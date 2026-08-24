# Test Data and Carrier Mocks

## Golden datasets

Create deterministic, anonymized fixtures:

- Auth/users/roles with positive and denied scopes.
- Addresses: exact, ambiguous, unsupported and carrier-code mismatch.
- Quotes: supported, explicit rejection, timeout, partial fees and expired.
- Create: success, business rejection, timeout-found, timeout-not-found and duplicate client key.
- Tracking: duplicate, out-of-order, unknown status and missing webhook.
- Return: valid, duplicate, wrong tenant/warehouse and damaged.
- Rates: zone/weight boundaries, volumetric, VAT, rounding, insurance, return and surcharge.
- Statements: clean, COD mismatch, fee mismatch, weight candidate, duplicate deduction, source-only and carrier-only.
- Bank: exact reference, suggested, one-to-many, many-to-one, short and over.
- Claims: complete, missing evidence, expired, partial accepted and installment recovery.

## Mock carrier server

One canonical mock controller supports configurable scenarios per carrier/account:

- latency_ms and timeout.
- status code/error body.
- serviceability outcome.
- quote services/components/expiry.
- create durable effect before timeout.
- lookup by client reference.
- state-constrained update/cancel/redelivery.
- label bytes/reference.
- webhook emission, duplication and reordering.
- rate limiting and auth failure.

Mocks live only in local/test. Production configuration fails closed if a mock adapter is selected.

## Data safety

- No production credential, phone, address, bank account or contract file.
- Synthetic test data is obvious and namespaced.
- UAT real data is minimized, separately controlled and never committed.

