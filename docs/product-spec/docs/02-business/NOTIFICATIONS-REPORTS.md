# Notifications, Escalations and Reports

## Notification matrix

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

Users may configure noncritical channels and digests. Security, unknown create outcome and claim-deadline critical alerts cannot be fully disabled.

## Report catalog

| ID | Report | Core dimensions/measures |
|---|---|---|
| REP-OPS-01 | Shipment operations | Created, failed, unknown, cancelled, picked, delivered, returned |
| REP-QTE-01 | Quote comparison | Availability, response latency, total cost, selected carrier |
| REP-CAR-01 | Carrier performance | SLA, delivery success, exceptions, return, fee variance |
| REP-EXC-01 | Exception rescue | Type, age, owner, action, outcome, prevented return |
| REP-RET-01 | Return receiving | Expected, received, duplicate, damage/mismatch evidence |
| REP-DQ-01 | Data quality | Readable, valid, missing, ambiguous and stale data |
| REP-AUD-01 | Audit findings | Processing status, finding type, amount, evidence |
| REP-MIS-01 | Missing settlement | Six states and aging |
| REP-BAT-01 | Settlement batches | Carrier transfer status and bank status separately |
| REP-COD-01 | COD ledger | Expected, carrier reported and actually received |
| REP-CASE-01 | Case portfolio | State, age, deadline, owner and outcome |
| REP-MONEY-01 | Evidence-level money | Suspected, verified, accepted and received separately |
| REP-BIL-01 | Ship Dễ usage | First billable event, price version and adjustments |
| REP-SEC-01 | Access/audit | Sensitive views, exports, deletes and support access |

Every summary supports drill-down to underlying records, calculation and source lineage. Export includes generation time, filters and data/rule version.

