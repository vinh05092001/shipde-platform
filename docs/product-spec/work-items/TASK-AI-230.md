# TASK-AI-230 — Delete closed AI Work Items and dead documents

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-230` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | 352 |
| Dependencies | `TASK-AI-229`, merged in #650 |
| Base | `2f1845ef85a42c417952192ccd7d52f85de9629d` |
| Assigned author | `CLAUDE` (one-time operator exception) |
| Reviewer | Codex, independent review of exact final SHA |
| Branch | `feat/task-ai-230-remove-shipped-history` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-*.md` (deletions of the listed closed items only); `docs/product-spec/work-items/TASK-AI-142.md`; `docs/product-spec/work-items/TASK-AI-230.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/AGENT_PROGRESS.md`; `docs/FINAL_HANDOFF.md`; `docs/IMPLEMENTATION_PLAN.md`; `docs/SOURCE_LOCK.md`; `docs/UX_AUDIT.md`; `docs/backoffice-remediation-plan.md`; `docs/ai-audit/65-items-status-20261108.md`; `docs/ai-audit/handoff-table-20261108.md`; `docs/ai-audit/open-prs-20261108.md`; `docs/ai-audit/register-reconcile-20261108.md`; `.evidence/REPORT7.md`; `.evidence/REPORT8.md`; `.evidence/REPORT9.md`; `.evidence/REPORT12.md`; `WRITER-SELECTION-HANDOFF.md` |

## Business outcome

Keep the active Work Item folder limited to items that are open or still read by code, so agents and the operator see current work instead of mixing active specifications with superseded or shipped material. History stays in Git, pull requests and the register.

## Operator decision and scope

On 2026-11-26 the operator decided that closed Work Items and stale documents are deleted, not archived. Delete 117 `TASK-AI-*.md` files whose register status is `MERGED` or `SUPERSEDED` and whose file name is not referenced anywhere outside the Work Item folder and the register. Keep items read by code or tests, items linked from `DASHBOARD.html` or other kept documents, `TASK-AI-167` (linked from `TASK-AI-228` evidence), and `TASK-AI-227..229`.

For every deleted item keep the register row, ID, status, dependencies, PR and merge commit; clear only `work_item_path`. Mark `TASK-AI-228` and `TASK-AI-229` `MERGED` with their PR and merge commit. Delete ten stale handoff and audit documents outside `docs/product-spec/`, four unreferenced `.evidence` reports and the root `WRITER-SELECTION-HANDOFF.md`; update the single sentence in `TASK-AI-142.md` that pointed to it. Keep `docs/ai-audit/tool-usage-20261107.md` because a test reads it.

Do not change code, tests, workflows, gate configuration, validators or `DASHBOARD.html`. Unwired web components cited in the implementation inventory stay for a separate decision.

## Approved deletion set

Use this exact set of Work Item IDs under the Work Item directory. Other Work Item deletions require a new scope decision.

- TASK-AI-46, TASK-AI-49, TASK-AI-50, TASK-AI-55, TASK-AI-56, TASK-AI-58, TASK-AI-59, TASK-AI-60, TASK-AI-61, TASK-AI-62.
- TASK-AI-63, TASK-AI-64, TASK-AI-65, TASK-AI-66, TASK-AI-67, TASK-AI-68, TASK-AI-69, TASK-AI-70, TASK-AI-73, TASK-AI-75.
- TASK-AI-76, TASK-AI-77, TASK-AI-78, TASK-AI-80, TASK-AI-82, TASK-AI-83, TASK-AI-85, TASK-AI-87, TASK-AI-89, TASK-AI-98.
- TASK-AI-105, TASK-AI-107, TASK-AI-108, TASK-AI-109, TASK-AI-110, TASK-AI-113, TASK-AI-114, TASK-AI-115, TASK-AI-116, TASK-AI-117.
- TASK-AI-118, TASK-AI-119, TASK-AI-120, TASK-AI-121, TASK-AI-122, TASK-AI-123, TASK-AI-124, TASK-AI-125, TASK-AI-126, TASK-AI-127.
- TASK-AI-128, TASK-AI-129, TASK-AI-130, TASK-AI-131, TASK-AI-132, TASK-AI-135, TASK-AI-136, TASK-AI-139, TASK-AI-140, TASK-AI-141.
- TASK-AI-143, TASK-AI-144, TASK-AI-146, TASK-AI-147, TASK-AI-148, TASK-AI-151, TASK-AI-154, TASK-AI-156, TASK-AI-159, TASK-AI-161.
- TASK-AI-162, TASK-AI-163, TASK-AI-165, TASK-AI-166, TASK-AI-168, TASK-AI-170, TASK-AI-171, TASK-AI-180, TASK-AI-182, TASK-AI-185.
- TASK-AI-186, TASK-AI-188, TASK-AI-189, TASK-AI-190, TASK-AI-191, TASK-AI-192, TASK-AI-193, TASK-AI-194, TASK-AI-195, TASK-AI-196.
- TASK-AI-197, TASK-AI-198, TASK-AI-199, TASK-AI-200, TASK-AI-201, TASK-AI-202, TASK-AI-203, TASK-AI-204, TASK-AI-205, TASK-AI-206.
- TASK-AI-207, TASK-AI-208, TASK-AI-209, TASK-AI-210, TASK-AI-211, TASK-AI-212, TASK-AI-213, TASK-AI-214, TASK-AI-215, TASK-AI-216.
- TASK-AI-217, TASK-AI-221, TASK-AI-222, TASK-AI-223, TASK-AI-224, TASK-AI-225, TASK-AI-226.

## Acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Every deleted Work Item had status `MERGED` or `SUPERSEDED` and no remaining file reference in the candidate tree or active PR queue. Keep the active specification coverage unchanged. Its register row is intact with an empty `work_item_path`. | Deterministic selection listing and register diff showing only `work_item_path` cleared, two lifecycle syncs and one new row. |
| AC2 | No tracked file references a deleted document, report or handoff. | `git grep` on each deleted name returns no hits. |
| AC3 | Documentation, specification and AI-brain checks pass unchanged. | Commands below on the exact head. |

## Verification

- `python docs/product-spec/scripts/validate_docs.py`
- `node tools/ai-brain/validate-work-item.js --wi TASK-AI-230 --file docs/product-spec/work-items/TASK-AI-230.md --register docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `pnpm test:specs`
- `pnpm test:brain`
- `git diff --check 2f1845ef85a42c417952192ccd7d52f85de9629d...HEAD`
- `scripts/ai/control.ps1 -Action Test`
- `node scripts/ai/check-no-hardcode.mjs`

Before requesting review, compare coverage for active register entries with the base and check open PRs for references to the deletion set. If a surviving consumer needs any listed file, stop and report the reference. Run the existing pre-push gate on the exact release head and send it for independent review.
