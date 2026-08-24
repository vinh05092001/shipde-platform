# AI Coding Guardrails

## Mandatory behavior

The coding agent must:

1. Read README and documents in stated order.
2. Cite requirement IDs in code comments only where they clarify non-obvious rules; keep traceability in tests/PR descriptions.
3. Implement vertical slices including UI, API, database, permission, errors, audit and tests.
4. Run lint, typecheck, tests and build before declaring a slice complete.
5. Use migrations and seed fixtures; never rely on manual database edits.
6. Preserve all existing passing behavior while extending later slices.
7. Record discovered specification conflicts; do not invent a silent resolution.

## Prohibited behavior

- Do not remove a feature because it appears complex.
- Do not leave a primary action button unconnected.
- Do not hardcode user, shop, token, rate, status, fee or production carrier response.
- Do not reuse APIs from another J&T country for J&T Vietnam.
- Do not treat third-party Viettel/J&T information as official partner contract.
- Do not call carrier APIs outside adapters.
- Do not retry create/cancel/redelivery/claim blindly.
- Do not use float for VND.
- Do not merge processing status and findings.
- Do not call suspected/verified/accepted money “received” without bank evidence.
- Do not permit cross-tenant identifiers supplied by the client to bypass scope.
- Do not store credentials or PII in logs.
- Do not mark TODO as done; register it as explicit backlog/known limitation.

## Slice completion response

For each slice, the agent reports:

- Requirements implemented.
- Files/migrations created or changed.
- Endpoints/screens/jobs added.
- Tests and commands run with results.
- Assumptions/decisions.
- Known limitations/blockers.
- Regression impact.

## Review checkpoints

Stop for human review before:

- Schema change that invalidates prior data.
- Authentication/tenant model change.
- External command or automatic claim behavior.
- Financial formula/rate policy change.
- Data retention/delete behavior.
- Production carrier credential use.

