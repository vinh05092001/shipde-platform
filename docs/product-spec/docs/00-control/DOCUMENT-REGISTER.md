# Document Register

This register maps the complete documentation set to consolidated repository artifacts. A consolidated artifact can cover several document types, but none of the required information may be omitted.

| Package | Artifact | Covers |
|---|---|---|
| Control | BASELINE-AND-DECISIONS.md | Decisions, assumptions, open issues, change control |
| Control | TRACEABILITY.md | Requirement identifiers and end-to-end traceability |
| Control | GLOSSARY.md | Canonical terminology |
| Product | PRODUCT-VISION-SCOPE.md | Vision, customers, scope, boundaries |
| Product | ACTORS-PERSONAS.md | Actors, jobs, needs and access context |
| Product | MASTER-FEATURE-CATALOG.md | Complete feature inventory |
| Product | BUSINESS-MODEL-KPIS.md | Pricing, product and operational metrics |
| Business | END-TO-END-PROCESSES.md | Process catalog and journeys |
| Business | USE-CASES.md | Use-case specifications |
| Business | BUSINESS-RULES-DECISION-TABLES.md | Rules, formulas and decisions |
| Business | STATE-MACHINES.md | Lifecycle models and transitions |
| Business | RBAC-APPROVAL-MATRIX.md | Permissions and approvals |
| Business | NOTIFICATIONS-REPORTS.md | Notifications, escalations and reports |
| UX | INFORMATION-ARCHITECTURE.md | Sitemap, navigation and screen inventory |
| UX | SCREEN-SPECIFICATIONS.md | Pages, fields, actions and UI states |
| UX | DESIGN-SYSTEM-UX-RULES.md | Components, content, responsive and accessibility |
| Data | DOMAIN-MODEL-ERD.md | Domain entities and relationships |
| Data | DATA-DICTIONARY.md | Fields, constraints and classifications |
| Data | DATA-LIFECYCLE-IMPORTS.md | Sources, lineage, versioning, retention and imports |
| Data | schema.dbml | Machine-readable conceptual schema |
| API | INTERNAL-API.md | Frontend/backend service contract |
| API | CARRIER-ADAPTER.md | Normalized carrier interface |
| API | CARRIER-CAPABILITY-MATRIX.md | Verified/conditional carrier capabilities |
| API | GHN.md | GHN integration notes |
| API | GHTK.md | GHTK integration notes |
| API | VIETTELPOST.md | Viettel Post confirmation plan |
| API | JT-EXPRESS.md | J&T Vietnam confirmation plan |
| API | OMS-BANK-WEBHOOKS.md | Pancake/OMS, bank and event integrations |
| API | ERROR-IDEMPOTENCY-RETRY.md | Canonical errors and resilience rules |
| Contracts | openapi.yaml | Machine-readable initial REST contract |
| Contracts | events/*.json | Event schemas |
| Contracts | imports/*.json | Import schemas |
| Architecture | SYSTEM-ARCHITECTURE.md | Context, containers and components |
| Architecture | FRONTEND-ARCHITECTURE.md | Frontend boundaries and conventions |
| Architecture | BACKEND-ARCHITECTURE.md | Backend modules, jobs and transactions |
| Architecture | SECURITY-NFR-OBSERVABILITY.md | Security, privacy, NFR and monitoring |
| Architecture | ADR.md | Architecture decision records |
| AI Build | TECH-STACK-REPOSITORY.md | Stack and repository structure |
| AI Build | AI-CODING-GUARDRAILS.md | Agent constraints and review rules |
| AI Build | VERTICAL-SLICE-PLAN.md | Ordered implementation plan |
| AI Build | DEFINITION-OF-READY-DONE.md | Entry and completion gates |
| Testing | TEST-STRATEGY.md | Test levels and ownership |
| Testing | ACCEPTANCE-AND-E2E.md | Feature acceptance and E2E journeys |
| Testing | TEST-DATA-MOCKS.md | Fixtures and carrier simulation |
| Delivery | BACKLOG-DEPENDENCIES.md | Epics, stories and dependencies |
| Delivery | CI-CD-DEPLOYMENT.md | Pipelines, environments and rollback |
| Delivery | OPERATIONS-RUNBOOK.md | Operational recovery procedures |
| Delivery | DEVELOPER-HANDOVER.md | Human developer handover |
| Delivery | RISKS-OPEN-ISSUES.md | Risks, unknowns and validation plan |
| AI Collaboration | SEMI-MANUAL-AI-WORKFLOW.md | 9Router/Gemini author, Codex reviewer and human control workflow |
| AI Collaboration | FOUNDATION-WORK-ITEMS.md | Required repository foundation sequence |
| AI Collaboration | FEATURE-DELIVERY-REGISTER.csv | Machine-readable queue covering all feature IDs |
| AI Collaboration | WORK-ITEM-TEMPLATE.md | Definition-of-Ready implementation contract |
| AI Collaboration | CODEX-PLANNING-PROMPT.md | Codex planning-only handoff prompt |
| AI Collaboration | GEMINI-START-PROMPT.md | Gemini single-Work-Item implementation prompt |
| AI Collaboration | NINEROUTER-START-PROMPT.md | Constrained low-risk 9Router worker prompt |
| AI Collaboration | CODEX-REVIEW-PROMPT.md | Codex independent feature review prompt |
| AI Collaboration | AI-TOOLCHAIN-DECISIONS.md | Adopted, deferred and rejected tools plus safe 9Router policy |
| AI Collaboration | REPOSITORY-CLI-MANIFEST.md | Complete product workspace, global CLI, project dependency, Docker service and agent-guidance inventory |
| AI Collaboration | WINDOWS-SETUP-RUNBOOK.md | Windows worktree, CLI, provider, health and protection procedure |
| Repository Control | AGENTS.md | Shared instructions and repository-specific review rules |
| Repository Control | PULL_REQUEST_TEMPLATE.md | Required implementation and evidence format |
| Repository Control | feature-contract-gate.yml | CI enforcement of one Work Item per PR |
| Repository Control | current-application.yml | Always-present path-aware install, lint, build and E2E gate |
| Repository Control | scripts/ai/*.ps1 | Safe Windows CLI installation, bootstrap, health, author, review and protection controls |

## Completeness test

For every feature marked CORE, the traceability matrix must eventually provide:

Feature ID → Actor → Rule → Use case → Screen → API/Job → Entity → State transition → Test → Backlog item.

The validator checks structural links and duplicate identifiers. Semantic sign-off remains a product/BA responsibility.

