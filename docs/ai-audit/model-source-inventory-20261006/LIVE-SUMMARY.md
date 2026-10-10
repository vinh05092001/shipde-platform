# Live model-source check — 2026-10-06

Probe of the model inventory (`docs/ai-audit/model-source-inventory-20261006/`).
This is **liveness at the probe time only** (2026-10-06 04:04–04:27 UTC):
a model listed here as alive answered a nonce round-trip once in that window.
Quotas reset, keys rotate and upstreams change; nothing below is a capacity,
entitlement or future-availability claim.

## Probe run

- Command: `node .inputs/probe-sources.js .inputs/targets-live.json .inputs/live-20261006.jsonl 16`
- Wrapper: `timeout 1500` (25-minute overall timeout, not hit).
- Exit code: **0**. Time window (UTC): **2026-10-06 04:04:08Z – 04:26:57Z**.
- Targets: 16 (13 from `.inputs/targets-all.json` + `bai`, `llmtr`, `tencent`).
- Raw output: `.inputs/live-20261006.jsonl` (1,701 lines: 16 `/models` list lines + 1,685 nonce probes).
- Classification: `live-20261006.json` (1,685 records, one per `(sourceId, modelId)`,
  latest wins; record = class + http + ms + at, no detail text).
- `tokenharbor` probe records are inventoried under sourceId `thb`;
  `requesty` list output belongs to inventory source `rqsty`.

## Classifier note (must read)

`.inputs/reconcile-20261005.js` loads its `classify()` from `reconcile-scan.js`,
which is **absent from the filtered inputs** (already noted by the inventory
`build.js`), so the original function text could not be executed unchanged.
Classification used `.inputs/classify-live-20261006.js`, a replica implementing
the documented contract, calibrated on the recorded outputs of the original run
(`.inputs/MODEL-SCAN-CANONICAL-20261005.json`):

- `PASS` (HTTP 200 and the nonce echoed back) → `API_PASS`. A missing nonce is never PASS.
- HTTP 200 with content but no nonce → `CONTENT_RETURNED_NONCE_MISSING`
  (the only model-attributable failure).
- Quota/credit/balance/subscription signals (incl. HTTP 402/429) → `BLOCKED_QUOTA`.
- Auth/entitlement (401, invalid subscription, forbidden, no-access) → `AUTH_FAILED`.
- Not-supported / not-found route errors → `ROUTE_MODEL_UNAVAILABLE`.
- Deprecated/retired/overloaded/provider errors, timeouts, HTTP 5xx → `UPSTREAM_FAILED`.
- Everything else (wrong endpoint, decisions-model, 404/405 contract) → `CALL_CONTRACT_UNRESOLVED`.

Only `API_PASS` counts as alive. Any residual difference to the original
function is confined to non-alive classes; the alive set is exact by
construction of the probe (nonce match).

## Per source: inventoried vs listed vs alive

`inventoried` = `modelCount` from `sources.json` (offline catalogue).
`listed` = live `/models` count at probe time. `alive` = `API_PASS` nonces.

| source | inventoried | listed (HTTP) | alive |
|---|---|---|---|
| 9router (gateway union) | 964 | 883 (200) | 43 |
| cohere | 52 | 35 (200) | 10 |
| baseten | 33 | 11 (200) | 0 |
| inception | 5 | 2 (200) | 2 |
| regolo | 25 | 16 (200) | 11 |
| amd-radeon | 15 | 9 (200) | 7 |
| dahl | 4 | 3 (200) | 3 |
| thegrid | 28 | 17 (200) | 3 |
| pgsgrove | 36 | 31 (200) | 6 |
| scaleway | 28 | 0 (**403** `insufficient permissions`) | 0 |
| thb (probed as tokenharbor) | 64 | 64 (200) | 4 |
| xkiro | 129 | 129 (200) | 53 |
| bai | 59 | 59 (200) | 0 (all 59 `BLOCKED_QUOTA`) |
| tencent | 89 | 86 (200) | 0 (all 86 `BLOCKED_QUOTA`) |
| rqsty (probed as requesty, list-only) | 166 | 754 (200, not probed) | — |
| llmtr | 31 | 340 (200) | 0 (328 quota + 12 contract) |

