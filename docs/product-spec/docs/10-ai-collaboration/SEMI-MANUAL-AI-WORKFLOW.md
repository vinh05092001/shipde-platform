# 9Router / Gemini → Codex Human-Gated Semi-Automatic Delivery Workflow

## Decision

The tools do not share chat history. They coordinate through one GitHub repository, one root `AGENTS.md`, one prepared Work Item, one feature branch and one Pull Request. The versioned `scripts/ai/control.ps1` reads Git/GitHub state and routes one `Resume` action to Codex planning, the assigned implementation author or Codex review. The human starts each gate, approves consequential decisions and performs the merge; CI and versioned evidence carry every handoff.

## Responsibility map

| Artifact/action                   | Claude |        Codex planner |           9Router worker |              Gemini |       Codex reviewer |             Human |
| --------------------------------- | -----: | -------------------: | -----------------------: | ------------------: | -------------------: | ----------------: |
| Propose business/solution updates |  Owner | Validate and version |                       No |                  No |        Verify source | Approve decisions |
| Prepare executable Work Item      |     No |                Owner |                       No |                  No |                   No |  Resolve blockers |
| Choose implementation author      |     No |            Recommend |                       No |                  No |  Challenge if unsafe |     Confirm/start |
| Implement production code         |     No |                   No |            Low-risk only |       Primary owner |                   No |                No |
| Add and run tests                 |     No |      Define evidence | Owner for assigned scope |               Owner | Verify independently |           Observe |
| Open/update Pull Request          |     No | Planning commit only |      Owner when assigned | Owner when assigned |         Read/comment |           Observe |
| Approve implementation            |     No |                   No |         No self-approval |    No self-approval |            Recommend |       Final owner |
| Merge to `main`                   |     No |                   No |                       No |                  No |                   No |             Owner |

## State flow

```mermaid
stateDiagram-v2
    [*] --> ReadyForAuthor
    ReadyForAuthor --> InProgress: controller starts assigned author
    InProgress --> ReadyForCodex: PR and evidence complete
    ReadyForCodex --> ChangesRequired: Codex finds gaps
    ChangesRequired --> ReadyForCodex: same author fixes same PR
    ReadyForCodex --> CodexPass: every gate passes
    CodexPass --> Merged: human merges
    InProgress --> Blocked: missing decision or dependency
    ReadyForCodex --> Blocked: evidence cannot be verified
```

## One-time local setup

| Workspace                           | Branch parked after setup | Purpose                                           |
| ----------------------------------- | ------------------------- | ------------------------------------------------- |
| `C:\Users\gumac\AI\shipde-platform` | `main`                    | Integration baseline; never direct implementation |
| `C:\Users\gumac\AI\shipde-claude`   | `agent/claude`            | Claude business and solution analysis only        |
| `C:\Users\gumac\AI\shipde-dsh`      | `agent/dsh`               | 9Router/DSH low-risk author                       |
| `C:\Users\gumac\AI\shipde-gemini`   | `agent/gemini`            | Gemini primary author                             |
| `C:\Users\gumac\AI\shipde-codex`    | `agent/codex-review`      | Codex planning and independent review             |

Each application opens only its own workspace. Complete and verify this layout with `WINDOWS-SETUP-RUNBOOK.md` and the safe commands under `scripts/ai/`. Before a new Work Item, fetch `origin`, create the prepared feature branch from current `origin/main`, and confirm `git status` is clean. Do not reuse an unmerged branch for another item.

Configure DSH and 9Router exactly as recorded in `AI-TOOLCHAIN-DECISIONS.md`: local endpoint only, Ponytail/Caveman/Headroom/request logging OFF and no committed credential. Protect `main`: disallow direct pushes and force pushes, require Pull Requests, require the always-present `contract` and `application-gate` checks, and require resolved review conversations.

## Per-Work-Item procedure

### 1. Codex prepares the next item

Use `FEATURE-DELIVERY-REGISTER.csv` in ascending `delivery_order`. Dependencies must be `MERGED`. In a planning-only task, Codex creates the feature branch from latest `main`, creates/fills the Work Item, chooses `GEMINI` or `9ROUTER`, records risk and allowed paths, and changes only that row to `READY_FOR_AUTHOR`. It changes no production code.

Foundation items run before product features. Use `CODEX-PLANNING-PROMPT.md`.

### 2. Controller starts the assigned author

