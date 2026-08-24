# Ship Dễ — Shared Agent Contract

This file is the shared operating contract for every coding agent working in the Ship Dễ repository. Codex prepares the executable Work Item, ZCode implements it, a fresh Codex review task independently verifies it, and a human is the merge owner.

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current feature Work Item and its acceptance scenarios
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and register the conflict; do not silently choose one.

## Repository baseline

The current root application is a Next.js/React/Prisma prototype. A visible screen, mock array, hard-coded quote, simulated carrier action or in-memory mutation is not proof that a feature is complete. The target architecture is defined in `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md` and must be reached through the reviewed foundation Work Items without discarding useful UI behavior.

Before the foundation migration, validate with the commands present in the current root `package.json`. After migration, the root commands in the target stack document become authoritative. Any command change must update this file and CI in the same Pull Request.

## Role separation

- **Codex — planner/BA:** selects the next dependency-ready feature, creates its feature branch, completes the Work Item from the product documents, closes or exposes business gaps, and changes the register to `READY_FOR_ZCODE` on that branch. It does not implement production code in this planning step.
- **ZCode — author:** plans the technical implementation and implements exactly one prepared Work Item, adds tests and evidence, pushes a feature branch and opens a Pull Request.
- **Codex — reviewer:** uses a new review-only task to review the Pull Request against the Work Item and source specifications, runs or inspects verification, and returns `PASS`, `CHANGES_REQUIRED` or `BLOCKED`. It does not merge and does not silently fix the author's branch during review.
- **Human — merge owner:** resolves product decisions, accepts residual risk and merges only after CI is green and Codex returns `PASS`.

The author must never mark its own work approved. A feature is not complete because ZCode says it is complete.

## Unit of delivery

- One branch and one Pull Request contain exactly one `FEAT-*` or one `TASK-FOUND-*` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.
- Do not start the next Work Item until the current Pull Request is merged or explicitly parked as `BLOCKED`.

Required status flow:

`BACKLOG -> BLOCKED_BY_FOUNDATION -> READY_FOR_ZCODE -> IN_PROGRESS -> READY_FOR_CODEX -> CHANGES_REQUIRED -> READY_FOR_CODEX -> CODEX_PASS -> MERGED`

`BLOCKED` may be entered from any active state with a written reason and evidence.

## Definition of a complete feature

A feature is vertical, not UI-only. Where applicable it includes:

- user-visible flow and loading, empty, validation, error, forbidden and success states;
- API/application behavior and canonical errors;
- persistence, migrations and seed/test fixtures;
- tenant scope, authorization, audit and sensitive-data handling;
- external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- unit, integration and end-to-end acceptance evidence;
- OpenAPI/schema, traceability and operational documentation updates.

No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.

The existing `.agents/rules/ponytail.md` may guide reuse and avoidance of
speculative code, but it never overrides Work Item completeness, the approved
architecture, business rules or the Ship Dễ visual/UX standard.

## Current pre-foundation verification

Until TASK-FOUND-02 replaces the package layout, run at minimum:

- `npm ci`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`

After the migration, use the root pnpm commands defined in the target stack
document and updated CI.

## Pull Request evidence

Every Pull Request must contain:

- exactly one Work Item ID and Feature ID;
- source document links and business outcome;
- acceptance matrix with pass/fail evidence;
- files, migrations, API routes, jobs and screens changed;
- commands run and exact results;
- screenshots for changed user-facing states;
- external API evidence level and fallback behavior;
- security, tenancy, idempotency and regression notes;
- known limitations; an empty section must explicitly say `None`.

## Code Review Rules

### Business completeness

- Reject an implementation that covers only the happy path or only the screen while the Work Item requires backend, persistence, permission, state or tests.
- Reject behavior that contradicts the feature's business rule, state machine, actor or acceptance scenario even if the code is clean.
- Reject a claim of completion when evidence is simulated, hard-coded or only stored in client memory.

### Carrier integrations

- Never infer carrier capability. Unsupported, unavailable, unverified and timed-out are distinct outcomes.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; flag any blind retry that can duplicate an external effect.
- Carrier quote, approved contract rate and final settlement deduction must remain separate evidence layers.

### Money and reconciliation

- VND must not use floating-point arithmetic.
- Processing status and financial findings are separate dimensions.
- Suspected, verified, carrier-accepted and bank-received amounts must not be collapsed.
- Bank receipt is required before money is called received.

### Security and tenancy

- Every tenant-owned read and write must be scoped server-side; never trust client-supplied shop, branch, warehouse or carrier-account ownership.
- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- High-risk actions require the approval and audit behavior defined in the specifications.

### User experience

- Reject disconnected buttons, placeholder data presented as live, missing recovery paths, inaccessible controls or mobile layouts that block the primary task.
- When no carrier can serve an address, the UI must explain known reasons and offer edit, retry, draft or documented manual fallback; API failure must not be shown as route unsupported.

### Verification

- New behavior requires tests at the lowest useful level plus the Work Item's acceptance path.
- A changed contract requires consumer, schema and compatibility checks.
- Formatting and lint belong to CI; review should focus on consequential correctness, security and specification gaps.

## Required handoff documents

- Workflow: `docs/product-spec/docs/10-ai-collaboration/ZCODE-CODEX-WORKFLOW.md`
- Queue: `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- Work Item template: `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`
- Codex planning prompt: `docs/product-spec/docs/10-ai-collaboration/CODEX-PLANNING-PROMPT.md`
- ZCode prompt: `docs/product-spec/docs/10-ai-collaboration/ZCODE-START-PROMPT.md`
- Codex prompt: `docs/product-spec/docs/10-ai-collaboration/CODEX-REVIEW-PROMPT.md`
