# GOAL-AUTOCLAW-REPOS-9 — Nhóm 8 - Có điều kiện (DECLARED, không cài)

## Control

| Field | Value |
|---|---|
| Work Item ID | `GOAL-AUTOCLAW-REPOS-9` |
| Feature ID | `GOAL-AUTOCLAW-REPOS` |
| Status | `BACKLOG` |
| Delivery order | `261` |
| Dependencies | `GOAL-AUTOCLAW-REPOS-1` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-8-CONDITIONAL.md`, `tools/ai-brain/test/repo-integration-group-8.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/goal-autoclaw-repos-9-impl` |
| Pull Request | `Pending` |

## Business outcome

> Ghi DECLARED cho nhóm 8 (có điều kiện) và KHÔNG cài khi chưa có requirement.

## Source references

- `docs/product-spec/docs/10-ai-collaboration/REPO-INTEGRATION-APPENDIX-20261013.md`
- `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-8-CONDITIONAL.md`

## Preconditions and dependencies

- Preconditions: GOAL-AUTOCLAW-REPOS-1.

## Author boundary

- Author: GEMINI. Follow AGENTS.md operating contract.
- Allowed paths: `docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-8-CONDITIONAL.md`, `tools/ai-brain/test/repo-integration-group-8.test.js`.
- Prohibited: no push, no merge, no deleting uncommitted work, no model selection.

## In scope

- Nhóm 8 - Có điều kiện (DECLARED, không cài).
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
| AC-1 | Repo/package + version/ref (DECLARED): storybookjs/storybook, pact-foundation/pact-js, Shopify/toxiproxy, SpectoLabs/hoverfly, stoplightio/prism (@stoplight/prism-cli@5.12.0), promptfoo/promptfoo, renovatebot/renovate@39.191.0, thanglequoc/vietnamese-provinces-database. | Passes automated verification | Automated check passes |
| AC-2 | Năng lực: catalog vượt Playwright gallery; consumer/provider contracts; network fault tests; capture/replay/simulation; OpenAPI mock/validation server; prompt/model regression dataset; dependency updates; address-data consumer. | Passes automated verification | Automated check passes |
| AC-3 | Trigger: chỉ khi có requirement cụ thể được ghi trong Work Item. | Passes automated verification | Automated check passes |
| AC-4 | Adapter/caller: chưa wire; ghi rõ requirement cần có trước khi INSTALLED. | Passes automated verification | Automated check passes |
| AC-5 | Hợp đồng vào/ra: requirement -> quyết định cài; không cài khi chưa có requirement. | Passes automated verification | Automated check passes |
| AC-6 | Task chạy thực + artifact: chỉ tài liệu DECLARED và lý do; không cài đặt. | Passes automated verification | Automated check passes |
| AC-7 | Trạng thái: DECLARED (không lên INSTALLED trong gói này); limitation: chờ requirement. | Passes automated verification | Automated check passes |
| AC-8 | Test passes: tools/ai-brain/test/repo-integration-group-8.test.js | Passes automated verification | Automated check passes |

## Verification commands

- `node --test tools/ai-brain/test/repo-integration-group-8.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `Pending` | `Pending` |

## Residual limitations

None.

### Integration evidence 2026-10-20 — promptfoo adopted, docker-compose rejected

- `promptfoo/promptfoo` is now executed, not only declared: `tools/controller-eval/eval.yaml` renders the real Controller prompts (`compilePrompt`, `compileReviewPrompt` from `tools/ai-brain/prompt-compiler.js`) through the offline `echo` provider and asserts the contract: publisher boundary and skill-pack lock in author prompts, UI authority for `author.ui`, the PASS-without-findings rule and the diff in review prompts, no `undefined`/`[object Object]` in ShipDe-generated text, and no token-shaped secrets. No model or network call is made by the eval.
- Command `pnpm test:prompts` (CI step in `current-application.yml`, telemetry and update checks disabled). Local result: `CONTROLLER_PROMPT_EVAL: 4 passed, 0 failed, 0 errors`, exit 0. Negative check with `SHIPDE_SKILL_PACK=off`: 3 failed, exit 1, so a dropped lock fails the gate.
- `tools/controller-eval/run.sh` installs the pinned promptfoo in an isolated npm prefix (no workspace lockfile change) and `run.js` calls the library `evaluate()` without result writing: the 0.120.0 CLI always runs its SQLite migrations, which fail on Linux (`Can't find meta/_journal.json`, CI run on dabecaf7).
- Pinned to 0.120.0: 0.122.2 through 0.124.1 fail to install (`ETARGET No matching version found for @ai-sdk/provider@3.0.19`).
- Manifest lifecycle: promptfoo PENDING to ADOPTED; `docker/compose` PENDING to REJECTED by operator decision: it only starts local backing services and is not a Controller or CI gate.
