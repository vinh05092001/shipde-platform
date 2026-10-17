# A. 88-repo comparison (inventory 2026-10-04, code eaa569f)

Status mapping: INSTALLED/ADOPTED/INTEGRATED -> INTEGRATED (tool in use, not brain code); ADOPT_PATTERN/EXTRACT/PENDING/WATCH/DEFERRED -> AUDIT_ONLY unless the brain code proves the pattern (see group table); PILOT -> POC_ONLY; REJECT -> REJECTED.

| repo | pinned | license | WS2 decision | status | group | runtime | daemon | idle MB |
|---|---|---|---|---|---|---|---|---|
| agentgateway/agentgateway | dd7a4b32d352 | Apache-2.0 | ADOPT_PATTERN | AUDIT_ONLY | source onboarding/gateway | rust | no | 35 |
| anchore/syft | unpinned | Apache-2.0 | WATCH | AUDIT_ONLY | review/qualification/security | native | no |  |
| anthropic-ai/claude-code | unpinned | none | INSTALLED | INTEGRATED | toolchain/app stack | node | no |  |
| aquasecurity/trivy | unpinned | Apache-2.0 | PENDING | AUDIT_ONLY | review/qualification/security | native | no |  |
| ast-grep/ast-grep | unpinned | MIT | WATCH | AUDIT_ONLY | context/token | native | no |  |
| automazeio/ccpm | 7d7e4623bc6d | MIT | REJECT | REJECTED | orchestration/handoff | native | no |  |
| berriai/litellm | 9dda4d895f16 | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | source onboarding/gateway | python | no | 150 |
| bostonvex/claude-codex-orchestrator | 7f8ad4defbcc4e6864a2aee744407854b44d7da5 | none | ADOPT_PATTERN | AUDIT_ONLY | orchestration/handoff | node | no |  |
| chromedevtools/chrome-devtools-mcp | unpinned | Apache-2.0 | ADOPTED | INTEGRATED | UI/test | node | no |  |
| cli/cli | unpinned | MIT | INSTALLED | INTEGRATED | toolchain/app stack | native | no |  |
| cline/cline | 9fe17595de3b0c980d6c8291f7c42bf0b8cc94a3 | Apache-2.0 | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | toolchain/app stack | node | yes | 100 |
| daytonaio/daytona | ec4c21b2d597 | Apache-2.0 | REJECT | REJECTED | orchestration/handoff | native | no |  |
| decolua/9router | unpinned | MIT | INSTALLED | INTEGRATED | source onboarding/gateway | node | yes |  |
| deepseek-ai/deepseek-harness | unpinned | MIT | INSTALLED | INTEGRATED | toolchain/app stack | python | no |  |
| dequelabs/axe-core | unpinned | MPL-2.0 | PENDING | AUDIT_ONLY | UI/test | node | no |  |
| dicklesworthstone/ntm | fe4cff595073 | MIT | REJECT | REJECTED | orchestration/handoff | native | yes | 50 |
| docker/compose | unpinned | Apache-2.0 | INSTALLED | INTEGRATED | toolchain/app stack | native | no |  |
| e2b-dev/e2b | 03887ad7813a | Apache-2.0 | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | recovery/retry | node | no | 50 |
| eslint/eslint | unpinned | MIT | INSTALLED | INTEGRATED | toolchain/app stack | node | no |  |
| evilmartians/lefthook | unpinned | MIT | ADOPTED | INTEGRATED | toolchain/app stack | native | no |  |
| fission-ai/openspec | unpinned | MIT | PENDING | AUDIT_ONLY | role/prompt/spec | node | no |  |
| forwardemail/supertest | unpinned | MIT | DEFERRED | AUDIT_ONLY | toolchain/app stack | node | no |  |
| gastownhall/beads | unpinned | MIT | PENDING | AUDIT_ONLY | orchestration/handoff | native | no |  |
| generalaction/emdash | b179913b8c80 | Apache-2.0 | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | orchestration/handoff | node | no | 50 |
| getnao/sylph | unpinned | MIT | PENDING | AUDIT_ONLY | toolchain/app stack | node | no |  |
| git-for-windows/git | unpinned | GPL-2.0 | INSTALLED | INTEGRATED | toolchain/app stack | native | no |  |
| github/spec-kit | unpinned | MIT | PENDING | AUDIT_ONLY | role/prompt/spec | ruby | no |  |
| gitleaks/gitleaks | unpinned | MIT | ADOPTED | INTEGRATED | review/qualification/security | native | no |  |
| google-gemini/gemini-cli | unpinned | Apache-2.0 | INSTALLED | INTEGRATED | toolchain/app stack | node | no |  |
| google/antigravity | unpinned | none | INSTALLED | INTEGRATED | toolchain/app stack | python | no |  |
| googlechrome/lighthouse-ci | unpinned | Apache-2.0 | PENDING | AUDIT_ONLY | UI/test | node | no |  |
| grafana/k6 | unpinned | AGPL-3.0 | WATCH | AUDIT_ONLY | toolchain/app stack | native | no |  |
| i-trytoohard/codex-startup-factory | 6e40df70f8ebd9d425243d9032abe0136b30bcd1 | MIT | ADOPT_PATTERN | AUDIT_ONLY | orchestration/handoff | node | yes |  |
| langchain-ai/deepagents | 5a21fbc597e9 | MIT | REJECT | REJECTED | orchestration/handoff | python | no | 80 |
| langchain-ai/langgraph | f5804a5bf583 | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | recovery/retry | python | no | 75 |
| langchain-ai/langgraph-supervisor-py | 88859b34017a | MIT | REJECT | REJECTED | orchestration/handoff | python | no |  |
| langchain-ai/open-swe | 9613f663bbff | MIT | ADOPT_PATTERN | AUDIT_ONLY | orchestration/handoff | python | no | 50 |
| manaflow-ai/cmux | unpinned | MIT | REJECT | REJECTED | orchestration/handoff | native | no |  |
| microsoft/agent-framework | e15c6dce2d10 | MIT | ADOPT_PATTERN | AUDIT_ONLY | orchestration/handoff | python | no | 60 |
| microsoft/llmlingua | unpinned | MIT | PILOT | POC_ONLY | context/token | python | no |  |
| microsoft/playwright | unpinned | Apache-2.0 | DEFERRED | AUDIT_ONLY | UI/test | node | no |  |
| microsoft/playwright-cli | unpinned | Apache-2.0 | ADOPTED | INTEGRATED | UI/test | node | no |  |
| microsoft/playwright-mcp | unpinned | Apache-2.0 | ADOPTED | INTEGRATED | UI/test | node | no |  |
| mswjs/msw | unpinned | MIT | ADOPTED | INTEGRATED | UI/test | node | no |  |
| mswjs/msw-storybook-addon | unpinned | MIT | DEFERRED | AUDIT_ONLY | UI/test | node | no |  |
| nestjs/nest | unpinned | MIT | DEFERRED | AUDIT_ONLY | toolchain/app stack | node | no |  |
| nock/nock | unpinned | MIT | WATCH | AUDIT_ONLY | toolchain/app stack | node | no |  |
| nodejs/node | unpinned | MIT | INSTALLED | INTEGRATED | toolchain/app stack | native | no |  |
| nousresearch/hermes-agent | unpinned | MIT | PENDING | AUDIT_ONLY | orchestration/handoff | python | no |  |
| nvidia/openshell | 2935e9731b97e89ae78aa7bc66867bc2281444ef | Apache-2.0 | REJECT | REJECTED | isolation | rust | yes | 1024 |
| open-policy-agent/opa | unpinned | Apache-2.0 | WATCH | AUDIT_ONLY | review/qualification/security | native | no |  |
| open-telemetry/opentelemetry-js | unpinned | Apache-2.0 | ADOPTED | INTEGRATED | toolchain/app stack | node | no |  |
| openai/codex | unpinned | none | INSTALLED | INTEGRATED | toolchain/app stack | node | no |  |
| openai/openai-agents-python | 28e9f4fca26d | MIT | ADOPT_PATTERN | AUDIT_ONLY | orchestration/handoff | python | no | 60 |
| openapi-ts/openapi-typescript | unpinned | MIT | ADOPTED | INTEGRATED | toolchain/app stack | node | no |  |
| openhands/openhands | 29b0281bf085 | MIT | ADOPT_PATTERN | AUDIT_ONLY | orchestration/handoff | python | yes | 300 |
| openhands/software-agent-sdk | d0f9500590c1 | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | review/qualification/security | python | no | 45 |
| oraios/serena | unpinned | MIT | PENDING | AUDIT_ONLY | context/token | python | no |  |
| pact-foundation/pact-js | unpinned | MIT | PILOT | POC_ONLY | toolchain/app stack | node | no |  |
| pnpm/pnpm | unpinned | MIT | INSTALLED | INTEGRATED | toolchain/app stack | node | no |  |
| prettier/prettier | unpinned | MIT | INSTALLED | INTEGRATED | toolchain/app stack | node | no |  |
| prisma/orm | unpinned | Apache-2.0 | INSTALLED | INTEGRATED | toolchain/app stack | node | no |  |
| promptfoo/promptfoo | unpinned | MIT | ADOPTED | INTEGRATED | review/qualification/security | node | no |  |
| raine/workmux | 761ad3bfe3c9 | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | recovery/retry | native | no | 25 |
| renovatebot/renovate | unpinned | AGPL-3.0 | ADOPTED | INTEGRATED | toolchain/app stack | node | no |  |
| ruvnet/ruflo | a3dee4ff8b7c | MIT | ADOPT_PATTERN | AUDIT_ONLY | recovery/retry | node | no | 120 |
| semgrep/semgrep | unpinned | LGPL-2.1 | PILOT | POC_ONLY | review/qualification/security | native | no |  |
| shopify/toxiproxy | unpinned | MIT | PILOT | POC_ONLY | toolchain/app stack | native | no |  |
| smtg-ai/claude-squad | ce1ffb4392b0 | AGPL-3.0 | REJECT | REJECTED | orchestration/handoff | native | no | 40 |
| snyk/agent-scan | unpinned | Apache-2.0 | PENDING | AUDIT_ONLY | review/qualification/security | node | no |  |
| spectolabs/hoverfly | unpinned | Apache-2.0 | WATCH | AUDIT_ONLY | toolchain/app stack | native | no |  |
| stoplightio/prism | unpinned | Apache-2.0 | ADOPTED | INTEGRATED | toolchain/app stack | node | no |  |
| storybookjs/addon-a11y | unpinned | MIT | DEFERRED | AUDIT_ONLY | UI/test | node | no |  |
| storybookjs/storybook | unpinned | MIT | PENDING | AUDIT_ONLY | UI/test | node | no |  |
| swe-agent/swe-agent | 3ea751c087f3 | MIT | REJECT | REJECTED | review/qualification/security | python | no | 40 |
| swe-agent/swe-rex | 5c995c365dfb1fd5bc56fda688be5d8538f9931f | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | recovery/retry | python | no | 35 |
| taskforcesh/bullmq | unpinned | MIT | DEFERRED | AUDIT_ONLY | toolchain/app stack | node | no |  |
| temporalio/sdk-typescript | c973304f77a4 | MIT | EXTRACT_SMALL_COMPONENT | AUDIT_ONLY | recovery/retry | node | no | 80 |
| thanglequoc/vietnamese-provinces-database | unpinned | MIT | PENDING | AUDIT_ONLY | toolchain/app stack | data | no |  |
| untrivial-ai/agent-orchestrator | unpinned | MIT | INSTALLED | INTEGRATED | orchestration/handoff | node | yes |  |
| upstash/context7 | unpinned | MIT | ADOPTED | INTEGRATED | context/token | node | no |  |
| vercel-labs/agent-skills | e74b3d8 | Apache-2.0 | PENDING | AUDIT_ONLY | role/prompt/spec | node | no |  |
| vercel/turborepo | unpinned | MPL-2.0 | INSTALLED | INTEGRATED | toolchain/app stack | native | no |  |
| vinh05092001/shipde-brain | 711954f9b7ceba86e890001fce97786536ac02d4 | none | PENDING | AUDIT_ONLY | orchestration/handoff | node | no |  |
| vinh05092001/shipde-platform | 09d9848a2e447829510dd65354e114a305e604c2 | none | INTEGRATED | INTEGRATED | toolchain/app stack | node | no |  |
| vitest-dev/vitest | unpinned | MIT | DEFERRED | AUDIT_ONLY | toolchain/app stack | node | no |  |
| xiufengsun/tokentracker | unpinned | MIT | PENDING | AUDIT_ONLY | context/token | node | no |  |
| yamadashy/repomix | unpinned | MIT | ADOPTED | INTEGRATED | context/token | node | no |  |
