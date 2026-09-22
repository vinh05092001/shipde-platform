# FEAT-USR-01 — User invitations

## Control

| Field | Value |
|---|---|
| Work Item ID | `FEAT-USR-01` |
| Feature ID | `FEAT-USR-01` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `11` |
| Dependencies | `TASK-FOUND-04` — `MERGED` by PR `#13` at `9d101f4e5d9de9b880cc4311126ce8fe06de4206` |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `apps/api/src/**`; `apps/api/test/**`; `apps/web/src/**`; `apps/web/tests/**`; `packages/contracts/**`; `packages/testkit/**`; `prisma/schema.prisma`; `prisma/migrations/**`; `docs/product-spec/contracts/openapi.yaml`; `docs/product-spec/docs/00-control/TRACEABILITY.md`; `docs/product-spec/docs/02-business/USE-CASES.md`; `docs/product-spec/docs/02-business/BUSINESS-RULES-DECISION-TABLES.md`; `docs/product-spec/docs/02-business/STATE-MACHINES.md`; `docs/product-spec/docs/03-ux/SCREEN-SPECIFICATIONS.md`; `docs/product-spec/docs/04-data/DATA-DICTIONARY.md`; `docs/product-spec/docs/04-data/schema.dbml`; `docs/product-spec/docs/08-testing/ACCEPTANCE-AND-E2E.md`; `docs/product-spec/work-items/FEAT-USR-01.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/feat-usr-01-user-invitations` |
| Pull Request | Planning PR created with title `[FEAT-USR-01] User invitation work item`; implementation author must replace this value with the implementation PR URL when opening the implementation PR. |

## Business outcome

A `SHOP_OWNER` or administrator who already has user-management authority can invite a person into the current tenant with no more role or resource scope than the inviter possesses. The recipient can securely accept one live invitation, establish or link their platform identity, and receive exactly the intended tenant membership. The inviter can see pending invitations, resend an expired or undelivered invitation, and cancel an invitation before acceptance. This lets a shop delegate warehouse and carrier-account work without sharing credentials or creating cross-tenant access.

## Source references

- `BASELINE-AND-DECISIONS.md` — `DEC-001`, `DEC-016`, and change control for PII, state transitions, and tenant isolation.
- `PRODUCT-VISION-SCOPE.md` — operational users, before-shipment identity/user/role scope, and the boundary “No cross-tenant access.”
- `MASTER-FEATURE-CATALOG.md` — `FEAT-USR-01`: send, resend, cancel, accept, and expire user invitations.
- `USE-CASES.md` — `UC-USR-01`: actor, permission precondition, identity → roles/scopes → send → verify/accept flow, least-authority rule, and invite/resend audit.
- `TRACEABILITY.md` — identity row `FEAT-USR` → `UC-USR-01`, `BR-RBAC-01`, `SCR-USR-01`, `API-USR`, `ENT-USER`/`ENT-ROLE`, `ST-INVITE`, `AC-USR-01`, `EPIC-FND`.
- `STATE-MACHINES.md` — `ST-INVITE`: `PENDING → ACCEPTED | EXPIRED | CANCELLED` and `EXPIRED → PENDING` on resend.
- `INFORMATION-ARCHITECTURE.md` — `SCR-USR-01` route `/settings/users`.
- `SCREEN-SPECIFICATIONS.md` — shared screen contract and onboarding step “Invite users and roles”; this Work Item adds the missing executable `SCR-USR-01` detail listed below.
- `INTERNAL-API.md` — `/api/v1`, bearer authorization, tenant derived from authorized membership, canonical errors, concurrency versioning, and `/users`/`/roles` resource family for invitations, users, roles, and scopes.
- `DATA-DICTIONARY.md`, identity section — `User.status` includes `INVITED`; `Membership.tenant_id` is server-derived; `Membership.scope_json` carries branch/warehouse/carrier-account scope.
- `DOMAIN-MODEL-ERD.md`, identity and tenancy aggregate — `User`, `Membership`, `Role`, `Permission`, and `Invitation`.
- `schema.dbml`, `users` and `memberships` — user identity, tenant membership, unique `(tenant_id, user_id)`, membership status, and `scope_json` baseline. The implementation adds the missing invitation table/relations without changing those semantics.
- `SECURITY-NFR-OBSERVABILITY.md` — backend RBAC, repository-layer tenant isolation, token/log protection, sensitive-data masking, immutable audit events, and tenant-isolation tests.
- `ERROR-IDEMPOTENCY-RETRY.md` — canonical `VALIDATION_ERROR`, `FORBIDDEN`, and `CONFLICT` semantics; same-operation retries must not create duplicate effects.
- `ACCEPTANCE-AND-E2E.md` — `AC-USR-01`: an owner invites an operator into one warehouse/account scope; after acceptance the operator cannot access another warehouse/account.
- `DEFINITION-OF-READY-DONE.md` — vertical UI/API/data/state/security/test evidence and clean-checkout verification gates.

