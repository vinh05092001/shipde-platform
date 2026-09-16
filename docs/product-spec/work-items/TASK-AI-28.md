# TASK-AI-28 — Automatic cooldown on provider refusal

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-28` |
| Feature ID | `N/A` |
| Status | `BACKLOG` |
| Delivery order | `161` |
| Dependencies | `none` |
| Assigned author | `CLAUDE` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/ceiling.js`, `tools/ai-brain/quota.js`, `tools/ai-brain/offerings.js`, `tools/ai-brain/scheduler.js`, `tools/ai-brain/test/ceiling.test.js`, `tools/ai-brain/test/cooldown.test.js`, `docs/product-spec/work-items/TASK-AI-28.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-28-auto-cooldown` |
| Pull Request | `pending` |

## Business outcome

The cooldown machinery is already written and has never run.

`ceiling.js` exports `cooldownFor(window, now)`, which returns the instant an
offering should become eligible again. `quota.js:83` refuses an offering whose
`account.cooldownUntil` lies in the future. `offerings.js` threads
`cooldownUntil` from the account and the offering entry into every headroom
calculation. Each piece works and is tested.

Nothing connects them. A repository-wide search finds `cooldownFor` and
`recordFailure` called only from `tools/ai-brain/test/ceiling.test.js`, and
`cooldownUntil` only ever read, never written by any production path. When a
provider answers `429` or "quota exceeded", the scheduler learns nothing: the
next task is routed to the same offering, is refused again, and the operator
is the only circuit breaker in the system.

This Work Item closes that gap. A refusal observed at the call site must cool
the offering that produced it, for a duration derived from the limit window
that was actually hit, and the ladder must step down a tier rather than retry
into the same wall.

## Source references

- `tools/ai-brain/ceiling.js` — `isQuotaRefusal`, `recordFailure`, `cooldownFor`, `Outcome`, `WINDOWS`, `LEDGER_FILE`
- `tools/ai-brain/quota.js:83` — the existing cooldown refusal path
- `tools/ai-brain/offerings.js:155,177,183` — where `cooldownUntil` enters headroom
- `tools/ai-brain/quota-store.js` — `DEFAULT_FAILURE_MAX_AGE_MS`, the 60-second expiry a failed reading already gets
- `AI-TOOL-10` — a failed or partial operation reports exact state; it must not be recorded as healthy

## Preconditions and dependencies

- No Work Item dependency. The register records `dependencies` as empty and the
  status as `BACKLOG`; this document does not advance it.
- The observation ledger at `~/.shipde/quota.observations.json` (`LEDGER_FILE`)
  already exists and is written by `record` and `recordFailure`.
- `cooldownFor` already returns the durations this Work Item relies on:
  `requestsPerMinute` 2 minutes, `requestsPerDay` 60, `tokensPerDay` 60,
  `tokensPerMonth` 240, and 5 minutes for an unrecognised window.

## Author boundary

The implementation may change only the files in `Allowed paths`. It may not
edit `.github/`, `scripts/verify-*`, `docs/product-spec/scripts/`, any
workflow, or any other Work Item document. It may not alter the column schema
of the delivery register, and it may not change any status or lifecycle state.

## In scope

- Wire refusal observation into the call site: when a provider call fails and
  `isQuotaRefusal` matches the error text, record the refusal through
  `recordFailure` and write a `cooldownUntil` for the offering.
- Derive the cooldown duration from the window that was hit, via the existing
  `cooldownFor`, rather than a fixed sleep.
- Step the ladder down one tier on refusal, so the next attempt uses a
  different offering instead of the one that just refused.
- Persist `cooldownUntil` where `quota.js` and `offerings.js` already read it,
  so no reader changes.
- Distinguish a quota refusal from every other failure. A network error, a
  timeout, a 500, or a routing error such as "no available channel" must not
  cool anything: cooling on those hides an outage as if it were a budget.
- Expire a cooldown by time alone. No success is required to clear it, because
  an offering that is cooling is never called and so can never produce one.
- Author `tools/ai-brain/test/cooldown.test.js` covering each rule below with
  injected clocks and an injected ledger path, so the suite needs no real
  provider and no real home directory.

## Out of scope

- Changing the durations in `cooldownFor`. They are inherited as specified.
- Adding new quota signal patterns to `QUOTA_SIGNALS` in `ceiling.js`. Signal
  accuracy is `TASK-AI-26`'s concern.
