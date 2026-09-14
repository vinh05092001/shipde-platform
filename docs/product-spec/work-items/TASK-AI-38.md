# TASK-AI-38 — Accessibility and performance gates for the web app (axe-core and lighthouse-ci)

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-38` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `171` |
| Dependencies | `TASK-AI-17` (merged, `1f587dd`) |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-38.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-38-a11y-perf` |
| Pull Request | `https://github.com/vinh05092001/shipde-platform/pull/25` |

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
- Delivery register row 171 reflects `BLOCKED_DEPENDENCY` awaiting automated write-back by `TASK-AI-19` reconciler; the Work Item specification respects register authority and remains at `BLOCKED_DEPENDENCY` until advanced through governed workflow.
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
  - Auditing rendered DOM nodes against WCAG 2.1 Level AA standards (color contrast 4.5:1 for normal text, 3:1 for large text; form element labeling; image alt text; aria-hidden validity; icon button accessible names; table header associations; modal focus traps).
  - Full coverage across UI states: default, loading, empty, validation error, forbidden, partial, success, and recovery.
  - Negative fixture validation: automated tests ensuring intentionally broken accessibility fixtures fail closed with clear, actionable violation reports (Rule ID, selector, failure summary).
- Define the technical specification for `lighthouse-ci` automated performance auditing:
  - Integration via `@lhci/cli` (pinned at `0.14.0`) driven by version-controlled `lighthouserc.json` at repository root.
  - Auditing exact approved critical routes: `/` (Authentication gateway), `/?tab=dashboard` (Executive dashboard / Operational KPIs), `/?tab=shipments` (Shipment operations table), and `/?tab=reconciliation` (Three ledgers & carrier reconciliation).
  - Auditing exact viewports: Desktop (`1366x768` px, 1.0 device scale factor) and Mobile (`390x844` px, 3.0 device scale factor, simulated 4G throttling).
  - Offline, local execution against built production Next.js assets (`pnpm build` -> local preview server), with zero external network calls and zero telemetry collection (`telemetry_network_behavior: "localhost-only"`).
  - Strict deterministic numeric budgets for Core Web Vitals, category scores, and bundle transfer:
    - Initial JavaScript bundle transfer budget: maximum `750 KB` (`768000` bytes uncompressed, `204800` bytes compressed transfer) per critical route.
    - Desktop (`1366x768`): LCP `<= 2000ms`, TBT / INP proxy `<= 150ms`, CLS `<= 0.05`, FCP `<= 1500ms`, Performance category score `>= 0.85`, Accessibility category score `>= 0.95`.
    - Mobile (`390x844`): LCP `<= 2500ms`, TBT / INP proxy `<= 200ms`, CLS `<= 0.10`, FCP `<= 1800ms`, Performance category score `>= 0.75`, Accessibility category score `>= 0.95`.
    - Best practices category score `>= 0.90`, SEO category score `>= 0.90`.
- Define CI pipeline and root script wiring:
  - Require downstream implementation to wire axe-core accessibility checks into the authoritative root E2E verification command (`pnpm test:e2e`) and Lighthouse CI audits into the authoritative root performance verification command (`pnpm test:perf`).
  - Require `.github/workflows/current-application.yml` to execute these gates on PR HEAD rather than executing only heuristic scanners.
- Define the role separation between automated gates and manual UX review:
  - Automated axe-core checks catch ~30-50% of machine-detectable issues; human/agent manual evidence (keyboard tab order, visible focus ring, screen reader semantics, responsive viewport testing) remains mandatory under `AGENTS.md` and `DESIGN-SYSTEM-UX-RULES.md`.
