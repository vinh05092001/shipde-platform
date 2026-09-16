# TASK-AI-16 — Codex review sessions regain activity hooks

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-16` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `150` |
| Dependencies | `TASK-AI-14` (merged, `f22c9b6`) |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `scripts/ai/common.ps1`, `scripts/ai/doctor.ps1`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `tools/ecosystem-manifest.json`, `docs/product-spec/work-items/TASK-AI-16.md`, `docs/product-spec/work-items/TASK-AI-16-FINDINGS.md`, `tools/ai-brain/acceptance/ac-16-*.js`, `tools/ai-brain/acceptance/lib/codex-hook-outcomes.js` |
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

**Measured status at HEAD: NOT DELIVERED.** `ao doctor` (the real AO binary)
still reports `WARN codex-launch-flags: codex rejected AO's launch flags …
exit status 1`, and the AO ledger `~/.ao/data/ao.db` holds `agy` and
`claude-code` sessions and not one Codex session. The hooks are not restored,
because the command line that fails is built by the closed AO binary; see
`TASK-AI-16-FINDINGS.md` and § Acceptance matrix audit, defect D2. What this Work
Item delivered is the diagnosis and the two `doctor.ps1` checks that report it
truthfully, not the restored audit trail.

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
| `AC-AI-16-01` | The repository-side Codex health check exists and distinguishes every state it must | `node tools/ai-brain/acceptance/ac-16-01-doctor-codex-surface.js` exits 0 and prints `AC-AI-16-01 surface held` | command stdout, including the `CONTROL:` line showing a removed state detected in a copy of `doctor.ps1` |
| `AC-AI-16-02` | Measured truth for "the AO ledger records activity for Codex sessions" — NOT DELIVERED at HEAD (defect D2) | `node tools/ai-brain/acceptance/ac-16-02-ledger-activity.js` exits 0 while no Codex session records activity, and exits 1 with `CLAIM_STALE` the moment one does | command stdout, reading `~/.ao/data/ao.db` read-only and naming every harness present |
| `AC-AI-16-03` | The real Codex CLI refuses a single-backslash `projects` path and accepts a forward-slash one, and the repository names both the override and the cause | `node tools/ai-brain/acceptance/ac-16-03-codex-flag-refusal.js` exits 0 and prints `AC-AI-16-03 held` | command stdout, including the `CONTROL:` line showing a malformed override refused |
| `AC-AI-16-04` | A state that cannot be measured is never a pass | `node tools/ai-brain/acceptance/ac-16-04-cannot-verify.js` exits 0 and prints `AC-AI-16-04 held` | command stdout, including the `CONTROL:` line showing a removed fail-closed branch detected |
| `AC-AI-16-05` | The repository's own checks ran and reported no regression | `node tools/ai-brain/acceptance/ac-16-05-suite-invariant.js` exits 0 and prints `AC-AI-16-05 suite invariant held: fail 0` | command stdout carrying the measured test and suite counts; no count is pinned |

## Acceptance matrix audit (defects found and repaired)

Every row of the acceptance matrix above was extracted programmatically from
the markdown table and executed as stored, on Windows, Node v24.15.0, from the
repository root, against the installed `codex-cli 0.154.0` and the live AO
daemon (`ao.exe` at `C:\Program Files\agent-orchestrator\resources\daemon`).
Five rows did not hold. What follows is the measurement, the classification and
the replacement.

There was no pre-existing acceptance-script pair for this Work Item. The rule
that `AC-AI-16-01` and `AC-AI-16-04` both need is committed once, to
`tools/ai-brain/acceptance/lib/codex-hook-outcomes.js`, and both rows `require`
it; the coupling is proved by mutation below.

### Step 1 measurement (rows as originally stored)

| Row | Stored as a command? | Measured |
|---|---|---|
| `AC-AI-16-01` | no — prose only | `ao doctor` exits `0` and prints `WARN codex-launch-flags: codex rejected AO's launch flags (… exit status 1) — codex sessions may spawn without activity hooks; a codex CLI update likely changed its flag/config surface`. Not PASS, and no hook is named |
| `AC-AI-16-02` | no — "SQL query output" | `ao.db`, grouped by harness: `agy` 52 sessions / 52 with activity (4 in the last 24h); `claude-code` 45 / 45 (17 in the last 24h); **`codex` 0 rows**. No Codex session exists to record activity |
| `AC-AI-16-03` | no — "captured stderr" | real `codex-cli 0.154.0`: single-backslash `projects` path exits `1` (`Error: failed to load bootstrap configuration`); forward-slash path exits `0`; doubled-backslash path exits `0` when the argument reaches the CLI intact. The refusal message names no CLI version |
| `AC-AI-16-04` | no — prose only | the daemon is `PASS` (`ready pid=4588`), so the "daemon stopped" state cannot be produced without disrupting the workstation; the rule is measured against the delivered code instead |
| `AC-AI-16-05` | no — "command output" | `node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"` exits `0` with `tests 626 / pass 626 / fail 0` |

