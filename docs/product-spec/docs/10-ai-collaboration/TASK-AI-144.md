# TASK-AI-144 — Controller model scores compare like with like

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-144` |
| Feature ID | `N/A — controller priors normalization and effort variant resolution` |
| Status | `IN_PROGRESS` |
| Delivery order | `264` |
| Dependencies | `TASK-AI-143` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/priors.js`; `tools/ai-brain/priors-public.js`; `tools/ai-brain/priors-sources/public.json`; `tools/ai-brain/test/task-ai-144*.test.js`; `docs/product-spec/work-items/TASK-AI-144.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-144-priors-normalize` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Prevent model scoring distortion and candidate misrouting in the Controller by ensuring model quality benchmarks compare like with like. Ingested leaderboards merge effort-variant entries into a single canonical model entry with per-effort benchmark values and base fallback, eliminating duplicated ranking rows that unfairly penalize models evaluated at specific reasoning effort levels. Router prefixes and model aliases resolve cleanly from configuration without hardcoded literals in controller source code, enabling models like `qwen/qwen3.8-max:free` and `gcli/grok-4.7` to match their benchmark priors.

## Source references

- `AGENTS.md` (Code review rules, No production hardcode, Verification commands)
- `docs/00-control/BASELINE-AND-DECISIONS.md`
- `tools/ai-brain/priors.js` (Priors loading, matching, scoring, merging, quartile tier assignment)
- `tools/ai-brain/priors-public.js` (Public leaderboard ingestion and document schema validation)
- `tools/ai-brain/priors-sources/public.json` (Public leaderboard descriptors and vocabulary configuration)

## Preconditions and dependencies

- Node.js >=20 and pnpm >=9 available.
- Prior Work Item `TASK-AI-143` merged in base.
- Clean working directory on `fix/task-ai-144-priors-normalize`.

## Author boundary

`GEMINI` authors this bounded controller brain enhancement. Changes are strictly confined to `tools/ai-brain/priors.js`, `tools/ai-brain/priors-public.js`, `tools/ai-brain/priors-sources/public.json`, and regression tests in `tools/ai-brain/test/`. No application code, database migrations, carrier adapters, or gate policies are modified. Effort suffixes, router prefixes, and alias normalization rules are declared in configuration rather than hardcoded literals.

## In scope

- One canonical model entry per model in `mergePriorDocuments`, with per-effort benchmark values stored under the canonical entry.
- External configuration in `tools/ai-brain/priors-sources/public.json` specifying `effortVariants`, `deploymentSuffixes`, `routerPrefixes`, and `aliasRules`.
- Effort-suffixed or router-prefixed live IDs resolve to the canonical model entry using configuration rules; unknown models remain unmatched (fail-closed).
- Missing benchmark values for an effort level fall back to the base model's value and are explicitly recorded as fallback in the prior evidence.
- Full regression tests covering Defect 1 (merging effort rows into one canonical entry) and Defect 3 (alias resolution for router IDs and models without base rows).

## Out of scope

- Defect 2 (independent source normalization, e.g. min-max / percentile within source before aggregation), which is deferred to the next run.
- Network calls in test suites (tests use deterministic fixtures only).
- Editing gate allowlists or baseline files.

## Business rules and edge cases

- `BR-PRIOR-01`: Each physical model must have exactly one canonical ranking row in priors documents.
- `BR-PRIOR-02`: Effort suffixes (e.g. `high`, `medium`, `thinking`) must not create separate top-level ranking rows.
- `BR-PRIOR-03`: When an effort variant lacks a benchmark required by a role profile, it falls back to the base model's benchmark value and marks `fallback: true` in evidence.
- `BR-PRIOR-04`: Effort and prefix vocabulary must be loaded from configuration, never hardcoded as code literals.
- `BR-PRIOR-05`: Unknown models must never be guessed or synthesized (fail closed).

## UI states

N/A — Controller brain routing and priors logic; no user interface is modified.

## API, event and data impact

- Priors documents (`model-priors.json`, `model-priors-live.json`) have a single ranking entry per model with per-effort benchmark values.
- Backward compatibility: Existing lookups and tests remain supported.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-144-01` | Ingest multiple effort variants for same model (e.g. base and high) | Produces single canonical ranking entry with per-effort benchmarks | Unit test in `task-ai-144-priors-effort.test.js` |
| `AC-AI-144-02` | Resolve model ID with effort suffix when benchmark is missing for effort | Uses base benchmark and flags `fallback: true` in evidence | Unit test in `task-ai-144-priors-effort.test.js` |
| `AC-AI-144-03` | Resolve model that only exists as effort row (e.g. `grok-4.7-high`) via router prefix (e.g. `gcli/grok-4.7`) | Matches canonical base `grok-4-7` cleanly | Unit test in `task-ai-144-priors-effort.test.js` |
| `AC-AI-144-04` | Resolve router-prefixed ID with suffix (e.g. `qwen/qwen3.8-max:free`) | Strips prefix and suffix according to configuration and matches canonical `qwen-3-8-max` | Unit test in `task-ai-144-priors-effort.test.js` |
| `AC-AI-144-05` | Verify no hardcoded literals | `node scripts/ai/check-no-hardcode.mjs` exits with code 0 | Terminal output |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-144-priors-effort.test.js`
- `node --test tools/ai-brain/test/priors-public.test.js tools/ai-brain/test/priors-variants.test.js tools/ai-brain/test/task-ai-142-*.test.js`
- `node scripts/ai/check-no-hardcode.mjs`
- `pnpm exec prettier --check docs/product-spec/work-items/TASK-AI-144.md tools/ai-brain/priors.js tools/ai-brain/priors-public.js tools/ai-brain/priors-sources/public.json`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | pending | pending | Initial authoring |

## Residual limitations

Defect 2 (independent source scale normalization before aggregation) is deferred to step 2 of TASK-AI-144 in the next run.
