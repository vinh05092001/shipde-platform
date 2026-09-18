# TASK-AI-46 — Model capability table with sourced evidence, and quota-aware rotation that uses it

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-46` |
| Feature ID | `N/A` |
| Status | `BACKLOG` |
| Delivery order | `178` |
| Dependencies | `TASK-AI-27; TASK-AI-41` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-46.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/benchmarks.json`, `tools/ai-brain/benchmarks.js`, `tools/ai-brain/fitness.js`, `tools/ai-brain/offerings.js`, `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/acceptance/ac-46-*.js`, `tools/ai-brain/test/benchmarks.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-46-capability-table-104730` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/106 |

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
   tuple, tracking: `score`, `harness`/agent used, `reasoning_setting`, `source_url`, and `checked_on` date.
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
   `BENCHMARK_VERSION_MISMATCH`). A record missing `source_url` or `checked_on` is flagged as a
   blocking error (`BENCHMARK_MISSING_SOURCE_URL`, `BENCHMARK_MISSING_CHECKED_ON`).

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
- Create `tools/ai-brain/benchmarks.json` with sourced external evidence records.
- Create `tools/ai-brain/benchmarks.js` with benchmark parsing, grade mapping, and staleness auditing.
- Update `tools/ai-brain/fitness.js` with 3-layer precedence (`productionResults` > `localEvaluation` > `externalEvidence`), layer provenance reporting, and inferred review grade override.
- Update `tools/ai-brain/offerings.js` with `access` dimension and quota-aware selection rotation skipping shared quota sources.
- Update `tools/ai-brain/seed-accounts.js` to declare access tiers and model versions.
- Provide comprehensive acceptance tests `tools/ai-brain/acceptance/ac-46-*.js` each with a CONTROL negative step.
- Provide unit tests `tools/ai-brain/test/benchmarks.test.js`.

## Out of scope

- Direct host modifications or API secret issuance.
- Altering the 4-level difficulty ladder (MECHANICAL, STANDARD, COMPLEX, ARCHITECTURAL).
- Altering CI workflow definitions under `.github/workflows/`.

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

## UI states

Operator console states for benchmark audit and quota-aware selection:
- **AUDIT PASS**: `Benchmark audit: VALIDATED (N records, 0 errors, M warnings)` (exit 0).
- **AUDIT FAIL**: `Benchmark audit: FAILED (N errors: BENCHMARK_MISSING_SOURCE_URL: <model-id>)` (exit 1).
- **ROTATION PASS**: `Selected offering <offering-id> (access: <tier>, skipped N sharing exhausted quota)`.

## API, event and data impact

- `tools/ai-brain/benchmarks.json`: New JSON data file storing external benchmark evidence records.
- `tools/ai-brain/fitness.js`: Exports `EVIDENCE_LAYER`, `resolveCapability`, `isCapable`, and supports layer provenance on resolved grades.
- `tools/ai-brain/offerings.js`: Exports `ACCESS_TYPE`, `ACCESS_RANK`, `selectOffering`, and populates `access` on offering objects.

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
| `AC-AI-46-05` | 0 | 0 | yes | `CONTROL: detected failure to skip shared quota ... QUOTA_ROTATION_VERIFIED: on quota refusal, rotation re-selects inside capable set and skips all sources sharing exhausted quota` |
| `AC-AI-46-06` | 0 | 0 | yes | `CONTROL: audit caught missing source_url as error ... STALENESS_AUDIT_VERIFIED: benchmark staleness and model version mismatch are warnings; missing source URL or checked_on are errors` |

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
# Expected: Exit code 0, all tests pass (497 passed, 0 failed)

python docs/product-spec/scripts/validate_docs.py
# Expected: Exit code 0, documentation validation passes
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `HEAD` | `READY_FOR_CODEX` | Initial implementation of TASK-AI-46: external benchmark evidence, 3-layer precedence, UNKNOWN propagation, inferred review override, access dimension separation, and quota-aware rotation. |
