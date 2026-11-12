# Model evaluation 2026-10-06 (Controller input)

Machine-readable file: `model-evaluation-20261006.json` (schema `shipde-model-evaluation/1`,
2416 candidates, 232 ALIVE, 1950 cooldowns). Probe window 04:20–07:20 UTC; latest line per
(source, model) wins. ALIVE count matches ranking v4 exactly (232).

## Per source (as of probe time)

| source | probed | alive | quota EXH / RL | next reset | resets through |
|---|---|---|---|---|---|
| 9router | 883 | 93 | 208 / 438 | 2026-10-06T07:12Z | 2026-10-10T15:22Z (ag/* 104h) |
| thegrid | 17 | 17 | 0 / 0 | — | — (concurrency limit 3; probed at 2) |
| xkiro | 129 | 53 | 66 / 0 | — | — (paid-model 403s, no reset text) |
| regolo | 16 | 11 | 0 / 0 | — | — |
| cohere (direct) | 35 | 10 | 0 / 15 | — | — (trial key 20/min, no reset text) |
| opencode-builtin | 10 | 9 | 0 / 0 | — | — |
| amd-radeon | 9 | 7 | 0 / 1 | — | — (no reset text) |
| corti | 7 | 6 | 0 / 0 | — | — (omit temperature,max_tokens) |
| pgsgrove | 31 | 6 | 0 / 0 | — | — |
| thb | 64 | 4 | 60 / 0 | — | — (subscription-gated, no reset text) |
| dahl | 3 | 3 | 0 / 0 | — | — |
| inception | 2 | 2 | 0 / 0 | — | — |
| explabs | 301 | 9 | 287 / 0 | — | — (purchase-gated, no reset text) |
| llmtr | 340 | 2 | 38 / 268 | — | — (no reset text) |
| bai (7 keys) | 472 | 0 | 472 / 0 | — | — (purchase/insufficient-balance, no reset text) |
| tencent | 86 | 0 | 86 / 0 | — | — (service/model mismatch, no reset text) |
| baseten | 11 | 0 | 11 / 0 | — | — (payment status, no reset text) |

Only 9router quota errors carried machine-parseable reset text (546 of 646 quota rows);
everywhere else `resetTime` is null and the Controller default applies. `quota.remaining`
is UNKNOWN for all candidates — the probe captured no rate-limit headers.

## Top tiers (ranking v4, alive only)

- T1: `deepseek-v4-1-flash` — explabs, pgsgrove, thb (`deepseek-v4.1-flash[:free]`).
- T2: `qwen3-8-flash-next`, `qwen3-8-27b` (amd-radeon, explabs, regolo), `qwen3-8-max`,
  `qwen3-7-max` (xkiro), `deepseek-v4-flash-0731` (dahl, pgsgrove),
  `deepseek-v4-flash-vision-exp` (amd-radeon), `gpt-5-6-luna` (explabs).

## Caveats

- Liveness is as of the probe time; quotas reset and balances change.
- Remaining capacity is unknown for every candidate (no rate-limit headers recorded).
- Router aliases (`kr/*`, `gh/*`, `cl/*`, `ocz/*`, `thegrid *-latest/code-*/agent-*/text-*`,
  `copilot-*`) are unmapped to canonical ids, so most 9router ALIVE rows have no benchmark.
- `live-audit2` parser gap: 21 WRONG_OR_EMPTY lines held the nonce in same-line JSON+SSE
  bodies; those re-confirmed PASS in `live-r3-confirm` are ALIVE here via latest-wins.
- No key material was read or written; `evidence.json`/`tools/` untouched; nothing committed.
