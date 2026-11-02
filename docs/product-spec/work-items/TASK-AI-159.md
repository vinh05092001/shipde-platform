# TASK-AI-159 — Accessible authenticated app shell

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-159` |
| Feature ID | N/A — shared app shell |
| Status | `IN_PROGRESS` |
| Delivery order | 291 |
| Dependencies | TASK-FOUND-02 |
| Assigned author | Codex — explicitly assigned by operator |
| Risk | MEDIUM |
| Allowed paths | apps/web/; docs/product-spec/work-items/TASK-AI-159.md; TASK-AI-159 register row; .oc/pr-body.md |
| Reviewer | Codex — fresh independent task |
| Branch | feat/task-ai-159-dashboard-shell |
| Pull Request | Not pushed, per operator instruction |

## Business outcome

Operators reach shops, orders and carriers faster on desktop and mobile while retaining existing application behavior and authentication.

## Source references

- BASELINE-AND-DECISIONS.md: DEC-001, DEC-016; PRODUCT-VISION-SCOPE.md: operational users and jobs to be done.
- MASTER-FEATURE-CATALOG.md: identity/organization, orders and shared platform.
- docs/03-ux/DESIGN-SYSTEM-UX-RULES.md: canonical components, responsive and accessibility.
- docs/03-ux/INFORMATION-ARCHITECTURE.md: primary navigation, route catalog and backend enforcement.
- docs/03-ux/SCREEN-SPECIFICATIONS.md: shared screen contract, SCR-CAR-01, SCR-ORD-02.
- docs/02-business/RBAC-APPROVAL-MATRIX.md: enforcement; existing authenticated /api/v1/me and /api/v1/roles contracts.
- Operator approval 2026-11-01: Kiranism/next-shadcn-dashboard-starter is an MIT reference only. Specification and existing authentication take precedence.

## Preconditions and dependencies

Branch baseline c6e71fcb9354cd2b14d1f5dcaed794abff306991. Frozen install uses C:/pnpm-store. Preserve pre-existing unrelated API/Prisma/carrier changes; exclude them from this commit.

## Ambiguity and clarification markers

No unresolved product decision. Existing shell routes are tab based; retain working destinations rather than create unimplemented canonical routes. No shadcn setup exists on this baseline; document the minimal primitive adaptation and any environment restrictions.

## Author boundary

Operator directly authorized Codex implementation in this isolated worktree. No API, Prisma, auth replacement, business logic, gate, baseline, allowlist, semgrep or .github changes. No push or self-review PASS.

## Slice sizing rule

One Work Item and commit. The ~400 line target is advisory; complete shell state and accessibility coverage remains required.

## In scope

Collapsible sidebar, cookie preference, grouped permitted routes, mobile sheet, route breadcrumbs, user menu, Ctrl/Cmd+K navigation palette, shell skeleton/empty/error/forbidden states, component and browser evidence, documentation.

## Out of scope

Starter demo pages/data/Clerk, global entity search replacement, APIs, migrations, business rules, auth redesign, unrelated dirty changes, gate changes and publishing.

## Business rules and edge cases

BR-SHELL-01: Both navigation surfaces use the same permission filtered targets from existing live role configuration. Unknown/deleted custom roles fail closed; backend checks remain authoritative.

BR-SHELL-02: Cookie holds only sidebar preference; mobile opening does not overwrite desktop preference. Esc closes overlays, traps focus and restores it.

BR-SHELL-03: Preserve global entity search and operational primary actions. At 360px navigation and primary actions remain reachable.

## Constitution check

- [x] Tenant scope: no new tenant data reads/writes; existing APIs resolve authenticated actor.
- [x] RBAC & permissions: consume current server profile and role configuration; UI filtering is supplementary.
- [x] Audit & sensitive data: no credentials or PII in evidence; preference cookie contains a boolean only.
- [x] VND integer arithmetic: N/A, no financial logic changes.
- [x] Carrier reconciliation: N/A, no carrier side effect changes.
- [ ] Tests at lowest useful level, test-first: component tests written before implementation; verification evidence recorded below.

## UI states

Loading: skeleton while auth/navigation restores. Empty: role has zero permitted targets. Error: actionable retry when role API fails. Forbidden: distinct 403 notice. Success: current route and permitted links. Recovery: close overlays, retry configuration, existing page recovery remains. Validation/partial: no new data-entry or bulk command flow.

## API, event and data impact

Read existing /api/v1/me and /api/v1/roles to identify the live effective role. No API/schema/events/jobs/migrations changed. Cookie persists only sidebar state. Existing API permission and tenant enforcement is retained.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
| --- | --- | --- | --- |
| AC-AI-159-01 | System/custom/unknown role | Shared permitted nav; unknown role empty, no owner fallback | component tests |
| AC-AI-159-02 | Current tab, nested and unknown route | Breadcrumbs match route boundaries; current item announced | component tests |
| AC-AI-159-03 | Ctrl/Cmd+K, search and select | Same targets; keyboard selection, Esc and restored focus | component + browser tests |
| AC-AI-159-04 | Desktop collapse and reload | Cookie restores preference | browser test + screenshot |
| AC-AI-159-05 | 360px mobile | Sheet focus trap/Esc, navigation and primary action reachable | browser test + screenshot |
| AC-AI-159-06 | Loading, empty, failed/forbidden nav | Dedicated states with recovery | component + browser tests |
| AC-AI-159-07 | Existing actions/auth/search | Existing flows preserved; old e2e assertions unchanged | existing tests + inspection |
| AC-AI-159-08 | Handoff and scope | One register row, attribution, required commands and commit, no push | docs-inspection + log; test not applicable: delivery metadata |

## Task breakdown

- [x] T01 Write failing permission/breadcrumb/palette component tests.
- [ ] T02 Implement shell-only primitive, route configuration and live role consumption.
- [ ] T03 Implement mobile/keyboard browser coverage and screenshots.
- [ ] T04 Run requested repository verification and update evidence.
- [ ] T05 Commit only TASK-AI-159; no push; request fresh independent review.

## Verification commands

pnpm install --frozen-lockfile --store-dir C:/pnpm-store; pnpm lint; pnpm format:check; pnpm typecheck; pnpm test; pnpm build; node scripts/ai/check-no-hardcode.mjs; git diff --check origin/main...HEAD. Windows uses pnpm.cmd to avoid host PowerShell execution policy. Results pending.

## Codex review record

No independent review performed. Intended handoff: READY_FOR_CODEX; not a PASS verdict.

## Residual limitations

Verification in progress. Existing prototype tabs/settings retain their working behavior; canonical future routes and unfinished business features remain outside this UI shell task. Starter Clerk, generic demo UX and mock navigation are excluded to follow the specification.
