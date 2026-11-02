# FEAT-COM-02 — Shared list behaviour

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `FEAT-COM-02` |
| Feature ID | `FEAT-COM-02` |
| Status | `BLOCKED` — remaining review and verification constraints below |
| Dependencies | `TASK-FOUND-04` |
| Assigned repair author | Codex, explicitly assigned by the user |
| Branch | `feat/feat-com-02-api` |
| Pull Request | #479 — one API and UI delivery |
| Reviewed commit | `79757c05ebf4f9748061bb569ba568c3e436bfd4` |
| Reviewer | Fresh independent Codex task after the repair commit; the author cannot approve |

## Business outcome and sources

Users filter, sort and paginate Users, Branches and Warehouses within their authorized
tenant. Screens use the server's rows and pagination metadata together. Saved views and
column settings belong to the authenticated tenant, user and list. This Pull Request
contains both API behaviour and its connected consumers.

- [Baseline and Decisions](../docs/00-control/BASELINE-AND-DECISIONS.md): DEC-016 and change control.
- [Product Vision and Scope](../docs/01-product/PRODUCT-VISION-SCOPE.md): tenant boundaries.
- [Master Feature Catalog](../docs/01-product/MASTER-FEATURE-CATALOG.md): FEAT-COM-02.
- [Design System and UX Rules](../docs/03-ux/DESIGN-SYSTEM-UX-RULES.md): filter bars, saved views, accessibility and responsive controls.
- [Screen Specifications](../docs/03-ux/SCREEN-SPECIFICATIONS.md): shared loading, empty, error, forbidden and recovery states.
- [Internal API](../docs/05-api-integrations/INTERNAL-API.md): authorized tenant, pagination and canonical envelopes.
- [Error, Idempotency and Retry](../docs/05-api-integrations/ERROR-IDEMPOTENCY-RETRY.md): validation, forbidden and safe read retries.
- [OpenAPI](../contracts/openapi.yaml): existing Users, Branches and Warehouses wire contracts.
- [Shared Agent Contract](../../../AGENTS.md) and the restored app author checklists.

## Scope and boundaries

The API uses shared policy-driven parsing for page, limit, supported filters and sort
fields, with a deterministic unique tie-breaker. Unsupported or malformed input is
rejected before queries. Data and count predicates include the authenticated tenant
and the live actor's assigned scopes. Empty or missing scopes grant no access, including
for OWNER actors. Unrestricted access requires an explicit wildcard.

The Users screen, its embedded Branches view, and the Branches/Warehouses settings pages
forward page, limit, search, status and sort changes to the API. Users retains its
20-row default; Branches and Warehouses use the approved 10-row defaults. Scope pickers
load every authorized branch page independently of the visible page.

Browser consumers import the canonical parser and policies through a browser-safe export
module. Request callbacks remain stable and abort stale requests. Metadata and rows are
bound to the same authenticated context. Missing identity disables preferences and denies
list reads. Preference keys encode the tenant/user/list tuple; malformed stored views
and URL parameters cannot inject arbitrary queries.

Allowed changes include the relevant API services/controllers/tests, web consumers and
shared list helpers, contracts, this Work Item and its register row. Review findings also
authorize restoration of the existing carrier catalog, schema/migration history, seed,
testkit data, approved delivery records and author documentation from `origin/main`
(`c6e71fcb9354cd2b14d1f5dcaed794abff306991`).

No new database schema or migration is introduced. The catalog schema and historical
migration are restored from the integration reference. Executable gate configurations,
allowlists, test baselines, Semgrep rules and `.github/` remain outside the repair scope.
Unrelated pre-existing TASK-AI-155 changes are preserved and excluded from the repair commit.
Cross-device preference synchronization remains outside this delivery.

## Business and security invariants

- Tenant ownership comes from the authenticated actor. Client ownership overrides cannot
  become list predicates; foreign entity reads and mutations return canonical denial.
- Empty, missing, foreign and unassigned scopes cannot create, update, activate, deactivate,
  delete or change defaults. A scoped default change also authorizes the previous default
  before any mutation inside the transaction. Warehouse create, update and default writers
  share a tenant row lock so concurrent changes cannot bypass that authorization.
- Actual audit writes recursively mask phone, email, bank account, token, secret,
  credential, authorization and API-key fields in both old and new metadata, including
  nested objects and arrays. Audit masking does not alter business records.
- HTTP/database failures and malformed response metadata render recoverable errors.
  They cannot render an empty success or expose database diagnostic text.
- A filtered empty page cannot establish that a new branch or warehouse is the tenant's
  first record. The API determines automatic first-record defaults; the UI only requests
  a default change when explicitly selected.
