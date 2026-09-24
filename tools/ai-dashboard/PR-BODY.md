# PROPOSED — Landing the Paseo view on the AI dashboard

## Control

| Field | Value |
|---|---|
| Work Item ID | PROPOSED |
| Feature ID | N/A |
| Status | READY_FOR_AUTHOR |
| Delivery order | 100 |
| Dependencies | None |
| Assigned author | GEMINI |
| Risk | LOW |
| Allowed paths | tools/ai-dashboard |
| Reviewer | Codex — fresh independent task |
| Branch | feat/dashboard-paseo-view |
| Pull Request | pending |

## Business outcome

The dashboard shows independent metrics using Paseo instead of Agent Orchestrator, enabling operators to see the truth without running side worktrees.

## Source references

None

## Preconditions and dependencies

None

## Author boundary

Gemini is chosen since this includes multiple changes across the dashboard application, which requires reading the entire state aggregation.

## In scope

Replaces AO with Paseo in the dashboard state aggregator, drops AO and Docker from panels, adds harness, source, and model to the active sessions view.

## Out of scope

No changes to the actual backend logic. No prisma or web app changes.

## Business rules and edge cases

Defaults missing agent source and model to unknown. Keeps ao-adapter for roles and freshness computation.

## UI states

Displays unknown if source or model is missing. Renders agent list with three new columns.

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
| 1 | pending | pending | None |

## Residual limitations

None
Review status: READY_FOR_CODEX
