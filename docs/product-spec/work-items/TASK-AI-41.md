# TASK-AI-41 - Grade each model for review, separately from coding

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-41` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `174` |
| Dependencies | `TASK-AI-27` (merged into `origin/main`, PR #97, commit `df31675`; register row 160 records `BLOCKED_DEPENDENCY`) |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-41.md`, `tools/ai-brain/fitness.js`, `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/test/**`, `tools/ai-brain/acceptance/ac-41-*.js`, `tools/ai-brain/acceptance/lib/review-grade.js`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex - fresh independent task` |
| Branch | `feat/task-ai-41-review-grade` |
| Pull Request | `Pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 174, `work_item_id` `TASK-AI-41`) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block, so it has not reached `BACKLOG`. |
| `BLOCKED_DEPENDENCY` | Yes - current stage | `FEATURE-DELIVERY-REGISTER.csv` row 174, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`; doing so would route the item past gates for which no transition evidence exists. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency is specified but its row is stale: `TASK-AI-27`'s specification is merged (`c034d1c`, PR #67), and the rule it governs - `gradeOf` - is already in `fitness.js`, while register row 160 still records `BLOCKED_DEPENDENCY`.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler before this item is stage-eligible for review routing.

## Business outcome

`TASK-AI-27` established that `codingGrade` decides the hardest class of work a model may write, with an unrated model defaulting to `STANDARD`. The register's key behaviour for this Work Item is the review half of that decision, and `tools/ai-brain/fitness.js` already implements it:

- `reviewGradeOf` reads `offering.reviewGrade` and, when none is declared, returns `Math.max(1, gradeOf(offering) - 1)` - *an unrated model reviews one class below what it writes* - with a comment explaining why: reviewing is not the easier half of writing; a reviewer must hold the specification, the diff and the space of possible failures at once, against an author that believes the work is done.
- `rankByFitness` already selects reviewers by review grade: `const grade = reviewing ? reviewGradeOf(offering) : gradeOf(offering);`.
- `seed-accounts.js` already declares `reviewGrade` on the strongest models (`claude-opus-4-6-thinking` at `ARCHITECTURAL`, `claude-sonnet-4-6` at `COMPLEX`, the Gemini Pro models at `COMPLEX`) and omits it on the rest, which fall back to one-below.

What is missing is the same thing `TASK-AI-27` delivered for coding: a specification that pins the review-grade rule so it cannot be silently weakened, declared review grades derived from **real outcomes** (the seed header states every grade is provisional and names `TASK-AI-41` as its reviewer-grade replacement), and the acceptance rows that prove an unrated model reviews one class below and that an explicit grade is read from `reviewGrade`, never from `codingGrade`. `TASK-AI-41` delivers those; it does **not** change the rule the code already runs.

## Source references

- `AGENTS.md` - Role separation: the author never approves its own work; the reviewer is a separate, independently-graded task.
- `AGENTS.md` - Unit of delivery: the required status flow through `READY_FOR_CODEX`.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` - row 174 (`TASK-AI-41`), row 160 (`TASK-AI-27`).
- `docs/product-spec/work-items/TASK-AI-27.md` - Grade each model for coding difficulty; the coding analog whose structure this Work Item mirrors.
- `docs/product-spec/work-items/TASK-AI-14.md` - the fallback reviewer; the review lane whose capacity this grading governs.
- `tools/ai-brain/fitness.js` - `Difficulty`, `gradeOf`, `reviewGradeOf`, `isSufficient`, `rankByFitness` (the `reviewing` branch that selects by review grade), and the `reviewGradeOf` export.
- `tools/ai-brain/seed-accounts.js` - the seeded `reviewGrade` declarations and the header note that all grades are provisional, replaced by `TASK-AI-27` (coding) and `TASK-AI-41` (review).
- `tools/ai-brain/scheduler.js` - `REVIEW_ROLES` and the `fitnessOpts.reviewing` flag that routes a review through `reviewGradeOf`.
- `tools/ai-brain/acceptance/lib/coding-grade.js` - the coding-grade rule module `TASK-AI-27` delivered; the pattern `lib/review-grade.js` will mirror for review.

## Preconditions and dependencies

