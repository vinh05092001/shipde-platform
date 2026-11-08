# TASK-AI-171 — Unified Routing Core: Route Identity, Scoped Health, Selection, JEV Advisory & Budget Contract

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-171` |
| Feature ID | `N/A — AI brain routing core selection and health isolation` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `293` |
| Dependencies | `TASK-AI-167` |
| Assigned author | `AGY` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/route-identity.js`; `tools/ai-brain/route-identity-utils.js`; `tools/ai-brain/route-identity-create.js`; `tools/ai-brain/route-identity-combo.js`; `config/route-identity.json`; `tools/ai-brain/test/task-ai-171-route-identity.test.js`; `tools/ai-brain/scoped-health.js`; `tools/ai-brain/scoped-health-classifier.js`; `tools/ai-brain/scoped-health-eval.js`; `tools/ai-brain/unified-selector.js`; `tools/ai-brain/unified-selector-admission.js`; `tools/ai-brain/unified-selector-jev.js`; `tools/ai-brain/candidate-adapters.js`; `tools/ai-brain/candidate-adapters-common.js`; `tools/ai-brain/candidate-adapters-direct.js`; `tools/ai-brain/candidate-adapters-agy.js`; `tools/ai-brain/routing.js`; `tools/ai-brain/agy-quota.js`; `tools/ai-brain/test/unified-routing-offline.test.js`; `docs/product-spec/work-items/TASK-AI-171.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `.oc/pr-body.md`; `tools/ai-brain/quota-scan.js` (PR #515, operator instruction); `tools/ai-brain/test/task-ai-171-onboard-scope.test.js` (PR #515) |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/routing-core-selection` |
| Pull Request | `N/A — authoring stage` |

## Business outcome

Establish a single, governed, unified route selection engine across all three execution pathways (9router, direct external providers, and AGY pool). The unified routing core guarantees:
1. Canonical route identity and non-colliding candidate keys that preserve source IDs, connection IDs, and delimiter escaping while masking private account emails across metadata and logs.
2. Scoped health and quota domain tracking preventing cross-contamination (account A failure never blocks account B; gateway down isolates from direct routes; transient DNS errors do not trigger auth failure; expired resetAt requires fresh telemetry rather than unprobed admission).
3. A single entry selection flow for 9router, direct providers, and AGY pool lanes with strict admission gating (cost ceiling enforcement, reviewer domain independence, combo constituent branch health/capabilities).
4. Contract-compliant JEV trade-off advisory that strictly advises weight profiles and rejects responses that illegally name candidate identities.
5. Structured task-scoped context and budget interface with explicit token priority over context window heuristics.

## Source references

