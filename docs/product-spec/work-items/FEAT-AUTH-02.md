# FEAT-AUTH-02 — Admin-created shop account

## Control

| Field | Value |
|---|---|
| Work Item ID | `FEAT-AUTH-02` |
| Feature ID | `FEAT-AUTH-02` |
| Status | `IN_PROGRESS` |
| Delivery order | 6 |
| Dependencies | `FEAT-AUTH-01` |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `apps/api/src/auth/**`, `apps/web/src/components/auth/AdminCreateShopView.tsx`, `apps/web/src/app/admin/shops/create/**`, `apps/web/src/context/AuthContext.tsx`, `packages/contracts/src/index.ts`, `docs/product-spec/**` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/feat-auth-02-admin-shop-account` |
| Pull Request | `<filled after push>` |

## Business outcome

A platform operator can create a new shop (tenant) and its initial OWNER user account without requiring public self-registration. The created account starts ACTIVE because the operator verified identity out-of-band.

## Source references

- `MASTER-FEATURE-CATALOG.md:10` — FEAT-AUTH-02
- `BASELINE-AND-DECISIONS.md` — DEC-013, DEC-016
- `USE-CASES.md` — UC-AUTH-03 (proposed)
- `BUSINESS-RULES-DECISION-TABLES.md` — BR-AUTH-11..15 (proposed)
- `STATE-MACHINES.md` — ST-USER admin-create transition (proposed)
- `SCREEN-SPECIFICATIONS.md` — SCR-AUTH-03 (proposed)
- `FEAT-AUTH-01.md` — sibling patterns

## Preconditions and dependencies

- FEAT-AUTH-01 merged (commit 4f32b93). AuthService, CanonicalApiException, hashPassword available.
- No new migration needed; reuses merchants, users, audit_logs tables.

## Author boundary

GEMINI: high-risk feature touching auth, authorization, tenant creation, cross-layer.

## In scope

- POST /auth/admin/create-shop-account endpoint (operator-only)
- createShopAccount service method in AuthService
- Operator token validation via x-operator-token header
- Web UI at /admin/shops/create with full state coverage
- AuthContext adminCreateShopAccount method
- Contract types, OpenAPI update, tests, spec updates, audit logging

## Out of scope

- FEAT-AUTH-01 (self-registration), FEAT-AUTH-03 (login), FEAT-AUTH-04 (password recovery)
- Full operator RBAC (uses shared secret for bootstrap)
- Email/SMS notification to created owner

## Business rules and edge cases

- BR-AUTH-11: Only operators may call; 401/403 otherwise
- BR-AUTH-12: Account starts ACTIVE (no verification needed)
- BR-AUTH-13: Requires merchant_name, full_name, email or phone, password >=8 chars
- BR-AUTH-14: Duplicate identifier check per BR-AUTH-03
- BR-AUTH-15: Immutable audit record per creation

## UI states

Route: /admin/shops/create (SCR-AUTH-03)
Loading, empty, validation, duplicate error, forbidden, error, success, recovery states all covered.

## API, event and data impact

POST /auth/admin/create-shop-account
Headers: x-operator-token
Body: merchant_name, full_name, email?, phone?, password
Response 201: merchant_id, merchant_code, user_id, status, created_at
Errors: UNAUTHORIZED(401), FORBIDDEN(403), VALIDATION_ERROR(400)
No new migration. New contract types in @shipde/contracts.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AUTH-02-01 | Valid creation with email | 201 ACTIVE | Supertest |
| AC-AUTH-02-02 | Valid creation with phone | 201 ACTIVE | Supertest |
| AC-AUTH-02-03 | Missing merchant_name | 400 VALIDATION_ERROR | Supertest |
| AC-AUTH-02-04 | Password <8 chars | 400 VALIDATION_ERROR | Supertest |
| AC-AUTH-02-05 | Duplicate email | 400 DUPLICATE | Supertest |
| AC-AUTH-02-06 | No operator token | 401 UNAUTHORIZED | Supertest |
| AC-AUTH-02-07 | Invalid operator token | 403 FORBIDDEN | Supertest |
| AC-AUTH-02-08 | Audit log created | Row exists | DB assertion |
| AC-AUTH-02-09 | UI state coverage | All states render | Component test |

## Verification commands

pnpm install --frozen-lockfile
pnpm db:generate
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| — | — | — | Not yet reviewed |

## Residual limitations

- Operator auth uses shared secret (OPERATOR_SECRET env var), not full RBAC. Owner: human. Risk: medium.
- No email/SMS to created owner. Owner: product. Risk: low.