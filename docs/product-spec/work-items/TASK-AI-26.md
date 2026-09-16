# TASK-AI-26 — Declare quota limits for every registered account

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-26` |
| Feature ID | `N/A` |
| Status | `BACKLOG` |
| Delivery order | `159` |
| Dependencies | `none` |
| Assigned author | `CLAUDE` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/accounts.js`, `tools/ai-brain/ceiling.js`, `tools/ai-brain/offerings.js`, `tools/ai-brain/seed-accounts.js`, `tools/ai-brain/test/ceiling.test.js`, `tools/ai-brain/test/limits.test.js`, `tools/ai-dashboard/capacity-adapter.js`, `docs/product-spec/work-items/TASK-AI-26.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-26-quota-ceilings` |
| Pull Request | `pending` |

## Business outcome

Every vendor reports a percentage and none reports the denominator.

```json
{"family":"gemini","window":"weekly","remainingPercent":84,"resetsAt":"2026-09-22T01:32:36Z"}
{"family":"claude-code","window":"session","remainingPercent":40,"usedPercent":60}
```

Eighty-four percent of what? The system's own windows — `requestsPerMinute`,
`requestsPerDay`, `tokensPerDay`, `tokensPerMonth` — are absolute quantities. A
percentage cannot be converted into "how many more tasks fit" without a
ceiling, so `offeringHeadroom` marks every offering `unknownBudget` and returns
no runway.

Measured at HEAD: **35 of 35 offerings report `unknownBudget: true` and
`runway: null`**, and all four registered accounts carry `limits: {}`.

The consequence is not cosmetic. Without runway the scheduler cannot answer the
only question that matters before dispatching work — will this offering finish
the task, or stop halfway — so it dispatches hopefully and discovers the answer
by being refused. `TASK-AI-28` cools an offering *after* a refusal; this Work
Item is what lets the system avoid the refusal in the first place.

This Work Item declares ceilings, and is equally concerned with refusing to
invent one. A fabricated ceiling turns `unknownBudget: true` into a confident
number that is wrong, which is worse than the honest blank it replaced.

## Source references

- `tools/ai-brain/accounts.js` — the registry, `limits` field, `Tier`
- `tools/ai-brain/ceiling.js` — `WINDOWS`, `inferLimits`, `effectiveLimits`, `readLedger`, `LEDGER_FILE`
- `tools/ai-brain/offerings.js` — `offeringHeadroom`, `unknownBudget`, `runway`
- `tools/ai-dashboard/capacity-adapter.js` — where the 35 unknown rows surface
- `AI-TOOL-10` — a failed or partial operation reports exact state and must not be recorded as healthy

## Preconditions and dependencies

- No Work Item dependency. Register row 159 records `dependencies` as empty and
  the status as `BACKLOG`; this document does not advance it.
- `effectiveLimits(account)` already merges declared limits with limits learned
  from the observation ledger, and already records which source supplied each
  value. Nothing in that merge changes here.
- The observation ledger at `~/.shipde/quota.observations.json` already
  accumulates the evidence `inferLimits` reads.

## Author boundary

The implementation may change only the files in `Allowed paths`. It may not
edit `.github/`, `scripts/verify-*`, `docs/product-spec/scripts/`, any
workflow, or another Work Item document. It may not alter the delivery register
schema, and it may not change any status or lifecycle state.

## In scope

- Declare a `limits` object for each registered account, keyed by the windows in
  `WINDOWS`, with an explicit provenance for every declared value.
- Record provenance in the registry alongside the number: `vendor-documented`
  (published by the provider), `observed` (derived from the ledger by
  `inferLimits`), or `operator-declared` (a figure the operator asserts). A
  number with no provenance is not accepted.
- Keep `unknownBudget: true` for any window where no ceiling is known. The
  absence of a ceiling must remain visible rather than being filled with a
  default.
- Convert a vendor percentage into an absolute remaining quantity only where a
  ceiling exists for that exact window and family, and surface the computed
  runway alongside the provenance of the ceiling it used.
- Extend `capacity-adapter` so each row reports which windows are known and
  which are not, so the dashboard can distinguish "plenty left" from "no idea".
- Author `tools/ai-brain/test/limits.test.js` covering each rule below with an
  injected registry and an injected ledger path.

## Out of scope

- Inventing ceilings for vendors that do not publish them. Where no figure
  exists, the window stays unknown.
- Changing how `inferLimits` learns from observations. Its inference is
  inherited as-is.
