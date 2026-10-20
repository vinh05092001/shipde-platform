# GOAL-AUTOCLAW-REPOS-6 — Nhóm 5 - Testing và quality

## Control

| Field           | Value                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `GOAL-AUTOCLAW-REPOS-6`                                                                                                                  |
| Feature ID      | `GOAL-AUTOCLAW-REPOS`                                                                                                                    |
| Status          | `BACKLOG`                                                                                                                                |
| Delivery order  | `258`                                                                                                                                    |
| Dependencies    | `GOAL-AUTOCLAW-REPOS-1`                                                                                                                  |
| Assigned author | `GEMINI`                                                                                                                                 |
| Risk            | `LOW`                                                                                                                                    |
| Allowed paths   | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-5-TESTING.md`, `tools/ai-brain/test/repo-integration-group-5.test.js` |
| Reviewer        | `Codex — fresh independent task`                                                                                                         |
| Branch          | `feat/goal-autoclaw-repos-6-impl`                                                                                                        |
| Pull Request    | `Pending`                                                                                                                                |

## Business outcome

> Ghi và kiểm bằng chứng gắn nhóm 5 (testing và quality), giữ MSW/Supertest tới khi từng migration case đạt parity.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-5-TESTING.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-5-TESTING.md`, `tools/ai-brain/test/repo-integration-group-5.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 5 - Testing và quality.
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

| AC/Test ID | Scenario                                                                                                                                                                                                                                                              | Expected result               | Evidence required      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------- |
| AC-1       | Repo/package + version/ref: microsoft/playwright, microsoft/playwright-cli (@playwright/cli@0.1.2), dequelabs/axe-core, GoogleChrome/lighthouse-ci, grafana/k6, ChromeDevTools/chrome-devtools-mcp, mswjs/msw, forwardemail/supertest, openapi-ts/openapi-typescript. | Passes automated verification | Automated check passes |
| AC-2       | Năng lực: E2E/API/screenshot/component tests; browser interaction; DOM accessibility; runtime performance budgets; load/performance; browser debugging; request fixtures; API integration assertions; generate types từ OpenAPI.                                      | Passes automated verification | Automated check passes |
| AC-3       | Trigger: acceptance path, a11y, performance budget, load workload, diagnosis, fixtures, OpenAPI drift.                                                                                                                                                                | Passes automated verification | Automated check passes |
| AC-4       | Adapter/caller tái dùng (không tạo trùng): tests hiện có; browser skill/tool wrapper có session lifecycle và teardown.                                                                                                                                                | Passes automated verification | Automated check passes |
| AC-5       | Hợp đồng vào/ra: acceptance -> tests và artifacts đúng SHA; violations/incomplete -> findings; OpenAPI -> types + drift/typecheck gate.                                                                                                                               | Passes automated verification | Automated check passes |
| AC-6       | Task chạy thực + artifact: test results và reports đúng SHA; không dùng việc click thành công thay test assertions.                                                                                                                                                   | Passes automated verification | Automated check passes |
| AC-7       | Trạng thái: DECLARED; chỉ lên WIRED/EXECUTION_VERIFIED/ACCEPTED khi có test và SHA; limitation: giữ MSW/Supertest tới khi parity.                                                                                                                                     | Passes automated verification | Automated check passes |
| AC-8       | Test passes: tools/ai-brain/test/repo-integration-group-5.test.js                                                                                                                                                                                                     | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-5.test.js`

## Codex review record

| Review round | Commit    | Verdict   | Findings resolved |
| ------------ | --------- | --------- | ----------------- |
| 1            | `Pending` | `Pending` | `Pending`         |

## Residual limitations

None.

### 2026-10-20 — dequelabs/axe-core: EXECUTION_VERIFIED

- Repo/package + ref: `axe-core@4.14.0`, `@axe-core/playwright@4.14.0`, `@playwright/test@1.64.1` (apps/web devDependencies).
- Capability: WCAG 2.1 A/AA DOM audit of the public web routes `/`, `/register`, `/forgot-password`, `/reset-password`.
- Trigger: `pnpm --filter @shipde/web test:a11y`, run by CI `current-application` after `pnpm build`.
- Caller/config: `apps/web/playwright.config.ts`, `apps/web/e2e/a11y.spec.ts`.
- Contract: a violation fails the gate. The full violations and incomplete results are attached to `apps/web/test-results/a11y-report.json` and uploaded as the `a11y-report` artifact.
- Real run: the first run found `button-name` (password visibility toggle) and `color-contrast` (brand orange `#EA4B12` 3.8:1, helper text 2.6:1) on all four routes. After the fixes all four pass.
- Fix decision: the operator chose to move the brand token to `#C23807` (5.4:1), hover `#A8300A`, per DESIGN-SYSTEM-UX-RULES "Minimum WCAG AA contrast".
- Limitation: authenticated screens are not audited yet; they need a seeded session fixture.
