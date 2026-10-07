# TASK-AI-111 — A pure slugify helper and a branch-name helper that uses it

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-111` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `223` |
| Dependencies | `None` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/slugify.js`; `tools/ai-brain/test/proof-slugify.test.js`; `docs/product-spec/work-items/TASK-AI-111.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-111` |
| Pull Request | `Pending` |

## Business Outcome

Work Item branches were spelled by hand, so the same Work Item could end up on differently named branches. This Work Item adds `tools/ai-brain/slugify.js`, a pure Node built-in module exporting two helpers:

- `slugify(text)` — the single slug primitive used everywhere: lower-cased input, every run of characters outside `[a-z0-9]` becomes one `-`, leading and trailing `-` trimmed, and the result capped at 48 characters without a trailing `-`.
- `normalizeWorkItemBranch(workItemId, kind, outcome)` — derives the Work Item branch as `<kind>/<lower-cased work item id>-<slug>` using `slugify`, so Work Item branches are derived consistently.

Both helpers are pure and deterministic: no I/O, no clock, no randomness, no global state, Node built-ins only.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| SL-R01 | `slugify(text)` transforms the text | lower-cased; each run of non `[a-z0-9]` replaced with a single `-`; leading and trailing `-` trimmed; result capped at 48 characters without a trailing `-` | SL-R01 tests in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R02 | `slugify(text)` receives invalid input | throws `Error` with code `SLUGIFY_INPUT_INVALID` for non-string input or input that slugs to empty | SL-R02 tests in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R03 | implementation and proof stay pure | pure and deterministic, Node built-ins only; tests in `tools/ai-brain/test/proof-slugify.test.js` with `node:test` | module imports and test run output |
| SL-R04 | control documents exist | `docs/product-spec/work-items/TASK-AI-111.md` with Control, Business Outcome, Acceptance Matrix, Verification Commands, Residual Limitations; register row `223` for `TASK-AI-111` with status `READY_FOR_CODEX` and branch `feat/task-ai-111` | document content and register diff |
| BR-R01 | `normalizeWorkItemBranch` derives the branch | result is `<kind>/<lower-cased id>-<slug(outcome)>`; `feat` is the default kind; a `FEAT-*` id keeps its `feat` prefix in the result | BR tests in `tools/ai-brain/test/proof-slugify.test.js` |
| BR-R02 | `normalizeWorkItemBranch` receives invalid input | `WORK_ITEM_ID_INVALID` outside `^(FEAT\|TASK-FOUND\|TASK-AI)-[A-Z0-9-]+$`; `BRANCH_KIND_INVALID` outside `feat`/`fix`; `OUTCOME_SLUG_EMPTY` when the outcome slugs to empty | BR tests in `tools/ai-brain/test/proof-slugify.test.js` |
| BR-R03 | derived branch length | a result of exactly 60 characters is allowed; 61 characters throws `BRANCH_TOO_LONG` instead of truncating | BR tests in `tools/ai-brain/test/proof-slugify.test.js` |

BR-R01 to BR-R03 cover the goal's branch-name helper; the committed expectations of `tools/ai-brain/exercise/e1-branch-name.cases.json` are mirrored in the proof tests so the derived branches match the loop's exercise data.

## Verification Commands

- `node --test tools/ai-brain/test/proof-slugify.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `git diff --check`

## Residual Limitations

- `slugify` truncates silently at 48 characters by design (SL-R01), so `normalizeWorkItemBranch` shortens a long outcome slug before its own 60-character check judges the composed branch.
- `slugify` reduces every run of characters outside `[a-z0-9]` to `-`, so non-ASCII letters are discarded rather than transliterated.
- A non-string `outcome` surfaces `SLUGIFY_INPUT_INVALID` from `slugify`; only a string that slugs to empty becomes `OUTCOME_SLUG_EMPTY`.
- `normalizeWorkItemBranch` is not consumed by the controller or the publisher yet; wiring those callers is outside this Work Item's allowed paths.
- The `node --test "tools/ai-brain/test/*.test.js"` suite reports 46 pre-existing failures in this worker environment (missing `prettier` module and publisher/isolation tests that refuse to run from inside the worker root). The identical failure set occurs without this Work Item's files; `tools/ai-brain/test/proof-slugify.test.js` passes in both runs.
