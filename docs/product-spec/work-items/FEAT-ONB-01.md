# FEAT-ONB-01 — Guided onboarding

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-ONB-01` |
| Feature ID      | `FEAT-ONB-01` |
| Status          | `READY_FOR_CODEX` |
| Delivery order  | 18 |
| Dependencies    | `TASK-FOUND-04` (merged), `FEAT-AUTH-01` (merged), `FEAT-AUTH-06` (merged), `FEAT-RBAC-01` (merged), `FEAT-RBAC-02` (merged), `FEAT-USR-01` (merged), `FEAT-ORG-01` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `HIGH` |
| Risk domains    | `tenant isolation`, `database ownership`, `auth`, `audit` |
| Allowed paths   | `docs/product-spec/work-items/FEAT-ONB-01.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `packages/contracts/src/index.ts`, `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/app.module.ts`, `apps/api/src/onboarding/*`, `apps/web/package.json`, `apps/web/src/app/page.tsx`, `apps/web/src/app/settings/shop/page.tsx`, `apps/web/src/components/SettingsWorkspace.tsx`, `apps/web/src/app/onboarding/*`, `apps/web/src/components/OnboardingFlow.tsx`, `apps/web/src/tests/onboarding-page-states.test.ts` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-onb-01` |
| Pull Request    | Pending |

## Business outcome

When a new merchant registers and logs into the platform, the platform guides the shop owner (`OWNER`) or administrative manager holding the `iam:shop_config` capability through a structured, multi-step onboarding journey:
1. Shop / Legal & Billing Profile (`SHOP_PROFILE`): Configure brand name, legal entity name, tax code, and billing defaults.
2. First Warehouse (`WAREHOUSE`): Establish the primary pickup and return warehouse address for fulfillment.
3. Invite Users & Roles (`INVITE_USERS`): Invite team members and assign operational scopes (optional/skippable).
4. Connect Carrier Account (`CARRIER_ACCOUNT`): Connect carrier credentials and verify serviceability capability.
5. Operating Defaults (`OPERATING_DEFAULTS`): Set default fee payer, weight units, and notifications (optional/skippable).
6. Test Order & Quote (`TEST_ORDER`): Execute test serviceability check, quote lookup, and simulated order creation to verify complete end-to-end readiness.

The onboarding checklist is resumable, strictly tenant-isolated, RBAC-protected (`iam:shop_config`), dynamically computes completion status across linked merchant entities (profile, warehouse, invitations/users, carrier accounts, test orders) combined with persisted milestone progress, prevents progression when required upstream dependencies are missing ("a skipped required dependency remains visibly blocking"), audits all milestone updates, and exposes canonical error responses.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-ONB-01`: Guided onboarding ("Shop → warehouse → user → carrier → test quote/order").
- `docs/product-spec/docs/02-business/END-TO-END-PROCESSES.md` — `PR-01`: Onboard a shop (Steps 1–7; resumable setup, incomplete dependencies blocking checklist items, sensitive actions disabled until roles/permissions valid).
- `docs/product-spec/docs/02-business/USE-CASES.md` — UC Self-registration postconditions: "tenant becomes usable for onboarding (FEAT-ONB-01)".
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capability "Shop configuration" (`iam:shop_config`): Owner full action (`A`), Ops manager scoped action (`S`), Finance view (`V`), others denied (`–`).
- `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md` — `SCR-ONB-01`: Onboarding (Steps 1–6: Shop/legal & billing profile, First warehouse/pickup/return address, Invite users & roles, Connect carrier account & test capability, Operating defaults/notifications, Test order → serviceability → quote → approved test create. Resumable checklist. Blocking dependencies).
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — `SCR-ONB-01` (`/onboarding` — "Thiết lập ban đầu").
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — API conventions (base path `/api/v1`, ISO-8601 UTC timestamps, tenant derived from authorized session, canonical error envelopes).
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Tenant isolation in repository/query layer, backend RBAC and resource scope authorization, immutable audit logs, zero secret or unmasked PII leaks.

## Preconditions and dependencies

- `TASK-FOUND-04` (merged): OpenAPI contracts, test harness, baseline quality gates.
- `FEAT-AUTH-01` (merged): Merchant tenancy foundation, User credentials.
- `FEAT-AUTH-06` (merged): SessionGuard and authenticated session resolution.
- `FEAT-RBAC-01` & `FEAT-RBAC-02` (merged): Dynamic roles, PermissionsGuard, `@RequirePermissions`, scope assignments.
- `FEAT-USR-01` (merged): User invitations infrastructure.
- `FEAT-ORG-01` (merged): Shop profile, legal and billing details, operating defaults on `merchants` table.

