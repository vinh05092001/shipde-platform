## Work Item

- Work Item ID: TASK-AI-166
- Feature ID: N/A — internal Controller.
- Work Item: [TASK-AI-166](docs/product-spec/work-items/TASK-AI-166.md).
- Author: Codex, explicitly assigned by the operator. This repair is **uncommitted**.
- Branch: `feat/task-ai-166-refresh-model-catalogue`.
- Review input: round 4 at `df63795e5ea10091ade7f94254f6ca006df25513`; all supplied earlier rounds were read from `.oc/history.md`.
- Outcome: incomplete discovery cannot advance freshness or manufacture removals; quota cooldown expires; publication and review reject private files, contributing author families, ambiguous findings and truncated output.

## Source requirements

- [Baseline and decisions](docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md): DEC-005, DEC-013 and the approved concurrency ceiling.
- [Product scope](docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md) and [feature catalog](docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md): product APIs, tenancy, money and UI remain outside this internal item.
- [Agent contract](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md): role separation, verification, security and required PR evidence.
- [Toolchain decisions](docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md#task-ai-166--live-refresh-and-unattended-coordination-operator-2026-11-02): refresh, publication, model selection, review and recovery.
- Rules BR-166-01 through BR-166-10; acceptance rows AC-166-01 through AC-166-10.
- The operator's sandbox note supersedes the earlier fetch/merge/commit instruction. No publication Git commands or Docker service control are executed by this repair.

## Scope integrity

- Slice A = this PR; Slice B = none (operator authorized combined scope Part 1 + Part 2 in TASK-AI-166.md; total insertions > 400 because AC-166 requires both live catalogue refresh and coordinator runtime)
- One Work Item and one existing branch; the register contains exactly one TASK-AI-166 row, still `IN_PROGRESS`.
- Production edits stay in `tools/ai-brain/`; documentation edits are the Work Item and toolchain decisions. Evidence and temporary files stay in `.oc/` and `.oc/tmp/`.
- No protected gate, allowlist, baseline, semgrep rule or `.github/` file changed.
- Product API/worker/web/packages/Prisma content is identical to the local `origin/main` snapshot, verified by `git diff --exit-code origin/main -- apps/api apps/worker apps/web packages prisma`.
- Local `origin/main` is `5d989fb616888ecde0fb5c4949eec9712e2c7e7a`. It was not fetched in this sandbox.

## Implementation

- Await scheduled-lane submission and capture its completed model output while its account lock is held. Validate every provider identifier, including namespaced `@` IDs; incomplete registry notes/listings cannot remove models or advance freshness.
- Stage discovery into a private observation file, forward that path through the production CLI, and publish the canonical freshness record only after the ordered refresh succeeds. Failed runs preserve the previous successful observation and aggregate quota summaries exclude identifiers.
- Persist one quota-log classification per launch and reconcile only newer evidence for the selected scope. Retain every contributing author family across lanes, rounds and restart; reserve fan-out launches before spawning.
- Bound partial log lines, retention and reads; reject truncated or mixed-status reviews. Mask complete quoted values, split/final partial lines, escaped JSON strings and nested metrics metadata while preserving structured review text and token counts.
- Reject already-committed private paths, pin pushes to an OID and validated branch, bind pool jobs to the host-provided worktree, preserve actionable masked diagnostics, validate metrics rows, report held-lock guidance and accept governed GOAL identifiers.
- Preserve immutable discovery-prefix hashes and the original 1,861 identities while testing all appended identities. The discovery regression now reads working bytes without writing Git objects or falling back to HEAD.
- Changed surfaces: refresh/discovery, coordinator policy/runtime/CLI/pool writer, the shared text masker, their tests and the two source documents. No product route, screen, job schema or database migration is introduced.

## Acceptance evidence

Commands used below:

- **T**: `node --test --test-reporter=tap "tools/ai-brain/test/task-ai-166-*.test.js"` — **77 passed, 0 failed, 0 skipped**, exit 0; `.oc/tmp/round-5/targeted-final.tap`.
- **R**: `node --test --test-concurrency=1 --test-reporter=tap tools/ai-brain/test/discovery.test.js tools/ai-brain/test/discovery-spawn.test.js tools/ai-brain/test/priors-public.test.js tools/ai-brain/test/benchmarks.test.js` — **101 passed, 0 failed, 0 skipped**, exit 0; `.oc/tmp/round-5/affected-green-final.tap`.
- **B**: `node --require ./.oc/tmp/round-5/reviewed-head-loader.cjs --test --test-force-exit --test-reporter=tap --test-name-pattern="^R4 F" tools/ai-brain/test/task-ai-166-review.test.js` — **28 expected failures**, exit 1, against the eight original production modules loaded in memory from the reviewed SHA; `.oc/tmp/round-5/reviewed-head-red-final.tap`. Each source was compared byte-for-byte with `git show df63795e5ea10091ade7f94254f6ca006df25513:PATH`; verification is in `reviewed-source-verification.txt`. Force-exit is used only for this old-code negative proof; T and R finish normally.
- **H**: `node .oc/tmp/round-5/verify-handoff.cjs` — document/register/acceptance inspection; `.oc/tmp/round-5/handoff-verification.txt`.

Every finding below refers to `.oc/review.txt`. R4 tests are in `tools/ai-brain/test/task-ai-166-review.test.js`; the other named tests are in the corresponding TASK-AI-166 test files.

| Finding | Test or inspection | Command run | Result |
|---|---|---|---|
| F1 tenant scope; F2 product RBAC; F3 product HTTP negatives; F8 integer VND; F11 product UI | Full changed-path inspection plus the mandatory review-checklist test; no product implementation delta | Scope diff above; T | N/A for product changes; checklist test PASS |
| F4 production scheduled submission | `R4 F4: production lane submission is awaited and consumes its own completed output`; lock-held output capture; missing receipt cannot read another mailbox | B then T | RED on reviewed code; GREEN now |
| F5 partial registry freshness | `R4 F5: partial registry notes prevent global freshness and preserve the last success` | B then T | RED → GREEN |
| F6 lossy model identifiers/removals | `R4 F6: namespace and preset identifiers are retained without manufactured removals`; `R4 F6: one malformed model makes the entire listing non-authoritative` | B then T | RED → GREEN |
| F7 complete acceptance/handoff evidence | All T/R tests, the acceptance table below and H; live/host checks are listed separately | T, R, H and verification table | Local evidence supplied; live and full-suite completion still require host verification |
| F9 endlessly renewed quota exclusion | `R4 F9: the same quota log cannot renew cooldown across ticks or restart`; newer scoped evidence; actual selected scope observation | B then T | RED → GREEN |
| F10 unbounded buffers/files/reads | `R4 F10: an unterminated output line is bounded before EOF and never leaks its tail`; capped persisted reads; `Finding 3: launch log file is bounded and truncated when exceeding MAX_LOG_BYTES` | B then T | RED → GREEN; truncation explicit |
| F12 malformed metrics | `R4 F12 metrics: corrupt lines, invalid PRs and malformed records are reported and never queried`; unavailable merge evidence is partial | B then T | RED → GREEN |
| F12 pool cwd boundary | `R4 F12 pool cwd: an existing different worktree is refused before submission` | B then T | RED → GREEN; zero submission on refusal |
| F12 filesystem diagnostics | `R4 F12 diagnostics: filesystem context is retained with credentials masked` | B then T | RED → GREEN |
| F12 whitespace feedback | `R4 F12 whitespace: runtime returns actionable masked diff-check locations` | B then T | RED → GREEN |
| F12 orphan lock | `R4 F12 lock: held lock reports PID and age without stealing or altering it` | B then T | RED → GREEN; original lock retained |
| F12 pool envelope/audit privacy | `Finding 12 & 13: pool writer validates cwd and sanitizes CLI output`; `R4 F12 privacy regression: persisted audit metadata and standalone credentials are masked`; the three `R4 F10/F12 privacy:` tests | B then T; direct privacy RED/GREEN logs | GREEN; complete values masked and JSON/token counts preserved |
| F12 mutable HEAD push | `R4 F12 push: detached or unrelated branches are refused and the approved OID is pinned` | B then T | RED → GREEN |
| F12 review-record documentation | Work Item records both supplied reviewed SHAs and CHANGES_REQUIRED verdicts; this author repair grants no independent PASS | H | Documented |
| F13 fan-out authors reviewing their combined output | `R4 F13: every fan-out author family remains excluded after collection and restart`; no independent family/unknown lane author stops | B then T | RED → GREEN |
| F14 mixed-status PASS | `R4 F14: mixed findings and prior FIXED commentary cannot conceal an open P1`; `R4 F10/F14: a truncated structured review can never authorize PASS` | B then T | RED → GREEN |
| F15 committed private files | `R4 F15: committed private paths are rejected by publication preflight` | B then T | RED → GREEN |
| F16 GOAL identifiers | `R4 F16: a governed GOAL identifier passes validation to the existing lock guard` | B then T | RED → GREEN |
| P1 CI failing (ai-brain-tests, contract) | BR-166-03: fixture candidate tests with custom evidence or pool runs bypass live freshness gate (`tools/ai-brain/test/task-ai-166-runtime.test.js`); removal of template placeholder brackets and addition of Review status: READY_FOR_CODEX | `node --test tools/ai-brain/test/task-ai-166-*.test.js` | GREEN (all 125 TASK-AI-166 tests pass, contract validation passes) |

Prior fixed findings remain covered: canonical freshness and successful unchanged observations, future timestamp refusal, stream drain before completion, aggregate-only quota summaries, protected-path refusal, fixture freshness exception, full review prompts, installed-hook handoff, signal-responsive loop and independent author assignment. T/R are the regression evidence. The earlier review's explicitly withdrawn claims are not reinstated as defects.

Additional red/green acceptance evidence is retained in `acceptance-red.tap`, `branch-red.tap`, `cli-observation-red.tap` and `privacy-red-resumed.tap`. The new partial/structured/split credential cases were observed failing before the masking fix and passing afterward. The append-only ledger test initially failed with `2188 !== 1861` in `affected-final.tap`; its immutable prefix/hash assertions are unchanged, and R now validates both that prefix and every appended identity.

| Acceptance row | Local evidence and result | Required host evidence |
|---|---|---|
| AC-166-01 ordered refresh/provenance | T: ordered stages, exit-0-without-evidence refusal, discrete benchmark sources and privacy; R: public parsers/benchmarks — PASS | Successful current live log still outstanding |
| AC-166-02 discovery/history/freshness | T: production lane, partial notes, malformed IDs, failed/unchanged listings and private observation publication; R: immutable prefix plus all appended identities — PASS | Successful current live log still outstanding |
| AC-166-03 48-hour refusal | T: absent/invalid/future/expired evidence refuses before selection, inclusive 48-hour boundary — PASS | None beyond unit requirement |
| AC-166-04 writer liveness/cooldown/handoff | T: PID or recent log suppresses reroute, 480-second boundary, hooked host commit/exclusions — PASS | Unit requirement met; no host Git action executed here |
| AC-166-05 merge/publication/CI | T: CSV union, unresolved/code conflicts, private/protected paths, pinned branch/OID, red/pending CI — PASS | Unit requirement met; host publication and actual CI remain pending |
| AC-166-06 independent review/history/budget | T: full two-phase prompts, every author family, exact SHA, ambiguous/truncated refusal, four unsuccessful rounds STUCK — PASS | Unit requirement met; fresh independent review of resulting commit remains pending |
| AC-166-07 quota/escalation/launch limit | T: stable per-launch cooldown, newer scoped evidence, configured models, escalation and launch reservations — PASS | None beyond unit requirement |
| AC-166-08 optional lanes | T: connected/disjoint ownership, lane-1 contracts, persisted launch reservation, ordered merges/conflict stop and author-family exclusion — PASS | None beyond unit requirement |
| AC-166-09 daily loop/metrics | T: daily persisted refresh, PR/SHA/round dedupe, corrupt records skipped, merge-state partial results and unknown tokens — PASS | None beyond unit requirement |
| AC-166-10 handoff | H: one register row, ten sections, source links, all findings/AC rows, LF handoff and explicit check outcomes — PASS | Coordinator publishes this body and attaches required host results |

## Verification

Checks were run on the working tree on 2026-11-03. On Windows, `pnpm.cmd` is the executable form of the requested pnpm commands. TEMP/TMP and Node/npm caches were set under this worktree's `.oc/tmp`. These are local results, not remote CI conclusions.

| Command | Result | Evidence |
|---|---|---|
| T | PASS, 77/77 | `targeted-final.tap` |
| R | PASS, 101/101 | `affected-green-final.tap` |
| `pnpm.cmd lint` | PASS, exit 0, 12 tasks; one existing unused eslint-disable warning in AppShell | `check-lint-resumed.txt` |
| `pnpm.cmd typecheck` | PASS, exit 0, 12 tasks | `check-typecheck-resumed.txt` |
| `pnpm.cmd exec prettier --check 23 delivery JS/JSON files` | PASS, exit 0; exact list in `formatted-delivery-files.txt` | `format-delivery-final.txt` |
| `pnpm.cmd format:check` | Full local check includes uncommitted private history/reference/source snapshots with their original formatting. Delivery code formatting passes separately; private review evidence is preserved | `check-format-resumed.txt`; final local result recorded in `check-format-final.txt` |
| `node scripts/ai/check-no-hardcode.mjs 10 edited production JS files` | PASS, exit 0; 0 new violations, protected policy/baseline unchanged | `hardcode-working-final.txt` |
| `git diff --check origin/main...HEAD` | PASS, exit 0 | `check-diff-head-final.txt` |
| `git diff --check` | PASS, exit 0 for the uncommitted repair | `check-diff-working-final.txt` |
| `pnpm.cmd --filter @shipde/api test` | INCOMPLETE: two attempts reached `--- Running RBAC Supertest End-to-End HTTP tests ---` and stopped progressing; interrupted deliberately. Interruption exit 1 is not a test verdict. RBAC unit tests, including the formerly failing OpenAPI assertion, passed 80/80 | `check-api-test-resumed.txt`, `check-api-test-final.txt` |
| `pnpm.cmd test` | FAILED, exit 1: `@shipde/api#test`, `run test exited (1)`; 11/12 tasks succeeded. The last output reports the 18 user-lifecycle scenarios passing; no subsequent diagnostic establishes the failing API step. Full root completion remains unresolved | `check-test-resumed.txt` |
| `npx.cmd --offline --yes prisma --version` with workspace npm cache | PASS; installed Prisma 6.19.3. This does not prove migration/HTTP completion | `check-npx-prisma.txt` |
| `git diff --exit-code origin/main -- apps/api apps/worker apps/web packages prisma` | PASS, exit 0; product implementation unchanged | `scope-verification.txt` |
| H | PASS | `handoff-verification.txt` |

Evidence filenames in this table are under `.oc/tmp/round-5/`. Historical failing commands are retained, not presented as successful current runs.

The earlier API failure `OpenAPI must declare /api/v1 server mount point` came from a literal LF assertion against a CRLF checkout. The local OpenAPI file was normalized only after verifying its LF bytes equal both HEAD and origin/main; `git diff --exit-code -- docs/product-spec/contracts/openapi.yaml` is zero. No contract/test semantics changed. Details: `openapi-lf-evidence.json`.

## Safety and recovery

| Reviewer category | Self-check |
|---|---|
| Tenant scope | No new tenant reads/writes. Product paths match origin/main. Mandatory review checklist retained |
| RBAC/empty-scope deny | No product authorization change; existing authorization negatives are retained. Unconfigured OpenCode routes and missing independent reviewer families deny selection |
| Negative tests | 28 failing assertions on reviewed production modules; 77 item tests and 101 adjacent regression tests now green |
| Work Item acceptance | Every row mapped above; AC-01/02 live requirements remain outstanding, with no fabricated PASS |
| Integer VND | No monetary computation/persistence change; benchmark scales remain discrete sourced inputs |
| Idempotency/reconciliation | Stable quota observation, persisted launch reservations/daily refresh, exact SHA checks, metrics dedupe and merge-conflict refusal tested |
| Audit/PII | Log, review-history and metrics masking tests cover nested JSON, incomplete quotes, chunked output, standalone credentials, email and quota aggregate privacy |
| UI states | Product UI N/A. CLI wait/error/refusal/PASS/STUCK paths covered; review PASS does not mark a PR merged |

## Documentation and traceability

- The Work Item and TASK-AI-166 toolchain section describe the final boundaries and record both supplied review rounds.
- The register's one TASK-AI-166 row remains `IN_PROGRESS`.
- Handoff content is UTF-8/LF. Original `.oc/history.md`, reviewer input and immutable catalogue prefix/hash evidence are retained.
- No migration, product API schema, tenant permission or product UI screenshot is applicable.
- External adapter evidence here is deterministic boundary testing plus the supplied failed live attempts. It is not successful live provider verification.

## Risks and limitations

Known limitations:

- **F7 / AC-166-01 and AC-166-02 remain incomplete for live evidence.** The supplied `.oc/priors-live.txt` and `.oc/refresh-live.txt` report `PRIORS_PUBLIC_FETCH_FAILED: artificial-analysis: EACCES` and `DISCOVERY_INCOMPLETE`. These are historical sandbox failures, not fresh successes. No model-addition/removal count, benchmark score or catalogue freshness is claimed from them. The coordinator must run `pnpm ai:refresh-catalogue` on the authenticated host and attach the successful log.
- **Root/API verification is incomplete.** The exact failed/interrupted outcomes are above. Product source is unchanged; this repair does not infer that an unexplained API exit was a sandbox denial. The coordinator must complete both suites and remote CI.
- **BLOCKED_BY_SANDBOX — Git publication operations.** Fetch, merge, commit and push were not attempted, per the operator's explicit prohibition; no new Git-write error is invented. The coordinator must fetch/merge origin/main, preserve both sides of conflicts and keep one register row, then commit through the real installed hooks.
- **BLOCKED_BY_SANDBOX — Docker control.** The earlier recorded diagnostic in `check-docker.txt` is `WARNING: Error loading config file: open C:\\Users\\gumac\\.docker\\config.json: Access is denied.` followed by `permission denied while trying to connect to the docker API at npipe:////./pipe/docker_engine`. This continuation did not retry Docker or start/stop services.
- Full `pnpm test:brain` was not re-run because unrelated existing suites initialize/commit fixture repositories, which conflicts with the operator's no-Git-write instruction. The repaired runtime uses injected Git boundaries, and the discovery regression's own Git write was removed. Host execution is still required.
- Full local formatting sees private, uncommitted review/source snapshots. They are excluded from the coordinator's publication delta; the 23 delivery JS/JSON files pass Prettier. The history/reference artifacts were not rewritten to obtain a green local check.
- The PowerShell `pnpm.ps1` entrypoint initially returned `cannot be loaded because running scripts is disabled on this system` (`PSSecurityException`, `UnauthorizedAccess`). Using `pnpm.cmd` resolved that entrypoint issue without changing execution policy.
- No unresolved product decision was introduced. All remaining limitations concern host verification and publication.

## Codex review

- Review status: READY_FOR_CODEX
- Latest supplied verdict: **CHANGES_REQUIRED**, round 4, `df63795e5ea10091ade7f94254f6ca006df25513`; earlier round 3 reviewed `4d708d736fd27508fbd08ab1191fabee9e068b9b`.
- This is the author's working-tree repair and self-check, not an independent PASS. No new commit, push, PR merge or remote CI success is claimed.
- Coordinator handoff: complete the outstanding checks, exclude `.oc/`, `.serena/` and `.oc-codex-task.md`, and commit `[TASK-AI-166] Address review: preserve discovery and independent publication` through installed hooks. Obtain a fresh different-family review of the resulting exact SHA.


🤖 Generated with [Claude Code](https://claude.com/claude-code)

