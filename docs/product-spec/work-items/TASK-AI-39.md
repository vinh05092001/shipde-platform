# TASK-AI-39 — Agent tooling security scan

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-39` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `172` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-39.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-39-agent-scan` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pulls |

## Business outcome

The Ship Dễ delivery workflow relies heavily on autonomous and semi-autonomous AI
agents (Claude Code CLI, Gemini, Codex, 9Router, and Agent Orchestrator workers)
collaborating across isolated worktrees to plan, implement, verify, and review
features. These agents operate with broad system capabilities, including command
execution, file modifications, git operations, and external tool integration via
the Model Context Protocol (MCP).

This agentic operational model introduces distinct security risks that traditional
source-code AST linters, secret scanners (Gitleaks), and container/dependency
vulnerability scanners (Trivy) cannot detect:
1. **Prompt injection and adversarial instruction override**: Malicious or
   adversarial inputs embedded within user-supplied tracking text, carrier API
   responses, pull request comments, or third-party documentation can hijack
   agent execution and subvert business constraints or tenant boundaries.
2. **Malicious or unsafe agent skills**: Custom agent skills (such as skill
   definitions, slash commands, and scripts) can introduce arbitrary command
   execution, unintended network communication, or improper file system access
   if admitted into the repository without verification.
3. **Overprivileged or misconfigured MCP servers**: MCP server configurations
   (e.g., `playwright-mcp`, `context7`) can expose unauthenticated local endpoints,
   bind to public network interfaces, or grant unbounded shell privileges.
4. **Untrusted agent memory and credential leakage**: Dynamically generated agent
   lessons or memory artifacts can inadvertently persist sensitive tokens,
   customer PII, or hallucinated operational policies into repository storage.

In `tools/ecosystem-manifest.json`, the security scanner for AI agent tools, skills,
and prompts is `agent-scan` (`snyk/agent-scan`, pinned at version `0.6.1`).
Following `TASK-AI-17`, `agent-scan` is documented truthfully as `PENDING` with
`blocking_policy: NON_BLOCKING` and source boundary `"Admission-scanning gate for
prompt injection and malicious skills under AI-TOOL-05; installation deferred to
TASK-AI-39"`.

`TASK-AI-39` establishes the authoritative specification for agent tooling security
scanning across the repository. It defines:
- The admission-scanning gate for agent skills, prompt templates, and MCP
  configurations under ecosystem policy `AI-TOOL-05`.
- Clear multi-vector scanning requirements covering static skill validation,
  prompt injection detection, MCP privilege auditing, and secret leakage prevention.
- Non-duplication and clear domain separation across security gates (Gitleaks for
  code/commit secrets, Trivy for container/dependency CVEs, and Agent-Scan for
  agentic skills, prompts, and MCP configurations).
- Operational execution modes: offline local rule evaluation for developer
  worktrees vs. authenticated platform evaluation in CI under the `SECURITY_REVIEW`
  profile.
- Strict manifest promotion criteria to transition `agent-scan` from `PENDING` to
  `ADOPTED` in downstream implementation.

## Source references

- `AGENTS.md` § Role separation — Author never approves own work; multi-agent
  isolation; status flow through `READY_FOR_CODEX`.
- `AGENTS.md` § UI quality and 9Router request policy — Headroom, Caveman, and
  Ponytail restrictions; preservation of business rules and test integrity.
- `tools/ecosystem-manifest.json` — Entry `agent-scan` (repository `snyk/agent-scan`,
  pinned version `0.6.1`, profiles `SECURITY_REVIEW`, `PR_REVIEW`).
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply
  integrated, enabled or blocking.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-05` — Skills/content are
  commit-pinned, admission-scanned and loaded only by task trigger; no blanket
  prompt injection.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-06` — Hermes memory and
  self-created skills are untrusted until human-reviewed into shipde-brain; no
  PII or credential persistence.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — A failed or partial
  installation reports exact state; must not be recorded as installed or healthy.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Snyk Agent
  Scan (`snyk/agent-scan`) network behavior, credential requirements, and telemetry
  governance.
- `docs/product-spec/work-items/TASK-AI-04.md` — Safe metadata detection via
  `python -m pip show snyk-agent-scan` parsing `Version:` without invoking active
  scans or leaking credentials.
- `docs/product-spec/work-items/TASK-AI-17.md` — Reconcile the ecosystem manifest
  against reality; truthful baseline preservation.

## Preconditions and dependencies

- `TASK-AI-17` reconciled `agent-scan` to `PENDING` with `blocking_policy: NON_BLOCKING`
  in `tools/ecosystem-manifest.json`.
- Gitleaks is active and blocking in CI (`ADOPTED`, `BLOCKING_GATE`, `ci-provisioned`)
  pinned at version `8.24.0` in `.github/workflows/security-baseline.yml`.
