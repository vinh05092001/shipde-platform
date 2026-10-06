# Model ranking v4 (2026-10-06, quota-retry + confirm rebuild)

**v4 supersedes `ranking-20261006-v3.json` for ranking use. v2 and v3 are left unchanged.**

v4 reuses exactly the v3 rules (N1–N4 normalization only, no router alias mapping, separate benchmark scales, tiers from AA then LiveBench). Liveness is the union of all 8 probe files (v3’s 5 plus `live-audit2`, `live-r3-confirm`, `live-r3-quota`), latest per (source, model). All 194 v3 alive rows are still alive; 38 rows are newly alive (11 from `.inputs/live-audit2-20261006.jsonl`, 21 from `.inputs/live-r3-confirm.jsonl`, 6 from `.inputs/live-r3-quota.jsonl`). No new row matches a benchmark canonical under N1–N4, so the ranked set is unchanged (19).

## Ranked canonical models (19)

Ordered by tier, then AA Coding Index, then LiveBench coding. Scales are never mixed. `matchRule` records which rule produced each match (EXACT or N1..N4).

| Rank | Canonical | Tier (source) | AA Coding | AA Intel | LiveBench overall / coding | SWE-bench Verified | matchRule | Alive as |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `deepseek-v4-1-flash` | T1 (LiveBench overall (AA missing)) | not found | not found | 81.1 / 80 | not found | N2, N2+N4 | explabs `deepseek-v4.1-flash`; pgsgrove `deepseek-v4.1-flash`; tokenharbor `deepseek-v4.1-flash:free` |
| 2 | `qwen3-8-flash-next` | T2 (AA Coding Index) | 73 | not found | 76.2 / 72.5 | not found | N1+N2 | amd-radeon `Qwen3.8-Flash-Next` |
| 3 | `qwen3-8-max` | T2 (AA Coding Index) | 71.8 | not found | 78.5 / 72.9 | not found | N2+N3+N4 | xkiro `qwen/qwen3.8-max:free` |
| 4 | `gpt-5-6-luna` | T2 (AA Coding Index) | 71.5 | not found | 73.6 / not found | not found | N2 | explabs `gpt-5.6-luna` |
| 5 | `deepseek-v4-flash-0731` | T2 (AA Coding Index) | 69.1 | not found | 74.2 / 75 | not found | N1+N3, EXACT | dahl `deepseek-ai/DeepSeek-V4-Flash-0731`; pgsgrove `deepseek-v4-flash-0731` |
| 6 | `qwen3-8-27b` | T2 (AA Coding Index) | 68.1 | not found | 75.3 / 75.7 | not found | N1+N2, N2 | amd-radeon `Qwen3.8-27B`; explabs `qwen3.8-27b`; regolo `qwen3.8-27b` |
| 7 | `qwen3-7-max` | T2 (AA Coding Index) | 66 | not found | 73.1 / 74.2 | not found | N2+N3+N4 | xkiro `qwen/qwen3.7-max:free` |
| 8 | `deepseek-v4-flash-vision-exp` | T2 (LiveBench overall (AA missing)) | not found | not found | 76.8 / 68.2 | not found | N1 | amd-radeon `DeepSeek-V4-Flash-Vision-Exp` |
| 9 | `qwen3-7-plus` | T3 (AA Coding Index) | 55.9 | not found | not found / not found | not found | N2+N3+N4 | xkiro `qwen/qwen3.7-plus:free` |
| 10 | `qwen3-6-plus` | T3 (AA Coding Index) | 54.5 | not found | 68.9 / not found | not found | N2+N3+N4 | xkiro `qwen/qwen3.6-plus:free` |
| 11 | `qwen3-6-27b` | T3 (AA Coding Index) | 53.7 | not found | 64 / 71.8 | not found | N2+N3+N4 | xkiro `qwen/qwen3.6-27b:free` |
| 12 | `minimax-m2-7` | T3 (AA Coding Index) | 52.6 | not found | not found / not found | not found | N1+N2+N3 | dahl `MiniMaxAI/MiniMax-M2.7` |
| 13 | `gpt-6-luna` | T3 (LiveBench overall (AA missing)) | not found | not found | 72 / 79 | not found | EXACT | explabs `gpt-6-luna` |
| 14 | `glm-5-3-flash` | T3 (LiveBench overall (AA missing)) | not found | not found | 71.6 / 79 | not found | N1+N2, N1+N2+N3, N2 | amd-radeon `GLM-5.3-Flash`; dahl `zai-org/GLM-5.3-Flash`; pgsgrove `glm-5.3-flash` |
| 15 | `mistral-medium-3-5` | T4 (AA Coding Index) | 46.9 | not found | not found / not found | not found | N2+N3 | xkiro `mistralai/mistral-medium-3.5` |
| 16 | `gemma4-31b` | T4 (AA Coding Index) | 43.4 | not found | not found / not found | not found | EXACT | regolo `gemma4-31b` |
| 17 | `qwen3-6-35b-a3b` | T4 (AA Coding Index) | 41.9 | not found | not found / not found | not found | N2+N3+N4 | xkiro `qwen/qwen3.6-35b-a3b:free` |
| 18 | `gpt-oss-120b` | T4 (AA Coding Index) | 30.4 | not found | not found / not found | not found | EXACT | regolo `gpt-oss-120b` |
| 19 | `gpt-oss-20b` | T4 (AA Coding Index) | 20.7 | not found | not found / not found | not found | EXACT | regolo `gpt-oss-20b` |

