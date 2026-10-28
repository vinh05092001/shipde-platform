# FEAT-PRO-01 — Personal profile

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-PRO-01` |
| Feature ID      | `FEAT-PRO-01` |
| Status          | `IN_PROGRESS` |
| Delivery order  | 19 |
| Dependencies    | `TASK-FOUND-04` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `MEDIUM` |
| Risk domains    | `auth`, `tenant isolation`, `user profile`, `notifications` |
| Allowed paths   | `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/users/*`, `apps/api/src/me/*`, `apps/api/src/app.module.ts`, `packages/contracts/src/*`, `docs/product-spec/contracts/openapi.yaml`, `docs/product-spec/work-items/FEAT-PRO-01.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `apps/web/src/app/settings/profile/*`, `apps/web/src/components/ProfileSettingsTab.tsx`, `apps/web/src/components/SettingsWorkspace.tsx`, `apps/web/src/context/AuthContext.tsx`, `apps/api/package.json`, `apps/web/package.json`, `apps/api/src/users/me.supertest.spec.ts`, `apps/api/src/users/me.unit.spec.ts`, `apps/web/src/tests/profile-page-states.test.ts` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-pro-01-personal-profile` |
| Pull Request    | Pending |

## Business outcome

Any authenticated merchant user (regardless of their role: `OWNER`, `OPS_CSKH`, `WAREHOUSE`, `ACCOUNTANT`, `FINANCE`, etc.) can view and update their personal profile (full name, phone number, avatar URL), configure their localization preferences (language, timezone), manage their operational defaults (such as default warehouse selection within their authorized scopes), and configure their notification delivery channels and digest intervals. The system guarantees that users cannot escalate privileges or manipulate tenant/role scopes via profile updates, ensures critical security/deadline alerts cannot be disabled per business rules, and writes immutable audit logs for all profile modifications.

## Source references

- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — `FEAT-PRO-01`: Personal profile ("Contact, language/timezone, defaults and notification preferences").
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — `DEC-016`: TypeScript monorepo standard; Change Control requirements for data, PII, and tenant isolation.
- `docs/product-spec/docs/02-business/NOTIFICATIONS-REPORTS.md` — Section "Notification matrix" & rules: "Users may configure noncritical channels and digests. Security, unknown create outcome and claim-deadline critical alerts cannot be fully disabled."
- `docs/product-spec/docs/02-business/USE-CASES.md` — `UC-AUTH-01`: Log in; User identity aggregate and authenticated user context.
- `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md` — Capabilities and enforcement rules: "Backend is authoritative; hidden UI controls are insufficient", "Permission evaluation includes tenant, branch, warehouse and carrier-account scope".
- `docs/product-spec/docs/04-data/DOMAIN-MODEL-ERD.md` — Section "Identity and tenancy": User, Membership, UserSession.
- `docs/product-spec/docs/04-data/DATA-DICTIONARY.md` — Section "Tenant and user": `User.id`, `User.email/phone`, `User.status`.
- `docs/product-spec/docs/05-api-integrations/INTERNAL-API.md` — Resource groups: `/me`: "Profile, sessions, memberships, preferences"; Base path `/api/v1`, JSON UTF-8, ISO-8601 UTC timestamps, Bearer session token, canonical error envelope.
- `docs/product-spec/docs/03-ux/INFORMATION-ARCHITECTURE.md` — Routes under `/settings` including personal profile, settings workspace, and global UI state conventions.
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` — Standard UI state contract (loading, empty, validation, error, forbidden, success, recovery).
- `docs/product-spec/docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md` — Strict server-side tenant scoping, PII protection, Vietnamese phone regex, and immutable audit logs capturing actor, target entity, old/new values, IP pseudonymization, and correlation IDs.
- `docs/product-spec/contracts/openapi.yaml` — Operation `getMe` under `/me` and schema definitions.
- `docs/product-spec/evidence/CURRENT-IMPLEMENTATION-INVENTORY.md` — `FEAT-PRO-01`: In-memory prototype profile in `SettingsWorkspace.tsx` to be replaced with real backend persistence, notification preferences, contact details, language/timezone, and defaults.

## Preconditions and dependencies

- `TASK-FOUND-04` is merged, providing OpenAPI contract generation, test infrastructure, and baseline quality gates.
- `FEAT-AUTH-01` is merged, providing `User` model, password hashing primitives, and authentication session foundations.
- `FEAT-AUTH-06` is merged, providing `SessionGuard` and database-backed `DeviceSession` token validation.
- `FEAT-RBAC-01` is merged, providing system roles, custom roles, and granular RBAC evaluation guards.

## Author boundary

`GEMINI` is assigned as the primary implementation author because personal profile spans database migrations, user entity schema extensions, server-side tenant scoping and privilege escalation protections, notification preference validation against business rules, OpenAPI contract alignment, and multi-state responsive UI implementation.

- **Next.js Document & State Security Boundary:** Profile and preferences forms run on the client within authenticated contexts, fetching real profile data via `/api/v1/me` and `/api/v1/me/preferences`, ensuring no hardcoded mock data is displayed.
- **Session & Guard Boundary:** Endpoints reuse `SessionGuard` to authenticate callers and extract `userId` and `merchantId` authoritatively from server-side session tokens.
- **Audit Logging Boundary:** Profile and preference updates write directly to `audit_logs` with action `PROFILE_UPDATED` or `PREFERENCES_UPDATED`.

## In scope

1. Database Schema Extension: Extend `User` model with `avatar_url`, `language`, `timezone`, `notification_preferences`, and `default_warehouse_id` fields, backed by a clean SQL migration (`20261028020000_feat_pro_01_personal_profile`).
2. `GET /api/v1/me` (and `/me`) — Retrieve authenticated user profile: `id`, `merchant_id`, `email`, `phone`, `full_name`, `role`, `status`, `avatar_url`, `store_scopes`, `warehouse_scopes`, `language`, `timezone`, `default_warehouse_id`, `notification_preferences`, `merchant` summary, and `created_at`.
3. `PATCH /api/v1/me` (and `/me`) — Update contact details (`full_name`, `phone`, `avatar_url`) and preferences (`language`, `timezone`, `default_warehouse_id`, `notification_preferences`). Rejects any attempt to modify `role`, `custom_role_id`, `merchant_id`, or scopes with 403 `FORBIDDEN` or ignores read-only fields.
4. `GET /api/v1/me/preferences` (and `/me/preferences`) — Retrieve specific user preferences: language, timezone, default warehouse, and notification matrix settings.
5. `PATCH /api/v1/me/preferences` (and `/me/preferences`) — Update user preferences with validation. Enforces that critical notifications (security alerts, unknown create outcomes, claim deadlines) cannot be disabled.
6. Validation: Validate Vietnamese phone regex (`^(0|\+84)[3|5|7|8|9][0-9]{8}$`), phone uniqueness across other active users, IANA timezone strings, and supported languages (`vi`, `en`).
7. Scope Checking: Ensure `default_warehouse_id` belongs to the user's authorized `warehouse_scopes` (or user possesses wildcard `*` scope).
8. Immutable Audit Trail: Record `PROFILE_UPDATED` and `PREFERENCES_UPDATED` audit events in `audit_logs` with before/after snapshots and correlation ID.
9. Contract & OpenAPI: Update `docs/product-spec/contracts/openapi.yaml` and `packages/contracts/src/` with schemas and endpoints for `/me` and `/me/preferences`.
10. Web UI: Responsive Personal Profile page at `/settings/profile` and tab within `SettingsWorkspace.tsx`, implementing the full UI state contract: Loading, Empty/Defaults, Validation, Error, Forbidden, Success, Recovery.
11. Test Coverage: Unit tests (`apps/api/src/users/me.unit.spec.ts`), supertest integration tests (`apps/api/src/users/me.supertest.spec.ts`), and web UI state tests (`apps/web/src/tests/profile-page-states.test.ts`).

## Out of scope

- Organization/Shop legal profile (`FEAT-ORG-01`).
- Multi-factor authentication enrollment or reset (`FEAT-AUTH-05`).
- Active session listing and revocation (`FEAT-AUTH-06`).
- Password reset and recovery flows (`FEAT-AUTH-04`).
- Bulk user administration and inviting other users (`FEAT-USR-01`).

## Business rules and edge cases

- `BR-PRO-01 — Strict Self-Scoping & Tenant Isolation`: The actor can only inspect and update their own profile. Target `userId` and `merchantId` are strictly derived from the validated bearer session (`SessionGuard`). Cross-tenant or cross-user modifications via client parameter injection are impossible.
- `BR-PRO-02 — Privilege Escalation Prevention`: Any attempt to submit or mutate `role`, `custom_role_id`, `store_scopes`, `warehouse_scopes`, `status`, or `merchant_id` via `/me` is rejected with 403 `PRIVILEGE_ESCALATION_DENIED` or strictly filtered out by DTO validation.
- `BR-PRO-03 — Critical Notification Inviolability`: Per `NOTIFICATIONS-REPORTS.md`, users may configure non-critical notification channels (such as delivery exceptions, overdue returns, rate discrepancies, and digest intervals), but critical security events (`security_alerts`), unknown shipment create outcomes (`create_unknown`), and claim deadline warnings (`claim_deadlines`) cannot be fully disabled. If a payload attempts to set these critical channels to `false`, the system overrides them to `true` or rejects the update with 400 `CANNOT_DISABLE_CRITICAL_NOTIFICATIONS`.
- `BR-PRO-04 — Contact Validation & Phone Uniqueness`: Phone numbers must match Vietnamese regex `^(0|\+84)[3|5|7|8|9][0-9]{8}$`. If the updated phone number is already registered to another user, the request fails with 409 `PHONE_ALREADY_EXISTS`.
- `BR-PRO-05 — Timezone and Language Conformance`: `language` must be one of `vi` or `en`. `timezone` must be a valid IANA timezone identifier (e.g., `Asia/Ho_Chi_Minh`, `UTC`). Invalid values return 400 `INVALID_INPUT`.
- `BR-PRO-06 — Warehouse Scope Conformance`: If `default_warehouse_id` is specified, it must be either present in the user's `warehouse_scopes` array or the user must hold wildcard scope `*`. Unauthorized warehouse selection returns 403 `WAREHOUSE_SCOPE_UNAUTHORIZED`.
- `BR-PRO-07 — Immutable Audit Trail`: All profile and preference mutations create an entry in `audit_logs` with `user_id`, `merchant_id`, `action: 'PROFILE_UPDATED'` or `action: 'PREFERENCES_UPDATED'`, `entity_type: 'User'`, `old_value`, `new_value`, and IP address.

## UI states

The Personal Profile view at `/settings/profile` and integrated within `SettingsWorkspace.tsx` implements:

- **Loading:** Skeleton placeholders displayed during initial profile and preferences fetch; submit buttons display inline spinners while saving.
- **Empty / Defaults:** Form initializes with system defaults (`language: "vi"`, `timezone: "Asia/Ho_Chi_Minh"`, critical alerts enabled) when fields have no prior saved values.
- **Validation:** Real-time inline field validation errors for invalid phone format, empty full name, or disallowed warehouse selection.
- **Error:** Persistent error alert banner showing canonical error messages when API calls fail, retaining user form input for retry.
- **Forbidden:** If session expires or user token is invalid, redirects to `/login` or displays unauthenticated state.
- **Success:** Dismissible success toast confirming: "Đã cập nhật thông tin cá nhân thành công" upon saving.
- **Recovery:** Network drop allows retry without loss of entered form data; idempotent PATCH prevents corrupted states.

## API, event and data impact

- `GET /api/v1/me` (and `/me`): Returns `MeResponse` containing user profile, merchant metadata, and current preferences.
- `PATCH /api/v1/me` (and `/me`): Accepts `UpdateMeDto`, returns updated profile.
- `GET /api/v1/me/preferences` (and `/me/preferences`): Returns `UserPreferencesResponse`.
- `PATCH /api/v1/me/preferences` (and `/me/preferences`): Accepts `UpdatePreferencesDto`, returns updated preferences.
- Canonical Errors:
  - 400 `INVALID_INPUT`: Malformed payload, invalid phone, or invalid timezone.
  - 400 `CANNOT_DISABLE_CRITICAL_NOTIFICATIONS`: Attempt to disable mandatory security/claim alerts.
  - 401 `UNAUTHENTICATED` / `SESSION_INVALID`: Missing or expired session token.
  - 403 `PRIVILEGE_ESCALATION_DENIED`: Attempt to alter role or scopes.
  - 403 `WAREHOUSE_SCOPE_UNAUTHORIZED`: Default warehouse outside authorized warehouse scopes.
  - 409 `PHONE_ALREADY_EXISTS`: Phone number already in use by another user.
- Migration: Adds `avatar_url`, `language`, `timezone`, `notification_preferences`, and `default_warehouse_id` columns to `users` table.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| `AC-PRO-01-01` | Authenticated user requests `/api/v1/me` | 200 OK with full user profile, contact details, scopes, merchant info, and default preferences | Supertest integration test |
| `AC-PRO-01-02` | Authenticated user updates full name, valid phone number, and avatar URL | 200 OK with updated profile; `audit_logs` records `PROFILE_UPDATED` with old/new values | Supertest integration test + DB assertion |
| `AC-PRO-01-03` | User attempts to update phone number to one already taken by another user | 409 Conflict canonical error `PHONE_ALREADY_EXISTS` | Supertest integration test |
| `AC-PRO-01-04` | User attempts to update phone number with invalid format | 400 Bad Request canonical error `INVALID_INPUT` | Supertest integration test |
| `AC-PRO-01-05` | User attempts to escalate privilege by passing `role` or `store_scopes` in `/me` payload | 403 Forbidden `PRIVILEGE_ESCALATION_DENIED` (or rejected with validation error); role remains unchanged | Supertest integration test |
| `AC-PRO-01-06` | User updates preferences: language (`en`), timezone (`Asia/Bangkok`), and non-critical notification toggles | 200 OK with updated preferences; `audit_logs` records `PREFERENCES_UPDATED` | Supertest integration test + DB assertion |
| `AC-PRO-01-07` | User attempts to disable critical alerts (`security_alerts: false` or `create_unknown: false`) | Critical alerts remain enforced (`true`) or returns 400 `CANNOT_DISABLE_CRITICAL_NOTIFICATIONS` | Supertest integration test |
| `AC-PRO-01-08` | User sets `default_warehouse_id` to a warehouse not in their `warehouse_scopes` | 403 Forbidden `WAREHOUSE_SCOPE_UNAUTHORIZED` | Supertest integration test |
| `AC-PRO-01-09` | Unauthenticated request without bearer token | 401 Unauthorized `UNAUTHENTICATED` canonical error | Supertest integration test |
| `AC-PRO-01-10` | Web UI Profile settings page verifies all UI states (loading skeleton, default values, form validation, error banner, and success toast) | Frontend test suite verifies loading, validation, success toast, and error state transitions | Web Vitest test suite |

## Verification commands

- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test` (includes `apps/api/src/users/me.unit.spec.ts` and `apps/api/src/users/me.supertest.spec.ts`)
- `pnpm test:web` (includes `apps/web/src/tests/profile-page-states.test.ts`)
- `pnpm contract:check`
- `pnpm build`
- `git diff --check`
- `node scripts/ai/check-no-hardcode.mjs`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
| --- | --- | --- | --- |
| 1 | Pending | Pending | Initial submission |

## Residual limitations

None.
