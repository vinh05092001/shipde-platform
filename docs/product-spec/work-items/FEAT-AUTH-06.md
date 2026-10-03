# FEAT-AUTH-06 — Session management

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `FEAT-AUTH-06` |
| Feature ID      | `FEAT-AUTH-06` |
| Status          | `READY_FOR_CODEX` |
| Delivery order  | 10 |
| Dependencies    | `TASK-FOUND-04` (merged) |
| Assigned author | `GEMINI` |
| Risk            | `MEDIUM` |
| Allowed paths   | `prisma/schema.prisma`, `prisma/migrations/*`, `apps/api/src/session/*`, `apps/api/src/app.module.ts`, `packages/testkit/src/msw/handlers.ts`, `packages/contracts/src/index.ts`, `docs/product-spec/contracts/openapi.yaml`, `docs/product-spec/work-items/FEAT-AUTH-06.md`, `apps/web/src/app/sessions/*`, `apps/web/src/components/sessions/*` |
| Reviewer        | Codex — fresh independent task |
| Branch          | `feat/feat-auth-06-sessions-c-230216` |
| Pull Request    | [#126](https://github.com/vinh05092001/shipde-platform/pull/126) |

## Business outcome

An authenticated merchant user can list all active sessions, revoke any session, revoke all sessions at once, and sessions expire after inactivity.

## Source references

- `MASTER-FEATURE-CATALOG.md` — `FEAT-AUTH-06`
- `PROTOTYPE-GAPS-AND-RISKS.md` — Session & Token Management
- `prisma/schema.prisma` L177-191 (existing DeviceSession)
- `apps/api/src/auth/` (FEAT-AUTH-01 patterns)

## In scope

1. `POST /api/v1/sessions` — Create session (at login)
2. `GET /api/v1/sessions` — List sessions
3. `DELETE /api/v1/sessions/:sessionId` — Revoke session
4. `POST /api/v1/sessions/revoke-all` — Revoke all sessions
5. `PATCH /api/v1/sessions/:sessionId/heartbeat` — Update last activity
6. Inactivity expiry (30 days), absolute lifetime (90 days)
7. Prisma migration, canonical errors, tenant scope, audit logging
8. MSW handlers, unit + integration tests

## Out of scope

- Login flow (FEAT-AUTH-03), MFA, frontend UI, Redis caching, JWT

## Business rules

BR-SESS-01..11: tenant isolation, SHA-256 token hashing, 90d absolute/30d inactivity expiry, idempotent revocation, audit logging, cross-tenant 403, raw tokens never returned, heartbeat scoped to current session.

## Verification commands

```
pnpm install --frozen-lockfile / pnpm db:generate / pnpm lint / pnpm typecheck / pnpm test / pnpm build
```

## Residual limitations

- FEAT-AUTH-03 not merged (tests create sessions directly). Risk: low.
- No JWT/Redis/frontend. Risk: low.