Tier rules (from `tools/ai-brain/data/external-model-priors.json`):
- AA Coding Index: T1 >= 74, T2 >= 66, T3 >= 50, else T4.
- LiveBench fallback (only when AA is missing): T1 >= 79, T2 >= 73, T3 >= 66, else T4.
- SWE-bench Verified is stored per row but never converted to a tier.
- "not found" means UNKNOWN, never 0.

## Unranked alive rows (206, canonical UNKNOWN)

By reason: NO_NORMALIZED_MATCH 60, PREFIX_NOT_ALLOWED 66, ROUTER_ALIAS 80. Full per-row reasons are in `ranking-20261006-v4.json`.

- 9router (93): bzl/auto:free, cf/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b, cf/@cf/meta/llama-3.1-70b-instruct-fp8-fast, cf/@cf/meta/llama-3.2-3b-instruct, cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast, cf/@cf/mistralai/mistral-small-3.1-24b-instruct, cf/@cf/qwen/qwen2.5-coder-32b-instruct, cf/@cf/qwen/qwq-32b, cf/@cf/zai-org/glm-4.7-flash, cl/apodex/apodex-1.1-mini:free, cl/cohere/north-mini-code:free, cl/dots-studio/dots-3-note-preview:free, cl/inclusionai/ling-3.0-flash-sante:free, cl/nvidia/nemotron-3-super-120b-a12b:free, cl/nvidia/nemotron-3-ultra-550b-a55b:free, cl/nvidia/nemotron-3.5-content-safety:free, cl/poolside/laguna-s-2.1:free, gh/copilot-search-a, gh/exec-agent-a, gh/exec-agent-c, gh/gpt-3.5-turbo, gh/gpt-3.5-turbo-0613, gh/gpt-4-o-preview, gh/gpt-4.1, gh/gpt-4.1-2025-04-14, gh/gpt-4o, gh/gpt-4o-2024-05-13, gh/gpt-4o-2024-08-06, gh/gpt-4o-2024-11-20, gh/gpt-4o-mini, gh/gpt-4o-mini-2024-07-18, groq/openai/gpt-oss-120b, kgw/kilo-auto/free, kgw/nvidia/nemotron-3-super-120b-a12b:free, kr/auto, kr/auto-thinking, kr/claude-haiku-4.5, kr/claude-haiku-4.5-agentic, kr/claude-haiku-4.5-thinking, kr/claude-haiku-4.5-thinking-agentic, kr/claude-sonnet-4, kr/claude-sonnet-4-agentic, kr/claude-sonnet-4-thinking, kr/claude-sonnet-4-thinking-agentic, kr/claude-sonnet-4.5, kr/claude-sonnet-4.5-agentic, kr/claude-sonnet-4.5-thinking, kr/claude-sonnet-4.5-thinking-agentic, kr/deepseek-3.2, kr/deepseek-3.2-agentic, kr/deepseek-3.2-thinking, kr/deepseek-3.2-thinking-agentic, kr/glm-5, kr/glm-5-agentic, kr/glm-5-thinking, kr/glm-5-thinking-agentic, kr/minimax-m2.1, kr/minimax-m2.1-agentic, kr/minimax-m2.1-thinking, kr/minimax-m2.1-thinking-agentic, kr/minimax-m2.5, kr/minimax-m2.5-agentic, kr/minimax-m2.5-thinking, kr/minimax-m2.5-thinking-agentic, kr/qwen3-coder-next, kr/qwen3-coder-next-agentic, kr/qwen3-coder-next-thinking, kr/qwen3-coder-next-thinking-agentic, mistral/codestral-latest, ocz/big-pickle, ocz/mimo-v2.5-free, ocz/mimo-v2.6-flash-free, ocz/muse-spark-1.2-contributor-free, ocz/muse-spark-1.3-contributor-free, ocz/nemotron-3-ultra-free, ocz/nemotron-3.5-lightning-free, ollama/gpt-oss:120b, openrouter/nvidia/nemotron-3.5-lightning:free, qd/qfmodel, tokenrouter/anthropic/claude-haiku-4.5, tokenrouter/anthropic/claude-opus-4.8, tokenrouter/anthropic/claude-sonnet-4.6, tokenrouter/deepseek/deepseek-v4-flash, tokenrouter/deepseek/deepseek-v4-pro, tokenrouter/google/gemini-3.5-flash, tokenrouter/google/gemini-3.6-flash, tokenrouter/moonshotai/kimi-k2.7-code, tokenrouter/openai/gpt-5.4, tokenrouter/z-ai/glm-5.2, vinh, xmtp/mimo-v2.5, xmtp/mimo-v2.5-pro, xmtp/mimo-v2.5-pro-claude
- amd-radeon (3): DeepSeek-V4-Flash, MiMo-V2.6-Flash, MiniCPM5-2B
- cohere (10): c4ai-aya-expanse-32b, c4ai-aya-vision-32b, command-a-03-2025, command-a-plus-05-2026, command-a-reasoning-08-2025, command-a-translate-08-2025, command-a-vision-07-2025, command-r-08-2024, command-r-plus-08-2024, command-r7b-12-2024
- corti (6): corti-s1, corti-s1-instant, corti-s1-mini, corti-s1-mini-instant, corti-s1-tiny, corti-s1-tiny-instant
- explabs (5): claude-opus-5.5, deepseek-v4-flash, glm-5.3-flash-abliterated, gpt-6-sol, mimo-v2.6-pro
- inception (2): mercury-2, mercury-2.5
- llmtr (2): agnes/agnes-2.5-flash, agnes/agnes-3.0-flash
- opencode-builtin (9): opencode/big-pickle, opencode/fledge-alpha-free, opencode/ling-3.1-flash-free, opencode/longcat-2.5-preview-free, opencode/mimo-v2.6-flash-free, opencode/muse-spark-1.3-contributor-free, opencode/nemotron-3-ultra-free, opencode/nemotron-3.5-lightning-free, opencode/space-bunny-free
- pgsgrove (3): deepseek-v4-flash-0731-turbo, deepseek-v4.1-flash-turbo, mimo-v2.6-flash
- regolo (7): apertus-70b, brick-complexity-pro, brick-v1-beta, glm5.2, mistral-small-4-119b, qwen3.5-122b, qwen3.5-9b
- thegrid (17): agent-max, agent-prime, agent-standard, bytedance-pro-latest, claude-opus-latest, code-max, code-prime, code-standard, deepseek-pro-latest, gemini-pro-latest, glm-latest, gpt-sol-latest, kimi-latest, minimax-latest, text-max, text-prime, text-standard
- tokenharbor (3): deepseek-v4-flash:free, mimo-v2.5:free, mimo-v2.6-flash:free
- xkiro (46): apodex/apodex-1.1-mini:free, cohere/aya-expanse-32b, cohere/aya-vision-32b, cohere/command-a, cohere/command-a-plus, cohere/command-a-reasoning, cohere/command-a-translate, cohere/command-a-vision, cohere/command-r-08-2024, cohere/command-r-plus-08-2024, cohere/command-r7b-12-2024, cohere/north-mini-code, cohere/north-small-translate, cohere/tiny-aya-earth, cohere/tiny-aya-fire, cohere/tiny-aya-global, cohere/tiny-aya-water, dots-studio/dots-3-note-preview:free, inclusionai/ling-3.0-flash-sante:free, liquid/lfm-2.5-2.6b:free, meituan/longcat-2.0, meituan/longcat-2.5-preview:free, mistralai/codestral-2508, mistralai/devstral-medium, mistralai/ministral-14b, mistralai/ministral-3b, mistralai/ministral-8b, mistralai/mistral-large-2512, mistralai/mistral-small-2603, qwen/qwen-plus-2025-07-28:free, qwen/qwen3-coder-plus:free, qwen/qwen3-max:free, qwen/qwen3-omni-flash:free, qwen/qwen3-vl-plus:free, qwen/qwen3.5-397b-a17b:free, qwen/qwen3.5-flash:free, qwen/qwen3.5-omni-flash:free, qwen/qwen3.5-omni-plus:free, qwen/qwen3.5-plus:free, qwen/qwen3.6-max-preview:free, qwen/qwen3.7-flash:free, qwen/qwen3.8-omni-flash:free, sensenova/sensenova-6.7-flash-lite, sensenova/sensenova-6.8-flash-lite, stealth/big-pickle, stealth/space-bunny-alpha:free