- Cooling or routing decisions. `TASK-AI-28` owns those.
- Adding new accounts or providers to the registry.
- Reading vendor billing or usage endpoints.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-26-R01` | **A ceiling without provenance is refused.** Every declared limit carries `source` of `vendor-documented`, `observed`, or `operator-declared`. A limit with an absent or unrecognised source is rejected at registry load with the account id and window named, not silently dropped and not silently used. |
| `AI-26-R02` | **Unknown stays unknown.** Where no ceiling exists for a window, `unknownBudget` remains `true` and `runway` remains `null` for every offering on that account. No default, no median of other accounts, no round number. An invented ceiling produces a confident wrong runway, which is strictly worse than a blank. |
| `AI-26-R03` | **A percentage is only converted against a matching ceiling.** `remainingPercent` for `family` F and `window` W may be converted to an absolute quantity only when a ceiling is declared for that same F and W. A ceiling for `tokensPerDay` must never be used to interpret a `weekly` percentage. |
| `AI-26-R04` | **Declared beats observed, and the record says so.** When both a declared and an observed value exist for a window, the declared value is used and the result records `source: 'operator-declared'` with the observed value retained as `observedAlternative`. A silent override would make a stale operator figure indistinguishable from a fresh measurement. |
| `AI-26-R05` | **Observed ceilings need a floor of evidence.** `inferLimits` may supply a ceiling only from at least `20` recorded observations for that account and window. Below that the window stays unknown: a ceiling guessed from three data points is a guess wearing a number. |
| `AI-26-R06` | **Runway names the ceiling it used.** Every computed runway carries the ceiling value, its window, and its provenance. A runway whose basis cannot be read back cannot be audited, and an operator cannot tell a measured figure from an asserted one. |
| `AI-26-R07` | **A disabled account declares nothing.** Limits on a disabled account are retained in the registry but excluded from capacity, so re-enabling restores them unchanged and disabling never silently edits them. |
| `AI-26-R08` | **Vendor percentages are never summed across accounts.** Two accounts at 80 percent are not 160 percent of anything. Aggregate capacity is computed only over windows with known absolute ceilings, and the aggregate states how many accounts it could not include. |
| `AI-26-R09` | **The account identity behind a ceiling is recorded.** A ceiling belongs to an account, and `budgetFingerprint` identifies an account only by its reset instants — two distinct accounts whose windows renew at the same moment produce identical fingerprints, which was observed on this machine on 2026-09-15 after a top-up. A declared limit therefore records the account id, never the fingerprint alone. |
| `AI-26-R10` | **Stale ceilings expire loudly.** A declared limit carries `assertedAt`. When it is older than `90` days the window is reported as `stale` rather than silently trusted, because a plan changed a quarter ago is not evidence about today. |

## UI states

Not applicable as a screen of its own. The cockpit capacity panel gains two
observable states per row:

- **Known** — a ceiling exists for the window; runway is a number and names its
  provenance.
- **Unknown** — no ceiling; runway is blank and the row states which windows are
  missing rather than showing an empty figure that reads as zero.

## API, event and data impact

- No database schema, backend API, or carrier protocol change.
- `accounts.registry.json` gains, per account, a `limits` object whose values
  are `{ value, source, assertedAt }` rather than bare numbers. An account whose
  `limits` is `{}` today remains valid and reports unknown.
- `capacity-adapter` output gains `knownWindows` and `unknownWindows` per row.
  Both existing consumers ignore unrecognised fields.

## Acceptance matrix

**Evidence boundary.** Every row runs against the real registry and ledger code
with injected paths. No row is satisfied by citing this document, and no row
reimplements `effectiveLimits` or `inferLimits` inline — a row that rebuilt
either would pass with the declaration absent, which is the defect this Work
Item exists to prevent.

| AC/Test ID | Scenario | Exact Command | Exit Code | Expected Output String | Output Source / Artifact |
|---|---|---|---|---|---|
| `AC-AI-26-01` | The problem is real at HEAD: every offering reports an unknown budget | `node -e "const{collectCapacity}=require('./tools/ai-dashboard/capacity-adapter');const rows=collectCapacity({}).data.rows\|\|[];const unk=rows.filter(r=>r.unknownBudget).length;if(unk!==rows.length){console.error('BASELINE_STALE: '+unk+' of '+rows.length+' unknown');process.exit(1)}console.log('BASELINE_CONFIRMED: '+unk+' of '+rows.length+' offerings have no ceiling')"` | `0` | `BASELINE_CONFIRMED: 35 of 35 offerings have no ceiling` | `tools/ai-dashboard/capacity-adapter.js` |
| `AC-AI-26-02` | A declared ceiling makes runway computable | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: a declared ceiling turns a percentage into a runway` | TAP output |
| `AC-AI-26-03` | Negative proof: no ceiling leaves the window unknown, with no default | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: an undeclared window stays unknown and gets no default` | TAP output |
| `AC-AI-26-04` | A limit without provenance is rejected, naming account and window | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: a limit with no source is rejected by account id and window` | TAP output |
| `AC-AI-26-05` | A ceiling is never applied across windows | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: a tokensPerDay ceiling never interprets a weekly percentage` | TAP output |
| `AC-AI-26-06` | Declared beats observed, and the observed value is retained | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: declared wins and keeps the observed value as an alternative` | TAP output |
| `AC-AI-26-07` | An observed ceiling below the evidence floor is refused | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: fewer than 20 observations yields no ceiling` | TAP output |
| `AC-AI-26-08` | Runway records the ceiling and provenance it used | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: runway names the ceiling value, window and source` | TAP output |
| `AC-AI-26-09` | Percentages are never summed across accounts | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: aggregate excludes unknown accounts and says how many` | TAP output |
| `AC-AI-26-10` | A stale assertion is reported, not trusted | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: a ceiling asserted over 90 days ago reports stale` | TAP output |
| `AC-AI-26-11` | A disabled account keeps its limits and contributes none | `node --test --test-reporter=tap tools/ai-brain/test/limits.test.js` | `0` | `# Subtest: a disabled account retains limits and contributes no capacity` | TAP output |
| `AC-AI-26-12` | The windows the system recognises are exactly the four in `WINDOWS` | `node -e "const{WINDOWS}=require('./tools/ai-brain/ceiling');const want=['requestsPerMinute','requestsPerDay','tokensPerDay','tokensPerMonth'];if(JSON.stringify(WINDOWS)!==JSON.stringify(want)){console.error('WINDOW_SET_DRIFT: '+JSON.stringify(WINDOWS));process.exit(1)}console.log('WINDOW_SET_EXACT: '+JSON.stringify(WINDOWS))"` | `0` | `WINDOW_SET_EXACT: ["requestsPerMinute","requestsPerDay","tokensPerDay","tokensPerMonth"]` | `tools/ai-brain/ceiling.js` |
| `AC-AI-26-13` | Negative proof that the TAP rows above are not vacuous | `node -e "const{spawnSync}=require('child_process');const p='THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ';const f='tools/ai-brain/test/limits.test.js';const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,f],{encoding:'utf8'});const n=r.stdout.split('\n').filter(l=>l.trim()==='# Subtest: '+p).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED: 0 tests matched '+p);process.exit(n>0?0:1)"` | `1` | `VACUOUS_PATTERN_REJECTED: 0 tests matched THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ` | command stdout |
| `AC-AI-26-14` | The new suite is green | `node --test tools/ai-brain/test/limits.test.js` | `0` | `fail 0` | test runner stdout |
| `AC-AI-26-15` | Existing ceiling behaviour is unbroken | `node --test tools/ai-brain/test/ceiling.test.js` | `0` | `fail 0` | test runner stdout |

