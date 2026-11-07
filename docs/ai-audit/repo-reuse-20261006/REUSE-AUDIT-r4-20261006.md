# Reuse audit r4 — final candidates and proposed combination (read-only, 2026-10-06)

No architecture is accepted yet; this is a proposal. Nothing was installed, coded or run. ShipDe code reference: origin/main eaa569f. The requirement map is r3 (accepted as a map).

## 1. Code read this round

| repo | pinned | license | read | key symbols |
|---|---|---|---|---|
| OrchestratorInc/agent-orchestrator (ComposioHQ/agent-orchestrator redirects here; Untrivial-ai/agent-orchestrator 9a1cb73 is a separate Go repo with the same product text) | d86288526dd9 | Apache-2.0 | tree (4,242 files), ports | `backend/internal/ports/agent.go: Agent{GetConfigSpec, GetLaunchCommand, GetPromptDeliveryStrategy, GetAgentHooks, GetRestoreCommand, SessionInfo}`, `LaunchConfig{Config AgentConfig, Permissions, Prompt, SessionID, AllowedTools, DisallowedTools, SystemPrompt}` (agent.go:526); `ports/reviewer.go: Reviewer{ReviewCommand, ReviewMessage}` + Restorer/Canceller; `ports/tracker.go: Tracker{Get, List, Preflight}`; `ports/native_checkpoint.go`; adapters for opencode, opencodev2, cline, agy, deepseekharness, codex, gemini, kimi, kiro, mimocode, muse…; `backend/internal/review/planner.go`; `pricing/catalog/v1`; `agent/modelcatalog` |
| gastownhall/beads | e72cd8b3153c | MIT | tree, README | `cmd/bd` (create, ready, update --claim, dep, remember, compact, compact_plan), `internal/storage` (Dolt), `integrations/beads-mcp`, `internal/tracker`, `internal/linear`; hash IDs; Windows listed |
| Fission-AI/OpenSpec | 9111a7654d78 | MIT | tree, README | `src/core/{artifact-graph, change-metadata, change-status-policy, specs-apply, validation, profiles, worksets, templates, command-generation, shared-skill-target}`; `openspec/changes/<id>/{specs,tasks.md}` |
| github/spec-kit | 2dda047809dd | MIT | tree | `templates/commands/{constitution, specify, clarify, plan, tasks, analyze, checklist, implement, taskstoissues, converge}.md`; `scripts/powershell` (Windows); `workflows/` step catalog; `extensions/{git, github, agent-context}` |
| NousResearch/hermes-agent (from r2) | 4787e4d56fc8 | MIT (+ per-skill LICENSE) | code | `hermes_cli/kanban_decompose.py`, `kanban_db_dispatch.py:2831 _default_spawn`, `tools/delegate_tool*.py`, `agent/memory_provider.py`, `agent/context_engine.py`, `agent/session_persistence.py` |

## 2. REJECT re-check (against need, not old audit or language)

| repo | old | re-check | new status |
|---|---|---|---|
| automazeio/ccpm | REJECT | Planner/PM workflow via GitHub issues as Claude command packs (MIT). It meets the planning need but overlaps spec-kit/OpenSpec, which are more general | AUDIT_ONLY (pattern) |
| langchain-ai/deepagents | REJECT | Planner + subagent + filesystem memory pattern (MIT). Python alone is not a reason. It drives LLM calls, not CLI coding agents in worktrees | AUDIT_ONLY (pattern) |
| langchain-ai/langgraph-supervisor-py | REJECT | Supervisor/handoff graph pattern (MIT); same limit as deepagents | AUDIT_ONLY (pattern) |
| swe-agent/swe-agent | REJECT | A single-agent harness for issue fixing; no planner or multi-worker | REJECTED (no unmet need it fills beyond opencode/hermes) |
| dicklesworthstone/ntm, manaflow-ai/cmux | REJECT | tmux session managers; tmux is not native on this Windows host | REJECTED (platform), revisit only under WSL |
| smtg-ai/claude-squad | REJECT | tmux based and AGPL-3.0 | REJECTED (platform + license) |
| daytonaio/daytona, nvidia/openshell | REJECT | Container/VM sandboxes needing Docker/WSL/k8s; the need is Windows WorkerUser isolation | REJECTED for the host isolation need; UNVERIFIED as an optional WSL sandbox |

