# TASK-AI-65 — Live routing: task profile → JEV → Controller ranking → pinned execution

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-65`                                                                                                                                                                                                                                                                                                                                            |
| Feature ID      | `N/A`                                                                                                                                                                                                                                                                                                                                                   |
| Status          | `IN_PROGRESS` (implementation committed on `feat/task-ai-65-live-routing`; Pull Request and Codex review are the next gates)                                                                                                                                                                                                                              |
| Delivery order  | `193` (the next free order after `TASK-AI-64` at `192`)                                                                                                                                                                                                                                                                                                 |
| Dependencies    | `TASK-AI-58`; `TASK-AI-64`                                                                                                                                                                                                                                                                                                                              |
| Assigned author | `GEMINI` (executed in the `ai65route` worktree per the routing contract)                                                                                                                                                                                                                                                                                |
| Risk            | `HIGH` (Controller selection policy, JEV advisory seam, evidence/cooldown write path)                                                                                                                                                                                                                                                                   |
| Allowed paths   | `tools/ai-brain/routing.js`, `tools/ai-brain/cli.js`, `tools/ai-brain/test/task-ai-65.test.js`, `docs/product-spec/work-items/TASK-AI-65.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`                                                                                                                                |
| Reviewer        | `Codex — fresh independent task`                                                                                                                                                                                                                                                                                                                        |
| Branch          | `feat/task-ai-65-live-routing`                                                                                                                                                                                                                                                                                                                          |
| Pull Request    | (not yet opened — the commit on this branch is the handoff)                                                                                                                                                                                                                                                                                             |

## Business outcome

Live dispatch finally routes on what the task actually needs. Before this Work Item the supervisor
verified two facts on `origin/main`, recorded as the gap `LIVE_ROUTING_NOT_WIRED`:

1. `tools/ai-brain/jev.js` (`advise` / `adviseOrReason`) was required by no production module;
   nothing asked JEV anything before a dispatch.
2. `node tools/ai-brain/cli.js dispatch --dry-run --item TASK-AI-64` returned the **identical**
   candidate list for `--role reviewer.security` and `--role author.foundation`: every candidate
   scored 26, all on the same `9router`/`antigravity`/`agy-native-a` failure domain — including a
   `claude-opus` candidate, although Claude models are forbidden as worker/reviewer. Role, latency,
   availability and the writer's failure domain influenced nothing.

After this Work Item, one dispatch names a **task profile** and the Controller answers with a ranked,
pinned candidate:

```
node tools/ai-brain/cli.js dispatch --dry-run --profile <file.json>
node tools/ai-brain/cli.js dispatch --execute  --profile <file.json>
node tools/ai-brain/cli.js dispatch --report-outcome <file.json>
```

The smallest slice that closes the gap, reusing the existing modules (`ranking.js`,
`candidates.js`, `capabilities.js`, `quota-store.js`, `decisions.js`, `failure-classifier.js`,
`evidence.js`, `cli.js dispatch`) rather than rewriting them:

1. **Task profile schema/validator** (`tools/ai-brain/routing.js:validateTaskProfile`): `taskId`,
   `role` (`writer|reviewer|security-review|scanner|researcher|integrator`), `complexity`,
   `requiredCapabilities`, `proofFloor`, `contextSize`, `expectedDuration`, `latencyPriority`,
   `qualityFloor`, `costCeiling`, `requiredHarness`, `forbiddenFailureDomains`, `resourceCeiling`,
   `currentWorkload`. An invalid profile is refused with per-field reason codes, never patched with
   defaults.
2. **JEV assessment step** (`routing.js:assessTask`, via `jev.adviseOrReason`): returns
   `taskClass`, `capabilityRequirements`, `difficulty`, latency/quality/cost weights,
   `recommendedModelClass` (a class: `fast` / `balanced` / `high-quality` — **never** a model,
   provider or account), `confidence`, `reasonCodes`. The `ask` function is injectable; with none
   configured — or on error or low confidence — the result is `UNDECIDED` and the Controller still
   decides from deterministic per-role fallback weights (`ROLE_FALLBACK_PROFILE`,
   `controllerFallbackProfile`). Never a crash, never a guess.
3. **Controller ranking** (`routing.js:rankForProfile`): hard floors first — proof level for the
   role (`proofFloor`, only *passed* evidence counts), quality floor, capability/context
   requirements, required harness, cost ceiling, availability (quota-exhausted and cooldown
   candidates excluded), resource ceiling (`currentWorkload >= resourceCeiling` refuses), the
   Claude-family policy (worker/reviewer roles exclude `claude|opus|sonnet|haiku` model ids with
   reason `CLAUDE_FAMILY_EXCLUDED_BY_POLICY`) and forbidden failure domains (the security
   reviewer must land outside the writer's domain). The score then optimises the **fastest
   candidate meeting the floors** — latency, quality and cost weighted by the JEV/Controller
   weights, with a busy/reservation penalty and an evidence-age penalty — not the strongest
   candidate.
4. **Top 3 output**: `rank | candidateKey (7-part) | expected duration | proof | quota |
   failure-domain | reason`, and rank 1 is reserved through the existing `quota-store`
   reservation under `--execute`.
5. **Pinned execution contract**: the dispatch returns (and prints) the pinned
   `candidateKey`; the executor reports a structured failure outcome
   `{candidateKey,status,errorClass,httpStatus,lastProgressAt,reason}` through `dispatch --report-outcome`, which updates evidence and
   cooldown through the existing `evidence.recordOutcome` (and its failure classification) before
   the next ranking round. Stall thresholds are constants with tests:
   `STALL_REQUEST_FINISH_MS = 7 min` (request finish) and
   `STALL_STRUCTURED_FAILURE_MS = 12 min` (structured failure → reselect).
6. **Decision log**: every profile dispatch writes one `selected` entry through `decisions.js`
   carrying the task profile, the JEV result, the full ranking and the final candidate.

No model, provider, account or gateway id is hard-coded in the routing code. The one family name in
`routing.js` is the Claude-family **exclusion** policy from `AGENTS.md` — a refusal rule, not a
routing choice — and analyst lanes (`scanner`, `researcher`, `integrator`) are not covered by that
bar.

## Source references

- `AGENTS.md` — role separation (Claude is analyst, never worker/reviewer); author routing;
  definition of a complete feature; code review rules (no production hardcode).
- `docs/product-spec/work-items/TASK-AI-58.md` — the Controller MVP: selection, evidence, quota,
  ranking, reservation, checkpoint, decision log. This Work Item calls those modules; it does not
  replace them.
- `docs/product-spec/work-items/TASK-AI-62.md` — honest proof levels (`API_PASS`,
  `HARNESS_PASS`, `WORK_ITEM_PASS`) and the one-way ladder, reused as the `proofFloor`.
- `docs/product-spec/work-items/TASK-AI-64.md` — the live loop this routing feeds; `AI-64-R03`
  (the Controller's decision is written, never discarded) and `AI-64-R11` (failure-domain rule
  stays the Controller's `sameFailureDomain`) apply unchanged.
- Supervisor gap evidence `LIVE_ROUTING_NOT_WIRED` (verified on `origin/main`): the two commands
  and their identical outputs quoted in the business outcome above.

## Preconditions and dependencies

- `TASK-AI-58` merged — the Controller owns selection, evidence, quota, reservations and the
  decision log.
- `TASK-AI-64` merged — the live loop exists and consumes Controller decisions; this Work Item
  gives the loop a profile-driven entry to the same dispatch seam.
- No new model, provider, account or gateway registration.

## Out of scope

- Changing the item-based `dispatch` ranking (`ranking.rankAndRecord`), its weights or its callers.
- Launching an agent from the profile path: the profile dispatch **pins**; execution and outcome
  reporting are separate steps of the pinned contract.
- A configured JEV `ask` implementation (a live advisory endpoint). The seam is injectable; with
  nothing configured the Controller decides deterministically.
- Any product, UI, API, persistence, tenant, money or carrier change.

## Acceptance matrix

All rows are covered by `tools/ai-brain/test/task-ai-65.test.js` (`65-01`..`65-12`), which runs
inside `pnpm test:brain` (`node --test "tools/ai-brain/test/*.test.js"`).

| AC/Test ID | Scenario | Expected result | Contract test |
| --- | --- | --- | --- |
| `AC-AI-65-01` | A short task with a high latency priority picks the fast candidate meeting the proof floor, not the strongest. | The fast candidate is pinned; the stronger one is ranked lower, not dropped. | `65-01` |
| `AC-AI-65-02` | A security review meets its quality floor and lands outside the writer's failure domain. | Chosen candidate is off the writer's gateway/upstream; writer-domain, low-quality and Claude candidates are excluded with named reasons. | `65-02` |
| `AC-AI-65-03` | A quota-exhausted candidate is never chosen. | `QUOTA_EXHAUSTED` exclusion with the named account scope. | `65-03` |
| `AC-AI-65-04` | A busy/reserved candidate is penalised. | An equally good free candidate outranks one holding a reservation. | `65-04` |
| `AC-AI-65-05` | A gateway failure reported through `--report-outcome` switches the next ranking to another failure domain. | The failed gateway's candidates are excluded by the evidence-store cooldown; the next pin is on another gateway. | `65-05` |
| `AC-AI-65-06` | A JEV UNDECIDED advisory is still handled by the Controller. | No-ask, throwing-ask and low-confidence asks all end `UNDECIDED`/controller with deterministic weights; the dispatch still pins. | `65-06` |
| `AC-AI-65-07` | No model, provider or account is hard-coded in the routing code. | Source scan of `routing.js` and `cli.js` finds no routing literal naming a model/provider family; the Claude-family pattern exists only as the policy exclusion. | `65-07` |
| `AC-AI-65-08` | The decision log records profile, JEV result, full ranking and final candidate. | One `selected` entry joins `taskProfile`, `jev`, the scored `ranking` and `chosen`. | `65-08` |
| `AC-AI-65-09` | The Claude family is excluded from worker and reviewer roles by policy. | Excluded for `writer`/`reviewer`/`security-review`; allowed on analyst lanes (`scanner`/`researcher`/`integrator`). | `65-09` |
| `AC-AI-65-10` | An invalid task profile is refused. | Exit 2 with `PROFILE_INVALID` and per-field reason codes; no ranking happens. | `65-10` |
| `AC-AI-65-11` | Stall thresholds are the contract constants. | 7 min (request finish) and 12 min (structured failure → reselect) drive `stallAssessment`. | `65-11` |
| `AC-AI-65-12` | `--report-outcome` validates its input, updates evidence/cooldown and writes a decision entry. | Invalid outcomes exit 2; a valid failed outcome blocks the candidate in the evidence store and records a `failed` decision with the stall verdict. | `65-12` |

## Verification evidence

- `node --test "tools/ai-brain/test/*.test.js"` — **1048 tests, 1048 pass, 0 fail** (includes the
  18 new TASK-AI-65 tests; no regression in the existing suites).
- `node tools/ai-brain/cli.js dispatch --dry-run --profile <sample security-review profile>` —
  real registry candidates, exits 0: JEV `UNDECIDED` → Controller weights `QUALITY_FIRST`;
  top 3 spans `9router/gh` and `9router/kimchi` failure domains (the writer's
  `antigravity`/`agy-native-a` domain and all Claude candidates excluded); scores 88/81/80 instead
  of a flat 26; pinned
  `paseo::cli::9router::gh::ninerouter::ninerouter::gh/gpt-5.3-codex`.

## Known limitations

- The profile path pins and reserves; it does not itself launch the harness. Launching remains the
  executor's job, per the pinned execution contract.
- With no JEV `ask` configured, every assessment is `UNDECIDED` and the deterministic per-role
  weights decide. That is the intended fail-safe, not a degraded mode.
- Candidates without a declared quality, cost or latency carry no sub-score; the total is
  renormalised over the signals that exist, so an unpriced candidate is never scored as cheap.
- **Bootstrap circularity**: On a fresh checkout, proofFloor > NONE is unsatisfiable. To bootstrap, run an execution with proofFloor: 'NONE' and --report-outcome with status: 'completed'.
- **API_PASS ceiling**: --report-outcome only ever mints API_PASS evidence. A higher proofFloor requires real execution evidence recorded via cli.js.
- **EVIDENCE_BLOCKED**: Candidates are permanently excluded if their last probe reported model_unsupported, upstream_credential (401), upstream_credit_exhausted (402), or upstream_rate_limit/ccount_quota_exhausted (429), until their evidence explicitly changes.
- **Headroom constants**: Candidates with unknown quota availability take a 15-point score penalty; 	ight takes a 10-point penalty.
- **forbiddenFailureDomains grammar**: Only exact component values (e.g., gy-native-a) or composed gateway/upstream forms (9router/antigravity) are supported.
