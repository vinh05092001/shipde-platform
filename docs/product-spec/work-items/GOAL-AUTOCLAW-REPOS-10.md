# GOAL-AUTOCLAW-REPOS-10 — Nhóm 9 - Ứng viên đối chứng (DECLARED, chưa triển khai)

## Control

| Field | Value |
|---|---|
| Work Item ID | `GOAL-AUTOCLAW-REPOS-10` |
| Feature ID | `GOAL-AUTOCLAW-REPOS` |
| Status | `BACKLOG` |
| Delivery order | `262` |
| Dependencies | `GOAL-AUTOCLAW-REPOS-1` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-9-CANDIDATES.md`, `tools/ai-brain/test/repo-integration-group-9.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/goal-autoclaw-repos-10-impl` |
| Pull Request | `Pending` |

## Business outcome

> Ghi DECLARED cho nhóm 9 (ứng viên đối chứng) và KHÔNG tuyên bố thay thế trước phép đo.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-9-CANDIDATES.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-9-CANDIDATES.md`, `tools/ai-brain/test/repo-integration-group-9.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 9 - Ứng viên đối chứng (DECLARED, chưa triển khai).
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
| AC-1 | Repo/package + version/ref (DECLARED): DeusData/codebase-memory-mcp, Nox-HQ/nox. | Passes automated verification | Automated check passes |
| AC-2 | Năng lực: symbol/call-graph/architecture retrieval so Serena; thử từng security scope so gates hiện tại. | Passes automated verification | Automated check passes |
| AC-3 | Trigger: phép đo đối chứng với Serena và với security gates hiện tại. | Passes automated verification | Automated check passes |
| AC-4 | Adapter/caller: chưa wire; ghi rõ phép đo cần có trước khi đổi mặc định. | Passes automated verification | Automated check passes |
| AC-5 | Hợp đồng vào/ra: phép đo -> kết luận; không tuyên bố thay semantic editing trước phép đo. | Passes automated verification | Automated check passes |
| AC-6 | Task chạy thực + artifact: chỉ tài liệu DECLARED và tiêu chí đo; không bỏ scanner cũ trước coverage parity. | Passes automated verification | Automated check passes |
| AC-7 | Trạng thái: DECLARED (không lên INSTALLED trong gói này); limitation: chưa triển khai mặc định. | Passes automated verification | Automated check passes |
| AC-8 | Test passes: tools/ai-brain/test/repo-integration-group-9.test.js | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-9.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `Pending` | `Pending` |

## Residual limitations

None.
