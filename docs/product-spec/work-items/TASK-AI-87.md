# TASK-AI-87 — Evidence-only candidates carry their account's declared capabilities

## Control

- Work Item ID: TASK-AI-87
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION agy-pool agy06 (google)
- Dependencies: TASK-AI-82, TASK-AI-85

## Business Outcome

Live proof 9 ranked evidence-only candidates but refused them all with CAPABILITY_MISSING because evidence records carry no capabilities; they now inherit the declared capabilities of their bound account and still fail closed when the account is unknown.

## Acceptance Matrix

- C-R01 candidatesFromEvidence(evidenceData, {accounts}) sets capabilities from the account whose id equals the combo accountId (declared capabilities only); combo.capabilities, if present, wins only when the account declares none.
- C-R02 an evidence-only candidate whose account is unknown or 'UNPINNED' keeps capabilities {} and therefore still fails capability floors (fail closed).
- C-R03 live callers (orchestrate buildCandidates/selectCandidateForProfile and cli assembleForDispatch) pass the same accounts list they already use; tests that inject candidates without accounts see no host registry.
- C-R04 test: evidence store with WORK_ITEM_PASS for an xkiro-like key + injected accounts declaring jsonSchema/tools -> the candidate passes the capability floor and is ranked; without the account -> CAPABILITY_MISSING:jsonSchema.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-87.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None recorded by the author; see review.
