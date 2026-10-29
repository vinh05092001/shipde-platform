# FEAT-COM-02 — Shared list behaviour

## Control

| Field           | Value                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `FEAT-COM-02`                                                                                                                                                                         |
| Feature ID      | `FEAT-COM-02`                                                                                                                                                                         |
| Status          | `IN_PROGRESS`                                                                                                                                                                         |
| Delivery order  | `21`                                                                                                                                                                                  |
| Dependencies    | `TASK-FOUND-04`                                                                                                                                                                       |
| Assigned author | Codex, explicitly assigned by the user for this run                                                                                                                                   |
| Risk            | HIGH — tenant isolation and shared consumer compatibility                                                                                                                             |
| Allowed paths   | `packages/contracts/src/`, relevant `apps/api/src/` list consumers and tests, `packages/config/src/`, `docs/product-spec/contracts/openapi.yaml`, this Work Item and its register row |
| Reviewer        | Codex — fresh independent task; implementation author cannot approve                                                                                                                  |
| Branch          | `feat/feat-com-02`                                                                                                                                                                    |
| Pull Request    | None; push and commit prohibited for this run                                                                                                                                         |

## Business outcome

Shop users can filter, sort and page operational lists consistently within their authorized tenant.
Saved views and column settings preserve useful working layouts. This is one complete feature;
the backend requested for this run is a technical slice, not proof of feature completion.

## Source references

- [Baseline and Decisions](../docs/00-control/BASELINE-AND-DECISIONS.md), “Product decisions”
  DEC-016 and “Change control”: shared TypeScript contracts and tenant-isolation regression evidence.
- [Product Vision and Scope](../docs/01-product/PRODUCT-VISION-SCOPE.md), “Boundaries”:
  no cross-tenant access.
- [Master Feature Catalog](../docs/01-product/MASTER-FEATURE-CATALOG.md), “2. Shared platform”,
  FEAT-COM-02: filter, sort, pagination, saved views and column settings.
- [Design System and UX Rules](../docs/03-ux/DESIGN-SYSTEM-UX-RULES.md), “Product UX principles”
  item 7, “Visual foundation”, “Canonical components”, “Responsive” and “Accessibility”:
  efficient operational tables, filter bars, saved views, accessible headers and overflow handling.
- [Screen Specifications](../docs/03-ux/SCREEN-SPECIFICATIONS.md), “Shared screen contract”:
  safe stable filter URLs, loading, empty, recoverable error, forbidden and not-found states.
- [Internal API](../docs/05-api-integrations/INTERNAL-API.md), “API conventions” and “Error envelope”:
  server-authorized tenant, pagination consistent within an endpoint family, canonical errors.
- [Error, Idempotency and Retry](../docs/05-api-integrations/ERROR-IDEMPOTENCY-RETRY.md),
  “Canonical error classes” and “Retry policy”: `VALIDATION_ERROR`, `FORBIDDEN`, safe read retries.
- [OpenAPI](../contracts/openapi.yaml), `GET /users`, `ListUsersResponse`,
  `components.parameters.Page` and `PageSize`: existing wire-contract compatibility.
- [Backlog and Dependencies](../docs/09-delivery/BACKLOG-DEPENDENCIES.md), “Epics” and
  “Planning rules”: foundation first; technical slices stay under one deliverable story.

## Preconditions and dependencies

Product foundation is available: the delivery register records `TASK-FOUND-04` as `MERGED`,
review `PASS`, commit `9d101f4e5d9de9b880cc4311126ce8fe06de4206`.
The FEAT-COM-02 register row names this foundation and the backlog dependency document;
that document does not name an additional FEAT-COM-02 prerequisite.
Existing `SessionGuard`, `PermissionsGuard` and tenant-scoped list services are reused.
Their prerequisite Work Items are present in `origin/main`, independently of stale register rows.

Workspace dependencies are installed as of 2026-10-29; the earlier missing-node_modules
blocker is removed. `origin/main` includes RBAC-01/02, USR-01/02, PRO-01, ORG-01 and
AUTH prerequisites; stale register statuses are not dependency gates for this run.

## Author boundary

The user explicitly assigned this backend slice to Codex. A 9Router assignment is unsuitable because
tenant isolation and shared API contracts cross its permitted boundary. Independent review and
human merge remain required. This run implements the explicitly assigned backend slice and its tests.

## In scope

- Shared pagination, filter and sort request/response contracts in `packages/contracts`.
- Reuse an existing authenticated list endpoint as the first backend consumer; retain its session
  and permission checks and its response projection that excludes credentials.
- Derive tenant scope from authorized server membership, apply it to both rows and counts, and
  scope related lookups as well. Query fields cannot supply or override ownership.
- Validate pagination and endpoint-supported filters/sort fields before database access; use
  canonical errors without echoing sensitive input.
