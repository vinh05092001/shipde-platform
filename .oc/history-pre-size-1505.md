## Round 94 review (pl-task-ai-158-94, writer was agy02:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 517ee1725e96f13642283f2bafa3fdd1b67e6929

TASK-AI-158 should produce focused, secret-checked, token-capped XML context while remaining advisory.
Acceptance scope: AC-AI-158-01–04 and BR-PACK-01–04; acceptance-row definitions were not supplied. This review covers only part 1’s registration, tests and MCP template.

Phase 1:

- (a) N/A — no tenant data access.
- (b) N/A — no application endpoints or RBAC changes.
- (c) N/A for cross-tenant/forbidden tests. Argument-validation, token-limit and detected-secret negative tests are present.
- (d) N/A — no established new P0/P1 acceptance violation in this part. Runtime implementation is omitted.
- (e) N/A — no money handling.
- (f) N/A — no external business effects requiring reconciliation.
- (g) N/A — no demonstrated secret disclosure. Exclusion and redaction tests are present; their implementations are omitted.
- (h) N/A — no UI changes.
- (i) Previous CI P1: **NOT FIXED — closure unverified** for `ai-brain-tests`, `current-application` and `application-gate`; see finding 1.

1. WHERE: `scripts/ai/test/pack-context.test.mjs:60` (`test_ci_pipeline_gates_and_toolchain_sync`)
   WRONG: **P1 — previous finding, closure unverified.** With passing dependency snapshots, hardcode checks and register checks, this test can succeed while `current-application` and `application-gate` fail. Supplied exact-head CI records contain blank results and omit those two jobs, so they do not establish that the previous failures are resolved.
   GOAL: Close the previous CI finding with successful results for all three affected gates at the reviewed SHA; the added integrity test cannot substitute for that evidence.
   VERIFY: `exact_head_required_gates_success`: assert `ai-brain-tests`, `current-application` and `application-gate` each report completed `SUCCESS` for `517ee1725e96f13642283f2bafa3fdd1b67e6929`; missing or blank conclusions must fail verification.

Phase 2: No **NEW P0/P1** established in the supplied part.

Follow-up (non-blocking): Mark the Python-unavailable smoke-redaction test as skipped; matching source-text substrings does not verify redaction behavior.VERDICT: CHANGES_REQUIRED
Reviewed SHA: 517ee1725e96f13642283f2bafa3fdd1b67e6929

TASK-AI-158 should provide focused, secret-checked, token-capped advisory XML packs and the approved ctx-tools integration.
Part 3 touches security configuration, packer-failure tests and MCP diagnostics. AC-AI-158-01–04 are referenced, but their individual acceptance rows were not supplied.

Phase 1 — every checklist category:

- **(a) Tenant scope:** N/A — no tenant reads/writes.
- **(b) Authorization/RBAC:** N/A — no application endpoints.
- **(c) Negative tests:** N/A for cross-tenant/forbidden requests. The added test covers repomix failure; the masking regression is specified in finding 1.
- **(d) Work Item/specification compliance:** Finding 1, **NEW P1**, `tools/ctx-tools/smoke.py:83`: sensitive error data survives masking.
- **(e) Integer VND:** N/A — no monetary operations.
- **(f) External-effect idempotency/reconciliation:** N/A — no carrier or business transactions.
- **(g) Audit/PII/secrets:** Finding 1, **NEW P1**, `tools/ctx-tools/smoke.py:83`.
- **(h) UI states:** N/A — no UI changes.
- **(i) Previous P1 — CI failures:** **NOT FIXED (unverified)**. The supplied head rollup contains empty conclusions and omits `current-application` and `application-gate`. The test added at `tools/ai-brain/test/context-pack-repomix.test.js:44` does not establish that these failures were repaired. No causal failure or verified repair location can be identified from the supplied excerpts.

