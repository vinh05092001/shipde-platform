# Per-repo decisions (88 inventory + 11 named candidates), 2026-10-06

One decision per repo. KEEP_RUNTIME = already running for the AI workflow; USE = to integrate into the brain (measured before default-on); USE_AS_TOOL = app/dev toolchain or helper, not the brain; PATTERN_ONLY = copy an idea, no dependency; REPLACED_BY = covered by a chosen repo; DROP = no need, conflict, license or platform.

| repo | pinned | license | old WS2 | decision | reason |
|---|---|---|---|---|---|
| agentgateway/agentgateway | dd7a4b32d352 | Apache-2.0 | ADOPT_PATTERN | PATTERN_ONLY | model pricing catalogue schema for future cost data |
| anchore/syft | unpinned | Apache-2.0 | WATCH | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| anthropic-ai/claude-code | unpinned | none | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| aquasecurity/trivy | unpinned | Apache-2.0 | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| ast-grep/ast-grep | unpinned | MIT | WATCH | USE_AS_TOOL | structural search for reviewers (optional) |
| automazeio/ccpm | 7d7e4623bc6d | MIT | REJECT | REPLACED_BY:obra/superpowers | PM workflow via commands; superpowers covers plan/execute/review |
| berriai/litellm | 9dda4d895f16 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | retry budget by exception; no gateway swap (9router stays) |
| bostonvex/claude-codex-orchestrator | 7f8ad4defbcc4e6864a2aee744407854b44d7da5 | none | ADOPT_PATTERN | REPLACED_BY:obra/superpowers | issue-driven loop covered by superpowers + ShipDe loop |
| chromedevtools/chrome-devtools-mcp | unpinned | Apache-2.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| cli/cli | unpinned | MIT | INSTALLED | KEEP_RUNTIME | publisher gh calls |
| cline/cline | 9fe17595de3b0c980d6c8291f7c42bf0b8cc94a3 | Apache-2.0 | EXTRACT_SMALL_COMPONENT | DROP | atomic-file POC measured slower (REJECT); Cline stays only as a 9router upstream |
| daytonaio/daytona | ec4c21b2d597 | Apache-2.0 | REJECT | DROP | container sandbox; not Windows host isolation |
| decolua/9router | unpinned | MIT | INSTALLED | KEEP_RUNTIME | gateway for most sources; call site sources.js/isolation-launcher |
| deepseek-ai/deepseek-harness | unpinned | MIT | INSTALLED | DROP | developer preview harness; opencode/hermes already cover |
| dequelabs/axe-core | unpinned | MPL-2.0 | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| dicklesworthstone/ntm | fe4cff595073 | MIT | REJECT | DROP | tmux-based; not native on Windows |
| docker/compose | unpinned | Apache-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| e2b-dev/e2b | 03887ad7813a | Apache-2.0 | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | withRetry REPLAYABLE_OPERATIONS guard |
| eslint/eslint | unpinned | MIT | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| evilmartians/lefthook | unpinned | MIT | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| fission-ai/openspec | unpinned | MIT | PENDING | REPLACED_BY:obra/superpowers | planner; ShipDe already has specs/Work Items; revisit only if superpowers planning fails measurement |
| forwardemail/supertest | unpinned | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| gastownhall/beads | unpinned | MIT | PENDING | DROP (defer) | shared task memory; use superpowers plan files + ShipDe checkpoint first; revisit if handoff fails |
| generalaction/emdash | b179913b8c80 | Apache-2.0 | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | collision-proof worktree payload |
| getnao/sylph | unpinned | MIT | PENDING | DROP | no license |
| git-for-windows/git | unpinned | GPL-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| github/spec-kit | unpinned | MIT | PENDING | REPLACED_BY:obra/superpowers | same as openspec |
| gitleaks/gitleaks | unpinned | MIT | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| google-gemini/gemini-cli | unpinned | Apache-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| google/antigravity | unpinned | none | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| googlechrome/lighthouse-ci | unpinned | Apache-2.0 | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| grafana/k6 | unpinned | AGPL-3.0 | WATCH | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| i-trytoohard/codex-startup-factory | 6e40df70f8ebd9d425243d9032abe0136b30bcd1 | MIT | ADOPT_PATTERN | REPLACED_BY:obra/superpowers | AO fork; workflow covered by superpowers skills |
| langchain-ai/deepagents | 5a21fbc597e9 | MIT | REJECT | PATTERN_ONLY | planner/subagent pattern; Python LLM-graph, not CLI workers |
| langchain-ai/langgraph | f5804a5bf583 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | retry classifier default_retry_on: cross-check failure-classifier.js |
| langchain-ai/langgraph-supervisor-py | 88859b34017a | MIT | REJECT | PATTERN_ONLY | supervisor/handoff pattern |
| langchain-ai/open-swe | 9613f663bbff | MIT | ADOPT_PATTERN | PATTERN_ONLY | review-repair state machine (ShipDe already has one) |
| manaflow-ai/cmux | unpinned | MIT | REJECT | DROP | tmux-based |
| microsoft/agent-framework | e15c6dce2d10 | MIT | ADOPT_PATTERN | PATTERN_ONLY | ShellPolicy / revision-checked checkpoint ideas |
| microsoft/llmlingua | unpinned | MIT | PILOT | DROP | Python prompt compression; RTK cheaper |
| microsoft/playwright | unpinned | Apache-2.0 | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| microsoft/playwright-cli | unpinned | Apache-2.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| microsoft/playwright-mcp | unpinned | Apache-2.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| mswjs/msw | unpinned | MIT | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| mswjs/msw-storybook-addon | unpinned | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| nestjs/nest | unpinned | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| nock/nock | unpinned | MIT | WATCH | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| nodejs/node | unpinned | MIT | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| nousresearch/hermes-agent | unpinned | MIT | PENDING | KEEP_RUNTIME | one-shot harness (harness.js); kanban/delegate stay candidates for planner later |
| nvidia/openshell | 2935e9731b97e89ae78aa7bc66867bc2281444ef | Apache-2.0 | REJECT | DROP | Rust/k8s sandbox; Windows WorkerUser isolation stays |
| open-policy-agent/opa | unpinned | Apache-2.0 | WATCH | DROP | policy engine not needed; ShipDe gates are code |
| open-telemetry/opentelemetry-js | unpinned | Apache-2.0 | ADOPTED | USE_AS_TOOL | app observability (product), not brain |
| openai/codex | unpinned | none | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| openai/openai-agents-python | 28e9f4fca26d | MIT | ADOPT_PATTERN | PATTERN_ONLY | handoff schema + guardrails |
| openapi-ts/openapi-typescript | unpinned | MIT | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| openhands/openhands | 29b0281bf085 | MIT | ADOPT_PATTERN | DROP | full platform, daemon + Docker, ~300MB; overlaps Controller |
| openhands/software-agent-sdk | d0f9500590c1 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | risk levels / critic ideas; not adopted as runtime |
| oraios/serena | unpinned | MIT | PENDING | PATTERN_ONLY | POC exists (serena.js); not adopted until measured; RTK first |
| pact-foundation/pact-js | unpinned | MIT | PILOT | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| pnpm/pnpm | unpinned | MIT | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| prettier/prettier | unpinned | MIT | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| prisma/orm | unpinned | Apache-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| promptfoo/promptfoo | unpinned | MIT | ADOPTED | DROP | not installed; Work Item evidence replaces eval harness |
| raine/workmux | 761ad3bfe3c9 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | git env scrubbing already applied in publisher |
| renovatebot/renovate | unpinned | AGPL-3.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| ruvnet/ruflo | a3dee4ff8b7c | MIT | ADOPT_PATTERN | PATTERN_ONLY | safe-git wrapper idea; do not vendor |
| semgrep/semgrep | unpinned | LGPL-2.1 | PILOT | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| shopify/toxiproxy | unpinned | MIT | PILOT | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| smtg-ai/claude-squad | ce1ffb4392b0 | AGPL-3.0 | REJECT | DROP | tmux + AGPL |
| snyk/agent-scan | unpinned | Apache-2.0 | PENDING | USE_AS_TOOL | scan installed skills/MCP before enabling them (security gate for superpowers/impeccable) |
| spectolabs/hoverfly | unpinned | Apache-2.0 | WATCH | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| stoplightio/prism | unpinned | Apache-2.0 | ADOPTED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| storybookjs/addon-a11y | unpinned | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| storybookjs/storybook | unpinned | MIT | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| swe-agent/swe-agent | 3ea751c087f3 | MIT | REJECT | DROP | single-agent harness; no unmet need |
| swe-agent/swe-rex | 5c995c365dfb1fd5bc56fda688be5d8538f9931f | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | liveness _wait_until_alive (ShipDe supervisor has its own) |
| taskforcesh/bullmq | unpinned | MIT | DEFERRED | DROP | Redis queue; would be a second scheduler |
| temporalio/sdk-typescript | c973304f77a4 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_ONLY | RetryPolicy spec: cross-check failure-classifier.js cooldowns |
| thanglequoc/vietnamese-provinces-database | unpinned | MIT | PENDING | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| untrivial-ai/agent-orchestrator | unpinned | MIT | INSTALLED | REPLACED_BY:obra/superpowers + ShipDe Controller | AO broke 18/9, heavy daemon, own model choice |
| upstash/context7 | unpinned | MIT | ADOPTED | USE_AS_TOOL | library docs lookup for workers |
| vercel-labs/agent-skills | e74b3d8 | Apache-2.0 | PENDING | DROP | no license |
| vercel/turborepo | unpinned | MPL-2.0 | INSTALLED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| vinh05092001/shipde-brain | 711954f9b7ceba86e890001fce97786536ac02d4 | none | PENDING | KEEP (data) | lessons/prompts store; no runtime reader yet |
| vinh05092001/shipde-platform | 09d9848a2e447829510dd65354e114a305e604c2 | none | INTEGRATED | KEEP_RUNTIME | this repo |
| vitest-dev/vitest | unpinned | MIT | DEFERRED | USE_AS_TOOL | app/dev/CI toolchain or agent CLI; not part of the brain |
| xiufengsun/tokentracker | unpinned | MIT | PENDING | USE_AS_TOOL (measure) | token telemetry for the before/after measurements |
| yamadashy/repomix | unpinned | MIT | ADOPTED | USE_AS_TOOL | installed; repo packing for reviewers/analysts |

