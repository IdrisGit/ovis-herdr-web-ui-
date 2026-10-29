# Handoff: Pi Earlier sessions labels

## Current state

- Checkout: `/home/idris/Dev/oss/ovis-herdr-web-ui-`, branch **`fix/pi-session-labels`**.
- Original continuation HEAD: **`6812d134`**. Latest application/test commit:
  **`6aca06091b7d0ce6986a0953ee8cd5d807187b85`** — `fix(session-history): scan Pi label string spans in bulk`.
  The following documentation commit updates this handoff and the report; consult `git log`.
- The existing implementation and review fixes were preserved, not restarted.
- The branch remains local, with no configured upstream. No push, PR, merge, tag, installed-service
  change, user-preview restart or live-pane automation occurred. Publication requires permission.
- Read [PI_RESUME_SESSION_NAMES_REPORT.md](PI_RESUME_SESSION_NAMES_REPORT.md), plus `AGENTS.md`,
  `server/AGENTS.md`, `src/AGENTS.md`, `CONTRIBUTING.md`, `.github/REVIEW.md` and
  `docs/development.md` before further work. Check `git status` for later user/session changes.

## Manual findings are now supplied; original-store retest is pending

The user supplied `/home/idris/Videos/2026-10-29 23-02-08.mp4` and confirmed the tested build was
`6812d134`, with browser/backend/store on **this laptop**, Pi **1.4.0**, and no additional symptoms
beyond the video. `/etc/os-release` identifies the laptop as **Omarchy Linux 4.0.6**, x86_64.
The recorded URL is `http://127.0.0.1:17318`.

Observed sequence:

1. Chat `/resume` for Ovis's folder lists readable session labels (~10–13 s).
2. Switch to openwhispr, open Chat `/resume`, select Pi: “Reading sessions…” becomes
   **“Pi sessions could not be read right now. Try again.”** (~20–24 s).
3. Switch that pane to Terminal and use native `/resume`: readable entries and a **202-session**
   count appear (~28–31 s).

**Do not claim the private-store failure is resolved.** Synthetic fixtures reproduce an aggregate
scan timeout and now pass, but no private transcript was scanned/copied for this continuation and
no post-fix manual retry has been reported. A count of 202 does not establish the user's byte sizes
or prove which retryable failure occurred. The video was only inspected; its text/media are not
regression fixtures or repository artifacts.

## Scoped follow-up correction

The new owned 202-session fixture places about 200 MiB in the newest 50 files. Before the correction,
it fails at the unchanged two-second deadline with `PiMetadataBusy` (about 2.17 s test duration).
The old single-20-MiB regression passes and did not cover this aggregate workload.

`server/pi-session-label.ts` formerly iterated every ordinary string character in JavaScript,
including ignored system prompts, extension state and tool output. It now validates ordinary spans
in the regexp engine within the current read chunk. Quotes, escapes, raw control characters and
UTF-8 still receive full validation, including beyond clipped metadata and inside ignored fields.
This is a small parser optimization, not a reader redesign.

The 202-session regression now passes in about **0.55–0.63 s total**, including fixture setup/cleanup
and **two fresh listings**. It counts both complete scans, checks newest-first IDs/readable labels,
64 KiB reads and released resources. The isolated real API also lists a similarly sized store and
sees an appended rename on reopening. New boundary/control tests preserve validation and clipping.
These are local test durations, not arbitrary-store latency guarantees.

## Required decisions and invariants

- **Keep the explicitly approved uncached design.** No LRU, prefix hash, append checkpoint, retained
  retry progress, shared in-flight answer or background scan without discussing a concrete need.
- Latest trimmed `session_info.name` wins; blank clears it; otherwise first usable user text.
  Pi `text` blocks join with spaces; no extension `title` fallback. Preserve the row/resume contract.
- Keep canonical containment, regular-file/bigint identity checks, checked descriptors,
  nonblocking/no-follow opens, permissions, other agents' 64 KiB head bounds, sorting and row limits.
- Keep two active readers, 32 waiting tasks, 64 KiB chunks and independent two-second listing
  deadlines. Very large/slow or changing files can still fail; retrying starts over, not from cache.
- Failed/incomplete scans return 503 `session_history_busy`, `Retry-After: 1`,
  `Cache-Control: no-store`, never missing-label/partial rows presented as success.
- Task cancellation reaches inside raw-open and identity-stat callbacks; outstanding filesystem
  calls keep their descriptor/slot until safe cleanup. Never reopen an unchecked path.
