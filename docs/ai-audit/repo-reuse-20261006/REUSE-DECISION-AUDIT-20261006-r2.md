# Reuse decision audit r2 — 2026-10-06 (read-only; ShipDe code origin/main eaa569f)

No architecture is chosen in this revision; the decision stays open. Option 3 from r1 is withdrawn as a decision.

## 1. Status vocabulary (applied to tools that touch the AI workflow)

RUNTIME_INTEGRATED requires all three: a call site in `tools/ai-brain`, configuration, and execution evidence.

| tool | status | call site | config | execution evidence |
|---|---|---|---|---|
| 9router | RUNTIME_INTEGRATED | sources.js, isolation-launcher.js (opencode.json generation) | sources.json, 9router :20128 | gateB3 decisions (paseo::http://127.0.0.1:20128/v1::9router::xmtp::…) |
| opencode | RUNTIME_INTEGRATED | harness.js (`opencode-direct`), isolation-launcher.js | worker opencode.json | gateB3 launch result, session ses_ef127f608ffeI6HcyPDwPxL5D4 |
| paseo | RUNTIME_INTEGRATED | harness.js (`paseo`), executor.js | sources.json | gate decision keys `paseo::…`; daemon pids 1128/3592/4720 |
| Hermes (one-shot harness only) | RUNTIME_INTEGRATED | harness.js:112-125 | sources.json:98-104 (`harness: hermes`, `hermes --version`) | logs/night/hermes-durable-evidence.txt (2026-09-29) |
| Hermes kanban / delegation / memory / context engine / skills | AUDIT_ONLY | none | none | none |
| gh CLI | RUNTIME_INTEGRATED | publisher.js `ghRun` | gh auth | draft PR #213 created by the publisher |
| serena | POC_ONLY | serena.js (cli.js `serena` only) | RESEARCH_ONLY profile (TASK-AI-32) | pilot logs only |
| repomix, promptfoo, context7, playwright-mcp, chrome-devtools-mcp | INSTALLED (no call site in tools/ai-brain; usage by people/agents not evidenced this session) | – | – | – |
| agent-orchestrator (AO) | MANUALLY_USED until 2026-09-17 (memory: 126 runs), unusable since about 18/9 | none in eaa569f | – | historical only |
| workmux git-env scrubbing | PATTERN_APPLIED | publisher.js withCleanGitEnv/safeGit | – | TASK-AI-104 tests |
| rtk, anthropics/skills, Agent-Skills-for-Context-Engineering, ui-ux-pro-max-skill | AUDIT_ONLY | – | – | – |
| cline atomic-file | REJECTED (measured: 5.3–15.8 ms per write, no gain over rename) | – | – | WS2 §3.4 |

## 2. Orchestration candidates (3, code and docs read)

| | Hermes (NousResearch/hermes-agent 4787e4d56fc8; local v0.21.4 2026-09-21) | agent-orchestrator (Untrivial-ai 9a1cb73134ac) | OpenHands software-agent-sdk (6f8c38d00e04) |
|---|---|---|---|
| License | MIT (repo); some skills carry their own LICENSE (for example skills/productivity/docx, pdf, powerpoint, xlsx, creative/humanizer); checked per skill before any use | Apache-2.0 (now Go; the inventory row said MIT/node, which is stale) | MIT |
| Planner | `agent/plan_prompt.py` (/plan writes a markdown plan, no execution); `hermes_cli/kanban_decompose.py` (LLM fans a triage task into a child-task graph with assignee = profile and parent links) | "plan and delegate larger outcomes" (README); a project-aware orchestrator | no planner module; subagent and critic packages |
| Delegation | `tools/delegate_tool*.py`: child agents with their own task_id and toolsets, depth 1 by default, batch/parallel, per-child provider/base_url override (`delegate_tool_config.py:182-237`), optional per-child git worktree (`delegation.worktree_isolation`) | worker sessions with their own workspace, agent, model and interface | `sdk/subagent` (6 files), example 25_agent_delegation |
| Memory provider | `agent/memory_provider.py` (pluggable, one external provider at a time); local plugins: byterover, hindsight, holographic, honcho, mem0, openviking, retaindb, supermemory | daemon state and a Kanban view | example 55_persistent_memory; `sdk/context` (33 files) |
| Context engine | `agent/context_engine.py` (pluggable compaction; ContextCompressor default) | – | condensers in `sdk/context` |
| Skills | about 400 skill files plus a skills hub and skill guards/linter (`tools/skills_*`) | – | AgentSkills SKILL.md loading (example 01_loading_agentskills) |
| Session persistence | `agent/session_persistence.py` (SQLite, dedup marker, resume) | daemon | `sdk/conversation`, example 10_persistence |
| Pinned execution | dispatcher spawns `hermes -p <profile> chat -q …` (`kanban_db_dispatch.py:2831`); a profile fixes provider/model; failure limit 2, quota/auth auto-block regex, memory-aware concurrency caps, request_review state | the worker is created with a chosen agent and model | `LLM(model=…)` per agent; REST Agent Server plus a TypeScript client |
| Windows | Windows install/venv e2e workflows; gateway_windows.py; installed and running here | Windows installer (desktop app plus daemon) | local workspace on Windows unverified; Docker workspaces need Docker/WSL |
| Adapter from the ShipDe Controller | Controller writes one Hermes profile per pinned 7-part candidate (provider/base_url/model, for example 9router) and assigns kanban tasks to that profile; or calls `delegate` with a per-child provider override. ShipDe keeps the evidence, failure-domain, review manifest and publisher | AO API/CLI for creating a worker with a given model is not documented in what was read | Node → REST Agent Server: create a conversation with `LLM(model, base_url)` per candidate; the Controller keeps selection |
| Unknown | whether a profile can carry the full candidate identity (account/quotaScope) beyond provider+model; whether kanban `request_review` can call a different-domain reviewer and attach ShipDe's manifest; kanban behaviour on Windows under WorkerUser isolation | daemon API; why it stopped working on 18/9 (memory only) | Windows local workspace; RAM; Node-side overhead |

## 3. Hermes component by component (not "already a harness, so enough")

| Hermes component | ShipDe today | could replace / add | adapter | risk / unknown |
|---|---|---|---|---|
| planner (`plan_prompt.py`, `kanban_decompose.py`) | planner.js (146 lines, "dry-run level") | goal → task graph with assignee | map kanban child tasks to Work Items, which must still be registered (PG-R03) | LLM-decomposed graph vs approved specs; the human gate must stay |
| delegation (`delegate_tool*`) | executor.js/scheduler.js dispatch path + orchestrate loop | parallel children, depth limit, per-child provider | per-child provider = Controller-chosen candidate | child approval callback defaults to deny (safe); isolation as WorkerUser not proven |
| memory provider | checkpoint + decision log + evidence.json; lessons/ (TASK-AI-21 schema+seed, no reader) | cross-session memory for workers | a ShipDe-owned memory provider plugin backed by lessons/ or a decision log reader | memory must not override specs |
| context engine | prompt-compiler.js; repo-map/scope-gate/output-store (TASK-AI-78, gated on a ≥40% token benchmark) | compaction per turn | none (worker-side config) | measure, do not assume |
| skills | none in the brain | role/procedure skills (AgentSkills format, shared with Anthropic and OpenHands) | role → skill set mapping | per-skill license |
| session persistence | worker sessions via opencode; checkpoint resume (TASK-AI-105) | resume of the worker conversation itself | session id in the checkpoint | – |
| pinned execution | isolation-launcher pins model in opencode.json | `hermes -p <profile>` | Controller-generated profile | profile ≠ full 7-part key (unknown) |
| Windows | yes | yes | – | WorkerUser + Hermes runtime under isolation not tested |

## 4. Context / prompt / UI (a separate group)

The line between helping and overriding: a skill may help implement an approved spec (layout, accessibility checks, component code). It may not replace the product, UX or screen specification as the authority (AGENTS.md "UI quality rule").

| candidate | pin | license (checked per part) | use as implementation aid | verdict now |
|---|---|---|---|---|
| ui-ux-pro-max-skill | 477bcb28c981 | MIT (LICENSE, skill.json) | palette/typography/a11y checklists applied only inside DESIGN-SYSTEM-UX-RULES + screen spec | AUDIT_ONLY (r1 REJECT withdrawn) |
| anthropics/skills frontend-design | 683bc88e56f3 | Apache-2.0 (skills/frontend-design/LICENSE.txt) | frontend build procedure | AUDIT_ONLY |
| anthropics/skills docx/pdf/pptx/xlsx | 683bc88e56f3 | source-available, "All rights reserved" | none | REJECTED for reuse |
| anthropics/skills skill-creator | 683bc88e56f3 | Apache-2.0 | skill authoring format | AUDIT_ONLY |
| Agent-Skills-for-Context-Engineering | 58b55a892175 | MIT | context/memory/multi-agent patterns (text) | AUDIT_ONLY |
| rtk | df39e33d7e59 | Apache-2.0 | shell-output compaction (AGENTS.md: low-risk work only) | AUDIT_ONLY |
| serena | 3155fd67e9b7 | SolidLSP MIT; app GPL-3.0-or-later | external process for symbol retrieval | POC_ONLY |
| repomix | inventory | MIT | repo packing | INSTALLED |
| Hermes skills | 4787e4d56fc8 | MIT plus per-skill LICENSE files | role skills | AUDIT_ONLY |

## 5. Unwired ShipDe modules: contract and consumer

| module | contract | intended consumer | status | position |
|---|---|---|---|---|
| repo-map.js, scope-gate.js, output-store.js | test/task-ai-78.test.js; TASK-AI-78.md:11 "not wired into the default prompt path until a benchmark shows ≥40% input-token reduction without lower pass rate" | prompt-compiler / writer loop | EXPERIMENTAL, gated on a benchmark that has not run | keep; they are arm candidates in POC B |
| tools/ai-brain/lessons/ | TASK-AI-21.md (shipde-brain repository and lesson schema) | shipde-brain repo / a memory reader | schema + seed, no reader | keep; possible backing store for a memory provider (POC A) |
| capabilities.js ROLES | capabilities.js:42-80; jev.js:167 reads mayWriteCode | role enforcement | partially read | keep; reconcile with routing roles after POC A |

## 6. Two independent POCs (not run)

Both POCs record quality, tokens, wall time, peak RAM and integration effort (lines and files changed in an adapter branch). Effort already spent on ShipDe code is not a decision criterion.

### POC A — workflow
- Goal: a fixed two-item goal — a registered Work Item pair (one implementation item plus one dependent test/doc item) with hidden tests.
- Flow: goal → plan → two roles/workers → handoff → independent review → kill after the first worker commit → resume.
- Arms:
  - A1, current ShipDe loop: orchestrate + planner.js.
  - A2, Hermes kanban: decompose + dispatcher. The Controller writes the profiles (pinned candidates through 9router); the ShipDe reviewer manifest and publisher stay.
  - A3 (optional), OpenHands SDK through its REST Agent Server with an LLM per conversation set by the Controller.
- Measures:
  - completion;
  - hidden-test pass;
  - exact-SHA review findings;
  - handoff fidelity (does the second worker use the first worker's commit and notes);
  - tokens;
  - wall time;
  - peak RAM of the process tree;
  - after the kill: duplicate launches/reviews and time to resume;
  - adapter lines.

### POC B — context / UI
- Task: one screen that already has a screen spec in docs/product-spec/docs/ (picked by the operator), built against DESIGN-SYSTEM-UX-RULES.
- Arms:
  - B1: current prompt-compiler.
  - B2: retrieval through serena/repomix + role skills (frontend-design, Apache-2.0) + ui-ux-pro-max as a checklist-only aid + rtk on shell output.
  - B3: B1 + TASK-AI-78 repo-map/scope-gate/output-store.
- Measures:
  - spec conformance: a checklist from the screen spec plus loading/empty/error/forbidden/success states;
  - accessibility (axe);
  - review findings;
  - input tokens;
  - wall time;
  - peak RAM;
  - integration effort.

## 7. Requirement table

| operator requirement | current capability | repo/component | self-built part it could replace | adapter needed | evidence | unknown | provisional decision |
|---|---|---|---|---|---|---|---|
| planner | planner.js dry-run; humans and Codex write Work Items | Hermes plan_prompt + kanban_decompose; AO planner | planner.js | kanban child → registered Work Item | files read above | quality of the decomposition against specs | POC A |
| orchestration / delegation | orchestrate loop + executor/scheduler | Hermes kanban dispatcher/delegate; OpenHands subagent; AO workers | executor.js/scheduler.js dispatch path; parts of the loop | Controller → Hermes profile/delegate override; Controller → OpenHands REST | kanban_db_dispatch.py:2831; delegate_tool_config.py:182 | full 7-part identity in a profile; isolation under WorkerUser | POC A |
| shared memory | checkpoint, decision log, evidence; lessons unwired | Hermes memory_provider (+ plugins); OpenHands persistent memory | lessons reader | ShipDe memory provider plugin | memory_provider.py | whether memory can leak into specs | POC A (secondary) |
| role / prompt | prompt-compiler; roles in orchestrate/routing; capabilities.ROLES partly read | AgentSkills SKILL.md (Anthropic Apache skills, Hermes skills, OpenHands) | role prompt text in prompt-compiler | role → skill-set map | licenses above | effect on quality | POC B |
| context / token | TASK-AI-78 modules gated; serena pilot | Hermes context_engine; rtk; serena; repomix | none until measured | worker-side config | TASK-AI-78.md:11 | real token reduction | POC B |
| skills | none in the brain | the skill sets above | – | loader in the chosen harness | per-skill licenses | – | POC B |
| UI by spec | specs + DESIGN-SYSTEM-UX-RULES; no UI skill | frontend-design (Apache-2.0), ui-ux-pro-max (MIT) as aids | – | role skill for UI work | licenses | spec-conformance gain | POC B |
| review / repair | review-loop + manifest + publisher gates | Hermes request_review; OpenHands critic | none | reviewer must stay different-domain and exact-SHA | – | whether external review lanes can emit ShipDe manifests | keep ShipDe gates |
| recovery | checkpoint/resume (unit), failure classifier | Hermes failure limit 2 + quota auto-block + session persistence | none decided | – | kanban_db_dispatch.py constants | live interrupt+resume not yet run in either system | POC A |
| resource | supervisor rule only | Hermes memory-aware concurrency caps | the supervisor RAM rule | config | kanban_db_dispatch.py docstring | Windows behaviour | POC A |
| source onboarding | sources.json + hand-edited opencode.json | Hermes model-providers plugins (including opencode-zen, nebius) | hand edits | profile generation | plugin list | – | POC A |
| publisher | ShipDe publisher (approval-bound) | – | – | – | #215/#217 | – | keep |
