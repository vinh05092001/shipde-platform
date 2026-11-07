# Model ranking v2 (2026-10-06, offline rebuild)

**v2 supersedes `ranking-20261006.json` (the old draft). That file is left untouched.**

## Ranked canonical models (6)

Ordered by tier, then AA Coding Index, then LiveBench coding. Scales are never mixed.

| Rank | Canonical | Tier (source) | AA Coding | AA Intel | LiveBench overall / coding | SWE-bench Verified | Alive as |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `deepseek-v4-flash-0731` | T2 (AA Coding 69.1) | 69.1 | 34.3 | 74.2 / 75.0 | not found | pgsgrove `deepseek-v4-flash-0731` |
| 2 | `deepseek-v4-flash-vision-exp` | T2 (LiveBench overall 76.8, AA missing) | not found | not found | 76.8 / 68.2 | not found | amd-radeon `DeepSeek-V4-Flash-Vision-Exp` |
| 3 | `gpt-6-luna` | T3 (LiveBench overall 72.0, AA missing) | not found | not found | 72.0 / 79.0 | not found | explabs `gpt-6-luna` |
| 4 | `gemma4-31b` | T4 (AA Coding 43.4) | 43.4 | 15 | not found | not found | regolo `gemma4-31b` |
| 5 | `gpt-oss-120b` | T4 (AA Coding 30.4) | 30.4 | 12 | not found | not found | regolo `gpt-oss-120b` |
| 6 | `gpt-oss-20b` | T4 (AA Coding 20.7) | 20.7 | 9 | not found | not found | regolo `gpt-oss-20b` |

Tier rules (from `tools/ai-brain/data/external-model-priors.json`):
- AA Coding Index: T1 >= 74, T2 >= 66, T3 >= 50, else T4.
- LiveBench fallback (only when AA is missing): T1 >= 79, T2 >= 73, T3 >= 66, else T4.
- SWE-bench Verified is stored per row but never converted to a tier.
- "not found" means UNKNOWN, never 0.

## Unranked alive rows (188, canonical UNKNOWN)

One row per alive `(source, modelId)`. Router aliases (`kr/claude-*`, thegrid `*-latest` /
`code-max` / `agent-prime`, `gh/copilot-*`), gateway-namespaced ids (`ocz/*`,
`opencode/*`, `org/model`), `-turbo` variants, and dot-vs-dash near-matches
(`qwen3.8-27b` vs priors `qwen3-8-27b`, `deepseek-v4.1-flash` vs `deepseek-v4-1-flash`,
`glm-5.3-flash` vs `glm-5-3-flash`) all stay UNKNOWN: the rule allows only a
case-insensitive exact priors match ignoring a trailing `:free`/`-free` suffix, or a
mapping stated in `docs-map.json` (its `documentedModels` lists contain no
alias-to-canonical mapping, so (b) sets no id in this run). Full per-row reasons are
in `ranking-20261006-v2.json`.

