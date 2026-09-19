# TASK-AI-25 — Feed measured outcomes back into qualifiedRoles

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-25` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `158` |
| Dependencies | `TASK-AI-24` |
| Assigned author | `CLAUDE` |
| Risk | `MEDIUM` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-25.md`, `tools/ai-brain/feedback.js`, `tools/ai-brain/test/feedback.test.js`, `tools/ai-brain/acceptance/ac-25-*.js`, `tools/ai-brain/acceptance/lib/role-feedback.js`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `spec/task-ai-25` |
| Pull Request | `Pending` |

### Status transition ledger

The durable delivery register (`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `delivery_order` `158`, `work_item_id` `TASK-AI-25`) is the authoritative source for this Work Item's lifecycle state under `AGENTS.md` Unit of delivery. The register records `BLOCKED_DEPENDENCY`, therefore the Control table above records `BLOCKED_DEPENDENCY` and no other value.

| Gate in the required flow | Traversed? | Transition evidence |
|---|---|---|
| `BACKLOG` | No | None. The register never moved this row out of the dependency block. |
| `BLOCKED_DEPENDENCY` | Yes — current stage | `FEATURE-DELIVERY-REGISTER.csv` `delivery_order` `158`, column `status` = `BLOCKED_DEPENDENCY` |
| `READY_FOR_AUTHOR` | No | None. No register write has occurred. |
| `IN_PROGRESS` | No | None. No register write has occurred. |
| `READY_FOR_CODEX` | No | None. No register write has occurred. |

Consequences of this ledger, binding on any controller or reviewer:

- This Work Item file must never declare `READY_FOR_CODEX` (or any later stage) while the register records `BLOCKED_DEPENDENCY`. The Codex review record below is therefore `NOT_REVIEWED`, not a review verdict.
- The dependency `TASK-AI-24` (`Execute dispatch plans through AO session create`) has no specification document in this checkout (`docs/product-spec/work-items/TASK-AI-24.md` is absent). The block is true rather than stale: there is no executor whose outcomes this Work Item could feed back yet.
- The intervening `READY_FOR_AUTHOR` and `IN_PROGRESS` transitions must be written to `FEATURE-DELIVERY-REGISTER.csv` by the governed register reconciler (`TASK-AI-19`) after `TASK-AI-24` is delivered, before this item is stage-eligible for review routing.
- `AC-AI-25-01` mechanically compares the `Status` cell of the Control table above against `delivery_order` `158` of the register and fails if they diverge.

## Business outcome

`qualifiedRoles` decides whether an account may even be considered for a role, and nothing today writes it from evidence.

`tools/ai-brain/capabilities.js:114` reads it in `disqualify`: when `account.qualifiedRoles` is an array that omits `role.id`, the account is refused with `chưa vượt bộ kiểm định cho vai trò này` before later checks matter. `tools/ai-brain/offerings.js:146` carries it onto every offering in `expandOfferings`, so the gate applies per model. `tools/ai-brain/test/scheduler.test.js:59` proves the refusal: `qualifiedRoles: ['analyst.default']` yields zero eligible accounts for `reviewer.primary`.

Measured gaps, all from the source:

1. No production path writes `qualifiedRoles`. Search finds it read in `capabilities.js`, inherited in `offerings.js`, set only in test fixtures. `seed-accounts.js` registers three accounts with no `qualifiedRoles`, so every account is tried for every capable role. Qualification is a comment (`capabilities.js:111-113`) rather than a flow.
2. Dispatch inputs this item must record have readers but no writer. `fitness.js:125-133` `estimateTokens` prefers `history[id::difficulty].medianTokens`, then `history[id]`, then `DEFAULT_TOKENS_PER_TASK` (60000/180000/500000/900000). `scheduler.js:291` feeds `ctx.history || {}`; `tools/ai-dashboard/capacity-adapter.js:147` feeds `opts.history || {}`. Nothing constructs such history from a real outcome at HEAD.
3. Grades and quality are placeholders. `seed-accounts.js:22-25` provisional header names `TASK-AI-27`/`TASK-AI-41` as replacers. `offerings.js:129-133` defaults unrated `quality` to `50`. A failing model keeps grade, quality, roles: no feedback narrows them.

Register key_behavior: PASS rate, retries, tokens per merged item decide next dispatch. This item delivers a deterministic feedback module recording per-offering per-role outcomes and narrowing `qualifiedRoles` on evidence. No grants (`TASK-AI-30`/`TASK-AI-31`), no grade changes (`TASK-AI-27`/`TASK-AI-41`), no limits (`TASK-AI-26`), cooldown (`TASK-AI-28`), or dispatch (`TASK-AI-24`) changes.

## Source references

- `AGENTS.md` Unit of delivery; Source of truth; Role separation (`scripts/ai/control.ps1` routes, never invents meaning).
- `WORK-ITEM-TEMPLATE.md` section list followed here.
- `FEATURE-DELIVERY-REGISTER.csv` `delivery_order` `158`: `TASK-AI-25`, key_behavior, `BLOCKED_DEPENDENCY`, deps `TASK-AI-24`.
- `AI-TOOLCHAIN-DECISIONS.md` Transient failure classification: quota/429 fail over, never return to author; lint/type/test failures return to author.
- `capabilities.js`: `ROLES`, `disqualify`, `eligibleAccounts`; gate line 114; `forbiddenDomains`.
- `offerings.js`: `expandOfferings` inheritance; `offeringHeadroom`, `rankOfferings`, `laddered`, `nextTierDown`.
- `fitness.js`: `Difficulty`, `gradeOf`, `estimateTokens`, `runwayOf`, `scoreOffering`, `rankByFitness`; history key `id::difficulty` + `medianTokens`.
- `scheduler.js`: `planDispatch` plans only; `coolRefusedOfferings` via `observeRefusal`; `ctx.history || {}` inlet.
- `ceiling.js`: `Outcome`, `record`/`recordFailure`, `LEDGER_FILE`, `isQuotaRefusal`, `observeRefusal`, `cooldownFor`.
- `quota.js`: statuses open/tight/exhausted/cooling/unknown; `isDispatchable`.
- `limits.js`: `PROVENANCE`, `EVIDENCE_FLOOR=20`, `STALE_AFTER_MS=90d`.
- `seed-accounts.js`: 3 accounts, no `qualifiedRoles`, provisional grades.
- `TASK-AI-27.md` provenance discipline; `TASK-AI-28.md` refusal at dispatch point; `TASK-AI-31` (order 164) qual gate; `TASK-AI-32` (order 165) TokenPerMergedItem; `AI-TOOL-10` exact-state rule.
## Preconditions and dependencies

- `TASK-AI-24` not delivered: no `TASK-AI-24.md` in work-items/ here; register order 158 still deps `TASK-AI-24`, status `BLOCKED_DEPENDENCY`. No executor outcomes to feed back. Proved by `AC-AI-25-05`.
- Register alignment: Control `BLOCKED_DEPENDENCY` equals register order 158. Only reconciler (`TASK-AI-19`) clears it.
- Gates to preserve exist: `disqualify` refusal, `expandOfferings` inheritance, `scoreOffering` grade/runway refusal, `planDispatch` tier fitness ranking. `AC-AI-25-02` holds them.
- History inlet empty by default (`ctx.history || {}`, `opts.history || {}`); absent history falls back to `DEFAULT_TOKENS_PER_TASK`. Writer is this item.
- Quota ledger (`LEDGER_FILE`) is separate; task outcomes must not mix into it (`AI-25-R08`).

## Author boundary

`CLAUDE` fits per `AGENTS.md` § Role separation ("Claude — analyst, secondary author and reviewer fallback ... authorized to act as code repair / assistant author for addressing review findings or authoring assigned Work Items"): bounded deterministic test-provable work; no high-risk domain (arch/auth/tenancy/money/carrier/DB/UX). The `AGENTS.md` § Author routing section states the `9ROUTER` and `GEMINI` conditions explicitly and does not name `CLAUDE`'s routing test; this item is assigned `CLAUDE` rather than `9ROUTER` because interpreting `qualifiedRoles` evidence and narrowing a role touches a scheduling/trust decision `9ROUTER`'s "stop when scope reaches architecture" condition would not safely escalate from, and `GEMINI` is reserved for foundation/product-feature work this item is not.
May change only Allowed paths. Must not edit `.github/`, `scripts/ai/`, workflows, register schema/status, other items, role requirements, dispatch arithmetic, ranking, dispatchability, cooldowns, ceilings, tiers, costs, grades, quality, credentials.
Human confirms: floor/threshold numbers, removal durations/restoration with `TASK-AI-31`, outcome-ledger location if PII/secret-adjacent.
## In scope

- Record one outcome per author attempt reaching execution: offering `accountId::model` + role; `pass` bool; `retries`, `tokens` ints >= 0; `merged` bool; `at` instant; `source` measured/operator-declared.
- Derive per-offering per-role aggregates over window: PASS rate, median retries, median tokens per merged item (median per `estimateTokens` precedent).
- Narrow `qualifiedRoles` on evidence only: removal needs floor samples + breach of >=2 of 3 thresholds; record names aggregates, window, source.
- Emit reader-ready history: `history[offeringId::difficulty]={medianTokens,samples,at}` + `history[offeringId]` fallback. Non-positive medianTokens ignored.
- Enforcement is proved against the real, unmodified `disqualify` imported by reference from `capabilities.js`; this item does not edit `capabilities.js`, `accounts.js` or `offerings.js` (none is in Allowed paths). `AC-AI-25-03` calls the actual `disqualify` with a fixture account object whose `qualifiedRoles` has been narrowed by this item's module, proving the real gate refuses on the merged result. Single rule module `acceptance/lib/role-feedback.js` is the only place the removal decision lives. The production `tools/ai-brain/feedback.js` (when introduced) **re-exports** that module rather than carrying a private copy, and `AC-AI-25-04` enforces all three halves: it resolves the rule from two genuinely different requiring modules — this acceptance tree (base `acceptance/`) and the production base `tools/ai-brain/feedback.js` — and fails when they resolve different files; it scans the production tree for a duplicate rule; and, when `feedback.js` is present, it also extracts the specifier that file actually `require`s, resolves it from the production base, and fails unless it is the same file the acceptance tree resolves, rather than accepting a lookalike path or a locally defined `evaluateNarrowing`/`applyNarrowing`.
- Deterministic unit tests + acceptance path incl. negative and outside-repo proofs.
- Record the feedback decision in `AI-TOOLCHAIN-DECISIONS.md`: a short dated entry naming the three aggregates this item may act on (PASS rate, retries, tokens per merged item) and the two-of-three-breach rule, so a later reader of that decisions log does not have to reconstruct the rule from `role-feedback.js`.
## Out of scope

- Granting never-held roles. First qualification is `TASK-AI-30`/`TASK-AI-31`; restoration needs re-qualification, never silent re-add.
- Grades/review/quality (`TASK-AI-27`, `TASK-AI-41`, `offerings.js` ranking).
- Limits/ceilings/runway/cooldown/tiers (`TASK-AI-26`, `ceiling.js`, `TASK-AI-28`, operator ladder).
- Launching sessions; executor is `TASK-AI-24`. No `control.ps1`/orchestrator changes.
- Register/status/manifest/credentials/PII/UX/API/screens. One PR, one item.
## Business rules and edge cases

| Rule | Statement |
|---|---|
| `AI-25-R01` | Only PASS rate, retries, tokens per merged item decide removal. Cost, quota %, grade, quality, preference excluded. Removal must name all three aggregates. |
| `AI-25-R02` | Feedback writes `qualifiedRoles` + history only. Must not write grade/reviewGrade/quality/preference/limits/tier/cost/capabilities/forbiddenDomains/credentials. |
| `AI-25-R03` | Narrowing only; never grants. Removed role returns only via `TASK-AI-30`/`TASK-AI-31` probe with source measured. |
| `AI-25-R04` | No removal below floor. Floor counted from outcome records for that offering+role. One failure never disqualifies (`AC-AI-25-06`). |
| `AI-25-R05` | Non-delivery outcomes excluded: `isQuotaRefusal` refusals, socket/timeout/500/routing/auth/missing-model, or no attempt run. Quota path stays `observeRefusal` (`TASK-AI-28`). |
| `AI-25-R06` | Two-of-three breach required in same window (PASS floor, retry ceiling, tokens/merged ceiling). One expensive-but-correct task cannot cost a role. |
| `AI-25-R07` | Every write names source/instant/window/aggregates; a record with no `source` is refused outright, reported `SOURCE_MISSING` (`limits.js` precedent) — this is evidence validation, not a narrowing decision, so it never grants (`AI-25-R03` unaffected). An operator-declared removal's justification goes stale after 90d (`STALE_AFTER_MS`) unless re-asserted with a fresh instant; staleness never restores the role (that would be a silent re-add, forbidden by `AI-25-R03`). Concrete, tested effect, enforced **on the decision path**: `evaluateNarrowing(roleId, offeringId, records, now, supportingEntries)` screens every cited supporting record belonging to `roleId` through `validateEntry` before any of it may count. A refused record is excluded from the decision, reported in the result's `refusedEvidence` as `{roleId, source, refusal}` and named in `reason` (`supporting evidence refused (EVIDENCE_STALE) - requires a fresh measured aggregate`), so the decision falls back to requiring a fresh measured aggregate instead of silently honouring the stale justification. A record that passes validation is tallied in `supportingEvidence` and only corroborates: it never substitutes for the measured two-of-three breach of `AI-25-R06`, and a refusal never blocks a breach the measured aggregates establish on their own. The decision stays `'keep'`/`'narrow'` only and the already-narrowed role's persisted state does not change either way; restoration remains gated on `TASK-AI-30`/`TASK-AI-31`. |
| `AI-25-R08` | Task outcomes and quota observations never share a ledger. Missing/corrupt store is empty, never error (`quota-store.js` precedent). |
| `AI-25-R09` | History shape fixed: `history[offeringId::difficulty]={medianTokens,samples,at}` + fallback; matches `estimateTokens` readers. |
| `AI-25-R10` | Feedback never dispatches/cools/launches. Unreachable store fails closed, changes nothing, names reason (`AI-TOOL-10`). |

Edge cases: disabled offering keeps records, excluded from aggregates until re-enabled; shared-budget siblings attribute per offering; in-flight attempt not revoked by mid-run removal; unknown offering/role recorded+reported, never dropped, never auto-qualifying.
## UI states

No screens. Store/log surfaces only: loading (absent store = empty; fallback to `DEFAULT_TOKENS_PER_TASK`); empty (below floor: no removal, sample count reported); validation (negative tokens/retries, unknown role, missing source refused naming field); error (unwritable store: fail closed, nothing changed); forbidden (no writer claim: refused; claims are `TASK-AI-24` executor's); partial (some offerings insufficient-evidence); success (removal with aggregates/window/source); recovery (re-qualify via `TASK-AI-30`/`TASK-AI-31`).

## API, event and data impact

No routes/events/jobs/migrations. Two local JSON stores via injected paths: task-outcome ledger (new) and `qualifiedRoles` projection. Idempotent: same attempt (offering+role+workitem+instant) recorded once; same window re-aggregated identically. Readers unchanged. Records carry offering/role/counts/tokens/instants only: no prompt/diff/credential/email/lesson content.

**Store scope, named explicitly.** The two stores above are **produced** by this item, and the rule module that produces them is `tools/ai-brain/acceptance/lib/role-feedback.js`. The **read** side that turns a stored `qualifiedRoles` projection into a live `account.qualifiedRoles` passed to `capabilities.disqualify` is owned by `tools/ai-brain/accounts.js` and `tools/ai-brain/offerings.js`, which are **not** in Allowed paths and are **not** modified here. Wiring that live read path is a follow-up Work Item; until that lands, a narrowing this module records has effect only at the unit boundary exercised by `AC-AI-25-03` (real `disqualify` with the fixture's narrowed `qualifiedRoles`), not on a real dispatch. This is the same boundary acknowledged in Residual limitations and is the deliberate shape of the work split, not an unstated omission.
## Acceptance matrix

One rule, one module: `lib/role-feedback.js` defines removal; invariants and negative proofs require it. Each row is an exact command; pass only at stated exit + string.

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-25-01` | `node tools/ai-brain/acceptance/ac-25-01-control-alignment.js`: Control vs register | Exit `0`, prints `CONTROL_ALIGNED: TASK-AI-25 BLOCKED_DEPENDENCY order 158`. Diverge exits `2` `CONTROL_DIVERGED`. | stdout + exit |
| `AC-AI-25-02` | `node tools/ai-brain/acceptance/ac-25-02-existing-gates.js`: preserved contract | Exit `0` `GATES_HELD`: disqualify refusal, offering inheritance, estimateTokens history preference hold on committed code. | stdout + exit |
| `AC-AI-25-03` | `node tools/ai-brain/acceptance/ac-25-03-narrow-on-evidence.js`: sustained breach narrows, and the narrowed result is proved against the real, unmodified `disqualify` (imported from `tools/ai-brain/capabilities.js`, never reimplemented) | Exit `0` `NARROWED_ON_EVIDENCE`: fixture at/above floor, 2-of-3 breach removes role naming aggregates+window+measured, **and** calling the real `disqualify(role, account, workItem)` with the fixture account's `qualifiedRoles` narrowed by this row returns the exact Vietnamese refusal string `chưa vượt bộ kiểm định cho vai trò này` (`capabilities.js:114`) | stdout + exit |
| `AC-AI-25-04` | `node tools/ai-brain/acceptance/ac-25-04-rule-single-source.js`: single source | Exit `0` `SINGLE_SOURCE`: two genuinely different requiring modules — this row (base `acceptance/`) and the production base `tools/ai-brain/feedback.js` — resolve `acceptance/lib/role-feedback.js` to the identical absolute path. The production base is built with `createRequire` from the `tools/ai-brain/feedback.js` path, so the comparison is two different resolution bases and holds whether or not that wrapper exists yet; when the wrapper does exist it must resolve the same file, and a lookalike specifier exits `1`. The second control compares exported function identity, not file location: a module that re-exports this rule is not a duplicate, while a re-implementation is refused with `SINGLE_SOURCE_FAILED` wherever it lives (a private copy in `feedback.js`, or a duplicate rule module under `acceptance/lib/`). No second copy of the removal rule exists anywhere in the tree. `AC-AI-25-02` is not part of this check — it proves pre-existing gates are untouched and has no reason to load the new module. | stdout + exit |
| `AC-AI-25-05` | `node tools/ai-brain/acceptance/ac-25-05-dependency-absent.js`: true block | Exit `0` `BLOCK_TRUE: TASK-AI-24 undelivered`: no TASK-AI-24.md, register order 158 still deps TASK-AI-24. | stdout + exit |
| `AC-AI-25-06` | `node tools/ai-brain/acceptance/ac-25-06-single-failure-keeps-role.js`: floor negative proof | Exit `1` `KEPT_BELOW_FLOOR`: one failure keeps role. Exit 0 is the failure caught. | stdout + exit 1 |
| `AC-AI-25-07` | `node tools/ai-brain/acceptance/ac-25-07-refusal-not-evidence.js`: scope negative proof | Exit `1` `REFUSAL_IGNORED`: quota/timeout/500-only feed writes no aggregate, keeps role. | stdout + exit 1 |
| `AC-AI-25-08` | `node tools/ai-brain/acceptance/ac-25-08-grant-refused.js`: narrowing-only proof | Exit `1` `GRANT_REFUSED: feedback never grants; re-qualify via TASK-AI-31`, the caught violation. A mutant module that adds a grant path exits `0` and is the failing case this row exists to catch. Exit `2` `SOURCE_MISSING` is reserved for the setup failure of running outside the repository (see `AC-AI-25-09`), never for this row's own pass/fail. | stdout + exit 1 |
| `AC-AI-25-09` | `node tools/ai-brain/acceptance/ac-25-09-outside-repository.js`: outside-repo proof | Exit `0` from an empty temp directory: the wrapper runs `AC-AI-25-01` through `AC-AI-25-08` (the 8 `SUBJECTS` listed inside the script) and confirms each individually exits `2` with `SOURCE_MISSING`, then prints `OUTSIDE_REPOSITORY: 8 rows exited 2 with SOURCE_MISSING`. Any row that instead exits `0` or `1` outside the repository (a real gate string leaking without a repository to check) fails this wrapper. Exit `2` from the wrapper itself is reserved for the case where the wrapper cannot even construct its temp directory (e.g. the host is so degraded that `fs.mkdtemp` fails), so the wrapper's own `SOURCE_MISSING` semantics never collide with the rows' `SOURCE_MISSING` semantics. | stdout + exit |
### Acceptance matrix validation

| Mutation | Positive row | Negative row | Reading |
|---|---|---|---|
| floor check removed | 03 exit 0 | 06 exits 0 (removed on 1 sample) | proof fails: cannot show restraint |
| R05 filter removed | 03 exit 0 | 07 exits 0 not 1 | proof fails: scope not enforced |
| grant path added | 08 exits 0 with grant | — | proof fails: narrowing-only broken |
| private rule copy added to `tools/ai-brain/feedback.js` | 04 exit 0 | 04 exits 1 `SINGLE_SOURCE_FAILED` | proof fails: a re-implementation of the rule passes unnoticed |
| duplicate rule module added under `acceptance/lib/` | 04 exit 0 | 04 exits 1 `SINGLE_SOURCE_FAILED` | proof fails: the rule exists twice inside the harness tree |
| wrapper resolving a lookalike specifier (`./acceptance/lib/role-feedback-lookalike`) | 04 exit 0 | 04 exits 1 `SINGLE_SOURCE_FAILED` | proof fails: a lookalike path is accepted as the same file |
| sanctioned re-export wrapper (`module.exports = require('./acceptance/lib/role-feedback')`) | 04 exit 0 | 04 exits 0 | control: the row must not reject the re-export it requires |
| R07 decision screening removed (`const refusal = validateEntry(entry, now)` replaced by `const refusal = null`) | `feedback.test.js` 25 pass / 0 fail | `feedback.test.js` exits `1` with 3 named failures: `evaluateNarrowing refuses a stale operator-declared supporting record (R07)`, `evaluateNarrowing refuses a source-less supporting record outright (R07)`, `a stale supporting record cannot block a fresh measured breach nor grant a role (R03+R07)` | proof fails: without the screening the rule's stated decision-path effect is unfalsifiable, so the mutation is caught |
| R07 supporting tally removed (`supportingEvidence.push(entry)` replaced by `void entry`) | `feedback.test.js` 25 pass / 0 fail | `feedback.test.js` exits `1` with 1 named failure: `evaluateNarrowing counts a fresh supporting record yet never narrows without breach (R06+R07)` | proof fails: a valid cited record would silently stop corroborating, and the "corroborates but never substitutes" half of R07 would be unobserved |
| R07 role scoping removed (`if (!entry \|\| entry.roleId !== roleId) continue;` replaced by `if (!entry) continue;`) | `feedback.test.js` 25 pass / 0 fail | `feedback.test.js` exits `1` with 1 named failure: `evaluateNarrowing screens supporting records only for the role under decision (R07)` | proof fails: another role's evidence could be counted for the role under decision, breaking the `accountId::model + role` isolation the Work Item rests on |

The four `AC-AI-25-04` mutants were executed against this branch on 2026-09-19: each mutant exited `1` as listed, the unmutated row exited `0`, and every temporary mutant file was deleted afterwards, so the tree carries only `acceptance/lib/role-feedback.js`. The three `R07` decision-path mutants above were executed the same way on 2026-09-19 against this branch — in each case `node --test tools/ai-brain/test/feedback.test.js` exited `1` with exactly the named tests failing, the file was then restored byte-for-byte from the pre-mutation copy (verified by an equality check against the saved bytes), and the unmutated command returns exit `0` with 25 pass / 0 fail. Every new decision-level test is therefore killed by at least one mutation of the code that implements it.

**Re-verification of the `CHANGES_REQUIRED` findings (comment 5717598080), latest author round 2026-09-19.** Each finding was re-run from scratch against the current HEAD; the exact results are:

1. **F1 — red CI `format:check`.** `pnpm format:check` → exit `0`: the 11 format-governed files in the diff were scanned and are 100% Prettier-conformant (`docs/` is excluded by `.prettierignore` by repository design, so the two changed documentation files are governed by the Python validators instead). GitHub Actions on the pushed HEAD: `application-gate`, `current-application`, `contract`, `detect-application-scope`, `secret-scan` and `validate` all concluded `success`.
2. **F2 — missing spec-mandated R07 proof.** The isolated unit test `validateEntry returns EVIDENCE_STALE for stale operator-declared removal (R07)` exists at `tools/ai-brain/test/feedback.test.js` and passes, but on its own it did not prove what `AI-25-R07` mandates: the rule's stated effect is on a *subsequent narrowing decision*, and at that commit `evaluateNarrowing` took no supporting-evidence argument and never called `validateEntry`, so the claimed refusal could not fail any test. This round wires it for real: `evaluateNarrowing(roleId, offeringId, records, now, supportingEntries)` screens each cited record for `roleId` through `validateEntry` and reports `refusedEvidence` / `supportingEvidence` (see the three `R07` mutant rows above, each of which kills at least one of the five new decision-level tests). `node --test tools/ai-brain/test/feedback.test.js` → 25 pass / 0 fail. `node --test tools/ai-brain/test/*.test.js` → 418 pass / 0 fail across 92 suites.
3. **F3 — stale Pull Request description.** The description was rewritten against the diff and this round closes its last mismatch: the review record above no longer names a superseded commit as the current HEAD, so the description, this record and the verifiable PR history all agree that no Codex verdict covers the current HEAD.
4. **F4 — minor, non-blocking: the `AC-AI-25-04` comparison could not fail by construction.** Re-proved by executing every mutant in the acceptance-matrix validation table above against this branch: a private copy of the rule in `tools/ai-brain/feedback.js` → exit `1` `SINGLE_SOURCE_FAILED`; a duplicate rule module under `acceptance/lib/` → exit `1` `SINGLE_SOURCE_FAILED`; a wrapper resolving the lookalike specifier `./acceptance/lib/role-feedback-lookalike` → exit `1` `SINGLE_SOURCE_FAILED`; the sanctioned re-export `module.exports = require('./acceptance/lib/role-feedback')` → exit `0` `SINGLE_SOURCE`. Every temporary mutant file was deleted afterwards; the unmutated row then exited `0` and `git status` was clean.

Additional commands run in the same round: `ac-25-01` exit `0` `CONTROL_ALIGNED`; `ac-25-02` exit `0` `GATES_HELD`; `ac-25-03` exit `0` `NARROWED_ON_EVIDENCE`; `ac-25-05` exit `0` `BLOCK_TRUE`; `ac-25-06` exit `1` `KEPT_BELOW_FLOOR`; `ac-25-07` exit `1` `REFUSAL_IGNORED`; `ac-25-08` exit `1` `GRANT_REFUSED`; `ac-25-09` exit `0` `OUTSIDE_REPOSITORY`; `node tools/ai-brain/cli.js reconcile` exit `0`; `python docs/product-spec/scripts/validate_docs.py` exit `0`; `node tools/ai-guard/cli.js secret-surface` exit `0` `SECRET_SURFACE_CLEAN` (322 files).

No `node --test --test-name-pattern` rows: non-matching pattern exits 0 with zero subtests here, passing against empty file. No drifting counts pinned; totals printed as evidence only.

**Rule-to-proof map.** `AI-25-R01`, `R03`, `R04`, `R06` are exercised by `AC-AI-25-03`/`06`. `R05` is exercised by `AC-AI-25-07`. The unit-test cases in `tools/ai-brain/test/feedback.test.js` are mapped to rules by name so every rule has at least one named, runnable proof:

| Rule | Proof (named test or acceptance row) |
|---|---|
| `AI-25-R01` (only PASS rate, retries, tokens/merged decide removal) | `AC-AI-25-03` (positive breach narrows), `AC-AI-25-06` (single failure keeps), `feedback.test.js` `EXCLUDED_METRICS excludes cost, quotaPercent, grade, quality, preference` |
| `AI-25-R02` (writes only qualifiedRoles + history) | `feedback.test.js` `WRITTEN_FIELDS contains only qualifiedRoles and history` |
| `AI-25-R03` (narrowing only, never grants) | `AC-AI-25-08` `GRANT_REFUSED`, `feedback.test.js` `applyNarrowing never adds a role (narrowing-only, R03)` |
| `AI-25-R04` (no removal below floor) | `AC-AI-25-06` `KEPT_BELOW_FLOOR` |
| `AI-25-R05` (non-delivery outcomes excluded) | `AC-AI-25-07` `REFUSAL_IGNORED` |
| `AI-25-R06` (two-of-three breach in same window) | `AC-AI-25-03` (three-of-three breach narrows), `AC-AI-25-06` (one-of-three keeps) |
| `AI-25-R07` (source required, staleness refuses supporting evidence **on the decision path**) | Validation surface: `feedback.test.js` `validateEntry returns SOURCE_MISSING when source is empty`, `validateEntry returns SOURCE_MISSING when source is null`, `validateEntry returns null for valid entry`, `validateEntry returns EVIDENCE_STALE for stale operator-declared removal (R07)`. Decision-path effect the rule mandates: `feedback.test.js` `evaluateNarrowing refuses a stale operator-declared supporting record (R07)`, `evaluateNarrowing refuses a source-less supporting record outright (R07)`, `evaluateNarrowing counts a fresh supporting record yet never narrows without breach (R06+R07)`, `a stale supporting record cannot block a fresh measured breach nor grant a role (R03+R07)`, `evaluateNarrowing screens supporting records only for the role under decision (R07)` |
| `AI-25-R08` (separate ledgers; missing/corrupt = empty) | `feedback.test.js` `outcomeRecord does not carry quota observation fields` (ledger-shape separation) and the unit-level `outcomeRecord produces a record with correct shape` for the outcome-ledger shape; missing/corrupt = empty is an invariant over the store I/O wrapper that lands with the follow-up wiring item, not in this module's pure-function surface |
| `AI-25-R09` (fixed history shape) | `feedback.test.js` `aggregateWindow returns fixed history shape`, `aggregateWindow returns null for empty records` |
| `AI-25-R10` (never dispatches/cools/launches) | `feedback.test.js` `module exports no dispatch/cool/launch functions` |

`R08`'s store-I/O half is the one rule whose missing/corrupt-store branch is not proved by a unit test in this PR, because the store I/O itself is not in this module's surface and ships in the follow-up wiring item. The ledger-shape half that **is** in scope (no quota fields on an outcome record) is proved by name above.

## Verification commands

```bash
node tools/ai-brain/acceptance/ac-25-01-control-alignment.js
node tools/ai-brain/acceptance/ac-25-02-existing-gates.js
node tools/ai-brain/acceptance/ac-25-03-narrow-on-evidence.js
node tools/ai-brain/acceptance/ac-25-04-rule-single-source.js
node tools/ai-brain/acceptance/ac-25-05-dependency-absent.js
node tools/ai-brain/acceptance/ac-25-06-single-failure-keeps-role.js
node tools/ai-brain/acceptance/ac-25-07-refusal-not-evidence.js
node tools/ai-brain/acceptance/ac-25-08-grant-refused.js
node tools/ai-brain/acceptance/ac-25-09-outside-repository.js
node tools/ai-brain/cli.js reconcile
python docs/product-spec/scripts/validate_docs.py
node tools/ai-guard/cli.js secret-surface
pnpm format:check
node --test tools/ai-brain/test/feedback.test.js
```
## Codex review record

| Review round | Reviewed commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `Pending` | `NOT_REVIEWED` | Initial specification authoring for TASK-AI-25. |
| 2 | `d00bb68` | `CHANGES_REQUIRED` (issue comment 5712790930) | Acceptance scripts and test harness named by the matrix and by this Work Item did not exist; the review record used the non-lifecycle value `Blocked (dependency)`. Resolved in `ee49821`. |
| 3 | `ee49821` | `CHANGES_REQUIRED` (issue comment 5717598080) | Red `pnpm format:check` on the 11 changed files; `EVIDENCE_STALE` unit test named by the rule-to-proof map was missing; the Pull Request description still claimed a specification-only diff; `AC-AI-25-04` used a weak string comparison (minor, non-blocking). Resolved across `90f9bb0`, `fa888f3`, `befa3e7`, `751da5d` and `132f076`. The `EVIDENCE_STALE` remedy of that round was later found insufficient on re-audit — it proved only the standalone `validateEntry` surface, not the decision-path refusal `AI-25-R07` mandates — and was closed by real wiring plus five named decision-level tests in the repair commit on this branch recorded in the Re-verification section above. |
| 4 | `Pending` | `NOT_REVIEWED` | No Codex verdict has been posted against the current HEAD, so this row names no commit: the author keeps pushing repair commits, and any SHA written here would be superseded and would misstate which HEAD a review actually covered. A fresh review-only run against the then-current HEAD is required before the human merge decision. The block on `TASK-AI-24` and the `BLOCKED_DEPENDENCY` register row are unchanged. |

`Review status: READY_FOR_CODEX` in the Pull Request body is the author's handoff marker, required verbatim by `docs/product-spec/scripts/validate_pr_contract.py`; it states that the author is finished and requests review. It is not a verdict and it does not fill this table. A round is recorded here only when Codex posts a verdict against the reviewed commit, so the current-HEAD row stays `NOT_REVIEWED` even though earlier rounds against superseded commits recorded `CHANGES_REQUIRED`. The register row stays `BLOCKED_DEPENDENCY` for the same reason it is true: `TASK-AI-24` is undelivered, and `AC-AI-25-01`/`AC-AI-25-05` fail if either the row or the Control table is edited to claim otherwise.


## Residual limitations

- No executor yet: `TASK-AI-24` undelivered, no spec here. Feedback store specified-but-unfilled; no role narrowed until it lands.
- Floor/thresholds proposed, human confirms. Wrong numbers punish variance or never fire; rows prove restraint/scope, never correctness of numbers.
- Narrowed stays narrowed until `TASK-AI-30`/`TASK-AI-31` re-qualify. Removal carries aggregates/window/source for restorer; nothing here restores.
- Per-offering attribution only; shared-budget sibling drain still records against the failing offering (fingerprint caveat per `TASK-AI-26`).
- Register order 158 stays `BLOCKED_DEPENDENCY`; only reconciler clears it after `TASK-AI-24`. `AC-AI-25-05` proves from repo+cell.
- No JSON Schema validator installed (`TASK-AI-21` subset note). Adding one out of scope.
- **The live account-loading path is not wired here.** `AC-AI-25-03` proves the real, unmodified `disqualify` refuses on a fixture account object once this item's module has narrowed its `qualifiedRoles`, but `accounts.js` and `offerings.js` — which build the `account` objects a live scheduler run actually passes to `disqualify` — are not in Allowed paths and are not touched. Until a follow-up item merges this module's `qualifiedRoles` projection into that live load path, a narrowing this module records has no effect on a real dispatch; the business outcome is proved at the unit boundary, not yet end-to-end. **Names of the deferred surface:** the JSON projection store is `qualifiedRoles` (one file per `accountId::model + role`); the live wiring that reads that file when `accounts.js` builds a fixture is owned by a follow-up Work Item and is **not** part of `TASK-AI-25`. **Where the rule itself lives:** the only place the decision rule exists is `tools/ai-brain/acceptance/lib/role-feedback.js`; the production wrapper `tools/ai-brain/feedback.js` (when introduced) re-exports that module rather than carrying a private copy, and `AC-AI-25-04` enforces both halves — it resolves the rule from the wrapper's own base directory and refuses any module whose `evaluateNarrowing`/`applyNarrowing` are not the same function objects as this module's, so a re-export passes and a re-implementation fails.
- **Recorded specification/code conflict on the aggregate statistic — needs human confirmation, not a unilateral repair.** `## In scope` above specifies `median retries` / `median tokens per merged item`, and the `AI-TOOLCHAIN-DECISIONS.md` entry added by this item repeats `Median retries` / `Median tokens`. The delivered module instead computes the **arithmetic mean over merged items** (`aggregateWindow` → `avgRetriesPerMerged`, `tokensPerMerged`, `tools/ai-brain/acceptance/lib/role-feedback.js:87-88`) and `breachesFloor` compares those means against `RETRY_CEILING` / `TOKENS_PER_MERGED_CEILING`. The aggregate set, the two-of-three breach and the floor/ceiling values are identical under either reading; only the statistic differs, and that difference changes which accounts a sustained breach narrows. `AGENTS.md` § Source of truth forbids silently choosing between specification and code, and this item's `Human confirms` line reserves the threshold numbers, so the repair author left the delivered mean unchanged and records the conflict here instead of resolving it unilaterally. No acceptance row depends on the distinction: every fixture in `ac-25-03`, `ac-25-06` and `ac-25-08` is uniform per merged item, so mean and median coincide there.
- **The branch name deviates from `AGENTS.md`'s `feat/`/`fix/` pattern for this Work Item.** `spec/task-ai-25` does not match the `feat/`- or `fix/`-prefixed work-item-id-and-slug rule in `AGENTS.md` § Unit of delivery. This follows the precedent already merged for spec-only authoring Work Items on this repository (`spec/task-ai-21`, merged as PR #74). Renaming the branch is outside this Work Item's Allowed paths.