- Read page defaults, limits and sort/filter policy from explicit configuration or registry data;
  fail closed when required policy is missing or malformed.
- Preserve pagination conventions within existing endpoint families. `/users` uses `page`/`limit`
  (default limit 20, maximum 100 in OpenAPI); shared `PageSize` uses `page_size` (50, maximum 200).
  These are existing contract evidence, not permission to scatter numeric literals in code.
- Keep full-feature UI, saved-view persistence and column-setting acceptance under this same item.

## Out of scope

Carrier actions, money calculations, new authentication/authorization policy, unrelated list rewrites,
bulk actions, exports, gate configuration changes, commits and pushes are outside this run.

## Business rules and edge cases

Pagination must reject malformed, fractional, negative and unsafe numeric inputs through
`VALIDATION_ERROR`, with no database query. Preserve existing documented boundary behaviour;
record any intended compatibility change before implementation. Sorting must use supported fields
and a deterministic unique tie-breaker. Arbitrary query objects must never become ORM predicates.
Filters must affect count and row queries identically. Missing authorized tenant fails closed before
either query. Empty results are successful empty data, not forbidden or provider failure. Read errors
must remain distinguishable from empty results and support safe retry without leaking data.

Saved-view ownership, visibility and persistence, column preference storage and endpoint-specific
sort/filter policies require explicit contracts before that portion is implemented. The catalog does
not authorize inventing cross-user sharing or exposing tenant identifiers in URLs.

## UI states

No UI is changed in this run. Full-feature acceptance still requires loading skeleton, empty data,
invalid-filter feedback, recoverable error/retry, forbidden, not-found where applicable, successful
filter/sort/page navigation, stable safe URL recovery, saved-view restoration and column settings.
Partial failures must be visible when a consuming screen combines multiple data sources.
Use accessible table headers, keyboard focus and responsive overflow without dropping data.

## API, event and data impact

Reuse `/api/v1` authenticated resource groups and canonical error handling. Add shared TypeScript
types without silently renaming existing query or metadata fields; synchronize OpenAPI and generated
types when a wire contract changes. Validate schema, consumer and compatibility behaviour together.
List reads have no external effects, events, jobs or idempotency-key requirement. No database schema or
migration is introduced in this backend run. Saved-view persistence requires a later explicit design
within this Work Item, including tenant/user ownership and migration evidence.

## Acceptance matrix

Backend criteria AC-COM-02-01 through AC-COM-02-11 have local mocked-test evidence below.
Repository-wide gates and live database verification remain incomplete. AC-COM-02-12 and
AC-COM-02-13 are deferred beyond this backend slice; the feature stays `IN_PROGRESS`.

| AC/Test ID   | Scenario                                                          | Expected result                                                         | Evidence required                                                      |
| ------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| AC-COM-02-01 | Valid configured page and size                                    | Correct database offset/limit and compatible metadata                   | Shared parser tests and consumer test asserting actual returned rows   |
| AC-COM-02-02 | Omitted page parameters                                           | Defaults come from endpoint policy                                      | Test with differing injected policies; existing consumer compatibility |
| AC-COM-02-03 | Malformed, fractional, negative, unsafe or repeated numeric input | Canonical validation error; no database read                            | Parser and HTTP tests asserting status/envelope and zero reads         |
| AC-COM-02-04 | Required policy absent or malformed                               | Fail closed; no fallback caps or queries                                | Negative configuration tests                                           |
| AC-COM-02-05 | Supported filter combined with pagination                         | Rows and total describe the same filtered tenant set                    | Multi-tenant fixture with matching/nonmatching rows and exact totals   |
| AC-COM-02-06 | Supported ascending/descending sort and tied values               | Correct ordering and deterministic page boundaries                      | Fixture assertions across adjacent pages                               |
| AC-COM-02-07 | Unsupported sort/filter or ownership override input               | Canonical validation error; no predicate injection                      | Negative HTTP tests including nested/object/array inputs               |
| AC-COM-02-08 | Authenticated tenant A with matching tenant B rows                | No B rows, counts or related lookup data                                | Consumer and HTTP isolation tests, including related role lookup       |
| AC-COM-02-09 | Missing session, permission or authorized tenant                  | Existing canonical authentication/forbidden result; no list query       | Guard and consumer negative tests                                      |
| AC-COM-02-10 | Empty data or database failure                                    | Empty success is distinct from recoverable failure; no PII leakage      | HTTP response assertions with safe error content                       |
| AC-COM-02-11 | Existing list consumer and schema generation                      | Existing family query/response fields remain compatible                 | Consumer regressions, OpenAPI generation and contract check            |
| AC-COM-02-12 | Full-feature filter/sort/page interaction                         | All shared screen states, safe URLs, keyboard and responsive use        | Browser acceptance and screenshots; deferred beyond this backend run   |
| AC-COM-02-13 | Save/restore views and column settings                            | Persist only explicitly authorized preferences within defined ownership | Ownership contract, persistence tests and browser evidence; deferred   |

