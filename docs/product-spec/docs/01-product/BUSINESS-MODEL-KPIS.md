# Business Model and KPI Catalog

## Initial pricing

- Pilot and initial production billing is based on reconciled waybills.
- A waybill becomes billable once, at its first conclusive audit result.
- Uniqueness key: tenant + carrier account + waybill.
- Reruns, corrected imports, carry-forward and claim follow-up do not rebill.
- No percentage-of-recovery fee.
- Shipping operations are included in the initial package to minimize customer friction; packaging can be revisited after usage data.

## Product KPIs

| Area | KPI |
|---|---|
| Onboarding | Time to first connected account; time to first successful shipment |
| Quote | Carrier response coverage; quote latency; no-option rate |
| Shipment | Creation success; unknown-outcome rate; duplicate waybills |
| Tracking | Event freshness; unmapped status rate |
| Exception | Time to acknowledge; rescue success; prevented returns |
| Return | Scan completeness; duplicate receipt prevented; evidence completeness |
| Audit | Auditable coverage; auto-match rate; false-positive rate |
| Money | Suspected, internally verified, carrier accepted and received values, separately |
| Claim | Cases submitted before deadline; carrier acceptance; recovery aging |
| Reliability | Connector availability by carrier; job failure/retry rate |
| User value | Manual hours saved; active users; willingness to pay |

## Release gates

- Duplicate shipment count must be zero in deterministic tests.
- No high-severity cross-tenant or authorization issue.
- No financial result without reproducible evidence.
- Carrier production capability must be partner-confirmed.
- Business KPI target values must be set before a pilot, not after.

