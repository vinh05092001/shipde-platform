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
| HUMAN-DECISION-FEAT-COM-09-2026-10-31 | DECIDED | Operator approved the six FEAT-COM-09 gap resolutions as recorded in the Work Item: D1 bounded S01 first delivery with one live producer (`EVT-COM-09-01`, invite/identity/security change) and versioned `EVT-COM-09-02`…`EVT-COM-09-14` fixture-only contracts whose future owners are `FEAT-CAR-05`, `FEAT-AVL-01`, `FEAT-CAR-07`, `FEAT-SHP-01`, `FEAT-SHP-02`, `FEAT-EXC-01`, `FEAT-RET-01`, `FEAT-IMP-02`, `FEAT-BNK-01`, `FEAT-AUD-07`, `FEAT-BNK-01`, `FEAT-CLM-01` and `FEAT-CLM-04` in that order; D2 notification center `SCR-COM-09` at `/settings/notifications` with per-recipient server-side read state, explicit idempotent read actions, cursor pagination and permission-free deep links; D3 protected events (`security_alerts`, `create_unknown`, `claim_deadline_warning`) always delivered in-app, write-time rejection of disabling them, and truthful `SKIPPED_NO_VERIFIED_EMAIL` email outcomes; D4 per-(tenant, recipient) ownership, the per-event role/capability/scope eligibility table, recipient-only inbox endpoints, no support inbox in this item, and sanitized immutable audit; D5 `provider_submission_id` captured before the provider call, `UNKNOWN` held with no automatic retry when no message id or lookup support exists, operator outcomes limited to `MARK_SENT` or `RELEASE_FOR_RETRY` through `POST /api/v1/admin/notification-deliveries/{delivery_id}/redeliver` on `SCR-COM-09-JOBS` at `/admin/jobs/notification-deliveries`, and prohibited reuse of the simulated verification adapter; D6 frozen `Notification`/`NotificationChannelDelivery` fields including source scope ids and provider ids, the common envelope with `is_resolution` plus the 14 required payload and fingerprint rows, tenant-scoped idempotency keys, policy-driven retention and the 16-row acceptance matrix. Owner: operator, 2026-10-31. | Work Item `docs/product-spec/work-items/FEAT-COM-09.md` is READY_FOR_AUTHOR for GEMINI (Slices A then B, one implementation PR); implementation must stay inside its frozen allowed paths and re-verify the merged baseline. The 13 fixture-only categories stay fixture-only until their named producer Work Items emit them. `FEAT-SEC-02` owns any later support read. D5 configuration defaults are reviewed as configuration data in the implementation PR. |

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

