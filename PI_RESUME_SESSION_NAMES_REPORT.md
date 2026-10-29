# Pi `/resume`: readable session labels

## Current status and continuation

The implementation is committed on **`fix/pi-session-labels`**, through application/test commit
**`6aca0609`**. It has not been pushed, opened as a PR, or merged. Read
[PI_RESUME_SESSION_NAMES_HANDOFF.md](PI_RESUME_SESSION_NAMES_HANDOFF.md) before continuing.

The manual findings supplied after handoff **`6812d134`** are recorded below. A synthetic
reproduction and scoped parser optimization are verified. **The user's original openwhispr store
has not been retested with that optimization:** do not claim its observed failure is resolved
solely from synthetic passes.

### Superseded recommendation: caching

The original investigation recommended a cached streaming reader. The user subsequently asked
whether other agents' Earlier sessions listings cache metadata and explicitly directed removal
of the Pi-only cache when they do not. These listings read their metadata fresh; unrelated
conversation/process caches elsewhere in Ovis are not precedent for this flow.

**The approved implementation is uncached.** Every listing scans fresh metadata. There is no
metadata LRU, prefix hash, append checkpoint, retained retry progress, or shared in-flight answer.
Do not reinstate those mechanisms to satisfy the initial plan without discussing a concrete need
with the user. Resource and failure limits remain required.

## Manual follow-up: aggregate scan timeout

### Confirmed test context and observations

The user supplied `/home/idris/Videos/2026-10-29 23-02-08.mp4` and confirmed:

- The tested build was **`6812d134`**, served at `http://127.0.0.1:17318` from this branch.
- Browser, backend and Pi store were on this laptop, not a remote backend PC. Its OS reports
  **Omarchy Linux 4.0.6**, x86_64; Pi's recorded banner is **1.4.0**, also confirmed by the user.
- The findings are those in the video; no separate additional symptoms were reported.

The video shows Ovis's own folder listing readable labels around 10–13 seconds. Switching to
openwhispr, opening Chat's `/resume`, and selecting Pi shows “Reading sessions…” and then
“Pi sessions could not be read right now. Try again.” around 20–24 seconds. Switching that pane
to Terminal and using native `/resume` lists readable entries, with a **202-session** count,
around 28–31 seconds. The count is observed; transcript sizes and the specific error cause in
that private store were not measured. No private transcript text was copied into tests or this
report, and no live user pane was driven during this continuation.

### Synthetic reproduction and correction (`6aca0609`)

A new owned 202-session fixture makes the newest 50 transcripts about 200 MiB in total, using
fictional system prompts, extension state and tool results. With the original parser it fails
with `PiMetadataBusy` at the ordinary two-second listing deadline (test duration about 2.17 s,
including setup). This demonstrates an aggregate workload the previous single-20-MiB regression
did not cover; it is not a claim that the user's files have these sizes.

The bottleneck is the projection's per-character JavaScript loop and clipped-text update for
ordinary strings, including large fields not retained in labels. The correction validates
contiguous ordinary string spans in the regexp engine within the current chunk. Quotes,
escapes, Unicode decoding and forbidden controls still take their checked paths. It does not
skip validation of ignored or clipped fields, buffer whole records, change native naming, alter
other providers, or relax descriptor/permission checks. The two-second budget, 64 KiB chunks,
reader admission and **fresh uncached scans** are unchanged.

The new regression passes in about **0.55–0.63 s total**, including fixture setup/cleanup and
**two** complete independent listings. It counts both sets of descriptor bytes and checks the
50 newest IDs, readable labels and resource cleanup. These are local test durations, not a
promise of latency on arbitrary stores. New parser tests cover all 32 forbidden raw controls
inside a large ignored string and clipping/escape behavior across chunk boundaries. A real
HTTP contract on the isolated herdr runner independently lists a similarly sized 202-session
store and observes an appended rename on reopening. Existing browser coverage remains unchanged.
Very large/slow or changing files can still produce the documented retryable error. A manual
retest of the original store remains necessary to establish whether this correction addresses
its exact failure.

### Follow-up verification

On **clean `6aca06091b7d0ce6986a0953ee8cd5d807187b85`**:

- **129 targeted unit tests passed.**
- **Seven isolated history API contract tests passed**, including the large-store regression and
  all four fixture setup/teardown failure paths.
- **Session-history browser regression and a fresh build passed.**
- Runner report: `node_modules/.cache/check/1bd99426-c615-4038-9751-b611557f8ea0/report.json`.
  Source stayed unchanged; fingerprint
  `0e9926fe59649a1c116b9f19709f4333c1e00c4234f92e188b9c5e3649c3fde4`.
  The runner ended processes left by the test command; no cleanup errors or retained state remain.