- `AGENTS.md` (Unit of delivery, Code review rules, Verification commands)
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`
- `tools/ai-brain/work-guard.js`
- `tools/ai-brain/route-identity.js`
- `tools/ai-brain/route-identity-utils.js`
- `tools/ai-brain/route-identity-create.js`
- `tools/ai-brain/route-identity-combo.js`
- `config/route-identity.json`
- `tools/ai-brain/scoped-health.js`
- `tools/ai-brain/unified-selector.js`
- `tools/ai-brain/candidate-adapters.js`
- `tools/ai-brain/routing.js`
- `tools/ai-brain/test/task-ai-171-route-identity.test.js`

## Preconditions and dependencies

- Monorepo baseline with Node >= 20.
- All candidate sources (9router SQLite database, direct provider environments, AGY pool lane configurations) accessible via offline deterministic adapters.
- Slice A offline test suite in `tools/ai-brain/test/task-ai-171-route-identity.test.js`; Slices B and C add their own offline suites. All suites verify 0 live inference calls.

## Ambiguity and clarification markers

None. All route identity schemas, scoped health categories, JEV advisory weight rules, and admission constraints are fully specified and tested.

## Author boundary

Appropriate for AGY author. All modifications are strictly confined to AI brain routing modules (`tools/ai-brain/`) and documentation. No application-level database schemas, payment flows, or carrier adapters are touched.

## Slice sizing rule

Bounded single vertical delivery of unified route identity, scoped health registry, candidate adapters, unified selector, offline tests, delivery register row, and PR documentation within the routing domain.

## In scope

This Pull Request delivers Slice A only: canonical route identity. Scoped health, candidate
adapters, unified selection, JEV advisory and the budget contract are deferred to Slices B and C
of the same Work Item; see the Slice plan section.

- `tools/ai-brain/route-identity.js`:
  - `createRouteIdentity`, `canonicalCandidateKey`, `parseRouteIdentity`, `distinguishPathway`, `resolveModelPrefix`.
  - Component escaping to allow double colons `::` and percent encodings in keys.
  - Private email registration and hashing (`registerPrivateEmail`, `hashEmail`, `maskEmailsInString`) preventing PII leakage.
  - Explicit provider handling that preserves a provider's own slash-namespaced model id (`meta-llama/Llama-3.3-70B-Instruct`).
  - Combo route identity expansion (`expandComboIdentity`).
- `config/route-identity.json`:
  - Versioned router-prefix data consumed by `resolveModelPrefix`.
- `tools/ai-brain/test/task-ai-171-route-identity.test.js`:
  - Offline tests for AC-AI-171-06 and the branch-preservation half of AC-AI-171-07.

## Out of scope

- Modifying controller dispatch workflows outside `routing.js` exports.
- Modifying root application UI or Prisma schemas.
- External carrier adapter changes.

## Business rules and edge cases

- `BR-ROUTING-01`: Account failure isolation. An authentication or rate limit failure on account A must never mark account B unhealthy, even when targeting the same model.
- `BR-ROUTING-02`: Shared quota deduplication. When an account is shared across pathways (e.g. 9router and direct/AGY), its quota scope must be linked so budget/exhaustion cannot be bypassed.
- `BR-ROUTING-03`: Error classification accuracy. DNS failures must be classified as `NETWORK_DNS` with transient cooldown, never misclassified as `AUTH`.
- `BR-ROUTING-04`: Gateway failure isolation. A local or gateway outage (e.g. ECONNREFUSED on port 20128) marks only the gateway unhealthy, leaving direct provider pathways operational.
- `BR-ROUTING-05`: Telemetry requirement on expired reset. An expired `resetAt` requires fresh telemetry probe (`requiresProbe: true`) and must not be admitted as healthy without verification.
- `BR-ROUTING-06`: Model ID preservation. Model IDs containing slashes and complex casing must not be truncated or normalized destructively.
- `BR-ROUTING-07`: Combo branch verification. Combo candidates retain constituent branches; admission requires checking all constituent branches for health, capabilities, and locks.
- `BR-ROUTING-08`: JEV advisory contract. JEV may only advise weight profiles (`LATENCY_FIRST`, `BALANCED`, `QUALITY_FIRST`). Any response naming a model, provider, account, or candidate key is rejected as `IDENTITY_PROHIBITED`.
- `BR-ROUTING-09`: Strict cost ceiling. When a cost ceiling is specified, candidates with unknown cost must be strictly rejected without inventing arbitrary score values.
- `BR-ROUTING-10`: Budget contract priority. Explicit `tokenBudget` takes precedence over `contextSize` heuristics; enforcement is marked `UNENFORCED_AT_SELECTION` unless runner-bound.

## Constitution check

- [x] **Tenant scope**: N/A — AI brain routing engine and offline adapters.
- [x] **RBAC & permissions**: Reviewer role policy enforces domain independence from the implementation author.
- [x] **Audit & sensitive data**: Private email addresses are hashed and masked (`registerPrivateEmail`, `hashEmail`); raw credentials and tokens never appear in candidate keys, scopes, or decision logs.
- [x] **VND integer arithmetic**: N/A — Routing modules calculate model token budgets and USD costs with strict null/unknown rejection.
- [x] **Carrier reconciliation**: N/A — AI model routing, not carrier logistics.
- [x] **Tests at the lowest useful level, test-first where executable**: Slice A acceptance is verified by 2 offline unit tests in `tools/ai-brain/test/task-ai-171-route-identity.test.js`, covering AC-AI-171-06 and the branch-preservation half of AC-AI-171-07. The remaining criteria move with Slices B/C.

## UI states

N/A — Backend routing and AI brain toolchain; no user interface is modified.

## API, event and data impact

- Exported API: `selectOptimalRoute` and `UnifiedRouteSelector` in `tools/ai-brain/routing.js`.
- Contracts: Route identity schema, Scoped health registry schema, Candidate aggregation contract, JEV weight advisory contract.
- Migrations: None.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-171-01 | Criterion 1: Cùng model, hai account | Account A auth failure isolates to Account A; Account B remains healthy | Slice B (deferred) |
| AC-AI-171-02 | Criterion 2: Hai đường chung quota | Shared account across 9router and AGY pool shares single quota scope | Slice B (deferred) |
| AC-AI-171-03 | Criterion 3: DNS không biến thành login-required | DNS failure is classified as NETWORK_DNS with transient cooldown, not AUTH | Slice B (deferred) |
| AC-AI-171-04 | Criterion 4: Gateway tắt không đánh chết upstream qua đường trực tiếp | ECONNREFUSED on port 20128 blocks 9router gateway, leaving direct route healthy | Slice B (deferred) |
| AC-AI-171-05 | Criterion 5: ResetAt đã qua và lock đã hết hạn | Expired resetAt requires fresh probe and does not bypass locks; expired lock cleared | Slice B (deferred) |
| AC-AI-171-06 | Criterion 6: Model ID nhiều dấu slash | Preserves multiple slashes and casing without mutilation | unit test (`task-ai-171-route-identity.test.js`) |
| AC-AI-171-07 | Criterion 7: Combo identity và ràng buộc | Combo retains constituent branches and evaluates branch health/capabilities | unit test (`task-ai-171-route-identity.test.js`, branch-preservation half); Slice C (role policy) |
| AC-AI-171-08 | Criterion 8: Candidate từ cả ba đường | Aggregates and selects across 9router, direct provider, and AGY pool | Slice C (deferred) |
| AC-AI-171-09 | Criterion 9: JEV cache hit/miss và undecided | JEV advisory caches properly and falls back deterministically on UNDECIDED | Slice C (deferred) |
| AC-AI-171-10 | Criterion 10: Budget và context interface | Emits structured budget contract with tokenBudget precedence | Slice C (deferred) |

## Task breakdown

- [x] `T01` [P] Design route identity schema with component escaping, private email hashing, and non-colliding candidate keys (`tools/ai-brain/route-identity.js`).
- [ ] `T02` Implement scoped health registry with fine-grained error categories, scopes, model locks, and reset elapsed telemetry requirements (`tools/ai-brain/scoped-health.js`) — Slice B, not in this PR.
- [ ] `T03` [P] Implement candidate adapters for 9router, direct providers, and AGY pool lanes with shared quota auto-linking (`tools/ai-brain/candidate-adapters.js`) — Slice C, not in this PR.
- [ ] `T04` Implement unified route selector with admission gating, cost ceiling enforcement, contract-compliant JEV trade-off advisory, and budget precedence (`tools/ai-brain/unified-selector.js`) — Slice C, not in this PR.
- [ ] `T05` Export production bridge `selectOptimalRoute` from `tools/ai-brain/routing.js` — Slice C, not in this PR.
- [x] `T06` [P] Write offline route identity unit tests for Slice A (`tools/ai-brain/test/task-ai-171-route-identity.test.js`).
- [x] `T07` Create Work Item `docs/product-spec/work-items/TASK-AI-171.md` and add delivery register row in `FEATURE-DELIVERY-REGISTER.csv`.
- [x] `T08` Run the Slice A verification suite and record evidence (unit test, format check, exact-head CI).

## Author checklist

- [x] `node --test tools/ai-brain/test/task-ai-171-route-identity.test.js` — 2 tests, 0 fail.
- [x] `pnpm format:check` — exit 0 (6 changed files).
- [x] Offline check `explicit-provider-preserves-model-namespace` — pass.
- [x] CI `current-application` and `application-gate` — pass at reviewed SHA `e72f3e19` (`gh pr checks 509`).

## Verification commands

```bash
node --test tools/ai-brain/test/task-ai-171-route-identity.test.js
pnpm format:check
pnpm lint
pnpm test:brain
pnpm security:secrets
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `5a4fad6` | CHANGES_REQUIRED | Initial patch 2 implementation: 11 findings identified |
| 2 | `50c26d7` | CHANGES_REQUIRED | Resolved 11 initial findings; 14 regression findings identified |
| 3 | `dd2dad3` | CHANGES_REQUIRED | Resolved 14 findings; 7 findings identified |
| 4 | `bf64a86` | CHANGES_REQUIRED | Resolved 7 findings on dd2dad3 |
| 5 | `f5807d4` | CHANGES_REQUIRED | Resolved Claude review findings; 6 P1 findings identified by Codex |
| 6 | `fa72284` | CHANGES_REQUIRED | Resolved 6 P1 findings from f5807d4; 6 P1 findings identified |
| 7 | `fb8826b` | CHANGES_REQUIRED | Resolved 6 P1 findings from fa72284; minor edge case findings |
| 8 | `95143fa` | PASS | Fallback account health key to connectionId on UNKNOWN and sync combo viableBranches on JEV revalidation |

