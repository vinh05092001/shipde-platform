# AI Vertical-Slice Build Plan

The AI builds the entire target product, but in dependency-ordered vertical slices. “Later” means execution order only, not product exclusion.

## Slice 0 — Repository and quality foundation

Deliver:

- Monorepo, apps/packages, Docker Compose.
- CI commands, lint/typecheck/test/build.
- PostgreSQL/Redis/object-store local services.
- OpenAPI/schema validation.
- Health/readiness and structured logging.

Exit: clean install and all root commands run.

## Slice 1 — Identity, tenancy and organization

Deliver:

- Register/login/verify/recovery/MFA/session.
- Tenant/shop/branch/warehouse.
- Invitations, roles/scopes and profile.
- Onboarding shell and audit events.
- Screens/API/migrations/tests.

Exit: owner creates shop/warehouse and invited operator logs in with correct scope.

## Slice 2 — Carrier accounts and adapter framework

Deliver:

- Carrier account connection, encrypted secret reference, test and health.
- Capability registry/evidence.
- Canonical adapter interface and mock server.
- GHN/GHTK initial official adapters behind environment flags.
- Viettel/J&T confirmation-required stubs/manual fallback.

Exit: capability UI accurately distinguishes supported, unsupported and unknown.

## Slice 3 — Orders, address and shipping options

Deliver:

- Manual/file source orders and parcels.
- Address normalization/mapping.
- Serviceability fan-out.
- Live quote normalization/snapshot.
- Compare/recommend/auto-routing with explanation.
- No-carrier and partial-outage UX.

Exit: AC-AVL, AC-QTE and AC-SEL journeys pass with mocks and verified sandboxes where available.

## Slice 4 — Shipment, label and pickup

Deliver:

- Create command saga/idempotency/reconciliation.
- Shipment detail, update/cancel/switch.
- Label and print flows.
- Pickup request/handover.
- OMS waybill sync adapter shell.

Exit: timeout test proves no duplicate waybill; old label invalidates on switch.

## Slice 5 — Tracking, recipient and exceptions

Deliver:

- Webhook/polling/inbox ledger and mappings.
- Timeline/current state/freshness.
- Recipient signed-link/OTP view.
- Exception detector/workbox/tasks.
- Redelivery command/manual fallback.

Exit: duplicate/out-of-order webhook tests pass and unknown status is preserved.

## Slice 6 — Returns

Deliver:

- Expected-return queue.
- Scan/duplicate check.
- Condition checklist and direct evidence.
- Chain of custody and issue case.

Exit: warehouse can complete scan-to-case flow without admin intervention.

## Slice 7 — Rate, policy and data imports

Deliver:

- Contract source/private files.
- Structured rate/settlement/claim policies.
- Maker-checker, effective versions and simulator.
- Import staging/validation/revision/lineage.

Exit: approved rate calculation reproduces golden examples and invalid imports never enter snapshot.

## Slice 8 — Audit and missing settlement

Deliver:

- Audit periods/runs/snapshots.
- Exact matching/manual queue.
- Component calculation and multiple findings.
- Six missing states and account-level threshold/carry.
- Results/explanation/dashboard.

Exit: deterministic golden audit and invariant totals pass.

## Slice 9 — Batch, bank and COD

Deliver:

- Settlement batches/control totals.
- Dual status dimensions.
- Bank import/matching/suggestion/allocation.
- COD ledger and receipt evidence.
- Period close/reopen/adjustment.

Exit: many-to-many allocations and short/over/full tests pass.

## Slice 10 — Cases and claims

Deliver:

- Case state machine, four money levels and carry-forward.
- Deadline policy/evidence checklist/package.
- Confirm-first claim submission.
- Policy-authorized auto-submit framework disabled until carrier capability confirmed.
- Response/outcome/recovery.

Exit: no expired/incomplete claim auto-submits; recovered value requires proof.

## Slice 11 — Reports, billing and administration

Deliver:

- Role dashboards/reports/export.
- Billable-event ledger and usage statement.
- Notification/escalation.
- Admin mapping, jobs, queue and support access.
- Retention/export/delete workflows.

Exit: traceability and all primary E2E tests pass.

## Slice 12 — Hardening and production readiness

- Security/performance/accessibility tests.
- Restore drill.
- Provider sandbox contract tests.
- Observability/incident runbooks.
- Remove unapproved mocks from production config.
- Human developer review and technical-debt triage.
