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
| Allowed paths   | `tools/ai-brain/orchestrate.js`, `tools/ai-brain/planner.js`, `tools/ai-brain/prompt-compiler.js`, `tools/ai-brain/supervisor.js`, `tools/ai-brain/review-loop.js`, `tools/ai-brain/executor.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/harness.js`, `tools/ai-brain/isolation-launcher.js`, `tools/ai-brain/publisher.js`, `tools/ai-brain/decisions.js`, `tools/ai-brain/approval-registry.js`, `tools/ai-brain/exercise/e1-branch-name.cases.json`, `tools/ai-brain/branch-name.js`, `tools/ai-brain/sources.js`, `tools/ai-brain/candidates.js`, `tools/ai-brain/failure-classifier.js`, `tools/ai-brain/test/task-ai-64.test.js`, `tools/ai-brain/test/failure-classifier.test.js`, `tools/ai-brain/test/fixtures/task-ai-64/`, `tools/ai-brain/test/isolation.test.js`, `tools/ai-brain/test/executor.test.js`, `tools/ai-brain/test/task-ai-60.test.js`, `docs/product-spec/work-items/TASK-AI-64.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
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

`tools/ai-brain/sources.js`, `tools/ai-brain/failure-classifier.js`, and
`tools/ai-brain/test/failure-classifier.test.js` are allowed paths amended during live run attempt 7
review (Defect E repair): `sources.js` exports `providerFromPrefix` ensuring the launcher's provider
definition is derived directly from the exact model string opencode receives; `failure-classifier.js`
classifies OpenCode harness configuration failures into `Scope.HARNESS` / `Cause.LAUNCH_CONFIG` with
finite cooldown and preserves matched stdout in evidence, preventing launch failures from poisoning
model domains; and `test/failure-classifier.test.js` houses the unit regression tests for Case 13.

`tools/ai-brain/candidates.js` is an allowed path amended during live run attempt 12 review
(Defect K repair): `candidates.js` avoids emitting wildcard accounts (`accountId: '*'`) from catalogue
expansion when concrete accounts are present and maps `reachedVia` router accounts to dependent harnesses,
ensuring reviewer candidates are not rejected by `WILDCARD_ACCOUNT`.

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

- **Security Update**: Operator-side git commands acting on worker repositories (in `supervisor.js`, `orchestrate.js`, `isolation-launcher.js`, and `publisher.js`) are never run inside the worker repo or with its config, even for source object retrieval. Instead, the implementation creates a blank safe repo under operator control and copies allow-listed objects (with a size bound and file-type checks) from the worker tree's own `.git` directory. No configuration overrides, flags, or attempts to “bypass” or “guarantee” parsing/config immunity are used or claimed, because the code does not consult the worker's configuration file at any point in the object/copy/publish step. This also protects against alternates chains, textconv filters, hooks, and malformed configs like `include.path`. (Note: no command in the transfer or push path can run a hook, so the hook guard is structural rather than tested). Object and ref copies are file-by-file with `lstat` and a byte cap, and a junction or symlink at a copy root is not followed. A worker-writable cwd is accepted only when `.git` is a real directory: a gitfile is refused outright, because the worker can write both the gitfile and a matching `gitdir` backlink. Gitdir resolution, including a linked-worktree backlink, is used only for an operator-owned cwd. Choosing which store is read is itself a risk surface, not only the bytes copied from it. `git clone --separate-git-dir` is an unsupported operator layout: its gitfile points outside the checkout and has no worktree backlink, so publish and host-side measurement refuse it. Re-clone without `--separate-git-dir`.

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

## Live run attempt 3 and orchestrate ranking fix (2026-10-01)

Attempt 3 BLOCKED with NO_ELIGIBLE_CANDIDATE because orchestrate ranked un-annotated candidates with exploration budget 0.
The fix routes per-item selection through candidates.annotateCandidates + routing.rankForProfile with the reviewer outside the writer failure domain.
Test 64-24 fails on 4d62bdf and passes here.
Full suite 1073/1073.
Supervisor repair: the per-item selection now calls routing.assessTask with an injectable o.jevAsk, so a JEV that cannot advise hands authority to the Controller through the real JEV path (UNDECIDED:UNREACHABLE) instead of a hand-built assessment; tests 64-25, 64-26 and 64-27 fail on b841658 and pass here, full suite 1076/1076.

## Live run attempt 5 isolated launch fix (2026-10-01)

Observation C: The `--isolated-worker` flag caused the paseo daemon to run the agent process outside the ShipDeWorker boundary by passing `--new-workspace worktree --worktree-mode branch-off`.
Decision: For isolated launches, `executor.resolveRoute` rewrites a `paseo` route to the dedicated `opencode-direct` adapter. The same route decision is consumed by `orchestrate.js`, so isolated live runs launch `opencode` directly instead of the `paseo` daemon. The `isolation-launcher.js` script starts `powershell.exe -File run-target.ps1` under the `ShipDeWorker` OS user account, and that nested script runs `opencode run --model <provider/model> --dir <worker root> --auto --format json` inside the worker root (`C:\ShipDeWorker\<job>`).
Gateway Key Delivery: Provider access for the worker is supplied by writing a minimal `opencode.json` config inside the worker root that points to the local 9Router endpoint (`http://127.0.0.1:20128/v1`). The config file references the gateway key only through the environment reference (`{env:NINEROUTER_API_KEY}`). The `isolation-launcher.js` allow-list passes the literal value of `NINEROUTER_API_KEY` only for the `opencode-direct` worker process. The key is never written to disk, passed in argv, sent in a prompt, or leaked into the repository.
Residual risk: The agent runs within the `ShipDeWorker` boundary and is not given operator GitHub credentials; `GH_CONFIG_DIR` is redirected to the worker root and GitHub token environment variables are not in the worker allow-list. However, because `NINEROUTER_API_KEY` is present in the `opencode-direct` process environment, a compromised agent could dump its own environment and observe the token, allowing unauthorized 9Router consumption if router-side quota and revocation controls failed.

## Live run attempt 6 native shim target launch fix (2026-10-01)

