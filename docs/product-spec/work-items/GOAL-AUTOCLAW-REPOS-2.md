# GOAL-AUTOCLAW-REPOS-2 — Nhóm 1 - Brain và điều phối

## Control

| Field | Value |
|---|---|
| Work Item ID | `GOAL-AUTOCLAW-REPOS-2` |
| Feature ID | `GOAL-AUTOCLAW-REPOS` |
| Status | `BACKLOG` |
| Delivery order | `254` |
| Dependencies | `GOAL-AUTOCLAW-REPOS-1` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md`, `tools/ai-brain/test/repo-integration-group-1.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/goal-autoclaw-repos-2-impl` |
| Pull Request | `Pending` |

## Business outcome

> Ghi và kiểm bằng chứng gắn nhóm 1 (brain và điều phối) theo hợp đồng 5 trạng thái, tái dùng contract Controller hiện có.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-1-BRAIN.md`, `tools/ai-brain/test/repo-integration-group-1.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 1 - Brain và điều phối.
- Unit and integration verification commands matching acceptance criteria.

## Out of scope

- Modifying unallowed paths or inventing business rules.

## Business rules and edge cases

- Strict adherence to repository baseline and source specifications.

## UI states

- Full state coverage where UI is affected; N/A for pure backend.

## API, event and data impact

- Safe contract and schema handling within allowed paths.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-1 | Repo/package + version/ref: vinh05092001/shipde-platform@origin/main 68e8b862, hermes-agent@0.21.4, vinh05092001/shipde-brain, 9router@0.5.99, opencode-ai@1.18.31, @openai/codex@0.162.0, @google/gemini-cli@0.58.0, @getpaseo/cli@0.8.0, @anthropic-ai/claude-code@2.1.296. | Passes automated verification | Automated check passes |
| AC-2 | Năng lực: Controller chọn source/model/account/harness, dispatch, quota/fallback/checkpoint/watchdog/evidence; Hermes chat/reasoning/skill/recall; shipde-brain facts/lessons/prompts; 9router model gateway; harness worker/reviewer; paseo session; claude-code giám sát bằng chứng. | Passes automated verification | Automated check passes |
| AC-3 | Trigger: goal run dispatch; chat; context theo task; gateway lỗi hoặc quota. | Passes automated verification | Automated check passes |
| AC-4 | Adapter/caller tái dùng (không tạo trùng): tools/ai-brain/orchestrate.js, tools/ai-brain/executor.js, tools/ai-brain/sources.js, tools/ai-brain/hermes-session.js, tools/ai-brain/route-probe.js, tools/ai-brain/route-health.js. | Passes automated verification | Automated check passes |
| AC-5 | Hợp đồng vào/ra: Work Item + candidate + worktree + permissions + timeout -> logs/artifacts/exit status; Hermes không tự chọn nguồn hay chạy dispatcher cạnh Controller. | Passes automated verification | Automated check passes |
| AC-6 | Task chạy thực + artifact: một task đi hết chat -> execution -> review -> response; artifact là decision log và launch result. | Passes automated verification | Automated check passes |
| AC-7 | Trạng thái: DECLARED; chỉ lên WIRED/EXECUTION_VERIFIED/ACCEPTED khi có test và SHA; limitation: gateway 9router thiếu credential cho nhiều provider. | Passes automated verification | Automated check passes |
| AC-8 | Test passes: tools/ai-brain/test/repo-integration-group-1.test.js | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-1.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `Pending` | `Pending` |

## Residual limitations

None.

### 2026-10-20 — installed CLIs and router: measured state

Each tool was run on the operator host on 2026-10-20. Manifest states follow what ran, not what was declared.

- **9router** `0.5.104` → ADOPTED. Caller: `tools/ai-brain/hermes-session.js:162-174` (base `http://127.0.0.1:20128/v1`). Real run: `GET /v1/models` returns HTTP 200. Independent reviews of #422, #423, #424 and #417 ran through `ag/gemini-3.8-flash-high` on this router; the records are under `.worktrees/logs/reviews/<sha>.md`.
- **codex-cli** `0.162.1` → ADOPTED. Caller: `tools/ai-brain/harness.js:212` (`command: 'codex'`) and `candidates.js:213`. Real run: `codex login status` reports "Logged in using ChatGPT". It was the TASK-142 reviewer until its quota ran out.
- **antigravity-cli** `1.4.3` → ADOPTED. Caller: `tools/ai-brain/agy-pool-runtime.js:463` and `agy-quota.js:240`. Real run: `agy -p "Reply with exactly: OK"` returns `OK`.
- **claude-code** `2.1.296` → ADOPTED. Caller: `harness.js` paseo adapter (`run --provider claude`). Real run: `claude -p` returns `OK`.
- **gh** `2.98.0` → ADOPTED. Caller: `tools/ai-brain/governed-merge.js:303` and `publisher.js:775`. Real run: `gh api rate_limit` returns an authenticated core limit of 5000.
- **deepseek-harness** `0.1.1-rc.2` stays INSTALLED. `dsh --help` runs, but no Controller caller launches it and no work run was observed.
- **gemini-cli** `0.58.0` → REJECTED. A real run fails with `IneligibleTierError: UNSUPPORTED_CLIENT`: Google no longer serves this client for individual Code Assist and directs users to Antigravity, which is adopted above.
- **docker-compose** → PENDING. `docker` is not on PATH and WSL has no distribution, so the earlier INSTALLED claim was an overstatement found by the manifest audit.
- **promptfoo** → PENDING. It was ADOPTED, but the `pf` binary is absent and no caller runs it; `fitness.js:154` only mentions it in a comment.
- **shipde-brain** → REJECTED by operator decision on 2026-10-20. Its role (task facts, lessons and prompts with provenance) is already covered by `docs/product-spec`, the skill pack and Hermes memory, and its provenance is the reviewed commits and PRs of this repository. A separate repository would add a second source that can drift.