## Verification commands

Run from the workspace root with foreground timeouts:

```text
pnpm exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/users/users.unit.spec.ts apps/api/src/users/users.scopes.unit.spec.ts
pnpm --filter @shipde/api test
pnpm contract:check
node scripts/ai/check-no-hardcode.mjs
pnpm exec prettier --check docs/product-spec/work-items/FEAT-COM-02.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv
pnpm typecheck
pnpm lint
```

`users.unit.spec.ts` imports `lists.unit.spec.ts`, so the existing API test command includes the
new shared-contract and HTTP fixture coverage. Add changed source files to the format command.
Redirect area-suite output to a file and inspect summary/failures. Do not claim completion until
required checks pass.

Verification on 2026-10-29, branch `feat/feat-com-02`, base `9648f3efd4789481480c0c4cbd9977b788be4cab`:

- Narrow API regression and list contract/HTTP tests: **26 passed, 0 failed**;
  existing scope-assignment unit tests: **18 passed, 0 failed** (**44 total**).
  `@shipde/contracts` has no test script; its shared parser is exercised by `lists.unit.spec.ts`.
- `pnpm --filter @shipde/config --filter @shipde/contracts build`: exit 0 before tests,
  ensuring API consumers load the current shared implementation.
- `pnpm --filter @shipde/api typecheck`, `pnpm --filter @shipde/contracts typecheck`,
  `pnpm --filter @shipde/config typecheck`: exit 0.
- Corresponding package `lint` commands: exit 0.
- Fresh `pnpm contract:check`: exit 0, 58 endpoints, generated types synchronized.
- `pnpm --filter @shipde/api test`: exit 1 before tests because the workspace build artifact
  `@shipde/testkit/dist/index.js` is absent. This does not invalidate the 44 narrow tests above;
  the complete API suite has not passed.
- `node scripts/ai/check-no-hardcode.mjs`: exit 0, **0 files scanned** because changes are
  uncommitted. Explicit changed-source scanning finds the existing
  `packages/config/src/index.ts:13` `DEFAULT_RBAC_SEED_MAX_ATTEMPTS: 10` violation.
  `node scripts/ai/check-no-hardcode.mjs --rev HEAD packages/config/src/index.ts`
  reproduces the same violation on the unchanged base. No gate or unrelated RBAC code changed.
- Root `pnpm typecheck` and `pnpm lint`: exit 1 before package checks, because Turbo's mandatory
  `db:generate` cannot download the Prisma engine from `binaries.prisma.sh` in this environment.
  This is separate from the removed missing-dependencies blocker.
- Prisma client types were generated with `--no-engine` for mocked tests. Engine path environment
  overrides were scoped to that generation process to avoid downloading unused engines; no engine
  was executed. This does not verify database connectivity or real Prisma queries.
- Formatting: changed TypeScript files checked with Prettier; documentation is ignored by the
  repository's standard Prettier configuration. Work Item markdown is additionally formatted and
  checked explicitly using `--ignore-path NUL`.

AC evidence mapping:

| ACs   | Backend evidence                                                                                               | Remaining boundary                                                      |
| ----- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 01-02 | Actual returned rows/metadata and alternative injected parser defaults                                         | No live DB evidence                                                     |
| 03-04 | Invalid scalar/array/object/unsafe input and malformed/missing policy rejected; HTTP errors precede reads      | Policy absence tested at canonical helper boundary                      |
| 05-08 | HTTP fixture verifies filtered rows/counts, ascending/descending tie-breaks, tenant and related-role isolation | Prisma behaviour represented by fixture adapter                         |
| 09    | Missing tenant fails closed with no reads; HTTP guard denial responses preserved                               | HTTP harness overrides session/permission guards; real guards unchanged |
| 10    | Empty success differs from safe retryable 503 without DB detail                                                | No production outage test                                               |
| 11    | Existing users regression plus OpenAPI generation/check                                                        | Existing wire fields retained                                           |
| 12-13 | Deferred                                                                                                       | UI, saved views, column persistence and browser acceptance              |

Compatibility: `page`/`limit`, defaults, maximum-limit clamping and empty `total_pages=1` remain.
Malformed/nonpositive values now return `VALIDATION_ERROR` instead of numeric coercion; unknown
query keys and enum values are rejected. Sort fields and directions are explicitly documented in
OpenAPI and centralized in `USERS_LIST_POLICY`. Query values never become arbitrary ORM predicates.

## Codex review record

No independent review requested or completed. No reviewed implementation commit exists.

## Residual limitations

Owner: implementation author. UI, saved views and column settings remain required before
full-feature completion. No feature-complete or production-ready claim is made.
