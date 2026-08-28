# Internal API Contract

The authoritative machine contract is contracts/openapi.yaml. This document defines resource semantics and command rules.

## API conventions

- Base path: /api/v1.
- JSON UTF-8; timestamps ISO-8601 UTC; money integer VND.
- Bearer session/access token; tenant derived from authorized membership, never trusted from arbitrary client scope.
- Cursor or page pagination consistently per endpoint family.
- Every external-effect command requires Idempotency-Key and returns correlation_id.
- Errors use canonical error envelope.
- ETag/version field is used for optimistic concurrency on editable aggregates.

## Resource groups

| Prefix                       | Purpose                                                 |
| ---------------------------- | ------------------------------------------------------- |
| /auth                        | Register, verify, login, MFA, refresh, logout, recovery |
| /me                          | Profile, sessions, memberships, preferences             |
| /shops                       | Shop, branches and warehouses                           |
| /users, /roles               | Invitations, users, roles and scopes                    |
| /carrier-accounts            | Connection, capability and health                       |
| /orders                      | Source orders, items and parcels                        |
| /shipping-options            | Serviceability, quotes and recommendations              |
| /shipments                   | Create/update/cancel, labels and pickup                 |
| /tracking                    | Timeline/current state and recipient-safe view          |
| /exceptions                  | Workbox, assignment and recovery actions                |
| /returns                     | Expected returns, scan and evidence                     |
| /rates, /policies            | Versions, rules, simulator and approval                 |
| /imports                     | Upload, validation, staging and promotion               |
| /audit-periods, /audit-runs  | Settlement audit lifecycle                              |
| /batches, /bank-transactions | Batch status and allocations                            |
| /cases, /claims              | Discrepancy workflow and submissions                    |
| /reports                     | Role-scoped summaries/exports                           |
| /billing                     | Usage ledger and statements                             |
| /admin                       | Mapping, jobs, queues and immutable audit               |

## Command response

Successful asynchronous command:

\`\`\`json
{
"data": {
"command_id": "uuid",
"status": "PENDING",
"resource_id": "uuid"
},
"meta": {
"correlation_id": "string"
}
}
\`\`\`

Unknown carrier outcome is a valid command state, not an HTTP success/failure guess:

\`\`\`json
{
"data": {
"command_id": "uuid",
"status": "OUTCOME_UNKNOWN",
"next_action": "REMOTE_RECONCILIATION"
},
"meta": {
"correlation_id": "string"
}
}
\`\`\`

## Error envelope

\`\`\`json
{
"error": {
"code": "CARRIER_TIMEOUT",
"message": "Chưa xác định hãng đã tạo vận đơn hay chưa.",
"retryable": false,
"next_action": "WAIT_FOR_RECONCILIATION",
"fields": []
},
"meta": {
"correlation_id": "string"
}
}
\`\`\`

Provider error text is stored in sanitized integration logs, not exposed raw when it contains sensitive or confusing data.
