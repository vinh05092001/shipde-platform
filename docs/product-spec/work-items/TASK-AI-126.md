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
| AL-R01 | autoclaw argv building | Builds openclaw argv with prompt file pattern, passes token ONLY via env var name, reports session id | AL-R01 tests in `tools/ai-brain/test/task-ai-126.test.js` |
| AL-R01 | 810002 classification | Classifies 810002 as upstream_rate_limit, retryable, 120000ms | AL-R01 test |
| AL-R02 | candidate registration | Candidates exist with correct failure domains (agy/<account>, autoclaw/zai) | AL-R02 test |
| AL-R03 | launcher flag gating | Live path uses host-sandboxed launcher enabled by --external-workers | AL-R03 test |
| AL-R04 | reviewer role selection | Reviewer role may select an autoclaw candidate | Addressed by Fixing candidate wildcard |
| AL-R05 | agy account validation | Validates account ID matches pattern | AL-R05 test |
| AL-R06 | Work Item and register | `TASK-AI-126.md` added, exactly one appended register row `239` | `git diff origin/main --numstat` for the register is `1 0` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-126.test.js tools/ai-brain/test/task-ai-121.test.js tools/ai-brain/test/task-ai-116.test.js tools/ai-brain/test/task-ai-113.test.js tools/ai-brain/test/task-ai-115.test.js tools/ai-brain/test/failure-classifier.test.js tools/ai-brain/test/task-ai-64.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/harness.js tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-126.test.js docs/product-spec/work-items/TASK-AI-126.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: AL-R01, AL-R02, AL-R03, AL-R05 tests fail.
- Pass-after: All new tests pass.

## Residual Limitations

- AutoClaw adapter uses the `OPENCLAW_GATEWAY_TOKEN` environment variable read from host.
