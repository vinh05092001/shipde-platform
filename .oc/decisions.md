# Decision ledger — p-task-ai-158 (seeded 11-04_08:33 from earlier review rounds)

- seen: WHERE: `docs/product-spec/work-items/TASK-AI-158.md:147` (`Current review repair evidence`) — previous P1, NOT FIXED/unverified
- seen: WHERE: `docs/product-spec/work-items/TASK-AI-158.md:99` (Acceptance matrix) — NEW P1
- seen: WHERE: `scripts/ai/pack-context.mjs:261` (`validateOutputPath`) — NEW P1
- seen: WHERE: `scripts/ai/test/pack-context.test.mjs:60` (`test_ci_pipeline_gates_and_toolchain_sync`)
- seen: WHERE: `tools/ctx-tools/attach.py:135` (`main`) — NEW P1.
- seen: WHERE: `tools/ctx-tools/smoke.py:41` (`sanitize_secret_payload`) — NEW P1
- seen: WHERE: `tools/ctx-tools/smoke.py:83` (`sanitize_secret_payload`) — NEW P1.
- seen: WHERE: `tools/ctx-tools/smoke.py:99` (MCP.request) — NEW P1
- seen: WHERE: `tools/ctx-tools/test_toolkit.py:91` (`TestToolkitRegistry.test_attach_dry_run_covers_all_mcp_tools_for_all_clients`) — Phase 2, NEW P1.
- seen: WHERE: docs/product-spec/work-items/TASK-AI-158.md:143 (Current review repair evidence) — prior P1: NOT FIXED; resolution unverified, category (i).
- seen: WHERE: scripts/ai/pack-context.mjs:261 (validateOutputPath) — NEW P1, category (d).
- SIZE (04/11 operator): PR must shrink to <=400 changed lines (AGENTS.md). Reviewer: a deletion that removes a feature not required by an AC is NOT a finding; do not raise new P1 on code that the delta deleted.
- SPLIT/TESTS (04/11 operator): only AC tests are committed; finding checks run locally, result in PR body, never committed (no file >300 lines); if >400 lines needed, ship Slice A of the same Work Item, rest listed as Slice B/C.