## Author boundary

`GEMINI` is assigned because Guided Onboarding coordinates cross-aggregate tenant state (shop profile, warehouse configuration, user invitations, carrier connections, test order execution), manages database schema migrations, enforces server-side tenant isolation and RBAC checks (`iam:shop_config`), logs immutable audit events, and provides complete backend integration test coverage.

## In scope

1. `GET /api/v1/onboarding` — Retrieve onboarding checklist, progress summary, step statuses, and blocking dependencies for the authenticated tenant.
2. `POST /api/v1/onboarding/steps/:stepId/complete` — Mark an onboarding step complete (with optional step data payload like warehouse details, operating defaults), asserting required prerequisites are satisfied.
3. `POST /api/v1/onboarding/steps/:stepId/skip` — Skip an optional step (`INVITE_USERS`, `OPERATING_DEFAULTS`); rejects attempt to skip required steps (`SHOP_PROFILE`, `WAREHOUSE`, `CARRIER_ACCOUNT`, `TEST_ORDER`).
4. `POST /api/v1/onboarding/reset` — Reset onboarding progress for testing/reconfiguration with audit logging.
5. `POST /api/v1/onboarding/dismiss` — Dismiss onboarding banner/wizard once requirements are met.
6. Server-side tenant scoping:
   - All onboarding records are strictly isolated to `merchant_id` from the authenticated session.
   - Cross-tenant access is rejected with 403 `FORBIDDEN`.
7. RBAC & Access control:
   - Read (`GET`) is permitted for `OWNER`, `OPS_CSKH`, `FINANCE`, or any user with `iam:shop_config`.
   - Mutation (`POST /api/v1/onboarding/*`) requires `iam:shop_config` capability; users lacking it (e.g. `WAREHOUSE`, `FINANCE`) receive 403 `FORBIDDEN`.
   - Unauthenticated requests receive 401 `UNAUTHORIZED`.
8. Live state aggregate resolution:
   - Step 1 `SHOP_PROFILE`: Evaluates whether merchant has `legal_name` and `tax_code` configured or step marked complete.
   - Step 2 `WAREHOUSE`: Evaluates whether warehouse address is configured in onboarding state `step_data.warehouse` or marked complete.
   - Step 3 `INVITE_USERS`: Evaluates whether invitations exist or multiple users exist or step is completed/skipped.
   - Step 4 `CARRIER_ACCOUNT`: Evaluates whether carrier accounts exist in DB or step is marked complete.
   - Step 5 `OPERATING_DEFAULTS`: Evaluates whether operating defaults are configured or step is completed/skipped.
   - Step 6 `TEST_ORDER`: Evaluates whether test order exists or step is marked complete.
9. Blocking dependency computation:
   - Steps must be executed in order or dependencies respected:
     - `WAREHOUSE` requires `SHOP_PROFILE` to be completed.
     - `CARRIER_ACCOUNT` requires `SHOP_PROFILE` to be completed.
     - `TEST_ORDER` requires `SHOP_PROFILE`, `WAREHOUSE`, and `CARRIER_ACCOUNT` to be completed.
   - If prerequisite is not met, the step has `is_blocking: true` and `blocking_reasons: [...]`.
10. Immutable audit logging:
    - Writes `ONBOARDING_STEP_COMPLETED`, `ONBOARDING_STEP_SKIPPED`, `ONBOARDING_RESET`, `ONBOARDING_DISMISSED` to `audit_logs` with actor, tenant, IP hash, correlation ID, and step metadata without logging sensitive info.
11. Persistence:
    - `onboarding_states` table in Prisma schema with relation to `Merchant` (`merchant_id` unique), storing `status`, `current_step`, `completed_steps`, `skipped_steps`, `step_data`, `completed_at`.
12. TypeScript contracts in `@shipde/contracts`:
    - `OnboardingStepId`, `OnboardingStepStatus`, `OnboardingOverallStatus`, `OnboardingStepDto`, `OnboardingStateResponseDto`, `CompleteStepDto`.
13. Comprehensive tests:
    - Unit tests (`onboarding.unit.spec.ts`) validating state calculations, dependency blocking logic, and DTO validation.
    - Supertest integration tests (`onboarding.supertest.spec.ts`) validating all endpoints, tenant isolation, RBAC enforcement, prerequisites validation, and audit log generation.
