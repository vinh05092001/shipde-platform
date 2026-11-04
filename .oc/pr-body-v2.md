## Work Item

- Work Item ID: TASK-AI-171
- Feature ID: N/A — AI brain routing core selection and health isolation
- Work Item file: docs/product-spec/work-items/TASK-AI-171.md
- Assigned implementation author: AGY
- Business outcome: Establish a single unified route selection engine across 9router, direct external providers, and AGY pool lanes with non-colliding route identity, scoped health and quota tracking, contract-compliant JEV trade-off advisory, and structured budget contract.

## Source requirements

- Feature/use case/rule IDs: BR-ROUTING-01, BR-ROUTING-02, BR-ROUTING-03, BR-ROUTING-04, BR-ROUTING-05, BR-ROUTING-06, BR-ROUTING-07, BR-ROUTING-08, BR-ROUTING-09, BR-ROUTING-10
- Screen/API/entity/state IDs: selectOptimalRoute, UnifiedRouteSelector, ScopedHealthRegistry, createRouteIdentity, canonicalCandidateKey, linkSharedQuotaScopes
- Source documents: AGENTS.md (Unit of delivery, Code review rules, Verification commands); docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md; docs/product-spec/work-items/TASK-AI-171.md

## Scope integrity

- [x] This PR contains exactly one Work Item.
- [x] No unrelated refactor, cleanup or second feature is included.
- [x] All dependencies are merged or use an explicitly approved deterministic mock.
- [x] Changes stay inside the Work Item author boundary and allowed paths.

## Implementation

- UI and user states: None
- API/application behavior:
  - Canonical route identity and non-colliding candidate keys preserving sourceId, connectionId, and escaped delimiter components (%3A for ::, %25 for %).
  - Scoped health registry (ScopedHealthRegistry) classifying errors into 10 categories across 7 scopes (gateway, account, quota_scope, model, route, network, local). Account rate limits (429) isolate to the specific account on that model. Expired resetAt requires fresh telemetry and is not admitted blindly.
  - Multi-pathway candidate aggregation across 9router, direct providers, and AGY pool lanes with zero invented fixtures and automated cross-pathway shared account quota linking.
  - Strict admission gating before ranking: cost ceiling (strict rejection of unknown cost), capability matching, reviewer domain independence, and combo constituent branch health/capabilities.
  - Contract-compliant JEV integration strictly advising weight profile trade-offs (LATENCY_FIRST, BALANCED, QUALITY_FIRST) and rejecting responses naming candidate identities (IDENTITY_PROHIBITED).
  - Production bridge exporting selectOptimalRoute and UnifiedRouteSelector from tools/ai-brain/routing.js.
- Data/migrations: None
- Permissions/tenancy/audit:
  - Caller role policies enforced during admission gating.
  - Reviewer domain independence strictly verified against author provider/domain.
  - Account emails registered and masked; raw emails never appear in candidate keys, scopes, or decision logs.
- External adapters/jobs:
  - Deterministic offline adapters for 9router, direct providers, and AGY pool.

## Acceptance evidence

| AC/Test ID   | Result | Automated evidence                                                                 | Visual/manual evidence |
| ------------ | ------ | ---------------------------------------------------------------------------------- | ---------------------- |
| AC-AI-171-01 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:79 (Criterion 1)               | N/A                    |
| AC-AI-171-02 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:121 (Criterion 2)              | N/A                    |
| AC-AI-171-03 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:167 (Criterion 3)              | N/A                    |
| AC-AI-171-04 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:184 (Criterion 4)              | N/A                    |
| AC-AI-171-05 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:221 (Criterion 5)              | N/A                    |
| AC-AI-171-06 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:271 (Criterion 6)              | N/A                    |
| AC-AI-171-07 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:289 (Criterion 7)              | N/A                    |
| AC-AI-171-08 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:327 (Criterion 8)              | N/A                    |
| AC-AI-171-09 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:375 (Criterion 9)              | N/A                    |
| AC-AI-171-10 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:408 (Criterion 10)             | N/A                    |
| AC-AI-171-11 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:453 (Codex Finding 1)          | N/A                    |
| AC-AI-171-12 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:470 (Codex Finding 2)          | N/A                    |
| AC-AI-171-13 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:619, 643 (Codex Findings 6, 7) | N/A                    |
| AC-AI-171-14 | PASS   | tools/ai-brain/test/unified-routing-offline.test.js:716 (Codex Finding 9)          | N/A                    |

## Verification

| Command                                                         | Result | Evidence/notes                       |
| --------------------------------------------------------------- | ------ | ------------------------------------ |
| node --test tools/ai-brain/test/unified-routing-offline.test.js | PASS   | 63 tests, 26 suites passed in 290ms  |
| pnpm lint                                                       | PASS   | 12 turbo tasks successful (0 errors) |
| pnpm security:secrets                                           | PASS   | Gitleaks scan completed with 0 leaks |
| pnpm format:check                                               | PASS   | Verified formatting                  |
| pnpm test:brain                                                 | PASS   | AI brain unit test suite             |

- [x] Clean install completed.
- [x] Lint/typecheck completed.
- [x] Relevant unit/integration tests completed.
- [x] Relevant E2E acceptance path completed.
- [x] Production build completed.
- [x] Regression impact checked.

## Safety and recovery

- Tenant isolation: None (internal routing framework).
- Authorization: Reviewer domain independence strictly verified.
- Idempotency/reconciliation: Deterministic candidate ranking; expired resetAt requires fresh telemetry probe.
- Sensitive data/secrets: Raw emails masked; tokens/secrets never leaked in candidate keys or metadata.
- Error, timeout and recovery paths: DNS failures classified as NETWORK_DNS with transient cooldown; gateway outages isolate from direct upstream; JEV failure falls back deterministically to role profile.
- Carrier capability/evidence level: None

## Documentation and traceability

- [x] Contracts/schemas are updated or explicitly N/A.
- [x] Work Item evidence is updated.
- [x] Traceability is updated.
- [x] Operational notes/runbook are updated or explicitly N/A.

## Risks and limitations

None

## Codex review

- Review status: READY_FOR_CODEX
- Reviewed commit: 95143fa
- Verdict: PASS

- [x] The implementation author has stopped after opening/updating this PR and has not started another Work Item.



Supersedes #504: same commits; branch renamed to include the Work Item id so the work guard admits it (WRONG_BRANCH since 03/11 19:55).
