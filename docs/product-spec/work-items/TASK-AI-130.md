# TASK-AI-130 — The Controller discovers every agy-pool model and selects by evidence, with no hard-coded model

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-130` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `243` |
| Dependencies | `TASK-AI-126` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/sources.json`; `tools/ai-brain/agy-pool-runtime.js`; `tools/ai-brain/candidates.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/test/task-ai-126.test.js`; `tools/ai-brain/test/task-ai-130.test.js`; `docs/product-spec/work-items/TASK-AI-130.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-130-agy-capabilities` |
| Pull Request | `Pending` |

## Business Outcome

Root cause: `tools/ai-brain/sources.json` declared the `agy-pool` source with the single hard-coded modelId `"gemini-3.1-pro-low"`, preventing the pool from offering any of the other models exposed by the Antigravity backend (`gemini-3.8-flash-*`, `gemini-3.7-flash-*`, `claude-opus-4-6-thinking`, `claude-sonnet-4-6`, `gpt-oss-120b-medium`, etc.). Furthermore, agy-pool candidates carried no capabilities, causing every agy-pool candidate to be rejected with `CAPABILITY_MISSING:jsonSchema` for the foundation author role.

AC-R01: No model ID is hard-coded for `agy-pool`. The pool's model list is discovered dynamically: preferring `agy models` CLI listing, otherwise falling back to importing Antigravity backend ("ag/" offerings) from catalogue data, stripping the gateway prefix. Discovery results are cached in memory and in catalogue data; if discovery fails, the pool keeps the last good list and records a warning, never falling back to a hard-coded model ID.

AC-R02: Each `agy-pool` candidate inherits capabilities and contextWindow from the catalogue entry for the same backend model ID (e.g., `gemini-3.8-flash-high`, `claude-opus-4-6-thinking`). Unknown models keep empty capabilities `{}` and reject with `CAPABILITY_MISSING`. The harness capability `tools: true` is recorded on `agy-pool` in `sources.json`. Effective capabilities are model AND harness.

AC-R03: Quota family mapping: `gemini-*` maps to `"gemini"`, `claude-*` and `gpt-*` map to `"claude-gpt"`. An account's candidates for a family are excluded when that family's quota is 0%, or when the account is AUTH_FAILED or missing. An account with Gemini exhausted can still offer its Claude models.

AC-R04: Ranking among discovered models uses existing evidence/quality/proof-floor logic only, with no special-casing of any model name.

AC-R05: Without `--external-workers agy-pool`, no agy-pool candidate is selected (TASK-AI-126 gating unchanged). The existing test `candidates.test.js` 'generates agy-pool candidates with the right 7-part key' stays unchanged and passing.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-R01 | Model discovery & caching | Models discovered via CLI or catalogue fallback, cached, resilient to failure | Test `AC-R06.5` in `task-ai-130.test.js` |
| AC-R02 | Catalogue capabilities inheritance | Known models inherit catalogue capabilities + harness tools; unknown models get `{}` | Tests `AC-R06.1`, `AC-R06.4` in `task-ai-130.test.js` |
| AC-R03 | Quota family mapping & account filtering | Gemini-0% still offers Claude; AUTH_FAILED accounts excluded | Tests `AC-R06.2`, `AC-R06.3` in `task-ai-130.test.js` |
| AC-R04 | Evidence-based ranking | Candidates ranked by evidence/quality without hard-coded model preferences | Test `AC-R06.1` in `task-ai-130.test.js` |
| AC-R05 | Launcher gating & regression safety | TASK-AI-126 launcher gate and 7-part key candidate test remain intact | Tests in `candidates.test.js` & `task-ai-126.test.js` |
| AC-R06 | Proof test suite | 6 sub-cases verifying discovery, family quota, auth failure, capabilities, cache, and zero literals | Tests `AC-R06.1`–`AC-R06.6` in `task-ai-130.test.js` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-130.test.js tools/ai-brain/test/task-ai-126.test.js tools/ai-brain/test/candidates.test.js tools/ai-brain/test/task-ai-68.test.js tools/ai-brain/test/discovery.test.js`

## Fail-Before / Pass-After

- Fail-before: On `origin/main` (`fee07f2c`), `tools/ai-brain/test/task-ai-130.test.js` is absent; `sources.json` contains hard-coded `"models": ["gemini-3.1-pro-low"]`; `candidates.js` carries `isAgyPool` hard-coding and does not discover models or catalogue capabilities; and all agy-pool candidates are rejected with `CAPABILITY_MISSING:jsonSchema`.
- Pass-after: All test cases in `tools/ai-brain/test/task-ai-130.test.js` pass, and all baseline test files pass cleanly: 124 passing tests across 5 test files (`task-ai-130.test.js`, `task-ai-126.test.js`, `candidates.test.js`, `task-ai-68.test.js`, `discovery.test.js`). Prettier checks and `git diff --check` are clean.

## Residual Limitations

- Model discovery caches results in memory and in `data/discovery/agy-pool-cache.json`; if both CLI and catalogue data are unavailable and no cache exists, discovery returns `[]` rather than guessing models.
- Family quota readings are derived from `out.txt` output from the `/quota` scheduled job; accounts without quota runs default to open headroom unless marked `AUTH_FAILED`.
