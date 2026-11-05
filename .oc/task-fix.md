# THIS ROUND = Slice A review fixes only (TASK-AI-155)

State (2026-11-04 22:40, commit 500c8ac): the branch was cut to Slice A. Dashboard shell, Storybook and their tests moved to Slice B (see the Work Item "Slice plan"). Do NOT re-add them.

Scope: only `apps/web/src/components/data-table/**`, `apps/web/src/hooks/use-debounced-callback.ts`, `apps/web/src/tests/data-table-*.test.ts`, `apps/web/src/tests/fixtures/data-table-shipments.ts`, `apps/web/src/app/layout.tsx` (NuqsAdapter).

1. Read `.oc/review.txt`. Fix only findings that point at files in scope. A finding about a removed file is void (deleted code is never a finding).
2. Every file stays <= 300 lines. Do not add tests for findings: run the check locally and write "finding N: <cmd> -> pass" in the PR body.
3. Verify: `cd apps/web && npx tsx src/tests/data-table-dashboard.test.ts && npx tsx src/tests/data-table-tablecn.test.ts` and `npx tsc --noEmit -p apps/web` (ignore .next/types).
4. Commit "[TASK-AI-155] Slice A review fixes" and stop.
