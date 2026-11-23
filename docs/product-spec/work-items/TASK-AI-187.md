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
| Allowed paths | `tools/ai-brain/review-manifest.js`; `tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js`; `docs/product-spec/work-items/TASK-AI-187.md`; `tools/ai-brain/cli/commands.js`; `tools/ai-brain/combo-reader.js`; `tools/ai-brain/context-pack.js`; `tools/ai-brain/intake.js`; `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/orchestrate/candidate-select.js`; `tools/ai-brain/orchestrate/repair-round.js`; `tools/ai-brain/orchestrate/review-lane.js`; `tools/ai-brain/pinpoint.js`; `tools/ai-brain/planner.js`; `tools/ai-brain/prompt-compiler.js`; `tools/ai-brain/test/f2-writer-paths-contract.test.js`; `tools/ai-brain/test/r1-r2-telemetry-and-review.test.js`; `tools/ai-brain/writer-scope.js` |
| Writer paths | `tools/ai-brain/review-manifest.js`; `tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js` |
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
## Live prerequisites approved for TASK-AI-187

- R1. When combo selection falls back to the configured combo, record the selection gate, pool kinds, read state and status, member and eligibility counts, and selection reason through the sanitized decision log. Replay the isolated CLI and the retry after an upstream 402.
- R2. In strict isolated review, refuse a reviewer matching the Controller-selected writer identity or a writer whose identity is unknown. A refusal cannot become PASS through a fallback or an explicit reviewer override. Preserve established behavior outside strict mode.
- Verify both prerequisites with r1-r2-telemetry-and-review.test.js and record the live run against its exact SHA. Publication requires a new writer commit and passing independent review.
- Identity enforcement in this scope uses Controller-selected identity. The actual model served by an opaque 9router combo remains unverified.

- F2. Use the two Writer paths for the writer and repair prompt, context, and diff checks. Review the integrated change using Allowed paths. Use PowerShell instructions for isolated workers.
- Verify the Writer paths contract with f2-writer-paths-contract.test.js.
