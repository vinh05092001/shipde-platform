# TASK-AI-238 — Allow protected governance PRs to carry evidence in GitHub

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-238` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | 355 |
| Dependencies | None |
| Base | `eea9bfd40ab569185479b1915daefd74e6238ef0` |
| Assigned author | `GEMINI` (AGY 08) |
| Risk | HIGH |
| Risk domains | security, release |
| Reviewer | Codex independent review at the exact final SHA |
| Branch | `fix/task-ai-238-pr-only-governance` |
| Allowed paths | `docs/product-spec/scripts/validate_pr_contract.py`; `docs/product-spec/scripts/pr_contract_policy.json`; `tools/ai-brain/test/task-ai-232-closed-work-item-contract.test.js`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-238.md` |

## Business outcome

Operators can ship narrowly scoped governance and cleanup changes with evidence in the pull request. Features and unrelated protected changes continue through the Work Item contract.

## Source requirements

The operator approved one last Work Item for this gate migration and assigned AGY 08 as the author. Reuse Governance v2 round 3 as the starting point. This PR itself uses the existing v1 Work Item contract. The four earlier cleanup work plans stay local and are not added to the register.

## Author boundary

Change only the validator, policy and existing contract-test file. This planning commit supplies the Work Item and one register row. Remove the bootstrap path and any code interpreting an authorization heading as permission. No workflow, branch protection, gate bypass, or merge authorization changes.

## Acceptance matrix

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC1 | Validate this migration against base policy v1. | The migration stays Tier B and passes with this Work Item and register row. The same diff with PR-only evidence is refused. Only a v2 policy already present on base enables Tier G. |
| AC2 | Classify known cleanup and governance on a v2 base. | Explicit path and operation pairs select Tier G with Goal, Scope, Verification and Preservation. Tests include the four actual cleanup patch scopes, including the real inventory path. Titles, labels, deleting undeclared files, changing a delete-only file, renames or copies across protected paths, type changes, mixed product work and editing policy in the PR cannot lower the review requirements. |
| AC3 | Validate manifest reconciliation. | Protect installed gates, commands, adopted entries and CI pins. Refuse duplicate or malformed IDs in base and head. Verify negative fixtures for Semgrep and Gitleaks duplicates and real register parsing. |
| AC4 | Validate compatibility and release evidence. | Retain Tier A, legacy FEAT/TASK/GOAL title and matching register checks, strict terminal-path cleanup, both sides of .env checks, and nonblank evidence checks. Keep the coverage represented by the 54 round-3 cases, replacing obsolete bootstrap cases with a v1 migration success and PR-only refusal. Required CI and independent review pass at the exact head. |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-232-closed-work-item-contract.test.js tools/ai-brain/test/task-ai-233-register-csv.test.js tools/ai-brain/test/task-ai-142-goal-pr-contract.test.js`
- `python docs/product-spec/scripts/validate_docs.py`
- `node tools/ai-brain/validate-work-item.js --wi TASK-AI-238 --file docs/product-spec/work-items/TASK-AI-238.md --register docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `pnpm test:brain`
- `pnpm ai:check`
- `git diff --check`

## Continuation addendum (v3 Slice 1 — operator-approved tooling & maintenance route)

- **Continuation authority:** Operator directive ("dọn liền") with 3-way consensus (AGY 08 + Claude + Codex) reusing `TASK-AI-238` (register row 355 unchanged; no new `TASK-AI-*` item or register row created).
- **Trace:** Follows `#656` (`58a42e8e`) to remove per-file Tier G whitelisting so ongoing AI tooling and AI-collaboration doc maintenance (`scripts/**`, `tools/**`, `docs/product-spec/docs/10-ai-collaboration/**`, `docs/product-spec/evidence/**`, root `AGENTS.md`/`CLAUDE.md`) ships as PR-only Tier G with CI + exact-SHA Codex review instead of creating new `TASK-AI-*` Work Items. Dependency-only `package.json`/`pnpm-lock.yaml` updates stay Tier B in Slice 1 and are deferred to a separate slice with trusted `pnpm` verification.
- **Preserved Tier B fail-closed boundaries:** Product code (`apps/**`, `packages/**`, `prisma/**`, `infra/**`, OpenAPI/contracts), normative product/decision docs (`00-control`..`09-delivery`), `package.json`/`pnpm-lock.yaml`, `.github/**`, CI/security gate scripts (`scripts/verify-trivy.ts`, `tools/openspec-check/**`, `tools/semgrep/**`, `scripts/ai/check-no-hardcode.mjs`, `scripts/ai/hardcode-allowlist.json`, `.gitleaks*`, `.trivyignore`, `.semgrep*`, `lefthook.yml`), nested `AGENTS.md`/`CLAUDE.md`, and `docs/product-spec/scripts/**` (policy/validator read from protected base only; no self-bootstrap).
- **Enforced v3 Tier G invariants:** `scripts/ai/hardcode-baseline.json` requires strict shrink tied to modified/deleted source files (no metadata or surviving-row drift); `ecosystem-manifest.json` locks top-level fields and candidates and allows retiring non-blocking/non-CI-consumed entries while protecting `BLOCKING_GATE`, `ci-provisioned`, and workflow-referenced entries.

