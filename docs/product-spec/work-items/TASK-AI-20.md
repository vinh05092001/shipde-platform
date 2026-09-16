# TASK-AI-20 — Author the missing Work Item specifications

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-20` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `153` |
| Dependencies | `TASK-AI-19` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-20.md`, `tools/ai-brain/acceptance/ac-20-*.js`, `tools/ai-brain/acceptance/lib/spec-coverage.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-20` |
| Pull Request | `Pending` |

## Business outcome

The delivery register is the project's queue, and every row of it names the
specification file that must exist before the item can be planned or started. A
row whose document does not exist is not a queue entry; it is a line that looks
like work and is not.

Measured on `origin/main` at `ab54b3f`, the pre-implementation baseline before
this Work Item's own document existed, of `178` delivery rows **`29` named a
specification file that exists and `149` named one that did not**. The register's
own `key_behavior` text ("only 13 exist") is stale — it was written before the
foundation and AI-workflow documents landed — and is recorded here as a
measurement, never asserted, so it cannot become a pinned number that drifts.

`TASK-AI-20` makes every register row point at a real Work Item document, and
installs the gate that keeps it that way:

1. A deterministic authoring engine emits a Work Item specification for every
   register row whose `work_item_path` is absent, built from the row's own facts
   (id, delivery order, dependencies, status, feature name, key behaviour) and
   the committed `WORK-ITEM-TEMPLATE.md`.
2. The engine is honest by construction. It never invents a business rule: every
   section it cannot derive from a register fact or a named source reference is
   emitted as an explicit `REQUIRES AUTHORING` marker, and such a document does
   **not** make its row ready. Filling a scaffold remains the independent Codex
   planning gate's work, exactly as it is today.
3. The reconciler's `SPEC_MISSING` finding becomes the enforcement point: `info`
   while a row is blocked, `error` the moment a row reaches `READY_FOR_AUTHOR` or
   a terminal state, so an item can never be treated as startable while its
   document is missing.

The outcome is falsifiable from the repository alone: the count of register rows
whose `work_item_path` does not resolve, and the count of existing documents
whose Control table names a different row.

## Source references

- `AGENTS.md` § Unit of delivery — One Work Item per branch and Pull Request; the
  required status flow beginning at `BACKLOG`.
- `AGENTS.md` § Source of truth — Specification precedence over code; a row must
  never claim what repository evidence cannot prove.
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md` — the
  committed section list every generated document must follow.
- `docs/product-spec/docs/10-ai-collaboration/CODEX-PLANNING-PROMPT.md` § step 4 —
  planning creates exactly `docs/product-spec/work-items/<WORK_ITEM_ID>.md` from
  the template and must not leave an aggregate source as the executable path.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` —
  the authoritative queue; row `153` registers `TASK-AI-20` and its dependency.
- `docs/product-spec/work-items/TASK-AI-19.md` — the reconciler that reports
  `SPEC_MISSING` and refuses write-back on an overstated register.
- `tools/ai-brain/reconcile.js` — the `SPEC_MISSING` rule and its severity ladder
  (`info` for an early state, `error` for `READY_*` or `MERGED`).
- `tools/ai-dashboard/register-adapter.js` § `parseRegisterCsv` — the canonical
  RFC 4180 register reader every script here re-uses instead of re-implementing.
- `tools/ai-brain/acceptance/lib/spec-coverage.js` — the single definition of the
  "is this row specified" rule this Work Item's rows exercise.

## Preconditions and dependencies

