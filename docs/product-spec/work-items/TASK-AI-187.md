# TASK-AI-187 — The review-manifest CLI finds the review artifact without crashing

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-187` |
| Feature ID | `N/A` |
| Status | `READY_FOR_AUTHOR` |
| Dependencies | None |
| Assigned author | Controller (combo `vinh`): first end-to-end run after combo-only routing |
| Risk | `LOW` |
| Complexity | `low` |
| Allowed paths | `tools/ai-brain/review-manifest.js`; `tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js` |
| Reviewer | Controller review lane |
| Branch | `feat/task-ai-187-review-manifest-cli` |

## Business outcome

Running `node tools/ai-brain/review-manifest.js <manifest> <repo> <commit> <work-item>` without an explicit artifact path validates the manifest instead of crashing.

Today the command-line entry point (`require.main === module`, around line 455) calls `path.dirname` and `path.join` to locate `review-artifact-<work-item>.md` next to the manifest. The module never requires `path`, so the command fails with `ReferenceError: path is not defined` before it validates anything.

## Scope

- Require Node's `path` module in `tools/ai-brain/review-manifest.js`.
- Add one narrow test that runs the file as a CLI without the sixth argument and checks that it does not fail with a `ReferenceError`.
- Change no other behaviour of `validateManifestFile` or of the exported API.

## Acceptance

| ID | Criterion | Evidence |
|---|---|---|
| AC1 | Running the CLI with a manifest path and no artifact argument exits without `ReferenceError: path is not defined` | `tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js` |
| AC2 | When `review-artifact-<work-item>.md` exists next to the manifest, the CLI uses it as the artifact path | `tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js` |
| AC3 | The exported API and existing review-manifest tests are unchanged | `tools/ai-brain/test/task-ai-102.test.js` and `tools/ai-brain/test/receipt-title-integrity.test.js` pass |

## Verification

- `node --test tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js`
- `node --test tools/ai-brain/test/task-ai-102.test.js tools/ai-brain/test/receipt-title-integrity.test.js`