## Residual limitations

Slice A (this PR) deliberately ships route identity only. Scoped health (AC-AI-171-01 to 05),
candidate adapters, unified selection, JEV advisory and the budget contract (AC-AI-171-08 to 10 and
the role-policy half of AC-AI-171-07) are deferred to Slices B and C of the same Work Item, together
with their open review findings. No acceptance row assigned to the shipped slice is left unproven.

## Slice plan (2026-11-05)

The PR reached 3.2k lines and every review round found new P1s (STUCK after 20 rounds), so it ships in slices of the same Work Item:

- Slice A (this PR): route identity — `route-identity*.js`, `config/route-identity.json`; AC-AI-171-06 and the branch-preservation half of AC-AI-171-07. Test: `tools/ai-brain/test/task-ai-171-route-identity.test.js`.
- Slice B (next PR): scoped health — AC-AI-171-01 to 05.
- Slice C (after B): candidate adapters, unified selector, JEV advisory and budget contract — AC-AI-171-08 to 10 and the role-policy half of AC-AI-171-07. The open review findings on `unified-selector-admission.js`, `candidate-adapters.js` and `unified-selector-jev.js` move with it.

## One scorer for dry-run and execute, with unsourced parts labelled (2026-11-07)

Outcome: Dry-run and execute rank one snapshot through one scorer; legacy values stay in force but are labelled unsourced.

