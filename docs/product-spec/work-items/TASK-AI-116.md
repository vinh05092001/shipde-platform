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

The launcher now resolves the source from the candidate's `gateway` field (passed
from orchestrate.js), not the model prefix. Resolving from the model prefix was
ambiguous because 9Router model IDs carry upstream prefixes (xmtp/, cl/, kr/) and
an upstream name can equal a direct source id, which would silently mis-route a
9Router candidate to a direct endpoint or vice versa.

When `gateway === '9router'`: existing 9router behavior byte-for-byte (provider/
wireId rules unchanged, env NINEROUTER_API_KEY only). When gateway equals a
sources.json id with https endpoint (or http://127.0.0.1/localhost) and
credential.env: that direct source, model sent without its `<gateway>/` prefix if
present. Unknown gateway: OPENCODE_DIRECT_SOURCE_UNKNOWN. Known gateway but no
endpoint/credential.env: OPENCODE_DIRECT_SOURCE_UNSUPPORTED. No gateway (legacy
callers): 9router unchanged.

The generated opencode.json uses the source's endpoint and credential, and the
worker env allowlist adds exactly that credential. If the required env var is
missing on the host, the launcher fails closed before spawning. Credential values
never appear in logs, files, errors or tests.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| DS-R01 | gateway 9router with upstream model xmtp/mimo-v2.6-pro | Uses 9router config; wire id is full 'xmtp/mimo-v2.6-pro' (TASK-AI-96) | DS-R01 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R01 | gateway inception with model inception/mercury-2.5 | Uses inception endpoint, INCEPTION_API_KEY; model id sent as 'mercury-2.5' (prefix stripped) | DS-R01 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R01 | gateway 9router with model inception/mercury-2.5 | Uses 9router, NOT direct inception source | DS-R01 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R02 | Unknown gateway | Fails with OPENCODE_DIRECT_SOURCE_UNKNOWN naming the gateway | DS-R02 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R02 | Source without endpoint | Fails with OPENCODE_DIRECT_SOURCE_UNSUPPORTED | DS-R02 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R02 | Source without credential.env | Fails with OPENCODE_DIRECT_SOURCE_UNSUPPORTED | DS-R02 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R02 | No gateway (legacy callers) | Uses 9router unchanged | DS-R02 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R03 | Direct source opencode.json | Provider id = source id, baseURL = source endpoint, apiKey = {env:credential.env} | DS-R03 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R03 | Model id wire format | Model id sent WITHOUT the gateway prefix for direct sources; both full and short entries exist in models map | DS-R03 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R04 | Worker env allowlist | Adds ONLY the selected source's credential.env; 9router case adds only NINEROUTER_API_KEY | DS-R04 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R04 | Missing credential | Fails with OPENCODE_DIRECT_CREDENTIAL_MISSING before spawning the worker | DS-R04 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R04 | Credential security | Credential VALUE never appears in opencode.json, run-target.ps1, logs, errors or tests; only the placeholder {env:VAR_NAME} is written | DS-R04 test in `tools/ai-brain/test/task-ai-116.test.js` |
| DS-R05 | Test style and regressions | Tests use node:test with stubbed spawnSync, temp worker root, fake env values; all isolation-launcher tests stay green | `node --test tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js tools/ai-brain/test/task-ai-109-rtk.test.js tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-94.test.js` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-96.test.js tools/ai-brain/test/task-ai-98.test.js tools/ai-brain/test/task-ai-109-rtk.test.js tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-94.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/isolation-launcher.js tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-116.test.js docs/product-spec/work-items/TASK-AI-116.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (`8fda924` before supervisor fix): resolved source from model prefix,
  which is ambiguous (upstream prefixes can equal direct source IDs). Tests for
  gateway-based routing did not exist.
- Pass-after: all 14 TASK-AI-116 tests pass (gateway-based routing); TASK-AI-113,
  TASK-AI-96, TASK-AI-98, TASK-AI-109-rtk, TASK-AI-114, and TASK-AI-94 stay green
  (51 tests total).

## Residual Limitations

- Only OpenAI-compatible sources with `endpoint` and `credential.env` are
  supported. Sources using OAuth, account stores or CLI access paths remain
  unsupported for isolated launches and correctly fail closed.
- The gateway must be passed from orchestrate.js. Legacy callers that do not
  provide a gateway will use 9router by default.
- The credential must be set in the host environment before the launcher runs.
  The launcher does not retrieve credentials from stores or generate temporary
  tokens.
