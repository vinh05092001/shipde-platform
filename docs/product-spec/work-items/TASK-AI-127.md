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
| Allowed paths | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/executor.js`; `tools/ai-brain/test/task-ai-127.test.js`; `docs/product-spec/work-items/TASK-AI-127.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
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

- Fail-before: Tests fail (no junctions logic)
- Pass-after: All tests pass

## Residual Limitations

- None
