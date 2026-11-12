# Model source inventory — 2026-10-06

Offline assembly from filtered inputs only. No endpoint was probed and no
model API was called to build this inventory.

## Sources (model count = unique modelId per source; candidate count = linked 7-part candidates)

| sourceId | kind | status | models | candidates |
|---|---|---|---|---|
| 9router | GATEWAY | ENUMERATED | 964 | 1866 |
| 9router-upstream-ag | GATEWAY_UPSTREAM | ENUMERATED | 37 | 57 |
| 9router-upstream-alims-intl | GATEWAY_UPSTREAM | ENUMERATED | 7 | 14 |
| 9router-upstream-bpm | GATEWAY_UPSTREAM | ENUMERATED | 7 | 14 |
| 9router-upstream-bzl | GATEWAY_UPSTREAM | ENUMERATED | 25 | 49 |
| 9router-upstream-cbai | GATEWAY_UPSTREAM | ENUMERATED | 15 | 30 |
| 9router-upstream-cc | GATEWAY_UPSTREAM | ENUMERATED | 7 | 13 |
| 9router-upstream-cerebras | GATEWAY_UPSTREAM | ENUMERATED | 6 | 12 |
| 9router-upstream-cf | GATEWAY_UPSTREAM | ENUMERATED | 23 | 36 |
| 9router-upstream-cl | GATEWAY_UPSTREAM | ENUMERATED | 473 | 941 |
| 9router-upstream-cmc | GATEWAY_UPSTREAM | ENUMERATED | 22 | 44 |
| 9router-upstream-cohere | GATEWAY_UPSTREAM | ENUMERATED | 3 | 6 |
| 9router-upstream-combo | GATEWAY_UPSTREAM | ENUMERATED | 2 | 3 |
| 9router-upstream-gcli | GATEWAY_UPSTREAM | ENUMERATED | 2 | 3 |
| 9router-upstream-gh | GATEWAY_UPSTREAM | ENUMERATED | 46 | 79 |
| 9router-upstream-groq | GATEWAY_UPSTREAM | ENUMERATED | 5 | 9 |
| 9router-upstream-kc | GATEWAY_UPSTREAM | ENUMERATED | 8 | 16 |
| 9router-upstream-kgw | GATEWAY_UPSTREAM | ENUMERATED | 9 | 15 |
| 9router-upstream-kimchi | GATEWAY_UPSTREAM | ENUMERATED | 8 | 16 |
| 9router-upstream-kr | GATEWAY_UPSTREAM | ENUMERATED | 36 | 80 |
| 9router-upstream-llm7 | GATEWAY_UPSTREAM | ENUMERATED | 5 | 10 |
| 9router-upstream-mistral | GATEWAY_UPSTREAM | ENUMERATED | 4 | 7 |
| 9router-upstream-ocg | GATEWAY_UPSTREAM | ENUMERATED | 42 | 84 |
| 9router-upstream-ocz | GATEWAY_UPSTREAM | ENUMERATED | 78 | 152 |
| 9router-upstream-ollama | GATEWAY_UPSTREAM | ENUMERATED | 9 | 17 |
| 9router-upstream-openrouter | GATEWAY_UPSTREAM | ENUMERATED | 5 | 10 |
| 9router-upstream-qd | GATEWAY_UPSTREAM | ENUMERATED | 16 | 31 |
| 9router-upstream-siliconflow | GATEWAY_UPSTREAM | ENUMERATED | 16 | 32 |
| 9router-upstream-tokenrouter | GATEWAY_UPSTREAM | ENUMERATED | 34 | 56 |
| 9router-upstream-xmtp | GATEWAY_UPSTREAM | ENUMERATED | 14 | 14 |
| cohere | DIRECT_API | ENUMERATED | 52 | 68 |
| baseten | DIRECT_API | ENUMERATED | 33 | 44 |
| inception | DIRECT_API | ENUMERATED | 5 | 7 |
| regolo | DIRECT_API | ENUMERATED | 25 | 34 |
| amd-radeon | DIRECT_API | ENUMERATED | 15 | 21 |
| dahl | DIRECT_API | ENUMERATED | 4 | 5 |
| thegrid | DIRECT_API | ENUMERATED | 28 | 39 |
| pgsgrove | DIRECT_API | ENUMERATED | 36 | 41 |
| scaleway | DIRECT_API | ENUMERATED | 28 | 29 |
| explabs | DIRECT_API | NOT_ENUMERATED | 0 | 0 |
| thb | DIRECT_API | ENUMERATED | 64 | 66 |
| xkiro | DIRECT_API | PARTIAL | 129 | 153 |
| bai | DIRECT_API | PARTIAL | 59 | 59 |
| tencent | DIRECT_API | PARTIAL | 89 | 88 |
| nebius | DIRECT_API | PARTIAL | 18 | 18 |
| rqsty | DIRECT_API | ENUMERATED | 166 | 748 |
| llmtr | DIRECT_API | ENUMERATED | 31 | 364 |
| agentrouter | DIRECT_API | ENUMERATED | 5 | 6 |
| regolo-ai | DIRECT_API | ENUMERATED | 18 | 18 |
| tencent-tokenhub | DIRECT_API | ENUMERATED | 3 | 3 |
| the-grid-ai | DIRECT_API | ENUMERATED | 9 | 9 |
| opencode-builtin | DIRECT_API | ENUMERATED | 10 | 10 |
| agy-local | DIRECT_CLI | PARTIAL | 20 | 20 |
| codex | DIRECT_CLI | PARTIAL | 1 | 1 |
| hermes | DIRECT_CLI | PARTIAL | 1 | 1 |
| qwen | DIRECT_CLI | NOT_ENUMERATED | 0 | 0 |
| gemini | DIRECT_CLI | NOT_ENUMERATED | 0 | 0 |
| cline | DIRECT_CLI | NOT_ENUMERATED | 0 | 0 |
| autoclaw | DIRECT_CLI | NOT_ENUMERATED | 0 | 0 |
| oc | DIRECT_CLI | NOT_ENUMERATED | 0 | 0 |
| paseo | DIRECT_CLI | NOT_ENUMERATED | 0 | 0 |
| jev | DIRECT_CLI | NOT_ENUMERATED | 0 | 0 |