## Method (v4 delta)

1. Recomputed liveness over 8 probe files; every v3 alive row survived (lost: 0).
2. 38 newly alive rows (11 from `.inputs/live-audit2-20261006.jsonl`, 21 from `.inputs/live-r3-confirm.jsonl`, 6 from `.inputs/live-r3-quota.jsonl`).
3. Each new row was tested with the exact v3 N1–N4 implementation against `external-model-priors.json` names: 9 ROUTER_ALIAS, 29 PREFIX_NOT_ALLOWED, 0 NO_NORMALIZED_MATCH; 0 joins to existing canonicals, 0 new canonicals.
4. v3 ranked rows (scores, tiers, members, matchRules) carried verbatim; order recomputed with the v3 sort (tier, AA Coding, LiveBench coding).

## Data dates

- Probes: 2026-10-06T04:04:44.367Z to 2026-10-06T07:20:42.421Z.
- Priors thresholds/values: `external-model-priors.json` generated 2026-10-05 (AA release 2026-09, LiveBench release 2026-06-25).
- Benchmark lookup: 2026-10-06 (LiveBench values are release 2026-06-25).

## Known limitations

- Carried from v3: `glm-5-3-flash` stays tiered from LiveBench overall (AA UNKNOWN); `apodex/`- and `liquid/`- and `cohere/`-prefixed xkiro rows stay unranked (prefix not in the N3 allowlist); versions and sizes are never stripped.
- New v4 rows are all router-prefixed (`tokenrouter/`, `xmtp/`, `cf/`, `kgw/`, `bzl/`, `openrouter/`, `mistral/`, `agnes/`) and stay unranked under the v3 alias/prefix rules even where the suffix names a known family (e.g. `xmtp/mimo-v2.5-pro`, `tokenrouter/deepseek/deepseek-v4-pro`).
- Liveness is as of the probe times. Ranking is a tie-break signal, not proof of fitness for ShipDe work.
