# TASK-FOUND-04 — Establish contracts and quality gates

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-FOUND-04`                                                                                                                                                                                                                                                                                                                                                           |
| Feature ID      | `N/A — repository foundation for EPIC-FND`                                                                                                                                                                                                                                                                                                                                |
| Status          | `READY_FOR_AUTHOR`                                                                                                                                                                                                                                                                                                                                                        |
| Delivery order  | `4`                                                                                                                                                                                                                                                                                                                                                                       |
| Dependencies    | `TASK-FOUND-03` — `MERGED` by PR `#8` at `ff1dbc770257b1a581b51951ab481ad037ed3ed1`                                                                                                                                                                                                                                                                                       |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                                                                                                                                                  |
| Risk            | `HIGH`                                                                                                                                                                                                                                                                                                                                                                    |
| Allowed paths   | `docs/product-spec/work-items/TASK-FOUND-04.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `package.json`; `pnpm-lock.yaml`; `turbo.json`; `packages/contracts/**`; `packages/testkit/**`; `packages/config/**`; `apps/web/**`; `apps/api/**`; `apps/worker/**`; `.github/workflows/**`; `scripts/**`; `docs/product-spec/contracts/**` |
| Branch          | `feat/task-found-04-contracts-quality-gates`                                                                                                                                                                                                                                                                                                                              |
| Pull Request    | Pending                                                                                                                                                                                                                                                                                                                                                                   |

## Business outcome

Establish the shared OpenAPI type generation, contract drift validation, testing harnesses (Vitest unit, Supertest integration, Playwright E2E), deterministic mock carrier adapters, MSW network simulation handlers, and CI quality gates so that every subsequent vertical product feature is built, tested, and reviewed against authoritative contracts and automated quality gates.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/FOUNDATION-WORK-ITEMS.md` — outcome, scope, and promotion rule for TASK-FOUND-04.
- `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md` — target stack commands, package structure, and code boundaries.
- `docs/product-spec/docs/08-testing/TEST-STRATEGY.md` — test pyramids, contract gates, MSW mocks, and deterministic fixtures.
- `docs/product-spec/docs/09-delivery/CI-CD-DEPLOYMENT.md` — CI gate definitions, secret scanning, and pull request verification.
- `docs/product-spec/contracts/openapi.yaml` — OpenAPI 3.1 specification source of truth.

## Acceptance criteria

- `AC-FOUND-04-01`: OpenAPI TypeScript definitions are generated automatically from `docs/product-spec/contracts/openapi.yaml` into `@shipde/contracts` with zero manual editing.
- `AC-FOUND-04-02`: A strict contract drift check (`pnpm contract:check`) verifies that generated TypeScript types match `openapi.yaml`, failing closed if specification and implementation diverge.
- `AC-FOUND-04-03`: `@shipde/testkit` provides deterministic carrier adapter mocks (GHN, GHTK, ViettelPost) with simulated success, validation error, network timeout, and rate limit responses without external network access.
- `AC-FOUND-04-04`: `@shipde/testkit` exports MSW (Mock Service Worker) handlers covering loading, empty, validation error, forbidden, partial, success, and recovery states for the web console.
- `AC-FOUND-04-05`: Supertest and NestJS testing harnesses are configured for `apps/api` and `apps/worker` to execute isolated integration tests against test databases.
- `AC-FOUND-04-06`: Automated database test isolation and reset scripts (`pnpm db:reset` / test transaction rollbacks) prevent test pollution across suites.
- `AC-FOUND-04-07`: CI pipeline enforces contract check, formatting, linting, typechecking, secrets scanning, unit/integration test suites, and build before merge readiness.
- `AC-FOUND-04-08`: Negative fixture tests confirm that intentionally broken contracts, leaked secrets, or accessibility defects fail the respective CI gate.
