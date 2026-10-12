# TASK-AI-142 — Hermes chat brain wired to the Controller

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-142` |
| Feature ID | `N/A` |
| Status | `IN_PROGRESS` |
| Delivery order | `252` |
| Dependencies | `TASK-AI-141; TASK-AI-132; TASK-AI-50` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Complexity | `standard` |
| Allowed paths | `tools/ai-brain/hermes-session.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/skills/shipde-controller/SKILL.md`; `scripts/ai/hermes-chat.ps1`; `tools/ai-brain/test/task-ai-142-hermes-session.test.js`; `docs/product-spec/work-items/TASK-AI-142.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-142-hermes-session` |
| Pull Request | `Pending` |

## Business outcome

The operator chats directly with Hermes. Hermes understands goals, plans, and reports back. The Controller (`tools/ai-brain`) retains model/account/harness choice, quota, concurrency, fallback, checkpoint, and dispatch. Claude only supervises and is not in the direct message path.

## Source references

- `.upstream-tmp/TASK-AI-142-spec.md`
- `AGENTS.md`: Shared Agent Contract, role separation, security and secret rules
- `docs/product-spec/docs/07-ai-build/TECH-STACK-REPOSITORY.md`
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`
- `tools/ai-brain/harness.js`: Hermes adapter (v0.21.4 pinned contract)
- `tools/ai-brain/routing.js`, `tools/ai-brain/ranking.js`, `tools/ai-brain/candidates.js`, `tools/ai-brain/decisions.js`, `tools/ai-brain/failure-classifier.js`, `tools/ai-brain/sources.js`

## Preconditions and dependencies

- Monorepo baseline with Controller infrastructure in `tools/ai-brain`.
- Hermes v0.21.4 contract established in TASK-AI-50 and TASK-AI-63.
- Source registry, candidate identity, and decision logging are operational.

## Author boundary

- Part H1 (Writer A): owns `tools/ai-brain/goals.js`, CLI `goal` commands (`start`, `amend`, `plan`, `run`, `status`, `stop`, `resume`).
- Part H2 (Writer B - GEMINI): owns `tools/ai-brain/hermes-session.js`, CLI `chat` and `goal session` entries, skill `tools/ai-brain/skills/shipde-controller/SKILL.md`, operator script `scripts/ai/hermes-chat.ps1`, and unit tests in `tools/ai-brain/test/task-ai-142-hermes-session.test.js`.
- Part H3: live acceptance on the supervisor/operator machine after H1 and H2 merge.

## In scope

- Part H2 implementation:
  - Model selection using existing routing/ranking for reasoning/planner role with 7-part key (`harness=hermes`).
  - Decision logging via `decisions.recordDecision`.
  - Providers config file generated under `data/hermes/` containing only `base_url` and env var NAME (no secrets).
  - Session persistence in `data/hermes/session.json` (`sessionId`, `candidateKey`, `goalIds`).
  - Hermes argv construction: `-m <modelId> --provider <provider-name> --resume <sessionId>` plus skill `-s`.
  - Relaunch loop with same `--resume <sessionId>` on route/quota/model failure; local failure does not cool down model.
  - Skill file `tools/ai-brain/skills/shipde-controller/SKILL.md` forbidding self-model-picking, subagent spawning, and claiming completion without evidence.
  - CLI `chat` and `goal session` commands in `tools/ai-brain/cli.js`.
  - Operator script `scripts/ai/hermes-chat.ps1`.
  - Deterministic unit tests with injectable dependencies in `tools/ai-brain/test/task-ai-142-hermes-session.test.js`.

## Out of scope

- Part H1 `goals.js` implementation (owned by Part H1).
- Live execution against real Hermes binary in automated test environments lacking binary/keys.
- Subagent spawning by Hermes.

## H2 open questions

The following points must be verified against the real Hermes v0.21.4 binary during Part H3 live acceptance:

1. **Provider config format:**
   - How Hermes v0.21.4 loads custom OpenAI-compatible endpoints when `--ignore-user-config` is used.
   - Whether Hermes supports custom config file path via CLI flag (e.g. `--config`, `-c`, or `--profile`) or reads from a local directory or environment variable.
   - Exact structure of `providers:` in Hermes YAML (e.g., keys `base_url`, `api_key_env`, `model_list`, etc.).
2. **Environment variable for provider credentials:**
   - Exact environment variable Hermes v0.21.4 expects for custom provider API keys (e.g. `OPENAI_API_KEY`, `<PROVIDER>_API_KEY`, or custom variable defined in the provider record).
3. **Session resumption semantics:**
   - Whether `hermes chat --resume <sessionId>` requires an already-existing session on disk or whether passing a fresh session ID initializes that session directly.
   - Verification of `--in <cwd>` alongside `--resume`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-142-H2-01` | Candidate selection for reasoning | 7-part key with `harness=hermes`, ranked by quality/priors, decision recorded | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-02` | Provider config generation | Written under `data/hermes/`, contains base_url and key env var NAME, zero secrets | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-03` | Hermes argv construction | Emits `-m <modelId> --provider <provider-name> --resume <sessionId>` and `-s` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-04` | Session persistence | Stored in `data/hermes/session.json` with `{sessionId, candidateKey, goalIds}` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-05` | Route/model failure recovery | Reselects candidate and relaunches with same `--resume <sessionId>` | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-06` | Local failure handling | Local environment failure does not cool down or exclude the model | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-07` | CLI entries | `chat` and `goal session` commands work and output JSON | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |
| `AC-AI-142-H2-08` | Skill & script integration | Skill forbids unauthorized behaviors; powershell entry point forwards to CLI | `tools/ai-brain/test/task-ai-142-hermes-session.test.js` |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-142-hermes-session.test.js`
- `npx prettier --write tools/ai-brain/hermes-session.js tools/ai-brain/cli.js tools/ai-brain/skills/shipde-controller/SKILL.md scripts/ai/hermes-chat.ps1 tools/ai-brain/test/task-ai-142-hermes-session.test.js docs/product-spec/work-items/TASK-AI-142.md`
- `git diff --check`

## Residual limitations

- Real binary verification is deferred to Part H3 live acceptance per prompt requirements (no binary or provider keys in this account).
