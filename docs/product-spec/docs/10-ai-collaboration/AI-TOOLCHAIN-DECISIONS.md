# Ship Dễ AI Toolchain Decisions

## Shared author pre-push check (TASK-AI-162)

Operator approved on 2026-11-02. Every writer lane (Gemini, Claude, 9Router and directly assigned Codex authors) runs `pnpm ai:check` before committing/pushing and pastes its summary in the PR. This local helper calls the existing CI gate scripts; **CI remains the authority**, and a local PASS is not independent review or permission to merge.

The checker runs `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm security:secrets`, `git diff --check origin/main...HEAD`, then tests, sequentially and failing fast. It pins the existing incremental scripts' base to `origin/main`, including their existing working-tree checks. It does not fetch; keep that ref current before starting work. Missing dependencies, Git history or native Gitleaks fail the relevant gate.

For tests, pnpm's since filter selects workspaces changed from the merge-base of `origin/main` and `HEAD`, plus their dependents. Before narrowing tests, the checker verifies that these workspace directories cover every committed, staged and unstaged changed path, including deletions and both sides of renames. Root/shared changes, untracked files, an empty selection, incomplete metadata or unavailable filtering conservatively fall back to full `pnpm test`.

When Turbo's affected dry-run contains runnable tests for every selected workspace, the checker uses `turbo run test --affected` to preserve its build graph. Empty, non-runnable or incomplete task sets require full tests, as does a successful probe with missing or malformed output. Only valid JSON with an optional Turbo version banner is accepted; a failed Turbo process may use the already verified pnpm filter. A failing test command is a failure, never a fallback trigger. Lint, typecheck and secrets retain their existing scope. The whitespace command checks committed changes; authors should also check their staged diff before committing.

The summary has one PASS/FAIL line per executed gate followed by `PASS ai:check` or `FAIL ai:check`; failure exits nonzero. Child output and exception text are suppressed because any gate can print sensitive source or environment data. The failed gate's name identifies the command to diagnose locally; never paste raw secrets or environment values into PR evidence.

Local hook installation remains optional and explicit: after `pnpm install --frozen-lockfile`, run `pnpm lefthook install`. Installed pre-push hooks invoke the shared command by default. The supported exception is the explicit, hook-only variable `SHIPDE_SKIP_AI_CHECK=1`; record why the local hook was skipped in PR evidence and still run the author checklist. Direct `pnpm ai:check` ignores the skip variable. Existing pre-commit and no-hardcode hooks are unchanged. No CI workflow, gate configuration, allowlist, baseline or Semgrep rule is relaxed.

