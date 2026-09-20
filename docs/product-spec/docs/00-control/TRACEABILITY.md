# Traceability

## Identifier prefixes

| Prefix | Type                  |
| ------ | --------------------- |
| FEAT   | Feature               |
| UC     | Use case              |
| BR     | Business rule         |
| SCR    | Screen                |
| API    | REST endpoint         |
| EVT    | Event                 |
| ENT    | Entity                |
| ST     | State machine         |
| AC     | Acceptance criterion  |
| TEST   | Test                  |
| EPIC   | Delivery epic         |
| ADR    | Architecture decision |

## Initial traceability

| Feature      | Use case   | Rule       | Screen       | API/Job              | Entity                 | State        | Acceptance | Epic        |
| ------------ | ---------- | ---------- | ------------ | -------------------- | ---------------------- | ------------ | ---------- | ----------- |
| FEAT-AUTH    | UC-AUTH-01 | BR-SEC-01  | SCR-AUTH-01  | API-AUTH-LOGIN       | ENT-USER               | ST-USER      | AC-AUTH-01 | EPIC-FND    |
| FEAT-AUTH-01 | UC-AUTH-02 | BR-AUTH-01 | SCR-AUTH-02  | API-AUTH-REGISTER    | ENT-MERCHANT, ENT-USER | ST-USER      | AC-AUTH-02 | EPIC-FND    |
| FEAT-AUTH-02 | UC-AUTH-03 | BR-ADMIN-01| SCR-ADMIN-01 | API-ADMIN-SHOPS      | ENT-MERCHANT, ENT-USER | ST-USER, ST-MERCHANT | AC-ADMIN-01..16 | EPIC-FND |
| FEAT-USR     | UC-USR-01  | BR-RBAC-01 | SCR-USR-01   | API-USR              | ENT-USER, ENT-ROLE     | ST-INVITE    | AC-USR-01  | EPIC-FND    |
| FEAT-AVL     | UC-SHIP-01 | BR-AVL-01  | SCR-QUOTE-01 | API-AVL              | ENT-QUOTE-REQUEST      | ST-QUOTE     | AC-AVL-01  | EPIC-QUOTE  |
| FEAT-QTE     | UC-SHIP-01 | BR-QTE-01  | SCR-QUOTE-01 | API-QUOTES           | ENT-QUOTE              | ST-QUOTE     | AC-QTE-01  | EPIC-QUOTE  |
| FEAT-SEL     | UC-SHIP-02 | BR-SEL-01  | SCR-QUOTE-01 | API-RECOMMEND        | ENT-ROUTING-DECISION   | ST-QUOTE     | AC-SEL-01  | EPIC-QUOTE  |
| FEAT-SHP     | UC-SHIP-03 | BR-IDEM-01 | SCR-SHIP-01  | API-SHIPMENT-CREATE  | ENT-SHIPMENT           | ST-SHIPMENT  | AC-SHP-01  | EPIC-SHIP   |
| FEAT-LBL     | UC-SHIP-04 | BR-LBL-01  | SCR-LABEL-01 | API-LABEL            | ENT-LABEL              | ST-SHIPMENT  | AC-LBL-01  | EPIC-SHIP   |
| FEAT-TRK     | UC-TRK-01  | BR-TRK-01  | SCR-TRACK-01 | JOB-TRACK, EVT-TRACK | ENT-TRACK-EVENT        | ST-SHIPMENT  | AC-TRK-01  | EPIC-TRACK  |
| FEAT-EXC     | UC-EXC-01  | BR-EXC-01  | SCR-EXC-01   | API-REDELIVER        | ENT-EXCEPTION          | ST-EXCEPTION | AC-EXC-01  | EPIC-TRACK  |
| FEAT-RET     | UC-RET-01  | BR-RET-01  | SCR-RET-01   | API-RETURN-RECEIPT   | ENT-RETURN-RECEIPT     | ST-RETURN    | AC-RET-01  | EPIC-RETURN |
| FEAT-RATE    | UC-RATE-01 | BR-RATE-01 | SCR-RATE-01  | API-RATE             | ENT-RATE-VERSION       | ST-APPROVAL  | AC-RATE-01 | EPIC-AUDIT  |
| FEAT-AUD     | UC-AUD-01  | BR-AUD-01  | SCR-AUD-01   | JOB-RECONCILE        | ENT-FINDING            | ST-RUN       | AC-AUD-01  | EPIC-AUDIT  |
| FEAT-BNK     | UC-BNK-01  | BR-BNK-01  | SCR-BATCH-01 | API-BANK-ALLOC       | ENT-BANK-ALLOCATION    | ST-BATCH     | AC-BNK-01  | EPIC-AUDIT  |
| FEAT-CLM     | UC-CLM-01  | BR-CLM-01  | SCR-CASE-01  | API-CLAIM            | ENT-CLAIM              | ST-CASE      | AC-CLM-01  | EPIC-CLAIM  |

The complete matrix is expanded as use cases, APIs and tests are implemented. New CORE feature IDs cannot be merged without a traceability row.
