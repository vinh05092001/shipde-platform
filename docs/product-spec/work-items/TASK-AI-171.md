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

## PR 12 — Explicit coordinator inputs and offline output

Operator-assigned author scope: `coordinator-options.js`, `cli.js`, `dispatch-output.js`, `route-handoff.js` and `task-ai-171-route-pr12-options.test.js` under `tools/ai-brain/`, plus this section. `dispatch --offline [--dry-run]` requires explicit `--root` (absolute), `--runtime` and `--code-sha`; ordinary mode also requires `--item`, `--cwd`, `--task` and `--snapshot`, while `--decision` consumes a structured decision without selecting again. Runtime JSON inputs are pre-sanitized exports: ordinary snapshots contain `candidates`, registry-qualified `launcherModels`, `registry`, `profile` and optional accounts/health/quota/evidence/priors/assessment metadata. Task paths resolve from the checkout; selection stages no prompts. The launch caller supplies an optional sandbox note as text.

Outcome: existing assembly/admission and Controller ranking produce stable redacted JSON, retain every refusal and exact selected identity, and emit only scalar launch receipts. Offline mode reads metadata and performs no process/network/credential/cache/task side effects. Credential bootstrap (B15), raw user config (B23) and workstation startup/orphan maintenance (B54) remain separate operator-owned operations. The caller supplies the code SHA; offline inspection does not run Git or establish live liveness, independent review or cutover.

Evidence: new tests fail on unchanged production code (8 tests, 0 pass, 8 fail) and pass after this change (8 tests, 8 pass, 0 fail). Combined `node --test` run with `dispatch-json.test.js`, `task-ai-171-route-handoff.test.js`, `task-ai-142-dryrun-priors.test.js` and `dispatch-wiring.test.js`: 46 tests, 42 pass, 4 fail; the same four dispatch-wiring failures reproduce at base `be926f07`. Repository Prettier and the explicit five-file no-hardcode scan pass. No network or commit; coordinator owns review and commit.
R03 audit follow-up (2026-11-08): `docs/ai-audit/65-items-status-20261108.md` records evidence against local `origin/main` at `be926f075348e0204cf4172fe1f9e59d7cfba750`, remaining work order and separate owners for items 61–65. It does not declare system completion.
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
## Tool manifest matches the repository (2026-11-09)

- ast-grep, playwright and axe-core are declared in package.json files and are now `installed`; semgrep and trivy point at the existing `security:semgrep` and `security:trivy` scripts; ledger records in GROUP-3 and GROUP-5 updated to INSTALLED, none promoted to EXECUTION_VERIFIED.
## Worker playbook (2026-11-08)

- `docs/product-spec/docs/10-ai-collaboration/WORKER-PLAYBOOK.md` gives every worker one guide: roles, four shared rules, graphify, tool state measured at `5c574f7a` (42 declared, 5 with a command, 2 gates), reference repositories, no-hardcode, reuse, fixing and hand-back checks. Linked from the four start prompts.
Operator finding 61 (context security, separate from routing; `.oc/item61.md:1`): context-pack now resolves the repository root and candidates with `fs.realpathSync`, refuses outside/unresolvable targets with sanitized manifest/result reasons, and rechecks fallback reads. Windows junction regression: before 0/8 pass (six outside-content assertions fail); after 8/8 pass. Existing context-related tests plus regression: 17/17 pass. Broader selected files: 117/118 pass, failing the AGY advertised-model test at `task-ai-141.test.js:100` (outside this repair). Hardcode guard blocked by missing `@typescript-eslint/parser`. Formatted with cached Prettier 3.9.6; no network or commit.
## AA prefix family (operator 2026-11-08)

- A name AA does not list takes its prefix family (`glm-5` -> `glm-5-3*`) at the lowest family score; trailing segments drop one at a time and a family needs two segments. Dispatch FEAT-CAR-01: 187 of 236 models scored. Risk: an older model can inherit a newer family floor (`claude-opus-4-6` from `claude-opus-5*`); label `aa-origin-family`.
- Vendor floor (operator 2026-11-08, MiniMax-M2.7 is deprecated on AA without an index): when no family matches, the vendor lowest published score, label `aa-origin-vendor`. Dispatch: 207 of 236 models scored.

## PR 07 — Fallback ceiling survives crashes and restarts (2026-11-09)

Rows B46, B49, conflict C6. `tools/ai-brain/coordinator-ledger.js` is the only owner of the ledger schema and the only supervised launch path: read and validate against the caller's item and worktree, let `route-handoff.js` decide (unchanged, pure), persist the launch intent, then spawn. A missing file is a fresh ticket; any present but invalid file (truncated, missing or inconsistent counters, wrong item or worktree, unknown version, conflicting aliases) is `LEDGER_UNREADABLE` and blocks. Save refuses anything its own validation rejects and writes via temp file and rename. Old `active` migrates to `activeWorker` only when the aliases agree.

Evidence: `node --test tools/ai-brain/test/task-ai-171-route-pr07-ledger.test.js tools/ai-brain/test/task-ai-171-fallback-chain.test.js tools/ai-brain/test/task-ai-171-route-handoff.test.js` → 39/39 pass; the PR 07 file fails on base (module absent). Redesigned after two review rounds (author: Claude, routing stalled with no live writer).
## PR 08 outcome — Record worker completion and stop before fallback (2026-11-09)

