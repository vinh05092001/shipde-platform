# FEAT-AUTH-02 — Admin-created shop account

## Control

| Field           | Value                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Work Item ID    | FEAT-AUTH-02                                                                                         |
| Feature ID      | FEAT-AUTH-02                                                                                         |
| Status          | IN_PROGRESS                                                                                          |
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
| `AC-ADMIN-01` | Missing or invalid session | Returns 401 SESSION_INVALID |
| `AC-ADMIN-02` | Missing PLATFORM_ADMIN role | Returns 403 FORBIDDEN |
| `AC-ADMIN-03` | Valid PLATFORM_ADMIN session with email-only | Creates verified active user and shop (audit actor = operator user id) |
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

- Platform operator authenticated via normal server session, authorized by platform-scoped PLATFORM_ADMIN role
- Static ADMIN_API_KEY auth path removed entirely
- Audit actor records operator user id from server session
- CSRF/origin protection enforced on admin mutations
- Tenant isolation enforced via merchant_id scoping
- Passwords hashed with argon2id
- No PII in logs or error responses

## Open questions

### Decision HUMAN-DECISION-AUTH02-PLATFORM-ADMIN-2026-10-28: option (a) PLATFORM_ADMIN role via normal session

Platform operators are real users authenticated through the normal login/session flow and authorized by a platform-scoped role PLATFORM_ADMIN in RBAC. NOT a static ADMIN_API_KEY.

