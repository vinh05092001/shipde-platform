# Baseline and Decisions

## Baseline statement

This repository supersedes the earlier PoV-only Dev Pack. The current baseline is the full Ship Dễ product. A file-first, single-shop settlement audit remains a valid validation slice, not the product boundary.

## Decision statuses

- DECIDED: implementation may proceed.
- CONDITIONAL: implementation proceeds behind capability/configuration checks.
- CONFIRMATION_REQUIRED: adapter/stub may be built, but production behavior requires partner evidence.
- PROHIBITED: implementation must reject the behavior.

## Product decisions

| ID | Status | Decision | Consequence |
|---|---|---|---|
| DEC-001 | DECIDED | Ship Dễ covers before, during and after shipment. | Pre-shipment and operational modules are CORE. |
| DEC-002 | DECIDED | Shops use their own carrier accounts/contracts by default. | Quotes and actions are account-scoped. |
| DEC-003 | DECIDED | Carrier serviceability API decides route availability when supported. | API failure is UNKNOWN, not UNSUPPORTED. |
| DEC-004 | DECIDED | Live quote, contract rate and settlement deduction are three evidence layers. | Store quote snapshot and rate version. |
| DEC-005 | DECIDED | No automatic blind retry for create/cancel/redelivery/claim commands. | Reconcile remote state first. |
| DEC-006 | DECIDED | Human selection and configurable auto-routing are both supported. | Recommendations remain explainable and overridable. |
| DEC-007 | DECIDED | Recipient experience is channel-neutral, web/PWA first. | Native app can reuse the same API later. |
| DEC-008 | CONDITIONAL | Claim submission can be manual-confirmed or policy-authorized automatic. | High-confidence rules, limits and audit are mandatory. |
| DEC-009 | DECIDED | Ship Dễ provides a COD ledger and bank reconciliation. | Carrier report alone cannot prove receipt. |
| DEC-010 | PROHIBITED | Ship Dễ must not directly hold/route customer COD without an approved licensed model. | Use a licensed partner integration if money movement is added. |
| DEC-011 | DECIDED | Ship Dễ may manage shop/partner warehouse and delivery workflows without owning physical assets. | Software capability is not removed by asset boundary. |
| DEC-012 | DECIDED | One waybill is billed once per carrier account at first conclusive audit. | Rerun/carry-forward/claim follow-up is not billed again. |
| DEC-013 | DECIDED | A rule author cannot approve the same rate/policy version. | Maker-checker enforcement is required. |
| DEC-014 | DECIDED | Processing status and findings are independent. | A matched waybill can carry many findings. |
| DEC-015 | DECIDED | Four monetary evidence levels are never summed together. | Separate reporting measures are mandatory. |
| DEC-016 | DECIDED | TypeScript monorepo is the default implementation stack. | Shared schemas/types and one-language handover. |
| DEC-017 | DECIDED | Concurrent implementation ceiling is fixed at one (AI-TOOL-03) as a stability measure. | Raising the ceiling requires an explicit governed decision (DEC-* or HUMAN-DECISION-*), never an unvetted runtime setting. |
| HUMAN-DECISION-CONCURRENCY-CEILING-2026-09-22 | DECIDED | The concurrent implementation ceiling rises from one to three, superseding the fixed value in DEC-017. | Operator instruction on 2026-09-22 to run feature Work Items in parallel overnight. Repairs of an open Pull Request and planning/documentation runs do not count towards the ceiling; only new implementation Work Items do. The controller must still keep one Work Item per branch and per Pull Request. |
| HUMAN-DECISION-FEAT-COM-09-2026-10-31 | DECIDED | Operator approved the six FEAT-COM-09 gap resolutions as recorded in the Work Item: D1 bounded S01 first delivery with one live producer (`EVT-COM-09-01`, invite/identity/security change) and versioned `EVT-COM-09-02`…`EVT-COM-09-14` fixture-only contracts whose future owners are `FEAT-CAR-05`, `FEAT-AVL-01`, `FEAT-CAR-07`, `FEAT-SHP-01`, `FEAT-SHP-02`, `FEAT-EXC-01`, `FEAT-RET-01`, `FEAT-IMP-02`, `FEAT-BNK-01`, `FEAT-AUD-07`, `FEAT-BNK-01`, `FEAT-CLM-01` and `FEAT-CLM-04` in that order; D2 notification center `SCR-COM-09` at `/settings/notifications` with per-recipient server-side read state, explicit idempotent read actions, cursor pagination and permission-free deep links; D3 protected events (`security_alerts`, `create_unknown`, `claim_deadline_warning`) always delivered in-app, write-time rejection of disabling them, and truthful `SKIPPED_NO_VERIFIED_EMAIL` email outcomes; D4 per-(tenant, recipient) ownership, the per-event role/capability/scope eligibility table, recipient-only inbox endpoints, no support inbox in this item, and sanitized immutable audit; D5 `provider_submission_id` captured before the provider call, `UNKNOWN` held with no automatic retry when no message id or lookup support exists, recovery delivery listing endpoint `GET /api/v1/admin/notification-deliveries` (authorized for OWNER/bound operator, returning masked email, attempt and submission id preconditions), operator outcomes limited to `MARK_SENT` or `RELEASE_FOR_RETRY` through `POST /api/v1/admin/notification-deliveries/{delivery_id}/redeliver` with `expected_attempt`, `expected_provider_submission_id`, and `idempotency_key` preconditions (stale replays reject with `409 CONFLICT`) on `SCR-COM-09-JOBS` at `/admin/jobs/notification-deliveries`, and prohibited reuse of the simulated verification adapter; D6 frozen `Notification`/`NotificationChannelDelivery` fields including source scope ids and provider ids, separation of outbox transport identity from notification grouping, resolution envelope targeting (`target_group_key`, `resolution_id`), credential incident identity (`incident_id` for `EVT-COM-09-02` in payload and active transport key `carrier_account_id:condition:incident_id` to prevent recurrence suppression across resolved incidents), recurring-window digest identities (`digest_window`, `queue_revision` for `EVT-COM-09-10`), the 14 required payload and fingerprint rows, policy-driven retention and the 16-row acceptance matrix. Owner: operator, 2026-10-31. | Work Item `docs/product-spec/work-items/FEAT-COM-09.md` is READY_FOR_AUTHOR for GEMINI (Slices A then B, one implementation PR); implementation must stay inside its frozen allowed paths and re-verify the merged baseline. The 13 fixture-only categories stay fixture-only until their named producer Work Items emit them. `FEAT-SEC-02` owns any later support read. D5 configuration defaults are reviewed as configuration data in the implementation PR. |
| HUMAN-DECISION-FEAT-SUP-01-2026-10-31 | DECIDED | Approval of contextual support request workflow, explicit consent boundary, independent state machine, RBAC capabilities, private attachments, and vertical slice architecture for [FEAT-SUP-01](../../work-items/FEAT-SUP-01.md). Date: 2026-10-31. Owner: operator. | Operator approval on 2026-10-31 resolves all planning gaps G01–G09: authenticated shop requests with typed context and clean attachment linkage (G01); dedicated UI routes `/support`, `/support/new`, `/support/:id`, operator queue (G02); independent state machine OPEN → IN_PROGRESS → WAITING_FOR_SHOP → RESOLVED (G03); granular RBAC capabilities and SHOP_OWNER consent delegation, including explicit operator read/reply permissions and platform triage queue scope separate from tenant-isolated shop access, plus native domain capability authorization (order:view_create, shipment:track_exceptions, reconciliation:run_review_audit, claim:verify_submit) for shop context data inspection (G04); private attachment upload staging lifecycle with presigned upload URLs, staging ownership, consistent null-until-commit staging linkage with validated target-ticket scope, synchronous malware scan verification with protected promotion to immutable storage (support/clean/*), cryptographic SHA-256 and S3 version ID binding, and atomic ticket/reply linkage with malware quarantine (G05); time-bound, named operator, scoped read-only consent grants with instant revocation and dedicated consented inspection path `GET /api/v1/support/requests/:id/context-data` producing immutable `SUPPORT_OPERATOR_ACCESS` audit logs with masked PII (G06); vertical slice architecture defining Slice A (API/Data/Contracts/RBAC) and Slice B (UI/E2E) aligned with COM-06 and SEC-02 boundaries (G07); tenant-scoped API contracts mapped to Merchant/merchant_id (G08); and test traceability with synthetic fixtures, deferring external notifications/SLA (G09). Work Item marked READY_FOR_AUTHOR. |
| HUMAN-DECISION-FEAT-CAR-01-2026-10-31 | DECIDED | Operator approval on 2026-10-31 (owner = operator) resolves all blocking gaps CAR-GAP-01 through CAR-GAP-07 for [FEAT-CAR-01](../../work-items/FEAT-CAR-01.md): (1) Platform-owned, versioned read-only carrier catalog with mutation UI deferred to FEAT-ADM-01, with multi-revision coexistence guaranteed via revision-scoped composite unique constraints `[catalogRevision, code]` and UUID primary keys across all reference models (`Carrier`, `CarrierService`, `CanonicalStatusReference`, `FeeComponentReference`, `CatalogCompatibilityMapping`); (2) Dedicated read-only catalog tab at `/settings/carriers` (`SCR-CAR-01`); (3) Canonical permission `iam:carrier_catalog:read` for OWNER, OPS_MANAGER, ORDER_OPERATOR, FINANCE, with platform writes reserved for admin audit; (4) Canonical carrier codes `GHN` ('Giao Hàng Nhanh'), `GHTK`, `VIETTEL_POST`, `JT` matching Prisma/contracts, with boundary alias normalization (`VTP` -> `VIETTEL_POST`, `JT_EXPRESS` -> `JT`); (5) Dedicated `/api/v1/carrier-catalog` API with 4 reference schemas (carriers, services, canonical statuses, fee components) and decoupled command vs operational shipment lifecycle; (6) Raw provider status and fee keys preserved with official carrier evidence (GHTK raw status `20` maps to canonical `RETURNING` per official GHTK documentation `https://docs.giaohangtietkiem.vn/`, GHTK raw status `13` 'Đơn hàng bồi thường' resolves to `UNMAPPED` / `null` to avoid conflating compensation with damage), unknown raw values resolve to unmapped rather than defaulting to IN_TRANSIT; (7) Initial baseline dataset with official public evidence for GHN/GHTK and confirmation-required flags for VIETTEL_POST/JT under OI-001/002. | Work Item [FEAT-CAR-01](../../work-items/FEAT-CAR-01.md) unblocked and set to `READY_FOR_AUTHOR`. Establishes the authoritative carrier taxonomy baseline for downstream account connection (FEAT-CAR-02), quoting, tracking, and settlement audit without provider code leakage. |

## Evidence levels

| Level | Meaning |
|---|---|
| VERIFIED_OFFICIAL | Current official public provider documentation observed |
| VERIFIED_PARTNER | Confirmed in partner portal/contract/sandbox by the shop or Ship Dễ |
| COMMUNITY_INDICATION | Non-official technical evidence; not production-authoritative |
| UNVERIFIED | No adequate evidence |

## Change control

Any change affecting money, state transitions, external commands, PII, billing or tenant isolation requires:

1. New decision-log entry.
2. Impacted requirement identifiers.
3. Updated API/data/test contracts.
4. Regression test.
5. Human approval before merge.