## Preconditions and dependencies

- `TASK-FOUND-04` is recorded `MERGED` in the delivery register at `9d101f4e5d9de9b880cc4311126ce8fe06de4206`; its contracts, deterministic testkit, CI gates, and monorepo commands are available.
- Tests use deterministic authenticated fixtures for an owner, an authorized administrator, an unauthorized operator, two tenants, two warehouses, and two carrier accounts. `FEAT-AUTH-03` is not pulled into scope merely to obtain a browser session.
- The invitation delivery channel uses an injected deterministic email adapter in tests. Selecting or integrating a production email provider remains a separately approved deployment concern; the implementation must never report “sent” when the adapter failed.
- Default role identifiers and resource-scope shapes may be consumed from existing contracts or fixtures. This item may assign them to an invitation, but it must not build the custom-role editor (`FEAT-RBAC-01`) or general scope-management UI (`FEAT-RBAC-02`).
- No unresolved product choice blocks implementation: the approved feature verbs and `ST-INVITE` transitions determine lifecycle; `UC-USR-01` determines actor and least-authority behavior; this Work Item makes the API, data, UI, and error contract explicit.

## Author boundary

Assign `GEMINI`. This is a vertical, high-risk identity feature spanning authenticated UI, API contracts, persistence, expiring bearer secrets, delivery side effects, authorization, tenant isolation, audit, concurrency, and E2E proof. It is prohibited for `9ROUTER` under `AGENTS.md` because it touches authentication, authorization, tenant isolation, and product UX.

GEMINI may choose internal module boundaries, query/index implementation, queue versus synchronous adapter invocation, and the cryptographic token-hash library already compatible with the repository. Human approval is required before introducing a production email vendor, weakening token entropy/expiry, expanding who may invite, granting permissions beyond the inviter, changing `ST-INVITE`, or adding cross-tenant identity disclosure.

## In scope

