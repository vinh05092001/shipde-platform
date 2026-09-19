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
| Allowed paths | `docs/product-spec/work-items/TASK-AI-23.md`, `tools/ai-brain/retrieval/**`, `tools/ai-brain/acceptance/ac-23-*.js`, `tools/ai-brain/acceptance/lib/lesson-retrieval.js`, `tools/ai-brain/acceptance/lib/dependency-delivered.js` |
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

1. **The retrieval rule had no artifact anywhere in the repository before this Work Item.** No retrieval filter, no admissible-status gate and no check existed — a search for `retriev` under `tools/ai-brain/*.js` (a non-recursive glob that still matches nothing on this branch) matched only unrelated reconciliation comments — so the register sentence could not be tested and a later implementation would have defined "reviewed" from scratch. This Work Item supplies that rule once, as the shared predicate `tools/ai-brain/acceptance/lib/lesson-retrieval.js` (`AI-23-R07`), and the acceptance rows below keep it true.
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
- No retrieval function exists in the operator surface this gate plugs into: `cli.js` exposes `reconcile`, `manifest`, `prove`, `quota` only; `facts.js` exposes commit/file/command readers only. The gate predicate is new code, delivered once by this Work Item as `tools/ai-brain/acceptance/lib/lesson-retrieval.js` (`AI-23-R07`).
- No network and no live store are required: the rows read the real schema and seed from this repository.

## Author boundary

`GEMINI` is the assigned author. Scope is bounded to the five paths named in Allowed paths above: this spec, `tools/ai-brain/retrieval/**` (reserved for the gate module, see Residual limitations), the acceptance rows `tools/ai-brain/acceptance/ac-23-*.js`, the shared retrieval rule module `tools/ai-brain/acceptance/lib/lesson-retrieval.js`, and the shared dependency rule module `tools/ai-brain/acceptance/lib/dependency-delivered.js`. The last is the module `TASK-AI-21` created and `TASK-AI-23` only `require`s for `AC-AI-23-09` and `AC-AI-23-10`: copying it would put the dependency-delivered rule in two places, so it is listed in Allowed paths instead, and the single branch of it this PR changes is bounded and substitution-evidenced under "Shared-module substitution evidence" below. `FEATURE-DELIVERY-REGISTER.csv` is not in Allowed paths and is not in this author's scope; only the governed register reconciler writes it (see "Do NOT advance the status ... manually" below). `GEMINI` is required (not `9ROUTER`) because the gate interprets a trust boundary (`AI-TOOL-06`); a mis-scoped filter silently promotes untrusted memory into prompts.
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

