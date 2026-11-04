## Round 91 review (pl-task-ai-158-91, writer was agy04:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 49e43c9f630d3bf2ce49f4573c6a4e0947e366c6

TASK-AI-158 should produce focused, secret-checked, token-capped XML context with summary-only stdout, plus the approved advisory ctx-tools support.
This part touches registration, dependency/CLI setup and verification under AC-AI-158-01–04; the individual acceptance rows and packer implementation were not supplied.
Review is limited to the supplied part 1/4; no commands or files were accessed.

1. Phase 1 (a) Tenant scope: N/A — no tenant reads or writes.

2. Phase 1 (b) Authorization/RBAC: N/A — no application endpoints.

3. Phase 1 (c) Negative tests: N/A — no missing endpoint tests apply. Supplied tests cover empty selections, invalid arguments, token overflow, detected secrets and unsafe destinations.

4. Phase 1 (d) Work Item/specification alignment: see finding 10 for inconsistent verification of the folded ctx-tools support. Packer behavior cannot be confirmed from tests alone.

5. Phase 1 (e) Integer VND: N/A — no monetary operations.

6. Phase 1 (f) External-effect idempotency/timeouts/reconciliation: N/A — no external business effects in this part.

7. Phase 1 (g) Audit and sensitive data: N/A — no demonstrated P0/P1 here. Secret exclusion and output-masking tests are supplied; their implementations are outside this part.

8. Phase 1 (h) UI states: N/A — no UI changes.

9. Phase 1 (i) Previous P1, failing CI: **NOT FIXED — unverified**. Supplied exact-head check conclusions are blank, and no attributable repair for the three reported failures can be established from this part. This does not establish that those jobs still fail.

10. WHERE: `tools/ctx-tools/test_toolkit.py:91` (`TestToolkitRegistry.test_attach_dry_run_covers_all_mcp_tools_for_all_clients`) — **Phase 2, NEW P1**.
    WRONG: In a clean checkout without `tools/ctx-tools/attach.py`, as the new pack-context installer-exclusion test requires, this test executes `from attach import load_servers` and fails with `ModuleNotFoundError`. The two delivered suites therefore require incompatible repository contents.
    GOAL: TASK-AI-158’s folded ctx-tools verification must pass alongside its packer verification. Replace the obsolete attachment dependency with verification of the shipped MCP template.
    VERIFY: Add `test_toolkit_suite_without_attach`: run `python tools/ctx-tools/test_toolkit.py` in the delivered checkout without an `attach` module and assert exit code `0`.VERDICT: CHANGES_REQUIRED
    Reviewed SHA: 49e43c9f630d3bf2ce49f4573c6a4e0947e366c6

TASK-AI-158 should produce focused, secret-checked, token-capped XML context with summary-only output, plus the approved ctx-tools integration.
This part touches configuration, sensitive diagnostics and smoke verification. AC-AI-158-01–04 are named without row definitions; assessment uses the supplied business rules and scope.

Phase 1 checklist:

- **(a) Tenant scope:** N/A — no tenant data access.
- **(b) Authorization/RBAC:** N/A — no endpoints.
- **(c) Negative tests:** N/A for cross-tenant/forbidden endpoints. The masking regression required below is not demonstrated by this part.
- **(d) Work Item/specification compliance:** Finding 1 affects the required sensitive-data boundary.
- **(e) Integer VND:** N/A — no money operations.
- **(f) External-effect idempotency/reconciliation:** N/A — no applicable business effects.
- **(g) Audit and secret masking:** Finding 1.
- **(h) UI states:** N/A — no UI changes.
- **(i) Previous P1 CI failure:** **NOT FIXED — resolution unverified.** Supplied check conclusions are blank, and `current-application`/`application-gate` are absent. The mock test at `tools/ai-brain/test/context-pack-repomix.test.js:44` does not establish that those gates recovered.

