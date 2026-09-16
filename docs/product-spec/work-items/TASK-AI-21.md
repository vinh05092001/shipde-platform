# TASK-AI-21 — Create the shipde-brain repository and lesson schema

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-21` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `154` |
| Dependencies | `TASK-AI-17` (delivered on `origin/main`; register row 150 not yet reconciled to `MERGED`) |
| Assigned author | `GEMINI` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-21.md`, `tools/ai-brain/lessons/**`, `tools/ai-brain/acceptance/ac-21-*.js`, `tools/ai-brain/acceptance/lib/lesson-schema.js`, `tools/ai-brain/acceptance/lib/brain-repository-contract.js`, `tools/ai-brain/acceptance/lib/dependency-delivered.js`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-21` |
| Pull Request | `Pending` |

**Row numbering.** "Row 154" is the register's own `delivery_order` column, the convention `TASK-AI-07` (row 140) and `TASK-AI-08` (row 141) already use. `TASK-AI-17` numbers by physical CSV line instead, where the same record is line 152 and `TASK-AI-19` is line 154. The two conventions disagree, so every row number in this file also names the record's `work_item_id`.

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, row 154, `work_item_id` `TASK-AI-21`) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` § Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block, so it has not reached `BACKLOG`. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` row 154, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`; doing so would route the item past gates for which no transition evidence exists. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency is satisfied in Git reality but not yet recorded: `TASK-AI-17`'s declared deliverable — the reconciled `tools/ecosystem-manifest.json` — is present on `origin/main` and satisfies `TASK-AI-17`'s own acceptance rule there, while register row 150 still reads `READY_FOR_CODEX`. `AC-AI-21-09` proves this from the repository and the merged tree rather than from the register.
- **Measured warning on this exact mechanism.** Register row 154 is not frozen. `TASK-AI-08` is the live precedent: its Control table declares `BLOCKED_DEPENDENCY` while register row 141 now reads `BACKLOG`, so `AC-AI-08-01` exits `1` on the current tip and its own negative proof `AC-AI-08-02` exits `2` at the control step. If the governed reconciler clears this row's block before this file merges, the Control table must be re-aligned to the register in the same change; the divergence would be reported by `AC-AI-21-01` rather than hidden.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler before this item is stage-eligible for review routing.

## Business outcome

`shipde-brain` is one of the two internal repositories in the governed ecosystem catalog, described as "Agent brain, memory, prompts, and knowledge base". Its manifest entry exists today — with a role, a declared source-of-truth boundary, `permissions: read-only-contract`, a health check and a rollback — but `TASK-AI-03` explicitly deferred creating it: "Creating `shipde-brain`; this Work Item records its contract only." `AI-TOOL-06` states the policy that governs it: "Hermes memory and self-created skills are untrusted until human-reviewed into shipde-brain; no PII or credential persistence." Nothing yet defines **what a reviewed memory record is**, **what an approved lesson must carry**, or **how an agent's proposal becomes an approved lesson**.

The register's key behaviour for this Work Item is the answer to the second question: *approved lessons carry `source_commit`, `scope`, `expiry` and `superseded_by`*. Four consequences, each of which is a defect class rather than a nicety:

1. **The register's key behaviour has no artifact anywhere in the repository.** No schema, no example record and no check exists, so the sentence in the register cannot be tested and a later implementation would define the fields from scratch.
2. **`expiry` and `superseded_by` are exactly the fields a memory store gets wrong.** A lesson with no expiry is silently permanent; a lesson replaced by a newer one keeps being applied. Both failures look identical to a field someone forgot to write, which is why the schema must **require the keys and accept an explicit `null`**. "No expiry" and "not replaced yet" are decisions, and the schema forces them to be written down rather than inferred from absence.
3. **Provenance cannot be asserted.** A lesson that names no commit cannot be re-verified when the code it describes changes, and a lesson pinned to `latest` or to a branch is not reproducible (`AI-TOOL-11`). An approved lesson carries the exact 40-character commit it was learned from.
4. **The brain's boundary is implicit.** Its manifest entry carries a health check, a rollback and a declared permission surface, but no check asserts that they stay declared, that the brain cannot be repointed at a different repository, or that it is never promoted into the orchestration runtime slot (`AI-TOOL-13`).

`TASK-AI-21` therefore delivers the canonical lesson schema, the conformance seed that proves the schema is satisfiable and exercises the approved, superseded and proposed statuses, the brain's repository contract, and the acceptance rows that keep both true. It does **not** create the GitHub repository — that is a human action outside Git, recorded as a residual limitation — and it does not add the promotion gate (`TASK-AI-22`) or the untrusted-content admission scan (`TASK-AI-39`).

## Source references

