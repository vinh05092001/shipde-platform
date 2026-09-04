# TASK-FOUND-03 — Add API, worker and local infrastructure

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-FOUND-03` |
| Feature ID | `N/A — repository foundation for EPIC-FND` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `3` |
| Dependencies | `TASK-FOUND-02` — `MERGED` by PR `#4` at `09d9848a2e447829510dd65354e114a305e604c2` |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/TASK-FOUND-03.md`; the `TASK-FOUND-03` row only in `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `README.md`; `.env.example`; `.gitignore`; root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, and `tsconfig*.json`; `.github/workflows/current-application.yml` and `.github/workflows/security-baseline.yml`; `apps/api/**`; `apps/worker/**`; `packages/config/**`, `packages/contracts/**`, and `packages/testkit/**` only for shared environment, health, correlation, outbox/queue contracts and deterministic foundation fixtures; `infra/docker/**`; `infra/migrations/**`; `prisma/**` only for migration ownership, an initial migration of the preserved schema, and additive foundation outbox records without changing existing product-field semantics; `apps/web/package.json` only if canonical Prisma-schema path or workspace command compatibility changes; and `docs/product-spec/contracts/openapi.yaml` only for the two operational health endpoint contracts |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-found-03-api-worker-infrastructure` |
| Pull Request | `Not opened — implementation author responsibility` |

## Business outcome

Ship Dễ developers and operators can start a real NestJS API process, a separately executable worker, PostgreSQL, Redis and S3-compatible object storage from the repository and determine whether each process and dependency is healthy. Later vertical Work Items gain a migration-owned PostgreSQL baseline, a durable outbox-to-BullMQ boundary, correlation-aware structured logging and safe local configuration without claiming that any prototype screen, product API, tenant permission or carrier command has become production-ready.

## Source references

- `DEC-016` and “Baseline statement” in `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — TypeScript monorepo is accepted, while the existing application remains prototype evidence.
- “Product scope” and “Boundaries” in `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md` — the foundation must support the full before/during/after-shipment product and must not introduce fake carrier results, COD custody or cross-tenant behavior.
- All `FEAT-*` rows in `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — no product feature is completed or reclassified by this Work Item.
- `EPIC-FND` and “Planning rules” in `docs/product-spec/docs/09-delivery/BACKLOG-DEPENDENCIES.md` — foundation precedes all vertical domain epics.
- `TASK-FOUND-03` and “Promotion rule” in `docs/product-spec/docs/10-ai-collaboration/FOUNDATION-WORK-ITEMS.md` — approved outcome, scope, exit and dependency order.
- “Default stack”, “Target code repository”, “Required root commands”, “Environment principles” and “Code boundaries” in `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md` — Node 24, pnpm 11, NestJS, PostgreSQL 16+, Redis/BullMQ, MinIO, Prisma ownership, project-pinned tools and mock/disabled carriers.
- `ADR-001`, `ADR-002`, `ADR-003`, `ADR-004` and `ADR-005` in `docs/product-spec/docs/06-architecture/ADR.md` — TypeScript monorepo, modular monolith, PostgreSQL system of record, Redis/BullMQ and S3-compatible storage are accepted decisions.
- “Containers”, “Architectural invariants”, “Transaction boundaries” and “Availability strategy” in `docs/product-spec/docs/06-architecture/SYSTEM-ARCHITECTURE.md` — API/worker/service topology, durable-before-dispatch, correlation, idempotent application and dependency isolation.
- “Stack”, “Layers”, “Outbox/inbox”, “Database rules” and “Background jobs” in `docs/product-spec/docs/06-architecture/BACKEND-ARCHITECTURE.md` — backend ownership and at-least-once worker requirements.
- “Observability”, “Security controls” and “NFR targets” in `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — structured logs, correlation identifiers, secret/PII exclusion and operational metrics.
- “Modeling rules” in `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` and `ShipmentCommand.*` in `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — durable records use tenant/correlation/idempotency boundaries; existing product entities are not redesigned here.
- “Idempotency” and “Retry policy” in `docs/product-spec/docs/05-api-integrations/ERROR-IDEMPOTENCY-RETRY.md` — at-least-once delivery may never become duplicate external effect. This Work Item uses only a synthetic internal smoke event and performs no external command.
- “Feature Definition of Ready/Done” in `docs/product-spec/docs/07-ai-build/DEFINITION-OF-READY-DONE.md`, “Worker/event” and “CI gates” in `docs/product-spec/docs/08-testing/TEST-STRATEGY.md`, and “Pull-request pipeline” in `docs/product-spec/docs/09-delivery/CI-CD-DEPLOYMENT.md` — migration, queue, health, clean-checkout and regression evidence requirements.
- The `TASK-FOUND-03` project-dependency and local-service rows in `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md` — NestJS, Prisma, BullMQ and OpenTelemetry are project dependencies; PostgreSQL, Redis and MinIO are pinned containers, not native installs.
- Sections `2.1`, `2.2`, `2.3`, `2.5`, `2.6`, `2.7` and `3` of `docs/product-spec/evidence/PROTOTYPE-GAPS-AND-RISKS.md` — the in-memory application, unapplied 17-model Prisma schema and simulated effects are preserved evidence, not proof of durable product behavior.
- `AC-FOUND-02-01` through `AC-FOUND-02-12` in `docs/product-spec/work-items/TASK-FOUND-02.md` and merge commit `09d9848a2e447829510dd65354e114a305e604c2` — the workspace baseline and root command routing that this item extends.
- Planning base `a344b69af3c1c9dc4469d0ccdefe15c130bb2188` on `origin/main`.

