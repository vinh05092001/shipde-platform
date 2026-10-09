# TASK-AI-127 — Isolated workers can run the repo's formatter, linter and tests on product work

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-127` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `240` |
| Dependencies | `TASK-AI-123` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/executor.js`; `tools/ai-brain/prompt-compiler.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/decisions.js`; `tools/ai-brain/test/task-ai-127.test.js`; `docs/product-spec/work-items/TASK-AI-127.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-127-worker-deps` |
| Pull Request | `Pending` |

## Business Outcome

Root cause: the isolated worker root has NO node_modules, so the worker cannot run prettier, eslint, tsc or tests on the pnpm monorepo. Host-side verification works because the host worktree has node_modules.

WD-R01: before an isolated launch, when the repo at the base SHA has pnpm-lock.yaml, the launcher ensures a shared dependency directory C:\ShipDeWorker\deps\<sha256 of pnpm-lock.yaml + package.json files, first 16 hex>\node_modules. Populate it ONCE from the host worktree's installed node_modules.

WD-R02: after provisioning, the worker root gets node_modules as a junction to that shared directory, and the same for each workspace package node_modules that pnpm creates when the host has them.

WD-R03: if the deps directory cannot be prepared, the launch is NOT blocked. Record a warning WORKER_DEPS_UNAVAILABLE.

WD-R04: the worker prompt tells the worker which commands it can now run.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| WD-R01 | Shared dependency dir | Populated from host node_modules, reused via marker | Test |
| WD-R02 | Worker node_modules junctions | Root and workspace junctions point to shared dir, excluded from git | Test |
| WD-R03 | Graceful failure | Missing host node_modules warns but doesn't block | Test |
| WD-R04 | Worker prompt | Isolated worker is prompted with allowed test commands | Test |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-127.test.js`

## Fail-Before / Pass-After

- Fail-before (SHA `e29b6a33`, the reviewed commit): independent review verdict `CHANGES_REQUIRED` (`.upstream-tmp/findings1.md`) — WD-R04 text reached only `executor.js` `defaultPrompt`/`resumePrompt` and never the real isolated prompts (`orchestrate.js` `compilePrompt` author `:3515` and repair `:5660`; `cli.js:1982` dropped `opts`); WD-R03 warning was dead wiring (`opts.log`, no production caller); WD-R05 proofs (hash derivation, copy-once/reuse, failure-warns, prompt text) were missing.
- Fail-before (tests against the pre-fix sources, `git stash` of the six source files restoring their `e29b6a33` versions): `node --test tools/ai-brain/test/task-ai-127.test.js` → `tests 5, pass 0, fail 5` — every test fails, including the four review-proof tests (`…sha256 of pnpm-lock.yaml + package.json files`, `…copied once, then reused via the ready marker`, `…warns WORKER_DEPS_UNAVAILABLE in the decision log…`, `…prompts carry the runnable commands (author, repair and cli paths)`). On `origin/main` (`300d46dc`) `tools/ai-brain/test/task-ai-127.test.js` is absent entirely, so the suite fails there too.
- Pass-after (this revision): `node --test tools/ai-brain/test/task-ai-127.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-119.test.js tools/ai-brain/test/task-ai-120.test.js tools/ai-brain/test/task-ai-123.test.js tools/ai-brain/test/task-ai-64.test.js` with `NINEROUTER_API_KEY` removed → `tests 167, pass 167, fail 0`. `prettier --write` on the changed files and `git diff --check` are clean.

## Residual Limitations

- The hash key is derived from the worker clone at the base SHA while the copy payload comes from the host worktree's installed `node_modules`; when host HEAD differs from the base SHA, key and payload can disagree (spec-sanctioned behaviour of WD-R01, recorded here as asked by review item 7).
- The `.shipde-deps-ready` marker proves the tree was complete at populate time (staging copy + atomic rename). A cache damaged after the marker was written is not detected and is never re-copied.
- The secret filter is exact-filename, basename-level defence-in-depth for a `node_modules`-only copy source (including symlink targets). A secret stored under an innocuous file name cannot be detected by name alone.
- A process killed mid-populate can leave an inert `deps/<hash>.staging-*` directory. It is never junctioned or marked ready and is not garbage-collected.
- The `WORKER_DEPS_UNAVAILABLE` record carries `workItemId`/`branch` when the caller supplies them (orchestrate and cli dispatch do; the `executePlan` path shares one options object across assignments and records the warning without a work item id).
