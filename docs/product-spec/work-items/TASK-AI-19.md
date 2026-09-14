# TASK-AI-19 — Deterministic register reconciler with write-back

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-19` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
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
- Support `--write`, `--dry-run`, and `--revert <audit-file>` CLI options in
  `tools/ai-brain/cli.js reconcile`.
- Enforce protected main worktree preflight: `--write` refuses to run (exit code 1)
  if invoked on the `main` branch or within the protected `shipde-platform`
  integration worktree, requiring execution in a dedicated feature worktree.
- Clear stale `BLOCKED_DEPENDENCY` and `BLOCKED_BY_FOUNDATION` rows to `BACKLOG`
  when all declared dependencies are verifiably `MERGED` (reachable on `mainRef`
  with `codex_verdict: PASS`). Rows do not skip to `READY_FOR_AUTHOR`.
- Record unrecorded merges (`MERGE_NOT_RECORDED`) to `MERGED` only for rows
  already in active post-review lifecycle states (`READY_FOR_CODEX` or `CODEX_PASS`)
  with verified PR identity, authoritative 40-character merge commit SHA,
  trusted exact-HEAD Codex review `PASS`, and passing CI checks.
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
| `AI-19-R03` | **Stale dependency unblocking to BACKLOG**: When all declared dependencies for a `BLOCKED_DEPENDENCY` or `BLOCKED_BY_FOUNDATION` row are `MERGED` with valid reachable commits on `mainRef` and `codex_verdict: PASS`, write-back transitions the status to `BACKLOG`. Write-back must never advance unblocked rows to `READY_FOR_AUTHOR`, preserving the Codex planning gate. |
| `AI-19-R04` | **Gated MERGED transition**: A row may transition from `READY_FOR_CODEX` or `CODEX_PASS` to `MERGED` only when all of the following are verifiably true: (1) verified PR reference in `pr` field; (2) exact 40-character merge commit SHA verified reachable on `mainRef`; (3) exact-HEAD Codex review verdict is `PASS` from a trusted reviewer login (`chatgpt-codex-connector[bot]` or authorized role) with 0 unresolved review threads; (4) required CI checks (`contract`, `application-gate`) report `SUCCESS` on exact HEAD; (5) `work_item_path` exists on disk. Rows in `BACKLOG`, `BLOCKED_*`, or `READY_FOR_AUTHOR` attempting `MERGED` transition are strictly refused. |
| `AI-19-R05` | **Fail-closed refusal on overstatements**: An overstatement is defined as any finding with `severity: 'error'` (`ROW_WITHOUT_ID`, `DUPLICATE_WORK_ITEM_ID`, `MERGED_WITHOUT_COMMIT`, `MERGE_COMMIT_MISSING`, `MERGE_COMMIT_NOT_REACHABLE`, `MERGED_WITHOUT_PASS`, `SPEC_MISSING` on terminal or ready rows). If any `error` exists, write-back refuses execution with exit code 1, leaving the CSV completely untouched (pre-hash == post-hash) and leaving no `.tmp` file. |
| `AI-19-R06` | **Protected main worktree guard**: Write-back must refuse to run (exit code 1) when executed on the `main`/`master` branch or within the protected `shipde-platform` integration worktree. Mutations require a dedicated feature worktree and branch, ensuring clean integration baselines and auditable PR output. |
| `AI-19-R07` | **Durable audit artifact and rollback**: Every `--write` execution writes a durable JSON audit artifact containing run ID, timestamp, operator session, git commit, pre/post SHA-256 hashes, and per-row mutation records with rule and evidence citations. A deterministic reversal procedure (`--revert <audit-file>`) restores the register to its exact pre-write state. |
| `AI-19-R08` | **Atomic RFC 4180 serialization**: File writes must be atomic via temporary sibling files (`FEATURE-DELIVERY-REGISTER.csv.tmp`), preserving RFC 4180 quoting rules, existing line endings, and byte-for-byte integrity of unaffected rows. |
| `AI-19-R09` | **Read-only default**: Invoking `cli.js reconcile` without `--write` is strictly read-only; mutations require explicit `--write`. `--dry-run` outputs the exact planned diff without touching disk. |

### Allowed-Transition Table

| Source Status | Destination Status | Preconditions and Required Evidence | Prohibited Shortcuts / Refusal Behavior |
|---|---|---|---|
| `BLOCKED_DEPENDENCY` | `BACKLOG` | 1. All declared dependencies in `dependencies` field exist in the register (`byId.has(dep)`).<br>2. Every declared dependency has `status == 'MERGED'`.<br>3. Every dependency has a 40-character `merge_commit` verified reachable on `mainRef` (`git merge-base --is-ancestor <sha> <mainRef>`).<br>4. Every dependency has `codex_verdict == 'PASS'`.<br>5. Target row has valid `work_item_id`. | Refuse transition to `READY_FOR_AUTHOR` (requires Codex planning gate) or `MERGED` (cannot skip author/PR/review/CI gates). |
| `BLOCKED_BY_FOUNDATION` | `BACKLOG` | 1. All foundation prerequisites (`TASK-FOUND-01` through `TASK-FOUND-04`) and declared dependencies are `MERGED` with reachable commits and `codex_verdict: PASS`.<br>2. Target row has valid `work_item_id`. | Refuse transition to `READY_FOR_AUTHOR` or `MERGED`. |
| `READY_FOR_CODEX` or `CODEX_PASS` | `MERGED` | 1. Verified PR reference in `pr` field; PR title strictly matches `[<WORK_ITEM_ID>] <outcome>`.<br>2. Authoritative 40-character merge commit SHA verified reachable on `mainRef` (resolved from merge metadata, accounting for squash merges).<br>3. Exact-HEAD Codex review verdict is `PASS` from a trusted reviewer login (`chatgpt-codex-connector[bot]` or authorized role) with 0 unresolved review threads.<br>4. Required CI checks (`contract`, `application-gate`) report `SUCCESS` on exact HEAD.<br>5. `work_item_path` exists on disk. | Refuse if any evidence is missing or unverified.<br>Refuse if source status is `BACKLOG`, `BLOCKED_*`, or `READY_FOR_AUTHOR` (skipping lifecycle gates strictly prohibited). |
| *Any other status* | *Any other status* | N/A | **STRICTLY PROHIBITED**. Reconciler refuses mutation and retains existing row status. |

### Resolution of Exact Merge Commit SHA

Squash merges (the repository standard under `TASK-AI-13`) squash feature branch commits
into a single new commit on `main`. As a result, the branch tip commit is **not** an
ancestor of `mainRef` (`git merge-base --is-ancestor <branchTip> origin/main` evaluates to false).
To resolve the exact merge commit SHA authoritatively without false ancestry assumptions:
1. **PR Merge Metadata**: Read the explicit `mergeCommit.oid` from GitHub PR metadata or
   the deterministic supervisor preflight snapshot (`control.ps1`).
2. **Local Commit Identification**: Search `mainRef` log for merge commits or squash commit
   messages matching `Merge pull request #<NN>` or `[<WORK_ITEM_ID>]` in the commit subject.