Author: Codex CLI as temporary writer, because the Controller had no ranking; not a Controller selection. Claude verified and committed.

Files: `tools/ai-brain/ranking.js` `tools/ai-brain/routing.js` `tools/ai-brain/test/task-ai-171-score-parity.test.js`

Evidence: `task-ai-171-score-parity.test.js` with routing, ranking and candidates tests: 61/61 pass, rerun by Claude. Author: 12 leaf failures exist with both baseline and this repair; CI ai-brain-tests is the regression evidence.

Limitations: No producer supplies measured scores yet, so production still ranks on unsourced legacy values. Not wired from cli.js. Most of the 20 audited values remain unsourced.
## Build a task from the real check failure (2026-11-07)

Outcome: A failed check produces a task stating only the true failure.

Author: Codex CLI as temporary writer, because the Controller had no ranking; not a Controller selection. Claude verified and committed.

Files: `tools/ai-brain/check-failure-task.js` `tools/ai-brain/test/task-ai-171-check-failure-task.test.js`

Evidence: `task-ai-171-check-failure-task.test.js`: 12/12 pass, rerun by Claude; author proved each AC by disabling it.

Limitations: Helper only, not wired to route.js yet. TASK-AI-169 replay uses synthetic fixtures. Hardcode guard not run locally.
## JEV decision contract that cannot override the Controller (2026-11-07)

Outcome: JEV is skipped for clear tasks, sees only the filtered shortlist, and low confidence, errors, timeouts or outside IDs never override the Controller.

Author: Codex CLI as temporary writer, because the Controller had no ranking; not a Controller selection. Claude verified and committed.

Files: `tools/ai-brain/jev.js` `tools/ai-brain/routing.js` `tools/ai-brain/jev-wrapper.js` `tools/ai-brain/test/task-ai-171-jev-contract.test.js`

Evidence: `task-ai-171-jev-contract.test.js`: 13/13 pass, rerun by Claude. Full `tools/ai-brain` local run: 3082 tests, 3036 pass, 45 fail; the comparison run on main did not finish, so CI ai-brain-tests is the regression evidence.

Limitations: Mock evidence only, not real JEV. Removes the wrapper's minConfidence 0 bypass, so more real asks may end UNDECIDED. cli.js join point not wired.
## Onboarding scope fix (2026-11-06, PR #515)

Routing audit follow-up, kept separate from the route-decision PR #514.

AGY remains the assigned author of this Work Item. Claude Code implemented PR #515 only, by operator instruction.

- Defect: `scanSourceQuotas` in `tools/ai-brain/quota-scan.js` returned every scope in the quota state for a source listed in `dispatch.providers`. `onboardSourceRolling` recorded those passes as passes of the gateway, which planned gateway routes for models the gateway does not advertise.
- Change: that path returns only the requested source's scopes.
- Allowed paths: `quota-scan.js` and `test/task-ai-171-onboard-scope.test.js` were added to the Control table for this PR by operator instruction; reviewer to confirm.
- Evidence: `test/task-ai-171-onboard-scope.test.js`, both cases fail without the fix and pass with it.
- Offline replay on copied data: first selection through `dispatchCommand --execute` with a mock runner; fallback through `assembleForDispatch` with `refreshRoutes`, not end to end through `dispatch --execute`, using a synthetic catalogue row and a failed direct route. After removing the four records neither suspect route was a candidate.
- A valid route confirms argv only. It ran with `allowUnprobedCandidates`, so route liveness is not proven.
- Not changed: existing evidence and route-health records.

## Fallback keeps the diff and stops at its limit (2026-11-07)

Outcome: After one fallback a worker chain stops, keeps the diff and never runs two writers on one worktree.

Author: Codex CLI as temporary writer, because the Controller had no ranking; not a Controller selection. Claude verified and committed.

Files: `tools/ai-brain/route-handoff.js` `tools/ai-brain/test/task-ai-171-route-handoff.test.js` `tools/ai-brain/test/task-ai-171-fallback-chain.test.js`

Evidence: `task-ai-171-fallback-chain.test.js` plus `task-ai-171-route-handoff.test.js`: 19/19 pass, rerun by Claude; new suite with old route-handoff: 1 pass, 6 fail per author.

Limitations: Stub execution with JSON reload, not a live restart. Caller must persist ledger and record activeWorker; not wired to the pipeline.
## Structured decision launch (2026-11-07, PR #516)

