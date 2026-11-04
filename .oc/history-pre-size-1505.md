## Round 3 review (pl-task-ai-166-3, writer was codex-ar:deepseek-v4-flash)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 4d708d736fd27508fbd08ab1191fabee9e068b9b

Phase 1 — checklist categories

(a) Tenant scope server-side on every read/write — N/A. The delta is the Controller/AI toolchain (`tools/ai-brain/`), docs and `package.json`; Work Item states "no product access changes" and no tenant-owned product tables or endpoints are touched hygiene issue noted under (g) below for local state files, but no tenant data model is read or written.

(b) Authorization/RBAC per endpoint, empty scope denies — N/A for product endpoints; no API route is added. Relevant adjacent process control is present and appears soundista: protected gate files are refused on commit (`coordinator-runtime.js:717` `PROTECTED_PATH` via `policy.protectedFile`), a loop lock is exclusive (`coordinator-cli.js:546-550`, `fs.openSync(lock,'wx')` with no steal), and unsupported harnesses fail closed (`coordinator-runtime.js:831` `UNSUPPORTED_COORDINATOR_HARNESS`; `candidates` filters to known harnesses). The author boundary is nonetheless self-contradicted (finding 5).

(c) Negative tests present (cross-tenant 403/404, validation errors, forbidden) — cross-tenant/403/404: N/A (no product API). Validation/forbidden-path negatives: the harness/family/ID/branch/private-file refusals above are the analogue and appear to be intended as negative tests, but the delta provides no test files and no evidence output, so their presence cannot be verified (finding 14).

(d) Behaviour matches the Work Item acceptance matrix and source specs — Partially. Acceptance rows AC-166-01/02/03 (refresh ordering, discovery honesty/freshness, 48h stale refusal), AC-166-04/05/06/07 (liveness/cooldown, main-merge + publication guards + red/pending CI, two-phase exact-SHA review + STUCK after four, quota/escalation/configured routes) and AC-166-08/09 (fan-out, metrics/single-flight daily) have corresponding code in the delta, but no test file or recorded passing evidence is in the diff. Several rows hinge on constants/behaviours that are not consistently implemented (findings 1-4). AC-166-10 handoff row is satisfied by the Work Item document itself.

(e) Money as integer VND, no floats — N/A. No monetary computation or storage added; Work Item records "unchanged, explicitly reviewed." No float arithmetic over VND, scores or percentages is introduced in the delta that would violate this rule (metrics use plain integer counts; scores are read, not converted to currency).

(f) Idempotency / timeouts / reconciliation for external effects — Not satisfied. This is exactly the class of behaviour the Work Item claims to add or preserve, and the delta weakens it:

1. P0 — `tools/ai-brain/catalogue-refresh.js:368` (delta lines 368-396): refresh persists freshness/report state from the _subprocess exit code only_. Because `cli.js` is invoked as a separate `node` process for `priors refresh`, `discovery run` and `quota-scan`, in-memory observations (including `quota-state.json` scope rows used at :369-392 and any priors/discovery objects) written by those stages are not visible to this process unless each stage writes to disk, and the summary is derived from whatever stale `data/quota-state.json` happens to exist. Worse, when a stage exits 0 but wrote nothing (partial run), this code cannot distinguish that from success: the quota summary is computed from all rows with `row.at >= startedAt` in a file it did not verify was written by this runiti, and `report.ok` becomes `true`. That allows a partial/failed scan to be reported as a successful refresh and permits `freshness.json` to advance on non-evidence — precisely the state (f) and BR-166-01 forbid.
2. P0 — `tools/ai-brain/coordinator-runtime.js:855-866` + `:983-987` vs `catalogue-refresh`/`cli.js:451-457`: the sandbox-writer launch path resolves on child `exit` (`child.on('exit')`/`resolve({exitCode})`) rather than on process close/drain. With `detached: true` and piped stdio (coordinator-runtime.js:839-843), `exit` can fire before stdout/stderr are flushed, so buffered output — including `[BLOCKED_BY_SANDBOX]` records and any quota/rate classification used for cooldown — can be truncated or lost. The Work Item's own author boundary ("Record each available check and each `BLOCKED_BY_SANDBOX` check with its exact error") and BR-166-08 (classification from sanitized logs) therefore depend on racy evidence. This must resolve on `close` (or await stream `end`) and flush the tail buffer deterministically.
3. P1 — `tools/ai-brain/coordinator-runtime.js:860-863` caps the buffered log by slice + `.at(-1)` semantics only on error text; the coordinator writer/reviewer launch log at `:852` appends indefinitely with no size bound. Reviewer output is untrusted external input; an unbounded log file under `.oc/` is a durable-state exfiltration/DoS surface and contradicts the local-exclusion intent in the decisions doc (.oc excluded from commits is necessary but not sufficient; reads and metrics parsing must be bounded).
4. P1 — `catalogue-refresh.js:394-395`: `refresh-report.json` is written via `writeJson` with no fsync/atomic-replace guarantee beyond rename, but the freshness gate at `cli.js:417-435` (`dispatchCommand`) reads only `freshness.json`, not the report. A crash between the two writes yields a state where dispatch believes the catalogue is fresh while `catalogueFreshness` at :315-328 computes staleness from a _different_ file. The 48h gate must derive from the same single persisted observation record that is atomically replaced, or `dispatch` must refuse when report/freshness disagree. As written, the stale-refusal is not idempotent across the two files.
5. P2 — `catalogue-refresh.js:321`: `ageMs > MAX_AGE_MS` rejects future-dated evidence, but there is no explicit clock-skew / tolerance note and no upper bound assertion that `lastSuccessfulAt` parse produced a sane epoch; a very small negative `ageMs` (e.g302ms skew) still passes (`ageMs < 0` only rejects negative). A future timestamp by a few hundred ms would be treated fresh. Acceptable as P2, but should be documented or clamped.
6. P2 — `coordinator-pool-writer.js:608`: `L...` job JSON is read with `JSON.parse(fs.readFileSync(...))` and no validation that `job.cwd` is inside the item worktree; `runPoolWriter` trusts a file in the worktree (`.oc/pool-writer-job.json`) that a sandbox writer could rewrite. The coordinator writes it, but a confused-deputy path exists if a prior writer leaves an edited file. Include a realpath/prefix check or write outside the writer-writable tree.