- `lefthook` (`TASK-AI-36`) and `trivy` (`TASK-AI-37`) are documented truthfully
  as `PENDING`.
- Monorepo package manifests forbid install lifecycle scripts (`preinstall`,
  `install`, `postinstall`, `prepare`) under the regression audit.
- Python 3.12 runtime environment is available for specification validation and
  local toolchain inspection.

## Author boundary

`GEMINI` is appropriate as primary author: this Work Item establishes a foundational
security architecture and specification spanning agent skills, prompt injection
mitigation, MCP configuration boundaries, and CI review policies.

Bounded scope: authoring the specification in `docs/product-spec/work-items/TASK-AI-39.md`.

Prohibited in this Work Item:
- Modifying `.github/workflows/*`, `scripts/verify-*`, `.gitleaks.toml`, or
  `docs/product-spec/scripts/*`.
- Adding `preinstall`, `postinstall`, `install`, or `prepare` scripts to `package.json`.
- Installing Python pip packages or modifying local Python environments.
- Editing `tools/ecosystem-manifest.json`, `FEATURE-DELIVERY-REGISTER.csv`, or
  monorepo source code in this specification PR.
- Falsifying or altering `codex-cli` version pins.
- Author never approves own work; handoff stops at `READY_FOR_CODEX`.

## In scope

- Define the admission-scanning architecture for AI agent tooling under `AI-TOOL-05`:
  1. Skill schema and frontmatter validation: validating YAML frontmatter,
     description clarity, declared tool requirements, and script permissions for
     skills in `.gemini/`, `.claude/`, or repository-governed skill directories.
  2. Prompt injection and jailbreak prevention: static heuristic and policy analysis
     of system prompts, agent persona templates, and dynamic injection variables to
     detect prompt injection vectors, instruction-override attempts, and role confusion.
  3. MCP server configuration audit: inspecting Model Context Protocol definitions
     (e.g., `playwright-mcp`, `context7`) to ensure least-privilege principles,
     prohibiting unconstrained shell execution, public network interface exposure
     (`0.0.0.0`), and environment variable leaks.
  4. Credential and sensitive data boundary: ensuring prompt templates, skill
     documentation, and agent scratch files contain no plaintext secrets (`SNYK_TOKEN`,
     `GITHUB_TOKEN`, carrier API keys, or customer PII).
- Define scanner execution modes and network governance under `AI-TOOLCHAIN-DECISIONS.md`:
  1. Offline local evaluation: local rule evaluation for developer worktrees with
     zero external network traffic (`telemetry_network_behavior: none` or localhost cache).
  2. Authenticated CI platform scan: governed execution using `SNYK_TOKEN` within
     GitHub Actions under the `SECURITY_REVIEW` profile.
  3. Fail-closed operational semantics: unparseable skills, syntax errors, or
     high/critical injection vulnerabilities exit code 1 and block PR admission;
     missing binary or execution faults exit code 2.
- Define non-duplication boundaries across security gates:
  - Gitleaks 8.24.0 remains the sole authoritative secret scanning gate (`TASK-AI-35`).
  - Trivy 0.60.0 remains the container and dependency vulnerability gate (`TASK-AI-37`).
  - Agent-Scan focuses exclusively on agentic artifacts: skills, prompts, agent
    profiles, and MCP configurations.
- Define health check and doctor diagnostic contract:
  - Diagnostic inspection via `python -m pip show snyk-agent-scan` (verifying
    `Version: 0.6.1`) and CLI health check without triggering unauthorized outbound
    network calls or consuming tokens during doctor execution.
- Define manifest promotion criteria for `tools/ecosystem-manifest.json`:
  - Formal checklist to transition `agent-scan` from `PENDING` to `ADOPTED` and
    `BLOCKING_GATE` in downstream implementation.
- Author complete Work Item specification `TASK-AI-39.md`.

## Out of scope

- Installing pip packages, modifying Python environments, or editing monorepo
  dependencies in this PR.
