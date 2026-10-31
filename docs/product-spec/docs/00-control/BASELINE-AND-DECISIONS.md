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
| HUMAN-DECISION-FEAT-SUP-01-2026-10-31 | DECIDED | Approval of contextual support request workflow, explicit consent boundary, independent state machine, RBAC capabilities, private attachments, and vertical slice architecture for [FEAT-SUP-01](../../work-items/FEAT-SUP-01.md). Date: 2026-10-31. Owner: operator. | Operator approval on 2026-10-31 resolves all planning gaps G01–G09: authenticated shop requests with typed context (G01); dedicated UI routes `/support`, `/support/new`, `/support/:id`, operator queue (G02); independent state machine OPEN → IN_PROGRESS → WAITING_FOR_SHOP → RESOLVED (G03); granular RBAC capabilities and SHOP_OWNER consent delegation (G04); private attachment contract with scan verification and presigned URLs (G05); time-bound, named operator, scoped read-only consent grants with instant revocation (G06); vertical slice architecture defining Slice A (API/Data/Contracts/RBAC) and Slice B (UI/E2E) aligned with COM-06 and SEC-02 boundaries (G07); tenant-scoped API contracts mapped to Merchant/merchant_id (G08); and test traceability with synthetic fixtures, deferring external notifications/SLA (G09). Work Item marked READY_FOR_AUTHOR. |

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