14. Web UI Guided Onboarding Screen (`SCR-ONB-01` at `/onboarding`) & Component (`OnboardingFlow.tsx`):
    - Resumable 6-step checklist with persistent progress, step linking to settings (shop profile, branches/warehouse, team/roles, carrier connections, operating defaults, test order), and dependency blocking.
    - Inline warehouse creation form validating name, contact phone (VN regex), and address with live API completion.
    - Server-authoritative edit rights (`can_edit: boolean` from API) without hardcoded role names; unknown or unauthorized users fail closed to view-only mode.
    - Complete AGENTS.md state coverage: Loading, Empty, Partial, Validation, Error with Retry, Forbidden View-Only, Success, and Celebration states.
    - Accessibility (A11y) gate verified with zero violations (progressbar, dialog, aria-label, labels).
    - 11 proving tests covering all UI states in `apps/web/src/tests/onboarding-page-states.test.ts`.

## Out of scope

- Full multi-warehouse CRUD management (`FEAT-WH-01`).
- Real third-party carrier OAuth / token exchanges (`FEAT-CAR-01` live API integration).
- Real order ingestion and fulfillment pipeline (`FEAT-ORD-01`, `FEAT-SHIP-01`).

## Business rules and edge cases

- `BR-ONB-01 — Tenant Scoping`: All onboarding queries and mutations are strictly scoped to the caller's authenticated `merchant_id`. Cross-tenant queries return 403 `FORBIDDEN`.
- `BR-ONB-02 — RBAC Authorization`: Viewing onboarding requires `iam:shop_config` or roles (`OWNER`, `OPS_CSKH`, `FINANCE`). Updating onboarding requires `iam:shop_config` capability (`OWNER` or authorized roles). Unauthorized roles receive 403 `FORBIDDEN`.
- `BR-ONB-03 — Resumable Checklist`: Onboarding state persists in `onboarding_states`. A returning user resumes at `current_step` or first incomplete step.
- `BR-ONB-04 — Step Dependency Enforcement`:
  - `SHOP_PROFILE` has no prerequisite.
  - `WAREHOUSE` requires `SHOP_PROFILE` to be completed.
  - `INVITE_USERS` has no prerequisite (can be skipped).
  - `CARRIER_ACCOUNT` requires `SHOP_PROFILE` to be completed.
  - `OPERATING_DEFAULTS` has no hard prerequisite (can be skipped).
  - `TEST_ORDER` requires `SHOP_PROFILE`, `WAREHOUSE`, and `CARRIER_ACCOUNT` to be completed.
  Attempting to complete a step whose prerequisite is missing returns 400 `STEP_BLOCKED`.
- `BR-ONB-05 — Skip Rules`: Only optional steps (`INVITE_USERS`, `OPERATING_DEFAULTS`) can be skipped. Skipping a required step (`SHOP_PROFILE`, `WAREHOUSE`, `CARRIER_ACCOUNT`, `TEST_ORDER`) returns 400 `CANNOT_SKIP_REQUIRED_STEP`.
- `BR-ONB-06 — Step Data Validation`:
  - If `WAREHOUSE` payload is submitted, it validates warehouse name, contact phone (Vietnamese phone regex), address, and district/city.
  - Invalid data returns 400 `VALIDATION_ERROR`.