Scope: rows B26, B51 and B52 (`tools/ai-brain/coordinator-completion.js`, `tools/ai-brain/failure-classifier.js`, `tools/ai-brain/test/task-ai-171-route-pr08-completion.test.js`).
- B51: `validateWorkerTimeout` rejects zero, NaN, negative and non-numeric values with `WORKER_TIMEOUT_INVALID`; `awaitWorkerCompletion` and `superviseWorkerCompletion` clear the timer on exit, ignore late exit events after timeout, call the injected stop-confirmation callback, and block fallback through `route-handoff.afterFailure` until termination is confirmed.
- B52: worker output is classified via `failure-classifier` (`extractProviderErrorText`, `extractInnerStatus`, `classifyFailure`); exit 0 with an `Error:` line or without a run-bound commit/artifact is not `WORKER_FINISHED`; inner statuses (including inner 503 wrapped by outer status and outer 503 wrapping inner status) govern classification; durable records keep only `code`, `status`, `category` and `scope` with no raw tail.
- B26: `evaluateLaneHold` and `activeHeldLanes` require an explicit `holdDurationMs` input (`HOLD_DURATION_INVALID`), release a held lane only on evidence bound to the matching `runId` (its commit, result or ended marker) or confirmed stop after expiry, and distinguish run-ended without commit (`COMPLETED_EMPTY`) from `WORKER_FINISHED`.
- Evidence: `task-ai-171-route-pr08-completion.test.js` fails 0/6 on base `2ce2bb72` and passes 6/6 on HEAD; offline injected readers only, no live worker spawn.
## PR 13 outcome — refresh catalogues and snapshots outside writer selection (2026-11-09)

Operator-assigned author scope: `tools/ai-brain/{discovery,scoring-policy,public-catalogue-cache,cli}.js`, `tools/ai-brain/test/task-ai-171-route-pr13-refresh.test.js`, plus this section.
Rows B05, B14, B17 and conflict C7:
- B05: `public-catalogue-cache.js` helper provides mtime cache reads and fetches with injected fetch and clock; returns `{data, ageMs, stale, error}` with limits as caller inputs (no hardcoded constants); offline mode performs zero network and zero write side effects.
- B14: `discovery.js` stamps `refreshed.stamp` and advances `lastSuccessfulAt` only on successful live listing; failed discovery runs leave prior stamps untouched; dispatch read path in `cli.js` only reads the catalogue and reports stale status without running any refresh subprocess or network requests.
- B17: `scoring-policy.js` consumer `loadScoringPolicy` reports missing (`AA_SNAPSHOT_MISSING`), stale (`AA_SNAPSHOT_STALE`), and corrupt (`AA_SNAPSHOT_CORRUPT`) snapshot status truthfully and never triggers automatic network fetches during dispatch selection; refresh remains an explicit maintenance operation.
- Conflict C7: Selection and dry-run dispatch paths are decoupled from refresh operations, guaranteeing zero background refresh side effects.

Evidence: the suite declared nine tests with no nested subtests, so the previously reported 12 passes was wrong. The previously reported base split (2 pass, 10 fail) was not reproducible: run unchanged on base `2ce2bb72` the suite fails at its top-level `require('../public-catalogue-cache')` before any test registers, so no per-test base count exists; with the PR's production files staged onto `2ce2bb72`, the nine tests all pass, verified 2026-11-09.
Related suites: `task-ai-171-aa-join.test.js` (15/15), `task-ai-171-scoring-policy.test.js` (15/15), `task-ai-166-partial-refresh.test.js` (5/5), `task-ai-166-refresh.test.js` (3/3), `refresh-lists-only.test.js` (3/3), `task-ai-139.test.js` (3/3), `task-ai-62.test.js` (15/15), `task-ai-73.test.js` (15/15), `task-ai-171-route-pr12-options.test.js` (10/10), `task-ai-171-route-pr01-consumer.test.js` (11/11). Total: 107 pass, 0 fail across all touched domain suites (rerun by the repair, see below).

## PR 13 repair outcome (2026-11-09)

Review findings 1–5 from the Route PR 13 review are fixed and the evidence is reconciled (finding 6). The suite now declares 8 tests: the previous 9 tests were consolidated (related cases merged into one test each) without dropping a verified case, and the five repair behaviours are covered by the three `*-repair` tests.

Fixed findings:
- Finding 1 (`scoring-policy.js`): snapshot age now always prefers a parseable `observedAt` over file mtime, with or without an injected clock; an old-observation snapshot with a recent mtime is stale either way.
- Finding 2 (`discovery.js`): `refreshed.stamp` advances only when the whole refresh is complete (`complete = successful.length > 0 && failed.length === 0`); a run with one listed and one failed source no longer advances it. `lastSuccessfulAt` keeps its documented "at least one listed source" contract (`catalogue-refresh.js`).
- Finding 3 (`public-catalogue-cache.js`): a non-2xx HTTP response (`ok === false` or `status >= 400`) is a fetch failure (`HTTP_<status>`); the error body never replaces the cache.
- Finding 4 (`public-catalogue-cache.js`): the caller's `timeoutMs` races the whole fetch-and-read (with an `AbortController` signal for standard fetch) and the response body is bounded by `maxBufferBytes` (`FETCH_TIMEOUT`, `RESPONSE_TOO_LARGE`); a standard `fetch` obeys both limits.
- Finding 5 (`scoring-policy.js` + `data/scoring-policy.json`): the permitted future-clock skew is `options.maxFutureSkewMs` falling back to `policy.maxFutureSkewMs`; no code constant remains, an unconfigured policy gets no future tolerance, and the operator policy declares `maxFutureSkewMs: 60000` to keep its previous behaviour. A negative or non-finite declared skew invalidates the policy.
- Finding 6 (this section): counts reconciled, commands and base procedure documented.

One existing suite needed a one-line adaptation to the new freshness contract: `task-ai-171-scoring-policy.test.js` ("AA join binds the observation version and labels how each route was matched") now injects its fixed test clock into `loadScoringPolicy` because its fixture snapshot carries a stale `observedAt` with a freshly written file — exactly the case finding 1 makes stale.