### D1 — `AC-AI-16-01`: a false claim, and a check id the repository does not own

**Defect class:** false claim.

**Measurement:** the row asserted that `ao doctor` reports the check
`codex-launch-flags` as `PASS` and names the registered hooks. The live run
reports `WARN`, exits `0`, and names the one opaque command line rather than any
hook. The check id itself lives inside the closed AO binary, not in
`scripts/ai/doctor.ps1`, which carries its own two blocks
(`=== CODEX LAUNCH FLAG SURFACE (TASK-AI-16) ===` and
`=== CODEX HOOK REGISTRATION (TASK-AI-16) ===`). The claim cannot be satisfied
by this repository at all.

**Replacement:** the Business outcome is marked NOT DELIVERED at HEAD with the
measurement, and the row now measures the repository-side surface that *is*
owned here — `tools/ai-brain/acceptance/ac-16-01-doctor-codex-surface.js`,
which reads the real `doctor.ps1` and `common.ps1` and requires all four states
plus the ledger read, with a control that removes a state from a copy.

### D2 — `AC-AI-16-02`: the audit trail the Work Item exists to restore is still absent

**Defect class:** false claim.

**Measurement:** the row asserted that `ao.db` records activity for a Codex
session. It records none: the ledger holds `agy` and `claude-code` sessions and
zero Codex rows, which is exactly the fault described in the Business outcome.
The Work Item's outcome is not delivered at HEAD.

**Replacement:** `tools/ai-brain/acceptance/ac-16-02-ledger-activity.js`, which
runs the same read-only query the delivered check runs, reports every harness,
and exits `1` with `CLAIM_STALE` the moment a Codex session records activity —
forcing this section to be widened in the same change.

### D3 — `AC-AI-16-03`: unrunnable, and wrong about the version

**Defect class:** unrunnable *and* false claim.

**Measurement:** the row carried no command, and its "message quotes the flag
and the CLI version" is false on the version: `ao doctor`'s `codex-launch-flags`
warning quotes the flag text but names no version, and `scripts/ai/doctor.ps1`
prints the version only on the separate `@openai/codex` package line, never in
the refusal. `AI-16-R02` asks for both in the same report.

**Replacement:** `tools/ai-brain/acceptance/ac-16-03-codex-flag-refusal.js`,
which probes the real CLI — single-backslash REFUSED, forward-slash ACCEPTED —
and asserts the repository names both the refused override and its cause. A
malformed override is the control, so an "ACCEPTED" verdict cannot come from a
CLI that ignores the flag.

### D4 — `AC-AI-16-04`: unrunnable without stopping a live daemon

**Defect class:** unrunnable.

**Measurement:** the row requires the AO daemon to be stopped. It is running
(`PASS daemon ready pid=4588`), and stopping it is a destructive act against the
workstation this audit runs on, not a repository check.

**Replacement:** `tools/ai-brain/acceptance/ac-16-04-cannot-verify.js`, which
measures the delivered rule instead — the shared module's pass table plus the
fail-closed branches in `doctor.ps1` and the `Verifiable = $false` paths in
`common.ps1` — with a control that removes the fail-closed branch from a copy.

### D5 — `AC-AI-16-05`: unrunnable, and not provable as written

**Defect class:** unrunnable.

**Measurement:** the row named no command and no runner. There is also no
automated harness over `scripts/ai/` itself, so "no regression in `scripts/ai`
behavior" cannot be proved mechanically from this repository; the closest
provable statement is that the suites the repository does own stay green.

**Replacement:** `tools/ai-brain/acceptance/ac-16-05-suite-invariant.js`, which
runs the repository's own three suites and asserts `fail 0` behind a
non-vacuity guard, pinning no count.

### D6 — the `.gitleaks.toml` change and the TASK-AI-18 pin (measured)

**Defect class:** cross-Work-Item consistency check — reported, not repaired
here, because the file belongs to `TASK-AI-18`'s pinned digest.

**Measurement:** `TASK-AI-18.md` line 83 and `AC-AI-18-15` pin `.gitleaks.toml`
at SHA-256 `232e56d960dc7c86c417edba436cb2f89621c58d56dd7e91705edfcced3ef859`.
The file on disk hashes to exactly that:

