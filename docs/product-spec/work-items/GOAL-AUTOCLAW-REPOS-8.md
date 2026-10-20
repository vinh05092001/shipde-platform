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

### 2026-10-20 — grafana/k6: EXECUTION_VERIFIED

- **Repo/ref:** k6 `2.3.0`. In CI it is installed from the release tarball after a `sha256sum -c` check against the release checksums. The version is read from the manifest entry. k6 moves from candidates (WATCH) to adopted.
- **Workload:** `tools/k6/health-smoke.js` runs 20 constant VUs for 20 s against `GET /health/live` on the built API.
- **Thresholds:** `http_req_failed rate<0.01`, `http_req_duration p(95)<200` and `checks rate>0.99`. A crossed threshold exits non-zero.
- **Environment lifecycle:** `tools/k6/run-health-smoke.sh` starts `apps/api/dist/main.js` with the placeholder `.env.example` (`NODE_ENV=test`), waits up to 60 s for liveness, runs k6 and stops the API on exit. The API connects to Prisma lazily, so no database is needed for liveness.
- **Trigger:** `pnpm test:load`; CI steps in `current-application.yml` after Lighthouse, uploading `k6-summary.json` and the API log.
- **Real run (local, Windows k6 v2.3.0):**
  - 196,844 requests, `p(95)=2.76ms`, 0% failed, all checks passed; exit 0.
  - Negative proof: the same run with `p(95)<0.1` exits 99 with "thresholds on metrics 'http_req_duration' have been crossed".
- **Verification:** manifest audit error 0; `ecosystem.ps1 validate` passes; manifest-audit and repo-integration tests pass 54/0.
- **Limitation:** the first workload covers liveness only. Load on authenticated routes needs a seeded database in CI.