1. **WHERE:** `tools/ctx-tools/smoke.py:41` (`sanitize_secret_payload`) — **NEW P1**

   **WRONG:** An MCP JSON-RPC error containing `data: {"accessToken": "opaque-credential-158"}` preserves the credential: the dictionary matcher misses camelCase `accessToken`, and the string matcher misses the quoted JSON key. `main` consequently prints the credential to stderr and persists it in `smoke-results.json`.

   **GOAL:** The folded ctx-tools diagnostics must satisfy TASK-AI-158’s sensitive-data boundary and the repository prohibition on secrets in logs/errors: credential values must be removed before diagnostics are emitted or saved.

   **VERIFY:** Add `test_rpc_error_credentials_never_reach_diagnostics`: return that error from a fake MCP server; assert stderr and `smoke-results.json` contain `[REDACTED]` and never contain the supplied credential. Parameterize the regression with a quoted password in the error message to cover the other unsupported representation.

Phase 2 open sweep: no additional P0/P1 identified in the supplied part.

Follow-up (non-blocking): `tools/ctx-tools/smoke.py:266` (`main`) constructs `MCP` outside the exception handler; a missing executable aborts the entire smoke run before writing its results.VERDICT: CHANGES_REQUIRED
Reviewed SHA: 49e43c9f630d3bf2ce49f4573c6a4e0947e366c6

TASK-AI-158 adds focused XML context packing with secret checks, token limits and summary-only stdout, remaining advisory.
This supplied part covers AC-AI-158-01–04 documentation and implementation, plus ctx-03 redaction tests; conclusions are limited to part 4/4.

Phase 1 — checklist:

1. (a) N/A — no tenant-owned reads or writes.

2. (b) N/A — no application endpoints or RBAC changes.

3. (c) N/A for cross-tenant, HTTP validation and forbidden-response tests. MCP error-redaction negative tests are present; the CLI test file is outside this supplied part.

4. WHERE: scripts/ai/pack-context.mjs:261 (validateOutputPath) — **NEW P1**, category (d).
   WRONG: Create `view` as a directory alias to `src`, containing `a.ts`. With `--paths "view/[ab].ts,docs/WI.md" --out src/a.ts`, validation accepts the source destination: relative-path comparisons miss the alias, and the identity scan skips character-class patterns because they contain neither `*` nor `?`. Successful publication replaces `src/a.ts` with XML.
   GOAL: TASK-AI-158’s source-preservation requirement and AC-AI-158-02 validation must reject destinations aliasing selected inputs for every supported glob syntax.
   VERIFY: Add `rejects_character_class_input_through_directory_alias`: create the alias and fixtures, invoke the CLI with those arguments, and assert non-zero exit plus byte-identical preservation of `src/a.ts`.

5. (e) N/A — no monetary calculations.

6. (f) N/A — no external business effects requiring idempotency or reconciliation; local publication safety is covered in finding 4.

7. (g) N/A — no additional P0/P1 masking defect established from this part. The wrapper forces security checks on and captures child output; the smoke implementation itself was not supplied.

8. (h) N/A — no UI changes.

9. WHERE: docs/product-spec/work-items/TASK-AI-158.md:143 (Current review repair evidence) — **prior P1: NOT FIXED; resolution unverified**, category (i).
   WRONG: The document claims all CI gates were verified, but the supplied exact-SHA rollup contains no conclusions and no results for `current-application` or `application-gate`; line 171 also records failed local checks and unverified remote CI. This evidence does not close the previous failing-CI finding.
   GOAL: Close the previous P1 only with successful results for the actual required gates at the reviewed SHA; component checks and documentation assertions cannot substitute.
   VERIFY: Add `reviewed_sha_has_successful_required_gates` to evidence validation: assert matching head SHA, completed status and `SUCCESS` conclusions for `ai-brain-tests`, `current-application` and `application-gate`.

Phase 2 — open sweep: No additional substantiated P0/P1 findings in the supplied part.

Follow-up (non-blocking): `test_smoke.py` contains no template/safe-root or attachment dry-run tests despite being the named evidence file for ctx-01 and ctx-02.

## Round 92 review (pl-task-ai-158-92, writer was agy07:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 4cca35418b3fb4de7839a65b518df67eb3113a53

1. **P1 — CI failing:** ai-brain-tests, application-gate, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 126151032305) — failing log lines

