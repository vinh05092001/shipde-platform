# TASK-AI-10 - Permission allowlist and security hardening

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-10`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Status          | `BLOCKED_DEPENDENCY`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Delivery order  | `143`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Dependencies    | `TASK-AI-09` (merged into `origin/main`; register row 142 not yet reconciled to `MERGED`)                                                                                                                                                                                                                                                                                                                                                                                       |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Risk            | `HIGH`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Allowed paths   | `docs/product-spec/work-items/TASK-AI-10.md`, `scripts/ai/control.ps1`, `tools/ecosystem-profiles.json`, `tools/ai-guard/**`, `tools/ai-brain/**`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-10-*.js`, `tools/ai-brain/acceptance/lib/permission-allowlist.js` |
| Reviewer        | `Codex - fresh independent task`                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Branch          | `spec/task-ai-10`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Pull Request    | `Pending`                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 143) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed?          | Transition evidence                                                                                   |
| ------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `BACKLOG`                 | No                  | None. The register never moved this row out of the dependency block, so it has not reached `BACKLOG`. |
| `BLOCKED_DEPENDENCY`      | Yes - current stage | `FEATURE-DELIVERY-REGISTER.csv` row 143, column `status` = `BLOCKED_DEPENDENCY`                       |
| `READY_FOR_AUTHOR`        | No                  | None. No register write has occurred.                                                                 |
| `IN_PROGRESS`             | No                  | None. No register write has occurred.                                                                 |
| `READY_FOR_CODEX`         | No                  | None. No register write has occurred.                                                                 |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`; doing so would route the item past gates for which no transition evidence exists. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency is satisfied in Git reality but not yet recorded: `TASK-AI-09`'s specification is merged into `origin/main` at `913284740f74e8e4ff096f2d4af4a321b01a11e3` (PR #70), while register row 142 still reads `BLOCKED_DEPENDENCY`. `AC-AI-10-03` proves this from the repository rather than from the register.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler before this item is stage-eligible for review routing.
- `AC-AI-10-01` mechanically compares the `Status` cell of the Control table above against row 143 of the register and fails if they diverge, guaranteeing the two sources cannot silently disagree.

## Business outcome

The deterministic supervisor built by `TASK-AI-06` and extended by `TASK-AI-07`, `TASK-AI-08` and `TASK-AI-09` now plans, repairs, recovers and restarts without a human in the loop. What it does not yet have is a written, testable statement of what that unattended process is permitted to do. `AI-TOOLCHAIN-DECISIONS.md` already declares the boundary in prose - a "Permission boundaries (TASK-AI-10+)" section that lists six routine operations and six explicitly denied ones - but the declaration is advisory: nothing consults it, and nothing fails when an operation crosses it.

`TASK-AI-10` turns that declaration into an enforced, least-privilege allowlist. The load-bearing half is the deny list:

1. **Auto-merge any Pull Request** - merge authority stays with the human and with the exact-HEAD preflight of `TASK-AI-13`, never with an unattended default.
2. **Force-push or rewrite history** - a pushed head may only advance; rewriting the branch an exact-HEAD review already read would forge the review evidence the gate rests on.
3. **Delete branches or worktrees destructively** - an operator removal is a decision; the supervisor reports it fail-closed instead of undoing it.
4. **Bypass CI or review gates** - no shortcut may present an unreviewed commit as reviewed.
5. **Broad unrestricted shell access** - routine operations run through fixed commands with bounded output; client input is never interpolated into a shell.
6. **Install, remove, or upgrade machine tools** - the toolchain is governed by the ecosystem manifest, not by an unattended run.

The allow half - read repository state, run lint/typecheck/test, create commits and push to feature branches, create and update Pull Requests, inspect CI status and review comments, and send messages to AO sessions - exists so the deny half cannot be read as "do nothing".

The outcome is falsifiable from the repository alone: the boundary is declared in one authority and complete, a removed deny entry is reported as a violation, and the surrounding delivery gates stay green.

## Source references

- `AGENTS.md` - Role separation: the author never approves its own work; the human is the merge owner.
- `AGENTS.md` - Unit of delivery: one branch and one Pull Request per Work Item; the required status flow through `READY_FOR_CODEX`.
- `AGENTS.md` - 9Router request policy: logging, Ponytail, Caveman and Headroom stay disabled; no router optimization may alter the Work Item.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` - "Permission boundaries (TASK-AI-10+)": the allowed and denied operations this Work Item enforces.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` - `AI-SUP-21`: durable review evidence is accepted only from the allowlisted Codex GitHub App identity `chatgpt-codex-connector[bot]`.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` - Human gates and the unattended supervisor mode the allowlist governs.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` - row 143 (`TASK-AI-10`) and row 142 (`TASK-AI-09`).
- `docs/product-spec/work-items/TASK-AI-06.md` - Out of scope: "Permission allowlist enforcement (TASK-AI-10)"; the supervisor the allowlist bounds.
- `docs/product-spec/work-items/TASK-AI-07.md`, `TASK-AI-08.md`, `TASK-AI-09.md` - Out of scope entries that defer fine-grained permission allowlists to this Work Item.
- `docs/product-spec/work-items/TASK-AI-13.md` - `AI-MERGE-04`: only `chatgpt-codex-connector[bot]` is a trusted reviewer; nothing extends the allowlist.
- `scripts/ai/control.ps1` - `$script:TrustedCodexReviewerLogins`, `Assert-ShipDeReviewTarget`, `Assert-ShipDeSupervisorLock`, the force-push detection in the reconciliation transition, and `Invoke-ShipDeAutoMerge` (the governed, preflight-bound merge).
- `tools/ecosystem-profiles.json` - the nine activation profiles carrying the minimum safe toolset (`allowed_tools`), a per-profile least-privilege `network_policy` (`localhost-only`, `localhost-only-strict-carrier-mock`, `air-gapped-preferred-no-leakage`, `local-scan-only`, `read-only-localhost`, `github-api-and-localhost-only`, or `local-and-registry-only`, never unrestricted) and concurrency limits.
- `tools/ai-guard/` - the writer-claim and secret-surface guards already enforcing part of the boundary.
- `tools/ai-brain/acceptance/lib/permission-allowlist.js` - the single definition of the boundary this Work Item's rows exercise.

## Preconditions and dependencies

- Prerequisite `TASK-AI-09` (Full checkpoint persistence and restart recovery) is declared on `origin/main` at `913284740f74e8e4ff096f2d4af4a321b01a11e3` (PR #70). `AC-AI-10-03` proves this from the repository rather than from the register.
- Delivery register alignment: `FEATURE-DELIVERY-REGISTER.csv` row 143 records `status: "BLOCKED_DEPENDENCY"`. The Control table records `BLOCKED_DEPENDENCY` exactly.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` carries the "Permission boundaries (TASK-AI-10+)" section with six allowed and six denied operations. `AC-AI-10-05` asserts this directly.
- A local Node.js runtime for the acceptance scripts. No network access and no credential are required.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Although the Control table's Allowed paths already name `scripts/ai/control.ps1`, `tools/ecosystem-profiles.json` and `tools/ai-guard/**` — because those are the eventual enforcement points this Work Item's rule module must bind to — this particular pull request changes zero application code: it authors only the specification (`TASK-AI-10.md`) and the acceptance harness (`tools/ai-brain/acceptance/ac-10-*.js`, `tools/ai-brain/acceptance/lib/permission-allowlist.js`) that prove the boundary from the repository as it stands today. `git show --stat` on this PR's commit shows exactly one markdown file and the acceptance scripts; no diff touches `control.ps1`, `ecosystem-profiles.json` or `tools/ai-guard/`.

Implementation of the enforced allowlist — actually editing `control.ps1`, `ecosystem-profiles.json` and `tools/ai-guard/` to consult `lib/permission-allowlist.js` at runtime — is a subsequent task by `GEMINI`, using the same three paths already declared above:

- `scripts/ai/control.ps1` (the enforcement point every routine operation passes through)
- `tools/ecosystem-profiles.json` (the activation-time tool subsets)
- `tools/ai-guard/` (the commit-time guards)

Prohibited in this Work Item:

- Do NOT weaken the deny list to make a check pass; a removed or reworded deny entry must make `AC-AI-10-06` red.
- Do NOT auto-merge, force-push, rewrite history, destructively delete a branch or worktree, bypass CI/review, open broad shell access, or install/remove/upgrade machine tools.
- Do NOT carry a second copy of the boundary; the rule lives once in `tools/ai-brain/acceptance/lib/permission-allowlist.js`.
- Do NOT touch `.github/`, `scripts/verify-*`, or `docs/product-spec/scripts/`.
- Do NOT advance the status in `FEATURE-DELIVERY-REGISTER.csv` manually.
- Do NOT feed outcomes back into `qualifiedRoles` (`TASK-AI-25`) or change quota, fitness or cooldown rules (`TASK-AI-26`, `TASK-AI-27`, `TASK-AI-28`).

## In scope

1. **One enforced boundary, one authority.** The supervisor's routine operations are bounded by the declared allowlist in `AI-TOOLCHAIN-DECISIONS.md` "Permission boundaries (TASK-AI-10+)"; an operation outside the allowlist is denied by default, fail-closed, not warned and continued.
2. **The six routine operations stay allowed**: read files and repository state; run lint, typecheck and test commands; create commits and push to feature branches; create and update Pull Requests; inspect CI status and review comments; send messages to AO sessions.
3. **The six operations stay denied**: auto-merge any Pull Request; force-push or rewrite history; delete branches or worktrees destructively; bypass CI or review gates; broad unrestricted shell access; install, remove or upgrade machine tools.
4. **Activation-time least privilege.** Each activation profile in `tools/ecosystem-profiles.json` carries only the tools its activity needs (`allowed_tools`), a per-profile least-privilege `network_policy` (not always literally `localhost-only`; see the seven distinct values in `tools/ecosystem-profiles.json`), and the concurrency ceiling.
5. **Reviewer-identity allowlist preserved.** Durable review evidence is admitted only from `chatgpt-codex-connector[bot]` (`AI-SUP-21`, `AI-MERGE-04`); no configuration, environment variable or actor extends that allowlist.
6. **Deterministic self-tests** covering the boundary: every allowed operation passes, every denied operation is refused, and an operation the allowlist does not name is denied by default.
7. **Acceptance rows** that assert the boundary is declared and complete, that a removed deny entry is reported, and that every negative proof fails closed (exit 2) when it cannot detect.

## Out of scope

- Cross-harness worker replacement (`TASK-AI-07`), CI/review repair budgeting (`TASK-AI-08`), checkpoint restart recovery (`TASK-AI-09`).
- Preview/DryRun modes and the comprehensive failover test matrix (`TASK-AI-11`).
- Windows Task Scheduler automation (`TASK-AI-12`), governed auto-merge (`TASK-AI-13`).
- Quota, fitness, cooldown or capability rules (`TASK-AI-26`, `TASK-AI-27`, `TASK-AI-28`).
- The product application's own permission model (auth/tenancy/RBAC); this Work Item governs the delivery pipeline, not the shipped product.

## Business rules and edge cases

| Rule        | Behavior                                                                                                                                                                                                                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI-10-R01` | **Deny by default.** An operation not on the allowed list is refused fail-closed. The allowlist is explicit; there is no "unspecified but harmless" category.                                                                                                                                                                      |
| `AI-10-R02` | **The deny list is load-bearing.** Each of the six denied operations is named, and removing one from the boundary is a violation reported by `AC-AI-10-06`, never a silent widening.                                                                                                                                               |
| `AI-10-R03` | **Denial is enforcement, not advice.** A denied operation stops the run with a diagnostic naming the operation; it is never logged as a warning and continued.                                                                                                                                                                     |
| `AI-10-R04` | **One authority.** The boundary is declared once in `AI-TOOLCHAIN-DECISIONS.md` and read by the enforcement point. A second, private copy of the allow/deny list is prohibited.                                                                                                                                                    |
| `AI-10-R05` | **Least privilege at activation.** Each profile in `tools/ecosystem-profiles.json` carries only the tools its activity needs, a per-profile least-privilege `network_policy` (not always literally `localhost-only`; see the seven distinct values in `tools/ecosystem-profiles.json`), and the concurrency ceiling.                                                                                                                                      |
| `AI-10-R06` | **Reviewer identity is part of the boundary.** Only `chatgpt-codex-connector[bot]` is trusted for durable review evidence; non-allowlisted review-shaped text is untrusted (`AI-SUP-21`).                                                                                                                                          |
| `AI-10-R07` | **Fixed commands, bounded output.** Routine operations run through fixed executable/argument construction with explicit timeouts; client or model input is never interpolated into a shell command.                                                                                                                                |
| `AI-10-R08` | **No vacuous verification.** Every acceptance row reads a real file or real repository state. No row compares two string literals written into its own command, no row asserts through `node --test --test-name-pattern` (which exits 0 when the pattern matches nothing), and no count that drifts with the repository is pinned. |

## UI states

Not applicable; this Work Item has no user-facing screen. The supervisor reports permission outcomes in its terminal log:

- **Allowed operation**: proceeds; no extra log line.
- **Denied operation (fail-closed)**: prints `[BLOCKED] Permission denied: {operation}` and stops.
- **Unknown operation (deny by default)**: prints `[BLOCKED] Permission denied: {operation} is not on the allowlist` and stops.
- **Non-allowlisted reviewer**: the review-shaped text is ignored as untrusted rather than posted or counted.

## API, event and data impact

No database schema, migration or runtime REST API change. The Work Item defines an enforcement surface and the boundary it reads:

- The supervisor consults one allowlist derived from `AI-TOOLCHAIN-DECISIONS.md` "Permission boundaries (TASK-AI-10+)" before every routine operation.
- `tools/ecosystem-profiles.json` remains the activation-time tool-subset source; its `allowed_tools`, `network_policy` and `concurrency_limits` fields are unchanged in shape.
- The reviewer-identity allowlist (`chatgpt-codex-connector[bot]`) is unchanged.

## Acceptance matrix

| AC/Test ID    | Scenario                                                                                                                                                   | Exact command to run                                             | Exit code | Expected output string                                                                      | File / artifact                                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC-AI-10-01` | Control table status and delivery register row 143 cannot diverge                                                                                          | `node tools/ai-brain/acceptance/ac-10-01-status-alignment.js`    | `0`       | `Control status matches register row 143: BLOCKED_DEPENDENCY (declared TASK-AI-10)`         | `docs/product-spec/work-items/TASK-AI-10.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-10-01-status-alignment.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js` |
| `AC-AI-10-02` | **Negative proof, must fail:** a tampered copy of the real specification diverges from the real register, and the comparison `AC-AI-10-01` runs detects it | `node tools/ai-brain/acceptance/ac-10-02-status-divergence.js`   | `1`       | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-10-02-status-divergence.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js`; command stderr                                                                                                          |
| `AC-AI-10-03` | Dependency resolution truthfulness: register row 143 declares `TASK-AI-09`, and `TASK-AI-09` is named by a commit reachable on `origin/main`               | `node tools/ai-brain/acceptance/ac-10-03-dependency-merged.js`   | `0`       | `TASK-AI-09 dependency verified: merged into origin/main for TASK-AI-10`                    | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-10-03-dependency-merged.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js`                                                  |
| `AC-AI-10-04` | **Negative proof, must fail:** a copy of the real register that names a dependency with no merge commit is refused by the same rule `AC-AI-10-03` runs     | `node tools/ai-brain/acceptance/ac-10-04-dependency-unproven.js` | `1`       | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main`              | `tools/ai-brain/acceptance/ac-10-04-dependency-unproven.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js`; command stderr                                                                                                            |
| `AC-AI-10-05` | The permission boundary is declared, complete, and in one authority                                                                                        | `node tools/ai-brain/acceptance/ac-10-05-allowlist-contract.js`  | `0`       | `ALLOWLIST_BOUNDARY_HOLDS: 6 allowed and 6 denied operations declared, none missing`        | `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `tools/ai-brain/acceptance/ac-10-05-allowlist-contract.js`, `tools/ai-brain/acceptance/lib/permission-allowlist.js`                                                  |
| `AC-AI-10-06` | **Negative proof, must fail:** a copy of the decisions document with one denied operation removed is rejected by the same rule `AC-AI-10-05` runs          | `node tools/ai-brain/acceptance/ac-10-06-allowlist-broken.js`    | `1`       | `ALLOWLIST_BOUNDARY_BROKEN: DENIED_OP_MISSING: Auto-merge any Pull Request`                 | `tools/ai-brain/acceptance/ac-10-06-allowlist-broken.js`, `tools/ai-brain/acceptance/lib/permission-allowlist.js`; command stderr                                                                                                            |
| `AC-AI-10-07` | Toolchain suite invariant green with 0 failures                                                                                                            | `node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js`     | `0`       | `AC-AI-08-07 suite invariant held: fail 0`                                                  | `tools/ai-brain/acceptance/ac-08-07-suite-invariant.js`; test runner stdout                                                                                                                                                                  |
| `AC-AI-10-08` | Delivery register reconciliation green with 0 errors                                                                                                       | `node tools/ai-brain/cli.js reconcile`                           | `0`       | `Tổng: 0 lỗi`                                                                               | `tools/ai-brain/cli.js` stdout                                                                                                                                                                                                               |
| `AC-AI-10-09` | Specification and documentation validation passes                                                                                                          | `python docs/product-spec/scripts/validate_docs.py`              | `0`       | `Documentation validation passed:`                                                          | `docs/product-spec/scripts/validate_docs.py` stdout                                                                                                                                                                                          |
| `AC-AI-10-10` | Secret surface guard reports no leakable secret                                                                                                            | `node tools/ai-guard/cli.js secret-surface`                      | `0`       | `SECRET_SURFACE_CLEAN`                                                                      | `tools/ai-guard/cli.js` stdout                                                                                                                                                                                                               |
| `AC-AI-10-11` | The three negative proofs fail closed (exit 2), not as findings, when their source is absent                                                               | `node tools/ai-brain/acceptance/ac-10-14-fail-closed-guards.js`  | `0`       | `FAIL_CLOSED_GUARDS: 3 negative proofs carry the SOURCE_MISSING guard`                      | `tools/ai-brain/acceptance/ac-10-14-fail-closed-guards.js`; command stdout                                                                                                                                                                   |

### Evidence notes for the invariant rows

`AC-AI-10-07`, `-08`, `-09` and `-10` assert invariants (`fail 0`, `0 lỗi`, a passing validator), never exact totals, because this Work Item itself adds a markdown specification file and seven acceptance scripts, so any pinned count is stale on arrival. The counts below are recorded as evidence of the observed baseline only.

| Row           | Asserted invariant                                                      | Observed baseline (evidence only, not asserted)                                                 |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `AC-AI-10-07` | `fail 0` in the test runner summary, with `tests > 0` and `suites > 0`  | `641` tests at the time of writing                                                              |
| `AC-AI-10-08` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js reconcile`               | `178` delivery register rows at the time of writing                                             |
| `AC-AI-10-09` | `Documentation validation passed:` from `validate_docs.py`              | `102` markdown files, `130` feature IDs, `178` delivery rows at the pre-implementation baseline |
| `AC-AI-10-10` | `SECRET_SURFACE_CLEAN` from `node tools/ai-guard/cli.js secret-surface` | `321` files scanned at the time of writing                                                      |

`AC-AI-10-07` runs the suite-invariant script already committed by `TASK-AI-08` rather than restating the rule in another private copy.

### Why each negative proof is not vacuous

| Row           | Negative proof of               | CONTROL (real input accepted)                                                 | Tamper (in-memory copy)                              | Rejection                              |
| ------------- | ------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------- |
| `AC-AI-10-02` | status alignment `AC-AI-10-01`  | real `TASK-AI-10.md` agrees with real register row 143                        | `Status` cell flipped to `READY_FOR_AUTHOR`          | `STATUS_DIVERGENCE_DETECTED`, exit `1` |
| `AC-AI-10-04` | dependency proof `AC-AI-10-03`  | real declared dependency `TASK-AI-09` has a commit naming it on `origin/main` | `dependencies` cell repointed to `TASK-AI-99`        | `DEPENDENCY_UNPROVEN`, exit `1`        |
| `AC-AI-10-06` | boundary contract `AC-AI-10-05` | real decisions document carries all six denied operations                     | the `Auto-merge any Pull Request` deny entry removed | `ALLOWLIST_BOUNDARY_BROKEN`, exit `1`  |

Each negative proof reads a **real** repository file, proves the untouched source is accepted as a CONTROL, tampers an **in-memory copy** (nothing is written to disk), and asserts the same shared rule rejects the copy. Each exits `2`, never `0`, when it cannot detect its tamper, and exits `2`, never `1`, when its real source is missing; `AC-AI-10-11` verifies the fail-closed guard in every subject.

### One rule, one module

`AC-AI-10-05` (the invariant) and `AC-AI-10-06` (its negative proof) exercise the same rule - "the permission boundary is declared, complete, and the deny list cannot be silently narrowed". The rule is defined once, in `tools/ai-brain/acceptance/lib/permission-allowlist.js`, and both scripts require it, so editing the rule changes the gate and the proof of the gate together. The status pair reuses `lib/spec-status-alignment.js` and the dependency pair reuses `lib/dependency-merged.js`, the same modules the other Work Items share.

## Verification commands

```bash
# 1. Control-table / register alignment for TASK-AI-10
node tools/ai-brain/acceptance/ac-10-01-status-alignment.js

# 2. Negative proof: a tampered specification copy diverges and is detected
node tools/ai-brain/acceptance/ac-10-02-status-divergence.js

# 3. Dependency truthfulness: TASK-AI-09 named by a commit on origin/main
node tools/ai-brain/acceptance/ac-10-03-dependency-merged.js

# 4. Negative proof: a dependency with no merge commit is refused
node tools/ai-brain/acceptance/ac-10-04-dependency-unproven.js

# 5. Permission boundary contract over the real decisions document
node tools/ai-brain/acceptance/ac-10-05-allowlist-contract.js

# 6. Negative proof: a removed deny entry is reported
node tools/ai-brain/acceptance/ac-10-06-allowlist-broken.js

# 7. Toolchain suite invariant (fail 0, and the suites really ran)
node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js

# 8. Register reconciliation audit
node tools/ai-brain/cli.js reconcile

# 9. Specification structural validation
python docs/product-spec/scripts/validate_docs.py

# 10. Secret surface guard
node tools/ai-guard/cli.js secret-surface

# 11. Fail-closed guard check for the three negative proofs
node tools/ai-brain/acceptance/ac-10-14-fail-closed-guards.js
```

## Codex review record

| Review round | Commit    | Verdict        | Findings resolved                                                                                                                                                                                                                                        |
| ------------ | --------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1            | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-10: permission allowlist and security hardening. The register records `BLOCKED_DEPENDENCY`, so under the status transition ledger above this item is not stage-eligible for review routing and no verdict is claimed. |

## Acceptance matrix validation

Written `2026-09-17`. Every `node` row was executed against this branch before the matrix was committed: the invariant rows produced exit `0` with their stated string and the three negative proofs produced exit `1` with their stated string. Each negative proof reads a real repository file, proves the untouched source is accepted as a CONTROL, tampers an in-memory copy, and asserts the same shared rule rejects it. Each negative proof exits `2`, not `0`, when it cannot detect its tamper, and exits `2`, not `1`, when its real source is missing.

| Row           | Exit | Output                                                                                      |
| ------------- | ---- | ------------------------------------------------------------------------------------------- |
| `AC-AI-10-01` | `0`  | `Control status matches register row 143: BLOCKED_DEPENDENCY (declared TASK-AI-10)`         |
| `AC-AI-10-02` | `1`  | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` |
| `AC-AI-10-03` | `0`  | `TASK-AI-09 dependency verified: merged into origin/main for TASK-AI-10`                    |
| `AC-AI-10-04` | `1`  | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main`              |
| `AC-AI-10-05` | `0`  | `ALLOWLIST_BOUNDARY_HOLDS: 6 allowed and 6 denied operations declared, none missing`        |
| `AC-AI-10-06` | `1`  | `ALLOWLIST_BOUNDARY_BROKEN: DENIED_OP_MISSING: Auto-merge any Pull Request`                 |

## Residual limitations

- **The enforcement point is not built here.** This Work Item authors the contract and its proofs. `AC-AI-10-05` and `-06` assert the boundary is declared and cannot be silently narrowed; they do not, and cannot, assert that `control.ps1` consults it, because that wiring is the implementation phase. A green matrix means "the boundary is complete", not "every operation is gated".
- **`dependency-merged.js` proves naming, not delivery.** It accepts any commit reachable on `origin/main` whose message names the dependency; for `TASK-AI-09` the naming commit is its own specification commit, not an implementation merge. The limitation is recorded so a later Work Item that depends on a frequently-named id does not inherit it silently.
- **The boundary is a source contract.** `AC-AI-10-05` and `-06` prove the decisions document carries the allow/deny list. They cannot prove no other code path performs a denied operation through some indirect route.
- **The product's own permission model is out of scope.** Auth, tenancy and RBAC for the shipped application are governed by their own specifications, not by this delivery-pipeline allowlist.
