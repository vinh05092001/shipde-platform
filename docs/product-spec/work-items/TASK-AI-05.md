# TASK-AI-05 — Restore post-merge controller synchronization

## Control

| Field           | Value                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-05`                                                                                                                                       |
| Feature ID      | `N/A`                                                                                                                                              |
| Status          | `READY_FOR_CODEX`                                                                                                                                  |
| Delivery order  | `138`                                                                                                                                              |
| Dependencies    | `TASK-AI-04` merged through PR #6 as `fab2aa966155406645b51a3222fe339de97b03f3`                                                                    |
| Assigned author | `9ROUTER` (implementation completed by Codex under explicit human corrective-action authorization)                                                 |
| Risk            | `LOW`                                                                                                                                              |
| Allowed paths   | `scripts/ai/control.ps1`; `docs/product-spec/work-items/TASK-AI-05.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | `Codex — fresh independent task`                                                                                                                   |
| Branch          | `fix/task-ai-05-sync-json-list`                                                                                                                    |
| Pull Request    | `#7`                                                                                                                                               |

## Business outcome

After a human merges an approved Work Item, the Ship Dễ product owner can choose **Sync after human merge** on Windows PowerShell 5.1 and have every clean worktree synchronize safely. The controller must enumerate merged Pull Requests as individual records instead of attempting to convert a `System.Object[]` value into one Pull Request number.

## Source references

- `AGENTS.md` — human-only merge, protected `main`, isolated worktrees and fail-closed controller behavior.
- `docs/product-spec/work-items/TASK-AI-01.md` — controller state routing and post-merge synchronization.
- `docs/product-spec/work-items/TASK-AI-02.md` — canonical Windows PowerShell 5.1 JSON-list normalization behavior.
- `scripts/ai/control.ps1` — `ConvertFrom-ShipDeJsonList`, `Assert-ShipDeJsonListCompatibility` and `Sync-ShipDeRegister`.
- Runtime evidence after PR #6 merged: menu action **6. Sync after human merge** fetched the remote and switched to `main`, then stopped safely with `Cannot convert the "System.Object[]" value of type "System.Object[]" to type "System.Int32"`.

## Preconditions and dependencies

- PR #6 is human-merged as `fab2aa966155406645b51a3222fe339de97b03f3`.
- GitHub CLI authentication remains available on the confirmed Windows 10 workstation.
- `ConvertFrom-ShipDeJsonList` already provides the approved empty/single/multiple record normalization used by open Pull Request discovery.
- The failed synchronization stopped before modifying tracked files or merging another branch.

## Author boundary

This is a bounded, low-risk controller compatibility correction suitable for the `9ROUTER` boundary. Implementation may change only the three allowed paths. It must not change product application code, dependencies, authentication, credentials, agent routing, required CI gates, human merge ownership, destructive Git behavior or dirty-worktree protections. The explicit human instruction authorized Codex to execute this corrective implementation; a separate fresh Codex task must independently review the immutable PR head.

## In scope

1. Route merged-Pull-Request JSON through the existing `ConvertFrom-ShipDeJsonList` compatibility boundary.
2. Validate each merged Pull Request has a usable title and one positive scalar integer number before synchronization consumes it.
3. Add deterministic startup self-tests covering empty, single, multiple and malformed merged Pull Request records on Windows PowerShell 5.1.
4. Preserve exact-HEAD Codex verdict reconciliation, protected-main behavior, clean-worktree checks and fast-forward-only synchronization.
5. Reconcile `TASK-AI-04` as merged and register this hotfix as the sole active Work Item.

## Out of scope

- Product application, API, worker, database, Redis, Docker, UI or dependency changes.
- Automatic Pull Request merge, force push, reset, branch deletion or dirty-worktree bypass.
- Changes to Claude, Gemini, 9Router or Codex provider/model configuration.
- Refactoring unrelated controller functions or changing normal **Continue pipeline** routing.
- Starting `TASK-FOUND-03` before this correction is independently reviewed and human-merged.

