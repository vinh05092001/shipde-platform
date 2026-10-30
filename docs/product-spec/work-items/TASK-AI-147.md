# TASK-AI-147 — Controller live route quota scanner with real clock and OpenCode sync

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-147` |
| Feature ID | `N/A — controller route scanning overhaul, live models, real clock, and reverse sync` |
| Status | `IN_PROGRESS` |
| Delivery order | `266` |
| Dependencies | `TASK-AI-142` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/quota-scan.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/sources.json`; `tools/ai-brain/routing.js`; `tools/ai-brain/route-health.js`; `tools/ai-brain/test/task-ai-147*.test.js`; `scripts/ai/hardcode-allowlist.json`; `docs/product-spec/work-items/TASK-AI-147.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-147-route-scan` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Revamp the Controller's route scanning mechanism across `tools/ai-brain/quota-scan.js`, `cli.js`, and `sources.json`:
1. Model source: Fetch live model list from `GET {endpoint}/models` for each configured source in `sources.json` using the declared credential env var. Do not read `opencode.json` as a model source. For sources that do not provide a `/models` endpoint, explicitly declare `models` with an update timestamp in `sources.json`.
2. Eliminate UNSCANNABLE: Sources lacking `models` or `verify.model` discover their models via step 1; probe with small completion with `max_tokens` adequate for reasoning models (>=128) and timeout resolved from configuration (never hardcoded 3000ms).
3. 9Router representative models: The representative model for each 9Router upstream prefix is chosen as the model with the highest prior score within that prefix, not simply the first model in `/models`.
4. Full route scanner: `quota-scan --full` from CLI executes `scanAllFullRoutes`, with upstream concurrency limiting and HTTP 429 retry with exponential backoff. Periodic scans and pre-intake preflight scans use the full route scanning path.
5. Real clock: `quota-state.json` `updatedAt` uses real clock timestamps (`Date.now()`) with clock injection supported for deterministic test suites, never fixed fixture timestamps.
6. Live route export and selection: Export verified alive routes with normalized prior scores and remaining quota for Controller/Jev writer and reviewer selection; when JEV is UNDECIDED, Controller deterministically selects the highest-scoring candidate from the verified alive routes. Record live run outcomes (success, hang/stalled, timeout, concurrency) into route health.
7. Reverse sync: Generate the `provider.ninerouter.models` section of `opencode.json` from 9Router's `/v1/models` after backing up the original configuration, modifying only the `models` dictionary.

## Constraints

- No hardcoded models, prefixes, timeouts, or numeric caps in production code.
- Fail closed on malformed responses or network failures.
- No test-only branching in production paths; use dependency injection (`fetch`, `now`, `env`, `quotaStateFile`).
- Unit tests run fully isolated with local fixtures and zero external network calls.
- Full `ai-brain` test suite and `check-no-hardcode.mjs` must pass clean.