- `SCR-USR-01` `/settings/users` list for tenant users and invitations, with server-side tenant scoping and permission-aware actions.
- Invite form for email, one or more existing role identifiers, and explicit warehouse/carrier-account scopes. The server validates every role and scope against the tenant and the inviter’s own effective permissions.
- Create exactly one `PENDING` invitation with a single-use opaque token whose plaintext is sent only through the delivery adapter; persist only a one-way token hash.
- Delivery outcome recording that distinguishes accepted-for-delivery from delivery failure. A failed delivery leaves a recoverable invitation record and UI action; it never shows a false sent success.
- Resend for `PENDING` or `EXPIRED`: atomically revoke the prior token, issue a new token and expiry, increment resend metadata, and make every older link unusable. Resend of an expired invitation performs the approved `EXPIRED → PENDING` transition.
- Cancel only a `PENDING` invitation. Cancellation revokes its token immediately and records actor, time, and reason if supplied.
- Expiration based on persisted `expires_at`; reads and accept/resend commands materialize `EXPIRED` consistently when the deadline has passed. A bounded background expiry job may be added, but correctness must not depend on the job having run.
- Public invite inspection and acceptance endpoints that reveal only the minimum recipient-safe tenant/inviter/role summary after a valid token is presented.
- Acceptance that atomically consumes the invitation, creates or links the platform `User`, creates exactly one tenant `Membership` with the invited roles/scopes, records required terms acceptance for a new identity, and changes invitation state to `ACCEPTED`.
- Existing-user acceptance only when the token recipient identity matches the invitation email. An existing membership in the same tenant returns an idempotent already-accepted result only when it came from this accepted invitation; otherwise it returns `CONFLICT` without widening permissions.
- Immutable audit events for invite, delivery result, resend, cancel, expire, acceptance success/failure, and authorization rejection. Tokens and unnecessary PII are excluded from logs, errors, snapshots, fixtures, and telemetry.
- OpenAPI, generated contracts, Prisma migration, deterministic fixtures, unit tests, API integration tests, component tests, and Playwright acceptance coverage for every matrix row.

## Out of scope

- Public self-registration, admin-created initial shop account, login, password recovery, MFA, and session management (`FEAT-AUTH-01..06`).
- General user edit/activate/suspend/delete/session-revoke lifecycle (`FEAT-USR-02`).
- Creating or editing custom roles/permissions (`FEAT-RBAC-01`) or a general-purpose scope assignment editor (`FEAT-RBAC-02`).
- Shop, branch, warehouse, or carrier-account CRUD.
- Invitations by phone/SMS, bulk CSV invitations, SCIM/directory sync, social/SSO onboarding, guest access, or invitations to multiple tenants in one command.
- Production email-provider selection, DNS/deliverability configuration, bounce processing, or marketing email preferences.
- Removing or transferring the last owner. Invitation acceptance may add an owner only when the inviter is permitted to grant that role; owner removal remains outside this feature.
- Automatic role escalation, implicit “all resources” scope, or accepting a client-supplied tenant ID as authority.

## Business rules and edge cases

| Rule ID | Rule |
|---|---|
| `BR-USR-INV-01` | Only `SHOP_OWNER` or an administrator with user-management permission in the current tenant may send, resend, or cancel. Tenant and inviter authority are derived server-side. |
| `BR-USR-INV-02` | The inviter may grant only existing tenant roles and resource scopes contained in the inviter’s own effective authority. Empty, foreign-tenant, unknown, or over-broad grants return `FORBIDDEN` or field-level `VALIDATION_ERROR`; no invitation is created. |
| `BR-USR-INV-03` | Email is normalized using the platform identity rule before uniqueness checks. At most one live `PENDING` invitation exists for `(tenant, normalized email)`. Concurrent duplicate sends converge on one invitation and do not send multiple valid tokens. |
| `BR-USR-INV-04` | A new token is cryptographically random, single-use, stored only as a hash, and has a configurable bounded lifetime defaulting to 24 hours, consistent with the approved email-token window in `BR-AUTH-06`. Token values never appear in logs or API responses for authenticated administrators. |
| `BR-USR-INV-05` | Resend is permitted for `PENDING` and `EXPIRED`, applies the approved `EXPIRED → PENDING` transition where needed, revokes all earlier tokens, and is rate-limited to the approved resend-verification policy in `BR-AUTH-08` (60-second cooldown, maximum five per hour per normalized recipient and tenant). |
| `BR-USR-INV-06` | Cancel is permitted only from `PENDING`. `ACCEPTED`, `CANCELLED`, or `EXPIRED` cancellation returns `CONFLICT` with current state and no mutation. |
| `BR-USR-INV-07` | At or after `expires_at`, the invitation cannot be accepted. The response is an explicit expired error and offers resend/contact-admin recovery without changing roles or membership. |
| `BR-USR-INV-08` | Accept is atomic and replay-safe. Exactly one `Membership` and one acceptance audit event result under concurrent submits; a second use of the same token receives an already-used/invalid state and cannot alter membership. |
| `BR-USR-INV-09` | A cancelled, expired, superseded, malformed, or unknown token fails closed. Responses do not reveal whether an arbitrary email or tenant exists. |
| `BR-USR-INV-10` | If the normalized email already has a membership in the target tenant, sending a new invitation returns `CONFLICT`. If it belongs to a platform user without that membership, acceptance links the identity only after recipient authentication or equivalent possession/verification proof defined by the acceptance contract. |
| `BR-USR-INV-11` | Invitation role/scope snapshot is immutable after send. A changed assignment requires cancel plus a new invitation, preserving what the recipient actually accepted. |
| `BR-USR-INV-12` | Invite, resend, cancel, expire, delivery outcome, accept, and denied management attempts are audited with tenant, actor, invitation ID, action, timestamp, correlation ID, and safe before/after metadata; never token text or unmasked recipient PII. |