(g) Audit + PII/secret masking — Partially satisfied; gaps as findings. `coordinator-runtime.js:633-643` `safeText` redacts key/token/secret/password assignments and emails, and `:852`/`:862` route all child output through it — good. But: 7. P1 — `tools/ai-brain/catalogue-refresh.js:368-396`: nothing in refresh report or quota summary is redacted before persistence. The summary embeds `row.source`, `row.scope`, `row.upstream`, `row.model` and codes read from `quota-state.json`; any provider upstream URL with a userinfo/API-key query parameter, or scopes with tenant/user identifiers, land verbatim in `data/quota-scan-summary.json` and `refresh-report.json`. Decisions doc text at .md:132-134 says the snapshot is "sanitized," but the code applies no `safeText`/sanitize layer to the written summary. An overt claim vs code mismatch. 8. P2 — `coordinator-runtime.js:644-651` `readLines` rethrows non-ENOENT errors with the raw path and OS message; callers in `coordinator-cli.js:512` and the CLI wrapper connect error handling to `safeText(error.code || error.message)`, but if `error.code` is present (e.g. EISDIR, ENOTDIR) the safe text becomes just the bare code and diagnostics are lost. Prefer `safeText(error.message)` with a stable prefix. 9. P2 — `coordinator-runtime.js:725-726`: on `git diff --check` failure, only `DIFF_CHECK_FAILED` is returned; the offending file/controlled line content is captured in `stderr` and never surfaced as review feedback, reducing the usefulness called for by BR-166-06 ("`diff --check` findings become review feedback").

(f cont.) P1 — `coordinator-runtime.js:583-...` metrics: `readLines` JSON.parse of each line has no schema guard. A hand-edited or partially written line (truncated write before rename elsewhere) with e.g. `pr: null` reaches `coordinator-cli.js:514-522` where `for (const pr of new Set(...))` then calls `String(null)` -> `"null"` -> `gh pr view null` and throws `METRICS_MERGE_STATE_UNAVAILABLE`, aborting the entire metrics summary for one bad row. A malformed row should be skipped (or the summary marked partial), not fatal, since metrics is read-only reporting. 11. P2 — `coordinator-cli.js:545-550`: lock metadata (`{pid}`) is written but never consulted, and `process.on('SIGINT'), etc` remove the lock only in `finally`. A SIGKILL/crash leaves `.oc/coordinator/loop.lock` orphaned forever; the comment says "existing lock requires operator inspection" but the failure message is the bare EEXIST from `openSync(lock,'wx')` on the host operator's terminal, not a guidance string. Add an explicit `LOOP_LOCK_HELD` error with pid/age and stale-lock instructions; do not auto-steal (that is correct), but make the fail-closed path legible. 12. P2 — `tools/ai-brain/coordinator-pool-writer.js:609-611`: `safeText(result.reason)` is applied to the _reason_, but `jobId` and the JSON envelope are printed raw to stdout on success (`JSON.stringify(result)` in the `require.main` branch). If a pool result reason or job id can contain provider text, stdout bypasses redaction and may be captured elsewhere. Route the printed object through the same redaction helper or print only the classified fields.

(h) UI states loading/empty/error/forbidden if UI changed — N/A for product UI (no UI files in the delta). The Work Item itself records "UI states: N/A — internal CLI" with truthful CLI states (`waiting for writer/CI`, `REFRESH_FAILED`, `STALE_CATALOGUE`, `CHANGES_REQUIRED`, PASS, STUCK, `DISCOVERY_INCOMPLETE`, `METRICS_MERGE_STATE_UNAVAILABLE`, `ITEM_BRANCH_MISMATCH`, `TASK_OUTSIDE_WORKTREE`). Those states largely follow the contract; they should be spelled out at item level when the CLI is documented, but the checklist itself is N/A.

