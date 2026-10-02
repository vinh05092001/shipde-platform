# Ship Dễ AI Toolchain Decisions

## Objective

Use the lowest-cost capable author without reducing business completeness, UI quality, security or evidence. GitHub artifacts are the shared memory; no agent framework may replace the approved product specification, Work Item or independent review.

The complete installation classification is maintained in `REPOSITORY-CLI-MANIFEST.md`. Only the Ship Dễ product repository is cloned; upstream projects are installed through their supported package, image, action or reviewed guidance mechanism.

## Adopted toolchain

| Tool or repository                                                                        | Decision                         | Purpose                                                                      | Boundary                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git, GitHub and Git worktrees                                                             | USE NOW                          | Isolated workspaces, durable handoff, CI and review                          | `main` is never an implementation workspace                                                                                                                                                                                                                   |
| Claude app and Claude Code                                                                | USE NOW                          | Business and solution analysis                                               | Interactive analysis stays in `shipde-claude`; unattended AO uses the governed 9Router launcher; no self-approval                                                                                                                                         |
| AgentRouter                                                                               | USE NOW                          | Claude Code-compatible provider and routing runtime                          | Keep upstream credentials outside Git; unattended AO routes via the localhost 9Router endpoint (port 20128) using `%USERPROFILE%\.claude-9router`, while direct AgentRouter access is reserved for the manual `%USERPROFILE%\.claude-orchestrator` diagnostic profile |
| Codex app and Codex CLI                                                                   | USE NOW                          | Work Item planning, documentation and fresh independent review               | Planning and review are separate tasks; no author self-review                                                                                                                                                                                                 |
| Gemini app, Antigravity CLI and [Gemini CLI](https://github.com/google-gemini/gemini-cli) | USE NOW                          | Primary implementation for complete vertical and high-risk work              | Prefer authenticated `agy`; `gemini` is the fallback; one prepared Work Item and branch at a time                                                                                                                                                             |
| [9Router](https://github.com/decolua/9router)                                             | USE NOW                          | Local OpenAI-compatible gateway, free-model fallback and usage visibility    | Localhost only; Ponytail and Caveman disabled                                                                                                                                                                                                                 |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)                       | USE NOW, PIN                     | Controlled 9Router author workspace                                          | Developer preview; keep `@deepseek-ai/dsh@0.1.1-rc.2` until an upgrade is tested                                                                                                                                                                              |
| pnpm 11 and Docker Desktop/Compose                                                        | INSTALL NOW                      | Prepare the Node 24 machine for the target monorepo and local infrastructure | Do not migrate the current npm prototype outside its Foundation Work Item                                                                                                                                                                                     |
| [Playwright](https://github.com/microsoft/playwright)                                     | ADOPT IN `TASK-FOUND-04`         | Browser E2E, trace/video evidence and screenshot comparison                  | Golden images require human-approved baselines                                                                                                                                                                                                                |
| [Storybook](https://github.com/storybookjs/storybook)                                     | ADOPT IN `TASK-FOUND-04`         | Visible catalog of component states and interaction/accessibility checks     | It documents approved UI; it does not invent the design                                                                                                                                                                                                       |
| [axe-core](https://github.com/dequelabs/axe-core)                                         | ADOPT IN `TASK-FOUND-04`         | Automated accessibility checks in rendered UI                                | Automated checks supplement, not replace, manual UX review                                                                                                                                                                                                    |
| [MSW](https://github.com/mswjs/msw)                                                       | ADOPT IN `TASK-FOUND-04`         | Deterministic API and carrier response states for UI/testing                 | Mock behavior is labeled and never presented as live production evidence                                                                                                                                                                                      |
| [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)                            | ADOPT IN `TASK-FOUND-04`         | Performance budgets for critical approved routes                             | Targeted CI only; do not consume every local iteration                                                                                                                                                                                                        |
| [Vercel agent skills](https://github.com/vercel-labs/agent-skills)                        | AUDIT AND PIN IN `TASK-FOUND-04` | React performance and UI review guidance                                     | Only `react-best-practices` and `web-design-guidelines`; Ship Dễ UX sources remain authoritative                                                                                                                                                              |

## External orchestration layer

[Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) is the control layer around the adopted ecosystem, not another adopted repository/provider. Ship Dễ pins the installed Windows runtime at `0.13.0` (raised from `0.12.12`, see AI-AO-PIN-2026-09-16), checks it with `ao status --json`, and starts it only through `scripts/ai/start-agent-orchestrator.ps1`. Its provenance is recorded in the top-level `orchestrator_runtime` object of `tools/ecosystem-manifest.json`, outside `adopted`.

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

AgentRouter provides Claude model access under two separate topologies:

1. **Manual direct profile (`%USERPROFILE%\.claude-orchestrator`):** Used directly by Claude Code for manual business and solution analysis. Its token is stored only in the user's credential environment and injected into the Claude process by an untracked local launcher. It connects directly to AgentRouter upstream without chaining through 9Router, and is not an implementation-author route. Its promotional balance is treated as temporary capacity rather than a permanent free entitlement. The repository stores no token, provider session or request log.
2. **Unattended routed topology (`%USERPROFILE%\.claude-9router`):** Used by unattended AO sessions. AO routes requests through the local 9Router endpoint at `http://localhost:20128/v1`, which manages provider fallback without manual token handling.

### Gateway routing record (TASK-AI-44)

Two gateways exist and they are not interchangeable. The name `AgentRouter` is reserved for the cloud endpoint; the local endpoint is `9Router`. The names in code follow this table.

| Gateway | Endpoint | Credential | Code names in this repository | Serves |
|---|---|---|---|---|
| AgentRouter (cloud) | `https://agentrouter.org/` (no `/v1`) | `AGENTROUTER_API_KEY`, User environment | `doctor.ps1` AgentRouter credential probe | Manual Claude Code business/solution analysis; the Claude and Codex fallback route |
| 9Router (local) | `http://localhost:20128/v1` | local token | `$script:NineRouterProfile`, `$script:NineRouterPort`, `Get-ShipDeNineRouterProfilePath`, `Assert-ShipDeNineRouterProfile`, `Assert-ShipDeNineRouterProfileBaseUrl`, `Test-ShipDeNineRouterEndpoint`, `Ensure-ShipDeNineRouterRuntime`, `Get-ShipDeNineRouterFailureSince` | Unattended AO sessions (`.claude-9router` profile), Gemini, dsh |

Fallback routing, as implemented:

- **Codex review fails** -> `Invoke-ShipDeClaudeReviewFallback` runs the host-authenticated native Claude Code CLI after clearing `ANTHROPIC_BASE_URL` and `CLAUDE_CONFIG_DIR`. It uses neither gateway; it spends the Claude subscription quota. The function was previously named after AgentRouter, which it never called.
- **An AO worker's provider fails** -> the local 9Router falls back across its configured upstreams; after every approved route is exhausted, TASK-AI-07 replaces the harness.
- **AgentRouter credential** -> reported available only after a live probe authenticates (`AI-44-R01`); a rejected key is a `doctor.ps1` failure, never "configured" (`AI-44-R02`). Only a 16-character SHA-256 prefix of the key is cached; the key itself is never written to a log, report or dashboard (`AI-44-R04`).

`scripts/ai/start-agent-orchestrator.ps1` still names its port parameter `-AgentRouterPort` while it addresses 9Router's port 20128; renaming that file is outside this Work Item's allowed paths (see the Work Item's Residual limitations).

### AO version pin raised to 0.13.0 (AI-AO-PIN-2026-09-16)

HUMAN-DECISION: operator approved AO 0.13.0 on 2026-09-16. The supervisor refused to start with `AO ProductVersion '0.13.0' does not match pinned version 0.12.12`; the operator chose raising the pin over reinstalling 0.12.12.

Compatibility verified on this host before the pin moved:

| Surface used by `control.ps1` | AO 0.13.0 result |
|---|---|
| `ao spawn --project --kind --name --branch --harness --prompt --mode` | every flag present in `ao spawn --help`; `agy`, `claude-code`, `codex`, `cline` remain valid harnesses |
| `ao session ls --project --json` | accepted; response keeps the `{ data, meta }` shape with `id`, `status`, `activity`, `isTerminated`, `harness`, `branch`, `prs` |
| `ao session get <id> --project --json` | accepted |
| `ao session kill <id> --project` | accepted |
| `ao review ls <session> --json` | accepted |
| `ao status --json` | accepted; returns `state: ready` |

Not verified: a live `ao spawn` end to end under 0.13.0. `ao version` on the daemon binary prints `dev`, so the desktop executable's ProductVersion remains the version source. Historical `0.12.12` references in TASK-AI-06/07 records and fixture comments describe what was observed then and are left unchanged.

## Low-cost model route

Create a 9Router combo named `shipde-low-risk`. Select only model IDs currently returned by `GET /v1/models`, in this preference order when available:

1. `oc/deepseek-v4-flash-free`
2. `oc/mimo-v2.5-free`
3. `oc/nemotron-3-ultra-free`

Free catalogs change. The health check reports missing candidates; never silently substitute an unknown model. This combo is not permitted for architecture, authentication, authorization, tenancy, money, database ownership, carrier side effects or final UI decisions.

## Upgrade rule

Do not auto-upgrade 9Router, DSH, Codex CLI, Gemini/Antigravity CLI, Claude Code or an agent plugin during an active Work Item. `install-clis.ps1` installs only missing tools. Record current versions, upgrade in a dedicated low-risk task, run the doctor, execute a disposable test branch and verify prompt injection settings before promoting the version.

## Codex CLI version dependency (TASK-AI-16)

Observed on 2026-09-14: `codex-cli 0.154.0`, installed as `@openai/codex@0.154.0`.
`tools/ecosystem-manifest.json` still pins `0.151.0`; reconciling that drift is a
human decision under the upgrade rule above and is deliberately not made here.

What this version accepts and refuses was established by probing each `-c`
override separately (`docs/product-spec/work-items/TASK-AI-16-FINDINGS.md`):

- All four hook overrides — `hooks.SessionStart`, `hooks.UserPromptSubmit`,
  `hooks.PermissionRequest`, `hooks.Stop` — are accepted. No hook needs to be
  dropped or reshaped.
- The `projects` override is refused when the path contains Windows
  backslashes: they are consumed as escape sequences, so the value reaches the
  parser as a string where a map was expected. The identical override with
  forward slashes is accepted.
- Doubling the backslashes is **accepted** when the argument reaches the CLI
  intact, and rejected when the same text is routed through `cmd.exe` /
  PowerShell quoting. The original probe took the second route, which is why it
  read the doubling result backwards. An escaping fix at the call site is
  therefore not ruled out by that evidence; the fix still belongs upstream
  because AO ships as a closed binary. Measured by
  `tools/ai-brain/acceptance/ac-16-03-codex-flag-refusal.js`.

The defect therefore sits in whatever builds Agent Orchestrator's command line,
not in the hook configuration and not in a CLI flag-surface change. AO ships as
a closed binary at `C:\Program Files\agent-orchestrator`, so the fix belongs
upstream; what this repository owns is an accurate diagnosis.

`doctor.ps1` carries two checks for this. The first probes the overrides
individually and names the one refused. The second reads the AO ledger at
`~/.ao/data/ao.db` and reports whether any Codex session has recorded activity,
because a flag that parses is not a hook that fired — a launch command exiting
zero proves neither. An unreadable ledger reports "cannot verify" and never a
pass.

## Ecosystem manifest reconciliation against reality (TASK-AI-17)

On 2026-09-14, the automated manifest audit (`node tools/ai-brain/cli.js manifest`)
evaluated all 37 declared adopted repositories in `tools/ecosystem-manifest.json`
against reality on the machine and in the monorepo workspace. The audit found:

- 37 repositories declared, 27 checkable, 19 present, 8 missing.
- 7 ERRORS `QUALITY_GATE_MISSING` as first reported: `lighthouse-ci`,
  `agent-scan`, `token-tracker`, `lefthook`, `gitleaks`, `axe-core`, `trivy`.
  Six of those were genuinely absent. The seventh, `gitleaks`, was a false
  positive and is treated separately below.
- 1 WARNING `DECLARED_ADOPTED_BUT_ABSENT`: `storybook` — declared `ADOPTED`,
  but absent from workspace dependencies.
- Pin drift: `codex-cli` pinned at `0.151.0` while `0.154.0` is installed.

Verdict: the manifest overclaimed reality. A quality gate believed to be running
when absent is worse than one openly missing, because the pipeline and operators
assume automated enforcement is active.

### `gitleaks` was never absent, and the check was wrong

The audit probes a `system` tool with `where` / `which` on the local host, which
cannot see a tool the CI runner provides. `gitleaks` is installed at the pinned
`8.24.0` by `.github/workflows/security-baseline.yml` and again by
`.github/workflows/current-application.yml`, and enforced as a blocking gate on
every Pull Request and push to `main`. It was running at the moment the audit
called it missing.

Downgrading it to `PENDING` would have documented a live blocking gate as
absent — understatement of exactly the kind this reconciliation exists to
prevent, running backwards. So the check was fixed instead of the record:
`gitleaks` stays `ADOPTED` / `BLOCKING_GATE` / `default_enabled: true` and moves
from `install_method: system` to `ci-provisioned`, a class the audit verifies
against the workflow that installs it. `TASK-AI-35` therefore evaluates
replacing a working gate with Betterleaks; it does not install a missing one.

### The seven that were genuinely absent

Under `AGENTS.md` and policy `AI-TOOL-10`, declared lifecycle states must match
machine truth; an agent may never flip flags to make an audit pass. The 7
genuinely absent entries — six failed gates plus `storybook` — are truthfully
downgraded from `ADOPTED` to `PENDING` with `default_enabled: false` and
`blocking_policy: "NON_BLOCKING"`, unblocking focused downstream Work Items:

1. `lefthook` (`PENDING` at this measurement; `ADOPTED` / `BLOCKING_GATE` since
   `TASK-AI-36`): absent from devDependencies. Downstream Work Item `TASK-AI-36`
   installs and configures Lefthook for pre-commit / pre-push hooks; see
   "Git hook manager: Lefthook (TASK-AI-36)" below.
2. `trivy` (`PENDING`): absent from system PATH. Downstream Work Item
   `TASK-AI-37` integrates Trivy container and dependency vulnerability scanning.
3. `axe-core` (`PENDING`): absent from devDependencies. Downstream Work Item
   `TASK-AI-38` integrates automated accessibility auditing via Playwright.
4. `lighthouse-ci` (`PENDING`): absent from devDependencies. Downstream Work Item
   `TASK-AI-38` configures performance budgets on critical routes.
5. `agent-scan` (`PENDING`): absent from python/pip tools. Downstream Work Item
   `TASK-AI-39` establishes security scanning for agent skills, prompts, and MCPs.
6. `token-tracker` (`PENDING`): absent from devDependencies; superseded by the
   internal token usage adapter in `tools/ai-brain` and `tools/ai-dashboard`
   (TASK-AI-15). Scheduled for formal manifest retirement in `TASK-AI-40`.
7. `storybook` (`PENDING`): absent from workspace. Maintained as `PENDING`
   until dedicated component documentation adoption in UI work items.

Codex CLI version drift:
The manifest entry for `codex-cli` now records `observed_version_or_commit: "0.154.0"`
and a descriptive version drift note. The manifest pin remains `0.151.0` pending a
deliberate human upgrade decision per the toolchain policy above.

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

The machine-readable source of truth is `tools/ecosystem-manifest.json`. The catalog comprises exactly **37 adopted repositories** (2 internal + 28 external baseline + 7 approved additions) alongside a distinct **14 product runtime/build dependencies** inventory:

### 1. Internal Repositories (2)

- `vinh05092001/shipde-platform`: Primary monorepo across 5 isolated worktrees.
- `vinh05092001/shipde-brain`: Agent brain, memory, prompts, and knowledge base.

### 2. External Baseline Repositories (28)

- Gateway & Execution: `decolua/9router`, `deepseek-ai/deepseek-harness`, `google-gemini/gemini-cli`, `google/antigravity`, `openai/codex`, `anthropic-ai/claude-code`, `microsoft/playwright-cli`, `cli/cli`, `docker/compose`.
- MCP & Diagnostic: `ChromeDevTools/chrome-devtools-mcp`.
- Testing & Quality Guidance: `vercel-labs/agent-skills`, `GoogleChrome/lighthouse-ci`, `storybookjs/storybook`, `mswjs/msw`, `openapi-ts/openapi-typescript`.
- Knowledge & Specification: `Fission-AI/OpenSpec`, `github/spec-kit`, `gastownhall/beads`, `getnao/sylph`, `upstash/context7`, `NousResearch/hermes-agent`.
- Security & Hygiene: `snyk/agent-scan`, `xiufengsun/TokenTracker`, `renovatebot/renovate`, `evilmartians/lefthook`.
- Development Toolkits: `oraios/serena`, `yamadashy/repomix`, `stoplightio/prism`.

### 3. Approved Additions (7)

- `gitleaks/gitleaks` (Secret scanning gate)
- `dequelabs/axe-core` (Accessibility audit engine)
- `microsoft/playwright-mcp` (Playwright MCP server)
- `promptfoo/promptfoo` (LLM & prompt evaluation harness)
- `aquasecurity/trivy` (Container & vulnerability scanner)
- `open-telemetry/opentelemetry-js` (Distributed tracing & observability)
- `thanglequoc/vietnamese-provinces-database` (Address normalization database)

### 4. Separate Product Runtime / Build Dependencies (14)

- Runtime & Package Management: `git-for-windows/git`, `nodejs/node`, `pnpm/pnpm`.
- Build & Quality Tooling: `eslint/eslint`, `prettier/prettier`, `vercel/turborepo`.
- Backend Stack: `nestjs/nest`, `prisma/prisma`, `taskforcesh/bullmq`.
- Test Suites: `vitest-dev/vitest`, `ladjs/supertest`, `microsoft/playwright` (Playwright Test).
- Storybook Ecosystem: `storybookjs/addon-a11y`, `mswjs/msw-storybook-addon`.

### Distinct Playwright Roles

Playwright capabilities are divided across three separate tools with strict role separation:

- **`microsoft/playwright` (Playwright Test)**: Pinned npm devDependency for running automated browser E2E test suites, visual regressions, and capturing traces/videos as PR acceptance evidence.
- **`microsoft/playwright-cli`**: Global CLI package designed for token-efficient agent command execution and targeted web inspection.
- **`microsoft/playwright-mcp`**: Model Context Protocol server enabling stateful interactive exploration and accessibility snapshot inspections by AI assistants.

Additionally, `ChromeDevTools/chrome-devtools-mcp` is reserved for deep Chrome DevTools Protocol (CDP) performance and network debugging. Both MCP servers remain stopped by default.

### Outbound Network & Credential Boundaries (Context7 & Snyk Agent Scan)

To prevent data exfiltration and ensure data isolation under `AI-TOOL-04`, `AI-TOOL-05`, and `AI-TOOL-11`, tools interacting with external networks are explicitly governed:

- **Context7 CLI (`upstash/context7`)**:
  - **Network Behavior**: Outbound HTTPS (`context7-api-outbound-https`) to `https://context7.com/api` for retrieving external library/framework documentation.
  - **Credentials**: Optional `CONTEXT7_API_KEY` for elevated rate limits; unauthenticated public doc search is supported.
  - **Data Sent**: Search query terms and target package/library names only. No proprietary codebase source code is sent.
  - **Telemetry**: Disabled by default. Local cached mode (`read-only-cache`) supported.
- **Snyk Agent Scan (`snyk/agent-scan`)**:
  - **Network Behavior**: Outbound HTTPS (`snyk-api-outbound-https`) to `https://api.snyk.io` and `https://app.snyk.io`.
  - **Credentials**: Requires `SNYK_TOKEN` for Snyk platform analysis and Evo reporting.
  - **Data Sent**: Scanned prompt text, skill definitions, and tool schemas evaluated against Snyk's policy database.
  - **Telemetry**: Bound by corporate Snyk CLI telemetry policy. Local rule evaluation requires token for catalog synchronization.

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

### Beads runs in shadow mode (TASK-AI-33)

`gastownhall/beads` is adopted for multi-agent coordination, but it does not own the dependency graph. `FEATURE-DELIVERY-REGISTER.csv` is the only authority for which Work Item waits on which.

- `node tools/ai-brain/cli.js shadow --project` writes a deterministic projection of the register's graph to a local store (default `.ai-local/shadow/dependency-graph.json`, untracked). `--compare` reports every `MISSING_IN_SHADOW` and `EXTRA_IN_SHADOW` edge by name and exits 1 on any divergence.
- Edges are parsed by the reconciler's own `parseDependencies`; there is no second parser.
- A shadow pass never writes the register. Each pass hashes the register's bytes before and after and fails if they differ. A divergence is fixed in the shadow or investigated in the register, never resolved by editing the register to match.
- The pass is local and offline. The upstream Beads binary is not installed, not required, and not exercised; a green comparison means a projection of the register agrees with the register, not that Beads does.

### Promotion gate for proposed memory (TASK-AI-22)

Under policy `AI-TOOL-06`, memory and skills remain untrusted until human-reviewed into `shipde-brain`. `TASK-AI-22` establishes the promotion gate:

- An agent may propose a lesson (`node tools/ai-brain/cli.js lesson propose`), writing `status: proposed`, `approved_by: null`, proposer identity, and 40-character `source_commit`.
- Only `node tools/ai-brain/cli.js lesson approve <id>` can write `status: approved`. It derives the approver from the operator's authenticated GitHub login (never declared input), strictly refuses self-approval (`SELF_APPROVAL`, `AI-22-R02`) and agent approval (`AGENT_APPROVAL`, `AI-22-R03`), re-validates against `lesson-schema.json`, and appends an immutable promotion record (`promotion-record.jsonl`).
- Reject (`status: rejected`, `approved_by: null`) and supersede (`status: superseded`, naming an existing approved replacement) follow the same gate and append-only record.

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

## Ecosystem Policies (`AI-TOOL-01` to `AI-TOOL-15`)

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
13. **AI-TOOL-13**: AO is a separately versioned external orchestration runtime with canonical source and health check; it is not counted in `adopted`.
14. **AI-TOOL-14**: TASK-AI-06 through TASK-AI-12 add no repositories or providers. Profile compilation resolves only governed manifest IDs and stops fail-closed when a required capability is absent.
15. **AI-TOOL-15**: The final unattended entrypoint is `control.ps1 -Action Resume`; `Supervise` remains a stage-specific recovery action until TASK-AI-12 completes convergence.

## Orchestrator Supervisor Policy (`AI-SUP-01` to `AI-SUP-21`)

The deterministic orchestrator supervisor (`scripts/ai/control.ps1 -Action Supervise`) automates routine Work Item processing while preserving human merge authority and fail-closed safety. It is a PowerShell state machine, not an LLM agent loop.

### Core principles

1. **AI-SUP-01**: The supervisor is a deterministic PowerShell loop, not an LLM agent.
2. **AI-SUP-02**: Only one Work Item is active at a time; parallel orchestration is not supported.
3. **AI-SUP-03**: The supervisor uses only supported public AO CLI commands; it does not modify AO internals.
4. **AI-SUP-04**: Implementation/test failures are NOT provider failures; they return to the author.
5. **AI-SUP-05**: Governed exact-HEAD auto-merge is authorized only through `TASK-AI-13` under `HUMAN-DECISION-ORCHESTRATOR-CORE-PRIORITY-2026-09-08` after `READY_FOR_HUMAN_MERGE` when strict single-snapshot preflight passes (exact 40-character commit OID, required GitHub Actions `SUCCESS` checks, trusted `chatgpt-codex-connector[bot]` `PASS` verdict, zero unresolved review threads, mergeable status, and `expectedHeadOid` squash mutation); human merge remains required for the bootstrap of TASK-AI-13 itself and whenever any preflight signal fails.

### 9Router-backed orchestration and lifecycle

6. **AI-SUP-06**: AO uses its own 9Router profile directory for unattended orchestration, `%USERPROFILE%\.claude-9router` by default (overridable with `-NineRouterProfilePath` or `SHIPDE_NINEROUTER_PROFILE`). The default is never the operator's native `%USERPROFILE%\.claude` Claude Code profile, which a self-test enforces; an explicit override remains an operator decision. The direct `.claude-orchestrator` profile is not used by unattended mode.
7. **AI-SUP-07**: 9Router owns Claude/provider quota fallback below AO; surfaced exhaustion means all approved routes failed and the supervisor stops fail-closed.
8. **AI-SUP-08**: Inactivity timeout is configurable (default 10 minutes).
9. **AI-SUP-09**: Maximum 1 nudge attempt per inactivity window before reporting stalled.
10. **AI-SUP-10**: The supervisor respects existing controller gates (CI must pass, Codex must approve).
11. **AI-SUP-11**: Starting `Supervise` repairs AO runtime drift by relaunching AO through 9Router before consuming a Work Item.
12. **AI-SUP-12**: Manual bootstrap review requires an exact PR number when more than one implementation PR is open.
13. **AI-SUP-13**: AO is an external control layer with pinned provenance and health check; it is never silently counted as an adopted repository/provider.
14. **AI-SUP-14**: Manual bootstrap review uses Codex's non-interactive custom-review contract with machine-readable schema output and parses that contract; stale output is deleted, and the local file never authorizes the supervisor gate.
15. **AI-SUP-15**: An open implementation PR belongs to the active Work Item only when both the Work Item ID and exact governed head branch match; zero, ambiguous, or wrong-branch matches fail closed.
16. **AI-SUP-16**: GitHub check attempts are grouped by name and provider identity; only the unambiguous newest attempt in each group participates, and required gates must come from GitHub Actions.
17. **AI-SUP-17**: An AO review trigger is checkpointed with its timestamp and must reach a supported terminal state within the configured bounded timeout.
18. **AI-SUP-18**: Bounded 9Router error records are diagnostic metadata after a terminal AO state. One failed request never proves that every fallback route was exhausted, and AO session DTO text is not treated as a provider transcript.
19. **AI-SUP-19**: Post-merge synchronization may recover Codex's exact-commit verdict from GitHub's durable Pull Request review collection when the AO session is no longer available.
20. **AI-SUP-20**: The governed launcher and controller prefer semantic build metadata from the live AO CLI matching the manifest pin; when AO reports `dev`, the observed ProductVersion from the canonical executable must match the manifest pin.
21. **AI-SUP-21**: Durable GitHub review evidence is accepted only from the exact allowlisted Codex GitHub App identity `chatgpt-codex-connector[bot]`; review-shaped text from any other author (including the repository owner or PR author) is untrusted. The one exception is the machine-authenticated fallback reviewer `TASK-AI-14` approved, whose verdict is recorded as `FALLBACK_PASS` rather than disguised as Codex, and which is admitted only on the terms `AI-19-R05` states: the reviewer is named in the evidence and the commit it read equals the evidence head. The exception exists because Codex is reachable only through a budget pool that can be exhausted, and a review gate that cannot be reached stops being a gate and becomes a stall; it does not extend to the repository owner or the PR author, who remain untrusted as reviewers of their own work.

### Provider and harness policy

Unattended AO sessions always use the dedicated 9Router profile directory (`%USERPROFILE%\.claude-9router` by default), whose `env.ANTHROPIC_BASE_URL` is the localhost 9Router endpoint (`http://localhost:20128/v1`). The operator's `%USERPROFILE%\.claude` profile stays natively authenticated Claude Code and must not carry that override, so the two profiles are split; the launcher and the supervisor both resolve the AO profile through `Get-ShipDeNineRouterProfilePath` and validate it through `Assert-ShipDeNineRouterProfileBaseUrl`, which fails closed with an actionable error naming the profile file when `settings.json`, its `env` block, or the base URL is missing or wrong. `Invoke-ShipDeClaudeReviewFallback` is deliberately outside this split: it keeps running under the native login with `ANTHROPIC_BASE_URL` cleared. The AO profile directory is local machine state created by the operator, never repository state, and no credential is copied into it from the native profile. The direct `%USERPROFILE%\.claude-orchestrator` profile is a separate manual profile reserved for explicit operator diagnosis, not the unattended path. Gemini implementation uses the supported `agy` harness; the unadvertised `gemini` AO harness is not attempted. Cross-harness replacement after 9Router exhausts every approved route belongs to TASK-AI-07 and must preserve the same Work Item, branch, and worktree. Consumer accounts are never aggregated or rotated to bypass provider limits; fallback uses approved providers and credentials within their terms.

### Transient failure classification

9Router handles transient provider failures internally. In accordance with AI-SUP-18, bounded 9Router error records are diagnostic metadata captured after a terminal AO state; one failed request never proves that every fallback route was exhausted. If a terminal provider failure or exhaustion reaches the supervisor, delivery stops fail-closed; implementation failures still return to the author:

| Classification            | Trigger failover | Return to author |
| ------------------------- | ---------------- | ---------------- |
| Quota exhausted           | Yes              | No               |
| Rate limited (429)        | Yes              | No               |
| Authentication error      | Yes (immediate)  | No               |
| Model unavailable         | Yes              | No               |
| Timeout (>30s)            | Yes              | No               |
| Non-zero exit (transient) | Yes              | No               |
| Lint/type/test failure    | No               | Yes              |
| Assertion failure         | No               | Yes              |
| User code exception       | No               | Yes              |

### TASK-AI-25 — qualifiedRoles feedback rule (2026-09-18)

`TASK-AI-25` records an author-attempt outcome per `accountId::model + role` and may narrow `qualifiedRoles` from measured evidence. The decision rule is the only place that rule lives, in `tools/ai-brain/acceptance/lib/role-feedback.js`. The three aggregates the rule may act on, and only those three, are:

1. **PASS rate** per merged item over the window (floor 0.5).
2. **Median retries** per merged item over the window (ceiling 3).
3. **Median tokens** per merged item over the window (ceiling 500 000).

A narrowing requires **two of three** breaches in the same window with at least the floor sample count. The rule never narrows on cost, quota percentage, grade, quality, or preference. The rule is narrowing-only: a removed role returns only through `TASK-AI-30` / `TASK-AI-31` re-qualification. Restoration through any other path, including a stale operator-declared entry, is forbidden — staleness is a read-time refusal (`EVIDENCE_STALE`), not a re-add trigger.

### TASK-AI-31 — Qualification gate grant rule (2026-09-18)

`TASK-AI-31` reads the probe result written by `TASK-AI-30` and grants `qualifiedRoles` into the account registry only when the probe outcome was `pass` and the result is within the grant cache window (4 hours). The grant rule lives in exactly one place: `tools/ai-brain/acceptance/lib/qualification-gate.js`, re-exported by reference from `tools/ai-brain/qualification-gate.js` — never copied.

Four properties make the gate safe:

1. **Grant is bounded** — the gate adds a role to `qualifiedRoles`; it never removes one (removal is `TASK-AI-25`'s narrowing rule).
2. **Grant requires source** — every written entry carries `{ roleId, grantedAt, source: 'qualification-gate', probeOutcome: 'pass' }` so the origin of every grant is auditable.
3. **Grant is field-constrained** — the gate writes only `qualifiedRoles` and `qualificationHistory`; it never writes grade, quality, preference, limits, tier, cost, capabilities, forbiddenDomains, or any credential.
4. **Grant is outcome-gated** — only `outcome: 'pass'` within the cache window grants; `fail`, `timeout`, `refused` and stale results never grant.

### TASK-AI-32 — Serena read-only code retrieval pilot (2026-09-20)

`TASK-AI-32` implements the read-only code retrieval pilot for `oraios/serena` under ecosystem profile `RESEARCH_ONLY` and permission boundary `ast-index-read`. The pilot provides authors (Gemini, Claude, 9Router) with symbol and reference lookup rather than loading whole files into context, evaluated against the `TokenPerMergedItem` efficiency metric.

The single-source pilot invariants live in `tools/ai-brain/acceptance/lib/serena-pilot.js` and `tools/ai-brain/serena.js`:

1. **Read-only invariant (`AI-32-R01`)**: Serena retrieval operations are strictly read-only. Any attempt to pass mutation or write flags (`write: true`, `mutate: true`, `--write`) throws or exits with `MUTATION_REFUSED`.
2. **Source of truth boundary (`AI-32-R02`)**: Serena is a code analysis assistant; output is implementation evidence, never business authority.
3. **TokenPerMergedItem efficiency (`AI-32-R03`)**: Symbol and reference retrieval is measured against full-file context ingestion, targeting prompt token reduction under `TOKENS_PER_MERGED_CEILING` (500,000 tokens from `TASK-AI-25`).
4. **Deterministic extraction (`AI-32-R04`)**: Symbol definitions report accurate line bounds (`startLine`, `endLine`), declarations, and code slices.
5. **Reference resolution (`AI-32-R05`)**: Resolves symbol usages across codebase files.
6. **Fail-closed on missing sources (`AI-32-R06`)**: Non-existent files or directories report `SOURCE_MISSING` and fail gracefully.


### Permission boundaries (TASK-AI-10+)

The supervisor operates with least-privilege permissions:

**Allowed (routine operations):**

- Read files and repository state
- Run lint, typecheck, test commands
- Create commits and push to feature branches
- Create and update Pull Requests
- Inspect CI status and review comments
- Send messages to AO sessions

**Explicitly denied:**

- Auto-merge any Pull Request
- Force-push or rewrite history
- Delete branches or worktrees destructively
- Bypass CI or review gates
- Broad unrestricted shell access
- Install, remove, or upgrade machine tools

## Git hook manager: Lefthook (TASK-AI-36)

Git hooks are the developer and agent front line for repository safety: they
refuse a commit when another live session already holds the branch (the
single-writer invariant, `AI-TOOL-03`) and when a credential has been staged
into the git index (`AI-36-R05`). Until this Work Item those hooks depended on
a hand-set `core.hooksPath = .githooks` override, which is a per-checkout
manual step that fails silently when it is skipped: a checkout with the path
set and no `pre-commit` in it commits unguarded, and a checkout with neither
has no hook at all.

The override is replaced with Lefthook (`evilmartians/lefthook`), pinned at
exact version `1.11.3` as a root devDependency, and configured in
version-controlled `lefthook.yml`:

- The `pre-commit` stage declares two commands, run sequentially.
  - `writer-claim` runs `node tools/ai-guard/cli.js check` — the same command
    the bespoke hook ran, so the guard behaviour is unchanged.
  - `staged-secret-scan` runs `node tools/ai-guard/cli.js staged-secrets`, which
    reads the git index (not the working tree) and evaluates `.gitleaks.toml`
    rules in Node.
- The authoritative secret barrier is unchanged: Gitleaks `8.24.0` remains a
  blocking CI gate provisioned by the GitHub Actions workflows. The staged
  scanner is local defence in depth, and it exists because on a clean Windows
  workstation `pnpm security:secrets` answers with operational exit code 2 when
  the Gitleaks binary is not on PATH — an answer a pre-commit hook cannot act
  on, since it distinguishes neither clean nor leaked.
- Installation is explicit, never implicit. Repository supply-chain policy
  forbids all four install lifecycle scripts (`preinstall`, `install`,
  `postinstall`, `prepare`) in the root and workspace manifests, so `pnpm
  install` never registers a hook. The `lefthook` npm package’s own
  `postinstall` runs `lefthook install -f`, which is exactly that forbidden
  behaviour, so its build script is denied in `pnpm-workspace.yaml`
  (`lefthook: false`); the binary is still resolved from the pinned
  `lefthook-windows-x64` optional dependency. Hook installation stays an
  explicit `pnpm lefthook install`, wired into
  `scripts/ai/bootstrap-worktrees.ps1`, with the pinned fallback
  `npx lefthook@1.11.3 install`. A bare `npx lefthook install` is forbidden
  under `AI-TOOL-11` because it would run whatever version the registry serves
  today.
- `scripts/ai/doctor.ps1` verifies that the binary resolves from the workspace
  pin, that the staged scanner answers, that the Lefthook `pre-commit` hook is
  installed in the repository’s git common dir, and that no `core.hooksPath`
  override is left in place to shadow it.
- A deliberate exception stays available and auditable: `git commit --no-verify`
  or `LEFTHOOK=0`. Lefthook does not tamper with Git’s own bypass flags
  (`AI-36-R07`).

`lefthook` moves from `PENDING` to `ADOPTED` / `BLOCKING_GATE` /
`default_enabled: true` in `tools/ecosystem-manifest.json` only because the
gating artifact landed in the same change: the exact `"lefthook": "1.11.3"` root
devDependency pin that the manifest audit probes as `dependency "lefthook"`
(`AI-36-R08`).
## Planner / executor split (TASK-AI-24)

- `tools/ai-brain/scheduler.js` (`planDispatch`) plans and never launches; it references no process-launching API (`AC-AI-24-06`).
- `tools/ai-brain/executor.js` (`executePlan`) is the only consumer of a plan and its only side effect is one `ao spawn` per `plan.assignments[]` entry, with the argument vector of `New-ShipDeAoSpawnArguments` in `scripts/ai/control.ps1` (`AC-AI-24-02`), passed as an array without a shell.
- Dry run is the default (`node tools/ai-brain/cli.js dispatch`); launching requires `--execute`. Deferred entries and alternatives are never launched, a second writer or an implementation beyond `plan.utilisation.maxImplementation` is refused, and any AO failure is `FAILED`, never `LAUNCHED`, with no in-call retry.
- A provider without a harness the controller already uses (`antigravity`/`gemini` → `agy`, `9router`/`anthropic`/`claude` → `claude-code`) is refused as `INCOMPLETE_ASSIGNMENT` rather than guessed.
- The controller keeps its own launch path; switching it to the executor is a separate Work Item.

## Concurrent implementation ceiling decision (TASK-AI-42)

- Under `AI-TOOL-03` and `AGENTS.md` ("Keep one active implementation Work Item until the workflow is proven stable"), the concurrent implementation ceiling is fixed at one (`1`) as a stability measure (`DEC-017`).
- Raising the implementation ceiling is a **governed decision, not an unvetted runtime setting**. An operator, caller, or runtime context cannot raise `maxImplementationAgents` via an arbitrary configuration knob.
- In `tools/ai-brain/scheduler.js` (`planDispatch`), `maxImplementationAgents` defaults to 1. Any attempt to request `maxImplementationAgents > 1` without an approved governed decision identifier (`DEC-*` or `HUMAN-DECISION-*`) is rejected and clamped to 1, preserving the `AI-TOOL-03` stability measure.
- The single-writer invariant (exactly one writer per Work Item / branch) remains absolute and non-configurable, holding permanently even when a governed decision raises concurrency across different Work Items.
- In `tools/ai-brain/executor.js` (`executePlan`), `maxImplementation` is read from `plan.utilisation.maxImplementation` (defaulting to 1) and enforces `IMPLEMENTATION_CEILING` on any attempt to exceed it.