Foundation traceability for this item is `EPIC-FND`; product feature, use-case, business-rule, screen and product state-machine IDs are `N/A`. Operational identifiers introduced and verified by this Work Item are `API-FOUND-HEALTH-LIVE`, `API-FOUND-HEALTH-READY`, `ENT-FOUND-OUTBOX`, `EVT-FOUND-QUEUE-SMOKE`, `AC-FOUND-03-01` through `AC-FOUND-03-14`, and their matching `TEST-FOUND-03-*` evidence.

## Preconditions and dependencies

- `TASK-FOUND-02` is `MERGED` in the delivery register and its merge commit `09d9848a2e447829510dd65354e114a305e604c2` is an ancestor of planning base `a344b69af3c1c9dc4469d0ccdefe15c130bb2188`.
- The planning branch was created cleanly from that current `origin/main`; no prior local or remote `TASK-FOUND-03` branch existed.
- The merged baseline provides Node.js `v24.15.0`, repository-pinned pnpm `11.23.0`, Turborepo workspaces, a generated Prisma client, current lint/format/typecheck/test/build gates and preservation tests.
- Docker `29.7.2` and Docker Compose `v5.4.0` resolve on the planning machine. The author must still prove that the Docker daemon and pinned services run in the implementation environment; native PostgreSQL, Redis, MinIO or Ubuntu installation is neither required nor allowed.
- The existing `prisma/schema.prisma` has 17 prototype-era models but no applied migration. It may be preserved as the initial migration input, but it is not authority for later feature semantics. This item must not rename or reinterpret those product fields; any conflict with `docs/product-spec/docs/04-data/**` is recorded for the owning vertical feature rather than silently resolved here.
- No production credential, carrier sandbox, live provider, real shop data or product authentication decision is needed. Carrier execution remains mock/disabled and no product route is redirected to the new API in this Work Item.

## Author boundary

`GEMINI` is required because this is a foundation migration spanning repository architecture, two executable services, database migration ownership, container orchestration, asynchronous processing, observability, CI and security-sensitive configuration. It fails every condition for `9ROUTER` assignment.