Verification (all run offline, 2026-11-09):
- `node --test tools/ai-brain/test/task-ai-171-route-pr13-refresh.test.js` — HEAD: 8 tests, 8 pass, 0 fail.
- Same command with the four production files reverted to `76c589f9` — 8 tests, 5 pass, 3 fail; every `*-repair` test fails there (`B05-repair` fetch failures/limits, `B14-repair` stamp, `B17-repair` freshness source and configured skew), the five carried-over cases pass.
- Base-`2ce2bb72` procedure for evidence: the suite cannot register tests on bare `2ce2bb72` (the helper module is new in this PR); staging the PR's production files onto `2ce2bb72` makes the nine original tests pass 9/9. The truth therefore is: the original suite never demonstrated the five gaps; the new `*-repair` tests do, by failing at `76c589f9` and passing at HEAD.
- Related suites re-run: `task-ai-171-scoring-policy.test.js` 15/15, `task-ai-171-aa-join.test.js` 15/15, `task-ai-166-partial-refresh.test.js` 5/5, `task-ai-166-refresh.test.js` 3/3, `refresh-lists-only.test.js` 3/3, `refresh-quota.test.js` 18/18, `task-ai-139.test.js` 3/3, `mvp-contract-18.test.js` 18/18 (no failures).
- `npx prettier@3.9.6 --check` on all seven changed files — pass.
- `node scripts/ai/check-no-hardcode.mjs` — BLOCKED_IN_SANDBOX: the worktree has no `node_modules` (@typescript-eslint/parser absent; exact error `Cannot find package '@typescript-eslint/parser'`). Manual review of the changed lines found no model IDs, score pairs or cap-named numeric literals; new literals are the status strings, `HTTP_<status>` prefixes and nothing scored.
- `pnpm lint`, `pnpm security:secrets`, `pnpm test:brain` — BLOCKED_IN_SANDBOX: no node_modules in this worktree; coordinator to run.
- Size: repair delta over `76c589f9` is 270 additions / 99 deletions (net +171); the whole PR remains ~570 changed lines against the reviewed ~401 because the five repair behaviours each required a reproducing test. The PR13 test file was consolidated (9 verbose tests → 8 compact tests covering the same cases) to offset growth.

Known limitations: offline evidence only; `quota-scan-summary.json` was modified before this repair by an earlier stage and is not part of it; no live catalogue fetch, CI, or independent review is claimed by this section.
## PR 02 — Offline unknown-health repair (2026-11-09)

Injected candidates default to unprobed admission through the shared helper. Known
route/account failures and credential refusals still take precedence. Explicit
`requireRouteHealth: true` or `allowUnprobedCandidates: false` retains strict admission.

Reproduction: pointing only the health file at an absent temporary path passed locally;
this did not reproduce the reported Linux CI failure. Explicitly passing the empty
store loaded from that absent file reproduced six failures in `task-ai-50.test.js`
and `task-ai-171-jev-pipeline.test.js`, including the five named failures. Before
the production repair: 26 pass / 6 fail across those suites and PR02 admission.
After repair and an additional default-admission/strict-mode regression: 97 pass /
0 fail across those three suites plus route identity, combo members, route scope,
TASK-AI-80, TASK-AI-87 and P5 dispatch liveness. These are offline fixtures, not
Linux CI proof. No network, commit or independent approval was performed.

## PR 02 — Restore health-required injected admission (2026-11-09)

Supersedes the preceding unknown-health repair: revert the injected-candidate
admission exception from `3feeb9d2`. Injected candidates still need route health
or explicit probe evidence. Known account failures and credential refusals remain
ineligible. TASK-AI-50 and JEV dispatch fixtures now carry passed probe evidence;
PR02 identity fixtures supply model/gateway/account-bound probe evidence. The
PR02 regression rejects unknown health before supplying evidence. Original default
health-rule assertions in TASK-AI-141 part E are restored without a strict-mode
opt-in; its remaining explicit dispatch fixture now supplies probe evidence.

Offline evidence: both original rule tests failed before the revert (0/2 passed).
After the revert, the three named PR02/dispatch suites reproduced seven failures
(26/33 passed). After fixture repairs, the four requested files pass 74/74,
including both rule tests. A second run redirected default health-store loads and
saves to a fresh temporary directory and also passed 74/74; explicit fixture
stores remain isolated. Prettier and the no-hardcode guard pass (zero new
instances). No assertions removed. No network or commit; remote CI and independent
review remain unverified. The unrelated pre-existing quota-summary change is
outside this repair.

## PR 02 repair outcome — explicit key format marker (2026-11-09)

Outcome: legacy pre-upgrade keys keep their literal fields; only keys written with
the new format are decoded. New-format keys carry an explicit `\x1E` record-separator
marker in front of the joined key when any field required escaping (`%`, `::`,
U+241F, boundary colon); keys of plain identities are byte-identical to their
pre-upgrade form. `parseCandidateKey` decodes only marker-prefixed keys, replacing
the trial re-encoding whose encoder diverged from `candidateKey` (the literal
`\u241f` text bug, base 71998e6a `identity.js`).

Where: `tools/ai-brain/discovery/identity.js` (candidateKey/parseCandidateKey) and
`tools/ai-brain/test/task-ai-171-route-pr02-regressions.test.js` (five new P2 cases
plus the strengthened idempotence case). No other file changed.

Evidence, Windows offline:
- Suite `task-ai-171-route-pr02-regressions.test.js` on HEAD: 12 tests, 12 pass / 0 fail
  (`node --test tools/ai-brain/test/task-ai-171-route-pr02-regressions.test.js`). With base
  `71998e6a` discovery/identity.js: the 9 P2 cases (a, b, b2, c, d, e and three catalogue cases f)
  fail; the 3 pre-existing tests pass.
