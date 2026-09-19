# TASK-AI-11 - Preview/dry-run mode contract and bounded failover recovery

## Control

| Field           | Value                                                                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-11`                                                                                                                                                                  |
| Feature ID      | `N/A`                                                                                                                                                                         |
| Status          | `BLOCKED_DEPENDENCY`                                                                                                                                                          |
| Delivery order  | `144`                                                                                                                                                                         |
| Dependencies    | `TASK-AI-10` (not yet merged into `origin/main`)                                                                                                                              |
| Assigned author | `GEMINI`                                                                                                                                                                      |
| Review status   | `NOT_REVIEWED`                                                                                                                                                                |
| Merge PR        | `#120`                                                                                                                                                                        |

## Problem

The ai-brain agent router currently has no formal preview/dry-run mode. Operators who want to see what the supervisor would do without mutating state must guess from logs. Additionally, the failover recovery path has no bounded budget: when every harness candidate fails the supervisor throws an unstructured error with no guarantee that the existing branch is preserved or that the session fails closed.

## Solution

Extend `control.ps1` with three new surfaces:

1. **`[switch]$Preview`** on the top-level param block. When set the supervisor emits a `[PREVIEW]` banner and skips all mutating operations, returning a `PREVIEW` result without writing checkpoints, spawning workers, or touching Git state.

2. **`[switch]$DryRun`** on the top-level param block (the existing per-worker `DryRun` on `Start-ShipDeAoWorker` is retained). When set the supervisor emits a `[SUPERVISOR][DRY-RUN]` banner and skips mutating operations similarly to Preview.

3. **`$MaxFailovers`** on the top-level param block (default 3). The supervisor's `FailoverCount` (already tracked in the state dictionary) is compared against this bound. When `FailoverCount -ge MaxFailovers` the supervisor:
   - emits a `[FAIL-CLOSED]` diagnostic naming the count and limit,
   - preserves the existing branch,
   - throws to terminate the session,
   - fails closed (no further operations are attempted).

## Acceptance criteria

| Row           | Exit | Output                                                                                                         |
| ------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `AC-AI-11-01` | `0`  | `Control status matches register row 144: BLOCKED_DEPENDENCY (declared TASK-AI-11)`                            |
| `AC-AI-11-02` | `1`  | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY`                    |
| `AC-AI-11-03` | `0`  | `TASK-AI-10 dependency verified: merged into origin/main for TASK-AI-11`                                       |
| `AC-AI-11-04` | `1`  | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main`                                 |
| `AC-AI-11-05` | `0`  | `PREVIEW_DRYRUN_CONTRACT_HOLDS: Preview/DryRun surface present in scripts/ai/control.ps1`                      |
| `AC-AI-11-06` | `1`  | `PREVIEW_CONTRACT_BROKEN: a [switch]$Preview parameter in the top-level param block`                           |
| `AC-AI-11-07` | `0`  | `FAILOVER_EXHAUSTION_CONTRACT_HOLDS: bounded failover exhaustion present in scripts/ai/control.ps1`             |
| `AC-AI-11-08` | `1`  | `FAILOVER_EXHAUSTION_CONTRACT_BROKEN: a guard that terminates the session when failover count exceeds the bound` |
| `AC-AI-11-09` | `0`  | `PREVIEW_DRYRUN_BANNERS_PRESENT: [PREVIEW] and [SUPERVISOR][DRY-RUN] banners found in scripts/ai/control.ps1`   |
| `AC-AI-11-10` | `0`  | `FAIL_CLOSED_GUARDS_HOLD: exhaustion stop, Preview if-guard, DryRun if-guard, and [FAIL-CLOSED] tag present`    |

## Residual limitations

- **The Preview/DryRun guards are structural, not behavioral.** The acceptance tests prove the switches and banners exist in the source; they do not execute the supervisor and observe its output. A runtime integration test that launches `control.ps1 -Action Supervise -Preview` and inspects stdout is a separate Work Item.
- **The failover exhaustion guard is checked once, at loop entry.** If the `FailoverCount` is incremented during the loop body the guard will fire on the next iteration, not mid-poll. This is intentional: the supervisor's poll loop is a single-threaded state machine and a mid-poll interrupt would leave the checkpoint in an inconsistent state.
- **`$MaxFailovers` defaults to 3.** The default is chosen so that an unconfigured supervisor still has a finite budget; operators who need more retries must pass `-MaxFailovers N` explicitly.

