# TASK-AI-102 — Draft pull requests carry the reviewed evidence

## Control

- Work Item ID: TASK-AI-102
- Status: READY_FOR_CODEX
- Assigned author: tokenharbor/gpt-6-luna via opencode
- Dependencies: None
- Branch: feat/task-ai-102-governed-draft

## Business Outcome

Draft Pull Requests opened by the live loop now retain the reviewed manifest, artifact, reviewer/writer candidates, findings, tests, fail-before evidence, and decision-log location. The generated draft body follows the repository PR contract and identifies the exact reviewed commit, making the draft a reviewable evidence handoff.

## Acceptance Matrix

| Requirement | Result | Evidence |
|---|---|---|
| PB-R01 caller title fields merge with checkpoint/manifest evidence | PASS | `tools/ai-brain/test/task-ai-102.test.js` orchestration handoff test |
| PB-R02 drafts refuse missing reviewer and decision evidence | PASS | Focused publisher refusal test |
| PB-R04 PASS with open findings is refused | PASS | Focused open-finding test and manifest validator |
| PB-R05 generated body includes required headings, status, SHA, and evidence | PASS | Focused body test with stubbed `gh` |
| PB-R06 only specified implementation files change | PASS | Reviewed diff |
| PB-R07 tests use temporary data and stubbed GitHub CLI | PASS | Focused Node test |
| PB-R08 Work Item and register row are present | PASS | This file and delivery register |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-102.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `./node_modules/.bin/prettier --write tools/ai-brain/publisher.js tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-102.test.js docs/product-spec/work-items/TASK-AI-102.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Residual Limitations

- None.
