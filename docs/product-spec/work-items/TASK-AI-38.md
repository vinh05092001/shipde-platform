# TASK-AI-38 — Accessibility and performance gates for the web app (axe-core and lighthouse-ci)

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-38` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `171` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-38.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-38-a11y-perf` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/25 |

## Business outcome

The Ship Dễ web application is an operational logistics platform used daily by merchant shippers, warehouse operators, and back-office reconcilers. In fast-paced operational workflows (such as parcel intake, barcode scanning, rate comparison, and batch dispatch), accessibility and fast page rendering are essential:

1. **Accessibility assurance**: Operators rely on rapid keyboard navigation, clear form error messaging, accessible focus management, and screen-reader compatibility. Without automated accessibility checks in continuous integration, regressions such as missing form labels, inaccessible action buttons, insufficient text contrast, and broken modal focus traps inevitably enter the codebase.
2. **Performance budgets on critical routes**: Operational efficiency requires snappy load times across both desktop and mobile/tablet devices. Key operational paths—including the authentication gateway, the order dispatch work queue, and parcel tracking—must meet strict Core Web Vitals budgets and bundle size thresholds.
3. **Automated gating and manual complement**: Foundation work item `TASK-FOUND-04` provided initial heuristic scanners (`scripts/verify-a11y.ts` and `scripts/verify-perf.ts`). This specification formalizes the production-grade quality gate architecture:
   - Automated accessibility audits using `axe-core` (pinned `4.10.2`) integrated into Playwright browser tests to inspect rendered DOM accessibility trees across all mandatory UI states (default, loading, empty, validation error, forbidden, partial, success, recovery).
   - Targeted performance budgeting using Lighthouse CI (`@lhci/cli` pinned `0.14.0`) driven by declarative configuration (`lighthouserc.json`) on critical routes against local production builds without external network calls.
   - Clear architectural boundary establishing that automated tools catch machine-verifiable defects but never replace mandatory manual keyboard testing, screen-reader validation, and responsive layout review.
   - Governed ecosystem manifest promotion path transitioning `axe-core` and `lighthouse-ci` from `PENDING` to `ADOPTED` and `BLOCKING_GATE` in `tools/ecosystem-manifest.json` once implementation is delivered.

## Source references