- Define the manifest promotion criteria for `tools/ecosystem-manifest.json`:
  - Exact 6 criteria to transition `axe-core` and `lighthouse-ci` from `PENDING` to `ADOPTED` and `BLOCKING_GATE` in the subsequent implementation pull request.
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
| `AI-38-R02` | Full UI state accessibility: Accessibility checks must not be limited to static default views; they must validate loading skeletons (`aria-busy="true"`, `role="status"`), empty states, validation error summaries, forbidden screens, interactive modals, and recovery states across all 8 mandatory UI states. |
| `AI-38-R03` | Keyboard focus trap and return: Modals, slide-overs, and confirmation dialogs must trap focus within the container while open and return focus to the triggering element upon dismissal; keyboard-only navigation must remain unblocked. |
| `AI-38-R04` | Non-color-alone status indicator: Status indicators (carrier status, delivery status, reconciliation discrepancy) must convey status via text labels and icons, never relying exclusively on color. |
| `AI-38-R05` | Targeted critical routes and viewport budgets: Lighthouse CI audits execute only against the four designated, approved critical routes (`/`, `/?tab=dashboard`, `/?tab=shipments`, `/?tab=reconciliation`) across two exact viewports: Desktop (`1366x768`) and Mobile (`390x844` with simulated 4G throttling). |
| `AI-38-R06` | Deterministic numeric Core Web Vitals and bundle budgets: Every audited route must satisfy explicit numeric budgets: initial JS bundle transfer `<= 750 KB` (`768000` bytes uncompressed); Desktop LCP `<= 2000ms`, TBT `<= 150ms`, CLS `<= 0.05`, FCP `<= 1500ms`, Perf `>= 0.85`, A11y `>= 0.95`; Mobile LCP `<= 2500ms`, TBT `<= 200ms`, CLS `<= 0.10`, FCP `<= 1800ms`, Perf `>= 0.75`, A11y `>= 0.95`. |
| `AI-38-R07` | Offline, local execution and zero telemetry: Lighthouse CI (`@lhci/cli` pinned `0.14.0`) and axe-core (pinned `4.10.2`) run strictly against locally built and served production Next.js assets (`pnpm build` -> local preview server), with zero external network calls and zero telemetry collection (`telemetry_network_behavior: "none"` for axe-core, `"localhost-only"` for lighthouse-ci). |
| `AI-38-R08` | Complementary manual evidence: Automated accessibility and Lighthouse scores do not replace required visual and manual evidence (PR screenshots, keyboard navigation validation, screen-reader sanity check, responsive testing) under `AGENTS.md` and `DESIGN-SYSTEM-UX-RULES.md`. |
| `AI-38-R09` | Authoritative verification gate integration in CI: Downstream implementation must wire axe-core checks into the authoritative root E2E command (`pnpm test:e2e`) and Lighthouse CI into the authoritative root performance command (`pnpm test:perf`), ensuring `.github/workflows/current-application.yml` runs them as blocking gates on PR HEAD rather than executing only heuristic scanners. |
| `AI-38-R10` | Truthful manifest promotion prerequisites: In `tools/ecosystem-manifest.json`, `axe-core` and `lighthouse-ci` remain `PENDING` and `NON_BLOCKING` until all 6 strict prerequisites (dependency pinning, config paths, CI wiring, green execution, negative proof, and zero warning creep) are committed and verified on PR HEAD. |

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
- Specifies adoption of `axe-core` (`4.10.2`) and `@axe-core/playwright` (`4.10.1`) as devDependencies.
- Specifies adoption of `@lhci/cli` (`0.14.0`) and root `lighthouserc.json`.
- Specifies wiring of E2E test scripts (`pnpm test:e2e`) and performance audit scripts (`pnpm test:perf`) to execute axe-core and Lighthouse CI in CI.
- Specifies eventual promotion in `tools/ecosystem-manifest.json` from `PENDING` to `ADOPTED` and `BLOCKING_GATE`.

## Acceptance matrix

