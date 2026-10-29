# Handoff: Pi Earlier sessions labels

## Start with the user's testing findings

**The user has new manual-testing findings and will share them with the next agent. They are not
recorded in this handoff or the report because their details have not been supplied yet.**

Ask for those findings before changing code. Obtain the actual symptom, expected behavior,
reproduction steps, laptop OS, Pi version, app URL/build, and which PC ran the Ovis backend.
A laptop browser reads the backend PC's sessions, not necessarily the laptop's. Do not assume the
user tested this branch or diagnose a cause before checking that context. Request only sanitized
metadata needed for reproduction, not whole private transcripts.

Read [PI_RESUME_SESSION_NAMES_REPORT.md](PI_RESUME_SESSION_NAMES_REPORT.md) for the investigation,
current design, review history and verification. The original cached-reader plan is superseded.

## Repository and branch state

- Checkout on this PC: `/home/idris/Dev/oss/ovis-herdr-web-ui-`.
- Continue on **`fix/pi-session-labels`**, not `main`; preserve the existing commits.
- Feature base: `e604183814d0293b51c192122c256e4c46288fb5`.
- Latest application/test commit at handoff: **`3c9f0b51`**. A subsequent documentation commit
  contains this handoff and the updated report; consult `git log` for the current HEAD.
- The branch is local and has no configured upstream. This session did not push, open a PR,
  merge, tag a release, or change the installed/main app. Do not tell the laptop user to fetch
  this branch from GitHub until it has actually been published or transferred.
- All session changes, including the previously untracked report, are committed for this handoff.
  Check `git status` first in case the user or another session changed anything afterward.

Commit order:

1. `2cfc5500` — `fix(session-history): stream native Pi session labels`
2. `402dc5ce` — `test(session-history): cover Pi history API and browser behavior`
3. `ce637646` — `docs(session-history): document Pi label scanning limits`
4. `b3da3794` — `fix(session-history): cancel checked opens before further I/O`
5. `3c9f0b51` — `test(session-history): guarantee API fixture cleanup on failure`
6. Documentation/handoff commit after those; its message identifies it without a self-referential hash.

## Required instructions and decisions

Read `AGENTS.md`, `server/AGENTS.md`, `src/AGENTS.md`, `CONTRIBUTING.md`, `.github/REVIEW.md`, and
`docs/development.md` before editing or running QA.

- **Keep the approved uncached design.** Other agents' Earlier sessions listings read fresh metadata;
  the user explicitly removed the Pi-only result cache and accepts rescanning. Do not restore an
  LRU, append/prefix cache, retained retry checkpoints or single-flight answers without agreement.
- Pi label priority: latest trimmed `session_info.name`; a blank name clears it; otherwise first
  usable user text. Pi `text` blocks join with spaces. Preserve the existing row/resume/UI contract.
- Preserve canonical containment, regular-file and bigint identity checks, checked descriptors,
  nonblocking/no-follow opens, permissions, other agents' 64 KiB head bounds, sorting and row limits.
- Synthetic tests only: owned temporary stores/state, isolated herdr, loopback `port: 0` servers.
  Never use the user's saved transcripts as fixtures or mutate their live herdr panes/session.
- Follow the project's verified-PR workflow when publication is authorized. Do not push, merge,
  modify installed services, or create release tags merely to complete this handoff task.

## Implementation map

- `server/pi-session-label.ts`: bounded incremental JSONL projection and EOF decoder finalization.
  No whole-record/transcript buffering, manual UTF-8-tail detector, or persistent parser checkpoint.
- `server/pi-session-metadata.ts`: fresh scans, two active readers/32 waiting tasks, 64 KiB chunks,
  independent two-second listing deadlines, task-owned `checkActive`, descriptor cleanup and stop.
- `server/session-history.ts`: Pi-only async listing, discovery/eligibility/ordering and
  `openPiChecked`. The cancellation guard is propagated inside raw open and identity-stat steps.
- `server/session-history-routes.ts`: permission checks and ordinary retryable 503 error envelope.
- `server/index.ts`: per-server reader creation, route wiring and shutdown.
- `server/pi-session-metadata.test.ts`: native naming, bounded parsing, freshness, actual filesystem
  callback cancellation/error regressions, gate cleanup and 20 MiB responsiveness.
- `server/session-history.test.ts`: existing provider bounds, paths, identities, cwd/version/ID rules
  and synchronous/non-Pi versus asynchronous/Pi listing behavior.
- `server/api.contract.test.ts`: `withPiHistoryFixture`, real HTTP checks and four fixture failure
  injections (workspace creation, server creation, server stop, workspace close).
- `scripts/session-history-browser-qa.ts`: real session-list components fed synthetic Pi transcripts,
  names/prompt fallback, rename/clear, busy errors and existing resume/menu behavior.
- `shared/session-history.ts`, `src/lib/api.ts`, `docs/development.md`: contract/policy documentation.
- `changelog.d/pi-session-labels.md`: existing user-visible fix fragment; do not edit CHANGELOG.md.