1. **Canonical retrieval gate** (single file under `tools/ai-brain/retrieval/`): given a lesson set shaped like `tools/ai-brain/lessons/lesson-seed.json`, returns exactly the lessons admissible to a prompt — `status: approved`, not expired, not superseded — with a machine-readable reason per excluded lesson. This round delivers that rule once, as the `admissible` predicate of `tools/ai-brain/acceptance/lib/lesson-retrieval.js` (`AI-23-R07`), and creates no file under `tools/ai-brain/retrieval/`; see Residual limitations for the boundary artifact a later item adds there.
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
| `AI-23-R02` | **Superseded lessons stay out**: a lesson whose own `status` is `superseded`, or whose own `superseded_by` is non-null (it has been replaced by another lesson), is retained for provenance and excluded from prompts. The replacement lesson itself — the one *named by* another record's `superseded_by` — is not excluded by this rule; it is evaluated on its own `status`, `expiry` and `superseded_by`, exactly like any other lesson. |
| `AI-23-R03` | **Expired lessons stay out**: `expiry` before the retrieval date is excluded even when approved. The retrieval date is a caller-supplied clock parameter when one is passed (so a test can pin it exactly); when none is passed, the gate defaults it to the wall-clock UTC date (`YYYY-MM-DD`) at the instant it runs. Explicit `null` `expiry` means not time-bounded and stays admissible. |
| `AI-23-R04` | **Admissibility requires schema conformance**: a lesson failing `matchesViolations` against the real schema is excluded even when `status` reads `approved`. |
| `AI-23-R05` | **Every exclusion carries its reason**: one machine-readable reason per excluded lesson; a silent drop is itself a violation. When more than one exclusion condition holds at once (for example a lesson that is both `superseded` and, independently, past its own `expiry`), the reason is reported in this fixed precedence order, most-authoritative first: `superseded` (a human decision already replaced it), then `expired` (a human-set time bound), then `unapproved` (`status` is not `approved`), then `nonconforming` (schema violation). `AC-AI-23-03` pins its retrieval date so this precedence never changes its own asserted output across runs. |
| `AI-23-R06` | **The gate reads status, never writes it**: retrieval cannot promote, approve, supersede or reject. The write path belongs to `TASK-AI-22` (`AI-TOOL-06`). |
| `AI-23-R07` | **One shared module**: the admissibility predicate lives in exactly one place, `tools/ai-brain/acceptance/lib/lesson-retrieval.js`, and is `require`d by every retrieval-specific row (`AC-AI-23-03` through `AC-AI-23-08`); the canonical gate file under `tools/ai-brain/retrieval/` is the later deliverable In scope 1 names, and it must `require` this same module rather than restate the predicate. No row and no gate file restates the predicate inline. The status-alignment (`AC-AI-23-01`, `-02`), dependency-block (`AC-AI-23-09`, `-10`) and outside-repository (`AC-AI-23-17`) rows check unrelated invariants and have no reason to load this module. |
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
| `AC-AI-23-04` | **Negative proof, must fail:** seed copy with only the proposed record's `status` field edited to `approved` (`approved_by` left at its untampered `null`) proves a naive status-only edit does not leak the record — the schema's approved-lesson requirement (`AI-21-R05`) backstops `AI-23-R04` and excludes it as `nonconforming` instead | `node tools/ai-brain/acceptance/ac-23-04-retrieval-leak.js` | `1` | `RETRIEVAL_LEAK: LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED stays excluded (nonconforming: approved_by required when status is approved)` | `lesson-seed.json`, `ac-23-04-retrieval-leak.js`, `lib/lesson-retrieval.js`; stderr |
| `AC-AI-23-05` | Superseded and expired lessons stay out even when approved. The real seed's only non-null `expiry` (`LESSON-SINGLE-REPAIR-PER-HEAD`, `2026-12-31`) sits on an already-superseded record, so this row also builds one synthetic fixture record — approved, not superseded, `expiry` before the pinned retrieval date — to exercise the expiry-only path the live seed cannot reach; the row states this explicitly rather than implying the fixture is the live seed | `node tools/ai-brain/acceptance/ac-23-05-retrieval-staleness.js` | `0` | `RETRIEVAL_STALENESS_HOLDS: superseded and expired lessons stay out of retrieval` | `lesson-seed.json`, `ac-23-05-retrieval-staleness.js`, `lib/lesson-retrieval.js` |
| `AC-AI-23-06` | **Negative proof, must fail:** an in-memory copy of `lib/lesson-retrieval.js`'s admissibility predicate (never the gate, which per `AI-23-R07` never restates the predicate) with the approved-status check deleted admits the proposed record, and is refused | `node tools/ai-brain/acceptance/ac-23-06-retrieval-requirement-missing.js` | `1` | `RETRIEVAL_REQUIREMENT_MISSING: status is not required for retrieval` | `ac-23-06-retrieval-requirement-missing.js`, `lib/lesson-retrieval.js`; stderr |
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
| `AC-AI-23-17` | Each of the four negative proofs defined in this matrix (`AC-AI-23-02`, `AC-AI-23-04`, `AC-AI-23-06`, `AC-AI-23-10`) exits 2, not 1, when run outside the repository | `node tools/ai-brain/acceptance/ac-23-17-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 4 negative proofs exited 2 with SOURCE_MISSING outside the repository` (the count form `TASK-AI-09` and `TASK-AI-21` use; the four subjects are named in the scenario cell and each is separately asserted there) | `ac-23-17-outside-repository.js`; stdout |
### Evidence notes

