# TASK-AI-46 — Model capability table with sourced evidence, and quota-aware rotation that uses it

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-46` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` (repair of round-5 `CHANGES_REQUIRED` complete; see § Codex review record) |
| Delivery order | `178` |
| Dependencies | `TASK-AI-27; TASK-AI-41` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-46.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/benchmarks.json`, `tools/ai-brain/benchmarks.js`, `tools/ai-brain/fitness.js`, `tools/ai-brain/offerings.js`, `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/acceptance/ac-46-*.js`, `tools/ai-brain/test/benchmarks.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-46-evidence-join` (successor of the closed chain #106 → #107 → #114) |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/116 |
| Delivery register row | `FEATURE-DELIVERY-REGISTER.csv` line 180 (`delivery_order` 178) |
| Original author | `GEMINI` |
| Repair author | `CLAUDE` — review repair, rounds 2–5 (AGENTS.md § Role separation) |

## Business outcome

Picking models based on generic heuristics, unverified claims, or price conflation
risks routing tasks either to under-capable models that fail halfway or wasting scarce
frontier quota on trivial work. Furthermore, when a model quota is exhausted, blind
retries that hit the same account or rate-limited provider waste tokens and cause pipeline
stalls.

This Work Item establishes an authoritative capability table backed by sourced evidence,
with quota-aware rotation:

1. **Sourced external evidence table**: `tools/ai-brain/benchmarks.json` holds external
   benchmark evaluations. Each record uniquely represents a `(model id, model version, benchmark, benchmark version)`
   tuple, tracking: `score`, `score_scale` (the scale the score is written on), `harness`/agent used,
   `reasoning_setting`, `source_url`, `checked_on` date and `verified` (whether the named source
   was actually resolved). Only a record carrying `verified: true` is evidence; `score` and
   `score_scale` together decide the grade, and a record never carries its own grade.
   Scores are never averaged across different benchmarks. An unrecorded model evaluates to `UNKNOWN`,
   never defaulting to "weak".
2. **Three-layer evidence precedence**: Resolution follows a strict precedence:
   `productionResults` (measured from real runs) > `localEvaluation` (smoke or promptfoo run on this host) > `externalEvidence` (`benchmarks.json`).
   `tools/ai-brain/fitness.js` exposes both the resolved grade and its layer provenance, allowing
   callers to distinguish measurement from inference. The fallback rule in `reviewGradeOf`
   (review grade defaults one class below coding grade) is explicitly marked as `INFERRED`
   and is overridden by any real review evidence.
3. **Access dimension separated from capability**: `tools/ai-brain/offerings.js` carries
   an independent `access` dimension (`free`, `included-in-paid-plan`, `pay-per-call`).
   A strong model reached through a free source retains its high capability and is never ranked as weak.
   Selection order: role and difficulty -> capable candidates -> sources with headroom and no cooldown ->
   cheapest access first (`free` < `included-in-paid-plan` < `pay-per-call`).
   On quota refusal, the scheduler re-selects inside the capable set and skips every source
   sharing the exhausted quota.
4. **Staleness and completeness audit**: An audit reports benchmark records older than 90 days
   or whose model version no longer matches an offering as warnings (`BENCHMARK_STALE_RECORD`,
   `BENCHMARK_VERSION_MISMATCH`, `BENCHMARK_UNVERIFIED_SOURCE`). A record missing `source_url` or
   `checked_on`, a record whose `verified` flag is absent or not a boolean
   (`BENCHMARK_MISSING_VERIFIED_FLAG`), a record that does not declare a usable `score_scale`
   (`BENCHMARK_MISSING_SCORE_SCALE`, `BENCHMARK_UNKNOWN_SCORE_SCALE`), a score outside its declared
   scale (`BENCHMARK_INVALID_SCORE`), a record carrying its own grade
   (`BENCHMARK_SELF_DECLARED_GRADE`) or a repeated evidence key
   (`BENCHMARK_DUPLICATE_KEY`) is flagged as a blocking error.

## Source references

- `AGENTS.md` § Source of truth — Existing code is evidence, not authority; capability claims must reflect actual evidence.
- `AGENTS.md` § Role separation — Implementation author never reviews or approves own work.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` row 178 — `TASK-AI-46` registration.
- `docs/product-spec/work-items/TASK-AI-27.md` — Model coding difficulty grading baseline.
- `docs/product-spec/work-items/TASK-AI-41.md` — Separate review grading and fallback baseline.
- `tools/ai-brain/benchmarks.json` — Authoritative external benchmark evidence table.
- `tools/ai-brain/benchmarks.js` — Benchmark evidence loading, evaluation, and staleness audit.
- `tools/ai-brain/fitness.js` — Multi-layer precedence resolution and provenance reporting.
- `tools/ai-brain/offerings.js` — Access dimension separation and quota-aware rotation.

