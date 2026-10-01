# TASK-AI-64 — Live autonomous coding loop

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Work Item ID    | `TASK-AI-64`                                                                                                                                                                                                                                                                                                                                         |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                                                |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                                                                                              |
| Delivery order  | `192` (the next free order after `TASK-AI-61` at `191`; the register row is present as row `192` with status `READY_FOR_CODEX`)                                                                                                                                                                                                                               |
| Dependencies    | `TASK-AI-50`; `TASK-AI-58`; `TASK-AI-59`; `TASK-AI-60`; `TASK-AI-61`; `TASK-AI-63`                                                                                                                                                                                                                                                                    |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                                                                                                                             |
| Risk            | `HIGH`                                                                                                                                                                                                                                                                                                                                               |
| Allowed paths   | `tools/ai-brain/orchestrate.js`, `tools/ai-brain/planner.js`, `tools/ai-brain/prompt-compiler.js`, `tools/ai-brain/supervisor.js`, `tools/ai-brain/review-loop.js`, `tools/ai-brain/executor.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/harness.js`, `tools/ai-brain/isolation-launcher.js`, `tools/ai-brain/publisher.js`, `tools/ai-brain/decisions.js`, `tools/ai-brain/approval-registry.js`, `tools/ai-brain/exercise/e1-branch-name.cases.json`, `tools/ai-brain/branch-name.js`, `tools/ai-brain/test/task-ai-64.test.js`, `tools/ai-brain/test/fixtures/task-ai-64/`, `tools/ai-brain/test/isolation.test.js`, `tools/ai-brain/test/executor.test.js`, `tools/ai-brain/test/task-ai-60.test.js`, `docs/product-spec/work-items/TASK-AI-64.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | `Codex — fresh independent task`                                                                                                                                                                                                                                                                                                                       |
| Branch          | `feat/task-ai-64-live-loop`                                                                                                                                                                                                                                                                                                                 |
| Pull Request    | `#166`                                                                                                                                                                                                                                                                                                                                            |

`READY_FOR_CODEX` records that the implementation is submitted for independent Codex review
in `#166`, **not** that this Work Item is complete. The **live-run acceptance evidence is
still outstanding**: no Live Run 1-3 artifact — run log, launch result, worker-root diff,
checkpoint capture, decision JSONL or draft Pull Request — is attached to this Work Item yet,
so every row that cites one is unmet: `AC-AI-64-01`, `-02`, `-03`, `-06`, `-07`, `-08`, `-11`,
`-12`, `-18` and `-21`, together with the operator-host half of `-05`. The contract suite in
`tools/ai-brain/test/task-ai-64.test.js` covers rows `-04`, `-05`, `-09`, `-10`, `-13`, `-14`,
`-15`, `-16`, `-17`, `-19`, `-20`, `-22`, `-23` and `-24`; the remaining rows carry their
reserved test ids and are unmet.

`tools/ai-brain/test/fixtures/task-ai-64/` is an allowed path because
`tools/ai-brain/test/task-ai-64.test.js` reads it at load time and copies from it: the three fixtures
`hermes-usage-report.json`, `checkpoint-resume.json` and `approval-registry.json` are required by the
named test file, and a Pull Request that carries the test without them is not buildable.

`tools/ai-brain/test/e1-branch-name.test.js` is deliberately **not** an allowed path. It is
materialised inside the worker root at run time and is never committed (§ "First live coding
exercise"), so it must not appear in the author's Pull Request either: `pnpm test:brain` is
`node --test "tools/ai-brain/test/*.test.js"` (`package.json:26`), and a committed file at that path
would join the integration suite on `main` and break it there. That fail-before belongs inside the
worker root — not in the author's file boundary, and not on the integration branch. The committed
artifact of the exercise is the data file
`tools/ai-brain/exercise/e1-branch-name.cases.json`.

## Business outcome

The autonomous loop that `TASK-AI-60` proved only as a dry run becomes a **live** loop that runs
without a human at the keyboard and without a human at the keyboard deciding anything it should not
decide. One real user goal travels the whole distance:

> user goal -> validated DAG -> Controller candidate -> pinned execution -> isolated worker ->
> code / test / commit -> exact-SHA review -> bounded repair -> publisher draft PR

Before this Work Item, every stage after "goal" was either a simulation or an injection point. The
shipped `orchestrate` entrypoint launches a no-op success by default, gates review with
`() => ({ pass: true })`, seeds the exact-SHA guarantee with the string `'head'`, calls
`ranking.rankAndRecord` directly with `dryRun: true` so the decision is never written, imports
`classifySession` and never calls it, keeps its checkpoint in memory and never writes it, parses the
agent handle out of a stream that does not carry it, and has no publisher caller and no approval
producer. The result is that the loop looks complete in a test and cannot run once.

After this Work Item, an operator can start one live run, name one goal, and receive a **draft Pull
Request** whose head is a commit that a real coding agent produced, a real test suite proves, and an
independent reviewer read at that exact commit. The operator's judgement is still required — but only
at the two places the specification says it belongs: choosing the Work Item, and merging.

The loop's autonomy is bounded by construction, not by convention. The Controller still chooses every
candidate. The worker still cannot reach GitHub. The publisher still runs outside the worker. The
draft Pull Request produced by a live run is a **proof artifact** and is never merged by the loop, by
the publisher, or by this Work Item's acceptance.

## Source references

- `AGENTS.md` — Role separation (Codex plans, Gemini authors, Codex reviews, human merges); Unit of
  delivery (one Work Item per branch and Pull Request); Definition of a complete feature; Code review
  rules (no simulation as completion evidence, no production hardcode, no hidden TODO).
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` — Per-Work-Item procedure;
  human gates; the unattended supervisor state machine; "CI and review gates" the loop must not
  bypass.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` — `AI-TOOL-03` (one
  implementation agent, one writer per Work Item), `AI-SUP-01` (the supervisor is a deterministic
  PowerShell loop, not an LLM agent loop), `AI-SUP-05` (governed exact-HEAD auto-merge only under
  TASK-AI-13 preflight), `AI-SUP-21` (only the allowlisted Codex App identity may carry a terminal
  verdict; a fallback reviewer is recorded as `FALLBACK_PASS` and must be named).
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md` — the section structure this
  document follows.
- `docs/product-spec/work-items/TASK-AI-58.md` — Controller MVP: candidate selection, evidence,
  quota, ranking, reservation, checkpoint/resume, decision log. This Work Item calls it; it does not
  replace it.
- `docs/product-spec/work-items/TASK-AI-59.md` — the seven `CLOSED` requirements for the live E2E
  worker, including "the publisher is outside the worker boundary" and "cleanup removes every
  worker-owned process".
- `docs/product-spec/work-items/TASK-AI-60.md` — the dry-run loop, rules `AI-60-R01`..`AI-60-R06`,
  tests 15-30. Every one of those tests must still pass after this Work Item; this Work Item replaces
  the *simulations*, not the rules.
- `docs/product-spec/work-items/TASK-AI-61.md` — the implemented isolation boundary (`ShipDeWorker`
  local user, ACLs, firewall, `CLOSED` verdict) and `tools/ai-brain/publisher.js` as the only
  component allowed to GitHub-write.
- `docs/product-spec/work-items/TASK-AI-63.md` — the Hermes v0.21.4 CLI contract: under `-z` stdout
  carries only the final response text; the durable handle is `session_id` in the `--usage-file`
  JSON report; a failed run reports `session_id: null` and must stay a hard `HARNESS_NO_SESSION_ID`.
  The recorded "remaining integration gap" in that Work Item is a prerequisite of this one.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — rows `189`..`192`
  (TASK-AI-60, -62, -63, -61) record the verdict vocabulary (`PASS`, `FALLBACK_PASS`) and the
  one-Way-merge evidence standard (`headRefOid` must be a 40-character SHA).
- `C:/Users/gumac/AI/shipde-platform/.worktrees/logs/night/task-ai-64-live-gap-audit.md` — the
  read-only gap audit of `tools/ai-brain` at `origin/main` that is the technical input to the
  implementation plan in this document. Its `REUSE` / `WIRE` / `MISSING` / `REJECT` verdicts are
  cited per step below.
- Code seams (read at `origin/main`): `tools/ai-brain/orchestrate.js`, `planner.js`,
  `prompt-compiler.js`, `supervisor.js`, `review-loop.js`, `executor.js`, `cli.js`, `harness.js`,
  `isolation-launcher.js`, `publisher.js`, `decisions.js`, `ranking.js`, `scheduler.js`,
  `fitness.js`, `failure-classifier.js`, `discovery/adapters.js`, `reconcile.js`,
  `scripts/ai/control.ps1`, `package.json`.

## Preconditions and dependencies

- `TASK-AI-50` merged — Hermes pinned adapter exists, so a pinned `candidateKey` is executable.
- `TASK-AI-58` merged — the Controller is on `main` and owns selection, evidence, ranking, quota,
  reservations, failure classification, fallback and the decision log.
- `TASK-AI-59` merged — the `CLOSED` definition exists and names the publisher boundary.
- `TASK-AI-60` merged — `planner.js`, `prompt-compiler.js`, `supervisor.js`, `review-loop.js`,
  `orchestrate.js` and the `orchestrate` CLI subcommand exist, so this Work Item wires real
  dependencies into existing seams rather than adding modules beside them.
- `TASK-AI-61` merged — the OS isolation is implemented; a live run may only be claimed when
  `scripts/ai/isolation/Test-WorkerIsolation.ps1` reports `Final Verdict: CLOSED` on the operator
  host. Code changes alone never make it `CLOSED` (`TASK-AI-61` runbook).
- `TASK-AI-63` merged — the Hermes adapter emits only real v0.21.4 options. Its recorded remaining
  integration gap (nobody supplies `usageFile`; the executor parses stdout) is closed here.
- Operator prerequisites (human, not code): the worker user is provisioned, ACLs and firewall rules
  applied, the DPAPI credential stored, and the `CLOSED` verdict obtained. Without them, a live run
  is refused (`ISOLATION_BOUNDARY_MISSING`), which is the correct outcome, not a fallback to an
  unisolated worker.
- No dependency on a new model, provider, account or gateway. The loop reads the existing registry.

## Author boundary

`GEMINI`, not `9ROUTER`. The scope crosses the Controller dispatch seam, the OS isolation launcher,
host-side test execution, an exact-SHA review binding, an approval authority and a GitHub write
performed by an external publisher. That is architecture, a credential boundary and a GitHub write —
every `9ROUTER` prohibition in `AGENTS.md`. Two failed `9ROUTER` attempts require escalation; here
escalation is decided up front.

Consequential decisions that still require human approval before the author starts:

1. **The approval authority.** `tools/ai-brain/publisher.js:147` reads an approval registry that
   nothing in the repository writes. The author must implement *who* writes an `APPROVED` entry and
   *under what authority*; the human accepts that design. A loop that can mint its own approval has
   proved nothing.
2. **The reviewer's identity in the live loop.** `control.ps1:1851-1880` reviews a Pull Request head
   through the host-authenticated Codex CLI. A live run has no Pull Request at review time, so the
   author must bind the review to the same exact SHA and the same `PASS` / `CHANGES_REQUIRED` /
   `BLOCKED` schema by a route the human accepts, and record which route it used.
3. **The live-run blast radius.** The author may not run a live run against a branch that is not a
   fresh `feat/task-ai-64-*` branch, and may not merge the resulting draft Pull Request.
4. **Governed auto-merge is out of scope.** `AI-SUP-05` stays exactly as it is. This Work Item does
   not touch `control.ps1` auto-merge and may not make a live run merge anything.

## Non-negotiable principles

These are the acceptance floor, not aspirations. A Pull Request that violates any of them is
`CHANGES_REQUIRED` regardless of how many tests pass.

| ID           | Principle                                                                                                                                                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI-64-P01`  | **The Controller is the only selector.** No module in the loop picks a candidate, an account, a model, a gateway or a fallback. Selection is a Controller decision made from the registry, the evidence store, quota, reservations and the decision log, and the loop only *consumes* it. A loop that ranks, filters or prefers is out of scope. |
| `AI-64-P02`  | **Hermes never changes provider, model, account or gateway.** The four are pinned by the Controller and passed into the adapter. A value the worker or the loop derives, guesses, defaults or "improves" is a hard failure, not a convenience. There is no default model and no default provider anywhere in the path. |
| `AI-64-P03`  | **The worker has no GitHub credential and never pushes, opens a Pull Request or merges.** This holds by OS boundary (TASK-AI-61), not by prompt. The prompt states the boundary; the firewall and the ACLs enforce it. A prompt that merely asks nicely is not a control.      |
| `AI-64-P04`  | **The publisher never runs in the worker.** The publisher runs operator-side, on the host tree, and is the only component permitted to reach GitHub. A publisher invoked from inside the worker root is a refusal, and the refusal is logged.                                                             |
| `AI-64-P05`  | **No second state store, registry, quota store, ranking engine or checkpoint store.** The decision log, the source registry, the evidence store, the quota store and the ranking engine are the existing ones. The loop adds no queue and no store of its own; a repair is a new plan over the same stores. |
| `AI-64-P06`  | **No hard-coded model, provider, account, gateway or source id anywhere in production code or tests.** Every identity comes from the registry and the evidence store through the Controller. A literal in a test that encodes today's provider is a defect, not a fixture.                              |
| `AI-64-P07`  | **The live-proof draft Pull Request is never merged.** The publisher creates a **draft** Pull Request and stops. The loop has no merge path, the publisher has no merge path, and the acceptance evidence of this Work Item is produced without merging anything. A human may later merge the draft by hand, entirely outside this Work Item. |
| `AI-64-P08`  | **Absence of evidence is never evidence of success.** An empty stdout, a missing artifact, an unreadable decision log, a missing session handle, a skipped gate and a default `pass` are all refusals, not passes. Every injected fallback that currently returns success is deleted.                 |

## In scope

1. `orchestrate` re-enters through the Controller's real dispatch seam (`cli.js` `dispatchCommand` /
   `executor.js` `executePlan`) so writer claims, the implementation ceiling, reservations, evidence,
   quota and the written decision are the Controller's, not the loop's.