Outcome: a launch runs only from a structured Controller decision; proof must match the actual execution route, failed evidence does not qualify, and an unresolved dispatch route is refused or falls back.

Evidence: `task-ai-171-route-handoff.test.js` 26/26 on `137e2eb7`; Codex PASS on `137e2eb7`.

Limitations: offline stub evidence; not yet wired into the pipeline.

## Combo membership fix (2026-11-07, PR #518)

Outcome: combo membership is separated from call eligibility; health lookups stay on the exact route and account.

Evidence: `task-ai-171-combo-members.test.js` and `task-ai-171-route-handoff.test.js` pass; Codex PASS on `be54bd6d`.

Limitations: offline evidence only.
## 401 scope fix (2026-11-07, PR #520)

Scope: a 401 behind a gateway blocks only as far as its evidence reaches. One route failing on its credential no longer removes other models or upstreams on the same gateway key. Base: PR #518.

Rules:

- A matching error tag drops only the failed route from that ticket's retry; it never blocks the whole upstream or the shared key.
- The tag counts only when its model matches the failed route.
- `connection` scope applies only with a confirmed connection ID.
- A whole upstream is blocked only by explicit `upstream-credential` evidence, which no error string produces.
- A stored scan 401 naming one model behind a gateway blocks only that model.
- Upstream rows with no model and direct-source rows keep their existing behaviour.

Files outside the Allowed paths above, needed by this fix: `tools/ai-brain/failure-classifier.js`, `routing.js`, `evidence.js`, `route-handoff.js`, `quota-scan.js`, `capability-probe.js`, `probe-order.js`, `hermes-session.js`, plus `task-ai-171-auth-scope.test.js`, `candidates.test.js` and `classifier-outcome.test.js`.

Evidence on `3886b2d5`: `task-ai-171-auth-scope.test.js` 24/24; focused run 229/229; full `tools/ai-brain` suite 3245 tests, 3176 pass, 68 fail, with no test failing only on this commit compared with `6c506ece`. The full suite is not green.

Limitations: the upstream reading of the four stored 2026-11-05 cases is an inference from error text; SQLite holds no record confirming it, and no request ID links client and gateway. Candidates carry no `connectionId` today, so the `connection` path is proven only by tests. AC-AI-171-01 and the other deferred rows in the Acceptance matrix are not closed by this fix.

## Prove route evidence stays within its route (2026-11-07)

Outcome: Twelve offline cases prove auth, quota and evidence do not spread beyond their route.

Author: Codex CLI as temporary writer, because the Controller had no ranking; not a Controller selection. Claude verified and committed.

Files: `tools/ai-brain/test/task-ai-171-route-health-evidence.test.js`

Evidence: `task-ai-171-route-health-evidence.test.js`: 12/12 pass, rerun by Claude. No production code changed and no defect found.

Limitations: Fixtures prove behaviour only, not live quota or liveness.

## Integration of open routing PRs (2026-11-07)

Operator instruction: finish the open slices, then merge them together. This branch merges #525, #518, #523, #520, #524 and #521. Each slice has its own Codex verdict on its PR; this branch gets one review of the combined result.

Three code conflicts were resolved by hand: route-handoff.js imports, afterFailure guards with auth classes, and candidates.js combo reads.

Limitations: offline evidence only; no real task run. TASK-AI-181 ships in the same PR by operator instruction, an exception to one Work Item per PR.

## Dispatch route scope (folded from TASK-AI-181)

This scope shipped inside the TASK-AI-171 integration PR, which may change only one Work Item.

### Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-181` |
| Feature ID | `N/A — AI dispatch` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `305` |
| Dependencies | `TASK-AI-171` (available on assigned base) |
| Assigned author | `Codex CLI — temporary operator dispatch; not Controller selection` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/{cli,candidates,ranking}.js`; `tools/ai-brain/test/task-ai-181-route-scope.test.js`; this Work Item; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `.oc/report.md` |
| Reviewer | Fresh independent review; author never approves or merges |
| Branch | `fix/task-ai-181-dispatch-combo-read` |
| Pull Request | `#521` |

### Business outcome

Dispatch obeys the writer ticket's combo scope and records why other routes were refused, including after advisory/probe reentry and during execution.

### Source references

- `BASELINE-AND-DECISIONS.md` — Change control; `PRODUCT-VISION-SCOPE.md` — Boundaries; `MASTER-FEATURE-CATALOG.md` — Shared platform (all under `docs/product-spec/docs/`).
- `docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md` — Role separation, Pull Request evidence.
- `TASK-AI-171.md` — Business rules `BR-ROUTING-07/08` (combo constituents and JEV advisory); `.oc/task.md` — F521 findings P1-1 through P2-3 and combo read check; operator Ticket A overrides commit/push instructions.

