## Round 1 review (pl-task-ai-167-1, writer was unknown)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 58f64a1beb242159a6e658a0a000b3f3d92bcfdf

1. **P1 — CI failing:** application-gate, contract, current-application. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### contract (job 125792589887) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR contains unchecked mandatory checklist items
##[error]Process completed with exit code 1.
```

### contract (job 125792699695) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR contains unchecked mandatory checklist items
##[error]Process completed with exit code 1.
```

### current-application (job 125792650450) — failing log lines

```
 - tools/ai-brain/review-loop.js
 - tools/ai-brain/test/work-guard.test.js
 - tools/ai-brain/work-guard.js
❌ PHÁT HIỆN 2 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - tools/ai-brain/test/work-guard.test.js
 - tools/ai-brain/work-guard.js
Chạy "npx prettier --write <file>" để sửa định dạng các tệp trên.
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### current-application (job 125792749636) — failing log lines

```
Đã phát hiện và quét 3 tệp tin được Prettier hỗ trợ trong phạm vi thay đổi:
 - tools/ai-brain/review-loop.js
 - tools/ai-brain/test/work-guard.test.js
❌ PHÁT HIỆN 2 TỆP TIN CHƯA ĐẠT CHUẨN ĐỊNH DẠNG PRETTIER:
 - tools/ai-brain/test/work-guard.test.js
 - tools/ai-brain/work-guard.js
Chạy "npx prettier --write <file>" để sửa định dạng các tệp trên.
 - tools/ai-brain/work-guard.js
[ELIFECYCLE] Command failed with exit code 1.
##[error]Process completed with exit code 1.
```

### application-gate (job 125793395372) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

### application-gate (job 125793538443) — failing log lines

```
env:
  DETECT_RESULT: success
  APPLICATION: true
  APPLICATION_RESULT: failure