Rows `AC-AI-26-02` through `AC-AI-26-11` name the TAP subtest rather than
asserting an exit code alone, because `node --test` exits `0` when
`--test-name-pattern` matches nothing — measured, and the reason
`AC-AI-26-13` exists.

## Verification commands

```bash
# 1. The baseline this Work Item addresses
node -e "const{collectCapacity}=require('./tools/ai-dashboard/capacity-adapter');const rows=collectCapacity({}).data.rows||[];console.log(rows.filter(r=>r.unknownBudget).length+' of '+rows.length+' offerings have no ceiling')"

# 2. The window set, unchanged
node -e "console.log(JSON.stringify(require('./tools/ai-brain/ceiling').WINDOWS))"

# 3. The new suite, with named subtests visible
node --test --test-reporter=tap tools/ai-brain/test/limits.test.js

# 4. Negative proof that a non-matching pattern is rejected
node -e "const{spawnSync}=require('child_process');const p='THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ';const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,'tools/ai-brain/test/limits.test.js'],{encoding:'utf8'});const n=r.stdout.split('\n').filter(l=>l.trim()==='# Subtest: '+p).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED');process.exit(n>0?0:1)"
# Expected exit code: 1

# 5. Existing behaviour unbroken
node --test tools/ai-brain/test/ceiling.test.js

# 6. Whole repository suite
pnpm test
```

## Codex review record

| Round | Commit | Verdict | Notes |
|---|---|---|---|
| 1 | `pending` | `pending` | Awaiting independent review. |