| AC/Test ID | Scenario | Exact Command | Exit Code | Expected Output String | Output Source / Artifact |
|---|---|---|---|---|---|
| `AC-AI-38-01` | Truthful manifest declaration for axe-core | `node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='axe-core'); if(!m \|\| m.lifecycle_state!=='PENDING' \|\| m.blocking_policy!=='NON_BLOCKING' \|\| m.pinned_version_or_commit!=='4.10.2' \|\| m.telemetry_network_behavior!=='none') throw new Error('axe-core truth mismatch'); console.log('axe-core truthfully declared: PENDING, NON_BLOCKING, pinned 4.10.2, zero telemetry');"` | `0` | `axe-core truthfully declared: PENDING, NON_BLOCKING, pinned 4.10.2, zero telemetry` | `tools/ecosystem-manifest.json` |
| `AC-AI-38-02` | Truthful manifest declaration for lighthouse-ci | `node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='lighthouse-ci'); if(!m \|\| m.lifecycle_state!=='PENDING' \|\| m.blocking_policy!=='NON_BLOCKING' \|\| m.pinned_version_or_commit!=='0.14.0' \|\| m.telemetry_network_behavior!=='localhost-only') throw new Error('lighthouse-ci truth mismatch'); console.log('lighthouse-ci truthfully declared: PENDING, NON_BLOCKING, pinned 0.14.0, localhost-only telemetry');"` | `0` | `lighthouse-ci truthfully declared: PENDING, NON_BLOCKING, pinned 0.14.0, localhost-only telemetry` | `tools/ecosystem-manifest.json` |
| `AC-AI-38-03` | Delivery register status truthfulness for TASK-AI-38 (row 171) | `python -c "import csv; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-38']; actual=rows[0]['status']; assert actual=='BLOCKED_DEPENDENCY', f'mismatch: {actual}'; print('Register row 171 status: ' + actual)"` | `0` | `Register row 171 status: BLOCKED_DEPENDENCY` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| `AC-AI-38-04` | Negative proof: unauthorized status advancement fails validation | `python -c "import csv, sys; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-38']; actual=rows[0]['status']; sys.stderr.write(f'UNAUTHORIZED_STATUS_ADVANCEMENT: register is {actual}\n'); sys.exit(1 if actual!='READY_FOR_CODEX' else 0)"` | `1` | `UNAUTHORIZED_STATUS_ADVANCEMENT: register is BLOCKED_DEPENDENCY` | command stderr |
| `AC-AI-38-05` | Negative proof: falsely declaring axe-core ADOPTED triggers QUALITY_GATE_MISSING | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const synthetic = { adopted: [{ id: 'axe-core', role: 'Accessibility testing engine', install_method: 'system', pinned_version_or_commit: '4.10.2', lifecycle_state: 'ADOPTED', blocking_policy: 'BLOCKING_GATE' }] }; const res = auditManifest(synthetic, { onPath: () => false, rootDir: process.cwd() }); if(!res.findings.some(f => f.code === 'QUALITY_GATE_MISSING' && f.severity === 'error')) process.exit(0); console.error('NEGATIVE TEST PROOF: Falsely declaring axe-core ADOPTED triggers QUALITY_GATE_MISSING error'); process.exit(1);"` | `1` | `NEGATIVE TEST PROOF: Falsely declaring axe-core ADOPTED triggers QUALITY_GATE_MISSING error` | command stderr |
| `AC-AI-38-06` | Negative proof: falsely declaring lighthouse-ci ADOPTED triggers QUALITY_GATE_MISSING | `node -e "const { auditManifest } = require('./tools/ai-brain/manifest-audit'); const synthetic = { adopted: [{ id: 'lighthouse-ci', role: 'Automated performance and audit tool', install_method: 'system', pinned_version_or_commit: '0.14.0', lifecycle_state: 'ADOPTED', blocking_policy: 'BLOCKING_GATE' }] }; const res = auditManifest(synthetic, { onPath: () => false, rootDir: process.cwd() }); if(!res.findings.some(f => f.code === 'QUALITY_GATE_MISSING' && f.severity === 'error')) process.exit(0); console.error('NEGATIVE TEST PROOF: Falsely declaring lighthouse-ci ADOPTED triggers QUALITY_GATE_MISSING error'); process.exit(1);"` | `1` | `NEGATIVE TEST PROOF: Falsely declaring lighthouse-ci ADOPTED triggers QUALITY_GATE_MISSING error` | command stderr |
| `AC-AI-38-07` | Invariant check: zero forbidden install lifecycle scripts | `node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); const forbidden=['preinstall','install','postinstall','prepare']; const found = forbidden.filter(s => (r.scripts && r.scripts[s]) \|\| (w.scripts && w.scripts[s])); if(found.length > 0) throw new Error('Forbidden lifecycle script detected: ' + found.join(', ')); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"` | `0` | `Zero forbidden lifecycle scripts present in root and web manifests` | `package.json`, `apps/web/package.json` |
| `AC-AI-38-08` | Negative proof: forbidden install lifecycle script triggers failure | `node -e "const synthetic = { scripts: { postinstall: 'npx axe-core-installer' } }; const forbidden = ['preinstall','install','postinstall','prepare']; const found = forbidden.filter(s => synthetic.scripts[s]); if(found.length > 0) { console.error('FORBIDDEN_LIFECYCLE_SCRIPT: detected ' + found.join(', ')); process.exit(1); }"` | `1` | `FORBIDDEN_LIFECYCLE_SCRIPT: detected postinstall` | command stderr |
| `AC-AI-38-09` | Specification structural integrity (all 16 required sections) | `python -c "content=open('docs/product-spec/work-items/TASK-AI-38.md', encoding='utf-8').read(); required=['## Control','## Business outcome','## Source references','## Preconditions and dependencies','## Author boundary','## In scope','## Out of scope','## Business rules and edge cases','## UI states','## API, event and data impact','## Acceptance matrix','## Downstream implementation acceptance contract','## Manifest promotion criteria','## Verification commands','## Codex review record','## Residual limitations']; missing=[s for s in required if s not in content]; assert not missing, f'Missing sections: {missing}'; print('Specification structural integrity verified: all 16 required sections present');"` | `0` | `Specification structural integrity verified: all 16 required sections present` | `docs/product-spec/work-items/TASK-AI-38.md` |
| `AC-AI-38-10` | Specification contract, numeric thresholds & CI wiring completeness | `python -c "content=open('docs/product-spec/work-items/TASK-AI-38.md', encoding='utf-8').read(); tokens=['4.10.2','0.14.0','768000','2500ms','200ms','0.10','0.05','1366x768','390x844','BLOCKED_DEPENDENCY','AI-38-R01','AI-38-R02','AI-38-R03','AI-38-R04','AI-38-R05','AI-38-R06','AI-38-R07','AI-38-R08','AI-38-R09','AI-38-R10','a11y-failing-fixture.tsx','lighthouserc.json','pnpm test:e2e','pnpm test:perf']; missing=[t for t in tokens if t not in content]; assert not missing, f'Missing required tokens: {missing}'; print('Specification numeric thresholds, viewports, rules AI-38-R01 through R10, and CI wiring verified');"` | `0` | `Specification numeric thresholds, viewports, rules AI-38-R01 through R10, and CI wiring verified` | `docs/product-spec/work-items/TASK-AI-38.md` |
| `AC-AI-38-11` | Manifest audit green with 0 errors and exactly 1 drift warning | `node tools/ai-brain/cli.js manifest` | `0` | `[CẢNH] PINNED_VERSION_DRIFT  (1)` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-38-12` | Register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi, 1 cảnh báo, 161 ghi chú` | `tools/ai-brain/cli.js` stdout |
| `AC-AI-38-13` | Specification and documentation validation | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed: 82 markdown files, 130 feature IDs, 178 delivery rows` | `docs/product-spec/scripts/validate_docs.py` stdout |
| `AC-AI-38-14` | Toolchain unit & integration test suites green | `node --test \"tools/ai-brain/test/*.test.js\" \"tools/ai-dashboard/test/*.test.js\" \"tools/ai-guard/test/*.test.js\"` | `0` | `ℹ pass 458` | Test runner stdout |
| `AC-AI-38-15` | Incremental code and document formatting check | `pnpm format:check` | `0` | `tuân thủ 100% chuẩn định dạng Prettier` | `scripts/verify-formatting.ts` stdout |