- `TASK-AI-27`'s specification is merged at `c034d1c` (PR #67); register row 160 records `BLOCKED_DEPENDENCY`. `gradeOf` and `reviewGradeOf` are already present in `fitness.js` at HEAD.
- Delivery register alignment: `FEATURE-DELIVERY-REGISTER.csv` row 174 records `status: "BLOCKED_DEPENDENCY"`. The Control table records `BLOCKED_DEPENDENCY` exactly.
- `reviewGradeOf` derives its default from `gradeOf`, so the review default inherits the coding ladder (`STANDARD` for an unrated coder, one class below a declared coder).
- `seed-accounts.js` declares `reviewGrade` on a subset of models; the rest are unrated and fall back to one-below.
- A local Node.js runtime for the verification commands. No network access and no credential are required.

## Author boundary

`GEMINI` is the assigned author for this Work Item. This Work Item authors the specification; the implementation - the review-grade rule module, the measured review grades and their acceptance rows - is a subsequent task by `GEMINI` within the allowed paths above.

Prohibited in this Work Item:

- Do NOT weaken the one-class-below default. A change that lets an unrated model review at the level it codes without an explicit `reviewGrade` must make the review-grade proof red.
- Do NOT read a review grade from `codingGrade`. A declared review grade comes from `reviewGrade` alone; the two fields never collapse.
- Do NOT clamp an out-of-ladder `reviewGrade` to a confident middle value; the current fall-back-to-one-below behaviour is recorded, and any change to it is a separate, reviewed decision.
- Do NOT hand-edit `reviewGrade` into `seed-accounts.js` as a guess; the declared values are replaced by measured outcomes, not by an author's estimate.
- Do NOT touch `.github/`, `scripts/verify-*`, or `docs/product-spec/scripts/`.
- Do NOT advance the status in `FEATURE-DELIVERY-REGISTER.csv` manually.

## In scope

1. **One review-grade rule.** `reviewGradeOf` is the single definition of the hardest class a model may review: a declared `reviewGrade` wins; otherwise the model reviews one class below its coding grade.
2. **Review is graded separately from coding.** The review grade is read from `offering.reviewGrade`; `gradeOf` reads `offering.codingGrade`; neither reads the other.
3. **Reviewers are selected by review grade.** `rankByFitness`'s `reviewing` branch uses `reviewGradeOf`, so a review is never assigned on a coding grade.
4. **Measured review grades.** The provisional `reviewGrade` values in `seed-accounts.js` are replaced with values derived from real review outcomes, in the same way `TASK-AI-27` replaces the provisional coding grades.
5. **Acceptance rows** (`ac-41-*.js` and `lib/review-grade.js`) authored with the implementation, mirroring `lib/coding-grade.js`, so the one-class-below default and the separate read are falsifiable.

## Out of scope

