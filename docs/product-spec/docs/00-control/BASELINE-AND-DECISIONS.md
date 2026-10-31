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
| HUMAN-DECISION-COM07-ACTIVITY-TIMELINE-2026-10-31 | DECIDED | Activity timeline scope, access control, API contract, and correlation data model approved (G1–G4). Host screen delivery boundary is strictly bounded to Shop, Branch, and Warehouse management screens, with domain screen integrations (SCR-SHIP-01, SCR-EXC-01, SCR-CASE-01) explicitly deferred to vertical Work Items (G1). Access is governed by exhaustive entity-to-capability mappings across 8 entities (SHOP, BRANCH, WAREHOUSE, USER, ORDER, SHIPMENT, EXCEPTION_CASE, CLAIM) and resource scopes with explicit Disjunctive OR logic for multi-resource entities (branch match + warehouse mismatch = granted) (G2). Two-tier entity resolution via retained historical audit tombstones enables query of physically deleted entities with verified terminal snapshot or authoritative historical scope record resolved from new_value on mutations (failing closed with 403 FORBIDDEN when scope is unavailable, correctly resolving reassignment-before-deletion, never falling back to a superseded scope across an unresolved scope transition such as a reassignment with missing new_value, and failing closed on conflicting same-timestamp scope ties under deterministic created_at DESC, id DESC ordering because AuditLog.id is a random UUID with no write-order proof) and real delete-then-query verification (G2). GET /api/v1/activity OpenAPI schema defined with ActivityTimelineItem and status enum (SUCCESS, FAILED) (G3). Additive correlation_id, legacy correlation parsing, action-based lifecycle classification strictly excluding cancellation state transitions from deletion, and partial update snapshot handling with is_partial: true distinguishing unavailable telemetry from known-absent states approved (G4). | Date: 2026-10-31. Owner: operator. Resolves blocking gaps G1–G4 and review findings, unblocking FEAT-COM-07 from BLOCKED to READY_FOR_AUTHOR. Work is structured into Slice A (API & data persistence) and Slice B (UI shared timeline component & screens). Author: GEMINI. Full specification and acceptance matrix recorded in [FEAT-COM-07](../../work-items/FEAT-COM-07.md). |
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

