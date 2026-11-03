## Work Item

TASK-AI-164. Feature ID: N/A (AI delivery workflow). Assigned author: Codex, operator assignment.

## Source requirements

Source: docs/product-spec/work-items/TASK-AI-164.md. Planners reject incomplete handoffs before author assignment.

## Scope integrity

One Work Item. Checker, readiness fixtures, workflow, template and one register row.

## Implementation

Read-only local CLI validates clarification markers, acceptance proofs, unchanged behaviour and source references. No application routes, migrations, jobs or screens.

## Acceptance evidence

AC-READY-01 through AC-READY-07 are exercised by readiness fixtures, CLI tests and the prepared Work Item command.

## Verification

This is a committed contract fixture, not a claim that CI passed. Execute node --test scripts/ai/test/ready-check*.test.mjs to validate it with the production PR validator.

## Safety and recovery

No tenant, RBAC, audit, VND or carrier changes. CLI errors preserve input bytes and mask contents. Failed checks return to planning.

## Documentation and traceability

The Work Item links approved sources and every acceptance proof. The workflow requires a passing readiness check before handoff.

## Risks and limitations

Readiness is structural; authors execute proofs and independent reviewers assess semantic completeness. No user-facing state changes or external API evidence.

## Codex review

Review status: READY_FOR_CODEX. Fresh independent review remains required.