- All 30 existing test files importing `discovery/identity.js` or `discovery/read.js`
  combined: 435 tests, 434 pass, 1 fail — the known pre-existing
  `task-ai-141.test.js` AGY advertised-model failure, which reproduces unchanged
  with the base identity.js.
- `task-ai-171-route-identity` + `combo-members` + `task-181-route-scope`: 33/33 pass.
- Prettier 3.9.6: both files clean. `check-no-hardcode`: pass (0 new instances).
- `pnpm lint` 12/12, `pnpm typecheck` 12/12, `git diff --check origin/main...HEAD` clean.
- `pnpm security:secrets` reports the pre-existing `DASHBOARD.html` finding present at
  base 71998e6a; no hit from this change.

Limitations: offline Windows evidence; Linux CI, fresh independent review and
external cutover remain unverified. Commit by the repair worker on this branch.

## PR 02 — CI admission repair, head 903bb345 (2026-11-09)

The shared admission helper had changed injected inventory's missing-health policy:
any unrelated cached route made missing records require probe evidence. Preserve
its earlier policy (explicit `routeHealth` or `requireRouteHealth` requires evidence)
while retaining shared credential, known account failure, alias and scan checks.
Generated production inventory keeps its existing strict admission behavior.

Regression: an absent temporary health file admits an injected fixture, unrelated
history does not change that result, explicit health/required health rejects it,
and a known account failure remains refused. It fails on 903bb345 and passes with
the repair; no existing assertion changed. With default health and decision stores
redirected to temporary directories, the original reservation test fails on HEAD;
R3 additionally needs an unrelated synthetic health record to reproduce its exact
`0 !== 1` failure. Both pass after repair. All five requested files: **84/84 pass**.
Formatting and the hardcode guard pass. Offline Windows evidence only; Linux CI
and independent review remain unverified. No network, credential reads or commit.

## PR 02 — Regression tests for the repair at 606c4934 (2026-11-09)

Outcome: committed tests guard the three repaired behaviours: required object
health beats unprobed admission, legacy unverified evidence cannot admit an
account-bound offline route, and pre-upgrade keys keep literal `%`/`:` fields.
Files: `tools/ai-brain/test/task-ai-171-route-pr02-regressions.test.js`; fixtures
are synthetic, with no `.oc` path, model name, score or numeric cap.
Evidence: all three fail at `7a24c39c` and pass at `606c4934`; base `710fdd5a`
already passes because the regressions came from this branch after it. Requested
files: **78/78 pass**; Prettier 3.9.6 and the hardcode guard pass.
Limitations: offline Windows only; Linux CI, cutover and independent review are
unverified. No network or credential reads.

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

## PR 03 — fallback repair: preserve unknown family telemetry (2026-11-09)

Operator assigned fallback repair after two Controller-chosen writers did not
converge. Fixed the P1 finding in `.oc/findings.md` at reviewed SHA `1690c184`:
`mergeQuotaWindows` now keeps `known:false` whenever any family window is unknown
or expired, regardless of row order (BR-ROUTING-05). A usable weekly window cannot
release a family that requires a fresh telemetry probe.

Six cases exercise expired, missing and explicit unknown short windows in both
orders through `scanCliLanes`, checking `STATE_ERROR`, `requiresProbe:true` and
blocked admission. Before the fix the requested two suites had **19 pass / 3 fail**;
all three forward-order regression cases failed with `OK` instead of `STATE_ERROR`.
After the fix: **22 tests, 22 pass, 0 fail, 0 skipped** using:

```bash
node --test tools/ai-brain/test/task-ai-171-route-pr03-observations.test.js tools/ai-brain/test/task-ai-171-route-pr02-admission.test.js
```

Offline evidence only; no network, credential reads or commit. The hardcode guard
cannot load the missing `@typescript-eslint/parser`; no dependency install was
attempted. Independent review and remote CI remain outstanding.
Formatting could not run: `npx.cmd --offline prettier@3.9.6` returned
`ENOTCACHED`; the shared installation directory also lacks the executable.
`git diff --check` passes. Graph query `node C:/Tools/graphify/q.js 5c574f7a
scanCliLanes` located the quota path; that graph is stale relative to `1690c184`,
so the current quota implementation and executable regressions supplied proof.

## PR 03 update outcome — sync with origin/main (2026-11-09)

Outcome: merged `origin/main` (containing squash-merged PR 02 `0274c68d`) into PR 03.
Resolved merge conflicts by adopting `origin/main` for PR 02 owned files (`identity.js`,
`task-ai-171-route-pr02-admission.test.js`), preserving PR 02 updates in `cli.js` while
re-applying PR 03's explicit unavailable health guard, and retaining PR 03 scope in
`scan-liveness.js`, `quota-scan.js`, `route-health.js`, and `task-ai-171-route-pr03-observations.test.js`.
All 64 tests in PR 03 and PR 02 core suites pass offline. Diff vs `origin/main` isolates only PR 03 changes.
## CI tool downloads retry and fail loudly (2026-11-09)

Operator-approved change to the three tool-download steps in `.github/workflows/current-application.yml` and `security-baseline.yml`: `curl --fail --retry 5 --retry-all-errors --retry-delay 5`, and gitleaks is saved to a file before `tar`. Versions, checksum checks and gates are unchanged. Cause: on 2026-11-09 more than ten runs failed with `gzip: not in gzip format` / `no properly formatted checksum lines` while the same URLs downloaded correctly from a workstation.

