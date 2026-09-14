# TASK-AI-19 — Deterministic register reconciler with write-back

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-19` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `152` |
| Dependencies | `TASK-AI-17` (merged, `1f587dd`) |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/reconcile.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/test/reconcile.test.js`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/work-items/TASK-AI-19.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-19-reconciler` |
| Pull Request | `https://github.com/vinh05092001/shipde-platform/pull/23` |

## Business outcome

The delivery register (`FEATURE-DELIVERY-REGISTER.csv`) is the repository's
single source of truth for queue ordering, Work Item readiness, and autonomous
orchestrator dispatch. Today, `tools/ai-brain/reconcile.js` checks the register
against repository and Git facts, but operates strictly as a read-only analyzer.
When dependencies merge, dependent rows remain frozen in `BLOCKED_DEPENDENCY`
or `BLOCKED_BY_FOUNDATION` until an operator or author manually edits the CSV.

A prime example is `TASK-AI-07` ("Cross-harness worker failover and bounded
recovery"). Its sole declared dependency, `TASK-AI-06`, merged to `main` in PR #9
(`fdf87594e60dc95aa1b9facb8af365666236f0e9`). Although `reconcile` reports
`BLOCK_NO_LONGER_TRUE`, `TASK-AI-07` remains recorded as `BLOCKED_DEPENDENCY`.
Manual CSV editing by autonomous agents introduces high risks of RFC 4180 quote
corruption, carriage return mutilation, and accidental churn on unrelated rows.

Adding a deterministic write-back capability (`node tools/ai-brain/cli.js reconcile --write`)
allows the register to self-heal: stale dependency blocks clear automatically,
unrecorded merges backed by verified `PASS` verdicts are recorded, and the queue
advances truthfully without manual intervention or risky ad-hoc edits.

## Source references

- `AGENTS.md` § Source of truth — Specification precedence over code; a row
  must never claim what repository evidence cannot prove.
- `AGENTS.md` § Unit of delivery — Required status flow:
  `BACKLOG -> BLOCKED_BY_FOUNDATION/BLOCKED_DEPENDENCY -> READY_FOR_AUTHOR -> IN_PROGRESS -> READY_FOR_CODEX -> CHANGES_REQUIRED -> READY_FOR_CODEX -> CODEX_PASS -> MERGED`.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` § 1. Codex
  prepares the next item — Dependency-ready Work Items in ascending delivery
  order; dependencies must be `MERGED`.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § `AI-TOOL-12` —
  GitHub merged state is reconciled by PR identity and merge SHA; repeated
  synchronization is a no-op and never rewrites unrelated rows.
- `tools/ai-brain/reconcile.js` — Core reconciliation rules: `BLOCK_NO_LONGER_TRUE`,
  `MERGE_NOT_RECORDED`, `SPEC_MISSING`, `MERGED_WITHOUT_COMMIT`.
- `tools/ai-brain/cli.js` — CLI command entrypoint for register reconciliation.
- `tools/ai-dashboard/register-adapter.js` — RFC 4180 CSV parser and register
  state derivation.

## Preconditions and dependencies

- `TASK-AI-17` merged into baseline (`1f587dd`), bringing manifest truth and zero
  manifest errors.
- `node tools/ai-brain/cli.js reconcile` reports 0 errors and 1 warning
  (`BLOCK_NO_LONGER_TRUE` for `TASK-AI-07`).
- `TASK-AI-06` merged (`fdf87594e60dc95aa1b9facb8af365666236f0e9`) with Codex
  verdict `PASS` and PR #9 evidence.
- `FEATURE-DELIVERY-REGISTER.csv` formatted according to RFC 4180 with standard
  headers.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded
to the six allowed paths:
`tools/ai-brain/reconcile.js`,
`tools/ai-brain/cli.js`,
`tools/ai-brain/test/reconcile.test.js`,
`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`,
`docs/product-spec/work-items/TASK-AI-19.md`, and
`docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`.

Prohibited in this Work Item:
- Modifying merge preflight or trusted reviewer logic in `scripts/ai/control.ps1`.
- Editing `.github/workflows/`, `scripts/verify-*`, or `docs/product-spec/scripts/`.
- Weakening or skipping any quality gate or validation check.
- Altering the column schema of `FEATURE-DELIVERY-REGISTER.csv`.
- Flipping statuses or lifecycle states without verifiable repository evidence.

## In scope

- Implement write-back logic in `tools/ai-brain/reconcile.js` to recompute row
  statuses from verified Git and dependency facts.
- Support `--write` and `--dry-run` CLI options in `tools/ai-brain/cli.js reconcile`.
- Automatically clear stale `BLOCKED_DEPENDENCY` and `BLOCKED_BY_FOUNDATION` rows
  when all dependencies are `MERGED` with valid reachable commits on `mainRef`
  and `codex_verdict: PASS`:
  - If the referenced `work_item_path` exists on disk as a valid specification file,
    transition status to `READY_FOR_AUTHOR`.
  - If the referenced `work_item_path` does not yet exist on disk (archetype:
    `TASK-AI-07`), transition status to `BACKLOG` so that Codex planning can author
    the specification without triggering `SPEC_MISSING` validation errors.
- Automatically record unrecorded merges (`MERGE_NOT_RECORDED`): when a branch tip
  is an ancestor of `mainRef` and codex verdict is `PASS`, record `status: MERGED`
  and the exact merge commit SHA.
- Ensure atomic writes via temporary sibling files (`FEATURE-DELIVERY-REGISTER.csv.tmp`)
  and exact RFC 4180 serialization, preserving quotes, line endings, and byte-for-byte
  integrity of unchanged rows.
- Refuse write-back fail-closed whenever structural errors (`ROW_WITHOUT_ID`,
  `DUPLICATE_WORK_ITEM_ID`, or overstatements) are present.
- Author unit and integration tests in `tools/ai-brain/test/reconcile.test.js`
  proving idempotency, stale block resolution, spec-aware destination status,
  and error refusal.

## Out of scope

- Authoring the missing Work Item specifications (assigned to `TASK-AI-20`).
- Implementing the failover runtime logic for `TASK-AI-07` itself.
- Querying remote GitHub REST/GraphQL endpoints at runtime (reconciler relies
  strictly on local Git DAG and repository facts).
- Changing supervisor auto-merge routines in `scripts/ai/control.ps1`.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-19-R01` | Write-back must be idempotent and deterministic: running `cli.js reconcile --write` multiple times on unchanged repository state produces zero diff after the first execution. |
| `AI-19-R02` | Any row in `BLOCKED_DEPENDENCY` or `BLOCKED_BY_FOUNDATION` whose declared dependencies are all verifiably `MERGED` (reachable in `mainRef` with `codex_verdict: PASS`) must have its stale block cleared on write-back. |
| `AI-19-R03` | When a stale dependency block is cleared: if `work_item_path` exists on disk, status becomes `READY_FOR_AUTHOR`; if `work_item_path` is absent from disk (such as `TASK-AI-07`), status becomes `BACKLOG` to allow Codex planning without failing `SPEC_MISSING`. |
| `AI-19-R04` | Unrecorded merges (`MERGE_NOT_RECORDED`) are updated to `MERGED` with the exact merge commit SHA only if `codex_verdict` is `PASS`. An unrecorded branch without a `PASS` verdict is not marked `MERGED`. |
| `AI-19-R05` | Write-back refuses and fails closed (exit code 1) if any `error` severity finding exists in the register (`ROW_WITHOUT_ID`, `DUPLICATE_WORK_ITEM_ID`, `MERGED_WITHOUT_COMMIT`, etc.). |
| `AI-19-R06` | File writes must be atomic via temporary file replacement, preserving RFC 4180 quoting rules and unaffected rows byte-for-byte. |
| `AI-19-R07` | Default CLI invocation (`cli.js reconcile`) remains read-only; mutations require explicit `--write`. |

## UI states

Not applicable; this Work Item has no user-facing screen. Operator-facing CLI
states for `node tools/ai-brain/cli.js reconcile`:
- Read-only report (default): displays grouped findings by severity (`[LỖI ]`, `[CẢNH]`, `[GHI ]`) without touching disk.
- Write-back preview (`--dry-run`): displays the exact diff of rows that would be mutated without writing to disk.
- Write-back applied (`--write`): atomically writes changes, prints mutation summary, and exits code 0 when clean.
- Write-back refused: prints blocking errors and exits code 1 with zero disk changes.

## API, event and data impact

- Updates `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
  when `--write` is invoked.
- Extends `tools/ai-brain/reconcile.js` with write-back transformation functions.
- Adds CLI flags `--write` and `--dry-run` to `tools/ai-brain/cli.js reconcile`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-19-01` | Run write-back with stale block lacking spec file (`TASK-AI-07`) | Row status transitions from `BLOCKED_DEPENDENCY` to `BACKLOG` | Unit test / CLI output |
| `AC-AI-19-02` | Run write-back with stale block having existing spec file | Row status transitions from `BLOCKED_DEPENDENCY` to `READY_FOR_AUTHOR` | Unit test / CLI output |
| `AC-AI-19-03` | Run write-back with active/unresolved dependency | Row status remains `BLOCKED_DEPENDENCY`; not mutated | Unit test / CLI output |
| `AC-AI-19-04` | Run write-back on branch merged into main with `PASS` verdict | Row status becomes `MERGED`, merge commit recorded | Unit test / CLI output |
| `AC-AI-19-05` | Run reconcile without `--write` flag | Reports findings; register CSV remains completely untouched | CLI stdout / file hash |
| `AC-AI-19-06` | Run write-back twice consecutively | Second run produces zero file modifications (idempotent) | File diff / test assertion |
| `AC-AI-19-07` | Attempt write-back on register with duplicate or missing IDs | Refuses write-back fail-closed; exits with code 1 | Captured stderr / exit code |
| `AC-AI-19-08` | Inspect CSV format after write-back | RFC 4180 compliant, quotes preserved, unaffected rows untouched | Diff inspection / parser test |

## Verification commands

```
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
node tools/ai-brain/cli.js reconcile
node tools/ai-brain/cli.js manifest
python docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Pending review | PENDING | Fresh specification authored for independent review |

## Residual limitations

Write-back operates deterministically on local repository facts (Git commit
history, branches, and on-disk files). It does not poll the remote GitHub API
directly; branches merged remotely must be fetched into `origin/main` before
reconciliation can verify them. Authoring specifications for items moved to
`BACKLOG` remains bounded by `TASK-AI-20`.
