# Per-repo decisions r2 (88 inventory + 13 outside: 11 named candidates + 2 runtimes missing from the inventory), 2026-10-06

One decision per repo. KEEP_RUNTIME = already running for the AI workflow; USE = to integrate into the brain (measured before default-on); USE_AS_TOOL = app/dev toolchain or helper, not the brain; PATTERN_ONLY = copy an idea, no dependency; REPLACED_BY = covered by a chosen repo; DROP = no need, conflict, license or platform.

| repo | pinned | license | old WS2 | decision | reason |
|---|---|---|---|---|---|
| agentgateway/agentgateway | dd7a4b32d352 | Apache-2.0 | ADOPT_PATTERN | PATTERN_ONLY | model pricing catalogue schema for future cost data |
| anchore/syft | unpinned (toolchain, not read) | Apache-2.0 | WATCH | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| anthropic-ai/claude-code | unpinned (toolchain, not read) | none | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| aquasecurity/trivy | 8f815546c7b5 | Apache-2.0 | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| ast-grep/ast-grep | 029430eac791 | MIT | WATCH | USE_AS_TOOL | structural search for reviewers (optional) |
| automazeio/ccpm | 7d7e4623bc6d | MIT | REJECT | REPLACED_BY:obra/superpowers | PM workflow via commands; superpowers covers plan/execute/review |
| berriai/litellm | 9dda4d895f16 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | retry budget by exception; no gateway swap (9router stays) |
| bostonvex/claude-codex-orchestrator | 7f8ad4defbcc4e6864a2aee744407854b44d7da5 | none | ADOPT_PATTERN | REPLACED_BY:obra/superpowers | issue-driven loop covered by superpowers + ShipDe loop |
| chromedevtools/chrome-devtools-mcp | unpinned (toolchain, not read) | Apache-2.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| cli/cli | 17142e08db2e | MIT | INSTALLED | KEEP_RUNTIME | publisher gh calls |
| cline/cline | 9fe17595de3b0c980d6c8291f7c42bf0b8cc94a3 | Apache-2.0 | EXTRACT_SMALL_COMPONENT | DROP | atomic-file POC measured slower (REJECT); Cline stays only as a 9router upstream |
| daytonaio/daytona | ec4c21b2d597 | Apache-2.0 | REJECT | DROP | container sandbox; not Windows host isolation |
| decolua/9router | a99cf57239ff (installed 0.5.95) | MIT | INSTALLED | KEEP_RUNTIME | gateway for most sources; call site sources.js/isolation-launcher |
| deepseek-ai/deepseek-harness | 5badb15009ae (installed dsh 0.1.1-rc.2) | MIT | INSTALLED | DROP | developer preview harness; opencode/hermes already cover |
| dequelabs/axe-core | unpinned (toolchain, not read) | MPL-2.0 | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| dicklesworthstone/ntm | fe4cff595073 | MIT | REJECT | DROP | tmux-based; not native on Windows |
| docker/compose | unpinned (toolchain, not read) | Apache-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| e2b-dev/e2b | 03887ad7813a | Apache-2.0 | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | withRetry REPLAYABLE_OPERATIONS guard |
| eslint/eslint | unpinned (toolchain, not read) | MIT | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| evilmartians/lefthook | unpinned (toolchain, not read) | MIT | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| fission-ai/openspec | 9111a7654d78 | MIT | PENDING | DEFERRED | change/spec/validation management is not covered by superpowers (workflow only); revisit for spec governance |
| forwardemail/supertest | unpinned (toolchain, not read) | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| gastownhall/beads | e72cd8b3153c | MIT | PENDING | DROP (defer) | shared task memory; use superpowers plan files + ShipDe checkpoint first; revisit if handoff fails |
| generalaction/emdash | b179913b8c80 | Apache-2.0 | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | collision-proof worktree payload |
| getnao/sylph | d31a9c05f19d | none (no LICENSE at d31a9c05f19d) | PENDING | DROP | no LICENSE file at d31a9c05f19d (GitHub reports none); inventory license column was wrong |
| git-for-windows/git | unpinned (toolchain, not read) | GPL-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| github/spec-kit | 2dda047809dd | MIT | PENDING | PATTERN_ONLY | constitution + artifact templates; not covered by superpowers |
| gitleaks/gitleaks | b58d3f102cf3 | MIT | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| google-gemini/gemini-cli | unpinned (toolchain, not read) | Apache-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| google/antigravity | unpinned (toolchain, not read) | none | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| googlechrome/lighthouse-ci | unpinned (toolchain, not read) | Apache-2.0 | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| grafana/k6 | unpinned (toolchain, not read) | AGPL-3.0 | WATCH | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| i-trytoohard/codex-startup-factory | 6e40df70f8ebd9d425243d9032abe0136b30bcd1 | MIT | ADOPT_PATTERN | REPLACED_BY:obra/superpowers | AO fork; workflow covered by superpowers skills |
| langchain-ai/deepagents | 5a21fbc597e9 | MIT | REJECT | PATTERN_ONLY | planner/subagent pattern; Python LLM-graph, not CLI workers |
| langchain-ai/langgraph | f5804a5bf583 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | retry classifier default_retry_on: cross-check failure-classifier.js |
| langchain-ai/langgraph-supervisor-py | 88859b34017a | MIT | REJECT | PATTERN_ONLY | supervisor/handoff pattern |
| langchain-ai/open-swe | 9613f663bbff | MIT | ADOPT_PATTERN | PATTERN_ONLY | review-repair state machine (ShipDe already has one) |
| manaflow-ai/cmux | unpinned (toolchain, not read) | MIT | REJECT | DROP | tmux-based |
| microsoft/agent-framework | e15c6dce2d10 | MIT | ADOPT_PATTERN | PATTERN_ONLY | ShellPolicy / revision-checked checkpoint ideas |
| microsoft/llmlingua | 5a4c78ae18ab | MIT | PILOT | DROP | Python prompt compression; RTK covers the shell-output part with no Python runtime. Savings not measured |
| microsoft/playwright | unpinned (toolchain, not read) | Apache-2.0 | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| microsoft/playwright-cli | unpinned (toolchain, not read) | Apache-2.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| microsoft/playwright-mcp | unpinned (toolchain, not read) | Apache-2.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| mswjs/msw | unpinned (toolchain, not read) | MIT | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| mswjs/msw-storybook-addon | unpinned (toolchain, not read) | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| nestjs/nest | unpinned (toolchain, not read) | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| nock/nock | unpinned (toolchain, not read) | MIT | WATCH | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| nodejs/node | unpinned (toolchain, not read) | MIT | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| nousresearch/hermes-agent | 4787e4d56fc8 (installed v0.21.4) | MIT | PENDING | KEEP_RUNTIME | one-shot harness (harness.js); kanban/delegate stay candidates for planner later |
| nvidia/openshell | 2935e9731b97e89ae78aa7bc66867bc2281444ef | Apache-2.0 | REJECT | DROP | Rust/k8s sandbox; Windows WorkerUser isolation stays |
| open-policy-agent/opa | d179cdae4073 | Apache-2.0 | WATCH | DROP | policy engine not needed; ShipDe gates are code |
| open-telemetry/opentelemetry-js | unpinned (toolchain, not read) | Apache-2.0 | ADOPTED | USE_AS_TOOL | app observability (product), not brain |
| openai/codex | unpinned (toolchain, not read) | none | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| openai/openai-agents-python | 28e9f4fca26d | MIT | ADOPT_PATTERN | PATTERN_ONLY | handoff schema + guardrails |
| openapi-ts/openapi-typescript | unpinned (toolchain, not read) | MIT | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| openhands/openhands | 29b0281bf085 | MIT | ADOPT_PATTERN | DROP | full platform with a server and Docker workspaces; overlaps the Controller. RAM not measured on this machine |
| openhands/software-agent-sdk | d0f9500590c1 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | risk levels / critic ideas; not adopted as runtime |
| oraios/serena | 3155fd67e9b7 | SolidLSP MIT / app GPL-3.0-or-later | PENDING | PATTERN_ONLY | POC exists (serena.js); not adopted until measured; RTK first |
| pact-foundation/pact-js | unpinned (toolchain, not read) | MIT | PILOT | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| pnpm/pnpm | unpinned (toolchain, not read) | MIT | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| prettier/prettier | unpinned (toolchain, not read) | MIT | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| prisma/orm | unpinned (toolchain, not read) | Apache-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| promptfoo/promptfoo | a65fe81a676e | MIT | ADOPTED | DEFERRED_QUALIFICATION_TOOL | dataset/regression evals of prompt-model-provider; different from Work Item evidence. Not installed. pinned a65fe81a676e |
| raine/workmux | 761ad3bfe3c9 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | git env scrubbing already applied in publisher |
| renovatebot/renovate | unpinned (toolchain, not read) | AGPL-3.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| ruvnet/ruflo | a3dee4ff8b7c | MIT | ADOPT_PATTERN | PATTERN_ONLY | safe-git wrapper idea; do not vendor |
| semgrep/semgrep | 93eeef68950a | LGPL-2.1 | PILOT | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| shopify/toxiproxy | unpinned (toolchain, not read) | MIT | PILOT | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| smtg-ai/claude-squad | ce1ffb4392b0 | AGPL-3.0 | REJECT | DROP | tmux + AGPL |
| snyk/agent-scan | 69ce32c6e5ae | Apache-2.0 | PENDING | USE_AS_TOOL | scan installed skills/MCP before enabling them (security gate for superpowers/impeccable) |
| spectolabs/hoverfly | unpinned (toolchain, not read) | Apache-2.0 | WATCH | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| stoplightio/prism | unpinned (toolchain, not read) | Apache-2.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| storybookjs/addon-a11y | unpinned (toolchain, not read) | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| storybookjs/storybook | unpinned (toolchain, not read) | MIT | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| swe-agent/swe-agent | 3ea751c087f3 | MIT | REJECT | DROP | single-agent harness; no unmet need |
| swe-agent/swe-rex | 5c995c365dfb1fd5bc56fda688be5d8538f9931f | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | liveness _wait_until_alive (ShipDe supervisor has its own) |
| taskforcesh/bullmq | 71c9ca72f321 | MIT | DEFERRED | DROP | Redis queue; would be a second scheduler |
| temporalio/sdk-typescript | c973304f77a4 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | RetryPolicy spec: cross-check failure-classifier.js cooldowns |
| thanglequoc/vietnamese-provinces-database | unpinned (toolchain, not read) | MIT | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| untrivial-ai/agent-orchestrator | 9a1cb73134ac | MIT | INSTALLED | DROP | AO stopped working ~18/9 (memory note); runs a background daemon and its own model choice, which conflicts with the Controller. RAM not measured |
| upstash/context7 | f2eef4f49da7 | MIT | ADOPTED | USE_AS_TOOL | library docs lookup for workers |
| vercel-labs/agent-skills | 063bee94c3f4 | none (no LICENSE at 063bee94c3f4) | PENDING | DROP | no LICENSE file at 063bee94c3f4 (GitHub reports none); inventory license column was wrong |
| vercel/turborepo | unpinned (toolchain, not read) | MPL-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| vinh05092001/shipde-brain | 711954f9b7ceba86e890001fce97786536ac02d4 | none | PENDING | KEEP (data) | lessons/prompts store; no runtime reader yet |
| vinh05092001/shipde-platform | 09d9848a2e447829510dd65354e114a305e604c2 | none | INTEGRATED | KEEP_RUNTIME | this repo |
| vitest-dev/vitest | unpinned (toolchain, not read) | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| xiufengsun/tokentracker | 17247d9d0c9e | MIT | PENDING | USE_AS_TOOL (measure) | token telemetry for the before/after measurements |
| yamadashy/repomix | 8d6429121e98 (installed 0.3.3) | MIT | ADOPTED | USE_AS_TOOL | installed; repo packing for reviewers/analysts |

