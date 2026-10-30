# TASK-FOUND-04 — Establish contracts and quality gates

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-FOUND-04`                                                                                                                                                                                                                                                                                                                                                           |
| Feature ID      | `N/A — repository foundation for EPIC-FND`                                                                                                                                                                                                                                                                                                                                |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                                                                                                         |
| Delivery order  | `4`                                                                                                                                                                                                                                                                                                                                                                       |
| Dependencies    | `TASK-FOUND-03` — `MERGED` by PR `#8` at `ff1dbc770257b1a581b51951ab481ad037ed3ed1`                                                                                                                                                                                                                                                                                       |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                                                                                                                                                  |
| Risk            | `HIGH`                                                                                                                                                                                                                                                                                                                                                                    |
| Allowed paths   | `docs/product-spec/work-items/TASK-FOUND-04.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `package.json`; `pnpm-lock.yaml`; `turbo.json`; `packages/contracts/**`; `packages/testkit/**`; `packages/config/**`; `apps/web/**`; `apps/api/**`; `apps/worker/**`; `.github/workflows/**`; `scripts/**`; `docs/product-spec/contracts/**` |
| Branch          | `feat/task-found-04-contracts-quality-gates`                                                                                                                                                                                                                                                                                                                              |
| Pull Request    | `#13`                                                                                                                                                                                                                                                                                                                                                                     |

## Business outcome

Establish the shared OpenAPI type generation, contract drift validation, testing harnesses (Vitest unit, Supertest integration, Playwright E2E), deterministic mock carrier adapters, MSW network simulation handlers, and CI quality gates so that every subsequent vertical product feature is built, tested, and reviewed against authoritative contracts and automated quality gates.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/FOUNDATION-WORK-ITEMS.md` — outcome, scope, and promotion rule for TASK-FOUND-04.
- `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md` — target stack commands, package structure, and code boundaries.
- `docs/product-spec/docs/08-testing/TEST-STRATEGY.md` — test pyramids, contract gates, MSW mocks, and deterministic fixtures.
- `docs/product-spec/docs/09-delivery/CI-CD-DEPLOYMENT.md` — CI gate definitions, secret scanning, and pull request verification.
- `docs/product-spec/contracts/openapi.yaml` — OpenAPI 3.1 specification source of truth.

## Acceptance criteria

- `AC-FOUND-04-01`: OpenAPI TypeScript definitions are generated automatically from `docs/product-spec/contracts/openapi.yaml` into `@shipde/contracts` with zero manual editing.
- `AC-FOUND-04-02`: A strict contract drift check (`pnpm contract:check`) verifies that generated TypeScript types match `openapi.yaml`, failing closed if specification and implementation diverge.
- `AC-FOUND-04-03`: `@shipde/testkit` provides deterministic carrier adapter mocks (GHN, GHTK, ViettelPost) with simulated success, validation error, network timeout, and rate limit responses without external network access.
- `AC-FOUND-04-04`: `@shipde/testkit` exports MSW (Mock Service Worker) handlers covering loading, empty, validation error, forbidden, partial, success, and recovery states for the web console.
- `AC-FOUND-04-05`: Supertest and NestJS testing harnesses are configured for `apps/api` and `apps/worker` to execute isolated integration tests against test databases.
- `AC-FOUND-04-06`: Automated database test isolation and reset scripts (`pnpm db:reset` / test transaction rollbacks) prevent test pollution across suites.
- `AC-FOUND-04-07`: CI pipeline enforces contract check, formatting, linting, typechecking, secrets scanning, unit/integration test suites, and build before merge readiness.
- `AC-FOUND-04-08`: Negative fixture tests confirm that intentionally broken contracts, leaked secrets, or accessibility defects fail the respective CI gate.

## Acceptance evidence

### 1. Contract generation and drift check

- Command: `pnpm contract:check`
- Output:
  ```
  📜 SHIP DỄ — BỘ KIỂM SOÁT VÀ KIỂM TOÁN HỢP ĐỒNG (OPENAPI CONTRACT GATE)
  ✅ OpenAPI Spec Version: 3.1.0
  ✅ Tổng số endpoints đã xác thực: 20
  ✅ Hợp đồng TypeScript (@shipde/contracts) đồng bộ 100% với openapi.yaml (Không có drift).
  ```

### 2. Carrier Mocks and MSW Handlers in `@shipde/testkit`

- Tested via: `packages/testkit/src/carriers/carrier-mock.test.ts` and `packages/testkit/src/msw/msw.test.ts`
- Modes verified: `SUCCESS`, `VALIDATION_ERROR`, `RATE_LIMIT`, `TIMEOUT`.
- Network states verified: `LOADING`, `EMPTY`, `ERROR`, `FORBIDDEN`, `PARTIAL`, `SUCCESS`, `RECOVERY`.

### 3. Negative Fixtures and CI Quality Gates Fail-Closed

- Tested via: `packages/testkit/src/quality-gates.test.ts`
- Results:
  - Missing routes or invalid schemas in OpenAPI spec: caught and failed.
  - Contract drift between spec and TypeScript types: detected and failed.
  - Accessibility missing `aria-label` or missing `alt`: caught and failed.
  - Visual baseline regression: caught and failed.
  - Performance budget violations: caught and failed.

### 4. Full Quality Gate Verification Suite

- `pnpm format:check`: PASS (All 28 modified files compliant).
- `pnpm lint`: PASS (7 packages, 11 tasks successful).
- `pnpm typecheck`: PASS (11 tasks successful, 0 errors).
- `pnpm test`: PASS (turbo test + test:audit + contract:check + test:a11y + test:visual + test:perf).
- `pnpm build`: PASS (Prisma generate + Turbopack Next.js build).
- `pnpm test:baseline`: PASS (10/10 preservation smoke surfaces).
- `pnpm security:secrets`: PASS (Gitleaks scan clean, 0 secrets).

## Follow-up (2026-10-30): Adoption Gaps Closure — Storybook & Vercel Skills

### 1. Context & Motivation

Audit on 2026-10-30 identified adoption gaps from the original foundation delivery:
1. `Storybook` was classified as `ADOPT IN TASK-FOUND-04` in `AI-TOOLCHAIN-DECISIONS.md` and `PENDING` in `tools/ecosystem-manifest.json`, but lacked dependency pinning, stories, and a CI build step in `apps/web`.
2. `Vercel agent skills` was classified as `AUDIT AND PIN IN TASK-FOUND-04`, but required formal audit verification, commit pinning, checksum registration, and specification boundary documentation.

### 2. Implementation & Resolution

#### A. Storybook Component Catalog & Quality Gate
- **Dependencies & Workspace**:
  - Pinned in `apps/web`: `@storybook/react-vite@8.6.0`, `@storybook/addon-a11y@8.6.0`, `vite@^8.3.5`, `storybook@8.6.0`, `@storybook/react@8.6.0`, `@storybook/addon-highlight@8.6.0`.
  - Applied patch `patches/@storybook__core@8.6.0.patch` via `pnpm patch` to prevent Windows sandboxed ACL traversal (`desktop-vi13ka6\agy07` boundary) and resolve internal core modules.
- **Root Package Scripts (AGENTS.md compliance)**:
  - `pnpm storybook`: Starts local development server on port 6006 with telemetry disabled.
  - `pnpm storybook:build`: Compiles static visual catalog into `apps/web/storybook-static/` with telemetry disabled.
- **Shared Component Stories (`apps/web/src/components/ui/`)**:
  - `DataTable.stories.tsx`: Covers `Success` (with interactive selection and pagination), `Loading` skeleton, and `Empty` placeholder states.
  - `OperationalComponents.stories.tsx`:
    - `StatusBadges`: Success (`DELIVERED`), In-Transit (`IN_TRANSIT`), Warning (`ATTENTION_REQUIRED`), Error (`DISCREPANCY_DETECTED`).
    - `EmptyStates`: Default empty, Filtered empty, Error with recovery action.
    - `MoneyFormats`: Confirmed positive/negative, Pending, Estimated (four-tier money rule compliance).
    - `TrackingCodes`: Single code, multi-package list with clipboard actions.
    - `AutomationTiers`: L2 Full Automation, L1 Semi-Automation, L0 Manual.
    - `Dialogs`: Confirm, Danger, and Reason Required operational modal dialogs.
- **CI Pipeline Step**:
  - Added `- name: Build Storybook component catalog` (`run: pnpm storybook:build`) in `.github/workflows/current-application.yml` directly after `pnpm build`.
- **Ecosystem Manifest Promotion**:
  - Promoted `storybook` and `storybook-addon-a11y` in `tools/ecosystem-manifest.json` from `PENDING`/`DEFERRED` to `ADOPTED`.

#### B. Vercel Agent Skills Audit & Pinning
- **Upstream Source**: `vercel-labs/agent-skills`
- **Pinned Commit SHA**: `063bee94c3f4df8453406c830b0a7df0f2860278`
- **Vendored Location**: `tools/ai-brain/skills/vercel/`
- **Vendored Assets & Integrity Hashes**:
  - `react-best-practices/SKILL.md`: sha256 `71ed7794962fa6e803ee83030517b5b93a9f70fbfeb431ec4535c5480a8d8355`
  - `web-interface-guidelines/command.md`: sha256 `d246b026f4f29b5823a9cc857f9edf3d2507002e055e32040cadeaf3b38e0234` (from `vercel-labs/web-interface-guidelines@434b7f91364665f2f733b310ec54809bf8f37937`)
  - `web-interface-guidelines/LICENSE`: sha256 `6cd1609c9c12233507cdd2ce0d32e9a721e3c27494951be06b90090deeeb7af2`
- **Audit Findings & Policy Boundaries**:
  - License: MIT License confirmed.
  - Advisory Authority Boundary: Advisory guidance only. Ship Dễ domain models, state coverage, VN currency arithmetic, and `DESIGN-SYSTEM-UX-RULES.md` remain authoritative.
  - Delivery Boundary: Injection only through locked pack in `tools/ai-brain/skill-pack.js` to UI feature roles; no unpinned external network calls permitted during review or execution.

### 3. Verification
- `pnpm storybook:build`: PASS (Exit code 0, 11 component entries indexed into static catalog in ~4.8s).
- `pnpm --filter @shipde/web typecheck`: PASS.
- `pnpm --filter @shipde/web lint`: PASS.
- `pnpm --filter @shipde/web test`: PASS.
- `node tools/ai-brain/manifest-audit.js`: PASS (Zero errors/warnings for storybook).
