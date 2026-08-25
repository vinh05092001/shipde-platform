# Ship Dễ — Product Specification & AI Build Pack

**Baseline:** 2026-08-24  
**Status:** Product baseline v1.0  
**Language:** Vietnamese for business specifications; English identifiers for code contracts.

## Purpose

This repository is the single source of truth used to:

1. Generate a complete Ship Dễ frontend and backend with an AI coding agent.
2. Verify the generated implementation through deterministic contracts and tests.
3. Hand the runnable product to a human developer for review, correction, hardening and production deployment.

Ship Dễ is an end-to-end multi-carrier shipping operations and control platform for Vietnamese shops. It covers:

- Before shipment: address validation, serviceability, live quotes, carrier recommendation, shipment creation, pickup and labels.
- In transit: unified tracking, exception workbox, redelivery and recipient experience.
- After shipment: return receiving, contract-rate audit, COD/bank reconciliation, discrepancy cases and claims.

The former file-first parcel-audit PoV is retained as one module and validation path. It no longer defines the whole product.

## Non-negotiable build rules

- No fake buttons, disconnected screens or hard-coded production data.
- Every user action maps to a backend command or a documented manual fallback.
- Carrier behavior is never invented. Unverified capabilities return UNSUPPORTED or PARTNER_CONFIRMATION_REQUIRED.
- A timed-out create-shipment request is reconciled before retry; duplicate waybills are unacceptable.
- Carrier API quote, approved contract rate and final carrier deduction are separate evidence layers.
- Processing status and financial findings are separate data dimensions.
- Sensitive data is tenant-isolated, minimized, encrypted and audited.
- Every feature traces to an actor, rule, screen, API, data entity and acceptance test.

## Reading order

1. [Document register](docs/00-control/DOCUMENT-REGISTER.md)
2. [Product vision and scope](docs/01-product/PRODUCT-VISION-SCOPE.md)
3. [Master feature catalog](docs/01-product/MASTER-FEATURE-CATALOG.md)
4. [End-to-end processes](docs/02-business/END-TO-END-PROCESSES.md)
5. [Business rules](docs/02-business/BUSINESS-RULES-DECISION-TABLES.md)
6. [State machines](docs/02-business/STATE-MACHINES.md)
7. [Screen specifications](docs/03-ux/SCREEN-SPECIFICATIONS.md)
8. [Domain model](docs/04-data/DOMAIN-MODEL-ERD.md)
9. [Internal API](docs/05-api-integrations/INTERNAL-API.md)
10. [System architecture](docs/06-architecture/SYSTEM-ARCHITECTURE.md)
11. [AI build plan](docs/07-ai-build/VERTICAL-SLICE-PLAN.md)
12. [Semi-manual AI workflow](docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md)
13. [Acceptance and E2E](docs/08-testing/ACCEPTANCE-AND-E2E.md)
14. [Developer handover](docs/09-delivery/DEVELOPER-HANDOVER.md)

## AI delivery entry points

- Claude proposes business and solution changes; the human approves material decisions before they become versioned sources.
- Codex prepares the next Work Item with
  [CODEX-PLANNING-PROMPT.md](docs/10-ai-collaboration/CODEX-PLANNING-PROMPT.md).
- Gemini implements primary/foundation Work Items with
  [GEMINI-START-PROMPT.md](docs/10-ai-collaboration/GEMINI-START-PROMPT.md).
- A DSH/OpenCode worker through 9Router implements only assigned low-risk Work Items with
  [NINEROUTER-START-PROMPT.md](docs/10-ai-collaboration/NINEROUTER-START-PROMPT.md).
- Codex independently reviews every Pull Request with
  [CODEX-REVIEW-PROMPT.md](docs/10-ai-collaboration/CODEX-REVIEW-PROMPT.md).
- The human starts each handoff and is the only merge owner.
- The 134-row delivery queue is
  [FEATURE-DELIVERY-REGISTER.csv](docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv):
  four foundation tasks plus all 130 product features.

## Formats

- Narrative and tables: Markdown.
- Diagrams: Mermaid embedded in Markdown.
- API contract: OpenAPI YAML.
- Event and import contracts: JSON Schema.
- Data model: Markdown ERD plus DBML.
- Acceptance scenarios: Given/When/Then tables.

## Source precedence

When documents conflict, apply this order:

1. Baseline decisions in docs/00-control.
2. Product scope and master feature catalog.
3. Business rules and state machines.
4. API and data contracts.
5. Screen specifications.
6. Backlog and AI prompts.

An implementation must not silently resolve a conflict. Record it in the decision/open-issue register.