**Full fast checks remain failed**, not skipped: **8,673 pass, 35 skip, one failure**, still
unchanged `scripts/install-node-fallback.test.ts:299` (expects `[ node]`, receives `[]` because
its supposed Node-free PATH contains system Node). Workflow syntax, generated types/themes,
typecheck and build passed. Report:
`node_modules/.cache/check/fc24da82-db10-483b-acb7-c831e9678736/report.json` records `6812d134`
plus the exact five-file diff committed as `6aca0609`, unchanged during execution; fingerprint
`8c330de5d0882bde3d392f08dda44d042f82e58e7ebc9de52cdbefa76cfdd9d0`.

Verification used Bun 1.4.4, herdr 0.9.5 and Node 26.7.0; the runner warns that CI pins Node 22.
The later report/handoff documentation update is not part of the clean application-commit run.
No new independent review was requested or performed. No push, PR, merge, tag, installed service
change or user-preview restart occurred.

## Original finding at base `e6041838`

Ovis intercepts Chat's `/resume` and opens **Earlier sessions** instead of Pi's native picker:

- `src/components/Composer.tsx` opens session history.
- `server/session-history-routes.ts` serves `GET /api/sessions/history` using `listSessions`.
- Before this branch, `server/session-history.ts` inspected only the first **64 KiB** of each
  transcript, discarding a final record crossing that cutoff.
- `src/components/SessionHistory.tsx` displays `row.title ?? row.firstMessage ?? row.id`.

The UI already prefers readable labels. The head-only reader could miss both append-only names
and a first user message following a large system prompt, extension record or other payload.

### Historical investigation evidence

The original read-only investigation established both mechanisms in separate saved sessions:

- A nonempty `session_info.name` began at byte **83,769**, past the previous read limit.
- Another session's first user message began at byte **96,868**, after a system record ending at
  byte 96,867. The user text itself was only 233 characters.

These establish failure mechanisms, not the identity of every row from the original report.
No browser reproduction, live-pane interaction or screenshots were performed during that initial
investigation. Later automated browser checks used fictional/synthetic fixtures only. Private
prompts, names and identifiers are intentionally not reproduced here.

## Authoritative label semantics

Checked against installed Pi **1.4.0**:

1. Use the **latest** `session_info.name`, trimmed. Empty/whitespace names clear an earlier name.
2. Without a name, use the first user message containing usable text. String content is supported;
   array content uses Pi `text` blocks joined with spaces, not `input_text` or image blocks.
3. Genuinely empty sessions retain the existing fallback. A scan stopped by its resource limits
   must not publish missing labels as though it completed successfully.

Authoritative installed references:

- `dist/core/session-manager.js`: `buildSessionInfo`, `appendSessionInfo`, `getSessionName`, and
  text extraction.
- `dist/modes/interactive/components/session-selector.js`: native display priority.
- `docs/session-format.md` and `docs/sessions.md`: metadata entries and session naming/storage.

The inspected package is under
`/home/idris/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/` on this PC.
Recheck the installed version when relevant. The parser is independently implemented; following
Pi's semantics does not require importing the whole SDK. Filenames, pane/workspace labels and
session IDs are not substitute name databases. Reading only a fixed head and tail is insufficient
because a name may occur in the middle of a long file.

## Implemented design

### Streaming projection: `server/pi-session-label.ts`

- Consumes UTF-8 JSONL incrementally; never buffers an entire transcript or arbitrarily large line.
- Retains only selected/clipped header and label fields, not conversation history or
  `allMessagesText`. Keys, primitive tokens and nesting are bounded; nesting past 64 levels is
  discarded through the next newline, as are malformed records.
- Handles large ignored system/extension/image data without losing later short metadata.
- Preserves BOMs for JSON validation rather than silently accepting BOM-prefixed records.
- `finish()` flushes the fatal decoder at EOF, accepting a complete newline-free final record and
  rejecting incomplete UTF-8. There is no manual tail detector or noncommitting preview API.

### Reader and integration

- `server/pi-session-metadata.ts` owns bounded admission and descriptor lifetimes, not a metadata
  cache. `server/index.ts` creates a reader per server and closes it at stop.
- `server/session-history.ts` gives Pi an asynchronous branch; other agents keep their existing
  synchronous/head-bounded behavior. Existing discovery budgets, supported versions, cwd matching,
  safe resume IDs/argv, sorting and the 50-row limit remain in place.
- Opens, identity stats and reads use the checked descriptor asynchronously. Canonical containment,
  regular-file checks, bigint device/inode comparison, and nonblocking/no-follow protections remain.
  Streams never reopen an unchecked path.
- One task-owned `checkActive` guard is passed into the production `openPiChecked` helper. It checks
  deadline/shutdown immediately after raw open and identity stat, inside descriptor-owning cleanup,
  as well as at reader-level I/O boundaries. Cancelling the caller does not prematurely close a
  descriptor still used by an outstanding filesystem operation.
- Late opener failures after a deadline remain retryable failures, not silently absent sessions.

### Resource policy and explicit tradeoffs

- **64 KiB chunks; two active readers; 32 waiting tasks.**
- One **two-second metadata-scan deadline per listing**, including queue time. Existing bounded
  directory discovery is unchanged. Time bounds replace a fixed per-file head/turn byte cutoff.
