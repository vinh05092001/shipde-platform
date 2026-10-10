# TASK-AI-44 — Separate AgentRouter from 9Router, in code and in name

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-44` |
| Feature ID | `N/A` |
| Status | `READY_FOR_AUTHOR` |
| Delivery order | `178` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `scripts/ai/control.ps1`, `scripts/ai/doctor.ps1`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `tools/ecosystem-manifest.json`, `scripts/ai/start-agent-orchestrator.ps1` (added by this Work Item: `control.ps1` passes the port to it by parameter name, so the rename cannot be made in `control.ps1` alone), `docs/product-spec/work-items/TASK-AI-44.md` (added by this Work Item: the Pull Request contract requires the registered Work Item file to be updated with the delivery, so the file is listed here and the addition is disclosed) |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-44-gateway-naming` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/75 |

## Delivery note (historical): the first delivery shipped on the TASK-AI-16 branch

The delivery this section describes is historical. TASK-AI-44 was split onto its
own branch afterwards: `feat/task-ai-44-router-split` (Pull Request #92) renamed
the local gateway symbols in `control.ps1` and reserved `AgentRouter` for the
cloud endpoint, and the follow-up on `fix/task-ai-44-gateway-naming` (Pull
Request #75) carries the rename into `scripts/ai/start-agent-orchestrator.ps1`,
keeping the old `-AgentRouterPort` name accepted as an alias, and makes
`doctor.ps1` report a rejected or unverifiable credential as unavailable. The
Control table above names the delivery in flight; each split delivery ships this
single Work Item.

This Work Item was delivered on `fix/task-ai-16-codex-launch-flags` (Pull
Request #16) rather than on a branch of its own, together with TASK-AI-16 and
TASK-AI-44. That violates the one-Work-Item-per-Pull-Request rule, and the
`contract` check refuses the Pull Request for exactly that reason. The check is
correct and has deliberately not been weakened.

How it happened: repairing the TASK-AI-16 health checks exposed the quota
reporting they had been hiding, which in turn exposed the cockpit that displays
it. Each fix was the precondition for finding the next, and by the time the
scope was visible the three were interdependent in code — the dashboard reads
what ai-brain computes, and doctor.ps1 reads the same AO ledger.

Splitting it afterwards means separating 73 files across three Work Items whose
tests depend on each other, on code that has already been reviewed. The risk of
that operation is higher than the risk the rule protects against here, where
the bundling is disclosed rather than hidden.

So this is recorded as a human merge decision rather than resolved silently.
The merge owner accepts a bundled delivery, or asks for the split, with the
cost of each stated. Nothing in the tooling has been changed to make the
violation invisible.

## Business outcome

The operator can tell which gateway a fallback will actually use, and the
fallback works when it is reached. Today neither is true: two different
gateways share one name in the codebase, and the credential for the cloud one
is dead, so a review fallback would fail at the moment it is needed most —
after the primary reviewer has already failed.

## The two gateways

They are genuinely different systems serving different agents.

| | AgentRouter | 9Router |
|---|---|---|
| Endpoint | `https://agentrouter.org/` | `http://localhost:20128/v1` |
| Location | cloud | local daemon |
| Credential | `AGENTROUTER_API_KEY` (User environment) | local token |
| Config directory | `~/.claude-agentrouter-old` | `~/.claude` |
| Default model | `claude-opus-4-8` | `cc/claude-opus-4-5-…` |
| Serves | Claude, Codex | Gemini, dsh |

`scripts/ai/doctor.ps1:274` uses the cloud endpoint correctly.

## The conflation

`scripts/ai/control.ps1` defines:

```powershell
$script:AgentRouterProfile = ~/.claude
$script:AgentRouterPort    = 20128
```

That is 9Router's port under AgentRouter's name, and the error text enforces
it:

```
"AgentRouter Claude profile must use http://localhost:20128/v1."
```

So a profile called "AgentRouter" is *required* to point at 9Router. The
consequence is not cosmetic. `Invoke-ShipDeAgentRouterReviewFallback` — the
chain that runs when Codex review fails — carries AgentRouter's name, tries
the native Claude Code CLI first, and validates a profile pinned to 9Router's
port. Reading the code does not tell you which route a fallback review takes,
and the route decides whose quota is spent.

## The credential is dead

Verified 2026-09-14:

| Request | Result |
|---|---|
| `GET https://agentrouter.org/` | HTTP 200 — the service is up |
| `GET /v1/models` with `Authorization: Bearer <key>` | **HTTP 401** |
| `POST /v1/messages` with `x-api-key` | **HTTP 401** |
| `POST /v1/messages` with `Authorization: Bearer` | **HTTP 401** |

The key is present (51 characters, User environment) and rejected in every
form. `doctor.ps1` reports "AgentRouter user credential: CONFIGURED" purely on
presence, so the dashboard and the health check both report a fallback that
cannot authenticate.

## In scope

- Give the two gateways distinct names throughout `control.ps1`. The local one
  is 9Router; reserve `AgentRouter` for the cloud endpoint.
- Make `doctor.ps1` verify the AgentRouter credential rather than its presence,
  and report a dead key as a failure.
- Record in `AI-TOOLCHAIN-DECISIONS.md` which agent falls back to which
  gateway, so the routing is documented rather than inferred.

## Out of scope

- Changing which gateway any agent uses. This Work Item makes the existing
  arrangement legible; it does not re-route anything.
- Renewing or removing the cloud AgentRouter credential. `doctor.ps1` reports
  a rejected key as a failure rather than as configured, which is the code
  behaviour this Work Item owns; renewing or removing the key itself is an
  operator action on the user environment, not a code change in this
  repository.
- The `Invoke-ShipDeAgentRouterReviewFallback` review logic itself beyond the
  rename.
- Adding a new gateway.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-44-R01` | A credential is reported as configured only after a live request authenticates. Presence is not configuration. |
| `AI-44-R02` | A fallback whose credential fails is reported as unavailable, so the operator learns before the primary path fails rather than after. |
| `AI-44-R03` | The rename changes no routing. Any behavioural change is a defect in this Work Item. |
| `AI-44-R04` | Neither gateway's credential is ever written to a log, a report or the dashboard. |

## API, event and data impact

None. No schema, migration or endpoint changes.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-44-01` | Read `control.ps1` for the local gateway | No symbol names it AgentRouter | grep output |
| `AC-AI-44-02` | Run `doctor.ps1` with the current dead key | AgentRouter reported unavailable, marked as a failure | doctor output |
| `AC-AI-44-03` | Run `doctor.ps1` with a working key | AgentRouter reported available | doctor output |
| `AC-AI-44-04` | Run the controller's existing self-tests | No behavioural change | test output |
| `AC-AI-44-05` | Search every output path | The key appears nowhere | grep output |

## Verification commands

```
pwsh -NoProfile -File scripts/ai/doctor.ps1
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js prove --tests "node tools/ai-brain/test/review-lane.test.js"
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Implementation record

| AC/Test ID | Result | Evidence |
|---|---|---|
| `AC-AI-44-01` | PASS | `grep -nE '\$script:AgentRouter\|function [A-Za-z-]*AgentRouter\|-AgentRouterPort' scripts/ai/control.ps1 scripts/ai/start-agent-orchestrator.ps1` returns no line (exit 1). The check is capable of failing: the same pattern matches 18 lines in `control.ps1` and 1 line in `start-agent-orchestrator.ps1` at the merge base `4b0fa4b`, and still matches `origin/main`'s un-renamed call site `& $Path -AiRoot $Root -AgentRouterPort $Port`. The only `AgentRouter` strings left in `control.ps1` are two comments: the AO banner, and the note that the launcher keeps the `AgentRouterPort` alias. The seven TASK-AI-06 fixture titles that also said `AgentRouter` were renamed to `9Router fallback` on `main` (PR #92). No symbol and no call site names the local gateway AgentRouter. |
| `AC-AI-44-02` | PASS (after fix) | Run on a temporary copy of `doctor.ps1` whose only change reads the key from a process variable holding a deliberately invalid value (the operator's working key is never touched). **Before this fix** the real probe timed out and doctor printed `CONFIGURED but unverified (probe timed out)` with no failure — a dead key reported as a usable fallback, violating `AI-44-R01`/`R02`. **After:** `AgentRouter user credential: UNAVAILABLE: key present but unverified (probe timed out)` and the failure list carries `AGENTROUTER_API_KEY could not be verified (probe timed out); treat the AgentRouter fallback as unavailable`. The copy is deleted afterwards. |
| `AC-AI-44-03` | PASS | Probe cache deleted first so the run is live, not cached: `AgentRouter user credential: AUTHENTICATED via deepseek-v4-flash` (no `[cached]` suffix), and no AgentRouter entry in the failure list. doctor exits 1 on this host for unrelated findings (Codex/Claude CLI auth, dirty worktree, ecosystem validation, hooksPath). |
| `AC-AI-44-04` | PASS | `control.ps1 -Action Test` exit 0, `ALL SUPERVISOR AND AUTO-MERGE BEHAVIORAL TESTS PASSED`; `node tools/ai-brain/test/review-lane.test.js` exit 0, 20 pass / 0 fail. Caller audit for the renamed `start-agent-orchestrator.ps1` parameter: `git grep -n -e '-AgentRouterPort' -- . ':!docs'` returns no line, so no call site still passes the old name; the only `AgentRouterPort` hits outside `docs/` are the `[Alias('AgentRouterPort')]` declaration itself and the `control.ps1` comment that documents it. The alias is what keeps a launcher outside the repository working (`(Get-Command start-agent-orchestrator.ps1).Parameters['NineRouterPort'].Aliases` = `AgentRouterPort`). |
| `AC-AI-44-05` | PASS | The key **value** is read from the User environment into a shell variable (never printed) and searched with `grep -rlF -- "$value"` over `scripts`, `tools`, `docs`, both `DASHBOARD.html` copies, both doctor run logs above and the probe cache `shipde-agentrouter-probe.json`: no file matches (exit 1). A sanity run of the same command against a file containing the value does match, so the search is capable of failing. The cache holds only `observedAt`, a 16-hex-character SHA-256 prefix `keyHash`, `live`, `detail` and `failure`. |

Renames (`control.ps1`, `start-agent-orchestrator.ps1`): `$script:AgentRouterProfile` -> `$script:NineRouterProfile`, `$script:AgentRouterPort` -> `$script:NineRouterPort`, `Assert-ShipDeAgentRouterProfile` -> `Assert-ShipDeNineRouterProfile`, `Test-ShipDeAgentRouterEndpoint` -> `Test-ShipDeNineRouterEndpoint`, `Ensure-ShipDeAgentRouterRuntime` -> `Ensure-ShipDeNineRouterRuntime`, `Get-ShipDeAgentRouterFailureSince` -> `Get-ShipDeNineRouterFailureSince`, `Test-AgentRouterEndpoint` -> `Test-NineRouterEndpoint`, parameter `-AgentRouterPort` -> `-NineRouterPort`.

**Finding while renaming.** `Invoke-ShipDeAgentRouterReviewFallback` never calls AgentRouter: it clears `ANTHROPIC_BASE_URL` and `CLAUDE_CONFIG_DIR` and runs the native Claude Code CLI. It is renamed `Invoke-ShipDeClaudeReviewFallback`, and `doctor.ps1` no longer claims AgentRouter serves the review fallback. No routing changed (`AI-44-R03`); the routing is recorded in `AI-TOOLCHAIN-DECISIONS.md` § Gateway routing record.

**Merge record (2026-09-19).** `origin/main` (`8cec992`, PR #92) is merged into this branch at merge base `4b0fa4b`. `main` already carried the `NineRouter*` symbol rename, so the four conflicts (`control.ps1`, `doctor.ps1`, `AI-TOOLCHAIN-DECISIONS.md`, this Work Item) were resolved by keeping both intents: `main`'s renames and its AO `0.13.0` pin section, plus this branch's port-parameter rename, its retained alias and the dead-key probe fix. No routing changed (`AI-44-R03`).

## Residual limitations

- Historical decision rows `AI-SUP-06`, `AI-SUP-07` and `AI-SUP-11` still say "AgentRouter" for the local route. They are decision records and are not rewritten; the routing record tells the reader how to read them.
- `AC-AI-44-02` uses a deliberately invalid key in a temporary copy of `doctor.ps1`, not a revoked real key. agentrouter.org answers `/v1/models` with 401 for both working and invalid keys, so a cheaper HTTP pre-check cannot distinguish them; the Claude Code probe remains the only authenticating check.
- `$script:AoRouterRuntimeFile` and the persisted `router_port` field keep their generic names: they name no gateway, and renaming a persisted field changes a runtime file contract outside this Work Item.
- **`start-agent-orchestrator.ps1` no longer names the local gateway `AgentRouter`.** Its port parameter is `-NineRouterPort` and its endpoint helper is `Test-NineRouterEndpoint`; the old `-AgentRouterPort` name is still accepted as an `[Alias]`, so a launcher outside the repository that still passes it keeps working (`AI-44-R03`). The governed launcher in `control.ps1` now passes `-NineRouterPort`, so the cross-file contract is explicit rather than implied.
- **The cloud AgentRouter credential is observed live, not assumed.** `agentrouter.org` rejected the stored key on 2026-09-14 (HTTP 401). On 2026-09-17 the same stored key authenticates (`doctor.ps1`: `AgentRouter user credential: AUTHENTICATED via deepseek-v4-flash`), so the fallback is currently available. `doctor.ps1` decides this from a live probe rather than from presence, so the report follows the credential either way; renewing or removing the key remains an operator action, not a code change.
- **`TASK-AI-07.md` still cites a renamed symbol.** `docs/product-spec/work-items/TASK-AI-07.md` still names `Get-ShipDeAgentRouterFailureSince` where this Work Item renamed it to `Get-ShipDeNineRouterFailureSince`. That file is outside this Work Item's allowed paths and is not edited here; correcting the citation belongs to a `TASK-AI-07` follow-up.
- **Scope disclosure for the merge owner.** `scripts/ai/start-agent-orchestrator.ps1` was added to Allowed paths by the author, because `control.ps1` passes the port to it by parameter name and the rename cannot land in one file. The merge owner accepts or rejects that widening.
- The one-Work-Item-per-PR note above describes the earlier bundled delivery on PR #16; the split deliveries (PR #92 and PR #75) each ship this single Work Item on its own branch.