## Business rules and edge cases

- `AI-SYNC-01`: JSON `[]` emits zero merged Pull Request records and synchronization remains a no-op for register reconciliation.
- `AI-SYNC-02`: One or many merged Pull Requests are emitted as individual records in source order.
- `AI-SYNC-03`: Every consumed record must contain a nonblank title and one positive scalar integer `number`; malformed records stop before register mutation or worktree synchronization.
- `AI-SYNC-04`: The same JSON-list compatibility boundary is used for open and merged Pull Request lists; direct list conversion must not reintroduce Windows PowerShell 5.1 array wrapping.
- `AI-SYNC-05`: Register reconciliation remains check-only on protected `main`; tracked files are never edited there.
- `AI-SYNC-06`: All worktree updates remain clean-check guarded and `--ff-only`; a failed prerequisite stops without reset, force or merge fallback.
- `AI-SYNC-07`: Exact-head `PASS` evidence and human-only merge rules remain unchanged.

## UI states

No product UI changes.

- **Successful sync:** controller reports reconciliation evidence and confirms all clean worktrees are parked and synchronized.
- **No merged records:** controller safely continues without a conversion error.
- **Malformed merged record:** controller prints `STOPPED SAFELY` with a specific malformed-record message.
- **Dirty or divergent worktree:** existing fail-closed message remains unchanged.

## API, event and data impact

No product API, event, schema, migration, job or tenant-data impact. The change only normalizes local JSON returned by `gh pr list --state merged`. The delivery register remains protected from direct edits in the `main` worktree.

## Acceptance matrix

| AC/Test ID | Scenario                                                                  | Expected result                                                                                                   | Evidence required                                  |
| ---------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `AC-AI-36` | Merged PR query returns `[]`                                              | Zero records are emitted; no number conversion occurs                                                             | Deterministic Windows PowerShell startup assertion |
| `AC-AI-37` | Merged PR query returns one or multiple records                           | Each record remains individually enumerable and its number converts to one `Int32`                                | Deterministic one/multiple record assertions       |
| `AC-AI-38` | Record has missing, blank, nonnumeric, nonpositive or array-valued number | Controller stops with a specific malformed merged PR error before synchronization                                 | Deterministic negative assertions                  |
| `AC-AI-39` | `Sync-ShipDeRegister` consumes GitHub JSON                                | It calls the shared JSON-list normalizer rather than direct `ConvertFrom-Json` list wrapping                      | Controller diff and source trace                   |
| `AC-AI-40` | Existing controller safety behavior is exercised                          | Exact-head review, check-only register reconciliation, clean checks and fast-forward-only merges remain unchanged | Diff audit, AST validation and CI                  |
| `AC-AI-41` | Human reruns action 6 after merge                                         | No `System.Object[]` to `System.Int32` error occurs and clean worktrees synchronize                               | Post-merge Windows PowerShell 5.1 smoke test       |

## Verification commands

From a clean checkout:

- Parse every `scripts/ai/*.ps1` file through the PowerShell AST parser in the contract job.
- Run `powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Status` on Windows PowerShell 5.1 and confirm all startup compatibility assertions pass.
- Run `python docs/product-spec/scripts/validate_docs.py`.
- Run `pnpm format:check`.
- Run `pnpm security:secrets`.
- Run `git diff --check origin/main...HEAD`.
- After human merge, run `powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Sync` and confirm no `System.Object[]` conversion error occurs.

## Codex review record

| Review round | Commit                                | Verdict              | Findings resolved      |
| ------------ | ------------------------------------- | -------------------- | ---------------------- |
| 1            | Pending immutable implementation head | Pending fresh review | Initial implementation |

## Residual limitations

The GitHub-backed CI runner validates PowerShell syntax and repository contracts, while the definitive synchronization smoke test requires the user's Windows PowerShell 5.1 worktrees after human merge. This is expected and does not authorize direct modification of protected `main`.