3. **DAG Verification**: Verify the resolved SHA exists in Git (`git cat-file -e <sha>`)
   and is directly reachable on `mainRef` (`git merge-base --is-ancestor <sha> origin/main`).

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
| `AC-AI-19-01` | Stale block unblocking to `BACKLOG` (`TASK-AI-07`) | Status transitions from `BLOCKED_DEPENDENCY` to `BACKLOG`; row is not advanced to `READY_FOR_AUTHOR`; audit artifact created | Command: `node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/fixtures/register-stale-dependency.csv --write --allow-fixture-write`<br>Exit code: `0`<br>Assertion: target row status is `BACKLOG`; audit JSON generated; pre/post hashes differ as expected; unchanged rows identical byte-for-byte |
| `AC-AI-19-02` | Active/unresolved dependency retention | Row with unmerged dependency remains `BLOCKED_DEPENDENCY`; zero modifications to CSV | Command: `node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/fixtures/register-active-dependency.csv --write --allow-fixture-write`<br>Exit code: `0`<br>Assertion: pre-hash SHA-256 == post-hash SHA-256; zero mutations in audit log |
| `AC-AI-19-03` | Verified unrecorded merge recording | Row in `READY_FOR_CODEX` with verified PR, 40-char merge commit reachable on `mainRef`, trusted exact-HEAD Codex `PASS`, and clean CI transitions to `MERGED` | Command: `node --test --test-name-pattern="records unrecorded merge with full verified evidence" tools/ai-brain/test/reconcile.test.js`<br>Exit code: `0`<br>Assertion: status is `MERGED`; `merge_commit` populated; `codex_verdict` is `PASS`; audit entry recorded |
| `AC-AI-19-04` | Refusal of unevidenced `MERGED` transition | Row lacking trusted exact-HEAD `PASS` review or lacking 40-char reachable merge commit is not modified to `MERGED`; warning emitted | Command: `node --test --test-name-pattern="refuses MERGED transition without full evidence" tools/ai-brain/test/reconcile.test.js`<br>Exit code: `0`<br>Assertion: target row status remains unchanged; warning in findings; pre-hash == post-hash |
| `AC-AI-19-05` | Refusal of lifecycle-skipping `MERGED` transition | Row in `BACKLOG` or `READY_FOR_AUTHOR` whose branch is merged refuses transition to `MERGED` to prevent skipping lifecycle gates | Command: `node --test --test-name-pattern="refuses lifecycle skipping to MERGED" tools/ai-brain/test/reconcile.test.js`<br>Exit code: `0`<br>Assertion: target row status remains unchanged; warning emitted; pre-hash == post-hash |
| `AC-AI-19-06` | Protected main worktree write refusal | `--write` invoked on `main` branch or in protected `shipde-platform` worktree refuses execution fail-closed with 0 file changes | Command: `node tools/ai-brain/cli.js reconcile --write`<br>Exit code: `1`<br>Assertion: stderr contains `Write-back refused: running in protected main worktree/branch`; pre-hash SHA-256 == post-hash SHA-256; absence of `.tmp` file |
| `AC-AI-19-07` | Overstatement / Structural corruption fail-closed refusal | Register containing `severity: error` finding (`ROW_WITHOUT_ID`, `DUPLICATE_WORK_ITEM_ID`, `MERGED_WITHOUT_COMMIT`) refuses write-back | Command: `node tools/ai-brain/cli.js reconcile --register tools/ai-brain/test/fixtures/register-corrupt-overstatement.csv --write --allow-fixture-write`<br>Exit code: `1`<br>Assertion: stderr contains `LỖI DUPLICATE_WORK_ITEM_ID` and `LỖI MERGED_WITHOUT_COMMIT`; pre-hash SHA-256 == post-hash SHA-256; absence of `.tmp` file |
| `AC-AI-19-08` | Write-back idempotency and zero-churn serialization | Consecutive write-back invocations produce zero file diff on second run; RFC 4180 quotes and line endings preserved byte-for-byte | Command: `node --test --test-name-pattern="reconcile write-back idempotency" tools/ai-brain/test/reconcile.test.js`<br>Exit code: `0`<br>Assertion: post-hash-1 == post-hash-2; git diff is completely empty; unaffected rows untouched |
| `AC-AI-19-09` | Read-only default execution | Invoking `reconcile` without `--write` reports findings without modifying disk | Command: `node tools/ai-brain/cli.js reconcile`<br>Exit code: `0`<br>Assertion: pre-hash SHA-256 == post-hash SHA-256; findings report printed to stdout; zero files touched |
| `AC-AI-19-10` | Durable audit artifact creation and deterministic rollback | Write-back generates audit JSON, and `--revert` restores exact pre-mutation CSV state | Command: `node --test --test-name-pattern="audit artifact creation and deterministic rollback" tools/ai-brain/test/reconcile.test.js`<br>Exit code: `0`<br>Assertion: audit JSON adheres to schema; post-revert SHA-256 matches pre-write SHA-256 byte-for-byte |

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
# Expected exit code: 0 (82 markdown files, 130 feature IDs, 178 delivery rows, 522 unique identifiers verified)

