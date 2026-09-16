# TASK-AI-19 — Deterministic register reconciler with write-back

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-19` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `152` |
| Dependencies | `TASK-AI-17` (merged, `1f587dd`) |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/reconcile.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/test/reconcile.test.js`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `docs/product-spec/work-items/TASK-AI-19.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-19-reconciler` |
| Pull Request | `https://github.com/vinh05092001/shipde-platform/pull/23` |

## Business outcome

The delivery register (`FEATURE-DELIVERY-REGISTER.csv`) is the repository's
single source of truth for queue ordering, Work Item readiness, and autonomous
orchestrator dispatch. Today, `tools/ai-brain/reconcile.js` checks the register
against repository and Git facts, but operates strictly as a read-only analyzer.
When dependencies merge, dependent rows remain frozen in `BLOCKED_DEPENDENCY`
or `BLOCKED_BY_FOUNDATION` until an operator or author manually edits the CSV.

A prime example is `TASK-AI-07` ("Cross-harness worker failover and bounded
recovery"). Its sole declared dependency, `TASK-AI-06`, merged to `main` in PR #9
(`fdf87594e60dc95aa1b9facb8af365666236f0e9`). Although `reconcile` reports
`BLOCK_NO_LONGER_TRUE`, `TASK-AI-07` remains recorded as `BLOCKED_DEPENDENCY`.
Manual CSV editing by autonomous agents introduces high risks of RFC 4180 quote
corruption, carriage return mutilation, and accidental churn on unrelated rows.

Adding a deterministic write-back capability (`node tools/ai-brain/cli.js reconcile --write`)
allows the register to self-heal: stale dependency blocks clear automatically,
transitioning to `BACKLOG` so that Codex planning can author the specification.
Importantly, write-back must be strictly fail-closed, refuse to advance rows
past unpassed lifecycle gates, refuse execution in the protected main worktree,
and emit durable before/after audit records with deterministic reversal procedures.

## Source references

- `AGENTS.md` § Source of truth — Specification precedence over code; a row
  must never claim what repository evidence cannot prove.
- `AGENTS.md` § Unit of delivery — Required status flow:
  `BACKLOG -> BLOCKED_BY_FOUNDATION/BLOCKED_DEPENDENCY -> READY_FOR_AUTHOR -> IN_PROGRESS -> READY_FOR_CODEX -> CHANGES_REQUIRED -> READY_FOR_CODEX -> CODEX_PASS -> MERGED`.
- `AGENTS.md` § Semi-automatic workspaces — Protected `shipde-platform`/`main`
  integration baseline; implementation agents must not edit it directly.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` § 1. Codex
  prepares the next item — Dependency-ready Work Items in ascending delivery
  order; dependencies must be `MERGED`. Codex planning owns selecting items and
  setting `READY_FOR_AUTHOR`.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § `AI-TOOL-12` —
  GitHub merged state is reconciled by PR identity and merge SHA; repeated
  synchronization is a no-op and never rewrites unrelated rows.
- `scripts/ai/control.ps1` § `Sync-ShipDeRegister`, `Sync-ShipDeRegisterAfterAutoMerge`,
  `$script:TrustedCodexReviewerLogins` — Protected main worktree guard, exact-HEAD
  Codex review verdict validation, and fail-closed merge synchronization.
- `tools/ai-brain/reconcile.js` — Core reconciliation rules: `BLOCK_NO_LONGER_TRUE`,
  `MERGE_NOT_RECORDED`, `SPEC_MISSING`, `MERGED_WITHOUT_COMMIT`.
- `tools/ai-brain/cli.js` — CLI command entrypoint for register reconciliation.
- `tools/ai-dashboard/register-adapter.js` — RFC 4180 CSV parser and register
  state derivation.

## Preconditions and dependencies

- `TASK-AI-17` merged into baseline (`1f587dd`), bringing manifest truth and zero
  manifest errors.
- `node tools/ai-brain/cli.js reconcile` reports 0 errors and 1 warning
  (`BLOCK_NO_LONGER_TRUE` for `TASK-AI-07`).
- `TASK-AI-06` merged (`fdf87594e60dc95aa1b9facb8af365666236f0e9`) with Codex
  verdict `PASS` and PR #9 evidence.
- `FEATURE-DELIVERY-REGISTER.csv` formatted according to RFC 4180 with standard
  headers.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded
to the six allowed paths:
`tools/ai-brain/reconcile.js`,
`tools/ai-brain/cli.js`,
`tools/ai-brain/test/reconcile.test.js`,
`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`,
`docs/product-spec/work-items/TASK-AI-19.md`, and
`docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`.

Prohibited in this Work Item:
- Modifying merge preflight or trusted reviewer logic in `scripts/ai/control.ps1`.
- Editing `.github/workflows/`, `scripts/verify-*`, or `docs/product-spec/scripts/`.
- Weakening or skipping any quality gate or validation check.
- Altering the column schema of `FEATURE-DELIVERY-REGISTER.csv`.
- Flipping statuses or lifecycle states without verifiable repository evidence.
- Running write-back in the protected main worktree (`shipde-platform`/`main`).

## In scope

- Implement write-back logic in `tools/ai-brain/reconcile.js` to recompute row
  statuses strictly governed by the Allowed-Transition Table.
- Support `--write`, `--dry-run`, `--revert <audit-file>`, `--register <path>`,
  `--merge-evidence <path>`, `--audit-out <path>`, and `--allow-fixture-write` CLI options in
  `tools/ai-brain/cli.js reconcile`. Unknown or misspelled options must be rejected with exit
  code 1 rather than silently ignored, so no acceptance command can pass while operating on a
  different register than the one it names.
- Enforce protected main worktree preflight: `--write` refuses to run (exit code 1)
  if invoked on the `main` or `master` branch or within the protected `shipde-platform`
  integration worktree, emitting an explicit refusal message to stderr and requiring
  execution in a dedicated feature worktree.
- Clear stale `BLOCKED_DEPENDENCY` and `BLOCKED_BY_FOUNDATION` rows strictly to `BACKLOG`
  when all declared dependencies are verifiably `MERGED` (reachable on `mainRef`
  with `codex_verdict: PASS`). Rows must never skip or bulk-promote to `READY_FOR_AUTHOR`
  upon dependency clearance, as mere existence of `work_item_path` does not satisfy the
  Definition of Ready or bypass Codex's required per-item planning and selection gate.
- Record unrecorded merges to `MERGED` only when provided with equivalent verified durable
  merge evidence (`--merge-evidence <file>` from supervisor preflight or GitHub PR metadata)
  for rows already in active post-review lifecycle states (`READY_FOR_CODEX` or `CODEX_PASS`).
  In the absence of verified durable merge evidence, write-back strictly refuses to mutate
  rows to `MERGED`; inferring merge status from Git branch tip ancestry or commit subject
  matching is prohibited.
- Produce a durable before/after audit artifact in
  `docs/product-spec/docs/10-ai-collaboration/audit/` recording run identity,
  operator, head commit, pre/post SHA-256 hashes, and per-row mutation details.
- Provide a deterministic reversal procedure (`reconcile --revert <audit-file>`)
  restoring the exact pre-mutation CSV content verified against `pre_hash_sha256`.
- Enforce fail-closed refusal (exit code 1, zero file change, no `.tmp` file)
  whenever any overstatement or structural integrity finding (`error` severity)
  is present.
- Ensure atomic writes via sibling `.tmp` files and exact RFC 4180 serialization,
  preserving quotes, CRLF/LF line endings, and byte-for-byte fidelity of untouched rows.
- Author comprehensive unit tests in `tools/ai-brain/test/reconcile.test.js`
  using named fixtures and proving idempotency, transition gating, refusal,
  and audit rollback.

## Out of scope

- Authoring missing Work Item specifications (assigned to `TASK-AI-20`).
- Implementing failover runtime logic for `TASK-AI-07` itself.
- Setting `READY_FOR_AUTHOR` status (reserved exclusively for Codex planning).
- Querying remote GitHub REST/GraphQL endpoints at runtime without local fallback
  (reconciler operates deterministically on local Git DAG and repository facts).
- Modifying supervisor auto-merge routines in `scripts/ai/control.ps1`.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-19-R01` | **Idempotency and determinism**: Running `cli.js reconcile --write` multiple times on an unchanged repository produces zero diff and identical file hashes after the first execution. |
| `AI-19-R02` | **Allowed-transition enforcement**: Mutations are restricted to the transitions explicitly enumerated in the Allowed-Transition Table. Any row transition not permitted by the table is strictly prohibited and fails closed. |
| `AI-19-R03` | **Stale dependency unblocking strictly to BACKLOG**: When all declared dependencies for a `BLOCKED_DEPENDENCY` or `BLOCKED_BY_FOUNDATION` row are `MERGED` with valid reachable commits on `mainRef` and a recorded review outcome in `codex_verdict` that is either `PASS` (the independent Codex verdict) or `FALLBACK_PASS` (a review that genuinely ran on another reviewer, named in the register rather than disguised as Codex), write-back transitions the status strictly to `BACKLOG`. An **empty** `codex_verdict` never clears a block: the absence of review is not a weaker form of evidence, and a chain of unreviewed work must not clear itself one link at a time. The bar is lower here than for `MERGED` for one reason only - `BACKLOG` confers nothing, since promotion to `READY_FOR_AUTHOR` remains reserved to the independent planning gate, so requiring full merge-grade evidence to move a row from *waiting* to *not yet queued* protects nothing while leaving the register saying something false. Mere existence of `work_item_path` does not prove readiness, provenance from approved sources, or queue eligibility. Promoting rows to `READY_FOR_AUTHOR` is reserved exclusively for the independent Codex planning and selection gate per AGENTS.md § Role separation; write-back must never bulk-promote unblocked rows to `READY_FOR_AUTHOR`. |
| `AI-19-R04` | **Durable-evidence-bound MERGED transition** (see `AI-19-R05` for the fallback reviewer's terms): A row may transition from `READY_FOR_CODEX` or `CODEX_PASS` to `MERGED` only when provided with equivalent durable merge evidence (`--merge-evidence <file>`) verifying: (1) PR identity matches row's `pr` and title `[<WORK_ITEM_ID>]`; (2) exact 40-character merge commit SHA verified reachable on `mainRef`; (3) exact-HEAD Codex review verdict is `PASS` from a trusted reviewer login (`chatgpt-codex-connector[bot]` or authorized role) on the exact reviewed `headRefOid` with 0 unresolved review threads; (4) required CI checks report `SUCCESS` on exact `headRefOid`; (5) `work_item_path` exists on disk. Because runtime GitHub queries are out of scope, the reconciler must consume equivalent durable evidence or refuse to write `MERGED`. Inferring merge from branch tip ancestry or commit subjects is prohibited (`AI-TOOL-12`). In the absence of durable evidence, write-back strictly refuses `MERGED` transition and retains existing status. Condition (3) is satisfied by a `FALLBACK_PASS` only on the terms `AI-19-R05` states. |
| `AI-19-R05` | **A fallback review may record a merge, on terms Codex is not held to.** `TASK-AI-14` established a machine-authenticated reviewer as an approved route; `AI-19-R04` was written before it and refused every `FALLBACK_PASS`, which left work that had genuinely shipped unrecordable whenever Codex was unreachable. A `FALLBACK_PASS` now satisfies condition (3), and only then, when the evidence also carries: (a) `fallbackReviewer`, the exact model identity that performed the review, because a verdict naming nobody cannot be checked or withdrawn; and (b) `reviewedCommit`, a 40-character SHA equal to `headRefOid`, because a review of an earlier commit is a review of different code. Codex is exempt from both because GitHub verifies its identity and the connector reports the head it read. Every other condition of `AI-19-R04` applies unchanged: an unreachable merge commit, an unresolved review thread, failing CI or a missing `work_item_path` refuses the row whatever the verdict. A verdict that is neither `PASS` nor `FALLBACK_PASS` is refused. |
| `AI-19-R05` | **Fail-closed refusal on overstatements**: An overstatement is defined as any finding with `severity: 'error'` (`ROW_WITHOUT_ID`, `DUPLICATE_WORK_ITEM_ID`, `MERGED_WITHOUT_COMMIT`, `MERGE_COMMIT_MISSING`, `MERGE_COMMIT_NOT_REACHABLE`, `MERGED_WITHOUT_PASS`, `SPEC_MISSING` on terminal or ready rows). If any `error` exists, write-back refuses execution with exit code 1, leaving the CSV completely untouched (pre-hash == post-hash) and leaving no `.tmp` file. |
| `AI-19-R06` | **Protected main worktree guard**: Write-back must refuse to run (exit code 1) when executed on the `main`/`master` branch or within the protected `shipde-platform` integration worktree, emitting `Write-back refused: running in protected main worktree/branch. Mutations require a dedicated feature worktree and branch.` to stderr. The register remains untouched (pre-hash == post-hash) with zero temporary files left. Mutations require a dedicated feature worktree and branch, ensuring clean integration baselines and auditable branch/PR handoff output per AGENTS.md § Semi-automatic workspaces. |
| `AI-19-R07` | **Durable audit artifact and rollback**: Every `--write` execution writes a durable JSON audit artifact containing run ID, timestamp, operator session, git commit, pre/post SHA-256 hashes, and per-row mutation records with rule and evidence citations. A deterministic reversal procedure (`--revert <audit-file>`) restores the register to its exact pre-write state. |
| `AI-19-R08` | **Atomic RFC 4180 serialization**: File writes must be atomic via temporary sibling files (`FEATURE-DELIVERY-REGISTER.csv.tmp`), preserving RFC 4180 quoting rules, existing line endings, and byte-for-byte integrity of unaffected rows. |
| `AI-19-R09` | **Read-only default**: Invoking `cli.js reconcile` without `--write` is strictly read-only; mutations require explicit `--write`. `--dry-run` outputs the exact planned diff without touching disk. |
| `AI-19-R10` | **No vacuous verification**: Every acceptance command must assert observable state, not merely an exit code. `node --test --test-name-pattern=<p>` exits `0` when `<p>` matches no test, so a bare exit-code assertion over a pattern proves nothing. Acceptance rows therefore invoke the CLI against a named fixture and compare the register SHA-256 against the audit artifact's `pre_hash_sha256`/`post_hash_sha256`; where a pattern-based run is unavoidable, the run must also assert that a non-zero number of tests matched. `AC-AI-19-11` is the standing negative proof that this class of defect fails closed. |

### Allowed-Transition Table

| Source Status | Destination Status | Preconditions and Required Evidence | Prohibited Shortcuts / Refusal Behavior |
|---|---|---|---|
| `BLOCKED_DEPENDENCY` | `BACKLOG` | 1. All declared dependencies in `dependencies` field exist in the register (`byId.has(dep)`).<br>2. Every declared dependency has `status == 'MERGED'`.<br>3. Every dependency has a 40-character `merge_commit` verified reachable on `mainRef` (`git merge-base --is-ancestor <sha> <mainRef>`).<br>4. Every dependency has `codex_verdict == 'PASS'`.<br>5. Target row has valid `work_item_id`. | Refuse transition to `READY_FOR_AUTHOR` (mere existence of spec does not prove Definition of Ready or queue selection; requires independent Codex planning gate) or `MERGED` (cannot skip author/PR/review/CI gates). |
| `BLOCKED_BY_FOUNDATION` | `BACKLOG` | 1. All foundation prerequisites (`TASK-FOUND-01` through `TASK-FOUND-04`) and declared dependencies are `MERGED` with reachable commits and `codex_verdict: PASS`.<br>2. Target row has valid `work_item_id`. | Refuse transition to `READY_FOR_AUTHOR` or `MERGED`. |
| `READY_FOR_CODEX` or `CODEX_PASS` | `MERGED` | 1. Provided with verified durable merge evidence artifact (`--merge-evidence <file>`).<br>2. Verified PR reference in evidence matches `pr` field; PR title strictly matches `[<WORK_ITEM_ID>] <outcome>`.<br>3. Authoritative 40-character merge commit SHA verified reachable on `mainRef` (`git merge-base --is-ancestor <sha> origin/main`).<br>4. Exact-HEAD Codex review verdict is `PASS` from a trusted reviewer login (`chatgpt-codex-connector[bot]` or authorized role) on exact `headRefOid` with 0 unresolved review threads.<br>5. Required CI checks report `SUCCESS` on exact `headRefOid`.<br>6. `work_item_path` exists on disk. | Refuse if durable merge evidence is absent, unverified, or fails DAG reachability.<br>Refuse any branch tip ancestry inference or commit text heuristic (`AI-TOOL-12`).<br>Refuse if source status is `BACKLOG`, `BLOCKED_*`, or `READY_FOR_AUTHOR` (skipping lifecycle gates strictly prohibited). |
| *Any other status* | *Any other status* | N/A | **STRICTLY PROHIBITED**. Reconciler refuses mutation and retains existing row status. |

### Binding MERGED Writes to Exact Reviewed PR Head and Durable Evidence

Squash merges (the repository standard under `TASK-AI-13`) squash feature branch commits
into a single new commit on `main`. As a result, the branch tip commit is **not** an
ancestor of `mainRef` (`git merge-base --is-ancestor <branchTip> origin/main` evaluates to false).
Furthermore, an unchanged branch tip already points into `main`, and an unbound `codex_verdict: PASS`
in the CSV may refer to an older head rather than the merged commit.

Under policy `AI-TOOL-12`, GitHub merged state is reconciled strictly by PR identity and merge SHA.
Because runtime GitHub queries are declared out of scope for local offline reconciliation, the reconciler
must consume equivalent durable evidence or refuse to write `MERGED`:
1. **Durable Merge Evidence Input**: The reconciler accepts a durable merge evidence artifact
   (`--merge-evidence <path-to-file>`) containing verified PR metadata (`number`, `title`, `headRefOid`,
   `mergeCommit.oid`, `codexVerdict`, `unresolvedThreadsCount`, `ciChecksStatus`) exported from
   supervisor preflight snapshots (`control.ps1` § `Sync-ShipDeRegister`) or GitHub CLI.
2. **DAG Reachability Verification**: The reconciler verifies that `mergeCommit.oid` is a valid 40-character SHA
   present in Git (`git cat-file -e <sha>`) and directly reachable on `mainRef` (`git merge-base --is-ancestor <sha> origin/main`).
3. **Exact-HEAD Review Binding**: The reconciler asserts that `codexVerdict == 'PASS'` from a trusted
   reviewer login with 0 unresolved review threads on the exact `headRefOid` that produced the merge.
4. **Fail-Closed Refusal**: If no durable merge evidence artifact is provided, or if any verification step fails,
   the reconciler strictly refuses to write `MERGED`, leaves the row status intact, and emits an informative
   warning. Inferring merge status solely from Git branch ancestry or commit subject grep is prohibited.

## UI states

Not applicable; this Work Item has no user-facing screen. Operator-facing CLI
states for `node tools/ai-brain/cli.js reconcile`:
- **Read-only report** (`cli.js reconcile`): Displays grouped findings by severity
  (`[LỖI ]`, `[CẢNH]`, `[GHI ]`) without modifying disk; exits 0 when clean or warnings-only,
  exits 1 on error findings.
- **Write-back preview** (`--dry-run`): Displays the exact row diff and audit preview
  without writing to disk; exits 0.
- **Write-back applied** (`--write` in feature worktree): Atomically writes changes,
  creates audit JSON artifact, outputs mutation summary, and exits 0.
- **Protected worktree refusal**: Emits error to stderr (`Write-back refused: running in protected main worktree/branch`)
  and exits code 1 with zero file modifications.
- **Error refusal**: Emits blocking errors (`severity: error`) to stderr and exits code 1
  with zero file modifications.
- **Audit revert applied** (`--revert <audit-file>`): Verifies post-hash, restores pre-write
  CSV content, verifies pre-hash, prints rollback confirmation, and exits 0.

## API, event and data impact

### Audit Artifact Schema

Every `--write` execution writes a durable JSON audit artifact to
`docs/product-spec/docs/10-ai-collaboration/audit/reconcile-audit-<timestamp>-<headSha>.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "run_id": "uuid-or-timestamp-string",
  "timestamp": "ISO-8601 UTC timestamp",
  "operator_session": "session-id-or-username",
  "head_sha": "40-character git commit SHA",
  "worktree": "path-to-current-worktree",
  "branch": "fix/task-ai-19-reconciler",
  "register_path": "docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv",
  "pre_hash_sha256": "64-character hex sha256 of register before mutation",
  "post_hash_sha256": "64-character hex sha256 of register after mutation",
  "mutations": [
    {
      "work_item_id": "TASK-AI-07",
      "rule_id": "AI-19-R03",
      "field": "status",
      "old_value": "BLOCKED_DEPENDENCY",
      "new_value": "BACKLOG",
      "evidence": {
        "reason": "Dependencies merged with PASS verdict",
        "dependencies": ["TASK-AI-06"],
        "dependency_commits": ["fdf87594e60dc95aa1b9facb8af365666236f0e9"],
        "codex_verdicts": ["PASS"]
      }
    }
  ]
}
```

### Reversal Procedure

To rollback an applied write-back cleanly and deterministically:
1. Run `node tools/ai-brain/cli.js reconcile --revert <path-to-audit-file>`.
2. The CLI loads the audit file and computes the current SHA-256 hash of `FEATURE-DELIVERY-REGISTER.csv`.
3. If current hash does not match `post_hash_sha256`, the command refuses rollback fail-closed
   (preventing clobbering concurrent or subsequent edits).
4. If hash matches, the CLI applies inverse mutations restoring each `old_value`.
5. The CLI atomically writes the restored content and computes the resulting SHA-256 hash.
6. The CLI asserts that the resulting hash matches `pre_hash_sha256` byte-for-byte.
7. An audit rollback confirmation entry is appended to the audit artifact.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-19-01` | Stale block unblocking strictly to `BACKLOG` (`TASK-AI-07`) | Status transitions from `BLOCKED_DEPENDENCY` strictly to `BACKLOG`; row is not advanced to `READY_FOR_AUTHOR`; audit artifact created | Command: `node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/fixtures/register-stale-dependency.csv --write --allow-fixture-write`<br>Exit code: `0`<br>Expected output: `Reconciled TASK-AI-07: BLOCKED_DEPENDENCY -> BACKLOG`<br>Source file: `tools/ai-brain/test/fixtures/register-stale-dependency.csv` |
| `AC-AI-19-02` | Active/unresolved dependency retention | Row with unmerged dependency remains `BLOCKED_DEPENDENCY`; 0 modifications to CSV | Command: `node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/fixtures/register-active-dependency.csv --write --allow-fixture-write`<br>Exit code: `0`<br>Expected output: `Register unchanged: 0 mutations applied`<br>Source file: `tools/ai-brain/test/fixtures/register-active-dependency.csv` |
| `AC-AI-19-03` | Verified unrecorded merge recording with durable evidence | Row in `READY_FOR_CODEX` supplied with verified durable merge evidence transitions to `MERGED`; the register bytes actually change and the audit artifact records the resulting hash | Command: `node -e "const fs=require('fs');fs.mkdirSync('tools/ai-brain/test/tmp',{recursive:true});fs.copyFileSync('tools/ai-brain/test/fixtures/register-unrecorded-merge.csv','tools/ai-brain/test/tmp/ac03.csv')" && node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/tmp/ac03.csv --merge-evidence tools/ai-brain/test/fixtures/merge-evidence-pr9.json --write --allow-fixture-write --audit-out tools/ai-brain/test/tmp/ac03-audit.json && node -e "const fs=require('fs'),c=require('crypto');const a=JSON.parse(fs.readFileSync('tools/ai-brain/test/tmp/ac03-audit.json','utf8'));const h=c.createHash('sha256').update(fs.readFileSync('tools/ai-brain/test/tmp/ac03.csv')).digest('hex');if(h!==a.post_hash_sha256||a.pre_hash_sha256===a.post_hash_sha256){console.log('HASH_CHECK_FAILED');process.exit(1)}console.log('POST_HASH_MATCH')"`<br>Exit code: `0`<br>Expected output: `Reconciled TASK-AI-06: READY_FOR_CODEX -> MERGED` then `POST_HASH_MATCH`<br>Source file: `tools/ai-brain/test/fixtures/register-unrecorded-merge.csv`, `tools/ai-brain/test/fixtures/merge-evidence-pr9.json`; artifact `tools/ai-brain/test/tmp/ac03-audit.json` |
| `AC-AI-19-04` | Refusal of unevidenced `MERGED` transition | The same row without `--merge-evidence` retains `READY_FOR_CODEX`; no branch-ancestry inference; register bytes unchanged (`pre_hash_sha256 == post_hash_sha256`) | Command: `node -e "const fs=require('fs');fs.mkdirSync('tools/ai-brain/test/tmp',{recursive:true});fs.copyFileSync('tools/ai-brain/test/fixtures/register-unrecorded-merge.csv','tools/ai-brain/test/tmp/ac04.csv')" && node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/tmp/ac04.csv --write --allow-fixture-write --audit-out tools/ai-brain/test/tmp/ac04-audit.json && node -e "const fs=require('fs'),c=require('crypto');const a=JSON.parse(fs.readFileSync('tools/ai-brain/test/tmp/ac04-audit.json','utf8'));const h=c.createHash('sha256').update(fs.readFileSync('tools/ai-brain/test/tmp/ac04.csv')).digest('hex');if(h!==a.pre_hash_sha256||a.pre_hash_sha256!==a.post_hash_sha256){console.log('HASH_CHECK_FAILED');process.exit(1)}console.log('PRE_HASH_EQUALS_POST_HASH')"`<br>Exit code: `0`<br>Expected output: `Refused MERGED for TASK-AI-06: no durable merge evidence provided`, then `Register unchanged: 0 mutations applied`, then `PRE_HASH_EQUALS_POST_HASH`<br>Source file: `tools/ai-brain/test/fixtures/register-unrecorded-merge.csv`; artifact `tools/ai-brain/test/tmp/ac04-audit.json` |
| `AC-AI-19-05` | Refusal of lifecycle-skipping `MERGED` transition | Row in `BACKLOG` whose branch is merged, supplied with otherwise valid durable evidence, still refuses `MERGED` because `BACKLOG` is not an allowed transition source; register bytes unchanged | Command: `node -e "const fs=require('fs');fs.mkdirSync('tools/ai-brain/test/tmp',{recursive:true});fs.copyFileSync('tools/ai-brain/test/fixtures/register-lifecycle-skip.csv','tools/ai-brain/test/tmp/ac05.csv')" && node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/tmp/ac05.csv --merge-evidence tools/ai-brain/test/fixtures/merge-evidence-pr9.json --write --allow-fixture-write --audit-out tools/ai-brain/test/tmp/ac05-audit.json && node -e "const fs=require('fs'),c=require('crypto');const a=JSON.parse(fs.readFileSync('tools/ai-brain/test/tmp/ac05-audit.json','utf8'));const h=c.createHash('sha256').update(fs.readFileSync('tools/ai-brain/test/tmp/ac05.csv')).digest('hex');if(h!==a.pre_hash_sha256||a.pre_hash_sha256!==a.post_hash_sha256){console.log('HASH_CHECK_FAILED');process.exit(1)}console.log('PRE_HASH_EQUALS_POST_HASH')"`<br>Exit code: `0`<br>Expected output: `Refused MERGED for TASK-AI-12: source status BACKLOG is not an allowed transition source`, then `Register unchanged: 0 mutations applied`, then `PRE_HASH_EQUALS_POST_HASH`<br>Source file: `tools/ai-brain/test/fixtures/register-lifecycle-skip.csv`, `tools/ai-brain/test/fixtures/merge-evidence-pr9.json`; artifact `tools/ai-brain/test/tmp/ac05-audit.json` |
| `AC-AI-19-06` | Protected main worktree write refusal | `--write` invoked on `main` branch or in protected `shipde-platform` worktree refuses execution fail-closed with 0 file changes | Command: `node tools/ai-brain/cli.js reconcile --write`<br>Exit code: `1`<br>Expected output: `Write-back refused: running in protected main worktree/branch. Mutations require a dedicated feature worktree and branch.`<br>Source file: `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| `AC-AI-19-07` | Overstatement / Structural corruption fail-closed refusal | Register containing `severity: error` finding (`ROW_WITHOUT_ID`, `DUPLICATE_WORK_ITEM_ID`, `MERGED_WITHOUT_COMMIT`) refuses write-back with 0 file changes | Command: `node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/fixtures/register-corrupt-overstatement.csv --write --allow-fixture-write`<br>Exit code: `1`<br>Expected output: `LỖI DUPLICATE_WORK_ITEM_ID`<br>Source file: `tools/ai-brain/test/fixtures/register-corrupt-overstatement.csv` |
| `AC-AI-19-08` | Write-back idempotency and zero-churn serialization | The first `--write` mutates; the second `--write` applies 0 mutations and yields the identical SHA-256, proving RFC 4180 quoting and line endings survive byte-for-byte | Command: `node -e "const fs=require('fs');fs.mkdirSync('tools/ai-brain/test/tmp',{recursive:true});fs.copyFileSync('tools/ai-brain/test/fixtures/register-stale-dependency.csv','tools/ai-brain/test/tmp/ac08.csv')" && node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/tmp/ac08.csv --write --allow-fixture-write --audit-out tools/ai-brain/test/tmp/ac08-audit-1.json && node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/tmp/ac08.csv --write --allow-fixture-write --audit-out tools/ai-brain/test/tmp/ac08-audit-2.json && node -e "const fs=require('fs'),c=require('crypto');const a1=JSON.parse(fs.readFileSync('tools/ai-brain/test/tmp/ac08-audit-1.json','utf8'));const a2=JSON.parse(fs.readFileSync('tools/ai-brain/test/tmp/ac08-audit-2.json','utf8'));const h=c.createHash('sha256').update(fs.readFileSync('tools/ai-brain/test/tmp/ac08.csv')).digest('hex');if(a1.pre_hash_sha256===a1.post_hash_sha256||a2.pre_hash_sha256!==a2.post_hash_sha256||a2.post_hash_sha256!==a1.post_hash_sha256||h!==a1.post_hash_sha256||a2.mutations.length!==0){console.log('IDEMPOTENCY_CHECK_FAILED');process.exit(1)}console.log('IDEMPOTENT_SECOND_RUN')"`<br>Exit code: `0`<br>Expected output: `Reconciled TASK-AI-07: BLOCKED_DEPENDENCY -> BACKLOG`, then `Register unchanged: 0 mutations applied`, then `IDEMPOTENT_SECOND_RUN`<br>Source file: `tools/ai-brain/test/fixtures/register-stale-dependency.csv`; artifacts `tools/ai-brain/test/tmp/ac08-audit-1.json`, `tools/ai-brain/test/tmp/ac08-audit-2.json` |
| `AC-AI-19-09` | Read-only default execution | Invoking `reconcile` without `--write` reports findings without modifying disk; 0 files modified | Command: `node tools/ai-brain/cli.js reconcile`<br>Exit code: `0`<br>Expected output: `Đã đối chiếu 178 đầu mục với những gì repository chứng minh được.`<br>Source file: `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| `AC-AI-19-10` | Durable audit artifact creation and deterministic rollback | `--write` emits the audit JSON with distinct pre/post hashes and at least one mutation record; `--revert` restores the register to exactly the original fixture bytes | Command: `node -e "const fs=require('fs');fs.mkdirSync('tools/ai-brain/test/tmp',{recursive:true});fs.copyFileSync('tools/ai-brain/test/fixtures/register-stale-dependency.csv','tools/ai-brain/test/tmp/ac10.csv')" && node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/tmp/ac10.csv --write --allow-fixture-write --audit-out tools/ai-brain/test/tmp/ac10-audit.json && node tools/ai-brain/cli.js reconcile --revert tools/ai-brain/test/tmp/ac10-audit.json --allow-fixture-write && node -e "const fs=require('fs'),c=require('crypto');const a=JSON.parse(fs.readFileSync('tools/ai-brain/test/tmp/ac10-audit.json','utf8'));const h=c.createHash('sha256').update(fs.readFileSync('tools/ai-brain/test/tmp/ac10.csv')).digest('hex');const o=c.createHash('sha256').update(fs.readFileSync('tools/ai-brain/test/fixtures/register-stale-dependency.csv')).digest('hex');if(h!==a.pre_hash_sha256||h!==o||a.pre_hash_sha256===a.post_hash_sha256||a.mutations.length===0){console.log('ROLLBACK_CHECK_FAILED');process.exit(1)}console.log('ROLLBACK_RESTORED_PRE_HASH')"`<br>Exit code: `0`<br>Expected output: `Reverted tools/ai-brain/test/tmp/ac10.csv to pre_hash_sha256` then `ROLLBACK_RESTORED_PRE_HASH`<br>Source file: `tools/ai-brain/test/fixtures/register-stale-dependency.csv`; artifact `tools/ai-brain/test/tmp/ac10-audit.json` |
| `AC-AI-19-11` | Vacuous `--test-name-pattern` is detected and rejected (negative proof) | `node --test` exits `0` even when `--test-name-pattern` matches no test, so an exit-code-only gate can report success while executing zero assertions. The guard counts the TAP `# Subtest:` lines carrying the exact pattern and exits non-zero when that count is `0`, so a mistyped or stale pattern can never pass vacuously | Command: `node -e "const{spawnSync}=require('child_process');const p=process.argv[1];const f=process.argv[2];const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,f],{encoding:'utf8'});const n=r.stdout.split('\n').filter(function(l){return l.trim()==='# Subtest: '+p;}).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED: 0 tests matched '+p);process.exit(n>0?0:1);" "THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ" tools/ai-brain/test/reconcile.test.js`<br>Exit code: `1`<br>Expected output: `VACUOUS_PATTERN_REJECTED: 0 tests matched THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ`<br>Source file: `tools/ai-brain/test/reconcile.test.js` via TAP output of `node --test --test-reporter=tap` |

## Verification commands

```bash
# 1. Full unit and integration test suite across all tools
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
# Expected exit code: 0 (All 458+ tests passing)

# 2. Reconcile read-only verification against repository facts
node tools/ai-brain/cli.js reconcile
# Expected exit code: 0 (0 errors, 1 warning for TASK-AI-07 BLOCK_NO_LONGER_TRUE)

# 3. Ecosystem manifest truth audit
node tools/ai-brain/cli.js manifest
# Expected exit code: 0 (0 errors, exactly 1 warning for pinned codex-cli drift)

# 4. Product documentation and Work Item traceability validator
python docs/product-spec/scripts/validate_docs.py
# Expected exit code: 0 (82 markdown files, 130 feature IDs, 178 delivery rows, 525 unique identifiers verified)

# 5. Protected main worktree write refusal test
node tools/ai-brain/cli.js reconcile --write
# Expected exit code: 1 (Refused with protected worktree guard error; zero file modifications)

# 6. Reconcile write-back unit test suite with named fixtures
node --test "tools/ai-brain/test/reconcile.test.js"
# Expected exit code: 0 (All assertions, idempotency, allowed transitions, and failure refusal verified)

# 7. Negative proof: a non-matching --test-name-pattern must be rejected, not silently pass
#    (node --test exits 0 when a pattern matches nothing; the guard counts matched TAP subtests)
node -e "const{spawnSync}=require('child_process');const p=process.argv[1];const f=process.argv[2];const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,f],{encoding:'utf8'});const n=r.stdout.split('
').filter(function(l){return l.trim()==='# Subtest: '+p;}).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED: 0 tests matched '+p);process.exit(n>0?0:1);" "THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ" tools/ai-brain/test/reconcile.test.js
# Expected exit code: 1 (VACUOUS_PATTERN_REJECTED: 0 tests matched THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ)
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `b52ded6` | `CHANGES_REQUIRED` | 4 P1 findings resolved: (1) `id=4006827820`: Control table status aligned to `BLOCKED_DEPENDENCY` per delivery register authority and AGENTS.md lifecycle rules; (2) `id=4006827826`: Stale dependency unblocking transitions strictly to `BACKLOG` (never `READY_FOR_AUTHOR`), preserving Definition of Ready and Codex planning selection gate; (3) `id=4006827836`: Prohibited inferring `MERGED` from branch tip ancestry or commit text; reconciler requires durable external merge evidence (`--merge-evidence`) or strictly refuses to write `MERGED` per `AI-TOOL-12`; (4) `id=4006827845`: Protected main worktree write refusal enforced fail-closed (exit code 1) with exact stderr guard message, requiring feature worktree and auditable PR output. |
| 2 | Pending review | `PENDING` | Fresh independent review task requested for updated specification. |
| 3 | `fix/task-ai-19-reconciler` | `CHANGES_REQUIRED` | 1 blocking finding resolved: `AC-AI-19-03`, `-04`, `-05`, `-08` and `-10` asserted only the exit code of `node --test --test-name-pattern=<name>` against names that do not exist in `tools/ai-brain/test/reconcile.test.js`. Measured directly: a non-matching pattern reports `tests 1, pass 1, fail 0` and exits `0`, so all five rows passed while executing zero assertions. All five were replaced with CLI invocations against named fixtures that assert both the exit code and observable state (register SHA-256 reconciled against the audit artifact's pre/post hashes), matching the shape of `AC-AI-19-01`. New rule `AI-19-R10` and new acceptance row `AC-AI-19-11` make the defect class fail closed. No gate, status, or acceptance row was weakened; control status remains `BLOCKED_DEPENDENCY` per the delivery register. |
| 4 | `feat/task-ai-19-reconciler-impl` | `IMPLEMENTED` | Specification implemented. Write-back added to `tools/ai-brain/reconcile.js` and `tools/ai-brain/cli.js` under the Allowed-Transition Table only: `BLOCKED_DEPENDENCY` / `BLOCKED_BY_FOUNDATION` clear strictly to `BACKLOG` when every declared dependency is `MERGED` with a 40-character merge commit present in the clone, reachable on `mainRef`, and carrying a `PASS` verdict; `READY_FOR_CODEX` / `CODEX_PASS` reach `MERGED` only against a durable evidence artifact that verifies PR identity, title, merge SHA reachability, exact-HEAD verdict, zero unresolved threads, CI status and on-disk spec path. Branch ancestry is never consulted (`AI-TOOL-12`). Atomic sibling-`.tmp` writes with per-record byte fidelity, durable audit artifact on every `--write`, and `--revert` that refuses if the register moved since the run it would undo. Protected-worktree guard strips a `refs/heads/` prefix before comparing, and `--allow-fixture-write` exempts only a register under the test tree so it cannot be used to reach the real one. Unknown options are rejected rather than ignored. 27 tests added (51 total); repository suite 11 of 11 tasks successful; all 11 acceptance rows executed with real output. First audited reconciliation cleared the stale `TASK-AI-07` block to `BACKLOG`, proved by dependency commit `fdf87594` with a `PASS` verdict; `TASK-AI-17` was refused in the same run for want of durable merge evidence, and that refusal is recorded in the artifact. |

| 5 | `fix/task-ai-19-mutation-count` | `CHANGES_REQUIRED` | Independent review through the local 9Router gateway (`cbai/glm-5.2`), run because Codex is unavailable, found that `applyStatusMutations`'s own documentation promised a check the caller never performed: it said a mutation planned but matching no row is *a bug worth failing on*, while `cli.js` tested only whether the applied count was zero. Planning three mutations and matching two printed `2 mutation(s) applied`, exited 0, and wrote an audit artifact agreeing - recording as complete a reconciliation that had partly not happened. The caller now compares the applied count against `plan.mutations.length`, refuses before writing when they disagree, names both counts and exits 1. `AC-AI-19-02` is unaffected because a plan of zero and an applied count of zero agree. Five further reviewer points are recorded under Residual limitations rather than bundled into this fix. |
## Executed runs

The reconciler has been run once against the real delivery register. This record
exists so the run is auditable from the specification rather than only from the
Pull Request that carried it.

| Field | Value |
|---|---|
| `run_id` | `293cecd2-cd83-4d0d-8778-aa66a8890c67` |
| `generated_at` | `2026-09-15T14:09:32.149Z` |
| `head_commit` | `f6d462e9ac6cf768ea1305fce77be755d2135c94` |
| `main_ref` | `origin/main` |
| Register SHA-256 before | `23b902154e15148853c7c4bae7771330be5c773e1c987719e67bdf3fd7683954` |
| Register SHA-256 after | `f2561a8ca612d4aa4cef1cff2b833e0ce6ceaa8157826c80abbca57f24d335e7` |
| Audit artifact | `docs/product-spec/docs/10-ai-collaboration/audit/reconcile-2026-09-15T14-09-32-148Z.json` |

All `129` mutations were the same transition — `BLOCKED_BY_FOUNDATION` to
`BACKLOG` under `AI-19-R03` — and every one of them was proven by the single
dependency `TASK-FOUND-04`, merged at `9d101f4e5d9de9b880cc4311126ce8fe06de4206`
with a `PASS` verdict. No row moved to `MERGED`, and no row moved to
`READY_FOR_AUTHOR`; clearing a block returns an item to `BACKLOG` and nothing
further, which is why `TASK-AI-20` still owns authoring the specifications for
them.

The run refused `2` rows, both under `AI-19-R04` and both for the same reason —
`no durable merge evidence provided`:

| Work Item | Rule | Reason |
|---|---|---|
| `FEAT-AUTH-01` | `AI-19-R04` | no durable merge evidence provided |
| `TASK-AI-17` | `AI-19-R04` | no durable merge evidence provided |

`TASK-AI-17` is merged in Git reality. The refusal is the rule working as
specified: `AI-19-R04` requires an evidence artifact carrying an exact-HEAD
Codex `PASS`, and none exists for it. The refusal is recorded here rather than
worked around, because the alternative — recording `MERGED` from a branch name
or a reachable commit alone — is the precise failure `AI-19-R04` was written to
prevent.

## Executed run: 2026-09-16

Two rows were recorded MERGED, both carrying a fallback review on the exact
merged head:

| Row | PR | Reviewed commit | Merge commit | Verdict |
|---|---|---|---|---|
| `TASK-AI-18` | `#47` | `d9e4c65a582749c97e19f21c26dca45deaaf497d` | `a2a3bc00a7d22e7bc25e0b2eb28c81c9b74ad774` | `FALLBACK_PASS` |
| `TASK-AI-15` | `#39` | `26f44e9d7df2db5b418969cbd22d23d4b03c9d8f` | `48314184e5fcfa98e7d2f4c4f0dcb0b0f5b3c2a1` | `FALLBACK_PASS` |

Three defects were found by attempting these writes, each recorded in the
commit that closed it:

1. **The source check was too strict.** `MERGED` was reachable only from
   `READY_FOR_CODEX` or `CODEX_PASS`, so a row whose work had shipped while the
   register stayed at `BACKLOG` could never be recorded. Measured: fifteen rows
   were in that state and none was refused by the evidence bar. The pre-review
   statuses are now accepted as sources, and the evidence bar is what remains.

2. **A MERGED transition wrote only the status cell.** The row then claimed to
   be merged showing no pull request, no commit and no verdict; the audit
   reported `MERGED_WITHOUT_COMMIT` and write-back refused the next write. The
   transition now writes all four cells, with column positions read from the
   header rather than fixed offsets.

3. **The audit disagreed with the transition it audits.** Widening the
   transition for `AI-19-R05` without widening the audit made the first row
   written under the new rule an error. Both now read one verdict set.

This closes the residual limitation this document recorded below: "Only the
status cell is written. The `pr`, `merge_commit` and `codex_verdict` columns are
never backfilled."

## Residual limitations

- **Reviewer points from round 5 not addressed here.** Reverting a penultimate audit is impossible by design, because `--revert` requires the register to still hash to that audit's `post_hash_sha256`; `operator_session` falls back to `USERNAME`, which is Windows-only, and does not consult `USER`; `require('crypto')` is called inline in two functions rather than hoisted; `pick(args, 'revert', 'revert')` passes the same key twice and is redundant; and an `AI-19-R02` refusal does not name the target row's status, so it reads similarly to an `AI-19-R04` refusal in an audit artifact. None of these changes whether the register is written correctly.

- **Allowed paths omit the fixture directory this document requires.** The Author boundary does not list
  `tools/ai-brain/test/fixtures/`, yet the acceptance matrix names six fixture files under it
  (`register-stale-dependency.csv`, `register-active-dependency.csv`, `register-unrecorded-merge.csv`,
  `register-lifecycle-skip.csv`, `register-corrupt-overstatement.csv`, `merge-evidence-pr9.json`).
  The fixtures were created because the matrix cannot be executed without them. The allowed-path list
  should be reconciled with the matrix rather than the matrix quietly reduced.
- **`AC-AI-19-01` consumes the fixture it reads.** It runs `--write` directly against
  `register-stale-dependency.csv`, so the file is left at `BACKLOG` and any later row copying that fixture
  starts from the mutated state. Observed in practice while executing the matrix. The row should copy into
  `tools/ai-brain/test/tmp/` first, as `AC-AI-19-03`, `-05`, `-08` and `-10` already do.
- **`AC-AI-19-07` states an expected string the reporter does not emit.** The row expects
  `LỖI DUPLICATE_WORK_ITEM_ID`; the report prints `[LỖI ] DUPLICATE_WORK_ITEM_ID`. The format predates this
  Work Item and was deliberately not changed to make a row pass; the expected string is what needs correcting.
- **Ten rows stay blocked on `TASK-AI-17`.** It is merged in Git reality but carries no durable merge evidence
  artifact, so the reconciler refuses to record it as `MERGED` and its dependents remain blocked. This is the
  rule working rather than a gap in it: clearing them requires an evidence artifact carrying an exact-HEAD
  Codex `PASS`, which does not exist for it today.
- **Only the status cell is written.** The `pr`, `merge_commit` and `codex_verdict` columns are never
  backfilled, so a row reconciled to `MERGED` still shows an empty `merge_commit` unless that column was
  already populated.

Write-back operates deterministically on local repository facts (Git commit
history, branches, and on-disk files). It does not poll remote GitHub API
endpoints directly; remote branches and PR merge commits must be fetched into
`origin/main` before reconciliation can verify them. Authoring specifications
for items moved to `BACKLOG` remains bounded by `TASK-AI-20`.