## 3. Status corrections (installed vs integrated)

- RUNTIME_INTEGRATED (call site + config + execution evidence): 9router, opencode, paseo, Hermes one-shot harness, gh.
- INSTALLED but not runtime-integrated: repomix 0.3.3, deepseek-harness (dsh 0.1.1-rc.2), gitleaks (CI), playwright tooling.
- Not installed although the inventory says ADOPTED or INSTALLED: promptfoo, agent-orchestrator (`ao`), serena (pilot via serena.js only).
- MANUALLY_USED: the agent-orchestrator line (ComposioHQ, now OrchestratorInc) until 2026-09-17, per memory.

## 4. The three gaps, restated as UNVERIFIED

These were not shown to exist, nor shown to be absent:
1. External orchestrator carrying a full candidate identity (account/quotaScope).
2. Approval-bound exact-SHA review manifest for publish.
3. Windows WorkerUser isolation for non-opencode harnesses.

## 5. ShipDe policy vs external workflow: extension points

ShipDe keeps the policy: Controller selection, evidence, failure-domain, quota, isolation, the review manifest, publisher approval and the register gate. A framework qualifies if it has a seam for each.

| ShipDe policy | AO (OrchestratorInc) | Hermes | beads | OpenSpec / spec-kit |
|---|---|---|---|---|
| Controller picks the candidate | `LaunchConfig.Config AgentConfig` per session + agent adapters (opencode, cline, agy…). Model field in AgentConfig: UNVERIFIED | profile per candidate (`hermes -p <profile>`); delegate per-child provider/base_url override | n/a (tracker) | n/a (spec/plan) |
| Isolation (WorkerUser) | `GetLaunchCommand` returns the argv. A ShipDe wrapper argv (isolation launcher) could be returned: UNVERIFIED | spawn is a subprocess; wrapping is UNVERIFIED | n/a | n/a |
| Exact-SHA review + manifest | `Reviewer` port. A ShipDe reviewer adapter could emit the manifest | `request_review` state; review adapter UNVERIFIED | n/a | `analyze`/`checklist` commands (static) |
| Register / Work Item source | `Tracker` port (Get/List/Preflight). A ShipDe-register tracker adapter is possible | kanban DB | `bd` issues with dependencies and claim (could mirror the register) | `openspec/changes` and `tasks.md`; spec-kit `tasks`/`taskstoissues` |
| Checkpoint/resume | `native_checkpoint.go`, session restore | `session_persistence.py` | Dolt history | – |
| Publisher approval | SCM ports; ShipDe publisher stays outside | – | – | – |
| Extension mechanism | Go interfaces compiled in (fork or upstream PR) | config/profile/plugins (no fork for profiles; Python for plugins) | CLI + MCP + HTTP API | markdown templates + CLI |

## 6. Final candidates per need

