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

### 2026-10-20 — GoogleChrome/lighthouse-ci: EXECUTION_VERIFIED

- Repo/package + ref: `@lhci/cli@0.15.1` (apps/web devDependency). Chrome is the Playwright Chromium already installed for the axe gate.
- Capability: Lighthouse budgets on the public routes `/`, `/register`, `/forgot-password`, `/reset-password`. Each route gets 3 desktop runs and the median run is scored.
- Trigger: `pnpm --filter @shipde/web test:lighthouse`, run in CI `current-application` after the axe gate. Reports are uploaded as the `lighthouse-report` artifact.
- Budgets (`apps/web/lighthouserc.cjs`):
  - Fail the build: accessibility ≥ 0.95, best-practices ≥ 0.90.
  - Warn only: performance ≥ 0.80, SEO ≥ 0.80.
  - The spec names no numeric performance budget yet, so performance stays non-blocking.
- Real run (median): `/` 0.96/0.95/0.96/1.00, `/register` 0.93/1.00/0.96/1.00, `/forgot-password` 1.00/1.00/0.96/1.00, `/reset-password` 0.96/1.00/0.96/1.00 (performance/accessibility/best-practices/SEO).
- Limitation: authenticated screens are not measured yet. The scores do not replace functional acceptance evidence (TECH-STACK-REPOSITORY).

### 2026-10-20 — vercel-labs/agent-skills: EXECUTION_VERIFIED

- **Repo and ref:**
  - `vercel-labs/agent-skills` `063bee94c3f4df8453406c830b0a7df0f2860278`: `react-best-practices/SKILL.md`.
  - `vercel-labs/web-interface-guidelines` `434b7f91364665f2f733b310ec54809bf8f37937`: `command.md` plus `LICENSE`.
  - Both are vendored byte-for-byte under `tools/ai-brain/skills/vercel/`, and `NOTICE.md` records the sha256 of each file.
  - The manifest's old pin `e74b3d8` no longer resolves upstream.
- **Scope:** only the two texts approved in `AI-TOOLCHAIN-DECISIONS.md`.
  - The upstream `web-design-guidelines` skill only tells the agent to fetch `command.md` from `main` before every review. That unpinned fetch is replaced by the pinned rules file.
  - `AGENTS.md` (112 KB) is not vendored.
- **Caller:** `tools/ai-brain/skill-pack.js` `UI_ROLE_SKILLS`. Each entry may name its own vendored root. UI roles (`author.ui`, `reviewer.ui`) receive the texts after `UI_AUTHORITY_HEADER` and `LOCK_HEADER`. Non-UI packs are unchanged.
- **Real run:** `lockedPack('author.ui')` returns 97,550 characters containing both `## Skill: vercel-*` sections. `lockedPack('author')` contains none.
- **Tests:** `repo-integration-vercel-skills.test.js` checks the byte pins against NOTICE, the ordering behind the headers and that non-UI roles receive nothing. The `task-ai-109*` and group-2 tests pass as well: 34 pass, 0 fail.
- **Rollback:** `SHIPDE_SKILL_PACK=off`, or revert the commit.

### 2026-10-20 — forwardemail/supertest: EXECUTION_VERIFIED (registered)

- **Repo/ref:** `supertest` `7.2.2`, a devDependency of `apps/api` and `apps/worker`. It was running but missing from the manifest, and is now registered as ADOPTED / BLOCKING_GATE.
- **Callers:**
  - `apps/api` `test`: `api.supertest.spec.ts`, `auth/auth.supertest.spec.ts`, `auth/auth.login.supertest.spec.ts` and `session/session.supertest.spec.ts`. They assert side effects such as audit rows, verification tokens and session state through Prisma.
  - `apps/worker` `test`: `worker.supertest.spec.ts`.
- **Real run:** CI run `39420673151` (`current-application`, `pnpm test`) executes both suites. The worker harness prints "ALL WORKER SUPERTEST & NESTJS HARNESS TESTS PASSED 100%", and the API suites pass inside the same green job.
- **Verification:** manifest audit error 0; `ecosystem.ps1 validate` passes; manifest-audit and repo-integration tests pass 54/0.