- Every retry starts over. Very large or slow stores can fail to finish within the request budget;
  reopening does not accumulate progress. No automatic/background retry is added.
- A final size and nanosecond mtime/ctime comparison refuses a file changed during scanning.
  Coarse filesystem timestamps can still hide a same-tick in-place rewrite.
- Busy/deadline/read-change failures use the normal API error envelope:
  **503 `session_history_busy`**, **`Retry-After: 1`**, **`Cache-Control: no-store`**. The existing
  client error path displays the failure rather than incomplete rows; successful row shape and
  title/first-message priority are unchanged.
- Watching devices are refused before store access. No prompt/name logging or persisted metadata
  format was added.

The policy is also documented in [docs/development.md](docs/development.md#pi-session-labels).

## Review findings addressed

Multiple independent review passes used the base model, with all four lanes at xhigh in the later
passes. They covered general correctness, project rules, simplicity/test necessity, and adversarial
parser/resource behavior. Reviewers were read/search-only; committed-range reviews received a full
Git diff artifact from the parent instead of pretending a clean working-tree diff covered commits.

Addressed findings and cleanups:

- LRU retry starvation and shared-waiter deadline adoption: removed with the approved no-cache,
  no-single-flight design.
- BOM acceptance mismatch: both decoder constructions preserve BOMs for rejection.
- Stale `readHead` test seam: retargeted to a non-Pi agent and verifies an actual descriptor read
  before the unsafe replacement case.
- Unused offsets, configuration and exports: removed. Read-error recovery now genuinely retries a
  previously failing reader instead of merely claiming recovery.
- Manual EOF tail/preview machinery: replaced by fatal decoder finalization.
- Held-read assertion/timeout cleanup: registered gate releases and local `finally`/outcome handling.
  Temporary fault-injection runs confirmed descriptor/task cleanup on both failure paths.
- Production nested-open cancellation: the same guard now reaches inside `openPiChecked`, not just
  the outer reader. Tests hold actual raw-open/identity-stat callbacks under shutdown and expiry.
- API fixture setup/teardown: `withPiHistoryFixture` guards setup and uses independent cleanup
  steps. Four injected failures cover workspace creation, server creation, server stop and workspace
  close against the isolated test session, with recovery of the deliberately unclosed owned workspace.

The last independent review inspected `ce637646`. Its final two P2 findings were addressed in
`b3da3794` and `3c9f0b51` and verified afterward. **Those follow-up commits have not received another
independent reviewer pass.** The subsequent manual follow-up and its verification are above;
that parser optimization has not received a new independent review either.

## Previous handoff verification

All tests use synthetic transcripts and owned temporary/isolated state, never copied private prompts.

- **126 targeted unit tests passed** across `server/pi-session-metadata.test.ts` and
  `server/session-history.test.ts`.
- **Six isolated history API contract tests passed**, including the four setup/teardown failures.
- **Session-history browser regression passed**, including rendered late names, prompt fallback,
  rename/clear behavior, retry errors and existing resume/menu behavior.
- Syntax checks, generated-file freshness, typecheck, build and `git diff --check` passed.
- **Full fast checks are not green:** 8,670 unit tests passed, 35 skipped, and one known unrelated
  failure remained in unchanged `scripts/install-node-fallback.test.ts:299`. Its supposedly
  Node-free `/usr/bin:/bin` fixture finds this PC's system Node. This failure also reproduces alone;
  it was not altered or hidden.

A temporary negative control disabled guard propagation into the production opener while preserving
outer reader checks. Both raw-open cancellation regressions then failed on the extra identity stat
(expected zero, observed one), demonstrating that the tests catch the formerly missed boundary.
Normal runs pass.

Machine-local verification reports (not committed or guaranteed to transfer to another laptop):

- `node_modules/.cache/check/c70abdb1-b2ce-4fc4-ad6b-13cebd3ac4a5/report.json`: isolated build +
  six API tests + browser regression, success.
- `node_modules/.cache/check/e4e32378-9efb-4857-bda8-97df76907c0f/report.json`: fast checks, failure
  only in the unrelated installer fixture.

Both runs recorded unchanged source during execution and source fingerprint
`e8ec81171e6317fe0058092f5a6ccf2c8a733dda7ce697a704b7f933ed457773`.
They record `ce637646` plus the then-uncommitted follow-up diff. Results apply to the final
application/test file contents subsequently committed in `b3da3794` and `3c9f0b51`; they are **not**
fresh verification of the later documentation/handoff commit identity. Rerun affected checks after
new source edits and follow repository verification requirements before any push.

## Next action

Have the user restart their manually started throwaway backend from this branch (not the installed
app or always-on main service), then repeat the video's openwhispr Chat `/resume` flow. A backend
already running `6812d134` does not acquire the parser correction from a browser reload. Record
whether the real store now lists successfully; if it still errors, obtain sanitized aggregate
metadata or an explicitly authorized read-only diagnosis before choosing another correction.
Do not introduce caching or claim complete resolution merely because synthetic regressions pass.
No preview was started or restarted by this continuation, and the always-on main app was untouched.