- `TASK-AI-19` (Deterministic register reconciler with write-back) is merged. Its
  Work Item specification merged to `main` as Pull Request #23 at
  `8d49b1a8d9b851afa7b4290329452687c1f0b3b6`, and the reconciler, its audited
  runs and its acceptance matrix landed on `main` through the follow-on
  increments, the latest being `ab54b3f6b128517c537eaa0402dfb2de88bb353c`
  (Pull Request #61). Both commits are reachable from `origin/main`.
- Authoritative delivery register status: row `153` records `TASK-AI-20` as
  `BLOCKED_DEPENDENCY` on `TASK-AI-19`. The Control table above records
  `BLOCKED_DEPENDENCY` and no other value. The row becomes eligible for
  `READY_FOR_AUTHOR` only through the reconciler's write-back path
  (`tools/ai-brain/reconcile.js`, `AI-19-R03`) once every declared dependency is
  `MERGED` and evidenced; it is never advanced by hand.
- `node tools/ai-brain/cli.js reconcile` reports `Tổng: 0 lỗi` against the real
  register, so no terminal or ready row currently claims a specification that
  does not exist.
- `python docs/product-spec/scripts/validate_docs.py` passes, so the generated
  documents can be validated by the same script that guards every other one.
- Node.js v24 workstation runtime and the `pnpm` workspace are available.

## Author boundary

`GEMINI` is the assigned author. This Work Item authors the specification and the
acceptance harness that prove it, and is bounded to the three allowed paths
above. It writes documents and scripts; it does not change application code.

Implementation of the engine and generation of the missing documents is a
subsequent task by `GEMINI` within these additional paths:

- `tools/ai-brain/spec-author.js`
- `tools/ai-brain/cli.js` (the `spec-author` sub-command)
- `tools/ai-brain/test/spec-author.test.js`
- `docs/product-spec/work-items/<WORK_ITEM_ID>.md` for the rows the engine is
  applied to
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` (the
  decision entry recording the engine's honesty contract)

Prohibited in this Work Item:

- Writing a business rule, actor, screen, API or acceptance outcome that no
  register fact, source reference or named document supports. A section that
  cannot be derived is marked `REQUIRES AUTHORING`, not invented.
- Advancing any register row's `status`, `branch`, `pr`, `codex_verdict` or
  `merge_commit`. The register is written only by the reconciler (`TASK-AI-19`)
  and by planning.
- Overwriting a specification that already exists, or reordering, renaming or
  deleting one.
- Declaring an item ready because a scaffold file now exists. Document existence
  is not the Definition of Ready.
- Weakening, skipping or narrowing `SPEC_MISSING` or any other reconciler rule,
  or editing `docs/product-spec/scripts/`.
- Author self-approval.

## In scope

- Author the deterministic authoring engine `tools/ai-brain/spec-author.js` and
  the `node tools/ai-brain/cli.js spec-author` command that emits missing Work
  Item documents from register facts and `WORK-ITEM-TEMPLATE.md`.
- Support `--register <path>`, `--out <dir>`, `--dry-run`, `--only <WORK_ITEM_ID>`
  and `--json`. Unknown or misspelled options are rejected with exit code 1
  rather than silently ignored, so no run can operate on a different register
  than the one it names.
- Refuse to overwrite any file that already exists, and make a second run on an
  unchanged register a zero-diff no-op.
- Emit each derivable Control field from the register row (`Work Item ID`,
  `Status`, `Delivery order`, `Dependencies`), and emit every section it cannot
  derive as an explicit `REQUIRES AUTHORING` marker with a matching entry under
  `Residual limitations`.
- Never write the register. The engine reads the register and writes only Work
  Item documents under `--out`.
- Apply the engine to the register's missing rows so that every `work_item_path`
  resolves, and record in the Pull Request the measured before/after counts
  (never a pinned number).
- Author acceptance rows that exercise the coverage and identity rules against
  the real register, and the negative proofs that the same rules reject a
  tampered copy and that the `SPEC_MISSING` severity escalates.

## Out of scope

- Filling a generated scaffold's business rules, screens, APIs or acceptance
  outcomes. That is the independent Codex planning gate (`CODEX-PLANNING-PROMPT.md`)
  and each item's own `READY_FOR_AUTHOR` step.
- Promoting any row to `READY_FOR_AUTHOR` or writing the register at all.
- Selecting, scheduling or dispatching the authored items (`TASK-AI-28`,
  `TASK-AI-19`).
- The shadow dependency graph (`TASK-AI-33`).
- Changing the column schema of `FEATURE-DELIVERY-REGISTER.csv`, or the shape of
  `WORK-ITEM-TEMPLATE.md`'s section list.
- Editing `docs/product-spec/scripts/validate_docs.py` or any other validator.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-20-R01` | **Coverage**: a register row is actionable when its `work_item_path` resolves to a file on disk. The completion measure of this Work Item is the count of rows whose path is absent, and that count is measured and reported, never pinned in an acceptance row — pinning a number that this Work Item exists to drive to zero would make every row fail at the moment it succeeded. |
| `AI-20-R02` | **Identity**: a document belongs to a row only when its Control table's `Work Item ID` equals the row's `work_item_id`. A file that exists under the right name but declares a different row is not that row's specification, and the coverage row fails while such a pair exists. |
| `AI-20-R03` | **No invented rules**: the engine derives only from the register row and the committed template. Every section it cannot derive carries an explicit `REQUIRES AUTHORING` marker and a `Residual limitations` entry. A generated document is a scaffold, not a ready specification, and its existence never advances the row. |
| `AI-20-R04` | **Never overwrite, always idempotent**: the engine refuses to write over an existing document and re-running it against an unchanged register produces a zero-byte diff. No `--force` flag exists for this. |
| `AI-20-R05` | **Determinism**: for a fixed register and template the output is byte-stable — rows are processed in ascending `delivery_order`, and no timestamp, hostname, path or random value appears in a document body. |
| `AI-20-R06` | **`SPEC_MISSING` severity ladder**: an absent specification is `info` while a row is `BLOCKED_*` or `BACKLOG`, and `error` once the row is `READY_*` or `MERGED`. The rule lives in `tools/ai-brain/reconcile.js` and is not restated by this Work Item. |
| `AI-20-R07` | **Register authority**: the engine never mutates the register. A row's lifecycle changes only through the reconciler's write-back (`AI-19-R03`) and Codex planning. |
| `AI-20-R08` | **No vacuous verification**: every acceptance row reads real files and asserts observable state. No row compares two string literals written into its own command, no row asserts through `node --test --test-name-pattern` (which exits `0` when the pattern matches nothing), and no count that drifts with the repository is pinned. |

## UI states

Not applicable; this Work Item has no user-facing screen. Operator-facing CLI
states for `node tools/ai-brain/cli.js spec-author`:

- **Dry run** (`--dry-run`): prints the document paths that would be created and
  the sections that would be marked `REQUIRES AUTHORING`; writes nothing; exits 0.
- **Applied**: writes the missing documents, prints `Created <n> specifications,
  skipped <m> existing`, and exits 0.
- **No work** (every row already specified): prints `Created 0 specifications,
  skipped <m> existing`; exits 0; zero diff.
- **Refusal**: an unknown option, an unreadable register, or an attempt to write
  outside `--out` prints the reason to stderr and exits 1 with no file written.

## API, event and data impact

No database schema, migration or runtime API change. The Work Item adds a Brain
CLI sub-command (`spec-author`) and a deterministic document layout under
`docs/product-spec/work-items/`. The register's column schema is unchanged.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-20-01` | The specification-identity rule over the real register: no existing specification belongs to a different row | `node tools/ai-brain/acceptance/ac-20-01-spec-coverage.js` exits 0 and prints the string `SPEC_COVERAGE: 0 identity mismatches`, after printing the measured `specified`/`unspecified` counts as evidence. The rule is not written into this row: the script requires `tools/ai-brain/acceptance/lib/spec-coverage.js`, the same module `AC-AI-20-02` requires, and it exits 2 outside the repository | command stdout |
| `AC-AI-20-02` | **Negative proof, must fail:** the identity rule rejects a copy of a real specification whose Control table names a different register row, after a CONTROL proving the untouched file matches its row | `node tools/ai-brain/acceptance/ac-20-02-spec-identity.js` exits 1 and prints the string `SPEC_IDENTITY_MISMATCH_DETECTED:`. It reads the real register and a real Work Item file, tampers only a copy written to `os.tmpdir()`, and exits 2 outside the repository | command stderr; `tools/ai-brain/acceptance/ac-20-02-spec-identity.js`, `tools/ai-brain/acceptance/lib/spec-coverage.js` |
| `AC-AI-20-03` | **Negative proof, must fail:** the reconciler's `SPEC_MISSING` severity escalates from `info` to `error` when a blocked row with an absent specification is recorded as ready, using the real rule in `tools/ai-brain/reconcile.js` | `node tools/ai-brain/acceptance/ac-20-03-spec-missing-severity.js` exits 1 and prints the string `SPEC_MISSING_ESCALATED:`. It CONTROLs that the real blocked row is reported as `info`, tampers a copy of the register in `os.tmpdir()`, and exits 2 outside the repository | command stderr; `tools/ai-brain/acceptance/ac-20-03-spec-missing-severity.js` |
| `AC-AI-20-04` | **Negative proof:** the three scripts above fail operationally (exit 2), not as findings, when run where no register exists | `node tools/ai-brain/acceptance/ac-20-04-outside-repository.js` exits 0 and prints the string `OUTSIDE_REPOSITORY_PROBE: 3 subjects exited 2 with no register present` | command stdout; `tools/ai-brain/acceptance/ac-20-04-outside-repository.js` |
| `AC-AI-20-05` | The register does not overstate: no ready or terminal row names a specification that does not exist | `node tools/ai-brain/cli.js reconcile` exits 0 and prints the string `Tổng: 0 lỗi` (the warning and note counts are deliberately not pinned) | command stdout; `tools/ai-brain/cli.js` |

### Acceptance matrix: why each negative proof is not vacuous

Every command in the table was extracted from the markdown and executed verbatim
against `origin/main` at `ab54b3f`. All five rows produced the exit code and the
string stated above.

| Script | In the repository | From an empty directory, no repository | The CONTROL it performs |
|---|---|---|---|
| `ac-20-01-spec-coverage.js` | exit `0`, `SPEC_COVERAGE: 0 identity mismatches` | exit `2`, `SOURCE_MISSING` | counts a real row whose path is altered to a nonexistent file, and stops counting a real unspecified row whose path is pointed at an existing file |
| `ac-20-02-spec-identity.js` | exit `1`, `SPEC_IDENTITY_MISMATCH_DETECTED:` | exit `2`, `SOURCE_MISSING` | proves the untouched real specification matches its register row before the tampered copy is rejected |
| `ac-20-03-spec-missing-severity.js` | exit `1`, `SPEC_MISSING_ESCALATED:` | exit `2`, `SOURCE_MISSING` | proves the real blocked row's absent specification is reported as `info` before the ready copy is reported as `error` |
| `ac-20-04-outside-repository.js` | exit `0`, `OUTSIDE_REPOSITORY_PROBE:` | exit `2`, `SOURCE_MISSING` | spawns each subject with a fresh empty working directory and fails if any subject exits without `SOURCE_MISSING` |

A command that still printed its expected string and exited as expected from an
empty directory would prove nothing; none of these does. `AC-AI-20-05` reads the
real register through the real reconciler, so it too cannot pass where no
register exists. No row asserts through `node --test --test-name-pattern`, and no
row pins a count that drifts with the repository.

### One rule, one module

`AC-AI-20-01` (the invariant) and `AC-AI-20-02` (its negative proof) exercise the
same rule — "a specification belongs to a register row only when its Control
table names that row". The rule is defined once, in
`tools/ai-brain/acceptance/lib/spec-coverage.js`, and both scripts require it, so
editing the rule there changes both the gate and the proof of the gate. The
module re-exports `parseRegisterCsv` from `tools/ai-dashboard/register-adapter.js`
instead of carrying a second CSV parser, and the severity ladder that
`AC-AI-20-03` proves is the reconciler's own `SPEC_MISSING` rule in
`tools/ai-brain/reconcile.js`, which `AC-AI-20-05` runs through the CLI — not a
private copy of it.

## Verification commands

```bash
# 1. The invariants, as the acceptance matrix runs them
node tools/ai-brain/acceptance/ac-20-01-spec-coverage.js    # exit 0
node tools/ai-brain/acceptance/ac-20-02-spec-identity.js    # exit 1 (negative proof)
node tools/ai-brain/acceptance/ac-20-03-spec-missing-severity.js  # exit 1 (negative proof)
node tools/ai-brain/acceptance/ac-20-04-outside-repository.js     # exit 0

# 2. The register does not overstate, and no ready row names an absent spec
node tools/ai-brain/cli.js reconcile
# Expected exit code: 0, Tổng: 0 lỗi

# 3. Documentation and formatting gates
python docs/product-spec/scripts/validate_docs.py
node tools/ai-guard/cli.js secret-surface
pnpm format:check

# 4. The engine's own tests, added during implementation
node --test tools/ai-brain/test/spec-author.test.js
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `PENDING` | Initial specification authoring for TASK-AI-20. |

## Residual limitations

- **The completeness of each generated document, not its existence.** The
  engineer this Work Item delivers proves that every register row points at a
  file that belongs to it. It does not and cannot prove that the business rules,
  screens, APIs and acceptance outcomes inside those documents are correct,
  because those are the Codex planning gate's to author item by item. A green
  coverage row therefore means "the queue is readable", never "every item is
  specified".

- **The register's own count is stale.** Row `153`'s `key_behavior` reads "only
  13 exist"; measured at the pre-implementation baseline `ab54b3f`, `29` of `178`
  rows named an existing file and `149` did not. The register text is recorded
  here rather than corrected in place because this Work Item does not write the
  register; the measurement is what the acceptance rows use.

- **The generated documents are scaffolds until planned.** Filling a scaffold is
  `TASK-AI-21` and each item's own planning step, not this Work Item. An item
  whose document still carries a `REQUIRES AUTHORING` marker is not ready, and
  nothing in this Work Item claims otherwise.

- **`SPEC_MISSING` protects readiness, not idle backlog.** A `BLOCKED_*` or
  `BACKLOG` row with no document is reported as `info`, not `error`, so the
  reconciler keeps the register trustworthy rather than blocking work that has
  not started. Driving the `unspecified` count to zero is this Work Item's job;
  the reconciler will not force it before then.