1. **WHERE:** `tools/ctx-tools/smoke.py:83` (`sanitize_secret_payload`) — **NEW P1**.
   **WRONG:** A JSON-RPC error with `message: 'password="alpha beta gamma"'` becomes `password="[REDACTED] beta gamma"`. The assignment regex stops at whitespace; subsequent sanitization preserves `beta gamma`, which reaches stderr and `smoke-results.json`.
   **GOAL:** The folded MCP tooling must satisfy the Work Item’s sensitive-data requirement and the repository prohibition on secrets in logs: redact the complete credential value before emitting or persisting diagnostics.
   **VERIFY:** Add `test_rpc_error_redacts_entire_quoted_password`: inject that JSON-RPC error through the smoke failure path and assert stderr and `smoke-results.json` contain `[REDACTED]` and contain none of `alpha`, `beta`, or `gamma`.

Phase 2 — no additional supported NEW P0/P1 findings in the supplied delta.

Follow-up (non-blocking): `functions_in` completeness checking in `smoke.py` accepts an empty expected-function set; a target containing only arrow functions can therefore receive PASS without demonstrating symbol retrieval.VERDICT: CHANGES_REQUIRED
Reviewed SHA: 517ee1725e96f13642283f2bafa3fdd1b67e6929

TASK-AI-158 should produce focused, secret-checked XML context with token-limit enforcement, summary-only stdout, and advisory behavior.
This part covers AC-AI-158-01–04 through the packer/documentation and AC-AI-158-ctx-03 through redaction tests; it also documents ctx-01–02.

Phase 1:

- (a) Tenant scope: N/A — no tenant reads or writes.
- (b) Authorization/RBAC: N/A — no application endpoints.
- (c) Negative tests: N/A for cross-tenant/forbidden responses. Secret-redaction negative tests are present; the packer test file is not supplied.
- (d) Work Item/specification match: NEW P1, finding 1.
- (e) Integer VND: N/A — no monetary calculations.
- (f) External-effect reconciliation: N/A — no remote business commands.
- (g) Audit/masking: N/A for additional established P0/P1 findings. Redaction tests are supplied, but their sanitizer implementation is outside this part.
- (h) UI states: N/A — no UI changes.
- (i) Previous P1 covering `ai-brain-tests`, `current-application`, and `application-gate`: NOT FIXED **in the supplied evidence**; current failure is not established either. Finding 2.

1. **WHERE:** `scripts/ai/pack-context.mjs:261` (`validateOutputPath`) — NEW P1  
   **WRONG:** Create `src/a.ts` and a directory alias `alias` pointing to `src`; select `--paths "alias/[a].ts"` with `--out src/a.ts`. Validation accepts the source file as the destination: relative-path matching cannot resolve the alias, and identity enumeration is skipped because the character-class glob contains neither `*` nor `?`. Successful publication then replaces that source file with XML.  
   **GOAL:** TASK-AI-158’s advisory packing and documented alias-collision protection must preserve selected source files, including selections using character-class globs through directory aliases.  
   **VERIFY:** Add `rejects_character_class_glob_through_directory_alias`: create that fixture and assert `validateOutputPath(root, 'src/a.ts', ['alias/[a].ts'])` throws an input/output collision before publication; assert source bytes remain unchanged.

2. **WHERE:** `docs/product-spec/work-items/TASK-AI-158.md:147` (`Current review repair evidence`) — previous P1, NOT FIXED/unverified  
   **WRONG:** For the reviewed SHA, the supplied CI rollup has blank conclusions and omits `current-application` and `application-gate`. The cited local integrity checks therefore leave the previous three-job CI failure without demonstrated successful reruns.  
   **GOAL:** Close the previous P1 using successful results from all three original CI jobs at this exact SHA. Local snapshot, register, and guard checks do not establish those results.  
   **VERIFY:** `exact_head_original_ci_passes`: assert `ai-brain-tests`, `current-application`, and `application-gate` each conclude `SUCCESS` for `517ee1725e96f13642283f2bafa3fdd1b67e6929`; the supplied evidence does not satisfy this assertion.

Phase 2: No additional NEW P0/P1 established from the supplied delta.

Follow-up (non-blocking): `tools/ctx-tools/test_smoke.py:17` contains redaction tests but no safe-root or default-dry-run tests promised by AC-AI-158-ctx-01–02.
