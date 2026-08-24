# Technology Stack and Repository

## Default stack

- Package manager: pnpm.
- Monorepo: Turborepo.
- Frontend: Next.js, React, TypeScript.
- Backend: NestJS, TypeScript.
- Database: PostgreSQL.
- ORM/migrations: Prisma unless ADR changes it before implementation.
- Queue/cache: Redis and BullMQ.
- Object storage: S3-compatible.
- Validation: Zod for shared/client schemas; backend DTO/domain validation remains authoritative.
- API: REST/OpenAPI.
- Testing: Vitest/Jest-compatible unit runner, Supertest/API integration and Playwright E2E.
- Local orchestration: Docker Compose.

## Target code repository

\`\`\`text
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
\`\`\`

## Required root commands

- pnpm install
- pnpm lint
- pnpm typecheck
- pnpm test
- pnpm test:integration
- pnpm test:e2e
- pnpm build
- pnpm dev
- pnpm db:migrate
- pnpm db:seed
- pnpm mock:carriers

## Environment principles

- .env.example documents names and safe placeholders only.
- Secrets never enter source control or test snapshots.
- Local, test, staging and production configurations are explicit.
- Carrier adapters default to mock/disabled until credentials and capability evidence exist.

## Code boundaries

- Feature/domain modules cannot import provider-specific adapter internals.
- UI consumes generated/shared contracts, not duplicate hand-written shapes.
- State transitions live in domain/application services.
- Database access is tenant-scoped through approved repositories.
- Unsafe external commands go through command/outbox workflow.

