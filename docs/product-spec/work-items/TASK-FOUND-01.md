# TASK-FOUND-01 — Freeze and classify the current prototype

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-FOUND-01` |
| Feature ID | `N/A — repository foundation` |
| Status | `READY_FOR_ZCODE` |
| Delivery order | `1` |
| Dependencies | `None` |
| Author | `ZCode` |
| Reviewer | `Codex` |
| Branch | `feat/task-found-01-freeze-prototype` |
| Pull Request | `Pending` |

## Business outcome

Create an evidence-based baseline of what the current Ship Dễ repository really implements before structural migration or new feature work. The product owner and later developer must be able to distinguish real backend behavior from partial logic, demo-only UI and absent functionality without relying on screenshots or agent claims.

## Source references

- Root `AGENTS.md` and its repository baseline, role separation and Definition of a complete feature.
- `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — all 130 product features.
- `docs/product-spec/docs/00-control/TRACEABILITY.md`.
- `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md`.
- `docs/product-spec/docs/07-ai-build/DEFINITION-OF-READY-DONE.md`.
- Current root `package.json`, `src/`, `prisma/`, `scripts/` and existing tests at planning base commit `31a75ae4a62f0256f71670c8b2af70b456abddec`.

## Preconditions and dependencies

- Start from the prepared branch and do not rebase onto an unreviewed code change.
- Use the current npm/Next.js repository commands; monorepo migration belongs to TASK-FOUND-02.
- Do not use production carrier credentials, production data or hidden environment values.

## In scope

1. Inventory every tracked application area: routes, pages, components, contexts, services, adapters, core engines, server/API handlers, domain types, Prisma models, scripts and tests.
2. Create `docs/product-spec/evidence/CURRENT-IMPLEMENTATION-INVENTORY.md` mapping every one of the 130 `FEAT-*` IDs to exactly one classification with file/line evidence:
   - `REAL`: real server/persistence/permission behavior and relevant tests satisfy the feature's present scope.
   - `PARTIAL`: some real layers exist, but one or more required layers or acceptance paths are missing.
   - `DEMO_ONLY`: hard-coded, in-memory, simulated, client-only or success UI without a committed external/persistent outcome.
   - `ABSENT`: no implementation evidence found.
   - `UNKNOWN`: evidence could not be established; never upgrade UNKNOWN to REAL by inference.
3. For every non-ABSENT row, list implemented layers and missing layers: UI, API/application, persistence, authorization/tenant scope, audit, external adapter and tests.
4. Create `docs/product-spec/evidence/PROTOTYPE-GAPS-AND-RISKS.md` covering hard-coded data, simulated carrier behavior, in-memory mutations, incomplete authentication/tenant boundaries, test realism, migration risks and reusable UI assets.
5. Add the smallest reliable baseline smoke tests needed to detect accidental loss of current visible/navigation behavior during TASK-FOUND-02. Tests may observe existing behavior but must not legitimize demo data as production behavior.
6. Run and record every verification command with exact result, duration and failure evidence.

## Out of scope

- No npm-to-pnpm or monorepo migration.
- No UI redesign or visual restyling.
- No implementation of FEAT-* business behavior.
- No new live carrier, OMS, bank or notification integration.
- No Prisma schema migration or production data rewrite.
- No broad refactor merely to make the inventory look cleaner.

## Rules and edge cases

- A rendered screen or clickable button alone is DEMO_ONLY unless the complete required outcome is evidenced.
- Code using exported master arrays, browser memory, artificial timeout, generated tracking numbers or mock credentials is not REAL production behavior.
- A Prisma model without a proven runtime write/read path is PARTIAL, not REAL.
- A test that reimplements expected logic inside the test instead of exercising production code is weak evidence and must be called out.
- Existing code can be reusable even when classified DEMO_ONLY; classification is not a deletion instruction.
- Findings must cite paths and symbols or line ranges. Generic statements such as “backend exists” are invalid.

## UI states

No user-facing behavior change is expected. Baseline smoke coverage must at least observe authentication entry, role-aware shell/navigation, dashboard, shipment list/detail or tracking entry, create-shipment entry, exception workbox, reconciliation, returns and settings surfaces when present. Record inaccessible or broken flows instead of silently fixing them.

## API, event and data impact

- No API contract or database behavior change is allowed.
- Test-only fixtures and harness configuration are allowed when isolated from production runtime.
- Documentation output must explain which current API/routes and Prisma models are actually exercised.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-FOUND-01-01 | Clean checkout verification | Current install, lint, build and E2E commands have truthful pass/fail records | Command log in PR and inventory document |
| AC-FOUND-01-02 | Repository inventory | Every tracked application area is represented with path evidence | Inventory section and file counts |
| AC-FOUND-01-03 | Feature coverage | All 130 catalog feature IDs occur exactly once in the implementation matrix | Automated coverage check |
| AC-FOUND-01-04 | Reality classification | Hard-coded/in-memory/simulated paths are never classified REAL | Evidence for representative UI store, auth, order/quote and carrier paths |
| AC-FOUND-01-05 | Preservation harness | Critical currently visible flows have repeatable baseline smoke evidence | Tests plus result log/screenshots where applicable |
| AC-FOUND-01-06 | Scope safety | No product behavior, schema or architecture migration is introduced | PR diff review |
| AC-FOUND-01-07 | Migration input | TASK-FOUND-02 receives explicit reusable assets, gaps and risks | Gaps-and-risks document |

## Verification commands

- `npm ci`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`
- `python3 docs/product-spec/scripts/validate_docs.py`
- `git diff --check`
- Any new baseline test command added in this Work Item, documented in `package.json` and the PR.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `Pending` | `Pending` |

## Residual limitations

None may be declared only after every repository area and all 130 feature IDs are classified. External live behavior that cannot be verified must remain UNKNOWN or DEMO_ONLY and be listed as a migration risk.
