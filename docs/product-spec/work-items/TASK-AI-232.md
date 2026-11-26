# TASK-AI-232 — Keep the one-Work-Item gate while retiring approved history

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-232` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | 353 |
| Dependencies | None |
| Base | `2f1845ef85a42c417952192ccd7d52f85de9629d` |
| Assigned author | Pending Controller routing to an eligible gate-change author |
| Risk | HIGH |
| Risk domains | security, release |
| Reviewer | Independent reviewer from a different model family |
| Branch | `fix/task-ai-232-closed-work-item-contract` |
| Allowed paths | `docs/product-spec/scripts/validate_pr_contract.py`; `docs/product-spec/scripts/work_item_cleanup_allowlist.json`; `tools/ai-brain/test/task-ai-232-closed-work-item-contract.test.js`; `docs/product-spec/work-items/TASK-AI-232.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |

## Business outcome

The operator can land the approved history-only cleanup in PR #651 while the merge gate still requires a single active Work Item and rejects unauthorized edits.

## Source references

- The operator approved this separate validator change on 2026-11-26. The cleanup PR may change only its own active Work Item file. Keep the existing TASK-AI-142 file and writer-selection handoff.
- PR #651 at `3ff8f4207348d65bf5aa07b0b340f7c74f92320a`, contract job 139765759672. The failure counts paths returned by `git diff --name-only` as changed Work Items.
- Freeze the historical deletion allowlist from the 110 IDs under **Approved deletion set** in planning commit `03e6a26dd75b5c4bec8f8f9a72ec7494dbc8c646`. Record the exact canonical repository-relative paths in the policy data included in this gate PR.

## Author boundary

Use the existing validator and Python standard library. The approved change covers this validator and its specific policy data only. Keep GitHub workflow and branch protection unchanged. Select the author through the Controller. Stop if it offers only a constrained low-risk writer, or if independent review from a different model family is unavailable.

The approved exception applies only to TASK-AI-230 and only to deletions listed in the allowlist shipped on the protected base ref. Never grant a PR permission from a list it adds or edits in its own head.

## Acceptance matrix

| AC | Scenario | Expected result |
| --- | --- | --- |
| AC1 | A normal PR creates or modifies Work Item files. | Preserve the existing single-ID rule, the PR title/body checks, and the requirement to update the active Work Item registered for that PR. Ordinary edits to any second Work Item still fail. |
| AC2 | TASK-AI-230 deletes a listed historical Work Item. | Use status-aware Git diff with NUL-delimited paths. Classify only actual deletions. The base register has exactly one matching row with status MERGED or SUPERSEDED holding that exact path. The head register has exactly one matching row with the path empty and all other fields unchanged. Exempt only this qualifying deletion from the active-ID count. |
| AC3 | History does not meet AC2. | Fail on active IDs, unlisted deletions, wrong PR identity, renames, copies, missing or duplicate rows, malformed inputs, or historical metadata drift. The cleanup PR cannot authorize itself by editing the policy list. Git or register read failure blocks the exception. |
| AC4 | CI evaluates the amended cleanup. | The gate PR is merged first. The amended #651 keeps TASK-AI-142 and the writer-selection handoff intact. Run the required contract job on its exact new head and obtain fresh independent review. |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-232-closed-work-item-contract.test.js tools/ai-brain/test/task-ai-142-goal-pr-contract.test.js tools/ai-brain/test/controller-canary.test.js`
- `python docs/product-spec/scripts/validate_docs.py`
- `node tools/ai-brain/validate-work-item.js --wi TASK-AI-232 --file docs/product-spec/work-items/TASK-AI-232.md --register docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `pnpm test:brain`
- `pnpm ai:check`
- `git diff --check`

Use a disposable Git fixture for the validator. Show the positive case fails before the fix and passes afterward, with separate negative cases for each rejection. Verify committed allowlist equality against the approved 110-item selection. Confirm existing GOAL and ordinary PR behavior is unchanged. Rollback is a revert of the gate PR, with #651 held until the gate is restored.
