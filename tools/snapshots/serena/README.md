# oraios/serena — Pinned Snapshot Reference

## Tool Overview

| Property                 | Value                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------- |
| ID                       | `serena`                                                                              |
| Name                     | Serena Code Toolkit                                                                   |
| Canonical URL            | `https://github.com/oraios/serena`                                                    |
| Repository               | `oraios/serena`                                                                       |
| Owner                    | `oraios`                                                                              |
| Pinned Version           | `0.1.0`                                                                               |
| Install Method           | `pinned-snapshot`                                                                     |
| Permissions              | `ast-index-read`                                                                      |
| Platform                 | `any`                                                                                 |
| Profile                  | `RESEARCH_ONLY`                                                                       |
| Health Check             | `Test-Path tools/snapshots/serena`                                                    |
| Source of Truth Boundary | Code analysis assistant; output is implementation evidence, never business authority. |

## Purpose and Scope

`oraios/serena` is an AI coding agent toolkit and AST indexing assistant designed for semantic code retrieval, symbol definition extraction, and reference lookup.

Under toolchain decision `AI-TOOL-01` and ecosystem profile `RESEARCH_ONLY`, Serena operates in a **read-only pilot** mode (`TASK-AI-32`).

### Operational Invariants

1. **Read-Only Invariant**: Symbol and reference retrieval operations are strictly read-only. Serena never mutates source files or application state (`AI-32-R01`).
2. **Source of Truth Boundary**: Output is implementation evidence, never business authority (`AI-32-R02`).
3. **TokenPerMergedItem Measurement**: Focused AST symbol retrieval is measured against full-file context loading, targeting significant prompt token reductions to keep author work within the 500k token ceiling (`TOKENS_PER_MERGED_CEILING` under `TASK-AI-25`).
4. **Local & Offline Execution**: Retrieval runs locally without external network telemetry or unvetted cloud dependencies (`AI-TOOL-04`, `AI-TOOL-05`).
