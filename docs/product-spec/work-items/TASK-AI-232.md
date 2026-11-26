# TASK-AI-232 — Scale Pull Request evidence to the risk of the change

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-232` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | 353 |
| Dependencies | None |
| Base | `2f1845ef85a42c417952192ccd7d52f85de9629d` |
| Assigned author | `CLAUDE` |
| Risk | HIGH |
| Risk domains | security, release |
| Reviewer | Codex independent review at the exact final SHA |
| Branch | `fix/task-ai-232-closed-work-item-contract` |
| Allowed paths | `docs/product-spec/scripts/validate_pr_contract.py`; `docs/product-spec/scripts/pr_contract_policy.json`; `tools/ai-brain/test/task-ai-232-closed-work-item-contract.test.js`; `docs/product-spec/work-items/TASK-AI-232.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `AGENTS.md`; `.github/PULL_REQUEST_TEMPLATE.md`; `docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md` |

## Business outcome

A maintainer can land verified maintenance using GitHub PR evidence without creating a Work Item file or register row. Product and high-risk changes retain the existing Work Item requirements. Every PR remains independently reviewed and subject to required CI.

## Source requirements

- The operator approved path-based two-tier PR governance on 2026-11-26. This Work Item supersedes the single-PR exception in planning commit `ab41ba0279ac2aedba799dcc2fa04d9ce3be116d`.
- PR #651 at `3ff8f4207348d65bf5aa07b0b340f7c74f92320a` demonstrates the existing classifier counting historical Work Item deletions as simultaneous active Work Items.
- Reuse the existing validator, product documentation and PR contract tests. Keep required workflow jobs, branch protection and merge authorization in place.

## Author boundary

Implement the two-tier policy in the existing validator and declare its path rules in the candidate policy file for independent review. Use the immutable base-side policy and base register for classification. The first PR introducing the policy must satisfy the existing Tier B contract. With no policy in base, evaluate with Tier B rules. A malformed or unreadable policy, event, Git diff or required register input must fail closed. A PR cannot change its own classification by editing the policy or evidence. Keep policy enforcement separate from PR author assertions.

Limit documentation edits to the operating card, PR template and contract wording necessary for users to follow the two routes. Do not change a workflow, release authorization, branch protection, or application code.

## Acceptance matrix

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC1 | GitHub supplies the PR event and immutable base/head commits. | Classify the actual Git delta using NUL-delimited name/status records. Read both paths for rename/copy, one path for add/modify/delete. Unrecognized, ambiguous or mixed scope is Tier B. The body, prefix and labels cannot lower the tier. |
| AC2 | Any affected path is protected. | Tier B applies to all apps, packages, Prisma, OpenAPI/contracts, auth/RBAC/tenant/money, workflows, gate and security policy paths and unknown paths. Keep one active Work Item, a matching unique register row, evidence required by the existing contract, and the existing sensitive-file restrictions. Do not treat a rename out of a protected path as clean maintenance. |
| AC3 | All changes are in explicitly recognized maintenance scope. | Allow a maintenance PR with a chore, docs or refactor title prefix and a body containing a goal, scope and verification evidence. Require no new Work Item file or register row. Docs, non-enforcement manifest changes and test maintenance are eligible when scope and preserved behavior are verifiable. Keep gate-bearing metadata and changes weakening acceptance or security coverage in Tier B. Reviewer verifies semantic parity that path rules cannot decide. |
| AC4 | Tier A removes historical Work Item files. | Permit only actual deletions of Work Items whose unique base register row is MERGED or SUPERSEDED and names that exact path. The cleaned row must still exist and must differ only by clearing that path. Every cleared path must match a qualifying deletion. Keep all other historical rows and fields unchanged and refuse changes to still-active Work Item files on Tier A. |
| AC5 | Any PR is prepared for release. | Preserve the tracked .env prohibition across both path sides. Keep required CI and independent review at the exact head. Reclassify after changes to the diff. Verify the gate cannot be bypassed through a title, policy edit, changed metadata or incomplete diff. |
| AC6 | GitHub merges the gate PR. | Adapt #651 in a separate follow-up. Keep TASK-AI-142.md and WRITER-SELECTION-HANDOFF.md. Move TASK-AI-228/229 status and merge-metadata reconciliation out of Tier A. Apply the new policy on its exact new SHA, with 110 historical Work Items and 10 other files still eligible if scope proof holds. |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-232-closed-work-item-contract.test.js tools/ai-brain/test/task-ai-142-goal-pr-contract.test.js tools/ai-brain/test/controller-canary.test.js`
- `python docs/product-spec/scripts/validate_docs.py`
- `node tools/ai-brain/validate-work-item.js --wi TASK-AI-232 --file docs/product-spec/work-items/TASK-AI-232.md --register docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `pnpm test:brain`
- `pnpm ai:check`
- `git diff --check`

Use disposable Git fixture revisions. Show a PR-only maintenance case fails before the change and passes after it. Independently test chore editing apps/api, docs editing .github, renaming or copying a workflow, policy self-edit to claim Tier A, historical metadata drift, deletion of an active Work Item, unrelated register changes, protected new and old paths, and malformed or unreadable inputs. Preserve the existing GOAL and normal Tier B success/failure cases. Require CI on the exact release SHA. Roll back by reverting the gate PR and holding dependent cleanup.
