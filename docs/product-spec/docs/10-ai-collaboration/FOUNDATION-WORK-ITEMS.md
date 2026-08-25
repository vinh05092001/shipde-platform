# Foundation Work Items

Product feature work is blocked until these items are merged in order. Each item gets its own assigned implementation author branch, Pull Request and Codex review.

## Current repository finding

As verified on 2026-08-24, the product repository is a single Next.js 16.1.6 application using React 19.2.3, Prisma 6.19.2 and `package-lock.json`. The target specification defines a pnpm/Turborepo workspace with separate web, API and worker boundaries. Existing UI and behavior are retained as prototype/reference material, but mock arrays and client-side mutations do not count as completed product features.

Machine-wide CLI preparation is defined in `REPOSITORY-CLI-MANIFEST.md`. Framework and test repositories below are installed as lockfile-pinned project dependencies in their assigned item, never globally and never by cloning upstream source.

## TASK-FOUND-01 — Freeze and classify the prototype

**Outcome:** a clean, reproducible baseline before structural migration.

- Inventory routes, components, server code, Prisma schema, adapters, fixtures and tests.
- Map existing behavior to feature IDs as `REAL`, `PARTIAL`, `DEMO_ONLY` or `ABSENT`, with file evidence.
- Add smoke tests for critical visible flows so later migration cannot silently remove them.
- Repair the verification baseline, including the declared-but-missing ESLint dependency/configuration, without weakening lint rules.
- Add a deterministic formatting baseline and Gitleaks secret scan; failures may not be hidden with blanket exclusions.
- Align local documentation, package engines and GitHub Actions on Node.js 24 so the existing Windows runtime and CI do not validate different majors.
- Confirm clean `npm ci`, lint, build and current E2E commands.
- Record current security, data and hardcode gaps; do not fix unrelated features in this PR.

**Exit:** Codex confirms the inventory is evidence-based, the baseline checks are reproducible and behavior-loss/secret fixtures are detected.

## TASK-FOUND-02 — Migrate repository structure without feature rewrite

**Outcome:** target monorepo skeleton while preserving the baseline UI.

- Introduce pnpm major 11 and Turborepo as project tooling, with an exact `packageManager` value, committed lockfile and explicit build-script allowlist.
- Move the existing Next.js application to `apps/web` with behavior-preservation tests passing.
- Create shared `packages/contracts`, `packages/config`, `packages/testkit` and `packages/ui` boundaries without speculative abstraction.
- Provide compatibility commands and update CI/documentation atomically.
- Do not implement product feature behavior in this structural PR.

**Exit:** clean install/lint/typecheck/test/build succeeds through root `pnpm` commands and the preserved flows remain usable.

## TASK-FOUND-03 — Add API, worker and local infrastructure

**Outcome:** executable backend foundation for real vertical features.

- Scaffold NestJS `apps/api` and `apps/worker` with health/readiness endpoints.
- Add PostgreSQL 16+, Redis and S3-compatible local services through Docker Compose using pinned image versions or digests.
- Establish Prisma migration ownership, BullMQ queue/outbox boundary, structured logs and correlation IDs.
- Add `.env.example` with safe placeholders and mock carrier defaults.
- No production credential or live carrier command is permitted.
- Do not require native PostgreSQL, Redis, MinIO or Ubuntu installation on the Windows machine.

**Exit:** API, worker and dependencies start locally; health, migration and queue smoke tests pass from documented root commands.

## TASK-FOUND-04 — Establish contracts and quality gates

**Outcome:** every later feature is testable and reviewable in the same way.

- Wire OpenAPI validation, `openapi-typescript` generation and shared contract drift checks.
- Provide Vitest unit, Supertest API integration and Playwright E2E harnesses plus deterministic carrier mocks.
- Add MSW handlers and `msw-storybook-addon` for approved loading, empty, error, partial, success and recovery states.
- Add Storybook state/interaction coverage, Playwright screenshot comparison and axe-based accessibility checks for approved UI.
- Add targeted Lighthouse CI budgets for the approved critical routes without running the full set on every local edit.
- Audit and pin only Vercel `react-best-practices` and `web-design-guidelines`; record the exact source commit and keep Ship Dễ screen/UX documents authoritative.
- Make root commands from the target stack document executable.
- Enable PR contract validation, secret scan, lint, typecheck, tests and build in CI.
- Add seed reset and isolated test database procedures.

**Exit:** deliberately broken contract, secret, accessibility, critical screenshot and test fixtures fail the correct CI gate, while all approved baseline checks pass.

## Promotion rule

After `TASK-FOUND-04` is `MERGED`, promote only the first dependency-ready feature rows in `FEATURE-DELIVERY-REGISTER.csv` from `BLOCKED_BY_FOUNDATION` to `READY_FOR_AUTHOR`. Do not bulk-mark all 130 features ready.
