# TASK-AI-116 — Isolated opencode-direct launches can use a direct model source

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-116` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `229` |
| Dependencies | `TASK-AI-113` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/test/task-ai-116.test.js`; `docs/product-spec/work-items/TASK-AI-116.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-116-direct-sources-isolated` |
| Pull Request | `Pending` |

## Business Outcome

Problem (main `377d483`): the worker opencode.json is always built from the
`9router` entry in `tools/ai-brain/sources.json` (baseURL, apiKey
`{env:NINEROUTER_API_KEY}`), so a Controller-pinned candidate from a direct
OpenAI-compatible source (entries with `endpoint` and `credential.env` like
inception, dahl, regolo, amd-radeon, tencent, cohere, baseten, thb, rqsty)
cannot run isolated.

The launcher now resolves the source from the pinned model's first path segment
(e.g., `inception/mercury-2.5` → sources.json id `inception`; `ninerouter/...`
keeps the existing 9router behavior byte-for-byte). A direct source must have an
https endpoint (or http://127.0.0.1 / localhost) and credential.env, otherwise
the launcher fails closed with a structured error naming the unsupported source.
Unknown prefixes fall back to 9router (upstream providers like cl/, xmtp/, kr/).

The generated opencode.json uses the source's endpoint and credential, and the
worker env allowlist adds exactly that credential. The 9router case still adds
only NINEROUTER_API_KEY. If the required env var is missing on the host, the
launcher fails closed before spawning. Credential values never appear in logs,
files, errors or tests.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| DS-R01 | ninerouter/ model | 9router behavior unchanged; provider is ninerouter, baseURL is 127.0.0.1:20128/v1, apiKey is {env:NINEROUTER_API_KEY}, router prefix is stripped | DS-R01 tests in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R01 | inception/mercury-2.5 | Resolves to inception source; opencode.json uses inception endpoint and INCEPTION_API_KEY | DS-R01 tests in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R02 | Unknown prefix (cl/, xmtp/) | Falls back to 9router; uses 9router endpoint and NINEROUTER_API_KEY; upstream prefix sent whole (TASK-AI-96) | DS-R02 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R02 | Source without endpoint | Fails with OPENCODE_DIRECT_SOURCE_UNSUPPORTED naming the source id | DS-R02 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R02 | Source without credential.env | Fails with OPENCODE_DIRECT_SOURCE_UNSUPPORTED naming the source id | DS-R02 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R03 | Direct source opencode.json | Provider id = source id, baseURL = source endpoint, apiKey = {env:credential.env} | DS-R03 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R03 | Model id wire format | Model id sent WITHOUT the source prefix (inception/mercury-2.5 → mercury-2.5); both full and short entries exist in models map | DS-R03 tests in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R04 | Worker env allowlist | Adds ONLY the selected source's credential.env; 9router case adds only NINEROUTER_API_KEY | DS-R04 tests in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R04 | Missing credential | Fails with OPENCODE_DIRECT_CREDENTIAL_MISSING before spawning the worker | DS-R04 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R04 | Credential security | Credential VALUE never appears in opencode.json, run-target.ps1, logs, errors or tests; only the placeholder {env:VAR_NAME} is written | DS-R04 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R05 | Test style and regressions | Tests use node:test with stubbed spawnSync, temp worker root, fake env values; all isolation-launcher tests stay green | `node --test tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js tools/ai-brain/test/task-ai-109-rtk.test.js tools/ai-brain/test/task-ai-114.test.js` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js tools/ai-brain/test/task-ai-109-rtk.test.js tools/ai-brain/test/task-ai-114.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/isolation-launcher.js tools/ai-brain/test/task-ai-116.test.js docs/product-spec/work-items/TASK-AI-116.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (`377d483` + new tests): DS-R01 inception test fails (always uses
  9router endpoint), DS-R02 validation tests fail (no source validation),
  DS-R03 tests fail (prefix not stripped for direct sources), DS-R04 tests fail
  (always adds NINEROUTER_API_KEY, no credential check).
- Pass-after: all 15 TASK-AI-116 tests pass; TASK-AI-113, TASK-AI-96,
  TASK-AI-98, TASK-AI-109-rtk and TASK-AI-114 stay green.

## Residual Limitations

- Only OpenAI-compatible sources with `endpoint` and `credential.env` are
  supported. Sources using OAuth, account stores or CLI access paths remain
  unsupported for isolated launches and correctly fail closed.
- Upstream prefixes (cl/, xmtp/, kr/) that are not in sources.json fall back to
  9router. If 9router itself is unavailable, the launcher fails closed.
- The credential must be set in the host environment before the launcher runs.
  The launcher does not retrieve credentials from stores or generate temporary
  tokens.
