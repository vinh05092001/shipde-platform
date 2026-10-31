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
| FEAT-AUTH-03 | UC-AUTH-01 | BR-AUTH-02, BR-AUTH-05, BR-AUTH-06, BR-AUTH-09, BR-AUTH-11, BR-AUTH-12, BR-AUTH-13 | SCR-AUTH-01 | API-AUTH-LOGIN, API-AUTH-LOGIN-OTP-REQUEST, API-AUTH-LOGIN-OTP-VERIFY | ENT-USER, ENT-DEVICE-SESSION, ENT-VERIFICATION-TOKEN | ST-USER | AC-AUTH-01 | EPIC-FND |
| FEAT-AUTH-05 | UC-AUTH-03 | BR-AUTH-14, BR-AUTH-15, BR-AUTH-16, BR-AUTH-17, BR-AUTH-18, BR-AUTH-19 | SCR-AUTH-01, SCR-AUTH-03 | API-AUTH-MFA-STATUS, API-AUTH-MFA-SETUP, API-AUTH-MFA-SETUP-VERIFY, API-AUTH-MFA-CHALLENGE-VERIFY, API-AUTH-MFA-RECOVERY-VERIFY, API-AUTH-MFA-RECOVERY-REGENERATE, API-AUTH-MFA-ADMIN-RESET | ENT-USER, ENT-DEVICE-SESSION, ENT-MFA-FACTOR, ENT-MFA-RECOVERY-CODE, ENT-MFA-CHALLENGE | ST-USER | AC-AUTH-05 | EPIC-FND |
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
| FEAT-COM-07  | UC-COM-07  | BR-COM-07-01, BR-COM-07-02, BR-COM-07-03, BR-COM-07-04, BR-COM-07-05, BR-COM-07-06, BR-COM-07-07, BR-COM-07-08, BR-COM-07-09, BR-COM-07-10, BR-COM-07-11, BR-COM-07-12 | SCR-SET-SHOP, SCR-SET-BRANCH, SCR-SET-WH | API-ACTIVITY-GET     | ENT-AUDIT-LOG          | ST-AUDIT-EVENT | AC-COM-07-01, AC-COM-07-02, AC-COM-07-03, AC-COM-07-04, AC-COM-07-05, AC-COM-07-06, AC-COM-07-07, AC-COM-07-08, AC-COM-07-09, AC-COM-07-10, AC-COM-07-11, AC-COM-07-12, AC-COM-07-13, AC-COM-07-14, AC-COM-07-15, AC-COM-07-16, AC-COM-07-17, AC-COM-07-18, AC-COM-07-19, AC-COM-07-20 | EPIC-SHARED |
| FEAT-CAR-01  | UC-CAR-01  | BR-CAR-01, BR-CAR-02, BR-CAR-03, BR-CAR-04, BR-CAR-05, BR-CAR-06, BR-CAR-07, BR-CAR-08, BR-CAR-09 | SCR-CAR-01 | API-CARRIER-CATALOG-LIST, API-CARRIER-CATALOG-DETAIL, API-CARRIER-CATALOG-STATUSES, API-CARRIER-CATALOG-FEES, API-CARRIER-CATALOG-COMPATIBILITY | ENT-CARRIER, ENT-CARRIER-SERVICE, ENT-CANONICAL-STATUS, ENT-FEE-COMPONENT, ENT-CATALOG-COMPATIBILITY-MAPPING | ST-SHIPMENT, ST-CARRIER-ACCOUNT | AC-CAR-01-01 .. AC-CAR-01-12 | EPIC-CAR |

The complete matrix is expanded as use cases, APIs and tests are implemented. New CORE feature IDs cannot be merged without a traceability row.
