# GOAL-AUTOCLAW-REPOS-3 — Nhóm 2 - Workflow và skills

## Control

| Field | Value |
|---|---|
| Work Item ID | `GOAL-AUTOCLAW-REPOS-3` |
| Feature ID | `GOAL-AUTOCLAW-REPOS` |
| Status | `BACKLOG` |
| Delivery order | `255` |
| Dependencies | `GOAL-AUTOCLAW-REPOS-1` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-2-WORKFLOW.md`, `tools/ai-brain/test/repo-integration-group-2.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/goal-autoclaw-repos-3-impl` |
| Pull Request | `Pending` |

## Business outcome

> Ghi và kiểm bằng chứng gắn nhóm 2 (workflow và skills), gate thực nằm ở Controller chứ không chỉ prompt.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-2-WORKFLOW.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-2-WORKFLOW.md`, `tools/ai-brain/test/repo-integration-group-2.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 2 - Workflow và skills.
- Unit and integration verification commands matching acceptance criteria.

## Out of scope

- Modifying unallowed paths or inventing business rules.

## Business rules and edge cases

- Strict adherence to repository baseline and source specifications.

## UI states

- Full state coverage where UI is affected; N/A for pure backend.

## API, event and data impact

- Safe contract and schema handling within allowed paths.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-1 | Repo/package + version/ref: obra/superpowers, Fission-AI/OpenSpec, pbakaus/impeccable, cli/cli. | Passes automated verification | Automated check passes |
| AC-2 | Năng lực: planning/systematic debugging/verification; spec/change proposals và validation; design context/UI critique; đọc tạo PR issues CI và evidence GitHub. | Passes automated verification | Automated check passes |
| AC-3 | Trigger: loại việc (plan, debug, review, UI task, PR evidence). | Passes automated verification | Automated check passes |
| AC-4 | Adapter/caller tái dùng (không tạo trùng): skill loader hiện có, tools/ai-brain/facts.js, tools/ai-brain/decisions.js; spec ID nằm trong Work Item. | Passes automated verification | Automated check passes |
| AC-5 | Hợp đồng vào/ra: Work Item -> skill phù hợp loại việc; spec ID/paths -> validation trong checks; repo/branch/SHA/check status -> evidence. | Passes automated verification | Automated check passes |
| AC-6 | Task chạy thực + artifact: loader chọn skill và chạy validation trong checks; không tạo spec authority thứ hai. | Passes automated verification | Automated check passes |
| AC-7 | Trạng thái: DECLARED; chỉ lên WIRED/EXECUTION_VERIFIED/ACCEPTED khi có test và SHA; limitation: không tự suy quyền merge từ quyền tạo PR. | Passes automated verification | Automated check passes |
| AC-8 | Test passes: tools/ai-brain/test/repo-integration-group-2.test.js | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-2.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `Pending` | `Pending` |

## Residual limitations

None.
