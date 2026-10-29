# Pi `/resume`: readable session labels

## Current status and continuation

The implementation is committed on **`fix/pi-session-labels`**, through application/test commit
**`3c9f0b51`**. It has not been pushed, opened as a PR, or merged. Read
[PI_RESUME_SESSION_NAMES_HANDOFF.md](PI_RESUME_SESSION_NAMES_HANDOFF.md) before continuing.

**The user has additional findings from manual testing and will share them with the next agent.**
Those findings have not been supplied to this session. Their symptoms, reproduction steps and
causes are unknown; do not infer that they are already covered or resolved by the tests below.

### Superseded recommendation: caching

The original investigation recommended a cached streaming reader. The user subsequently asked
whether other agents' Earlier sessions listings cache metadata and explicitly directed removal
of the Pi-only cache when they do not. These listings read their metadata fresh; unrelated
conversation/process caches elsewhere in Ovis are not precedent for this flow.

**The approved implementation is uncached.** Every listing scans fresh metadata. There is no
metadata LRU, prefix hash, append checkpoint, retained retry progress, or shared in-flight answer.
Do not reinstate those mechanisms to satisfy the initial plan without discussing a concrete need
with the user. Resource and failure limits remain required.

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
independent reviewer pass.** User-reported manual findings are still pending.

## Latest verification

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

Read the handoff, obtain the user's new manual-testing findings, and reproduce those exact symptoms
before deciding on another change. Do not declare the task finished, publish a PR, or merge merely
because synthetic regressions pass. No laptop preview was started in this session, and the maintainer's
always-on main app was not stopped or modified.
