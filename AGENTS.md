# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

The contract gate picks the route from the actual diff and the policy at the protected base (`docs/product-spec/scripts/pr_contract_policy.json`). The title, body or labels never lower the route. Every Pull Request still needs required CI and an independent review of the exact head.

- **Maintenance route (Tier A).** Every changed path must be inside the policy's maintenance scope: docs outside the product specification, `.evidence`, AI-brain tests, and deletion of `MERGED`/`SUPERSEDED` Work Items with only their register `work_item_path` cleared. Title the PR `chore:`, `docs:`, `refactor:` or `fix:`. Give `## Goal`, `## Scope` and `## Verification` in the body. Do not create a Work Item file or register row.
- **Maintenance & tooling governance route (Tier G).** A PR uses Tier G when every changed path matches a scoped tooling/docs/governance rule (`scripts/**`, `tools/**`, `docs/product-spec/docs/10-ai-collaboration/**`, `docs/product-spec/evidence/**`, root `AGENTS.md`/`CLAUDE.md`) or Tier A maintenance. Tier G never covers `apps/`, `packages/`, `package.json`/`pnpm-lock.yaml`, Prisma, OpenAPI/contracts, normative product/decision docs (`00-control`..`09-delivery`), `.github/`, CI/security gate scripts (`scripts/verify-trivy.ts`, `scripts/ai/control.ps1`, `scripts/ai/prepush-check.mjs`, `tools/openspec-check/**`, `tools/k6/**`, `tools/controller-eval/**`, `tools/semgrep/**`, `check-no-hardcode.mjs`, `hardcode-allowlist.json`, `.gitleaks*`, `.semgrep*`, `lefthook.yml`), the contract validator/policy itself, renames/copies across protected paths, type changes, or widening `hardcode-baseline.json`. Title `chore:`, `docs:`, `refactor:` or `fix:`. Give `## Goal`, `## Scope`, `## Preservation`, `## Verification` and `Review status: READY_FOR_CODEX` in the body. Do not create a Work Item file or register row; independent exact-SHA review and required CI still apply.
- **Work Item route (Tier B).** This applies to product behavior and security/gate infrastructure: `apps/`, `packages/`, Prisma, infra, OpenAPI/contracts, auth, tenant, money, carrier, workflows, security/gate configs, the contract validator/policy, and unknown or mixed paths. Use the rules below.
- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Shared coding guidelines

These practices apply to authors and reviewers using any model. Adapted from [Karpathy-inspired coding guidelines](https://github.com/multica-ai/andrej-karpathy-skills) (MIT). Ship Dễ's source-of-truth order and role boundaries above still apply.

- **Think before coding.** State assumptions that affect the result. Resolve conflicting evidence before editing; raise consequential ambiguity with the operator.
- **Keep the solution small.** Reuse existing code, tools and tests. Add abstractions or dependencies only when the work item needs them.
- **Make focused edits.** Keep every change tied to the work item. Follow local style, preserve unrelated behavior, and remove only dead code introduced by your change.
- **Define and verify success.** Name the expected behavior and the smallest useful check. Report what ran, what passed, and what remains unverified. Scale the process to the task.

For delegated work, include these four rules or explicitly tell the worker to read this section of `AGENTS.md` from its assigned checkout. Review against the work item and actual diff and test evidence.

## Operating OS (compact recovery, routing, retry & hygiene)

- **Compact / session recovery:** After `/compact` or starting a new session on an active Work Item, re-anchor state before editing: `node tools/ai-brain/resume-status.js --wi <ID> --checkpoint <PATH> --checkout <PATH>`.
- **Handoff readiness:** Before authoring a new Work Item, validate metadata and scope: `node tools/ai-brain/validate-work-item.js --wi <ID> --file <PATH> --register <REG> --strict`.
- **Difficulty routing (`L1`–`L4`):**
  - `L1` (1–3 low-risk files) / `L2` (4–8 file standard vertical) → standard author + cross-family independent review.
  - `L3` (multi-table, migration, webhook, job) → high-tier author + high-tier cross-family review.
  - `L4` (money VND, auth, RBAC, tenant isolation, gate/security) → strongest cross-family pair + explicit human sign-off.
- **Reuse Gate (3 tiers):** Prefer (1) existing repo modules → (2) approved dependencies in `package.json` → (3) external OSS compliant with the repository license/security policy (record source URL, pinned version/commit and exact SPDX identifier in the Work Item and PR).
- **Hard retry budget & cache discipline:** Prefer keeping one Work Item sticky to one account to preserve prompt cache, subject to quota. Environment errors → fix environment; `429`/quota exhaustion → route account switching through Controller/JEV rather than unconditional manual switching; logic failures → **max 2 repair rounds** before escalating to a stronger reviewer/author.
- **0-token self-check & hygiene:** Run `git diff --check`, secret scan and focused tests before requesting review. After merge, `node tools/ai-brain/hygiene-check.js --wi <ID> --checkpoint <PATH> --dry-run` is **preview-only** and conservatively retains unknown/unobserved worktrees; real cleanup requires verified evidence of owner, merged commit, clean tree, inactive session, and link-safe removal (unlink junctions before removing worktrees), and `CLEANED` is recorded only with a real cleanup receipt.
- **PR receipt metrics:** Record real delivery numbers in the PR receipt (`elapsed READY->merge`, `repair rounds`, `gate time`, `cleanup disposition`; include `tokens` only when backed by a real receipt).

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)