Verification: `node tools/ai-brain/acceptance/ac-17-01-manifest-audit-clean.js` now reports `error 0`. Before this change, main reported 1 error, from the docker-compose and promptfoo overstatements. Related tests (manifest-audit, review-lane, repo-integration group 1, group 8 and evidence): 45 pass, 0 fail.

### 2026-10-20 — appendix tools already in use, now registered

These five appendix repositories were running but had no manifest entry. Each is registered as ADOPTED with the observed version, its caller and a live run on the operator host:

- **anomalyco/opencode** `1.18.31`. Caller: `tools/ai-brain/harness.js:187` (`opencode-direct`) and the paseo `--provider opencode/...` sessions. Live: `opencode models` lists 1,533 models.
- **getpaseo/paseo** `0.8.0`. Caller: `harness.js:43` paseo adapter (`run --provider --background --json`). Live: the daemon was not running, so `paseo daemon start` started it, and `paseo ls` then listed past worker sessions with agent ID, provider, status and cwd.
- **rtk-ai/rtk** `0.50.0`. Caller: `tools/ai-brain/intake.js:44` and `:1264`. RTK is enabled only when no `RTK_RISK_DOMAINS` domain is present, so risk-domain items get raw output. Live: `rtk git status` returns compacted status.
- **obra/superpowers** `8ca22dba`. Vendored under `skills/superpowers/` and consumed by `skill-pack.js` (TASK-AI-109). The byte pins are tested by `task-ai-109.test.js`.
- **pbakaus/impeccable** `4e8504f1`. Vendored under `skills/impeccable/` and consumed by `skill-pack.js` for UI roles. The byte pins are tested by `task-ai-109-ui.test.js`.
- **microsoft/playwright** moves from DEFERRED to ADOPTED at `1.64.1`. It has run the blocking axe-core gate in CI (`current-application.yml`) since #422.

Verification: manifest audit error 0. manifest-audit and all repo-integration tests: 54 pass, 0 fail.
Validator: `scripts/ai/ecosystem.ps1 validate` passes. It now checks the adopted count against the approved list instead of a hardcoded 37, and the approved list includes the five registered repositories.