### Resource/failure tradeoffs

Each listing reads fresh metadata. A very large or slow store can exceed the two-second metadata
budget; retrying starts from zero, not from saved progress. Return 503 `session_history_busy` with
`Retry-After: 1` and `Cache-Control: no-store`, not partial/UUID-only rows from an unfinished scan.
Only filesystem operations already issued may finish after cancellation; their descriptor/slot is
retained until safe cleanup. No unchecked path is reopened. Coarse timestamps can still hide a
same-tick in-place rewrite from the final snapshot check.

## Latest verification and its limits

Final application/test contents were verified before commits 4/5 and these handoff documents:

- **126 targeted unit tests passed.**
- **Six isolated history contract tests passed**, including all four fixture failure paths.
- **Session-history browser regression passed.**
- Syntax, generated-file freshness, typecheck, build and `git diff --check` passed.
- **Full fast checks failed:** 8,670 unit passes, 35 skips, one known unrelated failure in unchanged
  `scripts/install-node-fallback.test.ts:299`. Its supposed Node-free `/usr/bin:/bin` fixture finds
  this PC's system Node, so it expects `[ node]` but gets `[]`. It reproduces alone; it was not
  fixed, skipped or hidden. Do not claim a fully green fast check.

Verification host: Linux/Bun 1.4.4; the runner warned that Node 26.7.0 differs from CI's Node 22.
The reports below record `ce637646` plus the pre-commit working diff and unchanged source during
execution. They do not establish a fresh verification identity for the subsequent commits/docs.
New code edits require new verification; run the required checks again before any push.

Machine-local, uncommitted artifacts (may not exist on a laptop or later session):

- Isolated pass: `node_modules/.cache/check/c70abdb1-b2ce-4fc4-ad6b-13cebd3ac4a5/report.json`.
- Fast failure: `node_modules/.cache/check/e4e32378-9efb-4857-bda8-97df76907c0f/report.json`.
- Source fingerprint of those runs:
  `e8ec81171e6317fe0058092f5a6ccf2c8a733dda7ce697a704b7f933ed457773`.
- Supplemental research/negative-control record: `/tmp/ovis-pi-label-fix-validation/RESULTS.md`.
  Disabling only guard propagation made the raw-open cancellation tests reproduce the extra stat.

### Useful commands

Run serially in the checkout; do not overlap builds/generated-file checks with other writers:

```bash
bun test server/pi-session-metadata.test.ts server/session-history.test.ts --timeout 30000
bun run typecheck
bun run check run bun test --timeout 15000 ./server/api.contract.test.ts --test-name-pattern 'GET /api/sessions/history'
bun run check run --build bun scripts/session-history-browser-qa.ts
bun run check fast
git diff --check
```

The `check run` wrapper owns its herdr/config/state and teardown. If Chromium is missing, follow
`docs/development.md` rather than using a personal browser profile. Read each check report's
status/source identity and retained-process errors, not only its exit code.

## Review status

The last independent four-lane xhigh review covered `e6041838..ce637646`. It found the nested
production-opener cancellation issue and the API fixture cleanup issue; commits 4/5 address them
with targeted regressions. **No independent reviewer pass has run on commits 4/5 afterward.**

Reviewer profiles here have read/search tools but no shell/Git. If the user asks for another
committed-range review, supply a complete readable diff artifact with the exact base/head and
changed-file list upfront. Do not let reviewers mistake a clean working-tree diff for the range,
or claim that they ran Git/tests when they could only inspect supplied evidence.

## Manual QA / laptop status

- No preview server was left running by this session. No laptop setup or code transfer was performed.
- The normal installed/main app does not automatically serve this local unpublished branch.
- A preview started by an agent for the user to open must follow `AGENTS.md`: bind this PC's
  Tailscale IPv4 on an unused port with separate app state, not `0.0.0.0` or an existing installed
  service port. Do not stop the always-on main app. An installed cross-device app needs HTTPS.
- If the user instead runs the backend on the laptop, it needs the actual branch code including
  commits 4/5 and reads that laptop's Pi store. Use `bun run server`, not the updating `start` mode.
- Ask which of these arrangements produced the new findings; do not assume one.

## Continuation checklist

1. Confirm checkout/branch/status and read the required guidance plus both root documents.
2. Obtain the user's new findings; distinguish observations from hypotheses and verify the tested
   build/backend/store context.
3. Reproduce the exact issue with owned/synthetic state where possible. Do not overwrite private
   session files or drive live panes to manufacture a reproduction.
4. Make a scoped correction and regression coverage while preserving the approved design unless
   the user explicitly changes it.
5. Rerun affected unit/isolated contract/browser checks; run fast checks and record any real failures.
6. Use Conventional Commits for subsequent commits. Keep existing history intact unless asked to
   restack/amend. Publish only when authorized, and never merge as part of this implementation pass.