Timeout and recovery behavior: a delivery timeout is `DELIVERY_UNKNOWN`, not success. The same command key/request may return the stored invitation and reconcile adapter status; a different request under the same key returns `CONFLICT`. Never generate another live token solely because the client timed out. UI recovery refetches invitation state before offering resend.

## UI states

`SCR-USR-01` must follow `DESIGN-SYSTEM-UX-RULES.md` and the shared `SCREEN-SPECIFICATIONS.md` contract.

- **Loading:** skeleton for initial list; scoped progress and disabled duplicate action for send/resend/cancel; acceptance submit locks while committing.
- **Empty:** “No users invited yet” with an Invite user action only for authorized actors; unauthorized viewers do not see management controls.
- **Invite form:** email, role, warehouse scope, and carrier-account scope with clear labels, keyboard operation, field-level validation, and no production-like sample defaults.
- **Validation:** malformed email, missing role, empty required operational scope, unknown resource, and over-grant show distinct actionable messages without clearing form input.
- **Duplicate/conflict:** existing member, existing pending invite, stale state/version, and reused token are distinct. A pending duplicate links to the existing record instead of claiming another email was sent.
- **Delivery partial/unknown:** invitation exists but delivery failed or timed out; show the truthful state and retry guidance after refetch, never a success toast.
- **List states:** user and invitation rows visibly distinguish `PENDING`, `ACCEPTED`, `EXPIRED`, `CANCELLED`, and delivery failure/unknown; timestamps use the user locale while retaining UTC API values.
- **Forbidden:** direct navigation by a user without management permission renders a forbidden state and performs no list/invite data leak.
- **Accept page loading:** validates the token before showing tenant/inviter/role summary; never displays the raw token after navigation.
- **Accept new identity:** collects display name, password that meets the current auth policy, and terms/privacy acceptance; existing identity follows the repository’s authenticated or identity-verification handoff without exposing whether another account exists.
- **Expired/cancelled/superseded/invalid:** separate failure messages. Expired offers contact-admin/resend guidance; cancelled and superseded do not offer acceptance; invalid remains non-enumerating.
- **Success:** confirms membership and exact granted role/scope, with a login/dashboard continuation only when that route is available. No false dashboard access claim is permitted.
- **Recovery:** network/server errors preserve entered values, refetch state before retry, and make the next safe action explicit. Responsive and accessibility evidence is required at mobile and desktop widths.

## API, event and data impact

All authenticated administration routes use `/api/v1`, bearer authorization, a server-derived tenant, canonical envelopes, `correlation_id`, and an `Idempotency-Key` for mutating invitation commands.