- `AGENTS.md` § Source of truth — Precedence order: specifications govern, existing code is implementation evidence.
- `AGENTS.md` § Role separation — Author never approves own work; author and reviewer are separate tasks.
- `AGENTS.md` § Unit of delivery — Required status flow through `READY_FOR_CODEX`.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-TOOL-06 — Hermes memory and self-created skills are untrusted until human-reviewed into shipde-brain; no PII or credential persistence.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-TOOL-11 — A supplied authoritative version, ref or path is fail closed; no fallback to `latest`, another branch or a broader filesystem path.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § AI-TOOL-13 — An external runtime is separately versioned with a canonical source and a health check, and is recorded outside `adopted`; the brain is the mirror image, an internal repository recorded inside `adopted` and never a runtime.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Governed Ecosystem Catalog § 1 Internal Repositories — `vinh05092001/shipde-brain`: agent brain, memory, prompts and knowledge base.
- `docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md` § Profile activation contract — the Research profile activates `shipde-brain`, one of DSH/Hermes, and Repomix.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` — Row 154 (`delivery_order` 154, `work_item_id` `TASK-AI-21`).
- `docs/product-spec/work-items/TASK-AI-03.md` § Out of scope — "Creating `shipde-brain`; this Work Item records its contract only", and § Business rules — `AI-TOOL-06`.
- `docs/product-spec/work-items/TASK-AI-17.md` § In scope — the manifest reconciliation that left `shipde-brain` at `PENDING` with `default_enabled: false` and `blocking_policy: NON_BLOCKING`.
- `docs/product-spec/work-items/TASK-AI-39.md` § In scope — generated agent lessons and prompt templates can contain adversarial instructions, which is the admission scan that will read what this schema defines.
- `tools/ecosystem-manifest.json` — the `shipde-brain` entry, its pin, health check, rollback and the `AI-TOOL-06` policy string.
- `tools/ai-brain/lessons/lesson-schema.json` — the canonical lesson schema this Work Item creates.
- `tools/ai-brain/lessons/lesson-seed.json` — the conformance seed that proves the schema is satisfiable.
- `tools/ai-brain/acceptance/lib/lesson-schema.js`, `tools/ai-brain/acceptance/lib/brain-repository-contract.js`, `tools/ai-brain/acceptance/lib/dependency-delivered.js` — the shared rules the acceptance rows require.

## Preconditions and dependencies

- Prerequisite `TASK-AI-17` is delivered on `origin/main`: its declared deliverable, the reconciled ecosystem manifest, is present in the merged tree and satisfies `TASK-AI-17`'s own acceptance rule there. `AC-AI-21-09` proves this from the repository rather than from the register.
- Delivery register alignment: `FEATURE-DELIVERY-REGISTER.csv` row 154 records `status: "BLOCKED_DEPENDENCY"`. The Control table records `BLOCKED_DEPENDENCY` exactly.
- No JSON Schema validator is installed in this repository (`ajv` and equivalents are absent), so the subset the acceptance rows apply is committed and named in `tools/ai-brain/acceptance/lib/lesson-schema.js` rather than implied.
- The conformance seed cites real commits that exist on this repository's history; no live lesson store and no network access is required.
- `tools/ai-brain/manifest-audit.js` and `tools/ai-brain/acceptance/lib/reconcile-expectations.js` already own the manifest's truthfulness rules; this Work Item asserts the brain's own declaration surface and re-uses `reconcile-expectations.js` by reference rather than restating it.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded to the lesson schema, the conformance seed, the two shared rule modules named in Allowed paths, their acceptance scripts, this specification, and the register row.

Prohibited in this Work Item:

- Do NOT create, push or configure the `shipde-brain` GitHub repository; that is a human action outside Git, and this Work Item defines the contract the repository must satisfy.
- Do NOT write lessons into a live store. The seed is a conformance artifact; the live store is written only through the promotion path owned by `TASK-AI-22`.
- Do NOT approve a lesson the author itself proposed (`AI-TOOL-06`); no agent asserts its own memory into the brain.
- Do NOT record PII, credentials, tokens or production data in a lesson or in the seed (`AI-TOOL-06`).
- Do NOT install a JSON Schema validator dependency or add a runtime dependency for the acceptance rows.
- Do NOT renumber, retire or repin manifest entries beyond the `shipde-brain` declaration this Work Item asserts; the reconciliation rules belong to `TASK-AI-17` and the retirements to `TASK-AI-40`.
- Do NOT store lessons in the delivery register or in the AO supervisor checkpoint; the brain is not a register shadow (`TASK-AI-33`).
- Do NOT advance the status in `FEATURE-DELIVERY-REGISTER.csv` manually.

## In scope

1. **Canonical lesson schema** at `tools/ai-brain/lessons/lesson-schema.json`:
   - Required keys: `id`, `title`, `status`, `scope`, `source_commit`, `expiry`, `superseded_by`, `evidence`, `created_at`, `proposed_by`, `approved_by`.
   - `status` distinguishes `proposed`, `approved`, `superseded` and `rejected`.
   - `scope` is constrained to a governed enum so a lesson cannot claim an arbitrary scope.
   - `source_commit` is constrained to a 40-character lowercase commit.
   - `expiry` and `superseded_by` are required keys that accept an explicit `null`, so "not time-bounded" and "not replaced" are stated rather than inferred from an absent key.
   - `additionalProperties: false`, so a lesson cannot smuggle an undeclared field past the schema.
2. **The approved-lesson requirement** expressed as `allOf` with `if`/`then` branches: an approved lesson requires all four of `source_commit`, `scope`, `expiry`, `superseded_by` and a non-empty `approved_by`; a superseded lesson must name the lesson that replaced it; a rejected lesson carries no approver.
3. **Conformance seed** at `tools/ai-brain/lessons/lesson-seed.json`: the worked examples that prove the schema is satisfiable, exercising every status the schema names and both the `null` and non-`null` forms of `expiry` and `superseded_by`. Each record cites a real commit from this repository.
4. **Brain repository contract**: the manifest's `shipde-brain` entry must declare a canonical source, a 40-character pin, a role, a source-of-truth boundary, permissions, a health check and a rollback; must not be the orchestration runtime; and the `AI-TOOL-06` policy string must record that memory stays untrusted until human-reviewed into the brain.
5. **Shared rule modules and acceptance rows**: `lesson-schema.js`, `brain-repository-contract.js` and `dependency-delivered.js` under `tools/ai-brain/acceptance/lib/`, each required by both an invariant row and its negative proof, with the dependency module re-exporting the register parser, the commit-name merge rule and the dependency's own deliverable rule by reference.
6. **Documented lifecycle**: the lesson lifecycle, the four required fields and the promotion boundary are documented in this Work Item and in the schema's own `description` fields, so the machine-readable contract and its rationale stay in one place.
7. **A closed gap in the shared dependency rule**: `deliverableAtOriginMain` accepts an injectable reader so the deliverable half of the dependency claim is falsifiable, and `AC-AI-21-10` exercises it against a tampered copy of the dependency's real artifact.

## Out of scope

- Creating the `shipde-brain` GitHub repository, its branch protection or its CI (human action).
- The promotion gate that turns a proposed memory into an approved lesson (`TASK-AI-22`).
- Admission scanning of lessons, skills and prompts for adversarial content (`TASK-AI-39`).
- Retiring or repinning manifest entries, including `token-tracker` and `sylph` (`TASK-AI-40`).
- Separating AgentRouter from 9Router in code or in name (`TASK-AI-44`).
- Machine restart checkpoint recovery (`TASK-AI-09`) and the Beads dependency shadow (`TASK-AI-33`).
- Any product feature, UI, API, Prisma schema, migration, queue or carrier behavior.
- Fetching, cloning or mirroring any upstream repository to satisfy the schema.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-21-R01` | **Provenance**: an approved lesson carries `source_commit`, the exact 40-character lowercase commit it was learned from. A lesson pinned to a branch, a tag, `latest` or a short SHA is not admissible. |
| `AI-21-R02` | **Scope**: an approved lesson carries a `scope` from the governed enum. A lesson with no declared scope is not admissible, because an unscoped lesson silently applies everywhere. |
| `AI-21-R03` | **Expiry is a stated decision**: `expiry` is a required key. An unbounded lesson writes an explicit `null`; it never omits the key, and it never writes the empty string. |
| `AI-21-R04` | **Supersession is a stated decision**: `superseded_by` is a required key. An unreplaced lesson writes an explicit `null`; a lesson whose `status` is `superseded` must name the lesson that replaced it. |
| `AI-21-R05` | **Only a human review approves**: `approved_by` is non-empty exactly when `status` is `approved` and `null` when `status` is `proposed` or `rejected`. No agent approves its own lesson (`AI-TOOL-06`). |
| `AI-21-R06` | **The brain is a knowledge repository, not a runtime**: it is never declared as the orchestration runtime and is never counted as a provider (`AI-TOOL-13`). |
| `AI-21-R07` | **The brain is pinned**: its manifest entry pins an exact 40-character commit. Falling back to `latest`, a branch or another repository is prohibited (`AI-TOOL-11`). |
| `AI-21-R08` | **The brain's boundary is declared**: role, source-of-truth boundary, permissions, health check and rollback are declared rather than implied, so "present" cannot be read as "integrated, enabled or blocking" (`AI-TOOL-01`). |
| `AI-21-R09` | **No PII and no credentials**: a lesson, the seed and the schema carry no personal data, token, credential or production payload (`AI-TOOL-06`). |
| `AI-21-R10` | **The schema is binding, not decorative**: a field the schema requires cannot be dropped without a violation, and a schema whose requirement is removed must be detectable as weaker. `AC-AI-21-06` asserts this about the schema itself. |