## Preconditions and dependencies

- `TASK-AI-27` (coding grade ladder) is merged into `origin/main` (commit `df31675`).
- `TASK-AI-41` (review grade separation) is merged into `origin/main` (commit `0496acf`).
- Delivery register records `TASK-AI-46` as `BACKLOG` with dependencies `TASK-AI-27; TASK-AI-41`.
- Node.js test runner and Python 3 available in environment.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded to the allowed paths:
- `docs/product-spec/work-items/TASK-AI-46.md`
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `tools/ai-brain/benchmarks.json`
- `tools/ai-brain/benchmarks.js`
- `tools/ai-brain/fitness.js`
- `tools/ai-brain/offerings.js`
- `tools/ai-brain/seed-accounts.js`
- `tools/ai-brain/acceptance/ac-46-*.js`
- `tools/ai-brain/test/benchmarks.test.js`

Prohibited in this Work Item:
- Modifying repository validator scripts outside allowed paths.
- Merging, approving, or reviewing own Pull Request.
- Averaging benchmark scores across different benchmarks.
- Defaulting unrecorded models to "weak" or MECHANICAL.

## In scope

- Author Work Item specification `docs/product-spec/work-items/TASK-AI-46.md`.
- Add delivery register row 178 with status `BACKLOG` and dependencies `TASK-AI-27; TASK-AI-41`.
- Create `tools/ai-brain/benchmarks.json` with sourced external evidence records. **Re-scoped by
  review #116 B2**: this Work Item delivers the record schema, the sourcing contract and the
  fail-closed gates. It does **not** deliver a record that is safe to mark `verified: true`, because
  no public source resolves the synthetic model ids this prototype ships (see
  § Delivery decision required from the planner). Flipping any record to verified is deferred to
  follow-up item `TASK-AI-46B`.
- Create `tools/ai-brain/benchmarks.js` with benchmark parsing, scale-declared grade mapping, and staleness/completeness auditing.
- Update `tools/ai-brain/fitness.js` with 3-layer precedence (`productionResults` > `localEvaluation` > `externalEvidence`), layer provenance reporting, and inferred review grade override.
- Update `tools/ai-brain/offerings.js` with `access` dimension and quota-aware selection rotation skipping shared quota sources.
- Update `tools/ai-brain/seed-accounts.js` to declare access tiers and model versions.
- Provide comprehensive acceptance tests `tools/ai-brain/acceptance/ac-46-*.js` each with a CONTROL negative step.
- Provide unit tests `tools/ai-brain/test/benchmarks.test.js`.

## Out of scope

- Direct host modifications or API secret issuance.
- Altering the 4-level difficulty ladder (MECHANICAL, STANDARD, COMPLEX, ARCHITECTURAL).
- Altering CI workflow definitions under `.github/workflows/`.
- Wiring `selectOffering`, `isCapable` or `auditBenchmarks` into `tools/ai-brain/scheduler.js`,
  `package.json` or CI. All three are outside the Allowed paths; see
  § Delivery decision required from the planner, follow-up item `TASK-AI-46B`.

## Delivery decision required from the planner

Review #116 finding **B2** records that this Work Item changes no runtime behaviour yet, and finding
**B5** that the reviewed chain had no path to `main`. Both are answered here as far as an author is
allowed to answer them. Per AGENTS.md § Role separation the decision itself belongs to the planner
(`Codex`) and the human product owner; this section states the options and the author's action, it
does not substitute for that decision.