The human runs `powershell -ExecutionPolicy Bypass -File .\\scripts\\ai\\control.ps1 -Action Resume`. The controller discovers the earliest remote `READY_FOR_AUTHOR` branch, reads the assigned author from its Work Item, parks the Codex worktree, checks out the branch only in the correct author worktree, copies the completed prompt and opens Gemini/Antigravity or DSH/9Router. No Work Item ID, slug, branch or author is retyped.

The author verifies branch, Work Item, allowed scope and readiness before editing. It implements one Work Item, runs the required checks, updates evidence, opens one Pull Request, marks `READY_FOR_CODEX` and stops.

### 3. CI verifies the handoff

The `contract` check runs for every Pull Request and validates the product specification, PR contract and PowerShell control-script syntax. The `application-gate` check also always reports: it runs clean install, lint, build and current E2E only when application-affecting paths changed, otherwise records that those checks are not applicable. A failed required check is returned to the same author with its exact log. The author must not claim readiness while CI is red.

### 4. Controller starts independent Codex review

When `Resume` detects one non-draft implementation Pull Request and every required check is green, it detaches `shipde-codex` at the immutable PR head and runs a governed read-only review with structured schema output (`codex exec --sandbox read-only --output-schema <schema-file> --output-last-message <review-file> -` with the review prompt piped via stdin). The review is saved outside the repository. The human confirms before it is posted to GitHub. The reviewer reads repository evidence rather than planning or author chat and returns `PASS`, `CHANGES_REQUIRED` or `BLOCKED`.

If more than one implementation Pull Request is open during bootstrap or recovery, use `control.ps1 -Action Review -PullRequestNumber <number>`. The controller must select that exact open PR or stop; it never guesses between active Work Items.

### 5. Correction loop

`CHANGES_REQUIRED` returns to the same implementation author and same branch. The author fixes findings, reruns the complete validation set and updates the PR evidence. Two failed 9Router correction rounds escalate the item to Gemini; record the author change in the Work Item. Every updated commit requires a fresh Codex verdict.

### 6. Human merge and workspace sync

The human merges only when CI is green, every acceptance row has evidence, Codex returns `PASS`, review conversations are resolved and residual limitations are explicitly accepted. After merge, reconcile the register to `MERGED`, record PR/merge commit, then run `control.ps1 -Action Sync` to park and fast-forward each clean agent worktree from `origin/main` before preparing another item.

## Routing rules

### Assign 9Router only for bounded low-risk work

- deterministic fixtures, carrier mocks and seed data;
- focused unit tests for already specified behavior;
- types, schemas or generated/mechanical updates with an existing contract;
- small CRUD or lint fixes with no ownership, authorization or money decision;
- documentation or evidence updates that do not change product meaning.

### Assign Gemini for primary implementation

- foundation migration and repository architecture;
- complete frontend/backend/persistence features;
- authentication, authorization and tenant isolation;
- carrier commands, retries, reconciliation and external effects;
- COD, wallet, billing and any money behavior;
- user-facing flows, design-system composition and accessibility;
- database migrations or cross-module changes.

## Human gates

Normal daily operation uses only `control.ps1 -Action Resume` (or **Continue pipeline** from the Desktop shortcut); advanced stage-specific actions remain available for recovery. The human must explicitly approve or start:

1. material business/solution decisions;
2. the selected Work Item and implementation author;
3. important UI outcomes;
4. changes involving money, permissions, secrets, destructive migrations or production integrations;
5. Codex review and final merge/release.

## Unattended supervisor mode (TASK-AI-06+)

Run `control.ps1 -Action Supervise`. It validates AO and, when AO is stopped, stale, or running with the wrong profile, invokes `scripts/ai/start-agent-orchestrator.ps1 -Restart` automatically. The launcher forces AO to use the existing `.claude` profile routed to localhost AgentRouter; AgentRouter handles Claude/provider quota fallback without replacing the AO session. The deterministic supervisor automates the per-Work-Item procedure:

AO is an external orchestration layer, not one of the adopted repositories/providers. Its canonical source, installed version and `ao status --json` health check are recorded separately in `tools/ecosystem-manifest.json`.

1. **Discovers** normal remote `feat/*` and `fix/*` refs and selects the earliest prepared `READY_FOR_AUTHOR` Work Item.
2. **Generates** the implementation prompt automatically (no clipboard/paste).
3. **Spawns** an isolated AO worker using the current public `ao spawn` contract.
4. **Monitors** session state, detecting inactivity and completion.
5. **Nudges** stalled sessions before escalating.
6. **Routes** each failed CI HEAD back to the same worker once.
7. **Triggers** independent Codex review after CI is green and routes exact-HEAD findings back to the worker.
8. **Notifies** the human only after durable exact-HEAD PASS; it never merges.