- Pagination controls and summaries use server totals. Status summaries are not inferred
  from the current page. Out-of-range recovery fetches the last real page.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence |
| --- | --- | --- | --- |
| AC-COM-02-01 | Configured page and size | Correct offset, limit, rows and metadata | `lists.unit.spec.ts`, Branches/Warehouses unit suites; browser page-two assertions exclude page-one rows |
| AC-COM-02-02 | Parameters omitted | Endpoint policy defaults, compatible consumers | Parser policy tests; actual Users/Branches/Warehouses browser requests |
| AC-COM-02-03 | Malformed, fractional, negative, unsafe or repeated input | Canonical validation error; zero reads | Parser and HTTP fixture negatives in `lists.unit.spec.ts` |
| AC-COM-02-04 | Policy absent or malformed | Fail closed before queries | Negative configuration/parser tests in `lists.unit.spec.ts` |
| AC-COM-02-05 | Filter plus pagination | Rows/counts share tenant and filter predicates | Multi-tenant service/HTTP fixtures and browser filter requests |
| AC-COM-02-06 | Ascending/descending sort with ties | Deterministic adjacent pages | Fixture ordering assertions and actual browser sort requests |
| AC-COM-02-07 | Unsupported sort/filter/ownership input | Validation error; no arbitrary predicate | Negative HTTP query tests |
| AC-COM-02-08 | Matching foreign-tenant records | No foreign rows, counts or related lookup data | Existing list fixtures and `review-regressions.http.spec.ts` foreign-entity negatives |
| AC-COM-02-09 | Missing identity, permission or scopes | Canonical denial; no unauthorized writes | Real controller/permission-guard HTTP fixture negatives; browser hydration/identity negatives |
| AC-COM-02-10 | Empty data, outage or malformed metadata | Distinct empty, retryable error and forbidden states | HTTP outage tests; browser negative error/empty assertions and retry |
| AC-COM-02-11 | Existing consumers and catalog | Compatible envelopes and retained catalog/schema/history | Contract generation/check; catalog unit/HTTP suites; preservation negatives |
| AC-COM-02-12 | Page/filter/sort and recovery interactions | Connected server requests, loading, no-results reset, forbidden, keyboard/mobile use | `shared-lists-browser.test.ts`; shared-list and existing screen state suites |
| AC-COM-02-13 | Save/apply/delete views and toggle columns | Authenticated tuple ownership and visible persistence failure | Actual browser save/apply/delete/reload, hidden-column and tenant/user isolation negatives |

## API, persistence and operational changes

Changed list routes are `GET /api/v1/users`, `GET /api/v1/branches` and
`GET /api/v1/warehouses`; existing family query names and response fields remain.
Branches retains `data.branches`, `data.can_edit` and its compatible nested metadata.
Malformed/nonpositive input returns `VALIDATION_ERROR` rather than coercion.
Unexpected list failures return safe retryable `503 TEMPORARILY_UNAVAILABLE`.

Branch mutation predicates include merchant ownership. Branch and warehouse audit
payloads are masked at the persistence boundary. Warehouse scope lookup rejects missing
tenant identity before reading membership, and default replacement denies changes affecting
an unassigned previous default while holding the tenant lock. No external carrier command,
money operation, new job or new preference persistence model is added.

The five existing carrier catalog endpoints, canonical `JT` code, boundary aliases,
RBAC permissions, seed data, testkit fixtures and catalog regression suites are restored.
Existing API test entry points invoke the restored catalog unit and live HTTP suites;
test scripts and gate settings are unchanged.

## Verification commands

Run from the workspace root; `pnpm.cmd` avoids the host PowerShell script policy.

```text
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd --filter @shipde/api test
git diff --check origin/main...HEAD
git diff --check
pnpm.cmd contract:check
node scripts/ai/check-no-hardcode.mjs
pnpm.cmd exec tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/users/users.unit.spec.ts apps/api/src/users/users.scopes.unit.spec.ts apps/api/src/branches/branches.unit.spec.ts apps/api/src/warehouses/warehouses.unit.spec.ts
pnpm.cmd --filter @shipde/web exec tsx src/tests/shared-lists-states.test.ts
```

For connected browser acceptance, start Next in a separate shell, then run the suite:

```text
pnpm.cmd --filter @shipde/web dev --hostname 127.0.0.1 --port 3217
pnpm.cmd --filter @shipde/web exec tsx src/tests/shared-lists-browser.test.ts
```

`SHIPDE_LIST_TEST_URL` selects another running Next URL. `SHIPDE_LIST_TEST_ARTIFACTS`
enables PNG capture. Tests use synthetic HTTP fixtures at the API boundary; they exercise
the actual pages, authentication hydration, list hooks and controls. This is browser
interaction evidence, not live database or external carrier evidence.

