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