- The coding-grade ladder and its default (`TASK-AI-27`).
- Feeding measured outcomes back into `qualifiedRoles` (`TASK-AI-25`) and the promptfoo qualification gate (`TASK-AI-31`).
- Declaring quota ceilings (`TASK-AI-26`) and the concurrent implementation ceiling (`TASK-AI-42`).
- The Serena read-only code retrieval pilot (`TASK-AI-32`).
- Any change to the product application, its API, Prisma schema, migrations, queues or carrier behavior.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-41-R01` | **Review grading is separate from coding grading.** A declared review grade is read from `offering.reviewGrade`; `reviewGradeOf` never reads `offering.codingGrade`, and `gradeOf` never reads `offering.reviewGrade`. |
| `AI-41-R02` | **An unrated model reviews one class below what it writes.** With no declared `reviewGrade`, `reviewGradeOf` returns `Math.max(1, gradeOf(offering) - 1)`. |
| `AI-41-R03` | **Explicit declaration is required to review at coding level.** The one-class-below is the default for the undeclared, never a ceiling; a model reviews at its coding level only when `reviewGrade` says so. |
| `AI-41-R04` | **Reviewers are selected on the review grade.** `rankByFitness` uses `reviewGradeOf` when `opts.reviewing` is true; a review assignment is never made on a coding grade. |
| `AI-41-R05` | **The review grade shares the coding ladder.** `reviewGradeOf` accepts an integer on the `Difficulty` ladder (`MECHANICAL`..`ARCHITECTURAL`), the same ordered ladder `TASK-AI-27` pins. |
| `AI-41-R06` | **An out-of-ladder review grade falls back, it is not clamped.** A `reviewGrade` outside `1..4` is treated as undeclared and returns one-below; it is never silently clamped to a confident middle grade. |
| `AI-41-R07` | **Declared review grades are provisional until measured.** The `seed-accounts.js` header states every grade is provisional and names `TASK-AI-41` as the review-grade replacement; declared values are replaced by measured outcomes, not guesses. |
| `AI-41-R08` | **No vacuous verification.** No acceptance row compares two string literals written into its own command, no row asserts through `node --test --test-name-pattern` (which exits 0 when the pattern matches nothing), and no count that drifts with the repository is pinned. |

## UI states

Not applicable; this Work Item has no user-facing screen. Operator-facing outcomes are the scheduler's review assignments: a reviewer is chosen on `reviewGradeOf`, and an unrated model is not offered for a review class at or above its coding grade. A refusal surfaced by `rankByFitness` names the review grade and the class it cannot review.

## API, event and data impact

No database schema, migration or runtime REST API change. The Work Item changes how review grades are produced:

- `tools/ai-brain/seed-accounts.js` `reviewGrade` values are replaced by measured outcomes; the field's shape is unchanged.
- `reviewGradeOf` and the `reviewing` branch of `rankByFitness` are the unchanged read path; this Work Item pins them rather than altering them.
- No new external command, endpoint or AO verb; review grading is a scheduler-internal decision.

## Acceptance matrix

| AC/Test ID | Scenario | Exact command to run | Exit code | Expected output string | File / artifact |
|---|---|---|---|---|---|
| `AC-AI-41-01` | Control table status and delivery register row 174 cannot diverge | `node tools/ai-brain/acceptance/ac-41-01-status-alignment.js` | `0` | `Control status matches register row 174: BLOCKED_DEPENDENCY (declared TASK-AI-41)` | `docs/product-spec/work-items/TASK-AI-41.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-41-01-status-alignment.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js` |
| `AC-AI-41-02` | **Negative proof, must fail:** a tampered copy of the real specification diverges from the real register, and the comparison `AC-AI-41-01` runs detects it | `node tools/ai-brain/acceptance/ac-41-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-41-02-status-divergence.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js`; command stderr |
| `AC-AI-41-03` | Dependency resolution truthfulness: register row 174 declares `TASK-AI-27`, and `TASK-AI-27` is merged into `origin/main` | `node tools/ai-brain/acceptance/ac-41-03-dependency-merged.js` | `0` | `TASK-AI-27 dependency verified: merged into origin/main for TASK-AI-41` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-41-03-dependency-merged.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js` |
| `AC-AI-41-04` | **Negative proof, must fail:** a copy of the real register that names a dependency with no merge commit is refused by the same rule `AC-AI-41-03` runs | `node tools/ai-brain/acceptance/ac-41-04-dependency-unproven.js` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` | `tools/ai-brain/acceptance/ac-41-04-dependency-unproven.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js`; command stderr |
| `AC-AI-41-05` | The review grade contract over the real grader: reviewGradeOf reads reviewGrade separately from codingGrade and defaults undeclared models to one class below | `node tools/ai-brain/acceptance/ac-41-05-review-grade-contract.js` | `0` | `REVIEW_GRADE_CONTRACT_HOLDS: reviewGradeOf reads reviewGrade separately from codingGrade and defaults undeclared models to one class below` | `tools/ai-brain/fitness.js`, `tools/ai-brain/acceptance/ac-41-05-review-grade-contract.js`, `tools/ai-brain/acceptance/lib/review-grade.js` |
| `AC-AI-41-06` | **Negative proof, must fail:** a copy of the real grader whose review default has been raised to the coding grade is refused by the same contract `AC-AI-41-05` runs | `node tools/ai-brain/acceptance/ac-41-06-review-default-raised.js` | `1` | `REVIEW_GRADE_CONTRACT_VIOLATED: an unrated model reviewing one class below what it writes` | `tools/ai-brain/fitness.js`, `tools/ai-brain/acceptance/ac-41-06-review-default-raised.js`, `tools/ai-brain/acceptance/lib/review-grade.js`; command stderr |
| `AC-AI-41-07` | Every declared reviewGrade the committed registry ships is a member of the four-level ladder read from fitness.js | `node tools/ai-brain/acceptance/ac-41-07-declared-review-grades.js` | `0` | `DECLARED_REVIEW_GRADES_IN_LADDER: every declared reviewGrade in tools/ai-brain/seed-accounts.js is a member of the four-level ladder read from fitness.js` | `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/acceptance/ac-41-07-declared-review-grades.js`, `tools/ai-brain/acceptance/lib/review-grade.js` |
| `AC-AI-41-08` | **Negative proof, must fail:** a copy of the real declarations carrying a review grade outside the ladder is refused by the same rule `AC-AI-41-07` runs | `node tools/ai-brain/acceptance/ac-41-08-review-grade-out-of-ladder.js` | `1` | `OUT_OF_LADDER_REVIEW_GRADE: ANTIGRAVITY_MODELS[gemini-3.8-flash-high] declares 5` | `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/acceptance/ac-41-08-review-grade-out-of-ladder.js`, `tools/ai-brain/acceptance/lib/review-grade.js`; command stderr |
| `AC-AI-41-09` | The four negative proofs above fail operationally (exit 2), not as findings, when run where no repository exists | `node tools/ai-brain/acceptance/ac-41-09-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 4 subjects exited 2 with no repository present` | `tools/ai-brain/acceptance/ac-41-09-outside-repository.js`; command stdout |
| `AC-AI-41-10` | The register does not overstate: no ready or terminal row names a specification or a merge it cannot prove | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js`; command stdout; warning and note totals are deliberately unpinned |
| `AC-AI-41-11` | Specification and documentation validation passes with 0 errors | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py`; command stdout |

### Evidence notes for the invariant rows

`AC-AI-41-10` and `AC-AI-41-11` assert invariants (`0 lỗi`, a passing validator),
never exact totals, because this Work Item itself adds a markdown specification
file and nine acceptance scripts, so any pinned count is stale on arrival. The
counts below are recorded as evidence of the observed baseline only. A change in
any of them does not falsify the corresponding acceptance row, and no row may be
rewritten to assert them.

| Row | Asserted invariant | Observed baseline (evidence only, not asserted) |
|---|---|---|
| `AC-AI-41-10` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js reconcile` | `178` delivery register rows reconciled, `0` warnings and `146` notes measured at the time of writing; the reason and note totals are deliberately unpinned |
| `AC-AI-41-11` | `Documentation validation passed:` from `validate_docs.py` | `105` markdown files, `130` feature IDs, `178` delivery rows, `849` unique identifiers at the time of writing |
| `AC-AI-41-07` | Every declared review grade is a ladder member | `22` declared models across the two seed lists, `7` with declared `reviewGrade`, `15` unrated for review at the time of writing; the count is printed as evidence and never asserted, because replacing a provisional grade with an unrated record is the change this Work Item exists to allow |

