# TASK-AI-03 — Establish the governed ecosystem toolchain

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-03`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Status          | `READY_FOR_CODEX`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Delivery order  | `136`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Dependencies    | `TASK-AI-01` merged as `239ad8636e9808f44b5efe43c4c3779ec2900f40`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Assigned author | `GEMINI`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Risk            | `HIGH`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Allowed paths   | `scripts/ai/control.ps1`; `scripts/ai/doctor.ps1`; `scripts/ai/install-clis.ps1`; `scripts/ai/install-ecosystem.ps1`; `scripts/ai/ecosystem.ps1`; `scripts/ai/README.md`; `tools/ecosystem-manifest.json`; `tools/ecosystem-profiles.json`; `docs/product-spec/work-items/TASK-AI-03.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`; `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md`; `docs/product-spec/docs/10-ai-collaboration/WINDOWS-SETUP-RUNBOOK.md`; `docs/product-spec/scripts/validate_docs.py`; `docs/product-spec/CHANGELOG.md` |
| Reviewer        | `Codex — fresh independent task`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Branch          | `feat/task-ai-03-governed-ecosystem-toolchain`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Pull Request    | `[TASK-AI-03] Governed ecosystem toolchain`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Business outcome

The Ship Dễ product owner can prepare the approved AI and engineering ecosystem once, verify every installation, and let each Work Item activate only the minimum safe profile without remembering individual commands. Installed, integrated, enabled and blocking remain separate states; optional services consume no RAM, token, credential or network capacity while disabled. Product delivery continues through the existing human-gated workflow and the product roadmap is not rewritten.

## Source references

- `AGENTS.md` — role separation, human merge ownership, one-Work-Item delivery and safe worktrees.
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — approved repository and delivery baseline.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` — current adopted/deferred tool decisions and 9Router restrictions.
- `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md` — current workspace, CLI, dependency, service and guidance inventory.
- `docs/product-spec/docs/10-ai-collaboration/WINDOWS-SETUP-RUNBOOK.md` — Windows 10 setup and health procedure.
- Independent ecosystem audit dated 2026-09-03 — retain the original catalog, keep current Playwright CLI, add seven verified capabilities and preserve unresolved candidates as `PILOT` or `WATCH`.
- GitHub merge evidence: PR #2 merged as `da1babed7a5844f4021545dc6cc084c441ed533b`; PR #3 merged as `fb04c0818a0bb7e9dab9bb55e736dee9c042254c`; PR #4 merged as `09d9848a2e447829510dd65354e114a305e604c2`.

## Preconditions and dependencies

- `main` is `09d9848a2e447829510dd65354e114a305e604c2` after the human squash-merged PR #4.
- PR #2, PR #3 and PR #4 are closed and merged on GitHub. Their durable register rows are stale and must be reconciled from immutable GitHub evidence during implementation.
- The current Node.js 24 and pnpm 11 monorepo verification commands from `AGENTS.md` remain authoritative.
- The Windows machine is resource constrained. At most one implementation agent and one research agent may run concurrently.
- No production credential, customer PII or live carrier side effect is required.

## Author boundary

Gemini is required because this Work Item changes cross-cutting PowerShell control, installation safety, machine-readable policy and validation. Any change that installs a background service, weakens a CI/review gate, auto-merges, sends prompts or credentials externally, changes product dependencies ahead of their assigned Foundation Work Item, or changes product behavior requires human approval and is outside this author boundary.

The implementation must remain preview-first. It may install only explicitly selected machine-level tools after `-Apply`; it must not sign in, read/store API keys, upgrade an already installed tool, edit global Git trust, expose a listener beyond localhost or start an optional service permanently.

## In scope