## UI states

Not applicable; this Work Item has no user-facing screen. Operator-facing output is the stdout of the acceptance scripts under `tools/ai-brain/acceptance/ac-21-*.js`, and the `status` a lesson carries: `proposed` — recorded, not yet trusted; `approved` — human-reviewed and admissible; `superseded` — retained for provenance, replaced by a named lesson; `rejected` — recorded as not admitted.

## API, event and data impact

- New data contract, not a runtime API: the lesson record with the eleven required keys above, and its four-state lifecycle. The store lives in the `shipde-brain` repository; this repository holds the schema and its conformance seed.
- `tools/ecosystem-manifest.json` is not modified by this Work Item; the `shipde-brain` entry's declared surface becomes asserted by `AC-AI-21-07`.
- No database migration, no REST or event contract, no carrier integration, and no change to the delivery register's schema.
- The schema deliberately stays inside the JSON Schema subset documented in `tools/ai-brain/acceptance/lib/lesson-schema.js`, because no validator dependency is installed.

## Acceptance matrix

| AC/Test ID | Scenario | Exact command to run | Exit code | Expected output string | File / artifact |
|---|---|---|---|---|---|
| `AC-AI-21-01` | Control table status and delivery register row 154 cannot diverge | `node tools/ai-brain/acceptance/ac-21-01-status-alignment.js` | `0` | `Control status matches register row 154: BLOCKED_DEPENDENCY (declared TASK-AI-21)` | `docs/product-spec/work-items/TASK-AI-21.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-21-01-status-alignment.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js` |
| `AC-AI-21-02` | **Negative proof, must fail:** a tampered copy of the real specification diverges from the real register, and the comparison `AC-AI-21-01` runs detects it | `node tools/ai-brain/acceptance/ac-21-02-status-divergence.js` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` | `tools/ai-brain/acceptance/ac-21-02-status-divergence.js`, `tools/ai-brain/acceptance/lib/spec-status-alignment.js`; command stderr |
| `AC-AI-21-03` | The real lesson schema admits every lesson in the real conformance seed | `node tools/ai-brain/acceptance/ac-21-03-lesson-schema.js` | `0` | `LESSON_SCHEMA_HOLDS: every seeded lesson is admitted by lesson-schema.json` | `tools/ai-brain/lessons/lesson-schema.json`, `tools/ai-brain/lessons/lesson-seed.json`, `tools/ai-brain/acceptance/ac-21-03-lesson-schema.js`, `tools/ai-brain/acceptance/lib/lesson-schema.js` |
| `AC-AI-21-04` | **Negative proof, must fail:** a copy of the real seed whose approved lesson has lost `source_commit` is refused by the same rule `AC-AI-21-03` runs | `node tools/ai-brain/acceptance/ac-21-04-lesson-record-inadmissible.js` | `1` | `LESSON_INADMISSIBLE: LESSON-MANIFEST-TRUTH missing source_commit is not admissible as an approved lesson` | `tools/ai-brain/lessons/lesson-seed.json`, `tools/ai-brain/acceptance/ac-21-04-lesson-record-inadmissible.js`, `tools/ai-brain/acceptance/lib/lesson-schema.js`; command stderr |
| `AC-AI-21-05` | The real lesson schema requires `source_commit`, `scope`, `expiry` and `superseded_by` for an approved lesson | `node tools/ai-brain/acceptance/ac-21-05-lesson-requirement.js` | `0` | `LESSON_REQUIREMENT_HOLDS: an approved lesson must carry source_commit, scope, expiry, superseded_by` | `tools/ai-brain/lessons/lesson-schema.json`, `tools/ai-brain/acceptance/ac-21-05-lesson-requirement.js`, `tools/ai-brain/acceptance/lib/lesson-schema.js` |
| `AC-AI-21-06` | **Negative proof, must fail:** a copy of the real schema with the approved-lesson requirement removed is refused, and the copy is shown to admit a lesson the real schema rejects | `node tools/ai-brain/acceptance/ac-21-06-lesson-requirement-missing.js` | `1` | `LESSON_REQUIREMENT_MISSING: source_commit is not required for an approved lesson` | `tools/ai-brain/lessons/lesson-schema.json`, `tools/ai-brain/acceptance/ac-21-06-lesson-requirement-missing.js`, `tools/ai-brain/acceptance/lib/lesson-schema.js`; command stderr |
| `AC-AI-21-07` | The real ecosystem manifest declares `shipde-brain` as a governed knowledge repository | `node tools/ai-brain/acceptance/ac-21-07-brain-repository-contract.js` | `0` | `BRAIN_REPOSITORY_CONTRACT_HOLDS: shipde-brain is declared as a governed knowledge repository in tools/ecosystem-manifest.json` | `tools/ecosystem-manifest.json`, `tools/ai-brain/acceptance/ac-21-07-brain-repository-contract.js`, `tools/ai-brain/acceptance/lib/brain-repository-contract.js` |
| `AC-AI-21-08` | **Negative proof, must fail:** copies of the real manifest with the brain entry repointed at another repository or pinned to a movable ref are refused by the same contract `AC-AI-21-07` runs | `node tools/ai-brain/acceptance/ac-21-08-brain-repository-overstated.js` | `1` | `BRAIN_REPOSITORY_UNPINNED: shipde-brain is pinned to "latest" rather than a 40-character commit` | `tools/ecosystem-manifest.json`, `tools/ai-brain/acceptance/ac-21-08-brain-repository-overstated.js`, `tools/ai-brain/acceptance/lib/brain-repository-contract.js`; command stderr |
| `AC-AI-21-09` | Dependency delivered: register row 154 declares `TASK-AI-17`, and `TASK-AI-17`'s own deliverable is present on `origin/main` and satisfies its own rule there | `node tools/ai-brain/acceptance/ac-21-09-dependency-delivered.js` | `0` | `TASK-AI-17 dependency verified: delivered on origin/main for TASK-AI-21` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ecosystem-manifest.json`, `tools/ai-brain/acceptance/ac-21-09-dependency-delivered.js`, `tools/ai-brain/acceptance/lib/dependency-delivered.js` |
| `AC-AI-21-10` | **Negative proof, must fail:** a copy of the real register naming a dependency with no merge commit is refused, and a copy of the dependency's real artifact that violates its own rule is refused by the second half of the same rule | `node tools/ai-brain/acceptance/ac-21-10-dependency-unproven.js` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` | `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-21-10-dependency-unproven.js`, `tools/ai-brain/acceptance/lib/dependency-delivered.js`; command stderr |
| `AC-AI-21-11` | Toolchain suite invariant green with 0 failures | `node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js` | `0` | `AC-AI-08-07 suite invariant held: fail 0 with` | `tools/ai-brain/acceptance/ac-08-07-suite-invariant.js`; test runner stdout |
| `AC-AI-21-12` | Manifest truth audit green with 0 errors | `node tools/ai-brain/cli.js manifest` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-21-13` | Delivery register reconciliation green with 0 errors | `node tools/ai-brain/cli.js reconcile` | `0` | `Tổng: 0 lỗi` | `tools/ai-brain/cli.js stdout` |
| `AC-AI-21-14` | Specification and documentation validation passes with 0 errors | `python docs/product-spec/scripts/validate_docs.py` | `0` | `Documentation validation passed:` | `docs/product-spec/scripts/validate_docs.py stdout` |
| `AC-AI-21-15` | Incremental code and document formatting check green | `pnpm format:check` | `0` | `✅ Hoàn tất:` | `scripts/verify-formatting.ts stdout` |
| `AC-AI-21-16` | Secret surface guard reports no leakable secret | `node tools/ai-guard/cli.js secret-surface` | `0` | `SECRET_SURFACE_CLEAN` | `tools/ai-guard/cli.js stdout` |
| `AC-AI-21-17` | The five negative proofs of this Work Item fail operationally (exit 2), not as findings (exit 1), when run outside the repository | `node tools/ai-brain/acceptance/ac-21-17-outside-repository.js` | `0` | `OUTSIDE_REPOSITORY_PROBE: 5 negative proofs exited 2 with SOURCE_MISSING outside the repository` | `tools/ai-brain/acceptance/ac-21-17-outside-repository.js`; command stdout |

### Evidence notes for the invariant rows

`AC-AI-21-01`, `-03`, `-05`, `-07`, `-09`, `-11`, `-12`, `-13`, `-14` and `-15` assert invariants — "the Control table agrees with the register", "every seeded lesson is admitted", "the schema requires the four fields", "fail 0", "0 lỗi", a passing validator — never exact totals, because this Work Item itself adds a markdown specification file, a schema, a seed and eleven acceptance scripts, so any pinned count is stale on arrival. The counts below are recorded as evidence of the observed baseline only; a change in any of them does not falsify the corresponding acceptance row, and no row may be rewritten to assert them.

| Row | Asserted invariant | Observed baseline (evidence only, not asserted) |
|---|---|---|
| `AC-AI-21-03` | every seeded lesson is admitted by the real schema | `6` seeded lessons: `4` approved, `1` superseded, `1` proposed |
| `AC-AI-21-11` | `fail 0` in the test runner summary, with `tests > 0` and `suites > 0` | `641` tests across `140` suites at the time of writing |
| `AC-AI-21-12` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js manifest` | Exactly one expected warning (`PINNED_VERSION_DRIFT` for `codex-cli`); warning and note totals are deliberately unpinned |
| `AC-AI-21-13` | `Tổng: 0 lỗi` from `node tools/ai-brain/cli.js reconcile` | `178` delivery register rows reconciled at the time of writing |
| `AC-AI-21-14` | `Documentation validation passed:` from `validate_docs.py` | `98` markdown files, `130` feature IDs, `178` delivery rows at the pre-implementation baseline |
| `AC-AI-21-15` | `✅ Hoàn tất:` from `scripts/verify-formatting.ts` | The scanned file count is deliberately unpinned |