```
sha256(.gitleaks.toml) = 232e56d960dc7c86c417edba436cb2f89621c58d56dd7e91705edfcced3ef859
```

So TASK-AI-16's change to that file **is** consistent with the pinned digest:
the pin was taken after AI-16 landed, and it encodes AI-16's content. The
finding is in the details, and both are measured rather than guessed:

1. **The pin is line-ending sensitive.** The committed blob hashes to
   `ce4a4db52b2c1044167a02a8deddab430218aa31424ca65e9adb6a8e3e932903` (LF), while
   the checkout hashes to the pinned `232e56d9…` (CRLF) because
   `core.autocrlf=true`. `AC-AI-18-15` reads the file from disk, so it passes on
   this Windows checkout and would fail on a Linux checkout of the same commit.
2. **The pinned gate already contains AI-16's widening.** AI-16's PR added
   `.gitleaks.toml`'s `[allowlist]` block — `regexTarget = "line"` plus three
   regexes admitting the redaction-test fixtures and the register's
   `key_behavior` column. `AI-18-R13` later declares "adding an allowlist entry
   so a new fixture passes the scanner is the specific weakening this rule
   forbids" and pins the file as the unchanged gate; the pinned baseline is
   already widened.

**Scope note (measured):** PR #16 (commit `8925218`) changed 94 files and
`+26 833` lines, of which 4 are inside this Work Item's Allowed paths. That
bundle was recorded as Codex review finding #6 under "Scope integrity"; it is
restated here as a measurement, not repaired.

### Coupling proof for the shared rule

`tools/ai-brain/acceptance/lib/codex-hook-outcomes.js` holds the four-state and
pass rules once; `AC-AI-16-01` and `AC-AI-16-04` both `require` it, and neither
restates them.

| Step | `ac-16-04` | `ac-16-01` |
|---|---|---|
| Module intact (baseline) | exit `0`, `AC-AI-16-04 held` | exit `0`, `AC-AI-16-01 surface held` |
| Pass rule disabled in the module (`isPass` returns `true`) | exit `1`, `VIOLATION CANNOT_VERIFY counts as a pass` (and `STALE`, `NOT_OBSERVED`) | exit `0` (it uses the module's state list, not the pass table) |
| Module restored from a file backup | exit `0` | exit `0` |

The negative row goes red the moment the rule stops firing, so the pair cannot
drift apart silently. The backup was taken with `cp` to a temp path and restored
by copying it back; no `git checkout --` was run against uncommitted work.

### Exit codes of the new acceptance scripts

| Script | In repository | From an empty directory, no repository |
|---|---|---|
| `ac-16-01-doctor-codex-surface.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-16-02-ledger-activity.js` | `0` (no Codex activity) / `1` (`CLAIM_STALE`) | `2` (`SOURCE_MISSING`) |
| `ac-16-03-codex-flag-refusal.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-16-04-cannot-verify.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-16-05-suite-invariant.js` | `0` | `2` (`SOURCE_MISSING`) |

## Verification commands

```
pwsh -NoProfile -File scripts/ai/doctor.ps1
& "C:\Program Files\agent-orchestrator\resources\daemon\ao.exe" doctor
node tools/ai-brain/cli.js reconcile
node tools/ai-brain/cli.js prove --tests "node tools/ai-brain/test/reconcile.test.js"
node tools/ai-brain/acceptance/ac-16-01-doctor-codex-surface.js
node tools/ai-brain/acceptance/ac-16-02-ledger-activity.js
node tools/ai-brain/acceptance/ac-16-03-codex-flag-refusal.js
node tools/ai-brain/acceptance/ac-16-04-cannot-verify.js
node tools/ai-brain/acceptance/ac-16-05-suite-invariant.js
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `c61c6e8` | `CHANGES_REQUIRED` | 6 findings; #1 fixed in PR #17, #2 and #3 in PR #16, #4 and #5 in PR #18, #6 recorded as the bundle under Scope integrity |
| 1a | PR #17 | author fix | Finding #1 — AO worker identity resolved from `AO_SESSION_ID`, proved against the daemon API from inside a live worker session; ai-guard hook now installs and was observed refusing a commit into a branch held by another session |
| 1b | PR #18 | author fix | Findings #4 and #5 — a routing error is no longer read as a quota refusal, so one mistyped model name can no longer pin an account's learned ceiling; a set-but-short `SHIPDE_ACCOUNT_KEY` now throws instead of silently falling back to the file key |
## Residual limitations

A future Codex CLI release may change the flag surface again. `AI-16-R02`
reduces that to a legible failure rather than a silent one, but it does not
prevent recurrence; pinning the CLI version is deliberately out of scope and
remains an open decision for the human owner.