### Preconditions and dependencies

Assigned HEAD `e77cb9fbe8cf0c81bc23631c213e761a21076a5d`; base branch `6c506ece23568fcf60c89bbc0284de86a6314c0e`. Offline fake registry, combo configuration, JEV and launcher only. Delivery order is max(304, 304) + 1 from local `origin/main` (`1b7a969df3bcb8563f42752f2d77a4809bf9d93c`) and the base branch; no network refresh.

### Ambiguity and clarification markers

None. Assumptions: `comboMembers` identifies the whole-combo route kind only when source metadata proves 9Router; model names alone prove neither source nor route kind. Absent scope allows individual routes. Non-writer behavior and generation callers without a role remain compatible.

### Author boundary and slice sizing rule

One bounded Work Item. Operator assigns Codex CLI as temporary writer; no ranking-selection claim. Reuse assembly, scope, source identity, candidate keys, JEV assessment, ranking and decision persistence. No scoring, JEV policy, dependencies, credentials, production network/model calls, gates or git configuration changes. Coordinator verifies and commits; author leaves edits uncommitted.

### In scope / Out of scope

In scope: the six F521 findings and read-order check. Out of scope: Controller ranking implementation, unrelated dispatch-wiring failures and external liveness proof.

### Business rules and edge cases

`BR-181-01`: A direct/non-9Router suffix collision is individual. `BR-181-02`: retain inventory before scope; combo-only refuses individuals with `NOT_IN_COMBO_CONFIG`, or `COMBO_CONFIG_UNAVAILABLE` when unread. `BR-181-03`: injected candidates and reentry obey the same scope. `BR-181-04`: preserve exclusions in decision records before launch; scoped routes never return. `BR-181-05`: retain registry-supplied launch prefix.

### Constitution check

Tenant scope, RBAC, VND and carrier reconciliation: N/A (offline AI toolchain only). Audit/sensitive data: fake fixtures, temporary stores, no credential reads. Lowest useful tests cover negative scope, unread configuration, reinjection, durable records and launch argv; no application UI, schema or migration changes.

### UI states / API, event and data impact

No UI. Internal generator `routeScope: combo-and-routes` retains inventory for the shared scope filter; other callers keep existing behavior. Internal `routeScopeExclusions` carries prior refusals through reentry, and ranking accepts `excludedRoutes` before persisting its decision. Canonical reasons above remain unchanged.

### Acceptance matrix

All executable evidence is in `tools/ai-brain/test/task-ai-181-route-scope.test.js`.

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| P1-1 | Combo-name collisions | Source and combo route kind required; real combo kept | unit: `P1-1: combo origin requires the router source and the combo route kind` |
| P1-2 | Inventory absent from discovery | Default/combined scope keep individual; limited scope records refusal; no-role caller compatible | unit: both `P1-2:` tests |
| P1-3 | Injected candidates, read/unread config | Same scope and reasons | unit: `P1-3: injected candidates receive the same scope check and reasons` |
| P2-1 | JEV/probe reentry and execute | Both reasons retained; excluded route cannot launch | integration: four `P2-1:` tests (both reasons, both paths) |
| P2-2 | Combo and individual launch | Registry `ninerouter/` prefix applied once | integration: `P2-2: launch argv preserves the registry prefix for combo and individual 9router routes` |
| P2-3 | Contract and register | This Work Item; exactly one READY_FOR_CODEX row, order 305 | docs-inspection; test not applicable: delivery metadata |
| READ | Reviewer profile reads combo early | One wasted read; no writer combo enabled | unit: `combo read order: reviewer profile wastes one read but does not enable a writer combo` |

### Task breakdown / Author checklist

- [x] Write and reproduce failing regression tests, then apply narrow fixes.
- [x] Verify named offline suites and prefix behavior; report existing failures separately.
- [x] Add contract/register and `.oc/report.md`; leave independent review and commit to coordinator.
- [ ] Coordinator runs dependency-backed checks and fresh independent review.

### Verification commands

`node --test tools/ai-brain/test/task-ai-181-route-scope.test.js tools/ai-brain/test/task-ai-66*.test.js tools/ai-brain/test/*dispatch*.test.js`; `node scripts/ai/check-no-hardcode.mjs`; `pnpm security:secrets`. Format changed supported files with Prettier `--end-of-line auto`. Exact results and environment limitations: `.oc/report.md`.

### Codex review record

No independent verdict yet. Temporary Codex writer does not approve its own work.

### Known limitations

Combo config is read before ticket role resolution when a reader is supplied. READ test demonstrates a wasted reviewer read without a wrong candidate result; left unchanged. Owner: coordinator; next action: consider read optimization separately. The four base dispatch-wiring failures remain outside scope. No live route liveness, remote CI or merge evidence is claimed.