`AC-AI-21-11` runs the suite-invariant script already committed by `TASK-AI-08` rather than adding a fourth private copy of the three test globs and the `fail 0` rule. That rule is owned by `tools/ai-brain/acceptance/ac-08-07-suite-invariant.js`; this Work Item consumes the gate and adds none.

## Verification commands

```bash
# 1. Control-table / register alignment for TASK-AI-21
node tools/ai-brain/acceptance/ac-21-01-status-alignment.js

# 2. Negative proof: a tampered specification copy diverges and is detected
node tools/ai-brain/acceptance/ac-21-02-status-divergence.js

# 3. The real schema admits the real conformance seed
node tools/ai-brain/acceptance/ac-21-03-lesson-schema.js

# 4. Negative proof: an approved lesson without source_commit is refused
node tools/ai-brain/acceptance/ac-21-04-lesson-record-inadmissible.js

# 5. The real schema requires the four fields for an approved lesson
node tools/ai-brain/acceptance/ac-21-05-lesson-requirement.js

# 6. Negative proof: a schema with the requirement removed is refused
node tools/ai-brain/acceptance/ac-21-06-lesson-requirement-missing.js

# 7. The real manifest declares shipde-brain as a governed knowledge repository
node tools/ai-brain/acceptance/ac-21-07-brain-repository-contract.js

# 8. Negative proof: a repointed or unpinned brain entry is refused
node tools/ai-brain/acceptance/ac-21-08-brain-repository-overstated.js

# 9. Dependency delivered: TASK-AI-17's deliverable on origin/main
node tools/ai-brain/acceptance/ac-21-09-dependency-delivered.js

# 10. Negative proof: an undelivered dependency, and an artifact violating its own rule, are refused
node tools/ai-brain/acceptance/ac-21-10-dependency-unproven.js

# 11. Toolchain suite invariant (fail 0, and the suites really ran)
node tools/ai-brain/acceptance/ac-08-07-suite-invariant.js

# 12. Manifest truth audit
node tools/ai-brain/cli.js manifest

# 13. Register reconciliation audit
node tools/ai-brain/cli.js reconcile

# 14. Specification structural validation
python docs/product-spec/scripts/validate_docs.py

# 15. Code formatting verification
pnpm format:check

# 16. Secret surface guard
node tools/ai-guard/cli.js secret-surface

# 17. Outside-repository probe: every negative proof exits 2, never 1
node tools/ai-brain/acceptance/ac-21-17-outside-repository.js
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Specification authored for TASK-AI-21: create the shipde-brain repository and lesson schema. The register records `BLOCKED_DEPENDENCY`, so under the status transition ledger above this item is not stage-eligible for review routing and no verdict is claimed. |

## Acceptance matrix validation

Written `2026-09-16`. Every row was executed against this branch before the
matrix was committed: the twelve non-negative rows produced their stated exit code
and expected string, and the five negative proofs produced exit `1` with their
stated string. Each negative proof reads a **real** repository file, proves the
untouched source is accepted as a CONTROL, tampers a **copy** under `os.tmpdir()`,
and asserts the same check rejects the copy. Each exits `2`, not `1`, when its real
source is missing; `AC-AI-21-17` measures that for all five at once.

| Row | Negative proof of which rule | CONTROL (real input accepted) | Tamper (copy) | Rejection |
|---|---|---|---|---|
| `AC-AI-21-02` | status alignment `AC-AI-21-01` | real `TASK-AI-21.md` agrees with real register row 154 | `Status` cell flipped to `READY_FOR_AUTHOR` in a copy | `STATUS_DIVERGENCE_DETECTED`, exit `1` |
| `AC-AI-21-04` | lesson admission `AC-AI-21-03` | the real seed is admitted by the real schema | `source_commit` deleted from the approved lesson `LESSON-MANIFEST-TRUTH` in a seed copy | `LESSON_INADMISSIBLE`, exit `1` |
| `AC-AI-21-06` | approved-lesson requirement `AC-AI-21-05` | the real schema requires all four fields for an approved lesson | `source_commit` removed from `required` and from the approved `then.required` in a schema copy | `LESSON_REQUIREMENT_MISSING`, exit `1` |
| `AC-AI-21-08` | brain repository contract `AC-AI-21-07` | the real manifest satisfies the contract | pin replaced by `latest`, and the repository repointed at `someone-else/notes`, in two manifest copies | `BRAIN_REPOSITORY_UNPINNED`, exit `1` |
| `AC-AI-21-10` | dependency delivered `AC-AI-21-09` | the real register's dependency is delivered on `origin/main` | the row's `dependencies` cell repointed at `TASK-AI-99` in a register copy, and `trivy` flipped back to `ADOPTED` in a copy of the dependency's real artifact | `DEPENDENCY_UNPROVEN`, exit `1` |

The matrix was then extracted from this table cell by cell and re-run as stored,
to prove no row's command is mangled by the table: all `17` of the `17` rows
passed with their stated exit code and expected string.

Three defect classes were removed while validating the matrix, each of which this
repository has already had to repair once:

1. **The rules live in one module each, not in the rows or in the schema prose.**
   `AC-AI-21-01`/`-02` share `tools/ai-brain/acceptance/lib/spec-status-alignment.js`
   (the module `TASK-AI-08` and `TASK-AI-09` already share), `-03`/`-04` and
   `-05`/`-06` share `lib/lesson-schema.js`, `-07`/`-08` share
   `lib/brain-repository-contract.js`, and `-09`/`-10` share
   `lib/dependency-delivered.js`. None of the scripts restates a rule it exercises.
2. **No command is stored inside a table cell.** The lesson rules need a JSON
   Schema subset evaluator and the brain rules need a nine-field declaration
   surface; stored inline, both would reach Node mangled, and a `SyntaxError`
   exits `1`, which is the code a negative row expects. Every row is therefore a
   committed script under `tools/ai-brain/acceptance/`.
3. **The negative proofs fail closed outside the repository.** `AC-AI-21-17`
   spawns all five from an empty temporary directory and requires exit `2` with
   the `SOURCE_MISSING` line naming the real file each one could not read. A proof
   that dies for an unrelated reason cannot be mistaken for a detection.

One real defect was found in a rule this Work Item re-uses, and closed here
rather than inherited. `tools/ai-brain/acceptance/lib/dependency-merged.js` proves
a Work Item is merged when any commit reachable on `origin/main` names it in its
message. Measured on the current tip, `git log origin/main --grep=TASK-AI-17`
matches commits from `TASK-AI-20` and `TASK-AI-33` that merely name `TASK-AI-17`
as a dependency, so the commit-name half alone cannot distinguish a delivered
Work Item from a referenced one. `lib/dependency-delivered.js` therefore requires
a **second** half — the dependency's declared artifact, read out of `origin/main`
with `git show`, must satisfy the dependency's own rule there — and re-exports the
original rule rather than replacing it. `AC-AI-21-08` exercises both halves.

## Coupling proof for the shared rules

Each pair was mutated through the shared module alone, without touching either
script, and both rows were re-run. Every module was restored from a file backup
afterwards (copied to a temporary path with `cp` and copied back; no
`git checkout --` was run against uncommitted work), and each restored file was
verified byte-identical to its backup.

Baseline, with all modules intact:

| Row | Exit | Output |
|---|---|---|
| `AC-AI-21-01` | `0` | `Control status matches register row 154: BLOCKED_DEPENDENCY (declared TASK-AI-21)` |
| `AC-AI-21-02` | `1` | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` |
| `AC-AI-21-03` | `0` | `LESSON_SCHEMA_HOLDS: every seeded lesson is admitted by lesson-schema.json` |
| `AC-AI-21-04` | `1` | `LESSON_INADMISSIBLE: LESSON-MANIFEST-TRUTH missing source_commit is not admissible as an approved lesson` |
| `AC-AI-21-05` | `0` | `LESSON_REQUIREMENT_HOLDS: an approved lesson must carry source_commit, scope, expiry, superseded_by` |
| `AC-AI-21-06` | `1` | `LESSON_REQUIREMENT_MISSING: source_commit is not required for an approved lesson` |
| `AC-AI-21-07` | `0` | `BRAIN_REPOSITORY_CONTRACT_HOLDS: shipde-brain is declared as a governed knowledge repository in tools/ecosystem-manifest.json` |
| `AC-AI-21-08` | `1` | `BRAIN_REPOSITORY_UNPINNED: shipde-brain is pinned to "latest" rather than a 40-character commit` |
| `AC-AI-21-09` | `0` | `TASK-AI-17 dependency verified: delivered on origin/main for TASK-AI-21` |
| `AC-AI-21-10` | `1` | `DEPENDENCY_UNPROVEN: TASK-AI-99 has no merge commit reachable on origin/main` |

