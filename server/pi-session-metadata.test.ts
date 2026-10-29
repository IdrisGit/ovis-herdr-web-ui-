import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as fs from "node:fs";
import { appendFileSync, fstatSync, mkdirSync, mkdtempSync, openSync, read, realpathSync, renameSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SessionHistoryResponse, SessionSnapshot } from "../shared/protocol.ts";
import { PiLabelParser } from "./pi-session-label.ts";
import { PI_CHUNK_BYTES, PI_READ_DEADLINE_MS, PI_READERS, PiMetadataBusy, PiSessionReader } from "./pi-session-metadata.ts";
import { listSessions, piSessionFolder } from "./session-history.ts";
import { handleSessionHistoryRequest } from "./session-history-routes.ts";

const roots: string[] = [];
const readers: PiSessionReader[] = [];
const releases: Array<() => void> = [];
/** Every held I/O gate also releases on test failure/timeout, before cleanup waits for readers. */
function ioGate() {
  const gate = Promise.withResolvers<void>();
  releases.push(gate.resolve);
  return gate;
}
afterEach(async () => {
  const closing = readers.splice(0);
  for (const reader of closing) reader.close();
  for (const release of releases.splice(0)) release();
  await Promise.all(closing.map((reader) => reader.idle()));
  mock.restore();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const header = (id = "fixture", cwd = process.cwd()) => line({ type: "session", version: 3, id, cwd, timestamp: "2026-10-01T09:00:00Z" });
const prompt = (content: unknown) => line({ type: "message", message: { role: "user", content } });
const name = (name: unknown) => line({ type: "session_info", name });
const filler = (size: number) => line({ type: "message", message: { role: "system", content: "x".repeat(size) } });
function fixture(options: ConstructorParameters<typeof PiSessionReader>[0] = {}) {
  const home = mkdtempSync(join(tmpdir(), "ovis-pi-label-"));
  roots.push(home);
  const store = join(home, "sessions");
  const folder = join(store, piSessionFolder(process.cwd()));
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "fixture.jsonl");
  const io = { bytes: 0, max: 0 };
  const reader = new PiSessionReader({
    read: options.read ?? ((fd, buffer, length, position) => new Promise((done, fail) => {
      io.max = Math.max(io.max, length);
      read(fd, buffer, 0, length, position, (error, bytes) => { io.bytes += bytes; if (error) fail(error); else done(bytes); });
    })),
  });
  readers.push(reader);
  const stores = { home, env: { PI_CODING_AGENT_SESSION_DIR: store }, piReader: reader };
  return { file, folder, reader, io, stores, list: () => listSessions("pi", process.cwd(), stores) };
}
const parsed = (body: string, chunk = 7) => {
  const bytes = Buffer.from(body);
  const parser = new PiLabelParser();
  for (let start = 0; start < bytes.length; start += chunk) parser.feed(bytes.subarray(start, start + chunk));
  return parser.finish();
};

describe("Pi native label semantics", () => {
  it("uses latest names, trims them, clears them explicitly and ignores extension titles", () => {
    const body = header() + prompt(" First prompt ") + name("old") + line({ type: "title", title: "not a Pi name" });
    expect(parsed(body).title).toBe("old");
    expect(parsed(body + name("  new name  ")).title).toBe("new name");
    for (const clear of ["", " \t\n ", null, undefined]) {
      expect(parsed(body + name(clear))).toMatchObject({ title: null, firstMessage: "First prompt" });
    }
  });

  it("takes the first usable user text, text blocks only joined with spaces, not input_text or images", () => {
    const body = header() + prompt("   ") + prompt([{ type: "image", data: "abc" }, { type: "input_text", text: "not Pi text" }])
      + prompt([{ type: "text", text: "  Hello" }, { type: "image", data: "abc" }, { type: "text", text: "world  " }]) + prompt("later");
    expect(parsed(body).firstMessage).toBe("Hello world");
    expect(parsed(header() + prompt("  string content  ")).firstMessage).toBe("string content");
    expect(parsed(header() + prompt([{ type: "text", text: "a " }, { type: "text", text: " b" }])).firstMessage).toBe("a   b");
    expect(parsed(header() + prompt([{ type: "text", text: " ".repeat(10000) + "after leading whitespace" }])).firstMessage).toBe("after leading whitespace");
  });

  it("matches JSON parsing across every boundary, escapes and Unicode included", () => {
    const body = header() + prompt([{ type: "text", text: 'Hello 🐑 한글 \\ "\n\t' }, { type: "text", text: "friend" }])
      + '{"type":"session_info","name":"a \\uD83D\\uDC11 \\uD55C"}\n';
    for (let size = 1; size < 80; size++) expect(parsed(body, size)).toMatchObject({ title: "a 🐑 한", firstMessage: 'Hello 🐑 한글 \\ "\n\t friend' });
  });

  it("does not trust malformed records, but keeps reading after enormous and deeply nested ones", () => {
    const bad = ['{"type":"session_info","name":"bad",}', '{"type":"session_info","name":"bad"} trailing', '{"type":"session_info","name":"bad\\q"}', '{"type":"session_info","name":"bad","x":01}'];
    for (const invalid of bad) expect(parsed(header() + name("good") + invalid + "\n").title).toBe("good");
    const deeplyNested = `{"x":${"[".repeat(100)}0${"]".repeat(100)}}\n`;
    expect(parsed(header() + deeplyNested + '{broken\n' + filler(512 * 1024) + prompt("readable"), PI_CHUNK_BYTES).firstMessage).toBe("readable");
  });

  it("rejects BOM-prefixed records as native JSON.parse does, including split BOM bytes", () => {
    const invalid = `\ufeff${name("bad").trimEnd()}`;
    expect(() => JSON.parse(invalid)).toThrow();
    for (let size = 1; size < 8; size++) {
      expect(parsed(header() + name("good") + invalid + "\n", size).title).toBe("good");
      expect(parsed(header() + name("good") + invalid + "\n" + name("after"), size).title).toBe("after");
    }
  });

  it("rejects malformed UTF-8 records and waits for complete JSON across chunks", () => {
    const parser = new PiLabelParser();
    parser.feed(Buffer.from(header() + name("good")));
    parser.feed(Buffer.concat([Buffer.from('{"type":"session_info","name":"'), Buffer.from([0xff]), Buffer.from('"}\n')]));
    parser.feed(Buffer.from('{"type":"session_info","name":"next","ignored":1'));
    parser.feed(Buffer.from('2}\n'));
    expect(parser.finish().title).toBe("next");
  });

  it("flushes UTF-8 at EOF, accepting a whole final record but rejecting incomplete bytes after it", () => {
    const prefix = Buffer.from(header() + name("good"));
    const final = Buffer.from(name("끝 🐑").trimEnd());
    const cases = [
      { bytes: Buffer.concat([prefix, final]), title: "끝 🐑" },
      ...[[0xe2], [0xe2, 0x82], [0xf0, 0x9f, 0x90]].map((tail) => ({
        // The JSON itself is complete; only flushing the decoder reveals this invalid suffix.
        bytes: Buffer.concat([prefix, final, Buffer.from(tail)]), title: "good",
      })),
    ];
    for (const { bytes, title } of cases) {
      for (const size of [1, 2, 3, 7]) {
        const parser = new PiLabelParser();
        for (let at = 0; at < bytes.length; at += size) parser.feed(bytes.subarray(at, at + size));
        expect(parser.finish().title).toBe(title);
      }
    }
  });

  it("retains clipped text from huge user/image and name records, not their conversation payloads", () => {
    const body = header() + prompt([{ type: "image", data: "a".repeat(512 * 1024) }, { type: "text", text: "hello".repeat(10000) }]) + name(" ".repeat(10000) + "n".repeat(10000));
    const label = parsed(body, PI_CHUNK_BYTES);
    expect(label.title).toBe("n".repeat(201));
    expect(label.firstMessage).toBe("hello".repeat(401).slice(0, 2001));
    expect(JSON.stringify(label).length).toBeLessThan(2500);
  });
});

describe("Pi fresh streaming reader", () => {
  it("finds late prompts/middle names and rereads unchanged and appended files without caching", async () => {
    const f = fixture();
    const body = header() + filler(128 * 1024) + line({ type: "custom", data: "s".repeat(128 * 1024) }) + prompt("late short prompt")
      + name("  name in the middle  ") + filler(3 * 1024 * 1024);
    writeFileSync(f.file, body);
    const rows = await f.list();
    expect(rows[0]).toMatchObject({ title: "name in the middle", firstMessage: "late short prompt", resume: { argv: ["pi", "--session", "fixture"] } });
    const bytes = Buffer.byteLength(body);
    expect(f.io.bytes).toBe(bytes);
    expect(f.io.max).toBeLessThanOrEqual(PI_CHUNK_BYTES);
    expect(await f.list()).toEqual(rows);
    expect(f.io.bytes).toBe(2 * bytes);
    const suffix = name("renamed");
    appendFileSync(f.file, suffix);
    expect((await f.list())[0]?.title).toBe("renamed");
    expect(f.io.bytes).toBe(3 * bytes + Buffer.byteLength(suffix));
    appendFileSync(f.file, name("  "));
    expect((await f.list())[0]).toMatchObject({ title: null, firstMessage: "late short prompt" });
  });

  it("reads completed partial JSONL and multibyte writes on the next fresh listing", async () => {
    const f = fixture();
    const bytes = Buffer.from(prompt("한글 🐑"));
    const split = bytes.indexOf(Buffer.from("한")) + 1;
    writeFileSync(f.file, header() + name("named"));
    appendFileSync(f.file, bytes.subarray(0, split));
    expect((await f.list())[0]).toMatchObject({ title: "named", firstMessage: null });
    appendFileSync(f.file, bytes.subarray(split));
    expect((await f.list())[0]).toMatchObject({ title: "named", firstMessage: "한글 🐑" });
    appendFileSync(f.file, '{"type":"session_info","name":"');
    expect((await f.list())[0]?.title).toBe("named");
    appendFileSync(f.file, '"}\n' + name("latest"));
    expect((await f.list())[0]?.title).toBe("latest");
  });

  it("accepts a final record without a newline and ignores it if a later write makes it invalid", async () => {
    const f = fixture();
    writeFileSync(f.file, header() + prompt("first") + name("old"));
    appendFileSync(f.file, name("preview").trimEnd());
    expect((await f.list())[0]?.title).toBe("preview");
    appendFileSync(f.file, 'garbage\n');
    expect((await f.list())[0]?.title).toBe("old");
    appendFileSync(f.file, name("after"));
    expect((await f.list())[0]?.title).toBe("after");
  });

  it("reads replacements, truncation, same-size rewrites with restored mtime, changed middles and deletion afresh", async () => {
    const f = fixture();
    const initial = header() + filler(70 * 1024) + name("old") + filler(70 * 1024) + prompt("first");
    writeFileSync(f.file, initial);
    expect((await f.list())[0]?.title).toBe("old");
    const originalTime = statSync(f.file).mtime;
    writeFileSync(f.file, initial.replace('"old"', '"new"'));
    utimesSync(f.file, originalTime, originalTime);
    expect((await f.list())[0]?.title).toBe("new");
    writeFileSync(f.file, initial.replace('"old"', '"mid"') + filler(1000));
    expect((await f.list())[0]?.title).toBe("mid");
    truncateSync(f.file, Buffer.byteLength(header()));
    expect((await f.list())[0]).toMatchObject({ title: null, firstMessage: null });
    renameSync(f.file, `${f.file}.old`);
    writeFileSync(f.file, header("replacement") + prompt("replacement prompt"));
    expect((await f.list())[0]).toMatchObject({ id: "replacement", firstMessage: "replacement prompt" });
    rmSync(f.file);
    expect(await f.list()).toEqual([]);
  });

  it("keeps same-ID files in different stores and paths independent", async () => {
    const a = fixture(); const b = fixture();
    b.stores.piReader = a.reader;
    writeFileSync(a.file, header() + name("store A"));
    writeFileSync(b.file, header() + name("store B"));
    expect((await a.list())[0]?.title).toBe("store A");
    expect((await b.list())[0]?.title).toBe("store B");
    writeFileSync(join(a.folder, "other.jsonl"), header() + name("other path"));
    expect((await a.list()).map((row) => row.title).sort()).toEqual(["other path", "store A"]);
  });

  it("bounds open readers and waiting tasks, and closes descriptors on stop", async () => {
    const entered = Promise.withResolvers<void>();
    const release = ioGate();
    const descriptors = new Set<number>();
    const f = fixture({ read: async (fd, buffer, length, position) => {
      descriptors.add(fd);
      if (descriptors.size === PI_READERS) entered.resolve();
      await release.promise;
      return new Promise((done, fail) => read(fd, buffer, 0, length, position, (error, count) => error ? fail(error) : done(count)));
    } });
    writeFileSync(f.file, header());
    const jobs = Array.from({ length: 40 }, () => f.reader.read(() => openSync(f.file, "r"), performance.now() + 2000).catch((error: unknown) => error));
    try {
      await entered.promise;
      expect(f.reader.size()).toEqual({ active: PI_READERS, waiting: 32 });
      f.reader.close();
      expect(f.reader.size().waiting).toBe(0);
      release.resolve();
      expect((await Promise.all(jobs)).every((error) => error instanceof PiMetadataBusy)).toBe(true);
    } finally {
      f.reader.close();
      release.resolve();
      await Promise.all(jobs);
      await f.reader.idle();
    }
    for (const fd of descriptors) expect(() => fstatSync(fd)).toThrow();
    expect(f.reader.size().active).toBe(0);
  });

  it("keeps independent deadlines for concurrent reads of the same file and closes only after outstanding I/O", async () => {
    const entered = Promise.withResolvers<void>();
    const release = ioGate();
    const descriptors = new Set<number>();
    const f = fixture({ read: async (fd, buffer, length, position) => {
      descriptors.add(fd);
      if (descriptors.size === 2) entered.resolve();
      await release.promise;
      return new Promise((done, fail) => read(fd, buffer, 0, length, position, (error, count) => error ? fail(error) : done(count)));
    } });
    writeFileSync(f.file, header() + prompt("independent"));
    const long = f.reader.read(() => openSync(f.file, "r"), performance.now() + 2000);
    const longOutcome = long.catch((error: unknown) => error);
    // The elapsed deadline is the behavior under test, not a wait for unrelated work.
    const short = f.reader.read(() => openSync(f.file, "r"), performance.now() + 50);
    const shortOutcome = short.catch((error: unknown) => error);
    try {
      await entered.promise;
      expect(short).not.toBe(long);
      expect(await shortOutcome).toBeInstanceOf(PiMetadataBusy);
      for (const fd of descriptors) expect(fstatSync(fd).isFile()).toBe(true);
      expect(f.reader.size().active).toBe(2);
      release.resolve();
      expect(await longOutcome).toMatchObject({ firstMessage: "independent" });
    } finally {
      f.reader.close();
      release.resolve();
      await Promise.all([longOutcome, shortOutcome]);
      await f.reader.idle();
    }
    for (const fd of descriptors) expect(() => fstatSync(fd)).toThrow();
    expect(f.reader.size().active).toBe(0);
  });

  for (const reason of ["shutdown", "deadline"] as const) {
    it(`closes an opener returning after ${reason} without starting scan I/O`, async () => {
      const entered = Promise.withResolvers<number>();
      const release = ioGate();
      const f = fixture();
      writeFileSync(f.file, header());
      const stats = spyOn(fs, "fstat");
      const outcome = f.reader.read(async () => {
        const fd = openSync(f.file, "r");
        entered.resolve(fd);
        await release.promise;
        return fd;
      }, performance.now() + (reason === "deadline" ? 50 : 2000)).catch((error: unknown) => error);
      try {
        const fd = await entered.promise;
        if (reason === "shutdown") f.reader.close();
        expect(await outcome).toBeInstanceOf(PiMetadataBusy);
        expect(fstatSync(fd).isFile()).toBe(true);
        release.resolve();
        await f.reader.idle();
        expect(stats).not.toHaveBeenCalled();
        expect(f.io.bytes).toBe(0);
        expect(() => fstatSync(fd)).toThrow();
        expect(f.reader.size().active).toBe(0);
      } finally {
        f.reader.close();
        release.resolve();
        await outcome;
        await f.reader.idle();
        stats.mockRestore();
      }
    });
  }

  for (const phase of ["open", "identity stat"] as const) {
    for (const reason of ["shutdown", "deadline"] as const) {
      it(`stops the production opener after ${phase} when cancelled by ${reason}`, async () => {
        const entered = Promise.withResolvers<void>();
        const release = ioGate();
        const f = fixture();
        writeFileSync(f.file, header());
        const checked = realpathSync(f.file);
        const actualOpen = fs.open;
        const actualStat = fs.fstat;
        let fd = -1;
        let stats = 0;
        let now = performance.now();
        const clock = spyOn(performance, "now").mockImplementation(() => now);
        const opened = spyOn(fs, "open").mockImplementation(((...args: unknown[]) => {
          if (args[0] !== checked) return Reflect.apply(actualOpen, fs, args);
          const callback = args.at(-1) as (error: NodeJS.ErrnoException | null, fd: number) => void;
          return Reflect.apply(actualOpen, fs, [...args.slice(0, -1), (error: NodeJS.ErrnoException | null, value: number) => {
            if (error) { callback(error, value); return; }
            fd = value;
            if (phase === "open") {
              entered.resolve();
              void release.promise.then(() => callback(null, value));
            } else callback(null, value);
          }]);
        }) as typeof fs.open);
        const stated = spyOn(fs, "fstat").mockImplementation(((...args: unknown[]) => {
          if (args[0] !== fd) return Reflect.apply(actualStat, fs, args);
          stats++;
          if (phase !== "identity stat" || stats !== 1) return Reflect.apply(actualStat, fs, args);
          const callback = args.at(-1) as (error: NodeJS.ErrnoException | null, stat: fs.BigIntStats) => void;
          return Reflect.apply(actualStat, fs, [...args.slice(0, -1), (error: NodeJS.ErrnoException | null, stat: fs.BigIntStats) => {
            entered.resolve();
            void release.promise.then(() => callback(error, stat));
          }]);
        }) as typeof fs.fstat);
        const outcome = f.list().catch((error: unknown) => error);
        try {
          await entered.promise;
          expect(fstatSync(fd).isFile()).toBe(true);
          if (reason === "shutdown") {
            f.reader.close();
            expect(await outcome).toBeInstanceOf(PiMetadataBusy);
          } else {
            // Cross the listing's deadline while the actual production callback is held,
            // without relying on a timer racing setup on a loaded filesystem.
            now += PI_READ_DEADLINE_MS + 1;
          }
          expect(f.reader.size().active).toBe(1);
          release.resolve();
          expect(await outcome).toBeInstanceOf(PiMetadataBusy);
          await f.reader.idle();
          expect(stats).toBe(phase === "open" ? 0 : 1);
          expect(f.io.bytes).toBe(0);
          expect(() => fstatSync(fd)).toThrow();
          expect(f.reader.size()).toEqual({ active: 0, waiting: 0 });
        } finally {
          f.reader.close();
          release.resolve();
          await outcome;
          await f.reader.idle();
          opened.mockRestore();
          stated.mockRestore();
          clock.mockRestore();
        }
      });
    }
  }

  it("reports a production open error arriving after the deadline as busy, not an empty listing", async () => {
    const entered = Promise.withResolvers<void>();
    const release = ioGate();
    const f = fixture();
    writeFileSync(f.file, header());
    const checked = realpathSync(f.file);
    const actualOpen = fs.open;
    let now = performance.now();
    const clock = spyOn(performance, "now").mockImplementation(() => now);
    const opened = spyOn(fs, "open").mockImplementation(((...args: unknown[]) => {
      if (args[0] !== checked) return Reflect.apply(actualOpen, fs, args);
      const callback = args.at(-1) as (error: NodeJS.ErrnoException, fd: number) => void;
      entered.resolve();
      void release.promise.then(() => callback(Object.assign(new Error("synthetic open failure"), { code: "EACCES" }), -1));
    }) as typeof fs.open);
    const stats = spyOn(fs, "fstat");
    const outcome = f.list().catch((error: unknown) => error);
    try {
      await entered.promise;
      now += PI_READ_DEADLINE_MS + 1;
      release.resolve();
      expect(await outcome).toBeInstanceOf(PiMetadataBusy);
      await f.reader.idle();
      expect(stats).not.toHaveBeenCalled();
      expect(f.io.bytes).toBe(0);
      expect(f.reader.size()).toEqual({ active: 0, waiting: 0 });
    } finally {
      f.reader.close();
      release.resolve();
      await outcome;
      await f.reader.idle();
      stats.mockRestore();
      opened.mockRestore();
      clock.mockRestore();
    }
  });

  it.skipIf(process.platform === "win32" || Bun.which("mkfifo") === null)("does not block on or read a FIFO swapped in after the regular-file check", async () => {
    const f = fixture();
    writeFileSync(f.file, header());
    const checked = realpathSync(f.file);
    let swapped = false;
    const rows = await listSessions("pi", process.cwd(), { ...f.stores, stat: (path, bigint) => {
      const stat = bigint ? statSync(path, { bigint: true }) : statSync(path);
      if (path === checked && !swapped) {
        swapped = true;
        rmSync(path);
        expect(Bun.spawnSync(["mkfifo", path]).exitCode).toBe(0);
      }
      return stat;
    } });
    expect(swapped).toBe(true);
    expect(rows).toEqual([]);
    expect(f.io.bytes).toBe(0);
  });

  it("recovers from a failed read without retaining descriptors or failed metadata", async () => {
    let failing = true;
    const f = fixture({ read: async (fd, buffer, length, position) => {
      if (failing) throw new Error("fixture read error");
      return new Promise((done, fail) => read(fd, buffer, 0, length, position, (error, count) => error ? fail(error) : done(count)));
    } });
    writeFileSync(f.file, header() + prompt("recovered"));
    await expect(f.list()).rejects.toBeInstanceOf(PiMetadataBusy);
    await f.reader.idle();
    expect(f.reader.size()).toEqual({ active: 0, waiting: 0 });
    failing = false;
    expect((await f.list())[0]?.firstMessage).toBe("recovered");
  });

  it("checks cwd, version and usable IDs on every listing", async () => {
    const f = fixture();
    writeFileSync(f.file, header() + prompt("valid"));
    expect(await f.list()).toHaveLength(1);
    for (const body of [header("foreign", "/another-folder"), header("future").replace('"version":3', '"version":999'), header("  ")]) {
      writeFileSync(f.file, body + prompt("ineligible"));
      expect(await f.list()).toEqual([]);
    }
  });

  it("discards a file mutated during a scan and refuses expired work before opening a descriptor", async () => {
    let mutate = true;
    const f = fixture({ read: async (fd, buffer, length, position) => {
      if (mutate) { mutate = false; appendFileSync(f.file, name("arrived during scan")); }
      return new Promise((done, fail) => read(fd, buffer, 0, length, position, (error, count) => error ? fail(error) : done(count)));
    } });
    writeFileSync(f.file, header());
    await expect(f.list()).rejects.toBeInstanceOf(PiMetadataBusy);
    expect((await f.list())[0]?.title).toBe("arrived during scan");
    let opened = false;
    await expect(f.reader.read(() => { opened = true; return openSync(f.file, "r"); }, 0)).rejects.toBeInstanceOf(PiMetadataBusy);
    expect(opened).toBe(false);
  });

  it("keeps a server responsive during a fresh 20 MiB listing and reads the file again on the next request", async () => {
    const scanning = Promise.withResolvers<void>();
    let bytes = 0;
    const f = fixture({ read: (fd, buffer, length, position) => new Promise((done, fail) => {
      scanning.resolve();
      read(fd, buffer, 0, length, position, (error, count) => { bytes += count; if (error) fail(error); else done(count); });
    }) });
    writeFileSync(f.file, header());
    // Synthetic transcript, built in small writes rather than one giant test allocation.
    const block = filler(1024 * 1024);
    for (let n = 0; n < 20; n++) appendFileSync(f.file, block);
    appendFileSync(f.file, prompt("after twenty MiB") + name("large fixture"));
    const snapshot = async () => ({ workspaces: [{ workspace_id: "w" }], tabs: [{ workspace_id: "w", tab_id: "t", number: 1 }], panes: [{ tab_id: "t", cwd: process.cwd() }] }) as unknown as SessionSnapshot;
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => {
      const url = new URL(request.url);
      return url.pathname === "/ping" ? new Response("pong") : handleSessionHistoryRequest(request, url, { readOnly: false, stores: f.stores, snapshot });
    } });
    try {
      const origin = `http://127.0.0.1:${server.port}`;
      const url = `${origin}/api/sessions/history?workspace_id=w&agent=pi`;
      const listing = fetch(url);
      await scanning.promise;
      expect(f.reader.size().active).toBeGreaterThan(0);
      expect(await (await fetch(`${origin}/ping`)).text()).toBe("pong");
      expect(bytes).toBeLessThan(statSync(f.file).size);
      const first = await listing;
      expect(first.status).toBe(200);
      expect(first.headers.get("cache-control")).toBe("no-store");
      const rows = ((await first.json()) as SessionHistoryResponse).sessions;
      expect(rows[0]).toMatchObject({ title: "large fixture", firstMessage: "after twenty MiB" });
      const size = statSync(f.file).size;
      expect(bytes).toBe(size);
      const second = await fetch(url);
      expect(second.status).toBe(200);
      expect(((await second.json()) as SessionHistoryResponse).sessions).toEqual(rows);
      expect(bytes).toBe(2 * size);
    } finally { server.stop(true); }
  }, 30_000);
});
