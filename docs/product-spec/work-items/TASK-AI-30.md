# TASK-AI-30 — Connection test that writes qualification results

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-30` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `163` |
| Dependencies | `TASK-AI-29` |
| Assigned author | `CLAUDE` |
| Risk | `HIGH` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-30.md`, `tools/ai-brain/qualification.js`, `tools/ai-brain/test/qualification.test.js`, `tools/ai-brain/acceptance/ac-30-*.js`, `tools/ai-brain/acceptance/lib/qualification.js`, `tools/ai-brain/acceptance/lib/dependency-declared.js`, `tools/ai-brain/cli.js`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-30` |
| Pull Request | `#87` (open, not merged; merge is human-only) |

### Status transition ledger

Register `FEATURE-DELIVERY-REGISTER.csv` `delivery_order` `163` (`work_item_id` `TASK-AI-30`) is authoritative under `AGENTS.md` Unit of delivery. It records `BLOCKED_DEPENDENCY`; the Control table records the same value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | Register `delivery_order` `163`, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Binding: this file must never declare `READY_FOR_CODEX` or later while the register records `BLOCKED_DEPENDENCY`; the Codex review record below is therefore `NOT_REVIEWED`. The block is the register's, not Git's: register row `162` (`work_item_id` `TASK-AI-29`) still records `BLOCKED_DEPENDENCY` with empty `pr` and empty `merge_commit`, so the queue carries no recorded delivery for the dependency and `AC-AI-30-03` asserts only the declared dependency name, never a merge. Conflict recorded, not silently resolved (`AGENTS.md` § Source of truth): `git log origin/main --grep=TASK-AI-29` returns two commits — `af16a1f` (PR #68, the specification, merged 2026-09-16) and `cd3cfd8` (PR #99, the implementation, merged 2026-09-17) — and the existing `acceptance/lib/dependency-merged.js` reports merge evidence from them (`dependencyProven('TASK-AI-29')` returns `ok: true` with 2 commits at the time of writing). The register governs the stage and the unreconciled row is the reconciler's to close, not this item's (`Do NOT touch … the register status column`); `cd3cfd8` is also not an ancestor of this branch, whose merge-base with `origin/main` is `a3f3e69`. The `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written by the governed reconciler (`TASK-AI-19`) before review routing. `AC-AI-30-01` compares the Control `Status` cell against register row `163` and fails on divergence.

**Row numbering.** This file cites the register's own `delivery_order` column (`163`) and names the `work_item_id` (`TASK-AI-30`) alongside it. The physical CSV line is `165`; header is line `1`.

## Business outcome

Registering an account (`TASK-AI-29`) puts a model on the books. Nothing yet answers the next question: can this model actually do work, and what is it qualified to do? Today the answer is assumed. `seed-accounts.js` declares every `codingGrade` as PROVISIONAL ("Nothing here has been measured"), and `fitness.js gradeOf` defaults an ungraded model to `STANDARD`, so a model nobody has probed is trusted with ordinary work by omission.

Two shipped consumers already wait for a measured answer, and both name this probe:

1. The capability gate is written but has nothing to read. `capabilities.js disqualify` refuses an account whose `qualifiedRoles` array does not name the role, with the comment "Promptfoo results are meant to write this field". No code writes it, so the field stays absent and the gate stays open.
2. The grade ladder is provisional. `offerings.js expandOfferings` inherits `qualifiedRoles` account-to-offering and defaults unrated `quality` to `50`, noting "Promptfoo results are meant to write this". `TASK-AI-27` leaves the probe to this item and consumes the outcomes it produces.

The register key behaviour — probe a newly added model and record what it is qualified to do — delivers a bounded connection test: a real request through the account's own launch path, recorded as a qualification result stored at a stable, readable location for a later item to consume. It does not promote, grade, or open any role, and it does not itself wire that result into `capabilities.disqualify`'s unrelated `qualifiedRoles` read: taking a role on a passing probe is `TASK-AI-31`, deriving a grade is `TASK-AI-27`, review grading is `TASK-AI-41`.
## Source references

- `AGENTS.md` Unit of delivery — one Work Item per branch and PR; status flow from `BACKLOG`.
- `AGENTS.md` Source of truth — specifications govern; code is evidence only.
- `AGENTS.md` Role separation — constrained author stops at auth, money, carrier effects.
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md` — section list followed.
- `FEATURE-DELIVERY-REGISTER.csv` `delivery_order` `163` — registers `TASK-AI-30`, `BLOCKED_DEPENDENCY`, dependency `TASK-AI-29`, key behaviour "Probe a newly added model and record what it is qualified to do".
- `tools/ai-brain/capabilities.js` — `disqualify` qualifiedRoles refusal; role table and `mayWriteCode`.
- `tools/ai-brain/offerings.js` — `expandOfferings` qualifiedRoles inheritance; unrated quality `50`.
- `tools/ai-brain/fitness.js` — `gradeOf` STANDARD default; quality never decides grade.
- `tools/ai-brain/accounts.js` — registry/encrypted-secret split; `listAccounts` presence flag.
- `tools/ai-brain/refresh-quota.js` — `READERS` antigravity + claude-code only; unsupported skipped.
- `tools/ai-brain/quota-store.js` — cache freshness and identity check; failures cached briefly.
- `tools/ai-brain/agy-identity.js` — `sameAccount` false on any unknown; switch forces reread.
- `scripts/ai/doctor.ps1` — `Invoke-ShipDeBoundedProbe`; cheapest-model probe; cached verdict; 2026-09-14 pool drain.
- `TASK-AI-29.md` Out of scope — probe and qualification record belong to `TASK-AI-30`.
- `TASK-AI-27.md` Out of scope — probe outcomes belong to `TASK-AI-30`.
- `AI-TOOL-10` — failed or partial operation reports exact state, never healthy.

## Preconditions and dependencies

- Prerequisite `TASK-AI-29` is declared by register row `163`, and the dependency's own row `162` still records `BLOCKED_DEPENDENCY` with no `pr` and no `merge_commit`: the register proves no delivery, so `AC-AI-30-03` asserts the declaration only. Git is ahead of the register on this point — `origin/main` carries `cd3cfd8` (`[TASK-AI-29] Registering an account no longer means editing a file by hand (#99)`, merged 2026-09-17) — and that conflict is recorded in the Status transition ledger above rather than resolved here. It is also absent from this branch's history: the merge-base with `origin/main` is `a3f3e69`, which predates `cd3cfd8`.
- The entry rule exists: `accounts.validateAccount` plus `limits.resolveLimits` via `acceptance/lib/account-entry.js`; the probe tests accounts the entry rule admits.
- The consumers exist: `capabilities.disqualify` reads `qualifiedRoles`; `expandOfferings` inherits it; `gradeOf` defaults unrated to STANDARD.
- The probe discipline exists: bounded probe with process-tree kill and cheapest-model rule in `scripts/ai/doctor.ps1`; this item moves that discipline into a recorded qualification path.

## Author boundary

`CLAUDE` is the assigned author, per `AGENTS.md` § Role separation ("Claude — analyst, secondary author and reviewer fallback ... authorized to act as ... assistant author for addressing review findings or authoring assigned Work Items"). Scope is strictly bounded: a bounded connection probe and a recorded qualification result inside `tools/ai-brain/` plus this specification. Risk is `HIGH`, not `MEDIUM`, because the probe decrypts a stored credential through `accounts.getSecret` and spends real, if bounded, model budget — both on `AGENTS.md`'s high-risk list. There is no separate approval ledger beyond the standard gate every Work Item already passes through: CI green, an independent Codex review verdict of `PASS`, and human merge (`AGENTS.md` § Role separation, § Unit of delivery); this item invents no additional approval mechanism, and implementation must not either.
Prohibited in this Work Item:

- Do NOT take a role, open `qualifiedRoles`, or grade any model. Gating is `TASK-AI-31`; grading is `TASK-AI-27`; review grading is `TASK-AI-41`.
- Do NOT add a mutating route to the cockpit. `AI15-R09` binds it; the cockpit stays observational.
- Do NOT write `accounts.registry.json` or `accounts.secrets.enc` except through `accounts.js`.
- Do NOT log or persist a credential, PII, or full probe output. Result records outcome only.
- Do NOT run an unbounded probe. Every probe carries a timeout and kills its process tree; repeats reuse a cached verdict.
- Do NOT probe a provider with no reader. Unsupported providers are skipped with a reason.
- Do NOT touch `.github/`, `scripts/verify-*`, `docs/product-spec/scripts/`, or the register status column.

## In scope

1. Bounded connection probe: real request through the account's own launch path, with timeout, tree kill, cheapest model, cached verdict.
2. Qualification result record: account id, model, instant, outcome (pass/fail/timeout/refused), latency, reason; readable; no credential or prompt text.
3. Result readability contract: the qualification result record lives at a stable, injectable path, keyed by account id and model, so a later item (`TASK-AI-31`) can read it without this item touching `capabilities.js`, `accounts.js`, `offerings.js` or `qualifiedRoles` — none of which is in Allowed paths. This item does not wire the result into `disqualify`; `disqualify`'s `qualifiedRoles` read is a separate, unrelated field this item never writes (`AI-30-R07`), and wiring a probe result into a granted role is `TASK-AI-31`'s job, not this one's.
4. Entry-rule compliance: probed account passes the entry rule; registry stays credential-free.
5. Deterministic unit tests in `tools/ai-brain/test/qualification.test.js` with injected functions; no network, no real registry.
6. Acceptance scripts `ac-30-*.js` sharing one rule module `acceptance/lib/qualification.js`.

## Out of scope

- Promptfoo role gate (`TASK-AI-31`); grades and quality (`TASK-AI-27`, `TASK-AI-41`).
- Ceilings and runway (`TASK-AI-26`); cooldown and step-down (`TASK-AI-28`).
- Entry form and credential storage (`TASK-AI-29` owns; this item consumes).
- Account removal or rotation; cockpit submit; any register write.
## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-30-R01` | **Probe the account's own launch path, never a hand-built request.** `seed-accounts.js` records per-account launch; `doctor.ps1` proves a hand-built request cannot tell a valid credential from an invalid one. Only the real client carries the probe. |
| `AI-30-R02` | **Every probe is bounded.** Timeout, process-tree kill, cheapest model, cached verdict. Repeats within the cache window reuse the verdict instead of spending again (2026-09-14 pool drain). |
| `AI-30-R03` | **Unsupported providers are skipped with a reason, never probed hopefully.** `refresh-quota.js READERS` covers antigravity and claude-code only; an empty result from an unanswerable question is not evidence. |
| `AI-30-R04` | **A failure is recorded as a failure, never as healthy.** Per `AI-TOOL-10`: pass/fail/timeout/refused with latency and reason. A `timeout` outcome is cached like any other verdict (`AI-30-R02`): a repeat within the cache window reuses the cached `timeout` and does not re-spend; "reconciles before retry" means the *next* probe attempted after the cache window expires re-runs the real client rather than assuming the earlier timeout was transient, never a same-window blind retry. |
| `AI-30-R05` | **The result carries no credential, PII, or prompt text.** Registry stays readable per `accounts.js`; credential travels only through `setSecret`/`getSecret`. |
| `AI-30-R06` | **Only entry-admitted accounts are probed.** Account passes `validateAccount` plus `resolveLimits` via the shared entry module; a refused entry is never probed. |
| `AI-30-R07` | **The probe never grants qualification.** It writes an outcome record; it never writes `qualifiedRoles`, grades, or quality. Promotion is `TASK-AI-31`. |

## UI states

N/A — this item makes no screen change; the cockpit is out of scope entirely (see Out of scope). A future item that surfaces this result on the cockpit must follow the read-only rule (`AI15-R09`) and specify its own states at that time; none is specified here to avoid describing a screen this item does not build.
## API, event and data impact

Probe is a local operator command joining the `cli.js` surface (unknown options refused). No HTTP route, no migration, no registry schema change: the result is a separate readable record keyed by account id and model. `qualifiedRoles`, grades, quality untouched. Additive only: dispatch, quota, capability reads unchanged when no result exists.
## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-30-01` | Control Status vs register row 163 | `node tools/ai-brain/acceptance/ac-30-01-status-alignment.js` exit 0 | `Control status matches register row 163` stdout |
| `AC-AI-30-02` | Negative: tampered spec copy diverges | `node tools/ai-brain/acceptance/ac-30-02-status-divergence.js` exit 1 | `STATUS_DIVERGENCE` stderr |
| `AC-AI-30-03` | Declared dependency exactly TASK-AI-29 | `node tools/ai-brain/acceptance/ac-30-03-dependency-declared.js` exit 0 | `TASK-AI-29 dependency declared` stdout |
| `AC-AI-30-04` | Negative: dependency repointed refused | `node tools/ai-brain/acceptance/ac-30-04-dependency-repointed.js` exit 1 | `DEPENDENCY_MISMATCH` stderr |
| `AC-AI-30-05` | Probe rule over seeded accounts | `node tools/ai-brain/acceptance/ac-30-05-probe-rule.js` exit 0 | `PROBE_HOLDS` stdout |
| `AC-AI-30-06` | Negative: unbounded and unsupported refused | `node tools/ai-brain/acceptance/ac-30-06-probe-rule-refused.js` exit 1 | `PROBE_VIOLATED` stderr |
| `AC-AI-30-07` | Result carries outcome, no credential | `node tools/ai-brain/acceptance/ac-30-07-result-credential-free.js` exit 0 | `RESULT_CLEAN` stdout |
| `AC-AI-30-08` | Negative: credential in result refused | `node tools/ai-brain/acceptance/ac-30-08-credential-in-result.js` exit 1 | `CREDENTIAL_IN_RESULT` stderr |
| `AC-AI-30-09` | Negatives exit 2 outside repository | `node tools/ai-brain/acceptance/ac-30-09-outside-repository.js` exit 0 | `OUTSIDE_REPOSITORY_PROBE` stdout |
| `AC-AI-30-10` | Register does not overstate (the row's script wraps `node tools/ai-brain/cli.js reconcile`) | `node tools/ai-brain/acceptance/ac-30-10-cli-surface.js` exit 0 | `Tổng: 0 lỗi` stdout |
| `AC-AI-30-11` | Docs validate (the row's script wraps `python docs/product-spec/scripts/validate_docs.py`) | `node tools/ai-brain/acceptance/ac-30-11-docs-validate.js` exit 0 | `Documentation validation passed` stdout |
| `AC-AI-30-12` | New unit tests pass (the row's script wraps `node --test tools/ai-brain/test/qualification.test.js`) | `node tools/ai-brain/acceptance/ac-30-12-unit-tests.js` exit 0 | `fail 0` stdout |
| `AC-AI-30-13` | No secret surface (the row's script wraps `node tools/ai-guard/cli.js secret-surface`) | `node tools/ai-brain/acceptance/ac-30-13-secret-surface.js` exit 0 | `SECRET_SURFACE_CLEAN` stdout |

Each row is a runnable command, read against the exit code and marker stored in its own cells rather than as "exit 0 is green": the four invariant rows (`01`, `03`, `05`, `07`) exit `0` while their rule holds, `1` when it is violated and `2` when it cannot be measured; the four negative proofs (`02`, `04`, `06`, `08`) exit `1` on the refusal each stores and move to `0` on a not-detected marker (`DIVERGENCE_NOT_DETECTED`, `DEPENDENCY_WRONG_DECLARED`, `PROBE_VIOLATION_NOT_DETECTED`, `CREDENTIAL_IN_RESULT_NOT_DETECTED`) the moment a shared rule stops refusing — for the two `qualification.js` pairs the invariant row then moves to `2` on `CONTROL_FAILED`, while for the two register-backed pairs the invariant row legitimately stays at `0` because the real input really is aligned and declared, which is why the negative is the load-bearing proof there; the four wrapping rows (`10` to `13`) exit `0` only when the audit they wrap reports its own clean marker, `1` when that audit fails and `2` when its subject is missing. Invariant rows assert markers, never pinned counts, since this item adds one spec file, thirteen acceptance scripts, two shared rule modules, the runtime qualification module and its test file: eighteen new files in total, the same eighteen that `git diff --diff-filter=A origin/main...HEAD` counts. Twelve of the thirteen rows also refuse operationally (`2`, with a `SOURCE_MISSING` line) when run with no repository on disk, so a row cannot report success where nothing exists; `AC-AI-30-09` is the deliberate exception, exiting `0` because its subject is the four negative proofs, which it runs itself with a fresh temporary working directory — a non-zero exit there would mean the measurement failed, not that the proofs held. Negative rows pair with one shared rule module (`acceptance/lib/qualification.js`) required by both sides; the status pair reuses the existing `lib/spec-status-alignment.js`. The dependency pair (`AC-AI-30-03`/`04`) introduces a new module, `acceptance/lib/dependency-declared.js` (in Allowed paths), rather than reusing `lib/dependency-merged.js` or `lib/dependency-delivered.js`: both of those existing modules assert merge evidence via Git, while this pair — per the Preconditions section above — asserts only that the register's declared dependency name is exactly `TASK-AI-29`, deliberately never a merge claim, because the register records no delivery for it (row `162` is still `BLOCKED_DEPENDENCY` with empty `pr` and empty `merge_commit`) even though `origin/main` carries `cd3cfd8` unreconciled into the register, as the Status transition ledger and the Preconditions section above both record. Outside-repository behaviour is measured by `AC-AI-30-09`.
## Verification commands

```bash
# The thirteen acceptance rows above, in order.
node tools/ai-brain/acceptance/ac-30-01-status-alignment.js
node tools/ai-brain/acceptance/ac-30-02-status-divergence.js
node tools/ai-brain/acceptance/ac-30-03-dependency-declared.js
node tools/ai-brain/acceptance/ac-30-04-dependency-repointed.js
node tools/ai-brain/acceptance/ac-30-05-probe-rule.js
node tools/ai-brain/acceptance/ac-30-06-probe-rule-refused.js
node tools/ai-brain/acceptance/ac-30-07-result-credential-free.js
node tools/ai-brain/acceptance/ac-30-08-credential-in-result.js
node tools/ai-brain/acceptance/ac-30-09-outside-repository.js
node tools/ai-brain/acceptance/ac-30-10-cli-surface.js
node tools/ai-brain/acceptance/ac-30-11-docs-validate.js
node tools/ai-brain/acceptance/ac-30-12-unit-tests.js
node tools/ai-brain/acceptance/ac-30-13-secret-surface.js

# The repo-level audits rows 10-13 wrap, run directly and wider than the rows do.
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
node --test 'tools/ai-brain/test/*.test.js'
node tools/ai-guard/cli.js secret-surface
```

## Acceptance matrix validation

Written 2026-09-18 on branch `spec/task-ai-30`, on top of the harness commit `88b7093`. Every row below was re-run **exactly as stored in the matrix above** — command text, exit code and evidence marker read from the table cells, not from a re-typed copy — and each was compared against what the row actually printed. No row asserts a pinned count, so the totals recorded here are evidence of one run, not a condition any row enforces. Re-verified 2026-09-19 at head `a494a3b` — thirteen of thirteen rows matching, and the whole `tools/ai-brain/test` suite (`node --test 'tools/ai-brain/test/*.test.js'`) exiting 0 with 406 of 406 passing, while `AC-AI-30-12` itself runs only `test/qualification.test.js` and asserts `fail 0` with a positive count, never a pinned total — and re-verified again after the Prettier-only reformat of the seven added `.js` files that CI's `pnpm format:check` refused at that head (`qualification.js`, `test/qualification.test.js`, `acceptance/lib/qualification.js`, `ac-30-03`, `ac-30-04`, `ac-30-09`, `ac-30-12`): that reformat joined over-wrapped lines and did nothing else, changing no behaviour, no exit code and no marker, with every row re-read from this table's own cells afterwards. Re-verified a third time on 2026-09-19 at head `26589d8`, after the last edit to this file, by a pass that re-ran the same harnesses from scratch: `MATRIX_ROWS=13 MISMATCHES=0`; `OUTSIDE_ROWS=13 REFUSED_WITH_2=12` (only `AC-AI-30-09` exits `0` outside the repository, by design); each of the four falsifiability stubs re-applied to its shared module, re-run and reverted with the restored file byte-identical (`MUTATION_DEVIATIONS=0`); Prettier over the committed blob of each of the seventeen added `.js` files `UNFORMATTED_COUNT=0`, matching `pnpm format:check` green over the same seventeen files; `node --test 'tools/ai-brain/test/*.test.js'` `406` of `406` with `fail 0`; `python docs/product-spec/scripts/validate_docs.py` passed; `node tools/ai-brain/cli.js reconcile` `Tổng: 0 lỗi`. The same pass corrected the `#87` description, which still described this branch as documentation-only with the dependency undelivered — both contradicted by this head.

| Row | Stored command exit | Marker observed in `stdout`/`stderr` |
|---|---|---|
| `AC-AI-30-01` | 0 | `Control status matches register row 163: BLOCKED_DEPENDENCY (declared TASK-AI-30)` |
| `AC-AI-30-02` | 1 | `STATUS_DIVERGENCE_DETECTED: tampered copy READY_FOR_AUTHOR != register BLOCKED_DEPENDENCY` (`stderr`) |
| `AC-AI-30-03` | 0 | `TASK-AI-29 dependency declared for TASK-AI-30 (name only, no merge claim)` |
| `AC-AI-30-04` | 1 | `DEPENDENCY_MISMATCH: repointed copy declares TASK-AI-99 != expected TASK-AI-29` (`stderr`) |
| `AC-AI-30-05` | 0 | `PROBE_HOLDS: compliant injected probe configuration accepted` |
| `AC-AI-30-06` | 1 | `PROBE_VIOLATED:` listing timeout, kill, model, cache, entry, provider and recording failures (`stderr`) |
| `AC-AI-30-07` | 0 | `RESULT_CLEAN: well-formed result carries no credential` |
| `AC-AI-30-08` | 1 | `CREDENTIAL_IN_RESULT: result carries the credential` (`stderr`) |
| `AC-AI-30-09` | 0 | `OUTSIDE_REPOSITORY_PROBE: 4 negative proofs exited 2 with SOURCE_MISSING outside the repository` |
| `AC-AI-30-10` | 0 | `Tổng: 0 lỗi — register does not overstate (reconciler ran green)` |
| `AC-AI-30-11` | 0 | `Documentation validation passed (validate_docs.py ran green)` |
| `AC-AI-30-12` | 0 | `AC-AI-30-12 unit tests passed: fail 0` with the observed passing total |
| `AC-AI-30-13` | 0 | `SECRET_SURFACE_CLEAN — ai-guard secret-surface ran green` |

### Negative proofs

Each negative proof rejects a tampered copy of real input and is paired with the invariant row that accepts the real input, so a proof that rejects everything and a rule that rejects nothing are both caught. Each tampered copy is written under `os.tmpdir()` with a pid-scoped name and unlinked by the row as soon as the copy has been read, so no row writes a repository file or leaves one behind.

| Negative proof | Rule it proves | CONTROL — real input accepted | Tamper applied to a copy | Rejection observed |
|---|---|---|---|---|
| `AC-AI-30-02` | status alignment (`AC-AI-30-01`) | real `TASK-AI-30.md` status cell agrees with real register row 163 | status cell flipped to `READY_FOR_AUTHOR` in a copy | `STATUS_DIVERGENCE_DETECTED`, exit 1 |
| `AC-AI-30-04` | declared dependency (`AC-AI-30-03`) | the real register declares exactly `TASK-AI-29` | the row's dependencies cell repointed at `TASK-AI-99` in a register copy | `DEPENDENCY_MISMATCH`, exit 1 |
| `AC-AI-30-06` | probe rule (`AC-AI-30-05`) | a compliant injected configuration is accepted | `timeoutMs` 0, `treeKill` off, `cheapestModel` off, `cacheWindowMs` negative, unsupported provider, refused entry, unrecorded outcome | `PROBE_VIOLATED`, exit 1 |
| `AC-AI-30-08` | result credential rule (`AC-AI-30-07`) | a clean, well-formed result is accepted | the credential planted in the record's readable reason | `CREDENTIAL_IN_RESULT`, exit 1 |

One shared module per pair, none restating its rule: `AC-AI-30-01`/`02` share `acceptance/lib/spec-status-alignment.js` (the module `TASK-AI-08`, `-09` and `-21` already share), `AC-AI-30-03`/`04` share the new `acceptance/lib/dependency-declared.js`, and `AC-AI-30-05` to `08` plus the unit tests share `acceptance/lib/qualification.js`. Both sides of a pair require the same module instance, so editing the rule moves both rows.

### Falsifiability of the shared rules (mutations applied to a working copy, then reverted)

| Mutation to the shared module | Invariant row | Negative proof | Reading |
|---|---|---|---|
| `qualification.js`: `probeRuleFindings` always returns no findings | `AC-AI-30-05` fails: `CONTROL_FAILED`, the rule cannot report a violation | `AC-AI-30-06` fails: `PROBE_VIOLATION_NOT_DETECTED` | A dead rule is caught from both sides |
| `qualification.js`: `resultCredentialFindings` always returns no findings | `AC-AI-30-07` fails: `CONTROL_FAILED` | `AC-AI-30-08` fails: `CREDENTIAL_IN_RESULT_NOT_DETECTED` | Same reading for the credential rule |
| `dependency-declared.js`: the declared dependency is always reported as declared | `AC-AI-30-03` unchanged, exit 0 | `AC-AI-30-04` fails: `DEPENDENCY_WRONG_DECLARED` | The proof alone would have missed it; the invariant row raises no false alarm because the real input is genuinely declared |
| `spec-status-alignment.js`: the divergence comparison disabled | `AC-AI-30-01` unchanged, exit 0 | `AC-AI-30-02` fails: `DIVERGENCE_NOT_DETECTED` | The gate stays green only while the comparison works |

### Fail-closed behaviour outside the repository

Every row that asserts a property of this repository was run with a temporary working directory outside it. Twelve rows refused operationally with exit `2` and a `SOURCE_MISSING` line naming the cwd-relative path they need (`TASK-AI-30.md`, `FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/qualification.js`, `docs/product-spec/scripts/validate_docs.py`, `tools/ai-brain/test`, `tools/ai-guard/cli.js`) rather than reporting success; none reported exit `0` where nothing exists. `AC-AI-30-09` exits `0` there by design: its subject is the four negative proofs, which it runs with a temporary working directory of its own, and it reports `OUTSIDE_REPOSITORY_PROBE` only when all four refused with exit `2`. `AC-AI-30-10` guards itself before spawning the reconciler, so a child's refusal cannot be re-reported as `RECONCILE_FAILED`, the code a real reconciliation failure uses.

### Repo-level audits the rows wrap, run directly

| Command | Observed at this head |
|---|---|
| `node tools/ai-brain/cli.js reconcile` | `Tổng: 0 lỗi` |
| `python docs/product-spec/scripts/validate_docs.py` | `Documentation validation passed: 102 markdown files, 130 feature IDs, 178 delivery rows, 824 unique identifiers` |
| `node --test 'tools/ai-brain/test/*.test.js'` | `406` tests in `93` suites, `406` pass, `0` fail (the new file contributes `13`) |
| `node tools/ai-guard/cli.js secret-surface` | `SECRET_SURFACE_CLEAN` |

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Spec authored for TASK-AI-30. Register records `BLOCKED_DEPENDENCY`; not stage-eligible for review routing. |

## Residual limitations

- **The bounded probe itself is not implemented by this specification change.** The rule module (`acceptance/lib/qualification.js`), the declared result path and record shape (`tools/ai-brain/qualification.js`) and the unit tests are delivered in this branch, and rows `AC-AI-30-05` to `AC-AI-30-08` and `AC-AI-30-12` run green against them — but every one of those rows exercises the rule with injected doubles, so no row reads a real credential, calls a real provider or writes a real result. The provider call, the timeout and tree-kill, the cache window and the recorded outcome are implementation work for this Work Item's `IN_PROGRESS` stage; the rows above are the conditions that implementation must keep true, and they fail the moment the delivered modules stop satisfying the rule.
- A passing probe is connectivity only. It says the model answered; it says nothing about quality, grade, or role fitness. Promotion stays with `TASK-AI-31`.
- A result goes stale. Past the cache window it is history, not standing; dispatch must re-probe rather than trust it.
- Spend is bounded, not zero. Cheapest model plus cache limits cost; each probe still spends budget.
- **No later item is yet registered to read this result.** This item stores the qualification result at a stable, injectable path (declared in `qualification.js`, mirroring how `ceiling.js` declares `LEDGER_FILE`) and proves the record's shape, but it does not modify `capabilities.js`, `accounts.js` or `offerings.js` — none is in Allowed paths. `TASK-AI-31` ("Promptfoo qualification gate before an account is used") is the most natural future reader by its business outcome, but `FEATURE-DELIVERY-REGISTER.csv` row 164 declares `TASK-AI-31`'s dependencies as `TASK-AI-20; TASK-AI-25`, not `TASK-AI-30`, and `docs/product-spec/work-items/TASK-AI-31.md` does not exist in this checkout. This item does not create that dependency link; it is a planning gap for whichever future item's specification adds `TASK-AI-30` to its declared dependencies and reads this record.
- **The branch name deviates from `AGENTS.md`'s `feat/`/`fix/` pattern for this Work Item.** `spec/task-ai-30` does not match the `feat/`- or `fix/`-prefixed work-item-id-and-slug rule in `AGENTS.md` § Unit of delivery. This follows the precedent already merged for spec-only authoring Work Items on this repository (`spec/task-ai-21`, merged as PR #74). Renaming the branch is outside this Work Item's Allowed paths.