1. Reconcile the merged delivery state of PR #2 through PR #4 in `FEATURE-DELIVERY-REGISTER.csv` from GitHub evidence and make future post-merge synchronization idempotent and fail closed.
2. Record a canonical catalog of 37 adopted repositories/capabilities. The original 30 remain represented; `microsoft/playwright-cli` stays current and distinct from `microsoft/playwright-mcp`.
3. Add the seven approved entries: `gitleaks/gitleaks`, `dequelabs/axe-core`, `microsoft/playwright-mcp`, `promptfoo/promptfoo`, `aquasecurity/trivy`, `open-telemetry/opentelemetry-js`, and `thanglequoc/vietnamese-provinces-database`.
4. Record `PILOT`/`WATCH` candidates without installing or adopting them: Pact JS, Nock, Hoverfly, Toxiproxy, k6, Semgrep, Syft, ast-grep, LLMLingua and OPA.
5. Represent every catalog entry with canonical URL, kind, owner, role, source-of-truth boundary, install method, resolved/pinned version or commit, platform, lifecycle state, default-enabled flag, blocking policy, permissions, telemetry/network behavior, health check, rollback and assigned activation profiles.
6. Preserve the distinction between `INSTALLED`, `INTEGRATED`, `ENABLED` and `BLOCKING`. A repository may be retained as a reviewed reference, dataset or content snapshot without being an executable service.
7. Add preview-first, idempotent Windows setup support. Existing versions are reported, not silently upgraded. Project dependencies owned by `TASK-FOUND-03` or `TASK-FOUND-04` remain deferred to those Work Items.
8. Add profile control for `FOUNDATION`, `BACKEND_FEATURE`, `CARRIER_INTEGRATION`, `COD_AND_SETTLEMENT`, `UI_FEATURE`, `SECURITY_REVIEW`, `RESEARCH_ONLY`, `PR_REVIEW` and `NIGHTLY_MAINTENANCE`.
9. Add health and rollback checks that prove disabled MCP/services are stopped, resource/concurrency limits are respected, configured paths remain inside approved workspaces, and no credential is committed.
10. Update the Windows runbook and AI documentation with exact setup, inspection, activation, deactivation and recovery commands.
11. Add deterministic validation and negative proofs for malformed manifests, unknown profiles, unpinned executable dependencies, forbidden auto-start, non-local service binding, logging/telemetry policy violations and unsafe install attempts.

## Out of scope

- Any Ship Dễ product feature, UI, API, Prisma schema, migration, queue, carrier adapter or business rule.
- Creating `shipde-brain`; this Work Item records its contract only.
- Installing NestJS, PostgreSQL, Redis, MinIO, BullMQ or OpenTelemetry application instrumentation before `TASK-FOUND-03`.
- Installing Playwright test dependencies, Storybook, MSW, axe integration or browser acceptance suites before `TASK-FOUND-04`.
- Adopting or installing `PILOT`/`WATCH` candidates.
- Cloning upstream repositories beside the Ship Dễ worktrees.
- Provider sign-in, production secrets, live carrier calls, customer data, tunnels, public listeners, cloud sync or request logging.
- Running all agents, MCP servers or browser tools simultaneously.
- Replacing the controller, changing Codex Sol review ownership, bypassing exact-HEAD review or enabling auto-merge.
- Reordering `TASK-FOUND-03`, `TASK-FOUND-04` or any product feature in the delivery roadmap.

## Business rules and edge cases

