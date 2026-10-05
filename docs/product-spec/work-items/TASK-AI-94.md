# TASK-AI-94 — Every lane re-selects after a launch failure and counts every launch

## Control

- Work Item ID: TASK-AI-94
- Status: READY_FOR_CODEX
- Assigned authors: agy-pool agy01 (initial), then tokenharbor/gpt-6-luna via opencode (completion after agy quota exhaustion and two ocz timeouts)
- Dependencies: TASK-AI-89
- Supersedes: TASK-AI-91 and TASK-AI-93 (both BLOCKED after exhausting repair budgets); this branch contains their commits up to b284ecc plus the reviewer-lane fix

## Business Outcome

A failing candidate is never retried blindly in any lane: failed keys and failed domains are excluded in writer, repair and reviewer selection, every launch counts toward a shared two-attempt cap per failure domain, failures are recorded once as evidence, and the work item ends BLOCKED with NO_ALTERNATE_FAILURE_DOMAIN when nothing eligible remains.

## Acceptance Matrix

- (TASK-AI-91) F-R01 within one run, a key whose launch failed is excluded from every later selection for the same work item (writer and reviewer lanes).
- (TASK-AI-91) F-R02 the failure is recorded through the existing outcome/evidence path with its classified scope (model, upstream, gateway, account), so that an upstream- or gateway-scoped failure also excludes other candidates in the same canonical failure domain for the rest of the run (reuse routing's canonical failure domain; no second rule).
- (TASK-AI-91) F-R03 at most two attempts per failure domain per work item; when no eligible candidate remains the work item ends BLOCKED with reasonCode NO_ALTERNATE_FAILURE_DOMAIN and the list of tried keys, never an unbounded loop.
- (TASK-AI-91) F-R04 the decision log records each attempt with attempt number, chosen key, failure scope and the excluded set.
- (TASK-AI-91) F-R05 test: fake launcher fails for key A (upstream X) -> next selection is a key outside X; when every candidate fails -> BLOCKED after bounded attempts with NO_ALTERNATE_FAILURE_DOMAIN; the same key is never selected twice.
- (TASK-AI-93) A-R01 domainAttempts is work-item scoped and shared by writer, repair and reviewer selection; the third attempt in a domain is refused and the next candidate outside it is chosen, or the item ends BLOCKED NO_ALTERNATE_FAILURE_DOMAIN.
- (TASK-AI-93) A-R02 a repair-lane launch failure is recorded through the same evidence path and directory as a writer failure.
- (TASK-AI-93) A-R03 tests: writer fails twice in domain X (model scope) then repair must not select X; repair failure appears in the run's evidence data.
- R-R01 after a reviewer launch failure, the next review round re-selects a reviewer excluding failed keys and excluded domains; the failed reviewer is never launched again for that work item.
- R-R02 every reviewer launch (not only the first selection) counts once toward the shared per-domain attempt cap; a third reviewer launch in one domain is refused and the lane falls back or the item ends BLOCKED NO_ALTERNATE_FAILURE_DOMAIN.
- R-R03 tests: reviewer R fails in round 1 -> round 2 uses a different reviewer; three reviewer failures in one domain -> no fourth launch in that domain.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-94.test.js tools/ai-brain/test/task-ai-93.test.js tools/ai-brain/test/task-ai-91.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

- cli.applyFailureBlocks still applies its own domain rule (out of scope; follow-up).
