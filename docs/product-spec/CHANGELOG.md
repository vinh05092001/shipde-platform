# Change log

## Governed ecosystem toolchain — 2026-09-03

- Established the machine-readable ecosystem manifest `tools/ecosystem-manifest.json` governing exactly 37 adopted repositories and capabilities across 5 layers, with 12 fail-closed ecosystem policies (`AI-TOOL-01` through `AI-TOOL-12`).
- Isolated 10 candidate technologies (`pact-js`, `nock`, `hoverfly`, `toxiproxy`, `k6`, `semgrep`, `syft`, `ast-grep`, `llmlingua`, `opa`) in explicit `PILOT`/`WATCH` lifecycle states with installation and enablement disabled by default.
- Established 9 activity-based activation profiles in `tools/ecosystem-profiles.json` (`FOUNDATION`, `BACKEND_FEATURE`, `CARRIER_INTEGRATION`, `COD_AND_SETTLEMENT`, `UI_FEATURE`, `SECURITY_REVIEW`, `RESEARCH_ONLY`, `PR_REVIEW`, `NIGHTLY_MAINTENANCE`) enforcing least-privilege tool subsets, concurrency limits (max 1 implementation, max 1 research), localhost-only network policy, and automatic post-task service cleanup.
- Added `scripts/ai/ecosystem.ps1` for deterministic manifest validation, profile activation/deactivation, ecosystem status querying, register synchronization, and automated negative policy test proofs.
- Added preview-first `scripts/ai/install-ecosystem.ps1` to inventory machine CLIs, preserve existing installations without upgrade, defer later Foundation 03/04 dependencies without modifying package manifests or lockfiles, and install missing machine tools safely with `-Apply`.
- Extended `scripts/ai/doctor.ps1` to validate ecosystem manifest health, verify stopped state of optional MCP servers and background services, and enforce workspace path containment inside `%USERPROFILE%\AI`.
- Reconciled merged GitHub Pull Request evidence for PR #2 (`TASK-AI-02`), PR #3 (`TASK-FOUND-01`), and PR #4 (`TASK-FOUND-02`) in `FEATURE-DELIVERY-REGISTER.csv`, making future post-merge synchronization idempotent in `scripts/ai/control.ps1`.

- Replaced the ZCode-only handoff with explicit 9Router, Gemini and Codex roles.
- Added deterministic worker routing, author risk/path boundaries and human control points.
- Renamed the ready state to `READY_FOR_AUTHOR` and added dedicated Gemini and 9Router prompts.
- Removed Ponytail as an always-on rule so UI and completeness follow approved product/UX sources.
- Preserved the existing PR contract and split application checks into a path-scoped workflow so documentation-only changes do not claim application verification.
- Recorded the prototype's missing ESLint dependency as a `TASK-FOUND-01` baseline blocker.
- Added a complete Windows operating runbook, five isolated worktrees and safe scripts for one-action state routing, Desktop entry, health checks, author handoff, independent review and `main` protection.
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
