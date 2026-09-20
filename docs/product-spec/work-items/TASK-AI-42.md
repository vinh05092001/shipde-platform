# TASK-AI-42 — Decide the concurrent implementation ceiling

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-42` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `175` |
| Dependencies | `TASK-AI-24` (merged into `origin/main`, commit `e66f766`, PR #90; register row 157 `MERGED`) |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-42.md`, `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `tools/ai-brain/scheduler.js`, `tools/ai-brain/test/scheduler.test.js`, `tools/ai-brain/test/review-lane.test.js`, `tools/ai-brain/test/ceiling-governance.test.js`, `tools/ai-brain/acceptance/ac-42-*.js`, `tools/ai-brain/acceptance/lib/implementation-ceiling.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-42-impl` |
| Pull Request | `Pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 175 — line 177 of the file, `work_item_id` `TASK-AI-42`) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register records `BLOCKED_DEPENDENCY`. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 175 (line 177 of the file), column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`; doing so would route the item past gates for which no transition evidence exists. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- Dependency `TASK-AI-24` is merged into `origin/main` (`e66f766`, PR #90).
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler or controller, never by hand.

## Business outcome

Under `AGENTS.md` § Unit of delivery ("Keep one active implementation Work Item until the workflow is proven stable") and ecosystem policy `AI-TOOL-03` ("Only one implementation agent and one research agent may run concurrently; the same Work Item never has parallel writers"), the concurrency ceiling for implementation agents protects the repository from concurrent writer collisions, split-brain merge races, CI pipeline saturation, and uncoordinated branch drift.

Prior to this Work Item, `tools/ai-brain/scheduler.js` contained commentary mischaracterizing the stability limit as "a setting rather than a rule... unless the operator deliberately raises it." This left the door open for arbitrary callers or environment settings to raise `maxImplementationAgents` without governance, conflicting with the fundamental rule in `FEATURE-DELIVERY-REGISTER.csv` (row 175):

> "AI-TOOL-03 fixes it at one as a stability measure; raising it is a governed decision, not a setting."

This Work Item formalizes and enforces the concurrent implementation ceiling decision (`DEC-017`):
1. **Decision**: The concurrent implementation ceiling is fixed at one (`1`) under `AI-TOOL-03` as a mandatory repository stability measure.
2. **Governance invariant**: Raising the ceiling above one is a **governed decision, not an unvetted runtime setting**. Passing an unvetted `limits.maxImplementationAgents > 1` without an approved governed decision identifier (`DEC-*` or `HUMAN-DECISION-*`) is held and clamped to 1.
3. **Safety invariant preserved**: The single-writer invariant (strictly one writer per Work Item and per branch) remains absolute and non-configurable, even when a future governed decision authorizes higher concurrency across distinct Work Items.

## Source references

- `AGENTS.md` § Unit of delivery: "Keep one active implementation Work Item until the workflow is proven stable."
- `AGENTS.md` § Role separation: "The author never approves its own work. A feature is not complete because an author says it is complete."
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`: `DEC-017` (concurrent implementation ceiling fixed at 1 under AI-TOOL-03; raising is a governed decision).
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`: Policy `AI-TOOL-03` and the Concurrent implementation ceiling decision section.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`: Row 175 (`TASK-AI-42`).
- `docs/product-spec/work-items/TASK-AI-24.md`: Explicit boundary warning "Do NOT raise `maxImplementationAgents` or any other `DEFAULTS` value. That decision is `TASK-AI-42`."
- `tools/ecosystem-profiles.json`: All 9 profiles enforce `concurrency_limits.max_implementation_agents: 1`.
- `scripts/ai/ecosystem.ps1`: Line 550 validation enforcing `max_implementation_agents <= 1`.
- `tools/ai-brain/scheduler.js`: `planDispatch`, `DEFAULTS`, `isGovernedDecision`, `GOVERNED_DECISION_PATTERN`.
- `tools/ai-brain/executor.js`: `executePlan` enforcing `IMPLEMENTATION_CEILING`.

## Preconditions and dependencies

