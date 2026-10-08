# [TASK-AI-68] The Controller can route to the agy pool

## Business outcome

The Controller can rank, score, and dispatch work to the 10 isolated Windows users `agy01..agy10` running Antigravity via Scheduled Tasks, expanding the available quota without copying a token between users. Exhausted and unauthenticated accounts are safely excluded based on their own reported quota, and jobs run autonomously using the existing adapter system.

## Specifications

Ten isolated Windows users `agy01..agy10` each hold their own agy Google login in their own Credential Manager. Each has a Scheduled Task `ShipDe\ShipDe-agyNN` that runs `C:\Tools\agy-pool\worker.ps1` as that user; the job is `C:\Tools\agy-runs\agyNN\job.json` (`{cwd,prompt,model}` or `{command:"quota"|"models"}`) and the result is `result.json` (`state ok|quota|error|login-required, exitCode`) plus `out.txt` (agy JSON).

The Controller registry only knows `agy-native-a`, so these pool accounts must be registered dynamically to reuse the existing `candidates.js` / `sources` / `quota-store` / `evidence` infrastructure with no new registry, ranking, or store logic.

Changes required:
1. Register the 10 pool accounts as concrete-account candidates with harness `agy-pool`, accessPath `ShipDe\ShipDe-agyNN`, account `agyNN`, quotaScope per account and model family, using the same 7-part key shape as evidence.
2. A read-only quota refresh that parses `result.json` and `out.txt` of a "quota" job into `quota-store` headroom (percent remaining and reset time) so exhausted accounts are excluded and fresher/larger headroom wins; `login-required` accounts are excluded with `AUTH_FAILED`.
3. A dispatch adapter that, for a pinned `agy-pool` candidate, writes `job.json` and starts the scheduled task (`schtasks /run /tn ShipDe\ShipDe-agyNN`), and maps `result.json` state to a structured outcome for `--report-outcome` (`ok` -> `completed`, `quota` -> `QUOTA_EXHAUSTED` with `resetsAt` as `cooldownUntil`, `login-required` -> `AUTH_FAILED`, `error` -> `failed`). Never read or print credentials.

## Preconditions and dependencies

- None. Works with existing Controller stores.

## Out of scope

- Creating a second registry or ranking logic.
- Setting up the Windows Scheduled Tasks or users.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result |
| --- | --- | --- |
| `AC-AI-68-01` | Candidate generation for pool | Candidates for agy01..agy10 appear with the right 7-part key shape (harness: agy-pool, upstream: antigravity, quotaScope: accountId:family) |
| `AC-AI-68-02` | Quota result 0% | Refresh excludes the account until reset |
| `AC-AI-68-03` | Quota result login-required | Refresh excludes the account with AUTH_FAILED reason |
| `AC-AI-68-04` | Dispatch adapter launch | Adapter writes the expected job.json and starts schtasks without exposing credentials |
| `AC-AI-68-05` | Dispatch adapter outcome | Maps result.json states to exact structured outcomes |

## Verification evidence

- The test results and dry run log will be written to `ai68-result.txt` in the root of the worktree and committed.

## Known limitations

- The account discovery regex `/^agy\d+$/` in `refresh-quota.js` accepts any number (e.g. `agy99`), but candidate generation emits only `agy01` to `agy10`. Quota may be read for accounts that the Controller can never dispatch.
- A quota rejection is reported as retryable because `structuredOutcome` derives `retryable` from `cooldownMs`, and `mapOutcome` only supplies `cooldownUntil`.
