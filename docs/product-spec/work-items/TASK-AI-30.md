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
| Pull Request | `Pending` |

### Status transition ledger

Register `FEATURE-DELIVERY-REGISTER.csv` `delivery_order` `163` (`work_item_id` `TASK-AI-30`) is authoritative under `AGENTS.md` Unit of delivery. It records `BLOCKED_DEPENDENCY`; the Control table records the same value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | Register `delivery_order` `163`, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Binding: this file must never declare `READY_FOR_CODEX` or later while the register records `BLOCKED_DEPENDENCY`; the Codex review record below is therefore `NOT_REVIEWED`. The block is true, not stale: dependency `TASK-AI-29` has no merge evidence on `origin/main` at the time of writing, so `AC-AI-30-03` asserts only the declared dependency name, never a merge. The `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written by the governed reconciler (`TASK-AI-19`) before review routing. `AC-AI-30-01` compares the Control `Status` cell against register row `163` and fails on divergence.

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

- Prerequisite `TASK-AI-29` is declared by register row `163` and has no merge evidence on `origin/main`; the block is true. `AC-AI-30-03` asserts the declaration only.
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
| `AC-AI-30-01` | Control Status vs register row 163 | `node tools/ai-brain/acceptance/ac-30-01-status-alignment.js` exit 0 | stdout match message |
| `AC-AI-30-02` | Negative: tampered spec copy diverges | `node tools/ai-brain/acceptance/ac-30-02-status-divergence.js` exit 1 | `STATUS_DIVERGENCE` stderr |
| `AC-AI-30-03` | Declared dependency exactly TASK-AI-29 | `node tools/ai-brain/acceptance/ac-30-03-dependency-declared.js` exit 0 | stdout declaration message |
| `AC-AI-30-04` | Negative: dependency repointed refused | `node tools/ai-brain/acceptance/ac-30-04-dependency-repointed.js` exit 1 | `DEPENDENCY_MISMATCH` stderr |
| `AC-AI-30-05` | Probe rule over seeded accounts | `node tools/ai-brain/acceptance/ac-30-05-probe-rule.js` exit 0 | `PROBE_HOLDS` stdout |
| `AC-AI-30-06` | Negative: unbounded and unsupported refused | `node tools/ai-brain/acceptance/ac-30-06-probe-rule-refused.js` exit 1 | `PROBE_VIOLATED` stderr |
| `AC-AI-30-07` | Result carries outcome, no credential | `node tools/ai-brain/acceptance/ac-30-07-result-credential-free.js` exit 0 | `RESULT_CLEAN` stdout |
| `AC-AI-30-08` | Negative: credential in result refused | `node tools/ai-brain/acceptance/ac-30-08-credential-in-result.js` exit 1 | `CREDENTIAL_IN_RESULT` stderr |
| `AC-AI-30-09` | Negatives exit 2 outside repository | `node tools/ai-brain/acceptance/ac-30-09-outside-repository.js` exit 0 | outside probe stdout |
| `AC-AI-30-10` | Register does not overstate | `node tools/ai-brain/cli.js reconcile` exit 0 | `Tổng: 0 lỗi` stdout |
| `AC-AI-30-11` | Docs validate | `python docs/product-spec/scripts/validate_docs.py` exit 0 | `Documentation validation passed:` stdout |
| `AC-AI-30-12` | New unit tests pass | `node --test tools/ai-brain/test/qualification.test.js` exit 0 | 0 fail stdout |
| `AC-AI-30-13` | No secret surface | `node tools/ai-guard/cli.js secret-surface` exit 0 | `SECRET_SURFACE_CLEAN` stdout |

Each row is a runnable command with a failing exit (`1` for violated, `2` for unmeasurable) when its rule breaks. Invariant rows assert markers, never pinned counts, since this item adds a spec file and nine scripts. Negative rows pair with one shared rule module (`acceptance/lib/qualification.js`) required by both sides; the status pair reuses the existing `lib/spec-status-alignment.js`. The dependency pair (`AC-AI-30-03`/`04`) introduces a new module, `acceptance/lib/dependency-declared.js` (in Allowed paths), rather than reusing `lib/dependency-merged.js` or `lib/dependency-delivered.js`: both of those existing modules assert merge evidence via Git, while this pair — per the Preconditions section above — asserts only that the register's declared dependency name is exactly `TASK-AI-29`, deliberately never a merge claim, since no merge evidence exists yet. Outside-repository behaviour is measured by `AC-AI-30-09`.
## Verification commands

```bash
node tools/ai-brain/acceptance/ac-30-01-status-alignment.js
node tools/ai-brain/acceptance/ac-30-02-status-divergence.js
node tools/ai-brain/acceptance/ac-30-03-dependency-declared.js
node tools/ai-brain/acceptance/ac-30-04-dependency-repointed.js
node tools/ai-brain/acceptance/ac-30-05-probe-rule.js
node tools/ai-brain/acceptance/ac-30-06-probe-rule-refused.js
node tools/ai-brain/acceptance/ac-30-07-result-credential-free.js
node tools/ai-brain/acceptance/ac-30-08-credential-in-result.js
node tools/ai-brain/acceptance/ac-30-09-outside-repository.js
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
node --test tools/ai-brain/test/qualification.test.js
node tools/ai-guard/cli.js secret-surface
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Spec authored for TASK-AI-30. Register records `BLOCKED_DEPENDENCY`; not stage-eligible for review routing. |

## Residual limitations

- Probe, rule module, result writer, and tests are specified here and delivered during implementation; rows `AC-AI-30-05` to `AC-AI-30-08` and `AC-AI-30-12` assert rules the shipped modules must satisfy, and fail until they exist.
- A passing probe is connectivity only. It says the model answered; it says nothing about quality, grade, or role fitness. Promotion stays with `TASK-AI-31`.
- A result goes stale. Past the cache window it is history, not standing; dispatch must re-probe rather than trust it.
- Spend is bounded, not zero. Cheapest model plus cache limits cost; each probe still spends budget.
- **No later item is yet registered to read this result.** This item stores the qualification result at a stable, injectable path (declared in `qualification.js`, mirroring how `ceiling.js` declares `LEDGER_FILE`) and proves the record's shape, but it does not modify `capabilities.js`, `accounts.js` or `offerings.js` — none is in Allowed paths. `TASK-AI-31` ("Promptfoo qualification gate before an account is used") is the most natural future reader by its business outcome, but `FEATURE-DELIVERY-REGISTER.csv` row 164 declares `TASK-AI-31`'s dependencies as `TASK-AI-20; TASK-AI-25`, not `TASK-AI-30`, and `docs/product-spec/work-items/TASK-AI-31.md` does not exist in this checkout. This item does not create that dependency link; it is a planning gap for whichever future item's specification adds `TASK-AI-30` to its declared dependencies and reads this record.
- **The branch name deviates from `AGENTS.md`'s `feat/`/`fix/` pattern for this Work Item.** `spec/task-ai-30` does not match the `feat/`- or `fix/`-prefixed work-item-id-and-slug rule in `AGENTS.md` § Unit of delivery. This follows the precedent already merged for spec-only authoring Work Items on this repository (`spec/task-ai-21`, merged as PR #74). Renaming the branch is outside this Work Item's Allowed paths.