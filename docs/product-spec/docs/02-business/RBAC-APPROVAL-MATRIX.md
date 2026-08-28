# RBAC and Approval Matrix

Legend: A = full action, V = view, S = scoped/configurable, – = denied.

| Capability               | Owner | Ops manager | Order operator |  CS | Warehouse | Finance | Rate author | Rate reviewer | Ship Dễ operator |
| ------------------------ | ----: | ----------: | -------------: | --: | --------: | ------: | ----------: | ------------: | ---------------: |
| Shop configuration       |     A |           S |              – |   – |         – |       V |           – |             – |                S |
| Manage users/roles       |     A |           S |              – |   – |         – |       – |           – |             – |                S |
| Connect observe token    |     A |           S |              – |   – |         – |       – |           – |             – |                S |
| Grant action permission  |     A |           S |              – |   – |         – |       – |           – |             – |                – |
| View/create source order |     A |           A |              A |   V |         S |       V |           – |             – |                S |
| Quote/select carrier     |     A |           A |              A |   V |         – |       V |           – |             – |                S |
| Create/update shipment   |     A |           A |              A |   S |         – |       – |           – |             – |                S |
| Cancel/redeliver         |     A |           A |              S |   S |         – |       – |           – |             – |                S |
| Print/hand over          |     A |           A |              A |   – |         A |       – |           – |             – |                S |
| Track/view exceptions    |     A |           A |              A |   A |         S |       V |           – |             – |                S |
| Receive return/evidence  |     A |           A |              – |   – |         A |       V |           – |             – |                S |
| View contract rates      |     A |           V |              – |   – |         – |       A |           A |             A |                S |
| Author rate/policy       |     S |           – |              – |   – |         – |       S |           A |             – |                S |
| Approve rate/policy      |     A |           – |              – |   – |         – |       S |           – |             A |                S |
| Import settlement/bank   |     A |           – |              – |   – |         – |       A |           – |             – |                S |
| Run/review audit         |     A |           V |              – |   – |         – |       A |           – |             – |                S |
| Allocate bank receipt    |     A |           – |              – |   – |         – |       A |           – |             – |                S |
| Verify/submit claim      |     A |           S |              – |   – |         – |       A |           – |             – |                S |
| Export PII/finance       |     A |           – |              – |   – |         – |       S |           – |             – |       Time-bound |
| View immutable audit log |     A |           S |              – |   – |         – |       S |           – |             – |       Time-bound |

## Approval rules

| Action                                        | Required approval                                                     |
| --------------------------------------------- | --------------------------------------------------------------------- |
| Approve rate/settlement/claim policy          | Reviewer different from author                                        |
| Grant carrier action permission               | Owner or explicitly delegated manager                                 |
| Cancel after pickup                           | Normally prohibited; approved exception procedure if carrier supports |
| Enable auto-routing                           | Owner/ops manager                                                     |
| Enable automatic claim submission             | Owner plus finance; claim type and amount limit                       |
| Reopen a closed settlement period             | Finance approver plus reason                                          |
| Bank allocation correction after confirmation | Finance approver plus audit                                           |
| Delete/export large PII dataset               | Owner/authorized data administrator                                   |
| Temporary Ship Dễ support access              | Shop consent, scoped purpose and expiry                               |

## Enforcement

- Backend is authoritative; hidden UI controls are insufficient.
- A user cannot grant a permission they do not hold.
- Permission evaluation includes tenant, branch, warehouse and carrier-account scope.
- Sensitive export/action checks require a fresh session or step-up authentication when configured.