- Fixtures use owned temporary stores/state, loopback `port: 0` servers and the isolated check runner.
  Never mutate live user panes, copy private transcripts into fixtures or modify installed services.

## Latest verification and limitations

Clean **`6aca0609`**, checked serially under the isolated runner with a fresh build:

- **129 targeted unit tests passed.**
- **Seven history API contract tests passed**, including the large store and all four fixture failure paths.
- **Session-history browser regression passed**, with existing rename/clear/error/resume/permission coverage.
- Runner report: `node_modules/.cache/check/1bd99426-c615-4038-9751-b611557f8ea0/report.json`.
  Source unchanged; fingerprint `0e9926fe59649a1c116b9f19709f4333c1e00c4234f92e188b9c5e3649c3fde4`.
  The runner ended test-command processes; no cleanup errors or retained state remain.

**Fast checks are still not green.** Rerun result: **8,673 unit passes, 35 skips, one unchanged
failure in `scripts/install-node-fallback.test.ts:299`**. Its supposed Node-free `/usr/bin:/bin`
fixture finds system Node, so it expects `[ node]` but gets `[]`. It was not fixed, skipped or hidden.
Workflow syntax, generated types/themes, typecheck and build passed.

Fast report: `node_modules/.cache/check/fc24da82-db10-483b-acb7-c831e9678736/report.json`, recording
`6812d134` plus the exact five-file diff committed as `6aca0609`, unchanged during execution;
fingerprint `8c330de5d0882bde3d392f08dda44d042f82e58e7ebc9de52cdbefa76cfdd9d0`.
The report/handoff update after `6aca0609` is documentation only, outside the clean-commit run.
Reports are machine-local artifacts, not committed or guaranteed to transfer.

Host: Bun 1.4.4, herdr 0.9.5, Node 26.7.0 (CI pins Node 22; runner warns). No native macOS/Windows
or complete integration/browser lane was run for this scoped continuation. `git diff --check` passed.

## Implementation and review map

- `server/pi-session-label.ts`: bounded incremental JSONL projection, bulk ordinary-string validation,
  EOF decoder finalization. No whole-record/transcript buffering or persistent checkpoints.
- `server/pi-session-metadata.ts`: fresh scans, reader admission/deadlines, cancellation and cleanup.
- `server/session-history.ts`: Pi-only async listing and `openPiChecked`; other agents remain unchanged.
- `server/session-history-routes.ts`, `server/index.ts`: permissions, error envelope, per-server lifecycle.
- `server/pi-session-metadata.test.ts`: native semantics, bulk validation boundaries, aggregate scans,
  freshness, actual filesystem callback cancellation/errors, resource cleanup and responsiveness.
- `server/session-history.test.ts`: provider bounds, paths/identities, eligibility and ordering.
- `server/api.contract.test.ts`: `withPiHistoryFixture`, real HTTP checks, aggregate store and four cleanup failures.
- `scripts/session-history-browser-qa.ts`: unchanged real-component coverage with synthetic Pi metadata.
- `docs/development.md`, `changelog.d/pi-session-labels.md`: policy and user-visible notes.

Commit sequence before the new correction: `2cfc5500`, `402dc5ce`, `ce637646`, `b3da3794`,
`3c9f0b51`, `6812d134`. The report preserves their investigation and review history.
The last independent review covered through `ce637646`; its opener-cancellation and fixture-cleanup
findings were fixed in `b3da3794`/`3c9f0b51`. Neither those fixes nor `6aca0609` have received a later
independent review. No new delegation/review was requested for this continuation.

## Next action

Have the user restart their **manually started throwaway backend from this branch**, not the
installed app or always-on main service, and repeat the video's openwhispr Chat `/resume` flow.
Reloading the browser does not update a backend still running `6812d134`. Record the result before
claiming the observed issue resolved. If it still fails, get sanitized aggregate metadata or explicit
authorization for a read-only diagnosis; do not invent a new symptom or silently introduce caching.

If further code changes are needed, repeat the affected checks serially:

```bash
bun test server/pi-session-metadata.test.ts server/session-history.test.ts --timeout 30000
bun run check run bun test --timeout 15000 ./server/api.contract.test.ts --test-name-pattern 'GET /api/sessions/history'
bun run check run --build bun scripts/session-history-browser-qa.ts
bun run check fast
git diff --check
```

An agent-started preview someone will open binds to the laptop's Tailscale IPv4 on an unused port
and separate state, per `AGENTS.md`; never replace an installed service or stop the always-on main
app. Cross-device app installation needs HTTPS. No preview was started by this continuation.
Do not push, open a PR, merge, tag or change services without authorization.
