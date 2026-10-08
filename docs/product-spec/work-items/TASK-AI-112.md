# TASK-AI-112 — A branch-name helper that reuses the shared slugify helper

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

Work Item branches had no single call site that turns a Work Item id and a title into the `feat/<lowercase-work-item-id>-<short-slug>` shape `AGENTS.md` fixes for Work Items, so every caller spelled the rule again. This Work Item adds `tools/ai-brain/branch-name.js`, one pure helper module (Node built-ins only, no I/O, no clock, no state) that owns the derivation:

- `branchNameFor(workItemId, title)` returns `'feat/' + workItemId.toLowerCase() + '-' + slugify(title)`, where `slugify` is the TASK-AI-111 primitive imported with `require('./slugify')`. The slug rule is never re-implemented here, so every derived branch keeps one spelling of the slug.
- A `workItemId` that does not match `/^(TASK|FEAT)-[A-Z0-9-]+$/` (wrong family, lower-case, non-string, empty) is refused with `Error` carrying `code = BRANCH_NAME_INPUT_INVALID`, never replaced with a guessed name. `BRANCH_NAME_INPUT_INVALID` is reserved for the Work Item id; an unusable title surfaces `SLUGIFY_INPUT_INVALID` from the reused helper.
- The helper is deterministic: the same id and title always derive the same branch.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| BN-R01 | Branch from id and title | `branchNameFor('TASK-AI-112', 'Add Branch Name Helper!')` returns `feat/task-ai-112-add-branch-name-helper`, i.e. `'feat/' + workItemId.toLowerCase() + '-' + slugify(title)` | `branchNameFor derives feat/<lower-cased work item id>-<slugified title>` in `tools/ai-brain/test/proof-branch-name.test.js` |
| BN-R01 | The title segment is the shared slug | The composed segment equals `slugify(title)` from `require('./slugify')`; separator runs, trimming and the 48-character cap match the TASK-AI-111 rule | `branchNameFor composes feat/<lower-cased id>-<slugify(title)> with the shared helper`; `branchNameFor slugs the title exactly like the shared helper` |
| BN-R01 | Slug rule reused, never re-implemented | Patching `require('../slugify').exports.slugify` before loading `branch-name.js` changes the derived segment to the patched slug, so the module cannot carry its own slug rule | `branchNameFor reuses the TASK-AI-111 slugify helper instead of re-implementing it` |
| BN-R01 | Fixed `feat/` prefix, id families lower-cased | `branchNameFor('FEAT-12', 'Fix the thing')` returns `feat/feat-12-fix-the-thing`; `branchNameFor('TASK-FOUND-02', 'E1 R1 2026')` returns `feat/task-found-02-e1-r1-2026` | `branchNameFor always emits the feat prefix and lower-cases a FEAT id`; `branchNameFor keeps digits and the TASK-FOUND family` |
| BN-R02 | `workItemId` does not match `^(TASK\|FEAT)-[A-Z0-9-]+$` | throws `Error` with code `BRANCH_NAME_INPUT_INVALID` — for `task-ai-112`, for `BUG-1`, `TASKX-1`, `FEAT`, `TASK-`, `TASK-AI-112 extra`, and for non-string or empty input | `branchNameFor throws BRANCH_NAME_INPUT_INVALID for a lower-case work item id`; `branchNameFor throws BRANCH_NAME_INPUT_INVALID outside the TASK and FEAT families`; `branchNameFor throws BRANCH_NAME_INPUT_INVALID for a non-string or empty id` |
| BN-R02 | Unusable title is not the id rule | A non-string or empty-after-slugify title surfaces `SLUGIFY_INPUT_INVALID` from the reused helper | `branchNameFor surfaces SLUGIFY_INPUT_INVALID for a title the shared helper refuses` |
| BN-R03 | Proof under `node:test`, including a reuse proof | `node --test tools/ai-brain/test/proof-branch-name.test.js` reports 11 tests with `fail 0`, one of them the slugify-reuse proof and one the purity check | test output |
| BN-R04 | Control documents | This document with Control, Business Outcome, Acceptance Matrix, Verification Commands, Residual Limitations; one appended register row `224` (`READY_FOR_CODEX`, branch `feat/task-ai-112`) | `git diff --numstat` for the register is `1 0` |