- Any retry, backoff or queue behaviour beyond stepping down one tier.
- Reading vendor quota endpoints. This Work Item observes refusals that already
  happened; it does not poll.
- Surfacing cooldown state in the dashboard.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-28-R01` | **Only a quota refusal cools.** A failure cools an offering only when `isQuotaRefusal(errorText)` returns `true`. Every other failure — network, timeout, `5xx`, routing errors such as "no available channel" — records nothing and cools nothing. Cooling on a transient outage converts a five-second blip into a sixty-minute blackout of a budget that was never exhausted. |
| `AI-28-R02` | **The duration comes from the window that was hit.** The cooldown instant is `cooldownFor(window, now)` where `window` is the limit window the refusal identifies. An unrecognised or absent window yields the 5-minute default. No caller may substitute its own duration. |
| `AI-28-R03` | **Cooldown is written where it is already read.** The implementation writes `cooldownUntil` as an ISO-8601 instant onto the offering or account record that `quota.js:83` and `offerings.js:155` already consult. No reader is modified; if a reader needs changing, the write is in the wrong place. |
| `AI-28-R04` | **Time alone clears a cooldown.** A cooldown expires when `Date.parse(cooldownUntil) <= now`. Nothing else clears it — not a success elsewhere, not a restart, not a new reading. An offering under cooldown is never called, so requiring a success to clear it would make the state permanent. |
| `AI-28-R05` | **One tier down, not one offering along.** On refusal the ladder selects the next tier, not the next offering within the same tier. Offerings in a tier typically share an account and therefore a budget; moving sideways retries the same wall. |
| `AI-28-R06` | **A cooled offering is excluded, not down-ranked.** `offeringHeadroom` must report a cooled offering as unavailable, so ranking cannot restore it by scoring it highly on cost or quality. |
| `AI-28-R07` | **The refusal is recorded before the cooldown is written.** If recording to the ledger fails, the cooldown is still written. The cooldown protects the next call; the ledger is evidence. Losing the evidence must not lose the protection. |
| `AI-28-R08` | **Idempotent under repeat refusals.** A second refusal for an offering already cooling extends the cooldown only if the newly computed instant is later than the stored one. A shorter window must never shorten a longer cooldown already in force. |
| `AI-28-R09` | **No silent global cooldown.** A refusal cools exactly the offering that produced it. It must not cool the account, the tier, or any sibling offering, because a per-model limit and a per-account limit are different ceilings and the refusal names only one. |
| `AI-28-R10` | **Every cooldown is attributable.** The stored record carries the offering id, the instant, the window that produced it, and the first 120 characters of the refusal text. A cooldown whose cause cannot be read back is indistinguishable from a bug. |

## UI states

Not applicable. This Work Item has no user-facing screen. Operator-visible
behaviour is confined to the scheduler's routing decisions and to the
observation ledger at `~/.shipde/quota.observations.json`.

## API, event and data impact

- No database schema, backend API, or carrier protocol change.
- The observation ledger gains refusal entries written through the existing
  `recordFailure`; its file format is unchanged.
- Offering records gain a `cooldownUntil` string. Both consumers already read
  this field and treat its absence as "not cooling", so records written before
  this change remain valid.

## Acceptance matrix

**Evidence boundary.** Every row below runs against the real modules in
`tools/ai-brain/` with an injected clock and an injected ledger path. No row is
satisfied by citing this document, and no row reimplements the logic it
verifies — a row that rebuilt `cooldownFor` or `isQuotaRefusal` inline would
pass with the wiring absent, which is precisely the defect this Work Item
exists to close.

| AC/Test ID | Scenario | Exact Command | Exit Code | Expected Output String | Output Source / Artifact |
|---|---|---|---|---|---|
| `AC-AI-28-01` | The gap this Work Item closes is real: nothing in production calls the cooldown machinery | `node -e "const{spawnSync}=require('child_process');const r=spawnSync('git',['grep','-nE','cooldownFor|recordFailure','--','tools/ai-brain'],{encoding:'utf8'});const prod=r.stdout.split('
').filter(l=>l&&!l.includes('/test/')&&!l.includes('ceiling.js'));if(prod.length===0){console.log('BASELINE_CONFIRMED: cooldown machinery has no production caller');process.exit(0)}console.error('BASELINE_STALE: '+prod.length+' production caller(s)');process.exit(1)"` | `0` | `BASELINE_CONFIRMED: cooldown machinery has no production caller` | `git grep` over `tools/ai-brain` |
| `AC-AI-28-02` | A quota refusal cools the offering for the window's duration | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: a 429 refusal cools the offering for the window duration` | TAP output |
| `AC-AI-28-03` | Negative proof: a network error cools nothing | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: ECONNREFUSED records nothing and cools nothing` | TAP output |
| `AC-AI-28-04` | Negative proof: a routing error cools nothing | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: a routing error does not cool the offering` | TAP output |
| `AC-AI-28-05` | The duration is the window's, not a caller's constant | `node -e "const{cooldownFor}=require('./tools/ai-brain/ceiling');const NOW=Date.parse('2026-01-01T00:00:00Z');const m=w=>(Date.parse(cooldownFor(w,NOW))-NOW)/60000;const got=[m('requestsPerMinute'),m('requestsPerDay'),m('tokensPerDay'),m('tokensPerMonth'),m('nonsense')];const want=[2,60,60,240,5];if(JSON.stringify(got)!==JSON.stringify(want)){console.error('WINDOW_DURATION_DRIFT: '+JSON.stringify(got));process.exit(1)}console.log('WINDOW_DURATIONS_EXACT: '+JSON.stringify(got))"` | `0` | `WINDOW_DURATIONS_EXACT: [2,60,60,240,5]` | `tools/ai-brain/ceiling.js` |
| `AC-AI-28-06` | A cooled offering is excluded from headroom, not merely down-ranked | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: a cooling offering is reported unavailable by offeringHeadroom` | TAP output |
| `AC-AI-28-07` | A later refusal extends a cooldown; an earlier one does not shorten it | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: a shorter window never shortens a cooldown already in force` | TAP output |
| `AC-AI-28-08` | Time alone clears the cooldown; no success is required | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: the cooldown clears on time alone` | TAP output |
| `AC-AI-28-09` | A refusal cools only the offering that produced it | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: a refusal does not cool sibling offerings or the account` | TAP output |
| `AC-AI-28-10` | The ladder steps down a tier rather than sideways | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: refusal steps the ladder down one tier` | TAP output |
| `AC-AI-28-11` | A ledger write failure does not cost the cooldown | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: an unwritable ledger still leaves the offering cooling` | TAP output |
| `AC-AI-28-12` | The stored cooldown is attributable | `node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js` | `0` | `# Subtest: the record names the offering, window and refusal text` | TAP output |
| `AC-AI-28-13` | Negative proof that the TAP assertions above are not vacuous: a pattern matching no test is rejected | `node -e "const{spawnSync}=require('child_process');const p='THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ';const f='tools/ai-brain/test/cooldown.test.js';const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,f],{encoding:'utf8'});const n=r.stdout.split('\n').filter(l=>l.trim()==='# Subtest: '+p).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED: 0 tests matched '+p);process.exit(n>0?0:1)"` | `1` | `VACUOUS_PATTERN_REJECTED: 0 tests matched THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ` | command stdout |
| `AC-AI-28-14` | The whole suite is green and the count is non-zero | `node --test tools/ai-brain/test/cooldown.test.js` | `0` | `fail 0` | test runner stdout |
| `AC-AI-28-15` | Existing quota behaviour is unbroken | `node --test tools/ai-brain/test/ceiling.test.js` | `0` | `fail 0` | test runner stdout |

