# TASK-AI-139 — Poolside and InternLM as direct model sources

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-139` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `249` |
| Dependencies | `TASK-AI-127` |
| Assigned author | `Codex` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/sources.json`; `tools/ai-brain/discovery.js`; `tools/ai-brain/discovery/adapters.js`; `tools/ai-brain/discovery/http.js`; `tools/ai-brain/test/task-ai-139.test.js`; `docs/product-spec/work-items/TASK-AI-139.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-139-poolside-internlm` |
| Pull Request | `Pending` |

## Business Outcome

Add Poolside and InternLM as separate direct model sources. Provider API keys are configured by the operator as environment variables; only environment variable names are stored in repository configuration. Model identifiers are discovered at runtime from each provider's model-list API and are never hard-coded.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| DS-R01 | Provider source definitions | OpenAI-compatible endpoints, env credential names, model-list verification and official documentation references | Registry inspection and discovery tests |
| DS-R02 | Model and capability discovery | Models come from `/models`; no model IDs or inferred capabilities are configured | Registry inspection and candidate tests |
| DS-R03 | Credential lifecycle | Missing credentials refuse locally; launch environment passes only selected env var name; no key is persisted | Launcher regression tests and secret scan |
| DS-R04 | Regression proof | Fake HTTP/env values demonstrate candidates, missing credential refusal, secret containment and endpoint source | `task-ai-139.test.js` |
| DS-R05 | Operator handoff | Work Item and one register row document setup, restart, and rotation guidance | Documentation and register inspection |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-139.test.js tools/ai-brain/test/candidates.test.js tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-130.test.js`
- `node --test tools/ai-brain/test/*.test.js` with `NINEROUTER_API_KEY` unset
- `./node_modules/.bin/prettier --check` on changed source, test and Work Item files
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: on `origin/main`, `poolside` and `internlm` have no source entries and TASK-AI-139 regression tests do not exist; runtime discovery cannot emit these direct candidates.
- Pass-after: pending execution on this branch; command results will be recorded after implementation verification.

## Operator Steps

Set the API keys in the Windows user environment (enter each provider-issued value locally; never paste a value into repository files, tests, logs, decisions, or worker files):

```powershell
setx POOLSIDE_API_KEY "<key>"
setx INTERNLM_API_KEY "<key>"
```

Restart the Controller process after setting these variables so it inherits the updated environment. If either key was ever pasted into a chat, log, repository, or other unintended location, rotate that provider key immediately.

## Residual Limitations

- Poolside deployments may use deployment-specific endpoints; the configured hosted endpoint is the documented Poolside Platform endpoint.
- Provider model capabilities remain empty until present in a trusted catalogue entry; routing must reject any missing required capability with `CAPABILITY_MISSING`.