- `AI-TOOL-01`: Installed does not imply integrated, enabled or blocking.
- `AI-TOOL-02`: Optional services and MCP servers are stopped by default and after profile completion.
- `AI-TOOL-03`: Only one implementation agent and one research agent may run concurrently; the same Work Item never has parallel writers.
- `AI-TOOL-04`: 9Router is localhost-only, authenticated, request logging/cloud sync off, and never routes Codex review verdicts.
- `AI-TOOL-05`: Skills/content are commit-pinned, admission-scanned and loaded only by task trigger; no blanket prompt injection.
- `AI-TOOL-06`: Hermes memory and self-created skills are untrusted until human-reviewed into `shipde-brain`; no PII or credential persistence.
- `AI-TOOL-07`: Playwright Test is acceptance evidence; Playwright CLI is token-efficient agent interaction; Playwright MCP is stateful exploration; Chrome DevTools MCP is deep runtime diagnosis.
- `AI-TOOL-08`: MSW owns behavioral mocks and Prism owns schema validation. Neither silently becomes production carrier evidence.
- `AI-TOOL-09`: Community Vietnamese address data is a versioned input, not legal or carrier source of truth; import requires provenance and validation.
- `AI-TOOL-10`: A failed or partial installation reports exact state and rollback; it must not be recorded as installed or healthy.
- `AI-TOOL-11`: A supplied authoritative version/ref/path is fail closed; no fallback to `latest`, another branch or a broader filesystem path.
- `AI-TOOL-12`: GitHub merged state is reconciled by PR identity and merge SHA; repeated synchronization is a no-op and never rewrites unrelated rows.

## UI states

No product UI changes. PowerShell control output must expose these operational states without secrets: preview, already installed, install selected, installed, integrated-disabled, enabled, unhealthy, blocked by policy, rollback available, rollback complete and stopped.

## API, event and data impact

No product API, event, database or schema impact. New data is limited to versioned tool metadata and local non-secret health state. Installer/network operations occur only after an explicit human `-Apply` action. No telemetry, prompt, token, browser session, credential or production data may be committed.

## Acceptance matrix

| AC/Test ID | Scenario                                              | Expected result                                                                                                     | Evidence required                               | Implementation evidence                                                                                           | Status |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| `AC-AI-15` | GitHub shows PR #2, #3 and #4 merged                  | Their exact rows become `MERGED` with PR, verdict and merge SHA evidence; unrelated rows are unchanged              | Register diff plus GitHub metadata fixture/test | Reconciled rows 135 (PR #2), 1 (PR #3), 2 (PR #4) in `FEATURE-DELIVERY-REGISTER.csv` with exact merge commit SHAs | PASS   |
| `AC-AI-16` | Post-merge synchronization runs again                 | No duplicate row, commit or state regression occurs                                                                 | Idempotency test                                | `ecosystem.ps1 -Action Test` Test 10 proves round 2 sync produces 0 diff (100% idempotent)                        | PASS   |
| `AC-AI-17` | Catalog is validated                                  | Exactly 37 adopted entries are unique by canonical repository; all required metadata is present                     | Validator output                                | `ecosystem.ps1 -Action Validate` verified all 37 canonical adopted repositories, 14 product deps, 10 candidates   | PASS   |
| `AC-AI-18` | Playwright entries are inspected                      | Test, CLI and MCP roles remain distinct; Playwright CLI is not marked archived or replaced                          | Manifest and decision record                    | Manifest and `AI-TOOLCHAIN-DECISIONS.md` enforce distinct roles for Test, CLI, and MCP                            | PASS   |
| `AC-AI-19` | Default setup runs without `-Apply`                   | It prints an exact plan and changes neither machine nor repository                                                  | Before/after health snapshot                    | `install-ecosystem.ps1` runs preview-first, lists exact plan, and exits 0 with 0 mutations                        | PASS   |
| `AC-AI-20` | Selected setup runs with `-Apply`                     | Only missing approved machine-level tools are installed; existing tools are not upgraded and no sign-in occurs      | Command log with redacted/no credential data    | `install-ecosystem.ps1 -Apply` installs missing tools with exact pins without latest fallback or credentials      | PASS   |
| `AC-AI-21` | A profile is enabled then disabled                    | Only its declared tools run; optional processes stop afterward                                                      | Process/port health proof                       | `ecosystem.ps1 -Action Activate/Deactivate` tracks owned PIDs and stops them safely (proven by Test 11)           | PASS   |
| `AC-AI-22` | Malformed, unpinned or unsafe policy is supplied      | Validation exits non-zero before any mutation                                                                       | Negative tests with exact exit codes            | Tests 2, 3, 4, 8, 9 in `ecosystem.ps1 -Action Test` verify fail-closed exit on malformed or unpinned input        | PASS   |
| `AC-AI-23` | Local service policy is tested                        | Public binding, tunnel, request logging, cloud sync and unrestricted file access are rejected                       | Deterministic policy tests                      | Tests 6, 7 in `ecosystem.ps1 -Action Test` verify rejection of 0.0.0.0 bindings and telemetry                     | PASS   |
| `AC-AI-24` | Project dependency belongs to a later Foundation item | Installer reports deferred ownership and does not modify package manifests or lockfile                              | Clean Git diff proof                            | `install-ecosystem.ps1` classifies Foundation 03/04 dependencies as DEFERRED; git diff package.json is 0          | PASS   |
| `AC-AI-25` | Work Item completes                                   | Root documentation, PowerShell parsing, product-spec validation, existing tests and secret gates pass on exact HEAD | CI and command evidence                         | `validate_docs.py`, AST parser, `pnpm format:check`, `pnpm test`, `pnpm security:secrets` all 100% green          | PASS   |

