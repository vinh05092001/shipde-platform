# FEAT-AUTH-02 — Admin-created shop account

## Control

| Field           | Value                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Work Item ID    | FEAT-AUTH-02                                                                                         |
| Feature ID      | FEAT-AUTH-02                                                                                         |
| Status          | READY_FOR_CODEX                                                                                      |
| Delivery order  | 6                                                                                                    |
| Dependencies    | TASK-FOUND-04 (merged), FEAT-AUTH-01 (merged)                                                        |
| Assigned author | GEMINI                                                                                               |
| Risk            | HIGH                                                                                                 |
| Branch          | feat/feat-auth-02-admin-shop-a-221211                                                                |
| Pull Request    | #123                                                                                                 |

## Codex Review

### Review Round 2 (CI remediation)

- **Reviewed commit:** `0d0180504e40fbacd8f74c73aeec807e241bd032` (Round 1 re-review) / CI failure diagnosis at `248ba8f`
- **Verdict:** CHANGES_REQUIRED → remediated in this push
- **Date:** 2026-09-23

#### Findings

1. Root-level scratch/debris files committed (`pr123-*.txt/tsv`, duplicate `schema.prisma`, `app.module.ts`, `openapi.ts`, `contracts-index.ts`, `migration.sql`) — broke `pnpm format:check` with 15 unformatted files including UTF-16 dumps.
2. Merge conflict with `origin/main` (FEAT-AUTH-03 touched the same `apps/api/package.json` test script) — PR state `dirty`, CI blocked.
3. `prisma/migrations/` missing the FEAT-AUTH-02 migration despite the work item requiring `created_by`/`activated_at`/`created_by_ip`; `prisma/schema.prisma` lacked the fields.
4. `useCallback`/`useEffect` declared after a conditional return in `admin/shops/page.tsx` — rules-of-hooks lint error.
5. Work item document not updated with review traceability.

#### Remediation

- ✅ Removed all 15 root-level debris files; canonical files remain in their proper locations
- ✅ Merged `origin/main`; resolved `apps/api/package.json` test script conflict keeping both auth-03 login spec and admin-auth spec
- ✅ Added `prisma/migrations/20260915000000_feat_auth_02_admin_shop/migration.sql` (forward-only, nullable columns, no backfill) and the three fields in `prisma/schema.prisma`
- ✅ Moved hooks above the early-return forbidden gate; unauthenticated users still see 403 immediately with no loading skeleton
- ✅ Local verification: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm contract:check`, `pnpm test`, `pnpm build`, and `validate_pr_contract.py` all pass

### Review Round 1

- **Reviewed commit:** `7ae6473db4a22d2d7382b656c1070734bba112ca`
- **Verdict:** CHANGES_REQUIRED
- **Date:** 2026-09-22

#### Findings

1. OpenAPI contract drift - Missing `/admin/shops` endpoint and schemas
2. PR body template placeholders - Remove boilerplate text
3. Test script cross-platform compatibility - Windows environment variable syntax
4. Missing merchant_name upper bound validation - BR-ADMIN-02 requires 2-255 check
5. Work item metadata outdated - Status and PR reference

#### Remediation

- ✅ Added `/admin/shops` POST endpoint to OpenAPI contract
- ✅ Added AdminCreateShopRequest and AdminCreateShopResponse schemas
- ✅ Generated TypeScript types with pnpm contract:generate
- ✅ Added merchant_name maxLength 255 validation in admin-auth.service.ts
- ✅ Fixed root package.json test:admin script for cross-platform
- ✅ Added admin-auth.supertest.spec.ts to apps/api/package.json test script
- ✅ Updated work item status to READY_FOR_CODEX
- ✅ Updated PR #123 body

## Business Outcome

Platform operator provisions initial shop owner accounts without exposing public self-registration.

## Acceptance Criteria

- [x] AC-ADMIN-01: Missing admin key returns 403
- [x] AC-ADMIN-02: Invalid admin key returns 403
- [x] AC-ADMIN-03: Valid admin key with email-only creates verified active user
- [x] AC-ADMIN-04: Database records include active status and verified timestamps
- [x] AC-ADMIN-05: Generated merchant code is unique and follows format
- [x] AC-ADMIN-06: Phone-only registration supported
- [x] AC-ADMIN-07: Custom password bypasses temporary password generation
- [x] AC-ADMIN-08: Duplicate email returns 400 VALIDATION_ERROR
- [x] AC-ADMIN-09: Missing both email and phone returns 400
- [x] AC-ADMIN-10: Invalid email format returns 400
- [x] AC-ADMIN-11: Invalid phone format returns 400
- [x] AC-ADMIN-12: Password shorter than 8 characters returns 400
- [x] AC-ADMIN-13: merchant_name longer than 255 characters returns 400
- [x] AC-ADMIN-14: Admin shop list and create routes are generated by Next.js and expose loading, empty, validation, error, forbidden and success states
- [x] AC-ADMIN-15: Signed-out users reach the forbidden state before any loading skeleton or in-flight state

## Implementation

Backend: admin-auth.service.ts, controller, guard, module, supertest spec
Frontend: admin/shops/page.tsx, admin/shops/create/page.tsx, API proxies
Contract: openapi.yaml /admin/shops endpoint, generated types

## Security Notes

- Admin key checked server-side, never exposed to client
- Tenant isolation enforced via merchant_id scoping
- Passwords hashed with argon2id
- No PII in logs or error responses