## Downstream implementation acceptance contract

When an author implements `TASK-AI-38`, the implementation must provide and satisfy the following deterministic verification contract:

1. **Package pins**:
   - `apps/web/package.json` adds `"axe-core": "4.10.2"` and `"@axe-core/playwright": "4.10.1"` under `devDependencies`.
   - Root `package.json` adds `"@lhci/cli": "0.14.0"` under `devDependencies`.
   - Root and workspace manifests strictly exclude install lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`).
2. **Declarative Lighthouse CI configuration (`lighthouserc.json`)**:
   - `lighthouserc.json` at repository root configures:
     - `ci.collect.numberOfRuns`: 3
     - `ci.collect.startServerCommand`: `pnpm --filter @shipde/web start` (serving local production build)
     - `ci.collect.url`: exactly 4 routes:
       - `http://localhost:3000/`
       - `http://localhost:3000/?tab=dashboard`
       - `http://localhost:3000/?tab=shipments`
       - `http://localhost:3000/?tab=reconciliation`
     - `ci.collect.settings`:
       - Desktop preset: `screenEmulation: { mobile: false, width: 1366, height: 768, deviceScaleFactor: 1 }`
       - Mobile preset: `screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 3 }`, throttling: simulated 4G
     - `ci.assert.assertions`:
       - `categories:performance`: `["error", {"minScore": 0.85}]` (desktop), `0.75` (mobile)
       - `categories:accessibility`: `["error", {"minScore": 0.95}]`
       - `categories:best-practices`: `["error", {"minScore": 0.90}]`
       - `categories:seo`: `["error", {"minScore": 0.90}]`
       - `largest-contentful-paint`: `["error", {"maxNumericValue": 2000}]` (desktop), `2500` (mobile)
       - `total-blocking-time`: `["error", {"maxNumericValue": 150}]` (desktop), `200` (mobile)
       - `cumulative-layout-shift`: `["error", {"maxNumericValue": 0.05}]` (desktop), `0.10` (mobile)
       - `first-contentful-paint`: `["error", {"maxNumericValue": 1500}]` (desktop), `1800` (mobile)
       - `resource-summary:script:size`: `["error", {"maxNumericValue": 768000}]` (750 KB uncompressed transfer)