On PowerShell systems that block `.ps1` shims, use `pnpm.cmd` for the same commands. Offline regression tests: `node --test tools/ai-brain/test/task-ai-162-prepush-check.test.js` (also discovered by the existing `pnpm test:brain` command).

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
| [qodo-ai/pr-agent](https://github.com/qodo-ai/pr-agent)                                   | USE NOW (ADVISORY)               | Advisory first-pass PR reviewer                                              | Operator approved 2026-10-31; advisory pre-review to cut CHANGES_REQUIRED rounds; does not replace independent Codex review; configured via repository secrets PR_AGENT_API_BASE, PR_AGENT_API_KEY, PR_AGENT_MODEL                          |

## External orchestration layer

[Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) is the control layer around the adopted ecosystem, not another adopted repository/provider. Ship Dễ pins the installed Windows runtime at `0.13.0` (raised from `0.12.12`, see AI-AO-PIN-2026-09-16), checks it with `ao status --json`, and starts it only through `scripts/ai/start-agent-orchestrator.ps1`. Its provenance is recorded in the top-level `orchestrator_runtime` object of `tools/ecosystem-manifest.json`, outside `adopted`.

## Explicitly not adopted

| Tool family                                                                         | Decision          | Reason                                                                                                                                 |
| ----------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Ponytail                                                                            | REJECT            | It biases toward minimal output and previously produced generic, incomplete Ship Dễ UI. Disable both repository and 9Router injection. |
| Caveman output mode                                                                 | REJECT            | Terse output removes reasoning and handoff evidence needed by a BA/product owner.                                                      |
| Headroom semantic compression                                                       | DEFER             | Adds another local service and may alter context. Reconsider only after measured evaluation.                                           |
| BMAD, Spec Kit, SuperClaude, Superpowers or another general orchestration framework | REJECT FOR NOW    | Duplicates approved specification and role contracts; Spec Kit patterns adopted docs-only without tooling (TASK-AI-157).              |
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

Two gateways exist and they are not interchangeable. The names in code follow this table; `AgentRouter` names only the cloud endpoint.

| Gateway | Endpoint | Credential | Code names | Serves |
|---|---|---|---|---|
| AgentRouter (cloud) | `https://agentrouter.org/` (no `/v1`) | `AGENTROUTER_API_KEY`, User environment | `doctor.ps1` AgentRouter credential probe | Manual Claude Code business/solution analysis; the Claude and Codex fallback route |
| 9Router (local) | `http://localhost:20128/v1` | local token | `$script:NineRouterProfile`, `$script:NineRouterPort`, `Get-ShipDeNineRouterProfilePath`, `Assert-ShipDeNineRouterProfile`, `Assert-ShipDeNineRouterProfileBaseUrl`, `Test-ShipDeNineRouterEndpoint`, `Ensure-ShipDeNineRouterRuntime`, `Get-ShipDeNineRouterFailureSince` | Unattended AO sessions (`.claude-9router` profile), Gemini, dsh |

Fallback routing, as implemented:

- **Codex review fails** -> `Invoke-ShipDeClaudeReviewFallback` runs the host-authenticated native Claude Code CLI with `ANTHROPIC_BASE_URL` and `CLAUDE_CONFIG_DIR` cleared. It uses neither gateway, and spends the Claude subscription quota. The function was previously named after AgentRouter, which it never called.
- **An AO worker's provider fails** -> 9Router falls back across its configured upstreams; after every approved route is exhausted, TASK-AI-07 replaces the harness.
- **AgentRouter credential** -> reported available only after a live probe authenticates (`AI-44-R01`); a rejected, timed-out or unverifiable key is a `doctor.ps1` failure, never "configured" (`AI-44-R02`). Only a 16-character SHA-256 prefix of the key is cached, to bind the verdict to the key; the key itself is never written to a log, report or dashboard (`AI-44-R04`).

Earlier decision rows (`AI-SUP-06`, `AI-SUP-07`, `AI-SUP-11`) say "AgentRouter" where the runtime they describe is the local 9Router route; read them through this table. The rename changed no routing (`AI-44-R03`).

`scripts/ai/start-agent-orchestrator.ps1` names its port parameter `-NineRouterPort` and its endpoint helper `Test-NineRouterEndpoint`; the old `-AgentRouterPort` name is still accepted as an alias, so a launcher outside the repository that still passes it keeps working (`AI-44-R03`).

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

## Spec Kit pattern adoption (TASK-AI-157)

Under operator approval (2026-10-31), Ship Dễ adopts useful specification patterns from [GitHub Spec Kit](https://github.com/github/spec-kit) (MIT License, Copyright (c) GitHub, Inc.) into its existing Work Item workflow as documentation-only standards, without installing Spec Kit tooling, CLI, or altering repository status flows:

1. **Ambiguity / `[NEEDS CLARIFICATION]` markers**: Any ambiguous requirement, rule gap, or unverified assumption must be explicitly tagged. Authors must stop and mark `BLOCKED` rather than guessing.
2. **Pre-implementation Constitution check**: Explicit verification of non-negotiable invariants (tenant scope, RBAC, audit masking, VND integer math, carrier reconciliation, tests at the lowest useful level with test-first ordering for executable acceptance rows and justified non-applicability for non-executable rows).
3. **Numbered task breakdown**: Execution ordered API/backend before UI and test-first for executable acceptance rows, with `[P]` markers indicating parallel-safe independent tasks.
4. **Slice sizing rule**: Each Work Item Pull Request stays a single vertical delivery of ~400 changed lines (API/backend before UI inside the same PR). Work that does not fit is split at planning time into independently scoped prerequisite Work Items, never into horizontal backend/UI slices of one feature.

Upstream CLI and framework tooling remain uninstalled; Ship Dễ's Work Item and Controller workflow remains authoritative.

## Advisory first-pass PR review: qodo-ai/pr-agent (TASK-AI-156)

Operator approved on 2026-10-31 as an advisory pre-reviewer running via `.github/workflows/pr-agent.yml` and configured at `.pr_agent.toml`.

### Purpose
Provide automated first-pass feedback on Pull Requests across `/review` and `/improve` commands to identify common specification and code quality issues early—such as server-side tenant scoping violations, empty tenant scope bypasses, missing endpoint RBAC guards, unmasked PII or credentials in logs/audit events, floating-point math on VND currency, unreconciled carrier timeout side effects, and lack of test coverage for new behaviors. This surfaces defects before human or independent reviewer cycles, directly cutting down iterative `CHANGES_REQUIRED` rounds.

### Advisory boundary
- **Does not replace independent review:** `pr-agent` is strictly advisory. It never replaces the independent Codex-family review (or authorized Claude fallback) mandated by `AGENTS.md` and `AI-SUP-21`. The official merge gate remains the independent review-only Codex task returning `PASS`.
- **Non-blocking gate isolation:** The workflow runs with `continue-on-error: true` and a 20-minute timeout. It is not added to required GitHub Actions status checks and can never block a PR merge or controller progression.
- **Strict least-privilege permissions:** Workflow permissions are strictly limited to `contents: read` and `pull-requests: write`.

### Operator secrets and configuration
The action connects to an OpenAI-compatible endpoint using credentials provided exclusively via repository secrets. No model or API key is hardcoded in repository files. The operator must configure the following repository secrets in GitHub:
- `PR_AGENT_API_BASE`: The base URL of the OpenAI-compatible API endpoint (e.g., `https://api.openai.com/v1` or an approved gateway URL).
- `PR_AGENT_API_KEY`: The API key or token for authenticating against the endpoint.
- `PR_AGENT_MODEL`: The model name to execute reviews and suggestions (e.g., `gpt-4o`, `gpt-4o-mini`, or provider model ID).

If any of these secrets are absent, or if the Pull Request originates from a fork, `.github/workflows/pr-agent.yml` skips execution cleanly, posts an informational notice, and completes successfully without failing.

## TASK-AI-166 — Live refresh and unattended coordination (operator 2026-11-02)

Run `pnpm ai:refresh-catalogue` daily on the authenticated operator host. It runs
the Controller's `priors refresh`, `discovery run`, and `quota-scan` in that order,
including quota scanning after a prior stage fails. Run it again after changing
provider configuration or when a provider announces new model IDs. Hermes is not
required. Public descriptors include BenchLM's
`https://benchlm.ai/data/models.json` and Artificial Analysis's
`https://artificialanalysis.ai/leaderboards/models`; existing coding benchmarks
remain configured. Every source declares verification and percentage scale;
`benchmarks.js` retains discrete sourced records and never averages benchmarks.
The existing prior role weighting and normalization remain a separate routing
input. Public fetch/schema failures retain the last good priors.

Discovery reads each configured OpenCode provider's live `/models`, the operator's
own `agy models`, and `agy models` through each existing per-user scheduled lane
adapter. Credentials stay in memory or the native user session; discovery never
opens an authentication store. A listing establishes advertisement only, never
quota or successful execution. The versioned JSONL ledger preserves previous
observations, appends additions/removals and records successful unchanged scans in
`data/discovery/freshness.json`. A failed, missing or partial listing cannot remove
models. Freshness advances only after all applicable live catalogues succeed;
presence-only harnesses have no listing to refresh. Partial runs keep source
failure reasons and the last successful observation time.

Every provider model row is validated before a listing is authoritative, including
namespaced `@` identifiers. Registry notes mark a listing incomplete. Scheduled
lanes return the completed job's own model output, captured while that job owns
the lane lock. The full refresh stages discovery into a private per-attempt
observation and publishes the canonical freshness record only after all stages
succeed; a crash during quota cannot advance dispatch freshness.

`dispatch --dry-run` fails with exit code 1 and `STALE_CATALOGUE` when the last
successful observation is absent, invalid, future-dated, or older than 48 hours.
Refresh reports and discovery snapshots expose partial failures without declaring
them current. Fixture-injected candidate tests use their own evidence, without
requiring a live host catalogue.

The host coordinator runs
`node tools/ai-brain/cli.js coordinator run .oc/items.json --loop` (omit `--loop`
for one pass). It performs one persisted refresh attempt daily, with an exclusive
loop lock, and processes existing PR worktrees. Its input is a JSON array:

```json
[
  {
    "id": "TASK-AI-166",
    "cwd": "C:/Users/gumac/AI/shipde-platform/.worktrees/p-task-ai-166",
    "pr": 123,
    "task": ".oc/operator-task.md",
    "risk": "HIGH",
    "fanout": false,
    "writer": {
      "model": "provider/configured-model-id",
      "family": "gpt",
      "harness": "codex",
      "cannotCommit": true
    }
  }
]
```

Replace the PR number and initial writer with the actual PR and writer identity;
the initial identity is required to review an already-authored branch. Supported
identifiers include `GOAL-<GOAL>-<n>` as well as FEAT and TASK items. Paths must
identify isolated worktrees on the expected Work Item branch. Selection consumes
the Controller's current qualified candidate ranking and only offers configured
OpenCode models. Native Claude runs only through host-authenticated Claude Code;
third-party Claude quotas are excluded. Scheduled AGY writers reuse the existing
lane lock and job receipt through a host process whose PID remains live while the
lane runs. Unsupported harnesses fail closed.

The writer is alive while its PID exists or its current log was written less than
three minutes ago. Unreadable liveness evidence stays unknown. A dead writer is
rerouted at most once every eight minutes per item. Quota/rate refusals classified
from sanitized logs exclude the model for two hours; successful quota refresh and
the existing Controller quota checks still apply. Log classification is persisted
once per launch; rereading an old log cannot extend the exclusion. Only newer
evidence for the selected quota scope can reconcile it. One failed review round prefers
a different writer; high-risk items prefer a score of at least 80. No model gets
more than two writer launches in twenty minutes across items. Launch reservations
are saved before starting the process; unresolved reservations or reviewer
interruptions require operator reconciliation, preventing duplicate launches.

For sandbox writers that cannot commit, the host stages output excluding `.oc/`,
`.serena/` and `.oc-codex-task.md`, then commits
`[ID] Address review: writer output (model)` through the existing installed-hook
validator. There is no hook bypass. Before review, the host fetches and cleanly
merges `origin/main`; a register-only conflict may use exact row union, while
conflicting values for the same item or any other merge conflict abort. Bad commit
subjects, protected gate files and `diff --check` findings become review feedback
and refuse push. The complete committed delta also rejects private `.oc/`,
`.serena/` and `.oc-codex-task.md` paths, including native-writer commits. Push uses
the pinned OID and a validated Work Item branch ref. `gh pr checks` at the exact PR head is authoritative: red CI is
`CHANGES_REQUIRED` with zero reviewer tokens, pending CI waits without consuming a
round, and unknown checks stop for an operator.

The independent reviewer family differs from every contributing author's family,
including earlier repair rounds and collected lanes. The family history persists
after lane collection and restart. Unknown authors or no independent family
require an operator. The reviewer reads a separate
checkout at the exact merged/pushed SHA, first checks tenant scope, RBAC/empty
scope, negative tests, acceptance rows, integer VND, idempotency/reconciliation,
audit/PII, UI states and prior findings `FIXED`/`NOT FIXED`, then performs an open
sweep of the full implementation and source contracts. Every round is appended to
the PR worktree's `.oc/history.md`, with current repair feedback in `.oc/review.txt`.
After four unsuccessful rounds the item becomes `STUCK` for a human. A `PASS` is
independent review evidence; existing human/conditional merge authorization still
owns merge. This loop never merges a PR.

Review findings use one numbered block per issue, with an explicit severity and
`FIXED:` or `NOT FIXED:` prefix. Prior-finding commentary cannot close a new issue;
mixed or ambiguous status fails closed. Child output has a 64 KiB partial-line
limit and 2 MiB total retention/read limit. Truncation is explicit, discarded
fragments are never persisted, and a truncated review cannot authorize PASS.
The child and both streams finish before review output is consumed. All log,
history and metrics metadata is masked before persistence.

Optional `fanout: true` groups findings into at most three connected, file-disjoint
lanes in separate worktrees. Lane 1 owns shared contracts (OpenAPI, Prisma,
contracts, package metadata, register and Work Items). Unknown file ownership
falls back to one writer. The host checks each lane's actual changed files against
its assigned files, commits through hooks, and merges lanes in numerical order.
No lane is dropped on conflict; conflicts or out-of-bound writes produce `STUCK`.
The combined SHA returns through main merge, gates, CI and independent review.
Review worktrees and lane worktrees are retained for operator inspection.

One `.oc/coordinator/metrics.jsonl` record per PR/SHA/round stores time, item, PR,
round, writer, verdict, measured reviewer tokens and CI-red status. Unknown token
usage remains null. `pnpm ai:metrics` prints median/p90 final rounds to PASS,
CI-red review rate and reviewer tokens per confirmed merged PR, consulting GitHub
for merge state. It deduplicates replayed metrics and never treats PASS as merged.
Malformed JSON/records are counted and skipped; invalid PR identifiers are never
queried. Failed merge-state lookups make the summary explicitly partial.
Unknown token usage makes the merged-token aggregate unknown. These metrics and
all coordinator state remain local and excluded from writer commits. A sanitized
`data/quota-scan-summary.json` snapshot summarizes the observed quota results for
the PR using aggregate counts only; source, scope, upstream and model identifiers
are not copied into that summary. The existing local `quota-state.json` remains
the routing store. A held loop lock reports PID/age and manual inspection guidance;
it is never stolen automatically.

Sandbox authors do not run git write commands, push, or commit. Record each
available check and each `BLOCKED_BY_SANDBOX` check with its exact error in the PR
body; the host coordinator commits the output and runs blocked refresh/checks.
Failed scans never justify replacing live evidence with model IDs or scores from
operator notes or fixture data.
## Offline DB-backed API tests (TASK-AI-163)

Operator authorization: 2026-11-02. Select option (a), `@electric-sql/pglite@0.3.16` with `pglite-prisma-adapter@0.6.1`, as an opt-in test dependency in `@shipde/testkit`. On 2026-11-03, the frozen install and all six helper integration tests passed on Windows inside the sandbox, including the complete migration history, Prisma CRUD/types, constraints, triggers, rollback and reset. The repository declares Prisma `^6.19.2` and locks Prisma/client 6.19.3. Full API acceptance results are recorded in `.oc/pr-body.md`.

### Evaluation order and compatibility

1. **PGlite + Prisma 6 adapter: first viable option, verified with our migrations.** The installed 0.6.1 manifest declares Prisma client `>= 6.10.0`, PGlite `>=0.2.0`, and adapter utilities 6.10.1. The installed PGlite 0.3.16 manifest identifies Electric DB Limited and Apache-2.0; it packages the WASM database without a server or native installer. Pin the established 0.3 release line for this Prisma 6 evaluation. Published sources: [adapter manifest](https://github.com/lucasthevenet/pglite-utils/blob/pglite-prisma-adapter%400.6.1/packages/prisma-adapter/package.json), [PGlite manifest](https://github.com/electric-sql/pglite/blob/%40electric-sql/pglite%400.3.16/packages/pglite/package.json).
2. **Latest adapter 0.7.2: rejected for Prisma 6.** Its [manifest](https://github.com/lucasthevenet/pglite-utils/blob/main/packages/prisma-adapter/package.json) requires Prisma client `>= 7.1.0` and adapter utilities 7.2.0. Do not resolve the adapter through an unbounded latest version.
3. **Embedded PostgreSQL binary: not selected because option (a) works.** [embedded-postgres](https://www.npmjs.com/package/embedded-postgres?activeTab=versions) has a PostgreSQL 16 release line and [Windows x64 binaries](https://www.npmjs.com/package/%40embedded-postgres/windows-x64). It starts `initdb`/`postgres` child processes and needs a cluster directory and socket. In the requested evaluation order, no binary installation or runtime claim is needed after PGlite passes the migration acceptance tests. Independent-connection and locking coverage remains on CI PostgreSQL, as authorized; it is not simulated locally.

[Prisma's v6 client reference](https://www.prisma.io/docs/orm/v6/reference/prisma-client-reference#adapter) states that driver adapters became GA in 6.16. The adapter README's historical `driverAdapters` preview flag is unnecessary with 6.19. The production schema/generator and CI connection behavior therefore remain unchanged.

### npm provenance and activity evidence

The following activity figures were already recorded in this worktree from indexed npm page snapshots on 2026-11-02. They have not been refreshed and must not be treated as current registry counters or exact release dates. On 2026-11-03, the installed package manifests independently confirmed the selected versions, licenses, author identities and adapter peer requirements. Author/repository identity is not a verified live npm maintainer list.

| Package                                                                                         | Maintainer/source                         | License                                                         | npm weekly downloads observed                                    | Last release shown                                                            |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [@electric-sql/pglite](https://www.npmjs.com/package/%40electric-sql/pglite)                    | Electric DB Limited / `electric-sql`      | Apache-2.0 in manifest; upstream also offers PostgreSQL License | 27,037,821 (package sidebar)                                     | 0.5.14, “a day ago”; implementation pin is 0.3.16                             |
| [pglite-prisma-adapter](https://www.npmjs.com/package/pglite-prisma-adapter?activeTab=versions) | Lucas Thevenet / `lucasthevenet`          | MIT                                                             | 157,659 (package sidebar); 78,345 for 0.6.1 in the version table | 0.7.2, “9 months ago”; 0.6.1, “a year ago”                                    |
| [embedded-postgres](https://www.npmjs.com/package/embedded-postgres?activeTab=versions)         | `leinelissen` (upstream repository owner) | MIT wrapper; binary package describes Apache-2.0 licensing      | 597,325 (package sidebar)                                        | Snapshot shows 18.4.0-beta.17, “5 months ago”; 16.14.0-beta.17 is also listed |

Live registry/weekly-download verification on 2026-11-03 is `BLOCKED_BY_SANDBOX`: each of the three package requests returned `{"error":"fetch failed","code":"EACCES"}`. The web tool also returned `(403) Forbidden` for npm package pages and could not access registry/download endpoints. The coordinator must refresh npm maintainer lists, exact latest/pinned release dates and weekly downloads; `.oc/tmp/npm-evidence.json` retains the package-level blocked results. Runtime acceptance is independently executable with the installed packages and is not blocked by this metadata request.

Lockfile entries retain SHA-512 integrity checks. The initial implementation reconstructed five new package records from published dependency manifests and existing npm/yarn lock records: [adapter, driver utilities, debug and postgres-array](https://github.com/oldschoolgg/oldschoolbot/blob/bf50c1a2f05d427b86863627ac23ba424ffecb8a/pnpm-lock.yaml) and [PGlite 0.3.16](https://github.com/lissy93/web-check/blob/master/yarn.lock) (recorded blob `85be6eda5fd97714c92ad3cda616f7bad9ee9f51`). No existing dependency versions or build-script policies change. `pnpm install --frozen-lockfile` now passes against the populated worktree (`Already up to date`); this proves lockfile consistency, not a fresh network download or clean-checkout install. CI/coordinator owns that remaining installation evidence.

### Execution and evidence boundary

`pnpm test:local-db` runs the existing API Supertest scripts serially with `TEST_DB=local`, a fresh in-memory database per DB-backed script, all 18 current migration files, and synthetic configuration. The helper executes whole SQL files separately (including PL/pgSQL triggers and enum alterations), offers reset by dropping only its private schema and replaying migrations, and closes both Prisma and PGlite. Future migrations are discovered automatically; missing or unsupported SQL fails the run.

The adapter does not implement `prisma migrate deploy`; direct execution of the repository migration SQL is the local test path, and CI keeps its existing CLI migration path. No `db push`, SQL replacement or migration omission is used. Helper regression tests cover representative types, unique/FK constraints, trigger behavior, rollback and reset; the full API suite remains the required acceptance proof.

Single-connection PGlite cannot validate overlapping transactions, independent connection access, locking, deadlocks or production PostgreSQL performance/version parity. Nine existing race scenarios are explicitly skipped with names and reasons; onboarding still prepares required fixtures sequentially. Four branch authorization scenarios also require a root-client read while an interactive transaction holds the only connection; they are named skips rather than increasing timeouts or rewriting transaction semantics. Branch owner CRUD, scoped reads, guard denials and cross-tenant assertions still run locally. In addition, an in-process git history secrets scan in RBAC tests is skipped offline where git history is not available. Redis/Lua, MinIO, worker/outbox delivery and dependency recovery require CI. Local API tests use the real rate-limit service's no-Redis memory backend; Redis/storage readiness reports down and unexpected direct service access throws. The foundation integration runner explicitly skips under local mode.

The runner reports suite process pass/skip/fail separately from skipped scenarios, and fails on child errors, timeouts or legacy offline-skipped suites. Actual check results, blocked errors and counts belong to `.oc/pr-body.md`; no blocked suite is reported as passing. Usage and lifecycle examples: packages/testkit/README.md.

## Affected-only PR CI caching and merge queue (TASK-AI-165)

Operator explicitly approved modifying `.github/` for this item on 2026-11-02.

### What Changed
1. **Affected-only PR CI with Turborepo**:
   - In `.github/workflows/current-application.yml`, configured `actions/checkout` with `fetch-depth: 0`, cached pnpm store (`pnpm/action-setup` before `actions/setup-node` with `cache: pnpm`), and restored Turborepo filesystem cache via `actions/cache@v4` on `.turbo`.
   - On `pull_request` events, runs `turbo run lint typecheck test build --affected` with `TURBO_SCM_BASE = ${{ github.event.pull_request.base.sha }}`, followed by root scripts linting (`pnpm exec eslint scripts`).
   - On `push` to `main` and on `merge_group` events, executes full non-affected runs (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`) to guarantee complete mainline integrity.
   - Preserves all required status check job names (`application-gate`, `contract`) and required verification steps (Prisma client generation, migrations, database services, integration tests, contract verification, secrets scanning, ast-grep, formatting negative proofs).
2. **Merge queue triggers**:
   - Added `merge_group` trigger to both workflows that provide required status checks:
     - `.github/workflows/current-application.yml` (provides required status check `application-gate`)
     - `.github/workflows/feature-contract-gate.yml` (provides required status check `contract`)
   - Added `push: branches: [main]` trigger to `.github/workflows/current-application.yml` to ensure Turborepo cache is populated on main and master runs are validated.

### Expected Effect
- **Substantially faster PR verification**: Rather than running full lint, typecheck, test, and build across all monorepo packages, PR CI runs only against packages directly affected by the PR diff relative to the PR base commit (`TURBO_SCM_BASE`), reducing CI duration and worker waiting times.
- **Cache reuse**: Monorepo package outputs and hashes are cached in `.turbo`, allowing unchanged dependencies to be restored instantly.
- **Concurrent agent PR throughput**: GitHub Merge Queue allows concurrent agent PRs to be queued and validated in parallel against speculative merged results without serial human rebase bottlenecks.
- **Zero weakening of required gates**: Required status checks (`application-gate` and `contract`) remain strictly enforced with identical names.

### Operator Step to Enable Merge Queue in Branch Protection
To enable the merge queue in GitHub repository settings (not executed by this PR):
1. Navigate to repository settings on GitHub: **Settings > Branches**.
2. Under **Branch protection rules**, edit the rule for branch `main`.
3. Check the box **Require merge queue**.
4. Configure merge queue parameters:
   - **Merge method**: Squash and merge.
   - **Build concurrency**: 2 to 5 (adjust based on GitHub Actions concurrency limit).
   - **Minimum / Maximum pull requests to merge**: 1 to 5.
   - **Status checks**: Ensure required checks `contract` and `application-gate` are selected.
5. Save changes.
