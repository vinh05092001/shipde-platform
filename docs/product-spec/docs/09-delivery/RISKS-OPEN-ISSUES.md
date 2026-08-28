# Risks and Open Issues

## Current open issues

| ID     | Issue                                                            | Status                      | Required action                                          |
| ------ | ---------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| OI-001 | Viettel Post current partner API contract not publicly verified  | Confirmation required       | Obtain official partner docs/sandbox                     |
| OI-002 | J&T Vietnam current partner API contract not publicly verified   | Confirmation required       | Obtain official Vietnam partner docs/sandbox             |
| OI-003 | Pancake API scopes/endpoints not included in current source pack | Confirmation required       | Obtain official/partner contract                         |
| OI-004 | Exact claim deadlines by category/carrier may change             | Legal/business verification | Source effective policies before enabling automation     |
| OI-005 | Automatic claim submission support varies by carrier             | Conditional                 | Confirm capability and shop authorization                |
| OI-006 | Full-product KPI target values are not numerically set           | Product decision            | Set before pilot                                         |
| OI-007 | Final production pricing after pilot                             | Product decision            | Validate usage/WTP; initial per-audited-waybill retained |
| OI-008 | RPO/RTO and capacity targets need cost approval                  | Technical/product decision  | Benchmark prototype and approve                          |

## Major risks

| Risk                            | Impact                    | Mitigation                                                  |
| ------------------------------- | ------------------------- | ----------------------------------------------------------- |
| AI invents carrier API          | Broken/unsafe integration | Capability evidence, adapter stubs, contract tests          |
| Duplicate external command      | Duplicate shipment/claim  | Persistent idempotency and reconciliation                   |
| Wrong address mapping           | Wrong route/price         | Versioned mapping and user confirmation                     |
| Quote differs from final charge | Trust loss                | Store quote + contract + statement evidence layers          |
| False audit positive            | Trust loss                | Approved rule, conservative result and golden tests         |
| Credential trust barrier        | Adoption                  | File/read-only first, least privilege and transparent audit |
| Multi-carrier maintenance       | Ongoing outages           | Isolation, capability registry, observability and fallback  |
| PII/financial leak              | Severe                    | Tenant isolation, masking, private storage and access audit |
| One-shot AI code dump           | Inconsistent product      | Vertical slices, DoD and regression gates                   |

## Resolution rule

No open issue may be silently replaced by an implementation assumption. High-impact items block production capability, not the whole codebase: build the interface, mock and fallback while the capability remains disabled.