- 9router (57): gh/copilot-search-a, gh/exec-agent-c, gh/gpt-3.5-turbo, gh/gpt-3.5-turbo-0613, gh/gpt-4-o-preview, gh/gpt-4.1, gh/gpt-4.1-2025-04-14, gh/gpt-4o, gh/gpt-4o-2024-05-13, gh/gpt-4o-2024-08-06, gh/gpt-4o-2024-11-20, gh/gpt-4o-mini, gh/gpt-4o-mini-2024-07-18, kr/auto, kr/auto-thinking, kr/claude-haiku-4.5, kr/claude-haiku-4.5-agentic, kr/claude-haiku-4.5-thinking, kr/claude-haiku-4.5-thinking-agentic, kr/claude-sonnet-4, kr/claude-sonnet-4-agentic, kr/claude-sonnet-4-thinking, kr/claude-sonnet-4-thinking-agentic, kr/claude-sonnet-4.5, kr/claude-sonnet-4.5-agentic, kr/claude-sonnet-4.5-thinking, kr/claude-sonnet-4.5-thinking-agentic, kr/deepseek-3.2, kr/deepseek-3.2-agentic, kr/deepseek-3.2-thinking, kr/deepseek-3.2-thinking-agentic, kr/glm-5, kr/glm-5-agentic, kr/glm-5-thinking, kr/glm-5-thinking-agentic, kr/minimax-m2.1, kr/minimax-m2.1-agentic, kr/minimax-m2.1-thinking, kr/minimax-m2.1-thinking-agentic, kr/minimax-m2.5, kr/minimax-m2.5-agentic, kr/minimax-m2.5-thinking, kr/minimax-m2.5-thinking-agentic, kr/qwen3-coder-next, kr/qwen3-coder-next-agentic, kr/qwen3-coder-next-thinking, kr/qwen3-coder-next-thinking-agentic, ocz/big-pickle, ocz/mimo-v2.5-free, ocz/mimo-v2.6-flash-free, ocz/muse-spark-1.2-contributor-free, ocz/muse-spark-1.3-contributor-free, ocz/nemotron-3-ultra-free, ocz/nemotron-3.5-lightning-free, ollama/gpt-oss:120b, qd/qfmodel, vinh
- amd-radeon (6): DeepSeek-V4-Flash, GLM-5.3-Flash, MiMo-V2.6-Flash, MiniCPM5-2B, Qwen3.8-27B, Qwen3.8-Flash-Next
- cohere (10): c4ai-aya-expanse-32b, c4ai-aya-vision-32b, command-a-03-2025, command-a-plus-05-2026, command-a-reasoning-08-2025, command-a-translate-08-2025, command-a-vision-07-2025, command-r-08-2024, command-r-plus-08-2024, command-r7b-12-2024
- corti (6): corti-s1, corti-s1-instant, corti-s1-mini, corti-s1-mini-instant, corti-s1-tiny, corti-s1-tiny-instant
- dahl (3): MiniMaxAI/MiniMax-M2.7, deepseek-ai/DeepSeek-V4-Flash-0731, zai-org/GLM-5.3-Flash (listed in docs-map, but org prefix / casing / separators differ from priors entries, so still UNKNOWN)
- explabs (8): claude-opus-5.5, deepseek-v4-flash, deepseek-v4.1-flash, glm-5.3-flash-abliterated, gpt-5.6-luna, gpt-6-sol, mimo-v2.6-pro, qwen3.8-27b
- inception (2): mercury-2, mercury-2.5
- opencode-builtin (9): opencode/big-pickle, opencode/fledge-alpha-free, opencode/ling-3.1-flash-free, opencode/longcat-2.5-preview-free, opencode/mimo-v2.6-flash-free, opencode/muse-spark-1.3-contributor-free, opencode/nemotron-3-ultra-free, opencode/nemotron-3.5-lightning-free, opencode/space-bunny-free
- pgsgrove (5): deepseek-v4-flash-0731-turbo, deepseek-v4.1-flash, deepseek-v4.1-flash-turbo, glm-5.3-flash, mimo-v2.6-flash (docs-map lists some of these verbatim, but states no canonical mapping; dot/dash variants of priors entries are not exact matches)
- regolo (8): apertus-70b, brick-complexity-pro, brick-v1-beta, glm5.2, mistral-small-4-119b, qwen3.5-122b, qwen3.5-9b, qwen3.8-27b
- thegrid (17): agent-max, agent-prime, agent-standard, bytedance-pro-latest, claude-opus-latest, code-max, code-prime, code-standard, deepseek-pro-latest, gemini-pro-latest, glm-latest, gpt-sol-latest, kimi-latest, minimax-latest, text-max, text-prime, text-standard
- tokenharbor (4): deepseek-v4-flash:free, deepseek-v4.1-flash:free, mimo-v2.5:free, mimo-v2.6-flash:free (free suffix stripped, still no priors-exact match)
- xkiro (53): apodex/apodex-1.1-mini:free, cohere/aya-expanse-32b, cohere/aya-vision-32b, cohere/command-a, cohere/command-a-plus, cohere/command-a-reasoning, cohere/command-a-translate, cohere/command-a-vision, cohere/command-r-08-2024, cohere/command-r-plus-08-2024, cohere/command-r7b-12-2024, cohere/north-mini-code, cohere/north-small-translate, cohere/tiny-aya-earth, cohere/tiny-aya-fire, cohere/tiny-aya-global, cohere/tiny-aya-water, dots-studio/dots-3-note-preview:free, inclusionai/ling-3.0-flash-sante:free, liquid/lfm-2.5-2.6b:free, meituan/longcat-2.0, meituan/longcat-2.5-preview:free, mistralai/codestral-2508, mistralai/devstral-medium, mistralai/ministral-14b, mistralai/ministral-3b, mistralai/ministral-8b, mistralai/mistral-large-2512, mistralai/mistral-medium-3.5, mistralai/mistral-small-2603, qwen/qwen-plus-2025-07-28:free, qwen/qwen3-coder-plus:free, qwen/qwen3-max:free, qwen/qwen3-omni-flash:free, qwen/qwen3-vl-plus:free, qwen/qwen3.5-397b-a17b:free, qwen/qwen3.5-flash:free, qwen/qwen3.5-omni-flash:free, qwen/qwen3.5-omni-plus:free, qwen/qwen3.5-plus:free, qwen/qwen3.6-27b:free, qwen/qwen3.6-35b-a3b:free, qwen/qwen3.6-max-preview:free, qwen/qwen3.6-plus:free, qwen/qwen3.7-flash:free, qwen/qwen3.7-max:free, qwen/qwen3.7-plus:free, qwen/qwen3.8-max:free, qwen/qwen3.8-omni-flash:free, sensenova/sensenova-6.7-flash-lite, sensenova/sensenova-6.8-flash-lite, stealth/big-pickle, stealth/space-bunny-alpha:free

