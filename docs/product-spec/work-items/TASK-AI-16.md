# TASK-AI-16 — Codex review sessions regain activity hooks

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-16` |
| Feature ID | `N/A` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `150` |
| Dependencies | `TASK-AI-14` (merged, `f22c9b6`) |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `scripts/ai/common.ps1`, `scripts/ai/doctor.ps1`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `tools/ecosystem-manifest.json` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-16-codex-launch-flags` |
| Pull Request | `<URL>` |

## Business outcome

The human merge owner can see what the independent reviewer did. Codex is the
only identity whose `PASS` counts as durable evidence under `AI-TOOL-04`, and a
Codex session that runs without activity hooks leaves no trace in `ao.db` — the
supervisor cannot tell whether a review happened, took an unexpected path, or
stalled. Restoring the hooks restores the one audit trail the merge gate rests
on.

## Source references

- `AGENTS.md` § Role separation — Codex as independent reviewer; author never
  approves its own work.
- `AGENTS.md` § Unit of delivery — required status flow through `READY_FOR_CODEX`.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-04` — 9Router never routes
  Codex review verdicts.
- `scripts/ai/control.ps1` — `Assert-ShipDeReviewTarget`,
  `Get-ShipDeAoExactHeadCodexVerdict`, `$script:TrustedCodexReviewerLogins`.
- `ao doctor` output, check id `codex-launch-flags`.

## Preconditions and dependencies

- Agent Orchestrator daemon reachable (`ao doctor` reports `PASS daemon`).
- `codex` resolves on `PATH`; observed version `codex-cli 0.154.0`.
- Observed failure, 2026-09-14:

  ```
  WARN codex-launch-flags: codex rejected AO's launch flags
       (`codex features list -c check_for_update_on_startup=false
         -c notice.hide_rate_limit_model_nudge=true
         -c hooks.SessionStart=[...] ...`: exit status 1)
       — codex sessions may spawn without activity hooks
  ```

- `hooks.log` records no delivery failure since 2026-09-09, so the fault is in
  the launch surface rather than in hook delivery.

## Author boundary

`9ROUTER` is appropriate: the change is bounded to configuration flags in two
PowerShell files, the correct flag set is discoverable by running the CLI, and
success is provable deterministically by `ao doctor`. It touches no
architecture, authentication, tenancy, money, carrier behavior or product UX.

Prohibited in this Work Item: editing `control.ps1` review logic, changing
`$script:TrustedCodexReviewerLogins`, altering any verdict or merge gate, and
weakening a hook to make the check pass. If the supported flag surface cannot
express one of the four hooks, stop and escalate to `GEMINI` rather than
dropping that hook.

## In scope

- Determine the flag and config surface accepted by `codex-cli 0.154.0`.
- Update the Codex launch invocation so `SessionStart`, `UserPromptSubmit`,
  `PermissionRequest` and `Stop` hooks are registered.
- Keep the invocation working when the installed Codex version differs: detect
  and adapt, or fail loudly with the version and the rejected flag.
- Extend `doctor.ps1` so the check reports which hooks were actually registered,
  not only that the command exited zero.
- Record the version dependency in `AI-TOOLCHAIN-DECISIONS.md`.

## Out of scope

- Any change to review verdict parsing, exact-HEAD binding or merge preflight.
- Upgrading or pinning the Codex CLI itself.
- Hooks for any other harness.
- The `ao-binary not found in PATH` warning, which is separate and benign.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-16-R01` | A Codex session must not start when hooks cannot be registered; refuse and report, rather than start unobserved. |
| `AI-16-R02` | A rejected flag is reported with the exact flag text and the CLI version, so the next breakage is diagnosable without re-deriving it. |
| `AI-16-R03` | Hook registration is verified by observing a recorded activity event, not by the launch command's exit code. |
| `AI-16-R04` | The daemon being stopped is reported as "cannot verify", never as a pass. |
| `AI-16-R05` | No hook may be dropped to make the check succeed. |

## UI states

Not applicable; this Work Item has no user-facing screen. Operator-facing
output is `ao doctor`, which must distinguish: all hooks registered; some
registered with the missing ones named; cannot verify because the daemon is
stopped; and rejected with the flag text quoted.

## API, event and data impact

No schema, migration or API change. The observable effect is that rows appear
in `ao.db` `sessions.activity_last_at` and `conversation_activities` for Codex
sessions, as they already do for `claude-code` and `agy`.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-16-01` | Run `ao doctor` with Codex installed | `codex-launch-flags` reports PASS and names the registered hooks | doctor output |
| `AC-AI-16-02` | Start a Codex session through AO, submit one prompt | `ao.db` records activity for that session | SQL query output showing the session row and its `activity_last_at` |
| `AC-AI-16-03` | Simulate a rejected flag | Launch refuses, message quotes the flag and the CLI version | captured stderr |
| `AC-AI-16-04` | Stop the daemon, run `ao doctor` | Reports "cannot verify", not PASS | doctor output |
| `AC-AI-16-05` | Run existing repository checks | No regression in `scripts/ai` behavior | command output |

## Verification commands

```
pwsh -NoProfile -File scripts/ai/doctor.ps1
& "C:\Program Files\agent-orchestrator\resources\daemon\ao.exe" doctor
node tools/ai-brain/cli.js reconcile
node tools/ai-brain/cli.js prove --tests "node tools/ai-brain/test/reconcile.test.js"
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

A future Codex CLI release may change the flag surface again. `AI-16-R02`
reduces that to a legible failure rather than a silent one, but it does not
prevent recurrence; pinning the CLI version is deliberately out of scope and
remains an open decision for the human owner.