`AC-AI-28-02` through `AC-AI-28-12` name TAP subtests directly rather than
asserting only an exit code, because `node --test` exits `0` when
`--test-name-pattern` matches nothing — measured, and the reason
`AC-AI-28-13` exists. A reviewer checking these rows must see the named
`# Subtest:` line in the output, not merely a zero exit.

## Verification commands

```bash
# 1. The baseline gap this Work Item closes
node -e "const{spawnSync}=require('child_process');const r=spawnSync('git',['grep','-nE','cooldownFor|recordFailure','--','tools/ai-brain'],{encoding:'utf8'});const prod=r.stdout.split('
').filter(l=>l&&!l.includes('/test/')&&!l.includes('ceiling.js'));if(prod.length===0){console.log('BASELINE_CONFIRMED: cooldown machinery has no production caller');process.exit(0)}console.error('BASELINE_STALE: '+prod.length+' production caller(s)')"

# 2. Window durations, unchanged from ceiling.js
node -e "const{cooldownFor}=require('./tools/ai-brain/ceiling');const N=Date.parse('2026-01-01T00:00:00Z');console.log([2,60,60,240,5].join(',')==='requestsPerMinute,requestsPerDay,tokensPerDay,tokensPerMonth,nonsense'.split(',').map(w=>(Date.parse(cooldownFor(w,N))-N)/60000).join(',')?'EXACT':'DRIFT')"

# 3. The cooldown suite, with named subtests visible
node --test --test-reporter=tap tools/ai-brain/test/cooldown.test.js

# 4. Negative proof that a non-matching pattern is rejected
node -e "const{spawnSync}=require('child_process');const p='THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ';const r=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+p,'tools/ai-brain/test/cooldown.test.js'],{encoding:'utf8'});const n=r.stdout.split('\n').filter(l=>l.trim()==='# Subtest: '+p).length;console.log(n>0?'MATCHED_TESTS='+n:'VACUOUS_PATTERN_REJECTED');process.exit(n>0?0:1)"
# Expected exit code: 1

# 5. Existing quota behaviour unbroken
node --test tools/ai-brain/test/ceiling.test.js

# 6. Whole repository suite
pnpm test
```

