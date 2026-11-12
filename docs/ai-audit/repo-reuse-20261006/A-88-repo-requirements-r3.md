# A. 88 repos against operator requirements (r3, 2026-10-06, read-only)

Requirement keys: PLAN planner, ORCH orchestration/delegation, MEM shared memory/handoff, ROLE role/prompt, CTX context/token, SKILL skills, UI UI-by-spec, REVIEW code-test-review-repair, ONBOARD source onboarding, QUAL model qualification, RECOVER recovery, RES resource, PUBLISH publisher, ISO isolation. "-" = toolchain/app stack with no AI-workflow requirement.

Evidence level: WS2_FILE (file:symbol audited 2026-10-04), READ_TODAY (README/tree/code read 2026-10-06), INVENTORY (inventory metadata only).

Status: RUNTIME_INTEGRATED needs call site + config + execution evidence; INSTALLED = binary present on this machine (checked 2026-10-06); otherwise AUDIT_ONLY / POC_ONLY / PATTERN_APPLIED / REJECTED.

| repo | pinned | license | WS2 decision | status r3 | requirements | evidence level |
|---|---|---|---|---|---|---|
| agentgateway/agentgateway | dd7a4b32d352 | Apache-2.0 | ADOPT_PATTERN | AUDIT_ONLY | ONBOARD | WS2_FILE |
| anchore/syft | unpinned | Apache-2.0 | WATCH | AUDIT_ONLY | REVIEW | INVENTORY |
| anthropic-ai/claude-code | unpinned | none | INSTALLED | INSTALLED | - | INVENTORY |
| aquasecurity/trivy | unpinned | Apache-2.0 | PENDING | AUDIT_ONLY | REVIEW | INVENTORY |
| ast-grep/ast-grep | unpinned | MIT | WATCH | AUDIT_ONLY | CTX REVIEW | INVENTORY |
| automazeio/ccpm | 7d7e4623bc6d | MIT | REJECT | REJECTED | PLAN ORCH | WS2_FILE |
| berriai/litellm | 9dda4d895f16 | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | ONBOARD RECOVER | WS2_FILE |
| bostonvex/claude-codex-orchestrator | 7f8ad4defbcc4e6864a2aee744407854b44d7da5 | none | ADOPT_PATTERN | AUDIT_ONLY | ORCH | READ_TODAY |
| chromedevtools/chrome-devtools-mcp | unpinned | Apache-2.0 | ADOPTED | AUDIT_ONLY | UI | INVENTORY |
| cli/cli | unpinned | MIT | INSTALLED | RUNTIME_INTEGRATED | PUBLISH | INVENTORY |
| cline/cline | 9fe17595de3b0c980d6c8291f7c42bf0b8cc94a3 | Apache-2.0 | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | RECOVER ORCH | WS2_FILE |
| daytonaio/daytona | ec4c21b2d597 | Apache-2.0 | REJECT | REJECTED | ISO | INVENTORY |
| decolua/9router | unpinned | MIT | INSTALLED | RUNTIME_INTEGRATED | ONBOARD ORCH | INVENTORY |
| deepseek-ai/deepseek-harness | unpinned | MIT | INSTALLED | INSTALLED | ORCH (harness) | READ_TODAY |
| dequelabs/axe-core | unpinned | MPL-2.0 | PENDING | AUDIT_ONLY | UI | INVENTORY |
| dicklesworthstone/ntm | fe4cff595073 | MIT | REJECT | REJECTED | RES ORCH | WS2_FILE |
| docker/compose | unpinned | Apache-2.0 | INSTALLED | INSTALLED | - | INVENTORY |
| e2b-dev/e2b | 03887ad7813a | Apache-2.0 | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | RECOVER ISO | WS2_FILE |
| eslint/eslint | unpinned | MIT | INSTALLED | INSTALLED | - | INVENTORY |
| evilmartians/lefthook | unpinned | MIT | ADOPTED | INSTALLED | - | INVENTORY |
| fission-ai/openspec | unpinned | MIT | PENDING | AUDIT_ONLY | PLAN ROLE | READ_TODAY |
| forwardemail/supertest | unpinned | MIT | DEFERRED | AUDIT_ONLY | - | INVENTORY |
| gastownhall/beads | unpinned | MIT | PENDING | AUDIT_ONLY | MEM PLAN | READ_TODAY |
| generalaction/emdash | b179913b8c80 | Apache-2.0 | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | ISO ORCH | WS2_FILE |
| getnao/sylph | unpinned | MIT | PENDING | AUDIT_ONLY | MEM SKILL | READ_TODAY |
| git-for-windows/git | unpinned | GPL-2.0 | INSTALLED | INSTALLED | - | INVENTORY |
| github/spec-kit | unpinned | MIT | PENDING | AUDIT_ONLY | PLAN ROLE | READ_TODAY |
| gitleaks/gitleaks | unpinned | MIT | ADOPTED | INSTALLED | REVIEW | INVENTORY |
| google-gemini/gemini-cli | unpinned | Apache-2.0 | INSTALLED | INSTALLED | - | INVENTORY |
| google/antigravity | unpinned | none | INSTALLED | INSTALLED | - | INVENTORY |
| googlechrome/lighthouse-ci | unpinned | Apache-2.0 | PENDING | AUDIT_ONLY | UI | INVENTORY |
| grafana/k6 | unpinned | AGPL-3.0 | WATCH | AUDIT_ONLY | - | INVENTORY |
| i-trytoohard/codex-startup-factory | 6e40df70f8ebd9d425243d9032abe0136b30bcd1 | MIT | ADOPT_PATTERN | AUDIT_ONLY | PLAN ORCH REVIEW (fork of ComposioHQ/agent-orchestrator) | READ_TODAY |
| langchain-ai/deepagents | 5a21fbc597e9 | MIT | REJECT | REJECTED | ORCH | WS2_FILE |
| langchain-ai/langgraph | f5804a5bf583 | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | RECOVER | WS2_FILE |
| langchain-ai/langgraph-supervisor-py | 88859b34017a | MIT | REJECT | REJECTED | ORCH | INVENTORY |
| langchain-ai/open-swe | 9613f663bbff | MIT | ADOPT_PATTERN | AUDIT_ONLY | REVIEW | WS2_FILE |
| manaflow-ai/cmux | unpinned | MIT | REJECT | REJECTED | ORCH | INVENTORY |
| microsoft/agent-framework | e15c6dce2d10 | MIT | ADOPT_PATTERN | AUDIT_ONLY | ORCH RECOVER | WS2_FILE |
| microsoft/llmlingua | unpinned | MIT | PILOT | POC_ONLY | CTX | READ_TODAY |
| microsoft/playwright | unpinned | Apache-2.0 | DEFERRED | AUDIT_ONLY | UI REVIEW | INVENTORY |
| microsoft/playwright-cli | unpinned | Apache-2.0 | ADOPTED | AUDIT_ONLY | UI | INVENTORY |
| microsoft/playwright-mcp | unpinned | Apache-2.0 | ADOPTED | AUDIT_ONLY | UI | INVENTORY |
| mswjs/msw | unpinned | MIT | ADOPTED | AUDIT_ONLY | - | INVENTORY |
| mswjs/msw-storybook-addon | unpinned | MIT | DEFERRED | AUDIT_ONLY | - | INVENTORY |
| nestjs/nest | unpinned | MIT | DEFERRED | AUDIT_ONLY | - | INVENTORY |
| nock/nock | unpinned | MIT | WATCH | AUDIT_ONLY | - | INVENTORY |
| nodejs/node | unpinned | MIT | INSTALLED | INSTALLED | - | INVENTORY |
| nousresearch/hermes-agent | unpinned | MIT | PENDING | RUNTIME_INTEGRATED | PLAN ORCH MEM CTX SKILL RECOVER RES ONBOARD | READ_TODAY |
| nvidia/openshell | 2935e9731b97e89ae78aa7bc66867bc2281444ef | Apache-2.0 | REJECT | REJECTED | ISO | WS2_FILE |
| open-policy-agent/opa | unpinned | Apache-2.0 | WATCH | AUDIT_ONLY | ROLE (policy) | INVENTORY |
| open-telemetry/opentelemetry-js | unpinned | Apache-2.0 | ADOPTED | AUDIT_ONLY | RES (telemetry) | INVENTORY |
| openai/codex | unpinned | none | INSTALLED | INSTALLED | - | INVENTORY |
| openai/openai-agents-python | 28e9f4fca26d | MIT | ADOPT_PATTERN | AUDIT_ONLY | ORCH ROLE | WS2_FILE |
| openapi-ts/openapi-typescript | unpinned | MIT | ADOPTED | AUDIT_ONLY | - | INVENTORY |
| openhands/openhands | 29b0281bf085 | MIT | ADOPT_PATTERN | AUDIT_ONLY | ORCH CTX | WS2_FILE |
| openhands/software-agent-sdk | d0f9500590c1 | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | ORCH MEM CTX SKILL REVIEW | WS2_FILE |
| oraios/serena | unpinned | MIT | PENDING | POC_ONLY | CTX | READ_TODAY |
| pact-foundation/pact-js | unpinned | MIT | PILOT | POC_ONLY | - | INVENTORY |
| pnpm/pnpm | unpinned | MIT | INSTALLED | INSTALLED | - | INVENTORY |
| prettier/prettier | unpinned | MIT | INSTALLED | INSTALLED | - | INVENTORY |
| prisma/orm | unpinned | Apache-2.0 | INSTALLED | INSTALLED | - | INVENTORY |
| promptfoo/promptfoo | unpinned | MIT | ADOPTED | AUDIT_ONLY | QUAL | INVENTORY |
| raine/workmux | 761ad3bfe3c9 | MIT | EXTRACT_SMALL_COMPONENT | PATTERN_APPLIED | ISO ORCH | WS2_FILE |
| renovatebot/renovate | unpinned | AGPL-3.0 | ADOPTED | AUDIT_ONLY | - | INVENTORY |
| ruvnet/ruflo | a3dee4ff8b7c | MIT | ADOPT_PATTERN | AUDIT_ONLY | ORCH ISO | WS2_FILE |
| semgrep/semgrep | unpinned | LGPL-2.1 | PILOT | POC_ONLY | REVIEW | INVENTORY |
| shopify/toxiproxy | unpinned | MIT | PILOT | POC_ONLY | - | INVENTORY |
| smtg-ai/claude-squad | ce1ffb4392b0 | AGPL-3.0 | REJECT | REJECTED | ORCH | WS2_FILE |
| snyk/agent-scan | unpinned | Apache-2.0 | PENDING | AUDIT_ONLY | SKILL (security scan of skills/MCP) | READ_TODAY |
| spectolabs/hoverfly | unpinned | Apache-2.0 | WATCH | AUDIT_ONLY | - | INVENTORY |
| stoplightio/prism | unpinned | Apache-2.0 | ADOPTED | AUDIT_ONLY | - | INVENTORY |
| storybookjs/addon-a11y | unpinned | MIT | DEFERRED | AUDIT_ONLY | UI | INVENTORY |
| storybookjs/storybook | unpinned | MIT | PENDING | AUDIT_ONLY | UI | INVENTORY |
| swe-agent/swe-agent | 3ea751c087f3 | MIT | REJECT | REJECTED | REVIEW | INVENTORY |
| swe-agent/swe-rex | 5c995c365dfb1fd5bc56fda688be5d8538f9931f | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | RECOVER ISO | WS2_FILE |
| taskforcesh/bullmq | unpinned | MIT | DEFERRED | AUDIT_ONLY | ORCH (queue) | INVENTORY |
| temporalio/sdk-typescript | c973304f77a4 | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | RECOVER | WS2_FILE |
| thanglequoc/vietnamese-provinces-database | unpinned | MIT | PENDING | AUDIT_ONLY | - | INVENTORY |
| untrivial-ai/agent-orchestrator | unpinned | MIT | INSTALLED | AUDIT_ONLY | PLAN ORCH REVIEW | READ_TODAY |
| upstash/context7 | unpinned | MIT | ADOPTED | AUDIT_ONLY | CTX | INVENTORY |
| vercel-labs/agent-skills | e74b3d8 | Apache-2.0 | PENDING | AUDIT_ONLY | SKILL UI | READ_TODAY |
| vercel/turborepo | unpinned | MPL-2.0 | INSTALLED | INSTALLED | - | INVENTORY |
| vinh05092001/shipde-brain | 711954f9b7ceba86e890001fce97786536ac02d4 | none | PENDING | AUDIT_ONLY | MEM ROLE (lessons, prompts) | READ_TODAY |
| vinh05092001/shipde-platform | 09d9848a2e447829510dd65354e114a305e604c2 | none | INTEGRATED | RUNTIME_INTEGRATED | all (this repo) | INVENTORY |
| vitest-dev/vitest | unpinned | MIT | DEFERRED | AUDIT_ONLY | - | INVENTORY |
| xiufengsun/tokentracker | unpinned | MIT | PENDING | AUDIT_ONLY | CTX (token telemetry) | READ_TODAY |
| yamadashy/repomix | unpinned | MIT | ADOPTED | INSTALLED | CTX | INVENTORY |