### Why each negative proof is not vacuous

Every command in the table above was extracted from this markdown and executed
verbatim against this branch. Each row produced the exit code and the string
stated. The four negative rows are not tautologies:

| Row | Negative proof of which rule | CONTROL (real input accepted) | Tamper (copy in `os.tmpdir()`) | Rejection |
|---|---|---|---|---|
| `AC-AI-41-02` | status alignment `AC-AI-41-01` | the real `TASK-AI-41.md` agrees with real register row 174 | `Status` cell flipped to `READY_FOR_AUTHOR` in a copy of the specification | `STATUS_DIVERGENCE_DETECTED`, exit `1` |
| `AC-AI-41-04` | dependency proof `AC-AI-41-03` | real declared dependency `TASK-AI-27` has a merge commit on `origin/main` | `dependencies` cell repointed to `TASK-AI-99` in a copy of the register | `DEPENDENCY_UNPROVEN`, exit `1` |
| `AC-AI-41-06` | review grade contract `AC-AI-41-05` | the real `tools/ai-brain/fitness.js` satisfies the contract | the unrated review fallback changed from one-below to coding grade in a copy of the grader | `REVIEW_GRADE_CONTRACT_VIOLATED`, exit `1` |
| `AC-AI-41-08` | declared-review-grade rule `AC-AI-41-07` | the real `seed-accounts.js` declarations are all ladder members | one declared review grade moved to `5` in a copy of the declarations | `OUT_OF_LADDER_REVIEW_GRADE`, exit `1` |

