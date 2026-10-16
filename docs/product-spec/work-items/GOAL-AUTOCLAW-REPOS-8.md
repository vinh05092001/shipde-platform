# GOAL-AUTOCLAW-REPOS-8 — Nhóm 7 - Product/toolchain

## Control

| Field | Value |
|---|---|
| Work Item ID | `GOAL-AUTOCLAW-REPOS-8` |
| Feature ID | `GOAL-AUTOCLAW-REPOS` |
| Status | `BACKLOG` |
| Delivery order | `260` |
| Dependencies | `GOAL-AUTOCLAW-REPOS-1` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-7-PRODUCT-TOOLCHAIN.md`, `tools/ai-brain/test/repo-integration-group-7.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/goal-autoclaw-repos-8-impl` |
| Pull Request | `Pending` |

## Business outcome

> Ghi và kiểm bằng chứng gắn nhóm 7 (product/toolchain) vào app/scripts/test infrastructure hiện có, không biến thành skill giả.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-7-PRODUCT-TOOLCHAIN.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-7-PRODUCT-TOOLCHAIN.md`, `tools/ai-brain/test/repo-integration-group-7.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 7 - Product/toolchain.
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
| AC-1 | Repo/package + version/ref: git-for-windows/git@2.49.0.windows.1, nodejs/node@v24.15.0, pnpm/pnpm@11.23.0, docker/compose, nestjs/nest, prisma/orm, taskforcesh/bullmq, vercel/turborepo, evilmartians/lefthook, open-telemetry/opentelemetry-js. | Passes automated verification | Automated check passes |
| AC-2 | Năng lực: version control/worktrees; runtime; dependencies/workspaces/SBOM; product test environment/readiness; backend modules; persistence/schema/migrations; product jobs idempotency/retry; build/test task graph và cache; staged checks bảo toàn unstaged changes; trace Work Item/run/attempt. | Passes automated verification | Automated check passes |
| AC-3 | Trigger: app/scripts/test infrastructure hiện có. | Passes automated verification | Automated check passes |
| AC-4 | Adapter/caller tái dùng (không tạo trùng): package.json, scripts và test infrastructure hiện có. | Passes automated verification | Automated check passes |
| AC-5 | Hợp đồng vào/ra: cấu hình hiện có -> hành vi toolchain; không rewrite hoặc nâng major để giảm số repo. | Passes automated verification | Automated check passes |
| AC-6 | Task chạy thực + artifact: command hiện có chạy được và ghi evidence; không biến product/toolchain thành skill giả. | Passes automated verification | Automated check passes |
| AC-7 | Trạng thái: DECLARED; chỉ lên WIRED/EXECUTION_VERIFIED/ACCEPTED khi có test và SHA; limitation: theo implementation hiện có. | Passes automated verification | Automated check passes |
| AC-8 | Test passes: tools/ai-brain/test/repo-integration-group-7.test.js | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-7.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `Pending` | `Pending` |

## Residual limitations

None.
