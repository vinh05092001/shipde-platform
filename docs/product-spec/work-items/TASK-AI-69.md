# TASK-AI-69 — Pool quota discovery and first evidence through the CLI

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-69` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
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
| 1 | `6dd2ebcadf7387c4e728c3ecd3af62ce0d9d6dc5` | `CHANGES_REQUIRED` | `F1`, `F2`, `F3`, `F4`, `F5`, `F6`, `F7`, `F8` |
| 2 | `5169178acddd433a06df1c8033b9ff1205342cfe` | `CHANGES_REQUIRED` | `F6`, `F7`, `R1`, `R2`, `R3`, `R4`, `R5`, `R6` |

### Review repair round 1 evidence

- `F1`: `runsDir` on non-Windows previously defaulted to relative Windows literal `C:\Tools\agy-runs`, creating a directory in cwd. `runsDir` now resolves non-Windows base via `XDG_DATA_HOME` or `~/.local/share/agy-runs` using POSIX path separators, and `runAdapter` immediately returns `exitCode: 1` with `UNSUPPORTED_PLATFORM: agy-pool requires Windows schtasks` when executed outside Windows without an adapter script.
  - Fail before: `runsDir({ platform: 'linux' })` returned `'C:\\Tools\\agy-runs'`; `runAdapter` failed on missing binary without explicit platform reason.
  - Pass after: `tools/ai-brain/test/task-ai-69.test.js` asserts `runsDir({ platform: 'linux' })` is absolute POSIX and `runAdapter` returns `UNSUPPORTED_PLATFORM`.
- `F2`: `submitJob` previously waited up to 120s even if the adapter launch failed immediately. It now checks launch failure before waiting, immediately writing error result and returning the adapter error. Added `--pool-timeout` / `--timeout-ms` flags to `cli.js quota` and streaming per-account progress output via `opts.onProgress`.
  - Fail before: `submitJob` blocked for full `timeoutMs` on launch exit != 0, returning `POOL_TIMEOUT`.
  - Pass after: `submitJob` returns in <100ms with exit code and reason; verified in `task-ai-69.test.js`.
- `F3`: `parseQuotaJson` converted windows without remaining quota into `remainingPercent: 0`, and `refreshAccount` mapped that to `QUOTA_EXHAUSTED`. `parseQuotaJson` now ignores unpopulated windows and marks unparseable JSON output as unavailable (`không có số liệu quota hợp lệ trong out.txt`), and `refreshAccount` only concludes `QUOTA_EXHAUSTED` when every reported window has non-positive remaining quota.
  - Fail before: `parseQuotaOutput('{"groups":[{"id":"gemini","weekly":{"resetAt":"..."}}]}')` emitted `remainingPercent: 0` and `refreshAccount` returned `QUOTA_EXHAUSTED`.
  - Pass after: `parseQuotaOutput` returns `available: false`, and `refreshAccount` preserves reason without mapping to `QUOTA_EXHAUSTED`.
- `F4`: Unvalidated `candidateKey` allowed path traversal in `accountDir`. Added strict `isValidAccountId` check (`/^agy\d{2}$/`) in `accountDir`, `readResult`, `runAdapter`, `submitJob`, `harness.mapOutcome`, and `routing.reportDispatchOutcome`.
  - Fail before: `accountDir('../../..')` returned traversed directory; `mapOutcome` read arbitrary filesystem paths.
  - Pass after: `accountDir('../../..')` throws `INVALID_ACCOUNT_ID`, `mapOutcome` returns `INVALID_ACCOUNT_ID`, and CLI `dispatch --report-outcome` exits code 2 with `OUTCOME_INVALID`.
- `F5`: `agyPool.quota(accountId, opts)` in `harness.js` was uncalled dead surface. Added caller in `refresh-quota.js` and dedicated unit test in `task-ai-68.test.js`.
  - Fail before: Zero callers or tests in repo.
  - Pass after: `refresh-quota.js` calls `agyPool.quota`; unit test in `tools/ai-brain/test/task-ai-68.test.js` passes.
- `F6`: Runtime candidate models relied on unrefreshed `out.txt`. Added `refreshModels` in `agy-pool-runtime.js` submitting `{ command: 'models' }`, and `modelIdsFromRuntime({ refreshModels: true })` triggers refresh.
  - Fail before: No `refreshModels` function; no mechanism to submit `{ command: 'models' }`.
  - Pass after: `refreshModels` submits `{ command: 'models' }` and parses advertised models; verified in `task-ai-69.test.js`.
- `F7`: Untracked scratch directories `.tmp-ai69-home/` and `.tmp-ai69-temp/` excluded via `.git/info/exclude` without deleting them.
- `F8`: Recorded residual limitations and review repair evidence in `TASK-AI-69.md`.

### Review repair round 2 evidence

- `F6 & R2`: Candidate model discovery was previously risking live scheduled task execution when `refreshModels` or `refresh` was set. Removed `refreshModels` dead surface and `opts.refresh` alias from `agy-pool-runtime.js`; candidate discovery purely inspects advertised models from `out.txt` and never executes jobs implicitly. Tested in `tools/ai-brain/test/task-ai-69.test.js`.
  - Fail before: `modelIdsFromRuntime({ refresh: true })` executed `submitJob` and invoked the adapter.
  - Pass after: `modelIdsFromRuntime({ refresh: true })` and `poolAccountCandidates` purely read `out.txt` without executing adapter.
- `F7`: Untracked scratch directories `.tmp-ai69-home/` and `.tmp-ai69-temp/` remain untracked and excluded locally via `.git/info/exclude`. Per operational policy ("never delete files"), files are preserved. Durable ignore rule addition to `.gitignore` is documented as deferred to a foundation task since `.gitignore` is outside the allowed paths for this Work Item.
- `R1`: Unparseable reported quota values (e.g. `"N/A"`) previously fell back to `0%` due to `Number.isFinite(remaining) ? remaining : 0`, causing `refreshAccount` to report `QUOTA_EXHAUSTED`. `parseQuotaJson` now maps unparseable values to `remainingPercent: 'UNKNOWN'`. `refreshAccount` strictly evaluates `QUOTA_EXHAUSTED` only when every reported window has a parsed finite value `<= 0` (or `disabled === true`). In CLI `--show`, `UNKNOWN` is rendered cleanly.
  - Fail before: `parseQuotaOutput` on `"N/A"` emitted `remainingPercent: 0` and CLI `quota` reported `HỎNG agy01 — QUOTA_EXHAUSTED`.
  - Pass after: `parseQuotaOutput` produces `remainingPercent: 'UNKNOWN'`; CLI `quota` reports `ĐỌC ĐƯỢC agy01 — 1 dòng` and `quota --show` displays `UNKNOWN`.
- `R3`: `agyPool.launch` in `harness.js` now validates `accountId` with `isValidAccountId` before accessing runtime directories, and `cli.js` guards `adapter.launch` in a structured try-catch to record launch preparation failure into the decision log rather than throwing an unhandled stack trace.
  - Fail before: `launch({ accountId: '../../..' })` threw unhandled into caller without account check.
  - Pass after: Throws named `INVALID_ACCOUNT_ID` and CLI catches failure safely.
- `R4`: `cli.js quota` previously resolved `args.home || process.env.HOME || process.env.USERPROFILE`, which preferred MSYS POSIX `HOME` over Windows platform paths. `cli.js` now mirrors `agy-pool-runtime.js` by preferring `USERPROFILE` when `process.platform === 'win32'`.
- `R5`: `runAdapter` and `submitJob` in `agy-pool-runtime.js` previously reported processes killed by timeout as `ADAPTER_EXIT_-1`. It now detects `ETIMEDOUT` / `SIGTERM` and reports structured `ADAPTER_TIMEOUT`.
  - Fail before: Timed out adapter printed `HỎNG agy01 — ADAPTER_EXIT_-1`.
  - Pass after: Timed out adapter prints `HỎNG agy01 — ADAPTER_TIMEOUT`; verified via CLI spawn test in `task-ai-69.test.js`.
- `R6`: Delivery register row in `FEATURE-DELIVERY-REGISTER.csv` updated from `IN_PROGRESS` to `READY_FOR_CODEX` to match the required state machine transition.

## Residual limitations

- Native execution of `agy-pool` scheduled tasks requires a Windows host with `schtasks`; on non-Windows platforms `runAdapter` refuses execution with an explicit `UNSUPPORTED_PLATFORM` error unless overridden with `adapterScript` or `fakeRunsDir`.
- Candidate model discovery extracts advertised models from runtime output (`out.txt`) produced by prior jobs (e.g. quota checks or task runs). Scheduled task submission for `{ command: 'models' }` is omitted from candidate assembly to guarantee that candidate generation remains non-blocking and purely read-only; background dynamic polling of the model catalogue is not implemented in this Work Item.
- Profile dispatch timeout defaults to 120 seconds unless explicitly overridden by `--pool-timeout` or `--timeout-ms`.
- Local scratch directories `.tmp-ai69-*` are excluded locally in `.git/info/exclude` without deleting files; durable repository-level ignore entries are deferred to foundation tasks as `.gitignore` is outside the allowed paths of this Work Item.

