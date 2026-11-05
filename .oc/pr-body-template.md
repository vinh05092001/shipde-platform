## Work Item

- Work Item ID: TASK-AI-146
- Feature ID: N/A — controller priors coding-agent benchmark sources and provisional weighting
- Work Item file: docs/product-spec/work-items/TASK-AI-146.md
- Assigned implementation author: GEMINI
- Business outcome: Ensure Controller priors and candidate routing accurately reflect real coding agent performance by ingesting leaderboards that measure coding agents directly (SWE-bench Verified, Terminal-Bench, Aider Polyglot, and LiveBench), with Artificial Analysis remaining primary, coding-agent sources heavily weighted for coding and review roles, benchlm filling gaps with lower weight, provisional scores down-weighted via configuration without outranking official models, and source metadata resolving router aliases via configuration.

## Source requirements

- Feature/use case/rule IDs: BR-BENCH-01, BR-BENCH-02, BR-BENCH-03, BR-BENCH-04, BR-BENCH-05, AC-AI-146-01, AC-AI-146-02, AC-AI-146-03, AC-AI-146-04, AC-AI-146-05, AC-AI-146-06, AC-AI-146-07, AC-AI-146-08
- Screen/API/entity/state IDs: N/A — controller brain routing and priors logic; no user interface is modified
- Source documents: docs/product-spec/work-items/TASK-AI-146.md, docs/00-control/BASELINE-AND-DECISIONS.md, docs/product-spec/work-items/TASK-AI-144.md, tools/ai-brain/priors.js, tools/ai-brain/priors-public.js, tools/ai-brain/priors-sources/public.json

## Scope integrity

- [x] This PR contains exactly one Work Item.
- [x] No unrelated refactor, cleanup or second feature is included.
- [x] All dependencies are merged or use an explicitly approved deterministic mock.
- [x] Changes stay inside the Work Item author boundary and allowed paths.

## Implementation

- UI and user states: N/A — Controller brain routing and priors logic; no UI is modified.
- API/application behavior: Ingests 4 new coding-agent benchmark sources (SWE-bench Verified, Terminal-Bench, Aider Polyglot, LiveBench) and BenchLM with provisional scores in tools/ai-brain/priors-public.js. Enforces provisional down-weighting (0.5 multiplier) and strictly-lower capping below official models across all scoring paths (per-row score, per-row benchmarks, effort aggregates, and priorFor routing scores). Ensures official models strictly precede provisional models in ranking order. Resolves creator and model aliases to router IDs via configuration rules.
- Data/migrations: N/A — no database tables or migrations modified; benchmark sources, role weights, alias rules, and provisional multiplier configured in tools/ai-brain/priors-sources/public.json.
- Permissions/tenancy/audit: N/A — internal controller brain routing algorithm; tenant data and permissions untouched.
- External adapters/jobs: Public leaderboard parsers implemented in priors-public.js with offline test fixtures in tools/ai-brain/test/fixtures/benchmark-sources/ to ensure zero network calls during tests.

## Acceptance evidence

| AC/Test ID   | Result | Automated evidence                                                                                                                                                             | Visual/manual evidence |
| ------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| AC-AI-146-01 | PASS   | tools/ai-brain/test/task-ai-146-benchmark-sources.test.js (SWE-bench Verified leaderboard ingestion from fixture)                                                              | N/A                    |
| AC-AI-146-02 | PASS   | tools/ai-brain/test/task-ai-146-benchmark-sources.test.js (Terminal-Bench Next.js payload ingestion from fixture)                                                              | N/A                    |
| AC-AI-146-03 | PASS   | tools/ai-brain/test/task-ai-146-benchmark-sources.test.js (Aider Polyglot YAML parser without external library)                                                                | N/A                    |
| AC-AI-146-04 | PASS   | tools/ai-brain/test/task-ai-146-benchmark-sources.test.js (LiveBench 2.0 CSV parser from fixture)                                                                              | N/A                    |
| AC-AI-146-05 | PASS   | tools/ai-brain/test/task-ai-146-benchmark-sources.test.js (Role weights from configuration)                                                                                    | N/A                    |
| AC-AI-146-06 | PASS   | tools/ai-brain/test/task-ai-146-benchmark-sources.test.js (Provisional score ingestion, down-weighting, and strictly-lower cap)                                                | N/A                    |
| AC-AI-146-07 | PASS   | tools/ai-brain/test/task-ai-146-benchmark-sources.test.js (Creator + model name mapping via config rules)                                                                      | N/A                    |
| AC-AI-146-08 | PASS   | node scripts/ai/check-no-hardcode.mjs exits with code 0                                                                                                                        | Terminal output        |
| P1-Review-1  | PASS   | tools/ai-brain/test/task-ai-146-benchmark-sources.test.js (Verified split only, fail closed when absent)                                                                       | N/A                    |
| P1-Review-2  | PASS   | tools/ai-brain/test/task-ai-146-benchmark-sources.test.js (Provisional precedence across every score path: per-row benchmarks, effort aggregates, priorFor, and ranking order) | N/A                    |

## Verification

| Command                                                                                                                                                    | Result | Evidence/notes                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| node --test tools/ai-brain/test/task-ai-146-benchmark-sources.test.js                                                                                      | PASS   | 12 tests pass                                  |
| node --test tools/ai-brain/test/priors-public.test.js tools/ai-brain/test/priors-variants.test.js tools/ai-brain/test/task-ai-142-priors-source-id.test.js | PASS   | 13 tests pass                                  |
| node --test tools/ai-brain/test/task-ai-144-priors-effort.test.js                                                                                          | PASS   | 30 tests pass                                  |
| node scripts/ai/check-no-hardcode.mjs                                                                                                                      | PASS   | 3 files scanned, 0 raw instances, baseline 345 |
| pnpm exec prettier --check changed files                                                                                                                   | PASS   | All matched files use Prettier code style      |

- [x] Clean install completed.
- [x] Lint/typecheck completed.
- [x] Relevant unit/integration tests completed.
- [x] Relevant E2E acceptance path completed.
- [x] Production build completed.
- [x] Regression impact checked.

## Safety and recovery

- Tenant isolation: N/A — brain priors ranking logic does not manage tenant data.
- Authorization: N/A — internal controller brain routing logic.
- Idempotency/reconciliation: Re-running priors merge or ingestion is deterministic and idempotent; repeated refresh never keeps stale aliases.
- Sensitive data/secrets: No secrets or credentials are handled or logged by public priors parsers.
- Error, timeout and recovery paths: Fail closed on malformed schema or missing Verified split (PRIORS_SWEBENCH_SCHEMA_CHANGED, PRIORS_TERMINALBENCH_SCHEMA_CHANGED, PRIORS_AIDER_SCHEMA_CHANGED, PRIORS_LIVEBENCH_SCHEMA_CHANGED).
- Carrier capability/evidence level: N/A — no carrier integration in this task.

## Documentation and traceability

- [x] Contracts/schemas are updated or explicitly N/A.
- [x] Work Item evidence is updated.
- [x] Traceability is updated.
- [x] Operational notes/runbook are updated or explicitly N/A.

## Risks and limitations

None

## Codex review

- Review status: READY_FOR_CODEX
- Reviewed commit: 76b3982b7fe4cd440612418be9c1f24bfe22851f
- Verdict: CHANGES_REQUIRED (round 2 addressed in follow-up commit)

- [x] The implementation author has stopped after opening/updating this PR and has not started another Work Item.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
