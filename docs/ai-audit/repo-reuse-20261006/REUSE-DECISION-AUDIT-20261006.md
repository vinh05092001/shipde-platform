# Reuse decision audit — 2026-10-06 (read-only, code origin/main eaa569f)

## Method and limits

Sources read:
- `.worktrees/logs/STOP-AND-STATUS-20261006.md`;
- `tools/ai-brain/*.js` at eaa569f (about 29,500 lines; which module requires which);
- `REPO-INVENTORY-CANONICAL-20261004.json` (88 repos), `REPO-REUSE-DECISION-FINAL-20261004.md`, `WS2-FINAL-REPORT-20261001.md`;
- GitHub API metadata, license files and top-level trees of 6 named candidates. No clone was made and no external script was run.

Limit: the GitHub repos were not read file by file in this pass. Wherever a file or symbol is cited for an external repo, it comes from the WS2 final decision document (audited on 2026-10-04) or from that repo's top-level tree and README.

The full 88-row table is in `A-88-repo-table.md`.

## A. 88 repos at a glance

| Status | Repos |
|---|---|
| INTEGRATED | 30 (toolchain and services: node, pnpm, prettier, eslint, prisma, gh, 9router, paseo/agent-orchestrator, playwright-mcp, msw, prism, gitleaks, lefthook, promptfoo, context7, repomix, opentelemetry-js, openapi-typescript, renovate, chrome-devtools-mcp, codex/gemini/claude CLIs, antigravity, deepseek-harness, docker compose, turborepo, git-for-windows, shipde-platform) |
| AUDIT_ONLY | 45 |
| POC_ONLY | 4 (llmlingua, pact-js, semgrep, toxiproxy) |
| REJECTED | 9 (ccpm, daytona, ntm, cmux, deepagents, langgraph-supervisor-py, claude-squad, swe-agent, openshell) |

Corrections against the inventory:
- nousresearch/hermes-agent: inventory says PENDING. It is INTEGRATED as a harness: `tools/ai-brain/harness.js:112-125` (Hermes v0.21.4 one-shot handle contract), also referenced in executor.js, orchestrate.js and sources.js.
- oraios/serena: inventory says PENDING. It is POC_ONLY: `tools/ai-brain/serena.js` (641 lines, TASK-AI-32 RESEARCH_ONLY) is reachable only through `cli.js serena`.
- raine/workmux git environment scrubbing: PATTERN_APPLIED. The publisher runs git through `withCleanGitEnv`/`safeGit` (used by TASK-AI-104 for the register read).
- cline/cline atomic file: REJECTED by measurement (5.3–15.8 ms per write). ShipDe keeps tmp+rename (`cli.js:946`, now with .tmp adoption at `cli.js:915-944`).

Four of the six named candidates are not in the inventory: rtk, anthropics/skills, Agent-Skills-for-Context-Engineering, ui-ux-pro-max-skill. They are covered in the group table below.

## Six named candidates

Pinned commits are the heads read from the GitHub API on 2026-10-06.

| repo | pinned | license per part | what it is | Windows | verdict |
|---|---|---|---|---|---|
| NousResearch/hermes-agent | 4787e4d56fc8 | MIT | Python agent runtime | runs as an installed binary here (JEV path, TASK-AI-50) | INTEGRATED as a harness; do not add more of it |
| oraios/serena | 3155fd67e9b7 | per component: SolidLSP (`src/solidlsp/`) MIT; Serena application GPL-3.0-or-later; a combined package is GPL as a whole | LSP-backed semantic code retrieval (MCP/CLI) | Python + language servers | POC_ONLY. Use only as a separate process (no linking, no vendoring of app code). The SolidLSP MIT part is the only extractable code |
| rtk-ai/rtk | df39e33d7e59 (branch develop) | Apache-2.0 | Rust CLI proxy that compacts shell output (git diff, test logs) before the agent reads it. README: "up to 90% of bash output", token numbers estimated as bytes/4 | winget package | AUDIT_ONLY. AGENTS.md already allows RTK only for low-risk work and forbids it on failed-test, evidence or diff-sensitive work |
| anthropics/skills | 683bc88e56f3 | no repo license. Most skills Apache-2.0 (for example `skills/skill-creator/LICENSE.txt`); `skills/docx`, `pdf`, `pptx`, `xlsx` are source-available, "All rights reserved" | SKILL.md format and example skills | n/a (markdown + scripts) | AUDIT_ONLY. Only the Apache-2.0 skills may be adapted; never copy the four document skills |
| muratcankoylan/Agent-Skills-for-Context-Engineering | 58b55a892175 | MIT | 21 markdown skills (context-compression, context-degradation, memory-systems, multi-agent-patterns, tool-design, evaluation, ...) | n/a | AUDIT_ONLY. Pattern text only; no runtime |
| nextlevelbuilder/ui-ux-pro-max-skill | 477bcb28c981 | MIT | design-taste skill (79 styles, 192 palettes, ...) | Python CLI | REJECTED as UX authority. AGENTS.md "UI quality rule" forbids a global taste prompt as product/UX authority; UX must follow DESIGN.md / DESIGN-SYSTEM-UX-RULES.md and screen specs |