## Candidates outside the inventory

| repo | pinned | license | requirements | status | evidence |
|---|---|---|---|---|---|
| rtk-ai/rtk | df39e33d7e59 | Apache-2.0 | CTX | AUDIT_ONLY | README |
| anthropics/skills | 683bc88e56f3 | Apache-2.0 per skill; docx/pdf/pptx/xlsx source-available | SKILL UI ROLE | AUDIT_ONLY | per-skill LICENSE |
| muratcankoylan/Agent-Skills-for-Context-Engineering | 58b55a892175 | MIT | CTX MEM SKILL | AUDIT_ONLY | tree |
| nextlevelbuilder/ui-ux-pro-max-skill | 477bcb28c981 | MIT | UI SKILL | AUDIT_ONLY | skill.json, LICENSE |
| ComposioHQ/agent-orchestrator (via fork) | not pinned | see fork (MIT) | PLAN ORCH REVIEW | MANUALLY_USED until 2026-09-17 (memory), not installed now | README of fork |

## Inventory corrections from the local check
- promptfoo: inventory ADOPTED; `promptfoo` is not on PATH.
- untrivial-ai/agent-orchestrator: inventory INSTALLED (node daemon); `ao` is not on PATH and upstream is now a Go desktop app. The AO used until 17/9 is most likely ComposioHQ/agent-orchestrator (`@aoagents/ao`), the base of i-trytoohard/codex-startup-factory.
- serena: no `serena` on PATH; the pilot ran through serena.js.
- hermes-agent: inventory PENDING, actually RUNTIME_INTEGRATED as a one-shot harness.