- `AGENTS.md` § Source of truth — Precedence order: specifications govern; existing code is implementation evidence.
- `AGENTS.md` § Role separation — Author never approves own work; independent Codex review gate.
- `AGENTS.md` § UI quality rule — Generic AI dashboards and disconnected controls rejected; full state coverage mandatory across approved screen specifications.
- `AGENTS.md` § Definition of a complete feature — User-visible flow across loading, empty, validation, error, forbidden, partial, success, and recovery states.
- `AGENTS.md` § Foundation verification commands — Verification gates (`pnpm test:e2e`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`).
- `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` § Visual foundation & Accessibility — WCAG AA contrast, keyboard tab order, visible focus rings, labels independent of placeholders, non-color-only status indicators, modal focus traps, and accessible table headers.
- `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md` § Target stack & UI evidence — Storybook, MSW, Playwright, axe-based accessibility checks, and targeted Lighthouse CI budgets.
- `docs/product-spec/docs/08-testing/TEST-STRATEGY.md` § Test levels & CI gates — Component, E2E, and Performance test levels.
- `docs/product-spec/docs/09-delivery/CI-CD-DEPLOYMENT.md` § Pull-request pipeline — E2E smoke and quality gates.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § UI quality stack & Governed Ecosystem Catalog — `axe-core` and `lighthouse-ci` roles, boundaries, and promotion criteria.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — Row 171 (`TASK-AI-38`).
- `tools/ecosystem-manifest.json` — Entries `axe-core` (pinned `4.10.2`) and `lighthouse-ci` (pinned `0.14.0`), both `PENDING`, `NON_BLOCKING`.
- `scripts/verify-a11y.ts` & `scripts/verify-perf.ts` — Existing foundation heuristic scripts.

## Preconditions and dependencies

- `TASK-AI-17` complete: Ecosystem manifest truthfully reconciled against repository reality.
- `gitleaks` is `ADOPTED` and a `BLOCKING_GATE`, `install_method: "ci-provisioned"`, installed at pinned `8.24.0` by `.github/workflows/security-baseline.yml`. It is NOT absent.
- `lefthook` and `trivy` genuinely are absent from host and workspace devDependencies prior to implementation, and are declared `PENDING` with `blocking_policy: "NON_BLOCKING"` in `tools/ecosystem-manifest.json`.
- `axe-core` (pinned `4.10.2`) and `lighthouse-ci` (pinned `0.14.0`) are currently declared `PENDING` in `tools/ecosystem-manifest.json` with `blocking_policy: "NON_BLOCKING"`, awaiting full implementation under their respective allowed paths.
- Install lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) are strictly forbidden in root and web manifests by the supply-chain security audit invariant.
- Quality gates remain green:
  - `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"` exits 0.
  - `node tools/ai-brain/cli.js reconcile` exits 0 (0 errors, 1 warning: TASK-AI-07).
  - `node tools/ai-brain/cli.js manifest` exits 0 (0 errors, 1 warning: codex-cli drift).
  - `python docs/product-spec/scripts/validate_docs.py` exits 0.

## Author boundary

`GEMINI` is appropriate as primary author: this Work Item authors the foundational specification for accessibility and performance quality gates across the web application, Playwright E2E testing framework, Lighthouse CI budgets, and ecosystem governance.

Bounded scope for this Work Item: authoring the formal specification in `docs/product-spec/work-items/TASK-AI-38.md`.

Prohibited in this Work Item:
- Do NOT edit `.github/`, `scripts/verify-*`, `docs/product-spec/scripts/`, `.gitleaks.toml`, or any validator script.
- Do NOT add `prepare`, `preinstall`, `install`, or `postinstall` scripts to `package.json`.
- Do NOT modify review verdict parsing, exact-HEAD binding, or supervisor logic in `scripts/ai/control.ps1`.
- Do NOT disable, skip, or narrow any check or quality gate.
- Do NOT flip `lifecycle_state` or `blocking_policy` in `tools/ecosystem-manifest.json` prematurely before implementation files and tests exist.
- Author never approves own work. Stop at `READY_FOR_CODEX`.

## In scope

- Define the technical specification for `axe-core` automated accessibility auditing:
  - Integration with Playwright via `@axe-core/playwright` or `axe-core` (pinned at `4.10.2`) in E2E browser test runs.
  - Auditing rendered DOM nodes against WCAG 2.1 Level AA and Section 508 standards (including color contrast, form element labeling, image alt text, aria-hidden validity, icon button names, table header associations, and modal focus traps).
  - Full coverage across UI states: default, loading, empty, validation error, forbidden, partial, success, and recovery.
  - Negative fixture validation: automated tests ensuring intentionally broken accessibility fixtures fail closed with clear, actionable violation reports (Rule ID, selector, failure summary).
- Define the technical specification for `lighthouse-ci` automated performance auditing:
  - Integration via `@lhci/cli` (pinned at `0.14.0`) driven by version-controlled `lighthouserc.json` at repository root.
  - Targeted critical routes execution (e.g., `/`, `/orders`, `/tracking`) rather than running across every local edit or unbounded URLs.
  - Offline, local execution against built production Next.js assets (`pnpm build` -> local static server or preview server), with zero telemetry and zero external network calls (`telemetry_network_behavior: "localhost-only"`).
  - Strict budget thresholds for Core Web Vitals and Lighthouse categories:
    - Accessibility score: `>= 0.95`.
    - Performance score: `>= 0.85` desktop, `>= 0.75` mobile emulation.
    - Best practices score: `>= 0.90`.
    - SEO score: `>= 0.90`.
    - Initial JavaScript bundle transfer budget per critical route (complementing `scripts/verify-perf.ts`).
- Define the role separation between automated gates and manual UX review:
  - Automated axe-core checks catch ~30-50% of machine-detectable issues; human/agent manual evidence (keyboard tab order, visible focus ring, screen reader semantics, responsive viewport testing) remains mandatory under `AGENTS.md` and `DESIGN-SYSTEM-UX-RULES.md`.
- Define the manifest promotion criteria for `tools/ecosystem-manifest.json`:
  - Exact criteria to transition `axe-core` and `lighthouse-ci` from `PENDING` to `ADOPTED` and `BLOCKING_GATE` in the subsequent implementation pull request.
- Author complete Work Item specification `TASK-AI-38.md`.

## Out of scope

- Implementing devDependencies installation or writing runtime Playwright test code in this specification PR.
- Upgrading or altering `gitleaks` (governed by `TASK-AI-35`).
- Installing or configuring `lefthook` (governed by `TASK-AI-36`).
- Integrating container vulnerability scanning with `trivy` (governed by `TASK-AI-37`).
- Altering the pinned `codex-cli` version.
- Modifying files under `.github/workflows/` or editing `scripts/verify-*`.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-38-R01` | Automated WCAG 2.1 AA enforcement: The axe-core integration via Playwright must audit rendered DOM against WCAG 2.1 AA rules, failing closed if any critical or serious violation (contrast, label, name, role) is detected. |
| `AI-38-R02` | Full UI state accessibility: Accessibility checks must not be limited to static default views; they must validate loading skeletons, empty states, validation error displays, forbidden screens, and interactive modals. |
| `AI-38-R03` | Keyboard focus trap and return: Modals, slide-overs, and confirmation dialogs must trap focus within the container while open and return focus to the triggering element upon dismissal; keyboard-only navigation must remain unblocked. |
| `AI-38-R04` | Non-color-alone status indicator: Status indicators (carrier status, delivery status, reconciliation discrepancy) must convey status via text labels and icons, never relying exclusively on color. |
| `AI-38-R05` | Targeted route performance budgets: Lighthouse CI audits must execute only against a designated, approved set of critical routes (e.g., `/`, `/orders`, `/tracking`), preventing excessive test execution overhead on non-critical paths. |
| `AI-38-R06` | Offline and zero telemetry execution: Lighthouse CI and axe-core runs must execute against locally served production builds without external network calls, and must have all external telemetry or data collection disabled (`telemetry_network_behavior: "localhost-only"` / `"none"`). |
| `AI-38-R07` | Complementary manual evidence: Automated accessibility and Lighthouse scores do not replace required visual and manual evidence (PR screenshots, keyboard navigation validation, screen-reader sanity check) under `AGENTS.md` and `TECH-STACK-REPOSITORY.md`. |
| `AI-38-R08` | Truthful manifest promotion: In `tools/ecosystem-manifest.json`, `axe-core` and `lighthouse-ci` remain `PENDING` until their package dependencies, configurations, and verification commands are committed and proven green in the repository. |

## UI states

Not applicable for this specification Work Item (authoring specification markdown only). For downstream implementation, user-visible web application states impacted by accessibility and performance rules:
- **Default operational view**: Clean tabular data, proper `th` scope, clear contrast, accessible action buttons.
- **Loading state**: Accessible skeleton elements with `aria-busy="true"` or `role="status"`, no layout shift breaking CLS budgets.
- **Empty state**: Semantic illustration/icon with accessible descriptive text and clear primary action button.
- **Validation error state**: Form field error summaries linked with `aria-describedby` and `aria-invalid="true"`, visible focus moved to first invalid field.
- **Forbidden / Not-found state**: Clear explanation of access denial or missing entity with accessible recovery navigation link.
- **Modal / Confirmation dialog**: Focus trapped within dialog, `aria-modal="true"`, ESC key dismisses, focus restored to trigger.
- **Recovery / Toast notification**: Live announcement via `aria-live="polite"` for non-disruptive feedback.

## API, event and data impact

No database schema, backend API, or carrier protocol contract modifications. Toolchain and quality gate impact:
- Specifies adoption of `axe-core` (`4.10.2`) and `@axe-core/playwright` as devDependencies.
- Specifies adoption of `@lhci/cli` (`0.14.0`) and root `lighthouserc.json`.
- Specifies E2E test scripts (`pnpm test:e2e:a11y`) and performance audit scripts (`pnpm test:perf:lhci`).
- Specifies eventual promotion in `tools/ecosystem-manifest.json` from `PENDING` to `ADOPTED`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-38-01` | Specification structural completeness | `docs/product-spec/work-items/TASK-AI-38.md` follows `TASK-AI-16.md` structure exactly (Control, Business outcome, Sources, Boundary, In/Out scope, Rules, Matrix, Commands, Limitations) | File inspection |
| `AC-AI-38-02` | axe-core WCAG 2.1 AA gate specification | Specification details Playwright integration with `axe-core` pinned at `4.10.2`, targeting full DOM trees across all 8 UI states | Specification text § In scope & `AI-38-R01`, `AI-38-R02` |
| `AC-AI-38-03` | Lighthouse CI performance budget specification | Specification details `@lhci/cli` pinned at `0.14.0`, root `lighthouserc.json`, targeted critical routes, and Core Web Vitals thresholds | Specification text § In scope & `AI-38-R05` |
| `AC-AI-38-04` | Zero telemetry and offline execution mandate | Specification enforces local static/preview server execution with zero external network access and zero telemetry collection | Specification text § `AI-38-R06` |
| `AC-AI-38-05` | Manual UX review complement rule | Specification establishes that automated a11y and Lighthouse scores do not replace manual keyboard and responsive evidence | Specification text § `AI-38-R07` |
| `AC-AI-38-06` | Negative failure proof requirement | Specification mandates negative fixtures proving that accessibility violations (e.g., missing label, bad contrast) fail closed | Specification text § In scope |
| `AC-AI-38-07` | Truthful manifest governance | Specification defines exact criteria for promoting `axe-core` and `lighthouse-ci` from `PENDING` to `ADOPTED` without violating manifest truth | Specification text § `AI-38-R08` |
| `AC-AI-38-08` | Repository validation and quality gate pass | Documentation validator (`validate_docs.py`), brain manifest, and reconcile gates pass with zero errors | CLI execution output |

## Verification commands

```powershell
python docs/product-spec/scripts/validate_docs.py
node tools/ai-brain/cli.js reconcile
node tools/ai-brain/cli.js manifest
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `HEAD` | `READY_FOR_CODEX` | Pending fresh independent Codex review |

## Residual limitations

- Automated accessibility audits using axe-core detect approximately 30% to 50% of potential accessibility barriers (such as color contrast, attribute syntax, and basic DOM relationships). Complex logical flows, meaningful screen reader announcements, and keyboard ergonomics require human and manual agent review during UI feature development.
- Lighthouse CI performance scores can exhibit minor variance in shared CI runners due to CPU throttling or resource contention; performance budgets must establish deterministic thresholds with appropriate margins to prevent false positive flakiness while strictly blocking regressions.