## Continuation addendum 2 (retire DeepSeek Harness)

- **Authorization and release route.** The operator approved retiring DeepSeek Harness on 2026-11-27, including its specific hardcode baseline exception. Publish this as a separate Tier B PR under the existing TASK-AI-238 record after #661 merges. Register row 355 stays unchanged.
- **Outcome.** Stop installing, advertising, provisioning and launching the retired DSH lane. Retain supported Gemini, Claude and Controller-managed 9Router behavior. A caller of the retired manual lane receives an explicit refusal and points to the existing Controller intake entry point.
- **Allowed paths for this continuation.** These paths and this addendum are the complete scope:

  - `scripts/ai/bootstrap-worktrees.ps1`
  - `scripts/ai/common.ps1`
  - `scripts/ai/control.ps1`
  - `scripts/ai/doctor.ps1`
  - `scripts/ai/ecosystem.ps1`
  - `scripts/ai/hardcode-baseline.json`
  - `scripts/ai/install-clis.ps1`
  - `scripts/ai/install-ecosystem.ps1`
  - `scripts/ai/start-work-item.ps1`
  - `tools/ai-brain/manifest-audit.js`
  - `tools/ecosystem-manifest.json`
  - `tools/ecosystem-profiles.json`

- **Preservation.** Keep the CI workflow and the `control.ps1 -Action Test` entry point and checks. Only remove the matching DSH baseline exception and update its count from 345 to 344. Keep unrelated adopted tools, existing user installations, dashboard and historical fixtures. Record any remaining operator documentation that points to DSH as a follow-up.
- **Pre-review evidence.** The draft passed 52 focused Node tests, `ecosystem.ps1 -Action Validate`, and the staged hardcode guard. The retired `start-work-item.ps1 -Author 9ROUTER` manual lane exited 1 with an explicit refusal. `cli.js intake --work-item` exited 0 with a valid local Work Item in the draft checkout. Repeat the applicable checks on the release candidate and use an existing valid Work Item for the intake smoke check.
- **Release acceptance.** Verify the diff against the post-#661 base, rerun the focused suites, supported route checks, ecosystem validation, hardcode guard and full brain suite. Require PowerShell 7 `control.ps1 -Action Test` in required CI and independent exact-head review before merge.

## Continuation addendum 3 (restore the Next.js production build)

- **Authorization and release route.** The operator approved this maintenance work in the cleanup plan. Claude authors the dependency fix, and Codex reviews the exact final SHA. Start from post-#662 main (`deb68980`). Use this existing Tier B Work Item, with no new Work Item or change to register row 355.
- **RED and stop condition.** In a clean checkout of the base with the repository-pinned pnpm and supported Node version, run `pnpm install --frozen-lockfile` then `pnpm --filter @shipde/web build`. Record Node, pnpm, the resolved Next.js version and the exact sanitized failure. Continue only if the build reproduces the reported `SecurityFatalError` after a successful frozen install. If it builds, the install fails, or the build fails for another reason, report the evidence and stop before changing versions.
- **Allowed paths.** This addendum, `apps/web/package.json` and `pnpm-lock.yaml`. Change the existing Next.js pin to the smallest compatible fixed version supported by the relevant upstream advisory. Change the existing `eslint-config-next` pin only if needed for compatibility and record the reason. Regenerate the lockfile using pinned pnpm. Keep the manifest's scripts and unrelated dependencies, other workspace importer declarations, registry sources, and build/security configuration. Review any transitive lockfile changes for a direct link to the approved upgrade.
- **GREEN.** On the candidate, repeat the frozen install and web build with the same inputs used for RED. Verify the resolved version, run web lint, typecheck, tests and baseline tests, then run `pnpm ai:check`. Verify only the allowed paths changed and `git diff --check` passes. Record the upstream advisory or release reference, the before/after build results and any linter version change in the PR. Merge after independent review of the exact SHA and required CI.
