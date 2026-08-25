# Change log

## Semi-manual multi-agent workflow — 2026-08-25

- Replaced the ZCode-only handoff with explicit 9Router, Gemini and Codex roles.
- Added deterministic worker routing, author risk/path boundaries and human control points.
- Renamed the ready state to `READY_FOR_AUTHOR` and added dedicated Gemini and 9Router prompts.
- Removed Ponytail as an always-on rule so UI and completeness follow approved product/UX sources.
- Preserved the existing PR contract and split application checks into a path-scoped workflow so documentation-only changes do not claim application verification.
- Recorded the prototype's missing ESLint dependency as a `TASK-FOUND-01` baseline blocker.
- Added a complete Windows operating runbook and safe scripts for worktree bootstrap, health checks, author handoff, independent review and `main` protection.
- Recorded the adopted/deferred/rejected toolchain, pinned DSH policy, free-model route and explicit 9Router Ponytail/Caveman prohibition.
- Made the application gate always report while running expensive application commands only for application-affecting paths.

## AI collaboration gate — 2026-08-24

- Added the shared root AGENTS.md used by ZCode and Codex.
- Added Codex planning, ZCode implementation and Codex review prompts.
- Added four foundation Work Items and a 134-row delivery register covering all
  130 product features.
- Added GitHub issue/PR templates and PR contract validation workflow.
- Added structural validation that the delivery register exactly covers the
  master feature catalog.

## 1.0.0 — 2026-08-24

- Reframed Ship Dễ from a post-shipment-only PoV into an end-to-end multi-carrier platform.
- Restored address, serviceability, quote, recommendation, shipment, cancellation, label and pickup functions to the core product.
- Preserved contract-rate audit, COD reconciliation, claim and evidence functionality.
- Added complete authentication, user, role, shop, branch, warehouse and shared platform capabilities.
- Added AI-build, test, deployment and developer-handover contracts.
- Marked unverified Viettel Post and J&T Vietnam partner APIs as confirmation-required.