```
  ✔ capabilities the operator declares are carried through (0.64109ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.606997ms)
✔ the add path writes only the entry the registry accepts (10.794099ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (2.17942ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (0.946953ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (1.183747ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.429735ms)
✔ the validator is the gate and names every failing field (5.863447ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (3.607214ms)
--
  ✔ the secret never appears in the registry file (1.161935ms)
  ✔ the secret is not stored in plaintext anywhere (1.485171ms)
  ✔ listAccounts reports presence but never the value (1.781666ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.891489ms)
  ✔ a secret for an unknown account is refused (0.338514ms)
  ✔ removing an account destroys its secret (1.023707ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (4.226643ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.436006ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.4538ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.608419ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.438951ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.410498ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.20299ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.248465ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.209232ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (3.55706ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.283922ms)
  ✔ audit flags missing source URL or checked_on as error (0.292177ms)
  ✔ audit flags model version mismatch with offerings as warning (0.255839ms)
  ✔ production benchmarks.json passes audit with zero errors (0.393947ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (1.893745ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (2.785856ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (2.527041ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.277028ms)
  ✔ summary.pass counts records with no findings (0.439091ms)
  ✔ the audit prints the operator-console state lines (0.314579ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (10.428615ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (2.833255ms)
--
  ✔ shared-quota defaults to unknown (0.812922ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.221174ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (18.648725ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (3.731446ms)
  ✔ cross-account: success on one account is not inherited as verified by another (1.991849ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.758302ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.355786ms)
✔ evidence store (44.14032ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (71.415807ms)
    ✔ login-required excluded (45.602699ms)
    ✔ the adapter writes the expected job.json and maps each result state (1.890971ms)
```

### current-application (job 126151177392) — failing log lines