# 5. Protected main worktree write refusal test
node tools/ai-brain/cli.js reconcile --write
# Expected exit code: 1 (Refused with protected worktree guard error; zero file modifications)

# 6. Reconcile write-back unit test suite with named fixtures
node --test "tools/ai-brain/test/reconcile.test.js"
# Expected exit code: 0 (All assertions, idempotency, allowed transitions, and failure refusal verified)
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `b52ded6` | `CHANGES_REQUIRED` | 7 review findings resolved in Round 2: (1) All ACs replaced with falsifiable criteria naming fixtures, exact commands, exit codes, and assertions; (2) Durable JSON audit artifact and deterministic `--revert` procedure specified; (3) Unblocking transitions to `BACKLOG` (not `READY_FOR_AUTHOR`), preserving the Codex planning gate; (4) `MERGE_NOT_RECORDED -> MERGED` strictly gated with verified PR identity, 40-char merge SHA reachable on `mainRef` (accounting for squash merges), trusted exact-HEAD Codex review `PASS`, and clean CI; (5) Allowed-Transition Table explicitly enumerates permitted source/destination states and prohibits lifecycle shortcuts; (6) Overstatements defined as severity `error` findings; exact merge commit SHA resolution defined via authoritative sources rather than ancestor inference; (7) Protected main worktree write refusal enforced; pre/post hash equality and temporary file absence mandated. |
| 2 | Pending review | `READY_FOR_CODEX` | Fresh independent review task requested for updated specification. |

## Residual limitations

Write-back operates deterministically on local repository facts (Git commit
history, branches, and on-disk files). It does not poll remote GitHub API
endpoints directly; remote branches and PR merge commits must be fetched into
`origin/main` before reconciliation can verify them. Authoring specifications
for items moved to `BACKLOG` remains bounded by `TASK-AI-20`.