## Group table (12 groups)

| # | group | need | ShipDe code now (eaa569f) | candidate + pin | mechanism | status | duplicate that can go | license | Windows | dep / RAM | integration effort | test needed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | core/runtime | run items end to end with gates | orchestrate.js (loop), cli.js orchestrate, supervisor.js, planner.js, review-loop.js, executor.js + scheduler.js (dispatch path TASK-AI-24/49) | microsoft/agent-framework e15c6dce2d10; openai/openai-agents-python 28e9f4fca26d | typed workflow state, handoff schema (WS2) | AUDIT_ONLY (patterns) | two dispatch paths (executor/scheduler vs orchestrate loop) need one owner; planner.js and supervisor.js are marked "dry-run level" | MIT | Python, unused | 60 MB each if adopted | high to replace | contract test that one entrypoint drives selection → publish |
| 2 | orchestration | select, reserve, fall back, isolate | routing.js, ranking.js, candidates.js, jev.js, isolation-launcher.js, failure-classifier.js | untrivial-ai/agent-orchestrator (installed, AO unusable since 18/9 per memory); openhands/openhands 29b0281bf085; generalaction/emdash b179913b8c80 | AO: daemon orchestrator; OpenHands: full platform (daemon, 300 MB); emdash: worktree payload | AO INTEGRATED-but-failing; others AUDIT_ONLY | none outside brain; AO itself is the duplicate | MIT / Apache-2.0 | AO needs daemon; OpenHands needs Docker/WSL | 300 MB+ | very high | – |
| 3 | memory/handoff | durable run state and handoff between agents | checkpoint (cli.js:915-946), evidence.json, decision log (decisions.js); `tools/ai-brain/lessons/` unwired | gastownhall/beads (PENDING); Agent-Skills memory-systems (MIT text) | issue-graph memory; pattern text | AUDIT_ONLY | lessons/ (schema+seed, no reader) | MIT | beads is a native binary | small | medium | resume test across processes; handoff schema test |
| 4 | role/prompt | role policy enforced; prompt built per role | prompt-compiler.js (used by orchestrate); roles applied at orchestrate.js:109-120 and routing.js:57,222; capabilities.js:42-80 ROLES only partly read (jev.js:167) | anthropics/skills skill-creator (Apache-2.0); github/spec-kit; fission-ai/openspec | SKILL.md structure; spec templates | AUDIT_ONLY | capabilities.ROLES vs routing roles: two role tables | Apache-2.0 / MIT | text | none | low (docs) | role table single source test |
| 5 | context/token | smaller prompts and tool output | repo-map.js, scope-gate.js, output-store.js (TASK-AI-78, unwired); serena.js (pilot) | rtk-ai/rtk df39e33d7e59; yamadashy/repomix (INTEGRATED tool); oraios/serena 3155fd67e9b7; microsoft/llmlingua (POC_ONLY) | shell-output compaction; repo packing; LSP retrieval | rtk AUDIT_ONLY, repomix INTEGRATED (tool), serena POC_ONLY | repo-map.js and output-store.js duplicate repomix/rtk roles and are not called | Apache-2.0 / MIT / GPL app | rtk via winget; serena needs language servers | rtk native, small; serena Python | low for rtk (worker-side only); medium for serena | token/wall-time POC (F) |
| 6 | code-test-review-repair | exact-SHA review, bounded repair | review-loop.js, review-manifest.js, orchestrate review lanes, publisher gates | langchain-ai/open-swe 9613f663bbff; swe-agent/swe-rex 5c995c365dfb | review-repair state machine; runtime liveness | AUDIT_ONLY | none | MIT | Python | – | – | provider-error-is-not-verdict test (gateB3 round 1 defect) |
| 7 | source onboarding | add a model source as data | sources.js + sources.json, candidates.js; opencode.json edited by hand | decolua/9router (INTEGRATED); agentgateway dd7a4b32d352 (catalogue schema); berriai/litellm 9dda4d895f16 | gateway; pricing catalogue schema; router config | 9router INTEGRATED; others AUDIT_ONLY | hand edits of opencode.json | MIT / Apache-2.0 | 9router runs here | 9router ~node app | low (data) | source added by data reaches launcher test |
| 8 | model qualification | role-specific proof before use | qualification.js, qualification-gate.js, work-evidence.js (import-work), evidence.js | promptfoo/promptfoo (INTEGRATED tool) | eval harness | INTEGRATED as tool, not wired to evidence | none | MIT | node | – | medium | imported evidence changes selection test |
| 9 | reuse-first / UI | reuse components, UX rules | none in brain; repo UI stack (storybook PENDING, playwright ADOPTED, axe PENDING) | ui-ux-pro-max-skill 477bcb28c981 | taste prompt | REJECTED (AGENTS.md UI rule) | – | MIT | – | – | – | – |
| 10 | recovery | resume, retry policy, failure scope | failure-classifier.js (TASK-AI-107), routing failure-domain (TASK-AI-103), checkpoint (TASK-AI-105) | temporalio/sdk-typescript c973304f77a4 (`retry-policy.ts:RetryPolicy`); langgraph f5804a5bf583 (`_retry.py:default_retry_on`); e2b 03887ad7813a (`retry.ts:withRetry`) | retry-policy spec and classifier | AUDIT_ONLY | none; ShipDe already has its own classifier | MIT / Apache-2.0 | n/a | none | low (pattern review only) | live interrupt+resume (still missing) |
| 11 | resource | RAM/CPU limits, lane count | limits.js, ceiling.js, quota-store.js (accounts/quota); no RAM governor in code (supervisor-only rule) | dicklesworthstone/ntm (REJECTED); raine/workmux 761ad3bfe3c9 | tmux-style session manager | REJECTED / PATTERN_APPLIED (git env) | – | MIT | ntm needs tmux | – | – | – |
| 12 | publisher | governed draft PR | publisher.js (TASK-AI-102/104 gates), approval-registry.js | cli/cli (INTEGRATED via gh) | gh pr create | INTEGRATED | none | MIT | yes | – | – | contract-green draft PR (Gate B, needs approval) |

