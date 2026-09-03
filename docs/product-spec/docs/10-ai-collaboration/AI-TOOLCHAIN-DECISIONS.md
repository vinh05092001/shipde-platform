# Ship Dễ AI Toolchain Decisions

## Objective

Use the lowest-cost capable author without reducing business completeness, UI quality, security or evidence. GitHub artifacts are the shared memory; no agent framework may replace the approved product specification, Work Item or independent review.

The complete installation classification is maintained in `REPOSITORY-CLI-MANIFEST.md`. Only the Ship Dễ product repository is cloned; upstream projects are installed through their supported package, image, action or reviewed guidance mechanism.

## Adopted toolchain

| Tool or repository                                                                        | Decision                         | Purpose                                                                      | Boundary                                                                                                    |
| ----------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Git, GitHub and Git worktrees                                                             | USE NOW                          | Isolated workspaces, durable handoff, CI and review                          | `main` is never an implementation workspace                                                                 |
| Claude app and Claude Code                                                                | USE NOW                          | Business and solution analysis                                               | Claude Code runs only in `shipde-claude` through AgentRouter; no production implementation or self-approval |
| AgentRouter                                                                               | USE NOW                          | Direct Claude Code-compatible provider with a user-owned promotional balance | Keep its token outside Git; do not route it through 9Router or assume promotional credit is permanent       |
| Codex app and Codex CLI                                                                   | USE NOW                          | Work Item planning, documentation and fresh independent review               | Planning and review are separate tasks; no author self-review                                               |
| Gemini app, Antigravity CLI and [Gemini CLI](https://github.com/google-gemini/gemini-cli) | USE NOW                          | Primary implementation for complete vertical and high-risk work              | Prefer authenticated `agy`; `gemini` is the fallback; one prepared Work Item and branch at a time           |
| [9Router](https://github.com/decolua/9router)                                             | USE NOW                          | Local OpenAI-compatible gateway, free-model fallback and usage visibility    | Localhost only; Ponytail and Caveman disabled                                                               |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)                       | USE NOW, PIN                     | Controlled 9Router author workspace                                          | Developer preview; keep `@deepseek-ai/dsh@0.1.1-rc.2` until an upgrade is tested                            |
| pnpm 11 and Docker Desktop/Compose                                                        | INSTALL NOW                      | Prepare the Node 24 machine for the target monorepo and local infrastructure | Do not migrate the current npm prototype outside its Foundation Work Item                                   |
| [Playwright](https://github.com/microsoft/playwright)                                     | ADOPT IN `TASK-FOUND-04`         | Browser E2E, trace/video evidence and screenshot comparison                  | Golden images require human-approved baselines                                                              |
| [Storybook](https://github.com/storybookjs/storybook)                                     | ADOPT IN `TASK-FOUND-04`         | Visible catalog of component states and interaction/accessibility checks     | It documents approved UI; it does not invent the design                                                     |
| [axe-core](https://github.com/dequelabs/axe-core)                                         | ADOPT IN `TASK-FOUND-04`         | Automated accessibility checks in rendered UI                                | Automated checks supplement, not replace, manual UX review                                                  |
| [MSW](https://github.com/mswjs/msw)                                                       | ADOPT IN `TASK-FOUND-04`         | Deterministic API and carrier response states for UI/testing                 | Mock behavior is labeled and never presented as live production evidence                                    |
| [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)                            | ADOPT IN `TASK-FOUND-04`         | Performance budgets for critical approved routes                             | Targeted CI only; do not consume every local iteration                                                      |
| [Vercel agent skills](https://github.com/vercel-labs/agent-skills)                        | AUDIT AND PIN IN `TASK-FOUND-04` | React performance and UI review guidance                                     | Only `react-best-practices` and `web-design-guidelines`; Ship Dễ UX sources remain authoritative            |

## Explicitly not adopted

| Tool family                                                                         | Decision          | Reason                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Ponytail                                                                            | REJECT            | It biases toward minimal output and previously produced generic, incomplete Ship Dễ UI. Disable both repository and 9Router injection. |
| Caveman output mode                                                                 | REJECT            | Terse output removes reasoning and handoff evidence needed by a BA/product owner.                                                      |
| Headroom semantic compression                                                       | DEFER             | Adds another local service and may alter context. Reconsider only after measured evaluation.                                           |
| BMAD, Spec Kit, SuperClaude, Superpowers or another general orchestration framework | REJECT FOR NOW    | Duplicates the approved specification, Work Item and role contract and can create conflicting instructions.                            |
| Generic dashboard/theme repositories                                                | REJECT            | Ship Dễ UI must come from approved screen states and design sources, not a transplanted AI theme.                                      |
| Unreviewed DSH or public agent-skill collections                                    | REJECT BY DEFAULT | Plugins and skills execute or inject trusted instructions. Add only through a reviewed, commit-pinned Work Item.                       |
| Global Nest, Prisma, Turbo, Playwright, Storybook or test CLIs                      | REJECT            | Project tools must be lockfile-pinned and invoked through root package scripts.                                                        |
| Native PostgreSQL, Redis or MinIO installation                                      | REJECT            | Docker Compose owns reproducible local services and avoids conflicting Windows services.                                               |
| WSL/Ubuntu as a baseline requirement                                                | REJECT            | The current Windows 10 Pro workflow is native; use WSL only if a future verified tool cannot operate safely without it.                |

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

## AgentRouter provider policy

AgentRouter is used directly by Claude Code for business and solution analysis. Its token is stored only in the user's credential environment and injected into the Claude process by an untracked local launcher. The repository stores no token, provider session or request log. AgentRouter is not chained through 9Router, is not an implementation-author route and its promotional balance is treated as temporary capacity rather than a permanent free entitlement.

## Low-cost model route

Create a 9Router combo named `shipde-low-risk`. Select only model IDs currently returned by `GET /v1/models`, in this preference order when available:

1. `oc/deepseek-v4-flash-free`
2. `oc/mimo-v2.5-free`
3. `oc/nemotron-3-ultra-free`

Free catalogs change. The health check reports missing candidates; never silently substitute an unknown model. This combo is not permitted for architecture, authentication, authorization, tenancy, money, database ownership, carrier side effects or final UI decisions.

## Upgrade rule

Do not auto-upgrade 9Router, DSH, Codex CLI, Gemini/Antigravity CLI, Claude Code or an agent plugin during an active Work Item. `install-clis.ps1` installs only missing tools. Record current versions, upgrade in a dedicated low-risk task, run the doctor, execute a disposable test branch and verify prompt injection settings before promoting the version.

## UI quality stack

`TASK-FOUND-04` must make these reviewable in one PR:

- Storybook stories for default, loading, empty, validation, error, forbidden, partial, success and recovery states where applicable;
- MSW handlers derived from approved contracts for each relevant response state;
- Playwright user journeys with trace and screenshots on failure;
- deterministic visual comparison for human-approved critical screens and desktop/mobile viewports;
- axe-based automated accessibility checks plus keyboard and responsive manual evidence;
- Lighthouse budgets for a small approved set of critical routes;
- audited, commit-pinned Vercel React and web-interface guidance shared by author and reviewer;
- screenshots attached to the PR, not accepted as a substitute for working behavior.

## Governed Ecosystem Catalog (37 Adopted Repositories)

The machine-readable source of truth is `tools/ecosystem-manifest.json`. The catalog spans 5 distinct governance layers:

1. **Workspaces (1)**: `shipde-platform` across 5 isolated worktrees.
2. **Machine-wide CLIs & Runtimes (14)**: `git`, `gh`, `node`, `pnpm`, `docker-compose`, `9router`, `deepseek-harness`, `gemini-cli`, `antigravity-cli`, `codex-cli`, `claude-code`, `playwright-cli`, `gitleaks`, `promptfoo`, `trivy`.
3. **Project Dependencies (16)**: `eslint`, `prettier`, `turborepo`, `nestjs`, `prisma`, `bullmq`, `vitest`, `supertest`, `playwright`, `storybook`, `storybook-addon-a11y`, `msw`, `msw-storybook-addon`, `openapi-typescript`, `lighthouse-ci`, `axe-core`, `opentelemetry-js`.
4. **Local Services & On-Demand MCPs (4)**: `chrome-devtools-mcp`, `playwright-mcp`, Docker Compose Postgres, Redis.
5. **Guidance & Curated Datasets (2)**: `vercel-agent-skills`, `vietnamese-provinces-database`.

### Distinct Playwright Roles

Playwright capabilities are divided across three separate tools with strict role separation:

- **`microsoft/playwright` (Playwright Test)**: Pinned npm devDependency for running automated browser E2E test suites, visual regressions, and capturing traces/videos as PR acceptance evidence.
- **`microsoft/playwright-cli`**: Global CLI package designed for token-efficient agent command execution and targeted web inspection.
- **`microsoft/playwright-mcp`**: Model Context Protocol server enabling stateful interactive exploration and accessibility snapshot inspections by AI assistants.

Additionally, `ChromeDevTools/chrome-devtools-mcp` is reserved for deep Chrome DevTools Protocol (CDP) performance and network debugging. Both MCP servers remain stopped by default.

## Evaluation Candidates (PILOT / WATCH)

Candidate technologies are inventoried in `tools/ecosystem-manifest.json` under `candidates`. They are never installed or enabled by default:

| Candidate ID | Name              | Role                     | Lifecycle | Evaluation Goal                                                                 |
| ------------ | ----------------- | ------------------------ | --------- | ------------------------------------------------------------------------------- |
| `pact-js`    | Pact JS           | Contract testing         | `PILOT`   | Multi-carrier adapter consumer-driven contract verification                     |
| `nock`       | Nock              | HTTP mocking             | `WATCH`   | Node.js backend integration test isolation comparison with MSW                  |
| `hoverfly`   | Hoverfly          | API virtualization       | `WATCH`   | Proxy-based carrier response capture for local integration testing              |
| `toxiproxy`  | Toxiproxy         | Network chaos simulation | `PILOT`   | Latency, timeout, and partition injection in carrier reconciliation loops       |
| `k6`         | k6                | Load testing             | `WATCH`   | High-volume batch statement upload and matching throughput benchmarks           |
| `semgrep`    | Semgrep           | AST pattern scanner      | `PILOT`   | Custom AST rules detecting cross-tenant data leaks and unauthenticated handlers |
| `syft`       | Syft              | SBOM generator           | `WATCH`   | Automated SPDX/CycloneDX SBOM artifact generation in GitHub Actions             |
| `ast-grep`   | ast-grep          | Structural code rewrite  | `WATCH`   | Structural refactoring across shared packages and Next.js applications          |
| `llmlingua`  | LLMLingua         | Prompt compression       | `PILOT`   | Prompt compression for lengthy Work Item specifications and logs                |
| `opa`        | Open Policy Agent | Policy engine            | `WATCH`   | Decoupled Rego policy enforcement for multi-tenant carrier access               |

## Activation Profiles

Tool usage is governed by 9 task-based activation profiles defined in `tools/ecosystem-profiles.json`:

- `FOUNDATION`: Monorepo structure, tooling baseline, shared packages, repository quality gates.
- `BACKEND_FEATURE`: API routes, background workers, database models, transactions, business rule services.
- `CARRIER_INTEGRATION`: Carrier connectors, tracking adapters, quote normalization, idempotent webhooks.
- `COD_AND_SETTLEMENT`: Three-ledger reconciliation, statement parsing, settlement batches, financial audit.
- `UI_FEATURE`: Next.js pages, accessible components, user journeys, responsive layouts, UI state flows.
- `SECURITY_REVIEW`: Secret scanning, vulnerability audit, AST patterns, dependency hygiene, tenant boundary checks.
- `RESEARCH_ONLY`: Read-only exploration, architecture analysis, documentation, specification research.
- `PR_REVIEW`: Independent Codex review, immutable HEAD verification, contract checks, quality gates.
- `NIGHTLY_MAINTENANCE`: Scheduled maintenance, dependency health, full secret scans, testkit assertions.

Profiles enforce concurrency limits (maximum 1 implementation author and 1 research agent concurrently; 1 writer per Work Item) and invoke automated post-task cleanup (`Stop-ShipDeOptionalServices`).

## Ecosystem Policies (`AI-TOOL-01` to `AI-TOOL-12`)

1. **AI-TOOL-01**: Installed does not imply integrated, enabled or blocking.
2. **AI-TOOL-02**: Optional services and MCP servers are stopped by default and after profile completion.
3. **AI-TOOL-03**: Only one implementation agent and one research agent may run concurrently; the same Work Item never has parallel writers.
4. **AI-TOOL-04**: 9Router is localhost-only, authenticated, request logging/cloud sync off, and never routes Codex review verdicts.
5. **AI-TOOL-05**: Skills/content are commit-pinned, admission-scanned and loaded only by task trigger; no blanket prompt injection.
6. **AI-TOOL-06**: Hermes memory and self-created skills are untrusted until human-reviewed into shipde-brain; no PII or credential persistence.
7. **AI-TOOL-07**: Playwright Test is acceptance evidence; Playwright CLI is token-efficient agent interaction; Playwright MCP is stateful exploration; Chrome DevTools MCP is deep runtime diagnosis.
8. **AI-TOOL-08**: MSW owns behavioral mocks and Prism owns schema validation. Neither silently becomes production carrier evidence.
9. **AI-TOOL-09**: Community Vietnamese address data is a versioned input, not legal or carrier source of truth; import requires provenance and validation.
10. **AI-TOOL-10**: A failed or partial installation reports exact state and rollback; it must not be recorded as installed or healthy.
11. **AI-TOOL-11**: A supplied authoritative version/ref/path is fail closed; no fallback to latest, another branch or a broader filesystem path.
12. **AI-TOOL-12**: GitHub merged state is reconciled by PR identity and merge SHA; repeated synchronization is a no-op and never rewrites unrelated rows.
