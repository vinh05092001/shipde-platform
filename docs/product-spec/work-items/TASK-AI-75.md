# TASK-AI-75 — Import merged, independently reviewed work as WORK_ITEM_PASS evidence

## Control

- Work Item ID: TASK-AI-75
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION (opencode xmtp/mimo-v2.6-pro stalled with no diff; switched failure domain to agy-pool agy05)
- Dependencies: TASK-AI-62 (honest proof levels), TASK-AI-73 (WORK_ITEM_PASS floor for coding/review)

## Business Outcome

The Controller can admit a candidate under the WORK_ITEM_PASS floor once that exact candidate has real merged work that an independent reviewer passed on the exact SHA. Without this, the evidence store starts empty and the floor refuses every candidate forever (live proofs 4 and 5 on 2026-10-04: PROOF_FLOOR_NOT_MET for all).

## Source References

- tools/ai-brain/evidence.js (Level, ProofLevel, recordProbe)
- tools/ai-brain/routing.js (proofObserved, PROOF_FLOORS)
- docs/product-spec/work-items/TASK-AI-73.md

## In Scope

- tools/ai-brain/work-evidence.js, CLI `evidence import-work` in tools/ai-brain/cli.js
- tools/ai-brain/test/task-ai-75.test.js and fixtures under tools/ai-brain/test/fixtures/task-ai-75/

## Out of Scope

- Signing or authenticating review files; changes to routing scores; any automatic import.

## Acceptance Matrix

- W-R01 sha must be exactly 40 lowercase hex, else refuse SHA_INVALID.
- W-R02 writer must parse as a 7-part candidate key with non-empty parts, else WRITER_KEY_INVALID.
- W-R03 review file must exist; line 1 must contain the full sha; line 2 must be exactly 'Review verdict: PASS'; else REVIEW_NOT_PASS (or REVIEW_SHA_MISMATCH when line 1 lacks the sha).
- W-R04 sha must be an ancestor of (or equal to) the main ref (git merge-base --is-ancestor), else NOT_MERGED. Squash merges: also accept when the review file names the sha and the main-ref history contains a commit whose message contains '[<work-item>]' — record which path proved it (ancestor|squash).
- W-R05 reviewer must be non-empty and must not equal the writer key, nor share its upstream segment or modelId, else REVIEWER_NOT_INDEPENDENT.
- W-R06 on success call evidence.recordProbe(dir, candidate, {level: 3 (OUTCOME), proofLevel:'WORK_ITEM_PASS', status:'passed', source:'import-work', workItem, sha, reviewer, reviewFile, mergeProof}) so routing proofObserved reports WORK_ITEM_PASS for that exact candidate key and no other.
- W-R07 idempotent: importing the same sha+writer twice adds no second item (returns ALREADY_RECORDED).
- W-R08 every refusal writes nothing to the evidence store; exit code 0 on success/ALREADY_RECORDED, 1 on refusal, 2 on bad argv.
- W-R09 a test proves routing.selectCandidate/rank (whichever exists) rejects the candidate with PROOF_FLOOR_NOT_MET before import and accepts it after import with proofFloor WORK_ITEM_PASS.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-75.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

- Review files are unsigned markdown; trust rests on the supervisor-held review log and the exact-SHA gate.
- The squash path binds the reviewed SHA to main only through the `[<work-item>]` commit message, not a tree comparison.
- The ancestor path does not bind the Work Item ID to the commit message.