- `GET /users/invitations` — paginated tenant-scoped invitation list with filters for state and normalized search; recipient PII masked according to permission.
- `POST /users/invitations` (`sendUserInvitation`) — request `{ email, role_ids, scopes }`; returns `201` with safe invitation metadata and delivery state. `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `409 CONFLICT`, and `429 RATE_LIMITED` are documented.
- `POST /users/invitations/{invitation_id}/resend` (`resendUserInvitation`) — optimistic version or ETag required; returns the refreshed `PENDING` invitation without token text.
- `POST /users/invitations/{invitation_id}/cancel` (`cancelUserInvitation`) — optimistic version or ETag required; optional reason; returns `CANCELLED`.
- `GET /auth/invitations/{token}` (`inspectUserInvitation`) — public/minimal safe summary only after token validation; invalid-family responses remain non-enumerating.
- `POST /auth/invitations/{token}/accept` (`acceptUserInvitation`) — new-identity or existing-identity proof plus terms fields as applicable; returns safe membership/user result and `ACCEPTED`, but session issuance is not required by this Work Item.

Add an `Invitation` persistence model with UUID, tenant ID, normalized recipient email plus protected display value, token hash/version, state, role/scope snapshot, inviter ID, expiry, consumed/cancelled/resend/delivery metadata, optimistic version, and timestamps. Add indexes/constraints for token-hash lookup, tenant listing, expiry scanning, and one live invitation per tenant/email. Preserve unique `(tenant_id, user_id)` membership behavior. Migration documentation must state forward and rollback/data-preservation behavior.

Publish durable internal events only after transaction commit (via the repository’s established outbox/event pattern if present): `UserInvitationCreated`, `UserInvitationDeliveryRecorded`, `UserInvitationResent`, `UserInvitationCancelled`, `UserInvitationExpired`, and `UserInvitationAccepted`. Delivery jobs carry invitation ID/token version, not arbitrary tenant authority, and ignore stale token versions. No external production integration is required; deterministic adapter evidence is required.

Contract changes are additive. Update `docs/product-spec/contracts/openapi.yaml`, regenerate `packages/contracts`, and pass contract drift checks. Update the cited traceability, business-rule, state, screen, data, and acceptance sources with the dedicated IDs introduced here; do not silently reuse aggregate IDs where a concrete test needs a stable identifier.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-USR-01-01` | Authorized owner sends a valid operator invite scoped to warehouse A and carrier account A | One `PENDING` invitation persists; one live token is delivered by deterministic adapter; role/scope snapshot is exact | API integration test + adapter capture + DB assertions |
| `AC-USR-01-02` | Invited recipient accepts before expiry | Token is consumed once; invitation becomes `ACCEPTED`; exactly one user/membership exists with invited role/scope | Integration test with transaction assertions |
| `AC-USR-01-03` | Accepted operator queries warehouse/account A and then B | A succeeds; B is `FORBIDDEN` with no cross-scope data | API integration + E2E acceptance test (`AC-USR-01`) |
| `AC-USR-01-04` | Unauthorized operator attempts list/send/resend/cancel, including a foreign-tenant invitation ID | Every request is `FORBIDDEN`/not-found-equivalent; no existence or PII leak; denied action audited | Two-tenant integration test + audit assertions |
| `AC-USR-01-05` | Inviter attempts to grant a role or scope they do not possess | Fails closed; no invitation, delivery, or membership side effect | API integration test |
| `AC-USR-01-06` | Two concurrent valid sends target the same tenant/email | Exactly one live pending invitation and one live token result; retry returns stored outcome or conflict per key/hash | Concurrency integration test |
| `AC-USR-01-07` | Resend a pending invitation after cooldown | Prior token becomes unusable; one new token/version and expiry exist; audit and delivery records are distinct | Integration test + adapter capture |
| `AC-USR-01-08` | Resend an expired invitation | `EXPIRED → PENDING`; new token accepts; old token remains expired/superseded | Clock-controlled integration test |
| `AC-USR-01-09` | Resend inside cooldown or above hourly maximum | `RATE_LIMITED` with retry hint; no new token or delivery | Clock-controlled integration test |
| `AC-USR-01-10` | Cancel pending invitation, then use its token | Invitation is `CANCELLED`; token cannot inspect/accept; no membership created | Integration test + audit assertions |
| `AC-USR-01-11` | Cancel `ACCEPTED`, `CANCELLED`, or `EXPIRED` invitation | `CONFLICT` with safe current state; no mutation | Parameterized integration test |
| `AC-USR-01-12` | Accept at/after persisted expiry | Explicit expired outcome, state materialized as `EXPIRED`, no user/membership mutation | Injected-clock integration test |
| `AC-USR-01-13` | Replay or concurrently submit one acceptance token | One request can commit; all others fail safely/idempotently; one membership and one success audit event | Concurrent integration test |
| `AC-USR-01-14` | Delivery adapter fails or times out after invitation creation | UI/API shows failed or unknown delivery truthfully; recovery refetch does not create a second live token | Integration test + component test |
| `AC-USR-01-15` | Existing platform user accepts a matching invite without target-tenant membership | Identity is securely linked; exactly one scoped membership is added; no other tenant membership changes | Two-tenant integration test |
| `AC-USR-01-16` | Existing member is invited again | `CONFLICT`; existing membership is not widened and no token is delivered | Integration test |
| `AC-USR-01-17` | Malformed, unknown, superseded, cancelled, or foreign token is inspected/accepted | Fails closed with non-enumerating canonical error; token/PII absent from logs | Parameterized security test + log inspection |
| `AC-USR-01-18` | `SCR-USR-01` list and invite flow | Loading, empty, validation, forbidden, pending, delivery partial, resend, cancel, expired, and success states render and recover correctly | Component tests + Playwright screenshots at mobile/desktop widths |
| `AC-USR-01-19` | Public accept flow for new identity | Token summary, password/terms validation, expired/error recovery, and accepted confirmation are accessible and connected to real API outcomes | Playwright E2E + accessibility scan |
| `AC-USR-01-20` | Contract, migration, audit, and secret-scrubbing checks | Generated contracts have zero drift; migration works cleanly; token values and unnecessary PII do not appear in output | Contract check + migration test + secrets/log evidence |
| `AC-USR-01-21` | Regression suite | Prior authentication, tenant-isolation, and baseline tests remain green | Full command output from clean checkout |