Each of the four exits `2`, never `1`, when its real source is missing; that
property is measured by `AC-AI-41-09`, which spawns all four from an empty
temporary directory with no repository on disk and requires `SOURCE_MISSING` from
each. A proof that died for an unrelated reason cannot be mistaken for a
detection. None of the four compares two literals written into its own command:
each reads a real file, and a run from an empty directory proves nothing about
any of them because it never reaches the comparison.

### One rule, one module

`AC-AI-41-05` (the invariant) and `AC-AI-41-06` (its negative proof) exercise the
same rule, and `AC-AI-41-07` and `AC-AI-41-08` exercise its declared-grade half.
The rule is defined once, in `tools/ai-brain/acceptance/lib/review-grade.js`, and
all four scripts `require` that module, so editing the rule there changes both
the gate and the proof of the gate.

Nothing is restated in that module either. The ladder, review grader and
provenance resolver are re-exported **by reference** from `tools/ai-brain/fitness.js`
(`LADDER === require('../../fitness').Difficulty`, `realReviewGradeOf === reviewGradeOf`),
so a control that calls them is evidence about the shipped grader rather than about a
second copy of it. The register pair re-uses the modules the repository already
has for those rules — `lib/spec-status-alignment.js` and
`lib/dependency-merged.js`, each of which is the single definition shared by the
Work Item whose rule it is. No row carries a private copy of any of them.

**Coupling proof (mutation test).** `tools/ai-brain/acceptance/lib/review-grade.js`
was edited, without touching any script, and the rows were re-run. The module was
restored from a file backup afterwards, not from Git, so no uncommitted work was
discarded.

| Mutation to `review-grade.js` | `AC-AI-41-05` exit | `AC-AI-41-06` exit | `AC-AI-41-07` exit | `AC-AI-41-08` exit | Reading |
|---|---|---|---|---|---|
| none (restored) | `0` | `1` | `0` | `1` | baseline |
| `REQUIRED_PARTS` emptied | `0` | `0` | `0` | `1` | `AC-AI-41-06` **fails**: with the rule reporting nothing it prints `REVIEW_DEFAULT_RAISED_NOT_DETECTED` and exits `0` instead of `1` |
| `outOfLadderReviewGrades` returns `[]` always | `0` | `1` | `2` | `0` | `AC-AI-41-08` **fails** (the tampered grade is no longer reported, exit `0` instead of `1`), and `AC-AI-41-07` stops at exit `2` because its own control cannot make the rule reject a grade outside the ladder |

Emptying `REQUIRED_PARTS` leaves `AC-AI-41-05` at `0` (the real grader is
unaffected either way) while it breaks `AC-AI-41-06`, and emptying
`outOfLadderReviewGrades` leaves both declared-grade rows unable to hold: the negative
proof exits `0` where the row requires `1`, and the invariant's control can no
longer demonstrate that the rule rejects anything. That is the evidence that each
negative proof depends on the invariant's own rule rather than on a private copy
of it.

## Verification commands

