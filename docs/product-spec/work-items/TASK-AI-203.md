# TASK-AI-203 — Retire the legacy dispatch command (Lát C-2b-2)

## Control

| Field           | Value |
| --------------- | ----- |
| Work Item ID    | `TASK-AI-203` |
| Feature ID      | `N/A` |
| Status          | `READY_FOR_CODEX` |
| Dependencies    | `TASK-AI-202` |
| Assigned author | Antigravity (`agy08`, Gemini) — Lát C cleanup; prepared for release by Claude |
| Risk            | `LOW`: removes the legacy `cli.js dispatch` command, whose live helpers moved to `orchestrate/runtime-helpers.js` in TASK-AI-202; the supported entry points `cli.js intake` and `cli.js orchestrate` are unchanged |
| Allowed paths   | `tools/ai-brain/cli.js`; `tools/ai-brain/cli/dispatch.js`; `tools/ai-brain/test/lat-c2b2-retire-dispatch.test.js`; `tools/ai-brain/test/controller-route-dispatch.test.js`; `tools/ai-brain/test/dispatch-json.test.js`; `tools/ai-brain/test/dispatch-order.test.js`; `tools/ai-brain/test/refresh-lists-only.test.js`; `tools/ai-brain/test/stale-score-producer.test.js`; `tools/ai-brain/test/task-ai-142-route-health-isolation.test.js`; `tools/ai-brain/test/task-ai-147-quota-scan.test.js`; `tools/ai-brain/test/task-ai-171-core-ticket-input.test.js`; `tools/ai-brain/test/task-ai-171-execute-target.test.js`; `tools/ai-brain/test/task-ai-171-gateway-error-class.test.js`; `tools/ai-brain/test/task-ai-171-jev-pipeline.test.js`; `tools/ai-brain/test/task-ai-171-launch-lifecycle.test.js`; `tools/ai-brain/test/task-ai-171-launch-options.test.js`; `tools/ai-brain/test/task-ai-171-route-pr02-regressions.test.js`; `tools/ai-brain/test/task-ai-171-route-pr12-options.test.js`; `tools/ai-brain/test/task-ai-171-scoring-policy.test.js`; `tools/ai-brain/test/task-ai-186-combo-followups.test.js`; `tools/ai-brain/test/task-ai-192-combo-reader.test.js`; `docs/product-spec/docs/10-ai-collaboration/WORKER-PLAYBOOK.md`; `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`; `docs/product-spec/work-items/TASK-AI-203.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | Independent reviewer on a different model |
| Branch          | `feat/task-ai-203-retire-legacy-dispatch` |

## Business outcome

Writer selection and launch go through `cli.js intake` and `cli.js orchestrate`. The older `cli.js dispatch` command and its 1,580-line `cli/dispatch.js` remained callable, so an operator or script could still reach the retired selection path by mistake. This Work Item deletes `cli/dispatch.js`, removes the dispatch command and its exports from `cli.js` (the command now fails closed with `DISPATCH_RETIRED` and exit code 1), removes the tests that only exercised that command, keeps the tests for live behaviour (including three agy-pool launch lifecycle cases that are restored against the live path), and points the current instructions in the worker playbook and toolchain decisions at the supported commands.

## Scope and acceptance

| ID  | Criterion | Evidence |
| --- | --------- | -------- |
| AC1 | `tools/ai-brain/cli/dispatch.js` is deleted; `cli.js` no longer exports `dispatchCommand` or `executeDispatchLaunch`; `intakeCommand` and `orchestrateCommand` remain | `lat-c2b2-retire-dispatch.test.js` |
| AC2 | `node tools/ai-brain/cli.js dispatch` fails closed with `DISPATCH_RETIRED` and exit code 1 | `lat-c2b2-retire-dispatch.test.js` |
| AC3 | Live agy-pool launch lifecycle behaviour stays covered: native allocation identity reaches the receipt consumer and owned stop, a report collision refuses before allocation, and a locked writer result is preserved | `task-ai-171-launch-lifecycle.test.js` |
| AC4 | Current instructions name `cli.js intake` / `cli.js orchestrate` instead of `cli.js dispatch`; historical Work Items are unchanged | `WORKER-PLAYBOOK.md`; `AI-TOOLCHAIN-DECISIONS.md` |

## Verification

- `node --test tools/ai-brain/test/lat-c2b2-retire-dispatch.test.js tools/ai-brain/test/task-ai-171-launch-lifecycle.test.js tools/ai-brain/test/task-ai-192-combo-reader.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): only the known baseline failures (`repo-integration-vercel-skills`, `task-ai-109`, `task-ai-109-ui`).
