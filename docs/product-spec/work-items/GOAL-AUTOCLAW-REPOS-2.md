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