```
✅ All Carrier Mock tests passed successfully.
🧪 Testing MSW Canonical State Handlers...
✅ All MSW Canonical State Handler and Auth tests passed successfully.
🧪 Testing Fail-Closed Quality Gates (Negative Fixtures)...
✅ All Negative Quality Gate tests correctly failed closed (Contracts, A11y, Secrets, Perf, Visual, Seed).
cache miss, executing c8292e063660c150
$ tsx src/worker.test.ts && tsx --tsconfig tsconfig.json src/worker.supertest.spec.ts
--
{"level":"info","time":"2026-11-03T19:27:13.190Z","service":"worker","correlationId":"corr-unit-1","message":"Processing smoke job job-unit-1 for outbox event test-outbox-1","metadata":{"jobId":"job-unit-1","smokeId":"smoke-1","outboxId":"test-outbox-1"}}
{"level":"warn","time":"2026-11-03T19:27:13.190Z","service":"worker","correlationId":"corr-unit-1","message":"Duplicate job job-unit-1 detected via atomic database claim guard for outbox event test-outbox-1. Side effects already committed.","metadata":{"outboxId":"test-outbox-1"}}
{"level":"warn","time":"2026-11-03T19:27:13.190Z","service":"worker","correlationId":"corr-unit-2","message":"SmokeWorker ignoring unsupported or missing event type 'EVT-UNSUPPORTED-TYPE' for job job-unit-unsupported","metadata":{"jobId":"job-unit-unsupported","eventType":"EVT-UNSUPPORTED-TYPE","outboxId":"test-outbox-2"}}
{"level":"error","time":"2026-11-03T19:27:13.191Z","service":"worker","correlationId":"corr-late","message":"Job job-late-failure in smoke-queue failed (attempt 1/3): Late timeout after published with password [REDACTED]","metadata":{"jobId":"job-late-failure","outboxId":"published-outbox-id","attempts":1,"isExhausted":false}}
{"level":"warn","time":"2026-11-03T19:27:13.191Z","service":"worker","correlationId":"corr-late","message":"Ignoring late failure update for outbox event published-outbox-id: already transitioned out of PROCESSING","metadata":{"outboxId":"published-outbox-id","jobId":"job-late-failure"}}
{"level":"info","time":"2026-11-03T19:27:13.197Z","service":"worker","correlationId":"corr-disp-prop-123","message":"Outbox event outbox-disp-1 (EVT-FOUND-QUEUE-SMOKE) dispatched to BullMQ queue smoke-queue","metadata":{"outboxId":"outbox-disp-1","eventType":"EVT-FOUND-QUEUE-SMOKE","queue":"smoke-queue","jobId":"idemp-disp-1-del-0-1793734033192"}}
{"level":"error","time":"2026-11-03T19:27:13.198Z","service":"worker","correlationId":"corr-disp-prop-123","message":"Failed to dispatch outbox event outbox-disp-1: Redis connection failed during queue.add","metadata":{"outboxId":"outbox-disp-1","error":"Redis connection failed during queue.add"}}
{"level":"error","time":"2026-11-03T19:27:13.198Z","service":"worker","correlationId":"corr-disp-prop-123","message":"Failed to dispatch outbox event outbox-disp-1: Database connection lost during updateMany","metadata":{"outboxId":"outbox-disp-1","error":"Database connection lost during updateMany"}}
{"level":"error","time":"2026-11-03T19:27:13.198Z","service":"worker","correlationId":"corr-disp-prop-123","message":"Failed to revert outbox event outbox-disp-1 status after dispatch failure: Database connection lost during updateMany","metadata":{"outboxId":"outbox-disp-1","error":"Database connection lost during updateMany"}}
✅ SmokeWorker and OutboxDispatcher offline unit behaviors passed
Testing SmokeWorker Redis deduplication (smoke:dedup:${jobId})...
--
{"level":"info","time":"2026-11-03T19:27:13.452Z","service":"worker","correlationId":"corr-uncommitted-1793734033440","message":"Processing smoke job job-crash-1793734033440 for outbox event 32627d04-1ea9-4d5a-9b43-c5e9098ed509","metadata":{"jobId":"job-crash-1793734033440","smokeId":"smoke_crash_1793734033440","outboxId":"32627d04-1ea9-4d5a-9b43-c5e9098ed509"}}
{"level":"info","time":"2026-11-03T19:27:13.463Z","service":"worker","correlationId":"corr-uncommitted-1793734033440","message":"Successfully executed deterministic smoke effect for job job-crash-1793734033440","metadata":{"jobId":"job-crash-1793734033440","smokeId":"smoke_crash_1793734033440","outboxId":"32627d04-1ea9-4d5a-9b43-c5e9098ed509"}}
✅ SmokeWorker Redis deduplication tests passed
Testing SmokeWorker transient handler failure and recovery...
{"level":"error","time":"2026-11-03T19:27:13.587Z","service":"worker","correlationId":"corr-transient-1793734033483","message":"Job job-transient-1793734033483 in smoke-queue failed (attempt 1/3): Transient DB timeout with password [REDACTED]","metadata":{"jobId":"job-transient-1793734033483","outboxId":"e732ff70-fd0a-4b07-8d57-5c26fdd97e71","attempts":1,"isExhausted":false}}
{"level":"info","time":"2026-11-03T19:27:13.618Z","service":"worker","correlationId":"corr-transient-1793734033483","message":"Processing smoke job job-transient-1793734033483 for outbox event e732ff70-fd0a-4b07-8d57-5c26fdd97e71","metadata":{"jobId":"job-transient-1793734033483","smokeId":"smoke_transient_1793734033483","outboxId":"e732ff70-fd0a-4b07-8d57-5c26fdd97e71"}}
{"level":"info","time":"2026-11-03T19:27:13.631Z","service":"worker","correlationId":"corr-transient-1793734033483","message":"Successfully executed deterministic smoke effect for job job-transient-1793734033483","metadata":{"jobId":"job-transient-1793734033483","smokeId":"smoke_transient_1793734033483","outboxId":"e732ff70-fd0a-4b07-8d57-5c26fdd97e71"}}
✅ SmokeWorker transient handler failure and recovery tests passed
Testing SmokeWorker exhausted handler failure (transition to FAILED)...
{"level":"error","time":"2026-11-03T19:27:13.747Z","service":"worker","correlationId":"corr-exhausted-1793734033647","message":"Job job-exhausted-1793734033647 in smoke-queue failed (attempt 3/3): Permanent downstream failure: token [REDACTED] rejected","metadata":{"jobId":"job-exhausted-1793734033647","outboxId":"670e4b41-0e20-4d1e-90b0-9e8bfbc2992e","attempts":3,"isExhausted":true}}
✅ SmokeWorker exhausted handler failure tests passed
Testing OutboxDispatcher with real database and Redis queue...
{"level":"info","time":"2026-11-03T19:27:13.944Z","service":"worker","correlationId":"corr-disp-1793734033812","message":"Outbox event 1e5caa50-e5af-4fb2-a110-19bd7c03f9dc (EVT-FOUND-QUEUE-SMOKE) dispatched to BullMQ queue smoke-queue","metadata":{"outboxId":"1e5caa50-e5af-4fb2-a110-19bd7c03f9dc","eventType":"EVT-FOUND-QUEUE-SMOKE","queue":"smoke-queue","jobId":"idemp-disp-1793734033812-del-0-1793734033932"}}
Testing concurrent dispatcher atomic claim...
Testing live retryFailed queue purge and re-dispatch...
{"level":"info","time":"2026-11-03T19:27:14.086Z","service":"worker","correlationId":"corr-failed-live-1793734034034","message":"Outbox event 1b7e2f2c-1111-4944-a113-cd3cd0ee5ba8 (EVT-FOUND-QUEUE-SMOKE) dispatched to BullMQ queue smoke-queue","metadata":{"outboxId":"1b7e2f2c-1111-4944-a113-cd3cd0ee5ba8","eventType":"EVT-FOUND-QUEUE-SMOKE","queue":"smoke-queue","jobId":"idemp-failed-live-1793734034034-del-0-1793734034084"}}
Testing live concurrent worker delivery atomic claim race...
{"level":"info","time":"2026-11-03T19:27:14.105Z","service":"worker","correlationId":"corr-race-live-1793734034093","message":"Processing smoke job race-job-1793734034096 for outbox event a4fa85fd-1e2f-4a32-a6d0-12a66722cc84","metadata":{"jobId":"race-job-1793734034096","smokeId":"race-effect-live","outboxId":"a4fa85fd-1e2f-4a32-a6d0-12a66722cc84"}}
--
Testing queue cleanup prefix collision safety (order-1 vs order-10)...
✅ Queue cleanup prefix collision safety verified
Testing SmokeWorker durable outbox requirement and malformed job rejection...
{"level":"error","time":"2026-11-03T19:27:14.742Z","service":"worker","correlationId":"corr-missing","message":"SmokeWorker rejected job job-missing-outbox-1793734034742: missing required durable outboxId","metadata":{"jobId":"job-missing-outbox-1793734034742","outboxId":"missing"}}
{"level":"error","time":"2026-11-03T19:27:14.760Z","service":"worker","correlationId":"corr-none","message":"SmokeWorker rejected job job-nonexistent-outbox-1793734034742: durable outbox event non-existent-uuid-999 not found in database","metadata":{"jobId":"job-nonexistent-outbox-1793734034742","outboxId":"non-existent-uuid-999"}}
✅ SmokeWorker durable outbox requirement verified
Testing StorageService bucket-scoped HeadBucketCommand check...
--
{"level":"info","time":"2026-11-03T19:27:14.976Z","service":"worker","correlationId":"corr-trace-1793734034970","message":"Processing smoke job job-trace-1793734034972 for outbox event 8a90f31c-c67e-4ff0-a380-13c0a220b5dd","metadata":{"jobId":"job-trace-1793734034972","smokeId":"trace-test","outboxId":"8a90f31c-c67e-4ff0-a380-13c0a220b5dd"}}
{"level":"info","time":"2026-11-03T19:27:14.986Z","service":"worker","correlationId":"corr-trace-1793734034970","message":"Successfully executed deterministic smoke effect for job job-trace-1793734034972","metadata":{"jobId":"job-trace-1793734034972","smokeId":"trace-test","outboxId":"8a90f31c-c67e-4ff0-a380-13c0a220b5dd"}}
✅ SmokeWorker distributed trace context continuation verified
Testing assertSafeDatabaseReset fail-closed guards...
✅ assertSafeDatabaseReset fail-closed guards verified
✅ OutboxDispatcher tests passed
🎉 All @shipde/worker tests passed successfully!
--
  PASS: /health/ready responded 200 with all dependencies up
[TEST 3] Propagates x-correlation-id through Worker health endpoint
  PASS: Correlation ID propagated correctly in HTTP header and body
[TEST 4] GET /health/ready fails closed (503) when database is down
  PASS: Worker outage simulation correctly returned 503 degraded
```

### application-gate (job 126152717028) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```