## B. At most 5 worth using now

1. **rtk-ai/rtk** (Apache-2.0, df39e33d7e59): worker-side shell-output compaction for low-risk Work Items only, as AGENTS.md already allows. External binary; nothing vendored. Measure it first (POC in F).
2. **oraios/serena** (SolidLSP MIT / app GPL-3.0, 3155fd67e9b7): already piloted (serena.js). Keep it as an external process for code retrieval, and measure it in the same POC. Do not vendor the application code.
3. **yamadashy/repomix** (MIT, already INTEGRATED as a tool): use it instead of finishing repo-map.js.
4. **anthropics/skills** `skills/skill-creator` (Apache-2.0, 683bc88e56f3): format for role/prompt manifests. Docs only; skip the four source-available document skills.
5. **temporalio/sdk-typescript** `RetryPolicy` (MIT, c973304f77a4): reference to check failure-classifier and cooldown semantics. Pattern only.

## C. Three options

1. **Keep the current orchestration.**
   - What stays: the Controller (routing, ranking, evidence, failure-domain, publisher gates). It is merged, tested and live-proven up to a reviewed commit (Gate B3).
   - Cost: generic parts keep being ShipDe-built (context, memory), and some built parts are unwired: repo-map, scope-gate, output-store, lessons, capabilities.ROLES.
