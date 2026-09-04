# TASK-AI-04 — Restore ecosystem installer compatibility

## Control

| Field           | Value                                                                                                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-04`                                                                                                                                                                                                                                                                                       |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                              |
| Status          | `READY_FOR_AUTHOR`                                                                                                                                                                                                                                                                                 |
| Delivery order  | `137`                                                                                                                                                                                                                                                                                              |
| Dependencies    | `TASK-AI-03` merged through PR #5 as `5ec80ae9ab31999fd88fa784a1c88b8434ece9c2`                                                                                                                                                                                                                    |
| Assigned author | `9ROUTER`                                                                                                                                                                                                                                                                                          |
| Risk            | `LOW`                                                                                                                                                                                                                                                                                              |
| Allowed paths   | `tools/ecosystem-manifest.json`; `scripts/ai/install-ecosystem.ps1`; `scripts/ai/ecosystem.ps1`; `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md`; `docs/product-spec/work-items/TASK-AI-04.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | `Codex — fresh independent task`                                                                                                                                                                                                                                                                   |
| Branch          | `fix/task-ai-04-ecosystem-installer-compatibility`                                                                                                                                                                                                                                                 |
| Pull Request    | `[TASK-AI-04] Restore ecosystem installer compatibility`                                                                                                                                                                                                                                           |

## Business outcome

On the approved Windows 10 development machine, the Ship Dễ product owner can run the governed ecosystem installer in Preview and receive accurate, fail-closed inventory results for the already installed Snyk Agent Scan and Promptfoo tools. The hotfix removes a false Agent Scan version mismatch and adopts the Promptfoo version that is compatible with the governed Node.js/Windows baseline without installing, upgrading, uninstalling or scanning anything during implementation verification.

## Problem statement

`TASK-AI-03` established a preview-first ecosystem installer and exact-version policy in merged PR #5. Two compatibility findings remain on the confirmed machine baseline:

1. Snyk Agent Scan `0.6.1` is installed and functional, but `scripts/ai/install-ecosystem.ps1` calls an unsupported `snyk-agent-scan --version` form. Version parsing therefore returns no value and the installer reports the installed package as `unknown` and mismatched.
2. The governed manifest pins Promptfoo `0.111.0`, but that release cannot be installed on the confirmed Node.js `24.15.0` and Windows combination because `better-sqlite3` has no usable prebuilt binary and falls back to a native `node-gyp` build requiring Visual Studio C++ Build Tools. Promptfoo `0.122.2` installs successfully and is the version already present, so the intentional temporary mismatch must be resolved in governance.

The correction must preserve the existing npm-global package metadata path because it already identifies tools whose command-line version output is noisy or absent, including Renovate and Stoplight Prism.

## Confirmed evidence

- Host baseline: Windows 10, Node.js `24.15.0`, npm `11.12.1`.
- `snyk-agent-scan` is installed and functional at `0.6.1`; `snyk-agent-scan help` displays `Snyk Agent Scan v0.6.1`.
- The existing Agent Scan detector invokes `snyk-agent-scan --version`, receives no parseable semantic version and reports `unknown`.
- `promptfoo@0.111.0` failed during `better-sqlite3` installation after no usable prebuilt binary was available and `node-gyp` required Visual Studio C++ Build Tools.
- `promptfoo@0.122.2` installed successfully; npm global package metadata reports exactly `0.122.2`.
- npm global package metadata reports Renovate `39.191.0`, Repomix `0.3.3`, `@stoplight/prism-cli` `5.12.0`, Context7 `0.5.9` and `@playwright/cli` `0.1.2`.
- Renovate can warn that `re2` is unavailable and fall back to RegExp while still reporting its expected installed version.
- `prism --version` may not produce a useful value; npm metadata correctly identifies `@stoplight/prism-cli@5.12.0`.
- `TASK-AI-03` was human-merged through PR #5 as commit `5ec80ae9ab31999fd88fa784a1c88b8434ece9c2`. This Work Item is a narrow follow-up to its `AC-AI-19`, `AC-AI-20`, `AI-TOOL-10` and `AI-TOOL-11` guarantees.

