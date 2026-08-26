# Ship Dễ — Shared Agent Contract

This is the operating contract for every AI and human working in the Ship Dễ repository. Delivery is human-gated and semi-automatic: GitHub is the durable handoff channel, the versioned controller derives the next safe stage, implementation authors work in isolated worktrees, CI verifies every Pull Request, and a fresh Codex task independently reviews each Work Item before the human merges it.

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## Repository baseline

The current root application is a Next.js/React/Prisma prototype. A visible screen, mock array, hard-coded quote, simulated carrier action or in-memory mutation is not proof that a feature is complete. The target architecture is defined in `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md` and must be reached through reviewed foundation Work Items without discarding useful UI behavior.

Before the foundation migration, validate with the commands present in the current root `package.json`. After migration, the root commands in the target stack document become authoritative. Any command change must update this file and CI in the same Pull Request.

## Semi-automatic workspaces

- `shipde-platform` / `main`: integration baseline; implementation agents must not edit it directly.
- `shipde-dsh`: low-risk author using DSH/OpenCode through 9Router.
- `shipde-gemini`: primary implementation author.
- `shipde-codex`: independent planning, documentation and review workspace.

Never assume chat history is shared. The Work Item, branch, commits, Pull Request, CI evidence and review comments are the complete handoff package. `scripts/ai/control.ps1` may route these artifacts, but it may not invent product meaning, bypass a dirty worktree, approve a failed gate or merge.

## Role separation

- **Claude — business and solution analyst:** proposes business/solution changes only. It does not implement production code or mark a Work Item ready. Material decisions require human approval and versioned specification updates.
- **Codex — planner/document owner:** selects the next dependency-ready item, prepares its complete Work Item from approved sources, chooses `GEMINI` or `9ROUTER` as author, and changes the register to `READY_FOR_AUTHOR`. It does not implement production code during planning.
- **9Router worker — constrained author:** handles only explicitly assigned, low-risk, deterministic work such as fixtures, mocks, types, small CRUD, focused tests, lint or mechanical changes. It must stop when scope reaches architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical product Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** uses a fresh review-only task, checks the full Pull Request against the Work Item and source specifications, and returns `PASS`, `CHANGES_REQUIRED` or `BLOCKED`. It does not merge or silently fix the author's branch during review.
- **Human — product and merge owner:** resolves product decisions, triggers each controller gate, accepts residual risk and merges only after CI is green and Codex returns `PASS`.

The author never approves its own work. A feature is not complete because an author says it is complete.

## Author routing

Assign `9ROUTER` only when all of the following are true:

- behavior is already fully specified;
- allowed files and expected output are bounded;
- deterministic tests can prove completion;
- no high-risk domain listed above is touched;
- failure can be safely escalated to Gemini without partial external effects.

Assign `GEMINI` for all foundation migrations, complete product features, cross-layer work, UI composition and any task that does not satisfy every 9Router condition. Two failed 9Router attempts require escalation; do not keep retrying to save credits.

## Unit of delivery

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*` or `TASK-AI-*` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.
- Keep one active implementation Work Item until the workflow is proven stable.

Required status flow:

`BACKLOG -> BLOCKED_BY_FOUNDATION/BLOCKED_DEPENDENCY -> READY_FOR_AUTHOR -> IN_PROGRESS -> READY_FOR_CODEX -> CHANGES_REQUIRED -> READY_FOR_CODEX -> CODEX_PASS -> MERGED`

`BLOCKED` may be entered from any active state with a written reason and evidence.

## Definition of a complete feature

A feature is vertical, not UI-only. Where applicable it includes:

- user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- API/application behavior and canonical errors;
- persistence, migrations and seed/test fixtures;
- tenant scope, authorization, audit and sensitive-data handling;
- external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- unit, integration and end-to-end acceptance evidence;
- OpenAPI/schema, traceability and operational documentation updates.

No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.

## UI quality rule

Do not use Ponytail or another global minimalism/taste prompt as product or UX authority. Reuse existing components only when they satisfy the approved screen specification and full state coverage. User-facing work must follow `DESIGN.md` once approved and, until then, `docs/product-spec/docs/03-ux/DESIGN-SYSTEM-UX-RULES.md` plus the relevant screen specification. Generic AI dashboards, disconnected controls and missing recovery paths must be rejected.

## 9Router request policy

The 9Router endpoint used by DSH must keep Ponytail, Caveman, Headroom and request logging disabled. RTK may compress tool output only for assigned low-risk work and must be disabled while investigating failed tests, full logs or evidence-sensitive diffs. No router optimization may alter the Work Item, business rules, acceptance evidence or UI state coverage.

## Current pre-foundation verification

Until `TASK-FOUND-02` replaces the package layout, run at minimum:

- `npm ci`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`

After migration, use the root commands defined in the target stack document and updated CI.

## Pull Request evidence

Every Pull Request must contain:

- exactly one Work Item ID and Feature ID;
- assigned implementation author and reviewed commit;
- source document links and business outcome;
- acceptance matrix with pass/fail evidence;
- files, migrations, API routes, jobs and screens changed;
- commands run and exact results;
- screenshots for changed user-facing states;
- external API evidence level and fallback behavior;
- security, tenancy, idempotency and regression notes;
- known limitations; an empty section must explicitly say `None`.

## Code review rules

### Business completeness

- Reject an implementation that covers only the happy path or only the screen while the Work Item requires backend, persistence, permission, state or tests.
- Reject behavior that contradicts the feature's rule, state machine, actor or acceptance scenario even if the code is clean.
- Reject completion claims based on simulation, hard-coded production behavior or client-only state.

### Carrier integrations

- Never infer carrier capability. Unsupported, unavailable, unverified and timed-out are distinct outcomes.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- Carrier quote, approved contract rate and final settlement deduction remain separate evidence layers.

### Money and reconciliation

- VND must not use floating-point arithmetic.
- Processing status and financial findings are separate dimensions.
- Suspected, verified, carrier-accepted and bank-received amounts must not be collapsed.
- Bank receipt is required before money is called received.

### Security and tenancy

- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- High-risk actions require the approval and audit behavior defined in the specifications.

### User experience

- Reject disconnected buttons, placeholder data presented as live, inaccessible controls or mobile layouts that block the primary task.
- When no carrier can serve an address, explain known reasons and offer edit, retry, draft or documented manual fallback; API failure must not be shown as route unsupported.

### Verification

- New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- A changed contract requires consumer, schema and compatibility checks.
- Formatting and lint belong to CI; review focuses on consequential correctness, security and specification gaps.

## Required handoff documents

- Workflow: `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`
- Queue: `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- Work Item template: `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`
- Codex planning prompt: `docs/product-spec/docs/10-ai-collaboration/CODEX-PLANNING-PROMPT.md`
- Gemini prompt: `docs/product-spec/docs/10-ai-collaboration/GEMINI-START-PROMPT.md`
- 9Router prompt: `docs/product-spec/docs/10-ai-collaboration/NINEROUTER-START-PROMPT.md`
- Codex review prompt: `docs/product-spec/docs/10-ai-collaboration/CODEX-REVIEW-PROMPT.md`
- Toolchain decisions: `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`
- Repository and CLI manifest: `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md`
- Windows setup runbook: `docs/product-spec/docs/10-ai-collaboration/WINDOWS-SETUP-RUNBOOK.md`
- Safe control scripts: `scripts/ai/README.md`
