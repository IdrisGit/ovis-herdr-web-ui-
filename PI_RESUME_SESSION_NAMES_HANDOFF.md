# Handoff: Pi Earlier sessions labels

## Current state

- Checkout: `/home/idris/Dev/oss/ovis-herdr-web-ui-`, branch **`fix/pi-session-labels`**.
- Original continuation HEAD: **`6812d134`**. Latest application/test commit:
  **`d5e621c4279dce95bd2ab0d700eea358b4a87f70`** — `fix(session-history): address Pi metadata review findings`.
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

## Parallel review: all findings and optional items resolved

The user requested six parallel reviewers on the session model at xhigh, then directed fixing
**all findings, including optional cleanups**. The six lanes reviewed `e6041838..d666a82a` with
`openai/gpt-6.1-sol-fast:xhigh`. The parent independently reproduced both production edge cases
with owned synthetic files. `d5e621c4` resolves every accepted item:

- Reject overflowing header cwd/ID strings instead of using truncated identities, including the
  Windows padded-separator membership case. Exact-limit values remain valid; label clipping is separate.
- Match native falsy-preamble skipping while preserving truthy non-header rejection. Root strings
  retain one character for truthiness, and primitive records finalize independently of trailing whitespace.
- Assert malformed-UTF-8 rejection without a later rename masking bad acceptance; retain recovery coverage.
- Replace scheduling assumptions with controlled clocks/read gates and complete pending-fetch cleanup.
- Cover shared multi-file deadlines, queued expiry without opening, FIFO, and error-only HTTP refusal
  after a real first scan. Keep the aggregate workload ungated.
- Remove the unsupported comparative-performance changelog bullet.
- Apply all optional cleanups: zero-retention accumulation is a no-op, the immutable escape lookup
  is hoisted, and the duplicate immediate outer deadline check/unused error import are removed.

The four originating reviewers then checked `d666a82a..d5e621c4` at inherited xhigh thinking.
**All confirmed their items resolved with no new findings.** These were read-only source/evidence
reviews, not reviewer-run tests or authority to publish/merge. The report records the complete
resolution table and review artifact references. No finding establishes the private video's cause.

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

Clean **`d5e621c4`**, checked serially under the isolated runner with a fresh build:

- **136 targeted unit tests passed.**
- **Seven history API contract tests passed**, including the large store, all four fixture failure
  paths and an error-only 503 after a real first row.
- **Session-history browser regression passed**, with existing rename/clear/error/resume/permission coverage.
- Runner report: `node_modules/.cache/check/79036277-c45f-4775-8020-c9f162dbc8f7/report.json`.
  The runner ended test-command processes; no cleanup errors or retained state remain.

**Fast checks are still not green.** Clean-head rerun: **8,680 unit passes, 35 skips, one unchanged
failure in `scripts/install-node-fallback.test.ts:299`**. Its supposed Node-free `/usr/bin:/bin`
fixture finds system Node, so it expects `[ node]` but gets `[]`. It was not fixed, skipped or hidden.
Workflow syntax, generated types/themes, typecheck and build passed.

Fast report: `node_modules/.cache/check/a5c5c752-6f06-49ac-9c9b-e6d625345e50/report.json`.
Both reports record clean `d5e621c4`, unchanged source and fingerprint
`32c5d93e110f84fed7db6b935356d3b74300093cae7104aed0dfef10ffc9a254`.
The report/handoff update after `d5e621c4` is documentation only, outside the clean-commit runs.
Reports are machine-local artifacts, not committed or guaranteed to transfer.

Production edge-case regressions failed before correction. Temporary negative controls made the
new UTF-8 assertion fail under nonfatal decoding, and aggregate-expiry coverage fail under renewed
per-file deadlines. Both fault edits were restored before final verification; none is committed.

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

Prior commit sequence: `2cfc5500`, `402dc5ce`, `ce637646`, `b3da3794`, `3c9f0b51`, `6812d134`,
`6aca0609`, `d666a82a`. The report preserves their investigation and review history. The six-lane
review covered the full range through `d666a82a`, including the old opener/fixture fixes and the
bulk-string optimization. Four retained reviewers confirmed the subsequent `d5e621c4` resolutions.
Review workflow IDs: `794f9578-b5e0-416b-8111-bdd2b958dad2` and
`1dc723cc-6336-4bbd-b1d4-7d307cab5609`; all reviewer sessions were read-only.

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
