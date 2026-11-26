# TASK-AI-228 — Align the AI delivery register with verified merges

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-228` |
| Feature ID | N/A |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | 350 |
| Dependencies | `TASK-AI-227` merged in #647 |
| Base | `aad5862b7798bc6d23dfd34a4c564538638f8051` |
| Assigned author | `GEMINI` |
| Risk | LOW. Documentation and register metadata only. |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-228.md` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-228-reconcile-delivery-register` |

## Business outcome

Operators see which AI Work Items have actually shipped. Keep the historical records and avoid rerouting work when the register has fallen behind GitHub.

## Scope

- Audit these 50 candidates against the frozen base: TASK-AI-154, 155, 159, 161, 162, 163, 166, 171, 180, 182, 185, 186–217 and 221–227. Reuse the existing register parser and read-only reconciliation evidence where practical. Treat commit subjects as leads. Confirm the PR belongs to the Work Item and actually delivered it, is merged to main, and has an exact merge SHA in the base ancestry. For an ID with multiple PRs, explain which integration completes this item and why. Keep ambiguous or unverifiable rows unchanged and report them explicitly.
- Update only status to MERGED and the PR and merge_commit fields of verified rows. Preserve an existing verdict and other fields. Fill a blank verdict only with durable independent review evidence tied to the shipped head. Leave older already-MERGED rows unchanged except for the duplicate listed below.
- Remove duplicate delivery row 299 for TASK-AI-167 after confirming that its other fields match row 293 and PR #503. Preserve row 293 and the Work Item file.
- Keep delivery row 167 for TASK-AI-34 as SUPERSEDED. Clear its dead work_item_path after confirming the file is absent and TASK-AI-35 through TASK-AI-38 are merged. Preserve the successor explanation.
- No changes to product Work Items, historical evidence files, source code, scripts, gates or dependencies. No filesystem cleanup in this Work Item.

## Acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Each of the 50 candidates has one reported outcome, either reconciled with verified evidence or unchanged with a reason. | In the PR body or this WI, list WI ID, PR, full merge SHA and outcome; justify overlaps or ambiguous matches. |
| AC2 | The duplicate row is gone, the surviving TASK-AI-167 row is unchanged, and TASK-AI-34 remains SUPERSEDED with no dead file link. | Compare parsed CSV rows against the base and verify the successor rows. |
| AC3 | Scope is limited to the two allowed files. Other rows, columns and historical WI files are preserved. CSV quoting and ordering remain valid. | Parse before and after, check the allowlisted changes by delivery_order and verify preservation of other records. |

## Verification

- `python docs/product-spec/scripts/validate_docs.py`
- `git diff --check`
- `node scripts/ai/check-no-hardcode.mjs`

This is a data reconciliation, so application tests are not applicable. Report the read-only evidence checks and any unresolved row alongside the exact head. Stop after the register changes and send the head for independent review.