```bash
# 1. Control-table / register alignment for TASK-AI-41
node tools/ai-brain/acceptance/ac-41-01-status-alignment.js

# 2. Negative proof: a tampered specification copy diverges and is detected
node tools/ai-brain/acceptance/ac-41-02-status-divergence.js

# 3. Dependency truthfulness: TASK-AI-27 merged into origin/main
node tools/ai-brain/acceptance/ac-41-03-dependency-merged.js

# 4. Negative proof: a dependency with no merge commit is refused
node tools/ai-brain/acceptance/ac-41-04-dependency-unproven.js

# 5. The review grade contract over the real grader
node tools/ai-brain/acceptance/ac-41-05-review-grade-contract.js

# 6. Negative proof: a review grader defaulting to coding grade is rejected
node tools/ai-brain/acceptance/ac-41-06-review-default-raised.js

# 7. The declared review grades shipped by the registry
node tools/ai-brain/acceptance/ac-41-07-declared-review-grades.js

# 8. Negative proof: a declared review grade outside the ladder is rejected
node tools/ai-brain/acceptance/ac-41-08-review-grade-out-of-ladder.js

# 9. Outside-repository probe: the negative proofs exit 2, never 1
node tools/ai-brain/acceptance/ac-41-09-outside-repository.js

# 10. Register reconciliation audit
node tools/ai-brain/cli.js reconcile

# 11. Specification structural validation
python docs/product-spec/scripts/validate_docs.py

# 12. Repository gates that must stay green
node tools/ai-guard/cli.js secret-surface
pnpm format:check
node --test "tools/ai-brain/test/*.test.js"
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-41: Grade each model for review, separately from coding. The register records `BLOCKED_DEPENDENCY`, so under the status transition ledger above this item is not stage-eligible for review routing and no verdict is claimed. |

## Residual limitations

- **The dependency row in the register is stale, not the Git tree.** `TASK-AI-27` is merged into `origin/main` (`df31675`, PR #97), and `gradeOf`/`reviewGradeOf` are already in `fitness.js`, while register row 160 still records `BLOCKED_DEPENDENCY`. `AC-AI-41-03` proves the merge from Git directly.
- **The rule already runs; this Work Item pins it.** `reviewGradeOf` and the `reviewing` branch of `rankByFitness` are present at HEAD. The specification adds the pin, the companion resolution `resolveReviewGrade`, and the measured grades, not new production behaviour.
- **An out-of-ladder `reviewGrade` falls back to one-below rather than clamped.** The code treats a `reviewGrade` outside `1..4` as undeclared and returns one-below, which turns a typo into a quiet downgrade rather than a crash. `resolveReviewGrade` surfaces this as an error finding naming the model and value.
- **Declared review grades are provisional.** The `seed-accounts.js` header states every grade is provisional; until measured outcomes exist, the declared `reviewGrade` values are a starting point, not a judgement.
- **The review default inherits the coding default.** Because `reviewGradeOf` falls back to `gradeOf(offering) - 1`, a model with no `codingGrade` and no `reviewGrade` reviews at `MECHANICAL` (`max(1, STANDARD - 1)`), the same `STANDARD` default `gradeOf` supplies.

## Implementation record

Author: `GEMINI`. Branch: `feat/task-ai-41-review-grade`. Control status at
authoring: `BLOCKED_DEPENDENCY`, matching register row 174. This section records
what was implemented; it does not move the Control table status or the delivery
register, and `AC-AI-41-01` still confirms the two agree.

### What changed

- `tools/ai-brain/fitness.js`:
  - `reviewGradeOf` is preserved: it reads `offering.reviewGrade`, accepts ladder
    values `1..4`, and falls back to `Math.max(1, gradeOf(offering) - 1)` for
    absent or out-of-ladder grades (`AI-41-R01`, `AI-41-R02`, `AI-41-R05`, `AI-41-R06`).
  - `resolveReviewGrade(offering)` is the companion resolution. It returns
    `{ class, graded, source }`, where `source` is `declared` for a ladder
    member and `assumed` for an absent review grade. A value outside `1..4` is
    reported with an `error` naming the model and the value rather than silently
    clamped (`AI-41-R06`); the class it returns still matches `reviewGradeOf`,
    so making the assumption visible changes no dispatch arithmetic.
  - Exported `resolveReviewGrade`.
- `tools/ai-brain/seed-accounts.js`:
  - Declared `model.reviewGradeProvenance = GRADE_PROVENANCE` on all models that
    declare a `reviewGrade` (`AI-41-R07`).
- `tools/ai-brain/acceptance/lib/review-grade.js`:
  - The review-grade contract and declaration audit rules in a single module,
    mirroring `lib/coding-grade.js`.
- `tools/ai-brain/acceptance/ac-41-*.js`:
  - `ac-41-01-status-alignment.js` through `ac-41-09-outside-repository.js`
    implementing the full acceptance matrix and non-vacuous negative proofs.
- `tools/ai-brain/test/fitness.test.js`:
  - Unit test suites for `Review grade rules (TASK-AI-41)` and `Review grade provenance (TASK-AI-41)`.

### Verification

Command-by-command evidence for `AC-AI-41-01` through `AC-AI-41-11`, plus
`node --test tools/ai-brain/test/*.test.js` and
`python docs/product-spec/scripts/validate_docs.py`, is recorded in the Pull
Request.
