# TASK-AI-112 — A branch-name helper derives Work Item branch names through the shared slugify

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-112` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `224` |
| Dependencies | `TASK-AI-111` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/branch-name.js`; `tools/ai-brain/test/proof-branch-name.test.js`; `docs/product-spec/work-items/TASK-AI-112.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-112` |
| Pull Request | `Pending` |

## Business Outcome

Work Item branches are still assembled by hand at every call site: the family
prefix, the id case and the outcome spelling each drift on their own. One
`branchNameFor(workItemId, title)` helper owns the composition —
`'feat/' + workItemId.toLowerCase() + '-' + slugify(title)` — and it takes the
slug rule from the TASK-AI-111 helper (`require('./slugify')`) instead of
re-implementing it, so every Work Item branch is derived the same way and the
slug rule keeps exactly one owner. A work item id outside
`/^(TASK|FEAT)-[A-Z0-9-]+$/` is rejected with `BRANCH_NAME_INPUT_INVALID`
before the title is touched. The helper is a pure function over strings: no
I/O, no clock, no randomness, no module state, Node built-ins only.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| BN-R01 | `branchNameFor(workItemId, title)` for `TASK-*` and `FEAT-*` ids, separator runs and edges in the title, 48- and 60-character title slugs | Returns `'feat/' + workItemId.toLowerCase() + '-' + slugify(title)`; the id is lower-cased verbatim (never slugified); the title slug keeps every TASK-AI-111 rule (separator runs collapse, edges trimmed, 48-character cap, no trailing dash) | BN-R01 tests in `tools/ai-brain/test/proof-branch-name.test.js` |
| BN-R02 | Work item id outside `/^(TASK|FEAT)-[A-Z0-9-]+$/` (lower-case id, unknown family, trailing junk, empty, non-string) | Throws `Error` with code `BRANCH_NAME_INPUT_INVALID` before the title is touched | BN-R02 tests in `tools/ai-brain/test/proof-branch-name.test.js` |
| BN-R03 | Module wiring (`require('./slugify')` present, no local slug rule); a patched `slugify` export observed at runtime; discriminating title slugs; title that slugs to nothing | The TASK-AI-111 `slugify` helper is reused and never re-implemented: the runtime call reaches `./slugify`, title failures propagate `SLUGIFY_INPUT_INVALID` | BN-R03 tests in `tools/ai-brain/test/proof-branch-name.test.js` |
| BN-R04 | Handoff metadata | Work Item and delivery register identify row `224`, `READY_FOR_CODEX`, and branch `feat/task-ai-112` | Work Item and register diff |

## Verification Commands

- `node --test tools/ai-brain/test/proof-branch-name.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `git diff --check`

## Residual Limitations

- `branchNameFor` always derives a `feat/` branch and takes no `kind` parameter; `fix/*` branches still come from TASK-AI-111's `branchName`, so two helpers can spell a branch for the same Work Item differently until a later item unifies them.
- The work item id is lower-cased verbatim instead of being slugified, so a pattern-valid id with repeated dashes (for example `TASK-AI--1`) keeps them in the branch name.
- Non-string work item ids (including boxed `String` objects and arrays) are rejected with `BRANCH_NAME_INPUT_INVALID` instead of being coerced, even though the BN-R02 regex would accept their stringified form.
- Title failures are rejected by `slugify` with `SLUGIFY_INPUT_INVALID` rather than `BRANCH_NAME_INPUT_INVALID`; the error code names the input owner.
