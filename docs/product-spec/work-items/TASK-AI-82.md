# TASK-AI-82 — The orchestrate path ranks evidence-backed candidates

## Control

- Work Item ID: TASK-AI-82
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION agy-pool agy04 (google)
- Dependencies: TASK-AI-80

## Business Outcome

A live run no longer needs the operator to list the right account by hand: candidates with recorded passed evidence take part in writer and reviewer selection, subject to the same floors, forbidden domains and reviewer independence (live proof 6 refused every candidate because evidence sat under an account the inputs did not list).

## Acceptance Matrix

- O-R01 orchestrate's candidate list for writer and reviewer selection includes candidates built by candidates.candidatesFromEvidence from the evidence store (reuse it; no second builder), merged with the accounts/catalogue candidates and deduplicated by the seven-part key.
- O-R02 evidence-only candidates keep their evidence, capabilities and account exactly as recorded; an account that the gateway chooses stays 'UNPINNED'.
- O-R03 forbidden failure domains and reviewer independence apply to evidence-only candidates exactly as to catalogue candidates (reuse routing's canonical failure domain).
- O-R04 test: an evidence store with WORK_ITEM_PASS for key K absent from --accounts/--catalogue -> orchestrate selection ranks and pins K; with K's domain forbidden -> refused with FORBIDDEN_FAILURE_DOMAIN.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-82.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None recorded by the author; see review.
