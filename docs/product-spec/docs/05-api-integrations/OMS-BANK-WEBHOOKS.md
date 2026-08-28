# OMS, Bank and Webhook Integrations

## Pancake/OMS adapter

Canonical operations:

- Pull or receive source order changes with cursor/watermark.
- Upsert by tenant + source system + source order code.
- Preserve source payload/revision.
- Push waybill, selected carrier, label link and canonical shipping status where permitted.
- Prevent feedback loops using origin/correlation metadata.
- Backfill and reconcile missed updates.
- CSV/XLSX import remains fallback.

Production Pancake endpoints/scopes require current official/partner documentation and account consent.

## Bank source

Initial mode is private CSV/XLSX import. Optional bank API can implement the same canonical contract.

Rules:

- Only inbound transactions are candidates for carrier receipt.
- Exact batch reference may auto-match.
- Amount/date/counterparty without exact reference is suggestion-only.
- Many-to-many allocations require amount per link.
- Allocation sum cannot exceed transaction amount.
- Raw bank file is restricted data with shorter access list.

## Webhook receiver

- Provider-specific route terminates at adapter.
- Verify signature/secret before acceptance.
- Store raw body hash, headers needed for verification, received time and provider event key.
- Acknowledge quickly after durable enqueue.
- Deduplicate and process asynchronously.
- Reject replay outside policy where provider timestamp/signature supports it.
- Unknown status is stored and mapped later.
- Polling reconciles missing/out-of-order events.

## Domain events

Key events:

- order.created, quote.requested, quote.available, routing.selected.
- shipment.create_requested, shipment.created, shipment.outcome_unknown.
- shipment.status_changed, exception.opened, exception.resolved.
- return.expected, return.received, return.issue_found.
- import.promoted, audit.completed, finding.created.
- batch.bank_status_changed, case.status_changed, claim.submitted, recovery.recorded.
