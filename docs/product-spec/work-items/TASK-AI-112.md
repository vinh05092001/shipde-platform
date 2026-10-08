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

Work Item branches still had no single call site that turned a Work Item id and a title into a branch name, so each caller spelled the rule again. This Work Item adds `tools/ai-brain/branch-name.js`, a pure Node built-in module exporting one helper:

- `branchNameFor(workItemId, title)` — returns `'feat/' + workItemId.toLowerCase() + '-' + slugify(title)` where `slugify` is the TASK-AI-111 primitive imported with `require('./slugify')`. The slug rule is never re-implemented here, so every derived branch keeps one spelling of the slug.

`branchNameFor` is pure and deterministic: no I/O, no clock, no randomness, no global state, Node built-ins only. It is a fixed-`feat/` shortcut for the Work Item id families `TASK-*` and `FEAT-*`; the kind-aware variant with the three-family id check and the 60-character branch cap stays in `normalizeWorkItemBranch` (`tools/ai-brain/slugify.js`, TASK-AI-111).

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| BN-R01 | `branchNameFor(workItemId, title)` derives the branch | result is `'feat/' + workItemId.toLowerCase() + '-' + slugify(title)` with `slugify` taken from `require('./slugify')`, never re-implemented | BN-R01 tests in `tools/ai-brain/test/proof-branch-name.test.js` |
| BN-R02 | `workItemId` does not match `^(TASK\|FEAT)-[A-Z0-9-]+$` | throws `Error` with code `BRANCH_NAME_INPUT_INVALID` | BN-R02 tests in `tools/ai-brain/test/proof-branch-name.test.js` |
| BN-R03 | implementation and proof stay pure and shared | tests in `tools/ai-brain/test/proof-branch-name.test.js` with `node:test`, including one that proves `slugify` is reused | module imports and the slugify-reuse test output |
| BN-R04 | control documents exist | `docs/product-spec/work-items/TASK-AI-112.md` with Control, Business Outcome, Acceptance Matrix, Verification Commands, Residual Limitations; register row `224` for `TASK-AI-112` with status `READY_FOR_CODEX` and branch `feat/task-ai-112` | document content and register diff |

## Verification Commands

- `node --test tools/ai-brain/test/proof-branch-name.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `git diff --check`

## Residual Limitations

- The dispatch prompt's `Allowed files` line named only `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, while BN-R03 and BN-R04 require `tools/ai-brain/branch-name.js`, `tools/ai-brain/test/proof-branch-name.test.js` and this document. The acceptance matrix is the definition of done, so those three files were created and the conflict is recorded here for the controller to correct the plan's allowed-paths field; owner: ShipDe Controller; risk: scope metadata no longer matches the delivered diff; next action: fix the work item spec before dispatch.
- `branchNameFor` always emits the `feat/` prefix and takes no kind argument, so `fix/...` branches remain the job of `normalizeWorkItemBranch`.
- `branchNameFor` accepts every `TASK-*` and `FEAT-*` id that matches `^(TASK|FEAT)-[A-Z0-9-]+$`, which is broader than the `FEAT|TASK-FOUND|TASK-AI` families `normalizeWorkItemBranch` accepts.
- A title that is not a string or that slugs to empty surfaces `SLUGIFY_INPUT_INVALID` from the reused helper; `BRANCH_NAME_INPUT_INVALID` is reserved for the Work Item id, and no title rule is re-implemented here.
- No composed-branch length check is applied: BN-R01 is a plain concatenation and only `slugify` caps the title at 48 characters, so callers that need the 60-character branch rule keep using `normalizeWorkItemBranch`.
- `branchNameFor` is not consumed by the controller or the publisher yet; wiring those callers is outside this Work Item's allowed paths.
- The `node --test "tools/ai-brain/test/*.test.js"` suite reports the same 46 pre-existing failures as before this Work Item (missing `prettier` module and publisher/isolation tests that refuse to run from inside the worker root); `tools/ai-brain/test/proof-branch-name.test.js` passes in both runs.
- The session usage report path `C:\Users\gumac\AppData\Local\Temp\shipde-usage\...` is not writable from the worker account (access denied); the harness collects the report from the run result instead.