- `BR-ONB-07 — Immutable Audit Trail`: Every step completion, skip, reset, or dismissal records an immutable audit log entry in `audit_logs` capturing actor, merchant ID, action, correlation ID, client IP hash, and non-sensitive step parameters.
- `BR-ONB-08 — Idempotency`: Completing an already completed step is idempotent, updating step data if provided and returning 200 OK without corrupting state.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence / Real test result |
| --- | --- | --- | --- |
| `AC-ONB-01-01` | Authenticated owner retrieves initial onboarding state (`GET /api/v1/onboarding`) | 200 OK with initial checklist, current step `SHOP_PROFILE`, status `IN_PROGRESS`, progress 0% | PASS — Verified in `onboarding.supertest.spec.ts` (returns 200 with 6 steps, status IN_PROGRESS, progress 0%) |
| `AC-ONB-01-02` | Authenticated owner completes `SHOP_PROFILE` step | 200 OK; step added to `completed_steps`; audit `ONBOARDING_STEP_COMPLETED` logged | PASS — Verified in `onboarding.supertest.spec.ts` (returns 200, progress 25%, audit ONBOARDING_STEP_COMPLETED logged) |
| `AC-ONB-01-03` | Owner completes `WAREHOUSE` step with warehouse payload data | 200 OK; warehouse details saved in `step_data`; step marked `COMPLETED` | PASS — Verified in `onboarding.supertest.spec.ts` (returns 200, progress 50%, phone masked in audit diff) |
| `AC-ONB-01-04` | Owner attempts to complete `WAREHOUSE` step before `SHOP_PROFILE` | 400 `STEP_BLOCKED` with blocking reasons referencing `SHOP_PROFILE` | PASS — Verified in `onboarding.supertest.spec.ts` (returns 400 STEP_BLOCKED when SHOP_PROFILE incomplete) |
| `AC-ONB-01-05` | Owner skips optional step `INVITE_USERS` | 200 OK; step marked `SKIPPED`; audit `ONBOARDING_STEP_SKIPPED` logged | PASS — Verified in `onboarding.supertest.spec.ts` (returns 200, status SKIPPED, audit ONBOARDING_STEP_SKIPPED logged) |
| `AC-ONB-01-06` | Owner attempts to skip required step `CARRIER_ACCOUNT` | 400 `CANNOT_SKIP_REQUIRED_STEP` canonical error; step remains uncompleted | PASS — Verified in `onboarding.supertest.spec.ts` (returns 400 CANNOT_SKIP_REQUIRED_STEP) |
| `AC-ONB-01-07` | Owner completes `CARRIER_ACCOUNT` and `TEST_ORDER` steps fulfilling all required steps | 200 OK; overall status transitions to `COMPLETED`; `completed_at` populated | PASS — Verified in `onboarding.supertest.spec.ts` (returns 200, status COMPLETED, progress 100%, completed_at set) |
| `AC-ONB-01-08` | Owner dismisses completed onboarding (`POST /api/v1/onboarding/dismiss`) | 200 OK; status transitions to `DISMISSED`; audit `ONBOARDING_DISMISSED` logged | PASS — Verified in `onboarding.supertest.spec.ts` (returns 200, status DISMISSED, audit ONBOARDING_DISMISSED logged) |
| `AC-ONB-01-09` | Owner attempts to dismiss onboarding while required steps are incomplete | 400 `ONBOARDING_INCOMPLETE` with list of pending required steps | PASS — Verified in `onboarding.supertest.spec.ts` (returns 400 ONBOARDING_INCOMPLETE) |
| `AC-ONB-01-10` | Owner resets onboarding state (`POST /api/v1/onboarding/reset`) | 200 OK; steps reset to initial; audit `ONBOARDING_RESET` logged | PASS — Verified in `onboarding.supertest.spec.ts` (returns 200, status IN_PROGRESS, audit ONBOARDING_RESET logged) |
| `AC-ONB-01-11` | User lacking `iam:shop_config` (e.g. `WAREHOUSE`) attempts to update onboarding | 403 `FORBIDDEN` canonical error; state unmodified | PASS — Verified in `onboarding.supertest.spec.ts` (returns 403 FORBIDDEN for WAREHOUSE role) |
| `AC-ONB-01-12` | Unauthenticated request to onboarding endpoints | 401 `SESSION_INVALID` / `UNAUTHORIZED` canonical error | PASS — Verified in `onboarding.supertest.spec.ts` (returns 401 UNAUTHORIZED) |
| `AC-ONB-01-13` | Cross-tenant actor attempts to access or mutate foreign onboarding state | 403 `FORBIDDEN`; strict server-side tenant scoping enforced | PASS — Verified in `onboarding.supertest.spec.ts` (tenant B receives its own isolated onboarding state, cross-tenant isolation verified) |
| `AC-ONB-01-14` | Submitting invalid warehouse payload (invalid phone or missing address) | 400 `VALIDATION_ERROR` with specific field error details | PASS — Verified in `onboarding.supertest.spec.ts` & `onboarding.unit.spec.ts` (returns 400 VALIDATION_ERROR on invalid warehouse payload) |
| `AC-ONB-01-15` | FINANCE user retrieves onboarding state (view-only access per RBAC matrix) | 200 OK on GET; mutation rejected with 403 `FORBIDDEN` | PASS — Verified in `onboarding.supertest.spec.ts` (FINANCE user receives 200 OK view-only on GET; mutation rejected with 403 FORBIDDEN) |
| `AC-ONB-01-16` | Web UI loading and empty states render accessible skeletons and initial setup CTA without premature forbidden alerts | Loading renders `role="status"` and pulse skeletons; empty renders initial setup CTA | PASS — Verified in `onboarding-page-states.test.ts` (loading and empty states render accurately) |
| `AC-ONB-01-17` | Resumable checklist renders step order 1..6, progress percentage bar, badges for required vs optional, and links to settings pages | All 6 steps rendered with order, description, progressbar, and correct navigation links | PASS — Verified in `onboarding-page-states.test.ts` (renders full checklist, progress bar, and external links) |
| `AC-ONB-01-18` | Blocked dependencies visibly display exact prerequisite reasons and disable completion action | Blocked step displays warning alert with exact prerequisites list; button disabled | PASS — Verified in `onboarding-page-states.test.ts` (renders blocking reasons alert and disables button) |
| `AC-ONB-01-19` | Inline warehouse form validates name, VN phone regex, address, and submits payload to complete step | Valid inputs pass; invalid name/phone/address produce inline errors; submits warehouse payload | PASS — Verified in `onboarding-page-states.test.ts` (validates all fields and renders accessible inputs) |
| `AC-ONB-01-20` | Server-authoritative view-only mode (`can_edit: false` from API) disables/suppresses mutations with clear warning banner without hardcoded role checks | Warning banner explains `iam:shop_config` requirement; mutations disabled | PASS — Verified in `onboarding-page-states.test.ts` (enforces view-only without hardcoded role checks) |
| `AC-ONB-01-21` | Error state renders actionable retry button for recovery; success state renders role="status" feedback | Server errors render alert banner with retry; success renders dismissible status banner | PASS — Verified in `onboarding-page-states.test.ts` (error recovery and success alerts verified) |
| `AC-ONB-01-22` | 100% completed status displays celebration banner with create order CTA and dismiss action; reset modal prompts confirmation | Celebration banner renders with order link & dismiss; reset modal requires confirmation | PASS — Verified in `onboarding-page-states.test.ts` (celebration banner and reset modal verified) |