- Editing CI workflow files under `.github/workflows/`.
- Changing Gitleaks configuration (`TASK-AI-35`) or Trivy configuration (`TASK-AI-37`).
- Modifying Agent Orchestrator supervisor scripts (`scripts/ai/control.ps1`).
- Falsifying or altering `codex-cli` version pins.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-39-R01` | Truthful lifecycle state: `agent-scan` remains `PENDING` with `blocking_policy: NON_BLOCKING` in `tools/ecosystem-manifest.json` until tooling installation and CI integration are fully implemented and verified. |
| `AI-39-R02` | Admission scanning for agent artifacts: Under `AI-TOOL-05`, all agent skills, prompt templates, and MCP server configurations committed to the repository must undergo automated admission scanning before activation. |
| `AI-39-R03` | Prompt injection and jailbreak prevention: Agent scan rules must inspect prompt definitions and skill instructions for prompt injection heuristics, jailbreak patterns, and unauthorized instruction overriding. |
| `AI-39-R04` | Least-privilege MCP configuration: MCP server definitions must not permit unconstrained shell execution, expose wildcard network bindings (`0.0.0.0`), or inject unredacted environment secrets into tool contexts. |
| `AI-39-R05` | Authority separation across scanners: Agent-Scan must not duplicate or override Gitleaks for git secret scanning or Trivy for container/dependency scanning. Each security tool retains exclusive authority over its domain. |
| `AI-39-R06` | Fail-closed operational policy: Operational errors (unparseable skill frontmatter, syntax failure, corrupted configuration) or critical security findings must produce a non-zero exit code and fail admission, never silently passing. |
| `AI-39-R07` | Network and telemetry governance: Local doctor and diagnostic checks must use metadata inspection (`python -m pip show snyk-agent-scan`) and must not make outbound network requests or leak `SNYK_TOKEN`. Remote scanning in CI must be restricted to designated endpoints (`api.snyk.io`). |
| `AI-39-R08` | Version pinning and provenance: Agent-Scan must be pinned to exact version `0.6.1` with verified installation method via pip, ensuring deterministic scanning behavior across environments. |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer- and CI-facing
outputs are CLI output and PR checks:
- **Clean scan**: Exit code 0, 0 prompt injection or skill configuration defects
  detected; admission passed.
- **Security defect detected**: Exit code 1, diagnostic identifying file path,
  offending line, rule ID, and vulnerability description (e.g. unconstrained
  command execution in skill script, prompt injection vulnerability); PR check
  fails closed.
- **Operational failure**: Exit code 2, diagnostic explaining syntax error,
  invalid arguments, or missing dependencies.
- **Doctor diagnosis**: `scripts/ai/doctor.ps1` reports `PENDING` when uninstalled
  or `PASS agent-scan` at version `0.6.1` via safe metadata inspection.

## API, event and data impact

No database schema, runtime REST API, or carrier integration contract changes.
Toolchain and quality gate impact:
- Specifies future installation of `snyk-agent-scan` pinned at `0.6.1`.
- Specifies admission-scanning commands for skills and prompt templates.
- Governs `tools/ecosystem-manifest.json` entry for `agent-scan`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-39-01` | Truthfulness of baseline gate status | `agent-scan` is truthfully documented as `PENDING`, `NON_BLOCKING`, with installation deferred to `TASK-AI-39` in `tools/ecosystem-manifest.json`; `gitleaks` is recognized as `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned` | `tools/ecosystem-manifest.json` and workflow review |
| `AC-AI-39-02` | Agent skill admission scanning specification | Specification defines static inspection of skill frontmatter, script permissions, and executable boundaries under `AI-TOOL-05` | Specification text § In scope & `AI-39-R02` |
| `AC-AI-39-03` | Prompt injection detection specification | Specification defines heuristic and policy-based prompt scanning for system prompts and agent instructions | Specification text § In scope & `AI-39-R03` |
| `AC-AI-39-04` | MCP configuration security audit specification | Specification defines security checks for MCP configurations, enforcing least privilege and preventing secret leakage | Specification text § In scope & `AI-39-R04` |
| `AC-AI-39-05` | Authority separation across quality gates | Specification mandates non-duplication with Gitleaks (secrets) and Trivy (dependencies/containers) | Specification text & `AI-39-R05` |
| `AC-AI-39-06` | Fail-closed and network governance rules | Specification mandates exit code 1 on vulnerability findings, exit code 2 on operational errors, and strict offline local behavior | Specification text & `AI-39-R06`, `AI-39-R07` |
| `AC-AI-39-07` | Safe metadata health check specification | Specification preserves `python -m pip show snyk-agent-scan` metadata inspection established in `TASK-AI-04` | Specification text & `AI-39-R07` |
| `AC-AI-39-08` | Documentation and green gate validation | Manifest audit (`node tools/ai-brain/cli.js manifest`), reconcile, unit tests, and `validate_docs.py` pass cleanly with 0 errors | CLI execution stdout |

## Verification commands

```powershell
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
python docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | HEAD | READY_FOR_CODEX | Pending fresh independent Codex review |

## Residual limitations

- Snyk Agent Scan relies on evolving vulnerability databases and heuristic models
  for prompt injection; novel or multi-turn prompt injection techniques may require
  ongoing updates to detection rules and complementary human review of agent instructions.
- Full platform-backed policy analysis requires `SNYK_TOKEN`; environments lacking
  this credential operate under local heuristic rule evaluation, which detects syntax
  and known static misconfigurations but may not access live platform policy catalogs.
- Specification authoring Work Item does not mutate `.github/` workflows or workspace
  dependencies directly; CI workflow integration and binary provisioning are strictly
  gated to subsequent implementation under repository change control rules.