Non-pass breakdown of the 1,543 non-alive records: `BLOCKED_QUOTA` 1,357,
`CALL_CONTRACT_UNRESOLVED` 60, `CONTENT_RETURNED_NONCE_MISSING` 56,
`UPSTREAM_FAILED` 34, `ROUTE_MODEL_UNAVAILABLE` 28, `AUTH_FAILED` 8.
Quota, auth, route and upstream failures are not model failures.

## Sources not covered by the live probe

NO_KEY (no key env var exists, so nothing was sent — no keys invented):

- `explabs` (endpoint `https://api.experientiallabs.ai/v1`, zero inventoried models)
- `nebius` (no endpoint URL in inputs; probed 2026-10-05 only via the `rqsty-nebius` route)
- `agentrouter` (no endpoint URL in inputs)
- `regolo-ai` (no endpoint URL in inputs; opencode-routed name)
- `tencent-tokenhub` (no endpoint URL in inputs; opencode-routed name)
- `the-grid-ai` (no endpoint URL in inputs; opencode-routed name)
- `opencode-builtin` (builtin service, no baseURL; harness-level only)

NOT_ENUMERATED / not HTTP-probeable (reason):

- `scaleway`: key exists but live `/models` returned **403** (`insufficient permissions
  to access the resource`) — 0 models listed, 0 probed. Auth failure, not a model verdict.
- `rqsty`/`requesty`: list-only target (754 ids listed, nonce probes skipped by design).
- 29 `9router-upstream-*` namespaces: not probed directly; they are routing
  namespaces inside the 9router gateway listing, covered by the 9router probe.
- `qwen`, `gemini`, `cline`, `autoclaw`, `oc`, `paseo`, `jev`: CLI/harness/structural
  entries with no routable models in the inputs.
- `agy-local`, `codex`, `hermes`: CLI-pinned models, no HTTP endpoint to probe.

## Ranking (alive models only)

`ranking-20261006.json`: 142 alive records, **17 with an exact-match public
benchmark, 125 `UNKNOWN`**. Match rule: exact model name/version only
(vendor routing prefix stripped, e.g. `kr/`, `zai-org/`; any variant suffix
such as `-agentic`, `-thinking`, `-turbo`, `-free`, `:free` disqualifies).
Tiers use the house thresholds from
`tools/ai-brain/data/external-model-priors.json`
(`aa-coding-index` rule: T1≥74, T2≥66, T3≥50, else T4) applied to the recorded
score; the `benchmark` object always names which benchmark the score came from
(Artificial Analysis Coding Index, SWE-bench Verified). Never guessed.

Ranked highlights: `kr/minimax-m2.5` (SWE-bench Verified 80.2, T1),
`deepseek-v4-flash-0731` via dahl/pgsgrove (SWE-bench Verified 79.0, T1),
`kr/glm-5` (77.8, T1), `kr/claude-sonnet-4.5` (77.2, T1); nine T2
(Claude Sonnet 4/Haiku 4.5, GLM-5.3-Flash ×3 spellings, Qwen3.8-27B ×2,
Qwen3.8-Flash-Next, DeepSeek-V4-Flash, glm5.2); one T3 (MiniMax-M2.7, 52.6);
one T4 (MiniCPM5-2B, 46.4).

## Files

- `docs-map.json` — 51 entries (22 `DIRECT_API` + 29 `GATEWAY_UPSTREAM`):
  official docs URL, documented list method, documented model ids or `UNKNOWN`.
- `live-20261006.json` — 1,685 classified `(sourceId, modelId)` records.
- `ranking-20261006.json` — 142 alive-model records with benchmark/tier.
- `.inputs/targets-live.json` — 16 probe targets. `.inputs/live-20261006.jsonl` — raw probe log.
- `.inputs/classify-live-20261006.js` — replica classifier (see note above).

Docs for `thegrid`, `explabs`, `regolo-ai`, `tencent-tokenhub`, `the-grid-ai`
and all `9router-upstream-*` namespaces remain `UNKNOWN` (no provider-owned
documentation found). `nebius`/`agentrouter` docs found but neither has a
probeable endpoint in the inputs.
