# Foundation Work Items

Product feature work is blocked until these items are merged in order. Each item gets its own assigned implementation author branch, Pull Request and Codex review.

## Current repository finding

As verified on 2026-08-24, the product repository is a single Next.js 16.1.6 application using React 19.2.3, Prisma 6.19.2 and `package-lock.json`. The target specification defines a pnpm/Turborepo workspace with separate web, API and worker boundaries. Existing UI and behavior are retained as prototype/reference material, but mock arrays and client-side mutations do not count as completed product features.

## TASK-FOUND-01 — Freeze and classify the prototype

**Outcome:** a clean, reproducible baseline before structural migration.

- Inventory routes, components, server code, Prisma schema, adapters, fixtures and tests.
- Map existing behavior to feature IDs as `REAL`, `PARTIAL`, `DEMO_ONLY` or `ABSENT`, with file evidence.
- Add smoke tests for critical visible flows so later migration cannot silently remove them.
- Repair the verification baseline, including the declared-but-missing ESLint dependency/configuration, without weakening lint rules.
- Confirm clean `npm ci`, lint, build and current E2E commands.
- Record current security, data and hardcode gaps; do not fix unrelated features in this PR.

**Exit:** Codex confirms the inventory is evidence-based and baseline tests detect behavior loss.

## TASK-FOUND-02 — Migrate repository structure without feature rewrite

**Outcome:** target monorepo skeleton while preserving the baseline UI.

- Introduce pnpm and Turborepo.
- Move the existing Next.js application to `apps/web` with behavior-preservation tests passing.
- Create shared `packages/contracts`, `packages/config`, `packages/testkit` and `packages/ui` boundaries without speculative abstraction.
- Provide compatibility commands and update CI/documentation atomically.
- Do not implement product feature behavior in this structural PR.

**Exit:** clean install/lint/typecheck/test/build succeeds and the preserved flows remain usable.

## TASK-FOUND-03 — Add API, worker and local infrastructure

**Outcome:** executable backend foundation for real vertical features.

- Scaffold `apps/api` and `apps/worker` with health/readiness endpoints.
- Add PostgreSQL, Redis and S3-compatible local services through Docker Compose.
- Establish Prisma migration ownership, queue/outbox boundary, structured logs and correlation IDs.
- Add `.env.example` with safe placeholders and mock carrier defaults.
- No production credential or live carrier command is permitted.

**Exit:** API, worker and dependencies start locally; health and queue smoke tests pass.

## TASK-FOUND-04 — Establish contracts and quality gates

**Outcome:** every later feature is testable and reviewable in the same way.

- Wire OpenAPI/JSON Schema validation and generated/shared contract checks.
- Provide unit, integration and Playwright E2E harnesses plus deterministic carrier mocks.
- Add Storybook state/interaction coverage, Playwright screenshot comparison and axe-based accessibility checks for approved UI.
- Make root commands from the target stack document executable.
- Enable PR contract validation, lint, typecheck, tests and build in CI.
- Add seed reset and isolated test database procedures.

**Exit:** a deliberately broken contract/test fails CI and all correct baseline checks pass.

## Promotion rule

After `TASK-FOUND-04` is `MERGED`, promote only the first dependency-ready feature rows in `FEATURE-DELIVERY-REGISTER.csv` from `BLOCKED_BY_FOUNDATION` to `READY_FOR_AUTHOR`. Do not bulk-mark all 130 features ready.

