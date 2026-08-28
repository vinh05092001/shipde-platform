# Technology Stack and Repository

## Default stack

- Runtime baseline: Node.js 24 locally, in CI and in build images.
- Package manager: pnpm 11, exact version pinned in `packageManager` with explicit dependency build-script approvals.
- Monorepo: Turborepo as a project dependency.
- Frontend: Next.js, React, TypeScript.
- Backend: NestJS, TypeScript.
- Database: PostgreSQL 16+.
- ORM/migrations: Prisma unless ADR changes it before implementation.
- Queue/cache: Redis and BullMQ.
- Object storage: S3-compatible; MinIO is the default local container.
- Validation: Zod for shared/client schemas; backend DTO/domain validation remains authoritative.
- API: REST/OpenAPI with validated generation of frontend TypeScript contracts.
- Testing: Vitest unit tests, Supertest API integration and Playwright browser E2E/visual tests.
- UI evidence: Storybook, MSW, axe-based accessibility and targeted Lighthouse CI budgets.
- Security baseline: Gitleaks plus package-manager dependency audit and reviewed build-script allowlists.
- Local orchestration: Docker Desktop/Compose; native PostgreSQL, Redis and MinIO installs are not required.

## Target code repository

```text
apps/
  web/
  api/
  worker/
packages/
  ui/
  contracts/
  config/
  testkit/
infra/
  docker/
  migrations/
docs/
scripts/
```

## Required root commands

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm test:a11y`
- `pnpm test:visual`
- `pnpm test:perf`
- `pnpm security:secrets`
- `pnpm build`
- `pnpm dev`
- `pnpm db:migrate`
- `pnpm db:seed`
- `pnpm mock:carriers`

Commands that do not apply to a package are routed from the root; agents must not bypass them by invoking a different global CLI.

## Environment principles

- `.env.example` documents names and safe placeholders only.
- Secrets never enter source control, request logs or test snapshots.
- Local, test, staging and production configurations are explicit.
- Carrier adapters default to mock/disabled until credentials and capability evidence exist.
- Docker images and JavaScript package versions are pinned by reviewed files.
- Dependency lifecycle scripts are denied unless explicitly reviewed and allowlisted.
- Newly released dependencies are not adopted during an active Work Item.

## Code boundaries

- Feature/domain modules cannot import provider-specific adapter internals.
- UI consumes generated/shared contracts, not duplicate hand-written shapes.
- State transitions live in domain/application services.
- Database access is tenant-scoped through approved repositories.
- Unsafe external commands go through command/outbox workflow.
- MSW and carrier mocks provide test evidence only and cannot be enabled in production.
- Storybook, screenshots and Lighthouse scores do not replace functional acceptance evidence.