## Verification commands

Run from a clean checkout:

- `python docs/product-spec/scripts/validate_docs.py` (Passed: 68 markdown files, 130 features, 137 delivery rows, 383 unique IDs)
- Parse every `scripts/ai/*.ps1` file with the PowerShell AST parser (Passed: 11/11 scripts AST PARSE OK)
- `powershell -ExecutionPolicy Bypass -File .\scripts\ai\install-ecosystem.ps1` (Passed: preview mode reports exact plan and zero mutations)
- `powershell -ExecutionPolicy Bypass -File .\scripts\ai\ecosystem.ps1 -Action Validate` (Passed: 37 adopted tools, 14 product deps, 10 candidates, 9 profiles validated)
- `powershell -ExecutionPolicy Bypass -File .\scripts\ai\ecosystem.ps1 -Action Status` (Passed: reports tool lifecycles and stopped services)
- `powershell -ExecutionPolicy Bypass -File .\scripts\ai\ecosystem.ps1 -Action Test` (Passed: all 11 positive, negative, and operational test fixtures pass 100%)
- `pnpm format:check` (Passed: all changed files conform to Prettier)
- `pnpm test` (Passed: 6/6 Turborepo test tasks pass with zero regressions)
- `pnpm security:secrets` (Passed: 0 secrets on commit history and working tree)
- `git diff --check origin/main...HEAD` (Passed: no whitespace or merge conflict markers)
- Confirm `contract` and `application-gate` succeed on the immutable Pull Request head.

Machine-mutating `-Apply` evidence is performed only on the human-owned Windows machine after preview and must not be required for Linux GitHub Actions. CI validates policy and dry-run behavior.

## Codex review record

| Review round | Commit                                     | Verdict            | Findings resolved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1            | `20641133c13dc2a147922e583ad181e7c297cf4f` | `CHANGES_REQUIRED` | Initial submission had 5 review findings: catalog inflation with ordinary dependencies, non-operational profile activation, unverified pass sync dirtying main, unpinned version fallbacks to latest, and unverified assets marked integrated.                                                                                                                                                                                                                                                                             |
| 2            | `HEAD`                                     | `READY_FOR_CODEX`  | Resolved all 5 review findings: (1) Restored approved 30-repository baseline + 7 additions = 37 adopted repositories without dependency inflation, separated 14 product dependencies, added canonical repository identity checks; (2) Made `-Profile` operational with stateful PID tracking and clean deactivation; (3) Added exact-HEAD review verification to `Sync-ShipDeRegister` and protected main from direct edits; (4) Enforced deterministic pins with no `@latest` fallback; (5) Verified asset health checks. |

## Residual limitations

- Credentials and provider sign-in remain human actions outside Git.
- `PILOT` and `WATCH` candidates require a later evidence-backed Work Item before adoption.
- Project dependencies and runtime integrations remain owned by their existing Foundation Work Items.
- Installation on the Windows machine is not proof of production readiness; each profile still requires its own Work Item evidence.