(i) Prior-review findings FIXED / NOT FIXED — the Work Item's "Codex review record" section (.md:266-268) states "No independent review yet," and the prompt provides no earlier review's open P0/P1 list, so there are no prior findings to verify as FIXED or NOT FIXED. This is itself a process gap (see Phase 1d and finding 14): the item entered READY_FOR_CODEX with no prior verdict attached and no CI/test evidence linked.

Phase or ordered batch, so observations on the "delta" are also admitted? Provide your "open sweep" findings next.

Phase 2 — open sweep (anything else) 13. P2 — `docs/.../TASK-AI-166.md:169` lists `Allowed paths` as `tools/ai-brain/`, `package.json`, this Work Item, one register row, `AI-TOOLCHAIN-DECISIONS.md`, `.oc/pr-body.md`, but the delta also adds a new file `tools/ai-brain/coordinator-cli.js` etc. All under `tools/ai-brain/`, so consistent; no out-of-bounds path observed.gets to the protected-gate configs? The item says protected `allowlists, gate configs, semgrep rules` are out of scope and `PROTECTED_PATH` is enforced by pattern — verify in review that `policy.protectedFile` actually matches all of allowlists/baselines/semgrep/gates and not only a subset; the delta does not show it. If it is narrower than BR-166-06 claims, that is a P1 acceptance gap. Flag as needs-verification (P1 if narrow). 14. P1 [needs-verification / lodged against item] — Acceptance evidence requirements (unit tests for AC-166-01..09, actual test run output, live log for AC-166-01/02 '"unit + live log," `pnpm` run of verification commands) are not present in the delta (no test files added) and no exit-status/output is quoted in `.oc/pr-body.md`. AC-166-03/04/05/06/07/08/09 are marked "unit"—with no unit tests in the diff these cannot pass review. A "docs-inspection; test not applicable" carve-out exists only for AC-166-10 and cannot be extended to the others. Likely cross-check: tests may live outside `tools/ai-brain/` and were omitted from the changed-file set, but the changed-file list is the delta authority; treat as NOT SATISFIED until cited. 15. P2 — Work Item "Dependencies" .md:166: edition mentions "existing prior role weighting and normalization" (docs:33) as a "separate routing input" but indicates scores are not averaged across benchmark types. There is no showing in the delta of how the sourced SkillBench/AA benchmarks are rows-union'd vs field-merges; recommend a single test asserting two-source rows remain discrete and no column-wise mean is produced (BR-166-02). 16. P2 — `cli.js:413-435`: the STALE_CATALOGUE gate is only active when `dryRunFlag` and `!deps.candidates && !deps.discoveryCatalogue`. It is appropriate that injected tests/fixtures bypass live freshness, consistent with BR-166-03, but it must be documented at the flag level that a _production code path_ resolving candidates must call `catalogueFreshness` rather than merely passing a truthy `deps.discoveryCatalogue`, otherwise a future caller could circumvent dispatch's 48h gate. Add the assertion to the item as an explicit acceptance note. 17. P2 — `coordinator-cli.js:534`: id regex `/(?:TASK-AI|TASK-FOUND|FEAT-[A-Z]+)-\d+$/` no longer accommodates `FOUE-` ids predating transitions nor lower-case `PATH-`/future ladder prefixes; if a previously-registered FEAT id exists in lowercase, item would be rejected `ITEM_INVALID`. Confirm the set matches the register's `FQ` columns (found `TASK-AI`,`TASK-FOUND`,`FEAT-` only in current rows) so this fails closed as intended, not silently. 18. P0 (already in Phase 1 signal if you consolidate) — `tools/ai-brain/coordinator-runtime.js` prepared `merge --no-commit --no-ff`, then `hooked commit --no-edit`. `merge` is not `commit`; the installed hooks on the host are what this exercises but there is no comparison that `--no-commit` leaves any conflict marker for the a/b register union (it does, correctly, then `policy.unionRegister(ours,theirs)` is written and re-added). But `hooked(cwd, ['commit','--no-edit'])` after `merge --abort` on the non-register path: on `merge --abort` failure (e.g timing) the merge returns `{ ok:false, 'MAIN_MERGE_CONFLICT: ...' }` without a re-check that worktree is non-`DIRTY`; a writer crash between write and abort could leave conflict markers. Consider `merge --abort` with result checked and fail `HEAD_CHANGED?` (P Georges don't include as blocker to conclusion) — actually no, listing as P2. 19. P2 — `coordinator-runtime.js` `push()` asserts `HEAD` at line 899 but then pushes `origin HEAD`, meaning the current branch; if the working branch was switched after the last persist, exact-SHA push is not guaranteed even though the merge commit was asserted to a stored `sha`. Acceptable given lock/loop semantics, but `push item.cwd sha:refs/heads/<expected-branch>` is stronger.

Summary: I cannot PASS this remote review because Phase-1 examples (f-g) find real P0/P1 correctness/privacy problems in the _committed_ state persisted by the personal/deployment model (a small typo stray line here is your crop). Use finding list below</think>VERDICT: CHANGES_REQUIRED都不要
Reviewed SHA: 4d708d736fd27508fbd08ab1191fabee9e068b9b

Phase 1 — per checklist category

(a) Tenant scope server-side on every read/write
N/A — no product data-access code in the delta (docs + `tools/ai-brain/` + `package.json` only); Work Item states no product access changes.

(b) Authorization/RBAC per endpoint, empty scope denies
N/A — no product endpoint added. Adjacent process controls examined under (f)/(i).

(c) Negative tests present
N/A — no product endpoint. For the new coordinator paths, negative-test evidence is absent; see finding 3.

(d) Behaviour matches Work Item acceptance matrix and source specs

1. P1 — `tools/ai-brain/catalogue-refresh.js:368-396`: the quota-scan summary is derived from `data/quota-state.json` rows filtered by `Date.parse(row.at) >= Date.parse(startedAt)`, but no stage-produced evidence file is verified and `options.persist` writes `refresh-report.json` while `dispatch`'s freshness gate (`cli.js:417-435`) reads `./data/discovery/freshness.json`. The delta contains no code that advances `freshness.json`, so the 48h `STALE_CATALOGUE` gate and the "freshness advances only after all applicable live catalogues succeed" rule (BR-166-01, AC-166-02/03) cannot pass review on this file alone.
2. P1 — AC-166-01..09 each require "unit" evidence (`.md:244-252`), and the delta adds no test files and quotes no recorded test/verification command output. The Work Item's own "Codex review record" (.md:266-268) states no independent review yet. Acceptance rows are therefore NOT SATISFIED on this diff; only AC-166-10 (handoff doc) is applicable.
3. P2 — `catalogue-refresh.js:321`: `ageMs < 0` rejects future-dated evidence only for negative values; a small positive clock skew passes as fresh with no tolerance/documented skew bound caught by BR-166-03 at :216.

(e) Money as integer VND, no floats
N/A — no monetary computation or persistence added; Work Item records "unchanged, explicitly reviewed." No float arithmetic over currency introduced.

(f) Idempotency/timeouts/reconciliation for external effects 4. P0 — `tools/ai-brain/coordinator-runtime.js:855-866` (resolve on `child.on('close')` uses `buffers` drained only inside `close`, but pipe draining with `detached: true` at :843) and `:983-987`: spawned writer/review children use detached piped stdio and resolve on `close`/`exit` without an explicit guarantee that the final partial-line buffers are flushed before `readFileSync(handle.log)` at :993 consumes them. Missed drain truncates `[BLOCKED_BY_SANDBOX]` records and quota/rate classifications (BR-166-08 cooldown), so the persisted evidence and cooldown decision can disagree. 5. P1 — `coordinator-runtime.js:860-864`: no upper bound and no rotation on the append target `file` (`launchLog(item)` / `review-output.txt`); both are in the writer-visible worktree. Reviewer output is external/untrusted input, so unbounded local retention inside the item worktree is a durable-state surface that contradicts the "coordinator state remains local and excluded" intent in the decisions doc (and reviewer output is not covered by the `.oc/.serena` commit exclusion at all for `review-output.txt`, which is inside `.oc/` while `.oc/` is excluded only for commits, not for exfiltration). 6. P2 — `coordinator-cli.js:545-550`: lock file is created `wx` with `{pid}` but that metadata is never read; after SIGKILL the orphan lock surfaces as a raw EEXIST to the operator instead of a `LOOP_LOCK_HELD` message. Stale-lock inspection is the documented manual fallback (.md/.md notes), so this is legibility, not correctness. 7. P师兄** P2 — `coordinator-cli.js:567-577`: SIGINT sets `stopping`, then the loop runs `await sleep(...)` up to 30s inside the same iteration before breaking; a slow shutdown is not a correctness defect (state is written before sleep), but operator-facing. 8. P2 — `coordinator-runtime.js` prepared merge path (`merge --no-commit --no-ff`, then `hooked commit --no-edit`) does not re-verify `--diff-filter=U` is empty after the register union write/re-add; the union is literal-row and deterministic, so risk is low, butcc a residual unmerged marker would be committed as content.

(g) Audit + PII/secret masking 9. P。

atalog** — Actually note: the enumerator you used ends at (h),(i) so keep SUMMERA 10. P1 — `catalogue-refresh.js:386-391`: persisted `quota-scan-summary.json` copies `row.source`, `row.scope`, `row.upstream`, `row.model` values verbatim; the decisions doc claims a "sanitized" snapshot (.md:132-134), but no sanitize/redaction is applied in this code path. Provider upstream URLs/identifiers can leak. 11. P2 — `coordinator-runtime.js:644-654`: `readLines` rethrows non-ENOENT errors with raw fs path/message; the CLI wrapper surfaces only `error.code` when present, losing diagnostics else. Prefer prefixed safe text. 12. P2 — `coordinator-pool-writer.js:609-611`: the `require.main` success branch prints `JSON.stringify(result)` raw to stdout (job id and any reason pass unredacted), while `runPoolWriter`'s return path sanitizes `reason`. Depending on capture, stdout is the bigger exposure. 13. P2 — `coordinator-pool-writer.js:606-608` no check that `job.cwd` is the item worktree/parent before submitting; the job file lives inside a sandbox-writer-writable tree (`.oc/pool-writer-job.json`) and this is a project path.

(h) UI states loading/empty/error/forbidden if UI changed
N/A — no UI files in the delta; Work Item records UI states as N/A for an internal CLI. CLI states named in the Work Item appear largely returned; documentation of the same at item level is an (d) concern.

(i) Prior-review findings FIXED/NOT FIXED 14. P1 — No prior Codex review exists (`.md:266-268` "No independent review yet"); the prompt supplies no earlier open P0/P1 list, so there is nothing verified FIXED. The item was nonetheless moved to READY_FOR_CODEX without CI/test evidence linked. Flag as process/acceptance status rather than a code regression.

Phase 2 — open sweep (additional) 15. P2 — `cli.js:417-435`: `dryRunFlag` + `!deps.candidates` + `!deps.discoveryCatalogue`... guard is correct for the fixture carve-out, but requires a production dispatch that passes neither `deps.candidates` nor `deps.discoveryCatalogue` to depend on real freshness; that dependency is implicit and not stated in the item's acceptance notes. Injected `discoveryCatalogue` bypasses the 48h gate by design; document it so future callers cannot disguise live injection. 16. P2 — `coordinator-cli.js:534-546`: the item-id regex does not allow multiple IDs that are already in the register's `TASK-FOUND-`/`FEAT-` prefixes, and there is no FQ column for `feature`; if the register implies a feature ID for manual trigger, that check omits it, or would reject an empty string, but at least it does not silently accept an empty string for the field, so evidence is fine. It accepts an empty string for the field, so evidence is fine. Confirm the allowed prefixes cover the register's `TASK-FOUND-`/`FEAT-` row set, else such a registered item would be rejected as `ITEM_INVALID`; current register sample shows those forms present (.csv:268-272), so this predicate is likely too narrow 17. P2 — `coordinator-runtime.js` `push()` asserts `HEAD` equals the sha and then pushes `HEAD` (`push or slice of args not guaranteed branch pinning`) — a stronger form would push `<sha>:refs/heads/<branch>`; with the loop lock and one item per cwd this is low risk, but should be captured as a task. 18. P2 — No `1`'s ownership in `coordinator-runtime.js` for `policy.protectedFile` match scope (allowlists/baselines/semgrep/gates vs a narrower pattern) is shown in the delta; verify the pattern covers every protected gate named in `.md:218-219`, and if it only covers a subset, raise to P1 — listed here as needs-verification.

Verdict is not a PASS: findings 2/3/4 (and the missing-freshness-writer in 5) are P0/P1-level for the item's own claimed behaviour and require code/test changes, not just notes. The two P0s (finding 4 drain race and finding 5 of the Phase 1 (d) refresh writer = my 1) need removal-on-new-commit before this is reviewable.

## Round 4 review (pl-task-ai-166-4, writer was opencode:amd-radeon/Qwen3.8-27B)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: df63795e5ea10091ade7f94254f6ca006df25513

1. **Phase 1 (a) — Tenant scope: N/A.** The supplied delta adds Controller tooling and evidence, with no tenant-owned product reads or writes.

2. **Phase 1 (b) — Endpoint authorization/RBAC: N/A.** No product endpoint changes. Coordinator publication and reviewer independence have findings below.

3. **Phase 1 (c) — Negative tests: product 403/404 cases are N/A.** Controller negatives now exist: protected paths, bad subjects, merge conflicts, stale evidence and invalid review results are covered in `tools/ai-brain/test/task-ai-166-coordinator.test.js`, `task-ai-166-refresh.test.js` and `task-ai-166-runtime.test.js`. Their presence fixes the previous “no test files” assertion. Execution evidence remains incomplete; see finding 7.

4. **Phase 1 (d) — NEW P1: scheduled-lane discovery never awaits the production submission.**
   `tools/ai-brain/discovery/live.js:152-161` awaits the injected `submitModels` branch but omits `await` before `pool.submitJob(...)`. For its asynchronous result, `exitCode` and `stdout` are read from the Promise, so the lane is recorded as `MODELS_COMMAND_FAILED` while its job continues. Configured lanes consequently prevent a complete refresh and fresh dispatch. The injected test bypasses this production branch. Await the real submission and consume its completed receipt.

5. **Phase 1 (d) — NEW P1: partial registry listings can advance global freshness.**
   `tools/ai-brain/discovery.js:126-140` excludes listings with nonempty `notes` from `successful`, but does not include them in `failed`. One other successful source therefore makes `complete` true despite a partial source. This contradicts BR-166-01 and AC-166-02. Treat incomplete listings as refresh failures while preserving the previous successful timestamp.

6. **Phase 1 (d) — NEW P1: lossy model filtering can manufacture disappearance evidence.**
   `tools/ai-brain/discovery/live.js:108-118` silently drops unsupported or malformed rows and labels the remaining list `enumerated`. The regex rejects `@`, although the supplied catalogue contains IDs such as `cf/@cf/cloudflare/clef-flash` and `cl/@preset/...`. Once such a source has previous observations, a subsequent filtered listing can cause removals through `discovery/reconcile.js:83-97`. Validate the complete payload and supported identifier syntax; rejected rows must make the listing incomplete rather than authoritative.

7. **Phase 1 (d) — P1, prior acceptance-evidence finding NOT FIXED in full.**
   `docs/product-spec/work-items/TASK-AI-166.md:75` still leaves verification unchecked; `:89-98` requires unit evidence and live logs. Test files and failed scanner-attempt artifacts are now supplied, but successful verification results and the required PR-body evidence are absent. The CI excerpt associates check names with this SHA but supplies **no conclusions**, so it does not establish green CI.

   Against the supplied acceptance matrix:
   - AC-01/02 have refresh tests and failed live-attempt artifacts; findings 4–6 still break discovery honesty/completeness.
   - AC-03 has a freshness gate and boundary tests.
   - AC-04/05 have mocked liveness, handoff, merge and publication tests.
   - AC-06 is affected by findings 13–14.
   - AC-07 is affected by finding 9.
   - AC-08 has partition/merge tests but the independence defect in finding 13.
   - AC-09 has daily-refresh and metrics tests; malformed-record handling remains unresolved.
   - AC-10’s required PR body is not supplied.

8. **Phase 1 (e) — Integer VND: N/A.** No monetary computation or persistence changes.

9. **Phase 1 (f) — NEW P1: quota cooldown renews indefinitely from the same old log.**
   `tools/ai-brain/coordinator.js:302-303` adds an exclusion ending at `now + quotaCooldownMs` every tick that rereads the quota log. If no alternative writer exists, `route()` retains that writer and log (`:255-257`), so every subsequent tick extends the exclusion again. The model never becomes eligible after two hours. Persist classification once per launch, using a stable observation time, and reconcile newer quota evidence.

10. **Phase 1 (g) — P1, prior unbounded-output finding NOT FIXED.**
    `tools/ai-brain/coordinator-runtime.js:233-245` has neither a partial-line buffer limit nor a file-size limit. A child emitting one long line exhausts memory; newline-delimited output can exhaust disk. `:354` and the review reader around `:376` then load the entire file. Sanitization does not bound resource consumption. Bound buffers, retention and reads, preserving an explicit truncation indicator.

    The previous quota-summary privacy finding **is FIXED**: `tools/ai-brain/catalogue-refresh.js:94-99` persists aggregate counts instead of source/scope/upstream/model identifiers.

11. **Phase 1 (h) — UI states: N/A.** No product UI changes.

12. **Phase 1 (i) — Previous findings, consolidated because the supplied review duplicates and contradicts itself.**

    | Previous issue                                        | Disposition at this SHA                                                                                                                                                                                                                                                       |
    | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
    | Missing discovery freshness writer                    | **FIXED:** `discovery.js:138-146` writes the observation record. New completeness defects are findings 4–6.                                                                                                                                                                   |
    | Report/freshness split as competing gate records      | **FIXED:** `catalogue-refresh.js:23-28` reads the observation record written by discovery; the report does not control dispatch freshness.                                                                                                                                    |
    | Child exit/drain race                                 | **FIXED:** `coordinator-runtime.js:243-246` handles `close` and synchronously flushes tail buffers before resolving. Detached mode does not invalidate that ordering.                                                                                                         |
    | Unbounded logs                                        | **NOT FIXED — P1:** finding 10.                                                                                                                                                                                                                                               |
    | Raw identifiers in quota summary                      | **FIXED:** `catalogue-refresh.js:94-99`.                                                                                                                                                                                                                                      |
    | No test files / no execution evidence                 | **FIXED** for test-file presence; **NOT FIXED — P1** for complete execution/handoff evidence, finding 7.                                                                                                                                                                      |
    | Invalid metrics records abort reporting               | **NOT FIXED — P2:** `coordinator-runtime.js:26-35` parses without validation; `coordinator-cli.js:15-21` sends invalid PR values to GitHub. A malformed/truncated line or `pr: null` aborts reporting. This is a reporting robustness defect, not the previously asserted P1. |
    | Protected-path coverage was unavailable               | **FIXED** as a verification gap: `coordinator.js:187-196` and its preflight tests now expose coverage for the named protected categories. No concrete missing category from that earlier speculative claim is established.                                                    |
    | Author-role contradiction                             | **FIXED:** explicit operator assignment and implementation authorization are recorded at `TASK-AI-166.md:12`, `:39` and `:43`.                                                                                                                                                |
    | “No independent review yet” prevents review readiness | **NOT FIXED as documentation** at `TASK-AI-166.md:113`; the earlier P1 interpretation is withdrawn. Entering independent review does not require an earlier independent review.                                                                                               |
    | Pool job’s writable `cwd` boundary                    | **NOT FIXED — P2:** `coordinator-pool-writer.js:8-10` forwards the job’s `cwd` without binding it to the expected worktree.                                                                                                                                                   |
    | Raw filesystem diagnostics reduced to errno           | **NOT FIXED — P2:** `coordinator-runtime.js:26-35`, `coordinator-cli.js:90`.                                                                                                                                                                                                  |
    | Whitespace feedback loses actionable details          | **NOT FIXED — P2:** `coordinator-runtime.js:108-109` and `:151-153` retain only `DIFF_CHECK_FAILED`.                                                                                                                                                                          |
    | Orphan-lock guidance                                  | **NOT FIXED — P2:** `coordinator-cli.js:48-50` still exposes raw `EEXIST`, without PID/age inspection guidance.                                                                                                                                                               |
    | Slow SIGINT sleep                                     | **FIXED:** `coordinator-cli.js:79-80` checks shutdown between one-second waits.                                                                                                                                                                                               |
    | Raw pool-result envelope                              | **NOT FIXED:** `coordinator-pool-writer.js:11-12` still prints `jobId` without sanitization. The supplied material does not establish that this generated identifier contains sensitive data, so the earlier leak claim is not retained as a blocker.                         |
    | Push uses mutable `HEAD` after checking it            | **NOT FIXED — P2:** `coordinator-runtime.js:280-282` still has a check/use race. Push the pinned OID to the validated branch ref.                                                                                                                                             |
    | Injected-catalogue freshness exception undocumented   | **FIXED:** `TASK-AI-166.md:61` explicitly documents the fixture exception.                                                                                                                                                                                                    |

    Earlier claims about future timestamps passing, subprocess memory hiding persisted files, unsupported `TASK-FOUND`/`FEAT-AUTH` IDs, out-of-scope paths, and necessarily committing unresolved Git entries are **NOT FIXED because those claims are withdrawn**: the supplied delta does not establish those defects. The benchmark cross-source assertion was a suggested additional test, not evidence of averaging introduced by this delta.

13. **Phase 2 — NEW P1: fan-out authors can review their own combined output.**
    `tools/ai-brain/coordinator-runtime.js:401-423` selects and records lane writers, but `coordinator.js:298-299` clears the lanes without retaining their author families. Reviewer selection then excludes only `current.writer`’s original family (`:364-375`). A lane writer from another family can consequently become the combined-SHA reviewer. Preserve the families of every contributing author and exclude all of them; stop for an operator if no independent reviewer remains.

14. **Phase 2 — NEW P1: a mixed finding block can hide an open P1 from the PASS guard.**
    `tools/ai-brain/coordinator-runtime.js:43-47` marks an entire block closed whenever it contains `FIXED` and lacks the exact text `NOT FIXED`. For example, `1. P1 Open authorization defect; previous issue FIXED` becomes a closed P1. `coordinator.js:399-400` then accepts a matching-SHA PASS despite the open defect. Parse finding status explicitly and separately from prior-finding commentary; mixed or ambiguous blocks must fail closed.

15. **Phase 2 — NEW P1: publication preflight permits already-committed private coordinator files.**
    `tools/ai-brain/coordinator-runtime.js:150-153` checks committed paths through `coordinator.js:192-197`, which does not reject `.oc/`, `.serena/` or `.oc-codex-task.md`. Staging exclusions and the cached-file check protect only the host handoff operation. An already-authored or native-writer commit containing `.oc/writer.log` or coordinator state can pass preflight and be pushed. Reject private paths in the complete publication delta before push.

16. **Phase 2 — NEW P2: valid Controller goal items are rejected.**
    `tools/ai-brain/coordinator-cli.js:34` excludes `GOAL-<GOAL>-<n>` identifiers, although the supplied agent contract explicitly permits them as delivery units. Support that identifier form or explicitly restrict this coordinator’s supported item types in its contract.

## Round 6 review (pl-task-ai-166-6, writer was codex-ar:gpt-6-astra)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 01d24d11d767a79f14af85283b679273c61168b6

1. **P1 — CI failing:** ai-brain-tests, contract. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 125661049495) — failing log lines

```
  ✔ capabilities the operator declares are carried through (0.520195ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.566511ms)
✔ the add path writes only the entry the registry accepts (9.604177ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (0.891604ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (1.108606ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (0.778374ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.405712ms)
✔ the validator is the gate and names every failing field (3.748354ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (0.327978ms)
--
  ✔ the secret never appears in the registry file (1.486057ms)
  ✔ the secret is not stored in plaintext anywhere (1.413682ms)
  ✔ listAccounts reports presence but never the value (1.828412ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.993243ms)
  ✔ a secret for an unknown account is refused (0.466115ms)
  ✔ removing an account destroys its secret (1.062271ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (4.214148ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.403078ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.490821ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.521297ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.444825ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.392899ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.219227ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.19962ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.190553ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (3.351748ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.288636ms)
  ✔ audit flags missing source URL or checked_on as error (0.250615ms)
  ✔ audit flags model version mismatch with offerings as warning (0.213646ms)
  ✔ production benchmarks.json passes audit with zero errors (0.171989ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (1.435132ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (2.534371ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (2.481234ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.253861ms)
  ✔ summary.pass counts records with no findings (0.440958ms)
  ✔ the audit prints the operator-console state lines (0.348256ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (9.128675ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (1.826678ms)
--
  ✔ shared-quota defaults to unknown (0.522319ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.209479ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (7.73503ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (1.505473ms)
  ✔ cross-account: success on one account is not inherited as verified by another (0.690651ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (1.4283ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.271704ms)
✔ evidence store (22.471398ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (48.097781ms)
    ✔ login-required excluded (39.604037ms)
    ✔ the adapter writes the expected job.json and maps each result state (2.186537ms)
```

### contract (job 125661049833) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR contains unchecked mandatory checklist items
##[error]Process completed with exit code 1.
```

## Round 100 review (pl-task-ai-166-100, writer was agy02:claude-opus-5-5-high)

VERDICT: CHANGES_REQUIRED
Reviewed SHA: 6a665f1367a5465cce3a7067a3556b2a094dc3ae

1. **P1 — CI failing:** ai-brain-tests, contract. Reproduce locally with the same commands as CI, fix, and re-run them green before committing.

### ai-brain-tests (job 126087646936) — failing log lines

```
  ✔ capabilities the operator declares are carried through (0.654234ms)
  ✔ an entry written without a credential reports it cannot authenticate yet (AI-29-R10) (0.51865ms)
✔ the add path writes only the entry the registry accepts (11.380894ms)
▶ the validator is the gate and names every failing field
  ✔ a missing provider, model and context window are all reported at once (AI-29-R03) (1.143099ms)
  ✔ a malformed id is refused rather than written (AI-29-R03) (1.383358ms)
  ✔ a tier outside the ladder is refused (AI-29-R03) (1.107753ms)
  ✔ a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04) (0.540782ms)
