# TASK-AI-44 — Separate AgentRouter from 9Router, in code and in name

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-44` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `178` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI (repaired from CLAUDE watchdog fallback in PR #108)` |
| Risk | `MEDIUM` |
| Allowed paths | `scripts/ai/control.ps1`, `scripts/ai/doctor.ps1`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `tools/ecosystem-manifest.json`, `docs/product-spec/work-items/TASK-AI-44.md`, `tools/ai-brain/acceptance/ac-44-01-doctor-unverified-arms.js` (added to satisfy Codex review round 1 Gap 1: deterministic durable test coverage of the repaired doctor.ps1 probe arms; addition disclosed in Work Item and PR body) |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-44-unverified-key` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/108 |

## Delivery note (historical): the first delivery shipped on the TASK-AI-16 branch

The delivery this section describes is historical. TASK-AI-44 is now delivered
on its own branch `feat/task-ai-44-router-split` (Pull Request #92), as the
one-Work-Item-per-Pull-Request rule requires; the Control table above names
that branch and Pull Request.

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
| `AC-AI-44-02` | Run `doctor.ps1` with unverified key probe outcomes | AgentRouter reported unavailable, marked as a failure | doctor output / `node tools/ai-brain/acceptance/ac-44-01-doctor-unverified-arms.js` (durable gate covering timeout, unexpected output, and probe exception arms) |
| `AC-AI-44-03` | Run `doctor.ps1` with a working key | AgentRouter reported available (`AUTHENTICATED via deepseek-v4-flash`), cached replay confirmed | doctor output |
| `AC-AI-44-04` | Run the controller's existing self-tests | No behavioural change | test output |
| `AC-AI-44-05` | Search every output path and test cache/failure payloads | The key appears nowhere, zero secret leaks | grep output / `node tools/ai-brain/acceptance/ac-44-01-doctor-unverified-arms.js` |

## Verification commands

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai/doctor.ps1
node tools/ai-brain/acceptance/ac-44-01-doctor-unverified-arms.js
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js prove --tests "node tools/ai-brain/test/review-lane.test.js"
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `7c5485eb174b6234df2998d4eaa2383a41870aa1` | `CHANGES_REQUIRED` | [Comment 5740392204](https://github.com/vinh05092001/shipde-platform/pull/108#issuecomment-5740392204): Gaps 1-4 resolved: (1) added deterministic durable gate `tools/ai-brain/acceptance/ac-44-01-doctor-unverified-arms.js` testing all probe arms, cached replay, and key isolation; (2) clarified PR #75 supersession and residual scope; (3) advanced delivery record in Work Item (status, branch `fix/task-ai-44-unverified-key`, PR #108, author); (4) recorded real Windows doctor execution evidence. |

## Follow-up delivery: an unverified key is not a configured key

After #92 merged, `doctor.ps1` still reported three probe outcomes as
`CONFIGURED but unverified` with no failure recorded: a probe timeout, an
unrecognised probe output, and a probe exception. Measured 2026-09-16, a
deliberately invalid key makes the probe time out rather than print a 401, so
a dead key read as a configured fallback, contrary to `AI-44-R01` and
`AI-44-R02`. Each of those outcomes now reports `UNAVAILABLE: key present but
unverified` and adds a failure, and the cached verdict carries the failure
forward.

This delivery is carried on branch `fix/task-ai-44-unverified-key` (Pull
Request #108, commit `7c5485eb174b6234df2998d4eaa2383a41870aa1`, repaired by
GEMINI), superseding Pull Request #75 (`fix/task-ai-44-gateway-naming`).
PR #75's residual scope outside TASK-AI-44 (`start-agent-orchestrator.ps1`
rename, its `control.ps1:3304` call site, and `AI-TOOLCHAIN-DECISIONS.md`
gateway-wording rewrite) belongs to a follow-up Work Item for
`start-agent-orchestrator.ps1`.

## Residual limitations

- **`start-agent-orchestrator.ps1` still names the local gateway `AgentRouter`.** Its `-AgentRouterPort` parameter and `Test-AgentRouterEndpoint` helper address 9Router's local port 20128 but lie outside this Work Item's allowed paths. `control.ps1`'s governed launcher keeps the `-AgentRouterPort` argument verbatim so the cross-file call contract is unchanged; renaming it is a follow-up that may edit `start-agent-orchestrator.ps1`.
- **The cloud AgentRouter credential is observed live, not assumed.** `agentrouter.org` rejected the stored key on 2026-09-14 (HTTP 401). On 2026-09-17 the same stored key authenticates (`doctor.ps1`: `AgentRouter user credential: AUTHENTICATED via deepseek-v4-flash`), so the fallback is currently available. `doctor.ps1` decides this from a live probe rather than from presence, so the report follows the credential either way; renewing or removing the key remains an operator action, not a code change.
- **`TASK-AI-07.md` still cites a renamed symbol.** `docs/product-spec/work-items/TASK-AI-07.md` still names `Get-ShipDeAgentRouterFailureSince` where this Work Item renamed it to `Get-ShipDeNineRouterFailureSince`. That file is outside this Work Item's allowed paths and is not edited here; correcting the citation belongs to a `TASK-AI-07` follow-up.
