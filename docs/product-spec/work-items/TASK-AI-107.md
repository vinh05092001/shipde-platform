# TASK-AI-107 — Rate limits are classified as quota, not harness failures

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-107` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `220` |
| Dependencies | None |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/failure-classifier.js`; `tools/ai-brain/isolation-launcher.js`; `tools/ai-brain/test/task-ai-107.test.js`; `docs/product-spec/work-items/TASK-AI-107.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-107-quota-not-harness` |
| Pull Request | `Pending` |

## Business Outcome

A live Gate B run that ends in an upstream 429 / FreeUsageLimitError rate limit no longer blames the harness. The classifier reads the structured error events in the isolated worker's stdout, classifies quota signals as `quota_exhausted` at upstream (or account when known) scope, and keeps the reset-after / isRetryable hints as cooldown data. `launch_config` is assigned only when the worker never started a model step and the launcher reports a configuration error, so one exhausted upstream stays a small domain and candidates on other upstreams of the same harness remain selectable instead of every candidate on the harness being blocked into `NO_ALTERNATE_FAILURE_DOMAIN`.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| FC-R01 | Recorded Gate B run 2 launch result (2026-10-06 04:53): worker stdout of JSON events ending in `{type:'error', error:{name:'APIError', data:{message:'[opencode-zen/big-pickle] [429]: ... FreeUsageLimitError Rate limit exceeded', statusCode:503, isRetryable:true}}}`, exit 1, empty stderr | Classifies `quota_exhausted` at `upstream` scope — not `launch_config` / `harness`; the structured error event is read from the worker stdout | `node --test tools/ai-brain/test/task-ai-107.test.js` (replay of the recorded result from `tools/ai-brain/test/fixtures/gateB2-launch-result.json`) |
| FC-R02 | Structured error events carrying 429, FreeUsageLimitError, rate limit, quota, insufficient credits, daily cap or INFERENCE_CAP_ERROR | `quota_exhausted` at `upstream` scope (or `account` when the cause names an account), never harness; isRetryable/reset-after hints kept as cooldown data (`retryable`, `cooldownMs`, `resetTime`) | Signal-table and 429-envelope assertions in `tools/ai-brain/test/task-ai-107.test.js` |
| FC-R03 | Launch/config failure with worker model-step events present; same failure with no model steps and a launcher configuration-error report | With `step_start`/`tool_use` events the result is never `launch_config`/`HARNESS_FAILED`; without model steps and with a configuration error report `launch_config` at `harness` scope stays assigned | FC-R03 test pair in `tools/ai-brain/test/task-ai-107.test.js` |
| FC-R04 | Replay of the recorded FC-R01 stdout through `classifyFailure` and `sameFailureDomain` | Asserts `quota_exhausted` at `upstream` scope; a candidate on another upstream of the same harness is not in the failed domain (still selectable) while the same upstream stays blocked | Failure-domain assertions in `tools/ai-brain/test/task-ai-107.test.js` |
| FC-R05 | Handoff metadata | Work Item and delivery register identify row `220`, `READY_FOR_CODEX`, and branch `feat/task-ai-107-quota-not-harness` | Work Item and register diff |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-107.test.js`
- `node --test "tools/ai-brain/test/*.test.js"`
- `./node_modules/.bin/prettier --write tools/ai-brain/failure-classifier.js tools/ai-brain/test/task-ai-107.test.js docs/product-spec/work-items/TASK-AI-107.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Residual Limitations

- The FC-R02 signal list classifies as `quota_exhausted` only when it appears in a structured error event (the launcher's trusted channel). The existing body/stderr classification table is unchanged: a plain body 429 with rate-limit text still classifies `upstream_rate_limit` (Case 4), and untrusted raw worker text can still never widen to quota (`failure-classifier.test.js` Finding F2).
- FC-R03's "never started a model step" counts genuine stream events: a step-start/tool part payload or the event envelope's session/message identity. A bare synthetic `{"type":"step_start","step":1}` line without that envelope is not proof the model ran — the untouched Finding F2 spoofing test in `tools/ai-brain/test/failure-classifier.test.js` keeps its `launch_config` expectation on exactly that shape.
- Under strict FC-R03 an explicit `LAUNCH_CONFIG`/`HARNESS_FAILED` cause no longer assigns harness scope when genuine model-step events are present; such a failure classifies by its remaining signals.
- `tools/ai-brain/isolation-launcher.js` is unchanged: the launch result already carries the worker stdout stream, and the classifier reads the structured events from it directly. The recorded Gate B result is preserved as the test fixture copy `tools/ai-brain/test/fixtures/gateB2-launch-result.json`; the root `gateB2-launch-result.json`, `TASK-AI-107-spec.json` and `PROMPT.md` are untouched.