## Totals by access family

- DIRECT_API (vendor APIs reached directly or through the opencode harness): 2001 candidates, 1717 unique raw modelIds.
- DIRECT_CLI (models pinned by CLI tool configs or the older agy catalogue): 22 candidates, 22 unique raw modelIds.
- Through-gateway (gateway == 9router, all upstreams): 1866 candidates, 1001 unique raw modelIds.
- Overall: 62 sources, 3889 unique 7-part candidates, 2729 unique raw modelIds.
- Proof split: 238 API_PASS, 3651 CATALOG_ONLY. No candidate carries HARNESS_PASS or WORK_ITEM_PASS.
- Canonical-model split: 30 candidates with an exact benchmark-prior match, the rest UNKNOWN.

Candidate buckets are disjoint by construction (the 7-part key differs in
harness/accessPath/gateway), while raw modelIds overlap across buckets (the
same vendor id can appear direct, via opencode and via the gateway).

## Counting and dedupe

- modelCount: unique exact-string modelId per source across current
  enumeration inputs (listings, config files, scan observations). The older
  2026-09-30 catalogue does not contribute to modelCount.
- candidates: unique full 7-part key
  (harness, accessPath, gateway, upstream, accountRef, quotaScope, modelId).
  The same modelId reached by two paths is two candidates; identical tuples
  from listing + scan + catalogue merge into one candidate whose evidenceRef
  lists every input file.
- unique raw modelId overall: exact-string distinct modelId across all candidates.
- canonicalModelId: exact string equality against
  tools/ai-brain/data/external-model-priors.json only; prefixes are never
  stripped to guess, so most values are UNKNOWN.
- Scan source derivation (which scan rows belong to which source) copies
  .inputs/reconcile-20261005.js exactly. Scan file names map to sources as:
  9router-* -> 9router; opencode-probe / opencode-builtin -> opencode:&lt;provider&gt;;
  full-scan / sources-new / bai-retry carry their own source field;
  thb-probe -> thb; nebius-probe -> nebius. The names 'tokenharbor' and 'thb'
  denote the same service and are inventoried under source 'thb'.

## Sources not fully enumerated

- explabs (NOT_ENUMERATED): Provider is configured in the opencode config extract with zero models; no listing, no probe.
- xkiro (PARTIAL): A /list endpoint advertised 129 models but named none in the filtered inputs; ids come from probe observations only.
- bai (PARTIAL): A /list endpoint advertised 59 models but named none in the filtered inputs; ids come from probe observations only.
- tencent (PARTIAL): No model listing in the filtered inputs; ids come from probe observations only. Opencode routes use the tencent-tokenhub provider name.
- nebius (PARTIAL): Probed via the rqsty-nebius route; no endpoint URL and no listing in the filtered inputs.
- agy-local (PARTIAL): Task names 'agy'; the registry id is 'agy-local'. No current listing in the filtered inputs; 20 ids survive from the 2026-09-30 catalogue only.
- codex (PARTIAL): CLI pins one model in config; per the registry, further models live in accounts.registry.json, which is not in the filtered inputs.
- hermes (PARTIAL): Config declares only a default model; the registry resolves the reasoning model per task, so no full listing exists.
- qwen (NOT_ENUMERATED): Filtered qwen settings name base URLs only and declare no models.
- gemini (NOT_ENUMERATED): No 'gemini' source in the Controller registry; the filtered gemini settings carry no models.
- cline (NOT_ENUMERATED): A harness: per the registry it brings no models of its own; cline-routed ids appear under the 9router cl upstream.
- autoclaw (NOT_ENUMERATED): A harness with no models of its own in the filtered inputs.
- oc (NOT_ENUMERATED): The path Paseo uses to reach 9router models; serves no models itself.
- paseo (NOT_ENUMERATED): Orchestrator daemon; serves no models. Kind is structural only.
- jev (NOT_ENUMERATED): Closed decision service (checkable questions only); serves no routable models.

This inventory is NOT complete: 15 of 62 sources are PARTIAL or NOT_ENUMERATED (listed above).

## Past observations, not current liveness

Scan results reused here are past observations dated 2026-10-04 and
2026-10-05 (see observedAt per candidate). They say nothing about whether a
model answers today: quotas reset, keys rotate and upstreams change. Nothing
in candidates.jsonl may be read as a live availability claim.

## Catalogue (listing) vs evidence (scan/evidence.json)

- Catalogue inputs (listings, config files, the 2026-09-30 catalogue) say a
  model id exists somewhere. They never prove it answers.
- Evidence inputs (scan classifications, tools/ai-brain evidence) say what a
  past call returned. The Controller evidence file
  (tools/ai-brain/data/evidence/evidence.json) is absent in this worktree, so
  no candidate is promoted above what its own scan classification supports:
  API_PASS requires a latest scan class of API_PASS, everything else stays
  CATALOG_ONLY, and older catalogue proof claims (including WORK_ITEM_PASS
  rows from 2026-09-30) are deliberately NOT carried over. Catalogue and
  evidence are kept apart by construction: proofLevel comes only from the
  scan rule, never from a listing.
- FINAL-MODEL-REGISTRY.md and WS1-FINAL-REPORT-20261001.md are human-readable
  evidence summaries, not machine-readable enumerations, and contribute no
  model ids to this inventory.