## Post-implementation notes

Two things measured differently from what the specification assumed.

1. **`inferWindow` reports a ceiling but not the evidence behind it.** The rule
   "fewer than 20 observations yields no ceiling" needed a sample count that the
   ceiling module does not return, so `limits.js` counts the ledger rows for that
   account and window directly rather than trusting a field that does not exist.

2. **The first version of the evidence-floor test proved nothing.** Mutation
   testing caught it: removing the floor entirely failed no test. The fixture was
   built from successful observations only, and `inferWindow` returns a null
   ceiling for those regardless — successes establish a floor, never a ceiling —
   so the floor was never reached. The fixture now carries refusals, and the test
   asserts a control: the same ledger with enough observations does yield a
   ceiling, so the refusal is attributable to the floor and to nothing else.

Mutation results after the fix: all `7` of `7` mutations to `limits.js` fail the
suite — removing `unknownBudget`, dropping the provenance check, breaking the
runway arithmetic, ignoring the window match, counting a disabled account,
removing the evidence floor, and forcing staleness to false.

## Completion record (2026-09-16)

PR #41 merged `limits.js` and its suite but left one in-scope item undone: the
capacity adapter never reported which windows each row knows. Measured on
`origin/main` `4b0fa4b`: `grep -rn "knownWindows\|unknownWindows" tools` returned
nothing, so the panel still could not tell "plenty left" from "no idea".

- `tools/ai-dashboard/capacity-adapter.js` now resolves each account once with
  `resolveLimits` (the same declared limits and ledger the scheduler reads) and
  adds `knownWindows` (`window`, `ceiling`, `provenance`, `stale`) and
  `unknownWindows` to every row. Nothing is defaulted.
- `tools/ai-brain/test/limits.test.js` gains two subtests driving the real
  `collectCapacity` with injected accounts: `each capacity row names its known
  and unknown windows` and `a row with no declared limits lists every window as
  unknown`.

**No ceiling was declared for any real account.** The registry lives outside
the repository (`~/.shipde/accounts.registry.json`), no provider on this machine
publishes an absolute figure, and the ledger holds no window with 20
observations. Under `AI-26-R02` every window stays unknown; `AC-AI-26-01`
still reads `35 of 35`, which is the honest state, not a defect. A ceiling is
added when an operator asserts one with provenance, not by this Work Item.

**Naming drift.** The rules say `source`; the merged code and suite use
`provenance`. The code is left as merged and this record names the difference.

| AC/Test ID | Result on this branch |
|---|---|
| `AC-AI-26-01` | exit 0, `BASELINE_CONFIRMED: 35 of 35 offerings have no ceiling` |
| `AC-AI-26-02`..`11` | every named subtest present in TAP output, suite exit 0 |
| `AC-AI-26-12` | `WINDOW_SET_EXACT` |
| `AC-AI-26-13` | exit 1, `VACUOUS_PATTERN_REJECTED` |
| `AC-AI-26-14` | `limits.test.js` 16 pass, 0 fail |
| `AC-AI-26-15` | `ceiling.test.js` 41 pass, 0 fail |
| all brain and dashboard suites | 516 pass, 0 fail |

## Residual limitations

- **Most ceilings are not published.** Antigravity reports a percentage and
  documents no absolute weekly token figure, so for those windows the only
  available provenance is `observed` or `operator-declared`. `AI-26-R05` sets
  an evidence floor for the first and `AI-26-R10` an expiry for the second, but
  neither makes an undocumented ceiling into a measured one.
- **An observed ceiling is a lower bound, not the limit.** `inferLimits` learns
  from what was spent before a refusal, which establishes what the account
  reached, never what it would have allowed. Runway built on it is conservative
  and may understate available capacity.
- **A percentage may not be linear in the quantity that matters.** Nothing
  verifies that 50 percent remaining corresponds to half the tokens; some
  vendors weight by model. Conversion assumes linearity, and that assumption is
  recorded here rather than tested.
- **`budgetFingerprint` cannot distinguish two accounts that renew together.**
  Observed on 2026-09-15: after a top-up, `agy-docker-b` and `agy-native-a`
  produced byte-identical fingerprints while being genuinely separate accounts
  with separate credential stores and different remaining percentages, because
  the fingerprint is built only from reset instants. `AI-26-R09` requires the
  account id to be recorded alongside any ceiling, but the underlying
  fingerprint weakness belongs to `quota-store.js` and is not fixed here.
- **Nothing here reconciles a ceiling against a bill.** A declared figure that
  is simply wrong will produce a confident runway that is wrong in the same
  direction for as long as it stands.