## Named candidates outside the inventory

| repo | pinned | license | decision | reason |
|---|---|---|---|---|
| obra/superpowers | 8ca22dba9a94 | MIT | USE | workflow skills: plan → subagent dev → review → repair; replaces ccpm/openspec/spec-kit/AO/startup-factory/claude-codex-orchestrator; no daemon |
| rtk-ai/rtk | df39e33d7e59 | Apache-2.0 | USE | shell-output compaction for low-risk worker runs; single binary; measure before default-on |
| pbakaus/impeccable | 4e8504f10106 | Apache-2.0 | USE | UI role skill + 60 detector rules; replaces ui-ux-pro-max/frontend-design; under screen spec |
| affaan-m/ECC | ef648e01899b | MIT | REPLACED_BY:obra/superpowers | overlaps; memory issues reported on Windows native; cherry-pick rules only if a gap appears |
| bmad-code-org/BMAD-METHOD | 8f2c13dd0e00 | MIT | REPLACED_BY:obra/superpowers | heavier methodology; one workflow only |
| open-gsd/gsd-core | n/a | MIT | DROP | own state + model selection conflicts with the Controller |
| mksglu/context-mode | e5fcca6802d4 | ELv2 (source-available) | DROP (fallback) | MCP + SQLite process, license; RTK first |
| earendil-works/pi | 9ad083102aa9 | MIT | DROP | harness only; opencode/hermes already |
| anthropics/skills | 683bc88e56f3 | Apache-2.0 per skill | REPLACED_BY:pbakaus/impeccable + obra/superpowers | skill-creator format only as reference |
| muratcankoylan/Agent-Skills-for-Context-Engineering | 58b55a892175 | MIT | PATTERN_ONLY | context patterns text |
| nextlevelbuilder/ui-ux-pro-max-skill | 477bcb28c981 | MIT | REPLACED_BY:pbakaus/impeccable | design checklist covered |

## Totals

- PATTERN_ONLY: 17
- USE_AS_TOOL: 44
- REPLACED_BY: 10
- KEEP_RUNTIME: 4
- DROP: 17
- DROP (defer): 1
- KEEP (data): 1
- USE_AS_TOOL (measure): 1
- USE: 3
- DROP (fallback): 1
