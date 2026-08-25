# Ship Dễ AI Toolchain Decisions

## Objective

Use the lowest-cost capable author without reducing business completeness, UI quality, security or evidence. GitHub artifacts are the shared memory; no agent framework may replace the approved product specification, Work Item or independent review.

## Adopted toolchain

| Tool or repository | Decision | Purpose | Boundary |
|---|---|---|---|
| Git, GitHub and Git worktrees | USE NOW | Isolated workspaces, durable handoff, CI and review | `main` is never an implementation workspace |
| Claude app | USE NOW | Business and solution analysis | No production implementation or self-approval |
| Codex app | USE NOW | Work Item planning, documentation and fresh independent review | Planning and review are separate tasks; no author self-review |
| Gemini app | USE NOW | Primary implementation for complete vertical and high-risk work | One prepared Work Item and branch at a time |
| [9Router](https://github.com/decolua/9router) | USE NOW | Local OpenAI-compatible gateway, free-model fallback and usage visibility | Localhost only; Ponytail and Caveman disabled |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | USE NOW, PIN | Controlled 9Router author workspace | Developer preview; keep `@deepseek-ai/dsh@0.1.1-rc.2` until an upgrade is tested |
| [Playwright](https://github.com/microsoft/playwright) | ADOPT IN `TASK-FOUND-04` | Browser E2E, trace/video evidence and screenshot comparison | Golden images require human-approved baselines |
| [Storybook](https://github.com/storybookjs/storybook) | ADOPT IN `TASK-FOUND-04` | Visible catalog of component states and interaction/accessibility checks | It documents approved UI; it does not invent the design |
| [axe-core](https://github.com/dequelabs/axe-core) | ADOPT IN `TASK-FOUND-04` | Automated accessibility checks in rendered UI | Automated checks supplement, not replace, manual UX review |

## Explicitly not adopted

| Tool family | Decision | Reason |
|---|---|---|
| Ponytail | REJECT | It biases toward minimal output and previously produced generic, incomplete Ship Dễ UI. Disable both repository and 9Router injection. |
| Caveman output mode | REJECT | Terse output removes reasoning and handoff evidence needed by a BA/product owner. |
| Headroom semantic compression | DEFER | Adds another local service and may alter context. Reconsider only after measured evaluation. |
| BMAD, Spec Kit, SuperClaude, Superpowers or another general orchestration framework | REJECT FOR NOW | Duplicates the approved specification, Work Item and role contract and can create conflicting instructions. |
| Generic dashboard/theme repositories | REJECT | Ship Dễ UI must come from approved screen states and design sources, not a transplanted AI theme. |
| Unreviewed DSH community plugins | REJECT BY DEFAULT | DSH plugins execute trusted code. Add only through a separate reviewed Work Item with source and permission audit. |

## 9Router endpoint policy

Use one local endpoint:

- Base URL: `http://127.0.0.1:20128/v1`
- DSH custom Provider ID: `9router`
- API protocol: `openai-completions`
- API key: enter through the DSH UI; never write it in this repository
- Request logging: OFF by default
- Ponytail: OFF
- Caveman: OFF
- Headroom: OFF
- RTK: ON only for low-risk implementation; turn it OFF when diagnosing logs, diffs or failed tests

DSH stores credentials outside the project and keeps only a credential reference in settings. The provider ID is permanent, so use exactly `9router`.

## Low-cost model route

Create a 9Router combo named `shipde-low-risk`. Select only model IDs currently returned by `GET /v1/models`, in this preference order when available:

1. `oc/deepseek-v4-flash-free`
2. `oc/mimo-v2.5-free`
3. `oc/nemotron-3-ultra-free`

Free catalogs change. The health check reports missing candidates; never silently substitute an unknown model. This combo is not permitted for architecture, authentication, authorization, tenancy, money, database ownership, carrier side effects or final UI decisions.

## Upgrade rule

Do not auto-upgrade 9Router, DSH or an agent plugin during an active Work Item. Record current versions, upgrade in a dedicated low-risk task, run the doctor, execute a disposable test branch and verify prompt injection settings before promoting the version.

## UI quality stack

`TASK-FOUND-04` must make these reviewable in one PR:

- Storybook stories for default, loading, empty, validation, error, forbidden, partial, success and recovery states where applicable;
- Playwright user journeys with trace and screenshots on failure;
- deterministic visual comparison for human-approved critical screens and desktop/mobile viewports;
- axe-based automated accessibility checks plus keyboard and responsive manual evidence;
- screenshots attached to the PR, not accepted as a substitute for working behavior.