The accepted ADRs already settle the consequential architecture choices: NestJS modular monolith, separate worker, PostgreSQL/Prisma, Redis/BullMQ and S3-compatible object storage. The author may choose exact compatible package and container patch versions, ports and internal module names only when they are pinned, documented, collision-safe and do not change those accepted boundaries. Stop and mark `BLOCKED` if implementation would require changing a product entity semantic, authentication/tenant model, external-effect policy, production secret handling or accepted ADR.

The author must not use this task to connect the prototype UI to PostgreSQL, replace Next.js product route handlers, implement login/tenancy, add a real carrier adapter, invent an outbox business payload, or claim a catalog feature as complete.

## In scope

- Add independently buildable and runnable NestJS workspaces at `apps/api` and `apps/worker`, both using the repository's Node 24/pnpm/Turbo conventions.
- Provide `API-FOUND-HEALTH-LIVE` and `API-FOUND-HEALTH-READY` for both processes. Liveness proves only that the process/event loop is alive. Readiness checks that process's required PostgreSQL, Redis and S3 dependencies and returns HTTP `503` until they are usable.
- Keep health responses minimal and deterministic: service name, status, dependency names/statuses, timestamp and correlation ID only. Never expose connection strings, host credentials, stack traces, database names, bucket keys, tenant data or provider payloads.
- Add pinned Docker Compose definitions under `infra/docker/**` for PostgreSQL 16+, Redis and MinIO (or another already approved S3-compatible local image), with health checks, named volumes, explicit local ports and deterministic startup/shutdown commands.
- Add `.env.example` with documented safe placeholders and fail-closed configuration validation for API port, worker health port, database, Redis, S3, log/trace settings and carrier mode. `CARRIER_MODE` defaults to `disabled` or deterministic `mock`; production must reject mock mode.
- Establish one canonical Prisma schema/migration owner and root commands for generation, migration deployment/status and local/test reset. Preserve the current 17-model field semantics in the initial baseline; add only infrastructure records required for `ENT-FOUND-OUTBOX`.
- Implement the minimal durable outbox/BullMQ plumbing needed to prove the architectural boundary: database work and outbox creation commit together, dispatch occurs after commit, jobs carry a correlation ID, worker handlers are safe under at-least-once delivery, and a failed publish remains recoverable.
- Use only `EVT-FOUND-QUEUE-SMOKE`, an obviously synthetic internal event with no carrier, user, money or product side effect, to prove queue delivery, retry/dedupe and recovery.
- Emit structured JSON logs from API and worker. Accept a valid inbound correlation ID or generate one, return it on HTTP responses, propagate it through outbox and BullMQ, and redact/omit secrets and payload PII.
- Add deterministic unit/integration smoke evidence for configuration validation, liveness/readiness success and dependency failure, clean migration, outbox commit/rollback, queue processing, duplicate/retry behavior and structured-log/correlation propagation.
- Extend root scripts, Turborepo tasks, CI and README instructions so clean-checkout installation, infrastructure startup, migration, health/queue smoke tests and teardown are reproducible on Windows PowerShell and Linux CI.
- Preserve all `TASK-FOUND-02` application behavior and tests. Planning/implementation evidence may update only this Work Item and its single delivery-register row.

## Out of scope

- Any `FEAT-*` behavior, screen, product API, authentication, authorization, membership, RBAC, tenant repository implementation or migration of the prototype's in-memory handlers to the API/database.
- Product redesign of the 17 preserved Prisma models, resolution of `Merchant` versus target `Tenant/Shop` semantics, product seed data or classification of a prototype feature as `REAL`.
- OpenAPI generation/drift automation, Vitest/Supertest/Playwright/Storybook/MSW/axe/Lighthouse harnesses, deterministic carrier server and seed reset framework owned by `TASK-FOUND-04`.
- Real carrier, OMS, bank, SMS/Zalo, email or production object-storage integration; webhook ingestion; carrier capability claims; production secrets; production deployment manifests.
- Product outbox events, shipment commands, blind retry, reconciliation logic or any external network side effect. The only queue payload is the synthetic foundation smoke event.
- UI composition or changes under `apps/web/src/**`; loading, empty, validation, error or recovery views for product screens.
- Destructive migration, deletion or transformation of existing data. There is no production database baseline authorized by this task.
- Broad dependency upgrades, unrelated cleanup, package-manager changes, global CLI installation or machine mutation.