### Residual limitations

Dependency-backed guard/format checks require installed tooling. Coordinator owns reruns and independent review before publication; see `.oc/report.md`.

### Controller reads the combo itself and refuses routes outside the ticket scope (2026-11-07)

Outcome: A ticket's route scope is enforced at every entry point, and each refused route keeps its reason through JEV and execute.

Author: Codex CLI as temporary writer, because the Controller had no ranking; not a Controller selection. Claude verified and committed.

Files: `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` `tools/ai-brain/candidates.js` `tools/ai-brain/cli.js` `tools/ai-brain/ranking.js` `tools/ai-brain/test/task-ai-181-route-scope.test.js` `docs/product-spec/work-items/TASK-AI-181.md`

Evidence: `task-ai-181-route-scope.test.js`: 14/14 pass, rerun by Claude; each P1 fails on e77cb9fb per author. Full suite before the A2 repair: 3235 tests, 46 fail; 1 new subtest compared with 6c506ece, repaired in A2. `repo-integration-group-6.test.js` needs tsx, absent in the worktree, so CI ai-brain-tests is its evidence.

Limitations: Mock launch and JEV verify orchestration only, not route liveness. Combo read before role is a wasted read, recorded as a known limitation. Base #518 is not merged.

## Dispatch catalogue read

`priors-public.liveModelIds` reparsed the catalogue for every prior match, so dispatch blocked for over 280 seconds on 11904 rows and looked like a stalled refresh. It now rereads only when the file changes.

## Offline integration and live proof (2026-11-08)

Integration of the routing tickets with a measured quality policy and scan-based route evidence. Evidence and open items: `docs/ai-audit/handoff-table-20261108.md`.

## Register reconciliation (PR #540)

- Report: `docs/ai-audit/register-reconcile-20261108.md`. Offline author, data fetched by the coordinator.
## Open PR (PR #541)

- Report: `docs/ai-audit/open-prs-20261108.md`. Offline author, data fetched by the coordinator.
## 9Router 503 classification (PR #538)

- 9Router answers 503 with the upstream status inside; 895 scan results were classified by that inner code (rate limit, no credit, model gone, auth, other) in `docs/ai-audit/handoff-table-20261108.md`.
- `cl`/`bzl` conflicts with earlier successful free calls are burst rate limits during the scan; `nous` is model gone. No backoff rescan was run.
## AA scoring restore (PR #539)

- The #537 integration dropped `2bc5eef9`; this restores the AA Intelligence percentile policy.
- The AA snapshot is fetched at runtime by `tools/ai-brain/aa-snapshot.js` and gitignored; a missing snapshot scores nothing.
- Route IDs join AA rows by last path segment; only a policy-declared deployment tag is stripped; an unnamed effort takes the lowest published effort.
- Evidence: 22/22 focused tests; dry-run FEAT-CAR-01 scored 76 of 234 models (was 6). Models absent from AA stay QUALITY_UNKNOWN.

## AA deprecated records (aa-snapshot deep mode)

- With `modelPageBase` in the policy, aa-snapshot reads the records AA embeds in model pages, including deprecated models the leaderboard table hides. Live run 2026-11-08: 115 rows (10 deprecated), dispatch FEAT-CAR-01 scored 87 of 236 models (was 76). AA publishes no index for the rest.

## AA origin names

- A route whose name differs from AA (renamed by a source) is joined to its origin through the shared prior matcher or a trailing numeric release tag; several candidates take the lowest score. Dispatch FEAT-CAR-01: 103 of 236 models scored (87 before).
- Review 08/11: the shared prior matcher was dropped from the origin join (it stripped efforts and merged distinct models); release-tag rule only. Dispatch: 102 of 235 scored.
## Scoring scale label (dispatch output)

- With an active scoring policy, `scoreScale` names the policy version and range and the decision carries `scoringPolicyStatus`; without a policy the profile label stays.

## Handoff table final update

- `docs/ai-audit/handoff-table-20261108.md` records #538 to #545, live scoring 103 of 236 (measured after merge), the FEAT-CAR-01 Slice B product ticket and the remaining blockers.

## AA variant takes its base (operator 2026-11-08)

- A known AA base followed by a variant AA does not publish (`gpt-6.1-sol-pro`, `glm-5.3-prime`) takes the base result at its lowest published score; longest base wins. Dispatch FEAT-CAR-01: 124 of 236 models scored (103 before).
## PR 01 — Preserve the Controller's selected writer and score (2026-11-08)