## Verification commands

Run from a clean checkout at the implementation commit:

```text
pnpm install --prod --frozen-lockfile
pnpm install --frozen-lockfile
pnpm db:generate
pnpm contract:generate
pnpm contract:check
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:baseline
pnpm security:secrets
pnpm build
```

The implementation PR must also identify and run the repository-native focused commands for invitation API tests, two-tenant authorization tests, and the `SCR-USR-01`/accept-page Playwright spec. If a listed focused script does not exist, add it within the allowed test/tooling paths or record the exact existing filter form used; do not claim a command that was not executed.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| — | — | — | Planning only; a fresh independent Codex task must review the implementation PR at its exact HEAD. |

## Residual limitations

- Production email-provider selection, deliverability, bounce handling, and DNS configuration are not approved by the cited sources. Owner: product/human. Risk: production invitations cannot be enabled until a provider adapter and operational evidence are approved. Next action: create a separate provider-integration Work Item; this feature remains fully testable through the deterministic adapter.
- `SCR-USR-01`, invitation-specific rule IDs, detailed API operations, the `Invitation` machine schema, and decomposed `AC-USR-01-*` rows are not yet expanded in the aggregate source documents. This Work Item derives them without contradicting `FEAT-USR-01`, `UC-USR-01`, `ST-INVITE`, or `AC-USR-01`; the implementation PR must update the cited source documents and contracts, and the independent reviewer must reject any conflict. Owner: `GEMINI` author and fresh Codex reviewer. Risk: medium documentation/contract drift until merged.

