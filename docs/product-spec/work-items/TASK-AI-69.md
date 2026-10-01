# TASK-AI-69 — Pool quota discovery and first evidence through the CLI

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-69` |
| Feature ID | `N/A` |
| Status | `IN_PROGRESS` |
| Delivery order | `197` |
| Dependencies | `TASK-AI-68` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-69.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `tools/ai-brain/agy-pool-runtime.js`; `tools/ai-brain/candidates.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/harness.js`; `tools/ai-brain/refresh-quota.js`; `tools/ai-brain/routing.js`; `tools/ai-brain/test/*.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-69-pool-quota-evidence` |
| Pull Request | `TBD` |

## Business outcome

The Controller can discover the actual `agy01..agy10` pool accounts present in the pool runtime, refresh each account's real quota through its own scheduled-task adapter, and select a pool candidate after a real small job outcome records first evidence. Pool accounts that require login or report no remaining quota are excluded with explicit reasons instead of appearing as unproven candidates or stale placeholders.

## Source references

- `docs/product-spec/work-items/TASK-AI-68.md` § Specifications and § Known limitations — the pool runtime contract, quota/outcome states, and post-merge gaps.
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md` § Acceptance matrix and § Verification commands — required Work Item structure and evidence format.
- `AGENTS.md` § Pull Request evidence and § Verification — no fabricated evidence, no credential disclosure, and source-specific proof.

## Preconditions and dependencies

`TASK-AI-68` introduced the agy-pool candidate and adapter surface. The post-merge smoke test showed that the CLI quota refresh and first-evidence path were still incomplete because account discovery depended on the account registry and proof-floor evidence was absent for pool candidates.

## Author boundary

`GEMINI` is appropriate because this changes Controller routing behavior, quota refresh, dispatch evidence, and tests across multiple AI-brain modules. No product UX, tenant data, credentials, billing, or carrier-side effects are in scope. The implementation must not read or print tokens, must not fabricate evidence, and must use injected fake runtimes only in tests.

## In scope

- Discover agy-pool accounts from the runtime directories, not from the account registry.
- Refresh pool quota by submitting `{ "command": "quota" }` through the agy-pool adapter and parsing `result.json` plus `out.txt`.
- Exclude login-required accounts as `AUTH_FAILED` and zero-quota accounts as `QUOTA_EXHAUSTED`.
- Generate concrete seven-part pool candidate keys using discovered accounts and runtime-advertised models.
- Allow `dispatch --report-outcome` to record first evidence from a pool job result so profile dispatch can pass an `API_PASS` proof floor.
- Add CLI-spawn tests with injected HOME/USERPROFILE/TEMP, injected pool runtime, and fake adapter.

## Out of scope

- Creating Windows users or Scheduled Tasks.
- Copying, reading, exporting, or validating credentials.
- Adding a second account registry or alternate evidence store.
- Promoting API evidence to harness or work-item proof.
- Dispatching real network jobs in tests.

## Business rules and edge cases

- `AI-69-R01` — Runtime discovery: pool accounts are only directories matching concrete `agyNN` runtime accounts.
- `AI-69-R02` — Adapter quota: quota refresh writes a quota job and reads the resulting pool output; stale quota files are not authority.
- `AI-69-R03` — Explicit refusal: `login-required` maps to `AUTH_FAILED`; zero remaining quota maps to `QUOTA_EXHAUSTED`.
- `AI-69-R04` — Seven-part identity: every selectable pool candidate is `harness::accessPath::gateway::upstream::account::quotaScope::modelId`.
- `AI-69-R05` — Honest first evidence: only a reported real job outcome records proof; tests may fake the runtime but may not commit evidence data.

## UI states

No product UI changes. CLI output must name discovered accounts, exclusion reasons, proof-floor refusal, and successful pinned selection.

## API, event and data impact

The AI-brain CLI accepts injected runtime paths for tests and local verification. The quota cache may record pool account quota readings under the operator's HOME. The evidence store is updated only when `dispatch --report-outcome` receives a terminal outcome for a candidate key.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-69-01` | Given agy runtime directories not present in the account registry, when `cli.js quota` runs | The CLI discovers the runtime accounts and refreshes each through the agy-pool quota job adapter | `tools/ai-brain/test/task-ai-69.test.js`; `node --test "tools/ai-brain/test/*.test.js"` |
| `AC-AI-69-02` | Given login-required and zero-quota pool accounts | They are excluded with `AUTH_FAILED` and `QUOTA_EXHAUSTED` | `tools/ai-brain/test/task-ai-69.test.js`; CLI stdout assertions |
| `AC-AI-69-03` | Given a quota-bearing pool account and runtime-advertised model | The Controller emits a seven-part `agy-pool::...::account::quotaScope::modelId` candidate key | `tools/ai-brain/test/task-ai-69.test.js`; candidate key assertion |
| `AC-AI-69-04` | Given profile dispatch with `requiredHarness: "agy-pool"` and `proofFloor: "API_PASS"` before evidence | The candidate is refused with `PROOF_FLOOR_NOT_MET:NONE` | CLI-spawn test assertion |
| `AC-AI-69-05` | Given `dispatch --report-outcome` for a completed pool job | Evidence is recorded and the same profile dispatch selects the candidate | CLI-spawn test assertion and evidence store read through production code |

## Verification commands

- `node --test "tools/ai-brain/test/*.test.js"`
- `npx --package prettier@3.9.6 prettier --check docs/product-spec/work-items/TASK-AI-69.md tools/ai-brain/agy-pool-runtime.js tools/ai-brain/candidates.js tools/ai-brain/cli.js tools/ai-brain/harness.js tools/ai-brain/refresh-quota.js tools/ai-brain/routing.js tools/ai-brain/test/refresh-quota.test.js tools/ai-brain/test/task-ai-68.test.js tools/ai-brain/test/task-ai-69.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `TBD` | `TBD` | `TBD` |

## Residual limitations

None.
