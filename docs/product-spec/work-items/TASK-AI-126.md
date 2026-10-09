# TASK-AI-126: the Controller can launch agy-pool and AutoClaw workers in live runs

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-126` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `239` |
| Dependencies | `None` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/harness.js`; `tools/ai-brain/sources.json`; `tools/ai-brain/failure-classifier.js`; `tools/ai-brain/candidates.js`; `tools/ai-brain/orchestrate.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/test/task-ai-126.test.js`; `docs/product-spec/work-items/TASK-AI-126.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-126-agy-autoclaw-live` |
| Pull Request | `Pending` |

## Business Outcome

The Controller must be able to select and launch agy-pool and AutoClaw workers itself in live runs, rather than needing the supervisor to launch them by hand. This includes candidate generation, failure classification, handling specific launcher arguments without leaking credentials, and executing them in host-sandboxed environments via an explicit flag.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AL-R01 | autoclaw argv building | Builds openclaw argv with prompt file pattern, passes token ONLY via env var name, reports session id | `tools/ai-brain/test/task-ai-126.test.js` — test "AL-R01: autoclaw argv building without the token value" |
| AL-R01 | 810002 classification | HTTP 403 + body code 810002 is upstream_rate_limit, retryable, retryAfterMs exactly 120000; a plain 403 stays upstream_entitlement | `tools/ai-brain/test/task-ai-126.test.js` — test "AL-R01: 810002 classification" |
| AL-R02 | candidate registration | agy-pool one candidate per account agy01..agy10 (failure domain agy/<account>) and autoclaw zai models (autoclaw/zai) are registered | `tools/ai-brain/test/task-ai-126.test.js` — test "AL-R02: candidate registration with failure domains" |
| AL-R02 | Controller selection (autoclaw) | An autoclaw candidate has a concrete accountId (not '*') and the Controller selects it when it is the best candidate — never WILDCARD_ACCOUNT | `tools/ai-brain/test/task-ai-126.test.js` — test "AL-R02: the Controller selects an autoclaw candidate with a concrete account and no WILDCARD_ACCOUNT" |
| AL-R02 | Controller selection (agy-pool) | An agy-pool candidate has a concrete accountId and the Controller selects it — never WILDCARD_ACCOUNT | `tools/ai-brain/test/task-ai-126.test.js` — test "AL-R02: the Controller selects an agy-pool candidate with a concrete account and no WILDCARD_ACCOUNT" |
| AL-R03 | launcher flag gating | Live path uses host-sandboxed launcher enabled by --external-workers and is never the default | `tools/ai-brain/test/task-ai-126.test.js` — test "AL-R03: launcher flag gating and launch correctness" |
| AL-R03 | external launch | The autoclaw/agy-pool launch is built with the prompt file and the token passed only through the env var name (never the value) | `tools/ai-brain/test/task-ai-126.test.js` — tests "AL-R03: the external launch passes the token only through the env var name" and "AL-R03: the agy-pool external launch writes job.json and triggers the scheduled task" |
| AL-R04 | reviewer role selection | The reviewer role may select an autoclaw candidate and the review prompt carries the diff inline (no tool use) | `tools/ai-brain/test/task-ai-126.test.js` — test "AL-R04: the reviewer role selects an autoclaw candidate and the review prompt carries the diff inline" |
| AL-R05 | agy account validation | Validates account ID matches pattern | `tools/ai-brain/test/task-ai-126.test.js` — test "AL-R05: agy account validation" |
| AL-R06 | Work Item and register | `TASK-AI-126.md` maps every AL-R0x to a named test; exactly one appended register row `239` | `tools/ai-brain/test/task-ai-126.test.js` — test "AL-R06: every AL-R0x maps to a named test and the register row 239 is one 14-column row"; `git diff origin/main --numstat` for the register is `1 0` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-126.test.js tools/ai-brain/test/task-ai-121.test.js tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-115.test.js tools/ai-brain/test/failure-classifier.test.js tools/ai-brain/test/task-ai-64.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/harness.js tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-126.test.js docs/product-spec/work-items/TASK-AI-126.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: AL-R01, AL-R02, AL-R03, AL-R05 tests fail.
- Pass-after: All new tests pass.

## Residual Limitations

- AutoClaw adapter uses the `OPENCLAW_GATEWAY_TOKEN` environment variable read from host.
