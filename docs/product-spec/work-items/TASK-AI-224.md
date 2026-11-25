# TASK-AI-224 — Record agy-pool writer identityProof and enforce F2 receipt-bound scope gate (WI-C1 + scope)

## Control

| Field | Value |
| --- | --- |
| Work Item ID | `TASK-AI-224` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-223` |
| Assigned author | Wave 3 agy-pool team (AGY 08 + Claude + Codex); packaged by Antigravity (`agy08`, Gemini) |
| Risk | `LOW`: agy-pool writer flag remains OFF by default; enforces receipt root/head binding and F2 scope gate before adoption; worker-core.ps1 is not deployed to C:\Tools yet |
| Allowed paths | `scripts/ai/agy-pool/worker-core.ps1`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/orchestrate/writer-loop.js`; `tools/ai-brain/test/task-ai-142-agy-pool-producer.test.js`; `tools/ai-brain/test/task-ai-142-agy-writer-session.test.js`; `tools/ai-brain/test/wi-c1-agy-writer-proof.test.js`; `tools/ai-brain/test/wi-c1-agy-writer-scope-orchestrate.test.js`; `tools/ai-brain/test/wi-c1-agy-writer-scope.test.js`; `docs/product-spec/work-items/TASK-AI-224.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model |
| Branch | `feat/task-ai-224-agy-writer-proof-scope` |

## Business outcome

Wire agy-pool writer identityProof, F2 writer-scope commit check bound to worker-core.ps1 receipt, and job-root-only safe.directory. All agy-pool runtime flags stay OFF by default until the full Wave 3 stack lands on `main` and Stage 2 live proof is authorized.

## Scope and acceptance

| ID | Criterion | Evidence |
| --- | --- | --- |
| AC1 | Focused Wave 3 tests and existing JEV/criteria tests pass with zero regression | `tools/ai-brain/test/wi-c1-agy-writer-proof.test.js`; `tools/ai-brain/test/wi-c1-agy-writer-scope.test.js`; `tools/ai-brain/test/wi-c1-agy-writer-scope-orchestrate.test.js`; `tools/ai-brain/test/task-ai-142-agy-pool-producer.test.js`; `tools/ai-brain/test/task-ai-142-agy-writer-session.test.js` |
| AC2 | Default configuration keeps agy-pool opt-in flags OFF and leaves 9router-only dispatch unchanged | `tools/ai-brain/test/wi-c1-agy-writer-proof.test.js`; `tools/ai-brain/test/wi-c1-agy-writer-scope.test.js`; `tools/ai-brain/test/wi-c1-agy-writer-scope-orchestrate.test.js`; `tools/ai-brain/test/task-ai-142-agy-pool-producer.test.js`; `tools/ai-brain/test/task-ai-142-agy-writer-session.test.js` |

## Verification

- `node --test tools/ai-brain/test/wi-c1-agy-writer-proof.test.js tools/ai-brain/test/wi-c1-agy-writer-scope.test.js tools/ai-brain/test/wi-c1-agy-writer-scope-orchestrate.test.js tools/ai-brain/test/task-ai-142-agy-pool-producer.test.js tools/ai-brain/test/task-ai-142-agy-writer-session.test.js`
- Full brain suite (`node --test "tools/ai-brain/test/*.test.js"`): 0 failures on LF checkout without `.oc`.
