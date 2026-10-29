# TASK-AI-148 — The delivery register shows what is actually merged

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-148` |
| Feature ID | `N/A — delivery workflow` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `264` |
| Dependencies | `TASK-FOUND-04` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-148.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-148-register-merged` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Operators can see merged delivery work in the register and identify the corresponding merged PR from the local origin/main history.

## Source references

- `AGENTS.md`, Unit of delivery and Required status flow.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md`, Prepare and merge reconciliation: merged work is reconciled to `MERGED` with PR evidence.
- `docs/product-spec/scripts/validate_pr_contract.py`, Work Item and register checks.

## Preconditions and dependencies

`TASK-FOUND-04` is recorded as merged in the register; `origin/main` is available locally. The observed origin/main tip is `9648f3efd4789481480c0c4cbd9977b788be4cab`.

## Author boundary

`9ROUTER` performs a bounded documentation reconciliation using deterministic Git history evidence. Only the two allowed files may change; application behavior, gate configuration, external actions and merge decisions are outside scope. An independent Codex review remains required.

## In scope

- Add this Work Item and exactly one corresponding register row.
- Mark registered Work Items `MERGED` when an origin/main squash title identifies the Work Item and PR number, recording that PR in the `pr` column.
- Preserve rows without such evidence and retain existing merged rows.

## Out of scope

- Fetching remote history, changing workflow gates, modifying application code, or asserting CI and review verdicts.
- Inferring merge evidence from unnumbered titles, other branches or external sources.

## Business rules and edge cases

- `BR-AI-148-01`: A status change requires a Work Item ID and a PR number in a squash title reachable from the local `origin/main` reference.
- `BR-AI-148-02`: When several qualifying titles name an item, use the first encountered in the Git log, the most recent in that history.
- `BR-AI-148-03`: Do not change a row without qualifying evidence; do not invent a verdict or merge commit.

## UI states

N/A — documentation and register data only.

## API, event and data impact

The existing CSV schema is unchanged. Consumers see reconciled status and PR fields; no migrations, events or API changes.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-148-01` | A non-merged register row has a matching numbered squash title in `git log origin/main` | Status is `MERGED` and `pr` identifies that title | Compare changed CSV rows against Git log |
| `AC-AI-148-02` | A row has no matching numbered squash title | Row remains unchanged | Compare CSV diff against Git log |
| `AC-AI-148-03` | The PR contract checks this Work Item | Exactly one registered row and one changed Work Item file | Contract validator and diff |
| `AC-AI-148-04` | Run repository documentation checks | Hardcode and formatting checks pass | Command output |

## Verification commands

```bash
git log origin/main --format=%s
git diff --check
node scripts/ai/check-no-hardcode.mjs
pnpm exec prettier --check docs/product-spec/work-items/TASK-AI-148.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| Pending | Not committed | Awaiting independent review | None |

## Residual limitations

- Evidence is limited to the locally available `origin/main` reference at the recorded tip; remote changes after that reference are not assessed. The next operator can refresh and reconcile again.
- Git history establishes merge evidence only; CI and independent review are separate gates.
