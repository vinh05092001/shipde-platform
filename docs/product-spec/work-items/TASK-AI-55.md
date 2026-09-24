# TASK-AI-55 — Landing the Paseo view on the AI dashboard

## Control

| Field | Value |
|---|---|
| Work Item ID | TASK-AI-55 |
| Feature ID | N/A |
| Status | READY_FOR_AUTHOR |
| Delivery order | 100 |
| Dependencies | None |
| Assigned author | GEMINI |
| Risk | LOW |
| Allowed paths | tools/ai-dashboard |
| Reviewer | Codex — fresh independent task |
| Branch | feat/dashboard-paseo-view |
| Pull Request | None |

## Business outcome

The dashboard shows independent metrics using Paseo instead of Agent Orchestrator, enabling operators to see the truth without running side worktrees.

## Source references

None

## Preconditions and dependencies

None

## Author boundary

Gemini is chosen since this includes multiple changes across the dashboard application, which requires reading the entire state aggregation.

## In scope

Replaces AO with Paseo in the dashboard state aggregator, drops AO and Docker from panels, adds harness, source, and model to the active sessions view. Includes the agy pool data collector (`agy-pool-adapter.js`) which supplies data to the architecture diagram (`architecture.js`), though no dedicated pool panel is added to the main dashboard.

## Out of scope

No changes to the actual backend logic. No prisma or web app changes.

## Business rules and edge cases

Defaults missing agent provider to empty string. Keeps ao-adapter for roles and freshness computation.

## UI states

Renders agent list with the new harness column.

## API, event and data impact

None

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-1 | Load dashboard | Renders without errors and without AO | Screen view |

## Verification commands

node --test tools/ai-dashboard/test/*.test.js

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | 234be34920d2549301e4df069f77e987b928dc17 | CHANGES_REQUIRED | None |

## Residual limitations

None
Review status: READY_FOR_CODEX