2. `--isolated-worker` reaches every launch in the loop; the `run`-injection exemption that silently
   drops isolation is removed; the worker is provisioned at a **pinned base SHA**, not at the
   operator worktree's current `HEAD`.
3. A real durable session handle: the launch supplies `--usage-file`, the handle is read from that
   report's `session_id`, and `process.pid` is never recorded as a session.
4. The checkpoint is written through the existing atomic writer, read back through the existing
   reader, and extended rather than duplicated; a resumed run does not re-run a completed step.
5. The supervisor is actually called, and it is given a real signal: a progress producer for the live
   session, an `inspect` on the Hermes adapter, and the third `job` argument the Hermes `resume`
   requires.
6. The three loop defaults (`runTests`, `review`, `repair`) become hard refusals when absent, are
   bound to a **host-side deterministic test runner** driven by the item's own
   `verification.command` / `verification.expect`, and are bound to an **exact-SHA reviewer** that
   must return the SHA it read. A review without a SHA is a refusal.
7. Repair is re-planned: open findings become a new work-item spec, the spec goes back through
   `planner.plan` (so unknown dependencies, cycles and file double-ownership are still rejected),
   and the repair budget is finite and returns `BLOCKED` when exhausted.
8. The publisher is called with the reviewed SHA, the verdict and a valid, unexpired, registered
   approval; the approval registry gains a producer; and a **draft** Pull Request is created with a
   title that satisfies the register's evidence standard and a head that satisfies the reviewer's
   exact-SHA rule.
9. The first live coding exercise (§ "First live coding exercise") is defined, seeded as data, and
   driven end-to-end by three live runs (§ "Live runs").

## Out of scope

- Any product, UI, API, persistence, tenant, money, carrier or credential change. This Work Item
  changes the toolchain only.
- Any change to `control.ps1` auto-merge (`AI-SUP-05`) or to the `TASK-AI-13` preflight.
- Merging the live-proof draft Pull Request, or marking it ready for review, or auto-merge of it.
- Changing the Controller's selection policy, ranking weights, failure classification or quota
  arithmetic. The loop calls the Controller; it does not teach it.
- A daemon, a scheduler service, a new transport, or an agent framework import.
- Multi-item DAG concurrency. The live run proves one item end to end; the ceiling
  (`AI-TOOL-03`) and `scheduler.planDispatch` remain the only concurrency authority.
- Running a live worker on a branch other than a fresh `feat/task-ai-64-*` branch.
- Any new model, provider, account or gateway registration.

## Business rules and edge cases

