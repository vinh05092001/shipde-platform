# TASK-AI-13 — Governed exact-HEAD auto-merge

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-13`                                                                                                                                                                                                                                                                                                  |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                         |
| Status          | `READY_FOR_AUTHOR`                                                                                                                                                                                                                                                                                            |
| Delivery order  | `146`                                                                                                                                                                                                                                                                                                         |
| Dependencies    | `TASK-AI-06` merged through PR #9 as `fdf87594e60dc95aa1b9facb8af365666236f0e9`                                                                                                                                                                                                                               |
| Assigned author | `GEMINI` (high-risk control-plane change that introduces the first automated merge side effect)                                                                                                                                                                                                               |
| Risk            | `HIGH`                                                                                                                                                                                                                                                                                                        |
| Allowed paths   | `AGENTS.md`; `.github/workflows/*.yml`; `scripts/ai/*.ps1`; `scripts/ai/README.md`; `docs/product-spec/work-items/TASK-AI-06.md`; `docs/product-spec/work-items/TASK-AI-13.md`; `docs/product-spec/docs/10-ai-collaboration/*.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | `Codex — fresh independent task; durable verdict only from chatgpt-codex-connector[bot]`                                                                                                                                                                                                                      |
| Branch          | `feat/task-ai-13-governed-auto-merge`                                                                                                                                                                                                                                                                         |
| Pull Request    | To be opened by the implementation author                                                                                                                                                                                                                                                                     |

## Priority and bootstrap decision

Human decision `HUMAN-DECISION-ORCHESTRATOR-CORE-PRIORITY-2026-09-08` authorizes unattended delivery of the orchestrator core through TASK-AI-13 and changes the merge boundary only through this Work Item. TASK-AI-13 is intentionally prepared before TASK-AI-07 through TASK-AI-12 so the remaining approved sequence can use the governed merge gate. This is the only approved temporary exception to the normal delivery-order preference.

PR #8 must remain open and unchanged while TASK-AI-13 is implemented. The human reported it as conflicting/non-mergeable; the planning preflight observed GitHub returning `mergeable=MERGEABLE` and `mergeStateStatus=BEHIND` at head `438c5b42b0668f8d94ccb7eb851d1cf29023eba8`. The controller must therefore treat PR #8 as parked and non-ready without falsifying or overwriting either evidence source. After TASK-AI-13 is merged, the same governed pipeline returns to PR #8 before TASK-AI-07.

## Business outcome

After an implementation Pull Request has immutable proof that its exact head passed every approved gate, the operator can leave the orchestrator running and the deterministic controller will merge that exact head through GitHub without another routine click. Any missing, stale, ambiguous, untrusted, unresolved, or contradictory signal stops without merging.

## Source references

- `HUMAN-DECISION-ORCHESTRATOR-CORE-PRIORITY-2026-09-08` — explicit approval for governed auto-merge through TASK-AI-13, priority order, PR #8 preservation, and `CORE_COMPLETE` termination.
- `AGENTS.md` sections **Semi-automatic workspaces**, **Role separation**, **Unit of delivery**, **Pull Request evidence**, **Code review rules**, and **Destructive actions** — branch isolation, independent review, one Work Item per PR, and fail-closed controls. The implementation must version the narrowly scoped auto-merge exception; it must not weaken author/reviewer separation.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` sections **State flow**, **CI verifies the handoff**, **Controller starts independent Codex review**, and **Correction loop**.
- `docs/product-spec/work-items/TASK-AI-06.md` rules `AI-SUP-02`, `AI-SUP-10`, `AI-SUP-15`, `AI-SUP-16`, `AI-SUP-17`, `AI-SUP-19`, and `AI-SUP-21` — single governed target, exact branch/Work Item binding, GitHub Actions provenance, bounded evidence, and immutable reviewer identity.
- GitHub GraphQL `MergePullRequestInput.expectedHeadOid` — the merge mutation must reject a head that changed after preflight: https://docs.github.com/en/graphql/reference/input-objects#mergepullrequestinput
- GitHub GraphQL `PullRequestReviewThread.isResolved` — review threads must be paginated and every thread resolved before merge: https://docs.github.com/en/graphql/reference/objects#pullrequestreviewthread
- GitHub branch-protection required status-check API — required contexts and bound GitHub App identities are read from current protection rather than inferred: https://docs.github.com/en/rest/branches/branch-protection#get-status-checks-protection

## Preconditions and dependencies

- PR #9 is merged; `origin/main` contains merge commit `fdf87594e60dc95aa1b9facb8af365666236f0e9`.
- TASK-AI-06 is reconciled to `MERGED` in this branch with PR #9, exact reviewed head `79faf3f1a19d80905ad03a2e861b5e2bef5ca153`, trusted verdict `PASS`, and merge commit evidence.
- The installed AO runtime remains pinned to the governed version and launches only through the approved localhost AgentRouter profile.
- The GitHub credential used by the controller has only the permission needed to read evidence and merge an eligible Pull Request. Missing permission is a blocker, never a reason to bypass evidence.
- PR #8 and its dirty Gemini repair worktree are preserved byte-for-byte until TASK-AI-13 has merged.

## Author boundary

Assign `GEMINI`. This Work Item changes a high-risk external side effect, the delivery state machine, GitHub evidence interpretation, reviewer/author separation, and crash recovery. A constrained 9Router worker must not implement or approve it.

The author may change only the allowed paths. It must not modify application code, PR #8, AO internals, provider/model routing, dashboard behavior, product features, branch protection settings, credentials, or repository secrets. It must not merge its own implementation PR; the existing human gate remains authoritative for the bootstrap merge of TASK-AI-13 itself unless a separately trusted controller version already satisfies this complete acceptance contract.

## In scope

1. Add one deterministic auto-merge transition after `READY_FOR_HUMAN_MERGE` that performs a fresh, single-snapshot preflight and then submits one GitHub merge mutation with `expectedHeadOid`.
2. Resolve exactly one open Pull Request by Work Item ID, head branch, base repository, and base branch. Ambiguity, forked heads, wrong branches, closed PRs, or duplicate Work Items stop fail-closed.
3. Read the current required status-check configuration for `main`, then bind every required context to the newest exact-head GitHub Actions check attempt and its expected GitHub App identity. For this Work Item, only completed `SUCCESS` is GREEN; missing, queued, in-progress, skipped, neutral, cancelled, timed out, action-required, stale, duplicate-latest, non-Actions, or unparseable checks block merge.
4. Accept review authority only from the immutable login `chatgpt-codex-connector[bot]`. Require an explicit terminal `PASS` tied to the exact head, reject stale or newer negative evidence, and reject evidence authored by the implementation author or any non-allowlisted identity.
5. Paginate reviews, issue comments, inline review comments, reactions when diagnostic, and GraphQL review threads to exhaustion. Any endpoint or parse failure blocks merge.
6. Require zero unresolved review threads and zero current actionable findings after the terminal exact-head PASS settle window. An outdated thread may be resolved only by the existing evidence-governed review workflow; auto-merge itself must never resolve a thread.
7. Require the Pull Request to be open, non-draft, mergeable, based on `main`, and unchanged between the evidence snapshot and mutation. `UNKNOWN`, `CONFLICTING`, `BEHIND` when strict protection requires freshness, or any unexpected mergeability state blocks or enters a bounded recheck without mutation.
8. Pass the preflight head SHA as `expectedHeadOid` to GitHub. A stale-head rejection restarts observation for the new head and must never reuse the earlier checks or review verdict.
9. Make merge dispatch idempotent and crash-safe. Persist a pending merge intent keyed by repository, PR number, Work Item, and expected head before dispatch; after restart, reconcile GitHub PR state and merge commit before retrying. Never emit two blind merge mutations.
10. Verify the postcondition from GitHub: PR state `MERGED`, merge commit OID present, and merged head/base identity matching the pending intent. Only then record `MERGED`, PR number, trusted verdict, reviewed head, and merge commit in the delivery register through a governed follow-up branch/PR or the already-authorized exact mechanism; protected `main` must never be left dirty.
11. Add bounded retries only for GitHub propagation states explicitly classified as transient. Authentication, authorization, malformed evidence, contradictory records, stale head, missing required checks, unresolved threads, or merge conflicts fail closed with an actionable blocker.
12. Update `AGENTS.md`, workflow documentation, controller README, and state diagrams so the auto-merge authority is limited to this exact evidence contract. Human approval remains required for product decisions, destructive recovery, credentials, ambiguous business rules, and exhausted recovery budgets.
13. Preserve PR #8 during TASK-AI-13. After the TASK-AI-13 bootstrap merge, the controller must select PR #8 for repair before preparing TASK-AI-07, without closing, deleting, or duplicating PR #8.
14. Expose a deterministic terminal status `CORE_COMPLETE` only after both TASK-AI-12 and TASK-AI-13 are verified `MERGED`. TASK-AI-14 and TASK-AI-15 must never be selected by this approved core run.

## Out of scope

- Implementing TASK-AI-07 through TASK-AI-12 in this Pull Request.
- Repairing, closing, deleting, superseding, or merging PR #8 before TASK-AI-13 is active.
- TASK-AI-14 dashboard work.
- TASK-AI-15 API/model routing.
- Changing application features, carrier behavior, tenant data, money logic, or user-facing screens.
- Changing GitHub branch-protection rules, repository secrets, credentials, billing, or collaborator permissions.
- Using GitHub native auto-merge as a substitute for deterministic controller preflight unless it preserves the same expected-head and evidence contract and is proven by tests.
- Auto-resolving review threads or dismissing reviews.

## Business rules and edge cases

- `AI-MERGE-01`: No merge command or mutation is reachable until every rule in this Work Item returns an affirmative result for one immutable snapshot.
- `AI-MERGE-02`: The expected head is a 40-character commit OID captured from the target PR and passed to `expectedHeadOid`; abbreviated or caller-supplied unverified SHAs are rejected.
- `AI-MERGE-03`: Every required check must be the unambiguous newest exact-head GitHub Actions attempt and conclude `SUCCESS`.
- `AI-MERGE-04`: The only trusted reviewer login is `chatgpt-codex-connector[bot]`; configuration, environment variables, PR authors, repository owners, and implementation authors cannot extend the allowlist.
- `AI-MERGE-05`: The implementation author cannot supply, approve, transform, or self-validate the terminal review verdict.
- `AI-MERGE-06`: One or more unresolved review threads blocks merge. Query failure is not equivalent to zero.
- `AI-MERGE-07`: A terminal PASS does not override a newer exact-head finding, contradictory equal-time verdict, unresolved thread, or failed check.
- `AI-MERGE-08`: Draft, fork, wrong-base, closed, already superseded, ambiguous, or non-mergeable Pull Requests are never merged.
- `AI-MERGE-09`: After any observed head change, discard the complete evidence snapshot and start again.
- `AI-MERGE-10`: Merge intent is persisted before the external effect; successful postcondition is persisted only after GitHub confirms it.
- `AI-MERGE-11`: A timed-out or ambiguous merge response is reconciled from remote PR state before any retry.
- `AI-MERGE-12`: PR #8 is an explicit preservation target during the bootstrap and cannot be closed, deleted, replaced, or accidentally selected as TASK-AI-13.
- `AI-MERGE-13`: The controller stops at `CORE_COMPLETE` only when TASK-AI-12 and TASK-AI-13 are both durably reconciled as `MERGED`.
- `AI-MERGE-14`: TASK-AI-14 and TASK-AI-15 are outside the approved run and selection must stop before either.

## UI states

No product UI changes. Console/operator states must be explicit: `WAIT_CI`, `WAIT_REVIEW`, `WAIT_THREADS`, `WAIT_MERGEABLE`, `MERGE_INTENT_PERSISTED`, `MERGE_RECONCILING`, `MERGED`, `BLOCKED`, and `CORE_COMPLETE`. Every wait state is bounded or driven by a documented external transition; no state may poll forever.

## API, event and data impact

- GitHub read APIs: Pull Request identity/head/base/draft/mergeability, branch-protection required checks, exact-head check suites/runs, reviews, issue comments, inline review comments, author identity, and paginated GraphQL review threads.
- GitHub write API: one merge mutation for the governed target using `expectedHeadOid`; no thread-resolution, review-dismissal, branch-protection, branch-deletion, PR-close, or PR-edit mutation.
- Checkpoint schema: add versioned pending/acknowledged merge intent, expected head, evidence digest/timestamps, merge attempt count, and confirmed merge commit. Older checkpoints must migrate deterministically or stop with preservation instructions.
- Delivery register: record reviewed head and merge evidence without direct edits to protected `main`.
- Logs: include Work Item, PR, expected head, check names/providers/conclusions, trusted verdict identifier, unresolved count, mergeability, mutation attempt key, and final merge commit; never include tokens, raw secrets, or unnecessary comment bodies.

## Acceptance matrix

| AC/Test ID    | Scenario                                                                                                                           | Expected result                                                               | Evidence required                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| `AC-AI-13-01` | Exactly one governed PR matches Work Item and branch                                                                               | Controller selects that PR only                                               | Deterministic fixture              |
| `AC-AI-13-02` | Zero or multiple matching PRs                                                                                                      | Stop without merge                                                            | Negative fixture                   |
| `AC-AI-13-03` | PR is draft, closed, forked, or targets a base other than `main`                                                                   | Stop without merge                                                            | Negative fixtures                  |
| `AC-AI-13-04` | Current branch protection lists required checks                                                                                    | Controller requires every listed context and expected App source              | Captured API fixture and assertion |
| `AC-AI-13-05` | Required check is missing, pending, skipped, neutral, cancelled, failed, stale, duplicated ambiguously, or not from GitHub Actions | Not GREEN; no merge mutation                                                  | Table-driven tests                 |
| `AC-AI-13-06` | All required newest exact-head GitHub Actions attempts are `SUCCESS`                                                               | CI gate becomes GREEN                                                         | Positive fixture                   |
| `AC-AI-13-07` | PASS comes from repository owner, PR author, implementation author, environment-configured login, or another bot                   | Reject as untrusted                                                           | Identity fixtures                  |
| `AC-AI-13-08` | Trusted bot supplies explicit terminal PASS for exact head with no newer negative evidence                                         | Review gate becomes PASS                                                      | Captured durable review fixture    |
| `AC-AI-13-09` | Review endpoint fails, evidence conflicts, verdict is stale, or newer exact-head finding exists                                    | Stop fail-closed                                                              | Failure fixtures                   |
| `AC-AI-13-10` | Review-thread pagination returns one unresolved thread on any page                                                                 | No merge mutation                                                             | Multi-page GraphQL fixture         |
| `AC-AI-13-11` | Review-thread query succeeds and every thread is resolved                                                                          | Thread gate returns zero unresolved                                           | Positive fixture                   |
| `AC-AI-13-12` | Review-thread query/parse fails                                                                                                    | Stop; never interpret as zero                                                 | Failure fixture                    |
| `AC-AI-13-13` | Mergeability is `UNKNOWN`, `CONFLICTING`, or stale/behind under strict protection                                                  | Bounded wait or blocker; no mutation                                          | State tests                        |
| `AC-AI-13-14` | PR head changes after preflight                                                                                                    | Old evidence is discarded; stale merge is rejected                            | Race fixture                       |
| `AC-AI-13-15` | All gates pass                                                                                                                     | Exactly one merge request includes the full captured SHA as `expectedHeadOid` | Command/mutation-vector assertion  |
| `AC-AI-13-16` | GitHub rejects `expectedHeadOid`                                                                                                   | No retry with stale evidence; observe new head                                | API failure fixture                |
| `AC-AI-13-17` | Process stops after persisting intent but before response                                                                          | Restart reconciles PR state before retry                                      | Crash-recovery fixture             |
| `AC-AI-13-18` | Merge response times out or is malformed                                                                                           | Reconcile remote PR/head/merge commit; fail closed if ambiguous               | Recovery fixture                   |
| `AC-AI-13-19` | Merge succeeds                                                                                                                     | Confirm `MERGED` and merge commit before advancing register                   | Postcondition fixture              |
| `AC-AI-13-20` | Current GitHub credential lacks merge permission                                                                                   | Report credential/permission blocker without bypass                           | Negative fixture                   |
| `AC-AI-13-21` | Implementation author attempts to provide the trusted verdict                                                                      | Self-review is rejected                                                       | Author/reviewer separation test    |
| `AC-AI-13-22` | TASK-AI-13 bootstrap runs while PR #8 exists                                                                                       | No PR #8 write, close, merge, branch deletion, or duplicate PR                | Mutation-surface audit             |
| `AC-AI-13-23` | TASK-AI-13 is merged                                                                                                               | Controller selects existing PR #8 repair before TASK-AI-07                    | Sequencing fixture                 |
| `AC-AI-13-24` | TASK-AI-12 and TASK-AI-13 are both reconciled MERGED                                                                               | Controller returns `CORE_COMPLETE` and does not select AI-14/AI-15            | End-to-end state test              |
| `AC-AI-13-25` | Any required evidence is absent or contradictory                                                                                   | Terminal or bounded fail-closed state; never merge                            | Aggregate negative test            |

## Verification commands

Run from a clean checkout of the implementation head:

- `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\ai\control.ps1 -Action Test`
- PowerShell parser checks for every changed `.ps1` file.
- `python docs/product-spec/scripts/validate_docs.py`
- `pnpm format:check`
- `pnpm security:secrets`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- Targeted mocked GraphQL/REST tests proving no live merge occurs in test mode and every acceptance row above.
- CI `contract` and `application-gate` from GitHub Actions on the exact PR head.

## Codex review record

| Review round | Commit  | Verdict | Findings resolved                 |
| ------------ | ------- | ------- | --------------------------------- |
| 1            | Pending | Pending | Fresh independent review required |

## Residual limitations

- TASK-AI-13 supplies the governed merge gate and approved sequencing boundary. Cross-harness fallback, richer repair diagnostics, full restart recovery, permission hardening, preview mode, and Windows scheduling remain TASK-AI-07 through TASK-AI-12 and must be delivered as separate Pull Requests.
- GitHub API availability and credential permission remain external dependencies; exhaustion becomes a written blocker.
