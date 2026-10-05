# TASK-AI-93 — Per-domain attempt cap and failure evidence apply to every lane

## Control

- Work Item ID: TASK-AI-93
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION agy-pool agy01 (google)
- Dependencies: TASK-AI-89
- Scope amendment: diff budget 200 raised to 550 (repair round 1 added reviewer-lane tests)
- Supersedes: TASK-AI-91 (BLOCKED: repair budget 2/2 exhausted with one confirmed open P1); this branch contains the TASK-AI-91 commits up to 92f710a plus the remaining fix

## Business Outcome

A failing candidate is never retried blindly: failed keys and failed domains are excluded in writer, reviewer and repair selection, at most two attempts per failure domain per work item across all lanes, and repair failures are recorded like writer failures.

## Acceptance Matrix

- (from TASK-AI-91) F-R01 within one run, a key whose launch failed is excluded from every later selection for the same work item (writer and reviewer lanes).
- (from TASK-AI-91) F-R02 the failure is recorded through the existing outcome/evidence path with its classified scope (model, upstream, gateway, account), so that an upstream- or gateway-scoped failure also excludes other candidates in the same canonical failure domain for the rest of the run (reuse routing's canonical failure domain; no second rule).
- (from TASK-AI-91) F-R03 at most two attempts per failure domain per work item; when no eligible candidate remains the work item ends BLOCKED with reasonCode NO_ALTERNATE_FAILURE_DOMAIN and the list of tried keys, never an unbounded loop.
- (from TASK-AI-91) F-R04 the decision log records each attempt with attempt number, chosen key, failure scope and the excluded set.
- (from TASK-AI-91) F-R05 test: fake launcher fails for key A (upstream X) -> next selection is a key outside X; when every candidate fails -> BLOCKED after bounded attempts with NO_ALTERNATE_FAILURE_DOMAIN; the same key is never selected twice.
- A-R01 domainAttempts is work-item scoped and shared by writer, repair and reviewer selection; the third attempt in a domain is refused and the next candidate outside it is chosen, or the item ends BLOCKED NO_ALTERNATE_FAILURE_DOMAIN.
- A-R02 a repair-lane launch failure is recorded through the same evidence path and directory as a writer failure.
- A-R03 tests: writer fails twice in domain X (model scope) then repair must not select X; repair failure appears in the run's evidence data.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-93.test.js tools/ai-brain/test/task-ai-91.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

- cli.applyFailureBlocks still applies its own domain rule (out of scope; follow-up).