## Method

1. Merged the 5 probe files in `.inputs/` (`live-20261006.jsonl`,
   `live-9router-r2-20261006.jsonl`, `live-extra-20261006.jsonl`,
   `live-ca-20261006.jsonl`, `live-fix-20261006.jsonl`); latest line per
   `(source, model)` wins by `at`; alive iff that line is `PASS`. 194 alive rows.
2. `modelId` kept verbatim. `canonicalModelId` set only on (a) case-insensitive
   exact match against `tools/ai-brain/data/external-model-priors.json` ignoring a
   single trailing `:free`/`-free` suffix, or (b) a mapping stated in
   `docs-map.json`. Router aliases (`kr/*`, thegrid `*-latest`/`code-max`/
   `agent-prime`, `gh/copilot-*`) stay UNKNOWN. 6 canonical ids found.
3. Benchmarks looked up 2026-10-06 on the official pages only:
   Artificial Analysis (`https://artificialanalysis.ai/models/capabilities/coding`,
   `https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index`
   plus per-model pages), LiveBench release 2026-06-25 (`https://livebench.ai/`,
   overall + coding), SWE-bench Verified (`https://www.swebench.com/verified`).
   Each stored separately as `{name, metric, score, date, url}`; missing is null
   (UNKNOWN), never 0. None of the 6 canonicals has a SWE-bench Verified
   mini-SWE-agent entry found.
4. Tier from AA Coding Index, else LiveBench overall; ordered by tier, AA Coding,
   LiveBench coding.

## Data dates

- Probes: 2026-10-06 04:04Z-05:45Z (per-line `at`; earliest PASS 04:20:51Z, latest 05:44:03Z).
- Priors thresholds: `external-model-priors.json` generated 2026-10-05 (AA release 2026-09, LiveBench release 2026-06-25).
- Benchmark lookup: 2026-10-06 (LiveBench values are release 2026-06-25).

Liveness is as of the probe times (2026-10-06 04:04Z-05:45Z). Ranking is a
tie-break signal, not proof of fitness for ShipDe work.