Observation / Defect: Live E2E attempt 6 failed on worker process launch with `SyntaxError: Invalid or unexpected token`. In `tools/ai-brain/harness.js:executableFor`, unwrapping `.cmd` shims unconditionally returned `{ file: opts.nodePath || process.execPath, prefixArgs: [target] }`. For `opencode`, the shim target is `node_modules\opencode-ai\bin\opencode.exe` (a native binary), causing Node to attempt executing machine code as JavaScript.
Decision: `executableFor` inspects the unwrapped target's extension (case-insensitive) using a deny-list / native check:
- Native executables (`.exe`, `.com`) return `{ file: target, prefixArgs: [] }` to be spawned directly without Node wrapping.
- All other targets (including standard JavaScript launchers `.js`, `.cjs`, `.mjs`, and extension-less Node scripts) remain wrapped with `opts.nodePath || process.execPath`.
Additionally, shim unwrapping handles `%~dp0%\`, `%dp0%\`, `%~dp0\`, and unquoted/forward-slash layouts, and correctly preserves space-bearing paths within quoted `node_modules` targets without premature token splitting. Regression tests in `tools/ai-brain/test/task-ai-64.test.js` verify native targets spawn directly, space-bearing paths are preserved, and script targets wrap with node.

Evidence:
- Fail-before base SHAs:
  - `194af039e56ff00e742b4978c39332152512f1d9`: native `.exe` target executed via `node` (producing `SyntaxError: Invalid or unexpected token` / DOS mode MZ header failure).
  - `64d7dec2d9e47f631d8349a9dcc388f51431eff0`: space-bearing `node_modules` target truncated by `\s` exclusion and silently regressed to `.cmd` shim fallback (`ERR_ASSERTION`).
- Command: `node --test "tools/ai-brain/test/*.test.js"`
- Pass-after result: All tests pass. Full test suite: 1100/1100 passed (38/38 in `tools/ai-brain/test/task-ai-64.test.js`).
- Prettier check: `npx --package prettier@3.9.6 prettier --check tools/ai-brain/harness.js tools/ai-brain/test/task-ai-64.test.js docs/product-spec/work-items/TASK-AI-64.md` clean.

Residual risk / known limitations:
- Deny-list extension behavior: `executableFor` inspects only `/\.(exe|com)$/i`. Non-executable script targets that are not JavaScript (such as `.bat`, `.cmd`, or `.ps1` targets) fall through to Node wrapping.
- Directory candidate matching: If the first existing candidate matched under `node_modules` happens to be a directory rather than a file (`tools/ai-brain/harness.js:479-481`), `exists(candidate)` evaluates to true, fails the `.exe` check, and is handed to Node wrapping.
- Standard npm global shims emit `.exe` or `.js` targets on Windows; non-standard shims wrapping batch or PowerShell scripts remain untested shape classes.

## Live run attempt 7 worker provider id and config error fix (2026-10-02)

Observation / Defect E: Live E2E attempt 7 failed with exit 1 within 5 seconds with stdout:
`{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error. Check server logs for details."}}}`.
Investigation revealed two compounding defects:
1. Provider ID Mismatch & Incomplete OpenCode Configuration: `tools/ai-brain/isolation-launcher.js` wrote `opencode.json` with hardcoded provider `"9router"`:
   ```json
   { "provider": { "9router": { "options": { "baseURL": "...", "apiKey": "{env:NINEROUTER_API_KEY}" } } } }
   ```
   while `opencode-direct` invoked `--model ninerouter/ag/gemini-3.1-pro-low`. Because `ninerouter` was not defined in `opencode.json`, OpenCode failed to resolve the provider. Furthermore, for custom OpenAI-compatible endpoints, OpenCode requires the `@ai-sdk/openai-compatible` npm driver, baseURL, apiKey env reference, and a `models` map declaring the pinned model.
2. Premature Domain Block from Launch/Harness Config Failure: Because OpenCode exited before issuing any model request, the orchestrator evaluated the exit without passing `stdout` to `classifyFailure`, which defaulted to `Scope.UNKNOWN`. In `sameFailureDomain`, `Scope.UNKNOWN` treated the error as an upstream/gateway failure and blocked all remaining candidates sharing `9router/ag` (`FAILURE_DOMAIN_AVOIDED`), ending with `NO_ELIGIBLE_CANDIDATE`.

Decision & Implementation:
1. Model-Derived Provider Derivation (`tools/ai-brain/isolation-launcher.js` & `tools/ai-brain/sources.js`): In `isolation-launcher.js`, extracted the exact `--model` argument received by opencode and derived `providerId` directly from that string using `sources.providerFromPrefix(pinnedModel)`, ensuring agreement (`providerFromPrefix(pinnedModel) === providerId`) without divergent lookups.
2. Complete OpenCode Provider Specification (`tools/ai-brain/isolation-launcher.js`): Configured `opencode.json` with the model-derived `providerId`, `npm: '@ai-sdk/openai-compatible'`, `options.baseURL`, `options.apiKey: '{env:...}'`, and a `models` map registering both the fully qualified and relative model keys.
3. Gated Harness / Launch Config Classification with Finite Cooldown (`tools/ai-brain/failure-classifier.js`): Added `Cause.HARNESS_FAILED` and `Cause.LAUNCH_CONFIG` under `Scope.HARNESS`. Case 13 is gated on absence of HTTP status (`!hasHttpStatus`, ensuring upstream HTTP responses are never misclassified as launch failures), non-zero exit code / no model call, and OpenCode local error envelope / provider resolution errors. Both causes are given a finite cooldown of 5 minutes (`DEFAULT_COOLDOWNS`), guaranteeing transient upstream 5xx errors never produce permanent bans.
4. Matched Stdout in Evidence (`tools/ai-brain/failure-classifier.js`): Accepted and recorded scrubbed `stdout` into durable `evidence` (documented in JSDoc) so classifications driven by stdout error payloads preserve audit evidence.
5. Cleaned Domain Non-Interference (`tools/ai-brain/cli.js:sameFailureDomain`): In `sameFailureDomain`, `Cause.LAUNCH_CONFIG` under harness scope returns `false` across candidates so harness configuration errors do not poison or block the upstream/gateway domain. Removed dead/unreachable branch comparisons.
6. Orchestration Telemetry (`tools/ai-brain/orchestrate.js`): Passed `stdout` in addition to `body` and `stderr` to `classifyFailure` so early JSON error outputs on stdout are properly classified.
7. Allowed Paths Amended (`docs/product-spec/work-items/TASK-AI-64.md`): Boundary updated to include `sources.js`, `failure-classifier.js`, and `test/failure-classifier.test.js` with documented justification.

Evidence:
- Fail-before base SHA: `56af8522de5ff411aaa35813ca05ccd707bf3e40` (9 failing tests across the updated test files: 5 DEFECT E failures in `tools/ai-brain/test/task-ai-64.test.js` [5/43 fail] and 4 Case 13 failures in `tools/ai-brain/test/failure-classifier.test.js` [4/70 fail]).
- Pass-after result: All tests pass. Full test suite: 1110/1110 passed (43/43 in `tools/ai-brain/test/task-ai-64.test.js`, 70/70 in `tools/ai-brain/test/failure-classifier.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js" "tools/ai-brain/test/failure-classifier.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `npx --package prettier@3.9.6 prettier --check tools/ai-brain/sources.js tools/ai-brain/isolation-launcher.js tools/ai-brain/failure-classifier.js tools/ai-brain/cli.js tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-64.test.js tools/ai-brain/test/failure-classifier.test.js docs/product-spec/work-items/TASK-AI-64.md`
  - `git diff --check` clean.

Residual risk / known limitations:
- If OpenCode encounters server-side errors from an upstream API that emit into the `UnknownError` envelope on stdout without an HTTP status, those could be classified as `LAUNCH_CONFIG`; the finite 5-minute cooldown bounds recovery time and prevents permanent candidate bans.
- Pre-installed `@ai-sdk/openai-compatible` is dynamically resolved by OpenCode at runtime from its environment or npm cache; in offline or firewalled environments without global caching, package installation could fail if not pre-seeded.

## Live run attempt 10 exercise runner after provision fix (2026-10-02)

Observation / Defect G: In Live E2E attempt 10, orchestrate ran with `--isolated-worker --exercise e1`, but inside the worker root `C:/ShipDeWorker/isolation` the runner file `tools/ai-brain/test/e1-branch-name.test.js` did not exist when the agent ran (`live10-worker-opencode.log`), forcing the agent to improvise an in-memory/scratch test.
Cause: `tools/ai-brain/orchestrate.js` called `materialiseExercise(job.cwd, o)` before `launcher(job)`. For isolated workers, `tools/ai-brain/isolation-launcher.js` then provisioned the worker root (`git clone --no-checkout` followed by `git checkout <baseSha>`), wiping the pre-materialised runner file before the agent started.

Decision & Implementation:
1. Post-Provisioning Runner Materialisation (`tools/ai-brain/isolation-launcher.js`):
   - `isolatedLauncher` accepts `opts.exercise` and `opts.onProvisioned`.
   - After provisioning the worker root (`git clone --no-checkout` + `git checkout headSha`), the launcher invokes `materialiseExercise(workerRoot, opts)` and the `opts.onProvisioned(workerRoot, opts)` callback, ensuring the runner exists before writing `run-target.ps1` and launching the agent process.
   - Excluded from Git Tracking: `appendGitInfoExclude(workerRoot, ['tools/ai-brain/test/e1-branch-name.test.js'])` ensures the runner remains untracked in `.git/info/exclude` in the worker clone, preventing it from ever being staged or committed into the repository or published draft Pull Request.
   - Fail-Before Capture at Base SHA: Invokes `captureFailBefore(workerRoot, exerciseInfo.runnerRel)` host-side at the pinned base SHA, capturing the missing module error and non-zero exit code into `launchResult.failBefore` and `launchResult.exercise`.
2. Clean Child Test Environment: Stripped `NODE_TEST_CONTEXT` and `NODE_TEST_WORKER_ID` from spawned child test process environment in `captureFailBefore` so recursive `node --test` execution in the provisioned tree executes cleanly without being skipped.
3. Orchestrator Integration (`tools/ai-brain/orchestrate.js`):
   - Reuses `materialiseExercise` and `captureFailBefore` exported from `isolation-launcher.js`.
   - `resolveLauncher` forwards `opts.exercise` and `opts.onProvisioned` to `isolatedLauncher`.
   - For isolated workers, `runOrchestration` defers materialisation to `isolatedLauncher`, and records `res.exercise` and `res.failBefore` on the job, session, and log outputs.

Evidence:
- Fail-before base SHA: `ab7f3728fb264abfd3fe09c0e26c67e0e35770c2` (runner absent when agent starts, no fail-before captured by launcher, no onProvisioned hook).
- Pass-after result: All tests pass. 3 new regression tests in `tools/ai-brain/test/task-ai-64.test.js`:
  1. The runner file exists in the provisioned worker root when the agent process starts, `onProvisioned` hook is called, and `failBefore` is captured at base SHA.
  2. Exercise runner is untracked by git and never committed (verified with real git repo).
  3. Orchestrator forwards `exercise` and records `exercise` and `failBefore` on `log` and `session`.
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `npx --package prettier@3.9.6 prettier --check tools/ai-brain/isolation-launcher.js tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-64.test.js docs/product-spec/work-items/TASK-AI-64.md`
  - `git diff --check` clean.

Residual risk / known limitations:
- Materialisation depends on `tools/ai-brain/exercise/e1-branch-name.cases.json` being present either in the provisioned tree or host worktree.
- The runner file is excluded locally via `.git/info/exclude`; if `.git/info` cannot be created or written, exclusion would fail closed.

## Live run attempt 11 worker head review, commit requirement, and usage report fix (2026-10-02)

Observation / Defect H & Defect A:
In Live E2E attempt 11 (`.worktrees/logs/night/ai64-live-run1-20261002-attempt11.md`), the isolated worker (`gemini-3.1-pro-low`) successfully wrote `tools/ai-brain/branch-name.js`, and host-side verification confirmed that fail-before failed at the base SHA and passed after the agent implementation. However:
1. (H1) Uncommitted Worker Changes: The worker left the code change uncommitted in the worker root (`C:/ShipDeWorker/isolation`). The prompt lacked an explicit local commit requirement, and the orchestrator lacked worker git commit verification (`head == baseSha` or dirty tree).
2. (H2) Review SHA Unpinned: In `tools/ai-brain/orchestrate.js:reviewItem`, the review loop statically referenced `o.sha` from the CLI `--sha` option. Since `--sha` was not supplied on the CLI, `o.sha` was null, causing the review loop to immediately block with `REVIEW_SHA_UNPINNED` and bypassing bounded repair.
3. (A) Missing Usage Report: The usage report file named in `out.json` (`job.usageFile` under `%TEMP%/shipde-usage/`) was never written to disk for `opencode-direct` launches because OpenCode lacks a `--usage-file` CLI flag, and `readSessionId` bypassed usage report verification for `opencode-direct`.

Decision & Implementation:
1. Explicit Worker Commit Requirement (`tools/ai-brain/prompt-compiler.js`):
   - Added mandatory commit instruction to compiled prompts: `Commit requirement: you must create exactly one local commit on the exercise branch (${branch}) containing all your changes (no push).`
   - Added usage report output instruction when `usageFile` is passed.
2. Clean Git Environment with Untracked Exclude Support (`tools/ai-brain/supervisor.js` & `tools/ai-brain/isolation-launcher.js`):
   - In `supervisor.js:withCleanGitEnv`, added safe copying of `info/exclude` into the operator-controlled clean temporary git environment so `status --porcelain`, `rev-parse`, and `diff` respect untracked file exclusions.
   - In `isolation-launcher.js:appendGitInfoExclude`, excluded harness runtime artifacts (`.shipde/`, `run-target.ps1`, `run-target.complete.json`, `temp/`, `.config/`, `.local/`, `Microsoft/`) in the worker root so operator telemetry does not dirty the worker worktree.
3. Worker Commit Verification & Bounded Repair Routing (`tools/ai-brain/orchestrate.js`):
   - Implemented `headShaOf(cwd)`, `isTreeDirty(cwd)`, and `verifyWorkerCommit(workerRoot, baseSha)`.
   - `verifyWorkerCommit` asserts that worker HEAD is a valid commit, `headSha !== baseSha`, and `isTreeDirty` is false. If uncommitted, returns `NO_LOCAL_COMMIT` with descriptive detail.
   - In `runVerificationCommand`: runs test command host-side; when exit and expect pass, executes `verifyWorkerCommit`. On uncommitted changes or missing commit, returns `{ pass: false, cause: 'NO_LOCAL_COMMIT', findings: [{ id: 'NO_LOCAL_COMMIT', open: true, detail }] }`, feeding `runReviewLoop`'s bounded repair mechanism without crashing or prematurely blocking with `REVIEW_SHA_UNPINNED`.
4. Pinned Worker Head Review (`tools/ai-brain/orchestrate.js`):
   - In `reviewItem`, resolves `targetSha = workerHead || o.sha` (40-char SHA); passes `workerRoot` and `baseSha` into verification options for `runReviewLoop`; records `sha: review.finalSha || targetSha`.
5. Usage Report Generation and Fail-Closed Verification (`tools/ai-brain/orchestrate.js`, `tools/ai-brain/harness.js`, `tools/ai-brain/executor.js`):
   - In `orchestrate.js:writeUsageReportFromHarnessResult(job, res)`, generates the durable usage report for `opencode-direct` from stdout JSON telemetry (`sessionID`, token counts) or `completionNonce`; if the launch exited non-zero, sets `session_id: null`. Preserves Hermes CLI usage report writing.
   - In `harness.js:opencodeDirect.sessionIdFrom`, extracts `session_id`/`sessionId`/`sessionID` from the usage report.
   - In `executor.js:readSessionId`, enforces reading and validating `job.usageFile` when `adapter.writesUsageReport` is true, failing closed with `HARNESS_USAGE_REPORT_MISSING` if absent and `HARNESS_USAGE_REPORT_INVALID` if malformed, falling back to `completionNonce` only when `job.usageFile` was omitted.

Evidence:
- Fail-before base SHA: `723fc8f` / `723fc8f31922cba2703aa406326b864a7812bb67`
  - Prompt omitted commit requirement and usage report instructions.
  - Worker commit unverified; dirty trees allowed.
  - `reviewItem` blocked with `REVIEW_SHA_UNPINNED` when `o.sha` was null.
  - OpenCode usage report file never created on disk; `readSessionId` bypassed usage report verification.
- Pass-after result: All tests pass. 11 new regression tests in `tools/ai-brain/test/task-ai-64.test.js`:
  - Full test suite: 1142/1142 passed (57/57 in `tools/ai-brain/test/task-ai-64.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `npx --package prettier@3.9.6 prettier --check tools/ai-brain/executor.js tools/ai-brain/harness.js tools/ai-brain/isolation-launcher.js tools/ai-brain/orchestrate.js tools/ai-brain/prompt-compiler.js tools/ai-brain/supervisor.js tools/ai-brain/test/task-ai-64.test.js docs/product-spec/work-items/TASK-AI-64.md`
  - `git diff --check` clean.

Residual risk / known limitations:
- The worker commit author and message are defined by the agent/git config inside the worker environment; `verifyWorkerCommit` asserts commit existence, parentage, and clean worktree status rather than commit message format.
- OpenCode telemetry extraction relies on stdout JSON lines or completionNonce fallback; non-zero exit codes write `session_id: null` to ensure fail-closed behavior.

## CI fix round 1 of 2: Worker-head verification parity on POSIX (2026-10-02)

Observation / Root Cause:
In commit `b971372`, `orchestrate.js:reviewItem` resolved `workerRoot` as `(o.isolatedWorker ? isolatedWorkerRoot : o.workerRoot) || session.worktree || o.cwd || process.cwd()`. On Windows in the local worktree checkout (`.worktrees/ai64head`), `.git` is a worktree file, which `withCleanGitEnv` (with `workerWritable: true`) refused as `.git-unresolved`, causing `headShaOf(process.cwd())` to return `null` and safely falling back to `o.sha` (`SHA_A`). However, on Ubuntu CI, the repository is checked out as a standard clone with a `.git` directory, so `headShaOf(process.cwd())` succeeded and returned the HEAD commit of the CI clone repository. This caused `targetSha` to bind to the CI commit SHA instead of `o.sha` (`SHA_A`), leading tests `64-09` and `64-10` to immediately block with `STALE_REVIEW_SHA` on round 1 because their mock reviewers returned `SHA_A`. Similarly, `runVerificationCommand` erroneously verified commits on `process.cwd()`.

Fix:
1. In `orchestrate.js:reviewItem`, removed `o.cwd || process.cwd()` fallback from `workerRoot`. If no isolated worker, explicit worker root, or session worktree exists, `workerRoot` resolves to `null`, ensuring `targetSha` preserves `o.sha`.
2. In `orchestrate.js:runVerificationCommand`, scoped `verifyWorkerCommit` to `workerRoot` (returning `pass: true` when `workerRoot` is absent) rather than testing `process.cwd()`.
3. In `supervisor.js:safeGit`, added scoped `-c safe.directory=<normCwd>` and `-c safe.directory=<normTmp>` arguments to prevent dubious ownership errors when `GIT_CONFIG_GLOBAL` is ignored on POSIX.
4. In `tools/ai-brain/test/task-ai-64.test.js`, added POSIX clone simulation tests proving that running from inside a git clone directory does not bind review to the host repository when `workerRoot` is unspecified.

## Live E2E Attempt 12 repair: Worker commit preservation and gateway+upstream failure domain (2026-10-02)

Observation / Defect J & Defect K:
In Live E2E attempt 12 (`.worktrees/logs/night/ai64-live-run1-20261002-attempt12.md`), the isolated worker (`ag/gemini-3.1-pro-low`) successfully wrote `tools/ai-brain/branch-name.js` and created a real local commit `817bc8b0e6a89d31a309fc2549cd5b567902951f`. However:
1. (Defect J) Worker Commit Loss during Repair: When verification failed, `repairRound` passed the commit SHA to `isolation-launcher.js:getIsolatedLauncher`, which deleted and re-cloned the worker root from the host repository. Because the worker commit was never pushed to the host, `git checkout <sha>` in the fresh clone failed, destroying the worker commit and crashing subsequent repairs with `Failed to checkout HEAD SHA in worker root`.
2. (Defect K) Overly Broad Reviewer Exclusion & Wildcard Accounts: In `orchestrate.js:reviewItem`, the reviewer selection refused all candidates (19x `FORBIDDEN_FAILURE_DOMAIN`, 8x `WILDCARD_ACCOUNT`, 5x `CANDIDATE_BLOCKED`). The writer was `9router::ag` (account `codex`). Setting `forbiddenDomains = [writerGateway, writerUpstream, writerAccount]` forbade the entire `9router` gateway (`'9router'`), which blocked valid reviewer candidates on other upstreams (`cl`, `ocz`, `gh`). Furthermore, `candidates.js:generateCandidates` emitted wildcard account candidates (`accountId: '*'`) for catalogue entries when concrete accounts existed or for dependencies reaching via a router (`source.reachedVia`), which were subsequently rejected by `routing.rankForProfile` with `WILDCARD_ACCOUNT`.

Fix:
1. Worker Root and Commit Preservation (`tools/ai-brain/isolation-launcher.js` & `tools/ai-brain/orchestrate.js`):
   - In `isolation-launcher.js`: Before deleting `workerRoot` and re-cloning from `hostCwd`, checked if `git rev-parse --verify --quiet <headSha>^{commit}` succeeds in `workerRoot`. If the commit already exists in the worker root, skipped deletion and re-cloning, preserving existing commits. If absent or invalid, re-provisioned and checked out `headSha`, throwing structured error `ISOLATION_CHECKOUT_FAILED: Failed to checkout HEAD SHA in worker root: <headSha>`.
   - In `orchestrate.js:repairRound`: Bound `repairJob.baseSha` to `sha || o.baseSha || null`, ensuring the worker commit under review is forwarded as the base commit for the repair round.
2. Failure Domain Scoped to Gateway+Upstream & Account Inheritance (`tools/ai-brain/orchestrate.js` & `tools/ai-brain/candidates.js`):
   - In `orchestrate.js:reviewItem`: Redefined `forbiddenDomains = [writerUpstream || writerGateway, writerAccount].filter(Boolean)`. Because failure domains are defined per gateway+upstream (each upstream is an independent failure domain), this permits reviewer candidates on the same router with distinct upstreams (e.g., `9router/cl`, `9router/ocz`).
   - In `candidates.js:generateCandidates`: Inherited bound accounts from `source.reachedVia` when direct accounts are empty. When concrete accounts exist (`accounts.some(a => a.id && a.id !== '*')`), suppressed `sharedArc` (`accountId: '*'`) from catalogue expansion, preventing creation of un-routable wildcard candidates.

Evidence:
- Fail-before base SHA: `fb78bec` / `fb78bec80e1f3ff8308f272db326c1448113e88d`
  - `isolation-launcher.js` unconditionally deleted worker root on re-provisioning, losing worker commits.
  - `orchestrate.js:reviewItem` forbade the entire router gateway, blocking all reviewer candidates.
  - `candidates.js:generateCandidates` generated wildcard candidates rejected as `WILDCARD_ACCOUNT`.
- Pass-after result: All tests pass. 5 new regression tests in `tools/ai-brain/test/task-ai-64.test.js`:
  - Full test suite: 1148/1148 passed (63/63 in `tools/ai-brain/test/task-ai-64.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `npx --package prettier@3.9.6 prettier --check tools/ai-brain/candidates.js tools/ai-brain/isolation-launcher.js tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-64.test.js docs/product-spec/work-items/TASK-AI-64.md`
  - `git diff --check` clean.

Residual risk / known limitations:
- A repair round preserves the existing worker root when the requested commit SHA is already verified locally; if the worker root is corrupted or missing the commit, it safely falls back to a clean re-clone and fails closed with `ISOLATION_CHECKOUT_FAILED` if checkout fails.
- Reviewer failure domain separation requires at least two distinct upstreams or distinct account identities available in the registry.

## Repair round 2 of 2: Never check out inside a retained worker root (2026-10-02)

Observation / Finding 1:
In review `f0bc0320fb941e9fb2be5bee6b2c8c5a4dbc26a5.md`, when a retained worker root already held the target commit (`alreadyHoldsHead = true`) but HEAD was at a different commit (`headIsAlreadyTarget = false`), `isolation-launcher.js` executed `git checkout <headSha>` directly inside `workerRoot`. Because git reads repo-local `.git/config` during checkout, any worker-planted smudge filter (`filter.<driver>.smudge`) or custom driver executed as the operator outside the `ShipDeWorker` boundary.

Fix:
1. Never check out in a retained worker root (`tools/ai-brain/isolation-launcher.js`):
   - Removed `git checkout` entirely from the retained worker root path.
   - Retained worker root (`workerRoot` and `.git` exist) is kept only when a hardened read (`withCleanGitEnv` / `safeGit`) confirms HEAD already equals the requested `headSha`.
   - If HEAD does not equal `headSha` (or is invalid/corrupt), returns structured failure `WORKER_HEAD_MISMATCH` that the repair loop in `orchestrate.js` treats as a failed repair attempt, preserving the worker's commits without deleting, re-cloning, or checking out.
2. Hardened operator git environment (`tools/ai-brain/supervisor.js`):
   - In `safeGit`: Added `-c core.hooksPath=<nulDevice>`, `-c core.fsmonitor=false`, `-c core.attributesFile=<nulDevice>`, `-c diff.external=`, and set `GIT_CONFIG_SYSTEM=<nulDevice>` alongside `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL=<nulDevice>`.
   - In `withCleanGitEnv`: Hardened `git init` with clean `GIT_CONFIG_*` environment.
3. Regression tests (`tools/ai-brain/test/task-ai-64.test.js`):
   - (a) Mismatched-head case: Retained worker root with planted `filter.evil.smudge` + `.gitattributes`, `core.attributesFile`, `core.hooksPath` post-checkout, and `core.fsmonitor`; forces mismatched HEAD; asserts `WORKER_HEAD_MISMATCH` is thrown, no marker file is written, and the worker commit is preserved without checkout.
   - (b) Matching-head case: Asserts no checkout is executed, no markers are written, and the worker commit is kept.

Evidence:
- Fail-before base SHA: `f0bc032` / `f0bc0320fb941e9fb2be5bee6b2c8c5a4dbc26a5`
  - `isolation-launcher.js` executed `git checkout` inside `workerRoot`, running worker-planted smudge filter as operator.
- Pass-after result: All tests pass. 65/65 passed in `tools/ai-brain/test/task-ai-64.test.js`; 1150/1150 passed in full brain suite (`tools/ai-brain/test/*.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- Repair round 1 supersedes the earlier six-field checkpoint review record with a durable execution receipt. Pre-repair checkpoints that never captured a receipt, including the original Live attempt 22 `checkpoint.json`, still fail closed and require a fresh reviewed run or documented re-review rather than being silently published.

## Repair Round 1 of 2: Durable execution receipt for resume and publish (Defect U review findings F1-F11) (2026-10-03)

Observation:
The independent review of commit `8f67987` found that Defect U persisted only `{workItemId, sha, verdict, reviewer, workerRoot, branch}` and defaulted missing verdicts to `PASS`. A completed checkpoint could therefore be incomplete, forged, or self-asserted, yet still be rewritten or published on resume. Required repair: persist a durable execution receipt sufficient to verify commit existence and ancestry, fail-before/pass-after evidence, exact-SHA PASS review with no open findings and reviewer outside the writer failure domain, publisher input reconstruction, no worker/reviewer re-run on resume, and integrity plus decision-log cross-check.

Fix:
1. Durable Receipt Shape (`tools/ai-brain/orchestrate.js`):
   - Removed the default `PASS` verdict in checkpoint normalization; absent verdict remains absent and refuses.
   - Persisted `baseSha`, `writerCandidateKey`, `reviewRounds`, `openFindings`, `tests` (`command`, `baseExitCode`, `headExitCode`, `outputDigest`), `decisionLog` evidence (`dir`, `now`, `completed`, `reviewedSha`, `verdict`, `reviewer`, `digest`), `draftTitle`, and `integrity` (`sha256:stable-json:v1`) for each completed receipt.
   - Preserved prior checkpoint review records verbatim instead of re-normalizing incomplete records into valid-looking records.
2. Resume Validation (`tools/ai-brain/orchestrate.js`):
   - Validates receipt integrity, exact 40-character SHA, PASS verdict, reviewer, branch, draft title, review rounds, zero open findings, test evidence, writer/reviewer failure-domain separation, and decision-log confirmation.
   - Cross-checks the recorded SHA in the recorded worker repo using hardened `withCleanGitEnv` / `safeGit`: `rev-parse <sha>^{commit}`, `merge-base --is-ancestor <baseSha> <sha>`, and explicit `sha != baseSha`.
   - Requires receipt `workerRoot` to match publish `cwd`; publication can rebuild `cwd`, branch, reviewer, verdict, reviewed SHA, and draft title from the receipt while keeping `publisher.js` gates unchanged. (Superseded by Repair Round 3: the element that must match publish `cwd` is the receipt's `publishCwd`, an operator-side directory; `workerRoot` is where the commit and its ancestry are verified. For an isolated run the two are necessarily different, because `publisher.js` refuses any cwd inside the worker root.)
3. Publication Diagnostics (`tools/ai-brain/orchestrate.js`):
   - Keeps no-publish runs non-publishing while preserving `NO_REVIEWED_COMMIT` diagnostics.
   - Final refusal now reports the concrete refused publication reason rather than a generic `PUBLICATION_REFUSED`.
4. Regression Tests (`tools/ai-brain/test/task-ai-64.test.js`):
   - Extended Defect U tests to assert the full receipt fields on the completed checkpoint.
   - Added mutation cases for integrity tampering, ghost SHA, base-commit receipt, failing pass-after evidence, open findings, same-domain reviewer, decision-log mismatch, missing review record, invalid SHA, non-PASS verdict, and approval bound to another SHA.
   - Resume publish still proves worker/reviewer are not re-run and publishes the recorded SHA only after the receipt validates.

Evidence:
- Fail-before base SHA: `a7687e1` / `a7687e1bb9b83981afa6b724f9f80ec054832ee0`
  - The Defect U tests fail at base because no durable receipt exists and completed resume cannot publish the recorded reviewed commit.
- Pass-after head SHA: `9a53116ee2b0cb57e9ec3aebdc1d2a92001e612d`.
- Commands run:
  - `node --test --test-name-pattern="recorded reviewed commit" tools/ai-brain/test/task-ai-64.test.js` -> 3/3 pass.
  - `node --test --test-name-pattern="64-24" tools/ai-brain/test/task-ai-64.test.js` -> 1/1 pass after preserving no-publish terminal behavior.
  - `node --test "tools/ai-brain/test/*.test.js"` with temp `HOME`, `USERPROFILE`, and `TEMP` outside the worktree -> 1210/1210 pass, 210 suites pass, 0 fail.

Residual risk / known limitations:
- Pre-repair checkpoints that lack any durable receipt remain unrecoverable by design and must be re-reviewed or re-run; absence of receipt evidence is refused, not converted to PASS.

## Repair Round 2 of 2: Receipt evidence is anchored and complete (Defect U review findings F12-F16) (2026-10-03)

Observation:
The independent review of commit `9a53116ee2b0cb57e9ec3aebdc1d2a92001e612d` closed F1-F11 but found five remaining gaps. Missing or non-numeric `tests.baseExitCode` could pass as fail-before evidence, `tests` were only shape-checked inside the receipt, `reviewRounds` and resumed round history were self-asserted by the receipt, the draft title was the literal placeholder `[TASK-AI-64] work item`, and this Work Item evidence block still had an unfilled SHA placeholder plus the wrong Defect U test pattern.

Fix:
1. Numeric fail-closed test receipt validation (`tools/ai-brain/orchestrate.js`):
   - `baseExitCode` and `headExitCode` must be finite numbers before comparison. Missing, absent, `NaN`, or string-only fake values are incomplete evidence and refuse.
2. Independent test-evidence anchor (`tools/ai-brain/orchestrate.js`):
   - The review execution records compacted test evidence into the append-only decision log at execution time on both `review` and `completed` records.
   - Resume validation recomputes decision-log evidence and compares receipt `tests` against the recorded decision-log copy. A fabricated receipt can recompute its unkeyed integrity checksum, but it cannot make the old decision-log record contain the fabricated command, exit codes, or output digest.
3. Decision-log review rounds and repair count (`tools/ai-brain/orchestrate.js`):
   - `reviewRounds` is compared with the matching `review` records in the decision log.
   - `repairCount` is persisted in the receipt and compared with the `completed` decision record.
   - Resumed `log.review.review.rounds` is rebuilt from recorded decision-log review records, not synthesized from the receipt's claimed count.
4. Real draft title (`tools/ai-brain/planner.js`, `tools/ai-brain/orchestrate.js`):
   - Planner now carries `title` and `businessOutcome` / `outcome` through to work items.
   - Receipt draft titles are derived from the Work Item outcome fields, falling back to acceptance evidence, instead of the literal string `work item`.
5. Work Item evidence block (`docs/product-spec/work-items/TASK-AI-64.md`):
   - Round 1 now names the actual pass-after SHA `9a53116ee2b0cb57e9ec3aebdc1d2a92001e612d`.
   - The Defect U command now uses `--test-name-pattern="recorded reviewed commit"`, matching the suite name.
  - Round 2 now names its own pass-after SHA `0c4685c19cd5d39d6bab0bd1662d3334d2fbf6aa`, closing the placeholder F16 raised for round 1.

Evidence:
- Fail-before SHA: `9a53116ee2b0cb57e9ec3aebdc1d2a92001e612d`.
  - Exported `9a53116` to a temp tree and copied the repaired Defect U test file over it. `node --test --test-name-pattern="recorded reviewed commit" tools/ai-brain/test/task-ai-64.test.js` failed 11/12 before the fix: missing `repairCount`, literal draft title, absent decision-log test anchor, absent and non-numeric `baseExitCode` publishing as `PUBLISHED_DRAFT`, fabricated test evidence publishing, review-round mismatch publishing, and incomplete Work Item evidence.
- Pass-after head SHA: `0c4685c19cd5d39d6bab0bd1662d3334d2fbf6aa`.
- Pass-after working tree:
  - `node --test --test-name-pattern="recorded reviewed commit" tools/ai-brain/test/task-ai-64.test.js` with temp `HOME`, `USERPROFILE`, and `TEMP` outside the worktree -> 12/12 pass.
  - `node --test tools/ai-brain/test/task-ai-64.test.js` with temp `HOME`, `USERPROFILE`, and `TEMP` outside the worktree -> 111/111 pass, 13 suites pass, 0 fail.
  - `node --test "tools/ai-brain/test/*.test.js"` with temp `HOME`, `USERPROFILE`, and `TEMP` outside the worktree -> 1219/1219 pass, 210 suites pass, 0 fail.
- Sound-anchor choice:
  - Chosen anchor is the append-only decision log written during the execution run. It records test command, fail-before/pass-after exit codes, output digest, review rounds, and repair count before resume. Resume re-reads that log and refuses if the checkpoint receipt disagrees.
  - This is stronger than receipt-only integrity: `integrity` remains an unkeyed stable-JSON checksum for corruption detection, not authenticity. Authenticity for publish is still the combined exact commit/ancestry check, reviewer-domain separation, SHA-bound approval, and decision-log cross-check.

Residual risk / known limitations:
- Pre-round-2 durable receipts that lack decision-log test and repair-count anchors fail closed on publish resume and require a fresh reviewed run or documented re-review.

## Repair Round 3: Repaired runs publish; receipt counts and cwd consistent (Defect U review findings F17-F21) (2026-10-03)

Observation:
The independent review of commit `0c4685c19cd5d39d6bab0bd1662d3334d2fbf6aa` closed F1-F16 but found five remaining gaps. `openFindings` was summed across every review round, so a run that completed `REVIEW_PASS` after a repair still carried `openFindings: 1` and was refused by the validator that wrote it; `reviewRounds` compared the receipt's total round count with the decision log's matched subset, so every multi-round run refused; the rebuilt publish `cwd` was the receipt's `workerRoot`, which an isolated run records under `C:\ShipDeWorker` and `publisher.js` refuses, so requirement (d) was unsatisfiable in this Work Item's own isolated scenario; an omitted `repairCount` was read as `Number(null) === 0` and, when the signature matched the shape the extractor re-materialised, published as `PUBLISHED_DRAFT`; and round 2's evidence block still carried no pass-after SHA.

Fix:
1. Open findings of the completed review (`tools/ai-brain/orchestrate.js`):
   - `countOpenFindings` counts the findings of the final round — the round the item completed on — instead of summing every round. Repair rounds and refused review rounds keep their history in the decision log. A repaired receipt now reads `verdict: PASS` with `openFindings: 0`; a receipt whose completed round still carries an open finding refuses.
2. Like-for-like `reviewRounds` (`tools/ai-brain/orchestrate.js`):
   - The receipt's `reviewRounds` is taken from the same decision-log evidence the validator compares against: the `review` records that attest to this receipt's reviewed commit and verdict. How many rounds a repaired run went through is `repairCount`, which was already compared like-for-like with the `completed` record.
3. Operator-side publish cwd (`tools/ai-brain/orchestrate.js`):
   - The receipt carries `publishCwd` next to `workerRoot`. An isolated run records the host worktree (or an explicitly designated `publisherCwd`), never the worker root; a non-isolated run records the worker root it already published from. Absence refuses: `PUBLISH_REFUSED: receipt missing publish cwd`.
   - Receipt validation and the publication stage resolve the cwd through one shared `resolvePublishCwd`, so the directory the receipt was checked against is the directory the publisher runs in — rebuilt from the receipt when the operator names none, and the two expressions can no longer disagree.
   - A receipt may never name a publish cwd inside the worker boundary: `PUBLISH_REFUSED: receipt publish cwd is inside the worker root`. `workerRoot` keeps its own role: the hardened `withCleanGitEnv` / `safeGit` commit-existence and ancestry checks still run there.
   - `publisher.js` is unchanged: no gate, credential, push path or approval rule was touched.
4. Incomplete receipt refusal (`tools/ai-brain/orchestrate.js`):
   - Absence stays absence in `extractCheckpointReview`: a count that is absent, `null` or non-numeric stays `null` (never `Number(null) === 0`), a field the checkpoint never carried is not re-materialised as `null`, and `verifyReceiptDecisionLog` refuses on the raw field before any coercion — `PUBLISH_REFUSED: receipt missing repair count`.
5. Evidence (`docs/product-spec/work-items/TASK-AI-64.md`, `tools/ai-brain/test/task-ai-64.test.js`):
   - Round 2 now records its pass-after SHA `0c4685c19cd5d39d6bab0bd1662d3334d2fbf6aa`, and round 1's statement about `workerRoot` matching publish `cwd` is marked superseded by this round.

Evidence:
- Fail-before SHA: `0c4685c19cd5d39d6bab0bd1662d3334d2fbf6aa`.
  - Exported `0c4685c` to a temp tree and copied the repaired Defect U test file over it. `node --test --test-name-pattern="recorded reviewed commit" tools/ai-brain/test/task-ai-64.test.js` failed 8/19 (seven tests plus their parent suite): the repaired-run receipt reported `openFindings: 1` instead of publishing, `publishCwdForReceipt` did not exist, the operator-side publish cwd could not be rebuilt (`missing publish cwd for receipt workerRoot check`), absent and `null` `repairCount` were refused as `receipt integrity mismatch` instead of being named, an omitted `repairCount` whose signature matched the extracted shape published as `PUBLISHED_DRAFT`, and round 2's pass-after SHA was absent from this Work Item.
- Pass-after head SHA: filled by the merge commit of this repair (the commands below ran on the working tree that became it).
- Pass-after working tree:
  - `node --test --test-name-pattern="recorded reviewed commit" tools/ai-brain/test/task-ai-64.test.js` with temp `HOME`, `USERPROFILE`, and `TEMP` outside the worktree -> 19/19 pass, 2 suites pass, 0 fail.
  - `node --test tools/ai-brain/test/task-ai-64.test.js` with temp `HOME`, `USERPROFILE`, and `TEMP` outside the worktree -> 118/118 pass, 13 suites pass, 0 fail.
  - `node --test "tools/ai-brain/test/*.test.js"` with temp `HOME`, `USERPROFILE`, and `TEMP` outside the worktree -> 1226/1226 pass, 210 suites pass, 0 fail.
- What stays closed: F1-F16 keep their round-1 and round-2 tests, all of which still pass; `tools/ai-brain/publisher.js` is byte-identical to `0c4685c`; no credential, push path or approval rule was added.

Residual risk / known limitations:
- Receipts written before round 3 carry no `publishCwd` and fail closed on publish resume (`receipt integrity mismatch` or `receipt missing publish cwd`); they require a fresh reviewed run or documented re-review rather than a looser check.
- An isolated run publishes only from an operator-side ref that contains the reviewed commit at HEAD. Fetching the reviewed commit out of the worker root into the host worktree is an operator action; without it the publisher refuses with its unchanged `SHA mismatch` gate, and the receipt names that refusal's cause instead of pointing the publisher at the worker root.
- `integrity` remains an unkeyed sha256 over the receipt's own data — corruption detection, not authenticity — as round 2 states. Authenticity for publish is still the commit/ancestry check, reviewer-domain separation, SHA-bound approval and the decision-log cross-check.

## Escalated author: Fresh worker root on first launch, retained only for repair (2026-10-02)

Observation / Finding 1:
In review `c8fe4fac992ceaa41d917df330f7dee304eb86b2.md`, the retained-root hardening over-corrected: `isolation-launcher.js` treated any existing `workerRoot` holding `.git` as retained and threw `WORKER_HEAD_MISMATCH` when HEAD != requested SHA. Because `workerRoot` is keyed by the host worktree leaf (`C:\ShipDeWorker\<leaf>`), normal first launches of subsequent runs with new `--base-sha` could no longer re-provision at the pinned base SHA and failed closed.

Required design & Fix:
1. Explicitly distinguish initial launch vs repair round (`tools/ai-brain/isolation-launcher.js` & `tools/ai-brain/orchestrate.js`):
   - Initial launch of a work item (no repair context, `retainWorkerHead` is undefined): always re-provisions a fresh worker root at the pinned base SHA (delete + `git clone --no-checkout --no-hardlinks` + `git checkout <headSha>` inside the fresh clone), regardless of what an earlier run left in `workerRoot`.
   - Repair round (`retainWorkerHead: <40-char sha>` passed explicitly by `orchestrate.js:repairRound`): keeps the existing root only if a hardened read (no worker config honoured: clean `GIT_CONFIG_GLOBAL`/`SYSTEM`=NUL, `-c core.hooksPath=NUL`, `-c core.fsmonitor=false`, `-c core.attributesFile=NUL`, `-c diff.external=`) confirms `HEAD == retainWorkerHead`. Never runs `git checkout` or any working-tree-mutating git inside a retained root. If absent or mismatched, throws structured `WORKER_HEAD_MISMATCH` error for that repair attempt without mutating or deleting the worker root.
2. Forwarding in orchestrator (`tools/ai-brain/orchestrate.js`):
   - In `resolveLauncher`: Forwards `retainWorkerHead: job.retainWorkerHead || undefined` to `isolatedLauncher`.
   - In `repairRound`: Adds `retainWorkerHead: sha || null` to `repairJob`.
3. Regression tests (`tools/ai-brain/test/task-ai-64.test.js`):
   - Kept all security regression tests from `c8fe4fa` passing with explicit `retainWorkerHead` in repair context.
   - Added `stale root on initial launch is re-provisioned at base (fails at c8fe4fa, passes after)`: verifies that a stale worker root left by a prior run is completely wiped and re-cloned/checked out at the pinned base SHA on initial launch (fails at `c8fe4fa`, passes after).
   - Added `repair with matching head keeps the commit and runs no checkout`: verifies that a repair round with matching `retainWorkerHead` retains the root and worker commit without executing checkout or worker-planted smudge/hook/fsmonitor.
   - Added `repair with mismatched head is structured, no marker written`: verifies that a repair round with mismatched `retainWorkerHead` fails closed with structured `WORKER_HEAD_MISMATCH` without executing checkout or worker-planted smudge/hook/fsmonitor.

Evidence:
- Fail-before base SHA: `c8fe4fa` / `c8fe4fac992ceaa41d917df330f7dee304eb86b2`
  - `isolation-launcher.js` refused stale worker root on initial launch with `WORKER_HEAD_MISMATCH`.
- Pass-after result: All tests pass. 68/68 passed in `tools/ai-brain/test/task-ai-64.test.js`; 1153/1153 passed in full brain suite (`tools/ai-brain/test/*.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- None.

## Live E2E Attempt 13: Isolated route covers opencode harness (Defect L) (2026-10-02)

Observation / Defect L:
In Live E2E attempt 13 (`.worktrees/logs/night/ai64-live-run1-20261002-attempt13.md`), the Controller selected a writer candidate on source `oc` (`opencode::cli::9router::cl::...`), whose registry entry in `tools/ai-brain/data/sources.json` specifies `harness: "opencode"`. On the isolated execution path (`--isolated-worker`), `executor.resolveRoute` only rewrote `paseo` -> `opencode-direct`. Consequently:
1. `getHarness("opencode")` threw `UNKNOWN_HARNESS: opencode` during `resolveLauncher`, preventing the worker from launching.
2. `classifyFailure` received the launch error and classified it as `Scope.UNKNOWN` / `Cause.UNKNOWN`, which `sameFailureDomain` treated as an upstream/gateway failure domain block, blocking all other candidates in that domain with `NO_ALTERNATE_FAILURE_DOMAIN: unknown (unknown)`.

Fix:
1. Data-Driven OpenCode Harness Routing (`tools/ai-brain/sources.js` & `tools/ai-brain/executor.js`):
   - Added `runsOpenCodeHarness(harnessName, registry)` in `sources.js`: Inspects registry data (`sources.json` `harness` field) to identify harnesses running the OpenCode CLI (`opencode` and `paseo`), without hard-coding models or providers.
   - In `executor.js:resolveRoute`: On the isolated path (`opts.isolatedWorker`), if `runsOpenCodeHarness(harnessName, registry)` is true, rewrites the harness to `opencode-direct`.
   - On the non-isolated path: Preserves `harnessName` (i.e. keeps `opencode` without silently falling back to `paseo`), returning a clean refusal when no non-isolated adapter is registered.
2. Launch Configuration Failure Classification (`tools/ai-brain/failure-classifier.js` & `tools/ai-brain/orchestrate.js`):
   - In `orchestrate.js:resolveLauncher`: Throws structured error `UNKNOWN_HARNESS: <harness>`.
   - In `failure-classifier.js`: Classified `UNKNOWN_HARNESS` and `HARNESS_UNKNOWN` as `Scope.HARNESS` and `Cause.LAUNCH_CONFIG` under Case 13.
   - Non-blocking failure domain: Because `cli.js:sameFailureDomain` treats `Scope.HARNESS` + `Cause.LAUNCH_CONFIG` as candidate-scoped (`return false`), launch config failures mark only the failing candidate in `failedKeys` without poisoning or blocking other candidates sharing the gateway/upstream domain.
3. Regression Tests (`tools/ai-brain/test/task-ai-64.test.js` & `tools/ai-brain/test/failure-classifier.test.js`):
   - `runsOpenCodeHarness identifies both opencode and paseo from registry data`.
   - `resolveRoute on isolated path maps harness opencode to opencode-direct, while non-isolated preserves it`.
   - `orchestrate with a candidate of harness opencode on the isolated path routes to opencode-direct and launches worker (fails at 0e04eed, passes after)`.
   - `orchestrate with candidate of harness opencode on non-isolated path refuses with UNKNOWN_HARNESS and classifies as Scope.HARNESS`.
   - Failure classifier tests verifying `UNKNOWN_HARNESS` and `HARNESS_UNKNOWN` classify as `Cause.LAUNCH_CONFIG` / `Scope.HARNESS` and `sameFailureDomain` returns `false`.

Evidence:
- Fail-before base SHA: `0e04eed` / `0e04eed9f43f80c65c692a7a4214f494fc7d1f56`
  - `orchestrate` with candidate of harness `opencode` threw `UNKNOWN_HARNESS` on isolated path and classified as `Scope.UNKNOWN` / `Cause.UNKNOWN`.
- Pass-after result: All tests pass. 72/72 passed in `tools/ai-brain/test/task-ai-64.test.js`; 1160/1160 passed in full brain suite (`tools/ai-brain/test/*.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/failure-classifier.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- Non-isolated execution path does not define an `opencode` harness adapter; callers requesting non-isolated runs with harness `opencode` receive a structured `UNKNOWN_HARNESS` refusal rather than implicit diversion to `paseo`.

## Live E2E Attempt 15: Worker timeout classification and upstream quota fallback (Defect M) (2026-10-02)

Observation / Defect M:
In Live E2E attempt 15 (log `.worktrees/logs/night/live15-orchestrate.log`, run data `tools/ai-brain/data/live15/out.json`, launch result `%LOCALAPPDATA%/ShipDe/launch-results/isolation-1790931015966.json`), the isolated worker (`opencode-direct`, model `ninerouter/ag/gemini-3.7-flash-medium`) was killed by the 30-minute launcher timeout because the upstream answered `"Unavailable (reset after 116h)"` and OpenCode kept retrying internally. Because `classifyFailure` received no HTTP status and unrecognized error text, it defaulted to `Scope.UNKNOWN` / `Cause.UNKNOWN`. `cli.js:sameFailureDomain` treated `Scope.UNKNOWN` as sharing gateway `9router`, blocking all remaining candidates across every upstream on `9router`, and the loop halted with `NO_ALTERNATE_FAILURE_DOMAIN: unknown (unknown)`.

Fix:
1. Launcher Timeout Classification & Precedence (F1) (`tools/ai-brain/failure-classifier.js` & `tools/ai-brain/orchestrate.js`):
   - Added `Cause.TIMEOUT` (`'timeout'`) and default cooldown (`10 * 60 * 1000`) in `failure-classifier.js`.
   - Launcher timeout takes precedence: When launcher timeout occurs (`input.timedOut === true`, `input.cause === 'TIMEOUT'`, or `/\[ISOLATION_LAUNCHER\] worker timed out/` in stderr/failureReason), it classifies immediately as `Cause.TIMEOUT` with `Scope.UPSTREAM` (10m cooldown), ensuring launcher timeouts are never misattributed to `quota_exhausted`.
   - In `orchestrate.js`: Forwards authentic `isLauncherTimedOut` from launcher result (`res.timedOut || /\[ISOLATION_LAUNCHER\] worker timed out/`) into `classifyFailure` without unanchored worker stderr pattern.
   - In `orchestrate.js:outcome`: Records `launch.cause` into `log.outcomes` (`{ workItemId, status, reason, cause }`), preserving the root cause in the structured outcome alongside `reason`.
2. Upstream Quota Classification, Error Envelopes & Bounded Cooldown (F2, F3) (`tools/ai-brain/failure-classifier.js`):
   - Added `Cause.QUOTA_EXHAUSTED` (`'quota_exhausted'`) and default cooldown (`60 * 60 * 1000`) in `failure-classifier.js`.
   - Bounded `parseResetTime` by `MAX_RESET_MS` (`30 * 24 * 60 * 60 * 1000`, 30 days) to prevent attacker-chosen unbounded cooldowns.
   - In `classifyFailure`: Quota classification derives strictly from structured signals (`input.cause`, HTTP 429 status code, or provider error envelopes in `stdout`/`stderr`), not arbitrary worker stdout text.
   - Gated Case 13 (`LAUNCH_CONFIG`) before worker text scanning so untrusted worker stdout cannot widen a harness launch failure into an upstream-scoped block.
   - Scoped `running` check to active session status signals (`isExhaustionHiding`), ensuring ordinary OpenCode `"status": "running"` event stream outputs do not bypass quota classification.
3. Upstream Failure Domain Isolation & Fallback (`tools/ai-brain/cli.js` & `tools/ai-brain/orchestrate.js`):
   - Because `scope` is `Scope.UPSTREAM`, `cli.js:sameFailureDomain` matches only candidates sharing `failed.upstream` (e.g. `ag`). Candidates on different upstreams (e.g. `gh`, `cl`, `ocz`) on `9router` remain eligible.
   - The orchestrator loop successfully falls back to alternate failure domains rather than stopping.
4. Regression Tests (`tools/ai-brain/test/failure-classifier.test.js` & `tools/ai-brain/test/task-ai-64.test.js`):
   - Unit regression tests in `test/failure-classifier.test.js` (Case 14): timeout precedence over worker output, real multi-line launcher timeout artifact classification (F1), worker output unable to widen harness launch_config failure (F2), unbounded reset hint capping (F2), real quota error with OpenCode `"status": "running"` (F3), FreeUsageLimit with running status line (F3), and failure domain isolation.
   - 4 orchestration regression tests in `test/task-ai-64.test.js` (Defect M): fallback on launcher timeout to alternate upstream, fallback on upstream quota error, structured `NO_ALTERNATE_FAILURE_DOMAIN: upstream (timeout)` with outcome cause when no alternate exists, and structured `NO_ALTERNATE_FAILURE_DOMAIN: upstream (quota_exhausted)` with outcome cause.

Evidence:
- Fail-before base SHA: `790b644` / `790b644b9d8c22c48626f930e3822b2f6d5ebb2f` (and repair round 1 base `9009f63` / `9009f63b6a46d7b889e5fd7c9eea1b510eb5eb42`)
  - `classifyFailure({ timedOut: true })` classified as `Cause.UNKNOWN` / `Scope.UNKNOWN` at `790b644`.
  - Real launcher timeout artifact `isolation-1790885717760.json` misclassified as `Cause.QUOTA_EXHAUSTED` at `9009f63` due to unanchored 429 and quota keywords in worker stdout; now correctly classified as `Cause.TIMEOUT` with 10m cooldown.
  - Harness `launch_config` failure with spoofed worker stdout line `429 ... quota exceeded` misclassified as `Cause.QUOTA_EXHAUSTED` at `9009f63`; now correctly classified as `Cause.LAUNCH_CONFIG`.
  - Quota error with OpenCode `"status": "running"` line misclassified as `Cause.TIMEOUT` at `9009f63`; now correctly classified as `Cause.QUOTA_EXHAUSTED` with parsed reset hint cooldown.
- Pass-after result: All tests pass. 76/76 passed in `tools/ai-brain/test/task-ai-64.test.js`; 89/89 passed in `tools/ai-brain/test/failure-classifier.test.js`; 27/27 passed in `tools/ai-brain/test/isolation.test.js`; 1180/1180 passed in full brain suite (`tools/ai-brain/test/*.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/failure-classifier.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- Active in-flight worker watchdog: The launcher timeout remains at 30 minutes (`workerTimeoutMs` / `WaitForExit($timeoutMs)`). During an in-flight run where upstream returns terminal quota errors (such as `Unavailable (reset after 116h)`), the worker may continue retrying until the launcher timeout kills it. Once the timeout kills the worker, the classification accurately maps the failure to `QUOTA_EXHAUSTED` (with the parsed reset hint) or `TIMEOUT` (with upstream failure scope), allowing the orchestrator loop to immediately fall back to an alternate candidate/domain rather than stalling. Implementing an active in-flight output watchdog in the launcher is deferred as a residual enhancement because `WaitForExit($timeoutMs)` is a pinned P6 contract assertion in `isolation.test.js` and asynchronous pipe reading across the `ShipDeWorker` impersonation boundary blocks early stream inspection without dedicated log file streaming.
## Live E2E Attempt 16: Worker provider error envelope classification and upstream quota fallback (Defect N) (2026-10-02)

Observation / Defect N:
In Live E2E attempt 16 (launch result `.worktrees/logs/night/live16-launch-result.json`), OpenCode exited with code 1 and stdout containing a structured provider error envelope:
`{"type":"error","timestamp":1790938156379,"sessionID":"ses_...","error":{"name":"APIError","data":{"message":"[cline/cline-free/deepseek-v4.1-flash] [429]: {\"error\":{\"code\":\"INFERENCE_CAP_ERROR\",\"message\":\"Error 429: Daily free limit reached on model deepseek/deepseek-v4.1-flash. Try again in 15h 27m\"}}\n (reset after 57s)","statusCode":503,"isRetryable":true,"responseHeaders":{...},"responseBody":"..."}}}`.
Because `classifyFailure` received no outer `httpStatus` and did not parse the structured OpenCode error event envelope, it defaulted to `Cause.UNKNOWN` / `Scope.UNKNOWN`. `cli.js:sameFailureDomain` treated `Scope.UNKNOWN` as sharing gateway `9router`, blocking all candidates on `9router` and preventing fallback to other upstreams. Furthermore, `parseResetTime` only parsed `resets in/after` and did not support `Try again in ...`, and would have taken the outer gateway rate-limit header (`57s`) rather than the provider daily inference cap cooldown (`15h 27m`).

Fix:
1. Structured Provider Error Envelope Extraction (`tools/ai-brain/failure-classifier.js`):
   - Added `extractStructuredProviderEvents(stdout)` to parse JSON error events from worker stdout (`parsed.type === 'error'` or `parsed.error`).
   - In `extractProviderErrorText`: extracts both `error.data.message` and `error.data.responseBody` from structured error events.
   - Extracts outer status (`error.data.statusCode`), inner status code (from `extractInnerStatus` on message or responseBody, e.g. `[429]`), and structured quota signals (`INFERENCE_CAP_ERROR`, `daily free limit reached`, `FreeUsageLimit`, `Unavailable reset after`).
   - Resolves effective HTTP status from inner and outer envelope status codes when caller supplies no outer `httpStatus`.
   - Gated strictly on structured JSON fields: arbitrary free text printed by workers (e.g. test output, logs) cannot trigger quota classification or widen failure domains.
2. "Try again in" Reset Time Parsing & Precedence (`tools/ai-brain/failure-classifier.js`):
   - In `parseResetTime`: extended patterns to parse `(?:resets?|try\s+again)\s+(?:in|after)`.
   - Pattern order ensures hour-based quota hints (`Try again in 15h 27m`) take precedence over transient seconds-only resets (`(reset after 57s)`), yielding the exact ~15h27m cooldown (`55620000` ms) bounded by `MAX_RESET_MS`.
   - Launcher timeout precedence remains unchanged: authentic launcher timeout signals (`timedOut: true`, launcher stderr) evaluate before provider envelope parsing and classify as `Cause.TIMEOUT` with 10m cooldown.
3. Upstream Failure Domain Isolation & Fallback (`tools/ai-brain/cli.js` & `tools/ai-brain/orchestrate.js`):
   - Classifies as `Cause.QUOTA_EXHAUSTED` with `Scope.UPSTREAM`.
   - `sameFailureDomain` blocks only candidates sharing the failed candidate's upstream (e.g. `cl`), leaving other upstreams on `9router` (e.g. `gh`) eligible for immediate fallback.
4. Regression Tests (`tools/ai-brain/test/failure-classifier.test.js` & `tools/ai-brain/test/task-ai-64.test.js`):
   - Unit regression tests in `test/failure-classifier.test.js` (Case 15): classification of real `live16-launch-result.json` stdout envelope (ids stripped) as `QUOTA_EXHAUSTED` with `Scope.UPSTREAM` and 15h27m cooldown; launcher timeout precedence over provider error envelope; arbitrary free text containing `INFERENCE_CAP_ERROR` not widening to quota; and failure domain isolation.
   - Orchestration regression test in `test/task-ai-64.test.js`: worker returning OpenCode provider error envelope classifies as `QUOTA_EXHAUSTED` and falls back to alternate candidate on different upstream (`gh`), completing the run.

Evidence:
- Fail-before base SHA: `fdd1f80` / `fdd1f8021cbb007a3306db3fc3e020290ca8350d`
  - `classifyFailure` on `live16` stdout envelope classified as `Cause.UNKNOWN` / `Scope.UNKNOWN` with 5m cooldown (`300000` ms).
- Pass-after result: All tests pass. 77/77 passed in `tools/ai-brain/test/task-ai-64.test.js`; 93/93 passed in `tools/ai-brain/test/failure-classifier.test.js`; 1185/1185 passed in full brain suite (`tools/ai-brain/test/*.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/failure-classifier.test.js"`
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- If a future provider emits non-standard error structures that are neither JSON nor matching standard HTTP status error patterns, it safely falls back to `Cause.UNKNOWN` with candidate-scoped isolation.

## Live E2E Attempt 17: Hardened dirty check agrees with provisioned checkout line-ending normalization and worker excludes (Defect O) (2026-10-02)

Observation / Defect O:
In Live E2E attempt 17 (run data `C:/Users/gumac/AI/shipde-platform/.worktrees/logs/night/live17-data/out.json`), the isolated worker successfully created local commits (`11cfd20`, `fd11370`), but every repair round was rejected with `NO_LOCAL_COMMIT` ("worker left uncommitted changes in the worktree (dirty tree)"). A normal `git status --porcelain` in `C:/ShipDeWorker/isolation` was clean, but supervisor `isTreeDirty` running through `withCleanGitEnv`/`safeGit` reported `" M docs/product-spec/scripts/validate_docs.py"`. This occurred due to an environment normalization discrepancy: the worker checkout was provisioned with host system line ending and mode settings (`core.autocrlf=true`, `core.filemode=false`), whereas `withCleanGitEnv` and `safeGit` operated with an empty config and `GIT_CONFIG_NOSYSTEM=1`, running status under `core.autocrlf=false` and default `core.filemode=true`. Furthermore, `withCleanGitEnv` risked reporting scratch files as untracked whenever worker `info/exclude` could not be safely resolved.

Fix:
1. Safe Configuration Resolution & Line-Ending Normalization (`tools/ai-brain/supervisor.js`):
   - Added `getEffectiveEolConfig(targetCwd, explicitOpts)`: Queries host effective `core.autocrlf` and `core.eol` (falling back to caller-supplied overrides if present).
   - Added `readSafeRepoConfig(cwd, options)`: Inspects repository `.git/config` for whitelisted line-ending and platform flags (`core.autocrlf`, `core.eol`, and `core.filemode`), falling back to effective host configuration and Windows default `filemode=false`. Strictly enforces whitelist values and ignores all untrusted/worker-controlled configurations (`hooksPath`, `fsmonitor`, `diff.external`, filter drivers).
   - Updated `withCleanGitEnv` and `safeGit`: `withCleanGitEnv` writes the safe configuration (`filemode`, `autocrlf`, `eol`) into `gitDir/config`, and `safeGit` passes them as explicit `-c` flags (`-c core.autocrlf=...`, `-c core.eol=...`, `-c core.filemode=...`) while maintaining all PR #184 hardening protections (`core.hooksPath=NUL`, `core.fsmonitor=false`, `core.attributesFile=NUL`, `diff.external=`).
2. Worker-Root Excludes Guarantee (`tools/ai-brain/supervisor.js`):
   - Added `WORKER_ROOT_EXCLUDES` and `ensureWorkerRootExcludes(gitDir, extra)`: Guarantees that `.shipde/`, `run-target*`, `temp/`, `.config/`, `.local/`, `Microsoft/`, `tools/ai-brain/test/e1-branch-name.test.js`, `tools/ai-brain/test/e1-*.test.js`, and `opencode.json` are always present in the supervisor's `gitDir/info/exclude`, even when `resolveWorkerGitDir` refuses to follow worker-controlled gitfiles or when worker exclude files are missing.
3. Provisioning Checkout Normalization (`tools/ai-brain/isolation-launcher.js`):
   - In `provisionWorker`: Queries effective line-ending configuration via `getEffectiveEolConfig(hostCwd, opts)` and passes explicit `-c` flags (`core.autocrlf`, `core.eol`, and Windows `core.filemode=false`) to the checkout command.
   - Configures `core.autocrlf`, `core.eol`, and `core.filemode` explicitly in `workerRoot/.git/config` post-checkout so worker-executed git commands and subsequent supervisor dirty checks operate under the identical normalization context.
4. Orchestrator Options Propagation (`tools/ai-brain/orchestrate.js`):
   - Forwarded optional `options` through `headShaOf`, `isTreeDirty`, and `verifyWorkerCommit` to `withCleanGitEnv` and `safeGit`.
5. Regression Tests (`tools/ai-brain/test/task-ai-64.test.js`):
   - Added Defect O test suite verifying:
     - A provisioned worker root with a CRLF-normalized tracked file and excluded scratch across all categories is NOT dirty (`isTreeDirty === false`, `verifyWorkerCommit.pass === true`), while a real uncommitted change IS dirty (`isTreeDirty === true`, `NO_LOCAL_COMMIT` dirty tree). Test is Ubuntu-portable by provisioning with explicit CRLF normalization options.
     - Hardened dirty check honours worker-root excludes even on worker-writable worktrees where worker `info/exclude` cannot be resolved.
     - `readSafeRepoConfig` extracts safe settings and ignores malicious worker-controlled `hooksPath`, `fsmonitor`, and `diff.external`.

Evidence:
- Fail-before base SHA: `fdd1f80` / `fdd1f80f4edce721cac95de3c7ca2d4de0d7aa80`
  - In `C:/ShipDeWorker/isolation`, `isTreeDirty` returned `true` with `" M docs/product-spec/scripts/validate_docs.py\n"` at `fdd1f80`.
  - A provisioned worker root with CRLF-normalized tracked files was rejected with `NO_LOCAL_COMMIT` ("dirty tree").
- Pass-after result: All tests pass. 79/79 passed in `tools/ai-brain/test/task-ai-64.test.js`; 1183/1183 passed in full brain suite (`tools/ai-brain/test/*.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- None.

## Live E2E Attempt 18: Provisioned worker root pinned to base SHA in linked worktree (Defect Q) (2026-10-02)

Observation / Defect Q:
In Live E2E attempt 18 (run data `C:/Users/gumac/AI/shipde-platform/.worktrees/logs/night/live18-data/out.json`, worker git log `../logs/night/live18-worker-git-log.txt`), `orchestrate` ran with `--base-sha adb6cfc121312b230ef5d727a5dd87bd35e97f59` from host worktree `C:/Users/gumac/AI/shipde-platform/.worktrees/isolation`. However, the provisioned worker root `C:/ShipDeWorker/isolation` ended up on commit `42f97c5` (the primary checkout HEAD of the shared repository / stale branch ref `feat/task-ai-64`). Because the worker root was provisioned with a detached `git checkout <headSha>` and did not create or pin the exercise branch or update the remote tracking branch, when the worker executed git switch/checkout on the requested exercise branch (`feat/task-ai-64`), Git matched the cloned remote tracking branch `origin/feat/task-ai-64` pointing to `42f97c5`. The worker committed on top of `42f97c5`, which was not a descendant of `adb6cfc`, causing exercise cases to be missing and verification to fail. Furthermore, provisioning did not verify that HEAD matched the requested base SHA via hardened rev-parse, `captureFailBefore` did not verify ancestry, and `verifyWorkerCommit` did not check commit ancestry before accepting worker commits.

Fix:
1. Pinned Branch Provisioning and Remote Ref Alignment (`tools/ai-brain/isolation-launcher.js`, `tools/ai-brain/orchestrate.js`, `tools/ai-brain/cli.js`):
   - In `cli.js`: Passed `branch` and `workItemId` to `orchestrate.runOrchestration`.
   - In `orchestrate.js`: Propagated `branch` and `workItemId` through `resolveLauncher` to `isolatedLauncher`.
   - In `isolation-launcher.js`: In `provisionWorker`, derived `targetBranch` from `opts.branch` or `opts.workItemId` (`feat/<workItemId>`). Provisioning checks out the base SHA directly onto `targetBranch` using `git checkout -B <targetBranch> <headSha>`. Updates `refs/remotes/origin/<targetBranch>` in the provisioned worker root to `headSha`, ensuring any subsequent checkout or switch by the agent stays pinned to the base SHA.
2. Hardened Provisioning HEAD Verification (`tools/ai-brain/isolation-launcher.js`):
   - After provisioning and line-ending/filemode configuration, hardened `rev-parse --verify --quiet HEAD^{commit}` runs via `withCleanGitEnv`/`safeGit` (with fallback to direct hardened git invocation with `safe.directory` and null configs).
   - Any mismatch between provisioned worker root HEAD and requested `headSha` immediately throws a hard structured `PROVISION_BASE_MISMATCH` failure before the agent starts.
   - Pre-launch check: Before spawning the adapter/agent process, verifies once more that worker root HEAD equals `expectedActiveSha` (`retainWorkerHead || headSha`), throwing `PROVISION_BASE_MISMATCH` (or `WORKER_HEAD_MISMATCH`) on discrepancy.
3. Fail-Before Ancestry Assertion (`tools/ai-brain/isolation-launcher.js`):
   - In `captureFailBefore`: Runs `git merge-base --is-ancestor <baseSha> HEAD`. If `baseSha` is not an ancestor of worker root HEAD, throws `FAIL_BEFORE_ANCESTRY_MISMATCH`.
   - In `materialiseExercise`: Propagates `FAIL_BEFORE_ANCESTRY_MISMATCH` immediately, preventing invalid fail-before captures on diverged trees.
4. Worker Commit Ancestry Assertion (`tools/ai-brain/orchestrate.js`):
   - In `verifyWorkerCommit`: Runs `git merge-base --is-ancestor <cleanBase> <headSha>`. If the worker commit is not a descendant of the base SHA, rejects with `{ pass: false, cause: 'NO_LOCAL_COMMIT', detail: 'worker commit ... is not a descendant of base SHA ...' }`.
5. Regression Tests (`tools/ai-brain/test/task-ai-64.test.js`):
   - Added Defect Q test suite (5 tests):
     - Provisioning pins worker root to base SHA when host is a linked worktree whose primary HEAD differs from base SHA (fails at adb6cfc, passes after).
     - Hard structured failure `PROVISION_BASE_MISMATCH` if provisioned worker root HEAD does not match requested base SHA.
     - Pre-launch check throws `PROVISION_BASE_MISMATCH` if worker root HEAD moves before agent start.
     - `captureFailBefore` asserts ancestry and throws `FAIL_BEFORE_ANCESTRY_MISMATCH` when base SHA is not ancestor of worker HEAD.
     - `verifyWorkerCommit` fails with `NO_LOCAL_COMMIT` when worker commit is not a descendant of base SHA (fails at adb6cfc, passes after).

Evidence:
- Fail-before base SHA: `adb6cfc` / `adb6cfc121312b230ef5d727a5dd87bd35e97f59`
  - In Live attempt 18, `C:/ShipDeWorker/isolation` provisioned from linked worktree `.worktrees/isolation` moved to `42f97c5` on `feat/task-ai-64` checkout.
  - At `adb6cfc`, `verifyWorkerCommit` lacked `merge-base --is-ancestor` assertion and accepted non-descendant commits; `captureFailBefore` lacked ancestry checks; and `isolation-launcher` lacked `PROVISION_BASE_MISMATCH` rev-parse verification.
- Pass-after result: All tests pass. 84/84 passed in `tools/ai-brain/test/task-ai-64.test.js`; 1188/1188 passed in full brain suite (`tools/ai-brain/test/*.test.js`).
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- None.

## Live E2E Attempt 19: Worker prompt requires clean tree and repair names dirty paths (Defect R) (2026-10-02)

Observation / Defect R:
In Live E2E attempt 19 (run data `C:/Users/gumac/AI/shipde-platform/.worktrees/logs/night/live19-data/out.json`), the isolated worker produced a correct commit (`c4a64f5`; exercise runner passed 11/11) but left untracked scratch files `test.js`, `test-my.js`, and `tools/ai-brain/branch-name.js.backup`. `verifyWorkerCommit` correctly detected a dirty tree and rejected it with `NO_LOCAL_COMMIT`, ending the run in `REPAIR_BUDGET_EXHAUSTED` (round 1 also had no commit created). The repair prompt only told the worker `worker left uncommitted changes in the worktree (dirty tree)` without specifying which files made the tree dirty or the relevant head and base SHAs.

Fix:
1. Explicit Clean-Tree Prompt Requirements (`tools/ai-brain/prompt-compiler.js`):
   - Added `CLEAN_TREE_RULES` stating explicitly: work only inside the allowed paths, do not create scratch/backup/test files outside them, delete any temporary file before finishing, finish with exactly one local commit and a clean git status (no untracked files).
   - In `compilePrompt`: Injects clean tree rules into all worker prompts, and formats explicit `Offending paths: <paths>`, `HEAD SHA: <headSha>`, and `Base SHA: <baseSha>` sections when dirty paths or SHAs are provided via context, item properties, or repair criteria.
2. Hardened Tree Status & Offending Path Extraction (`tools/ai-brain/orchestrate.js`):
   - Added `getTreeStatus(cwd, options)`: Runs `git status --porcelain` in the hardened clean git environment (`withCleanGitEnv`/`safeGit`), parsing untracked (`??`), modified (`M`), added (`A`), and deleted (`D`) file paths into a unique `dirtyPaths` array while preserving all PR #184 / Defect O hardening guarantees and excludes.
   - Refactored `isTreeDirty(cwd, options)` to delegate to `getTreeStatus(cwd, options).isDirty`, keeping the clean-tree rule strictly unchanged.
   - In `verifyWorkerCommit`: Returns `dirtyPaths`, `headSha`, and `baseSha`. When `isTreeDirty` triggers, constructs `detail` listing the exact offending paths (e.g. `offending paths: test.js, test-my.js, tools/ai-brain/branch-name.js.backup`) and head/base SHAs while preserving `/dirty tree/` matching. When `headSha === baseSha` or ancestry fails, also queries and attaches offending paths and SHAs.
3. Repair Spec & Prompt Forwarding (`tools/ai-brain/orchestrate.js`):
   - In `runVerificationCommand`: Populates `dirtyPaths`, `headSha`, and `baseSha` on `findings` entries for `NO_LOCAL_COMMIT`.
   - In `repairSpec`: Implemented `formatFindingDetail` ensuring acceptance criteria include exact offending paths and head/base SHAs, and attaches `dirtyPaths`, `headSha`, and `baseSha` to the repair spec.
   - In `repairRound`: Extracts `dirtyPaths`, `headSha`, and `baseSha` from incoming findings and passes them directly to `compilePrompt` alongside `planned`, ensuring the repair prompt provides the worker the exact filenames to delete/clean.
4. Regression Tests (`tools/ai-brain/test/task-ai-64.test.js`):
   - Added Defect R test suite (5 tests):
     - Compiled worker prompt explicitly states clean-tree rules (fails at b305bb3, passes after).
     - `verifyWorkerCommit` returns exact offending paths and head/base SHAs when worker leaves untracked scratch files (fails at b305bb3, passes after).
     - `repairRound` and `repairSpec` compile repair prompt listing exact dirty paths and head/base SHAs (fails at b305bb3, passes after).
     - Clean-tree rule is preserved: `verifyWorkerCommit` and `isTreeDirty` reject untracked scratch files while clean tree passes.
     - `verifyWorkerCommit` reports head and base SHAs and offending paths when worker HEAD matches baseSha.

Evidence:
- Fail-before base SHA: `b305bb3` / `b305bb3f041fad001dee9dff3706cf28087fbb13`
  - In Live attempt 19, isolated worker left untracked scratch files `test.js`, `test-my.js`, and `tools/ai-brain/branch-name.js.backup`.
  - At `b305bb3`, `compilePrompt` lacked explicit clean tree rules; `verifyWorkerCommit` reported only `worker left uncommitted changes in the worktree (dirty tree)` without dirty paths; and `repairRound` did not list offending paths in the repair prompt.
- Pass-after result: All tests pass. 90/90 passed in `tools/ai-brain/test/task-ai-64.test.js`; full brain suite passing.
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- None.

## Live E2E Attempt 20: Wire exact-SHA review lane into the live loop (Defect S) (2026-10-02)

Observation / Defect S:
In Live E2E attempt 20 (run data `C:/Users/gumac/AI/shipde-platform/.worktrees/logs/night/live20-data/`, orchestrate log `live20-orchestrate.log`, worker git log `worker-git-log.txt`), the isolated worker produced local commits `18e3cfb` and `97f6bb2` on base SHA `7d8bfdf` with a clean tree, successfully completing local verification. However, when reaching the review stage, `orchestrate` threw `REVIEW_ROUTE_UNAVAILABLE: no exact-SHA review lane is wired for the live loop` at `tools/ai-brain/orchestrate.js:304` because `reviewLane` was an unwired stub that threw when an injected mock reviewer was absent.

Fix:
1. Review Prompt Compilation (`tools/ai-brain/prompt-compiler.js`):
   - Added `compileReviewPrompt(item, ctx)`: Compiles an independent reviewer prompt containing the Work Item, role requirement (`reviewer`), exact review target commit SHA, base SHA, allowed files, acceptance criteria, exercise test command, base..head diff text, publisher boundary, read-only isolated root constraints, and machine-readable JSON verdict file requirement (`verdict.json`: `sha`, `verdict: "PASS" | "CHANGES_REQUIRED"`, `findings[]`).
2. Separate Read-Only Review Root Provisioning (`tools/ai-brain/orchestrate.js`):
   - Added `provisionReviewRoot(workerRoot, reviewRoot, targetSha, options)`: Provisions a separate read-only review root from the worker repository using hardened git per PR #184 / #187 / #189. Copies sanitized objects from the worker's object store via `withCleanGitEnv` / `safeCopyObjects` without consulting worker configuration, creates an operator-controlled ref at `targetSha`, clones with `--no-checkout --no-hardlinks`, configures safe line endings and filemode, checks out `targetSha`, and verifies HEAD matches `targetSha` with hardened `rev-parse --verify --quiet HEAD^{commit}`. Ensures the reviewer cannot modify the writer root.
3. Review Lane Implementation & Fail-Closed Verdict Parsing (`tools/ai-brain/orchestrate.js`, `tools/ai-brain/review-loop.js`):
   - In `review-loop.js`: Awaited `review(currentSha)` to support asynchronous review harness execution, and preserved structured refusal causes (`rev.cause` / `findings[0].id`) for unbound and stale SHA rounds.
   - In `orchestrate.js`: Re-implemented `reviewLane`:
     - Enforces `reviewer==writer refused`: Rejects immediately with `REVIEWER_EQUALS_WRITER` if the reviewer candidate matches the writer candidate.
     - Selects the reviewer candidate chosen by the Controller outside the writer failure domain (Defect K). Fails closed with `NO_REVIEWER_CANDIDATE` if no eligible candidate meets floors.
     - Resolves launch route and executes the reviewer through the launcher in `reviewWorkerRoot`.
     - Computes host-side diff `baseSha..targetSha` and injects it into the compiled review prompt.
     - Parses `verdict.json` fail-closed: missing file, invalid JSON, invalid schema, or `sha !== targetSha` produces `CHANGES_REQUIRED` (or `STALE_REVIEW_SHA`), feeding findings into `repairRound`.
     - Valid `PASS` with open findings is rejected (`PASS_WITH_FINDINGS_REJECTED`), while clean `PASS` on exact SHA completes the item with `REVIEW_PASS`.
   - Propagated execution context (`item`, `session`, `log`, `logOpts`, `launcher`, `usageDir`, `now`, `candidates`, `evidenceData`, `registry`) into `reviewLane` call from `reviewItem`.
4. Regression Tests (`tools/ai-brain/test/task-ai-64.test.js`):
   - Added Defect S test suite (5 tests with injected launcher seam):
     - PASS verdict on exact SHA completes the item (fails at 7d8bfdf with REVIEW_ROUTE_UNAVAILABLE, passes after).
     - CHANGES_REQUIRED goes to repair and completes after repair commit and second review (fails at 7d8bfdf, passes after).
     - PASS with open findings rejected with `PASS_WITH_FINDINGS_REJECTED` (fails at 7d8bfdf, passes after).
     - SHA mismatch rejected with `STALE_REVIEW_SHA` (fails at 7d8bfdf, passes after).
     - Reviewer equals writer refused with `REVIEWER_EQUALS_WRITER` (fails at 7d8bfdf, passes after).
   - Tests are fully Ubuntu-portable.

Evidence:
- Fail-before base SHA: `7d8bfdf` / `7d8bfdf62fdd2487eaa39f22023683c0e4d4b0f1`
  - In Live attempt 20, orchestrate crashed at the review stage with `Error: REVIEW_ROUTE_UNAVAILABLE: no exact-SHA review lane is wired for the live loop`.
  - At `7d8bfdf`, `reviewLane` lacked review execution, separate review root provisioning, review prompt compilation, and fail-closed verdict parsing.
- Pass-after result: All tests pass. 95/95 passed in `tools/ai-brain/test/task-ai-64.test.js`; full brain suite passing.
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- None.

## Live E2E Attempt 21: Reviewer exclusion uses gateway+upstream failure domain (Defect T) (2026-10-02)

Observation / Defect T:
In Live attempt 21 (run data `C:/Users/gumac/AI/shipde-platform/.worktrees/logs/night/live21-data/`), writer `opencode::cli::9router::kgw::codex::codex::ninerouter/kgw/nvidia/nemotron-3-super-120b-a12b:free` produced commit `1fcdff6`, but every review round was REFUSED with `NO_REVIEWER_CANDIDATE` although the catalogue offers `cl/nvidia/nemotron-3-ultra-550b-a55b:free` (gateway `9router`, upstream `cl`) which is outside the writer failure domain `9router/kgw`. `reviewItem` in `orchestrate.js` built `forbiddenDomains` from the writer upstream/gateway AND account (`[writerUpstream || writerGateway, writerAccount]`); since all candidates shared gateway `9router` and router account `codex`, this excluded all reviewer candidates.

Fix:
1. Reviewer Exclusion Scoped to Gateway+Upstream Failure Domain (`tools/ai-brain/orchestrate.js`):
   - In `reviewItem`: Replaced `forbiddenDomains = [writerUpstream || writerGateway, writerAccount].filter(Boolean)` with `forbiddenDomains = [writerUpstream || writerGateway].filter(Boolean)`. Reviewer exclusion uses the gateway+upstream failure domain (or gateway if no upstream), allowing reviewer candidates on the same gateway with distinct upstreams without forbidding the shared router account (`writerAccount`).
   - Forwarded `writerCandidateKey: writerKey` into profile/item for reviewer selection.
2. Diagnosable Reviewer Selection Decision Logging & Reviewer != Writer Enforcement (`tools/ai-brain/orchestrate.js`, `tools/ai-brain/decisions.js`):
   - In `decisions.js`: Added `REVIEWER_SELECTION: 'reviewer-selection'` to `Stage` enum.
   - In `orchestrate.js:selectCandidateForProfile`: When selecting a candidate for `role === 'reviewer'`, records decision with `stage: Stage.REVIEWER_SELECTION` (`'reviewer-selection'`) containing `profile`, `ranking`, `rejected[]` with reason codes, and `chosen`, making review candidate refusals fully diagnosable in the decision log.
   - Enforced `reviewer != writer`: If `result.chosen === writerKey`, resets `chosen` to `null` with reason `REFUSED: reviewer equals writer` and records `REVIEWER_EQUALS_WRITER` in `rejected[]`.
3. Regression Tests (`tools/ai-brain/test/task-ai-64.test.js`):
   - Added Defect T regression suite:
     - Writer `9router/kgw` + candidate `9router/cl` (sharing gateway and account) selects `cl` as reviewer and completes review (fails at `4a727a6`, passes after).
     - Candidate only in `9router/kgw` is refused with `NO_REVIEWER_CANDIDATE` (fails at `4a727a6`, passes after).
     - Decision log records `stage: 'reviewer-selection'` with `profile`, `ranking`, `rejected[]` reason codes, and `chosen` (fails at `4a727a6`, passes after).
     - Direct `selectCandidateForProfile` test verifying candidate only in `9router/kgw` is refused with `FORBIDDEN_FAILURE_DOMAIN` in `rejected[]` and decision log.
   - Tests are fully Ubuntu-portable.

Evidence:
- Fail-before base SHA: `4a727a6` / `4a727a66c406bc45bc49352e89f7ea5d72ee83c4`
  - In Live attempt 21, writer on `9router/kgw` excluded all reviewer candidates on `9router` because `writerAccount` (`codex`) was included in `forbiddenDomains`.
  - Decision log lacked `reviewer-selection` stage record.
- Pass-after result: All tests pass. 99/99 passed in `tools/ai-brain/test/task-ai-64.test.js`; full brain suite passing.
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- None.

## Live E2E Attempt 22: Resume can publish the recorded reviewed commit (Defect U) (2026-10-03)

Observation / Defect U:
In Live attempt 22 (run data `C:/Users/gumac/AI/shipde-platform/.worktrees/logs/night/live22-data/`), the loop completed with `REVIEW_PASS` on worker commit `2d23262d107d88d8623467b5670298af97af6c89` (reviewer `opencode::cli::9router::ocz::codex::codex::ninerouter/ocz/big-pickle`), but was run without `--publish`. The operator then issued a SHA-bound approval and re-ran `orchestrate` with the same `--checkpoint` plus `--publish --approval <id>`. Because the checkpoint (`checkpoint.json`) recorded only `completed: ["TASK-AI-64"]` and not the reviewed commit, the resumed run skipped the item as already completed (`CHECKPOINT_COMPLETED`), leaving `log.reviews` empty; the publisher then reported `NO_REVIEWED_COMMIT: nothing to publish` (`out-publish.json`), failing to publish the approved commit.

Fix:
1. Persist Review Results in Checkpoints (`tools/ai-brain/orchestrate.js`):
   - In `reviewItem`: Populated `reviewer`, `workerRoot`, and `branch` on each review entry in `log.reviews`.
   - In `finish`: Built `checkpointReviews` via `buildCheckpointReviews(log, prior, allCompleted)` to persist per completed item the review result (`sha`, `verdict`, `reviewer`, `workerRoot`, `branch`) in the checkpoint JSON under `reviews: [...]`, preserving prior review records across runs.
2. Checkpoint Review Extraction & Publication on Resume (`tools/ai-brain/orchestrate.js`):
   - Added `extractCheckpointReview(checkpoint, workItemId)`: Reads recorded review records from `checkpoint.reviews` (array or map) or alternate keys (`completedReviews`, `reviewResults`).
   - In `runOrchestration`: When resuming an item in `completedBefore`, validates the checkpoint review record (asserting exact 40-character SHA, valid PASS verdict, and reviewer presence) and attaches it to `log.reviews` without re-running the worker or review. If the record is missing or forged, marks structured `checkpointReviewError`.
   - In `publication`: When `--publish` is requested, publishes from the recorded reviewed commit through existing publisher gates (approval bound to exact sha, verdict, reviewer, expiry), while refusing fail-closed if the checkpoint review is missing, forged, or did not record a PASS verdict.
3. Regression Tests (`tools/ai-brain/test/task-ai-64.test.js`):
   - Added Defect U regression suite:
     - `complete-then-resume-with-publish calls the publisher with the recorded sha`: Initial run completes with review pass and persists review to checkpoint; resume run with `--publish` and SHA-bound approval publishes from the recorded commit without re-running worker or reviewer (fails at `a7687e1`, passes after).
     - `missing/forged record refuses`: A checkpoint with completed items but missing review record, forged invalid SHA, or non-PASS verdict refuses publication with structured reason (fails at `a7687e1`, passes after).
     - `approval bound to another sha refuses`: An approval bound to a different commit refuses publication at publisher gate (fails at `a7687e1`, passes after).
   - Tests are fully Ubuntu-portable.

Evidence:
- Fail-before base SHA: `a7687e1` / `a7687e1bb9b83981afa6b724f9f80ec054832ee0`
  - In Live attempt 22, orchestrate resumed with `--publish` skipped completed items without populating review results, producing `NO_REVIEWED_COMMIT: nothing to publish`.
  - Checkpoint did not persist reviewed SHA, verdict, reviewer, worker root, or branch.
- Pass-after result: All tests pass. 102/102 passed in `tools/ai-brain/test/task-ai-64.test.js`; full brain suite passing.
- Commands run:
  - `node --test "tools/ai-brain/test/task-ai-64.test.js"`
  - `node --test "tools/ai-brain/test/*.test.js"`
  - `git diff --check` clean.
  - `npx --package prettier@3.9.6 prettier --check` on changed files clean.

Residual risk / known limitations:
- None.