### The delivery gap (B2)

- The capability table fails closed: all 7 records carry `verified: false`, so
  `findBenchmarkEvidence` returns `null` for every model and no offering is graded from external
  evidence. This is the intended interim state, not a delivered capability.
- Real sources cannot be attached in this Work Item. Every `model_id` in the table
  (`claude-opus-4-6-thinking`, `cc/claude-opus-5`, `gemini-3.1-pro-high`, …) is a synthetic
  identifier invented by this prototype, and the `swe-bench/SWE-bench` `docs/results/` paths were
  confirmed 404 in round 3. Writing a plausible URL against a model that does not exist publicly
  would be fabricated evidence, which AGENTS.md § Definition of a complete feature forbids.
- `selectOffering` and `auditBenchmarks` have no production caller: they are reached only from
  `acceptance/ac-46-*.js` and `test/benchmarks.test.js`. `scheduler.js` reads `gradeRecord` as
  metadata only, and the audit is not wired to `package.json` or CI.

### Options put to the planner

1. **Real sources.** Replace the synthetic `model_id` values with the models actually configured in
   `seed-accounts.js`, then attach a resolvable source to each record and mark it verified. Requires
   product selection of the evidence source and a live resolution step.
2. **Re-scope plus follow-up item** *(recorded here as the author's action; awaiting planner
   acceptance)*. This Work Item closes as the evidence **contract and gates** only. A follow-up
   Work Item `TASK-AI-46B — Capability evidence reaches production` owns:
   - (a) real resolvable sources per record, one verified record minimum, before anything grades;
   - (b) wiring `selectOffering` and `isCapable` into `tools/ai-brain/scheduler.js` so the declared
     grade stops being the ranking input;
   - (c) calling `node tools/ai-brain/benchmarks.js audit` from `package.json` and the CI
     `current-application` job so a damaged or unmappable table blocks a merge (review #116 N4).
   Options (b) and (c) need `scheduler.js`, `package.json` and `.github/workflows/` added to the
   Allowed paths, which is a scope extension only the planner may grant.

### The landing path (B5)

No PR in the #106 → #107 → #114 → #116 chain targeted `main`, because #106 and #107 were closed and
#114 and #116 stack on integration branches. Fixed without inventing a new PR: PR #116 itself was
re-targeted with `PATCH repos/<owner>/<repo>/pulls/116` to `base = main`, and `git merge-tree
--write-tree origin/main HEAD` confirms `main` merges into this head with no conflict, so the
terminal PR for `TASK-AI-46` now carries all four commits and can reach `main`.

### Hard gate while the gap is open

No record in `benchmarks.json` may be set to `verified: true` until its `source_url` has been
resolved and read. Any commit that flips a record without naming the resolution evidence in the PR
body must be rejected, because from that moment the latent mis-grading in review #116 B4 becomes
live runtime behaviour.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-46-R01` | External benchmark evidence is stored in `tools/ai-brain/benchmarks.json`. One record per `(model id, model version, benchmark, benchmark version)`. Scores from different benchmarks are never averaged together. |
| `AI-46-R02` | An unrecorded model evaluates to `UNKNOWN`, never "weak" (MECHANICAL). When evaluating capability for a task difficulty, `UNKNOWN` cannot be assumed capable. |
| `AI-46-R03` | Fixed evidence layer precedence: `productionResults` (measured from real runs) > `localEvaluation` (smoke / promptfoo run) > `externalEvidence` (`benchmarks.json`) > `declared` > `inferred`. |
| `AI-46-R04` | Capability resolution (`resolveCapability`) exposes the resolved grade along with its layer provenance (`productionResults`, `localEvaluation`, `externalEvidence`, `declared`, or `inferred`), allowing callers to distinguish measurement from inference. |
| `AI-46-R05` | The default review grade rule in `reviewGradeOf` (one class below coding grade) is explicitly marked as `INFERRED` (`layer: 'inferred'`, `inferred: true`) and is overridden by any real review evidence in `productionResults`, `localEvaluation`, or `externalEvidence`. |
| `AI-46-R06` | Offerings in `tools/ai-brain/offerings.js` carry an independent `access` dimension (`free`, `included-in-paid-plan`, `pay-per-call`). A strong model reached via a free source maintains its high capability and is never ranked as weak. |
| `AI-46-R07` | Selection order: role & difficulty -> capable candidates -> headroom & no cooldown -> cheapest access first (`free` < `included-in-paid-plan` < `pay-per-call`). On quota refusal, re-selection occurs inside the capable set and skips every source sharing the exhausted quota. |
| `AI-46-R08` | Benchmark staleness audit: records older than 90 days or whose model version no longer matches an offering emit warnings (`BENCHMARK_STALE_RECORD`, `BENCHMARK_VERSION_MISMATCH`). Records missing `source_url` or `checked_on` emit blocking errors (`BENCHMARK_MISSING_SOURCE_URL`, `BENCHMARK_MISSING_CHECKED_ON`). |
| `AI-46-R09` | The verified flag is opt-in, never opt-out. A record is evidence only when `verified === true`. A record that omits the flag, carries `false`, or carries a non-boolean grades nothing; omitting it or making it non-boolean is a blocking error (`BENCHMARK_MISSING_VERIFIED_FLAG`), and `verified: false` is a warning (`BENCHMARK_UNVERIFIED_SOURCE`). Grading cannot be re-enabled by forgetting one field. |
| `AI-46-R10` | Every record declares the scale its `score` is written on: `score_scale: fraction` (0–1) or `score_scale: percent` (0–100). The grade is resolved by putting the score on the percentage ladder the mapping is defined on. A score that cannot be mapped — no declared scale on an ambiguous value, an unknown scale label, or a value outside its declared scale — grades nothing and is a blocking error (`BENCHMARK_MISSING_SCORE_SCALE`, `BENCHMARK_UNKNOWN_SCORE_SCALE`, `BENCHMARK_INVALID_SCORE`). An unmappable score never falls back to MECHANICAL, which `AI-46-R02` forbids. Measured evidence from `productionResults`/`localEvaluation` is not a table record and may omit the scale; a value of 1 or below is then refused rather than guessed. |
| `AI-46-R11` | A record does not carry its own grade. The grade comes from the sourced score through the benchmark mapping; a `grade` or `codingGrade` field on a table record is ignored by the join and is a blocking error (`BENCHMARK_SELF_DECLARED_GRADE`). |
| `AI-46-R12` | Where a model has several verified records, the grade is the strongest **single** record (best-of), never an average and never a blend of several benchmarks. `AI-46-R01` forbids averaging; this rule names the max-selection that the same evidence cannot settle on its own, so a wide spread across benchmarks is reported through the record the grade was taken from. |

## UI states

Operator console states for benchmark audit and quota-aware selection:
- **AUDIT PASS**: `Benchmark audit: VALIDATED (N records, 0 errors, M warnings)` (exit 0).
- **AUDIT FAIL**: `Benchmark audit: FAILED (N errors: BENCHMARK_MISSING_SOURCE_URL: <model-id>)` (exit 1).
- **ROTATION PASS**: `Selected offering <offering-id> (access: <tier>, skipped N sharing exhausted quota)`.
  Emitted by `formatSelectionResult(selection)` in `tools/ai-brain/offerings.js` and carried on the
  selection as `selection.message`, so a caller cannot print a selection without the line. The line
  carries the access dimension and never a capability grade (`AI-46-R06`).
- **ROTATION REFUSED**: `No offering selected` followed by the refusal reason. A refusal is kept
  distinct from a rotation: a rotation means the ladder moved, a refusal means the capable set was
  emptied, so the task is deferred rather than silently downgraded.
- **DECLINED OFFERINGS**: `Rotated from N offerings that declined this task:` followed by
  `- <offering-id> (<model>): <refusal reason>` per skipped offering, so the operator sees that a
  strong account was skipped rather than being shown only a successful selection.
- **GRADE PROVENANCE**: when a selection was graded by verified external evidence, the console adds
  `Graded from <benchmark> <version> = <percent>% (<source-url>), not from a self-declared grade`.
  A grade from any other layer prints no evidence line, and a rejected grade reads
  `No benchmark evidence: <error>`.

## API, event and data impact

- `tools/ai-brain/benchmarks.json`: New JSON data file storing external benchmark evidence records.
- `tools/ai-brain/fitness.js`: Exports `EVIDENCE_LAYER`, `resolveCapability`, `isCapable`, and supports layer provenance on resolved grades. Exports `formatGradeReason(gradeRecord)` for the operator-visible proof behind a grade.
- `tools/ai-brain/offerings.js`: Exports `ACCESS_TYPE`, `ACCESS_RANK`, `selectOffering`, and populates `access` on offering objects. `selectOffering` returns `gradeRecord` and `message` alongside the selection, and exports `formatSelectionResult(selection)`.
- `tools/ai-brain/benchmarks.js`: Exports `SCORE_SCALE`, `normalizeBenchmarkScore(score, scale)` and `formatAuditResult(result)` in addition to the loader, join and audit.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-46-01` | Fixed evidence layer precedence: productionResults > localEvaluation > externalEvidence | `node tools/ai-brain/acceptance/ac-46-01-precedence.js` exits 0 and prints `PRECEDENCE_VERIFIED: productionResults > localEvaluation > externalEvidence` | command stdout, including `CONTROL:` line showing inverted precedence rejected |
| `AC-AI-46-02` | UNKNOWN propagation: unrecorded model evaluates to UNKNOWN, never weak | `node tools/ai-brain/acceptance/ac-46-02-unknown-propagation.js` exits 0 and prints `UNKNOWN_PROPAGATION_VERIFIED: unrecorded models resolve to UNKNOWN, never weak` | command stdout, including `CONTROL:` line showing false weak classification rejected |
| `AC-AI-46-03` | Inferred review grade marked INFERRED and overridden by real review evidence | `node tools/ai-brain/acceptance/ac-46-03-inferred-review-override.js` exits 0 and prints `INFERRED_REVIEW_OVERRIDE_VERIFIED: inferred review grade marked INFERRED and overridden by real review evidence` | command stdout, including `CONTROL:` line showing stubborn inferred rule rejected |
| `AC-AI-46-04` | Access dimension separated from capability, cheapest access first | `node tools/ai-brain/acceptance/ac-46-04-access-separated-from-capability.js` exits 0 and prints `ACCESS_SEPARATED_FROM_CAPABILITY_VERIFIED: access dimension independent of capability, cheapest access selected first` | command stdout, including `CONTROL:` line showing access-capability conflation rejected |
| `AC-AI-46-05` | Quota-aware rotation: on quota refusal, skip all sources sharing exhausted quota | `node tools/ai-brain/acceptance/ac-46-05-quota-rotation.js` exits 0 and prints `QUOTA_ROTATION_VERIFIED: on quota refusal, rotation re-selects inside capable set and skips all sources sharing exhausted quota` | command stdout, including `CONTROL:` line showing shared quota retry rejected |
| `AC-AI-46-06` | Benchmark staleness and completeness audit flags staleness as warning and missing fields as error | `node tools/ai-brain/acceptance/ac-46-06-staleness-audit.js` exits 0 and prints `STALENESS_AUDIT_VERIFIED: benchmark staleness and model version mismatch are warnings; missing source URL or checked_on are errors` | command stdout, including `CONTROL:` line showing missing source_url rejected with error |

## Acceptance matrix audit (defects found and repaired)

All acceptance scripts were executed and measured against real repository files. Every check implements an explicit CONTROL negative step confirming that buggy or tampered behavior is caught and refused.

| Row | Expected exit | Actual exit | Expected string found | Output status |
|---|---|---|---|---|
| `AC-AI-46-01` | 0 | 0 | yes | `CONTROL: inverted precedence rejected ... PRECEDENCE_VERIFIED: productionResults > localEvaluation > externalEvidence` |
| `AC-AI-46-02` | 0 | 0 | yes | `CONTROL: detected and rejected false "weak" classification ... UNKNOWN_PROPAGATION_VERIFIED: unrecorded models resolve to UNKNOWN, never weak` |
| `AC-AI-46-03` | 0 | 0 | yes | `CONTROL: stubborn inferred rule ignoring real review evidence detected ... INFERRED_REVIEW_OVERRIDE_VERIFIED: inferred review grade marked INFERRED and overridden by real review evidence` |
| `AC-AI-46-04` | 0 | 0 | yes | `CONTROL: detected conflation of access and capability ... ACCESS_SEPARATED_FROM_CAPABILITY_VERIFIED: access dimension independent of capability, cheapest access selected first` |
| `AC-AI-46-05` | 0 | 0 | yes | `CONTROL: detected failure to skip shared quota ... QUOTA_ROTATION_VERIFIED: on quota refusal, rotation re-selects inside capable set and skips all sources sharing exhausted quota` + `OPERATOR_STATE_VERIFIED: rotation names the declined offerings (- acc-alpha::model-1 (model-1): quota exhausted) and a refusal reads as a refusal (No offering selected)` |
| `AC-AI-46-06` | 0 | 0 | yes | `CONTROL: audit caught missing source_url as error ... EVIDENCE: all 9 audited rules reported their own error code ... EVIDENCE: shipped table 7 records, 0 errors, 7 warnings, 0 records grade ... STALENESS_AUDIT_VERIFIED: benchmark staleness and model version mismatch are warnings; missing source URL or checked_on are errors` |

## Verification commands

```powershell
node tools/ai-brain/acceptance/ac-46-01-precedence.js
# Expected: Exit code 0, PRECEDENCE_VERIFIED

node tools/ai-brain/acceptance/ac-46-02-unknown-propagation.js
# Expected: Exit code 0, UNKNOWN_PROPAGATION_VERIFIED

node tools/ai-brain/acceptance/ac-46-03-inferred-review-override.js
# Expected: Exit code 0, INFERRED_REVIEW_OVERRIDE_VERIFIED

node tools/ai-brain/acceptance/ac-46-04-access-separated-from-capability.js
# Expected: Exit code 0, ACCESS_SEPARATED_FROM_CAPABILITY_VERIFIED

node tools/ai-brain/acceptance/ac-46-05-quota-rotation.js
# Expected: Exit code 0, QUOTA_ROTATION_VERIFIED

node tools/ai-brain/acceptance/ac-46-06-staleness-audit.js
# Expected: Exit code 0, STALENESS_AUDIT_VERIFIED

node --test tools/ai-brain/test/*.test.js
# Expected: Exit code 0, all tests pass (522 passed, 0 failed at the round-5 repair head; the
# round-4 figure of 497 was overtaken by the B3/B4/N2 probes added in this repair)

python docs/product-spec/scripts/validate_docs.py
# Expected: Exit code 0, documentation validation passes

node tools/ai-brain/benchmarks.js audit
# Expected: Exit code 0, `Benchmark audit: VALIDATED (7 records, 0 errors, 7 warnings)`

pnpm format:check
# Expected: Exit code 0 — this is the CI `current-application` step that failed at 557a767.
# `npx prettier --check tools/ai-brain` cannot be used as local evidence on this machine: git checks
# the tree out with CRLF while Prettier's default endOfLine is "lf", so it flags every file.
# scripts/verify-formatting.ts is the gate and it checks with endOfLine: 'auto'.
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `HEAD` | `READY_FOR_CODEX` | Initial implementation of TASK-AI-46: external benchmark evidence, 3-layer precedence, UNKNOWN propagation, inferred review override, access dimension separation, and quota-aware rotation. |
| 2 | `c5ad4a5` | `CHANGES_REQUIRED` | B1: the 11 `tools/ai-brain` files failing `pnpm format:check` were reformatted with Prettier 3.9.6 (whitespace and line wrapping only, no behavior change). B2: PR evidence now lists only the commands actually run, with their exact results. |
| 3 (repair) | `c5ad4a5` | `CHANGES_REQUIRED` | B3: `docs/results/` does not exist in `swe-bench/SWE-bench` (404), so all 7 `benchmarks.json` records are marked `verified: false`; an unverified record grades nothing and the audit reports `BENCHMARK_UNVERIFIED_SOURCE` (warn). M1: `selectOffering` refuses an offering with no headroom record. M2: a repeated `(model_id, model_version, benchmark, benchmark_version)` key is audit error `BENCHMARK_DUPLICATE_KEY`. B4 (no production caller of `selectOffering`) is open: `scheduler.js` is outside Allowed paths. |
| 4 (repair) | `c5ad4a5` | `CHANGES_REQUIRED` | Review of 2026-09-19T05:09Z. F3: `expandOfferings` resolves each grade by `model` and `modelVersion`, not the offering id, and reads the table once per expansion. F6: `loadBenchmarks` throws `BENCHMARKS_UNREADABLE` on a missing, corrupt or non-array table, and `resolveGrade` no longer swallows it. F7 (partial): `node tools/ai-brain/benchmarks.js audit` prints the specified `Benchmark audit: VALIDATED/FAILED` line, checks versions against the seed offerings, and exits 1 on any error. `summary.pass` counts records with no findings. Still open: the audit is not called from `package.json` or CI, and `selectOffering` (F4/B4) is not wired in, because both files are outside Allowed paths. |
| 5 (repair) | `557a767` | `CHANGES_REQUIRED` → repaired in this head | Review of 2026-09-19T06:03:01Z over `557a767`. **B1**: `pnpm format:check` failed at that head on `tools/ai-brain/offerings.js` and `tools/ai-brain/test/benchmarks.test.js`, aborting `typecheck`/`test`/`test:e2e`/`test:baseline`/`build`/`security:secrets`; both files are Prettier-clean now and the gate is recorded in the PR body. **B2**: the delivery gap is written up in § Delivery decision required from the planner with the two options and follow-up item `TASK-AI-46B`; Control table and register row 180 updated from `BACKLOG`/PR #106 to `READY_FOR_CODEX`/PR #116. **B3**: the gate is opt-in — `verified !== true` grades nothing and a missing or non-boolean flag is audit error `BENCHMARK_MISSING_VERIFIED_FLAG`. **B4**: every record declares `score_scale` (`fraction` 0–1, `percent` 0–100) and an unmappable score is an error (`BENCHMARK_MISSING_SCORE_SCALE`, `BENCHMARK_UNKNOWN_SCORE_SCALE`, `BENCHMARK_INVALID_SCORE`) instead of a ladder guess; the self-declared-grade escape hatch is removed (`BENCHMARK_SELF_DECLARED_GRADE`) and best-of selection is now a documented rule (`AI-46-R12`). **B5**: PR #116 re-targeted onto `main`. **N1**: § 1 and § 4 document `verified`, `score_scale`, `grade` and the six new audit codes. **N2**: the specified `Selected offering …` console state is emitted by `formatSelectionResult` and asserted by `ac-46-05`. **N3**: expected test count corrected to 522. **N4**: still open by boundary, and assigned to `TASK-AI-46B` (c). |

## Known limitations

- Every record in `benchmarks.json` is `verified: false`, so the table grades nothing yet and this
  Work Item changes no runtime selection behaviour. That is the fail-closed interim state recorded
  in § Delivery decision required from the planner, not a claim of completion.
- `selectOffering`, `isCapable` and `auditBenchmarks` have no production caller, and the audit does
  not block a merge, because `scheduler.js`, `package.json` and `.github/workflows/` are outside the
  Allowed paths. Deferred to `TASK-AI-46B` (b) and (c).
- The grade for a model with several verified records is the strongest single record (`AI-46-R12`);
  a model that scores high on one benchmark and low on another is therefore reported at its best
  measured class, with the record it was measured on named in the console line.
- Evidence for the operator console states is the acceptance scripts and unit tests, not screenshots:
  these are CLI/console lines in `tools/ai-brain`, and the Work Item touches no web screen.