## Verification Commands

- `node --test tools/ai-brain/test/proof-branch-name.test.js` — 11 pass, 0 fail
- `node --test tools/ai-brain/test/proof-slugify.test.js` — 13 pass, 0 fail (TASK-AI-111 dependency intact)
- `node --test "tools/ai-brain/test/*.test.js"` — 1568 pass, 48 fail; the 48 are pre-existing failures unchanged by this Work Item (baseline on this tree before the change: 1557 pass, 48 fail — the difference is exactly these 11 new tests)
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: `node --test tools/ai-brain/test/proof-branch-name.test.js` fails with `Cannot find module '../branch-name'` (watched and recorded before implementation).
- Pass-after: the same command reports 11 pass, 0 fail.

## Residual Limitations

- The dispatch prompt's `Allowed files` line named only `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, while BN-R01, BN-R03 and BN-R04 require `tools/ai-brain/branch-name.js`, `tools/ai-brain/test/proof-branch-name.test.js` and this document. The acceptance matrix is the definition of done, so exactly those four files were written and the conflict is recorded here for the controller to correct the plan's allowed-paths field; owner: ShipDe Controller; risk: scope metadata does not match the delivered diff; next action: fix the work item spec before dispatch. The prompt's goal line ("add a pure slugify helper and a branch-name helper") is likewise the gate5 run goal shared with TASK-AI-111; BN-R01 governs here and `slugify` is reused, never re-implemented.
- `tools/ai-brain/slugify.js` (TASK-AI-111) also exports a `branchNameFor`, but with the shape `branchNameFor(kind, workItemId, title?)`. This module's `branchNameFor(workItemId, title)` is the fixed-`feat/` Work Item derivation; two sibling modules therefore export the same name with different shapes, and callers must pick the one they mean. TASK-AI-111's helper and its 13 proof tests are left untouched.
- `branchNameFor` takes a required `title`: the BN-R01 formula always appends `'-' + slugify(title)`, so an omitted title surfaces `SLUGIFY_INPUT_INVALID` from the reused helper rather than dropping the segment. Callers that need a bare `feat/<id>` branch name cannot use this helper.
- `BRANCH_NAME_INPUT_INVALID` covers only the Work Item id. A title that is not a string or that slugs to nothing raises `SLUGIFY_INPUT_INVALID` (the shared helper's code); no title rule is duplicated here.
- No composed-branch length check is applied: BN-R01 is a plain concatenation and only `slugify` caps the title at 48 characters.
- The id pattern `/^(TASK|FEAT)-[A-Z0-9-]+$/` accepts every `TASK-*` and `FEAT-*` id, which is broader than the `FEAT-*`, `TASK-FOUND-*` and `TASK-AI-*` families `AGENTS.md` names; BN-R02 fixes the pattern, so it is used verbatim.
- `branchNameFor` is not consumed by the controller or the publisher yet; wiring those callers is outside this Work Item's allowed paths.
- `node_modules` is not installed in this workspace, so `prettier --check` cannot be run locally. Both JS files are hand-formatted to `.prettierrc` (`semi`, `singleQuote`, `tabWidth: 2`, `trailingComma: es5`, `printWidth: 100`): no trailing comma in call-argument lists and every line at or below 100 characters. If the host format gate still flags drift, that finding takes the usual bounded repair round.
- The session usage report path `C:\Users\gumac\AppData\Local\Temp\shipde-usage\TASK-AI-112-1791451146205-a1.json` is not writable from this worker account (write attempt failed `UnauthorizedAccessException: Access is denied`); per the dispatch prompt the harness collects the report from the run result instead.
- The 48 pre-existing failures of `node --test "tools/ai-brain/test/*.test.js"` are outside this Work Item: publisher refusal expectations that refuse to run from inside the worker root, `regression 10: discovery source and test files pass prettier format check` (needs `require('prettier')`), `PowerShell WhatIf runs without changes`, gateway/credential, isolation-launcher and task-ai-64/73/77/113/116/123 harness cases. No failing test imports `tools/ai-brain/branch-name.js` or `tools/ai-brain/slugify.js`.