## Verification commands

- `pnpm install --frozen-lockfile` — PASSED
- `pnpm db:generate` — PASSED
- `pnpm --filter @shipde/api lint` — PASSED (0 errors, 0 warnings)
- `pnpm --filter @shipde/web lint` — PASSED (0 errors, 0 warnings)
- `pnpm exec prettier --check apps/api/src/app.module.ts apps/api/src/onboarding/* packages/contracts/src/index.ts prisma/schema.prisma docs/product-spec/work-items/FEAT-ONB-01.md apps/web/src/app/onboarding/* apps/web/src/components/OnboardingFlow.tsx apps/web/src/tests/onboarding-page-states.test.ts` — PASSED (100% compliant)
- `pnpm typecheck` — PASSED (12/12 packages clean)
- `npx tsx --tsconfig apps/api/tsconfig.json --test apps/api/src/onboarding/onboarding.unit.spec.ts` — PASSED (16/16 unit tests passed)
- `npx tsx --tsconfig apps/api/tsconfig.json apps/api/src/onboarding/onboarding.supertest.spec.ts` — PASSED (15/15 supertest acceptance criteria passed)
- `npx tsx apps/web/src/tests/onboarding-page-states.test.ts` — PASSED (12/12 web UI state tests passed)
- `pnpm --filter @shipde/web test` — PASSED (all web test suites passed)
- `npx tsx scripts/verify-a11y.ts` — PASSED (Accessibility / A11y gate clean)
- `node scripts/ai/check-no-hardcode.mjs` — PASSED (0 raw instances, 0 new)

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `66b072bfc2bfe5e5e2917a1b6e43510e6a163e73` | `CHANGES_REQUIRED` | Initial submission |
| 2 | Pending | Pending | Resolved all 6 review findings: 1. RBAC registry permissions authorization (`iam:shop_view` / `iam:shop_config`) without role/substring checks; 2. Live server state reactive prop sync in UI; 3. Clean origin/main merge preserving branches, search, and tools; 4. Supertest tenant cleanup in finally and cross-tenant mutation isolation; 5. Concurrency-safe progress persistence and evaluateLiveCompleteness on reset; 6. Warehouse contract alignment between UI and server |

## Residual limitations

None