Mutation results. In five of the six mutations the invariant row stayed green while
its negative proof went red, which is the reading that matters: the invariant row
alone cannot tell a live rule from a dead one. The third mutation is the exception
and is reported as measured — the requirement detector's own non-vacuity control
catches the emptied rule, so both rows fail.

| Mutation (shared module only) | Invariant row | Negative proof | Reading |
|---|---|---|---|
| `spec-status-alignment.js`: the divergence check is disabled | `AC-AI-21-01` exit `0` (unchanged) | `AC-AI-21-02` exit `0`, prints `DIVERGENCE_NOT_DETECTED` | The proof **fails**: the pair agrees while the rule is dead |
| `lesson-schema.js`: `matchesViolations` reports no violation | `AC-AI-21-03` exit `0` (unchanged) | `AC-AI-21-04` exit `0`, prints `INADMISSIBLE_LESSON_NOT_DETECTED` | The proof **fails**: the schema admits anything while the admission row stays green |
| `lesson-schema.js`: `approvedRequirementViolations` reports nothing | `AC-AI-21-05` exit `2` (`CONTROL_FAILED: the requirement detector cannot report missing requirements`) | `AC-AI-21-06` exit `0`, prints `LESSON_REQUIREMENT_MISSING_NOT_DETECTED` | Both **fail**: the detector's own control catches the empty rule and the proof can no longer reject |
| `brain-repository-contract.js`: the unpinned check removed | `AC-AI-21-07` exit `0` (unchanged) | `AC-AI-21-08` exit `2`, prints `CONTROL_FAILED: the contract accepted a brain pinned to a movable ref` | The proof **fails**: with the rule dead it cannot demonstrate a refusal |
| `dependency-merged.js`: `dependencyProven` proves every dependency | `AC-AI-21-09` exit `0` (unchanged) | `AC-AI-21-10` exit `2`, prints `SOURCE_MISSING: no declared deliverable rule for TASK-AI-99` | The proof **fails**, and the failure is the second half firing — evidence that `dependency-delivered.js` re-exports this module by reference |
| `dependency-delivered.js`: `deliverableAtOriginMain` accepts every artifact | `AC-AI-21-09` exit `0` (unchanged) | `AC-AI-21-10` exit `2`, prints `CONTROL_FAILED: the deliverable rule accepted a copy that violates its own rule` | The proof **fails**: the deliverable half is falsifiable, not decorative |