| need | candidate | pinned | file:symbol | what it can do | adapter needed | ShipDe code it could replace |
|---|---|---|---|---|---|---|
| orchestration | OrchestratorInc/agent-orchestrator | d86288526dd9 | ports/agent.go Agent, LaunchConfig; ports/reviewer.go; ports/tracker.go | multi-worker sessions, worktrees, CI/review reactions, Kanban, restore | Go: a ShipDe Tracker (register), a ShipDe Reviewer (manifest), a launch wrapper for isolation, model from the Controller | executor.js/scheduler.js dispatch path; supervisor.js lifecycle |
| orchestration | Hermes kanban/delegate | 4787e4d56fc8 | kanban_db_dispatch.py:2831; delegate_tool_config.py:182-237 | decompose, dispatch with failure limit/quota block, delegation | profile writer per candidate; isolation wrapper; review hook | same as above + planner.js |
| planner (spec → plan → tasks) | Fission-AI/OpenSpec | 9111a7654d78 | src/core/artifact-graph, specs-apply, validation | change folders with specs + tasks, validation | map a change to a Work Item + register row | parts of Work Item drafting; planner.js |
| planner | github/spec-kit | 2dda047809dd | templates/commands/{specify, plan, tasks, analyze, checklist} | command templates, PowerShell scripts | map tasks to Work Items | same |
| memory/handoff | gastownhall/beads | e72cd8b3153c | cmd/bd ready, update --claim, dep, remember, compact; beads-mcp | dependency-aware task memory, claims, durable facts, compaction | sync bd issues ⇄ register; keep run checkpoint and model evidence out of bd | lessons/ reader; handoff notes |
| memory/handoff | Hermes memory_provider | 4787e4d56fc8 | agent/memory_provider.py | per-agent recall plugins | a ShipDe provider plugin | lessons/ reader |
| role/prompt/skills | anthropics/skills (Apache skills only) + Agent-Skills-for-Context-Engineering (MIT) | 683bc88e56f3 / 58b55a892175 | skills/skill-creator, skills/frontend-design; skills/* | SKILL.md role/procedure skills | role → skill-set map in prompt-compiler or harness loader | role text in prompt-compiler; the duplicate role table |
| context/token | serena (SolidLSP MIT part / external process) + repomix + rtk | 3155fd67e9b7 / installed 0.3.3 / df39e33d7e59 | src/solidlsp; repomix CLI; rtk proxy | symbol retrieval, repo packing, shell-output compaction | worker-side config only | repo-map.js/output-store.js only if the TASK-AI-78 benchmark says so |
| UI/component | anthropics frontend-design (Apache) + axe-core (MPL-2.0) + playwright | 683bc88e56f3 / inventory | skills/frontend-design | implementation help under the screen spec + a11y checks | UI-role skill set | none |
| discovery/benchmark | ShipDe sources.json + 9router + external-model-priors.json | eaa569f | sources.js, priors.js | data-driven sources, benchmark tie-break | – | – |
| discovery/benchmark | AO modelcatalog/pricing; Hermes model-providers | d86288526dd9 / 4787e4d56fc8 | agent/modelcatalog, pricing/catalog/v1; plugins/model-providers | model lists and pricing per agent/provider | import as data | hand-edited opencode.json |

## 7. Proposed combination (proposal; operator decides)

| group | preferred | fallback | reason |
|---|---|---|---|
| orchestration/planner | OpenSpec for spec → change → tasks, with ShipDe's orchestrate loop executing | Hermes kanban (decompose + dispatcher) behind a profile-per-candidate seam; AO ports as a second fallback | OpenSpec adds the missing planner without moving execution or policy, and is TypeScript with a CLI. Hermes and AO both replace execution and need isolation/review seams that are UNVERIFIED. Hermes needs no fork (profiles); AO needs Go adapters (fork or upstream PR) |
| shared memory/handoff | beads (bd) as the task/handoff memory, synced with the register; checkpoint and evidence stay in ShipDe | Hermes memory_provider with a ShipDe plugin | beads gives dependency graph, claims, remember and compaction across agents and machines, with an MCP server and Windows support. Hermes memory is per-agent recall rather than a shared task graph |
| role/prompt/skills | SKILL.md skills (Anthropic Apache skills + Agent-Skills MIT) mapped per ShipDe role | spec-kit command templates as role procedures | one open format usable by several harnesses (Hermes, OpenHands, Claude); licenses checked per skill |
| context/token | serena (external) + repomix + rtk for low-risk items, gated by a benchmark | ShipDe TASK-AI-78 modules (already contract-tested) | external tools are maintained upstream; the TASK-AI-78 contract keeps ShipDe's modules until measured |
| UI/component | frontend-design skill + axe-core + playwright under the screen spec | ui-ux-pro-max as a checklist aid | implementation help without overriding the spec (AGENTS.md UI rule) |
| discovery/benchmark | keep ShipDe sources.json + 9router + priors | import AO modelcatalog/pricing or Hermes provider lists as data | the Controller must stay the single selector; external catalogues only feed data |
| ShipDe gates kept | Controller selection (7-part key, evidence, failure-domain, quota/cooldown), isolation launcher, exact-SHA review manifest, publisher approval, register gate, checkpoint | – | no audited framework supplies these; each candidate needs a seam to call them |

## 8. Still unknown (would need a POC, not done)
- AgentConfig model/env fields in AO; whether AO restore matches ShipDe checkpoint/resume.
- Hermes profile carrying account/quotaScope; the aux LLM pinning in decompose.
- beads Dolt footprint and RAM on Windows; sync semantics with the CSV register.
- OpenSpec change ⇄ Work Item mapping, including the contract CI expectations.
