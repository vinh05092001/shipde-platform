# TASK-AI-27 — Grade each model for coding difficulty

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-27` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `160` |
| Dependencies | `TASK-AI-26` (merged into `origin/main`; register row 159 not yet reconciled to `MERGED`) |
| Assigned author | `CLAUDE` |
| Risk | `MEDIUM` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-27.md`, `tools/ai-brain/fitness.js`, `tools/ai-brain/offerings.js`, `tools/ai-brain/scheduler.js`, `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/test/fitness.test.js`, `tools/ai-brain/acceptance/ac-27-*.js`, `tools/ai-brain/acceptance/lib/coding-grade.js`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-27` |
| Pull Request | `pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 160) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block, so it has not reached `BACKLOG`. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 160, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency is satisfied in Git reality but not yet recorded: `TASK-AI-26` is merged into `origin/main` at `3ccf49b7fed6127a54676fef23980e50f4d6bca1` (PR #41), while register row 159 still reads `BACKLOG`. `AC-AI-27-03` proves the merge from the repository rather than from the register, because the register status is stale rather than true.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler (`TASK-AI-19`) before this item is stage-eligible for review routing.
- `AC-AI-27-01` mechanically compares the `Status` cell of the Control table above against row 160 of the register and fails if they diverge, guaranteeing the two sources cannot silently disagree.

## Business outcome

`codingGrade` is the field that decides which class of work a model may take, and it is the only such field. `tools/ai-brain/fitness.js` reads it in `gradeOf`, refuses any task above it in `scoreOffering`, and derives the review class from it in `reviewGradeOf`. The ladder has four ordered classes — `MECHANICAL`, `STANDARD`, `COMPLEX`, `ARCHITECTURAL` — and the arithmetic of dispatch already depends on it.

Two things are wrong with it today, and both were measured in the source rather than assumed:

1. **An ungraded model is indistinguishable from one graded STANDARD.** `gradeOf` returns `Difficulty.STANDARD` when `codingGrade` is absent or outside `1..4`. Measured at HEAD: `gradeOf({ id: 'ac27-control-ungraded' })` returns `2`, and nothing anywhere records whether that `2` was declared by an operator or assumed by the default. A model nobody has ever graded therefore reads exactly like a model measured and rated STANDARD, and a typo such as `codingGrade: 9` is silently clamped to the same confident middle grade rather than reported.
2. **No grade the repository ships was measured.** `tools/ai-brain/seed-accounts.js` says so in its own header: the grades are "PROVISIONAL. Nothing here has been measured", and it names `TASK-AI-27` and `TASK-AI-41` as the Work Items that replace them with grades derived from real outcomes. The 22 declared models therefore carry numbers that look like judgements and are placeholders.

This Work Item makes a declared grade distinguishable from an assumed one, refuses a grade outside the ladder instead of clamping it, and lets a grade be derived from outcomes with the evidence recorded alongside it. The ladder itself, its ordering, and the dispatch arithmetic that consumes it are preserved exactly: `AC-AI-27-05` asserts the contract the real grader already satisfies, so this Work Item cannot quietly remove it.

## Source references

- `tools/ai-brain/fitness.js` — `Difficulty`, `DIFFICULTY_NAMES`, `gradeOf`, `reviewGradeOf`, `isSufficient`, `scoreOffering`, `rankByFitness`, `runwayReport`
- `tools/ai-brain/offerings.js` — `expandOfferings`, where `codingGrade` is inherited from the model entry or the account
- `tools/ai-brain/scheduler.js` — `planDispatch`, which reads `item.difficulty` and `role.difficulty` and records `grade` on every assignment
- `tools/ai-brain/seed-accounts.js` — the 22 provisional declarations and the header that calls them provisional
- `docs/product-spec/work-items/TASK-AI-26.md` § Post-implementation notes — the provenance discipline a derived number must follow: a value with no provenance is refused rather than filled with a default, and an evidence floor is counted from the ledger rather than trusted from a field that does not exist
- `docs/product-spec/work-items/TASK-AI-41.md` — review grading, deliberately separate and downstream of this Work Item
- `docs/product-spec/work-items/TASK-AI-30.md` — the qualification probe that will supply the measured outcomes
- `AI-TOOL-10` — a failed or partial operation reports exact state and must not be recorded as healthy

## Preconditions and dependencies

- Prerequisite `TASK-AI-26` (Declare quota limits for every registered account) is merged into `origin/main` at `3ccf49b7fed6127a54676fef23980e50f4d6bca1` (PR #41). `AC-AI-27-03` proves this from Git rather than from the register.
- Delivery register alignment: `FEATURE-DELIVERY-REGISTER.csv` row 160 records `status: "BLOCKED_DEPENDENCY"`. The Control table records `BLOCKED_DEPENDENCY` exactly. The block is stale rather than true: the dependency is merged in Git, and clearing the row is the reconciler's write-back (`TASK-AI-19`), never a hand edit.
- The grade ladder exists and is applied: `Difficulty` is declared in `fitness.js` with the four ordered classes, and `scoreOffering` returns `usable: false` naming the grade it needed.
- `tools/ai-brain/test/fitness.test.js` exists and exercises `gradeOf`, `isSufficient` and `scoreOffering`, so a behavioural regression in the grader is already caught.
- `seed-accounts.js` declares grades through the same `Difficulty` object the grader compares against, so a declaration and an assertion cannot disagree about what a class is worth.

## Author boundary

`CLAUDE` is the assigned author for this Work Item. Scope is strictly bounded to making a declared coding grade distinguishable from an assumed one, refusing a grade outside the ladder, and recording the provenance and evidence of every grade, within `tools/ai-brain/` and this specification.

Prohibited in this Work Item:

- Do NOT touch `.github/`, `scripts/verify-*`, or `docs/product-spec/scripts/`.
- Do NOT change the four ladder levels, their names, or their order. `AC-AI-27-05` asserts the ladder the real grader ships; widening or renumbering it is a different Work Item.
- Do NOT derive a grade from `quality`, from price, or from the model's name. `quality` ranks two models against each other and is not evidence that a model can finish a class of work.
- Do NOT raise a grade to make a dispatch succeed. A grade that moves without a recorded outcome is the fabrication this Work Item exists to prevent.
- Do NOT lower the default for an ungraded model below STANDARD, and do NOT raise it above STANDARD. Either change alters which work the whole fleet may take.
- Do NOT advance the status in `FEATURE-DELIVERY-REGISTER.csv` manually.
- Do NOT implement review grading, the qualification probe, or the cooldown ladder (`TASK-AI-41`, `TASK-AI-30`, `TASK-AI-28`).

## In scope

1. **A grade record rather than a bare number**:
   - `gradeOf` continues to return the class, and a companion resolution reports `graded: true` or `graded: false` with the source of the value (`declared` or `assumed`), so an ungraded model is visible as ungraded.
   - `isSufficient` and `scoreOffering` keep their existing outcomes for an ungraded model: it is sufficient up to STANDARD and refused above it. Making the assumption visible must not change which work the fleet may take.
2. **A declared grade outside the ladder is refused, naming the model and the value**:
   - `gradeOf` currently clamps any value outside `1..4` to STANDARD. The implementation reports the value instead, so a typo is a finding rather than a confident middle grade. The clamp is the behaviour this Work Item replaces; `AI-27-R04` records that.
3. **A derived grade carries its provenance and its evidence**:
   - A grade derived from outcomes carries the class it was derived for, the number of observations behind it, and the instant it was computed. Below the floor the grade stays as it was and the derivation is reported as insufficient evidence rather than asserted.
   - The evidence floor is counted from the recorded outcomes, not read from a field, following the correction recorded in `TASK-AI-26.md` § Post-implementation notes.
4. **A grade moves only with a recorded outcome**:
   - Re-grading retains the previous grade and the outcome that moved it, so a lowered grade is auditable rather than erased.
5. **The grade travels with the dispatch decision**:
   - `expandOfferings` carries the grade record, and every assignment produced by `planDispatch` records the grade used and whether it was declared or assumed.
6. **The provisional declarations are replaced or marked**:
   - Every grade in `seed-accounts.js` is either backed by a recorded outcome or explicitly ungraded. No declaration keeps a placeholder that reads as a measurement.
7. **Deterministic unit tests**:
   - Extend `tools/ai-brain/test/fitness.test.js` covering each rule below with no network and no real registry.

## Out of scope

- Review grading and the one-class-below derivation for reviewers (`TASK-AI-41` owns it; this Work Item keeps `reviewGradeOf` intact and unchanged).
- The qualification probe that produces the outcomes a derived grade consumes (`TASK-AI-30`).
- Ceilings, runway arithmetic and provenance for limits (`TASK-AI-26`).
- Cooldown, tier step-down and refusal routing (`TASK-AI-28`).
- Changing which models are registered, or adding a provider.
- Any change to the delivery register schema or to a lifecycle state.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-27-R01` | **A grade is the declared class, never an inference from strength.** `codingGrade` is the only input to a model's class. `quality`, cost and the model's name never raise or lower it, because quality ranks two models against each other and says nothing about whether either can finish a class of work. |
| `AI-27-R02` | **An absent grade is STANDARD, never the top class.** An ungraded model may take ordinary work and may never be trusted with ARCHITECTURAL work by omission. The default sits in the middle of the ladder so an omission is a middle grade rather than a grant. |
| `AI-27-R03` | **An assumed grade is distinguishable from a declared one.** A grade the default supplied reports `graded: false` with source `assumed`; a grade an operator declared reports `graded: true` with source `declared`. A reader that cannot tell an unmeasured model from a rated one cannot act on either. |
| `AI-27-R04` | **A grade outside the ladder is refused, not clamped.** A declared `codingGrade` that is not one of the four classes is reported with the model and the value. Clamping it to STANDARD converts a typo into a confident middle grade, which is worse than the report. |
| `AI-27-R05` | **A derived grade needs a floor of evidence.** A grade derived from outcomes requires at least the recorded floor of observations for that class. Below the floor the previous grade stands and the derivation is reported as insufficient evidence, because a grade inferred from two outcomes is a guess wearing a number. |
| `AI-27-R06` | **A grade never exceeds its evidence.** A model is graded for a class only when it has completed work of that class and the outcome was recorded. A model that has never been given architectural work is not graded architectural, however strong it looks. |
| `AI-27-R07` | **A grade moves only with a recorded outcome.** Every change to a grade names the outcome that caused it. A grade that moved with nothing to point at is indistinguishable from a bug and is refused. |
| `AI-27-R08` | **A lowered grade is retained, not erased.** Re-grading keeps the previous grade alongside the new one, so a demotion can be read back. Erasing it would make the fleet's history of failures unavailable to the operator who has to decide what to trust. |
| `AI-27-R09` | **The grade is recorded on the dispatch decision.** Every assignment carries the grade used and whether it was declared or assumed, so a reviewer can see why a model was trusted with the work without re-deriving it from the registry. |
| `AI-27-R10` | **The review class stays derived from the coding class.** An ungraded model reviews one class below what it writes, and only an explicit `reviewGrade` may set review higher. This derivation is inherited unchanged; widening it is `TASK-AI-41`'s. |

## UI states

Not applicable as a screen of its own. The cockpit capacity panel gains two observable states per row, carried by the grade record:

- **Declared** — the row names the class and that an operator set it.
- **Assumed** — the row names the class and states plainly that no grade was declared, rather than showing `STANDARD` as though it were a rating.

## API, event and data impact

- No database schema, backend API, or carrier protocol change.
- `accounts.registry.json` model entries keep `codingGrade` as a number; the grade record is resolved at read time rather than stored twice, so a registry written before this change stays valid and simply reports `graded: false` for a model that declares no grade.
- `expandOfferings` and the `planDispatch` assignment gain the grade record. Both existing consumers ignore unrecognised fields.
- No change to `accounts.registry.json`'s column shape, and no change to the delivery register.

## Acceptance matrix

**Evidence boundary.** Every row runs against the real modules in `tools/ai-brain/`
or against a copy of a real repository file written to `os.tmpdir()`. No row is
satisfied by citing this document, no row compares two string literals written
into its own command, no row asserts through `node --test --test-name-pattern`,
and no row pins a count that drifts with the repository. No command is stored
inline in a table cell: a raw `|` inside a cell splits it, and a mangled command
that dies on a syntax error exits `1`, which is the code several rows below
expect. Every row is a committed script or a command that already exists.

| AC/Test ID | Scenario | Exact Command | Exit Code | Expected Output String | Output Source / Artifact |
|---|---|---|---|---|---|
| `AC-AI-27-01` | Control table status and delivery register row 160 cannot diverge | `node tools/ai-brain/acceptance/ac-27-01-status-alignment.js` | `0` | `Control status matches register row 160: BLOCKED_DEPENDENCY (declared TASK-AI-27)` | `docs/product-spec/work-items/TASK-AI-27.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-27-01-status-alignment.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js` |
| `AC-AI-27-02` | **Negative proof, must fail:** a tampered copy of the real specification diverges from the real register, and the comparison `AC-AI-27-01` runs detects it | `node tools/ai-brain/acceptance/ac-27-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-27-02-status-divergence.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js`; command stderr |
| `AC-AI-27-03` | Dependency resolution truthfulness: register row 160 declares `TASK-AI-26`, and `TASK-AI-26` is merged into `origin/main` | `node tools/ai-brain/acceptance/ac-27-03-dependency-merged.js` | `0` | `TASK-AI-26 dependency verified: merged into origin/main for TASK-AI-27` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-27-03-dependency-merged.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js` |
| `AC-AI-27-04` | **Negative proof, must fail:** a copy of the real register that names a dependency with no merge commit is refused by the same rule `AC-AI-27-03` runs | `node tools/ai-brain/acceptance/ac-27-04-dependency-unproven.js` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` | `tools/ai-brain/acceptance/ac-27-04-dependency-unproven.js`, `tools/ai-brain/acceptance/lib/dependency-merged.js`; command stderr |
| `AC-AI-27-05` | The real grader classes a model by its declared grade and defaults an absent grade to STANDARD, never to the top class | `node tools/ai-brain/acceptance/ac-27-05-grade-contract.js` | `0` | `GRADE_CONTRACT_HOLDS: codingGrade decides the class of work and an absent grade defaults to STANDARD, never to the top class` | `tools/ai-brain/fitness.js`, `tools/ai-brain/acceptance/ac-27-05-grade-contract.js`, `tools/ai-brain/acceptance/lib/coding-grade.js` |
| `AC-AI-27-06` | **Negative proof, must fail:** a copy of the real grader whose default has been raised to the top class is refused by the same contract `AC-AI-27-05` runs | `node tools/ai-brain/acceptance/ac-27-06-grade-default-raised.js` | `1` | `GRADE_CONTRACT_VIOLATED: an absent codingGrade falling back to STANDARD` | `tools/ai-brain/fitness.js`, `tools/ai-brain/acceptance/ac-27-06-grade-default-raised.js`, `tools/ai-brain/acceptance/lib/coding-grade.js`; command stderr |
| `AC-AI-27-07` | Every coding grade the committed registry ships is a member of the four-level ladder | `node tools/ai-brain/acceptance/ac-27-07-declared-grades.js` | `0` | `DECLARED_GRADES_IN_LADDER: every declared codingGrade in tools/ai-brain/seed-accounts.js is a member of the four-level ladder read from fitness.js` | `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/acceptance/ac-27-07-declared-grades.js`, `tools/ai-brain/acceptance/lib/coding-grade.js` |
| `AC-AI-27-08` | **Negative proof, must fail:** a copy of the real declarations carrying a grade outside the ladder is refused by the same rule `AC-AI-27-07` runs | `node tools/ai-brain/acceptance/ac-27-08-grade-out-of-ladder.js` | `1` | `OUT_OF_LADDER_GRADE: ANTIGRAVITY_MODELS[gemini-3.8-flash-high] declares 5` | `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/acceptance/ac-27-08-grade-out-of-ladder.js`, `tools/ai-brain/acceptance/lib/coding-grade.js`; command stderr |
| `AC-AI-27-09` | The four negative proofs above fail operationally (exit 2), not as findings, when run where no repository exists | `node tools/ai-brain/acceptance/ac-27-09-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 4 subjects exited 2 with no repository present` | `tools/ai-brain/acceptance/ac-27-09-outside-repository.js`; command stdout |
| `AC-AI-27-10` | The register does not overstate: no ready or terminal row names a specification or a merge it cannot prove | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js`; command stdout; warning and note totals are deliberately unpinned |
| `AC-AI-27-11` | Specification and documentation validation passes with 0 errors | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py`; command stdout |

### Evidence notes for the invariant rows

`AC-AI-27-10` and `AC-AI-27-11` assert invariants (`0 lỗi`, a passing validator),
never exact totals, because this Work Item itself adds a markdown specification
file and nine acceptance scripts, so any pinned count is stale on arrival. The
counts below are recorded as evidence of the observed baseline only. A change in
any of them does not falsify the corresponding acceptance row, and no row may be
rewritten to assert them.

| Row | Asserted invariant | Observed baseline (evidence only, not asserted) |
|---|---|---|
| `AC-AI-27-10` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js reconcile` | `178` delivery register rows reconciled, exactly one expected warning (`PINNED_VERSION_DRIFT` for `codex-cli`) |
| `AC-AI-27-11` | `Documentation validation passed:` from `validate_docs.py` | `94` markdown files, `130` feature IDs, `178` delivery rows at the time of writing |
| `AC-AI-27-07` | Every declared grade is a ladder member | `22` declared models across the two seed lists, `22` graded, `0` ungraded at the time of writing; the count is printed as evidence and never asserted, because replacing a provisional grade with an ungraded record is the change this Work Item exists to allow |

### Why each negative proof is not vacuous

Every command in the table above was extracted from this markdown and executed
verbatim against this branch. Each row produced the exit code and the string
stated. The four negative rows are not tautologies:

| Row | Negative proof of which rule | CONTROL (real input accepted) | Tamper (copy in `os.tmpdir()`) | Rejection |
|---|---|---|---|---|
| `AC-AI-27-02` | status alignment `AC-AI-27-01` | the real `TASK-AI-27.md` agrees with real register row 160 | `Status` cell flipped to `READY_FOR_AUTHOR` in a copy of the specification | `STATUS_DIVERGENCE_DETECTED`, exit `1` |
| `AC-AI-27-04` | dependency proof `AC-AI-27-03` | real declared dependency `TASK-AI-26` has a merge commit on `origin/main` | `dependencies` cell repointed to `TASK-AI-99` in a copy of the register | `DEPENDENCY_UNPROVEN`, exit `1` |
| `AC-AI-27-06` | grade contract `AC-AI-27-05` | the real `tools/ai-brain/fitness.js` satisfies the contract | the ungraded fallback changed from `STANDARD` to `ARCHITECTURAL` in a copy of the grader | `GRADE_CONTRACT_VIOLATED`, exit `1` |
| `AC-AI-27-08` | declared-grade rule `AC-AI-27-07` | the real `seed-accounts.js` declarations are all ladder members | one declared grade moved to `5` in a copy of the declarations | `OUT_OF_LADDER_GRADE`, exit `1` |

Each of the four exits `2`, never `1`, when its real source is missing; that
property is measured by `AC-AI-27-09`, which spawns all four from an empty
temporary directory with no repository on disk and requires `SOURCE_MISSING` from
each. A proof that died for an unrelated reason cannot be mistaken for a
detection. None of the four compares two literals written into its own command:
each reads a real file, and a run from an empty directory proves nothing about
any of them because it never reaches the comparison.

### One rule, one module

`AC-AI-27-05` (the invariant) and `AC-AI-27-06` (its negative proof) exercise the
same rule, and `AC-AI-27-07` and `AC-AI-27-08` exercise its declared-grade half.
The rule is defined once, in `tools/ai-brain/acceptance/lib/coding-grade.js`, and
all four scripts `require` that module, so editing the rule there changes both
the gate and the proof of the gate.

Nothing is restated in that module either. The ladder, the grader and the
sufficiency test are re-exported **by reference** from `tools/ai-brain/fitness.js`
(`LADDER === require('../fitness').Difficulty`, `realGradeOf === gradeOf`), so a
control that calls them is evidence about the shipped grader rather than about a
second copy of it. The register pair re-uses the modules the repository already
has for those rules — `lib/spec-status-alignment.js` and
`lib/dependency-merged.js`, each of which is the single definition shared by the
Work Item whose rule it is. No row carries a private copy of any of them.

**Coupling proof (mutation test).** `tools/ai-brain/acceptance/lib/coding-grade.js`
was edited, without touching any script, and the rows were re-run. The module was
restored from a file backup afterwards, not from Git, so no uncommitted work was
discarded.

| Mutation to `coding-grade.js` | `AC-AI-27-05` exit | `AC-AI-27-06` exit | `AC-AI-27-07` exit | `AC-AI-27-08` exit | Reading |
|---|---|---|---|---|---|
| none (restored) | `0` | `1` | `0` | `1` | baseline |
| `REQUIRED_PARTS` emptied | `0` | `0` | `0` | `1` | `AC-AI-27-06` **fails**: with the rule reporting nothing it prints `GRADE_DEFAULT_RAISED_NOT_DETECTED` and exits `0` instead of `1` |
| `outOfLadderGrades` returns `[]` always | `0` | `1` | `2` | `0` | `AC-AI-27-08` **fails** (the tampered grade is no longer reported, exit `0` instead of `1`), and `AC-AI-27-07` stops at exit `2` because its own control cannot make the rule reject a grade outside the ladder |
| `DEFAULT_IS_NOT_THE_TOP_GRADE` part dropped only | `0` | `1` | `0` | `1` | no change: the tamper is caught by `UNGRADED_DEFAULTS_TO_STANDARD`, which names the same line |
| `GRADE_LADDER_ORDERED` part dropped only | `0` | `1` | `0` | `1` | no change: the tamper does not touch the ladder declaration |

Emptying `REQUIRED_PARTS` leaves `AC-AI-27-05` at `0` (the real grader is
unaffected either way) while it breaks `AC-AI-27-06`, and emptying
`outOfLadderGrades` leaves both declared-grade rows unable to hold: the negative
proof exits `0` where the row requires `1`, and the invariant's control can no
longer demonstrate that the rule rejects anything. That is the evidence that each
negative proof depends on the invariant's own rule rather than on a private copy
of it.

## Verification commands

```bash
# 1. Control-table / register alignment for TASK-AI-27
node tools/ai-brain/acceptance/ac-27-01-status-alignment.js

# 2. Negative proof: a tampered specification copy diverges and is detected
node tools/ai-brain/acceptance/ac-27-02-status-divergence.js

# 3. Dependency truthfulness: TASK-AI-26 merged into origin/main
node tools/ai-brain/acceptance/ac-27-03-dependency-merged.js

# 4. Negative proof: a dependency with no merge commit is refused
node tools/ai-brain/acceptance/ac-27-04-dependency-unproven.js

# 5. The grade contract over the real grader
node tools/ai-brain/acceptance/ac-27-05-grade-contract.js

# 6. Negative proof: a grader defaulting to the top class is rejected
node tools/ai-brain/acceptance/ac-27-06-grade-default-raised.js

# 7. The declared grades shipped by the registry
node tools/ai-brain/acceptance/ac-27-07-declared-grades.js

# 8. Negative proof: a declared grade outside the ladder is rejected
node tools/ai-brain/acceptance/ac-27-08-grade-out-of-ladder.js

# 9. Outside-repository probe: the negative proofs exit 2, never 1
node tools/ai-brain/acceptance/ac-27-09-outside-repository.js

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
| 1 | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-27: grading each model for coding difficulty. The register records `BLOCKED_DEPENDENCY`, so under the status transition ledger above this item is not stage-eligible for review routing and no verdict is claimed. |

## Residual limitations

- **The assumption is made visible; it is not removed.** `AI-27-R02` keeps an
  ungraded model at STANDARD because raising or lowering the default changes which
  work the whole fleet may take, and that is a larger decision than this Work Item.
  A fleet of ungraded models is still trusted with ordinary work.
- **A grade is a class, not a measurement of quality.** `AI-27-R01` forbids reading
  the grade from `quality`, so this Work Item does not unify the two axes that
  `fitness.js` deliberately separates. A model may be graded ARCHITECTURAL and
  score poorly; the grade says it is allowed, not that it is good.
- **Nothing here proves a grade correct.** The rules constrain where a grade may
  come from and what must accompany it. They cannot tell a grade derived from a
  handful of easy wins from one derived from representative work, and they do not
  attempt to.
- **The derived-grade path produced no positive acceptance row.** The flow that
  derives a grade from recorded outcomes does not exist at HEAD, so a row asserting
  it would fail on arrival. `AC-AI-27-05` to `-08` assert what the grader must
  preserve; the derivation itself is specified here and delivered during
  implementation.
- **`AI-27-R04` replaces a behaviour rather than adding one.** `gradeOf` clamps an
  out-of-ladder value to STANDARD today, so the refusal names a value the current
  code silently accepts. The invariant row asserts the weaker true property that
  the committed declarations are all ladder members, which holds today and must
  hold after; the refusal itself is not asserted by a positive row.
- **The replacement of the provisional grades is not measured.** `seed-accounts.js`
  declares grades its own header calls unmeasured. This Work Item specifies that
  each becomes measured or explicitly ungraded; it does not count how many are
  which, because the count is the outcome and pinning it would be the drift this
  repository removed from its matrices.
- **`AC-AI-27-09` proves operational failure, not correctness.** It shows the four
  negative proofs refuse to answer outside the repository. It cannot show that any
  of them would catch a defect the rule was not written for.

## Contradictions found in neighbouring specifications

1. **`TASK-AI-26.md` `AI-26-R01` says a limit with no source is "rejected at
   registry load"; `limits.resolveLimits` only rejects an entry that is an object
   carrying `value` without a recognised `provenance`.** A limit declared as a
   bare number is not rejected and not reported — it is silently treated as no
   declaration at all, and the window stays unknown. Measured at HEAD:
   `resolveLimits({ id: 'a', limits: { tokensPerDay: 1000 } }, { skipLedger: true })`
   returns `rejected: []` and `windows.tokensPerDay.unknownBudget === true`. The
   tested shape is `{ value: 500 }` with no `provenance`, which is rejected with
   the account and window named. The rule's wording and its implementation differ
   for the bare-number case, and the difference is invisible because both end with
   the window unknown. `TASK-AI-26` is merged and this Work Item does not edit it;
   the finding is recorded here so the next Work Item touching
   `limits.js` resolves it deliberately rather than inheriting it.

2. **`TASK-AI-27`'s register row names a dependency that is merged, while the row
   still reads `BLOCKED_DEPENDENCY`.** Same class of staleness `TASK-AI-08.md`
   and `TASK-AI-20.md` both document for their own rows: register row 159
   (`TASK-AI-26`) reads `BACKLOG` although `TASK-AI-26` is merged at
   `3ccf49b7fed6127a54676fef23980e50f4d6bca1`. The block is stale rather than
   true, and `AC-AI-27-03` proves the dependency from Git instead of asserting the
   register status, which would fail while the reconciler correctly refuses to
   write `MERGED`.