Before database-backed tests, `docker info` must succeed. Start Docker Desktop when
necessary, then `docker start shipde-postgres shipde-redis shipde-minio`. After tests,
run `docker stop shipde-postgres shipde-redis shipde-minio`. An offline skip does not
count as database verification.

## Local repair evidence — 2026-11-02

- Negative preservation/scope tests were observed failing before their repairs.
- HTTP audit tests invoke real controllers, permission guards and mutation services;
  only session identity and persistence are fixture adapters. Captured `auditLog.create`
  writes prove masking across every branch/warehouse mutation path.
- The missing-tenant warehouse membership negative failed with wildcard access before
  the guard repair; it now denies without a membership query.
- The scoped warehouse default test failed with `201` before the fix and now denies with
  `403` and zero writes. A positive control allows fully assigned default replacement.
- Existing database-backed Branches and Warehouses supertest entry points now include
  empty OWNER mutation denial, scoped count assertions and immutable row/audit checks.
  Warehouse coverage also checks nested sensitive values in real persisted before/after
  audit diffs, and overlapping transactions for create, update and set-default paths.
  These added live regressions remain unexecuted until the Docker prerequisite is met.
- Chromium browser acceptance passes **11 scenario groups**, including negative
  page-one visibility, preference ownership, error/empty separation, hydration and
  default-promotion assertions. Shared-list state coverage passes **13 scenario groups**.
- Contract check passes with **71 endpoints** and zero generated-type drift.
- Final root `pnpm.cmd lint` and `pnpm.cmd typecheck` pass (12 successful tasks each).
- The selected API unit/HTTP fixture command passes **187 tests**, **36 suites**, with
  **zero failures and zero skips**. This is distinct from the full API test gate.
- The four changed/new API HTTP and review regression files also pass a separate `tsc`
  check using a temporary configuration, because the normal API typecheck excludes specs.
- Existing Users, scope assignment, Branches and Warehouses screen state suites pass.
  Warehouse accessibility assertions verify error states hide stale edit controls while
  a successful list retains accessible edit labels.
- `git diff --check origin/main...HEAD` and the working-tree diff check pass.
- Repair source/test files pass Prettier. Root `pnpm.cmd format:check` reports one
  pre-existing untracked failure in `.oc/pr-body-template.md`; that unrelated draft remains
  untouched and is excluded from the repair commit.
- `node scripts/ai/check-no-hardcode.mjs` returns success but scans **zero configured
  files**, so its result supplies no additional coverage for these product changes.
- The complete `pnpm.cmd --filter @shipde/api test` command remains pending Docker access.
- Screenshots in the local artifact directory include branch pagination, embedded
  Branches page two, Warehouse page two/columns, forbidden and mobile recovery.
  No new exact-SHA CI or independent review verdict is claimed.

## Review closure and remaining blockers

| Review finding | Repair and evidence | State |
| --- | --- | --- |
| P1 #1 — catalog removal | Restored implementation/permissions/contracts/seed/testkit and regression entry points; registration, alias, unknown-code and permission HTTP negatives | Repaired locally |
| P1 #2 — migration history removal | Restored existing schema and catalog migration; negative preservation test for all five models/tables | Repaired locally |
| P1 #3 — approved governance rollback | Restored five delivery records/Work Items, their traceability, root advisory rule and app/workflow author documentation; preservation negatives pass | Partial: product baseline clarification pending |
| P1 #4 — incomplete vertical handoff | This branch/PR includes connected API and UI; split-delivery claims removed; executable browser evidence and handoff negative | Repaired locally |
| P1 #5 — previous-review closure gaps | HTTP mutation/audit/tenant negatives and actual browser interactions replace helper-only claims; live scoped/audit/default race regressions added | Full database-backed API gate pending |

`[NEEDS CLARIFICATION]` Finding #3 also requests restoration of two approved decision
rows in `docs/00-control/BASELINE-AND-DECISIONS.md`, while this repair instruction
explicitly prohibits touching baselines. That file remains unchanged until the operator
resolves the conflict. The exact restoration can be reviewed as a local patch.

Docker Desktop was started, but `docker info` is denied access to the engine pipe in this
sandbox. The operator has been asked to confirm host-side `docker info` and container
startup. No database-backed API suite, successful container lifecycle or repair commit
is claimed. Commit only after the remaining finding is resolved and every required check
passes. Do not push.

## Known limitations

Preferences persist in browser storage for one authenticated tenant/user/list tuple;
cross-device synchronization requires a future approved server-preferences contract.
Browser and HTTP fixture evidence does not replace the pending real database-backed API
suite. The product-baseline restoration, full API gate and fresh independent review
remain outstanding.