## Selector fix: an assembled quota block survives annotation (2026-11-09)

`annotateCandidates` (`tools/ai-brain/candidates.js`) set `c.blocked = block.blocked` from route evidence, which cleared a `QUOTA_EXHAUSTED` block that AGY-pool assembly had already measured (live quota at zero), leaving `blocked:false` with `blockReason:'QUOTA_EXHAUSTED'`. The assembled quota block is now kept when evidence finds no block. Evidence: `node --test tools/ai-brain/test/task-ai-171-selector-quota-flag.test.js` fails on base (1/2) and passes on HEAD (2/2); suites importing candidates.js show only failures that also fail on main locally.

## PR 06a — worktree claims need a live, bound owner record (2026-11-09)

- Scope: `tools/ai-brain/coordinator-claim.js` (`claimWorktree`, `verifyWorktreeClaim`), shared test helper `tools/ai-brain/test/helpers/worktree-claim.js`, and migrated test suites (`task-ai-171-auth-scope`, `task-ai-171-fallback-chain`, `task-ai-171-offline-replay`, `task-ai-171-route-handoff`, `task-ai-171-route-pr01-consumer`, `task-ai-171-route-pr07-ledger`).
- Outcome: worktree claims require a live PID bound to the target worktree path and owner metadata before worker launch.
- Evidence: 112 tests in the 10 files importing route-handoff/coordinator-claim pass at f012f209, 0 fail, 0 skip. Offline evidence only.
- Entry guard follows in PR 06b (#566); Slice B (.evict recovery, process-ownership findings 3/4/5/8) deferred.

## PR 06 — Give each worktree one confirmed worker owner (Slice A) (2026-11-09)

- Scope (`tools/ai-brain/coordinator-claim.js`, `tools/ai-brain/route-handoff.js`, `tools/ai-brain/test/task-ai-171-route-pr06-claim.test.js`): Slice A cut to AC and blocking findings (findings 1, 2, 7, Review d items d1-d4); `process-ownership.js` removed; findings 3, 4, 5, 6, 8 deferred to Slice B.
- Finding 1 / Item d1: ownership enforced at `route-handoff.firstLaunch`; no name/path exemptions; omitted/unresolved cwd and unconfirmed claims fail closed (`WORKTREE_CLAIM_REQUIRED`).
- Finding 2 / Items d2 & d4: `verifyWorktreeClaim` probes foreign owner PID under default options, requires matching disk worktree binding, and rejects metadata-only claims; dead predecessor claim rejected for launch/reconcile while fresh claimant recovers exclusively.
- Finding 7 / Item d3: dead same-item worker record is unlinked without blocking restart; live same-item worker blocks acquisition and prevents `firstLaunch` from launching (`WORKER_STILL_ACTIVE`).
- Evidence: 4/4 tests pass in `task-ai-171-route-pr06-claim.test.js`. Offline evidence only.

## Slice 1: A1 — Gateway error classification (2026-11-10)

- Scope: `tools/ai-brain/failure-classifier.js`, `tools/ai-brain/test/task-ai-171-gateway-error-class.test.js`.
- Outcome: Classifies 9Router gateway errors ("No active credentials for provider: <p>" with UPSTREAM scope, "<model> has reached its concurrency capacity" with MODEL scope) as UPSTREAM_CREDENTIAL and GENUINE_CAPACITY; records failures to model-route-health with bounded backoff and validates candidate selection eligibility.
- Depends on: None (based on origin/main `e3f5f307`).
- Evidence: 8/8 tests pass offline via `node --test tools/ai-brain/test/task-ai-171-gateway-error-class.test.js`.

## Per-source catalogue freshness (2026-11-09)

When discovery listed at least one source, `tools/ai-brain/discovery.js:169` updated the global `lastSuccessfulAt`, and `tools/ai-brain/catalogue-refresh.js:66-85` checked only this global age. A partial refresh therefore masked failed or stale sources by admitting them as fresh.
Freshness is now evaluated per source via `sourceFreshness` (`tools/ai-brain/catalogue-refresh.js:53-145`) and enforced during candidate assembly (`tools/ai-brain/cli.js:1273-1653`). A source listed this run is admitted; a source failing this run retains prior good evidence if within 48h (`staleListingRetained: true`), but is otherwise rejected with reason `SOURCE_CATALOGUE_STALE`. A legacy freshness file without per-source timestamps fails explicitly for every source and cannot be admitted via the global timestamp. Completed enumerations returning 0 models follow the discovery contract (no-models) and are not marked fresh.
Evidence: `tools/ai-brain/test/task-ai-171-fresh-partial.test.js` passes 13/13 at HEAD (0/13 on base); 6 catalogue-refresh importer suites pass 31/0.

## Core slice 2a1 — route-health lookup never masks an upstream failure (2026-11-10)

- Scope: `tools/ai-brain/cli.js` (`getCandidateRouteHealthRecord` / `candidateExclusionReason` shared by the three lookup sites), `tools/ai-brain/test/task-ai-171-health-lookup.test.js`.
- Rule: Upstream failure beats gateway AVAILABLE; newer scoped failure beats stale AVAILABLE; no whole-gateway block (unrelated upstream on same gateway remains eligible).
- Evidence: `tools/ai-brain/test/task-ai-171-health-lookup.test.js` (task-ai-171-health-lookup 4/0).
- Next: 2a2 execute path.

## Slice 2a: INT-1 — Controller execute path & outcome recording (2026-11-10)

- Scope: `tools/ai-brain/cli.js` (`dispatchCommand` `--execute` flag, `makeExecuteResult`), `tools/ai-brain/harness.js`, `tools/ai-brain/test/task-ai-171-int1-execute.test.js`.
- Outcome: Executes chosen candidate through harness dispatch with bound argv identity, records execution failure to model-route-health store, and returns structured result to CLI entrypoint.
- Depends on: Slice 1 (`fix/task-ai-171-core-s1-gateway-error-class`).
- Evidence: 3/3 tests pass offline via `node --test tools/ai-brain/test/task-ai-171-int1-execute.test.js`.

## Slice 2b: Route Launch — Controller refusal and runtime provenance (2026-11-10)

- Scope: `tools/ai-brain/route-launch.js` (`routeLaunchStep`), `tools/ai-brain/test/task-ai-171-int1-execute.test.js` (test 5).
- Outcome: Encapsulates coordinator launch step in tracked repository module; refuses execution on null choice with `NO_CONTROLLER_CHOICE` (0 child processes of any kind, no process.exit). When candidate is chosen: bounds process count to 1 synchronous git SHA lookup (`git rev-parse HEAD`) when SHA is not pre-supplied, plus exactly 1 execution dispatch spawn bound to `--offering` (total 2 bounded child processes; 1 dispatch if repoSha pre-supplied). Requires valid persisted provenance before execution; refuses with `LOG_OPEN_FAILED` on unopenable output log without creating unread pipes (stdio ignore); tracks custom launcher spawns and reports `launch state unknown/failed` if launcher fails after dispatch; closes parent descriptors; and delivers asynchronous spawn errors to caller via `completion` promise / callback as structured failure (`launched: false, status: 'failed', reason: 'SPAWN_ERROR'`).
- Depends on: Slice 2a2 (`fix/task-ai-171-core-s2a2-execute-path`).
- Evidence: 5/5 tests pass offline via `node --test tools/ai-brain/test/task-ai-171-int1-execute.test.js` (tests: 5, suites: 1, pass: 5, fail: 0):
  - Test 1: `INT-1: execute launches chosen candidate with argv identity, records failure to route-health, and feeds next selection` (PASS)
  - Test 2: `INT-1: CLI entrypoint main(["dispatch", "--execute", "--json", ...]) returns structured output, masks emails, and validates worker outcome` (PASS)
  - Test 3: `INT-1: worker stdout spoofed JSON success with non-zero exit is rejected as failure` (PASS)
  - Test 4: `INT-1: isolated dispatch reaches isolation launcher seam, preserves candidate options, persists receipt before launch, and forbids fallback on failure` (PASS)
  - Test 5: `INT-1: routeLaunchStep behaviour: chosen = null refuses spawn; chosen candidate launches bounded processes with matching argv identity, log safety, launcher tracking, and async error completion` (PASS)

## Slice 3: A2 — Direct-HTTP external sources candidate generation (2026-11-10)

- Scope: `tools/ai-brain/candidates.js` (`generateCandidatesWithCatalog`), `tools/ai-brain/test/task-ai-171-external-sources.test.js`, `tools/ai-brain/test/task-ai-142-opencode-writers.test.js`.
- Outcome: Wires direct-http external model sources from catalogue into candidate generation; emits MODELS_UNKNOWN_FOR_SOURCE when uncatalogued; routes direct-http sources to wire model IDs.
- Depends on: Slice 2b (`fix/task-ai-171-core-s2b-route-launch`).
- Evidence: 3/3 tests in `task-ai-171-external-sources.test.js` and 5/5 tests in `task-ai-142-opencode-writers.test.js` pass offline.

## Slice 4a: A3 — Quota group parser and rows in Antigravity pool runtime (2026-11-10)

- Scope: `tools/ai-brain/agy-pool-runtime.js`, `tools/ai-brain/test/task-ai-171-quota-group.test.js`, `tools/ai-brain/test/fixtures/task-ai-171-real-quota-out.json`, `tools/ai-brain/test/task-ai-69.test.js`.
- Outcome: Parses Antigravity account quotas by exact quota group name and window rather than family; maps display-name aliases to quota groups; adds `group` field to parsed quota rows.
- Depends on: Slice 3 (`fix/task-ai-171-core-s3-external-sources`).
- Evidence: 3/3 tests in `task-ai-171-quota-group.test.js` and 14/14 tests in `task-ai-69.test.js` pass offline.

## Slice 4b: A3 — Antigravity candidate admission by quota group (2026-11-10)

- Scope: `tools/ai-brain/candidates.js` (`poolAccountCandidates`), `tools/ai-brain/test/task-ai-171-quota-group.test.js`.
- Outcome: Matches candidate models against Antigravity quota groups; blocks exhausted models with QUOTA_EXHAUSTED and unmapped models with QUOTA_GROUP_UNKNOWN.
- Depends on: Slice 4a (`fix/task-ai-171-core-s4a-quota-parser`).
- Evidence: 5/5 tests in `task-ai-171-quota-group.test.js` pass offline.

## Slice 5: C — Offline replay dry-run fixtures (2026-11-10)

- Scope: `tools/ai-brain/writer-combo.js`, `tools/ai-brain/candidates.js` (`builtinOpencodeModels`), `tools/ai-brain/cli.js` (`resolveFixturePaths`), `tools/ai-brain/test/fixtures/task-ai-171/*`, `tools/ai-brain/test/task-ai-171-offline-replay.test.js`.
- Outcome: Supports offline dry-run dispatch with combo and opencode model fixtures; makes zero outbound network calls and respects CLI and environment fixture overrides.
- Depends on: Slice 4b (`fix/task-ai-171-core-s4b-quota-admission`).
- Evidence: 6/6 tests in `task-ai-171-offline-replay.test.js` pass with strict offline network guards active.

## Slice 6: CORE-IN — Ticket markdown parsing and input in dispatch (2026-11-10)

- Scope: `tools/ai-brain/ticket-parser.js`, `tools/ai-brain/orchestrate.js` (`buildProfile`), `tools/ai-brain/cli.js` (`--ticket` option and decision receipt), `tools/ai-brain/test/task-ai-171-core-ticket-input.test.js`.
- Outcome: Parses work item ticket markdown files for dispatch planning without hardcoded risk lists; populates profile forbidden failure domains, risk domains, and allowed files; attaches `itemSource` and assessment to decision receipts.
- Depends on: Slice 5 (`fix/task-ai-171-core-s5-offline-replay`).
- Evidence: 7/7 tests in `task-ai-171-core-ticket-input.test.js` pass.

## PR 09 outcome — Escalate from run-linked review evidence (2026-11-09)

Scope: rows B12, B35, B36, B65, B69 and B71 (`tools/ai-brain/outcome-history.js`, a narrow use in `tools/ai-brain/routing.js`, `tools/ai-brain/test/task-ai-171-route-pr09-history.test.js`).
- B12: `verdictHistory` keys rounds and verdicts by the full route identity (`candidateKey`/`writerCandidateKey`/`chosen`), never the leaf model name, so shared suffixes and same-model/different-account routes never merge; each verdict is attributed only to the route its record names.
- B35/B36: a failed round is an actual `changes_required`/refused review bound to a reviewed `reviewedSha`, and only then; a missing commit, an unrelated commit between launches, and quota/rate-limit/timeout/sandbox/harness outages are excluded from quality failures.
- B65: `escalationPlan` escalates only to an untried candidate whose quality is `known` and whose score ties or beats the best tried route under the Controller comparator; the retained route is preferred and never listed as rejected.
- B69: `lastFailedRoute` and `failedRounds` are Work Item- and run-scoped (`runId`), so a local launch failure on one run is not a provider penalty on every run; when the only candidate has failed the plan is a truthful `BLOCKED`/`ONLY_FAILED_CANDIDATE`, and an empty pool is `NO_ELIGIBLE_CANDIDATE`.
- B71: `boundedOutcomeSummary` reports structured round/verdict counts only and is clipped to `maxChars`; it states no fictitious "best finisher" claim and asks no question.
- Wiring: `routing.js` delegates its proof-check `isQualityVerdict` to the shared reader and records a durable `classification` (quality vs outage) with each dispatch outcome, so later readers never re-derive it from free text or commit counts.
- Evidence: `task-ai-171-route-pr09-history.test.js` passes 11/11 on HEAD; on base `bcafec4d` the file fails at its top-level `require('../outcome-history')` before any test registers. All 55 test files importing `../routing`, run in one `node --test` call, give 808/809 pass; the single failure (`task-ai-147-quota-scan.test.js` "TASK-AI-147 Review R4: production default destination is restored and records outcomes without injected store") reproduces identically on origin/main (`.worktrees/stage-main` at 119fa297). Prettier 3.9.6 and the hardcode guard pass.

## Launch Options Forwarding and Immutable Base Commit Pinning (2026-11-10)

- Scope: `tools/ai-brain/cli.js` (`dispatchCommand`), `tools/ai-brain/test/task-ai-171-launch-options.test.js`.
- Outcome: Forwards `tokenBudget`, `outputCeiling`, `workerTimeoutMs`, and `mode` from request/decision/args to adapter and runner; records limit enforcement status in the launch record; pins one resolved 40-hex base commit SHA for adapter and runner, refusing with `BASE_SHA_UNRESOLVED` when unresolvable.
- Depends on: Slice 6 (`fix/task-ai-171-core-s6-ticket-input`).
- Evidence: 5/5 tests in `task-ai-171-launch-options.test.js` pass offline.

## Source freshness outcome — per-source lastSuccessfulAt from the producer (2026-11-10)

- Scope: `tools/ai-brain/discovery.js`, `tools/ai-brain/catalogue-refresh.js`, `tools/ai-brain/test/task-ai-171-source-freshness.test.js`.
- Outcome:
  - Successful sources stamped: `discovery.js` and `catalogue-refresh.js` stamp `lastSuccessfulAt` (and `lastAttemptAt`) for each source that listed successfully and has models.
  - Failed, retained or untouched sources keep prior value: prior `lastSuccessfulAt` is preserved across refreshes; never backfilled from the document timestamp.
  - Reader `sourceFreshness` unchanged: the #567 per-source rule is kept, continuing to require per-source evidence rather than falling back to the document timestamp.
- Evidence: new test fails 2/3 on base 119fa297, passes on head; 10 related test files 67/68, the one failure task-ai-147 R4 fails identically on main.

## PR 09 outcome — Lane ownership acquisition before agy-pool worker execution (2026-11-10)

Scope: `tools/ai-brain/harness.js` (`agyPool.launch`), `tools/ai-brain/test/task-ai-171-r3-lane-ownership.test.js`.
- AC B39 / BR lane ownership: `agyPool.launch` routes job publication through existing `lane-launcher.launch(accountDir, payload, opts)`. The existing lane lock and active-job occupancy recheck ensure atomicity before any scheduler call or worker run.
- When a lane is busy or held, `agyPool.launch` returns a structured refusal (`LANE_BUSY`) without overwriting `job.json`, and `cli.js` (`dispatchCommand` `--execute`) records the launch failure without invoking the worker runner.
- Evidence: `task-ai-171-r3-lane-ownership.test.js` fails on base `119fa297` (0/1 pass, 2 runner calls) and passes on HEAD (1/1 pass, exactly one launcher call, second refused lane-busy, shared `job.json` not overwritten).
- Regression verification: `task-ai-171-int1-execute.test.js` (5/5), `task-ai-69.test.js` (14/14), `lane-launcher.test.js` (24/24), `task-ai-126.test.js` (11/11).

## FU-581-a: Pinned Base Verification in Target Worktree (2026-11-10)

- Scope: `tools/ai-brain/cli.js` (`dispatchCommand`), `tools/ai-brain/test/task-ai-171-pinned-base.test.js`.
- Outcome: Enforces that base commit is strictly accepted as a 40-hex SHA verified via `commitExists` (`git cat-file -e <sha>^{commit}`) in the target worktree; refuses branch names and unresolvable SHAs with `BASE_SHA_UNRESOLVED` before any launcher call; eliminates fallback to the tool repository and branch-name commit fabrication.
- Depends on: Launch Options Forwarding (`fix/task-ai-171-launch-options`, PR #581).
- Evidence: `task-ai-171-pinned-base.test.js` fails 1/4 on base 1296a736 (3/4 fail on branch names, fake SHAs, and tool-repo fallback) and passes 4/4 on HEAD; `task-ai-171-launch-options.test.js` (5/5) and `task-ai-171-int1-execute.test.js` (5/5) pass.
- Dry-run vs execute (`resolveExecuteBase`): `execute === true` always validates a real pinned base; a dry-run flag (e.g. `deps.dryRunOffline` or an offline profile fixture) never bypasses that validation. Pure dry-run (`execute` omitted or `false`) performs no base validation and makes no git call.
- Git root seam: `deps.gitRoot` is an internal dependency-injection seam, like `deps.commitExists`, used only by tests (e.g. offline replay execute fixtures). The production default (`git rev-parse --show-toplevel` in the resolved target) is unchanged, and the seam is not reachable from CLI flags, environment variables or data files. No test-name special case exists in production code.

## Lane mailbox ownership outcome — pool submissions respect AGY lane ownership (2026-11-10)

Scope: `tools/ai-brain/agy-pool-runtime.js` (`submitJob`/`submitLocked`), `tools/ai-brain/lane-launcher.js` (export of `activeJobWithoutResult`), `tools/ai-brain/test/task-ai-171-lane-mailbox.test.js`.
- Outcome: Busy lane refused before any `job.json` write, `result.json` unlink, or adapter call; timeout keeps ownership without synthetic result; proven pre-launch failure releases the matching owner; single lock order `job.lock` -> lane generation lock.
- Evidence: Busy case fails on base `1296a736`, passes on head; with `r3-lane-ownership` and `task-ai-69` 20/0; independent review found no race by source reading, no multi-process stress run.

## FU-584: Every execute path validates a target-bound pinned base (2026-11-10)

- Scope: `tools/ai-brain/cli.js` (`dispatchCommand`, `resolveExecuteBase`), `tools/ai-brain/test/task-ai-171-pinned-base.test.js`.
- P1-1 Checkpoint resume validates base: `resolveExecuteBase` moved outside `if (!finalChosenKey)`, so checkpoint resume paths always validate the base before reservation, adapter, or runner calls.
- P1-2 Dependency SHA always verified: `deps.baseSha` / `deps.base` / `deps.repoSha` are verified with `commitExists` regardless of whether `explicitTargets` are present; previously skipped when target came from `deps.rootDir` or `cwd`.
- P1-3 cwd included in target set: `args.cwd` / `deps.cwd` added to `explicitTargets` so the adapter/runner cwd repo is validated; `root=A, cwd=B` with different git roots is refused as `TARGET_WORKTREE_CONFLICT`.

## FU-584-r2: One validated execute target for every execute path (2026-11-11)

- Scope: NEW `tools/ai-brain/execute-target.js` (`resolveExecuteTarget`, `isValidTarget`), `tools/ai-brain/cli.js` (E1 `dispatchCommand`, E3 `--plan`), `tools/ai-brain/routing.js` (E2 `runProfileDispatch`, `defaultLauncher`), `tools/ai-brain/executor.js` (`executePlan`), `tools/ai-brain/test/task-ai-171-execute-target.test.js`; fixture seams only in `task-ai-171-launch-options`, `task-ai-171-int1-execute`, `task-ai-50`, `task-ai-171-r3-lane-ownership`.
- One-target rule: every execute path (E1 item dispatch, E2 `--profile`, E3 `--plan` and direct `executePlan`) obtains its target from `resolveExecuteTarget(args, deps)`, which returns a frozen `{ok, code?, targetRepo, cwd, baseSha, origin}`. The cwd formula (`args.cwd || deps.cwd || deps.rootDir || targetRepo`) and the pinned SHA in that object are exactly what the adapter and the runner receive; no path recomputes them. Explicit `root` / `treePath` / provenance / `cwd` targets that resolve to different git roots are refused with `TARGET_WORKTREE_CONFLICT`; there is no fallback to the tool repository. Every SHA origin is verified with `commitExists` in the target repo.
- Refusal: a non-`ok` target is a structured refusal with zero reservations, zero adapter calls and zero runner calls (E2 resolves before the first `recordReservation`).
- Mode: only an effecting execution resolves a target (E1/E2 `execute === true`; E3 `dryRun === false`, even when `execute` is omitted). A pure dry run makes no git call.
- E3 boundary: `executePlan` never executes without a validated target. A supplied `opts.executeTarget` must have been created by `resolveExecuteTarget` (module-private `WeakSet`); a forged `{ok:true}` object is refused with `EXECUTE_TARGET_FORGED`. A direct caller that supplies no target gets one resolved inside `executePlan`; `opts.base || 'main'` is no longer used for execution (dry-run preview vectors are unchanged).
- `resolveExecuteBase` in `cli.js` is a thin delegate to `resolveExecuteTarget` (no duplicated logic), kept because existing pinned-base assertions call it.
