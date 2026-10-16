# GOAL-AUTOCLAW-REPOS-5 — Nhóm 4 - Migration lint/format

## Control

| Field           | Value                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `GOAL-AUTOCLAW-REPOS-5`                                                                                                                      |
| Feature ID      | `GOAL-AUTOCLAW-REPOS`                                                                                                                        |
| Status          | `BACKLOG`                                                                                                                                    |
| Delivery order  | `257`                                                                                                                                        |
| Dependencies    | `GOAL-AUTOCLAW-REPOS-1`                                                                                                                      |
| Assigned author | `GEMINI`                                                                                                                                     |
| Risk            | `LOW`                                                                                                                                        |
| Allowed paths   | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-4-LINT-FORMAT.md`, `tools/ai-brain/test/repo-integration-group-4.test.js` |
| Reviewer        | `Codex — fresh independent task`                                                                                                             |
| Branch          | `feat/goal-autoclaw-repos-5-impl`                                                                                                            |
| Pull Request    | `Pending`                                                                                                                                    |

## Business outcome

> Ghi và kiểm bằng chứng migration lint/format sang Biome, chỉ bỏ eslint và prettier ở phạm vi đạt parity.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-4-LINT-FORMAT.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-4-LINT-FORMAT.md`, `tools/ai-brain/test/repo-integration-group-4.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 4 - Migration lint/format.
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

| AC/Test ID | Scenario                                                                                                                                      | Expected result               | Evidence required      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------- |
| AC-1       | Repo/package + version/ref: biomejs/biome (phương án migration chính).                                                                        | Passes automated verification | Automated check passes |
| AC-2       | Năng lực: gom lint + format + imports.                                                                                                        | Passes automated verification | Automated check passes |
| AC-3       | Trigger: scripts, config, hooks, CI và generated-output pipeline.                                                                             | Passes automated verification | Automated check passes |
| AC-4       | Adapter/caller tái dùng (không tạo trùng): scripts và CI hiện có; đối chiếu rules/plugins và lời gọi prettier.format.                         | Passes automated verification | Automated check passes |
| AC-5       | Hợp đồng vào/ra: rules/plugins và format calls -> parity matrix; chỉ bỏ eslint hoặc prettier ở phạm vi đạt parity.                            | Passes automated verification | Automated check passes |
| AC-6       | Task chạy thực + artifact: parity matrix và CI result; không cài thêm Oxc cạnh Biome.                                                         | Passes automated verification | Automated check passes |
| AC-7       | Trạng thái: DECLARED; chỉ lên WIRED/EXECUTION_VERIFIED/ACCEPTED khi có test và SHA; limitation: migration từng bước, không rewrite đồng loạt. | Passes automated verification | Automated check passes |
| AC-8       | Test passes: tools/ai-brain/test/repo-integration-group-4.test.js                                                                             | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-4.test.js`

## Codex review record

| Review round | Commit    | Verdict   | Findings resolved |
| ------------ | --------- | --------- | ----------------- |
| 1            | `Pending` | `Pending` | `Pending`         |

## Residual limitations

None.
