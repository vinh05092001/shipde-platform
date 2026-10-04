# TASK-AI-80 — Controller selector defects

## Control

- Work Item ID: TASK-AI-80
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION agy-pool agy02 (google); the Controller catalogue does not yet include agy candidates (defect D1)
- Dependencies: TASK-AI-73, TASK-AI-75

## Business Outcome

The Controller ranks every candidate that has real evidence, produces differentiated scores, treats every spelling of a failure domain the same, and launches exactly the reserved candidate instead of leaving the launch to the supervisor.

## Acceptance Matrix

- E-R01 a candidate whose seven-part key has passed evidence in the evidence store is included in the dispatch candidate list even when it is absent from the discovery catalogue, with harness/accessPath/gateway/upstream/account/quotaScope/modelId taken from the evidence combo; its evidence (proof level, role/task metadata if present) is preserved. Test: import WORK_ITEM_PASS for a key not in the catalogue -> dispatch dry-run ranks it.
- E-R02 rankForProfile computes non-zero, differentiated scores from evidence: quality from passed evidence (WORK_ITEM_PASS > HARNESS_PASS > API_PASS, recency), reliability from pass/fail ratio, latency from recorded ms, cost from known cost; unknown components are reported as null and contribute 0 but are never replaced by a neutral 50.
- E-R03 when every eligible candidate scores 0 the result carries reasonCode MODEL_SELECTION_NOT_PROVEN and --execute refuses to reserve (exit 1) unless --exploration-budget > 0, in which case it records EXPLORATION.
- E-R04 test: three candidates with different evidence get different scores and the best-evidenced ranks first; changing evidence changes the order.
- E-R05 one function canonicalFailureDomain(x) accepts 'ocz', '9router/ocz', a full seven-part key or a candidate object and returns the same canonical value (gateway/upstream); forbiddenFailureDomains entries of any of those forms exclude every candidate in that domain (no alias can re-admit it), and the decision log prints the same canonical form. Reuse/align with publisher.failureDomainFromCandidateKey (import it; do not duplicate a second rule).
- E-R06 dispatch --execute returns a structured launchRequest {candidateKey, harness, accessPath, gateway, upstream, account ('UNPINNED' when the gateway chooses the account), modelId, reservationId} and, when --launch is given, calls an injectable launcher (default: the existing harness/executor adapter) with exactly that request; the launcher must not alter gateway/upstream/account/model.
- E-R07 launch failure releases the reservation (quota-store) and records the outcome against the same reservationId; success records outcome against the same reservationId.
- E-R08 a candidate whose account cannot be pinned is recorded as account 'UNPINNED' everywhere (launchRequest, reservation, decision log), never a guessed account.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-80.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None recorded by the author; see review.
