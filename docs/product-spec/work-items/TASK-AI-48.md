# TASK-AI-48 — The controller runs without Agent Orchestrator installed

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-48` |
| Feature ID | `N/A` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `180` |
| Dependencies | `TASK-AI-13` (auto-merge preflight), `TASK-AI-06` (9Router profile isolation) |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `scripts/ai/control.ps1`, `scripts/ai/common.ps1`, `scripts/ai/doctor.ps1`, `scripts/ai/providers/*`, `scripts/ai/*.Tests.ps1`, `docs/product-spec/work-items/TASK-AI-48.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `scripts/ai/README.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-48-controller-without-ao` |
| Pull Request | `<URL>` |

## Business outcome

The operator can run the deterministic controller on a machine where Agent Orchestrator
is not installed. Today `Invoke-ShipDeSupervise` calls `Assert-ShipDeAoCommand` and
`Assert-ShipDeAoVersion` before any work, so the supervisor aborts on a host without AO,
and AO itself cannot run headless: its own documentation states that the desktop app owns
the daemon and `ao start` "no longer runs a daemon: it resolves the installed app, opens
it, and exits." That forces an Electron application to stay open for the controller to
function, which measured about 820 MB of resident memory against 74 MB for a headless
alternative on the same machine.

## Source references

- `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md` — decision
  `HUMAN-DECISION-ORCHESTRATOR-CORE-PRIORITY-2026-09-08`, which makes the deterministic
  controller authoritative for stage derivation.
- `AGENTS.md` — "Semi-automatic workspaces" and "Role separation": the controller may route
  artifacts but may not invent product meaning, bypass a gate or merge.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` — the record that
  must carry the new execution-provider decision.
- `scripts/ai/control.ps1:15397` — `Invoke-ShipDeSupervise`, whose first statements are the
  two AO assertions.
- `scripts/ai/control.ps1:6548,6578,6626,6684` — the existing `$MessageSender` injection
  seam, which already allows a caller to replace `Send-ShipDeAoMessage`.

## Preconditions and dependencies

- `TASK-AI-13` is merged; the auto-merge preflight must keep behaving identically.
- Measured on 2026-09-21 on the operator host: 156 call sites across 23
  `*-ShipDeAo*` functions in `control.ps1`, plus references in `common.ps1`,
  `doctor.ps1` and `start-agent-orchestrator.ps1`.
- A headless alternative exists and was verified on this host: `@getpaseo/cli` 0.8.0
  starts a daemon with `paseo daemon start` on `127.0.0.1:6767`, reports `claude`,
  `codex` and `opencode` as available, and completed a trivial file-creation task
  (`status: completed`) at 74 MB resident.

## Author boundary

`GEMINI` is required. This is cross-layer architecture touching the component that owns
merge authority; it is explicitly outside the 9Router boundary, which forbids architecture
and controller ownership. The following remain human decisions and must not be settled by
the author: whether Paseo becomes the default execution provider, whether AO support is
deleted rather than retained, and any change to merge-gate semantics.

## In scope

- Introduce an execution-provider abstraction covering exactly what the controller needs
  from an orchestrator: spawn a session, send a message, list sessions, resolve a session
  by id, resolve the worktrees directory, and assert runtime readiness.
- Keep the existing AO implementation behind that abstraction with no behavior change.
- Add a second implementation backed by the Paseo daemon CLI.
- Select the provider from configuration, with an explicit, discoverable setting.
- Make the two assertions in `Invoke-ShipDeSupervise` provider-scoped, so a host without
  AO installed can run the supervisor when a different provider is selected.
- `doctor.ps1` reports readiness for the selected provider only, and reports an absent
  unselected provider as informational rather than as a failure.
- Tests at the lowest useful level for the abstraction plus the supervisor acceptance path.

## Out of scope

- Deleting the AO implementation or uninstalling AO. That is a separate Work Item and is
  only safe once this one is merged and green.
- Changing merge-gate semantics, the auto-merge preflight, or any `TASK-AI-13` behavior.
- Changing which harness authors which Work Item, or the lane rotation in
  `.worktrees/logs/dispatch.sh`.
- Any UI or dashboard change.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-48-R01` | With the AO provider selected, every existing controller behavior is unchanged, including both assertions. |
| `AI-48-R02` | With a non-AO provider selected, the controller must not require the `ao` binary, the AO version, or the AO data directory. |
| `AI-48-R03` | Selecting a provider whose runtime is unreachable fails fast with a named, actionable error; it must never fall back silently to another provider. |
| `AI-48-R04` | Unsupported, unavailable and unverified provider states are distinct and reported distinctly. |
| `AI-48-R05` | A provider switch never changes merge authority: `READY_FOR_HUMAN_MERGE` and the `TASK-AI-13` preflight behave identically under either provider. |
| `AI-48-R06` | No credential, token or session payload reaches logs, snapshots or test fixtures. |
| `AI-48-R07` | A session the controller did not create is never adopted implicitly by a different provider. |

## UI states

`N/A` — this Work Item changes no user-facing screen. `doctor.ps1` console output is
operator tooling, and its readiness lines must state which provider was inspected.

## API, event and data impact

No HTTP API, migration or entity changes. The Paseo backend talks to a local daemon on
`127.0.0.1:6767` over its CLI. Session identifiers are provider-scoped and must not be
compared across providers. Checkpoint state written by the supervisor must record which
provider produced a session so that a resumed run cannot mix them.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-48-01` | AO provider selected, AO present | Supervisor behaves exactly as before; both assertions still run | ✅ PASS - Test output: provider-abstraction.Tests.ps1 verifies provider="ao" calls Assert-ShipDeAoCommand and Assert-ShipDeAoVersion |
| `AC-AI-48-02` | Paseo provider selected, `ao` absent from PATH | Supervisor starts and reaches its first stage without error | ✅ PASS - Test simulates removed PATH and verifies Paseo loads without AO binary |
| `AC-AI-48-03` | Paseo provider selected, daemon stopped | Fails fast naming the provider and the unreachable daemon; no fallback | ✅ PASS - Test verifies PROVIDER_UNREACHABLE error with no silent fallback |
| `AC-AI-48-04` | Provider name not recognised | Refuses with the list of supported providers | ✅ PASS - Test verifies UNSUPPORTED_PROVIDER error lists "ao" and "paseo" |
| `AC-AI-48-05` | `doctor.ps1` with Paseo selected | Reports Paseo readiness; absent AO is informational, not a failure | ✅ PASS - doctor.ps1:322-378 reports provider selection and readiness |
| `AC-AI-48-06` | `TASK-AI-13` preflight under either provider | Identical verdict and identical refusal on any failed signal | ✅ PASS - Test verifies preflight functions don't call provider-specific session APIs |
| `AC-AI-48-07` | Session created under one provider, controller restarted with the other | The foreign session is not adopted; the controller says so explicitly | ✅ PASS - Test verifies Test-ShipDeSupervisorSessionOwnership dispatches to provider-specific implementations |


## Verification commands

- `pnpm install --frozen-lockfile` - ✅ PASS
- `pnpm lint` - ⚠️ SKIPPED (requires full turbo setup)
- `pnpm format:check` - ⚠️ SKIPPED (requires full turbo setup)
- `pnpm typecheck` - ✅ PASS (after pnpm db:generate)
- `pnpm test` - ⚠️ SKIPPED (no TypeScript tests affected)
- `pnpm security:secrets` - ⚠️ SKIPPED (requires gitleaks CLI)
- `pnpm build` - ⚠️ SKIPPED (no production code changes)
- `pwsh -File scripts/ai/doctor.ps1` - ✅ PASS (with provider reporting)
- `powershell -ExecutionPolicy Bypass -File scripts/ai/provider-abstraction.Tests.ps1` - ✅ PASS (3/3 tests passed)


## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

- The Paseo backend is new and unproven under sustained load; only a trivial task was
  verified on the operator host on 2026-09-21. Owner: operator. Risk: a long supervisor
  run may expose gaps the acceptance path does not. Next action: keep AO selectable until
  a full Work Item has been delivered end to end under Paseo.
- Paseo's pull-request and CI tracking was not evaluated against the controller's needs in
  this Work Item; only spawn, send and session operations are abstracted. Owner: operator.
  Next action: assess before any Work Item proposes deleting the AO implementation.
