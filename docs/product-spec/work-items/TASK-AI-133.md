# TASK-AI-133 — Governed merge accepts the Controller's independent exact-SHA review, so a PASS item merges without the supervisor

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-133` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `245` |
| Dependencies | `TASK-AI-128` |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `tools/ai-brain/governed-merge.js`; `tools/ai-brain/data/merge-config.json`; `tools/ai-brain/cli.js`; `tools/ai-brain/orchestrate.js`; `scripts/ai/control.ps1`; `tools/ai-brain/test/task-ai-133.test.js`; `docs/product-spec/work-items/TASK-AI-133.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-133-governed-merge` |
| Pull Request | `Pending` |

## Business Outcome

Scripts/ai/control.ps1 (TASK-AI-13) already performs a fail-closed exact-HEAD auto-merge with expectedHeadOid squash mutation, but only trusted a chatgpt-codex-connector[bot] PASS verdict. With Codex out of usage until 2026-11-06, PRs have been reviewed by independent non-Codex reviewers via the Controller review loop and merged manually under the operator standing authorization (2026-10-04).

TASK-AI-133 implements governed exact-HEAD auto-merge on the brain side (`node tools/ai-brain/cli.js merge --work-item <ID>`), accepting the Controller's validated exact-SHA review manifest when CI is green and there are zero open P0/P1 findings and zero unresolved review threads.

GM-R01: merges only when all preflight gates pass (validated review manifest PASS on exact SHA, reviewer in separate failure domain from all writers, 0 open P0/P1 findings, required GitHub checks SUCCESS on exact OID, 0 unresolved threads, not draft, title carrying exactly that Work Item ID, not on never-merge config list, squash mutation with expectedHeadOid).

GM-R02: allows a merge commit of origin/main only when change lines are byte-identical to the reviewed SHA's change lines against its base; otherwise DELTA_REVIEW_REQUIRED.

GM-R03: every refusal is fail-closed, with a named reason written to the decision log, with no retry loops on failed checks.

GM-R04: preserves the Codex-bot path in control.ps1 while adding the Controller review manifest as an additional trusted verdict source under operator standing authorization (2026-10-04).

GM-R05: next-item loop calls merge after publish when the item is eligible.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| GM-R01 | Governed merge preflight gates | PR merged with expectedHeadOid squash mutation only when all gates pass | Test (`task-ai-133.test.js`) |
| GM-R02 | Merge commit of origin/main (branch behind) | Byte-identical change lines allowed; non-identical refused with DELTA_REVIEW_REQUIRED | Test (`task-ai-133.test.js`) |
| GM-R03 | Fail-closed refusal logging | Named refusal reason written to decision log with zero retry loops | Test (`task-ai-133.test.js`) |
| GM-R04 | Additional trusted verdict in control.ps1 | Review manifest PASS accepted without altering Codex-bot path | Test (`task-ai-133.test.js`) |
| GM-R05 | Next-item loop merge integration | Merges after publish when item is eligible | Test (`task-ai-133.test.js`) |
| GM-R06 | Comprehensive offline test suite | Covers all refusal reasons, happy path, byte-identical/non-identical merge | Test (`task-ai-133.test.js`) |
| GM-R07 | Documentation and register row | Spec created and exactly one row 245 appended to register | File and git numstat 1 0 |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-133.test.js`

## Fail-Before / Pass-After

- Fail-before: on `origin/main`, `tools/ai-brain/governed-merge.js` and `tools/ai-brain/test/task-ai-133.test.js` do not exist, and `cli.js merge` is unrecognized.
- Pass-after: `node --test tools/ai-brain/test/task-ai-133.test.js` passes with all tests green.

## Residual Limitations

- Automatic rebase is not executed: when a branch is behind origin/main, the merge commit must already exist and its change lines must be byte-identical to the reviewed diff.
- Live-proof drafts listed in neverMerge config remain permanently blocked from automated merge.