2. **Replace orchestration with an existing platform** (OpenHands, agent-orchestrator, LangGraph, agent-framework).
   - Evidence against:
     - AO stopped working on 18/9 (memory: ao-not-usable) and is heavy on Claude quota;
     - OpenHands needs a daemon plus Docker/WSL and about 300 MB;
     - LangGraph and agent-framework are Python, while the brain is Node;
     - none of them has ShipDe's 7-part candidate key, quota/failure-domain evidence or approval-bound publisher.
   - Cost: a large rewrite, and the six merged gates (#214–#219) would be lost.
3. **Hybrid.** Keep the Controller and gates, and stop building generic layers:
   - context/token: rtk on the worker + repomix/serena as external tools, instead of repo-map/output-store;
   - role/prompt: one role manifest format modelled on SKILL.md;
   - memory: checkpoint + decision log stay; lessons/ is dropped until there is a reader;
   - qualification: promptfoo stays a tool; evidence comes from `import-work`.

## D. Choice: option 3 (hybrid)

- **Why:**
  - The parts that are hard to buy are already built and merged: candidate key, evidence, failure-domain, approval-bound publisher, isolation.
  - The parts that are cheap to buy are either half-built and unwired in ShipDe (repo-map, output-store, scope-gate, lessons) or not built at all (shell-output compaction).
  - Option 2 discards the merged gates. Option 1 keeps spending on generic pieces.
- **Scope:**
  - worker-side tool configuration (rtk/serena/repomix as external processes);
  - one role manifest table;
  - delete or archive the unwired modules after operator approval.
  - No Controller rewrite.
- **Rollback:** the external tools are opt-in per Work Item profile, so disabling the flag restores the current behaviour. Removed modules stay recoverable from git history (TASK-AI-78 merge c052112).

## E. Minimal backlog

MUST_HAVE_NOW (gates for real coding; unchanged from STOP report):
1. Operator approval for 2b371fd, then publish and get contract + CI green. Evidence: gateB3 out.json publication NOT_REQUESTED.
2. A reviewer provider error must not become a CHANGES_REQUIRED verdict. Evidence: gateB3 `review-manifest-TASK-AI-106-round-1.json`.
3. One live interrupt+resume on main. Evidence: TASK-AI-105 proven only by unit tests and the mid-run checkpoint.
4. Role-specific evidence import (TASK-AI-92 + import-work). Evidence: evidence.json has 7 WORK_ITEM_PASS records for 4 models, no role.

NEXT:
- POC F (rtk + serena on the same Work Item), then decide on adoption.
- A single role table: merge capabilities.ROLES with the routing role set.

DEFER:
- beads/memory systems; llmlingua; source onboarding automation beyond sources.json data.

REMOVE_DUPLICATE (needs operator approval; nothing deleted now):
- repo-map.js, scope-gate.js, output-store.js: unwired, and covered by repomix/rtk.
- tools/ai-brain/lessons/: no reader.
- capabilities.ROLES or the routing role set: keep one.
- reuse-decision-matrix.md: superseded.

## F. Proposed POC (not started)

- **Task:**
  - Two fixed Work Items, each with hidden tests: one small (clampInteger-like) and one medium (the TASK-AI-107 replay classifier change against eaa569f^).
  - The same Controller-selected writer key in both arms.
  - 3 runs per arm.
- **Arms:**
  - A: current loop.
  - B: current loop with rtk on worker shell output and serena retrieval enabled (external processes).
- **Metrics:**
  - completion: reviewed commit reached (yes/no);
  - tokens: opencode session usage input/output per run;
  - wall time;
  - peak RAM of the worker tree (sampled every 5 s);
  - correctness: hidden tests pass plus independent exact-SHA review findings;
  - recovery: kill the orchestrate process after the launch step, rerun with the same checkpoint, count duplicate launches and reviews.
- **Pass rule:** B is adopted only if it cuts input tokens or wall time by at least 20% with no loss in correctness or recovery. Otherwise REJECT.