## Business rules and edge cases

- `ADR-002`: API and worker remain parts of one modular-monolith codebase with explicit interface/application/infrastructure boundaries; do not introduce microservices or provider-specific domain imports.
- `ADR-003`: PostgreSQL is the durable source of record. If PostgreSQL is unavailable, readiness is `503`, migration and outbox operations fail closed, and no success is reported from an in-memory substitute.
- `ADR-004`: BullMQ workers are at-least-once. Re-delivery of the same synthetic outbox record must not produce a second committed smoke effect; retries are bounded and exhausted work is observable/recoverable rather than silently discarded.
- `ADR-005`: S3-compatible storage is a dependency boundary only. No real evidence, label, recipient or contract file is uploaded by this item.
- A database transaction rollback must also roll back its outbox insert. A queue publish must happen only after the outbox transaction commits. If publish fails, the durable outbox record remains pending for a later bounded retry.
- API/worker startup with missing or malformed required configuration fails with a sanitized validation error and non-zero exit. Values must not be guessed from production-like defaults.
- Liveness is independent of dependency health. Readiness is `503` if any required dependency is unavailable, identifies only the failing dependency class, and returns to `200` after recovery without restarting when the client library supports reconnection.
- A caller-supplied correlation ID is accepted only if it satisfies the documented length/character policy; invalid or absent input is replaced, never echoed unsafely. One correlation ID connects request, outbox record, job and worker logs.
- Logs must be machine-parseable JSON and must not contain environment values, passwords, tokens, MinIO keys, complete connection strings, raw queue payloads, unmasked PII or stack traces in normal health responses.
- Compose images use an exact version or digest, never `latest`. Containers have health checks and named volumes; teardown does not delete volumes unless an explicit local/test reset command is invoked.
- Port collision, unavailable Docker daemon, dependency timeout and partial service availability must fail with actionable local documentation and non-zero commands, never a false green health result.
- Existing product API handlers remain prototype-only. Their in-memory mutation, static auth and simulated carrier gaps are not fixed, hidden or relabeled by this Work Item.
- No command may require a native PostgreSQL, Redis or MinIO installation, WSL/Ubuntu, a globally installed Nest/Prisma/BullMQ CLI, or a committed `.env` file.

## UI states

No product screen changes are authorized, so product loading, empty, validation, error, forbidden, partial, success and recovery UI states are `N/A`.

Operational state coverage is still required:

- Startup/loading: liveness becomes available when the process is alive; readiness remains `503` while required dependencies initialize.
- Empty: an empty database, empty bucket and empty queue are valid after migration and must not make readiness fail.
- Validation: missing/malformed environment configuration fails before accepting work, with field names but no secret values.
- Error: each unavailable dependency yields sanitized `503` readiness evidence and a non-zero smoke command.
- Forbidden: no product authorization surface exists; health endpoints expose only non-sensitive operational state.
- Partial: liveness may remain `200` while readiness is `503`; one failed service must not be reported as all services healthy.
- Success: API and worker liveness/readiness return `200`, migration status is current and one synthetic event is processed once.
- Recovery: restoring a dependency allows readiness and pending outbox delivery to recover without data loss or manual database edits.

## API, event and data impact

- Add operational endpoints for both services:
  - `GET /health/live` (`API-FOUND-HEALTH-LIVE`) returns `200` when that process is alive and does not query dependencies.
  - `GET /health/ready` (`API-FOUND-HEALTH-READY`) returns `200` only when required dependencies pass bounded checks; otherwise it returns `503` with sanitized per-dependency status.