3. **Audited critical routes & viewports**:
   - Exact routes:
     - `/`: Landing and authentication gateway.
     - `/?tab=dashboard`: Operational Control Tower and metrics summary.
     - `/?tab=shipments`: Parcel dispatch work queue and shipment table.
     - `/?tab=reconciliation`: Three ledgers discrepancy and carrier invoice reconciliation.
   - Exact viewports:
     - Desktop: `1366x768` px.
     - Mobile: `390x844` px.
4. **Deterministic Core Web Vitals & bundle transfer budgets**:
   - Initial JS transfer per critical route: `<= 750 KB` (`768000` bytes uncompressed, `204800` bytes compressed transfer).
   - Desktop (`1366x768`): LCP `<= 2000ms`, TBT `<= 150ms` (lab proxy for INP `<= 200ms`), CLS `<= 0.05`, FCP `<= 1500ms`, Performance category score `>= 0.85`, Accessibility category score `>= 0.95`.
   - Mobile (`390x844`): LCP `<= 2500ms`, TBT `<= 200ms` (lab proxy for INP `<= 200ms`), CLS `<= 0.10`, FCP `<= 1800ms`, Performance category score `>= 0.75`, Accessibility category score `>= 0.95`.
5. **Negative accessibility fixture & fail-closed proof**:
   - Fixture path: `apps/web/src/tests/fixtures/a11y-failing-fixture.tsx`
   - Content: synthetic DOM elements containing intentional critical/serious violations:
     - `<button id="broken-contrast-btn" style={{ background: '#777', color: '#888' }}></button>` (violates `color-contrast` and `button-name`).
     - `<input id="unlabeled-input" type="text" />` (violates `label` / `aria-label`).
   - Test runner: `apps/web/src/tests/a11y-negative.test.ts` executing `@axe-core/playwright` against the rendered fixture.
   - Command: `pnpm --filter @shipde/web test:e2e -- a11y-negative`
   - Expected exit code: `1`
   - Expected failing output: `AXE_ACCESSIBILITY_VIOLATION: Found 2 critical/serious violations: [color-contrast, button-name]`