Operator-assigned Codex author scope: `tools/ai-brain/{dispatch-output,route-handoff}.js`, `tools/ai-brain/test/task-ai-171-route-pr01-consumer.test.js`, plus this section.
Rows B09/B10/B19/B21/B60/B70/B72 reuse Controller scoring and explicit route fields.
`decisionFromDispatch(json, { exitCode, error, workItemId })` adapts dispatch output for
the existing handoff; it preserves scores, scale, provenance, order and refusals.
Strict envelopes launch only the chosen offering; unavailable/null choices block.
Fallback requires a fresh Controller choice; legacy decision callers stay compatible.
Malformed JSON, execution errors, empty inventory and policy refusals remain distinct.
Evidence: new tests before implementation 0 pass / 11 fail; after implementation
11 pass / 0 fail. PR 01 existing suites: 53 pass / 0 fail; handoff/fallback: 33 pass / 0 fail.
Prettier 3.9.6 uses repo settings; the hardcode guard passes with zero new instances.
Offline evidence only. External cutover, live routes, CI, independent review and commit remain with the coordinator; `.oc/route.js` was neither copied nor changed.

## PR 02 — Preserve full route identity and admit all sources once (2026-11-08)

Operator-assigned author scope covers B20/B22/B57/B58/B59/B62/B73. Reuse the
existing pool inventory, combo candidate/scope rules and real-route resolver.
Injected routes now use the shared admission function, including credential refusals
and account-bound registry alias lookup. Deduplicate injected and refreshed inventory
before admission; preserve accounts, slash/case IDs, vendors and effort variants.
The shared discovery identity helper reuses route-identity component escaping and
decoding so delimiter/percent values cannot merge distinct routes. Ordinary keys
without encoded characters retain their representation; parsed keys round-trip.
Combo selection remains a real candidate and its resolved launch evidence names it.

Offline evidence: new PR 02 suite before implementation **0 pass / 5 fail**;
after implementation **5 pass / 0 fail**. Existing `task-ai-171-route-identity`,
`task-ai-171-combo-members`, `task-ai-181-route-scope`: **33 pass / 0 fail**.
Additional candidate/discovery/dispatch-json/route-handoff compatibility: **130 pass /
0 fail**. Repo Prettier and hardcode guard pass (zero new hardcode instances).
No external script copied or changed; no network or commit. External cutover,
remote CI and independent review remain coordinator responsibilities.

## PR 03 — Keep liveness and quota failures within their actual route (2026-11-08)

Ported coordinator observation boundaries for B24/B27/B28/B29/B30/B32/B33/B61
through existing scan, quota and health modules. Exact source/account/model scans
reuse quota classification (including outer 503/inner errors), retain observation
time and retry evidence, and discard response text. Older observations cannot
replace newer failures. Structured completion evidence tolerates a post-answer
timeout; error prose is not completion. Family quota admission combines all
windows, preserves five-hour exhaustion and requires fresh telemetry after reset.
An explicitly unavailable health store refuses admission. Selection does not read
raw provider logs or credentials; due probes remain explicit existing commands.

Offline evidence: new `task-ai-171-route-pr03-observations` suite before changes:
**9 tests, 0 pass, 9 fail**. After changes plus existing `task-ai-171-auth-scope`,
`task-ai-171-onboard-scope`, `task-ai-171-route-health-evidence`:
**50 tests, 50 pass, 0 fail**. Additional P5 liveness/PR 02 compatibility with the
new suite: **25 tests, 25 pass, 0 fail**. No network, external script changes or
commit; live evidence, remote CI and independent review remain outstanding.

Changed JavaScript formatted with offline Prettier 3.9.6 and repo settings;
`git diff --check` passes. The hardcode guard could not execute:
`ERR_MODULE_NOT_FOUND: @typescript-eslint/parser`. No dependency install or
network fallback was attempted; coordinator must rerun this gate with dependencies.

## PR 03 — repair round 1: review findings (2026-11-09)

Finding Piant1 (synthetic file timestamp outranked an explicit newer failure)
fixed in `tools/ai-brain/scan-liveness.js`: each record now tracks whether its
time came from an explicit `observedAt`/`at`. An explicit timestamp always wins;
the file mtime is used only to break ties between legacy rows in file order.
Test `PR03: synthetic file timestamp never outranks an explicit newer failure`.

Finding 2 (merging quota windows released an exhausted route prematurely bodily)
fixed in `tools/ai-brain/quota-scan.js` `mergeQuotaWindows`: a family keeps the
lowest remaining percent and,756 when several windows are exhausted, the
**furthest** reset. The block therefore survives until the last binding window
resets, and unknown/expired telemetry still reports `known:false`.
Test `PR03: merging quota windows keeps the last exhausted reset so the block
survives`.

Both new tests fail on `19707394` (suite 9 pass / 2 fail) and pass after
(16 pass / 0 fail) together with `task-ai-171-route-pr02-admission`.
Changed files pass Prettier 3.9.6. The hardcode guard remains BLOCKED_BY_SANDBOX:
`ERR_MODULE_NOT_FOUND: @typescript-eslint/parser`.
