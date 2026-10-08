# TASK-AI-111 — A pure slugify helper derives Work Item branch names

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-111` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `223` |
| Dependencies | None |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/slugify.js`; `tools/ai-brain/test/proof-slugify.test.js`; `docs/product-spec/work-items/TASK-AI-111.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-111` |
| Pull Request | `Pending` |

## Business Outcome

Work Item branch names are spelled by hand today: one outcome becomes
`add-a-pure-slugify-helper`, the next `add_a_pure_slugify_helper`, a third is
truncated differently on every retry. The spelling of a branch is a small thing
to disagree about and an expensive one to reconcile after the fact. One pure
`slugify` helper owns the rule — lower-case, non `[a-z0-9]` runs collapse to a
single dash, edges are trimmed, the result is capped at 48 characters and never
ends in a dash — and a `branchName` helper composes `<kind>/<work item id>-<outcome slug>`
from it, so every Work Item branch is derived the same way. Both helpers are
pure functions over strings: no I/O, no clock, no randomness, no module state,
Node built-ins only.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| SL-R01 | `slugify` on mixed-case input, separator runs (`a  --  b`, `a_B.c!d`), leading/trailing separators, 48- and 60-character results | Lower-cased; each run of non `[a-z0-9]` characters becomes exactly one `-`; leading and trailing `-` trimmed; result capped at 48 characters and never ends with `-` | SL-R01 tests in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R02 | Non-string input (`undefined`, `null`, `42`, `{}`, `['a']`, `true`, boxed `String`); input that slugs to nothing (`''`, `'   '`, `'!!!'`, `'---'`, `' _-. '`) | Throws `Error` with code `SLUGIFY_INPUT_INVALID` | SL-R02 tests in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R03 | Repeated calls with the same and different inputs; module load | Pure: same input always yields the same output, nothing is mutated or observed between calls; implementation uses Node built-ins only | SL-R03 tests in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R04 | `branchName(kind, workItemId, outcome)` for `feat` and `fix`, separator runs in the outcome, omitted outcome, kind outside `feat`/`fix`, non-string work item id, outcome that slugs to nothing | `<kind>/<slugified id>-<slugified outcome>` (id only when the outcome is omitted); kind outside `feat`/`fix` throws `BRANCH_NAME_INPUT_INVALID`; id and outcome failures reuse `SLUGIFY_INPUT_INVALID` | branchName tests in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R05 | Handoff metadata | Work Item and delivery register identify row `223`, `READY_FOR_CODEX`, and branch `feat/task-ai-111` | Work Item and register diff |

## Verification Commands

- `node --test tools/ai-brain/test/proof-slugify.test.js`
- `git diff --check`

## Residual Limitations

- The 48-character cap applies to the slug (and therefore to the outcome segment of a branch name), not to the full branch name; the work item id segment is bounded only by `slugify`'s validation of the input string.
- `branchName` validates only that `kind` is exactly `feat` or `fix`; it does not verify that the work item id belongs to a known family (`FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*`), so a well-formed slug from an unknown id still composes a branch name.
- Non-ASCII letters (for example `é`) count as non `[a-z0-9]` and are folded into separator runs, so accented words lose those letters rather than being transliterated.
