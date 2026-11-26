# TASK-AI-233 — Restore strict validation of the delivery register

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-233` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | 354 |
| Dependencies | TASK-AI-232 |
| Base | `31319e8a448cf01c2ddde51bdc1ef8f6fe6db069` |
| Assigned author | `CLAUDE` |
| Risk | HIGH |
| Risk domains | release |
| Reviewer | Codex independent review at the exact final SHA |
| Branch | `fix/task-ai-233-normalize-delivery-register` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-233.md`; `tools/ai-brain/test/task-ai-233-register-csv.test.js` |

## Business outcome

Maintenance pull requests can remove shipped Work Item files and clear their register paths using the strict two-tier PR contract.

## Source requirements

- TASK-AI-232 introduced strict base/head register parsing for Tier A in PR #652.
- At the pinned base the register has a 14-field header and 324 records. Each of these 21 records has one extra empty final field: 65, 66, 67, 68, 69, 70, 73, 75, 76, 77, 78, 80, 82, 83, 85, 87, 89, 94, 96, 98 and 100 (all TASK-AI IDs).
- The operator approved data repair and assigned Claude to author. This PR uses Tier B.

## Author boundary

Reuse `read_register` from `docs/product-spec/scripts/validate_pr_contract.py`. Run the regression against the tracked register in the candidate checkout. Leave the validator, policy, CI, historical metadata and cleanup branch out of the implementation.

## Acceptance matrix

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC1 | Compare the candidate register with the pinned base. | Remove only the extra empty field from the 21 named records. Preserve the first 14 values, order, and line endings of those records. The header and other existing bytes stay identical. The only new record is the planning row for TASK-AI-233. |
| AC2 | Run the new regression against the real checkout register. | The same strict parser the PR gate uses rejects the pinned base and accepts the repaired candidate. Record RED before the data repair and GREEN after it. A missing Python executable in CI must surface as a failed or clearly unmet check. |
| AC3 | Publish and review the repair. | The Tier B contract, required CI, and independent exact-head review pass. After merge, verify the separate cleanup using the real Git base/head event against the new main before publishing it. |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-233-register-csv.test.js tools/ai-brain/test/task-ai-232-closed-work-item-contract.test.js`
- `python docs/product-spec/scripts/validate_docs.py`
- `node tools/ai-brain/validate-work-item.js --wi TASK-AI-233 --file docs/product-spec/work-items/TASK-AI-233.md --register docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `pnpm test:brain`
- `pnpm ai:check`
- `git diff --check`
