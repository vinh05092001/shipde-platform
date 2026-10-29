# TASK-AI-146 — Controller scores come from sources that measure coding agents

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-146` |
| Feature ID | `N/A — controller priors coding-agent benchmark sources and provisional weighting` |
| Status | `IN_PROGRESS` |
| Delivery order | `266` |
| Dependencies | `TASK-AI-144` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/priors.js`; `tools/ai-brain/priors-public.js`; `tools/ai-brain/priors-sources/public.json`; `tools/ai-brain/test/task-ai-146*.test.js`; `tools/ai-brain/test/fixtures/benchmark-sources/*`; `docs/product-spec/work-items/TASK-AI-146.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-146-benchmark-sources` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Ensure Controller priors and candidate routing accurately reflect real coding agent performance by ingesting leaderboards that measure coding agents directly: SWE-bench Verified, Terminal-Bench, Aider Polyglot, and LiveBench. Artificial Analysis remains primary, coding-agent sources are heavily weighted for coding and review roles, while benchlm fills coverage gaps with lower weight. Provisional scores from sources like benchlm are tracked with `provisional: true`, down-weighted via configuration, and constrained so they can never outrank official models. Router ID aliases derived from source creator and model name metadata allow seamless resolution for router-routed candidates without hardcoding in production logic.

## Source references

- `AGENTS.md` (Code review rules, No production hardcode, Verification commands)
- `docs/00-control/BASELINE-AND-DECISIONS.md`
- `docs/product-spec/work-items/TASK-AI-144.md`
- `tools/ai-brain/priors.js` (Priors loading, matching, scoring, merging, quartile tier assignment)
- `tools/ai-brain/priors-public.js` (Public leaderboard ingestion, benchmark parsers, schema validation)
- `tools/ai-brain/priors-sources/public.json` (Public leaderboard descriptors, benchmark sources configuration, role weights, alias rules)

## Preconditions and dependencies

- Node.js >=20 and pnpm >=9 available.
- Prior Work Item `TASK-AI-144` present on branch.
- Clean working directory on `fix/task-ai-146-benchmark-sources`.
- Benchmark source URLs probed with curl and verified machine-readable:
  - SWE-bench: `https://www.swebench.com` (Verified leaderboard embedded in `<script id="leaderboard-data">`)
  - Terminal-Bench: `https://www.tbench.ai` (Next.js React Server Component flight chunks)
  - Aider: `https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml` (YAML list of test results)
  - LiveBench: `https://livebench.ai/data/20261025/table.csv` (LiveBench 2.0 CSV release data)

## Author boundary

`GEMINI` authors this bounded controller brain enhancement. Changes are strictly confined to `tools/ai-brain/priors.js`, `tools/ai-brain/priors-public.js`, `tools/ai-brain/priors-sources/public.json`, unit test fixtures in `tools/ai-brain/test/fixtures/benchmark-sources/`, and regression tests in `tools/ai-brain/test/`. No application code, database migrations, carrier adapters, or gate policies are modified. Weights, alias rules, and multipliers are declared in configuration rather than hardcoded in source code.

## In scope

- Configure benchmark sources in `tools/ai-brain/priors-sources/public.json` with id, url, fetch/parse method, metric names, role weights (coding/review), and trust level.
- Implement parsers for SWE-bench, Terminal-Bench, Aider Polyglot, LiveBench, and updated BenchLM with provisional scores in `tools/ai-brain/priors-public.js`.
- Weights configured in `public.json`: Artificial Analysis primary, coding-agent sources weighted for coding/review, benchlm lower weight.
- Provisional score ingestion: marked `provisional: true`, down-weighted by config multiplier (`provisionalWeightMultiplier: 0.5`), capped strictly below lowest official score, and ordered after official models in ranking.
- Alias mapping: map creator + model name from source data to router IDs like `recursive/flint-v1.0:free` via config rules; unknown stays unmatched.
- Small saved fixtures for unit tests with zero network calls during test runs.

## Out of scope

- Network calls in test suites (tests use deterministic fixtures only).
- Live refresh network execution in CI.
- Editing gate allowlists or baseline files.

## Business rules and edge cases

- `BR-BENCH-01`: Benchmark sources must be configured in `tools/ai-brain/priors-sources/public.json` with machine-readable URLs verified via live probe.
- `BR-BENCH-02`: Weights live in configuration, not code. Coding-agent benchmarks must be weighted for coding and review roles; benchlm only fills gaps.
- `BR-BENCH-03`: Provisional scores must be marked `provisional: true`, down-weighted via configuration, and must never outrank a model with official scores.
- `BR-BENCH-04`: Creator + model name fields map to router IDs via configuration rules; unknown models stay unmatched (fail closed).
- `BR-BENCH-05`: Test fixtures must be small, local, and run without network access.

## UI states

N/A — Controller brain routing and priors logic; no user interface is modified.

## API, event and data impact

- Public priors documents include benchmark metrics from coding-agent sources (`sweBenchVerified`, `terminalBenchAccuracy`, `aiderPolyglot`, `liveBenchCoding`, `liveBenchReasoning`, `liveBenchAgentic`).
- Ingested rankings preserve `provisional: true` flags and enforce official precedence.
- Backward compatibility: All existing priors lookups and tests remain supported.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-146-01` | Ingest SWE-bench Verified leaderboard from fixture | Extracts verified resolution percentages and preserves model tags | Unit test in `task-ai-146-benchmark-sources.test.js` |
| `AC-AI-146-02` | Ingest Terminal-Bench from Next.js payload fixture | Extracts accuracy and reasoning effort | Unit test in `task-ai-146-benchmark-sources.test.js` |
| `AC-AI-146-03` | Ingest Aider Polyglot leaderboard from YAML fixture | Extracts pass rate 2 / pass rate 1 without external YAML library | Unit test in `task-ai-146-benchmark-sources.test.js` |
| `AC-AI-146-04` | Ingest LiveBench 2.0 scores from CSV fixture | Extracts coding, reasoning, and agentic metrics | Unit test in `task-ai-146-benchmark-sources.test.js` |
| `AC-AI-146-05` | Role weights from configuration | Weights live in config; coding-agent sources weighted for coding/review; benchlm lower weight | Unit test in `task-ai-146-benchmark-sources.test.js` |
| `AC-AI-146-06` | Ingest provisional score (e.g. benchlm provisionalDisplayScore with rankingEligible: false) | Marked `provisional: true`, down-weighted by config multiplier, and capped strictly below official models | Unit test in `task-ai-146-benchmark-sources.test.js` |
| `AC-AI-146-07` | Creator + model name mapping via config rules | Maps creator "Recursive" + model "Flint" to `recursive/flint-v1.0:free`; unknown stays unmatched | Unit test in `task-ai-146-benchmark-sources.test.js` |
| `AC-AI-146-08` | Verify no hardcoded literals | `node scripts/ai/check-no-hardcode.mjs` exits with code 0 | Terminal output |

## Verification commands

- `node --test tools/ai-brain/test/task-ai-146-benchmark-sources.test.js tools/ai-brain/test/task-ai-144-priors-effort.test.js`
- `node scripts/ai/check-no-hardcode.mjs`
- `pnpm exec prettier --check docs/product-spec/work-items/TASK-AI-146.md tools/ai-brain/priors.js tools/ai-brain/priors-public.js tools/ai-brain/priors-sources/public.json tools/ai-brain/test/task-ai-146-benchmark-sources.test.js`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `TBD` | `TBD` | Initial authoring |

## Residual limitations

None