✔ the validator is the gate and names every failing field (4.754496ms)
▶ a ceiling carries its provenance and never a bare number
  ✔ a bare number ceiling is refused, not assumed (AI-29-R05) (1.029206ms)
--
  ✔ the secret never appears in the registry file (1.364273ms)
  ✔ the secret is not stored in plaintext anywhere (1.326061ms)
  ✔ listAccounts reports presence but never the value (1.543989ms)
  ✔ a wrong key fails loudly instead of returning garbage (0.868645ms)
  ✔ a secret for an unknown account is refused (0.370062ms)
  ✔ removing an account destroys its secret (1.246563ms)
--
✔ The operator console reads the rotation and the refusal (#116 N2) (3.540645ms)
▶ Benchmark source verification and key uniqueness (TASK-AI-46)
  ✔ a record marked verified: false grades nothing and is reported (0.35288ms)
  ✔ a record that omits the verified flag is refused and is an audit error (#116 B3) (0.429935ms)
  ✔ a non-boolean verified flag is refused and is an audit error (#116 B3) (0.583802ms)
  ✔ a record cannot grade itself through a self-declared grade (#116 B4) (0.378107ms)
  ✔ a score that cannot be mapped grades nothing and is an audit error (#116 B4) (0.405299ms)
  ✔ the strongest single record sets the grade, and it is never blended (#116 B4) (0.217296ms)
  ✔ a repeated (model, version, benchmark, benchmark version) key is an audit error (0.24085ms)
  ✔ every shipped benchmark record is marked unverified until a real source is recorded (0.200315ms)
✔ Benchmark source verification and key uniqueness (TASK-AI-46) (3.36674ms)
▶ Benchmark staleness and completeness audit (TASK-AI-46)
  ✔ audit flags records older than 90 days as warning (0.322594ms)
  ✔ audit flags missing source URL or checked_on as error (0.2834ms)
  ✔ audit flags model version mismatch with offerings as warning (0.24012ms)
  ✔ production benchmarks.json passes audit with zero errors (0.194384ms)
✔ Benchmark staleness and completeness audit (TASK-AI-46) (1.615643ms)
▶ Evidence reaches real offerings and fails closed (#106 review 05:09Z)
  ✔ a seed offering resolves through externalEvidence by its model, not its offering id (2.877224ms)
  ✔ a seed offering graded by evidence carries the sourced record as its proof (2.549069ms)
--
  ✔ resolveGrade does not read damaged evidence as no evidence (0.302045ms)
  ✔ summary.pass counts records with no findings (0.423022ms)
  ✔ the audit prints the operator-console state lines (0.391002ms)
✔ Evidence reaches real offerings and fails closed (#106 review 05:09Z) (9.732019ms)
▶ evidence store
  ✔ loads empty evidence when file does not exist (1.711292ms)
--
  ✔ shared-quota defaults to unknown (0.670785ms)
  ✔ candidateKey produces seven-part identity everywhere matching candidates.candidateKey (0.159207ms)
  ✔ cross-account: 401 on one account does not block unrelated accounts on same upstream (7.377674ms)
  ✔ cross-account: failure recorded for one account does not infect other accounts (1.522258ms)
  ✔ cross-account: success on one account is not inherited as verified by another (1.035347ms)
  ✔ migration: legacy 4-field evidence is migrated fail-closed as unverified history (0.888903ms)
  ✔ headroomScore: unpacks object readings from quota.accountHeadroom (0.265838ms)
✔ evidence store (21.39942ms)
--
  ▶ agy-pool quota and adapter (TASK-AI-68)
    ✔ a quota result with 0% excludes that account until reset (41.198736ms)
    ✔ login-required excluded (43.128467ms)
    ✔ the adapter writes the expected job.json and maps each result state (1.884767ms)
```

### contract (job 126087645921) — failing log lines

```
  Python2_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  Python3_ROOT_DIR: /opt/hostedtoolcache/Python/3.12.15/x64
  LD_LIBRARY_PATH: /opt/hostedtoolcache/Python/3.12.15/x64/lib
Pull Request contract validation failed:
- PR body still contains required template placeholders
- PR is not marked READY_FOR_CODEX
##[error]Process completed with exit code 1.
```
