# Operations Runbook

## Carrier outage

1. Confirm affected carrier/account/capability.
2. Open circuit for failing capability.
3. Preserve partial results and mark UNKNOWN_ERROR.
4. Notify affected operators with manual fallback.
5. Do not disable healthy carriers.
6. Reprobe in half-open mode and close incident with timeline.

## Shipment create outcome unknown

1. Freeze further create attempts for source order/account.
2. Query by client reference/approved lookup.
3. Poll within bounded reconciliation window.
4. If found, link waybill and mark command succeeded.
5. If proven not found, permit retry with same lineage under policy.
6. If still unknown, create manual work item; never blind retry.

## Duplicate waybill suspected

1. Stop label/pickup.
2. Compare command/idempotency and remote references.
3. Identify operationally valid waybill.
4. Cancel duplicate only if carrier state/capability safely allows.
5. Invalidate label and audit correction.
6. Add regression fixture/root-cause action.

## Webhook backlog

1. Check queue depth, oldest age and verification failures.
2. Scale/fix workers without clearing durable messages.
3. Deduplicate/replay idempotently.
4. Run tracking polling reconciliation.
5. Report affected freshness window.

## Import blocked

1. Review blocking header/key/control errors.
2. Download row issue report.
3. Correct source/mapping and upload new revision.
4. Promote only after validation.
5. Never edit promoted raw rows.

## Audit invariant failure

1. Mark run failed/non-official.
2. Preserve snapshot/log.
3. Compare detail and summary/rule version.
4. Fix code/rule through approved change.
5. Rerun as new run; never overwrite.

## Bank allocation correction

1. Lock affected transaction/batches.
2. Reverse/correct allocations with reason and approver.
3. Recompute independent batch bank statuses.
4. Update received/recovery evidence without rewriting case history.

## Security/privacy incident

1. Contain access/token and preserve evidence.
2. Identify tenant/data scope.
3. Rotate affected secrets.
4. Follow notification/legal policy.
5. Correct, test and document root cause.