## Residual limitations

- **The repository itself is not created by this Work Item.** `shipde-brain` is a
  GitHub repository, and creating it, protecting it and giving it CI is a human
  action outside Git. This Work Item delivers the schema, the conformance seed and
  the manifest contract the repository must satisfy; until the repository exists,
  the seed is a conformance artifact and **no lesson is live**.
- **The promotion gate is `TASK-AI-22`.** Nothing here prevents an agent from
  writing a lesson with `status: proposed`; `AI-21-R05` states that only a human
  review may set `approved_by`, and `AC-AI-21-03` and `AC-AI-21-05` assert that a
  record cannot be approved without one, but the governed transition itself is owned by
  `TASK-AI-22`.
- **No JSON Schema validator is installed**, so the acceptance rows apply a
  committed, named subset — `type`, `enum`, `const`, `pattern`, `minLength`,
  `required`, `properties`, `additionalProperties: false`, `items`, `allOf` and
  `if`/`then`/`else`. A keyword outside that subset would be ignored by
  `AC-AI-21-03` while still being valid JSON Schema, so the schema deliberately
  stays inside the subset. Adding a validator dependency is out of scope.
- **Delivery register row 154 displays `BLOCKED_DEPENDENCY`** while `TASK-AI-17`'s
  deliverable is already on `origin/main` and register row 150 still reads
  `READY_FOR_CODEX`. The Control table stays strictly aligned to the register under
  `AGENTS.md` § Unit of delivery; clearing the block is the governed reconciler's
  job, not a manual write. `AC-AI-21-09` therefore proves the dependency from the
  repository and the merged tree; it does not assert the register status.
- **Two row-numbering conventions disagree in this directory.** `TASK-AI-07` and
  `TASK-AI-08` call the register's `delivery_order` column the "row"; `TASK-AI-17`
  numbers by physical CSV line. Measured: `TASK-AI-17` is `delivery_order` 150 and
  physical line 152, and physical line 154 is `TASK-AI-19`, not `TASK-AI-21`. This
  file uses `delivery_order` and names the `work_item_id` alongside every row
  number so the two cannot be confused. The divergence is recorded rather than
  repaired, because renumbering another Work Item's prose is not this one's scope.
- **The commit-name half of the dependency rule is weaker than it looks**, as
  measured under Acceptance matrix validation. This Work Item closes the gap for
  its own row by adding the deliverable half; a Work Item that calls
  `dependencyProven` on its own, without `deliverableAtOriginMain`, still inherits
  the weaker rule. Migrating the remaining callers (`ac-07-06`, `ac-08-03`,
  `ac-08-04`, `ac-09-03`, `ac-09-04`) to the two-half rule belongs to those Work
  Items, one Pull Request each.