| Rule          | Behavior                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AI-64-R01`   | A real goal produces a validated DAG. An unknown dependency, a dependency cycle or two items owning one file fails closed before any launch; nothing is deferred silently. `planner.js` remains the only validator.       |
| `AI-64-R02`   | The prompt carries the item's allowed files, its forbidden region, its test command, its acceptance criteria and the pinned `candidateKey`, and the publisher boundary verbatim. A prompt missing any of them is not dispatchable.                            |
| `AI-64-R03`   | The Controller's decision is the one that is used, and it is **written** to the decision log before the launch, with the ranking inputs recorded — never as a dry run whose decision is discarded.                                                                                   |
| `AI-64-R04`   | A launch that cannot produce a real durable handle is a failure. `HARNESS_NO_SESSION_ID` is never softened into a pid, a timestamp or a "latest" lookup. A resume uses the handle from the `--usage-file` report, and the handle survives the process.                     |
| `AI-64-R05`   | An empty success is `COMPLETED_EMPTY`, a live session with no progress for the stall window is `STALLED`, a dead process is `FAILED`. A loop that reaches review with `COMPLETED_EMPTY` or `STALLED` does not review and does not publish.                                                 |
| `AI-64-R06`   | Tests run **host-side**, outside the worker, because the worker is untrusted and can forge its own output. The gate is the item's `verification.command` compared against `verification.expect`; a missing command is a refusal, never `node --test` assumed.                     |
| `AI-64-R07`   | A review is bound to the exact SHA it read. A review naming a different SHA is `STALE_REVIEW_SHA`; a review naming **no** SHA is refused, because an unbound review is evidence for every commit at once. `PASS` with open findings is rejected.                                           |
| `AI-64-R08`   | The reviewer differs from the writer in candidate identity: a different account, or a different model, or a different gateway, or a different upstream — a route chosen by the Controller through the review lane, never chosen by the loop. A reviewer that equals the writer is a refusal.                       |
| `AI-64-R09`   | An open finding produces a **repair task**: a new work-item spec whose acceptance criteria are the findings, re-planned through the planner. Repair that would re-own a file already owned by the item it repairs is rejected at `planner.js` (`FILE_OWNED_TWICE`), not downstream.      |
| `AI-64-R10`   | Repair is finite. Exhausting the budget returns `BLOCKED`, records `REPAIR_BUDGET_EXHAUSTED` and publishes nothing. There is no unbounded retry anywhere in the loop.                                                                                                                                       |
| `AI-64-R11`   | A failure classified as `upstream` / `gateway` / `account` / `model` / `candidate` / `access_path` / `harness` selects the next candidate through the Controller's `sameFailureDomain`, not a second, simpler definition of "different domain".                                                                       |
| `AI-64-R12`   | The publisher accepts only a 40-character reviewed SHA that equals the current head, a verdict from the accepted enum, and an unexpired approval present in the registry as `APPROVED` and bound to that SHA. Anything missing, expired, mismatched or unbound is `PUBLISH_REFUSED`.                          |
| `AI-64-R13`   | The publisher creates a **draft** Pull Request whose title begins with `[<WORK_ITEM_ID>]` and whose head is the reviewed SHA. It then stops. It never marks the Pull Request ready, never merges, never approves, never comments.                                                                             |
| `AI-64-R14`   | The decision log is the trace. Every selection, launch, session id, branch, classification, review round, verdict and outcome is recorded there, credential-scrubbed, append-only, one JSONL per day, and survives the process that wrote it. A run whose log cannot be read is refused, not treated as empty.                |
| `AI-64-R15`   | The loop is fail-closed on every seam. A missing dependency, an unreadable log, an absent verdict, an absent approval, an isolation verdict that is not `CLOSED` or is stale, a base SHA that cannot be resolved, a SHA that is not 40 hex characters — each stops the run and records the reason.                                                  |

- **Security Update**: Operator-side git commands acting on worker repositories (in `supervisor.js`, `orchestrate.js`, and `publisher.js`) are never run inside the worker repo or with its config, even for source object retrieval. Instead, the implementation creates a blank safe repo under operator control and copies allow-listed objects (with a size bound and file-type checks) from the worker tree's own `.git` directory. No configuration overrides, flags, or attempts to “bypass” or “guarantee” parsing/config immunity are used or claimed, because the code does not consult the worker's configuration file at any point in the object/copy/publish step. This also protects against alternates chains, textconv filters, hooks, and malformed configs like `include.path`. (Note: no command in the transfer or push path can run a hook, so the hook guard is structural rather than tested). Object and ref copies are file-by-file with `lstat` and a byte cap, and a junction or symlink at a copy root is not followed. A worker-writable cwd is accepted only when `.git` is a real directory: a gitfile is refused outright, because the worker can write both the gitfile and a matching `gitdir` backlink. Gitdir resolution, including a linked-worktree backlink, is used only for an operator-owned cwd. Choosing which store is read is itself a risk surface, not only the bytes copied from it. `git clone --separate-git-dir` is an unsupported operator layout: its gitfile points outside the checkout and has no worktree backlink, so publish and host-side measurement refuse it. Re-clone without `--separate-git-dir`.

### Edge cases that must be covered

- Plan valid, **no eligible candidate** -> item `blocked`, no launch, no session, no PR.
- **Unknown dependency / cycle / file double-ownership** -> plan errors, all items deferred, nothing
  launched, and the errors appear in the run's outcome log.
- Isolation verdict `PARTIAL`, `OPEN`, **missing or stale** -> `ISOLATION_BOUNDARY_MISSING`; the run
  stops. It never falls back to an unisolated worker.
- Pinned base SHA absent, ambiguous or not a commit -> stop before the worker root is created.
- Hermes writes the report with `"session_id": null` -> `HARNESS_NO_SESSION_ID`; the claim is not
  recorded; the run does not proceed to review.
- The agent exits 0 with no diff, no commit and no output -> `COMPLETED_EMPTY`; the run does not
  review; nothing is published.
- The agent runs past the stall window with no progress -> `STALLED`; the run stops; the checkpoint is
  written; a human decides.
- First candidate fails with a `gateway`-scoped classification and every remaining candidate is in
  the same gateway -> `blocked`, reason `NO_ALTERNATE_FAILURE_DOMAIN`; no same-domain retry.
- The decision log directory is unreadable -> writing assignments refuse
  (`DECISION_LOG_UNREADABLE`); the loop does not interpret unreadable as "no writers".
- Two runs of the same Work Item on the same branch -> the second is refused (`DUPLICATE_WRITER`).
- A review returns `CHANGES_REQUIRED` on a SHA that is no longer the head -> `STALE_REVIEW_SHA`;
  re-review at the new head; the stale review is discarded, not merged.
- Repair budget of zero -> immediate `BLOCKED` with the reason, not one free attempt.
- Approval exists but is expired, or exists for a different SHA, or is `PENDING` -> `PUBLISH_REFUSED`
  with the specific reason.
- The worker root is deleted mid-run -> the run is `FAILED`; no publish; the draft is not created.

## UI states

`N/A` — this Work Item changes no user-facing screen. The "UI" of a live run is its command output and
its run log; their required states are the outcomes above: per-item `completed` / `blocked` /
`deferred`, per-session `RUNNING_WITH_PROGRESS` / `STALLED` / `FAILED` / `COMPLETED_WITH_ARTIFACT` /
`COMPLETED_EMPTY` / `UNKNOWN`, and per-run `PUBLISHED_DRAFT` / `BLOCKED` / `REFUSED` / `FAILED`. Each
is a distinct terminal string, and no terminal string is printed without its reason.

## API, event and data impact

- **No product API, no schema, no migration, no tenant scope, no money.** The loop writes only to the
  existing decision log directory, the existing checkpoint file, the existing quota/evidence stores,
  the host-owned launch-results directory and GitHub (one draft Pull Request).
- **Decision log** (`decisions.js`, append-only JSONL, one file per day, credential-scrubbed): new
  stages are recorded through the existing `Stage` enum where they fit; a new live-loop stage
  (for example the review round) is added to that enum rather than written to a new log.
- **Checkpoint**: the existing `cli.js:1277-1288` shape is extended with the live-loop fields. There
  is no fourth checkpoint shape. The in-memory `resumeFrom` object is deleted.
- **Harness launch argv**: the Hermes adapter gains a required `usageFile` path; the report is read
  from disk. No other harness contract changes.
- **Approval registry**: `%LOCALAPPDATA%\ShipDe\approvals.json` gains entries written by a named
  authority, each carrying `approvalId`, `state`, `reviewedSha`, `verdict`, `reviewer`,
  `issuedAt`, `expiry`. The publisher's existing P2 rule is unchanged: `testMode` remains an
  explicit injected option used only by tests, never inferred from argv or environment.
- **Idempotency**: a live run keyed on `(workItemId, baseSha)` that already reached `PUBLISHED_DRAFT`
  does not publish a second draft; it returns the existing PR number. A repair round is keyed on
  `(workItemId, reviewedSha, round)`.
- **Compatibility**: `TASK-AI-60` tests 15-30 keep passing; `executor.js`'s `run` injection remains
  for tests, but it can no longer disable isolation; `publisher.publish` keeps its existing
  signature and gains the approved verdict enum and the draft-PR step.
- **Consumers**: `scripts/ai/control.ps1` and `reconcile.js` are not modified; the draft Pull Request
  the loop creates is a valid input to them if a human later chooses to review it normally.

## Acceptance matrix

Every row is testable, and its coverage is stated per row instead of claimed in aggregate. The
`Contract test` column cites only tests that exist today in
`tools/ai-brain/test/task-ai-64.test.js` — `64-01`..`64-13`, added at `171c83f` — and states what each
of them actually asserts. A row with no delivered test says **no test yet — Lane F must add**, names
the assertion to write and reserves the next free test id in row order; a reserved id is a promise,
not a citation, and no row counts one as coverage. Rows 5-8, 18 and 21 are additionally proven by the
live runs and by CI. A row with no artifact in this Pull Request is a failure.

| AC/Test ID | Scenario (Given / When / Then) | Expected result | Contract test (`tools/ai-brain/test/task-ai-64.test.js`) | Live-run / CI evidence |
| --- | --- | --- | --- | --- |
| `AC-AI-64-01` | **A real goal yields a valid DAG.** Given a genuine user goal text and the real work-item specs, When `planner.plan` runs, Then a DAG is returned and `errors` is empty. | A non-empty `workItems` DAG whose every id is reachable, with no `UNKNOWN_DEPENDENCY`, no `DEPENDENCY_CYCLE`, no `FILE_OWNED_TWICE`. The goal text — not a hard-coded `DRY-RUN-GOAL` — is what produced it. | **No test yet — Lane F must add** `64-14`: a `planner.plan` case over a real goal string, asserting a non-empty DAG and empty `errors`. The delivered suite never imports `planner.js`. | The `plan` output captured in the run log of Live Run 1, next to the goal text that produced it. |
| `AC-AI-64-02` | **No file-ownership conflict.** Given a two-item plan, When both items are validated, Then no two items own the same file. | `errors` contains no `FILE_OWNED_TWICE`; and a deliberately conflicting plan *does* produce one (negative case), proving the check runs in the live path and is not merely absent. | **No test yet — Lane F must add** `64-15`: the positive and negative `FILE_OWNED_TWICE` pair. The string occurs nowhere in the delivered suite. | The run log's `plan.errors` array in Live Run 1 is `[]`. |
| `AC-AI-64-03` | **Prompt carries scope, tests, acceptance and candidateKey.** Given a planned item and the Controller's chosen candidate, When `compilePrompt` runs, Then the emitted prompt contains the allowed files, the test command, every acceptance criterion and the pinned key. | One prompt string containing the `candidateKey` returned by the Controller, the item's `verification.command`, each acceptance criterion, the forbidden-region line and the publisher boundary. No model, provider or account name is present. | **No test yet — Lane F must add** `64-16`: a `compilePrompt` case asserting all four elements and asserting **absence** of any model / provider / account literal. The delivered suite never imports `prompt-compiler.js`. | The compiled prompt stored verbatim in Live Run 1's run log. |
| `AC-AI-64-04` | **The Controller picks the candidate from registry/evidence.** Given a live registry and evidence store, When the loop dispatches an item, Then the chosen key equals the Controller's decision, and that decision is written to the decision log before the launch. | The launch uses exactly the Controller's `chosen`; the decision log contains the `selected` record with the same `chosen` and the ranking inputs; the loop contains no ranking call of its own. | `64-02` — every dispatched `candidateKey` is a `selected` / `refused` decision the Controller wrote to the decision log before the launch, and every one of them is a registry candidate, so no identity is derived in the loop. | The `decisions` JSONL line for Live Run 1; `git grep` showing no `rankAndRecord` call outside `ranking.js` / `cli.js`. |
| `AC-AI-64-05` | **A real agent runs via `--isolated-worker`.** Given a `CLOSED` isolation verdict on the operator host, When the live run launches, Then the agent process runs as the isolated local user, in a worker root provisioned at the pinned base SHA, with no GitHub credential in its environment. | A launch-result JSON exists in the host-owned launch-results directory; the worker process owner is the `ShipDeWorker` SID; the worker root's `HEAD` equals the pinned base SHA exactly; the isolation launcher logs the boundary verification. | `64-03` — a live run requests the isolated launcher even when a test runner is injected, and neither `executor.js` nor `cli.js` contains a `typeof run !== 'function'` isolation exemption. The worker SID, the pinned base SHA and the absent GitHub credential: **no test yet — Lane F must add** `64-17`. | Live Run 1 `launch-result-*.json`; `GetOwner` / process-owner evidence; `git -C <workerRoot> rev-parse HEAD` output recorded in the run log; the `CLOSED` verdict file. |
| `AC-AI-64-06` | **The worker changes real code, not only a report.** Given the completed worker session, When the worker root's diff is read, Then production source files changed. | `git -C <workerRoot> diff --stat` against the pinned base SHA lists the branch-name module and its test, with real added/removed lines; a run that produced only prose is classified `COMPLETED_EMPTY` and rejected. | **No test yet — Lane F must add** `64-18`: a worker-root diff assertion over a fixture root. No unit test can provision a real worker root, so until that test exists this row is live-run evidence only. | The `git diff --stat` and the full diff captured in Live Run 1's run log; the reviewer's read of the same diff at the same SHA. |
| `AC-AI-64-07` | **Test fail-before and pass-after.** Given the exercise test file, When the verification command runs at the pinned base SHA, Then it fails; and when it runs at the worker's head SHA, Then it passes. | Exit code non-zero with a deterministic failure (missing module) at base; exit code `0` with `0 failures` at head. The same command, the same expect string, run host-side both times. | **No test yet — Lane F must add** `64-19`: a host-side runner case proving `verification.command` is executed, compared against `verification.expect`, and refused when the command is absent. The delivered suite injects `tests` and never runs a command. | The two captured command transcripts in Live Run 1's run log, each with its exit code, the command line and the expected-result comparison. |
| `AC-AI-64-08` | **The worker creates a local commit.** Given a changed worker root, When the run collects the result, Then exactly one local commit exists on the exercise branch and no push occurred. | `git -C <workerRoot> rev-parse HEAD` is a 40-character SHA whose parent is the pinned base SHA; the remote has no such branch; the publisher (not the worker) is what makes the branch visible upstream. | **No test yet — Lane F must add** `64-20`: a local-commit case (exactly one commit, parent = the pinned base SHA, no push). | `git log --format=%H %P -1` from the worker root; the remote branch absence check; the SHA equals the `reviewedSha` passed to the publisher. |
| `AC-AI-64-09` | **The supervisor distinguishes progress, stall and empty success.** Given three session shapes, When the supervisor classifies them, Then three different statuses are returned. | `COMPLETED_WITH_ARTIFACT` for exit 0 with a diff, `STALLED` for a live session past the stall window with no metric progress, `COMPLETED_EMPTY` for exit 0 with neither artifact nor text. The loop calls the supervisor and the classification gates the next stage. | `64-06` — `COMPLETED_EMPTY` is the session's terminal status, the item does not complete and no review is called. `64-07` — `STALLED`, no completion, and the checkpoint written for a human. The positive `COMPLETED_WITH_ARTIFACT` status: **no test yet — Lane F must add** `64-21`. | A source assertion that the live path calls `classifySession` (closing the audit's dead import); Live Run 2's stopped-at-checkpoint log showing `STALLED` recorded before stop. |
| `AC-AI-64-10` | **Review is bound to the exact SHA.** Given a commit at SHA `A`, When a review of SHA `B` is offered for it, Then the run is refused; and when a review with no SHA is offered, Then the run is refused. | `STALE_REVIEW_SHA` for `B`; an explicit refusal reason for a missing `sha`; the accepted review's `sha` equals the head the publisher later receives. | `64-08` — a review of another SHA is refused with a `STALE_REVIEW_SHA` cause, and a review naming no SHA is not accepted and records a blocked round with its reason. | The review record for Live Run 1, whose `sha` field equals the published head; the `TASK-AI-60` stale-SHA test still passing. |
| `AC-AI-64-11` | **The reviewer differs from the writer.** Given a writer candidate, When the review lane is scheduled, Then the reviewer candidate differs in account, or model, or gateway, or upstream. | The reviewer's `candidateKey` shares no full identity with the writer's; a reviewer equal to the writer is refused before review starts; the review record names the reviewer identity. | **No test yet — Lane F must add** `64-22`: a reviewer equal to the writer is refused, and a genuinely divergent reviewer is accepted. The delivered suite injects the reviewer and never compares identities. | The review record's reviewer field in Live Run 1; the Controller's review-lane assignment in the decision log. |
| `AC-AI-64-12` | **A finding creates a repair task.** Given a `CHANGES_REQUIRED` review with open findings, When the loop reacts, Then a new work-item spec exists whose acceptance criteria are those findings, and it was re-planned. | A repair item appears in a re-run `planner.plan`; its `acceptanceCriteria` are the open findings; it re-passes the fail-closed checks; `rounds` is carried forward rather than collapsed. A repair that re-owns the original item's file is rejected with `FILE_OWNED_TWICE`. | **No test yet — Lane F must add** `64-23`: a findings-to-spec case that re-enters `planner.plan` and is refused with `FILE_OWNED_TWICE`. The delivered suite builds no repair spec and re-runs no plan. | Live Run 3's repair item and its re-planned DAG. |
| `AC-AI-64-13` | **Finite repair budget.** Given a review that never passes, When the budget is `N`, Then the run stops after `N` repairs. | `REPAIR_BUDGET_EXHAUSTED` is recorded and the status is `BLOCKED`; the publisher is never called; exactly `N` repair rounds appear. A budget of `0` yields an immediate `BLOCKED`. | `64-10` — a review that never passes is bounded, does not complete the item, and records `REPAIR_BUDGET_EXHAUSTED` in the decision log. The publisher-never-called and budget-`0` clauses: **no test yet — Lane F must add** `64-24`. | Live Run 3's round count and terminal status. |
| `AC-AI-64-14` | **Resume uses the checkpoint.** Given a run stopped after a checkpoint was written, When it is restarted, Then it reads the checkpoint file from disk. | The restarted run reads the existing file through the existing reader; the in-memory `resumeFrom` object is gone; a missing checkpoint file is a clean first run, not an error. | `64-05` — the run reads the checkpoint file from disk, writes it back through the atomic writer (its mtime advances and the completed item is still listed) and no longer carries `resumeFrom`. The missing-file-is-a-clean-first-run clause: **no test yet — Lane F must add** `64-25`. | The checkpoint file captured in Live Run 2. |
| `AC-AI-64-15` | **Completed steps never re-run.** Given a checkpoint listing a completed item, When the run resumes, Then that item is not launched again. | The resumed run's launch list excludes every completed item; the same `workItemId` is never launched twice in one run or across a resume; a completed item's commit SHA is unchanged. | `64-05` — a resumed run launches only the incomplete item and never the completed one. The one-launch-per-item uniqueness across a resume and the unchanged-SHA clauses: **no test yet — Lane F must add** `64-26`. | Live Run 2's before/after launch lists and the resulting commit count. |
| `AC-AI-64-16` | **A gateway/upstream failure picks another failure domain.** Given a first candidate that fails with a classified scope, When the Controller selects the replacement, Then the replacement is outside that scope's domain. | The replacement's failure domain differs per the Controller's `sameFailureDomain`; the loop's own simpler "different gateway or upstream" test is deleted; when no candidate is outside the domain, the run is `blocked` with `NO_ALTERNATE_FAILURE_DOMAIN` and no retry. | `64-13` — the fixture failure classifies as `gateway` through the real `classifyFailure`, the replacement is dispatched with a different gateway, and the control run completes once the replacement succeeds. The `NO_ALTERNATE_FAILURE_DOMAIN` refusal when no candidate is outside the domain: **no test yet — Lane F must add** `64-27`. | Live Run 2's fallback record: the first choice, the replacement, the classified scope, the `fallbackReason`. |
| `AC-AI-64-17` | **Publisher accepts only a reviewed SHA plus a valid approval.** Given a publish call, When any gate is missing, Then it is refused with a specific reason. | `PUBLISH_REFUSED` for: missing/short SHA, SHA ≠ current head, missing or expired approval, approval not `APPROVED`, approval bound to a different SHA, verdict outside the accepted enum. Each refusal names the specific gate. | `64-12` — a `reviewedSha` that is not a 40-character commit, an approval that is registered and `APPROVED` but bound to another SHA, and a SHA that is not the current head are each refused, and the second refusal is about the SHA binding rather than registration. The missing / expired / not-`APPROVED` approval and the out-of-enum verdict clauses: **no test yet — Lane F must add** `64-28`. | `tools/ai-brain/test/isolation.test.js` still green; the refusal strings asserted verbatim. |
| `AC-AI-64-18` | **A draft PR exists.** Given a passing review and a valid approval, When the publisher runs, Then one draft Pull Request exists. | `gh pr view <n> --json isDraft,headRefOid,title` returns `isDraft: true`, `headRefOid` equal to the reviewed 40-character SHA, and a title beginning `[<WORK_ITEM_ID>]`. Exactly one PR exists for the run; a second run for the same key creates none. | **No test yet — Lane F must add** `64-29`: publish idempotency on `(workItemId, baseSha)` under `testMode`. The draft-PR shape itself needs a real GitHub write, so it is live-run evidence. | Live Run 1's `gh pr view` JSON captured in the run log; the PR URL and number. |
| `AC-AI-64-19` | **The worker cannot publish.** Given the isolated worker, When any publish action is attempted from inside it, Then it fails. | `git push` fails, `gh` is not authenticated inside the worker, the worker cannot read the operator profile or the GitHub credential, the host-owned launch-result file is not writable from the worker root, and no publish call is reachable from the worker process. | `64-11` — no worker-reachable module (`harness.js`, `executor.js`, `isolation-launcher.js`) requires the publisher, and `publish` called with the worker root as `cwd` throws a `PUBLISH_REFUSED` that names the worker boundary. | `Test-WorkerIsolation.ps1` output (`Final Verdict: CLOSED`); the refusal log from an in-worker publish attempt recorded in Live Run 1. |
| `AC-AI-64-20` | **Decision/outcome log is traceable.** Given a completed live run, When the decision log and the run log are read, Then every selection, launch, session id, branch, classification, review round, verdict and outcome is present and joins to one Work Item. | The daily JSONL contains the run's `selected` / `launched` / review / `completed` (or the terminal `failed` / `refused`) records for that `workItemId`; the run log references the same ids; no credential appears in any line. | `64-09` — the review-rejection reason and the open finding id both survive in the run record and the decision log. The whole-file shape, the per-`workItemId` join and the credential scrub: **no test yet — Lane F must add** `64-30`. | The decision JSONL for Live Run 1 (whole file, scrubbed) plus the run log; a `pnpm security:secrets` pass over both. |
| `AC-AI-64-21` | **Full tests, format, CI and secret scan pass.** Given this Pull Request on a clean checkout, When the repository verification commands run, Then every one exits `0`. | `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm test:brain`, `pnpm security:secrets`, `pnpm build` all exit `0`; CI is green on `contract`, `application-gate`, `AI Brain test suite` and `Security baseline`. | **No test yet — Lane F must add** `64-31`: an assertion that `pnpm test:brain`'s `tools/ai-brain/test/*.test.js` glob discovers and passes this whole suite. The row is otherwise proven by the repository commands themselves. | The exact command list and outputs in the Pull Request body; the four GitHub Actions check runs at the reviewed head. |
| `AC-AI-64-22` | **A simulated or absent launch is never counted as a live run.** Given a loop handed no launcher at all, and then a loop handed a hard-coded callback that returns exit `0` and a `sessionId` in stdout but writes no durable report, When the run reconciles, Then neither shape is recorded as a launch or as a completion. | The work item is absent from `reconciliation.completed` in both cases, and the decision log contains no `launched` record for either run. The no-op default launcher and every injected fallback that returns success are deleted (`AI-64-P08`): absence of evidence is never evidence of a launch, a session or a success. | `64-01` — the absent-launcher shape, the simulated-callback shape, and the empty set of `launched` records in each decision log. | None required — the row is deterministic. The Pull Request body records that the no-op default launcher is gone from `orchestrate.js`. |
| `AC-AI-64-23` | **The session handle is durable and real.** Given a live launch, When the loop records the session, Then the handle it stores is the `session_id` from the `--usage-file` report the loop itself supplied, and no handle is derived. | The launch job carries a `usage*` path ending in `.json`; every `sessionId` in the decision log equals that report's `session_id`; no `sessionId: process.pid` survives in `cli.js`, `executor.js` or `orchestrate.js`; a report whose `session_id` is `null` stays `HARNESS_NO_SESSION_ID` and the run does not reach review (`AI-64-R04`). | `64-04` — the handle reaching the decision log, its equality with the report's `session_id`, and the absence of any `sessionId: process.pid` in the three launch paths. | Live Run 1's decisions JSONL line whose `session_id` equals the `--usage-file` report on disk. |
| `AC-AI-64-24` | **A PASS carrying open findings is rejected, and the contradiction is recorded.** Given a reviewer that returns `pass: true`, `verdict: 'PASS'` and one open finding, When the loop consumes the verdict, Then the run does not complete and the refusal is legible downstream. | The work item is not completed; the run trace and the decision log both carry `PASS_WITH_FINDINGS_REJECTED` and the finding id (`F-1`), so repair, the decision log and a human can see what was refused instead of a bare `BLOCKED` (`AI-64-R07`, `AI-64-R14`, `AI-64-P08`). | `64-09` — no completion, `PASS_WITH_FINDINGS_REJECTED` present in the trace, and `F-1` surviving in the run record or the decision log. | Live Run 3's review record and the repair item built from its findings. |

### Test-to-row index

Every test in the delivered suite is claimed by at least one acceptance row, and this index is the
traceability check for that claim. A test Lane F adds is entered here in the same commit that adds it.

| Contract test | What it actually asserts | Acceptance row(s) |
| --- | --- | --- |
| `64-01` | A simulated or absent launch is never a live run and leaves no `launched` record | `AC-AI-64-22` |
| `64-02` | Every dispatched `candidateKey` is a Controller decision written before the launch, and is a registry candidate | `AC-AI-64-04` |
| `64-03` | The isolated launcher is requested for a live run, and an injected runner cannot disable it | `AC-AI-64-05` |
| `64-04` | The durable `session_id` is read from the `--usage-file` report and recorded, never guessed | `AC-AI-64-23` |
| `64-05` | The checkpoint is read from disk and written back, and the completed item is not re-launched | `AC-AI-64-14`, `AC-AI-64-15` |
| `64-06` | `COMPLETED_EMPTY` is a terminal status, does not complete the item and does not review | `AC-AI-64-09` |
| `64-07` | `STALLED` stops the run and leaves a checkpoint for a human | `AC-AI-64-09` |
| `64-08` | A review is bound to the exact SHA it read; a review naming no SHA is refused | `AC-AI-64-10` |
| `64-09` | A `PASS` carrying open findings is rejected and the reason and finding survive in the trace | `AC-AI-64-24`, `AC-AI-64-20` |
| `64-10` | The repair budget is finite, the run does not complete and exhaustion is recorded | `AC-AI-64-13` |
| `64-11` | No worker-reachable module requires the publisher, and the worker root is refused | `AC-AI-64-19` |
| `64-12` | The publisher refuses a SHA that is malformed, unapproved or not the head | `AC-AI-64-17` |
| `64-13` | A gateway-scoped failure selects a candidate outside that failure domain | `AC-AI-64-16` |

`AC-AI-64-22`, `-23` and `-24` exist because the review found `64-01`, `64-04` and `64-09` asserting
behaviour that no row covered. `AC-AI-64-01`..`21` keep the ids the delivered test file already cites,
so no test id moved when the matrix was realigned.

## First live coding exercise

The first live run must be small, deterministic, and completely unrelated to authentication,
authorization, money, tenant isolation, carrier effects, credentials and real data. It exists to
prove the **loop**, not to deliver product value.

**Exercise `E1` — `normalizeWorkItemBranch(workItemId, kind, outcome)`**

A new pure module `tools/ai-brain/branch-name.js` exporting a single function. No I/O, no network, no
filesystem, no clock, no randomness, no global state, no dependency outside Node built-ins.

Normative contract:

| Rule        | Behavior                                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `E1-R01`    | `workItemId` must match `^(FEAT\|TASK-FOUND\|TASK-AI)-[A-Z0-9-]+$`; otherwise throw `WORK_ITEM_ID_INVALID`.                     |
| `E1-R02`    | The result uses the lower-cased id: `feat/` or `fix/`, then the id, then `-`, then the slug.                                    |
| `E1-R03`    | `kind` is exactly `feat` or `fix`; anything else throws `BRANCH_KIND_INVALID`. `feat` is the default.                            |
| `E1-R04`    | `outcome` is slugified: lower-cased; every run of characters outside `[a-z0-9]` becomes a single `-`; leading and trailing `-` are trimmed; inner `-` runs are collapsed. An outcome that yields an empty slug throws `OUTCOME_SLUG_EMPTY`. |
| `E1-R05`    | The result length must not exceed 60 characters; a longer result throws `BRANCH_TOO_LONG`. It is never silently truncated.          |
| `E1-R06`    | The result contains exactly one `/`, immediately after the kind. It never contains `\`, `..`, a trailing `.`, `.lock`, or a shell metacharacter. |
| `E1-R07`    | The function is pure: the same inputs always produce the same output; it performs no I/O and mutates nothing.                      |

**Seeding, and why fail-before is honest.** The exercise's expected inputs and outputs are committed as
**data only**, at `tools/ai-brain/exercise/e1-branch-name.cases.json`: an array of
`{ name, kind, workItemId, outcome, expect }` objects, where `expect` is either the exact expected
string or the exact expected thrown error code. A JSON data file breaks nothing in CI and asserts
nothing by itself. The loop materialises the runner file `tools/ai-brain/test/e1-branch-name.test.js`
**inside the worker root only**, from that data, before the agent is launched, and that runner is
**never committed to this repository**: it is deliberately absent from the Work Item's allowed paths,
it is not part of `pnpm test:brain` on `main`, and it must stay untracked in the worker root so it can
never enter the reviewed commit. A repository — or a published draft Pull Request — that contains
`tools/ai-brain/test/e1-branch-name.test.js` fails this Work Item, because `pnpm test:brain` is
`node --test "tools/ai-brain/test/*.test.js"` (`package.json:26`) and that glob would then pick the
exercise up on the integration branch. The committed artifact of the exercise is the data file.

That gives an unfakeable pair:

- **fail-before** — at the pinned base SHA, with the materialised test present and
  `tools/ai-brain/branch-name.js` absent: `node --test tools/ai-brain/test/e1-branch-name.test.js`
  exits non-zero with a missing-module error. This is a real, captured run, not an assertion about
  one.
- **pass-after** — after the agent implements the module, the same command at the worker's head SHA
  exits `0` with `0 failures`.

The exercise's `verification.command` is
`node --test tools/ai-brain/test/e1-branch-name.test.js` and its `verification.expect` is
`0 failures`. The committed data file is a normal committed artifact and must be valid JSON
(`validate_docs.py` parses it) and secret-free.

**Explicitly excluded from `E1`:** anything touching auth, tokens, tenant scoping, money arithmetic,
carrier commands, real data, real customer data, migrations, the isolation scripts, the publisher, the
approval registry and the loop's own dispatch code. The exercise must not be able to damage the loop
that is demonstrating it.

## Live runs

Three live runs are required. Each one is recorded as a run log (the decisions JSONL, the loop's run
record, the captured command transcripts, the verification-command outputs and the `gh pr view` JSON)
and pasted into this Work Item's Pull Request as evidence. A run that is claimed but not recorded is
`CHANGES_REQUIRED`.

### Live Run 1 — happy path

Goal: the `E1` exercise, stated as a real user goal ("add a pure branch-name helper so the loop can
derive the branch for a Work Item without hand-typing it").

1. The goal is planned into a validated DAG; the plan is logged.
2. The Controller selects one candidate from the live registry and evidence; the decision is written
   before the launch.
3. The launch is pinned: provider, model, account and gateway come from the chosen candidate and are
   never altered.
4. The agent runs under `--isolated-worker` in a worker root at the pinned base SHA, with no GitHub
   credential, and receives the compiled prompt (scope, tests, acceptance, pinned key, publisher
   boundary).
5. The agent edits real code and creates one local commit.
6. Host-side, the verification command is run at base (**fails**) and at head (**passes**).
7. The supervisor classifies the session from real signals.
8. The Controller schedules an independent reviewer in a different failure domain; the review is bound
   to the exact head SHA and returns `PASS` with no open findings.
9. A human records the approval (the named authority from the author boundary) and the publisher, on
   the host, creates the **draft** Pull Request and stops.
10. The draft Pull Request is left open and unmerged. That is the end of the run.

### Live Run 2 — recovery

Two acceptable shapes; the run records which one was performed, and the acceptance row cites the
recorded one.

- **2A — controlled gateway/upstream failure.** The Controller's first choice is a candidate whose
  gateway or upstream is deliberately unreachable for the run (a route the operator names in
  advance; no product code is touched to induce it). The failure is classified by the existing
  failure classifier, the Controller selects a candidate outside that failure domain, the run
  continues and still produces a draft Pull Request. The decision log shows `firstChoice`,
  the replacement, the classified scope and the `fallbackReason`.
- **2B — stop after checkpoint.** The operator stops the run once the checkpoint is written, then
  restarts it. The restart reads the checkpoint from disk, does not re-launch any completed step, and
  finishes the same item. The decision log shows one launch per item across both processes.

**2C (recommended, both at once, since recovery is the point):** 2A followed by 2B. The run proves
scoped fallback *and* resumability in one record.

### Live Run 3 — bounded repair

The reviewer returns `CHANGES_REQUIRED` with at least one open, specific finding against the exact
head SHA — a finding that is genuinely actionable (for example a missing negative case for
`E1-R05`, or a result that silently truncates instead of throwing `BRANCH_TOO_LONG`).

1. The finding becomes a repair work-item spec whose acceptance criteria are the findings.
2. The spec goes back through `planner.plan` and re-passes the fail-closed checks.
3. A fresh repair worker runs under the same isolation, on a new commit.
4. Tests run again host-side; the reviewer re-reviews at the **new** exact SHA. The stale review of
   the old SHA is discarded, never reused.
5. Either the review passes and the run publishes a draft Pull Request at the new SHA, or the repair
   budget is exhausted and the run ends `BLOCKED` with `REPAIR_BUDGET_EXHAUSTED` and publishes
   nothing. Both endings are acceptable evidence; an unbounded loop is not.

## Implementation plan

The technical input is the read-only gap audit
`C:/Users/gumac/AI/shipde-platform/.worktrees/logs/night/task-ai-64-live-gap-audit.md`, read at
`origin/main`. Its verdicts — `REUSE` (works, wire it in), `WIRE` (exists but is a stub or an
unconnected seam), `MISSING` (no implementation), `REJECT` (must not be used as-is) — are cited per
step. No step creates a new module where an audited seam already exists.

### Step 1 — make `orchestrate` call the Controller, not ranking

**Audit: §2 WIRE + REJECT.** `orchestrate.js:86-92` calls `ranking.rankAndRecord` directly with
`dryRun: true`, so `ranking.js:658` (`if (!ctx.dryRun && chosen)`) never writes the decision, no
writer claim is taken, the implementation ceiling, reservations and `eligibleAccounts` are all
skipped, `ranking.js:413-423` falls back to the default quota store, and the executor's
session-id path and `--isolated-worker` never run. `orchestrate.js:19` also imports
`classifySession` and never calls it.

**Change:** dispatch through `cli.js:905` `dispatchCommand` / `executor.js:142` `executePlan` so the
existing writer-claim, ceiling, reservation and ranking logic is the one that runs. Keep
`planner.js` for DAG validation only, fed from the real specs, not from a hard-coded `DRY-RUN-GOAL`
(`cli.js:1968-1977`). Delete the loop's own fallback scan at `orchestrate.js:121-140` (audit §11: a
second fallback engine that ignores the failure classifier's scope) and use the Controller's
`sameFailureDomain` (`cli.js:740-768`) with `failure-classifier.js`. **Serve `AC-AI-64-04`,
`AC-AI-64-16`, `AC-AI-64-22`.**

### Step 2 — thread `--isolated-worker` through, and pin the base SHA

**Audit: §3 WIRE (two seams), one gating hazard, one defect.** `cli.js:947` and `cli.js:1537-1539`
and `executor.js:148-150` all disable isolation whenever a `run` is injected — so any dependency
injection silently drops the worker boundary with no log line. `orchestrate.js:40-44` has no
`isolatedWorker` option at all. `isolation-launcher.js:208-214` provisions the worker at
`git rev-parse HEAD` of the operator worktree, while its own comment at `:204` claims "clean clone
at the reviewed SHA".

**Change:** add `isolatedWorker` to the loop's options and forward it; delete the `typeof run !==
'function'` exemptions (`executor.js:148`, `cli.js:1537` — `executor.js:142` is the only writer);
replace `isolation-launcher.js:208-214` with the caller's pinned base SHA, matching the comment.
**REUSE** the launcher's existing verdicts unchanged: freshness/`CLOSED` gate (`:145-158`), full-path
worktree binding (`:166-171`), `policyHash` over `scripts/ai/isolation` (`:175-178`), per-check
`/^PASS/` gate (`:187-194`), live boundary re-verification (`:196-202`), host-owned launch-results
(`:242-252`). **Serve `AC-AI-64-05`, `AC-AI-64-19`.**

### Step 3 — produce and store a real durable session handle

**Audit: §4 MISSING in production, REJECT `sessionId: process.pid`.** Nobody supplies `usageFile`
(`harness.js:139` supports it; the live launch at `cli.js:1554-1575` does not pass it). The executor
parses the wrong channel (`executor.js:390-401`): under `-z` stdout is prose, so `parseLastJson`
returns `null` and a live Hermes launch fails closed as `HARNESS_INVALID_JSON` before
`sessionIdFrom` is ever consulted. And `cli.js:1589` / `cli.js:1660` record `sessionId: process.pid`,
which `decisions.js:216-226` will later treat as the session to resume.

**Change:** pass `usageFile` at the live launch and read `session_id` from that report; delete both
`process.pid` records; keep the correct path already present at `executor.js:395-416` so the id lands
in the daily JSONL via `decisions.js:81-90`. Scrubbing stays enforced (`decisions.js:43,52-65`).
This also closes the "remaining integration gap" recorded in `TASK-AI-63`. **Serve `AC-AI-64-04`,
`AC-AI-64-20`, `AC-AI-64-23`.**

### Step 4 — persist the checkpoint through the existing atomic writer

**Audit: §5 WIRE.** The store exists and is atomic (`cli.js:682-686` `readCheckpoint`, `cli.js:688-695`
`writeJsonFile`, tmp-file + `renameSync`) but the loop never persists to it: `orchestrate.js:175-181`
builds a `{completed, blocked, deferred, at}` object, calls it "reuses the existing decisions-store
convention, no new store", and drops it. The resume input is a literal object, not a file
(`orchestrate.js:66-69`, proven only by an inline test).

**Change:** write the checkpoint with the existing atomic writer and read it back with the existing
reader, **extending** the shape at `cli.js:1277-1288`; delete the in-memory `resumeFrom`. Reuse the
`dryRunDispatch.executeTouched` double-execution guard (`cli.js:1359-1362`, set at `cli.js:1691-1699`).
**Do not add a fourth checkpoint shape** — `discovery.js:152,195-198` already owns a
`checkpoint-<stamp>.json` for a different purpose. **Serve `AC-AI-64-14`, `AC-AI-64-15`.**

### Step 5 — call the supervisor, and give it a real signal

**Audit: §6 MISSING (no producer), WIRE (call it).** `supervisor.js:15-61` is sound and
`harness.js:190-232` implements `progressVerdict` over seven markers, but nothing computes
`diffBytes` / `commits` / `tests` / `logBytes` / `toolCalls` / `toolActivity` from a live session, and
the Hermes adapter (`harness.js:122-169`) defines no `inspect`, so `executor.js:289` skips the liveness
probe silently. `executor.js:322` calls `adapter.resume(sessionId, prompt)` without the third `job`
argument, so `harness.js:145` throws `HERMES_REQUIRES_PINNED_CANDIDATE` on every resume.

**Change:** call `classifySession` where `orchestrate.js:19` currently only imports it, and gate the
next stage on it; add a progress producer for the live session; add `inspect` to the Hermes adapter
so `harness.js:166-168` `progressFromInspect` has a source; pass the third `job` argument at
`executor.js:322`. **REUSE** `supervisor.js:15-22` statuses, `:24-28` `hasArtifact`, `:37-46` the
`COMPLETED_EMPTY` rule, and `harness.js:196-204` markers, `:205` `hasMetricProgress`, `:223-230`
`RUNNING_WITHOUT_PROGRESS`, `:192` the 15-minute default stall window. **Serve `AC-AI-64-09`.**

### Step 6 — replace the three loop defaults with real work

**Audit: §7 MISSING (no deterministic test runner) + §8 WIRE (SHA binding, missing the reviewer).**
`review-loop.js:35-37` defaults `runTests` to `{pass:true}`, `review` to `{pass:true, findings:[]}`
and `repair` to `(findings, sha) => ({sha})` — a live caller that forgets a dependency gets a green
loop, and `test/task-ai-60.test.js:50` / `cli.js:1987` encode the same shape. `planner.js:113`
carries `verification.command` / `expect` and `prompt-compiler.js:34` prints it into the prompt, but
**no production code in `tools/ai-brain` spawns a test command or a `git commit`**. `review-loop.js:61`
is guarded by `rev.sha &&`, so a review that omits its SHA passes for any SHA.

**Change:** `review-loop.js:35-37` throws when `runTests` / `review` / `repair` is absent. Bind
`runTests` to `planner.js:113` `verification.command` / `expect` executed **host-side** — the
`package.json:11-45` commands, `test:brain` at `package.json:26` — because the worker is untrusted and
cannot be believed to report its own test result (`publisher.js:1-19`, `isolation-launcher.js:242-252`).
Bind `review` to an exact-SHA reviewer **REUSE**-ing the discipline already implemented at
`control.ps1:1851-1854` (40-64 hex `headRefOid`), `:1868-1871` (fetched head equals the CI-approved
head), `:1875-1880` (detach and re-verify `rev-parse HEAD`), `:1890`/`:1900` (verdict/findings schema
and enum), and `reconcile.js:454-457` (`SHA_40`). Make `rev.sha` mandatory. Schedule the reviewer as
a role (`scheduler.js:118` `REVIEW_ROLES`, ceiling at `:108,379-384`), never as a literal in the loop;
note `discovery/adapters.js:46-49`, where the operator has banned the `codex` CLI for
plan/review-only model enumeration, so the reviewer lane is a scheduled role, not an enumeration.
**Serve `AC-AI-64-06`, `AC-AI-64-07`, `AC-AI-64-10`, `AC-AI-64-11`.**

### Step 7 — route repair back through the planner

**Audit: §9 MISSING.** `review-loop.js:75-86` repairs by re-running on the *same* state object: the
repair result is only a SHA, there is no findings-to-spec translation, no new DAG node and no second
`planner.plan` call (the plan is built once, at `orchestrate.js:52`). `orchestrate.js:151-152` stores
`review.rounds` on the log and never feeds it forward. Bounding is already correct (`:34` default 3,
`:49-52`, `:80-83` `REPAIR_BUDGET_EXHAUSTED`), and that bounding is **REUSE**d.

**Change:** turn open findings into a new work-item spec and re-enter `planner.plan`, keeping the
fail-closed checks at `planner.js:84-101` (`UNKNOWN_DEPENDENCY`, `DEPENDENCY_CYCLE`,
`FILE_OWNED_TWICE`) — a repair that re-owns the original item's file is refused there, not
downstream. Carry `rounds` forward. **Serve `AC-AI-64-12`, `AC-AI-64-13`.**

### Step 8 — call the publisher, specify the approval producer, create the draft Pull Request

**Audit: §10 MISSING (approval producer, PR creation) + WIRE (binding, verdict enum).** The gate at
`publisher.js:125-219` is complete and **REUSE**d unchanged: `:130-141` refusals in order,
`:146-155` the approval registry, `:161-167` https-only `remoteUrl` from trusted controller input
only, `:169-178` the SHA binding against `git rev-parse HEAD`, `:91-117` the sanitized local mirror
(`:79` `SAFE_MIRROR_CONFIG`, `:81-89` `buildSanitizedMirror`), `:206-210` the push. The gaps: nothing
in `cli.js` or `control.ps1` calls `publish` (**MISSING**); `approvals.json` (`:147`) has no producer
anywhere in the repository (**MISSING**); the approval is not bound to the SHA, the reviewer or an
issuer (`:125` accepts a flat options bag) (**MISSING**); `:139` accepts only the literal `PASS` while
the repository's own terminal verdict for this slice is `FALLBACK_PASS`
(`reconcile.js:474-551`, register rows `189`..`192`) (**WIRE**: accept the real enum, on the terms
`reconcile.js:482-492` already states — named reviewer, exact 40-character reviewed commit); and no
`gh pr create` exists anywhere in `tools/ai-brain` (**MISSING**).

**Change:** call `publish` with `reviewedSha` = the review loop's `finalSha` (`:72`) and `verdict`
= the loop's terminal status; implement and document the approval producer (a named authority, an
approval bound to `reviewedSha` + `reviewer` + `expiry`, written operator-side only — this is the
human decision listed in the author boundary); add the draft-PR step, whose title satisfies
`reconcile.js:450-451` (`[ID]` prefix) and whose head satisfies `control.ps1:1492`; make the step
idempotent on `(workItemId, baseSha)`; and never mark the Pull Request ready and never merge.
`publish` must run operator-side on the host tree, never inside `workerRoot` (audit §10 isolation
note, `isolation-launcher.js:242-252`, `test/isolation.test.js:242-247`). **Serve `AC-AI-64-17`,
`AC-AI-64-18`, `AC-AI-64-19`.**

### Step 9 — prove there is exactly one of everything

**Audit: §11 REJECT the `planner.js` + `orchestrate.js` queue and fallback as production authority.**
A second scheduler already stands beside `scheduler.js:197` `planDispatch`; a second ranking path sits
beside `fitness.js` `rankByFitness`; a second fallback engine sits beside `cli.js:740-786`
`applyDryRunBlocks` + `failure-classifier.js`; three checkpoint shapes coexist
(`orchestrate.js:176-181`, `cli.js:1277-1288`, `orchestrate.js:66-69`). `test/task-ai-60.test.js`
test 30 is a string-presence assertion — it proves the imports exist, not that one store exists.

**Change:** the loop runs no queue, no ceiling, no ranking, no fallback and no store of its own; it
calls `scheduler.planDispatch` through the Controller and reads the existing stores. Extend test 30
into a structural assertion that names each single owner (`planDispatch` in `scheduler.js`;
`rankAndRecord` in `ranking.js`; the decision log in `decisions.js`; the checkpoint in `cli.js`) and
fails if a second definition of any of them appears under `tools/ai-brain/`. Also close the
`openWritersDetailed` omission the audit names: the orchestrate path never calls it
(`decisions.js:207`), so the one-writer-per-branch rule R04 and the unreadable-log refusal never run
there (`decisions.js:100-102`, `:201-206` — treating unreadable as "no writers" is how a second
agent lands on a busy branch). **Serve `AI-64-P05`, `AC-AI-64-20`, `AC-AI-64-24`.**

## Verification commands

All run from a clean checkout of the branch, with the operator host in the state `TASK-AI-61`'s
runbook requires.

Repository gates:

- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test:brain`
- `pnpm test`
- `pnpm security:secrets`
- `pnpm build`

Specification gate:

- `python docs/product-spec/scripts/validate_docs.py`

Isolation and live-loop gates (operator host, elevated where the runbook says so):

- `.\scripts\ai\isolation\Test-WorkerIsolation.ps1` — must print `Final Verdict: CLOSED`
- `node tools/ai-brain/cli.js orchestrate --goal <file> --out <log> --isolated-worker --execute` —
  Live Run 1
- the same command for Live Run 2 (with the operator-declared unreachable route, then a stop and
  restart) and Live Run 3
- `gh pr view <n> --json isDraft,headRefOid,title` — the draft Pull Request evidence

Non-executable (Windows host; documented commands, verified by CI on `ubuntu-latest`):
`pnpm install --prod --frozen-lockfile`, `pnpm test:e2e`, `pnpm test:baseline`.

## Pull Request evidence required

- Exactly one Work Item ID and Feature ID (`TASK-AI-64`, `N/A`), assigned author `GEMINI`, reviewed
  commit.
- The 24 acceptance rows, each with its artifact, pasted in full, together with the test-to-row index.
  A row with no artifact is a failure.
- The three live run records: decisions JSONL, run log, fail-before/pass-after transcripts, the
  `git diff --stat`, the commit SHA, the review record, and the `gh pr view` JSON.
- The isolation verdict, verbatim.
- Files, migrations, API routes, jobs and screens changed: `None` for migrations, API routes and
  screens; the file list from the allowed-paths row; the new jobs are the three live runs.
- The exact commands run and their exact results.
- Security, tenancy, idempotency and regression notes: worker has no GitHub credential; publisher is
  host-side only; approval is bound to SHA + reviewer + expiry; a repeat run for the same
  `(workItemId, baseSha)` creates no second draft; `TASK-AI-60` tests 15-30 and the `executor` /
  `isolation` suites unchanged and green.
- External API evidence level and fallback behaviour: the model gateway is a real external API; the
  evidence level is `HARNESS_PASS` at minimum for the writer and the reviewer, and the fallback is the
  Controller's scope-aware domain change, recorded with its classification. `API_PASS` is never
  promoted.
- Known limitations: `None` is not an acceptable answer; § Residual limitations must be completed
  honestly.

## Codex review record

| Review round | Commit    | Verdict        | Findings resolved |
| ------------ | --------- | -------------- | ----------------- |
| 1            | `Pending` | `NOT_REVIEWED` | Draft Work Item; not yet authored. |

## Residual limitations

- The live runs are operator-initiated and operator-witnessed. An unattended run is not produced by
  this Work Item.
- The approval authority is a human decision left open in the author boundary; until the human accepts
  a design, `publish` refuses and the loop ends `BLOCKED` — which is the correct fail-closed behaviour
  and the correct reason it cannot currently complete end to end.
- The publisher still accepts `FALLBACK_PASS` only on `reconcile.js:482-492` terms (named reviewer,
  exact 40-character reviewed commit). TASK-AI-64 does not strengthen or relax that.
- Progress measurement remains marker-based (`harness.js:196-204`); a session that produces work
  without any of the seven markers reads as `STALLED`. This is conservative in the safe direction and
  is recorded rather than hidden.
- The reviewer's exact-SHA discipline is re-used from `control.ps1`; a live review before a Pull
  Request exists runs through a host-side route, and the human accepts that route in the author
  boundary.
- The `E1` exercise is a toolchain change, not product value. It proves the loop. It is never a
  substitute for a product Work Item.
- The live-proof draft Pull Request stays open and unmerged. If a human later merges it, that merge
  happens entirely outside this Work Item's evidence and this Work Item makes no claim about it.

## Fix Notes

- Fixed a defect during live run: `TypeError: cli.readCheckpoint is not a function`. The `tools/ai-brain/cli.js` entry script was invoking `main()` before assigning `module.exports`, causing a partial exports object when `orchestrate.js` lazily required it back. Fixed by reordering the export assignment before the `require.main` check and added regression test `64-23` (AC-AI-64-14).
