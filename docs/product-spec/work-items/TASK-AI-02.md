# TASK-AI-02 — Handle an empty Pull Request queue safely

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-02` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `0` |
| Dependencies | `TASK-AI-01` merged as `239ad8636e9808f44b5efe43c4c3779ec2900f40` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `scripts/ai/control.ps1`, `docs/product-spec/work-items/TASK-AI-02.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-02-empty-pr-list` |
| Pull Request | `#2` |

## Business outcome

After the setup Pull Request is merged and no implementation Pull Request is open, the product owner can choose **Continue pipeline** without understanding GitHub JSON or PowerShell internals. The controller treats the empty queue as zero records and advances to preparation of the next Work Item instead of stopping on a missing `title` property.

## Source references

- `AGENTS.md` — human-gated semi-automatic workflow and role separation.
- `docs/product-spec/work-items/TASK-AI-01.md` — `AC-AI-09` controller state routing.
- `scripts/ai/control.ps1` — `Get-ShipDeOpenPullRequests` and `Invoke-ShipDeResume`.
- Runtime evidence from Windows PowerShell 5.1 after PR #1 merged: `gh pr list` returned `[]`, and **Continue pipeline** stopped while reading `title`.

## Preconditions and dependencies

- PR #1 is merged and all five worktrees are synchronized.
- GitHub CLI authentication is available.
- The repository has zero open Pull Requests when reproducing the failure.

## Author boundary

This is a bounded control-script compatibility correction. The assigned low-risk author may change only the three allowed paths. It must not change application code, product behavior, credentials, agent routing, review gates, merge ownership or worktree safety.

## In scope

- Normalize JSON arrays from `gh pr list` under Windows PowerShell 5.1.
- Ensure an empty JSON array emits zero Pull Request records.
- Add a deterministic runtime compatibility self-check for empty, single-item and multi-item JSON lists.
- Preserve the existing routing from no open PR to prepared-item discovery and then Codex planning.
- Record PR #1 as merged and this correction as the sole active AI-control Work Item.

## Out of scope

- Fully unattended implementation or merge.
- Starting every AI simultaneously.
- Authentication changes, provider changes or credential handling.
- Product application, schema, dependency, UI or deployment changes.
- Refactoring unrelated controller functions.

## Business rules and edge cases

- `[]` means no open Pull Request and must never be represented as one placeholder object.
- One Pull Request remains one record; multiple Pull Requests remain multiple records so the existing safety block still applies.
- Malformed GitHub records fail closed with a clear message.
- No branch is merged and no Work Item is implemented automatically.

## UI states

- **Empty queue:** Continue pipeline advances to prepared-item lookup/planning.
- **Malformed response:** controller stops safely with a specific GitHub record error.
- **One or multiple PRs:** existing review and multiple-PR blocking behavior is unchanged.

## API, event and data impact

None. This changes only local parsing of GitHub CLI JSON. No API contract, product data, event, migration or external side effect is added.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-10` | `ConvertFrom-Json` receives `[]` on Windows PowerShell | Zero records are emitted and no `title` access occurs | Runtime compatibility self-check and controller diff |
| `AC-AI-11` | JSON contains one or two PR objects | Object count, ordering and `title` values are preserved | Runtime compatibility self-check |
| `AC-AI-12` | Continue pipeline runs with zero open PRs | Existing flow advances to prepared-item lookup and Codex planning | Source trace plus post-merge Windows smoke test |
| `AC-AI-13` | GitHub returns a malformed non-empty record | Controller stops safely with a clear error | Guard in `Get-ShipDeOpenPullRequests` |
| `AC-AI-14` | Correction is reviewed | Existing immutable-SHA CI/review and human-only merge rules remain unchanged | CI and fresh Codex review |

## Verification commands

From a clean checkout:

- Parse every `scripts/ai/*.ps1` file through the PowerShell AST parser in the `contract` job.
- Run `powershell -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Resume` on Windows PowerShell 5.1 with zero open PRs.
- Confirm no `title` error occurs and the controller opens Codex planning.
- Confirm `contract` and `application-gate` succeed on the immutable PR head.

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | Pending | Pending | Empty-array compatibility and safe zero-PR routing |

## Residual limitations

The GitHub-backed CI parser checks PowerShell syntax, while the built-in compatibility assertion executes on the user's actual Windows PowerShell version whenever the controller starts. Human credential entry and merge approval remain intentionally manual.
