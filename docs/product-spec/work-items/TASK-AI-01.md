# TASK-AI-01 — Establish human-gated semi-automatic AI delivery workflow

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-01` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | Existing product specification and CI baseline at commit `31a75ae` |
| Assigned author | `Codex document owner` |
| Risk | `LOW` |
| Allowed paths | `AGENTS.md`, `.agents/**`, `.github/**`, `.gitignore`, `scripts/ai/**`, `docs/product-spec/**` |
| Reviewer | `Fresh independent Codex task plus human merge owner` |
| Branch | `chore/ai-semi-manual-workflow` |
| Pull Request | `#1` |

## Business outcome

The product owner can press one `Resume` action to advance the complete Ship Dễ repository/toolchain across Claude, 9Router, Gemini and Codex without retyping Work Item, branch, author or Pull Request data and without allowing agents to edit the same workspace. Low-cost models receive bounded low-risk work, Gemini owns primary implementation, Codex independently reviews every Work Item, and the human retains all material decisions and merge authority.

## Source references

- Root and product-spec `AGENTS.md` contracts.
- Product baseline, technology stack and delivery queue under `docs/product-spec/docs/`.
- Existing GitHub issue, Pull Request and CI contract gates.
- Official installation sources for Codex CLI, Gemini CLI, DSH, 9Router and the selected quality repositories.
- Human decision: prepare the entire repository and CLI layer before beginning product implementation, using human-gated semi-automatic control with isolated Claude, DSH, Gemini and Codex worktrees.

## Preconditions and dependencies

- GitHub repository and existing product specification are available.
- Worktrees `shipde-claude`, `shipde-dsh`, `shipde-gemini` and `shipde-codex` exist at the same baseline.
- Git, GitHub CLI, Node and npm are already available on Windows.
- Existing CI validates documentation, lint, build and E2E behavior when their paths apply.

## Author boundary

This is a documentation and workflow-control change. It may add guarded machine-setup scripts but must not change application behavior, product business rules, database schema, runtime dependencies or deployment behavior.

## In scope

- Replace the ZCode-only operating contract with explicit Claude, 9Router, Gemini, Codex and human responsibilities.
- Add deterministic routing and escalation rules.
- Add dedicated Gemini and 9Router start/fix prompts.
- Record assigned author, risk and allowed paths in every prepared Work Item.
- Rename `READY_FOR_ZCODE` to `READY_FOR_AUTHOR` in active delivery control artifacts.
- Update issue/PR templates and documentation validation.
- Separate the always-on contract gate from path-aware application checks without changing application commands.
- Add safe Windows scripts for CLI installation, five-worktree bootstrap, health diagnosis, Desktop controller installation, human-gated state routing, author handoff, non-interactive Codex review, post-review correction handoff and post-merge `main` protection.
- Record the complete repository/CLI/service inventory and exact rule for global, project-local, Docker and guidance dependencies.
- Record complete adopted/deferred/rejected toolchain decisions and the DSH-to-9Router configuration contract without storing a credential.
- Bind every application repository/tool to `TASK-FOUND-01` through `TASK-FOUND-04` instead of installing an unreviewed mixed stack into the prototype.
- Remove Ponytail as an always-on repository rule and skill and explicitly disable its 9Router endpoint injection.

## Out of scope

- Entering account credentials, DSH provider credentials or 9Router API keys on behalf of the human.
- Starting Docker services or accepting Docker Desktop terms on the user's machine.
- Fully unattended orchestration, parallel implementation, automatic product decisions, automatic merge, deployment or credential entry.
- Installing application framework/test dependencies before their assigned Foundation Work Item.
- Implementing product features or changing production code.
- Changing existing application CI commands; this task only scopes when those commands run.

## Business rules and edge cases

- One implementation author works on one Work Item and one branch.
- The controller automatically derives the next stage from versioned Git/GitHub state, but a human initiates each stage and remains the only merge owner.
- A matching draft Pull Request blocks the pipeline; it never causes another Work Item to start.
- Codex reviews only the immutable PR head SHA whose required `contract` and `application-gate` jobs both completed successfully.
- Only the Ship Dễ repository is cloned; upstream repositories use supported, versioned consumption mechanisms.
- Machine agent CLIs may be global; framework/build/test CLIs must be lockfile-pinned project dependencies.
- The installer previews by default, installs only missing tools, never auto-upgrades and never authenticates an account.
- 9Router is allowed only for bounded low-risk deterministic work.
- Two failed 9Router correction rounds require escalation to Gemini.
- Gemini is the default for foundation, vertical, UI, security, money, carrier-effect and cross-layer work.
- Codex review uses a fresh task and never self-approves implementation.
- Only the human may merge, accept terms, provide credentials or accept residual risk.
- Missing or contradictory business decisions block implementation.

## UI states

Not applicable. This Work Item changes workflow documentation and setup controls only.

## API, event and data impact

None. No runtime contract, event, migration or product data is changed.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-01` | Any agent opens the repository | Root and nested `AGENTS.md` describe the same human-gated semi-automatic roles and source precedence | File diff and documentation validator |
| `AC-AI-02` | Human assigns a prepared item | Separate Gemini and 9Router prompts enforce branch, scope, evidence and stop conditions | Prompt files and workflow cross-references |
| `AC-AI-03` | Planning marks an item ready | Register, template and validator accept `READY_FOR_AUTHOR` consistently | CSV and validator evidence |
| `AC-AI-04` | An agent begins UI/code work | No Ponytail always-on rule or skill can override completeness or UX sources | Deleted `.agents` files and root UI rule |
| `AC-AI-05` | Pull Request opens | `contract` and `application-gate` must both succeed; a default-application path policy runs install, lint, build and E2E for every path not explicitly classified as control/documentation-only | GitHub Actions results and scope-detection log |
| `AC-AI-06` | Human completes Windows setup | Versioned scripts verify worktrees, every selected agent authentication route with bounded non-secret probes, Docker, local services and current free-model availability without persisting a secret | PowerShell parse gate and post-merge doctor output |
| `AC-AI-07` | DSH uses 9Router | Provider fields, model route, disabled prompt injection and escalation boundaries are explicit | Toolchain decision and Windows runbook |
| `AC-AI-08` | Human asks which repositories and CLIs are required | Every product workspace, global CLI, project dependency, Docker service, focused agent guidance and exclusion has one owner and installation phase | Repository/CLI manifest, installer preview and Foundation mapping |
| `AC-AI-09` | Human runs controller `Resume` | Controller chooses planning, assigned author or Codex review from Git/GitHub state; it blocks drafts, requires both named gates, detaches and re-verifies the immutable head SHA, stops on dirty/multiple/moved states and never merges | `scripts/ai/control.ps1`, PowerShell parser gate and dry status evidence |

## Verification commands

For this setup Pull Request:

- `cd docs/product-spec && python3 scripts/validate_docs.py`
- `python3 docs/product-spec/scripts/validate_pr_contract.py --event "$GITHUB_EVENT_PATH"`
- Parse every `scripts/ai/*.ps1` file, including `control.ps1`, through the PowerShell abstract syntax tree parser in the `contract` job.
- Confirm `application-gate` succeeds as not applicable because only setup/control paths changed.

For the post-merge Windows machine:

- `powershell -ExecutionPolicy Bypass -File .\scripts\ai\install-clis.ps1 -InstallDocker`
- `powershell -ExecutionPolicy Bypass -File .\scripts\ai\install-clis.ps1 -Apply -InstallDocker`
- `powershell -ExecutionPolicy Bypass -File .\scripts\ai\install-control-shortcut.ps1 -Apply`
- `powershell -ExecutionPolicy Bypass -File .\scripts\ai\doctor.ps1 -TestDocker -TestModels`
- `powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Status`

For every application-affecting Pull Request, the path-scoped workflow continues to require:

- `npm ci`
- `npm run lint`
- `npm run build`
- `npm run test:e2e`

These npm commands are replaced atomically by the documented root pnpm commands in `TASK-FOUND-02`.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `c8dd4c69` | `CHANGES_REQUIRED` | Seven P1/P2 findings recorded in PR comment |
| 2 | Correction head on PR #1 | Pending fresh review | PR protection, path scope, immutable review SHA, exact gates, draft blocking, agent authentication and all-ID Work Item validation |

## Residual limitations

Account sign-in, API key entry, Docker Desktop terms/restart and application of GitHub branch protection remain explicit human actions because credentials and legal/admin approvals must not be automated or committed. Guarded commands and deterministic checks are ready. The prototype currently declares an `eslint` script without the `eslint` development dependency; `TASK-FOUND-01` must repair and prove the application baseline before product feature work.

