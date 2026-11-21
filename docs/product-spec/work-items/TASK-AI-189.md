# TASK-AI-189 — Legacy CLI cleanup (Lát A): remove dead subcommands and unreachable modules

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-189` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-171`; `TASK-AI-182` |
| Assigned author | Antigravity (`agy08`, Gemini) — operator instruction 2026-11-21 ("dọn cái cũ trước") |
| Risk | `LOW`: removes unreachable legacy CLI subcommands and dead modules with zero live callers |
| Allowed paths | `tools/ai-brain/cli.js`; `tools/ai-brain/cli/commands.js`; `tools/ai-brain/cli/reconcile-manifest.js`; `tools/ai-brain/agy-gateway.js`; `tools/ai-brain/shadow.js`; `tools/ai-brain/eval/compression-eval.js`; `tools/ai-brain/test/task-ai-142-agy-gateway.test.js`; `tools/ai-brain/test/shadow.test.js`; `tools/ai-brain/test/task-ai-151-compression-eval.test.js`; `tools/ai-brain/test/task-ai-189-lat-a-cleanup.test.js`; `docs/product-spec/work-items/TASK-AI-189.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model (`gpt-6.1-sol` via AgentRouter) |
| Branch | `feat/task-ai-189-cleanup-lat-a` |

## Business outcome

Shrinks the `tools/ai-brain` CLI surface and removes 2,154 lines of dead legacy code (`agy-gateway`, `shadow`, `prove`, `eval/compression-eval`) as Slice A of the post-combo-only cleanup plan (`deadmap.md`), while preserving all live subcommands, external dashboard/tool `require()` callers, and `repo-integration-group-3` contracts.

## Scope and acceptance

| ID | Criterion | Evidence |
|---|---|---|
| AC1 | Dead subcommands `agy-gateway`, `shadow`, and `prove` are removed from `cli.js`, `cli/commands.js`, and `cli/reconcile-manifest.js` | `tools/ai-brain/test/task-ai-189-lat-a-cleanup.test.js` |
| AC2 | Unreachable modules `agy-gateway.js`, `shadow.js`, and `eval/compression-eval.js` and their dedicated tests are removed | `tools/ai-brain/test/task-ai-189-lat-a-cleanup.test.js` |
| AC3 | Live CLI modules and existing tests continue to load and pass with no regressions | `node --test tools/ai-brain/test/task-ai-189-lat-a-cleanup.test.js` and full `tools/ai-brain` suite |

## Verification

- `node --test tools/ai-brain/test/task-ai-189-lat-a-cleanup.test.js`
- `node --test tools/ai-brain/test/task-ai-182-split-paths.test.js tools/ai-brain/test/decisions-size.test.js`
- Full `tools/ai-brain/test/*.test.js` suite (modulo known Windows-only failures)
