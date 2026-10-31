# FEAT-COM-09 — Shop users receive actionable, scoped notifications

## Control

| Field | Value |
|---|---|
| Work Item ID | `FEAT-COM-09` |
| Feature ID | `FEAT-COM-09` |
| Status | `READY_FOR_AUTHOR` — gaps G1–G6 are recorded as decisions D1–D6 (Operator approval 2026-10-31; versioned in `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`) |
| Delivery order | 28, S01, Shared platform |
| Dependencies | Registered: `TASK-FOUND-04` plus BACKLOG-DEPENDENCIES.md. Available integration prerequisites: `FEAT-AUTH-01`, `FEAT-AUTH-06`, `FEAT-RBAC-01`, `FEAT-RBAC-02`, `FEAT-PRO-01`. Domain producer dependency scope is resolved by D1 (bounded S01 first delivery; the remaining producer categories ship as versioned fixture-only event contracts). |
| Assigned author | `GEMINI` |
| Risk | HIGH — tenant/recipient isolation, security notices, financial information in email, durable asynchronous delivery |
| Allowed paths | Planning phase (this PR): this file, the FEAT-COM-09 row in `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, and `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`. Implementation phase: frozen allowed paths in [Allowed paths (frozen)](#allowed-paths-frozen). |
| Reviewer | Codex — fresh independent task |
| Branch | `feat/feat-com-09` — existing isolated branch; planning finalisation in this PR, one implementation PR to follow |
| Pull Request | Planning finalisation PR on `feat/feat-com-09` (documentation only, this commit). The single implementation PR for this Work Item follows on the same branch after `IN_PROGRESS`. |
| Inspected baseline | Local HEAD and local `origin/main`: `b52f3af7c579be6e5fbbfcd339a4e54d8d0c4d48`; inspected 2026-10-30. No remote refresh or CI verification claimed. |

## Business outcome

Shop owners, operations managers, order operators, customer service, warehouse staff and finance receive the events relevant to their work through a persistent in-app notification center and the email channels specified by the notification matrix. They can distinguish unread notices and severity and follow a deep link to the underlying authorized record. Repeated events are grouped or deduplicated according to that matrix, without suppressing required security or critical operational alerts.

This is a complete vertical feature: event creation, recipient selection, persistence, delivery, authenticated queries/actions, UI, recovery and evidence. A settings toggle, toast, mock email dispatch or seeded inbox alone does not satisfy it.

## Source references

Paths below are relative to this Work Item. Headings without existing identifiers are cited by their exact heading; this plan does not fabricate approved BR/UC/SCR/API/EVT/ENT/ST IDs. AC/Test IDs below are local planning identifiers, not previously approved source IDs.

| Source | Exact authority used |
|---|---|
| [Baseline and decisions](../docs/00-control/BASELINE-AND-DECISIONS.md#product-decisions) | DEC-005 (no blind external-command retry), DEC-007 (channel-neutral web/PWA), DEC-014/015 (processing/findings and monetary evidence stay separate), DEC-016; Change control requires approved decisions/contracts/tests for PII, permission and tenant changes. |
| [Vision](../docs/01-product/PRODUCT-VISION-SCOPE.md#boundaries) | Operational users; Boundaries: no cross-tenant access, no fake external results, no financial conclusion without evidence. |
| [Feature catalog](../docs/01-product/MASTER-FEATURE-CATALOG.md#2-shared-platform) | FEAT-COM-09: in-app/email, unread, severity, dedupe and deep link. FEAT-PRO-01 owns personal notification preferences. |
| [Actors](../docs/01-product/ACTORS-PERSONAS.md#actors-and-personas) | SHOP_OWNER, OPS_MANAGER, ORDER_OPERATOR, CUSTOMER_SERVICE, WAREHOUSE_OPERATOR, FINANCE; SHIPDE_OPERATOR only within granted temporary tenant scope; SYSTEM_ADMIN has no default business browsing. |
| [Notification matrix](../docs/02-business/NOTIFICATIONS-REPORTS.md#notification-matrix) | All 14 event rows, their default audience/severity/channel/grouping/escalation, and the final mandatory-alert paragraph. This is the specific notification business authority. |
| [Business rules](../docs/02-business/BUSINESS-RULES-DECISION-TABLES.md) | BR-AUTH-09/17/19 security audit; BR-AVL-02 distinguishes timeout from unsupported; BR-IDEM-02 reconciles unknown create before retry. No notification-center rule family exists. |
| [Use cases](../docs/02-business/USE-CASES.md) | UC-USR-01 invitations, UC-TRK-01 ingest/verify/dedupe/canonicalize/update/notify, UC-SHIP-03 unknown outcome, UC-CLM-01 policy/deadline/evidence. No dedicated notification-center use case exists. |
| [Processes](../docs/02-business/END-TO-END-PROCESSES.md#pr-01-onboard-a-shop) | PR-01 step 6 configures notifications; PR-03 tracking/exception and PR-06 claim processes supply domain context, not new permission grants. |
| [States](../docs/02-business/STATE-MACHINES.md) | Shipment CREATE_OUTCOME_UNKNOWN; Operational exception RESOLVED/REOPENED; Discrepancy case ACCEPTED_UNPAID. No notification read/delivery lifecycle is defined. |
| [RBAC](../docs/02-business/RBAC-APPROVAL-MATRIX.md#enforcement) | Backend authoritative; tenant/branch/warehouse/carrier-account scope; consented temporary support access. No notification-specific capability is defined. |
| [Screens](../docs/03-ux/SCREEN-SPECIFICATIONS.md#shared-screen-contract) | Shared screen states, stable URLs where safe, validation, duplicate-submit protection, permission-aware actions; SCR-ONB-01 operating defaults/notifications; SCR-SHIP-01 unknown outcome. No notification-center screen specification exists. |
| [Navigation](../docs/03-ux/INFORMATION-ARCHITECTURE.md#primary-navigation) | Cấu hình → Thông báo; Route catalog contains no notification-center route/SCR ID. |
| [UX rules](../docs/03-ux/DESIGN-SYSTEM-UX-RULES.md) | Canonical components: toast plus persistent notification center; content rules, responsive behavior, WCAG AA, keyboard/focus and async announcements. |
| [Domain model](../docs/04-data/DOMAIN-MODEL-ERD.md#aggregates) | Notification is named in Audit and money; Modeling rules require tenant identity, UTC and controlled history. No Notification fields/relationships are specified. |
| [Dictionary](../docs/04-data/DATA-DICTIONARY.md#data-classification), [conceptual schema](../docs/04-data/schema.dbml), [lifecycle](../docs/04-data/DATA-LIFECYCLE-IMPORTS.md#retention) | User/tenant and data classification; no Notification table/field contract; configurable retention, audited deletion and preserved required metadata. |
| [Internal API](../docs/05-api-integrations/INTERNAL-API.md#api-conventions), [OpenAPI](../contracts/openapi.yaml) | `/api/v1`, authenticated tenant context, pagination, canonical errors/correlation; `/me/preferences`, NotificationChannels/Subscriptions/Preferences exist. No inbox/list/count/read operation or Notification resource schema exists. |
| [Retry contract](../docs/05-api-integrations/ERROR-IDEMPOTENCY-RETRY.md) | VALIDATION_ERROR, FORBIDDEN, CONFLICT; durable dedupe before retry, and no unsafe external-command retry. Does not define email delivery ambiguity/retry. |
| [Backend](../docs/06-architecture/BACKEND-ARCHITECTURE.md#outboxinbox), [frontend](../docs/06-architecture/FRONTEND-ARCHITECTURE.md#state-rules), [security](../docs/06-architecture/SECURITY-NFR-OBSERVABILITY.md) | Transactional state/outbox; at-least-once idempotent handlers; query-backed UI, generated types; scope enforcement, masking, immutable security audit, correlation and queue/dead-letter observability. |
| [Stack](../docs/07-ai-build/TECH-STACK-REPOSITORY.md), [Ready/Done](../docs/07-ai-build/DEFINITION-OF-READY-DONE.md#feature-definition-of-ready) | Existing pnpm/NestJS/Next.js/Prisma/BullMQ stack; no implementation until actors, permissions, states, contracts, acceptance and dependencies are ready. |
| [Acceptance](../docs/08-testing/ACCEPTANCE-AND-E2E.md), [test strategy](../docs/08-testing/TEST-STRATEGY.md), [test data](../docs/08-testing/TEST-DATA-MOCKS.md) | E2E-10 tenant attack and domain regressions; unit/API/worker/component/browser evidence and synthetic scoped fixtures. No FEAT-COM-09 acceptance source exists. |
| [Dependencies](../docs/09-delivery/BACKLOG-DEPENDENCIES.md#epics), [traceability](../docs/00-control/TRACEABILITY.md#initial-traceability) | EPIC-REPORT includes notifications and depends on all domain epics, unlike early S01 placement. Traceability has no FEAT-COM-09 row; a new CORE feature cannot merge without one. |
| [Workflow](../docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [planning prompt](../docs/10-ai-collaboration/CODEX-PLANNING-PROMPT.md), [template](../docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md) | Dedicated executable Work Item, GEMINI routing for cross-layer/security/UI, BLOCKED for missing material rules; user overrides commit/push with uncommitted delivery. |

## Preconditions and dependencies

The local `origin/main` ancestry includes TASK-FOUND-04 `9d101f4e` (#13), FEAT-AUTH-01 `4f32b93b` (#14), FEAT-AUTH-06 `234056f8` (#446), FEAT-RBAC-01 `d27f5f44` (#449), FEAT-PRO-01 `3d35075f` (#457) and FEAT-RBAC-02 `7969cad9` (#459); their register rows say MERGED. These are local merged-baseline observations, not a live GitHub gate result.

The user selected FEAT-COM-09 explicitly. Earlier rows remain unchanged; this is not a claim that all earlier product features are complete. In particular the register still contains earlier READY_FOR_CODEX rows. Do not reconcile those within this item.

### Existing code integration evidence

- `apps/api/src/session/session.guard.ts`: validates durable sessions and derives `userId`/`merchantId`; setup-only MFA tokens are limited to an explicit allowlist. Notification access must not expand that allowlist.
- `apps/api/src/rbac/rbac.guard.ts`, `rbac.service.ts`, `rbac.constants.ts`: reusable current actor/permission evaluation; no notification capability entry. Audience labels alone do not authorize underlying records.
- `apps/api/src/users/me.controller.ts`, `me.dto.ts`, `me.service.ts`: GET/PATCH `/api/v1/me/preferences`; merge stored channels and subscriptions; reject disabling security_alerts, create_unknown, claim_deadline_warning. Channels remain independently writable, including both email=false and in_app=false; that open policy is resolved for this feature by D3 (write-time rejection plus delivery-time in-app override).
- `prisma/schema.prisma`: tenant key is implemented as `merchant_id`; `User.notification_preferences` is JSONB. AuditLog and technical OutboxEvent exist; there is no Notification model. OutboxEvent has a globally unique optional idempotency key and no tenant column; a future design must establish tenant-safe keys/context rather than assume it is already a notification outbox.
- `apps/api/src/outbox/outbox.service.ts` rejects all event types except QUEUE_SMOKE_EVENT_TYPE. `apps/worker/src/dispatcher/outbox.dispatcher.ts` selects only that type; `apps/worker/src/queue/smoke.worker.ts` rejects other types. They prove infrastructure, not notification delivery. Adding notification events requires coordinated producer/dispatcher/consumer contract changes and smoke regressions.
- `apps/api/src/auth/default-verification-adapter.ts` simulates delivery, returns success even when a production provider is not wired, and logs recipient/token/OTP in development. This conflicts with no-fake-result/no-secret-log requirements. Do not reuse this implementation as notification email evidence; the existing conflict is recorded for resolution, not silently repaired by this planning task, and D5 explicitly prohibits its reuse for notification email.
- `apps/web/src/app/settings/profile/page.tsx` and `components/ProfileSettingsTab.tsx` expose persisted personal preferences. Preserve their API compatibility and tests.
- `apps/web/src/components/NotificationMatrixTab.tsx` holds a hardcoded event matrix in React state; save/test actions only produce success toasts and claim FCM/APNS dispatch. `SettingsWorkspace.tsx` and `ShopSettingsModal.tsx` embed it. These are prototype behavior, not authority or proof of a working inbox, persistence or delivery. Its fixed thresholds/digest choices and mobile push claims cannot be adopted as new product policy.
- OpenAPI preference schemas are in `docs/product-spec/contracts/openapi.yaml`, shared/generated types in `packages/contracts/src/index.ts` and `openapi.ts`. The repository-root `contracts/openapi.yaml` mentioned by INTERNAL-API.md does not exist; use the actual specification package location.

### Readiness gaps — evidence and recorded resolutions

The gap table below is retained as the planning context for the resolutions recorded after it.

| Gap | Evidence and missing decision | Required resolution before READY_FOR_AUTHOR |
|---|---|---|
| G1 — delivery scope/dependencies | S01 register places this item after foundation; BACKLOG-DEPENDENCIES.md assigns notifications to EPIC-REPORT after all domain epics. Matrix covers 14 producer categories, but neither defines an approved S01 subset nor event contracts/mocks for unavailable producers. | Product owner approves full producer integration dependencies or a bounded first delivery with explicitly contracted fixtures/future integrations. Version dependency/scope sources and exact producer EVT IDs. Do not present fixtures as live events. |
| G2 — unread/lifecycle/deep-link screen behavior | Feature catalog says unread/deep link, but SCREEN-SPECIFICATIONS.md, STATE-MACHINES.md and route catalog define no center. Opening versus explicitly marking read, per-user versus shared read state, count behavior, resolved-alert visibility and allowed actions are unspecified. | Approve SCR/UC/ST and route, visible fields/filters/actions, unread transition/count semantics, pagination/order, and inaccessible/deleted deep-link recovery. No automatic domain resolution on read can be assumed. |
| G3 — mandatory channels/preference compatibility | Matrix requires in-app + email for security/unknown-create/deadline and forbids fully disabling those alerts; existing preferences can turn both channels off while retaining mandatory subscriptions. No policy defines override versus rejection or how to handle users without a usable email. | Approve mandatory channel behavior, missing/unverified email recovery and preference compatibility/migration. Include tests for both channels off and retain three protected subscriptions. Do not silently pick override or reject. |
| G4 — audience/scope/audit | Default audience roles exist, but RBAC matrix defines no notification list/read/manage rights. Self-security events versus tenant events, custom-role mapping, role/scope revocation after delivery, support access, and auditing notification reads/delivery are unspecified. | Approve recipient ownership and permission rules, scope re-evaluation and data disclosure policy (including email snapshots), plus exact audited actions and sanitized fields. No new owner-wide or support-wide inbox access by inference. |
| G5 — email delivery and escalation | Matrix says daily digest, age escalation, multi-level reminders and remains until resolved, without thresholds/timezone/config ownership, delivery-state/retry/provider contract or timeout reconciliation. Existing mail adapter is simulated; smoke outbox rejects notification types. | Approve configurable schedules/grouping keys and resolution signals, email adapter/provider evidence or an explicit nonproduction-only contract, truthful failure/unknown semantics, dedupe window/key and retries/dead-letter/manual recovery. Resolve recorded adapter conflict or explicitly prohibit its reuse. No invented attempt caps, minutes or partner capabilities. |
| G6 — resource/API/data/acceptance | Domain model only names Notification; dictionary/DBML/OpenAPI have no notification resource, list/count/read commands or read/delivery models. Traceability and acceptance documents have no feature-specific row/AC. Retention values are policy-driven, not supplied. | Version API/ENT/EVT schemas, recipient and tenant constraints/indexes, lifecycle/concurrency/idempotency, retention policy reference and migration/forward-recovery plan; approve the source-backed acceptance matrix and traceability. This Work Item must then replace blocked assertions with exact executable contracts. |

### Recorded decisions (Operator approval 2026-10-31)

**D1 — Delivery scope and producer dependencies (resolves G1).** A bounded first delivery at the S01 scope is approved, not full producer integration. The notification platform ships with exactly one live producer category whose integration prerequisites are merged in the inspected baseline: invite/identity/security change (FEAT-AUTH-01 producers in `apps/api/src/invitations/` and `apps/api/src/auth/auth.service.ts`). The remaining 13 matrix event categories ship as versioned event contracts `EVT-COM-09-02` through `EVT-COM-09-14` (matrix order, see D6) in `packages/contracts`, with deterministic fixture producers usable in test/integration evidence only. Each contract names the future producer Work Item that will connect it live. Fixture-generated notifications are labelled fixture evidence in every test report and PR evidence section and are never presented as live events. Dependency/scope sources are versioned by this decision entry, register row 28 and the `NOTIFICATIONS-REPORTS.md` matrix.

**D2 — Notification center screen, unread and deep-link semantics (resolves G2).** Screen `SCR-COM-09` (Notification center) at route `/settings/notifications`, under Cấu hình → Thông báo per `INFORMATION-ARCHITECTURE.md`; the implementation PR adds the row to the IA route catalog. The entry file is the standalone route `apps/web/src/app/settings/notifications/page.tsx`, matching the current standalone `/settings/*` page pattern; no shared shell entry file changes are required beyond the preference-embedded settings tabs listed in the frozen paths.
- Visible fields: severity (icon plus text, never color-only), title, event-type label, source reference label (link text only, no destination metadata), created time in the recipient's IANA timezone, unread indicator, digest member count for grouped rows, resolved label for resolved rows.
- Filters: unread only, severity, event family (only categories with a live producer in the current baseline). Ordering: severity rank descending, then `created_at` descending. Pagination: cursor-based, limit capped by governed configuration.
- Unread semantics: read state is per recipient user and server-side only. Opening a deep link never marks a notice read; the explicit mutations `POST /api/v1/notifications/{id}/read` and `POST /api/v1/notifications/read-all` are the only read transitions and are idempotent. The unread count is computed server-side per request for the session tenant plus user; clients never accumulate counts. Tenant switching re-fetches; no stale-tenant content is cached.
- Deep links: a notice stores a server-rendered internal path only (no token, no permission). Destination authorization remains authoritative. Deleted or inaccessible destinations render the shared not-found/forbidden recovery with a return link to the center; the notice row and its metadata are neither leaked nor auto-removed. Reading never implies domain resolution.
- Resolved alerts remain visible with a resolved label until retention processing (matrix "remains until resolved").

**D3 — Mandatory channels and preference compatibility (resolves G3).** The three protected event classes map to the existing subscription keys `security_alerts`, `create_unknown` and `claim_deadline_warning` and can never be fully disabled.
- Write-time rejection: `PATCH /api/v1/me/preferences` (and `PATCH /api/v1/me` where it carries preferences) rejects `false` for any protected subscription key with canonical `400 VALIDATION_ERROR` (`PROTECTED_SUBSCRIPTION_CANNOT_DISABLE`); rejections are audited per D4.
- Delivery-time override: protected events are always delivered in-app regardless of stored channel preferences (in-app is the guaranteed mandatory channel per DEC-007 channel neutrality); legacy or migrated rows with `channels.in_app=false` do not suppress protected in-app delivery. Email delivery proceeds only when the recipient has a usable, verified email address.
- Missing/unverified email: the email dispatch outcome is recorded as `SKIPPED_NO_VERIFIED_EMAIL` (truthful; neither fake success nor generic failure). The profile and the center surface an actionable "email not usable" notice with a link to update/verify the email. Previously skipped protected emails are not resent when the address becomes verified; subsequent protected email events deliver normally.
- Non-critical channels, digest windows and non-protected subscriptions remain user-configurable; persisted preferences are read at dispatch time so the change affects actual delivery.
- Compatibility/migration: the feature migration forces the three protected subscription keys to `true` in place on existing `User.notification_preferences` rows; other keys and channel booleans are preserved. The `push` preference key is preserved for schema compatibility; no push transport exists and the center never claims push dispatch.
- Required tests: both channels off (legacy row), protected-subscription rejection, missing/unverified email, and a non-critical preference change affecting real delivery.

**D4 — Recipient ownership, permissions, scope and audit (resolves G4).** Every notification row is owned by (`merchant_id`, recipient `user_id`). List, count and read endpoints are scoped server-side to the session-derived merchant plus user; client-supplied user/tenant/recipient values are never authority (read mutations accept only the notification id, and id lookup enforces scope).
- Access: any authenticated tenant member may list, read and mark their own notifications; no new RBAC capability is introduced and no owner-wide or support-wide inbox access is inferred.
- Recipient expansion happens at dispatch time: the matrix audience role labels are resolved to concrete current users from live tenant membership via the role→audience mapping frozen in `packages/contracts` (custom roles included, no hard-coded role names in code). Delivered rows remain visible to their named recipient if their role is later revoked (historical disclosure to a known recipient); no new rows are addressed to them.
- Support access: tenant-granted temporary support scope may read notifications only within its store/warehouse scope with the purpose/expiry already recorded on the grant; no platform-admin bypass; `SYSTEM_ADMIN` has no notification access by default.
- Revocation: every query re-evaluates current session/permission state; expired or revoked access yields `401`/`403` with no content or count leakage (counts are scoped).
- Audited actions (immutable security/business audit on the existing `AuditLog` pattern): (a) each protected-class dispatch (event, channel, outcome, recipient, tenant, correlation, actor=system), (b) protected preference write rejections (actor, attempted key, outcome), (c) dead-letter escalation of email dispatch (notification, channel, safe error code, actor). Sanitized fields only: no email bodies, no recipient PII beyond the masked recipient address, no tokens or credentials.
- Data disclosure policy: stored content is a safe snapshot (title, severity, event type, source reference type+id, link path); email renders the same fields and carries no PII beyond the recipient's own address.

**D5 — Email delivery, schedules, escalation and reconciliation (resolves G5).** A new worker-side notification mail adapter is used; reuse of `apps/api/src/auth/default-verification-adapter.ts` as notification email evidence is explicitly prohibited, and its existing conflict stays recorded against the authentication owner (see Residual limitations). Missing provider configuration is a truthful `NOT_CONFIGURED` dispatch outcome (observable, no simulated success); in-app delivery is unaffected. A deterministic fake transport is test-only and labelled fixture evidence.
- Delivery states per channel row: `PENDING`, `IN_FLIGHT`, `SENT`, `FAILED`, `UNKNOWN`, `SKIPPED_NO_VERIFIED_EMAIL`, `NOT_CONFIGURED`, `DEAD_LETTER`.
- Ambiguity: timeout or ambiguous provider response → `UNKNOWN`; the worker reconciles provider state (by provider message id where supported) before any retry. Blind retries that could double-send an email are prohibited (DEC-005).
- Retries are bounded by validated configuration in `packages/config` (attempt cap, backoff steps, dead-letter threshold); no attempt caps, minutes or thresholds are hard-coded in production code.
- Dead-letter recovery: a Ship Dễ operator may trigger manual redelivery of a dead-lettered protected email dispatch from the admin Job/queue area within their granted scope; the action is audited.
- Digest windows, age-escalation tiers and claim-deadline reminder tiers are governed configuration evaluated in the recipient's IANA timezone (existing profile `timezone`); proposed default values are configuration data submitted in the implementation PR for operator review, not code constants.
- Grouping/dedupe keys follow the matrix Dedupe/escalation column exactly: one per order/input version, per carrier incident, per shipment/exception, daily digest (window boundary encoded in the key), per import revision, queue-count digest, per audit run, multi-level reminders, aging escalation. Duplicate transport delivery must not erase a distinct security notice.
- Resolution signals: domain resolution events from each live producer mark linked notices `RESOLVED`; no other signal resolves a notice; read actions never resolve.

**D6 — Resource/API/data contracts, retention, acceptance and traceability (resolves G6).**
- Entities (Prisma, tenant key `merchant_id`, ids `@db.Uuid`): `Notification` — `id`, `merchant_id`, `recipient_user_id`, `event_type` (one of the 14 contract types), `severity` (`critical|high|medium`), `title`, `body`, `source_type`, `source_id`, `group_key`, `link_path`, `status` (`ACTIVE|RESOLVED`), `read_at`, `resolved_at`, `retention_until`, `created_at`, `updated_at`; unique `@@unique([merchant_id, event_type, group_key, recipient_user_id])`; index `[merchant_id, recipient_user_id, status, severity, created_at]`. `NotificationChannelDelivery` — `id`, `notification_id`, `channel` (`in_app|email`), `state` (D5 states), `attempts`, `last_error_code` (safe code only), `sent_at`, `correlation_id`, `created_at`, `updated_at`; unique `@@unique([notification_id, channel])`.
- API (canonical envelope, correlation id on every response): `GET /api/v1/notifications` (params `cursor`, `limit` config-capped, `unread_only`, `severity`, `status`; ordered severity rank desc then `created_at` desc); `GET /api/v1/notifications/unread-count` → `{ data: { unread_count } }`; `POST /api/v1/notifications/{id}/read` (idempotent); `POST /api/v1/notifications/read-all`. No public endpoint exists or may be added for arbitrary client event/recipient creation.
- Errors (frozen): `400 VALIDATION_ERROR` for invalid params and wrong DTO types (never `500`); existing canonical `401` session codes; `404 NOT_FOUND` identical for absent, other-tenant, deleted or retention-processed rows (prevents notification existence enumeration); `403 FORBIDDEN` for scope denial without data.
- Events: one outbox event type `NOTIFICATION_EVENT` (constant in `packages/contracts`) whose payload carries `event` (one of `EVT-COM-09-01`…`EVT-COM-09-14`), `schema_version`, `occurred_at`, `merchant_id`, `source { type, id }`. Producer outbox idempotency key format: `com09:<merchant_id>:<event_type>:<source_fingerprint>` — tenant-scoped and deterministic per source event/version, establishing the tenant-safe key context the existing `OutboxEvent.idempotency_key` gap requires. The worker consumer re-validates payloads against the contracts and dead-letters violations.
- The 14 event contracts in matrix order: `EVT-COM-09-01` invite/identity/security change, `EVT-COM-09-02` carrier token invalid/expiring, `EVT-COM-09-03` serviceability all unavailable, `EVT-COM-09-04` carrier API outage/timeout, `EVT-COM-09-05` create outcome unknown, `EVT-COM-09-06` pickup overdue, `EVT-COM-09-07` delivery exception, `EVT-COM-09-08` return expected/overdue, `EVT-COM-09-09` import blocked, `EVT-COM-09-10` manual match required, `EVT-COM-09-11` audit finding created, `EVT-COM-09-12` bank short/over, `EVT-COM-09-13` claim deadline approaching, `EVT-COM-09-14` claim accepted but unpaid. Each has a fixed versioned payload shape in `packages/contracts`.
- Retention: `retention_until` is policy-driven per `DATA-LIFECYCLE-IMPORTS.md` and governed configuration; expiry anonymizes or deletes notification and delivery rows while preserving immutable audit entries; cross-tenant cleanup is batched per tenant and audited.
- Migration: one forward migration adding the two models plus the D3 protected-preference backfill; no backfill of historical events; reproducible in test; forward-recoverable.
- Acceptance: the 16-row matrix AC-COM-09-01…16 with test ids TEST-COM-09-01…16 is the acceptance set; the author registers the concrete suites in the owning package scripts so root gates execute them.
- Traceability: the implementation PR adds the FEAT-COM-09 row to `docs/product-spec/docs/00-control/TRACEABILITY.md` (feature → source documents → AC → tests).

## Author boundary

GEMINI is required because this feature crosses frontend, API, database migrations, tenant/RBAC controls and asynchronous external delivery. 9ROUTER is not eligible. G1–G6 are settled as D1–D6 (Operator approval 2026-10-31); GEMINI may choose routine implementation details only within the approved contracts below.

The implementation allowed paths are frozen in [Allowed paths (frozen)](#allowed-paths-frozen). The integration boundary is:

- API: a dedicated `apps/api/src/notifications/` module; registration in `apps/api/src/app.module.ts`; preference code/tests in `apps/api/src/users/me.*`; coordinated `apps/api/src/outbox/outbox.service.ts` changes; live producer emission only on existing invite/identity/security change paths in `apps/api/src/invitations/` and `apps/api/src/auth/auth.service.ts` (D1).
- Worker: a dedicated `apps/worker/src/notifications/` module; worker module registration and `apps/worker/src/dispatcher/outbox.dispatcher.ts`; preserve `apps/worker/src/queue/smoke.worker.ts` and smoke behavior with regression evidence.
- Web: `apps/web/src/app/settings/notifications/page.tsx` (SCR-COM-09, named by D2) plus `apps/web/src/components/notifications/`; existing `ProfileSettingsTab.tsx`, `NotificationMatrixTab.tsx`, `SettingsWorkspace.tsx`, `ShopSettingsModal.tsx` may change only where the D2/D3 notification integration requires it. Entry file is the standalone route page (D2); no further shared shell entry file exists in the current baseline.
- Persistence/contracts: `prisma/schema.prisma`, one feature migration under `prisma/migrations/`, `docs/product-spec/contracts/openapi.yaml`, shared/generated `packages/contracts/src/` notification definitions (D6), and `packages/config/src/` validated delivery configuration (D5).
- Tests/evidence: focused API/worker/UI tests in their modules (`apps/api/src/notifications/`, `apps/worker/src/notifications/`, `apps/web/src/tests/`, `apps/web/e2e/`), `packages/testkit/src/`, and matching package test registration, plus this Work Item, its register row, traceability and feature evidence.

Do not modify authentication semantics beyond D1 event emission, unrelated RBAC grants, unrelated UI, dependency versions, controller/toolchain code or global CI commands. A required wider path or product change requires an explicit source-backed scope revision first.

## In scope

Per recorded decisions D1–D6 (Operator approval 2026-10-31): a persistent center with unread/severity/deep links, server-authorized event-to-recipient distribution, matrix-based grouping and required email delivery, durable idempotent processing, compatible preferences, required audit/observability, full UI states and end-to-end evidence. The one available live producer path (invite/identity/security change) is connected; the unimplemented producer integrations are the explicitly approved fixture-only event contracts of D1, truthfully labeled at their evidence level.

## Out of scope

Native push/FCM/APNS, SMS, recipient marketing, report generation/billing, new carrier capabilities, shipment/claim/money commands and full implementations of producer domain features. A notification deep link conveys no permission or automatic action. No threshold, financial finding or resolution may be invented by the center. Do not turn this item into a profile rewrite or global prototype cleanup.

## Implementation slices

The work is large; it is delivered as two ordered slices inside the one branch and one implementation PR (one Work Item per PR stays true).

**Slice A — API, data and delivery (backend/worker).** Prisma models and the single migration with the D3 protected-preference backfill; `packages/contracts` notification DTOs, the 14 `EVT-COM-09-*` event contracts and the `NOTIFICATION_EVENT` outbox constant; `packages/config/src/` validated delivery configuration; `apps/api/src/notifications/` module (list/count/read endpoints, server-side scoping, canonical errors); `apps/api/src/users/me.*` D3 rejection and preference compatibility; `apps/api/src/outbox/outbox.service.ts` accepting `NOTIFICATION_EVENT`; live producer emission in `apps/api/src/invitations/` and `apps/api/src/auth/auth.service.ts` (invite/identity/security change only, D1); `apps/worker/src/notifications/` consumer (recipient expansion, dedupe/grouping, in-app persistence, email dispatch with D5 states/retry/dead-letter, digest and escalation schedulers); `apps/worker/src/dispatcher/outbox.dispatcher.ts` routing; `packages/testkit/src/` synthetic fixtures; Slice A tests (API unit/supertest, worker, DB concurrency, crash/replay, controlled transport). Slice A acceptance rows: TEST-COM-09-01, 02, 04, 05, 08, 09, 10, 11, 13, 14, 16 at API/worker/DB level.

**Slice B — UI (web).** `apps/web/src/app/settings/notifications/page.tsx` (SCR-COM-09) covering every state in the UI states table; `apps/web/src/components/notifications/` feature components; settings-tab compatibility in `ProfileSettingsTab.tsx`, `NotificationMatrixTab.tsx`, `SettingsWorkspace.tsx` and `ShopSettingsModal.tsx` (preference forms follow D3 rejection behavior; simulated multi-channel dispatch claims removed); web unit tests in `apps/web/src/tests/`; Playwright E2E in `apps/web/e2e/` including keyboard/a11y flows and deep-link recovery; screenshots for every changed user-visible state. Slice B acceptance rows: TEST-COM-09-02, 03, 06, 07, 12, 15 at component/browser level.

Slice A must pass its acceptance rows before Slice B starts. Implementation PR evidence covers all 16 AC rows with per-slice results.

## Allowed paths (frozen)

Frozen by D1–D6 for the implementation phase. Any required wider path needs an explicit source-backed scope revision first (see Author boundary).

- API: `apps/api/src/notifications/` (new module, incl. spec files); `apps/api/src/app.module.ts`; `apps/api/src/users/me.controller.ts`, `me.dto.ts`, `me.service.ts` (D3 rejection and preference compatibility only); `apps/api/src/outbox/outbox.service.ts` (accept `NOTIFICATION_EVENT`); live producer emission in `apps/api/src/invitations/invitations.service.ts` and `apps/api/src/auth/auth.service.ts` on existing identity/security change paths (event emission only, no behavior change), with their existing spec files.
- Worker: `apps/worker/src/notifications/` (new module, incl. spec files); `apps/worker/src/app.module.ts`; `apps/worker/src/dispatcher/outbox.dispatcher.ts`; `apps/worker/src/queue/smoke.worker.ts` is regression-only (no changes expected).
- Web: `apps/web/src/app/settings/notifications/page.tsx` (SCR-COM-09); `apps/web/src/components/notifications/` (new); `apps/web/src/components/ProfileSettingsTab.tsx`, `NotificationMatrixTab.tsx`, `SettingsWorkspace.tsx`, `ShopSettingsModal.tsx` (only where D2/D3 integration requires); `apps/web/src/tests/` (new web unit specs); `apps/web/e2e/` (new center E2E specs).
- Persistence/contracts/config: `prisma/schema.prisma`; exactly one new migration directory under `prisma/migrations/`; `docs/product-spec/contracts/openapi.yaml`; `packages/contracts/src/` (notification DTOs, the 14 event contracts, `NOTIFICATION_EVENT` constant); `packages/config/src/` (validated delivery configuration).
- Tests/evidence: `packages/testkit/src/` synthetic notification fixtures; focused suites registered in the owning package scripts so root gates execute them; `docs/product-spec/work-items/FEAT-COM-09.md` (evidence), the FEAT-COM-09 register row, `docs/product-spec/docs/00-control/TRACEABILITY.md` (FEAT-COM-09 row); UI screenshots attached to the PR.
- Prohibited: authentication semantics changes beyond D1 event emission, unrelated RBAC grants, unrelated UI, dependency versions, controller/toolchain code, global CI commands, and any modification of gate configs (`.gitleaks*`, allowlists, baselines, validators).

## Business rules and edge cases

The following table reproduces [Notification matrix](../docs/02-business/NOTIFICATIONS-REPORTS.md#notification-matrix); the event contract ids `EVT-COM-09-01`…`EVT-COM-09-14` follow this table's order (D6). Scheduling/grouping algorithms are governed configuration per D5, not new constants.

| Event | Default audience | Severity | Channel | Dedupe/escalation |
|---|---|---|---|---|
| Invite/identity/security change | Affected user/owner | High | In-app + email | Never suppress security notice |
| Carrier token invalid/expiring | Owner/ops | High | In-app + email | Escalate until fixed |
| Serviceability all unavailable | Order operator | Medium | In-app | One per order/input version |
| Carrier API outage/timeout | Ops | Medium | In-app | Group by carrier incident |
| Create outcome unknown | Operator/manager | Critical | In-app + email | Remains open until reconciled |
| Pickup overdue | Ops/warehouse | High | In-app | Escalate by age |
| Delivery exception | CS/ops | High | In-app | Group by shipment/exception |
| Return expected/overdue | Warehouse/ops | Medium | In-app | Daily digest plus critical aging |
| Import blocked | Finance/operator | High | In-app | One per import revision |
| Manual match required | Finance/operator | Medium | In-app | Queue count digest |
| Audit finding created | Finance | Medium | In-app | Group by audit run |
| Bank short/over | Finance/owner | High | In-app + email | Remains until resolved |
| Claim deadline approaching | Finance/owner | Critical | In-app + email | Multi-level reminders |
| Claim accepted but unpaid | Finance | High | In-app | Aging escalation |

Noncritical channels/digests are configurable; security, unknown create and critical claim deadlines cannot be fully disabled. The actual channel enforcement follows the approved D3 decision. Duplicate transport delivery must not erase a distinct security notice; the exact identity/grouping contract is D5/D6.

BR-AVL-02: unavailable-by-serviceability and API timeout must not share unsupported wording. BR-IDEM-02/DEC-005: unknown-create notices lead to reconciliation, never blind create retry. DEC-014/015: notification wording preserves processing/finding and monetary evidence distinctions, including accepted-but-unpaid. Reading a notice cannot be treated as proof that its domain incident was reconciled or money received.

## UI states

The feature screen and interaction contract is fixed by D2 (SCR-COM-09 at `/settings/notifications`; per-recipient server-side read state; explicit read mutations; cursor pagination; permission-free deep links). The states below are the required shared-contract states with D2 feature behavior.

| State | Required observable behavior/evidence |
|---|---|
| Loading | Accessible skeleton/progress while fetching authoritative notices/count; no invented unread count or sample notices. Capture component and browser evidence. |
| Empty | Explain that the authorized result set contains no notices; distinguish an empty result from load failure. Filtered-empty recovery depends on approved filters. |
| Validation | Canonical field/global errors for approved inputs; retain safe values and allow correction. Inputs are exactly the D2 list filters and cursor; no other client inputs exist. |
| Error | Recoverable API error with safe correlation context and retry guidance; no success toast or clearing unread state on failed mutation. |
| Unauthenticated/forbidden | Existing session-expiry/MFA rules; no notification text/count from denied scopes. Show actionable login/access recovery without exposing another recipient's data. |
| Not found | Deleted/inaccessible link destination yields shared not-found/forbidden recovery, without resource metadata leakage. Destination authorization remains authoritative. |
| Partial | Successful in-app persistence must not imply successful email delivery; failures remain observable and recoverable. Per D2/D5, per-channel delivery status is not an end-user control; failed/unknown email dispatches stay observable in worker evidence and admin Job/queue observability. |
| Success | Display real returned notices with text/icon severity and approved unread representation; acknowledge only committed read/delivery outcomes. Authorized deep links reach their actual destination. |
| Recovery | Retry recoverable reads; re-fetch after conflict, reconnect or session restoration; safe tenant switching without old-tenant cached content. Read-count convergence and mutation replay follow D2/D6 (server-side per-recipient state, idempotent read mutations). |
| Accessibility/responsive | Keyboard/focus, text labels beyond color, async announcements, WCAG AA and mobile/tablet access to the primary action; verify screenshots and browser keyboard flow. |

## API, event and data impact

- **Existing API to preserve:** GET/PATCH `/api/v1/me` and `/api/v1/me/preferences`; OpenAPI paths `/me` and `/me/preferences`. Existing preference keys are email/in_app/push, digest_window_minutes, delivery_fail, rate_discrepancy, cod_overdue, claim_deadline_warning, abnormal_return, security_alerts and create_unknown. Preserve consumers or provide an approved compatible migration. A push preference does not prove a push transport exists.
- **New queries/commands (frozen by D6):** `GET /api/v1/notifications` (cursor pagination, config-capped limit, `unread_only`/`severity`/`status` filters, severity-rank-then-`created_at` ordering), `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/{id}/read` (idempotent) and `POST /api/v1/notifications/read-all`. OpenAPI schemas and generated `packages/contracts` DTOs are part of the implementation PR. No public endpoint for arbitrary client event/recipient creation is authorized or may be added.
- **Errors (frozen by D6):** existing canonical envelope with safe correlation ID. `400 VALIDATION_ERROR` for invalid params and wrong DTO types (never `500`); existing canonical `401` session codes; `404 NOT_FOUND` identical for absent, other-tenant, deleted or retention-processed rows (prevents notification existence enumeration); `403 FORBIDDEN` for scope denial without data; `CONFLICT` reserved for a true version/state conflict if one arises in implementation review.
- **Data (frozen by D6):** `Notification` and `NotificationChannelDelivery` models with the exact fields, unique constraints and indexes in D6; tenant key is the existing `merchant_id` (no second tenant system); content is the safe snapshot defined by D4; `retention_until` is policy-driven per `DATA-LIFECYCLE-IMPORTS.md` plus governed configuration.
- **Events/jobs (frozen by D1/D5/D6):** local domain state and the outgoing `NOTIFICATION_EVENT` outbox row commit atomically; the worker consumer is added in the same change, so no event is injected into the dispatcher without a matching consumer; handlers tolerate at-least-once delivery; producer outbox idempotency keys use the tenant-scoped `com09:<merchant_id>:<event_type>:<source_fingerprint>` format; recipient authorization, grouping keys and resolution signals follow D4/D5. The smoke worker and smoke behavior are preserved with regression evidence. Independent channel failure must not lose committed notices or regenerate domain side effects.
- **Email (frozen by D3/D5):** per-channel delivery states `PENDING`, `IN_FLIGHT`, `SENT`, `FAILED`, `UNKNOWN`, `SKIPPED_NO_VERIFIED_EMAIL`, `NOT_CONFIGURED`, `DEAD_LETTER`; `UNKNOWN` is reconciled with the provider before any retry; no blind retry that can double-send (DEC-005); retry bounds are validated `packages/config` values, never hard-coded; dead-letter plus audited operator manual redelivery; missing provider configuration yields truthful `NOT_CONFIGURED`, never simulated success; deterministic fake transport is test-only fixture evidence; reuse of `default-verification-adapter.ts` as notification email evidence is prohibited.
- **Migrations/compatibility (frozen by D3/D6):** one forward migration adding both models plus the in-place backfill forcing the three protected subscription keys to `true` on existing `User.notification_preferences` rows; no historical event backfill; reproducible database tests; forward-recoverable. Do not reset production data or rewrite audit history. Retention values and delivery caps are governed configuration.
- **Tenant/RBAC/audit (frozen by D4):** identity derives from the current server session; tenant and recipient scope is enforced server-side for listing, counts, read mutations, delivery and links; client user/tenant/scope values are never authority; every query re-evaluates current session/permission state (revoked/expired access yields `401`/`403` without content or count leakage); tenant-granted support access is bounded by purpose/expiry within its store/warehouse scope; no platform-admin bypass; `SYSTEM_ADMIN` has no default access. Immutable security/business audit records the D4 action set with safe actor/resource/time/correlation/outcome; never tokens, full recipient PII or mail credentials in logs, snapshots or error responses.

## Acceptance matrix

All rows are **NOT RUN — to be executed during implementation** (Slice A then Slice B). G1–G6 are resolved as D1–D6, so no row is blocked by a missing decision; each row cites the decision(s) governing it. These IDs reserve test traceability; they do not assert existing executable tests, which the implementation author registers in the owning package scripts (D6).

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-COM-09-01 / TEST-COM-09-01 | For each of 14 matrix events, generate an approved valid domain event | Audience/severity/default channels match the source table; the D1 live producer (invite/identity/security change) is connected end-to-end; fixture events are labelled fixture evidence | Table-driven rules tests plus real producer→DB→worker integration; label fixtures separately |
| AC-COM-09-02 / TEST-COM-09-02 | Receive security/unknown-create/deadline events with both optional channels disabled or email unavailable | Mandatory notices remain effective under D3 (in-app guaranteed; protected write rejection; truthful `SKIPPED_NO_VERIFIED_EMAIL`); no silent suppression or fake email success | Preference/dispatcher integration with missing/unverified email and channel-off cases |
| AC-COM-09-03 / TEST-COM-09-03 | Customize a noncritical channel/digest and reload/restart | Persisted preference affects actual approved delivery behavior without changing protected subscriptions | Existing profile regression plus API/worker/browser flow; D3/D5 |
| AC-COM-09-04 / TEST-COM-09-04 | Concurrent duplicate event dispatch and worker restart after commit | D5/D6 event-recipient/channel dedupe holds (`com09:` idempotency keys plus the notification unique constraint); distinct security events survive; incident/input-version/revision groups match policy | Database concurrency and crash/replay tests; D5/D6 |
| AC-COM-09-05 / TEST-COM-09-05 | Same order changes input version or an import advances revision | No suppression across distinct source versions where the matrix requires one per version/revision | Parameterized grouping integration with the D5/D6 keys |
| AC-COM-09-06 / TEST-COM-09-06 | Load unread notices, perform approved read action concurrently on two clients, reload | Read state/count converge durably per D2 (server-side per-recipient state, idempotent read mutations); no client-only mutation and no incident auto-resolution | DB/API concurrency tests and browser reload test; D2/D6 |
| AC-COM-09-07 / TEST-COM-09-07 | Follow a notice to an authorized, removed or newly forbidden resource | Correct D2 destination or safe shared not-found/forbidden recovery; link carries no permission | Browser deep-link tests and destination API tests; D2/D4 |
| AC-COM-09-08 / TEST-COM-09-08 | Change tenant/user/resource identifiers in list/count/read/delivery contexts | No cross-tenant/recipient/branch/warehouse/account disclosure or mutation; custom roles and revoked scopes follow D4 | Negative API and worker integration across two tenants/two recipients and scope boundaries; E2E-10 |
| AC-COM-09-09 / TEST-COM-09-09 | Use revoked/expired/setup-only session or expired support grant | Access denied without content/count leakage; no notification MFA allowlist expansion | Session/RBAC integration and browser recovery; D4 |
| AC-COM-09-10 / TEST-COM-09-10 | Email provider missing, times out, rejects or becomes unavailable after in-app commit | Durable in-app result preserved; no false delivery success; D5 `UNKNOWN` reconcile-before-retry, retry bounds and dead-letter recovery observable | Controlled transport integration, crash recovery and redacted logs; real transport evidence distinct from test mock; D5 |
| AC-COM-09-11 / TEST-COM-09-11 | Advance configured clock through digest/escalation and domain resolution | D5 governed schedules and recipient timezone observed; repeated security notices not suppressed; read action alone does not reconcile incidents | Fake-clock unit plus scheduler/DB integration, configuration-boundary and resolution tests; D2/D5 |
| AC-COM-09-12 / TEST-COM-09-12 | Render each UI state listed above on desktop/mobile and operate by keyboard | All shared UI requirements met with authoritative data and recovery per D2 | Component assertions plus real browser E2E/screenshots, accessibility checks; D2 |
| AC-COM-09-13 / TEST-COM-09-13 | Security event and failed authorization traverse audit/log paths | Required immutable safe audit under D4; correlation preserved; no secrets/unnecessary PII | DB audit assertions, log/error/snapshot redaction tests and secret scan |
| AC-COM-09-14 / TEST-COM-09-14 | Migrate existing profile/queue data, run new notification path and existing consumers | D3/D6 migration and protected-preference backfill succeed; preference schemas and smoke dispatch regressions pass | Migration/API schema-consumer tests and smoke/API/web regressions; D6 |
| AC-COM-09-15 / TEST-COM-09-15 | Render unavailable route, API timeout, unknown create, accepted-unpaid and bank findings | Source-specific reasons/evidence preserved; no blind external command or false receipt claim | Rules/content tests and authorized browser links; BR-AVL-02, BR-IDEM-02, DEC-014/015 |
| AC-COM-09-16 / TEST-COM-09-16 | Apply configured eligible retention/deletion and attempt cross-tenant cleanup | D6 retention records removed/anonymized without breaking required audit/history or tenant isolation | Database lifecycle tests and operational recovery evidence; D6 |

Fixtures must use synthetic identifiers, separate tenants and recipients, allowed/denied/currently revoked roles/scopes, duplicate/distinct events, all channel preference combinations, unavailable email, deterministic clocks, and controlled transport failures. No real shop contact details, tokens, contracts or bank data may be committed.

## Verification commands

For this planning change: run `python docs/product-spec/scripts/validate_docs.py`, `git diff --check`, and the no-hardcode guard below. Check that only this Work Item and the single register row changed, links/headings resolve and no template placeholders remain. Application tests are not claimed for a documentation-only plan.

Planning verification on 2026-10-30: documentation validator PASS (225 Markdown files, 130 feature IDs, 263 delivery rows); `git diff --check` PASS; no-hardcode guard PASS with 0 files in its controller-only diff scope (not a notification implementation check). A focused structural check passed for 34 source-link file targets, absence of template tokens, exactly one changed CSV row and consistent BLOCKED/GEMINI assignment. Existing untracked `.serena/.gitignore` was present before planning and remains untouched. Application tests, runtime email delivery and remote CI were not run.

Planning finalisation verification on 2026-10-31: documentation validator PASS (225 Markdown files, 130 feature IDs, 263 delivery rows, 1640 unique identifiers); no-hardcode guard PASS (0 files in its documentation-only diff scope, baseline 345); `prettier --check` PASS on all three changed documents; `git diff --check` PASS. Structural check: exactly one register row changed (row 28: `BLOCKED` → `READY_FOR_AUTHOR`, branch and work-item path preserved); decision entry `HUMAN-DECISION-FEAT-COM-09-2026-10-31` present in `BASELINE-AND-DECISIONS.md`; D1–D6 each record the gap context, the approved decision and the Operator approval 2026-10-31 citation; no template tokens remain. Application tests, runtime email delivery and remote CI were not run (documentation-only change).

For implementation after unblocking, use Node 24 and repository-pinned pnpm 11 from a clean isolated checkout with documented test configuration. Run the production-install regression in a separate clean checkout before the development install. Do not read/print credential files or reset a shared/live database.

```text
pnpm install --prod --frozen-lockfile
pnpm install --frozen-lockfile
pnpm db:generate
pnpm infra:up
pnpm infra:wait
pnpm db:migrate
pnpm db:seed
pnpm lint
pnpm format:check
pnpm typecheck
pnpm contract:check
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:baseline
pnpm test:brain
pnpm test:a11y
pnpm test:visual
pnpm test:perf
pnpm security:secrets
node scripts/ai/check-no-hardcode.mjs
pnpm build
python docs/product-spec/scripts/validate_docs.py
git diff --check
```

Register new focused suites in the matching package scripts so the root gates execute them. Attach exact command results, baseline/author SHA, AC-to-test mapping, migration evidence, UI screenshots, redacted worker recovery evidence, and email evidence level to one implementation PR titled `[FEAT-COM-09] Shop users receive actionable, scoped notifications`. Do not count static markup, mocked API replies or transport fixtures as proof of connected production behavior. CI and fresh exact-SHA Codex review remain separate gates.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| Planning readiness, 2026-10-30 | Inspected baseline `b52f3af7c579be6e5fbbfcd339a4e54d8d0c4d48`; planning changes uncommitted | BLOCKED (readiness assessment, not independent code review) | G1–G6 remain open; no author implementation or review performed |
| Planning finalisation, 2026-10-31 | This PR (documentation only, on `feat/feat-com-09`) | PENDING — independent Codex review of the finalised Work Item required before `IN_PROGRESS` | G1–G6 recorded as D1–D6 per Operator approval 2026-10-31; Status set to READY_FOR_AUTHOR |

## Residual limitations

- G1–G6 are resolved as D1–D6 (Operator approval 2026-10-31, versioned in `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`). Residual bounded work: the 13 fixture-only producer categories of D1 each need a future producer Work Item to become live, and the proposed D5 delivery-configuration default values are submitted in the implementation PR for operator review as configuration data.
- The register schema has no assigned-author column. Assigned author is GEMINI in this Work Item, the existing routing source; do not add a global CSV column or alter unrelated rows. Its branch/path/status fields identify this blocked handoff.
- The prototype notification controls and default verification adapter conflicts remain recorded. D3/D5 prohibit reusing the simulated adapter for notification email and require the settings-tab compatibility changes in the frozen paths; the underlying authentication adapter conflict stays with the authentication owner and is not fixed by this Work Item. No permission to silently fix unrelated authentication behavior is granted.
- Planning and finalisation baseline verification are local only; remote freshness, production transport availability and runtime test success were not established. The author must re-check the current merged baseline and gates before implementation.

## Start handoff

Status is READY_FOR_AUTHOR with G1–G6 recorded as D1–D6 (Operator approval 2026-10-31). Use `docs/product-spec/docs/10-ai-collaboration/GEMINI-START-PROMPT.md` for Work Item FEAT-COM-09, branch `feat/feat-com-09`, dedicated path `docs/product-spec/work-items/FEAT-COM-09.md`, assigned author GEMINI. Revalidate the exact branch/base and the frozen allowed-file list before editing, and implement Slice A before Slice B. Planning and later independent review must remain separate tasks.