- The health contract is operational, not a claim that any `/api/v1` product resource exists. If represented in `docs/product-spec/contracts/openapi.yaml`, changes are limited to these health operations and their minimal schemas.
- Add internal `EVT-FOUND-QUEUE-SMOKE` solely for deterministic verification. It is not a product event schema and cannot be routed to an external adapter.
- Add the smallest technical `ENT-FOUND-OUTBOX` persistence shape required for durable dispatch, including stable identifier, event type, sanitized payload/reference, correlation identifier, created/available timestamps, delivery state, bounded attempt/error metadata and a uniqueness/dedupe guard. The final field design must preserve at-least-once safety and be recorded in the migration.
- Keep one canonical Prisma schema and checked-in migration history. The initial migration must apply to an empty PostgreSQL 16+ database and `migrate status` must be clean. Existing product fields are preserved, not treated as final source-of-truth semantics.
- Migration rollback is application rollback against an additive, backward-compatible schema. No automated down migration may drop retained records; destructive reset is permitted only for an explicitly isolated local/test database and must require a clearly named command.
- No existing product endpoint, JSON response, event schema, route path or web consumer changes. No data is copied from the in-memory prototype, and no production data migration is implied.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-FOUND-03-01` / `TEST-FOUND-03-01` | Given the merged monorepo, when workspace structure and manifests are inspected | `apps/api` and `apps/worker` are real NestJS workspaces with independent build/start commands; accepted package families are exact/lockfile-pinned and no global framework CLI is required | File diff, lockfile proof, `pnpm build`, package command output |
| `AC-FOUND-03-02` / `TEST-FOUND-03-02` | Given a clean machine with Docker Compose, when documented local startup runs | Pinned PostgreSQL 16+, Redis and S3-compatible containers become healthy using named volumes and local-only documented ports; no native service or Ubuntu install is requested | `docker compose config --images`, startup/health logs, README evidence |
| `AC-FOUND-03-03` / `TEST-FOUND-03-03` | Given safe example configuration, when API and worker start | Valid local configuration starts both processes; missing/malformed required configuration exits non-zero before work is accepted and does not print secret values | Config validation tests and sanitized positive/negative logs |
| `AC-FOUND-03-04` / `TEST-FOUND-03-04` | Given either process is running, when its liveness endpoint is called | `GET /health/live` returns bounded `200` response independent of PostgreSQL/Redis/S3 state and includes a valid correlation ID without sensitive metadata | Automated HTTP smoke for API and worker, response snapshots |
| `AC-FOUND-03-05` / `TEST-FOUND-03-05` | Given all required services are healthy, when readiness is called | API and worker `GET /health/ready` return `200` with minimal per-dependency state | Automated HTTP smoke for both processes |
| `AC-FOUND-03-06` / `TEST-FOUND-03-06` | Given PostgreSQL, Redis or S3 is unavailable one at a time, when readiness is called | Liveness stays `200`; readiness is bounded and returns `503` naming only the dependency class; restoration returns readiness to `200` without false success | Deterministic dependency-failure/recovery tests and logs |
| `AC-FOUND-03-07` / `TEST-FOUND-03-07` | Given an empty PostgreSQL 16+ database, when root generation/migration commands run | Canonical Prisma client generation succeeds, checked-in initial migration applies once, repeated deployment is idempotent and migration status is current | `pnpm db:generate`, `pnpm db:migrate`, repeated deploy/status output |
| `AC-FOUND-03-08` / `TEST-FOUND-03-08` | Given application database work creates a synthetic outbox event, when its transaction commits or rolls back | Commit persists both records atomically; rollback persists neither; dispatcher never publishes an uncommitted event | Database integration tests and row assertions |
| `AC-FOUND-03-09` / `TEST-FOUND-03-09` | Given one committed `EVT-FOUND-QUEUE-SMOKE` outbox record, when dispatch and worker execution run | BullMQ receives it only after commit, worker records exactly one deterministic smoke effect, and correlation ID is preserved end to end | Queue/worker integration test, database assertions, correlated logs |
| `AC-FOUND-03-10` / `TEST-FOUND-03-10` | Given duplicate delivery, transient publish/handler failure and exhausted retry scenarios | Duplicate/retry does not duplicate the committed smoke effect; pending/failed state and bounded attempts are observable and recoverable without external effects | Retry/dedupe/dead-letter or failed-state tests and exact assertions |
| `AC-FOUND-03-11` / `TEST-FOUND-03-11` | Given HTTP and queue processing, when logs are captured | Every line is parseable structured JSON, valid/generated correlation propagates across boundaries, and secret/PII fixtures are absent or redacted | Log parser/redaction tests with negative fixtures |
| `AC-FOUND-03-12` / `TEST-FOUND-03-12` | Given existing web routes, prototype state and preservation suites, when the full root gate runs | Existing URLs, visible behavior, 130-feature inventory classifications and prior tests remain unchanged; no product feature is marked complete | `pnpm test:e2e`, `pnpm test:baseline`, inventory/regression outputs and diff review |
| `AC-FOUND-03-13` / `TEST-FOUND-03-13` | Given a clean checkout and CI, when all documented root commands run | Production-only install, full install, generation, lint, format, typecheck, unit/integration, E2E, baseline, secret scan and build all succeed; required infra failures make CI fail closed | GitHub Actions URLs, exact command/exit-code table, clean-tree proof |
| `AC-FOUND-03-14` / `TEST-FOUND-03-14` | Given the implementation Pull Request, when scope and handoff are reviewed | Exactly this Work Item is present; all changes stay within Allowed paths; every acceptance row has real evidence; no credential/live carrier/product implementation exists; limitations explicitly say `None` or name owner/risk/action | PR file list, acceptance evidence, secret scan, Codex review |

## Verification commands

Run from a clean checkout. Commands introduced by this Work Item must be real and fail closed; they may not be successful no-ops. The implementation may choose the exact Compose filename under `infra/docker/**`, but README, package scripts and CI must use one consistent path.

1. `node --version`
2. `pnpm --version`
3. `pnpm install --prod --frozen-lockfile`
4. `pnpm install --frozen-lockfile`
5. `pnpm db:generate`
6. `docker compose -f infra/docker/compose.yml config --quiet`
7. `pnpm infra:up`
8. `pnpm infra:wait`
9. `pnpm db:migrate`
10. `pnpm db:migrate:status`
11. `pnpm lint`
12. `pnpm format:check`
13. `pnpm typecheck`
14. `pnpm test`
15. `pnpm test:integration`
16. `pnpm test:e2e`
17. `pnpm test:baseline`
18. `pnpm run verify:inventory`
19. `pnpm security:secrets`
20. `pnpm build`
21. `git diff --check origin/main...HEAD`
22. `git status --short`
23. `pnpm infra:down`

CI must additionally prove one-at-a-time dependency failure/recovery and execute teardown in an always-run cleanup step. The production-only install must run in a separate clean checkout or job before full development dependencies are restored.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<implementation commit>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links or None>` |

## Residual limitations

- The existing 17-model Prisma schema is a preserved prototype asset and does not fully match the target entities in `docs/product-spec/docs/04-data/**`. This Work Item may make it migratable but may not silently choose product semantics; later vertical schema changes remain governed by their source IDs and reviewed migrations.
- The existing Next.js API handlers, in-memory state, static authentication and simulated carrier actions remain prototype-only and are not connected to the new API/database by this Work Item.
- `TASK-FOUND-04` still owns complete OpenAPI drift enforcement, Supertest/Vitest/Playwright, deterministic carrier mocks, Storybook/MSW/a11y/visual/performance gates and seed-reset procedures.
- The `TASK-AI-05` delivery-register row is stale at `READY_FOR_CODEX`, but GitHub PR `#7` and planning base commit `a344b69af3c1c9dc4469d0ccdefe15c130bb2188` prove it is merged. This Work Item does not alter another row.