6. **Clean accessibility E2E suite**:
   - Test runner: `apps/web/src/tests/a11y-wcag.test.ts` auditing rendered DOM across all 8 UI states (default, loading, empty, validation error, forbidden, partial, success, recovery).
   - Command: `pnpm --filter @shipde/web test:e2e -- a11y-wcag`
   - Expected exit code: `0`
   - Expected output: `0 accessibility violations found across 8 UI states`
7. **Negative performance budget fixture & fail-closed proof**:
   - Fixture path: `tests/fixtures/lighthouserc-strict-negative.json` with an unachievable script size budget (`resourceSizes: [{ "resourceType": "script", "budget": 10 }]` - 10 KB budget).
   - Command: `lhci assert --config=tests/fixtures/lighthouserc-strict-negative.json`
   - Expected exit code: `1`
   - Expected failing output: `RESOURCE_BUDGET_EXCEEDED` or `exceeded JS performance budget`
8. **Root script and CI pipeline wiring**:
   - In root `package.json`:
     - `"test:e2e"`: wired to run Playwright E2E suites including `apps/web/src/tests/a11y-wcag.test.ts`.
     - `"test:perf"`: wired to execute `tsx scripts/verify-perf.ts && lhci autorun`.
   - In `.github/workflows/current-application.yml`:
     - Executes `pnpm test` (which invokes `test:perf` with LHCI assertion).
     - Executes `pnpm test:e2e` (which invokes Playwright with axe-core assertion).
     - Both gates block PR merges on failure; tools are never declared `BLOCKING_GATE` while CI runs only heuristic scanners.
9. **Offline execution & zero telemetry invariant**:
   - `@lhci/cli` runs locally with `telemetry_network_behavior: "localhost-only"`.
   - `axe-core` runs offline in local DOM with `telemetry_network_behavior: "none"`.

## Manifest promotion criteria

Promoting `axe-core` and `lighthouse-ci` from `PENDING` to `ADOPTED` and `BLOCKING_GATE` in `tools/ecosystem-manifest.json` strictly requires satisfying all 6 prerequisites with auditable workflow evidence:

1. **Exact-HEAD Execution**: GitHub Actions `Current application checks` passed at the exact 40-character commit SHA of PR HEAD.
2. **Clean Accessibility and Performance Proof**:
   - `pnpm test:e2e` runs Playwright axe-core audits and exits `0` with zero critical or serious accessibility violations.
   - `pnpm test:perf` runs Lighthouse CI audits against all 4 critical routes and exits `0` with all numeric budgets met.
3. **Negative Fixture Fail-Closed Proofs**:
   - Negative accessibility fixture (`apps/web/src/tests/fixtures/a11y-failing-fixture.tsx`) causes `a11y-negative.test.ts` to fail closed with exit code `1`.
   - Negative performance configuration causes LHCI assertion to fail closed with exit code `1`.
4. **Local Offline & Zero Telemetry Invariant**:
   - `@lhci/cli` runs locally with `telemetry_network_behavior: "localhost-only"`.
   - `axe-core` runs offline in local DOM with `telemetry_network_behavior: "none"`.