The supervisor is a PowerShell state machine, not an LLM agent loop. It:

- Preserves fail-closed behavior (stops on unrecoverable errors).
- Never auto-merges (human merge is always required).
- Relies on AgentRouter for provider/model fallback and treats surfaced exhaustion as a real blocker.
- Writes checkpoints for restart recovery.
- Respects all existing CI and review gates.

Normal unattended flow:

```
delivery register → supervisor → assigned worker → local verification
→ commit/push/PR → CI → automatic CI repair → independent Codex review
→ automatic review repair → exact-HEAD PASS → human merge notification
→ post-merge synchronization → next Work Item
```

## Final automation acceptance case (TASK-AI-07 through TASK-AI-12)

The completed orchestrator must perform the full governed flow from one command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Resume
```

The resulting sequence is: select the dependency-ready Work Item; compile the minimum profile; start the assigned worker in its branch/worktree; implement and test; open the PR; monitor and repair CI; invoke independent exact-HEAD Codex review; return review findings to the worker; stop for human merge after durable `PASS`; then reconcile `main` and continue with the next dependency-ready item.

The operator intervenes only for initial credential/login, destructive actions, conflicting or missing business rules, and Pull Request merge. Routine prompt copying, agent-stall watching, CI comment transfer and quota-driven provider switching are controller responsibilities.

AO session controls keep **Automatically fix CI failures**, **Automatically fix review comments**, and **Terminate on merge** enabled. The controller remains authoritative for exact-HEAD gates, retry budgets, checkpoints and selecting the next Work Item.

### Profile activation contract

The controller reads `tools/ecosystem-manifest.json` and activates only the governed capabilities needed for the selected Work Item:

| Work type                | Governed capability set                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| Specification            | OpenSpec, Spec Kit, Context7                                                     |
| Backend implementation   | Gemini, Serena, Context7, governed coding skills                                 |
| UI implementation        | Gemini, governed UI skills, Vercel Agent Skills, component inspection, Storybook |
| E2E/API                  | Playwright Test, MSW, Prism                                                      |
| Browser diagnosis        | Playwright CLI, Chrome DevTools MCP                                              |
| Research                 | `shipde-brain`, one of DSH/Hermes, Repomix                                       |
| Review                   | Codex plus controller or governed review daemon                                  |
| Multi-agent coordination | Beads plus governed mailbox capability                                           |
| Security                 | Agent Scan                                                                       |
| Cost                     | TokenTracker plus 9Router statistics                                             |
| Maintenance              | Renovate plus Lefthook                                                           |

This contract does not authorize installation of missing repositories or providers. If a named capability has no governed manifest entry, profile compilation stops fail-closed and reports the exact gap. The machine runs at most one implementation agent and one research agent, with one writer per Work Item.

### Parallel product delivery lane

Toolchain hardening must not block product work. PR #8 is first returned to green CI and an exact-HEAD Codex verdict; `CHANGES_REQUIRED` returns to Gemini, while `PASS` waits for human merge. After merge, the controller reconciles the register and proceeds to `TASK-FOUND-04`: Playwright/Vitest harness, carrier mock server, test seed/reset, and OpenAPI drift validation using MSW and Prism within their assigned roles. Product flows then proceed in order: coverage check, rate comparison, create/cancel shipment, label printing, COD/settlement, webhook idempotency, claims, and finally redelivery/rerouting.

## Failure handling

| Situation                                                                | Required action                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Business rule missing or contradictory                                   | Mark `BLOCKED`; no agent may invent it                                           |
| Carrier capability unverified                                            | Use explicit unverified/unsupported state and deterministic mock/manual fallback |
| AgentRouter exhausts every approved route                                | Preserve checkpoint and stop fail-closed for human credential/provider action    |
| 9Router injects Ponytail/Caveman or changes evidence through compression | Stop, disable the feature and repeat verification from uncompressed evidence     |
| DSH/9Router version or model catalog changes mid-item                    | Pin the working version/model or mark `BLOCKED`; never silently substitute       |
| Author cannot open a PR                                                  | Push branch and provide commit; human opens PR with the template                 |
| CI fails                                                                 | Same author fixes the exact failure before review                                |
| Codex cannot verify evidence                                             | Return `BLOCKED`, never a conditional pass                                       |
| PR contains more than one Work Item                                      | Split before review                                                              |
| Existing prototype appears complete                                      | Reassess against the full Definition of Done; demo UI is insufficient            |
