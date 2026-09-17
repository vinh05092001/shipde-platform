# TASK-AI-23 — Retrieval restricted to APPROVED lessons

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-23` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `156` |
| Dependencies | `TASK-AI-22` (register row 155, `delivery_order` 155, `work_item_id` `TASK-AI-22`) |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-23.md`, `tools/ai-brain/retrieval/**`, `tools/ai-brain/acceptance/ac-23-*.js`, `tools/ai-brain/acceptance/lib/lesson-retrieval.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-23` |
| Pull Request | `Pending` |

**Row numbering.** "Row 156" is the register's own `delivery_order` column, the convention `TASK-AI-07` (row 140) and `TASK-AI-08` (row 141) already use. The same record is physical CSV line 158. Every row number in this file also names the record's `work_item_id` so the two conventions cannot be confused.

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 156, `work_item_id` `TASK-AI-23`) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block, so it has not reached `BACKLOG`. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 156, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`; doing so would route the item past gates for which no transition evidence exists. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency chain is not yet delivered in Git reality: the prerequisite `TASK-AI-22` (promotion gate) has no Work Item file in `docs/product-spec/work-items/` on this checkout, and its register row 155 records `BLOCKED_DEPENDENCY` behind `TASK-AI-21`. `AC-AI-23-09` proves this from the repository and the register rather than asserting delivery.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler before this item is stage-eligible for review routing.

## Business outcome

`AI-TOOL-06` states the policy that governs the brain: "Hermes memory and self-created skills are untrusted until human-reviewed into shipde-brain; no PII or credential persistence." `TASK-AI-21` defines what a reviewed record is — the lesson schema at `tools/ai-brain/lessons/lesson-schema.json`, whose `status` distinguishes `proposed`, `approved`, `superseded` and `rejected` — and its conformance seed at `tools/ai-brain/lessons/lesson-seed.json` exercises every one of those statuses. The seed's own untrusted record proves the gap: `LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED` carries `status: proposed` today, and nothing in this checkout stops a reader from loading it into a prompt.

The register's key behaviour for this Work Item is the retrieval answer: *only reviewed knowledge reaches a prompt; proposals stay out of retrieval*. Three consequences, each a defect class rather than a nicety:

1. **The retrieval rule has no artifact anywhere in the repository.** No retrieval filter, no admissible-status gate and no check exists — a search for `retriev` under `tools/ai-brain/*.js` matches only unrelated reconciliation comments — so the register sentence cannot be tested and a later implementation would define "reviewed" from scratch.
2. **An unfiltered read leaks the untrusted.** The seed carries approved, superseded and proposed records side by side. A reader that loads the file without filtering by `status` serves the proposed record with the same authority as the approved ones, defeating the `AI-TOOL-06` trust boundary `TASK-AI-22` enforces at write time.
3. **Stale knowledge looks identical to live knowledge.** An expired lesson and a superseded lesson are both retained for provenance by the `TASK-AI-21` schema, but neither is current. A reader that admits them without checking `expiry` and `superseded_by` re-applies knowledge a human already replaced or time-bounded.

`TASK-AI-23` therefore delivers the canonical retrieval gate — the shared rule admitting exactly the lessons whose `status` is `approved`, neither expired nor superseded — plus the acceptance rows that keep it true, and nothing else.

## Source references

- `AGENTS.md` § Source of truth — specifications govern, existing code is implementation evidence.
- `AGENTS.md` § Role separation — author never approves own work; author and reviewer are separate tasks.
- `AGENTS.md` § Unit of delivery — required status flow through `READY_FOR_CODEX`.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-TOOL-06 — Hermes memory and self-created skills are untrusted until human-reviewed into shipde-brain; no PII or credential persistence.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-TOOL-11 — a supplied authoritative version, ref or path is fail closed; no fallback to `latest`, another branch or a broader path.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Governed Ecosystem Catalog § 1 Internal Repositories — `vinh05092001/shipde-brain`: agent brain, memory, prompts and knowledge base.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` § Research row — `shipde-brain` is a research source alongside one of DSH/Hermes and Repomix.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — row 156 (`delivery_order` 156, `work_item_id` `TASK-AI-23`); row 155 (`delivery_order` 155, `work_item_id` `TASK-AI-22`); row 154 (`delivery_order` 154, `work_item_id` `TASK-AI-21`).
- `docs/product-spec/work-items/TASK-AI-21.md` § Business rules — `AI-21-R01` through `AI-21-R05` (the approved-lesson shape this gate reads); § Out of scope — the promotion gate belongs to `TASK-AI-22`.
- `tools/ecosystem-manifest.json` — the `shipde-brain` workspace entry (canonical URL `https://github.com/vinh05092001/shipde-brain`, `permissions: read-only-contract`, health check `Test-Path ../shipde-brain`) and the `AI-TOOL-06` policy string.
- `tools/ai-brain/lessons/lesson-schema.json` — the canonical lesson schema: `status` enum (`proposed`, `approved`, `superseded`, `rejected`) and the `allOf`/`if`/`then` approved-lesson requirement.
- `tools/ai-brain/lessons/lesson-seed.json` — the conformance seed: approved, superseded and proposed records side by side, including proposed `LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED`.
- `tools/ai-brain/acceptance/lib/lesson-schema.js` — the shared schema rule (`matchesViolations`, `approvedRequirementViolations`, `seedLessons`) the retrieval gate reuses by reference.
- `tools/ai-brain/facts.js` — `runCheck` and repository-bound commit/file readers; no retrieval function exists in this module.
- `tools/ai-brain/cli.js` — operator commands `reconcile`, `manifest`, `prove`, `quota`; no retrieval command exists in this module.
- `scripts/ai/README.md` — the control-script surface (`control.ps1`, `ecosystem.ps1`, `doctor.ps1`); no script in `scripts/ai` reads lessons.
## Preconditions and dependencies

- Prerequisite `TASK-AI-22` is **not** delivered: its Work Item file is absent here and its register row 155 records `BLOCKED_DEPENDENCY` behind `TASK-AI-21`. `AC-AI-23-09` proves the block from the repo and the register.
- Register alignment: row 156 records `status: "BLOCKED_DEPENDENCY"`. The Control table records `BLOCKED_DEPENDENCY` exactly.
- The lesson contract this gate reads already exists: `tools/ai-brain/lessons/lesson-schema.json`, `tools/ai-brain/lessons/lesson-seed.json`, and `tools/ai-brain/acceptance/lib/lesson-schema.js` are committed here.
- No retrieval function exists yet: `cli.js` exposes `reconcile`, `manifest`, `prove`, `quota` only; `facts.js` exposes commit/file/command readers only. The gate is new code.
- No network and no live store are required: the rows read the real schema and seed from this repository.

## Author boundary

`GEMINI` is the assigned author. Scope is bounded to the retrieval gate, its shared rule module, its acceptance scripts, this spec, and the register row. `GEMINI` is required (not `9ROUTER`) because the gate interprets a trust boundary (`AI-TOOL-06`); a mis-scoped filter silently promotes untrusted memory into prompts.
Prohibited in this Work Item:

- Do NOT create, push or configure the `shipde-brain` GitHub repository; that is a human action outside Git.
- Do NOT add the promotion gate (`TASK-AI-22`); this gate reads `status`, it never writes it.
- Do NOT approve a lesson the author itself proposed (`AI-TOOL-06`).
- Do NOT record PII, credentials, tokens or production data in a lesson, the gate or fixtures (`AI-TOOL-06`).
- Do NOT restate the schema-subset validator; require `tools/ai-brain/acceptance/lib/lesson-schema.js` by reference.
- Do NOT add a retrieval network service, a prompt-injection path, or an admission scan (`TASK-AI-39`).
- Do NOT store lessons in the delivery register or the AO supervisor checkpoint (`TASK-AI-33`).
- Do NOT advance the status in `FEATURE-DELIVERY-REGISTER.csv` manually.

## In scope

1. **Canonical retrieval gate** (single file under `tools/ai-brain/retrieval/`): given a lesson set shaped like `tools/ai-brain/lessons/lesson-seed.json`, returns exactly the lessons admissible to a prompt — `status: approved`, not expired, not superseded — with a machine-readable reason per excluded lesson.
2. **Shared rule module** at `tools/ai-brain/acceptance/lib/lesson-retrieval.js`: the admissibility predicate in exactly one place, required by both each invariant row and its negative proof. It requires `lib/lesson-schema.js` by reference and states only the read-time conditions.
3. **Acceptance rows** at `tools/ai-brain/acceptance/ac-23-*.js`: the alignment pair, the retrieval invariant and negative proofs, the dependency-block proof, and the suite/audit/validation rows in the Acceptance matrix.
4. **Retrieval over the real seed**: admits the approved live records; excludes proposed `LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED`, superseded `LESSON-SINGLE-REPAIR-PER-HEAD`, and any expired record, each with its reason.
5. **Documented read-time contract**: the admissible shape, exclusion reasons, and promotion boundary in this Work Item and the gate's comments.

## Out of scope

- The promotion gate (`TASK-AI-22`).
- Creating the `shipde-brain` GitHub repository, branch protection or CI (human action).
- Admission scanning of lessons, skills and prompts (`TASK-AI-39`).
- Retiring or repinning manifest entries (`TASK-AI-40`).
- Checkpoint recovery (`TASK-AI-09`) and the Beads shadow (`TASK-AI-33`).
- Any product feature, UI, API, Prisma schema, migration, queue or carrier behavior.
- Fetching, cloning or mirroring any upstream repository.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-23-R01` | **Only approved lessons are retrievable**: a lesson reaches a prompt only when `status` is `approved`. `proposed` and `rejected` are never admissible, however well-formed. |
| `AI-23-R02` | **Superseded lessons stay out**: `status: superseded`, or an id named as another lesson's `superseded_by`, is retained for provenance and excluded from prompts. |
| `AI-23-R03` | **Expired lessons stay out**: `expiry` before the retrieval date is excluded even when approved. Explicit `null` means not time-bounded and stays admissible. |
| `AI-23-R04` | **Admissibility requires schema conformance**: a lesson failing `matchesViolations` against the real schema is excluded even when `status` reads `approved`. |
| `AI-23-R05` | **Every exclusion carries its reason**: one machine-readable reason per excluded lesson; a silent drop is itself a violation. |
| `AI-23-R06` | **The gate reads status, never writes it**: retrieval cannot promote, approve, supersede or reject. The write path belongs to `TASK-AI-22` (`AI-TOOL-06`). |
| `AI-23-R07` | **One shared module**: the predicate lives in `lib/lesson-retrieval.js`, required by both each invariant row and its negative proof. |
| `AI-23-R08` | **No PII and no credentials**: retrieved lessons, fixtures and logs carry none (`AI-TOOL-06`). |

## UI states

Not applicable; no user-facing screen. Operator output is the stdout of `tools/ai-brain/acceptance/ac-23-*.js`, and the read-time state per lesson: `admitted`; `excluded: unapproved`; `excluded: superseded`; `excluded: expired`; `excluded: nonconforming`.

## API, event and data impact

- New read-time contract, not a runtime API: the admissibility predicate over the lesson record `TASK-AI-21` defines. The store lives in `shipde-brain`; this repo holds the gate, schema and seed.
- `tools/ecosystem-manifest.json` is not modified; the `shipde-brain` surface stays asserted by `AC-AI-21-07`.
- No migration, no REST/event contract, no carrier integration, no register schema change.
- The gate stays inside the JSON Schema subset in `lib/lesson-schema.js`; no validator dependency is installed.

## Acceptance matrix

| AC/Test ID | Scenario | Exact command to run | Exit code | Expected output string | File / artifact |
|---|---|---|---|---|---|
| `AC-AI-23-01` | Control table status and register row 156 cannot diverge | `node tools/ai-brain/acceptance/ac-23-01-status-alignment.js` | `0` | `Control status matches register row 156: BLOCKED_DEPENDENCY (declared TASK-AI-23)` | `TASK-AI-23.md`, `FEATURE-DELIVERY-REGISTER.csv`, `ac-23-01-status-alignment.js`, `lib/spec-status-alignment.js` |
| `AC-AI-23-02` | **Negative proof, must fail:** tampered spec copy diverges and is detected | `node tools/ai-brain/acceptance/ac-23-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `ac-23-02-status-divergence.js`, `lib/spec-status-alignment.js`; stderr |
| `AC-AI-23-03` | Gate admits approved live seed lessons, excludes proposed/superseded/expired with reasons | `node tools/ai-brain/acceptance/ac-23-03-lesson-retrieval.js` | `0` | `LESSON_RETRIEVAL_HOLDS: only approved live lessons are retrievable` | `lesson-schema.json`, `lesson-seed.json`, `ac-23-03-lesson-retrieval.js`, `lib/lesson-retrieval.js` |
| `AC-AI-23-04` | **Negative proof, must fail:** seed copy with proposed record flipped to approved leaks and is refused | `node tools/ai-brain/acceptance/ac-23-04-retrieval-leak.js` | `1` | `RETRIEVAL_LEAK: LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED is proposed and not retrievable` | `lesson-seed.json`, `ac-23-04-retrieval-leak.js`, `lib/lesson-retrieval.js`; stderr |
| `AC-AI-23-05` | Superseded and expired lessons stay out even when approved | `node tools/ai-brain/acceptance/ac-23-05-retrieval-staleness.js` | `0` | `RETRIEVAL_STALENESS_HOLDS: superseded and expired lessons stay out of retrieval` | `lesson-seed.json`, `ac-23-05-retrieval-staleness.js`, `lib/lesson-retrieval.js` |
| `AC-AI-23-06` | **Negative proof, must fail:** gate copy without approved-status requirement admits proposed and is refused | `node tools/ai-brain/acceptance/ac-23-06-retrieval-requirement-missing.js` | `1` | `RETRIEVAL_REQUIREMENT_MISSING: status is not required for retrieval` | `ac-23-06-retrieval-requirement-missing.js`, `lib/lesson-retrieval.js`; stderr |
| `AC-AI-23-07` | Every excluded lesson carries a machine-readable reason | `node tools/ai-brain/acceptance/ac-23-07-retrieval-reasons.js` | `0` | `RETRIEVAL_REASONS_HOLDS: every excluded lesson carries its reason` | `ac-23-07-retrieval-reasons.js`, `lib/lesson-retrieval.js` |
| `AC-AI-23-08` | Schema-nonconforming lesson stays out even when approved | `node tools/ai-brain/acceptance/ac-23-08-retrieval-nonconforming.js` | `0` | `RETRIEVAL_CONFORMANCE_HOLDS: a nonconforming approved lesson stays out of retrieval` | `lesson-schema.json`, `ac-23-08-retrieval-nonconforming.js`, `lib/lesson-schema.js`, `lib/lesson-retrieval.js` |
| `AC-AI-23-09` | Dependency blocked: row 156 declares `TASK-AI-22`, which has no delivered file and no merged gate | `node tools/ai-brain/acceptance/ac-23-09-dependency-blocked.js` | `0` | `TASK-AI-22 dependency blocked: no promotion gate delivered for TASK-AI-23` | `FEATURE-DELIVERY-REGISTER.csv`, `ac-23-09-dependency-blocked.js`, `lib/dependency-delivered.js` |
| `AC-AI-23-10` | **Negative proof, must fail:** undelivered dependency and artifact violating its own rule are refused | `node tools/ai-brain/acceptance/ac-23-10-dependency-unproven.js` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` | `FEATURE-DELIVERY-REGISTER.csv`, `ac-23-10-dependency-unproven.js`, `lib/dependency-delivered.js`; stderr |
| `AC-AI-23-11` | Suite invariant green with 0 failures | `node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js` | `0` | `AC-AI-08-07 suite invariant held: fail 0 with` | `ac-08-07-suite-invariant.js`; runner stdout |
| `AC-AI-23-12` | Manifest truth audit green with 0 errors | `node tools/ai-brain/cli.js manifest --json` | `0` | `"error": 0` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-23-13` | Register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile --json` | `0` | `"error": 0` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-23-14` | Docs validation passes with 0 errors | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `validate_docs.py stdout` |
| `AC-AI-23-15` | Formatting check green | `pnpm format:check` | `0` | `100%` | `scripts/verify-formatting.ts stdout` |
| `AC-AI-23-16` | Secret surface guard clean | `node tools/ai-guard/cli.js secret-surface` | `0` | `SECRET_SURFACE_CLEAN` | `tools/ai-guard/cli.js stdout` |
| `AC-AI-23-17` | Negative proofs exit 2 (not 1) outside the repository | `node tools/ai-brain/acceptance/ac-23-17-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 4 negative proofs exited 2 with SOURCE_MISSING outside the repository` | `ac-23-17-outside-repository.js`; stdout |
### Evidence notes

Invariant rows assert invariants, never exact totals, because the seed grows and later items add scripts. Baselines below are evidence only: `AC-AI-23-03` admits 4 approved live and excludes 1 superseded plus 1 proposed; `AC-AI-23-11` reports 641 tests across 140 suites; `AC-AI-23-13` reconciles 178 rows; `AC-AI-23-14` covers 102 markdown files, 130 feature IDs, 178 rows. `AC-AI-23-11` reuses the suite gate owned by `TASK-AI-08`; this item adds none.

## Verification commands

All commands run from a clean checkout:

```bash
node tools/ai-brain/acceptance/ac-23-01-status-alignment.js
node tools/ai-brain/acceptance/ac-23-02-status-divergence.js
node tools/ai-brain/acceptance/ac-23-03-lesson-retrieval.js
node tools/ai-brain/acceptance/ac-23-04-retrieval-leak.js
node tools/ai-brain/acceptance/ac-23-05-retrieval-staleness.js
node tools/ai-brain/acceptance/ac-23-06-retrieval-requirement-missing.js
node tools/ai-brain/acceptance/ac-23-07-retrieval-reasons.js
node tools/ai-brain/acceptance/ac-23-08-retrieval-nonconforming.js
node tools/ai-brain/acceptance/ac-23-09-dependency-blocked.js
node tools/ai-brain/acceptance/ac-23-10-dependency-unproven.js
node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js
node tools/ai-brain/cli.js manifest --json
node tools/ai-brain/cli.js reconcile --json
python docs/product-spec/scripts/validate_docs.py
pnpm format:check
node tools/ai-guard/cli.js secret-surface
node tools/ai-brain/acceptance/ac-23-17-outside-repository.js
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Spec authored for TASK-AI-23. Register records `BLOCKED_DEPENDENCY`, so item is not stage-eligible and no verdict is claimed. |

## Acceptance matrix validation

Written `2026-09-17`. Spec only: no acceptance script exists yet here, so no row has been executed and no exit/output above is claimed as observed. The author must execute every row before the matrix is evidence, following the `TASK-AI-21` pattern: each negative proof reads a real file, proves the untouched source is accepted as CONTROL, tampers a copy under `os.tmpdir()`, and asserts the same check rejects the copy. Each exits `2`, not `1`, when its source is absent.

## Residual limitations

- **The repository itself is not created here.** `shipde-brain` is a GitHub repo; creating, protecting and giving it CI is a human action outside Git. Until it exists, the gate reads the seed here and no lesson is live.
- **The promotion gate is `TASK-AI-22`.** Nothing here writes an approval (`AI-23-R06`); the write path is owned by `TASK-AI-22`, still `BLOCKED_DEPENDENCY` on row 155 with no file here.
- **No retrieval runtime is installed.** The gate is a read-time predicate, not a service: no prompt pipeline, vector store, or network call is in scope. Wiring it into a prompt belongs to a later item.
- **No JSON Schema validator is installed**, so rows apply the named subset in `lib/lesson-schema.js` (`type`, `enum`, `const`, `pattern`, `minLength`, `required`, `properties`, `additionalProperties: false`, `items`, `allOf`, `if`/`then`/`else`). A keyword outside it would be ignored by `AC-AI-23-08`.
- **Row 156 displays `BLOCKED_DEPENDENCY`** behind `TASK-AI-22`. The Control table stays aligned to the register; clearing the block is the governed reconciler's job. `AC-AI-23-09` proves the block; it does not assert delivery.
- **Two row-numbering conventions disagree.** `TASK-AI-07`/`TASK-AI-08` call `delivery_order` the row; `TASK-AI-17` numbers by physical CSV line. Measured: `TASK-AI-23` is `delivery_order` 156, physical line 158. This file uses `delivery_order` plus `work_item_id`. Divergence is recorded, not repaired.

