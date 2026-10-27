# FEAT-AUTH-02 — Admin-created shop account

## Control

| Field           | Value                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Work Item ID    | FEAT-AUTH-02                                                                                         |
| Feature ID      | FEAT-AUTH-02                                                                                         |
| Status          | BLOCKED                                                                                              |
| Delivery order  | 6                                                                                                    |
| Dependencies    | TASK-FOUND-04                                                                                        |
| Assigned author | GEMINI                                                                                               |
| Risk            | HIGH                                                                                                 |
| Allowed paths   | `docs/product-spec/work-items/FEAT-AUTH-02.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/contracts/openapi.yaml`; `packages/contracts/**`; `prisma/schema.prisma`; `prisma/migrations/**`; `apps/api/package.json`; `apps/api/src/auth/**`; `apps/web/package.json`; `apps/web/eslint.config.mjs`; `apps/web/src/app/admin/**`; `apps/web/src/app/api/admin/**`; `apps/web/src/tests/**`; `eslint.config.mjs`; `package.json`; `pnpm-lock.yaml` |
| Branch          | feat/feat-auth-02-admin-shop                                                                         |
| Pull Request    | Pending                                                                                              |

## Business Outcome

Platform operator provisions initial shop owner accounts without exposing public self-registration.

## Acceptance criteria

| AC/Test ID | Scenario | Expected result |
| --- | --- | --- |
| `AC-ADMIN-01` | Missing admin key | Returns 403 Forbidden |
| `AC-ADMIN-02` | Invalid admin key | Returns 403 Forbidden |
| `AC-ADMIN-03` | Valid admin key with email-only | Creates verified active user and shop |
| `AC-ADMIN-04` | Database records verification | Records include active status and verified timestamps |
| `AC-ADMIN-05` | Generated merchant code | Unique and follows standard format |
| `AC-ADMIN-06` | Phone-only registration | Supported with verified status |
| `AC-ADMIN-07` | Custom password provided | Bypasses temporary password generation |
| `AC-ADMIN-08` | Duplicate email provided | Returns 400 VALIDATION_ERROR |
| `AC-ADMIN-09` | Missing both email and phone | Returns 400 VALIDATION_ERROR |
| `AC-ADMIN-10` | Invalid email format | Returns 400 VALIDATION_ERROR |
| `AC-ADMIN-11` | Invalid phone format | Returns 400 VALIDATION_ERROR |
| `AC-ADMIN-12` | Password shorter than 8 characters | Returns 400 VALIDATION_ERROR |
| `AC-ADMIN-13` | merchant_name longer than 255 characters | Returns 400 VALIDATION_ERROR |
| `AC-ADMIN-14` | Admin shop list and create routes | Expose loading, empty, validation, error, forbidden and success states |
| `AC-ADMIN-15` | Signed-out users access admin routes | Reach the forbidden state before any loading skeleton or in-flight state |

## Verification commands

- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm contract:check`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`

## Security Notes

- Admin key checked server-side, never exposed to client
- Tenant isolation enforced via merchant_id scoping
- Passwords hashed with argon2id
- No PII in logs or error responses

## Open questions

### Operator Identity and Session Specification Missing (Finding 3)

The approved specifications (`docs/product-spec/docs/01-product/ACTORS-PERSONAS.md`, `docs/product-spec/docs/02-business/RBAC-APPROVAL-MATRIX.md`, `docs/product-spec/contracts/openapi.yaml`, and `prisma/schema.prisma`) do not define:
1. How a platform operator (`SHIPDE_OPERATOR` / backoffice administrator) session is established (no operator login endpoint, credential model, or authentication challenge exists in the approved specifications).
2. The platform operator role in `prisma/schema.prisma` `RoleEnum` or `AccessTokenClaims` (current roles in schema and token utility are strictly tenant-scoped: `OWNER`, `OPS_CSKH`, `WAREHOUSE`, `ACCOUNTANT`).
3. How `SessionGuard` and `DeviceSession` (which requires `user_id` and `merchant_id`) validate tenantless platform operator sessions.
4. The OpenAPI contract (`/admin/shops`) explicitly specifies `adminApiKeyAuth: []` (`x-admin-key: <ADMIN_API_KEY>`) rather than session bearer tokens.

In accordance with the operating contract rules, implementation has stopped on Finding 3 pending specification of the platform-operator session lifecycle. The Work Item is marked `BLOCKED`.

