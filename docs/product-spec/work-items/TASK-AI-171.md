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
