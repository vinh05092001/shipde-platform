# TASK-AI-91 — A failed candidate is not re-selected; bounded fallback across failure domains

## Control

- Work Item ID: TASK-AI-91
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION agy-pool agy01 (google)
- Dependencies: TASK-AI-89

## Business Outcome

Live proof 11 selected the same failing candidate at least three times. A launch failure now excludes that key, and for upstream or gateway scoped failures its whole failure domain, from later selection for the work item; attempts are bounded and end BLOCKED with NO_ALTERNATE_FAILURE_DOMAIN.

## Acceptance Matrix

- F-R01 within one run, a key whose launch failed is excluded from every later selection for the same work item (writer and reviewer lanes).
- F-R02 the failure is recorded through the existing outcome/evidence path with its classified scope (model, upstream, gateway, account), so that an upstream- or gateway-scoped failure also excludes other candidates in the same canonical failure domain for the rest of the run (reuse routing's canonical failure domain; no second rule).
- F-R03 at most two attempts per failure domain per work item; when no eligible candidate remains the work item ends BLOCKED with reasonCode NO_ALTERNATE_FAILURE_DOMAIN and the list of tried keys, never an unbounded loop.
- F-R04 the decision log records each attempt with attempt number, chosen key, failure scope and the excluded set.
- F-R05 test: fake launcher fails for key A (upstream X) -> next selection is a key outside X; when every candidate fails -> BLOCKED after bounded attempts with NO_ALTERNATE_FAILURE_DOMAIN; the same key is never selected twice.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-91.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None recorded by the author; see review.
