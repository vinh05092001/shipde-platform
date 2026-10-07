# TASK-AI-112 — Work Item branch names derive through the shared slugify helper

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

`AGENTS.md` requires one branch shape per Work Item,
`feat/<lowercase-work-item-id>-<short-slug>`, and TASK-AI-111 delivered the pure
`slugify` helper that normalizes the short slug. This Work Item adds the
branch-name helper that uses it: `branchNameFor(workItemId, title)` returns
`'feat/' + workItemId.toLowerCase() + '-' + slugify(title)`, deriving the title
segment through the TASK-AI-111 helper required as `require('./slugify')` and
never re-implementing its rules. The Work Item id keeps its structure and is
only lower-cased, so `TASK-AI-112` reads `task-ai-112` in every run and on
every host; an id outside `/^(TASK|FEAT)-[A-Z0-9-]+$/` throws `Error` with code
`BRANCH_NAME_INPUT_INVALID` before any name is derived. One helper, one slug
implementation, one branch string for the register, the controller and the
worker.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| BN-R01 | `branchNameFor(workItemId, title)` derivation | Returns `'feat/' + workItemId.toLowerCase() + '-' + slugify(title)` where the slug comes from the TASK-AI-111 `slugify` helper required as `require('./slugify')`, never re-implemented | BN-R01 tests in `tools/ai-brain/test/proof-branch-name.test.js` |
| BN-R02 | `workItemId` outside the pattern | Throws `Error` with code `BRANCH_NAME_INPUT_INVALID` when `workItemId` does not match `/^(TASK|FEAT)-[A-Z0-9-]+$/` | BN-R02 tests in `tools/ai-brain/test/proof-branch-name.test.js` |
| BN-R03 | Proof harness | Tests live in `tools/ai-brain/test/proof-branch-name.test.js` under `node:test` and include one that proves `slugify` is reused rather than re-implemented | `tools/ai-brain/test/proof-branch-name.test.js` |
| BN-R04 | Documentation and register | This Work Item document exists with Control, Business Outcome, Acceptance Matrix, Verification Commands and Residual Limitations; register gains row `224` for `TASK-AI-112`, status `READY_FOR_CODEX`, branch `feat/task-ai-112` | `docs/product-spec/work-items/TASK-AI-112.md` and the appended row in `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |

## Verification Commands

- `node --test tools/ai-brain/test/proof-branch-name.test.js`
- `git diff --check`

## Residual Limitations

- The prefix is always `feat/`; this helper does not derive `fix/...` names, which stay with TASK-AI-111's `branchName(workItemId, shortSlug, kind)`.
- `workItemId` is only lower-cased, never slugified, so its structure survives verbatim in the branch name; the caller passes an id the pattern already accepts.
- Invalid `title` surfaces `SLUGIFY_INPUT_INVALID` from the delegated helper rather than a branch-specific code; only `workItemId` reports `BRANCH_NAME_INPUT_INVALID`.
- Two different titles can collapse to the same slug through `slugify`'s 48-character cap; the caller keeps ownership of uniqueness.