## Source references

- `AGENTS.md` — planning/implementation separation, 9Router author boundary, one-Work-Item delivery, verification and human-only merge.
- `docs/product-spec/AGENTS.md` — repository-local role separation and current verification authority.
- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — approved baseline and change control; no product-domain decision is changed.
- `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md` and `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md` — product scope remains unchanged; Feature ID is `N/A`.
- `docs/product-spec/work-items/TASK-AI-03.md` — `AC-AI-19` preview immutability, `AC-AI-20` install-only-missing behavior, `AI-TOOL-10` accurate partial-state reporting and `AI-TOOL-11` exact-pin fail-closed behavior.
- [PR #5](https://github.com/vinh05092001/shipde-platform/pull/5) / merge `5ec80ae9ab31999fd88fa784a1c88b8434ece9c2` — durable implementation and merge evidence for `TASK-AI-03`.
- `tools/ecosystem-manifest.json` — machine-readable source of truth for Agent Scan `0.6.1`, the temporary Promptfoo `0.111.0` pin and unchanged neighboring tool pins.
- `scripts/ai/install-ecosystem.ps1` — Agent Scan CLI-based version detection, npm-global metadata inventory, missing/mismatch classification and Preview output.
- `scripts/ai/ecosystem.ps1` — existing deterministic ecosystem validation and installer negative proofs.
- `docs/product-spec/docs/10-ai-collaboration/REPOSITORY-CLI-MANIFEST.md`, **Machine-wide CLI layer** — human-readable Promptfoo installation policy that must remain aligned with the machine-readable pin.

## Preconditions and dependencies

- `TASK-AI-03` is merged through PR #5 at `5ec80ae9ab31999fd88fa784a1c88b8434ece9c2` and supplies the installer, manifest and test harness being corrected.
- The confirmed installed versions are evidence for the compatibility target, not authorization to mutate the machine.
- The author starts from this prepared branch through the human-triggered controller and changes only the allowed paths.
- No product application dependency, package manifest, lockfile, credential or live MCP configuration is needed.

## Author boundary

`9ROUTER` is appropriate because the behavior is fully specified, the file set is explicit, the change is local to version inventory, and deterministic fixtures can prove every positive and negative path. The author may update only the six allowed paths and must stop if completion would require architecture changes, authentication, a Snyk token, a security scan, application dependencies, product UX, tenant data, money, carrier behavior, machine installation or an external side effect.

Deterministic proof must not depend solely on the author's machine state. Tests must isolate command discovery and metadata output with controlled fixtures, perform no network request, and demonstrate that install/upgrade commands were not invoked for already installed packages.

## In scope

1. Change the machine-readable Promptfoo pin from exactly `0.111.0` to exactly `0.122.2` and align the corresponding machine-wide CLI documentation. No other tool version may change.
2. Detect Snyk Agent Scan through installed Python package metadata using `python -m pip show snyk-agent-scan` and parse the exact `Version:` field. Do not execute `snyk-agent-scan`, a scan command or an MCP inspection to determine its version.
3. Keep missing, installed and mismatched Agent Scan states distinct. Missing or malformed metadata must not be treated as installed or compatible.
4. Preserve npm-global metadata verification through `npm list --global --depth=0 --json` and the existing package-name mapping for Promptfoo, Renovate, Repomix, Stoplight Prism, Context7, Playwright CLI and every other npm-global tool.
5. Make installer invocation and deterministic fixtures work when the repository, manifest, script, executable fixture or output path contains spaces.
6. Add or update deterministic tests for correct Agent Scan detection, the new Promptfoo pin, missing-tool reporting, mismatch fail-closed behavior, Preview immutability, and preservation of installed tools without reinstall or upgrade.
7. Produce a final non-mutating Preview in which Snyk Agent Scan and Promptfoo are each listed as `[OK]` and the `VERSION MISMATCHED TOOLS` section is exactly `None`.

## Out of scope

- Installing, uninstalling, repairing or upgrading any machine-level tool.
- Installing Visual Studio, Visual Studio Build Tools, a C++ toolchain, Python, Node.js, npm or native build prerequisites.
- Running Snyk Agent Scan against MCP configurations, skills, prompts, repositories or any other target.
- Authentication, reading `SNYK_TOKEN`, sign-in, credential storage, telemetry changes or outbound Snyk requests.
- Adding application dependencies or modifying any `package.json`, `pnpm-lock.yaml`, `package-lock.json`, workspace manifest or lockfile.
- Installing Lighthouse, Storybook, `openapi-typescript`, Lefthook, Gitleaks or Trivy.
- Changing any version other than the governed Promptfoo pin from `0.111.0` to `0.122.2`.
- Changing lifecycle states, profiles, tool permissions, network policy, optional service activation or product behavior.
- Refactoring the complete installer, test harness or ecosystem catalog.
- Updating unrelated documentation, roadmap rows or Work Items.
- Running a real-machine `-Apply`; only controlled, non-mutating command fixtures may exercise that branch for fail-closed proof.

## Business rules and edge cases

- `AI-COMPAT-01`: Agent Scan version detection reads local installed-package metadata only. It must not run a security scan, access MCP configurations, authenticate or make a network request.
- `AI-COMPAT-02`: Only an exact, parseable `Version:` value of `0.6.1` is accepted for Agent Scan. Empty output, command failure, missing `Version:`, malformed versions and every other version remain missing or mismatched as appropriate; they never become `[OK]`.
- `AI-COMPAT-03`: Promptfoo is compatible only when npm global metadata reports exact version `0.122.2`. CLI banner output is not substituted for authoritative npm metadata.
- `AI-COMPAT-04`: A discovered version that differs from its pin remains `VERSION_MISMATCH`, and `-Apply` must fail closed without installing, upgrading, overwriting or uninstalling that tool.
- `AI-COMPAT-05`: Absence of a command or package metadata remains `MISSING`; it must not be collapsed into a mismatch or success.
- `AI-COMPAT-06`: Preview performs zero repository and machine mutations regardless of missing, matching or mismatched tool state.
- `AI-COMPAT-07`: An already installed exact version is preserved. Neither Preview nor `-Apply` may reinstall or upgrade it.
- `AI-COMPAT-08`: Paths and process arguments are passed as discrete values and remain correct when they include spaces. Tests must exercise an isolated temporary root whose name contains at least one space.
- `AI-COMPAT-09`: Warnings or unusable CLI output from Renovate or Prism do not override valid npm metadata. The existing npm-global metadata path and all unrelated pins remain unchanged.
- `AI-COMPAT-10`: Version detection failures are reported without leaking environment variables, credentials, package-manager configuration or unrelated filesystem paths.

## UI states

No product UI changes. The affected PowerShell output must retain these operational states:

- **Installed:** `[OK] Snyk Agent Scan` with `0.6.1` and `[OK] Promptfoo` with `0.122.2`.
- **Missing:** the tool remains in `MISSING MACHINE-LEVEL TOOLS PLAN`; Preview does not act on it.
- **Mismatch:** the tool remains under `VERSION MISMATCHED TOOLS` with observed and expected versions and no automatic mutation.
- **Preview success:** the existing explicit zero-mutation notice remains present.
- **Final confirmed-machine Preview:** Agent Scan and Promptfoo are `[OK]`; `VERSION MISMATCHED TOOLS` prints `None`.

## API, event and data impact

No product API, event, database, schema, migration, job, UI or tenant-data impact. The only governed data change is Promptfoo's exact version pin in the ecosystem catalog and its matching human-readable CLI inventory. Installer behavior changes only how local Agent Scan package metadata is read. Compatibility is preserved for all existing parameters and for npm-global version detection.

## Acceptance matrix

| AC/Test ID | Scenario                                                                                                                                                                           | Expected result                                                                                                                                                                       | Evidence required                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `AC-AI-26` | Controlled `python -m pip show snyk-agent-scan` output contains `Name: snyk-agent-scan` and `Version: 0.6.1`                                                                       | Agent Scan is listed as `[OK]` at `0.6.1`; no Agent Scan executable or scan action is invoked                                                                                         | Deterministic fixture with invocation log and installer output assertion                        |
| `AC-AI-27` | Manifest and npm metadata both report Promptfoo `0.122.2`                                                                                                                          | Promptfoo is accepted as the exact pin and listed as `[OK]`; `0.111.0` is absent from governed Promptfoo policy                                                                       | Manifest/document assertions and deterministic npm metadata fixture                             |
| `AC-AI-28` | Agent Scan or an npm-global tool is absent from controlled command/package metadata                                                                                                | Each absent tool remains reported in `MISSING MACHINE-LEVEL TOOLS PLAN`, never `[OK]`                                                                                                 | Deterministic missing-tool fixtures and output assertions                                       |
| `AC-AI-29` | Controlled metadata reports a real version different from its exact pin                                                                                                            | Tool remains under `VERSION MISMATCHED TOOLS`; `-Apply` exits non-zero and no install, upgrade, overwrite or uninstall command runs                                                   | Agent Scan and npm mismatch fixtures, exit-code checks and package-manager invocation log       |
| `AC-AI-30` | Preview runs with matching, missing and mismatched fixture states                                                                                                                  | Exit is non-mutating; repository fixture hashes/status and simulated machine/package state are identical before and after                                                             | Before/after snapshots from a deterministic isolated fixture                                    |
| `AC-AI-31` | `-Apply` is exercised only against controlled exact-version fixtures                                                                                                               | Existing Agent Scan, Promptfoo and representative npm tools are preserved without reinstall or upgrade                                                                                | Stub invocation log proving zero `pip install`, `npm install`, uninstall or upgrade calls       |
| `AC-AI-32` | Installer, manifest, fixture executables and redirected outputs reside below a path containing spaces                                                                              | Detection and classification results remain correct with no quoting or truncation failure                                                                                             | Deterministic path-with-spaces test on Windows PowerShell 5.1                                   |
| `AC-AI-33` | Renovate `39.191.0`, Repomix `0.3.3`, Prism `5.12.0`, Context7 `0.5.9` and Playwright CLI `0.1.2` are supplied through npm metadata while CLI output is noisy, missing or unusable | All remain `[OK]` from npm metadata; no detector regresses to CLI banner parsing                                                                                                      | Deterministic npm JSON fixture covering package-name mappings and noisy CLI stubs               |
| `AC-AI-34` | Final targeted Preview runs on the confirmed machine without `-Apply`                                                                                                              | Snyk Agent Scan and Promptfoo are `[OK]`, `VERSION MISMATCHED TOOLS` is `None`, no scan runs, and before/after repository and package inventories are unchanged                       | Redacted command output plus before/after `git status`, npm-global and pip inventory comparison |
| `AC-AI-35` | Work Item completes on an immutable implementation head                                                                                                                            | Documentation validation, manifest validation, PowerShell parsing, deterministic ecosystem tests, formatting, tests and secret scan all pass; changed paths stay within the allowlist | Exact command logs, changed-file list, CI and fresh independent Codex review                    |

## Verification matrix

| Verification                      | Command or method                                                                                                                              | Required result                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Documentation structure           | `python docs/product-spec/scripts/validate_docs.py`                                                                                            | Pass with no missing files, invalid register status/order or broken internal link                                    |
| Manifest contract                 | `powershell -ExecutionPolicy Bypass -File .\scripts\ai\ecosystem.ps1 -Action Validate`                                                         | 37 adopted tools, 14 product dependencies, 10 candidates and 9 profiles remain valid; only Promptfoo changes version |
| Deterministic compatibility suite | `powershell -ExecutionPolicy Bypass -File .\scripts\ai\ecosystem.ps1 -Action Test`                                                             | All existing tests plus `AC-AI-26` through `AC-AI-33` pass without network or real package mutation                  |
| PowerShell syntax                 | Parse every `scripts/ai/*.ps1` file with `[System.Management.Automation.Language.Parser]::ParseFile(...)`                                      | Zero parse errors                                                                                                    |
| Final targeted Preview            | `& .\scripts\ai\install-ecosystem.ps1 -Tools @("agent-scan", "promptfoo")`                                                                     | Both tools are `[OK]`; `VERSION MISMATCHED TOOLS` is `None`; Preview zero-mutation notice is present                 |
| Repository immutability           | Compare `git status --porcelain=v1` and hashes of tracked files immediately before and after final Preview                                     | No Preview-created or Preview-modified repository file                                                               |
| Machine package immutability      | Compare `npm list --global --depth=0 --json`, `python -m pip show snyk-agent-scan` and controlled invocation evidence before and after Preview | Installed package versions are unchanged; no install/uninstall/upgrade command or scan executed                      |
| Repository quality                | `pnpm format:check`; `pnpm test`; `pnpm security:secrets`; `git diff --check origin/main...HEAD`                                               | All pass on the immutable implementation head                                                                        |
| Scope audit                       | `git diff --name-only origin/main...HEAD` and version-pin diff inspection                                                                      | Only allowed paths changed; only Promptfoo's governed version changed                                                |

All commands run from a clean checkout. The final Preview is non-mutating and must not include `-Apply`. Logs must be redacted if local paths or configuration expose user-specific information.

## Rollback plan

If the implementation causes a regression before merge, the author reverts only its changes on the same Work Item branch, reruns the full verification matrix and updates the same Pull Request. If a regression is discovered after merge, the human opens a governed revert that restores the prior Promptfoo pin, Agent Scan detector and tests together; the installer remains Preview-only while the revert is reviewed.

No machine rollback is expected because this Work Item authorizes no installation, upgrade, uninstall or scan. If any such mutation occurs, stop immediately, record the exact command and observed package inventories, and escalate to the human rather than attempting an ungoverned repair. The safe manual diagnostic fallback is metadata inspection only: `python -m pip show snyk-agent-scan` and `npm list --global --depth=0 --json`.

## Security considerations

- `python -m pip show snyk-agent-scan` reads local distribution metadata and must not consume `SNYK_TOKEN`, authenticate, upload content or inspect MCP configurations.
- Never execute Agent Scan as a health check in this Work Item. A help/banner observation is confirmed evidence only, not the implementation mechanism.
- Parse only the exact `Version:` metadata field and validate it as a strict semantic version. Ambiguous, malformed or conflicting output fails closed.
- Preserve stdout/stderr hygiene: do not print environment variables, npm configuration, Python configuration, credentials, prompt contents, MCP configuration or customer data.
- Deterministic tests use synthetic metadata and command stubs under isolated temporary directories. They must neither shadow commands outside the test process nor persist machine state.
- Existing exact-pin, preview-first and preserve-without-upgrade guarantees from `TASK-AI-03` remain mandatory.

## Codex review record

| Review round | Commit                      | Verdict           | Findings resolved                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | --------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1            | TBD (pending commit)        | CHANGES_REQUIRED  | **Blocking:** Test 15b used production port 20128 while user-managed 9Router service was already listening, causing environment-dependent failure. **Resolution:** Refactored Tests 15a, 15b, and 15c to use isolated dynamically selected loopback ports (29114, 29115, 29117-29118) via new `TestPortOverrides` parameter. All 21 ecosystem tests now pass deterministically while preserving real 9Router on production port 20128. Also fixed Python mock fixtures in Tests 16-19 to use proper CMD batch file escaping for Windows compatibility. |

## Residual limitations

- Compatibility is governed for the confirmed Windows 10, Node.js `24.15.0` and npm `11.12.1` baseline. A future Node.js or package-manager upgrade requires separate evidence and governance.
- Promptfoo `0.122.2` being installable and inventory-compatible does not authorize live prompt evaluation, provider credentials or production use.
- Agent Scan being detectable does not authorize a scan or prove that any MCP configuration is safe.