Required application checks did not pass: failure
##[error]Process completed with exit code 1.
```

## Round 2 review (pl-task-ai-167-2, writer was agy02:gemini-3.8-flash-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: a96c6ff03429abd3f55c2fb4b53c2323d43cbc28

1. **Phase 1 (a) — Tenant scope: N/A.** No tenant-owned reads or writes changed.

2. **(b) — Authorization/RBAC: N/A.** No application endpoints or permission scopes changed.

3. **(c) — Endpoint negative tests: N/A.** No cross-tenant, validation or forbidden endpoint behavior changed. Workspace refusals, duplicate admission and lock ownership have negative tests.

4. **(d) — NEW P1: Workspace verification fails open when conflict inspection fails.** `tools/ai-brain/work-guard.js:69` rejects conflicts only when Git succeeds. A nonzero result from `git diff --name-only --diff-filter=U` falls through to `ok: true`. AC-AI-167-01 requires conflict refusal; inability to inspect conflicts must also refuse admission.

5. **(d) — NEW P1: Unknown token consumption bypasses token caps.** `tools/ai-brain/work-guard.js:241` increments `tokensUnknown`, but admission checks only the known token subtotal at `tools/ai-brain/work-guard.js:307`. Repeated transient attempts recorded without token usage remain admissible indefinitely under a token-only cap. Enforcing the item/goal token caps requires unresolved usage to block admission or an explicit conservative accounting policy.

6. **(d) — NEW P1: Cleanup failure drops the worker result during serialization.** `tools/ai-brain/work-guard.js:452` returns an object whose worker fields exist only on its prototype. For a worker result `{ jobId: 'j1', exitCode: 7 }`, `JSON.stringify()` of the returned value contains only `cleanupError`; object spread likewise loses the worker fields. This violates AC-AI-167-07’s result preservation and breaks a serialized job handoff. Preserve the worker’s own properties when adding the annotation.

7. **(d) — P2: Falsy worker exceptions are swallowed.** `tools/ai-brain/work-guard.js:438` uses `if (err)` to detect failure. A worker that throws `null`, `undefined`, `false`, `0` or `''` resolves successfully through this helper. Track whether the worker threw separately from the thrown value.

8. **(d) — P2: The revisited-SHA regression test asserts nothing.** `tools/ai-brain/test/work-guard.test.js:254` neither counts test/review calls nor asserts an outcome; `runs` is unused. The test passes even if revisited SHAs are tested repeatedly. Add explicit invocation assertions for AC-AI-167-08.

9. **(e) — Integer VND: N/A.** No monetary behavior changed.

10. **(f) — External-effect idempotency/timeouts/reconciliation: N/A.** No carrier or other remote-effect operation changed. Local lock correctness is covered in finding 14.

11. **(g) — Audit and PII/secret masking: N/A.** No sensitive-data or audit flow changed in the supplied delta.

12. **(h) — UI states: N/A.** No UI changed.

13. **(i) — Previous P1 CI failures: FIXED.** The supplied exact-head evidence reports `contract`, `current-application` and `application-gate` as `SUCCESS`. The previously unformatted files are included in the current delta, for example `tools/ai-brain/work-guard.js:181` and `tools/ai-brain/test/work-guard.test.js:54`. The mandatory-checklist correction is PR metadata, so no source-line citation establishes that edit; the supplied successful contract check establishes that the gate now passes. No previous P0 was listed.

14. **Phase 2 — NEW P1: Unexpected liveness errors permit lock takeover.** `tools/ai-brain/work-guard.js:325` treats every `process.kill(pid, 0)` error except `EPERM` as proof of death. `acquireLock` then permits takeover at `tools/ai-brain/work-guard.js:375`. An error other than `ESRCH` does not establish that the owner is dead. This violates BR-LOOP-04 and can undermine ledger serialization. Treat uncertain liveness as held.

15. **Phase 2 — P2: Checkout comparison conflates distinct case-sensitive paths.** `tools/ai-brain/work-guard.js:50` lowercases paths unconditionally. On a case-sensitive filesystem, `/w/Item` and `/w/item` can be different checkouts but pass the expected-root comparison. Apply case folding only where filesystem path equality permits it.

## Round 3 review (pl-task-ai-167-3, writer was agy03:gemini-3.8-flash-low)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 955aebd3d50e04737b856c94c9f7f0a37a06ad86

1. **Phase 1 (a) — Tenant scope: N/A.** No tenant-owned application reads or writes changed.

2. **(b) — Authorization/RBAC: N/A.** No application endpoints or permission scopes changed.

3. **(c) — Endpoint negative tests: N/A.** No cross-tenant, validation or forbidden endpoint behavior changed. Negative tests cover workspace refusals, duplicate admission, damaged ledgers, lock ownership and job mismatches.

4. **(d) — P1, previous #5 NOT FIXED: Goal-only token caps still permit unlimited unknown consumption.** `tools/ai-brain/work-guard.js:293` imputes unknown usage using only `this.limits.item`, including when updating the goal accumulator. With `{ goal: { tokens: 3000 } }`, an unreserved attempt recorded as `TIMEOUT` with `{}` receives zero imputed tokens. Repeated transient attempts therefore remain admissible indefinitely. Apply a conservative policy to both item and goal caps.

5. **(d) — NEW P1: Recording one attempt erases other attempts’ unresolved token charges.** `tools/ai-brain/work-guard.js:290` clears the accumulator’s entire `unknownTokens` balance when any known usage arrives. For example, with item caps of 1000 and a goal cap of 3000, reserve attempts for A and B: the goal has 2000 imputed tokens. Recording A’s known usage clears both reservations’ goal charges, although B remains unresolved. Repeating this across items bypasses the goal cap. The unknown, unreserved branch at `tools/ai-brain/work-guard.js:293` also replaces previous imputation instead of accumulating it. Settle each fingerprint’s charge independently.

6. **(d) — NEW P1: Elapsed-time caps omit unresolved reservations.** Reservations store their start time at `tools/ai-brain/work-guard.js:255`, but elapsed consumption grows only through supplied `usage.ms` at `tools/ai-brain/work-guard.js:284`. If a worker runs past an item or goal time cap and dies without recording, another reservation is admitted while `spent.ms` remains zero. Repeated crashes bypass a time-only cap. Account for elapsed unresolved reservations or refuse admission when their consumption cannot be established.

7. **(e) — Integer VND: N/A.** No monetary behavior changed.

8. **(f) — External-effect idempotency/timeouts/reconciliation: N/A.** No carrier or other remote-effect operation changed. Local lock findings appear below.

9. **(g) — Audit and PII/secret masking: N/A.** No application audit or sensitive-data flow changed in the supplied delta.

10. **(h) — UI states: N/A.** No UI changed.

11. **(i) — Previous-review findings:**

    - **#4 FIXED:** Failed or missing conflict inspection refuses admission at `tools/ai-brain/work-guard.js:88`.
    - **#5 NOT FIXED:** The goal-only token-cap bypass remains; see finding 4.
    - **#6 FIXED:** Worker own-property descriptors are copied onto the returned object at `tools/ai-brain/work-guard.js:560`, preserving ordinary job fields through JSON serialization and spread.
    - **#7 FIXED:** A separate thrown flag preserves falsy worker exceptions at `tools/ai-brain/work-guard.js:532`.
    - **#8 FIXED:** Explicit invocation and outcome assertions replace the previously empty regression test at `tools/ai-brain/test/work-guard.test.js:307`.
    - **#13 FIXED:** The supplied exact-head CI evidence reports `contract`, `current-application` and `application-gate` as `SUCCESS`. The PR-metadata correction has no source-line citation.
    - **#14 FIXED:** Liveness probing treats only `ESRCH` as death at `tools/ai-brain/work-guard.js:406`.
    - **#15 NOT FIXED — P2:** `tools/ai-brain/work-guard.js:59` assumes every Darwin filesystem is case-insensitive. On case-sensitive APFS, distinct checkout paths still compare equal by default at `tools/ai-brain/work-guard.js:66`. The environment override supports correction but does not establish the filesystem’s actual semantics.

12. **Phase 2 — NEW P1: Contenders delete earlier lock generations despite the explicit contract.** The successful acquisition path unlinks earlier generation files and release markers at `tools/ai-brain/work-guard.js:495`. TASK-AI-167 requires dead owners to be superseded through exclusive generation creation, never deletion; BR-LOOP-04 also prohibits contenders from deleting locks. Preserve earlier generations and their release markers.

13. **Phase 2 — P2: Unknown completion charges a reserved attempt twice.** At `tools/ai-brain/work-guard.js:287`, the reservation’s existing imputation is retained, then another full item token cap is added at `tools/ai-brain/work-guard.js:293`. One reservation under a 3000-token item cap, completed with unknown usage, becomes 6000 imputed tokens. Preserve that attempt’s existing charge when its usage remains unknown.

14. **Phase 2 — P2: Cleanup annotation breaks built-in worker result types.** `tools/ai-brain/work-guard.js:558` creates a wrapper inheriting from the worker result. For an array, JSON serialization changes from an array to an object. For a `Date`, inherited serialization methods throw because the wrapper lacks Date internal slots. Ordinary job objects are fixed, but AC-AI-167-07’s general result-preservation guarantee remains incomplete for these types.

## Round 4 review (pl-task-ai-167-4, writer was agy03:gemini-3.8-flash-medium)
VERDICT: CHANGES_REQUIRED
Reviewed SHA: 504092851714a27f97d7d17325ad7b6ddea359c8

1. **Phase 1 (a) — Tenant scope: N/A.** No tenant-owned application reads or writes changed.

2. **(b) — Authorization/RBAC: N/A.** No application endpoints or permission scopes changed.

3. **(c) — Endpoint negative tests: N/A.** No cross-tenant, validation or forbidden endpoint behavior changed. Guard negative tests are present, but do not cover the bypasses below.

4. **(d) — NEW P1: Completing a reservation without elapsed usage erases its time consumption.** `tools/ai-brain/work-guard.js:364` adds only supplied `usage.ms`; recording then replaces the reservation at `tools/ai-brain/work-guard.js:381`, removing its start time from subsequent in-flight accounting. With an item time cap of 5000 ms, reserve at t=1000, finish at t=7000, and record `DONE` with `{}`: persisted consumption remains zero and another fingerprint is admitted. Repetition bypasses the time cap. The CLI explicitly supplies zero when `--ms` is omitted at `tools/ai-brain/work-guard.js:768`. Account for the reservation’s elapsed time when completion timing is unavailable.

5. **(d) — NEW P1: Null token usage becomes known zero and refunds the reservation.** Validation coerces values through `Number()` at `tools/ai-brain/work-guard.js:351`; `knownTokens` consequently accepts `null`, `false` and `''` at `tools/ai-brain/work-guard.js:355`. Recording a reserved attempt as `TIMEOUT` with `{ tokens: null }` adds zero tokens and removes its imputation at `tools/ai-brain/work-guard.js:368`. Repeated transient attempts can therefore bypass a token-only cap. Reject these values or retain conservative unknown charges.

6. **(d) — NEW P1: A structurally damaged ledger can lose outstanding token charges without being refused.** `tools/ai-brain/work-guard.js:423` permits a missing `unknownTokens` counter, while fingerprint validation at `tools/ai-brain/work-guard.js:503` checks only the outcome’s type. Delete `goal.unknownTokens` from a ledger whose reservation has exhausted a goal token cap: loading succeeds, and `tools/ai-brain/work-guard.js:482` counts the missing charge as zero, admitting more work. Validate outstanding charge metadata and required counter consistency before admission.

7. **(e) — Integer VND: N/A.** No monetary behavior changed.

8. **(f) — External-effect idempotency/timeouts/reconciliation: N/A.** No remote-effect operation changed. Local lock findings appear in Phase 2.

9. **(g) — Audit and PII/secret masking: N/A.** No application audit or identified sensitive-data flow changed in the supplied delta.

10. **(h) — UI states: N/A.** No UI changed.

11. **(i) — Prior-review findings:**

    - **Previous finding 4, goal-only token caps — FIXED:** Goal caps now supply imputation at `tools/ai-brain/work-guard.js:461`.
    - **Previous finding 5, clearing other attempts’ charges — FIXED:** Settlement subtracts the reservation’s own imputation at `tools/ai-brain/work-guard.js:368`; unreserved unknown charges accumulate at `tools/ai-brain/work-guard.js:374`.
    - **Previous finding 6, unresolved reservation time — FIXED for the reported path:** Dead reservations accumulate elapsed consumption at `tools/ai-brain/work-guard.js:245`; outstanding reservations contribute through `tools/ai-brain/work-guard.js:268` and `tools/ai-brain/work-guard.js:438`. Finding 4 identifies a separate completion-path bypass.
    - **Previous finding 12, deleting earlier lock generations — FIXED:** Acquisition preserves earlier generations and markers at `tools/ai-brain/work-guard.js:619`. The unlink at line 616 removes only the contender’s own unsuccessful generation.
    - **Previous finding 13, double-charging unknown completion — FIXED:** Additional imputation applies only to unreserved records at `tools/ai-brain/work-guard.js:372`.
    - **Previous finding 14, built-in result preservation — NOT FIXED, P2:** Array and Date handling is repaired at `tools/ai-brain/work-guard.js:679` and `tools/ai-brain/work-guard.js:681`, but other built-ins still lose required internal slots; see finding 14 below.
    - **Inherited earlier #4, failed conflict inspection — FIXED:** `tools/ai-brain/work-guard.js:119` refuses unsuccessful inspection.
    - **Inherited earlier #6, ordinary result properties — FIXED:** Own descriptors are copied at `tools/ai-brain/work-guard.js:698`.
    - **Inherited earlier #7, falsy worker exceptions — FIXED:** The separate thrown flag is set at `tools/ai-brain/work-guard.js:653` and the original value rethrown at line 670.
    - **Inherited earlier #8, ineffective regression test — FIXED:** Explicit execution-count assertions remain at `tools/ai-brain/test/work-guard.test.js:307`.
    - **Inherited earlier #13, exact-head CI — FIXED:** All supplied checks report `SUCCESS` for the reviewed SHA; this evidence has no source-line citation.
    - **Inherited earlier #14, uncertain liveness — FIXED:** Only `ESRCH` establishes death at `tools/ai-brain/work-guard.js:534`.
    - **Inherited earlier #15, blanket Darwin case folding — FIXED:** Filesystem probing replaces that assumption at `tools/ai-brain/work-guard.js:87`.

12. **Phase 2 — NEW P1: Release targets an older generation when a job ID is reused.** `tools/ai-brain/work-guard.js:626` selects the first unreleased generation matching `jobId`, ignoring `owner.gen`. After dead generation 1 is superseded by generation 2 using the same job ID, releasing the returned generation-2 owner renames generation 1 at `tools/ai-brain/work-guard.js:628`. Generation 2 remains held while its PID remains alive, stalling further acquisition. Release must identify the acquired generation.

13. **Phase 2 — NEW P2: An invalid release owner can release unreadable lock metadata.** At `tools/ai-brain/work-guard.js:626`, unreadable JSON falls back to `{}`. Passing `{}` as the owner makes both job IDs `undefined`, so the comparison succeeds and release renames the lock. Require a valid owner job ID and readable, valid holder metadata before matching ownership.

14. **Phase 2 — P2: Cleanup still breaks unsupported built-ins and private-field instances.** `tools/ai-brain/work-guard.js:691` wraps remaining objects with `Object.create(out)`. A returned `Uint8Array` then throws when its `byteLength` getter accesses the wrapper; a class whose `exitCode` getter uses a private field fails similarly. Preserve the original result when safe annotation or copying cannot preserve its behavior.

15. **NEW P0/P1:** No P0 findings. New P1 findings are **4, 5, 6 and 12**.