## Named candidates outside the inventory

| repo | pinned | license | decision | reason |
|---|---|---|---|---|
| obra/superpowers | 8ca22dba9a94 | MIT | USE (locked adapter) | workflow/prompt pack: plan → subagent dev → review → repair. Must be adapted before use: its own model tiering/selection, a 5-round fix loop, push/merge/discard guidance and delete-code-before-test TDD conflict with the Controller, the repair budget, the publisher and recovery policy; only prompts/workflow are used, the Controller keeps model choice, repair budget and publish rights. Architecture has no background service; RAM not measured |
| rtk-ai/rtk | df39e33d7e59 | Apache-2.0 | USE (measure first) | shell-output compaction for low-risk worker runs; single binary run per command; savings on ShipDe not measured; AGENTS.md limits it to low-risk work |
| pbakaus/impeccable | 4e8504f10106 | Apache-2.0 | USE | UI role skill + 60 detector rules; replaces ui-ux-pro-max/frontend-design; under screen spec |
| affaan-m/ECC | ef648e01899b | MIT | PATTERN_ONLY / PILOT_WINDOWS (memory) | orchestration/skills overlap superpowers and are not used; memory format/handoff kept as pattern or a Windows pilot; not enabled at runtime (Windows-native memory issues reported) |
| bmad-code-org/BMAD-METHOD | 8f2c13dd0e00 | MIT | ALTERNATIVE_WORKFLOW | product brief, architecture, UX, story context and adjustable planning depth that superpowers does not cover; benchmark against superpowers; never install both |
| open-gsd/gsd-core | 1b362a1f688c (operator verified 13d37238ba08) | MIT | DROP runtime / PATTERN_ONLY | own state and model selection conflict with the Controller; patterns STATE.md, context budgeting and resume may be reused |
| mksglu/context-mode | e5fcca6802d4 | ELv2 (source-available) | DROP (fallback) | MCP + SQLite process, license; RTK first |
| earendil-works/pi | 9ad083102aa9 | MIT | DROP | harness only (no planner/subagent); OpenCode and Hermes one-shot already serve as harnesses |
| anthropics/skills | 683bc88e56f3 | Apache-2.0 per skill (docx/pdf/pptx/xlsx source-available) | PATTERN_ONLY | skill-creator format as reference; UI covered by impeccable |
| muratcankoylan/Agent-Skills-for-Context-Engineering | 58b55a892175 | MIT | PATTERN_ONLY | context patterns text |
| nextlevelbuilder/ui-ux-pro-max-skill | 477bcb28c981 | MIT | REPLACED_BY:pbakaus/impeccable | design checklist covered |
| anomalyco/opencode | f03046d9f558 (installed 1.18.31) | MIT | KEEP_RUNTIME | main worker harness: isolated opencode-direct launches and reviewer runs; missing from the 88 inventory |
| getpaseo/paseo | 81a5e5bc61d6 (installed 0.8.0) | mixed per component (LICENSE: portions licensed separately) | KEEP_RUNTIME | harness/daemon used by Controller candidates (paseo::...); missing from the 88 inventory |

