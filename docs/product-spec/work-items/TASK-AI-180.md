# TASK-AI-180 — Share coding guidelines across agents

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-180` |
| Feature ID | `N/A` |
| Status | `READY_FOR_REVIEW` |
| Dependencies | None |
| Assigned author | Codex (documentation) |
| Risk | `LOW` |
| Allowed paths | `AGENTS.md`; `docs/product-spec/work-items/TASK-AI-180.md` |
| Reviewer | Codex — fresh independent task |
| Branch | `feat/task-ai-180-shared-coding-guidelines` |

## Business outcome

Agents working in Ship Dễ share a concise standard for scoped, verifiable code changes, regardless of the model selected.

## Source references

- `AGENTS.md`: Source of truth, Role separation, Definition of Done.
- [Upstream guidelines](https://github.com/multica-ai/andrej-karpathy-skills): The Four Principles in Detail.

## Scope and acceptance

- The root operating card contains all four practices, with attribution, without altering existing rules.
- Delegated tasks point workers to the same guidance or include it in their prompt.
- No external plugin installation, runtime changes, or inference calls are needed for this documentation change. Launcher-specific automatic loading is outside this change.

## Verification

Review the two-file diff for scope, attribution and preservation of the existing contract. No application tests are required for this documentation-only change.