Invariant rows assert invariants, never exact totals, because the seed grows and later items add scripts. Baselines below are evidence only, re-measured on this branch at head `63dcf6f` on `2026-09-19` (see Acceptance matrix validation for the verbatim output of each): `AC-AI-23-03` admits 4 approved live and excludes 1 superseded plus 1 proposed; `AC-AI-23-11` reports 643 tests across 141 suites; `AC-AI-23-13` reconciles 178 rows; `AC-AI-23-14` covers 102 markdown files, 130 feature IDs, 178 rows. `AC-AI-23-11` reuses the suite gate owned by `TASK-AI-08`; this item adds none.

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
node --test tools/ai-brain/test/*.test.js
node tools/ai-brain/cli.js manifest --json
node tools/ai-brain/cli.js reconcile --json
python docs/product-spec/scripts/validate_docs.py
pnpm format:check
node tools/ai-guard/cli.js secret-surface
node tools/ai-brain/acceptance/ac-23-17-outside-repository.js
```

## Codex review record

| Review round | Reviewed commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `fcf0a5b` | `CHANGES_REQUIRED` | Six findings on the rule text, the `AC-AI-23-04` scenario and internal contradictions of the first draft; itemised in the review comment on this PR. Resolved in `4924861` |
| 2 | `4924861` | `CHANGES_REQUIRED` | `AC-AI-23-04` still contradicted itself and one fix was only partly applied. Resolved in `ab8a761` |
| 3 | `ab8a761` | `PASS` | None open; the reviewer noted the repository's Prettier configuration skips this file |
| 4 | `ab8a761` | `PASS` | Independent re-review of the same commit against the register, seed and schema; nothing blocked the merge |
| 5 | `ccda8d9` | `CHANGES_REQUIRED` | The whole acceptance matrix named scripts that did not exist in the branch. Harness delivered in `5be9558` |
| 6 | `5be9558` | `CHANGES_REQUIRED` | (a) a blank line at EOF failed `git diff --check` in CI, (b) `Acceptance matrix validation` still claimed no acceptance script existed, (c) shared `lib/dependency-delivered.js` was not in Allowed paths, (d) the PR body verification table omitted `node --test` and `pnpm format:check`. Resolved in `543736d` and in this round |
| 7 | `127966c` and later doc-only commits on this branch | `NOT_REVIEWED` | No verdict claimed. Round 6's remediation landed in `543736d`; `127966c` re-executed all seventeen rows on `2026-09-19`, pasted each observed exit code and output, added the shared-module substitution evidence and recorded the `origin/main` drift under Residual limitations |
| 8 | `63dcf6f` and later documentation-only commits on this branch | `NOT_REVIEWED` | No verdict claimed, and the author does not review its own work. Round 6's four findings were re-measured from this checkout rather than carried forward: the CI check suite is `success` on this head, `git diff --check` is clean, all seventeen rows and the shared-module substitution experiment were re-run and reproduced, and both repository gates are green. The PR description was corrected in the same round. The later documentation-only commits on this branch fix four statements this PR itself had made stale: the Business outcome's claim that no retrieval artifact exists anywhere, the precondition that no retrieval function exists, `AI-23-R07`'s present-tense claim that a canonical gate file already `require`s this module, and a residual limitation that described In scope 1 as promising a `tools/ai-brain/retrieval/lesson-admission-gate.md` artifact plus an `Acceptance criteria` heading this file does not contain. See the second-pass note under Acceptance matrix validation |
| 9 | `4c22376` and the documentation-only commit that records this pass | `NOT_REVIEWED` | No verdict claimed, and the author does not review its own work. The four round-6 findings were measured a third time from this checkout: `git diff --check` clean with a single trailing newline, eleven check runs `success` on `4c22376`, all seventeen matrix rows re-executed with their recorded exits and outputs, the shared-module substitution experiment reproduced with the module left byte-identical to its committed blob, and both repository gates green. See the third-pass note under Acceptance matrix validation |

Register status governs stage eligibility: `delivery_order` 156 records `BLOCKED_DEPENDENCY`, so this item is not dispatch-eligible and no round above is claimed as an approval.

## Acceptance matrix validation

Written `2026-09-17`; evidence recorded `2026-09-19` at commit `543736d` on `spec/task-ai-23`, re-executed the same day at head `2e5cce4`, re-executed a second time the same day at head `63dcf6f`, and re-executed a third time the same day at head `4c22376` — the commits between them being documentation-only; every exit code and output string below reproduced unchanged at each later head. The harness is delivered in this PR: scripts `ac-23-01` through `ac-23-10`, `ac-23-17-outside-repository.js`, and shared modules `lib/lesson-retrieval.js` and `lib/dependency-delivered.js`, all under `tools/ai-brain/acceptance/`. Each row of the matrix above was therefore executed against this checkout, and the observed exit code and observed output are pasted below verbatim rather than asserted. All seventeen rows reproduced their stated exit code. Every row reads committed code, the register or the schema rather than this document, so a documentation-only commit to this file cannot change an exit code recorded above; `git diff --stat` shows which paths each later head actually touched.

| Row | Exact command | Expected exit | Observed exit | Observed output (verbatim) |
|---|---|---|---|---|
| `AC-AI-23-01` | `node tools/ai-brain/acceptance/ac-23-01-status-alignment.js` | `0` | `0` | `Control status matches register row 156: BLOCKED_DEPENDENCY (declared TASK-AI-23)` |
| `AC-AI-23-02` | `node tools/ai-brain/acceptance/ac-23-02-status-divergence.js` | `1` | `1` | stderr `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` |
| `AC-AI-23-03` | `node tools/ai-brain/acceptance/ac-23-03-lesson-retrieval.js` | `0` | `0` | `LESSON_RETRIEVAL_HOLDS: only approved live lessons are retrievable`; admitted 4 approved live lessons, excluded `LESSON-SINGLE-REPAIR-PER-HEAD` (superseded) and `LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED` (unapproved) |
| `AC-AI-23-04` | `node tools/ai-brain/acceptance/ac-23-04-retrieval-leak.js` | `1` | `1` | stderr `RETRIEVAL_LEAK: LESSON-BRAIN-UNTRUSTED-UNTIL-REVIEWED stays excluded (nonconforming: approved_by required when status is approved)` |
| `AC-AI-23-05` | `node tools/ai-brain/acceptance/ac-23-05-retrieval-staleness.js` | `0` | `0` | `RETRIEVAL_STALENESS_HOLDS: superseded and expired lessons stay out of retrieval`; synthetic `LESSON-SYNTHETIC-EXPIRY-ONLY-FIXTURE` excluded expired, `LESSON-SINGLE-REPAIR-PER-HEAD` excluded superseded with that reason winning over expiry per `AI-23-R05` |
| `AC-AI-23-06` | `node tools/ai-brain/acceptance/ac-23-06-retrieval-requirement-missing.js` | `1` | `1` | stderr `RETRIEVAL_REQUIREMENT_MISSING: status is not required for retrieval` |
| `AC-AI-23-07` | `node tools/ai-brain/acceptance/ac-23-07-retrieval-reasons.js` | `0` | `0` | `RETRIEVAL_REASONS_HOLDS: every excluded lesson carries its reason`; 4 admitted with no reason, 2 excluded each with its reason |
| `AC-AI-23-08` | `node tools/ai-brain/acceptance/ac-23-08-retrieval-nonconforming.js` | `0` | `0` | `RETRIEVAL_CONFORMANCE_HOLDS: a nonconforming approved lesson stays out of retrieval` |
| `AC-AI-23-09` | `node tools/ai-brain/acceptance/ac-23-09-dependency-blocked.js` | `0` | `0` | `TASK-AI-22 dependency blocked: no promotion gate delivered for TASK-AI-23`; reason `no declared deliverable rule for TASK-AI-22` |
| `AC-AI-23-10` | `node tools/ai-brain/acceptance/ac-23-10-dependency-unproven.js` | `1` | `1` | stderr `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` |
| `AC-AI-23-11` | `node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js` | `0` | `0` | `AC-AI-08-07 suite invariant held: fail 0 with 643 passing of 643 tests across 141 suites` |
| `AC-AI-23-12` | `node tools/ai-brain/cli.js manifest --json` | `0` | `0` | `"error": 0` (37 checks, `"warn": 1`, `"info": 2`, `"trustworthy": true`) |
| `AC-AI-23-13` | `node tools/ai-brain/cli.js reconcile --json` | `0` | `0` | `"error": 0`, `"trustworthy": true` |
| `AC-AI-23-14` | `python docs/product-spec/scripts/validate_docs.py` | `0` | `0` | `Documentation validation passed: 102 markdown files, 130 feature IDs, 178 delivery rows, 828 unique identifiers.` |
| `AC-AI-23-15` | `pnpm format:check` | `0` | `0` | exit `0`; the incremental checker reports all 13 changed files at 100% conformance |
| `AC-AI-23-16` | `node tools/ai-guard/cli.js secret-surface` | `0` | `0` | `SECRET_SURFACE_CLEAN` and `files scanned: 323` |
| `AC-AI-23-17` | `node tools/ai-brain/acceptance/ac-23-17-outside-repository.js` | `0` | `0` | `CONTROL: each child ran with no repository on disk and refused operationally` and `OUTSIDE_REPOSITORY_PROBE: 4 negative proofs exited 2 with SOURCE_MISSING outside the repository` |

Each negative proof follows the `TASK-AI-21` pattern: it reads a real file, proves the untouched source is accepted as CONTROL, tampers a copy, and asserts the same check rejects the copy. The copy is written under `os.tmpdir()` by `AC-AI-23-02`, `-04`, `-05`, `-08` and `-10`; `AC-AI-23-06` tampers an in-memory copy of the admissibility predicate instead, because its subject is a function body and not a data file, which is what `AI-23-R07` requires of it. Each of the four subjects of `AC-AI-23-17` exits `2`, not `1`, when its source is absent.

**Shared-module substitution evidence.** `lib/dependency-delivered.js` is shared with `TASK-AI-21`. The only behavioral change this PR makes to it is the branch where the dependency's merge commit exists but no deliverable rule is declared: `measurable: false` becomes `measurable: true, ok: false`, which is exactly the state `AC-AI-23-09` must be able to observe instead of dying as unmeasurable. To bound the blast radius, the four rows that load the module were run twice on this checkout - once with the module replaced by the untouched `origin/main` blob, once with this PR's copy restored:

| Row | With the `origin/main` module | With this PR's module |
|---|---|---|
| `ac-21-09-dependency-delivered.js` | exit `1`, `DEPENDENCY_UNPROVEN: TASK-AI-17 is named on origin/main but its deliverable tools/ecosystem-manifest.json still violates its own rule: lefthook: lifecycle_state is ADOPTED, expected PENDING` | exit `1`, identical message |
| `ac-21-10-dependency-unproven.js` | exit `2`, `CONTROL_FAILED: the real dependency TASK-AI-17 is not delivered, so the negative case is meaningless` | exit `2`, identical message |
| `ac-23-09-dependency-blocked.js` | exit `2`, `SOURCE_MISSING: no declared deliverable rule for TASK-AI-22` | exit `0`, `TASK-AI-22 dependency blocked: no promotion gate delivered for TASK-AI-23` |
| `ac-23-10-dependency-unproven.js` | exit `2`, `SOURCE_MISSING: no declared deliverable rule for TASK-AI-22` | exit `1`, `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` |

Neither `TASK-AI-21` result moves under this PR's edit: both keep the same exit code and the same message, so their red is `origin/main` data that moved after this branch last merged main, recorded under Residual limitations rather than repaired here. Both rows of this Work Item do depend on the edit, which is why the module is listed in Allowed paths instead of being copied.

**Round-6 finding re-verification at head `2e5cce4` (`2026-09-19`).** The four findings of the review round that examined `5be9558` were re-checked from this checkout rather than trusted from the previous round's report: (a) `git diff --check origin/main...HEAD` exits `0` and the file ends in exactly one newline, so the blank line at EOF that failed CI is gone; (b) this section describes the delivered harness and every one of the seventeen rows was re-executed with the exit code and the output shown in the table above; (c) `tools/ai-brain/acceptance/lib/dependency-delivered.js` is listed in the Control table's Allowed paths, and the substitution table above was re-measured at this head, reproducing both columns exactly; (d) the PR description carries a row for `node --test tools/ai-brain/test/*.test.js` and a row for `pnpm format:check`. The two repository gates this Work Item owns were re-run at the same head: `node --test tools/ai-brain/test/*.test.js` reports 393 pass / 0 fail, and `python docs/product-spec/scripts/validate_docs.py` exits `0`.

**Round-6 findings re-verified at head `63dcf6f` (`2026-09-19`, second pass).** The same four findings were measured again from this checkout rather than carried forward from the paragraph above. (a) `git diff --check origin/main...HEAD` exits `0` and this file ends in exactly one newline with no blank line at EOF; the check suite recorded on `63dcf6f` holds eleven check runs — `application-gate`, `current-application`, `detect-application-scope`, `contract`, `secret-scan` and `validate` — every one `completed` with `success`. (b) All seventeen rows above were re-executed at this head and each reproduced its expected exit code and its pasted output, including the four negative proofs at exit `1`. (c) The substitution experiment on `lib/dependency-delivered.js` was re-run end to end: with the untouched `origin/main` blob restored into the working tree, `ac-21-09` exits `1` and `ac-21-10` exits `2` while `ac-23-09` and `ac-23-10` both exit `2` with `SOURCE_MISSING`; with this PR's blob in place the two `TASK-AI-21` rows keep exactly those exit codes and messages while `ac-23-09` exits `0` and `ac-23-10` exits `1`. The module was left byte-identical to its committed blob afterwards, so the shared edit moves no `TASK-AI-21` result. (d) The PR description carries a row for `node --test tools/ai-brain/test/*.test.js` and a row for `pnpm format:check`, and its branch-state sentence reports the ahead/behind counts measured against `origin/main` at this head. The repository gates were re-run in the same checkout: `node --test tools/ai-brain/test/*.test.js` exits `0` with 393 pass and 0 fail; `python docs/product-spec/scripts/validate_docs.py` exits `0` with `Documentation validation passed: 102 markdown files, 130 feature IDs, 178 delivery rows, 828 unique identifiers.`; `pnpm format:check` with `BASE_SHA=origin/main` exits `0` and reports the 13 format-governed files among the 14 this PR changes — `.prettierignore` excludes `docs/`, so this specification is not one of them — at 100% conformance; `node tools/ai-guard/cli.js secret-surface` exits `0` with `SECRET_SURFACE_CLEAN` after `files scanned: 323`; `node tools/ai-brain/cli.js manifest --json` reports `"error": 0` across its 37 rows.

**Round-6 findings re-verified at head `4c22376` (`2026-09-19`, third pass).** The same four findings were measured a third time from this checkout rather than carried forward from the paragraph above. (a) `git diff --check origin/main...HEAD` exits `0` and this file ends in exactly one newline with no blank line at EOF; the check suite recorded on `4c22376` holds eleven check runs — `application-gate`, `current-application`, `detect-application-scope`, `contract`, `secret-scan` and `validate` — every one `completed` with `success`. (b) All seventeen rows above were re-executed at this head and each reproduced its expected exit code and its pasted output, including the four negative proofs at exit `1`. (c) The substitution experiment on `lib/dependency-delivered.js` was re-run end to end: with the untouched `origin/main` blob restored into the working tree, `ac-21-09` exits `1` and `ac-21-10` exits `2` with identical messages while `ac-23-09` and `ac-23-10` both exit `2` with `SOURCE_MISSING`; with this PR's blob back in place `ac-23-09` exits `0` and `ac-23-10` exits `1`, and the module was left byte-identical to its committed blob afterwards. (d) The PR description carries a row for `node --test tools/ai-brain/test/*.test.js` and a row for `pnpm format:check`; measured against `origin/main` at this head the branch is 12 commits ahead and 17 behind. The repository gates were re-run in the same checkout: `node --test tools/ai-brain/test/*.test.js` exits `0` with 393 pass and 0 fail; `python docs/product-spec/scripts/validate_docs.py` exits `0` with `Documentation validation passed: 102 markdown files, 130 feature IDs, 178 delivery rows, 828 unique identifiers.`; `pnpm format:check` exits `0` reporting the 13 format-governed files among the 14 this PR changes at 100% conformance; `node tools/ai-guard/cli.js secret-surface` exits `0` with `SECRET_SURFACE_CLEAN` after `files scanned: 323`.

**Environment caveat.** This evidence was recorded on a Windows checkout with `core.autocrlf=true`. Two gates govern that checkout differently than a naive reading of them suggests: `.prettierignore` lists `docs/`, so `AC-AI-23-15` formats only the JavaScript, TypeScript and JSON files this PR changes (its run reports 13 such files at 100% conformance and never a markdown file), while this specification document itself is governed by `AC-AI-23-14`, the Python documentation validator; a bare `npx prettier --check` outside the repository gate compares markdown against `endOfLine: "lf"` and reports CRLF noise that neither gate sees.

## Residual limitations

- **The branch name predates `AGENTS.md`'s `feat/`/`fix/` pattern for this Work Item.** `spec/task-ai-23` does not match the `feat/`- or `fix/`-prefixed work-item-id-and-slug rule in `AGENTS.md` § Unit of delivery. This follows the precedent already merged for spec-only authoring Work Items on this repository (for example `spec/task-ai-21`, PR #74; `spec/task-ai-08`; `spec/task-ai-09`), and the branch itself was created before this specification was authored. Renaming it is outside this Work Item's Allowed paths.
- **The repository itself is not created here.** `shipde-brain` is a GitHub repo; creating, protecting and giving it CI is a human action outside Git. Until it exists, the gate reads the seed here and no lesson is live.
- **The promotion gate is `TASK-AI-22`.** Nothing here writes an approval (`AI-23-R06`); the write path is owned by `TASK-AI-22`, still `BLOCKED_DEPENDENCY` on row 155 with no file here.
- **No retrieval runtime is installed.** The gate is a read-time predicate, not a service: no prompt pipeline, vector store, or network call is in scope. Wiring it into a prompt belongs to a later item.
- **No JSON Schema validator is installed**, so rows apply the named subset in `lib/lesson-schema.js` (`type`, `enum`, `const`, `pattern`, `minLength`, `required`, `properties`, `additionalProperties: false`, `items`, `allOf`, `if`/`then`/`else`). A keyword outside it would be ignored by `AC-AI-23-08`.
- **Row 156 displays `BLOCKED_DEPENDENCY`** behind `TASK-AI-22`. The Control table stays aligned to the register; clearing the block is the governed reconciler's job. `AC-AI-23-09` proves the block; it does not assert delivery.
- **Two row-numbering conventions disagree.** `TASK-AI-07`/`TASK-AI-08` call `delivery_order` the row; `TASK-AI-17` numbers by physical CSV line. Measured: `TASK-AI-23` is `delivery_order` 156, physical line 158. This file uses `delivery_order` plus `work_item_id`. Divergence is recorded, not repaired.
- **The canonical gate file named in In scope 1 is not created by this round.** In scope 1 heads its first deliverable "Canonical retrieval gate (single file under `tools/ai-brain/retrieval/`)" and then records that this round delivers that rule once, as the `admissible` predicate in `tools/ai-brain/acceptance/lib/lesson-retrieval.js` (`AI-23-R07`: one copy of the predicate), creating no file under `tools/ai-brain/retrieval/`; no matrix row requires a file there either. That directory stays reserved in Allowed paths for the gate module the later prompt-wiring item adds, which must `require` this same predicate rather than restate it. No placeholder document is created here to satisfy the path, and no other section of this file claims the artifact exists — the earlier wording in this bullet, which named a `tools/ai-brain/retrieval/lesson-admission-gate.md` artifact as promised by In scope 1, an "Acceptance criteria" heading and the Business outcome, is withdrawn, because this file has no such section and names no such path anywhere else. This is a naming gap the reviewer flagged on 2026-09-17; it is recorded rather than closed by inventing a second copy of the rule.
- **The Allowed-paths line that covers the shared module was extended by this Work Item's author, and that extension is not self-approved.** Round 6 offered two remedies for the `tools/ai-brain/acceptance/lib/dependency-delivered.js` edit: document the shared-module change in the PR description, or split it out. This branch took the first — the PR description carries the rationale and the substitution evidence, and the module is named in the Control table's Allowed paths and in the Author boundary — but adding a path to a Control table is a planning act under `AGENTS.md` § Role separation, so the extension is disclosed for the human and the reviewing task to ratify or refuse rather than presented as settled. Refusing it means taking the second remedy instead: the one changed branch of the module moves into the `TASK-AI-21` lane, and `AC-AI-23-09` and `AC-AI-23-10` then exit `2` with `SOURCE_MISSING` on this branch until that item lands.
- **`origin/main` data drift makes two `TASK-AI-21` rows red, and this branch is 17 commits behind.** `ac-21-09-dependency-delivered.js` exits `1` and `ac-21-10-dependency-unproven.js` exits `2` because `lefthook` in `tools/ecosystem-manifest.json` became `lifecycle_state: "ADOPTED"` while the `TASK-AI-17` reconcile expectation for it still reads `PENDING`. The drift arrived in `8cec992` (`[TASK-AI-36]` Git hooks run from the version-controlled Lefthook config, PR #96, merged `2026-09-18`), after the review round of `2026-09-17` measured both rows green and after this branch last merged main at `ccda8d9`; the shared module is not involved, as the substitution test under "Shared-module substitution evidence" shows. Repairing it belongs to the `TASK-AI-17`/`TASK-AI-21` lane, outside this Work Item's Allowed paths, so it is recorded here and flagged in the PR comment rather than fixed. The integration merge decision, including whether to refresh this branch against `main`, is the human's.
