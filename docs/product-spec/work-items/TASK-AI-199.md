# TASK-AI-199 — Keep the worker deps virtual store inside the cache

## Control

| Field           | Value                                                                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-199`                                                                                                                                                                                                                    |
| Feature ID      | `N/A`                                                                                                                                                                                                                            |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                |
| Dependencies    | `TASK-AI-187`                                                                                                                                                                                                                    |
| Assigned author | Claude (Opus) — prepared for release on `ef37995e` by Antigravity (`agy08`, Gemini)                                                                                                                                              |
| Risk            | `LOW`: adds `--virtual-store-dir=node_modules/.pnpm` to the shared worker deps `pnpm install` command so global pnpm settings cannot redirect symlinks outside the staging cache                                                 |
| Allowed paths   | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/test/worker-deps-local-virtual-store.test.js`; `docs/product-spec/work-items/TASK-AI-199.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model                                                                                                                                                                                        |
| Branch          | `feat/task-ai-199-worker-deps-vstore`                                                                                                                                                                                            |

## Business outcome

The shared worker deps cache ran `pnpm install --frozen-lockfile` without `--virtual-store-dir`, so a user or global pnpm `virtualStoreDir` setting could point the virtual store at another checkout. When that happened, cached dependencies linked outside the cache directory and every isolated worker launch failed with `WORKER_DEPS_LINK_OUTSIDE_CACHE`. Passing `--virtual-store-dir=node_modules/.pnpm` keeps the virtual store inside the staging tree regardless of host pnpm configuration.

## Scope and acceptance

| ID  | Criterion                                                                                                                                                                               | Evidence                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| AC1 | `isolation-launcher.js` passes `--virtual-store-dir=node_modules/.pnpm` to `pnpm install --frozen-lockfile` when staging worker dependencies                                            | `tools/ai-brain/test/worker-deps-local-virtual-store.test.js` |
| AC2 | When global pnpm config points `virtual-store-dir` outside the cache, worker dependency staging succeeds and all links remain inside the cache without `WORKER_DEPS_LINK_OUTSIDE_CACHE` | `tools/ai-brain/test/worker-deps-local-virtual-store.test.js` |

## Verification

- `node --test tools/ai-brain/test/worker-deps-local-virtual-store.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): only the known baseline failures (`repo-integration-vercel-skills`, `task-ai-109`, `task-ai-109-ui`).
