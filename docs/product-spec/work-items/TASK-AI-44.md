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
| Allowed paths | `scripts/ai/control.ps1`, `scripts/ai/doctor.ps1`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `tools/ecosystem-manifest.json`, `scripts/ai/start-agent-orchestrator.ps1` (added: `control.ps1` passes the port to it by parameter name, so the rename cannot be made in `control.ps1` alone) |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-44-gateway-naming` |
| Pull Request | `<URL>` |

## Delivery note: this Work Item ships on the TASK-AI-16 branch

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
- Renew or remove the credential. A fallback that cannot authenticate should
  not be reported as available.

## Out of scope

- Changing which gateway any agent uses. This Work Item makes the existing
  arrangement legible; it does not re-route anything.
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
| `AC-AI-44-01` | PASS | `grep -nE '\$script:AgentRouter\|function [A-Za-z-]*AgentRouter\|-AgentRouterPort' scripts/ai/control.ps1 scripts/ai/start-agent-orchestrator.ps1` returns no line (exit 1). The seven remaining `AgentRouter` strings in `control.ps1` are the historical TASK-AI-06 Pull Request title inside test fixtures, not symbols. |
| `AC-AI-44-02` | NOT RE-RUN LIVE | The key was renewed before this change, so a dead key could not be observed without destroying a working credential. The rejected-key branch in `doctor.ps1` (`KEY PRESENT BUT REJECTED`, added to `$failures`) is unchanged by this Work Item. |
| `AC-AI-44-03` | PASS | `doctor.ps1` on 2026-09-16: `AgentRouter user credential: AUTHENTICATED via deepseek-v4-flash`. |
| `AC-AI-44-04` | PASS | `control.ps1 -Action Test` exit 0, `ALL SUPERVISOR AND AUTO-MERGE BEHAVIORAL TESTS PASSED`; `review-lane.test.js` exit 0. |
| `AC-AI-44-05` | PASS | `grep -rlF "$AGENTROUTER_API_KEY" scripts tools docs DASHBOARD.html` (key length 51) returns no file, exit 1. |

Renames (`control.ps1`, `start-agent-orchestrator.ps1`): `$script:AgentRouterProfile` -> `$script:NineRouterProfile`, `$script:AgentRouterPort` -> `$script:NineRouterPort`, `Assert-ShipDeAgentRouterProfile` -> `Assert-ShipDeNineRouterProfile`, `Test-ShipDeAgentRouterEndpoint` -> `Test-ShipDeNineRouterEndpoint`, `Ensure-ShipDeAgentRouterRuntime` -> `Ensure-ShipDeNineRouterRuntime`, `Get-ShipDeAgentRouterFailureSince` -> `Get-ShipDeNineRouterFailureSince`, `Test-AgentRouterEndpoint` -> `Test-NineRouterEndpoint`, parameter `-AgentRouterPort` -> `-NineRouterPort`.

**Finding while renaming.** `Invoke-ShipDeAgentRouterReviewFallback` never calls AgentRouter: it clears `ANTHROPIC_BASE_URL` and `CLAUDE_CONFIG_DIR` and runs the native Claude Code CLI. It is renamed `Invoke-ShipDeClaudeReviewFallback`, and `doctor.ps1` no longer claims AgentRouter serves the review fallback. No routing changed (`AI-44-R03`); the routing is recorded in `AI-TOOLCHAIN-DECISIONS.md` § Gateway routing record.

## Residual limitations

- Historical decision rows `AI-SUP-06`, `AI-SUP-07` and `AI-SUP-11` still say "AgentRouter" for the local route. They are decision records and are not rewritten; the routing record tells the reader how to read them.
- `AC-AI-44-02` was not observed live against a dead key (see above).
- The one-Work-Item-per-PR note above describes the earlier bundled delivery on PR #16; this change ships on its own branch.