## Codex review record

| Round | Commit | Verdict | Notes |
|---|---|---|---|
| 1 | `pending` | `pending` | Awaiting independent review. |

## Residual limitations

- **The refusal text is the only evidence of which window was hit.** Providers
  do not agree on wording, and `QUOTA_SIGNALS` matches text rather than a
  structured field. A refusal whose wording names no window falls to the
  5-minute default, which is deliberately short: guessing a long cooldown from
  an unparsed message would take an offering out of service on no evidence.
- **Nothing here measures whether the cooldown was the right length.** The
  durations are inherited from `cooldownFor` and were not derived from
  observed reset behaviour. If a provider's window is longer than the value
  chosen, the ladder will step back into a refusal once and cool again.
- **A cooldown is per-process state until it is persisted.** The write target
  in `AI-28-R03` is the record the existing readers consult; if that record is
  in-memory for a given run, a restart clears the cooldown and the first call
  after restart will be refused again. Persisting across restarts is not
  specified here and should be raised separately if the refusal cost matters.
- **Tier step-down assumes tiers are ordered by budget independence.** `AI-28-R05`
  is only correct while offerings within a tier share an account. If a future
  registry places independent accounts in the same tier, stepping down a whole
  tier will skip capacity that was available.

## Post-implementation notes

Measured while implementing, on branch `feat/task-ai-28-cooldown-tests`:

- **The `Branch` field in Control is wrong for this delivery.** It names
  `feat/task-ai-28-auto-cooldown`; the work was delivered on
  `feat/task-ai-28-cooldown-tests`. The field was not edited, because the
  Author boundary forbids changing control state.
- **`AC-AI-28-05`'s durations hold exactly.** Measured
  `[2,60,60,240,5]` minutes for `requestsPerMinute`, `requestsPerDay`,
  `tokensPerDay`, `tokensPerMonth` and an unrecognised window. No drift.
- **`AC-AI-28-01`'s baseline still holds after this change.** `git grep -nE
  'cooldownFor|recordFailure' -- tools/ai-brain`, with `/test/` and
  `ceiling.js` lines removed, returns no line. The wiring added here
  (`observeRefusal`) lives inside `ceiling.js`, so no production *call site*
  outside the module exists yet: `scheduler.js` still does not observe
  refusals. The scheduler call site remains open work.
- **`AC-AI-28-13` is confirmed, and it is the reason no test here asserts via
  a name pattern.** Measured: `node --test --test-reporter=tap
  --test-name-pattern=THIS_TEST_DOES_NOT_EXIST_AT_ALL_XYZ
  tools/ai-brain/test/cooldown.test.js` exits `0` with zero subtests matched.
  A row that checked only the exit code would pass against an empty file.
- **The test file the spec promised did not exist.** `tools/ai-brain/test/cooldown.test.js`
  is new here; before it, `cooldownFor`, `Outcome`, `WINDOWS` and `recordFailure`
  were exercised only incidentally by `ceiling.test.js`.
- **Mutation evidence (the tests are not vacuous).** With `cooldownFor`
  neutered to return a fixed instant: 13 tests, 10 pass, 3 fail. With
  `observeRefusal` neutered to return a constant object: 13 tests, 5 pass,
  8 fail. Restored: 13 pass, 0 fail. The 5 that survive the second mutation
  are the headroom and ladder rows, which exercise `offerings.js` and
  `quota.js` rather than the observer.
- **`AI-28-R05` needed a helper that did not exist.** `offerings.js` exported
  `laddered` but nothing that chose the next rung, so "one tier down, not one
  offering along" was unrepresentable. `nextTierDown` was added there.