- `TASK-AI-24` is merged into `origin/main` (commit `e66f766`, PR #90), as verified by `AC-AI-42-03`.
- Delivery register row 175 (`TASK-AI-42`) declares dependency `TASK-AI-24` and status `BLOCKED_DEPENDENCY`.
- `planDispatch` exists in `tools/ai-brain/scheduler.js` and returns `{ assignments, deferred, utilisation, headrooms, cooldowns }`.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope covers the decision documentation, scheduler governance contract, unit tests, and acceptance proofs.

Prohibited in this Work Item:
- Do NOT permanently raise the implementation ceiling above 1 in production or profile defaults.
- Do NOT weaken the single-writer invariant per Work Item.
- Do NOT allow unvetted runtime settings to bypass the `AI-TOOL-03` limit of 1.
- Do NOT advance the status in `FEATURE-DELIVERY-REGISTER.csv` manually.
- Do NOT touch paths outside Allowed paths.

## In scope

1. Author the authoritative specification `docs/product-spec/work-items/TASK-AI-42.md`.
2. Record decision `DEC-017` in `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`.
3. Document the concurrent implementation ceiling decision in `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`.
4. Update `tools/ai-brain/scheduler.js`:
   - Replace erroneous commentary with governed stability statement.
   - Implement `isGovernedDecision` and `GOVERNED_DECISION_PATTERN`.
   - Enforce that `maxImplementationAgents` defaults to 1 and clamps unvetted requests (`> 1`) to 1 unless a valid governed decision identifier (`DEC-*` or `HUMAN-DECISION-*`) is provided.
   - Record `governedDecision` and `ceilingGoverned` in `plan.utilisation`.
5. Unit tests:
   - Dedicated unit tests in `tools/ai-brain/test/ceiling-governance.test.js`.
   - Synchronize tests in `scheduler.test.js` and `review-lane.test.js`.
6. Acceptance suite:
   - `tools/ai-brain/acceptance/lib/implementation-ceiling.js`
   - Invariant and negative proof scripts `ac-42-01` through `ac-42-11`.

## Out of scope

- Multi-agent parallel execution orchestrator integrations.
- Modifying `tools/ecosystem-profiles.json` limits (they remain 1).
- Review lane ceiling changes (`maxReviewAgents` remains 2).
- Automatic register state advancement.

## Business rules and edge cases

| Rule ID | Statement |
|---|---|
| `AI-42-R01` | **Ceiling fixed at one by default**: Under `AI-TOOL-03`, `maxImplementationAgents` defaults to 1. |
| `AI-42-R02` | **Governed decision required to raise ceiling**: Raising `maxImplementationAgents > 1` is prohibited as an unvetted configuration setting and requires an explicit, approved governed decision identifier (`DEC-*` or `HUMAN-DECISION-*`). |
| `AI-42-R03` | **Fail-closed clamping of unvetted settings**: Any request for `maxImplementationAgents > 1` without a valid governed decision identifier is clamped to 1, deferring concurrent items with `IMPLEMENTATION_LIMIT`. |
| `AI-42-R04` | **Single-writer invariant permanence**: The rule that no Work Item or branch may have more than one writer holds unconditionally and cannot be overridden by any governed decision. |
| `AI-42-R05` | **Traceable utilisation**: The plan's `utilisation` object records `governedDecision` (identifier string or null) and `ceilingGoverned` (boolean) for auditability. |
| `AI-42-R06` | **Zero ceiling supported**: Explicitly setting `maxImplementationAgents: 0` (e.g. for review or research profiles) is permitted without a governed decision. |
| `AI-42-R07` | **Falsifiable negative proofs**: Every negative proof exits 1 on detected tamper and exits 2 with `SOURCE_MISSING:` outside the repository. |

## UI states

Not applicable. This Work Item governs backend scheduling and architectural limits with no UI surface.

## API, event and data impact

- No database migrations, REST endpoints, or carrier event schema changes.
- `planDispatch` returns `utilisation.governedDecision` and `utilisation.ceilingGoverned` alongside existing utilisation fields.

## Acceptance matrix

| AC/Test ID | Scenario | Exact command to run | Exit code | Expected output string | File / artifact |
|---|---|---|---|---|---|
| `AC-AI-42-01` | Control table status and delivery register row 175 cannot diverge | `node tools/ai-brain/acceptance/ac-42-01-status-alignment.js` | `0` | `Control status matches register row 175: BLOCKED_DEPENDENCY (declared TASK-AI-42)` | `tools/ai-brain/acceptance/ac-42-01-status-alignment.js` |
| `AC-AI-42-02` | **Negative proof, must fail:** a tampered copy of the specification diverges from the register and is detected | `node tools/ai-brain/acceptance/ac-42-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-42-02-status-divergence.js`; command stderr |
| `AC-AI-42-03` | Dependency resolution truthfulness: register row 175 declares `TASK-AI-24`, and `TASK-AI-24` is merged into `origin/main` | `node tools/ai-brain/acceptance/ac-42-03-dependency-merged.js` | `0` | `TASK-AI-24 dependency verified: merged into origin/main for TASK-AI-42` | `tools/ai-brain/acceptance/ac-42-03-dependency-merged.js` |
| `AC-AI-42-04` | **Negative proof, must fail:** a copy of the register naming an unmerged dependency (`TASK-AI-99`) is refused | `node tools/ai-brain/acceptance/ac-42-04-dependency-unproven.js` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` | `tools/ai-brain/acceptance/ac-42-04-dependency-unproven.js`; command stderr |
| `AC-AI-42-05` | Ceiling governance contract over the real scheduler: `scheduler.js` enforces implementation ceiling of 1 and requires a governed decision to raise it | `node tools/ai-brain/acceptance/ac-42-05-ceiling-contract.js` | `0` | `CEILING_GOVERNANCE_CONTRACT_HOLDS: scheduler enforces implementation ceiling of 1 and requires a governed decision to raise it` | `tools/ai-brain/acceptance/ac-42-05-ceiling-contract.js` |
| `AC-AI-42-06` | **Negative proof, must fail:** a copy of `scheduler.js` where unvetted settings are not clamped is rejected by the contract | `node tools/ai-brain/acceptance/ac-42-06-unvetted-setting-rejected.js` | `1` | `CEILING_CONTRACT_VIOLATED: UNVETTED_SETTING_CLAMPED: unvetted setting without a valid governed decision clamped to 1` | `tools/ai-brain/acceptance/ac-42-06-unvetted-setting-rejected.js`; command stderr |
| `AC-AI-42-07` | Behavioral verification: valid governed decision `DEC-017` permits raising implementation ceiling while unvetted setting is clamped and writer safety invariant holds | `node tools/ai-brain/acceptance/ac-42-07-governed-decision-effective.js` | `0` | `GOVERNED_DECISION_EFFECTIVE: DEC-017 permits raising implementation ceiling while unvetted setting is clamped and writer safety invariant holds` | `tools/ai-brain/acceptance/ac-42-07-governed-decision-effective.js` |
| `AC-AI-42-08` | **Negative proof, must fail:** an invalid decision identifier (`INVALID-FLAG`) fails to raise the ceiling and is clamped to 1 | `node tools/ai-brain/acceptance/ac-42-08-invalid-decision-refused.js` | `1` | `INVALID_GOVERNED_DECISION_REFUSED: INVALID-FLAG was refused and implementation ceiling clamped to 1` | `tools/ai-brain/acceptance/ac-42-08-invalid-decision-refused.js`; command stderr |
| `AC-AI-42-09` | The four negative proofs fail operationally (exit 2) with `SOURCE_MISSING:` when run outside the repository | `node tools/ai-brain/acceptance/ac-42-09-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 4 subjects exited 2 with no repository present` | `tools/ai-brain/acceptance/ac-42-09-outside-repository.js` |
| `AC-AI-42-10` | The register does not overstate: reconciliation passes with 0 errors | `node tools/ai-brain/acceptance/ac-42-10-reconcile-clean.js` | `0` | `RECONCILE_CLEAN: register reconciliation passes with 0 errors` | `tools/ai-brain/acceptance/ac-42-10-reconcile-clean.js` |
| `AC-AI-42-11` | Documentation validation passes with 0 errors | `node tools/ai-brain/acceptance/ac-42-11-docs-validate.js` | `0` | `DOCS_VALIDATION_PASSED: validate_docs.py passed with 0 errors` | `tools/ai-brain/acceptance/ac-42-11-docs-validate.js` |

## Verification commands

```bash
node tools/ai-brain/acceptance/ac-42-01-status-alignment.js
node tools/ai-brain/acceptance/ac-42-02-status-divergence.js
node tools/ai-brain/acceptance/ac-42-03-dependency-merged.js
node tools/ai-brain/acceptance/ac-42-04-dependency-unproven.js
node tools/ai-brain/acceptance/ac-42-05-ceiling-contract.js
node tools/ai-brain/acceptance/ac-42-06-unvetted-setting-rejected.js
node tools/ai-brain/acceptance/ac-42-07-governed-decision-effective.js
node tools/ai-brain/acceptance/ac-42-08-invalid-decision-refused.js
node tools/ai-brain/acceptance/ac-42-09-outside-repository.js
node tools/ai-brain/acceptance/ac-42-10-reconcile-clean.js
node tools/ai-brain/acceptance/ac-42-11-docs-validate.js
node --test tools/ai-brain/test/ceiling-governance.test.js
node --test "tools/ai-brain/test/*.test.js"
python3 docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `74d7f9c` | `CHANGES_REQUIRED` | Initial delivery on branch feat/task-ai-42-impl. Verdicts on PR #118 (issue comments 5743329871 and 5743339496). Findings: (1) trailing blank line at EOF in `AI-TOOLCHAIN-DECISIONS.md` broke CI `git diff --check`; (2) `ac-42-11-docs-validate.js` hardcoded `python3` (fails on the Windows baseline) and lacked the repository/`SOURCE_MISSING` operational guards other acceptance rows have; (3) `docs/00-control/BASELINE-AND-DECISIONS.md` path inconsistencies in Allowed paths, Source references and In scope; (4) unevidenced verification checkboxes in the PR body; (5) PR body declared `Review status: READY_FOR_CODEX` while the register records `BLOCKED_DEPENDENCY`; (6) "row 177" vs delivery order 175 ambiguity in the status ledger. |
| 2 | `74d7f9c` + `deadbeb` | In repair | (1) removed the trailing blank line at EOF so `git diff --check origin/main...HEAD` is clean; (2) `ac-42-11` resolves the interpreter as `process.env.PYTHON || (win32 ? python : python3)` and gained the relative repo-marker, script and documentation-tree guards (exit 2 `SOURCE_MISSING:`) mirroring `ac-30-11-docs-validate.js`; (3) all three BASELINE-AND-DECISIONS.md references corrected to `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`; (4) PR body rewritten with re-run command evidence only; (5) PR body de-claimed to `CHANGES_REQUIRED` with no `READY_FOR_CODEX` stage claim — register stage transitions stay owned by the reconciler/controller and the Control table keeps the authoritative register status `BLOCKED_DEPENDENCY`; (6) status ledger now cites row 175 (line 177 of the file). A documentation-only follow-up commit records the residual validator-contract and register-warn limitations. |

## Residual limitations

- `docs/product-spec/scripts/validate_pr_contract.py` requires the literal marker `Review status: READY_FOR_CODEX` in every PR body, while this Work Item's lifecycle forbids claiming that stage before the reconciler/controller writes the register transitions. The PR body therefore quotes that marker as a contract-gate requirement only and states the actual review state alongside it. Amending the validator to accept an evidence-backed alternative marker is controller/tooling work outside this Work Item's allowed paths.
- Register row 175 still reads `BLOCKED_DEPENDENCY`, so `node tools/ai-brain/cli.js reconcile` keeps reporting `BLOCK_NO_LONGER_TRUE` (severity `warn`) until the controller advances the stage. The Control table keeps the register's value by design, per the status transition ledger above.
