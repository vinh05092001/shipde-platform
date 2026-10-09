# TASK-AI-66 — The Controller can see the sources that actually work

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Work Item ID    | `TASK-AI-66`                                                                                                                                                                                                                                                                                         |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                |
| Status          | `IN_PROGRESS` (implementation committed on `feat/task-ai-66-routing-candidates`; Pull Request and Codex review are the next gates)                                                                                                                                                                       |
| Delivery order  | `194` (the next free order after `TASK-AI-65` at `193`)                                                                                                                                                                                                                                              |
| Dependencies    | `TASK-AI-58`; `TASK-AI-62`; `TASK-AI-65`                                                                                                                                                                                                                                                             |
| Assigned author | `GEMINI` (executed in the `ai66cand` worktree per the routing contract)                                                                                                                                                                                                                              |
| Risk            | `MEDIUM` (candidate assembly and the cooldown write path; no schema, no money, no carrier side effect)                                                                                                                                                                                                |
| Allowed paths   | `tools/ai-brain/candidates.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/routing.js`, `tools/ai-brain/evidence.js`, `tools/ai-brain/test/task-ai-66.test.js`, `docs/product-spec/work-items/TASK-AI-66.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer        | `Codex — fresh independent task`                                                                                                                                                                                                                                                                     |
| Branch          | `feat/task-ai-66-routing-candidates`                                                                                                                                                                                                                                                                 |
| Pull Request    | (not yet opened — the commit on this branch is the handoff)                                                                                                                                                                                                                                            |

## Business outcome

`TASK-AI-65` made dispatch route on a task profile, and made the Controller answer with a ranked,
pinned candidate. It is only useful if the Controller can **see** the sources that actually do the
work. On the night of 30/9 it could not, and the gap is recorded here as it was observed.

Real outcomes were recorded for nine candidates with
`node tools/ai-brain/cli.js dispatch --report-outcome <file>`:

- `COMPLETED` — `paseo::cli::9router::ag::ninerouter::ninerouter::ag/gemini-3.1-pro-low`,
  `...::gcli/...::gcli/grok-4.7`, `...::ocz/...::ocz/big-pickle`, `...::gh/...::gh/gpt-4.1`
- `FAILED` — `...::gh/...::gh/gpt-5.3-codex` (`MODEL_NOT_SUPPORTED`), `...::kimchi/...::kimchi/*`
  (`CREDIT_EXHAUSTED`), `...::cl/...::cl/cline-free/deepseek-v4.1-flash` (`AUTH_FAILED`),
  `...::ag/...::ag/gemini-3.1-pro-low` (`QUOTA_EXHAUSTED` until 01:55)

Every one of those four `COMPLETED` sources did real Work Item work that night — commits,
independent reviews, a `PASS` verdict. Then a profile with `proofFloor: API_PASS` and
`requiredHarness: paseo` still refused, and the exclusion counts named the reason:

```
No candidate meets the profile: REFUSED: no candidate meets the profile floors
  EXCLUDED 1461x HARNESS_NOT_REQUIRED, 13x CANDIDATE_BLOCKED,
  188x WILDCARD_ACCOUNT, 12x PROOF_FLOOR_NOT_MET:NONE
```

`PROOF_FLOOR_NOT_MET:NONE` is the whole story. Those four sources **were not candidates at all**, so
their recorded evidence could never be matched and their Work Items could never be routed again.

Two independent defects produce that outcome, and both are closed here.

### Defect 1 — a source only existed if a human had typed its name into a file

`assembleCandidates` (`tools/ai-brain/cli.js`) built candidates from the discovery catalogue and from
`expandOfferings(accounts)`. Offerings come from the account registry, and the `ninerouter` account
declared **eight** models by hand:

```
cc/claude-opus-5, cc/claude-sonnet-5, cc/claude-haiku-4-5-20251001,
kimchi/glm-5.3, kimchi/glm-5.3-flash, kimchi/deepseek-v4-flash-0731, kimchi/minimax-m3,
gh/gpt-5.3-codex
```

The 9Router on this machine serves **886** model ids across 24 upstream aliases (`ag`, `gcli`,
`ocz`, `gh`, `cl`, `kimchi`, `cc`, `cf`, `qd`, `kr`, `bzl`, …). Every alias the operator had not
typed by hand was invisible to the Controller. The sources that happened to do all the real work
that night — `ag`, `gcli`, `ocz`, and `gh/gpt-4.1` — were all of them untyped.

The identity was already correct. What was missing was the *set*: nothing minted a candidate for a
model the gateway itself advertises, on the concrete account that can reach it.

### Defect 2 — the reported cooldown was thrown away

A `QUOTA_EXHAUSTED` outcome carrying `cooldownUntil: "2026-10-01T01:55:00+07:00"` was recorded, and
the instant was discarded. `reportDispatchOutcome` never passed `cooldownUntil` to
`evidence.recordOutcome`, so the cooldown was re-derived from the free-text `reason`. That text said
`reset after ~3h`, which the classifier cannot parse, so it fell through to its
`UNKNOWN` default — **five minutes**:

```json
{"cooldownMs": 300000, "resetTime": null, "cause": "unknown", "scope": "unknown"}
```

A source that was hard down until 01:55 became dispatchable again at 23:00. The reporter's
observation is strictly better evidence than a duration scraped out of a message, and it was being
thrown away in favour of the worse of the two.

## The smallest fix

Reuse the existing modules — discovery, offerings, the sources registry and `candidates.js`. No
second registry, no second ranking pass, no second store.

1. **`candidates.gatewayAccountCandidates({registry, accounts, catalogue})`** — for every account
   whose `provider` names a source that reaches a gateway which serves models, emit one candidate per
   model that gateway advertises, on **that account's own route**: harness from the dispatch table,
   access path from the source, gateway from `reachedVia` (or the source itself, when the provider
   *is* the gateway), `accountId` and `quotaScope` both the concrete account id, `upstream` and
   `modelId` exactly as the gateway advertises them.

   The seven-part key it produces is byte-identical to the one the evidence uses:

   ```
   paseo::cli::9router::<alias>::ninerouter::ninerouter::<alias>/<model>
   ```

   `harness=paseo` (from the dispatch table), `accessPath=cli` (the agent-cli, not the gateway
   endpoint), `gateway=9router` (`reachedVia`), `upstream=<alias>` (the id's own prefix segment),
   `accountId=quotaScope=ninerouter` (the concrete account). The model id is the alias-prefixed id
   **with no second `ninerouter/` prefix**, which is what made `ninerouter/ag/…` a different key
   from `ag/…` and why evidence recorded against one could never match the other.

   An advertised model carries no `quality` and no `cost`. A gateway catalogue proves a route
   exists, never that the account may use it or that it is any good — so the values stay
   undeclared and `scoreForProfile` renormalises over the signals that are known, rather than
   scoring an unproven model as if it were measured.

2. **`cli.assembleForDispatch`** — one assembly for both dispatch paths, so the item path and the
   profile path produce the same candidate objects with the same identity. The advertised candidates
   are merged **after** the offerings, so an operator's declared entry for the same key still wins:
   it carries the declared grades and limits, while the advertised row only proves the route exists.
   An injected candidate list still short-circuits, because a caller supplying candidates is
   replaying or testing them, not asking what the machine serves.

3. **`evidence.recordProbe` honours an explicit `cooldownUntil`** — when a reported item carries a
   parseable instant, that instant becomes the cooldown's `resetTime`; the classification's own
   answer stands otherwise. An unparseable value is ignored, never guessed at, and never becomes
   `NaN`. `routing.reportDispatchOutcome` passes the reporter's `cooldownUntil` through, so
   `isCooldownActive` excludes the source until exactly that moment.

4. **One hard-coded gateway id removed.** `cli.js` defaulted an offering's gateway to the literal
   `'9router'` whenever its provider was not a router. That is the exact defect the no-hardcode rule
   exists to prevent, on the identity path: it mints keys that look dispatchable but can never match
   real evidence. The gateway is now derived from the registry, and an unknown gateway is recorded as
   empty rather than guessed.

### Where the catalogue comes from

`tools/ai-brain/data/discovery` — the committed ledger that discovery already maintains, and the only
thing this path reads. No network call is added to dispatch.

To refresh it against what the local 9Router serves now:

```
node tools/ai-brain/discovery.js run
```

`run` reads the router's own `/v1/models` listing through the registry-declared endpoint
(`http://127.0.0.1:20128/v1/models`), attaching `NINEROUTER_API_KEY` from the process environment
for that single request. The credential is never returned, logged, stored or snapshotted —
`discovery/http.js` puts it on the wire and `describeRequest` reports only `{url, auth:
'credentialed'}`. It is a `GET` of a models list and refuses every other request shape.

The committed catalogue is a snapshot, and snapshots go stale: `cl/cline-free/deepseek-v4.1-flash`
is served by the router today and is **not** in the committed ledger, so that key is absent until a
refresh. All other eight recorded keys already match. This is the intended relationship — the ledger
is the authority on what was observed, and a refresh is how new reality enters it.

## Source references

- `AGENTS.md` — "No production hardcode" and the code review rules; a name in the data is fine, a
  name in the code is the bug.
- `docs/product-spec/work-items/TASK-AI-65.md` — the profile dispatch, `proofFloor`, the pinned
  execution contract and `--report-outcome` this Work Item feeds.
- `docs/product-spec/work-items/TASK-AI-62.md` — honest proof levels; `API_PASS` is what
  `--report-outcome` mints, and the floor the refused profile above asked for.
- `docs/product-spec/work-items/TASK-AI-58.md` — the Controller's selection, evidence and cooldown
  stores, reused unchanged.
- `tools/ai-brain/sources.js` — the rule that nothing in the dispatch path may branch on a source id,
  and the registry this fix derives every route from.
- Supervisor gap evidence (30/9 23:25, on `main`): the nine `--report-outcome` records and the
  refusal with the four exclusion counts quoted in the business outcome.

## Preconditions and dependencies

- `TASK-AI-58` merged — the Controller owns evidence, cooldowns and ranking.
- `TASK-AI-62` merged — the honest proof ladder the `proofFloor` reads.
- `TASK-AI-65` merged — the profile dispatch path this candidate set feeds.
- No new model, provider, account or gateway registration: every route and every model id in this
  change is read from the registry or from the advertised catalogue.

## Out of scope

- Launching a harness from the profile path. It pins; the executor launches, unchanged.
- Changing the floors, the weights or the ranking in `routing.js`.
- Refreshing the committed discovery catalogue in this Pull Request. A refresh is an observation,
  recorded by the operator with `discovery.js run`, not a code change; the ledger is left as found so
  the reviewer can measure the before and the after.
- Any product, UI, API, persistence, tenant, money or carrier change.

## Acceptance matrix

All rows are covered by `tools/ai-brain/test/task-ai-66.test.js` (`66-01`..`66-09`), which runs
inside `pnpm test:brain` (`node --test "tools/ai-brain/test/*.test.js"`). The suite is hermetic: no
network, no 9Router, no `$HOME`, no real registry and no machine clock — the advertised catalogue is
a fixture, the registry is a literal, and the clock is fixed. Paths come from `os.tmpdir()`, so the
suite is Ubuntu-safe.

| AC/Test ID | Scenario | Expected result | Contract test |
| --- | --- | --- | --- |
| `AC-AI-66-01` | A gateway advertises four models across two aliases; the account declared one. | Four candidates, all on the concrete account's route, each `upstream` equal to the alias its own id carries. | `66-01` |
| `AC-AI-66-02` | The key a real outcome was recorded against is compared field for field with a generated key. | Seven parts; `harness`/`accessPath`/`gateway` identical; `quotaScope` equals `accountId`; the model id carries its own alias with no second prefix. | `66-02` |
| `AC-AI-66-03` | A profile with `proofFloor: API_PASS` runs before and after a recorded `COMPLETED` outcome for one advertised source. | Before: exit 1 naming `PROOF_FLOOR_NOT_MET:NONE`. After: exit 0, that exact key pinned and shown in the top 3 with `proof API_PASS`. | `66-03` |
| `AC-AI-66-04` | A `QUOTA_EXHAUSTED` outcome carries `cooldownUntil`; the reason text also says `reset after ~3h`. | The recorded reset time is the reported instant; blocked one minute before it, free one minute after — the 5-minute default and the 3-hour text both lose. | `66-04` |
| `AC-AI-66-05` | A `cooldownUntil` that does not parse is reported. | No instant is stored, `resetTime` is never `NaN`, and the classified cooldown still applies. | `66-05` |
| `AC-AI-66-06` | The account is disabled, its provider is unrouted, its source is retired or deferred, or the gateway advertises nothing. | Zero candidates in every case — skipped, never guessed. | `66-06` |
| `AC-AI-66-07` | The gateway's own pseudo-group (`combo66`/`combo66`) and an id that disagrees with its own upstream are advertised. | Neither becomes a candidate: an unprefixed id names no reachable alias, and one of two disagreeing fields is wrong. | `66-07` |
| `AC-AI-66-08` | The candidate-identity path is scanned for the alias and model names from the 30/9 run. | No match in executable code in `candidates.js`, `cli.js`, `routing.js`, `evidence.js`, `offerings.js`, `sources.js`, `ranking.js`. | `66-08` |
| `AC-AI-66-09` | Advertised-but-undeclared models are inspected for invented scores. | No `quality`, no `cost`; the one declared model still resolves and keeps its declared grade. | `66-09` |

## Verification evidence

- `node --test "tools/ai-brain/test/*.test.js"` — **1071 tests, 1071 pass, 0 fail** (includes the 9
  new TASK-AI-66 tests; no regression in the existing 1062).
- Real dry run on this machine, before the change, against the `live-reviewer.json` profile
  (`proofFloor: API_PASS`, `requiredHarness: paseo`, `forbiddenFailureDomains: ["gcli"]`):
  `EXCLUDED 1469x HARNESS_NOT_REQUIRED, 257x CLAUDE_FAMILY_EXCLUDED_BY_POLICY, 188x
  WILDCARD_ACCOUNT, 17x PROOF_FLOOR_NOT_MET:NONE` — the four sources that did the night's work were
  not in the candidate set at all.
- Real dry run after the change, same command and same profile: a top 3 is returned. See
  `ai66-result.txt` for the verbatim output.
- Key match against the real evidence keys, on this machine's committed catalogue: 8 of 9 recorded
  keys now resolve to an exact candidate, including all four `COMPLETED` sources
  (`ag/gemini-3.1-pro-low`, `gcli/grok-4.7`, `ocz/big-pickle`, `gh/gpt-4.1`). The ninth,
  `cl/cline-free/deepseek-v4.1-flash`, is served by the router today and is absent only because the
  committed ledger predates it; after `node tools/ai-brain/discovery.js run` into a scratch
  directory, all 9 resolve, at 1858 candidates across 24 aliases.
- Cooldown, probed through the real `dispatch --report-outcome` on a temp evidence store: the
  reported `2026-10-01T01:55:00+07:00` became `resetTime 2026-09-30T18:55:00.000Z`; blocked at +30
  min and +1 h, free at +3 h. Before the change the same outcome recorded
  `{"cooldownMs": 300000, "resetTime": null, "cause": "unknown"}`.

## Known limitations

- **The committed catalogue is a snapshot.** A model the router begins serving after the last
  `discovery.js run` is not a candidate until that command is run again. This is the intended
  relationship between observation and the ledger, and it is why the refresh command is documented
  above rather than hidden in a script.
- **An advertised model is unproven by construction.** It carries no quality and no cost, so it
  cannot meet a proof floor above `NONE` until an outcome is recorded for it. That is the point: the
  catalogue makes a source *visible*, and only evidence makes it *eligible*.
- **A gateway catalogue is the union of the accounts logged into it.** Advertising a model proves a
  route exists, never that the specific account has quota for it. The account is named on the
  candidate so a refusal scopes to the right budget, but the first run against a newly visible alias
  may still return 402 or 429, and that is the first real evidence about that alias.
- **The candidate set grows with the catalogue.** 886 advertised ids on one gateway becomes ~1858
  candidates across the two accounts that reach it. The floors and the score already handle that
  (the existing dry run ranked ~1930 candidates), but the number is now bounded by what a gateway
  advertises rather than by how much an operator typed.
- **Only the offering path's gateway fallback changed.** Other default fallbacks that predate this
  Work Item (`discovery/read.js` defaulting a missing `accessPath` to a literal) are untouched; they
  are not routing decisions and widening this change to them is unrelated cleanup.