5. **Supply-Chain Security Invariant**:
   - Zero forbidden lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`) introduced in `package.json` or `apps/web/package.json`.
6. **Manifest Truthfulness and Field Transitions**:
   - In `tools/ecosystem-manifest.json`:
     - `axe-core`: `lifecycle_state` transitions from `"PENDING"` to `"ADOPTED"`, `blocking_policy` transitions from `"NON_BLOCKING"` to `"BLOCKING_GATE"`, `source_of_truth_boundary` updated to `"Enforced via Playwright WCAG 2.1 AA gate in pnpm test:e2e"`.
     - `lighthouse-ci`: `lifecycle_state` transitions from `"PENDING"` to `"ADOPTED"`, `blocking_policy` transitions from `"NON_BLOCKING"` to `"BLOCKING_GATE"`, `source_of_truth_boundary` updated to `"Enforced via lighthouserc.json in pnpm test:perf"`.
   - `node tools/ai-brain/cli.js manifest` passes with 0 errors and exactly 1 warning (the codex-cli version drift).

## Verification commands

```powershell
# Work Item specific & toolchain verification commands:
node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='axe-core'); if(!m || m.lifecycle_state!=='PENDING' || m.blocking_policy!=='NON_BLOCKING' || m.pinned_version_or_commit!=='4.10.2' || m.telemetry_network_behavior!=='none') throw new Error('axe-core truth mismatch'); console.log('axe-core truthfully declared: PENDING, NON_BLOCKING, pinned 4.10.2, zero telemetry');"
node -e "const m=require('./tools/ecosystem-manifest.json').adopted.find(t=>t.id==='lighthouse-ci'); if(!m || m.lifecycle_state!=='PENDING' || m.blocking_policy!=='NON_BLOCKING' || m.pinned_version_or_commit!=='0.14.0' || m.telemetry_network_behavior!=='localhost-only') throw new Error('lighthouse-ci truth mismatch'); console.log('lighthouse-ci truthfully declared: PENDING, NON_BLOCKING, pinned 0.14.0, localhost-only telemetry');"
python -c "import csv; rows=[r for r in csv.DictReader(open('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv', encoding='utf-8')) if r['work_item_id']=='TASK-AI-38']; actual=rows[0]['status']; assert actual=='BLOCKED_DEPENDENCY', f'mismatch: {actual}'; print('Register row 171 status: ' + actual)"
node -e "const r=require('./package.json'), w=require('./apps/web/package.json'); const forbidden=['preinstall','install','postinstall','prepare']; const found = forbidden.filter(s => (r.scripts && r.scripts[s]) || (w.scripts && w.scripts[s])); if(found.length > 0) throw new Error('Forbidden lifecycle script detected: ' + found.join(', ')); console.log('Zero forbidden lifecycle scripts present in root and web manifests');"
python -c "content=open('docs/product-spec/work-items/TASK-AI-38.md', encoding='utf-8').read(); required=['## Control','## Business outcome','## Source references','## Preconditions and dependencies','## Author boundary','## In scope','## Out of scope','## Business rules and edge cases','## UI states','## API, event and data impact','## Acceptance matrix','## Downstream implementation acceptance contract','## Manifest promotion criteria','## Verification commands','## Codex review record','## Residual limitations']; missing=[s for s in required if s not in content]; assert not missing, f'Missing sections: {missing}'; print('Specification structural integrity verified: all 16 required sections present');"
python -c "content=open('docs/product-spec/work-items/TASK-AI-38.md', encoding='utf-8').read(); tokens=['4.10.2','0.14.0','768000','2500ms','200ms','0.10','0.05','1366x768','390x844','BLOCKED_DEPENDENCY','AI-38-R01','AI-38-R02','AI-38-R03','AI-38-R04','AI-38-R05','AI-38-R06','AI-38-R07','AI-38-R08','AI-38-R09','AI-38-R10','a11y-failing-fixture.tsx','lighthouserc.json','pnpm test:e2e','pnpm test:perf']; missing=[t for t in tokens if t not in content]; assert not missing, f'Missing required tokens: {missing}'; print('Specification numeric thresholds, viewports, rules AI-38-R01 through R10, and CI wiring verified');"
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
pnpm format:check
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `c2d6cb6` | `CHANGES_REQUIRED` | Resolved 5 review findings & 3 cross-specification patterns: (1) Pattern 1 / Finding 1: Replaced all vague intention-based acceptance rows (AC-AI-38-01 through 08 citing 'File inspection' or 'Specification text') with 15 reviewer-executable commands specifying exact commands, expected exit codes, expected output strings, and output files/artifacts. (2) Pattern 2 / Finding 3: Replaced unquantified transfer and category score promises with explicit numeric thresholds: 750 KB (768,000 bytes) max initial JS bundle transfer, desktop Core Web Vitals (LCP <= 2000ms, TBT <= 150ms, CLS <= 0.05, FCP <= 1500ms, Perf >= 0.85, A11y >= 0.95), mobile Core Web Vitals (LCP <= 2500ms, TBT <= 200ms, CLS <= 0.10, FCP <= 1800ms, Perf >= 0.75, A11y >= 0.95), and named exact audited routes ('/', '/?tab=dashboard', '/?tab=shipments', '/?tab=reconciliation') and viewports (Desktop 1366x768, Mobile 390x844). (3) Pattern 3 / Finding 2: Negative fixtures specified and verified: unauthorized register status advancement exits 1 with UNAUTHORIZED_STATUS_ADVANCEMENT, prematurely declaring axe-core ADOPTED exits 1 with QUALITY_GATE_MISSING, prematurely declaring lighthouse-ci ADOPTED exits 1 with QUALITY_GATE_MISSING, and forbidden install lifecycle script exits 1 with FORBIDDEN_LIFECYCLE_SCRIPT. Downstream contract defines exact negative fixture apps/web/src/tests/fixtures/a11y-failing-fixture.tsx failing closed with exit code 1. (4) Finding 4: Defined exact downstream implementation acceptance contract and 6 non-negotiable manifest promotion prerequisites with dependency paths, config paths, commands, exit codes, and manifest field transitions. (5) Finding 5 / Inline Review Comment: Asserted the exact manifest warning baseline of zero errors and exactly 1 warning for the human-approved codex-cli version drift ([CẢNH] PINNED_VERSION_DRIFT (1) naming codex-cli). (6) CI & Root Script Wiring: Addressed delegation of 'pnpm test' to heuristic scanners by mandating downstream integration of axe-core into 'pnpm test:e2e' and Lighthouse CI into 'pnpm test:perf' and .github/workflows/current-application.yml so tools cannot be declared BLOCKING_GATE while CI executes only heuristic scripts. (7) Authority Alignment: Aligned Control table status to authoritative delivery register row 171 (BLOCKED_DEPENDENCY). |
| 2 | `HEAD` | `READY_FOR_CODEX` | Pending fresh independent Codex review |

## Residual limitations

- Delivery register row 171 reflects `BLOCKED_DEPENDENCY` awaiting automated write-back by `TASK-AI-19` reconciler; the Work Item specification respects register authority and remains at `BLOCKED_DEPENDENCY` until advanced through governed workflow.
- Automated accessibility audits using axe-core detect approximately 30% to 50% of potential accessibility barriers (such as color contrast, attribute syntax, and basic DOM relationships); complex logical flows, meaningful screen reader announcements, and keyboard ergonomics require human and manual agent review during UI feature development under `AGENTS.md` and `DESIGN-SYSTEM-UX-RULES.md`.
- Specification does not modify `.github/` workflows or root `package.json` directly in this specification Work Item; actual script wiring, dependency installation, and manifest promotion are strictly gated to the downstream implementation phase to honor repository change boundaries and prevent premature gate claims.
- Lighthouse CI performance scores can exhibit minor variance in shared CI runners due to CPU throttling or resource contention; performance budgets establish deterministic thresholds with appropriate margins to prevent false positive flakiness while strictly blocking regressions.
