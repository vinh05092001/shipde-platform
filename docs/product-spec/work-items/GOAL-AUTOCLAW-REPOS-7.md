# GOAL-AUTOCLAW-REPOS-7 — Nhóm 6 - Security

## Control

| Field           | Value                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `GOAL-AUTOCLAW-REPOS-7`                                                                                                                   |
| Feature ID      | `GOAL-AUTOCLAW-REPOS`                                                                                                                     |
| Status          | `BACKLOG`                                                                                                                                 |
| Delivery order  | `259`                                                                                                                                     |
| Dependencies    | `GOAL-AUTOCLAW-REPOS-1`                                                                                                                   |
| Assigned author | `GEMINI`                                                                                                                                  |
| Risk            | `LOW`                                                                                                                                     |
| Allowed paths   | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-6-SECURITY.md`, `tools/ai-brain/test/repo-integration-group-6.test.js` |
| Reviewer        | `Codex — fresh independent task`                                                                                                          |
| Branch          | `feat/goal-autoclaw-repos-7-impl`                                                                                                         |
| Pull Request    | `Pending`                                                                                                                                 |

## Business outcome

> Ghi và kiểm bằng chứng gắn nhóm 6 (security), scanner unavailable hoặc error không được thành PASS.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-6-SECURITY.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-6-SECURITY.md`, `tools/ai-brain/test/repo-integration-group-6.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 6 - Security.
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

| AC/Test ID | Scenario                                                                                                                                   | Expected result               | Evidence required      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ---------------------- |
| AC-1       | Repo/package + version/ref: gitleaks/gitleaks, aquasecurity/trivy, semgrep/semgrep, snyk/agent-scan.                                       | Passes automated verification | Automated check passes |
| AC-2       | Năng lực: secrets/Git-history gate; vulnerability/config scopes; code-security rules; agent/MCP/skill security.                            | Passes automated verification | Automated check passes |
| AC-3       | Trigger: CI/hooks, target/DB/scope, rules pin, directories/manifests.                                                                      | Passes automated verification | Automated check passes |
| AC-4       | Adapter/caller tái dùng (không tạo trùng): security runner và gate hiện có; không bật mặc định trong CI khi chưa đo thời gian.             | Passes automated verification | Automated check passes |
| AC-5       | Hợp đồng vào/ra: baseline và fixtures -> findings; suppression phải có lý do và test; scanner lỗi -> không PASS.                           | Passes automated verification | Automated check passes |
| AC-6       | Task chạy thực + artifact: benign và malicious fixtures, exit status rõ; chưa thay toàn bộ bằng Nox hoặc Cisco scanners.                   | Passes automated verification | Automated check passes |
| AC-7       | Trạng thái: DECLARED; chỉ lên WIRED/EXECUTION_VERIFIED/ACCEPTED khi có test và SHA; limitation: không bỏ scanner cũ trước coverage parity. | Passes automated verification | Automated check passes |
| AC-8       | Test passes: tools/ai-brain/test/repo-integration-group-6.test.js                                                                          | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-6.test.js`

## Codex review record

| Review round | Commit    | Verdict   | Findings resolved |
| ------------ | --------- | --------- | ----------------- |
| 1            | `Pending` | `Pending` | `Pending`         |

## Residual limitations

None.