## Totals

- PATTERN_ONLY: 19
- USE_AS_TOOL: 44
- REPLACED_BY: 4
- KEEP_RUNTIME: 6
- DROP: 16
- DEFERRED: 1
- DROP (defer): 1
- DEFERRED_QUALIFICATION_TOOL: 1
- KEEP (data): 1
- USE_AS_TOOL (measure): 1
- USE (locked adapter): 1
- USE (measure first): 1
- USE: 1
- PATTERN_ONLY / PILOT_WINDOWS (memory): 1
- ALTERNATIVE_WORKFLOW: 1
- DROP runtime / PATTERN_ONLY: 1
- DROP (fallback): 1

## Minimal core after r2 corrections (proposal)
- ShipDe Controller: policy, model/source/account/quota/fallback/checkpoint (sole selector).
- OpenCode + Hermes one-shot: execution harnesses; Paseo where Controller candidates use it.
- Superpowers: workflow/prompt/role pack, permission-locked (no model choice, no push/merge, ShipDe repair budget).
- RTK: task-scoped output filtering, benchmark before default-on.
- Impeccable: UI role and detectors, under the screen spec.
- ECC memory format: pilot only, not enabled on Windows runtime.
- GitHub/CI/test/security tools: tools, no background services.
- No new orchestrator daemon.

## r2 changes (operator review 2026-10-06)
Narrowed superpowers replacement (OpenSpec DEFERRED, spec-kit PATTERN_ONLY, ECC PATTERN_ONLY/PILOT_WINDOWS, BMAD ALTERNATIVE_WORKFLOW); promptfoo DEFERRED_QUALIFICATION_TOOL; added OpenCode and Paseo runtimes; fixed sylph/vercel license column; removed unmeasured RAM/cost claims; pinned gsd-core and all runtime/USE/DROP/security rows; superpowers adapter constraints recorded.
