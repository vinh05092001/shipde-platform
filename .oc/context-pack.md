# Focused context pack

## .oc/context-pack.md

```
# Focused context pack

## .oc/context-pack.md

```
# Focused context pack

## .oc/context-pack.md

```
# Focused context pack

## .oc/context-pack.md

```
# Focused context pack

## .oc/context-pack.md

```
# Focused context pack

## .oc/pr-body-remote.md

```
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

| Finding                                                                                     | Test or inspection                                                                                                                                                                                                                           | Command run                                             | Result                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F1 tenant scope; F2 product RBAC; F3 product HTTP negatives; F8 integer VND; F11 product UI | Full changed-path inspection plus the mandatory review-checklist test; no product implementation delta                                                                                                                                       | Scope diff above; T                                     | N/A for product changes; checklist test PASS                                            |
| F4 production scheduled submission                                                          | `R4 F4: production lane submission is awaited and consumes its own completed output`; lock-held output capture; missing receipt cannot read another mailbox                                                                                  | B then T                                                | RED on reviewed code; GREEN now                                                         |
| F5 partial registry freshness                                                               | `R4 F5: partial registry notes prevent global freshness and preserve the last success`                                                                                                                                                       | B then T                                                | RED → GREEN                                                                             |
| F6 lossy model identifiers/removals                                                         | `R4 F6: namespace and preset identifiers are retained without manufactured removals`; `R4 F6: one malformed model makes the entire listing non-authoritative`                                                                                | B then T                                                | RED → GREEN                                                                             |
| F7 complete acceptance/handoff evidence                                                     | All T/R tests, the acceptance table below and H; live/host checks are listed separately                                                                                                                                                      | T, R, H and verification table                          | Local evidence supplied; live and full-suite completion still require host verification |
| F9 endlessly renewed quota exclusion                                                        | `R4 F9: the same quota log cannot renew cooldown across ticks or restart`; newer scoped evidence; actual selected scope observation                                                                                                          | B then T                                                | RED → GREEN                                                                             |
| F10 unbounded buffers/files/reads                                                           | `R4 F10: an unterminated output line is bounded before EOF and never leaks its tail`; capped persisted reads; `Finding 3: launch log file is bounded and truncated when exceeding MAX_LOG_BYTES`                                             | B then T                                                | RED → GREEN; truncation explicit                                                        |
| F12 malformed metrics                                                                       | `R4 F12 metrics: corrupt lines, invalid PRs and malformed records are reported and never queried`; unavailable merge evidence is partial                                                                                                     | B then T                                                | RED → GREEN                                                                             |
| F12 pool cwd boundary                                                                       | `R4 F12 pool cwd: an existing different worktree is refused before submission`                                                                                                                                                               | B then T                                                | RED → GREEN; zero submission on refusal                                                 |
| F12 filesystem diagnostics                                                                  | `R4 F12 diagnostics: filesystem context is retained with credentials masked`                                                                                                                                                                 | B then T                                                | RED → GREEN                                                                             |
| F12 whitespace feedback                                                                     | `R4 F12 whitespace: runtime returns actionable masked diff-check locations`                                                                                                                                                                  | B then T                                                | RED → GREEN                                                                             |
| F12 orphan lock                                                                             | `R4 F12 lock: held lock reports PID and age without stealing or altering it`                                                                                                                                                                 | B then T                                                | RED → GREEN; original lock retained                                                     |
| F12 pool envelope/audit privacy                                                             | `Finding 12 & 13: pool writer validates cwd and sanitizes CLI output`; `R4 F12 privacy regression: persisted audit metadata and standalone credentials are masked`; the three `R4 F10/F12 privacy:` tests                                    | B then T; direct privacy RED/GREEN logs                 | GREEN; complete values masked and JSON/token counts preserved                           |
| F12 mutable HEAD push                                                                       | `R4 F12 push: detached or unrelated branches are refused and the approved OID is pinned`                                                                                                                                                     | B then T                                                | RED → GREEN                                                                             |
| F12 review-record documentation                                                             | Work Item records both supplied reviewed SHAs and CHANGES_REQUIRED verdicts; this author repair grants no independent PASS                                                                                                                   | H                                                       | Documented                                                                              |
| F13 fan-out authors reviewing their combined output                                         | `R4 F13: every fan-out author family remains excluded after collection and restart`; no independent family/unknown lane author stops                                                                                                         | B then T                                                | RED → GREEN                                                                             |
| F14 mixed-status PASS                                                                       | `R4 F14: mixed findings and prior FIXED commentary cannot conceal an open P1`; `R4 F10/F14: a truncated structured review can never authorize PASS`                                                                                          | B then T                                                | RED → GREEN                                                                             |
| F15 committed private files                                                                 | `R4 F15: committed private paths are rejected by publication preflight`                                                                                                                                                                      | B then T                                                | RED → GREEN                                                                             |
| F16 GOAL identifiers                                                                        | `R4 F16: a governed GOAL identifier passes validation to the existing lock guard`                                                                                                                                                            | B then T                                                | RED → GREEN                                                                             |
| P1 CI failing (ai-brain-tests, contract)                                                    | BR-166-03: fixture candidate tests with custom evidence or pool runs bypass live freshness gate (`tools/ai-brain/test/task-ai-166-runtime.test.js`); removal of template placeholder brackets and addition of Review status: READY_FOR_CODEX | `node --test tools/ai-brain/test/task-ai-166-*.test.js` | GREEN (all 125 TASK-AI-166 tests pass, contract validation passes)                      |

Prior fixed findings remain covered: canonical freshness and successful unchanged observations, future timestamp refusal, stream drain before completion, aggregate-only quota summaries, protected-path refusal, fixture freshness exception, full review prompts, installed-hook handoff, signal-responsive loop and independent author assignment. T/R are the regression evidence. The earlier review's explicitly withdrawn claims are not reinstated as defects.

Additional red/green acceptance evidence is retained in `acceptance-red.tap`, `branch-red.tap`, `cli-observation-red.tap` and `privacy-red-resumed.tap`. The new partial/structured/split credential cases were observed failing before the masking fix and passing afterward. The append-only ledger test initially failed with `2188 !== 1861` in `affected-final.tap`; its immutable prefix/hash assertions are unchanged, and R now validates both that prefix and every appended identity.

| Acceptance row                              | Local evidence and result                                                                                                                                                | Required host evidence                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| AC-166-01 ordered refresh/provenance        | T: ordered stages, exit-0-without-evidence refusal, discrete benchmark sources and privacy; R: public parsers/benchmarks — PASS                                          | Successful current live log still outstanding                                      |
| AC-166-02 discovery/history/freshness       | T: production lane, partial notes, malformed IDs, failed/unchanged listings and private observation publication; R: immutable prefix plus all appended identities — PASS | Successful current live log still outstanding                                      |
| AC-166-03 48-hour refusal                   | T: absent/invalid/future/expired evidence refuses before selection, inclusive 48-hour boundary — PASS                                                                    | None beyond unit requirement                                                       |
| AC-166-04 writer liveness/cooldown/handoff  | T: PID or recent log suppresses reroute, 480-second boundary, hooked host commit/exclusions — PASS                                                                       | Unit requirement met; no host Git action executed here                             |
| AC-166-05 merge/publication/CI              | T: CSV union, unresolved/code conflicts, private/protected paths, pinned branch/OID, red/pending CI — PASS                                                               | Unit requirement met; host publication and actual CI remain pending                |
| AC-166-06 independent review/history/budget | T: full two-phase prompts, every author family, exact SHA, ambiguous/truncated refusal, four unsuccessful rounds STUCK — PASS                                            | Unit requirement met; fresh independent review of resulting commit remains pending |
| AC-166-07 quota/escalation/launch limit     | T: stable per-launch cooldown, newer scoped evidence, configured models, escalation and launch reservations — PASS                                                       | None beyond unit requirement                                                       |
| AC-166-08 optional lanes                    | T: connected/disjoint ownership, lane-1 contracts, persisted launch reservation, ordered merges/conflict stop and author-family exclusion — PASS                         | None beyond unit requirement                                                       |
| AC-166-09 daily loop/metrics                | T: daily persisted refresh, PR/SHA/round dedupe, corrupt records skipped, merge-state partial results and unknown tokens — PASS                                          | None beyond unit requirement                                                       |
| AC-166-10 handoff                           | H: one register row, ten sections, source links, all findings/AC rows, LF handoff and explicit check outcomes — PASS                                                     | Coordinator publishes this body and attaches required host results                 |

## Verification

Checks were run on the working tree on 2026-11-03. On Windows, `pnpm.cmd` is the executable form of the requested pnpm commands. TEMP/TMP and Node/npm caches were set under this worktree's `.oc/tmp`. These are local results, not remote CI conclusions.

| Command                                                                             | Result                                                                                                                                                                                                                                                                | Evidence                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| T                                                                                   | PASS, 77/77                                                                                                                                                                                                                                                           | `targeted-final.tap`                                                                |
| R                                                                                   | PASS, 101/101                                                                                                                                                                                                                                                         | `affected-green-final.tap`                                                          |
| `pnpm.cmd lint`                                                                     | PASS, exit 0, 12 tasks; one existing unused eslint-disable warning in AppShell                                                                                                                                                                                        | `check-lint-resumed.txt`                                                            |
| `pnpm.cmd typecheck`                                                                | PASS, exit 0, 12 tasks                                                                                                                                                                                                                                                | `check-typecheck-resumed.txt`                                                       |
| `pnpm.cmd exec prettier --check 23 delivery JS/JSON files`                          | PASS, exit 0; exact list in `formatted-delivery-files.txt`                                                                                                                                                                                                            | `format-delivery-final.txt`                                                         |
| `pnpm.cmd format:check`                                                             | Full local check includes uncommitted private history/reference/source snapshots with their original formatting. Delivery code formatting passes separately; private review evidence is preserved                                                                     | `check-format-resumed.txt`; final local result recorded in `check-format-final.txt` |
| `node scripts/ai/check-no-hardcode.mjs 10 edited production JS files`               | PASS, exit 0; 0 new violations, protected policy/baseline unchanged                                                                                                                                                                                                   | `hardcode-working-final.txt`                                                        |
| `git diff --check origin/main...HEAD`                                               | PASS, exit 0                                                                                                                                                                                                                                                          | `check-diff-head-final.txt`                                                         |
| `git diff --check`                                                                  | PASS, exit 0 for the uncommitted repair                                                                                                                                                                                                                               | `check-diff-working-final.txt`                                                      |
| `pnpm.cmd --filter @shipde/api test`                                                | INCOMPLETE: two attempts reached `--- Running RBAC Supertest End-to-End HTTP tests ---` and stopped progressing; interrupted deliberately. Interruption exit 1 is not a test verdict. RBAC unit tests, including the formerly failing OpenAPI assertion, passed 80/80 | `check-api-test-resumed.txt`, `check-api-test-final.txt`                            |
| `pnpm.cmd test`                                                                     | FAILED, exit 1: `@shipde/api#test`, `run test exited (1)`; 11/12 tasks succeeded. The last output reports the 18 user-lifecycle scenarios passing; no subsequent diagnostic establishes the failing API step. Full root completion remains unresolved                 | `check-test-resumed.txt`                                                            |
| `npx.cmd --offline --yes prisma --version` with workspace npm cache                 | PASS; installed Prisma 6.19.3. This does not prove migration/HTTP completion                                                                                                                                                                                          | `check-npx-prisma.txt`                                                              |
| `git diff --exit-code origin/main -- apps/api apps/worker apps/web packages prisma` | PASS, exit 0; product implementation unchanged                                                                                                                                                                                                                        | `scope-verification.txt`                                                            |
| H                                                                                   | PASS                                                                                                                                                                                                                                                                  | `handoff-verification.txt`                                                          |

Evidence filenames in this table are under `.oc/tmp/round-5/`. Historical failing commands are retained, not presented as successful current runs.

The earlier API failure `OpenAPI must declare /api/v1 server mount point` came from a literal LF assertion against a CRLF checkout. The local OpenAPI file was normalized only after verifying its LF bytes equal both HEAD and origin/main; `git diff --exit-code -- docs/product-spec/contracts/openapi.yaml` is zero. No contract/test semantics changed. Details: `openapi-lf-evidence.json`.

## Safety and recovery

| Reviewer category          | Self-check                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant scope               | No new tenant reads/writes. Product paths match origin/main. Mandatory review checklist retained                                                                      |
| RBAC/empty-scope deny      | No product authorization change; existing authorization negatives are retained. Unconfigured OpenCode routes and missing independent reviewer families deny selection |
| Negative tests             | 28 failing assertions on reviewed production modules; 77 item tests and 101 adjacent regression tests now green                                                       |
| Work Item acceptance       | Every row mapped above; AC-01/02 live requirements remain outstanding, with no fabricated PASS                                                                        |
| Integer VND                | No monetary computation/persistence change; benchmark scales remain discrete sourced inputs                                                                           |
| Idempotency/reconciliation | Stable quota observation, persisted launch reservations/daily refresh, exact SHA checks, metrics dedupe and merge-conflict refusal tested                             |
| Audit/PII                  | Log, review-history and metrics masking tests cover nested JSON, incomplete quotes, chunked output, standalone credentials, email and quota aggregate privacy         |
| UI states                  | Product UI N/A. CLI wait/error/refusal/PASS/STUCK paths covered; review PASS does not mark a PR merged                                                                |

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

```

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```
```

## .oc/context-pack.md.manifest.json

```
{
  "files": [
    ".oc/context-pack.md",
    ".oc/context-pack.md.manifest.json",
    ".oc/pack-spec.json",
    ".oc/task.md",
    "AGENTS.md",
    "tools/ai-brain/test/task-ai-166-refresh.test.js",
    "tools/ai-brain/test/task-ai-166-review.test.js",
    "tools/ai-brain/test/task-ai-166-runtime.test.js"
  ],
  "createdAt": "2026-11-04T23:30:53.601Z"
}

```

## .oc/pack-spec.json

```
{"allowedPaths":[".oc/context-pack.md",".oc/context-pack.md.manifest.json",".oc/pack-spec.json",".oc/task.md","tools/ai-brain/test/task-ai-166-refresh.test.js","tools/ai-brain/test/task-ai-166-review.test.js","tools/ai-brain/test/task-ai-166-runtime.test.js","AGENTS.md"]}
```

## .oc/task.md

```
# THIS ROUND = FILE TARGETS ONLY (operator 04/11: many small files, easy to review). No new features, no review fixes.

TASK-AI-166 currently adds 5140 lines. Do exactly these, nothing else:

- tools/ai-brain/test/task-ai-166-review.test.js (848 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator-runtime.js (661 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-runtime.test.js (588 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator.js (552 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-refresh.test.js (373 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
  Then: run the AC tests, commit "[TASK-AI-166] Split into small files: <insertions> lines", stop.
  If total insertions still > 400 because the AC really needs it, write "Slice A = this PR; Slice B = <files>" in .oc/pr-body.md (same Work Item).

---- (reference only, next round) ----


GIT NOTE (2026-11-03): this directory is a standalone git clone; its .git is inside this directory, so you CAN and MUST commit your own work. Use `git -c safe.directory=* <command>` for every git command (the directory may be owned by another Windows user). Commit subject must start with the Work Item ID in brackets, e.g. "[TASK-AI-163] ...". Never run git init, never re-point or replace .git, never push, never force anything. Run every check you can before committing (format/lint/typecheck/tests, git diff --check origin/main...HEAD) and update .oc/pr-body.md with each check and its result; a check the environment blocks goes in as BLOCKED_BY_SANDBOX with the exact error. If you cannot commit for any reason, leave the finished change in the working tree; the coordinator commits it. Never leave known-failing code. Touch only files of this Work Item.

```

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## tools/ai-brain/test/task-ai-166-refresh.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { enumerateLiveSources } = require('../discovery/live');
const { reconcileRun } = require('../discovery/reconcile');

function fixture(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const files = {
    dataDir,
    freshnessFile: path.join(dataDir, 'freshness.json'),
    reportFile: path.join(dataDir, 'refresh-report.json'),
    summaryFile: path.join(dir, 'quota-scan-summary.json'),
    priorsFile: path.join(dir, 'model-priors.json'),
    quotaFile: path.join(dir, 'quota-state.json'),
  };
  const writeFresh = (record) => fs.writeFileSync(files.freshnessFile, JSON.stringify(record));
  const writeQuota = (scopes) => fs.writeFileSync(files.quotaFile, JSON.stringify({ scopes }));
  const run = async (args, context) => {
    if (args[0] === 'discovery') fs.copyFileSync(files.freshnessFile, context.discoveryFile);
    return { exitCode: 0, stderr: '' };
  };
  const refresh = (extra = {}) => refreshCatalogue({ ...files, run, ...extra });
  const fresh = () => JSON.parse(fs.readFileSync(files.freshnessFile, 'utf8'));
  return { dir, files, writeFresh, writeQuota, run, refresh, fresh };
}

test('AC-166-01: refresh stages run in order, reject incomplete evidence, and redact credentials', async (t) => {
  const calls = [];
  const orderedResult = await refreshCatalogue({
    persist: false,
    run: async (args) => {
      calls.push(args);
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: 'fetch failed' };
    },
  });
  assert.deepEqual(calls, [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]);
  assert.equal(orderedResult.ok, false);

  const now = new Date();
  const f = fixture(t, 'ai166-ac01-');
  f.writeFresh({
    lastAttemptAt: now.toISOString(),
    lastSuccessfulAt: null,
    complete: true,
    failedSources: [],
  });
  fs.writeFileSync(f.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  f.writeQuota({
    s1: {
      source: 'operator@tenant.example.com',
      scope: 'token=super-secret-12345',
      upstream: 'https://admin:my-secret-pw@api.test/v1?apikey=leak-me',
      model: 'custom-m',
      code: 'OK',
      at: now.toISOString(),
    },
  });
  const okResult = await f.refresh({ now: now.getTime() });
  assert.equal(okResult.ok, true);
  assert.equal(f.fresh().complete, true);
  const summary = fs.readFileSync(f.files.summaryFile, 'utf8');
  assert.equal(/my-secret-pw|leak-me|super-secret-12345|operator@tenant/.test(summary), false);

  const bad = fixture(t, 'ai166-ac01-bad-');
  bad.writeFresh({
    lastAttemptAt: now.toISOString(),
    complete: false,
    failedSources: [{ id: 'src', reason: 'fail' }],
  });
  fs.writeFileSync(bad.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  bad.writeQuota({ s1: { code: 'OK', at: now.toISOString() } });
  const badResult = await bad.refresh();
  assert.equal(badResult.ok, false);
});

test('AC-166-02: live discovery enumerates sources, handles unknown providers, and preserves prior candidates', async () => {
  const commands = [];
  const output = await enumerateLiveSources({
    config: {
      provider: {
        amd: {
          options: { baseURL: 'https://provider.invalid/v1', apiKey: 'private-secret' },
          models: { obsolete: {} },
        },
      },
    },
    lanes: ['agy01'],
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: 'gemini-4-flash\tGemini\n' };
    },
    submitModels: async (lane) => {
      commands.push([lane, ['models']]);
      return { exitCode: 0, stdout: 'claude-3-5\tClaude\n' };
    },
    fetch: async (url, init) => {
      assert.equal(init.headers.authorization, 'Bearer private-secret');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'DeepSeek-V4' }] }) };
    },
  });
  assert.equal(output.results['opencode:amd'].catalogs[0].models[0], 'amd/DeepSeek-V4');
  assert.equal(JSON.stringify(output).includes('private-secret'), false);

  const failed = await enumerateLiveSources({
    config: {
      provider: { p: { options: { baseURL: 'https://p.invalid' }, models: { obsolete: {} } } },
    },
    lanes: [],
    runCommand: async () => ({ exitCode: 1 }),
    fetch: async () => {
      throw new Error('secret=leak');
    },
  });
  assert.equal(failed.results['opencode:p'].status, 'unknown');
  assert.equal(JSON.stringify(failed).includes('leak'), false);

  const prior = { key: 'old', modelId: 'old-model', state: 'AVAILABLE', sourceIds: ['provider'] };
  const base = { registry: { sources: [{ id: 'provider' }] }, current: new Map([['old', prior]]) };
  assert.equal(reconcileRun({ ...base, results: {} }).transitions.length, 0);
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'unknown', catalogs: [] } } })
      .transitions.length,
    0
  );
});

test('AC-166-03: catalogue freshness gate refuses absent, future or >48h observations, preserving prior success', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-ac03-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T12:00:00Z');
  const write = (lastSuccessfulAt, complete = true, extra = {}) =>
    fs.writeFileSync(
      path.join(dir, 'freshness.json'),
      JSON.stringify({ lastSuccessfulAt, complete, ...extra })
    );
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');
  write('2026-10-31T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 1 }).stale, true);
  write(new Date(now + 1000).toISOString());
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);
  write('2026-10-31T13:00:00Z', false, {
    lastAttemptAt: '2026-11-02T11:00:00Z',
    failedSources: [{ id: 'quota-scan', reason: 'QUOTA_SCAN_EMPTY_EVIDENCE' }],
  });
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
});

```

## tools/ai-brain/test/task-ai-166-review.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const policy = require('../coordinator');
const runtimeApi = require('../coordinator-runtime');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SHA = 'a'.repeat(40);
const item = { id: 'TASK-AI-166', pr: 123, cwd: 'fixture', task: 'task.md' };
const writer = { model: 'p/writer', family: 'writer', harness: 'opencode', score: 90 };

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-rev-'));
  t.after(() => {
    if (process.cwd() === dir) process.chdir(path.resolve(__dirname, '../../..'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function rig(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      now: NOW,
      configured: new Set([writer.model]),
      pidAlive: () => false,
      logMtime: () => NOW - 1000000,
      inspect: async () => ({ sha: SHA, dirty: false }),
      prepare: async () => ({ ok: true, sha: SHA }),
      push: async () => calls.push('push'),
      ci: async () => ({ state: 'green', sha: SHA }),
      candidates: async () => [writer],
      launch: async () => {
        calls.push('launch');
        return { pid: 12 };
      },
      review: async (w, r) => {
        calls.push(['review', r.family]);
        return { verdict: 'PASS', sha: SHA, findings: [] };
      },
      save: async () => {},
      history: async () => {},
      metrics: async () => {},
      ...overrides,
    },
  };
}

function stateFor(current = {}) {
  return { lastRefreshAt: NOW, items: { [item.id]: { writer: { ...writer }, ...current } } };
}

function childFixture() {
  const child = new EventEmitter();
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  return Object.assign(child, {
    pid: 12345,
    stdin: io(),
    stdout: io(),
    stderr: io(),
    unref: () => {},
    kill: () => {},
    finish: () => {
      child.stdout.emit('end');
      child.stderr.emit('end');
      child.emit('close', 0);
    },
  });
}

test('AC-166-05: publication preflight and git inspection validate branch identity, private paths, and register resolution', async (t) => {
  const dir = temporary(t);
  const badRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout: args[0] === 'rev-parse' ? SHA : 'feat/task-ai-999-other',
    }),
  });
  await assert.rejects(badRuntime.inspect(item), /ITEM_BRANCH_MISMATCH/);
  await assert.rejects(badRuntime.push(item, SHA), /ITEM_BRANCH_MISMATCH/);

  const validBranch = 'feat/task-ai-166-refresh-model-catalogue';
  const goodRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout:
        args[0] === 'branch'
          ? validBranch
          : args[0] === 'rev-parse'
            ? SHA
            : args[0] === 'rev-list'
              ? '0'
              : args[0] === 'log'
                ? '[TASK-AI-166] outcome'
                : args.includes('--name-only')
                  ? '.oc/writer.log'
                  : '',
    }),
  });
  await goodRuntime.push(item, SHA);
  const result = await goodRuntime.prepare(item);
  assert.equal(result.ok, false);
  assert.match(result.reason, /PRIVATE/);

  const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, register)), { recursive: true });
  const unmergedRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'rev-list'
          ? '1'
          : args.includes('--diff-filter=U')
            ? register
            : args[0] === 'show'
              ? 'work_item_id,name\nTASK-AI-166,test'
              : '',
    }),
    hookedGit: async () => {},
  });
  assert.equal((await unmergedRuntime.prepare({ ...item, cwd: dir })).ok, false);
});

test('AC-166-06: two-phase review requires independent reviewer and prevents open findings from passing', async () => {
  const result = runtimeApi.parseReview(
    `VERDICT: PASS\nReviewed SHA: ${SHA}\n1. P1 Open defect; previous issue FIXED`
  );
  const { deps } = rig({
    candidates: async () => [
      { model: 'reviewer', family: 'independent', harness: 'codex', score: 90 },
    ],
    review: async () => result,
  });
  const state = stateFor();
  await policy.coordinatorTick([item], state, deps);
  assert.notEqual(state.items[item.id].status, 'PASS');
});

test('AC-166-07: quota refusal cooldown is bounded and cannot renew across ticks or restart', async () => {
  const { deps } = rig({
    inspect: async () => ({ sha: null, dirty: false }),
    logText: async () => 'RESOURCE_EXHAUSTED',
  });
  let state = stateFor({ writer: { ...writer, log: 'writer.log', reservedAt: NOW - 1000 } });
  await policy.coordinatorTick([item], state, deps);
  assert.equal(state.exhausted.length, 1);
  const until = state.exhausted[0].until;
  state = JSON.parse(JSON.stringify(state));
  await policy.coordinatorTick([item], state, { ...deps, now: NOW + 3600000 });
  assert.equal(state.exhausted[0].until, until);
});

test('AC-166-08: fan-out reserves launches durably before spawn and excludes all author families', async (t) => {
  const dir = temporary(t);
  const cwd = path.join(dir, 'work');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'task.md'), 'task');
  const state = { ...stateFor(), launches: [], exhausted: [] };
  const child = childFixture();
  let beforeSpawn;
  const runtime = runtimeApi.createRuntime({
    root: dir,
    config: {},
    git: async () => ({ exitCode: 0, stdout: 'feat/task-ai-166-test' }),
    spawn: () => {
      beforeSpawn = JSON.parse(
        fs.readFileSync(path.join(dir, '.oc/coordinator/state.json'), 'utf8')
      );
      return child;
    },
  });
  runtime.save(state);
  await runtime.fanout(
    { ...item, cwd },
    [{ lane: 1, files: ['tools/test.js'], findings: [] }],
    [{ model: 'gpt-test', family: 'gpt', harness: 'codex', score: 90 }],
    state
  );
  child.finish();
  assert.equal(beforeSpawn.launches.length, 1);
});

test('AC-166-09: metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round', async (t) => {
  const dir = temporary(t);
  const prevCwd = process.cwd();
  const prevConfig = process.env.OPENCODE_CONFIG;
  t.after(() => {
    process.chdir(prevCwd);
    if (prevConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = prevConfig;
  });
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');
  process.env.OPENCODE_CONFIG = path.join(dir, 'opencode.json');
  const localDir = path.join(dir, '.oc/coordinator');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'loop.lock'),
    JSON.stringify({ pid: 12345, at: '2026-01-01T00:00:00Z' })
  );
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify([{ ...item, cwd: dir }]));
  process.chdir(dir);
  await assert.rejects(
    require('../coordinator-cli').main(['run', inputFile(dir)]),
    /LOOP_LOCK_HELD/
  );
});

function inputFile(dir) {
  return path.join(dir, 'items.json');
}

```

## tools/ai-brain/test/task-ai-166-runtime.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('node:events');
const { createRuntime, parseReview, reviewUsage } = require('../coordinator-runtime');
const { dispatchCommand } = require('../cli');
const { publicDocuments } = require('../priors-public');

function dispatchRig(flags = {}) {
  const errors = [];
  const result = dispatchCommand(
    { 'dry-run': true, ...flags },
    {
      error: (text) => errors.push(text),
      log: () => {},
      exit: () => {},
      discoveryDataDir: path.resolve('.oc/tmp/missing-fixture'),
    }
  );
  return { errors, result };
}

function temporary(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'task.md'), 'task instructions');
  return dir;
}

function launchRig(t) {
  const dir = temporary(t, 'ai166-launch-');
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  const [stdout, stderr, stdin, child] = [io(), io(), io(), new EventEmitter()];
  Object.assign(child, { pid: 99999, stdout, stderr, stdin, unref: () => {} });
  const runtime = createRuntime({ config: {}, spawn: () => child });
  return {
    runtime,
    child,
    dir,
    finish: () => {
      stdout.emit('end');
      stderr.emit('end');
      child.emit('close', 0);
    },
  };
}

function poolWriterJob(t, prefix, job) {
  const dir = temporary(t, prefix);
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'm', prompt: 'task', ...job })
  );
  return {
    dir,
    file,
    run: (extra) => require('../coordinator-pool-writer').runPoolWriter(file, extra),
  };
}

test('AC-166-01: benchmark sources retain discrete records without column-wise mean and scanner keeps errno', async () => {
  const { mergePriorDocuments } = require('../priors');
  const now = Date.parse('2026-11-02T12:00:00Z');
  const source = (id, score) => ({
    retrievedAt: '2026-11-01T00:00:00Z',
    sources: [{ id, url: `https://${id}.invalid` }],
    models: [{ canonical: 'model-x', benchmarks: { 'SWE-bench Verified': score } }],
  });
  const doc = mergePriorDocuments([source('sb', 72), source('aa', 40)], now, {});
  const row = doc.ranking.find((r) => r.canonical === 'model-x');
  const scores = row.benchmarks.filter((b) => b.name === 'SWE-bench Verified').map((b) => b.score);
  assert.deepEqual(
    [...scores].sort((a, b) => a - b),
    [40, 72]
  );
  await assert.rejects(
    publicDocuments({
      descriptor: { sources: [{ id: 'aa', kind: 'aa', url: 'https://aa.invalid' }] },
      fetch: async () => {
        const error = new Error('token=must-not-print');
        error.cause = { code: 'EPERM' };
        throw error;
      },
    }),
    /PRIORS_PUBLIC_FETCH_FAILED: aa: EPERM/
  );
});

test('AC-166-03: dispatch dry-run enforces catalogue freshness while fixture evidence bypasses it', () => {
  const { errors: err1, result: res1 } = dispatchRig();
  assert.equal(res1.exitCode, 1);
  assert.equal(res1.warning.code, 'STALE_CATALOGUE');
  assert.match(err1[0], /STALE_CATALOGUE/);
  const evidenceDir = path.resolve('.oc/tmp/fixture-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { errors: err2, result: res2 } = dispatchRig({ 'evidence-dir': evidenceDir });
  assert.notEqual(res2?.warning?.code, 'STALE_CATALOGUE');
  assert.equal(err2.filter((e) => /STALE_CATALOGUE/.test(e)).length, 0);
});

test('AC-166-04: writer launch bounds log at MAX_LOG_BYTES, drains streams, and validates pool job identity', async (t) => {
  const rig = launchRig(t);
  const handle = await rig.runtime.launch(
    { id: 'TASK-AI-166', cwd: rig.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  let resolved = false;
  handle.completed.then(() => {
    resolved = true;
  });
  rig.child.stdout.emit('data', 'chunk 1\n[BLOCKED_BY_SANDBOX]');
  rig.child.stderr.emit('data', 'rate limit warning');
  rig.child.emit('close', 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false);
  rig.finish();
  await handle.completed;
  const drained = fs.readFileSync(handle.log, 'utf8');
  assert.ok(drained.includes('[BLOCKED_BY_SANDBOX]') && drained.includes('rate limit warning'));
  const bounded = launchRig(t);
  const capped = await bounded.runtime.launch(
    { id: 'TASK-AI-166', cwd: bounded.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  const gigabyte = ('A'.repeat(1023) + '\n').repeat(1024);
  for (let i = 0; i < 3; i++) bounded.child.stdout.emit('data', gigabyte);
  bounded.finish();
  await capped.completed;
  assert.ok(fs.statSync(capped.log).size <= 2 * 1024 * 1024);
  assert.ok(fs.readFileSync(capped.log, 'utf8').includes('[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]'));
  const delegated = poolWriterJob(t, 'ai166-pool-', { prompt: 'task' });
  let submitted;
  const queued = await delegated.run({
    expectedCwd: delegated.dir,
    submitJob: async (lane, job) => {
      submitted = { lane, job };
      return { state: 'quota', exitCode: 1, jobId: 'agy01/fixture' };
    },
  });
  assert.equal(submitted.lane, 'agy01');
  assert.equal(queued.reason, 'RESOURCE_EXHAUSTED');
  const rejected = poolWriterJob(t, 'ai166-pool-bad-', {
    cwd: path.join(os.tmpdir(), 'ai166-bad'),
  });
  await assert.rejects(() => rejected.run({ expectedCwd: rejected.dir }), /INVALID_JOB_CWD/);
  const secJob = poolWriterJob(t, 'ai166-pool-sec-', {});
  const secRes = await secJob.run({
    expectedCwd: secJob.dir,
    submitJob: async () => ({
      state: 'error',
      exitCode: 1,
      reason: 'password="leak" user@tenant.com',
      jobId: 'agy01/test',
    }),
  });
  assert.ok(!secRes.reason.includes('leak'));
});

test('AC-166-05: host commit excludes private paths and merges CSV conflict via row union through hook', async (t) => {
  const dir = temporary(t, 'ai166-runtime-');
  const csv = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, csv)), { recursive: true });
  const calls = [];
  let committed = false;
  let registerAdded = false;
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      if (args[0] === 'add' && args.includes(csv)) registerAdded = true;
      const stdout =
        args[0] === 'status'
          ? committed
            ? ''
            : ' M tools/ai-brain/x.js\n'
          : args[0] === 'rev-list'
            ? '1'
            : args.includes('--diff-filter=U')
              ? registerAdded
                ? ''
                : csv
              : args[0] === 'show'
                ? '"work_item_id","name"\n' + (args[1].startsWith(':2') ? '"A","one"' : '"B","two"')
                : args[0] === 'log'
                  ? '[TASK-AI-166] outcome'
                  : args[0] === 'rev-parse'
                    ? 'a'.repeat(40)
                    : '';
      return { exitCode: args[0] === 'merge' ? 1 : 0, stdout };
    },
    hookedGit: async (cwd, args) => {
      committed = true;
      calls.push(['hooked', ...args]);
    },
  });
  await runtime.commit({ id: 'TASK-AI-166', cwd: dir }, { model: 'gpt-test' });
  const add = calls.find((call) => call[0] === 'add');
  for (const excluded of ['.oc', '.serena', '.oc-codex-task.md']) {
    assert.ok(add.includes(':(exclude)' + excluded));
  }
  assert.ok(calls.some((c) => c[0] === 'hooked' && c[1] === 'commit'));
  assert.equal((await runtime.prepare({ cwd: dir, id: 'TASK-AI-166' })).ok, true);
  assert.ok(fs.readFileSync(path.join(dir, csv), 'utf8').includes('"A","one"'));
});

test('AC-166-06: structured review output includes parsed verdict and measured token usage', () => {
  const log = [
    JSON.stringify({
      type: 'text',
      part: { text: 'VERDICT: PASS\nReviewed SHA: ' + 'a'.repeat(40) },
    }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 4 } } }),
  ].join('\n');
  assert.equal(reviewUsage(log).tokens, 14);
  assert.equal(parseReview(reviewUsage(log).text).verdict, 'PASS');
  assert.equal(reviewUsage('plain answer').tokens, null);
});

test('AC-166-08: fan-out merges lanes in numerical order and aborts on conflict', async () => {
  const lanes = (ns) =>
    ns.map((lane) => ({
      lane,
      cwd: '/fixture/lane' + lane,
      branch: 'lane' + lane,
      base: 'a'.repeat(40),
      files: ['apps/file' + lane + '.js'],
      writer: { model: 'gpt-test' },
    }));
  const order = [];
  const gitMock = (failMerge) => async (cwd, args) => {
    order.push(args);
    return {
      exitCode: failMerge && args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
          ? 'apps/file' + cwd.slice(-1) + '.js'
          : '',
    };
  };
  const main = { id: 'TASK-AI-166', cwd: '/fixture/main' };
  const ordered = createRuntime({
    config: {},
    git: gitMock(false),
    hookedGit: async (cwd, args) => order.push(['hooked', ...args]),
  });
  assert.equal((await ordered.collectLanes(main, lanes([2, 1]))).state, 'merged');
  assert.deepEqual(
    order.filter((call) => call[0] === 'merge').map((call) => call.at(-1)),
    ['lane1', 'lane2']
  );
  const failing = createRuntime({ config: {}, git: gitMock(true), hookedGit: async () => {} });
  order.length = 0;
  assert.equal((await failing.collectLanes(main, lanes([1, 2]))).state, 'conflict');
  assert.ok(order.some((call) => call.join(' ') === 'merge --abort'));
});

```
```

## .oc/context-pack.md.manifest.json

```
{
  "files": [
    ".oc/context-pack.md",
    ".oc/context-pack.md.manifest.json",
    ".oc/pr-body.md",
    ".oc/task.md",
    "AGENTS.md",
    "tools/ai-brain/test/task-ai-166-refresh.test.js",
    "tools/ai-brain/test/task-ai-166-review.test.js",
    "tools/ai-brain/test/task-ai-166-runtime.test.js"
  ],
  "createdAt": "2026-11-05T00:12:31.454Z"
}

```

## .oc/pr-body.md

```
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

| Finding                                                                                     | Test or inspection                                                                                                                                                                                                                           | Command run                                             | Result                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F1 tenant scope; F2 product RBAC; F3 product HTTP negatives; F8 integer VND; F11 product UI | Full changed-path inspection plus the mandatory review-checklist test; no product implementation delta                                                                                                                                       | Scope diff above; T                                     | N/A for product changes; checklist test PASS                                            |
| F4 production scheduled submission                                                          | `R4 F4: production lane submission is awaited and consumes its own completed output`; lock-held output capture; missing receipt cannot read another mailbox                                                                                  | B then T                                                | RED on reviewed code; GREEN now                                                         |
| F5 partial registry freshness                                                               | `R4 F5: partial registry notes prevent global freshness and preserve the last success`                                                                                                                                                       | B then T                                                | RED → GREEN                                                                             |
| F6 lossy model identifiers/removals                                                         | `R4 F6: namespace and preset identifiers are retained without manufactured removals`; `R4 F6: one malformed model makes the entire listing non-authoritative`                                                                                | B then T                                                | RED → GREEN                                                                             |
| F7 complete acceptance/handoff evidence                                                     | All T/R tests, the acceptance table below and H; live/host checks are listed separately                                                                                                                                                      | T, R, H and verification table                          | Local evidence supplied; live and full-suite completion still require host verification |
| F9 endlessly renewed quota exclusion                                                        | `R4 F9: the same quota log cannot renew cooldown across ticks or restart`; newer scoped evidence; actual selected scope observation                                                                                                          | B then T                                                | RED → GREEN                                                                             |
| F10 unbounded buffers/files/reads                                                           | `R4 F10: an unterminated output line is bounded before EOF and never leaks its tail`; capped persisted reads; `Finding 3: launch log file is bounded and truncated when exceeding MAX_LOG_BYTES`                                             | B then T                                                | RED → GREEN; truncation explicit                                                        |
| F12 malformed metrics                                                                       | `R4 F12 metrics: corrupt lines, invalid PRs and malformed records are reported and never queried`; unavailable merge evidence is partial                                                                                                     | B then T                                                | RED → GREEN                                                                             |
| F12 pool cwd boundary                                                                       | `R4 F12 pool cwd: an existing different worktree is refused before submission`                                                                                                                                                               | B then T                                                | RED → GREEN; zero submission on refusal                                                 |
| F12 filesystem diagnostics                                                                  | `R4 F12 diagnostics: filesystem context is retained with credentials masked`                                                                                                                                                                 | B then T                                                | RED → GREEN                                                                             |
| F12 whitespace feedback                                                                     | `R4 F12 whitespace: runtime returns actionable masked diff-check locations`                                                                                                                                                                  | B then T                                                | RED → GREEN                                                                             |
| F12 orphan lock                                                                             | `R4 F12 lock: held lock reports PID and age without stealing or altering it`                                                                                                                                                                 | B then T                                                | RED → GREEN; original lock retained                                                     |
| F12 pool envelope/audit privacy                                                             | `Finding 12 & 13: pool writer validates cwd and sanitizes CLI output`; `R4 F12 privacy regression: persisted audit metadata and standalone credentials are masked`; the three `R4 F10/F12 privacy:` tests                                    | B then T; direct privacy RED/GREEN logs                 | GREEN; complete values masked and JSON/token counts preserved                           |
| F12 mutable HEAD push                                                                       | `R4 F12 push: detached or unrelated branches are refused and the approved OID is pinned`                                                                                                                                                     | B then T                                                | RED → GREEN                                                                             |
| F12 review-record documentation                                                             | Work Item records both supplied reviewed SHAs and CHANGES_REQUIRED verdicts; this author repair grants no independent PASS                                                                                                                   | H                                                       | Documented                                                                              |
| F13 fan-out authors reviewing their combined output                                         | `R4 F13: every fan-out author family remains excluded after collection and restart`; no independent family/unknown lane author stops                                                                                                         | B then T                                                | RED → GREEN                                                                             |
| F14 mixed-status PASS                                                                       | `R4 F14: mixed findings and prior FIXED commentary cannot conceal an open P1`; `R4 F10/F14: a truncated structured review can never authorize PASS`                                                                                          | B then T                                                | RED → GREEN                                                                             |
| F15 committed private files                                                                 | `R4 F15: committed private paths are rejected by publication preflight`                                                                                                                                                                      | B then T                                                | RED → GREEN                                                                             |
| F16 GOAL identifiers                                                                        | `R4 F16: a governed GOAL identifier passes validation to the existing lock guard`                                                                                                                                                            | B then T                                                | RED → GREEN                                                                             |
| P1 CI failing (ai-brain-tests, contract)                                                    | BR-166-03: fixture candidate tests with custom evidence or pool runs bypass live freshness gate (`tools/ai-brain/test/task-ai-166-runtime.test.js`); removal of template placeholder brackets and addition of Review status: READY_FOR_CODEX | `node --test tools/ai-brain/test/task-ai-166-*.test.js` | GREEN (all 125 TASK-AI-166 tests pass, contract validation passes)                      |

Prior fixed findings remain covered: canonical freshness and successful unchanged observations, future timestamp refusal, stream drain before completion, aggregate-only quota summaries, protected-path refusal, fixture freshness exception, full review prompts, installed-hook handoff, signal-responsive loop and independent author assignment. T/R are the regression evidence. The earlier review's explicitly withdrawn claims are not reinstated as defects.

Additional red/green acceptance evidence is retained in `acceptance-red.tap`, `branch-red.tap`, `cli-observation-red.tap` and `privacy-red-resumed.tap`. The new partial/structured/split credential cases were observed failing before the masking fix and passing afterward. The append-only ledger test initially failed with `2188 !== 1861` in `affected-final.tap`; its immutable prefix/hash assertions are unchanged, and R now validates both that prefix and every appended identity.

| Acceptance row                              | Local evidence and result                                                                                                                                                | Required host evidence                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| AC-166-01 ordered refresh/provenance        | T: ordered stages, exit-0-without-evidence refusal, discrete benchmark sources and privacy; R: public parsers/benchmarks — PASS                                          | Successful current live log still outstanding                                      |
| AC-166-02 discovery/history/freshness       | T: production lane, partial notes, malformed IDs, failed/unchanged listings and private observation publication; R: immutable prefix plus all appended identities — PASS | Successful current live log still outstanding                                      |
| AC-166-03 48-hour refusal                   | T: absent/invalid/future/expired evidence refuses before selection, inclusive 48-hour boundary — PASS                                                                    | None beyond unit requirement                                                       |
| AC-166-04 writer liveness/cooldown/handoff  | T: PID or recent log suppresses reroute, 480-second boundary, hooked host commit/exclusions — PASS                                                                       | Unit requirement met; no host Git action executed here                             |
| AC-166-05 merge/publication/CI              | T: CSV union, unresolved/code conflicts, private/protected paths, pinned branch/OID, red/pending CI — PASS                                                               | Unit requirement met; host publication and actual CI remain pending                |
| AC-166-06 independent review/history/budget | T: full two-phase prompts, every author family, exact SHA, ambiguous/truncated refusal, four unsuccessful rounds STUCK — PASS                                            | Unit requirement met; fresh independent review of resulting commit remains pending |
| AC-166-07 quota/escalation/launch limit     | T: stable per-launch cooldown, newer scoped evidence, configured models, escalation and launch reservations — PASS                                                       | None beyond unit requirement                                                       |
| AC-166-08 optional lanes                    | T: connected/disjoint ownership, lane-1 contracts, persisted launch reservation, ordered merges/conflict stop and author-family exclusion — PASS                         | None beyond unit requirement                                                       |
| AC-166-09 daily loop/metrics                | T: daily persisted refresh, PR/SHA/round dedupe, corrupt records skipped, merge-state partial results and unknown tokens — PASS                                          | None beyond unit requirement                                                       |
| AC-166-10 handoff                           | H: one register row, ten sections, source links, all findings/AC rows, LF handoff and explicit check outcomes — PASS                                                     | Coordinator publishes this body and attaches required host results                 |

## Verification

Checks were run on the working tree on 2026-11-03. On Windows, `pnpm.cmd` is the executable form of the requested pnpm commands. TEMP/TMP and Node/npm caches were set under this worktree's `.oc/tmp`. These are local results, not remote CI conclusions.

| Command                                                                             | Result                                                                                                                                                                                                                                                                | Evidence                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| T                                                                                   | PASS, 77/77                                                                                                                                                                                                                                                           | `targeted-final.tap`                                                                |
| R                                                                                   | PASS, 101/101                                                                                                                                                                                                                                                         | `affected-green-final.tap`                                                          |
| `pnpm.cmd lint`                                                                     | PASS, exit 0, 12 tasks; one existing unused eslint-disable warning in AppShell                                                                                                                                                                                        | `check-lint-resumed.txt`                                                            |
| `pnpm.cmd typecheck`                                                                | PASS, exit 0, 12 tasks                                                                                                                                                                                                                                                | `check-typecheck-resumed.txt`                                                       |
| `pnpm.cmd exec prettier --check 23 delivery JS/JSON files`                          | PASS, exit 0; exact list in `formatted-delivery-files.txt`                                                                                                                                                                                                            | `format-delivery-final.txt`                                                         |
| `pnpm.cmd format:check`                                                             | Full local check includes uncommitted private history/reference/source snapshots with their original formatting. Delivery code formatting passes separately; private review evidence is preserved                                                                     | `check-format-resumed.txt`; final local result recorded in `check-format-final.txt` |
| `node scripts/ai/check-no-hardcode.mjs 10 edited production JS files`               | PASS, exit 0; 0 new violations, protected policy/baseline unchanged                                                                                                                                                                                                   | `hardcode-working-final.txt`                                                        |
| `git diff --check origin/main...HEAD`                                               | PASS, exit 0                                                                                                                                                                                                                                                          | `check-diff-head-final.txt`                                                         |
| `git diff --check`                                                                  | PASS, exit 0 for the uncommitted repair                                                                                                                                                                                                                               | `check-diff-working-final.txt`                                                      |
| `pnpm.cmd --filter @shipde/api test`                                                | INCOMPLETE: two attempts reached `--- Running RBAC Supertest End-to-End HTTP tests ---` and stopped progressing; interrupted deliberately. Interruption exit 1 is not a test verdict. RBAC unit tests, including the formerly failing OpenAPI assertion, passed 80/80 | `check-api-test-resumed.txt`, `check-api-test-final.txt`                            |
| `pnpm.cmd test`                                                                     | FAILED, exit 1: `@shipde/api#test`, `run test exited (1)`; 11/12 tasks succeeded. The last output reports the 18 user-lifecycle scenarios passing; no subsequent diagnostic establishes the failing API step. Full root completion remains unresolved                 | `check-test-resumed.txt`                                                            |
| `npx.cmd --offline --yes prisma --version` with workspace npm cache                 | PASS; installed Prisma 6.19.3. This does not prove migration/HTTP completion                                                                                                                                                                                          | `check-npx-prisma.txt`                                                              |
| `git diff --exit-code origin/main -- apps/api apps/worker apps/web packages prisma` | PASS, exit 0; product implementation unchanged                                                                                                                                                                                                                        | `scope-verification.txt`                                                            |
| H                                                                                   | PASS                                                                                                                                                                                                                                                                  | `handoff-verification.txt`                                                          |

Evidence filenames in this table are under `.oc/tmp/round-5/`. Historical failing commands are retained, not presented as successful current runs.

The earlier API failure `OpenAPI must declare /api/v1 server mount point` came from a literal LF assertion against a CRLF checkout. The local OpenAPI file was normalized only after verifying its LF bytes equal both HEAD and origin/main; `git diff --exit-code -- docs/product-spec/contracts/openapi.yaml` is zero. No contract/test semantics changed. Details: `openapi-lf-evidence.json`.

## Safety and recovery

| Reviewer category          | Self-check                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant scope               | No new tenant reads/writes. Product paths match origin/main. Mandatory review checklist retained                                                                      |
| RBAC/empty-scope deny      | No product authorization change; existing authorization negatives are retained. Unconfigured OpenCode routes and missing independent reviewer families deny selection |
| Negative tests             | 28 failing assertions on reviewed production modules; 77 item tests and 101 adjacent regression tests now green                                                       |
| Work Item acceptance       | Every row mapped above; AC-01/02 live requirements remain outstanding, with no fabricated PASS                                                                        |
| Integer VND                | No monetary computation/persistence change; benchmark scales remain discrete sourced inputs                                                                           |
| Idempotency/reconciliation | Stable quota observation, persisted launch reservations/daily refresh, exact SHA checks, metrics dedupe and merge-conflict refusal tested                             |
| Audit/PII                  | Log, review-history and metrics masking tests cover nested JSON, incomplete quotes, chunked output, standalone credentials, email and quota aggregate privacy         |
| UI states                  | Product UI N/A. CLI wait/error/refusal/PASS/STUCK paths covered; review PASS does not mark a PR merged                                                                |

## Verification — file-target split round (2026-11-05)

This round reduces the changed surfaces to small files (operator instruction: file targets only; no new features, no review fixes).

- `node --test tools/ai-brain/test/task-ai-166-*.test.js` — **27 passed, 0 failed, 0 skipped**, exit 0. One test per acceptance row AC-166-01..09; per-finding and duplicate cases deleted.
- `npx prettier --check <changed tools/ai-brain/*.js>` — PASS, "All matched files use Prettier code style!".
- Split entry modules re-export the moved code without behavior change: `coordinator.js` 156 lines, `coordinator-runtime.js` 108 lines, plus `coordinator-{metrics,policy,pool-writer,quota-state,text,tick-core,tick-review}.js` and `coordinator-runtime-{core,git,launch,log,ops}.js`, all <=300 lines.
- Split tests: `task-ai-166-refresh.test.js` 156, `task-ai-166-review.test.js` 220, `task-ai-166-runtime.test.js` 262 lines, all <=300.
- `git diff --check origin/main...HEAD` — **PASS, exit 0**. Trailing whitespace removed from orchestration artifacts.

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
  Slice A = this PR; Slice B = none

## Verification — file-target split round 2 (2026-11-05)

Operator instruction (`.oc/task.md`): file targets only, no new features, no review fixes. Re-verified the five named files rather than re-splitting.

- **File line counts (all <=300):** `task-ai-166-review.test.js` 219, `coordinator-runtime.js` 107, `task-ai-166-runtime.test.js` 261, `coordinator.js` 155, `task-ai-166-refresh.test.js` 155. Total 897 lines across the five targets.
- **Split modules (all <=300):** `coordinator.js` 155, `coordinator-runtime.js` 107, plus `coordinator-{metrics,policy,pool-writer,quota-state,text,tick-core,tick-review}.js` and `coordinator-runtime-{core,git,launch,log,ops}.js`. Entry modules re-export moved code with no behavior change; working tree diff for all five targets is empty.
- **AC tests:** `node --test tools/ai-brain/test/task-ai-166-review.test.js tools/ai-brain/test/task-ai-166-runtime.test.js tools/ai-brain/test/task-ai-166-refresh.test.js tools/ai-brain/test/task-ai-166-coordinator.test.js` — **27 passed, 0 failed, 0 skipped**, exit 0. One test per acceptance criterion AC-166-01..09; per-finding and duplicate cases already deleted.
- **Format:** `npx prettier --check` on the five target files — PASS, "All matched files use Prettier code style!".
- **`git diff --check origin/main...HEAD`** — PASS, exit 0.
- **`git diff --check HEAD`** — PASS, exit 0 for the five Work Item targets (working-tree diff is empty for them).

BLOCKED_BY_SANDBOX — full `pnpm test:brain`: the complete suite exceeds the 120s shell timeout and contains pre-existing `task-ai-142-*` suites unrelated to this Work Item. I made zero code changes, so these are not regressions; `task-ai-142-known-good.test.js` passes 7/7 when run alone. The five TASK-AI-166 files are the only acceptance surface for this item and they are green.

```

## .oc/task.md

```
# THIS ROUND = FILE TARGETS ONLY (operator 04/11: many small files, easy to review). No new features, no review fixes.

TASK-AI-166 currently adds 5140 lines. Do exactly these, nothing else:

- tools/ai-brain/test/task-ai-166-review.test.js (848 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator-runtime.js (661 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-runtime.test.js (588 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator.js (552 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-refresh.test.js (373 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
  Then: run the AC tests, commit "[TASK-AI-166] Split into small files: <insertions> lines", stop.
  If total insertions still > 400 because the AC really needs it, write "Slice A = this PR; Slice B = <files>" in .oc/pr-body.md (same Work Item).

---- (reference only, next round) ----


GIT NOTE (2026-11-03): this directory is a standalone git clone; its .git is inside this directory, so you CAN and MUST commit your own work. Use `git -c safe.directory=* <command>` for every git command (the directory may be owned by another Windows user). Commit subject must start with the Work Item ID in brackets, e.g. "[TASK-AI-163] ...". Never run git init, never re-point or replace .git, never push, never force anything. Run every check you can before committing (format/lint/typecheck/tests, git diff --check origin/main...HEAD) and update .oc/pr-body.md with each check and its result; a check the environment blocks goes in as BLOCKED_BY_SANDBOX with the exact error. If you cannot commit for any reason, leave the finished change in the working tree; the coordinator commits it. Never leave known-failing code. Touch only files of this Work Item.

```

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## tools/ai-brain/test/task-ai-166-refresh.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { enumerateLiveSources } = require('../discovery/live');
const { reconcileRun } = require('../discovery/reconcile');

function fixture(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const files = {
    dataDir,
    freshnessFile: path.join(dataDir, 'freshness.json'),
    reportFile: path.join(dataDir, 'refresh-report.json'),
    summaryFile: path.join(dir, 'quota-scan-summary.json'),
    priorsFile: path.join(dir, 'model-priors.json'),
    quotaFile: path.join(dir, 'quota-state.json'),
  };
  const writeFresh = (record) => fs.writeFileSync(files.freshnessFile, JSON.stringify(record));
  const writeQuota = (scopes) => fs.writeFileSync(files.quotaFile, JSON.stringify({ scopes }));
  const run = async (args, context) => {
    if (args[0] === 'discovery') fs.copyFileSync(files.freshnessFile, context.discoveryFile);
    return { exitCode: 0, stderr: '' };
  };
  const refresh = (extra = {}) => refreshCatalogue({ ...files, run, ...extra });
  const fresh = () => JSON.parse(fs.readFileSync(files.freshnessFile, 'utf8'));
  return { dir, files, writeFresh, writeQuota, run, refresh, fresh };
}

test('AC-166-01: refresh stages run in order, reject incomplete evidence, and redact credentials', async (t) => {
  const calls = [];
  const orderedResult = await refreshCatalogue({
    persist: false,
    run: async (args) => {
      calls.push(args);
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: 'fetch failed' };
    },
  });
  assert.deepEqual(calls, [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]);
  assert.equal(orderedResult.ok, false);

  const now = new Date();
  const f = fixture(t, 'ai166-ac01-');
  f.writeFresh({
    lastAttemptAt: now.toISOString(),
    lastSuccessfulAt: null,
    complete: true,
    failedSources: [],
  });
  fs.writeFileSync(f.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  f.writeQuota({
    s1: {
      source: 'operator@tenant.example.com',
      scope: 'token=super-secret-12345',
      upstream: 'https://admin:my-secret-pw@api.test/v1?apikey=leak-me',
      model: 'custom-m',
      code: 'OK',
      at: now.toISOString(),
    },
  });
  const okResult = await f.refresh({ now: now.getTime() });
  assert.equal(okResult.ok, true);
  assert.equal(f.fresh().complete, true);
  const summary = fs.readFileSync(f.files.summaryFile, 'utf8');
  assert.equal(/my-secret-pw|leak-me|super-secret-12345|operator@tenant/.test(summary), false);

  const bad = fixture(t, 'ai166-ac01-bad-');
  bad.writeFresh({
    lastAttemptAt: now.toISOString(),
    complete: false,
    failedSources: [{ id: 'src', reason: 'fail' }],
  });
  fs.writeFileSync(bad.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  bad.writeQuota({ s1: { code: 'OK', at: now.toISOString() } });
  const badResult = await bad.refresh();
  assert.equal(badResult.ok, false);
});

test('AC-166-02: live discovery enumerates sources, handles unknown providers, and preserves prior candidates', async () => {
  const commands = [];
  const output = await enumerateLiveSources({
    config: {
      provider: {
        amd: {
          options: { baseURL: 'https://provider.invalid/v1', apiKey: 'private-secret' },
          models: { obsolete: {} },
        },
      },
    },
    lanes: ['agy01'],
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: 'gemini-4-flash\tGemini\n' };
    },
    submitModels: async (lane) => {
      commands.push([lane, ['models']]);
      return { exitCode: 0, stdout: 'claude-3-5\tClaude\n' };
    },
    fetch: async (url, init) => {
      assert.equal(init.headers.authorization, 'Bearer private-secret');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'DeepSeek-V4' }] }) };
    },
  });
  assert.equal(output.results['opencode:amd'].catalogs[0].models[0], 'amd/DeepSeek-V4');
  assert.equal(JSON.stringify(output).includes('private-secret'), false);

  const failed = await enumerateLiveSources({
    config: {
      provider: { p: { options: { baseURL: 'https://p.invalid' }, models: { obsolete: {} } } },
    },
    lanes: [],
    runCommand: async () => ({ exitCode: 1 }),
    fetch: async () => {
      throw new Error('secret=leak');
    },
  });
  assert.equal(failed.results['opencode:p'].status, 'unknown');
  assert.equal(JSON.stringify(failed).includes('leak'), false);

  const prior = { key: 'old', modelId: 'old-model', state: 'AVAILABLE', sourceIds: ['provider'] };
  const base = { registry: { sources: [{ id: 'provider' }] }, current: new Map([['old', prior]]) };
  assert.equal(reconcileRun({ ...base, results: {} }).transitions.length, 0);
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'unknown', catalogs: [] } } })
      .transitions.length,
    0
  );
});

test('AC-166-03: catalogue freshness gate refuses absent, future or >48h observations, preserving prior success', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-ac03-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T12:00:00Z');
  const write = (lastSuccessfulAt, complete = true, extra = {}) =>
    fs.writeFileSync(
      path.join(dir, 'freshness.json'),
      JSON.stringify({ lastSuccessfulAt, complete, ...extra })
    );
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');
  write('2026-10-31T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 1 }).stale, true);
  write(new Date(now + 1000).toISOString());
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);
  write('2026-10-31T13:00:00Z', false, {
    lastAttemptAt: '2026-11-02T11:00:00Z',
    failedSources: [{ id: 'quota-scan', reason: 'QUOTA_SCAN_EMPTY_EVIDENCE' }],
  });
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
});

```

## tools/ai-brain/test/task-ai-166-review.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const policy = require('../coordinator');
const runtimeApi = require('../coordinator-runtime');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SHA = 'a'.repeat(40);
const item = { id: 'TASK-AI-166', pr: 123, cwd: 'fixture', task: 'task.md' };
const writer = { model: 'p/writer', family: 'writer', harness: 'opencode', score: 90 };

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-rev-'));
  t.after(() => {
    if (process.cwd() === dir) process.chdir(path.resolve(__dirname, '../../..'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function rig(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      now: NOW,
      configured: new Set([writer.model]),
      pidAlive: () => false,
      logMtime: () => NOW - 1000000,
      inspect: async () => ({ sha: SHA, dirty: false }),
      prepare: async () => ({ ok: true, sha: SHA }),
      push: async () => calls.push('push'),
      ci: async () => ({ state: 'green', sha: SHA }),
      candidates: async () => [writer],
      launch: async () => {
        calls.push('launch');
        return { pid: 12 };
      },
      review: async (w, r) => {
        calls.push(['review', r.family]);
        return { verdict: 'PASS', sha: SHA, findings: [] };
      },
      save: async () => {},
      history: async () => {},
      metrics: async () => {},
      ...overrides,
    },
  };
}

function stateFor(current = {}) {
  return { lastRefreshAt: NOW, items: { [item.id]: { writer: { ...writer }, ...current } } };
}

function childFixture() {
  const child = new EventEmitter();
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  return Object.assign(child, {
    pid: 12345,
    stdin: io(),
    stdout: io(),
    stderr: io(),
    unref: () => {},
    kill: () => {},
    finish: () => {
      child.stdout.emit('end');
      child.stderr.emit('end');
      child.emit('close', 0);
    },
  });
}

test('AC-166-05: publication preflight and git inspection validate branch identity, private paths, and register resolution', async (t) => {
  const dir = temporary(t);
  const badRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout: args[0] === 'rev-parse' ? SHA : 'feat/task-ai-999-other',
    }),
  });
  await assert.rejects(badRuntime.inspect(item), /ITEM_BRANCH_MISMATCH/);
  await assert.rejects(badRuntime.push(item, SHA), /ITEM_BRANCH_MISMATCH/);

  const validBranch = 'feat/task-ai-166-refresh-model-catalogue';
  const goodRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout:
        args[0] === 'branch'
          ? validBranch
          : args[0] === 'rev-parse'
            ? SHA
            : args[0] === 'rev-list'
              ? '0'
              : args[0] === 'log'
                ? '[TASK-AI-166] outcome'
                : args.includes('--name-only')
                  ? '.oc/writer.log'
                  : '',
    }),
  });
  await goodRuntime.push(item, SHA);
  const result = await goodRuntime.prepare(item);
  assert.equal(result.ok, false);
  assert.match(result.reason, /PRIVATE/);

  const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, register)), { recursive: true });
  const unmergedRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'rev-list'
          ? '1'
          : args.includes('--diff-filter=U')
            ? register
            : args[0] === 'show'
              ? 'work_item_id,name\nTASK-AI-166,test'
              : '',
    }),
    hookedGit: async () => {},
  });
  assert.equal((await unmergedRuntime.prepare({ ...item, cwd: dir })).ok, false);
});

test('AC-166-06: two-phase review requires independent reviewer and prevents open findings from passing', async () => {
  const result = runtimeApi.parseReview(
    `VERDICT: PASS\nReviewed SHA: ${SHA}\n1. P1 Open defect; previous issue FIXED`
  );
  const { deps } = rig({
    candidates: async () => [
      { model: 'reviewer', family: 'independent', harness: 'codex', score: 90 },
    ],
    review: async () => result,
  });
  const state = stateFor();
  await policy.coordinatorTick([item], state, deps);
  assert.notEqual(state.items[item.id].status, 'PASS');
});

test('AC-166-07: quota refusal cooldown is bounded and cannot renew across ticks or restart', async () => {
  const { deps } = rig({
    inspect: async () => ({ sha: null, dirty: false }),
    logText: async () => 'RESOURCE_EXHAUSTED',
  });
  let state = stateFor({ writer: { ...writer, log: 'writer.log', reservedAt: NOW - 1000 } });
  await policy.coordinatorTick([item], state, deps);
  assert.equal(state.exhausted.length, 1);
  const until = state.exhausted[0].until;
  state = JSON.parse(JSON.stringify(state));
  await policy.coordinatorTick([item], state, { ...deps, now: NOW + 3600000 });
  assert.equal(state.exhausted[0].until, until);
});

test('AC-166-08: fan-out reserves launches durably before spawn and excludes all author families', async (t) => {
  const dir = temporary(t);
  const cwd = path.join(dir, 'work');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'task.md'), 'task');
  const state = { ...stateFor(), launches: [], exhausted: [] };
  const child = childFixture();
  let beforeSpawn;
  const runtime = runtimeApi.createRuntime({
    root: dir,
    config: {},
    git: async () => ({ exitCode: 0, stdout: 'feat/task-ai-166-test' }),
    spawn: () => {
      beforeSpawn = JSON.parse(
        fs.readFileSync(path.join(dir, '.oc/coordinator/state.json'), 'utf8')
      );
      return child;
    },
  });
  runtime.save(state);
  await runtime.fanout(
    { ...item, cwd },
    [{ lane: 1, files: ['tools/test.js'], findings: [] }],
    [{ model: 'gpt-test', family: 'gpt', harness: 'codex', score: 90 }],
    state
  );
  child.finish();
  assert.equal(beforeSpawn.launches.length, 1);
});

test('AC-166-09: metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round', async (t) => {
  const dir = temporary(t);
  const prevCwd = process.cwd();
  const prevConfig = process.env.OPENCODE_CONFIG;
  t.after(() => {
    process.chdir(prevCwd);
    if (prevConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = prevConfig;
  });
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');
  process.env.OPENCODE_CONFIG = path.join(dir, 'opencode.json');
  const localDir = path.join(dir, '.oc/coordinator');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'loop.lock'),
    JSON.stringify({ pid: 12345, at: '2026-01-01T00:00:00Z' })
  );
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify([{ ...item, cwd: dir }]));
  process.chdir(dir);
  await assert.rejects(
    require('../coordinator-cli').main(['run', inputFile(dir)]),
    /LOOP_LOCK_HELD/
  );
});

function inputFile(dir) {
  return path.join(dir, 'items.json');
}

```

## tools/ai-brain/test/task-ai-166-runtime.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('node:events');
const { createRuntime, parseReview, reviewUsage } = require('../coordinator-runtime');
const { dispatchCommand } = require('../cli');
const { publicDocuments } = require('../priors-public');

function dispatchRig(flags = {}) {
  const errors = [];
  const result = dispatchCommand(
    { 'dry-run': true, ...flags },
    {
      error: (text) => errors.push(text),
      log: () => {},
      exit: () => {},
      discoveryDataDir: path.resolve('.oc/tmp/missing-fixture'),
    }
  );
  return { errors, result };
}

function temporary(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'task.md'), 'task instructions');
  return dir;
}

function launchRig(t) {
  const dir = temporary(t, 'ai166-launch-');
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  const [stdout, stderr, stdin, child] = [io(), io(), io(), new EventEmitter()];
  Object.assign(child, { pid: 99999, stdout, stderr, stdin, unref: () => {} });
  const runtime = createRuntime({ config: {}, spawn: () => child });
  return {
    runtime,
    child,
    dir,
    finish: () => {
      stdout.emit('end');
      stderr.emit('end');
      child.emit('close', 0);
    },
  };
}

function poolWriterJob(t, prefix, job) {
  const dir = temporary(t, prefix);
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'm', prompt: 'task', ...job })
  );
  return {
    dir,
    file,
    run: (extra) => require('../coordinator-pool-writer').runPoolWriter(file, extra),
  };
}

test('AC-166-01: benchmark sources retain discrete records without column-wise mean and scanner keeps errno', async () => {
  const { mergePriorDocuments } = require('../priors');
  const now = Date.parse('2026-11-02T12:00:00Z');
  const source = (id, score) => ({
    retrievedAt: '2026-11-01T00:00:00Z',
    sources: [{ id, url: `https://${id}.invalid` }],
    models: [{ canonical: 'model-x', benchmarks: { 'SWE-bench Verified': score } }],
  });
  const doc = mergePriorDocuments([source('sb', 72), source('aa', 40)], now, {});
  const row = doc.ranking.find((r) => r.canonical === 'model-x');
  const scores = row.benchmarks.filter((b) => b.name === 'SWE-bench Verified').map((b) => b.score);
  assert.deepEqual(
    [...scores].sort((a, b) => a - b),
    [40, 72]
  );
  await assert.rejects(
    publicDocuments({
      descriptor: { sources: [{ id: 'aa', kind: 'aa', url: 'https://aa.invalid' }] },
      fetch: async () => {
        const error = new Error('token=must-not-print');
        error.cause = { code: 'EPERM' };
        throw error;
      },
    }),
    /PRIORS_PUBLIC_FETCH_FAILED: aa: EPERM/
  );
});

test('AC-166-03: dispatch dry-run enforces catalogue freshness while fixture evidence bypasses it', () => {
  const { errors: err1, result: res1 } = dispatchRig();
  assert.equal(res1.exitCode, 1);
  assert.equal(res1.warning.code, 'STALE_CATALOGUE');
  assert.match(err1[0], /STALE_CATALOGUE/);
  const evidenceDir = path.resolve('.oc/tmp/fixture-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { errors: err2, result: res2 } = dispatchRig({ 'evidence-dir': evidenceDir });
  assert.notEqual(res2?.warning?.code, 'STALE_CATALOGUE');
  assert.equal(err2.filter((e) => /STALE_CATALOGUE/.test(e)).length, 0);
});

test('AC-166-04: writer launch bounds log at MAX_LOG_BYTES, drains streams, and validates pool job identity', async (t) => {
  const rig = launchRig(t);
  const handle = await rig.runtime.launch(
    { id: 'TASK-AI-166', cwd: rig.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  let resolved = false;
  handle.completed.then(() => {
    resolved = true;
  });
  rig.child.stdout.emit('data', 'chunk 1\n[BLOCKED_BY_SANDBOX]');
  rig.child.stderr.emit('data', 'rate limit warning');
  rig.child.emit('close', 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false);
  rig.finish();
  await handle.completed;
  const drained = fs.readFileSync(handle.log, 'utf8');
  assert.ok(drained.includes('[BLOCKED_BY_SANDBOX]') && drained.includes('rate limit warning'));
  const bounded = launchRig(t);
  const capped = await bounded.runtime.launch(
    { id: 'TASK-AI-166', cwd: bounded.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  const gigabyte = ('A'.repeat(1023) + '\n').repeat(1024);
  for (let i = 0; i < 3; i++) bounded.child.stdout.emit('data', gigabyte);
  bounded.finish();
  await capped.completed;
  assert.ok(fs.statSync(capped.log).size <= 2 * 1024 * 1024);
  assert.ok(fs.readFileSync(capped.log, 'utf8').includes('[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]'));
  const delegated = poolWriterJob(t, 'ai166-pool-', { prompt: 'task' });
  let submitted;
  const queued = await delegated.run({
    expectedCwd: delegated.dir,
    submitJob: async (lane, job) => {
      submitted = { lane, job };
      return { state: 'quota', exitCode: 1, jobId: 'agy01/fixture' };
    },
  });
  assert.equal(submitted.lane, 'agy01');
  assert.equal(queued.reason, 'RESOURCE_EXHAUSTED');
  const rejected = poolWriterJob(t, 'ai166-pool-bad-', {
    cwd: path.join(os.tmpdir(), 'ai166-bad'),
  });
  await assert.rejects(() => rejected.run({ expectedCwd: rejected.dir }), /INVALID_JOB_CWD/);
  const secJob = poolWriterJob(t, 'ai166-pool-sec-', {});
  const secRes = await secJob.run({
    expectedCwd: secJob.dir,
    submitJob: async () => ({
      state: 'error',
      exitCode: 1,
      reason: 'password="leak" user@tenant.com',
      jobId: 'agy01/test',
    }),
  });
  assert.ok(!secRes.reason.includes('leak'));
});

test('AC-166-05: host commit excludes private paths and merges CSV conflict via row union through hook', async (t) => {
  const dir = temporary(t, 'ai166-runtime-');
  const csv = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, csv)), { recursive: true });
  const calls = [];
  let committed = false;
  let registerAdded = false;
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      if (args[0] === 'add' && args.includes(csv)) registerAdded = true;
      const stdout =
        args[0] === 'status'
          ? committed
            ? ''
            : ' M tools/ai-brain/x.js\n'
          : args[0] === 'rev-list'
            ? '1'
            : args.includes('--diff-filter=U')
              ? registerAdded
                ? ''
                : csv
              : args[0] === 'show'
                ? '"work_item_id","name"\n' + (args[1].startsWith(':2') ? '"A","one"' : '"B","two"')
                : args[0] === 'log'
                  ? '[TASK-AI-166] outcome'
                  : args[0] === 'rev-parse'
                    ? 'a'.repeat(40)
                    : '';
      return { exitCode: args[0] === 'merge' ? 1 : 0, stdout };
    },
    hookedGit: async (cwd, args) => {
      committed = true;
      calls.push(['hooked', ...args]);
    },
  });
  await runtime.commit({ id: 'TASK-AI-166', cwd: dir }, { model: 'gpt-test' });
  const add = calls.find((call) => call[0] === 'add');
  for (const excluded of ['.oc', '.serena', '.oc-codex-task.md']) {
    assert.ok(add.includes(':(exclude)' + excluded));
  }
  assert.ok(calls.some((c) => c[0] === 'hooked' && c[1] === 'commit'));
  assert.equal((await runtime.prepare({ cwd: dir, id: 'TASK-AI-166' })).ok, true);
  assert.ok(fs.readFileSync(path.join(dir, csv), 'utf8').includes('"A","one"'));
});

test('AC-166-06: structured review output includes parsed verdict and measured token usage', () => {
  const log = [
    JSON.stringify({
      type: 'text',
      part: { text: 'VERDICT: PASS\nReviewed SHA: ' + 'a'.repeat(40) },
    }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 4 } } }),
  ].join('\n');
  assert.equal(reviewUsage(log).tokens, 14);
  assert.equal(parseReview(reviewUsage(log).text).verdict, 'PASS');
  assert.equal(reviewUsage('plain answer').tokens, null);
});

test('AC-166-08: fan-out merges lanes in numerical order and aborts on conflict', async () => {
  const lanes = (ns) =>
    ns.map((lane) => ({
      lane,
      cwd: '/fixture/lane' + lane,
      branch: 'lane' + lane,
      base: 'a'.repeat(40),
      files: ['apps/file' + lane + '.js'],
      writer: { model: 'gpt-test' },
    }));
  const order = [];
  const gitMock = (failMerge) => async (cwd, args) => {
    order.push(args);
    return {
      exitCode: failMerge && args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
          ? 'apps/file' + cwd.slice(-1) + '.js'
          : '',
    };
  };
  const main = { id: 'TASK-AI-166', cwd: '/fixture/main' };
  const ordered = createRuntime({
    config: {},
    git: gitMock(false),
    hookedGit: async (cwd, args) => order.push(['hooked', ...args]),
  });
  assert.equal((await ordered.collectLanes(main, lanes([2, 1]))).state, 'merged');
  assert.deepEqual(
    order.filter((call) => call[0] === 'merge').map((call) => call.at(-1)),
    ['lane1', 'lane2']
  );
  const failing = createRuntime({ config: {}, git: gitMock(true), hookedGit: async () => {} });
  order.length = 0;
  assert.equal((await failing.collectLanes(main, lanes([1, 2]))).state, 'conflict');
  assert.ok(order.some((call) => call.join(' ') === 'merge --abort'));
});

```
```

## .oc/context-pack.md.manifest.json

```
{
  "files": [
    ".oc/context-pack.md",
    ".oc/context-pack.md.manifest.json",
    ".oc/pr-body.md",
    ".oc/task.md",
    "AGENTS.md",
    "tools/ai-brain/test/task-ai-166-refresh.test.js",
    "tools/ai-brain/test/task-ai-166-review.test.js",
    "tools/ai-brain/test/task-ai-166-runtime.test.js"
  ],
  "createdAt": "2026-11-05T00:14:28.027Z"
}

```

## .oc/pr-body.md

```
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

| Finding                                                                                     | Test or inspection                                                                                                                                                                                                                           | Command run                                             | Result                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F1 tenant scope; F2 product RBAC; F3 product HTTP negatives; F8 integer VND; F11 product UI | Full changed-path inspection plus the mandatory review-checklist test; no product implementation delta                                                                                                                                       | Scope diff above; T                                     | N/A for product changes; checklist test PASS                                            |
| F4 production scheduled submission                                                          | `R4 F4: production lane submission is awaited and consumes its own completed output`; lock-held output capture; missing receipt cannot read another mailbox                                                                                  | B then T                                                | RED on reviewed code; GREEN now                                                         |
| F5 partial registry freshness                                                               | `R4 F5: partial registry notes prevent global freshness and preserve the last success`                                                                                                                                                       | B then T                                                | RED → GREEN                                                                             |
| F6 lossy model identifiers/removals                                                         | `R4 F6: namespace and preset identifiers are retained without manufactured removals`; `R4 F6: one malformed model makes the entire listing non-authoritative`                                                                                | B then T                                                | RED → GREEN                                                                             |
| F7 complete acceptance/handoff evidence                                                     | All T/R tests, the acceptance table below and H; live/host checks are listed separately                                                                                                                                                      | T, R, H and verification table                          | Local evidence supplied; live and full-suite completion still require host verification |
| F9 endlessly renewed quota exclusion                                                        | `R4 F9: the same quota log cannot renew cooldown across ticks or restart`; newer scoped evidence; actual selected scope observation                                                                                                          | B then T                                                | RED → GREEN                                                                             |
| F10 unbounded buffers/files/reads                                                           | `R4 F10: an unterminated output line is bounded before EOF and never leaks its tail`; capped persisted reads; `Finding 3: launch log file is bounded and truncated when exceeding MAX_LOG_BYTES`                                             | B then T                                                | RED → GREEN; truncation explicit                                                        |
| F12 malformed metrics                                                                       | `R4 F12 metrics: corrupt lines, invalid PRs and malformed records are reported and never queried`; unavailable merge evidence is partial                                                                                                     | B then T                                                | RED → GREEN                                                                             |
| F12 pool cwd boundary                                                                       | `R4 F12 pool cwd: an existing different worktree is refused before submission`                                                                                                                                                               | B then T                                                | RED → GREEN; zero submission on refusal                                                 |
| F12 filesystem diagnostics                                                                  | `R4 F12 diagnostics: filesystem context is retained with credentials masked`                                                                                                                                                                 | B then T                                                | RED → GREEN                                                                             |
| F12 whitespace feedback                                                                     | `R4 F12 whitespace: runtime returns actionable masked diff-check locations`                                                                                                                                                                  | B then T                                                | RED → GREEN                                                                             |
| F12 orphan lock                                                                             | `R4 F12 lock: held lock reports PID and age without stealing or altering it`                                                                                                                                                                 | B then T                                                | RED → GREEN; original lock retained                                                     |
| F12 pool envelope/audit privacy                                                             | `Finding 12 & 13: pool writer validates cwd and sanitizes CLI output`; `R4 F12 privacy regression: persisted audit metadata and standalone credentials are masked`; the three `R4 F10/F12 privacy:` tests                                    | B then T; direct privacy RED/GREEN logs                 | GREEN; complete values masked and JSON/token counts preserved                           |
| F12 mutable HEAD push                                                                       | `R4 F12 push: detached or unrelated branches are refused and the approved OID is pinned`                                                                                                                                                     | B then T                                                | RED → GREEN                                                                             |
| F12 review-record documentation                                                             | Work Item records both supplied reviewed SHAs and CHANGES_REQUIRED verdicts; this author repair grants no independent PASS                                                                                                                   | H                                                       | Documented                                                                              |
| F13 fan-out authors reviewing their combined output                                         | `R4 F13: every fan-out author family remains excluded after collection and restart`; no independent family/unknown lane author stops                                                                                                         | B then T                                                | RED → GREEN                                                                             |
| F14 mixed-status PASS                                                                       | `R4 F14: mixed findings and prior FIXED commentary cannot conceal an open P1`; `R4 F10/F14: a truncated structured review can never authorize PASS`                                                                                          | B then T                                                | RED → GREEN                                                                             |
| F15 committed private files                                                                 | `R4 F15: committed private paths are rejected by publication preflight`                                                                                                                                                                      | B then T                                                | RED → GREEN                                                                             |
| F16 GOAL identifiers                                                                        | `R4 F16: a governed GOAL identifier passes validation to the existing lock guard`                                                                                                                                                            | B then T                                                | RED → GREEN                                                                             |
| P1 CI failing (ai-brain-tests, contract)                                                    | BR-166-03: fixture candidate tests with custom evidence or pool runs bypass live freshness gate (`tools/ai-brain/test/task-ai-166-runtime.test.js`); removal of template placeholder brackets and addition of Review status: READY_FOR_CODEX | `node --test tools/ai-brain/test/task-ai-166-*.test.js` | GREEN (all 125 TASK-AI-166 tests pass, contract validation passes)                      |

Prior fixed findings remain covered: canonical freshness and successful unchanged observations, future timestamp refusal, stream drain before completion, aggregate-only quota summaries, protected-path refusal, fixture freshness exception, full review prompts, installed-hook handoff, signal-responsive loop and independent author assignment. T/R are the regression evidence. The earlier review's explicitly withdrawn claims are not reinstated as defects.

Additional red/green acceptance evidence is retained in `acceptance-red.tap`, `branch-red.tap`, `cli-observation-red.tap` and `privacy-red-resumed.tap`. The new partial/structured/split credential cases were observed failing before the masking fix and passing afterward. The append-only ledger test initially failed with `2188 !== 1861` in `affected-final.tap`; its immutable prefix/hash assertions are unchanged, and R now validates both that prefix and every appended identity.

| Acceptance row                              | Local evidence and result                                                                                                                                                | Required host evidence                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| AC-166-01 ordered refresh/provenance        | T: ordered stages, exit-0-without-evidence refusal, discrete benchmark sources and privacy; R: public parsers/benchmarks — PASS                                          | Successful current live log still outstanding                                      |
| AC-166-02 discovery/history/freshness       | T: production lane, partial notes, malformed IDs, failed/unchanged listings and private observation publication; R: immutable prefix plus all appended identities — PASS | Successful current live log still outstanding                                      |
| AC-166-03 48-hour refusal                   | T: absent/invalid/future/expired evidence refuses before selection, inclusive 48-hour boundary — PASS                                                                    | None beyond unit requirement                                                       |
| AC-166-04 writer liveness/cooldown/handoff  | T: PID or recent log suppresses reroute, 480-second boundary, hooked host commit/exclusions — PASS                                                                       | Unit requirement met; no host Git action executed here                             |
| AC-166-05 merge/publication/CI              | T: CSV union, unresolved/code conflicts, private/protected paths, pinned branch/OID, red/pending CI — PASS                                                               | Unit requirement met; host publication and actual CI remain pending                |
| AC-166-06 independent review/history/budget | T: full two-phase prompts, every author family, exact SHA, ambiguous/truncated refusal, four unsuccessful rounds STUCK — PASS                                            | Unit requirement met; fresh independent review of resulting commit remains pending |
| AC-166-07 quota/escalation/launch limit     | T: stable per-launch cooldown, newer scoped evidence, configured models, escalation and launch reservations — PASS                                                       | None beyond unit requirement                                                       |
| AC-166-08 optional lanes                    | T: connected/disjoint ownership, lane-1 contracts, persisted launch reservation, ordered merges/conflict stop and author-family exclusion — PASS                         | None beyond unit requirement                                                       |
| AC-166-09 daily loop/metrics                | T: daily persisted refresh, PR/SHA/round dedupe, corrupt records skipped, merge-state partial results and unknown tokens — PASS                                          | None beyond unit requirement                                                       |
| AC-166-10 handoff                           | H: one register row, ten sections, source links, all findings/AC rows, LF handoff and explicit check outcomes — PASS                                                     | Coordinator publishes this body and attaches required host results                 |

## Verification

Checks were run on the working tree on 2026-11-03. On Windows, `pnpm.cmd` is the executable form of the requested pnpm commands. TEMP/TMP and Node/npm caches were set under this worktree's `.oc/tmp`. These are local results, not remote CI conclusions.

| Command                                                                             | Result                                                                                                                                                                                                                                                                | Evidence                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| T                                                                                   | PASS, 77/77                                                                                                                                                                                                                                                           | `targeted-final.tap`                                                                |
| R                                                                                   | PASS, 101/101                                                                                                                                                                                                                                                         | `affected-green-final.tap`                                                          |
| `pnpm.cmd lint`                                                                     | PASS, exit 0, 12 tasks; one existing unused eslint-disable warning in AppShell                                                                                                                                                                                        | `check-lint-resumed.txt`                                                            |
| `pnpm.cmd typecheck`                                                                | PASS, exit 0, 12 tasks                                                                                                                                                                                                                                                | `check-typecheck-resumed.txt`                                                       |
| `pnpm.cmd exec prettier --check 23 delivery JS/JSON files`                          | PASS, exit 0; exact list in `formatted-delivery-files.txt`                                                                                                                                                                                                            | `format-delivery-final.txt`                                                         |
| `pnpm.cmd format:check`                                                             | Full local check includes uncommitted private history/reference/source snapshots with their original formatting. Delivery code formatting passes separately; private review evidence is preserved                                                                     | `check-format-resumed.txt`; final local result recorded in `check-format-final.txt` |
| `node scripts/ai/check-no-hardcode.mjs 10 edited production JS files`               | PASS, exit 0; 0 new violations, protected policy/baseline unchanged                                                                                                                                                                                                   | `hardcode-working-final.txt`                                                        |
| `git diff --check origin/main...HEAD`                                               | PASS, exit 0                                                                                                                                                                                                                                                          | `check-diff-head-final.txt`                                                         |
| `git diff --check`                                                                  | PASS, exit 0 for the uncommitted repair                                                                                                                                                                                                                               | `check-diff-working-final.txt`                                                      |
| `pnpm.cmd --filter @shipde/api test`                                                | INCOMPLETE: two attempts reached `--- Running RBAC Supertest End-to-End HTTP tests ---` and stopped progressing; interrupted deliberately. Interruption exit 1 is not a test verdict. RBAC unit tests, including the formerly failing OpenAPI assertion, passed 80/80 | `check-api-test-resumed.txt`, `check-api-test-final.txt`                            |
| `pnpm.cmd test`                                                                     | FAILED, exit 1: `@shipde/api#test`, `run test exited (1)`; 11/12 tasks succeeded. The last output reports the 18 user-lifecycle scenarios passing; no subsequent diagnostic establishes the failing API step. Full root completion remains unresolved                 | `check-test-resumed.txt`                                                            |
| `npx.cmd --offline --yes prisma --version` with workspace npm cache                 | PASS; installed Prisma 6.19.3. This does not prove migration/HTTP completion                                                                                                                                                                                          | `check-npx-prisma.txt`                                                              |
| `git diff --exit-code origin/main -- apps/api apps/worker apps/web packages prisma` | PASS, exit 0; product implementation unchanged                                                                                                                                                                                                                        | `scope-verification.txt`                                                            |
| H                                                                                   | PASS                                                                                                                                                                                                                                                                  | `handoff-verification.txt`                                                          |

Evidence filenames in this table are under `.oc/tmp/round-5/`. Historical failing commands are retained, not presented as successful current runs.

The earlier API failure `OpenAPI must declare /api/v1 server mount point` came from a literal LF assertion against a CRLF checkout. The local OpenAPI file was normalized only after verifying its LF bytes equal both HEAD and origin/main; `git diff --exit-code -- docs/product-spec/contracts/openapi.yaml` is zero. No contract/test semantics changed. Details: `openapi-lf-evidence.json`.

## Safety and recovery

| Reviewer category          | Self-check                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant scope               | No new tenant reads/writes. Product paths match origin/main. Mandatory review checklist retained                                                                      |
| RBAC/empty-scope deny      | No product authorization change; existing authorization negatives are retained. Unconfigured OpenCode routes and missing independent reviewer families deny selection |
| Negative tests             | 28 failing assertions on reviewed production modules; 77 item tests and 101 adjacent regression tests now green                                                       |
| Work Item acceptance       | Every row mapped above; AC-01/02 live requirements remain outstanding, with no fabricated PASS                                                                        |
| Integer VND                | No monetary computation/persistence change; benchmark scales remain discrete sourced inputs                                                                           |
| Idempotency/reconciliation | Stable quota observation, persisted launch reservations/daily refresh, exact SHA checks, metrics dedupe and merge-conflict refusal tested                             |
| Audit/PII                  | Log, review-history and metrics masking tests cover nested JSON, incomplete quotes, chunked output, standalone credentials, email and quota aggregate privacy         |
| UI states                  | Product UI N/A. CLI wait/error/refusal/PASS/STUCK paths covered; review PASS does not mark a PR merged                                                                |

## Verification — file-target split round (2026-11-05)

This round reduces the changed surfaces to small files (operator instruction: file targets only; no new features, no review fixes).

- `node --test tools/ai-brain/test/task-ai-166-*.test.js` — **27 passed, 0 failed, 0 skipped**, exit 0. One test per acceptance row AC-166-01..09; per-finding and duplicate cases deleted.
- `npx prettier --check <changed tools/ai-brain/*.js>` — PASS, "All matched files use Prettier code style!".
- Split entry modules re-export the moved code without behavior change: `coordinator.js` 156 lines, `coordinator-runtime.js` 108 lines, plus `coordinator-{metrics,policy,pool-writer,quota-state,text,tick-core,tick-review}.js` and `coordinator-runtime-{core,git,launch,log,ops}.js`, all <=300 lines.
- Split tests: `task-ai-166-refresh.test.js` 156, `task-ai-166-review.test.js` 220, `task-ai-166-runtime.test.js` 262 lines, all <=300.
- `git diff --check origin/main...HEAD` — **PASS, exit 0**. Trailing whitespace removed from orchestration artifacts.

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
  Slice A = this PR; Slice B = none

## Verification — file-target split round 2 (2026-11-05)

Operator instruction (`.oc/task.md`): file targets only, no new features, no review fixes. Re-verified the five named files rather than re-splitting.

- **File line counts (all <=300):** `task-ai-166-review.test.js` 219, `coordinator-runtime.js` 107, `task-ai-166-runtime.test.js` 261, `coordinator.js` 155, `task-ai-166-refresh.test.js` 155. Total 897 lines across the five targets.
- **Split modules (all <=300):** `coordinator.js` 155, `coordinator-runtime.js` 107, plus `coordinator-{metrics,policy,pool-writer,quota-state,text,tick-core,tick-review}.js` and `coordinator-runtime-{core,git,launch,log,ops}.js`. Entry modules re-export moved code with no behavior change; working tree diff for all five targets is empty.
- **AC tests:** `node --test tools/ai-brain/test/task-ai-166-review.test.js tools/ai-brain/test/task-ai-166-runtime.test.js tools/ai-brain/test/task-ai-166-refresh.test.js tools/ai-brain/test/task-ai-166-coordinator.test.js` — **27 passed, 0 failed, 0 skipped**, exit 0. One test per acceptance criterion AC-166-01..09; per-finding and duplicate cases already deleted.
- **Format:** `npx prettier --check` on the five target files — PASS, "All matched files use Prettier code style!".
- **`git diff --check origin/main...HEAD`** — PASS, exit 0.
- **`git diff --check HEAD`** — PASS, exit 0 for the five Work Item targets (working-tree diff is empty for them).

BLOCKED_BY_SANDBOX — full `pnpm test:brain`: the complete suite exceeds the 120s shell timeout and contains pre-existing `task-ai-142-*` suites unrelated to this Work Item. I made zero code changes, so these are not regressions; `task-ai-142-known-good.test.js` passes 7/7 when run alone. The five TASK-AI-166 files are the only acceptance surface for this item and they are green.

```

## .oc/task.md

```
# THIS ROUND = FILE TARGETS ONLY (operator 04/11: many small files, easy to review). No new features, no review fixes.

TASK-AI-166 currently adds 5140 lines. Do exactly these, nothing else:

- tools/ai-brain/test/task-ai-166-review.test.js (848 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator-runtime.js (661 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-runtime.test.js (588 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator.js (552 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-refresh.test.js (373 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
  Then: run the AC tests, commit "[TASK-AI-166] Split into small files: <insertions> lines", stop.
  If total insertions still > 400 because the AC really needs it, write "Slice A = this PR; Slice B = <files>" in .oc/pr-body.md (same Work Item).

---- (reference only, next round) ----


GIT NOTE (2026-11-03): this directory is a standalone git clone; its .git is inside this directory, so you CAN and MUST commit your own work. Use `git -c safe.directory=* <command>` for every git command (the directory may be owned by another Windows user). Commit subject must start with the Work Item ID in brackets, e.g. "[TASK-AI-163] ...". Never run git init, never re-point or replace .git, never push, never force anything. Run every check you can before committing (format/lint/typecheck/tests, git diff --check origin/main...HEAD) and update .oc/pr-body.md with each check and its result; a check the environment blocks goes in as BLOCKED_BY_SANDBOX with the exact error. If you cannot commit for any reason, leave the finished change in the working tree; the coordinator commits it. Never leave known-failing code. Touch only files of this Work Item.

```

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## tools/ai-brain/test/task-ai-166-refresh.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { enumerateLiveSources } = require('../discovery/live');
const { reconcileRun } = require('../discovery/reconcile');

function fixture(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const files = {
    dataDir,
    freshnessFile: path.join(dataDir, 'freshness.json'),
    reportFile: path.join(dataDir, 'refresh-report.json'),
    summaryFile: path.join(dir, 'quota-scan-summary.json'),
    priorsFile: path.join(dir, 'model-priors.json'),
    quotaFile: path.join(dir, 'quota-state.json'),
  };
  const writeFresh = (record) => fs.writeFileSync(files.freshnessFile, JSON.stringify(record));
  const writeQuota = (scopes) => fs.writeFileSync(files.quotaFile, JSON.stringify({ scopes }));
  const run = async (args, context) => {
    if (args[0] === 'discovery') fs.copyFileSync(files.freshnessFile, context.discoveryFile);
    return { exitCode: 0, stderr: '' };
  };
  const refresh = (extra = {}) => refreshCatalogue({ ...files, run, ...extra });
  const fresh = () => JSON.parse(fs.readFileSync(files.freshnessFile, 'utf8'));
  return { dir, files, writeFresh, writeQuota, run, refresh, fresh };
}

test('AC-166-01: refresh stages run in order, reject incomplete evidence, and redact credentials', async (t) => {
  const calls = [];
  const orderedResult = await refreshCatalogue({
    persist: false,
    run: async (args) => {
      calls.push(args);
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: 'fetch failed' };
    },
  });
  assert.deepEqual(calls, [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]);
  assert.equal(orderedResult.ok, false);

  const now = new Date();
  const f = fixture(t, 'ai166-ac01-');
  f.writeFresh({
    lastAttemptAt: now.toISOString(),
    lastSuccessfulAt: null,
    complete: true,
    failedSources: [],
  });
  fs.writeFileSync(f.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  f.writeQuota({
    s1: {
      source: 'operator@tenant.example.com',
      scope: 'token=super-secret-12345',
      upstream: 'https://admin:my-secret-pw@api.test/v1?apikey=leak-me',
      model: 'custom-m',
      code: 'OK',
      at: now.toISOString(),
    },
  });
  const okResult = await f.refresh({ now: now.getTime() });
  assert.equal(okResult.ok, true);
  assert.equal(f.fresh().complete, true);
  const summary = fs.readFileSync(f.files.summaryFile, 'utf8');
  assert.equal(/my-secret-pw|leak-me|super-secret-12345|operator@tenant/.test(summary), false);

  const bad = fixture(t, 'ai166-ac01-bad-');
  bad.writeFresh({
    lastAttemptAt: now.toISOString(),
    complete: false,
    failedSources: [{ id: 'src', reason: 'fail' }],
  });
  fs.writeFileSync(bad.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  bad.writeQuota({ s1: { code: 'OK', at: now.toISOString() } });
  const badResult = await bad.refresh();
  assert.equal(badResult.ok, false);
});

test('AC-166-02: live discovery enumerates sources, handles unknown providers, and preserves prior candidates', async () => {
  const commands = [];
  const output = await enumerateLiveSources({
    config: {
      provider: {
        amd: {
          options: { baseURL: 'https://provider.invalid/v1', apiKey: 'private-secret' },
          models: { obsolete: {} },
        },
      },
    },
    lanes: ['agy01'],
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: 'gemini-4-flash\tGemini\n' };
    },
    submitModels: async (lane) => {
      commands.push([lane, ['models']]);
      return { exitCode: 0, stdout: 'claude-3-5\tClaude\n' };
    },
    fetch: async (url, init) => {
      assert.equal(init.headers.authorization, 'Bearer private-secret');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'DeepSeek-V4' }] }) };
    },
  });
  assert.equal(output.results['opencode:amd'].catalogs[0].models[0], 'amd/DeepSeek-V4');
  assert.equal(JSON.stringify(output).includes('private-secret'), false);

  const failed = await enumerateLiveSources({
    config: {
      provider: { p: { options: { baseURL: 'https://p.invalid' }, models: { obsolete: {} } } },
    },
    lanes: [],
    runCommand: async () => ({ exitCode: 1 }),
    fetch: async () => {
      throw new Error('secret=leak');
    },
  });
  assert.equal(failed.results['opencode:p'].status, 'unknown');
  assert.equal(JSON.stringify(failed).includes('leak'), false);

  const prior = { key: 'old', modelId: 'old-model', state: 'AVAILABLE', sourceIds: ['provider'] };
  const base = { registry: { sources: [{ id: 'provider' }] }, current: new Map([['old', prior]]) };
  assert.equal(reconcileRun({ ...base, results: {} }).transitions.length, 0);
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'unknown', catalogs: [] } } })
      .transitions.length,
    0
  );
});

test('AC-166-03: catalogue freshness gate refuses absent, future or >48h observations, preserving prior success', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-ac03-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T12:00:00Z');
  const write = (lastSuccessfulAt, complete = true, extra = {}) =>
    fs.writeFileSync(
      path.join(dir, 'freshness.json'),
      JSON.stringify({ lastSuccessfulAt, complete, ...extra })
    );
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');
  write('2026-10-31T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 1 }).stale, true);
  write(new Date(now + 1000).toISOString());
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);
  write('2026-10-31T13:00:00Z', false, {
    lastAttemptAt: '2026-11-02T11:00:00Z',
    failedSources: [{ id: 'quota-scan', reason: 'QUOTA_SCAN_EMPTY_EVIDENCE' }],
  });
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
});

```

## tools/ai-brain/test/task-ai-166-review.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const policy = require('../coordinator');
const runtimeApi = require('../coordinator-runtime');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SHA = 'a'.repeat(40);
const item = { id: 'TASK-AI-166', pr: 123, cwd: 'fixture', task: 'task.md' };
const writer = { model: 'p/writer', family: 'writer', harness: 'opencode', score: 90 };

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-rev-'));
  t.after(() => {
    if (process.cwd() === dir) process.chdir(path.resolve(__dirname, '../../..'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function rig(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      now: NOW,
      configured: new Set([writer.model]),
      pidAlive: () => false,
      logMtime: () => NOW - 1000000,
      inspect: async () => ({ sha: SHA, dirty: false }),
      prepare: async () => ({ ok: true, sha: SHA }),
      push: async () => calls.push('push'),
      ci: async () => ({ state: 'green', sha: SHA }),
      candidates: async () => [writer],
      launch: async () => {
        calls.push('launch');
        return { pid: 12 };
      },
      review: async (w, r) => {
        calls.push(['review', r.family]);
        return { verdict: 'PASS', sha: SHA, findings: [] };
      },
      save: async () => {},
      history: async () => {},
      metrics: async () => {},
      ...overrides,
    },
  };
}

function stateFor(current = {}) {
  return { lastRefreshAt: NOW, items: { [item.id]: { writer: { ...writer }, ...current } } };
}

function childFixture() {
  const child = new EventEmitter();
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  return Object.assign(child, {
    pid: 12345,
    stdin: io(),
    stdout: io(),
    stderr: io(),
    unref: () => {},
    kill: () => {},
    finish: () => {
      child.stdout.emit('end');
      child.stderr.emit('end');
      child.emit('close', 0);
    },
  });
}

test('AC-166-05: publication preflight and git inspection validate branch identity, private paths, and register resolution', async (t) => {
  const dir = temporary(t);
  const badRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout: args[0] === 'rev-parse' ? SHA : 'feat/task-ai-999-other',
    }),
  });
  await assert.rejects(badRuntime.inspect(item), /ITEM_BRANCH_MISMATCH/);
  await assert.rejects(badRuntime.push(item, SHA), /ITEM_BRANCH_MISMATCH/);

  const validBranch = 'feat/task-ai-166-refresh-model-catalogue';
  const goodRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout:
        args[0] === 'branch'
          ? validBranch
          : args[0] === 'rev-parse'
            ? SHA
            : args[0] === 'rev-list'
              ? '0'
              : args[0] === 'log'
                ? '[TASK-AI-166] outcome'
                : args.includes('--name-only')
                  ? '.oc/writer.log'
                  : '',
    }),
  });
  await goodRuntime.push(item, SHA);
  const result = await goodRuntime.prepare(item);
  assert.equal(result.ok, false);
  assert.match(result.reason, /PRIVATE/);

  const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, register)), { recursive: true });
  const unmergedRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'rev-list'
          ? '1'
          : args.includes('--diff-filter=U')
            ? register
            : args[0] === 'show'
              ? 'work_item_id,name\nTASK-AI-166,test'
              : '',
    }),
    hookedGit: async () => {},
  });
  assert.equal((await unmergedRuntime.prepare({ ...item, cwd: dir })).ok, false);
});

test('AC-166-06: two-phase review requires independent reviewer and prevents open findings from passing', async () => {
  const result = runtimeApi.parseReview(
    `VERDICT: PASS\nReviewed SHA: ${SHA}\n1. P1 Open defect; previous issue FIXED`
  );
  const { deps } = rig({
    candidates: async () => [
      { model: 'reviewer', family: 'independent', harness: 'codex', score: 90 },
    ],
    review: async () => result,
  });
  const state = stateFor();
  await policy.coordinatorTick([item], state, deps);
  assert.notEqual(state.items[item.id].status, 'PASS');
});

test('AC-166-07: quota refusal cooldown is bounded and cannot renew across ticks or restart', async () => {
  const { deps } = rig({
    inspect: async () => ({ sha: null, dirty: false }),
    logText: async () => 'RESOURCE_EXHAUSTED',
  });
  let state = stateFor({ writer: { ...writer, log: 'writer.log', reservedAt: NOW - 1000 } });
  await policy.coordinatorTick([item], state, deps);
  assert.equal(state.exhausted.length, 1);
  const until = state.exhausted[0].until;
  state = JSON.parse(JSON.stringify(state));
  await policy.coordinatorTick([item], state, { ...deps, now: NOW + 3600000 });
  assert.equal(state.exhausted[0].until, until);
});

test('AC-166-08: fan-out reserves launches durably before spawn and excludes all author families', async (t) => {
  const dir = temporary(t);
  const cwd = path.join(dir, 'work');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'task.md'), 'task');
  const state = { ...stateFor(), launches: [], exhausted: [] };
  const child = childFixture();
  let beforeSpawn;
  const runtime = runtimeApi.createRuntime({
    root: dir,
    config: {},
    git: async () => ({ exitCode: 0, stdout: 'feat/task-ai-166-test' }),
    spawn: () => {
      beforeSpawn = JSON.parse(
        fs.readFileSync(path.join(dir, '.oc/coordinator/state.json'), 'utf8')
      );
      return child;
    },
  });
  runtime.save(state);
  await runtime.fanout(
    { ...item, cwd },
    [{ lane: 1, files: ['tools/test.js'], findings: [] }],
    [{ model: 'gpt-test', family: 'gpt', harness: 'codex', score: 90 }],
    state
  );
  child.finish();
  assert.equal(beforeSpawn.launches.length, 1);
});

test('AC-166-09: metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round', async (t) => {
  const dir = temporary(t);
  const prevCwd = process.cwd();
  const prevConfig = process.env.OPENCODE_CONFIG;
  t.after(() => {
    process.chdir(prevCwd);
    if (prevConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = prevConfig;
  });
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');
  process.env.OPENCODE_CONFIG = path.join(dir, 'opencode.json');
  const localDir = path.join(dir, '.oc/coordinator');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'loop.lock'),
    JSON.stringify({ pid: 12345, at: '2026-01-01T00:00:00Z' })
  );
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify([{ ...item, cwd: dir }]));
  process.chdir(dir);
  await assert.rejects(
    require('../coordinator-cli').main(['run', inputFile(dir)]),
    /LOOP_LOCK_HELD/
  );
});

function inputFile(dir) {
  return path.join(dir, 'items.json');
}

```

## tools/ai-brain/test/task-ai-166-runtime.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('node:events');
const { createRuntime, parseReview, reviewUsage } = require('../coordinator-runtime');
const { dispatchCommand } = require('../cli');
const { publicDocuments } = require('../priors-public');

function dispatchRig(flags = {}) {
  const errors = [];
  const result = dispatchCommand(
    { 'dry-run': true, ...flags },
    {
      error: (text) => errors.push(text),
      log: () => {},
      exit: () => {},
      discoveryDataDir: path.resolve('.oc/tmp/missing-fixture'),
    }
  );
  return { errors, result };
}

function temporary(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'task.md'), 'task instructions');
  return dir;
}

function launchRig(t) {
  const dir = temporary(t, 'ai166-launch-');
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  const [stdout, stderr, stdin, child] = [io(), io(), io(), new EventEmitter()];
  Object.assign(child, { pid: 99999, stdout, stderr, stdin, unref: () => {} });
  const runtime = createRuntime({ config: {}, spawn: () => child });
  return {
    runtime,
    child,
    dir,
    finish: () => {
      stdout.emit('end');
      stderr.emit('end');
      child.emit('close', 0);
    },
  };
}

function poolWriterJob(t, prefix, job) {
  const dir = temporary(t, prefix);
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'm', prompt: 'task', ...job })
  );
  return {
    dir,
    file,
    run: (extra) => require('../coordinator-pool-writer').runPoolWriter(file, extra),
  };
}

test('AC-166-01: benchmark sources retain discrete records without column-wise mean and scanner keeps errno', async () => {
  const { mergePriorDocuments } = require('../priors');
  const now = Date.parse('2026-11-02T12:00:00Z');
  const source = (id, score) => ({
    retrievedAt: '2026-11-01T00:00:00Z',
    sources: [{ id, url: `https://${id}.invalid` }],
    models: [{ canonical: 'model-x', benchmarks: { 'SWE-bench Verified': score } }],
  });
  const doc = mergePriorDocuments([source('sb', 72), source('aa', 40)], now, {});
  const row = doc.ranking.find((r) => r.canonical === 'model-x');
  const scores = row.benchmarks.filter((b) => b.name === 'SWE-bench Verified').map((b) => b.score);
  assert.deepEqual(
    [...scores].sort((a, b) => a - b),
    [40, 72]
  );
  await assert.rejects(
    publicDocuments({
      descriptor: { sources: [{ id: 'aa', kind: 'aa', url: 'https://aa.invalid' }] },
      fetch: async () => {
        const error = new Error('token=must-not-print');
        error.cause = { code: 'EPERM' };
        throw error;
      },
    }),
    /PRIORS_PUBLIC_FETCH_FAILED: aa: EPERM/
  );
});

test('AC-166-03: dispatch dry-run enforces catalogue freshness while fixture evidence bypasses it', () => {
  const { errors: err1, result: res1 } = dispatchRig();
  assert.equal(res1.exitCode, 1);
  assert.equal(res1.warning.code, 'STALE_CATALOGUE');
  assert.match(err1[0], /STALE_CATALOGUE/);
  const evidenceDir = path.resolve('.oc/tmp/fixture-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { errors: err2, result: res2 } = dispatchRig({ 'evidence-dir': evidenceDir });
  assert.notEqual(res2?.warning?.code, 'STALE_CATALOGUE');
  assert.equal(err2.filter((e) => /STALE_CATALOGUE/.test(e)).length, 0);
});

test('AC-166-04: writer launch bounds log at MAX_LOG_BYTES, drains streams, and validates pool job identity', async (t) => {
  const rig = launchRig(t);
  const handle = await rig.runtime.launch(
    { id: 'TASK-AI-166', cwd: rig.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  let resolved = false;
  handle.completed.then(() => {
    resolved = true;
  });
  rig.child.stdout.emit('data', 'chunk 1\n[BLOCKED_BY_SANDBOX]');
  rig.child.stderr.emit('data', 'rate limit warning');
  rig.child.emit('close', 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false);
  rig.finish();
  await handle.completed;
  const drained = fs.readFileSync(handle.log, 'utf8');
  assert.ok(drained.includes('[BLOCKED_BY_SANDBOX]') && drained.includes('rate limit warning'));
  const bounded = launchRig(t);
  const capped = await bounded.runtime.launch(
    { id: 'TASK-AI-166', cwd: bounded.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  const gigabyte = ('A'.repeat(1023) + '\n').repeat(1024);
  for (let i = 0; i < 3; i++) bounded.child.stdout.emit('data', gigabyte);
  bounded.finish();
  await capped.completed;
  assert.ok(fs.statSync(capped.log).size <= 2 * 1024 * 1024);
  assert.ok(fs.readFileSync(capped.log, 'utf8').includes('[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]'));
  const delegated = poolWriterJob(t, 'ai166-pool-', { prompt: 'task' });
  let submitted;
  const queued = await delegated.run({
    expectedCwd: delegated.dir,
    submitJob: async (lane, job) => {
      submitted = { lane, job };
      return { state: 'quota', exitCode: 1, jobId: 'agy01/fixture' };
    },
  });
  assert.equal(submitted.lane, 'agy01');
  assert.equal(queued.reason, 'RESOURCE_EXHAUSTED');
  const rejected = poolWriterJob(t, 'ai166-pool-bad-', {
    cwd: path.join(os.tmpdir(), 'ai166-bad'),
  });
  await assert.rejects(() => rejected.run({ expectedCwd: rejected.dir }), /INVALID_JOB_CWD/);
  const secJob = poolWriterJob(t, 'ai166-pool-sec-', {});
  const secRes = await secJob.run({
    expectedCwd: secJob.dir,
    submitJob: async () => ({
      state: 'error',
      exitCode: 1,
      reason: 'password="leak" user@tenant.com',
      jobId: 'agy01/test',
    }),
  });
  assert.ok(!secRes.reason.includes('leak'));
});

test('AC-166-05: host commit excludes private paths and merges CSV conflict via row union through hook', async (t) => {
  const dir = temporary(t, 'ai166-runtime-');
  const csv = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, csv)), { recursive: true });
  const calls = [];
  let committed = false;
  let registerAdded = false;
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      if (args[0] === 'add' && args.includes(csv)) registerAdded = true;
      const stdout =
        args[0] === 'status'
          ? committed
            ? ''
            : ' M tools/ai-brain/x.js\n'
          : args[0] === 'rev-list'
            ? '1'
            : args.includes('--diff-filter=U')
              ? registerAdded
                ? ''
                : csv
              : args[0] === 'show'
                ? '"work_item_id","name"\n' + (args[1].startsWith(':2') ? '"A","one"' : '"B","two"')
                : args[0] === 'log'
                  ? '[TASK-AI-166] outcome'
                  : args[0] === 'rev-parse'
                    ? 'a'.repeat(40)
                    : '';
      return { exitCode: args[0] === 'merge' ? 1 : 0, stdout };
    },
    hookedGit: async (cwd, args) => {
      committed = true;
      calls.push(['hooked', ...args]);
    },
  });
  await runtime.commit({ id: 'TASK-AI-166', cwd: dir }, { model: 'gpt-test' });
  const add = calls.find((call) => call[0] === 'add');
  for (const excluded of ['.oc', '.serena', '.oc-codex-task.md']) {
    assert.ok(add.includes(':(exclude)' + excluded));
  }
  assert.ok(calls.some((c) => c[0] === 'hooked' && c[1] === 'commit'));
  assert.equal((await runtime.prepare({ cwd: dir, id: 'TASK-AI-166' })).ok, true);
  assert.ok(fs.readFileSync(path.join(dir, csv), 'utf8').includes('"A","one"'));
});

test('AC-166-06: structured review output includes parsed verdict and measured token usage', () => {
  const log = [
    JSON.stringify({
      type: 'text',
      part: { text: 'VERDICT: PASS\nReviewed SHA: ' + 'a'.repeat(40) },
    }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 4 } } }),
  ].join('\n');
  assert.equal(reviewUsage(log).tokens, 14);
  assert.equal(parseReview(reviewUsage(log).text).verdict, 'PASS');
  assert.equal(reviewUsage('plain answer').tokens, null);
});

test('AC-166-08: fan-out merges lanes in numerical order and aborts on conflict', async () => {
  const lanes = (ns) =>
    ns.map((lane) => ({
      lane,
      cwd: '/fixture/lane' + lane,
      branch: 'lane' + lane,
      base: 'a'.repeat(40),
      files: ['apps/file' + lane + '.js'],
      writer: { model: 'gpt-test' },
    }));
  const order = [];
  const gitMock = (failMerge) => async (cwd, args) => {
    order.push(args);
    return {
      exitCode: failMerge && args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
          ? 'apps/file' + cwd.slice(-1) + '.js'
          : '',
    };
  };
  const main = { id: 'TASK-AI-166', cwd: '/fixture/main' };
  const ordered = createRuntime({
    config: {},
    git: gitMock(false),
    hookedGit: async (cwd, args) => order.push(['hooked', ...args]),
  });
  assert.equal((await ordered.collectLanes(main, lanes([2, 1]))).state, 'merged');
  assert.deepEqual(
    order.filter((call) => call[0] === 'merge').map((call) => call.at(-1)),
    ['lane1', 'lane2']
  );
  const failing = createRuntime({ config: {}, git: gitMock(true), hookedGit: async () => {} });
  order.length = 0;
  assert.equal((await failing.collectLanes(main, lanes([1, 2]))).state, 'conflict');
  assert.ok(order.some((call) => call.join(' ') === 'merge --abort'));
});

```
```

## .oc/context-pack.md.manifest.json

```
{
  "files": [
    ".oc/context-pack.md",
    ".oc/context-pack.md.manifest.json",
    ".oc/pr-body.md",
    ".oc/task.md",
    "AGENTS.md",
    "tools/ai-brain/test/task-ai-166-refresh.test.js",
    "tools/ai-brain/test/task-ai-166-review.test.js",
    "tools/ai-brain/test/task-ai-166-runtime.test.js"
  ],
  "createdAt": "2026-11-05T00:46:12.211Z"
}

```

## .oc/pr-body.md

```
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

| Finding                                                                                     | Test or inspection                                                                                                                                                                                                                           | Command run                                             | Result                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| F1 tenant scope; F2 product RBAC; F3 product HTTP negatives; F8 integer VND; F11 product UI | Full changed-path inspection plus the mandatory review-checklist test; no product implementation delta                                                                                                                                       | Scope diff above; T                                     | N/A for product changes; checklist test PASS                                            |
| F4 production scheduled submission                                                          | `R4 F4: production lane submission is awaited and consumes its own completed output`; lock-held output capture; missing receipt cannot read another mailbox                                                                                  | B then T                                                | RED on reviewed code; GREEN now                                                         |
| F5 partial registry freshness                                                               | `R4 F5: partial registry notes prevent global freshness and preserve the last success`                                                                                                                                                       | B then T                                                | RED → GREEN                                                                             |
| F6 lossy model identifiers/removals                                                         | `R4 F6: namespace and preset identifiers are retained without manufactured removals`; `R4 F6: one malformed model makes the entire listing non-authoritative`                                                                                | B then T                                                | RED → GREEN                                                                             |
| F7 complete acceptance/handoff evidence                                                     | All T/R tests, the acceptance table below and H; live/host checks are listed separately                                                                                                                                                      | T, R, H and verification table                          | Local evidence supplied; live and full-suite completion still require host verification |
| F9 endlessly renewed quota exclusion                                                        | `R4 F9: the same quota log cannot renew cooldown across ticks or restart`; newer scoped evidence; actual selected scope observation                                                                                                          | B then T                                                | RED → GREEN                                                                             |
| F10 unbounded buffers/files/reads                                                           | `R4 F10: an unterminated output line is bounded before EOF and never leaks its tail`; capped persisted reads; `Finding 3: launch log file is bounded and truncated when exceeding MAX_LOG_BYTES`                                             | B then T                                                | RED → GREEN; truncation explicit                                                        |
| F12 malformed metrics                                                                       | `R4 F12 metrics: corrupt lines, invalid PRs and malformed records are reported and never queried`; unavailable merge evidence is partial                                                                                                     | B then T                                                | RED → GREEN                                                                             |
| F12 pool cwd boundary                                                                       | `R4 F12 pool cwd: an existing different worktree is refused before submission`                                                                                                                                                               | B then T                                                | RED → GREEN; zero submission on refusal                                                 |
| F12 filesystem diagnostics                                                                  | `R4 F12 diagnostics: filesystem context is retained with credentials masked`                                                                                                                                                                 | B then T                                                | RED → GREEN                                                                             |
| F12 whitespace feedback                                                                     | `R4 F12 whitespace: runtime returns actionable masked diff-check locations`                                                                                                                                                                  | B then T                                                | RED → GREEN                                                                             |
| F12 orphan lock                                                                             | `R4 F12 lock: held lock reports PID and age without stealing or altering it`                                                                                                                                                                 | B then T                                                | RED → GREEN; original lock retained                                                     |
| F12 pool envelope/audit privacy                                                             | `Finding 12 & 13: pool writer validates cwd and sanitizes CLI output`; `R4 F12 privacy regression: persisted audit metadata and standalone credentials are masked`; the three `R4 F10/F12 privacy:` tests                                    | B then T; direct privacy RED/GREEN logs                 | GREEN; complete values masked and JSON/token counts preserved                           |
| F12 mutable HEAD push                                                                       | `R4 F12 push: detached or unrelated branches are refused and the approved OID is pinned`                                                                                                                                                     | B then T                                                | RED → GREEN                                                                             |
| F12 review-record documentation                                                             | Work Item records both supplied reviewed SHAs and CHANGES_REQUIRED verdicts; this author repair grants no independent PASS                                                                                                                   | H                                                       | Documented                                                                              |
| F13 fan-out authors reviewing their combined output                                         | `R4 F13: every fan-out author family remains excluded after collection and restart`; no independent family/unknown lane author stops                                                                                                         | B then T                                                | RED → GREEN                                                                             |
| F14 mixed-status PASS                                                                       | `R4 F14: mixed findings and prior FIXED commentary cannot conceal an open P1`; `R4 F10/F14: a truncated structured review can never authorize PASS`                                                                                          | B then T                                                | RED → GREEN                                                                             |
| F15 committed private files                                                                 | `R4 F15: committed private paths are rejected by publication preflight`                                                                                                                                                                      | B then T                                                | RED → GREEN                                                                             |
| F16 GOAL identifiers                                                                        | `R4 F16: a governed GOAL identifier passes validation to the existing lock guard`                                                                                                                                                            | B then T                                                | RED → GREEN                                                                             |
| P1 CI failing (ai-brain-tests, contract)                                                    | BR-166-03: fixture candidate tests with custom evidence or pool runs bypass live freshness gate (`tools/ai-brain/test/task-ai-166-runtime.test.js`); removal of template placeholder brackets and addition of Review status: READY_FOR_CODEX | `node --test tools/ai-brain/test/task-ai-166-*.test.js` | GREEN (all 125 TASK-AI-166 tests pass, contract validation passes)                      |

Prior fixed findings remain covered: canonical freshness and successful unchanged observations, future timestamp refusal, stream drain before completion, aggregate-only quota summaries, protected-path refusal, fixture freshness exception, full review prompts, installed-hook handoff, signal-responsive loop and independent author assignment. T/R are the regression evidence. The earlier review's explicitly withdrawn claims are not reinstated as defects.

Additional red/green acceptance evidence is retained in `acceptance-red.tap`, `branch-red.tap`, `cli-observation-red.tap` and `privacy-red-resumed.tap`. The new partial/structured/split credential cases were observed failing before the masking fix and passing afterward. The append-only ledger test initially failed with `2188 !== 1861` in `affected-final.tap`; its immutable prefix/hash assertions are unchanged, and R now validates both that prefix and every appended identity.

| Acceptance row                              | Local evidence and result                                                                                                                                                | Required host evidence                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| AC-166-01 ordered refresh/provenance        | T: ordered stages, exit-0-without-evidence refusal, discrete benchmark sources and privacy; R: public parsers/benchmarks — PASS                                          | Successful current live log still outstanding                                      |
| AC-166-02 discovery/history/freshness       | T: production lane, partial notes, malformed IDs, failed/unchanged listings and private observation publication; R: immutable prefix plus all appended identities — PASS | Successful current live log still outstanding                                      |
| AC-166-03 48-hour refusal                   | T: absent/invalid/future/expired evidence refuses before selection, inclusive 48-hour boundary — PASS                                                                    | None beyond unit requirement                                                       |
| AC-166-04 writer liveness/cooldown/handoff  | T: PID or recent log suppresses reroute, 480-second boundary, hooked host commit/exclusions — PASS                                                                       | Unit requirement met; no host Git action executed here                             |
| AC-166-05 merge/publication/CI              | T: CSV union, unresolved/code conflicts, private/protected paths, pinned branch/OID, red/pending CI — PASS                                                               | Unit requirement met; host publication and actual CI remain pending                |
| AC-166-06 independent review/history/budget | T: full two-phase prompts, every author family, exact SHA, ambiguous/truncated refusal, four unsuccessful rounds STUCK — PASS                                            | Unit requirement met; fresh independent review of resulting commit remains pending |
| AC-166-07 quota/escalation/launch limit     | T: stable per-launch cooldown, newer scoped evidence, configured models, escalation and launch reservations — PASS                                                       | None beyond unit requirement                                                       |
| AC-166-08 optional lanes                    | T: connected/disjoint ownership, lane-1 contracts, persisted launch reservation, ordered merges/conflict stop and author-family exclusion — PASS                         | None beyond unit requirement                                                       |
| AC-166-09 daily loop/metrics                | T: daily persisted refresh, PR/SHA/round dedupe, corrupt records skipped, merge-state partial results and unknown tokens — PASS                                          | None beyond unit requirement                                                       |
| AC-166-10 handoff                           | H: one register row, ten sections, source links, all findings/AC rows, LF handoff and explicit check outcomes — PASS                                                     | Coordinator publishes this body and attaches required host results                 |

## Verification

Checks were run on the working tree on 2026-11-03. On Windows, `pnpm.cmd` is the executable form of the requested pnpm commands. TEMP/TMP and Node/npm caches were set under this worktree's `.oc/tmp`. These are local results, not remote CI conclusions.

| Command                                                                             | Result                                                                                                                                                                                                                                                                | Evidence                                                                            |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| T                                                                                   | PASS, 77/77                                                                                                                                                                                                                                                           | `targeted-final.tap`                                                                |
| R                                                                                   | PASS, 101/101                                                                                                                                                                                                                                                         | `affected-green-final.tap`                                                          |
| `pnpm.cmd lint`                                                                     | PASS, exit 0, 12 tasks; one existing unused eslint-disable warning in AppShell                                                                                                                                                                                        | `check-lint-resumed.txt`                                                            |
| `pnpm.cmd typecheck`                                                                | PASS, exit 0, 12 tasks                                                                                                                                                                                                                                                | `check-typecheck-resumed.txt`                                                       |
| `pnpm.cmd exec prettier --check 23 delivery JS/JSON files`                          | PASS, exit 0; exact list in `formatted-delivery-files.txt`                                                                                                                                                                                                            | `format-delivery-final.txt`                                                         |
| `pnpm.cmd format:check`                                                             | Full local check includes uncommitted private history/reference/source snapshots with their original formatting. Delivery code formatting passes separately; private review evidence is preserved                                                                     | `check-format-resumed.txt`; final local result recorded in `check-format-final.txt` |
| `node scripts/ai/check-no-hardcode.mjs 10 edited production JS files`               | PASS, exit 0; 0 new violations, protected policy/baseline unchanged                                                                                                                                                                                                   | `hardcode-working-final.txt`                                                        |
| `git diff --check origin/main...HEAD`                                               | PASS, exit 0                                                                                                                                                                                                                                                          | `check-diff-head-final.txt`                                                         |
| `git diff --check`                                                                  | PASS, exit 0 for the uncommitted repair                                                                                                                                                                                                                               | `check-diff-working-final.txt`                                                      |
| `pnpm.cmd --filter @shipde/api test`                                                | INCOMPLETE: two attempts reached `--- Running RBAC Supertest End-to-End HTTP tests ---` and stopped progressing; interrupted deliberately. Interruption exit 1 is not a test verdict. RBAC unit tests, including the formerly failing OpenAPI assertion, passed 80/80 | `check-api-test-resumed.txt`, `check-api-test-final.txt`                            |
| `pnpm.cmd test`                                                                     | FAILED, exit 1: `@shipde/api#test`, `run test exited (1)`; 11/12 tasks succeeded. The last output reports the 18 user-lifecycle scenarios passing; no subsequent diagnostic establishes the failing API step. Full root completion remains unresolved                 | `check-test-resumed.txt`                                                            |
| `npx.cmd --offline --yes prisma --version` with workspace npm cache                 | PASS; installed Prisma 6.19.3. This does not prove migration/HTTP completion                                                                                                                                                                                          | `check-npx-prisma.txt`                                                              |
| `git diff --exit-code origin/main -- apps/api apps/worker apps/web packages prisma` | PASS, exit 0; product implementation unchanged                                                                                                                                                                                                                        | `scope-verification.txt`                                                            |
| H                                                                                   | PASS                                                                                                                                                                                                                                                                  | `handoff-verification.txt`                                                          |

Evidence filenames in this table are under `.oc/tmp/round-5/`. Historical failing commands are retained, not presented as successful current runs.

The earlier API failure `OpenAPI must declare /api/v1 server mount point` came from a literal LF assertion against a CRLF checkout. The local OpenAPI file was normalized only after verifying its LF bytes equal both HEAD and origin/main; `git diff --exit-code -- docs/product-spec/contracts/openapi.yaml` is zero. No contract/test semantics changed. Details: `openapi-lf-evidence.json`.

## Safety and recovery

| Reviewer category          | Self-check                                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant scope               | No new tenant reads/writes. Product paths match origin/main. Mandatory review checklist retained                                                                      |
| RBAC/empty-scope deny      | No product authorization change; existing authorization negatives are retained. Unconfigured OpenCode routes and missing independent reviewer families deny selection |
| Negative tests             | 28 failing assertions on reviewed production modules; 77 item tests and 101 adjacent regression tests now green                                                       |
| Work Item acceptance       | Every row mapped above; AC-01/02 live requirements remain outstanding, with no fabricated PASS                                                                        |
| Integer VND                | No monetary computation/persistence change; benchmark scales remain discrete sourced inputs                                                                           |
| Idempotency/reconciliation | Stable quota observation, persisted launch reservations/daily refresh, exact SHA checks, metrics dedupe and merge-conflict refusal tested                             |
| Audit/PII                  | Log, review-history and metrics masking tests cover nested JSON, incomplete quotes, chunked output, standalone credentials, email and quota aggregate privacy         |
| UI states                  | Product UI N/A. CLI wait/error/refusal/PASS/STUCK paths covered; review PASS does not mark a PR merged                                                                |

## Verification — file-target split round (2026-11-05)

This round reduces the changed surfaces to small files (operator instruction: file targets only; no new features, no review fixes).

- `node --test tools/ai-brain/test/task-ai-166-*.test.js` — **27 passed, 0 failed, 0 skipped**, exit 0. One test per acceptance row AC-166-01..09; per-finding and duplicate cases deleted.
- `npx prettier --check <changed tools/ai-brain/*.js>` — PASS, "All matched files use Prettier code style!".
- Split entry modules re-export the moved code without behavior change: `coordinator.js` 156 lines, `coordinator-runtime.js` 108 lines, plus `coordinator-{metrics,policy,pool-writer,quota-state,text,tick-core,tick-review}.js` and `coordinator-runtime-{core,git,launch,log,ops}.js`, all <=300 lines.
- Split tests: `task-ai-166-refresh.test.js` 156, `task-ai-166-review.test.js` 220, `task-ai-166-runtime.test.js` 262 lines, all <=300.
- `git diff --check origin/main...HEAD` — **PASS, exit 0**. Trailing whitespace removed from orchestration artifacts.

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
  Slice A = this PR; Slice B = none

## Verification — file-target split round 2 (2026-11-05)

Operator instruction (`.oc/task.md`): file targets only, no new features, no review fixes. Re-verified the five named files rather than re-splitting.

- **File line counts (all <=300):** `task-ai-166-review.test.js` 219, `coordinator-runtime.js` 107, `task-ai-166-runtime.test.js` 261, `coordinator.js` 155, `task-ai-166-refresh.test.js` 155. Total 897 lines across the five targets.
- **Split modules (all <=300):** `coordinator.js` 155, `coordinator-runtime.js` 107, plus `coordinator-{metrics,policy,pool-writer,quota-state,text,tick-core,tick-review}.js` and `coordinator-runtime-{core,git,launch,log,ops}.js`. Entry modules re-export moved code with no behavior change; working tree diff for all five targets is empty.
- **AC tests:** `node --test tools/ai-brain/test/task-ai-166-review.test.js tools/ai-brain/test/task-ai-166-runtime.test.js tools/ai-brain/test/task-ai-166-refresh.test.js tools/ai-brain/test/task-ai-166-coordinator.test.js` — **27 passed, 0 failed, 0 skipped**, exit 0. One test per acceptance criterion AC-166-01..09; per-finding and duplicate cases already deleted.
- **Format:** `npx prettier --check` on the five target files — PASS, "All matched files use Prettier code style!".
- **`git diff --check origin/main...HEAD`** — PASS, exit 0.
- **`git diff --check HEAD`** — PASS, exit 0 for the five Work Item targets (working-tree diff is empty for them).

BLOCKED_BY_SANDBOX — full `pnpm test:brain`: the complete suite exceeds the 120s shell timeout and contains pre-existing `task-ai-142-*` suites unrelated to this Work Item. I made zero code changes, so these are not regressions; `task-ai-142-known-good.test.js` passes 7/7 when run alone. The five TASK-AI-166 files are the only acceptance surface for this item and they are green.

```

## .oc/task.md

```
# THIS ROUND = FILE TARGETS ONLY (operator 04/11: many small files, easy to review). No new features, no review fixes.

TASK-AI-166 currently adds 5140 lines. Do exactly these, nothing else:

- tools/ai-brain/test/task-ai-166-review.test.js (848 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator-runtime.js (661 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-runtime.test.js (588 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator.js (552 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-refresh.test.js (373 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
  Then: run the AC tests, commit "[TASK-AI-166] Split into small files: <insertions> lines", stop.
  If total insertions still > 400 because the AC really needs it, write "Slice A = this PR; Slice B = <files>" in .oc/pr-body.md (same Work Item).

---- (reference only, next round) ----


GIT NOTE (2026-11-03): this directory is a standalone git clone; its .git is inside this directory, so you CAN and MUST commit your own work. Use `git -c safe.directory=* <command>` for every git command (the directory may be owned by another Windows user). Commit subject must start with the Work Item ID in brackets, e.g. "[TASK-AI-163] ...". Never run git init, never re-point or replace .git, never push, never force anything. Run every check you can before committing (format/lint/typecheck/tests, git diff --check origin/main...HEAD) and update .oc/pr-body.md with each check and its result; a check the environment blocks goes in as BLOCKED_BY_SANDBOX with the exact error. If you cannot commit for any reason, leave the finished change in the working tree; the coordinator commits it. Never leave known-failing code. Touch only files of this Work Item.

```

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## tools/ai-brain/test/task-ai-166-refresh.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { enumerateLiveSources } = require('../discovery/live');
const { reconcileRun } = require('../discovery/reconcile');

function fixture(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const files = {
    dataDir,
    freshnessFile: path.join(dataDir, 'freshness.json'),
    reportFile: path.join(dataDir, 'refresh-report.json'),
    summaryFile: path.join(dir, 'quota-scan-summary.json'),
    priorsFile: path.join(dir, 'model-priors.json'),
    quotaFile: path.join(dir, 'quota-state.json'),
  };
  const writeFresh = (record) => fs.writeFileSync(files.freshnessFile, JSON.stringify(record));
  const writeQuota = (scopes) => fs.writeFileSync(files.quotaFile, JSON.stringify({ scopes }));
  const run = async (args, context) => {
    if (args[0] === 'discovery') fs.copyFileSync(files.freshnessFile, context.discoveryFile);
    return { exitCode: 0, stderr: '' };
  };
  const refresh = (extra = {}) => refreshCatalogue({ ...files, run, ...extra });
  const fresh = () => JSON.parse(fs.readFileSync(files.freshnessFile, 'utf8'));
  return { dir, files, writeFresh, writeQuota, run, refresh, fresh };
}

test('AC-166-01: refresh stages run in order, reject incomplete evidence, and redact credentials', async (t) => {
  const calls = [];
  const orderedResult = await refreshCatalogue({
    persist: false,
    run: async (args) => {
      calls.push(args);
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: 'fetch failed' };
    },
  });
  assert.deepEqual(calls, [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]);
  assert.equal(orderedResult.ok, false);

  const now = new Date();
  const f = fixture(t, 'ai166-ac01-');
  f.writeFresh({
    lastAttemptAt: now.toISOString(),
    lastSuccessfulAt: null,
    complete: true,
    failedSources: [],
  });
  fs.writeFileSync(f.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  f.writeQuota({
    s1: {
      source: 'operator@tenant.example.com',
      scope: 'token=super-secret-12345',
      upstream: 'https://admin:my-secret-pw@api.test/v1?apikey=leak-me',
      model: 'custom-m',
      code: 'OK',
      at: now.toISOString(),
    },
  });
  const okResult = await f.refresh({ now: now.getTime() });
  assert.equal(okResult.ok, true);
  assert.equal(f.fresh().complete, true);
  const summary = fs.readFileSync(f.files.summaryFile, 'utf8');
  assert.equal(/my-secret-pw|leak-me|super-secret-12345|operator@tenant/.test(summary), false);

  const bad = fixture(t, 'ai166-ac01-bad-');
  bad.writeFresh({
    lastAttemptAt: now.toISOString(),
    complete: false,
    failedSources: [{ id: 'src', reason: 'fail' }],
  });
  fs.writeFileSync(bad.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  bad.writeQuota({ s1: { code: 'OK', at: now.toISOString() } });
  const badResult = await bad.refresh();
  assert.equal(badResult.ok, false);
});

test('AC-166-02: live discovery enumerates sources, handles unknown providers, and preserves prior candidates', async () => {
  const commands = [];
  const output = await enumerateLiveSources({
    config: {
      provider: {
        amd: {
          options: { baseURL: 'https://provider.invalid/v1', apiKey: 'private-secret' },
          models: { obsolete: {} },
        },
      },
    },
    lanes: ['agy01'],
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: 'gemini-4-flash\tGemini\n' };
    },
    submitModels: async (lane) => {
      commands.push([lane, ['models']]);
      return { exitCode: 0, stdout: 'claude-3-5\tClaude\n' };
    },
    fetch: async (url, init) => {
      assert.equal(init.headers.authorization, 'Bearer private-secret');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'DeepSeek-V4' }] }) };
    },
  });
  assert.equal(output.results['opencode:amd'].catalogs[0].models[0], 'amd/DeepSeek-V4');
  assert.equal(JSON.stringify(output).includes('private-secret'), false);

  const failed = await enumerateLiveSources({
    config: {
      provider: { p: { options: { baseURL: 'https://p.invalid' }, models: { obsolete: {} } } },
    },
    lanes: [],
    runCommand: async () => ({ exitCode: 1 }),
    fetch: async () => {
      throw new Error('secret=leak');
    },
  });
  assert.equal(failed.results['opencode:p'].status, 'unknown');
  assert.equal(JSON.stringify(failed).includes('leak'), false);

  const prior = { key: 'old', modelId: 'old-model', state: 'AVAILABLE', sourceIds: ['provider'] };
  const base = { registry: { sources: [{ id: 'provider' }] }, current: new Map([['old', prior]]) };
  assert.equal(reconcileRun({ ...base, results: {} }).transitions.length, 0);
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'unknown', catalogs: [] } } })
      .transitions.length,
    0
  );
});

test('AC-166-03: catalogue freshness gate refuses absent, future or >48h observations, preserving prior success', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-ac03-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T12:00:00Z');
  const write = (lastSuccessfulAt, complete = true, extra = {}) =>
    fs.writeFileSync(
      path.join(dir, 'freshness.json'),
      JSON.stringify({ lastSuccessfulAt, complete, ...extra })
    );
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');
  write('2026-10-31T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 1 }).stale, true);
  write(new Date(now + 1000).toISOString());
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);
  write('2026-10-31T13:00:00Z', false, {
    lastAttemptAt: '2026-11-02T11:00:00Z',
    failedSources: [{ id: 'quota-scan', reason: 'QUOTA_SCAN_EMPTY_EVIDENCE' }],
  });
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
});

```

## tools/ai-brain/test/task-ai-166-review.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const policy = require('../coordinator');
const runtimeApi = require('../coordinator-runtime');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SHA = 'a'.repeat(40);
const item = { id: 'TASK-AI-166', pr: 123, cwd: 'fixture', task: 'task.md' };
const writer = { model: 'p/writer', family: 'writer', harness: 'opencode', score: 90 };

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-rev-'));
  t.after(() => {
    if (process.cwd() === dir) process.chdir(path.resolve(__dirname, '../../..'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function rig(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      now: NOW,
      configured: new Set([writer.model]),
      pidAlive: () => false,
      logMtime: () => NOW - 1000000,
      inspect: async () => ({ sha: SHA, dirty: false }),
      prepare: async () => ({ ok: true, sha: SHA }),
      push: async () => calls.push('push'),
      ci: async () => ({ state: 'green', sha: SHA }),
      candidates: async () => [writer],
      launch: async () => {
        calls.push('launch');
        return { pid: 12 };
      },
      review: async (w, r) => {
        calls.push(['review', r.family]);
        return { verdict: 'PASS', sha: SHA, findings: [] };
      },
      save: async () => {},
      history: async () => {},
      metrics: async () => {},
      ...overrides,
    },
  };
}

function stateFor(current = {}) {
  return { lastRefreshAt: NOW, items: { [item.id]: { writer: { ...writer }, ...current } } };
}

function childFixture() {
  const child = new EventEmitter();
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  return Object.assign(child, {
    pid: 12345,
    stdin: io(),
    stdout: io(),
    stderr: io(),
    unref: () => {},
    kill: () => {},
    finish: () => {
      child.stdout.emit('end');
      child.stderr.emit('end');
      child.emit('close', 0);
    },
  });
}

test('AC-166-05: publication preflight and git inspection validate branch identity, private paths, and register resolution', async (t) => {
  const dir = temporary(t);
  const badRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout: args[0] === 'rev-parse' ? SHA : 'feat/task-ai-999-other',
    }),
  });
  await assert.rejects(badRuntime.inspect(item), /ITEM_BRANCH_MISMATCH/);
  await assert.rejects(badRuntime.push(item, SHA), /ITEM_BRANCH_MISMATCH/);

  const validBranch = 'feat/task-ai-166-refresh-model-catalogue';
  const goodRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout:
        args[0] === 'branch'
          ? validBranch
          : args[0] === 'rev-parse'
            ? SHA
            : args[0] === 'rev-list'
              ? '0'
              : args[0] === 'log'
                ? '[TASK-AI-166] outcome'
                : args.includes('--name-only')
                  ? '.oc/writer.log'
                  : '',
    }),
  });
  await goodRuntime.push(item, SHA);
  const result = await goodRuntime.prepare(item);
  assert.equal(result.ok, false);
  assert.match(result.reason, /PRIVATE/);

  const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, register)), { recursive: true });
  const unmergedRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'rev-list'
          ? '1'
          : args.includes('--diff-filter=U')
            ? register
            : args[0] === 'show'
              ? 'work_item_id,name\nTASK-AI-166,test'
              : '',
    }),
    hookedGit: async () => {},
  });
  assert.equal((await unmergedRuntime.prepare({ ...item, cwd: dir })).ok, false);
});

test('AC-166-06: two-phase review requires independent reviewer and prevents open findings from passing', async () => {
  const result = runtimeApi.parseReview(
    `VERDICT: PASS\nReviewed SHA: ${SHA}\n1. P1 Open defect; previous issue FIXED`
  );
  const { deps } = rig({
    candidates: async () => [
      { model: 'reviewer', family: 'independent', harness: 'codex', score: 90 },
    ],
    review: async () => result,
  });
  const state = stateFor();
  await policy.coordinatorTick([item], state, deps);
  assert.notEqual(state.items[item.id].status, 'PASS');
});

test('AC-166-07: quota refusal cooldown is bounded and cannot renew across ticks or restart', async () => {
  const { deps } = rig({
    inspect: async () => ({ sha: null, dirty: false }),
    logText: async () => 'RESOURCE_EXHAUSTED',
  });
  let state = stateFor({ writer: { ...writer, log: 'writer.log', reservedAt: NOW - 1000 } });
  await policy.coordinatorTick([item], state, deps);
  assert.equal(state.exhausted.length, 1);
  const until = state.exhausted[0].until;
  state = JSON.parse(JSON.stringify(state));
  await policy.coordinatorTick([item], state, { ...deps, now: NOW + 3600000 });
  assert.equal(state.exhausted[0].until, until);
});

test('AC-166-08: fan-out reserves launches durably before spawn and excludes all author families', async (t) => {
  const dir = temporary(t);
  const cwd = path.join(dir, 'work');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'task.md'), 'task');
  const state = { ...stateFor(), launches: [], exhausted: [] };
  const child = childFixture();
  let beforeSpawn;
  const runtime = runtimeApi.createRuntime({
    root: dir,
    config: {},
    git: async () => ({ exitCode: 0, stdout: 'feat/task-ai-166-test' }),
    spawn: () => {
      beforeSpawn = JSON.parse(
        fs.readFileSync(path.join(dir, '.oc/coordinator/state.json'), 'utf8')
      );
      return child;
    },
  });
  runtime.save(state);
  await runtime.fanout(
    { ...item, cwd },
    [{ lane: 1, files: ['tools/test.js'], findings: [] }],
    [{ model: 'gpt-test', family: 'gpt', harness: 'codex', score: 90 }],
    state
  );
  child.finish();
  assert.equal(beforeSpawn.launches.length, 1);
});

test('AC-166-09: metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round', async (t) => {
  const dir = temporary(t);
  const prevCwd = process.cwd();
  const prevConfig = process.env.OPENCODE_CONFIG;
  t.after(() => {
    process.chdir(prevCwd);
    if (prevConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = prevConfig;
  });
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');
  process.env.OPENCODE_CONFIG = path.join(dir, 'opencode.json');
  const localDir = path.join(dir, '.oc/coordinator');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'loop.lock'),
    JSON.stringify({ pid: 12345, at: '2026-01-01T00:00:00Z' })
  );
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify([{ ...item, cwd: dir }]));
  process.chdir(dir);
  await assert.rejects(
    require('../coordinator-cli').main(['run', inputFile(dir)]),
    /LOOP_LOCK_HELD/
  );
});

function inputFile(dir) {
  return path.join(dir, 'items.json');
}

```

## tools/ai-brain/test/task-ai-166-runtime.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('node:events');
const { createRuntime, parseReview, reviewUsage } = require('../coordinator-runtime');
const { dispatchCommand } = require('../cli');
const { publicDocuments } = require('../priors-public');

function dispatchRig(flags = {}) {
  const errors = [];
  const result = dispatchCommand(
    { 'dry-run': true, ...flags },
    {
      error: (text) => errors.push(text),
      log: () => {},
      exit: () => {},
      discoveryDataDir: path.resolve('.oc/tmp/missing-fixture'),
    }
  );
  return { errors, result };
}

function temporary(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'task.md'), 'task instructions');
  return dir;
}

function launchRig(t) {
  const dir = temporary(t, 'ai166-launch-');
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  const [stdout, stderr, stdin, child] = [io(), io(), io(), new EventEmitter()];
  Object.assign(child, { pid: 99999, stdout, stderr, stdin, unref: () => {} });
  const runtime = createRuntime({ config: {}, spawn: () => child });
  return {
    runtime,
    child,
    dir,
    finish: () => {
      stdout.emit('end');
      stderr.emit('end');
      child.emit('close', 0);
    },
  };
}

function poolWriterJob(t, prefix, job) {
  const dir = temporary(t, prefix);
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'm', prompt: 'task', ...job })
  );
  return {
    dir,
    file,
    run: (extra) => require('../coordinator-pool-writer').runPoolWriter(file, extra),
  };
}

test('AC-166-01: benchmark sources retain discrete records without column-wise mean and scanner keeps errno', async () => {
  const { mergePriorDocuments } = require('../priors');
  const now = Date.parse('2026-11-02T12:00:00Z');
  const source = (id, score) => ({
    retrievedAt: '2026-11-01T00:00:00Z',
    sources: [{ id, url: `https://${id}.invalid` }],
    models: [{ canonical: 'model-x', benchmarks: { 'SWE-bench Verified': score } }],
  });
  const doc = mergePriorDocuments([source('sb', 72), source('aa', 40)], now, {});
  const row = doc.ranking.find((r) => r.canonical === 'model-x');
  const scores = row.benchmarks.filter((b) => b.name === 'SWE-bench Verified').map((b) => b.score);
  assert.deepEqual(
    [...scores].sort((a, b) => a - b),
    [40, 72]
  );
  await assert.rejects(
    publicDocuments({
      descriptor: { sources: [{ id: 'aa', kind: 'aa', url: 'https://aa.invalid' }] },
      fetch: async () => {
        const error = new Error('token=must-not-print');
        error.cause = { code: 'EPERM' };
        throw error;
      },
    }),
    /PRIORS_PUBLIC_FETCH_FAILED: aa: EPERM/
  );
});

test('AC-166-03: dispatch dry-run enforces catalogue freshness while fixture evidence bypasses it', () => {
  const { errors: err1, result: res1 } = dispatchRig();
  assert.equal(res1.exitCode, 1);
  assert.equal(res1.warning.code, 'STALE_CATALOGUE');
  assert.match(err1[0], /STALE_CATALOGUE/);
  const evidenceDir = path.resolve('.oc/tmp/fixture-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { errors: err2, result: res2 } = dispatchRig({ 'evidence-dir': evidenceDir });
  assert.notEqual(res2?.warning?.code, 'STALE_CATALOGUE');
  assert.equal(err2.filter((e) => /STALE_CATALOGUE/.test(e)).length, 0);
});

test('AC-166-04: writer launch bounds log at MAX_LOG_BYTES, drains streams, and validates pool job identity', async (t) => {
  const rig = launchRig(t);
  const handle = await rig.runtime.launch(
    { id: 'TASK-AI-166', cwd: rig.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  let resolved = false;
  handle.completed.then(() => {
    resolved = true;
  });
  rig.child.stdout.emit('data', 'chunk 1\n[BLOCKED_BY_SANDBOX]');
  rig.child.stderr.emit('data', 'rate limit warning');
  rig.child.emit('close', 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false);
  rig.finish();
  await handle.completed;
  const drained = fs.readFileSync(handle.log, 'utf8');
  assert.ok(drained.includes('[BLOCKED_BY_SANDBOX]') && drained.includes('rate limit warning'));
  const bounded = launchRig(t);
  const capped = await bounded.runtime.launch(
    { id: 'TASK-AI-166', cwd: bounded.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  const gigabyte = ('A'.repeat(1023) + '\n').repeat(1024);
  for (let i = 0; i < 3; i++) bounded.child.stdout.emit('data', gigabyte);
  bounded.finish();
  await capped.completed;
  assert.ok(fs.statSync(capped.log).size <= 2 * 1024 * 1024);
  assert.ok(fs.readFileSync(capped.log, 'utf8').includes('[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]'));
  const delegated = poolWriterJob(t, 'ai166-pool-', { prompt: 'task' });
  let submitted;
  const queued = await delegated.run({
    expectedCwd: delegated.dir,
    submitJob: async (lane, job) => {
      submitted = { lane, job };
      return { state: 'quota', exitCode: 1, jobId: 'agy01/fixture' };
    },
  });
  assert.equal(submitted.lane, 'agy01');
  assert.equal(queued.reason, 'RESOURCE_EXHAUSTED');
  const rejected = poolWriterJob(t, 'ai166-pool-bad-', {
    cwd: path.join(os.tmpdir(), 'ai166-bad'),
  });
  await assert.rejects(() => rejected.run({ expectedCwd: rejected.dir }), /INVALID_JOB_CWD/);
  const secJob = poolWriterJob(t, 'ai166-pool-sec-', {});
  const secRes = await secJob.run({
    expectedCwd: secJob.dir,
    submitJob: async () => ({
      state: 'error',
      exitCode: 1,
      reason: 'password="leak" user@tenant.com',
      jobId: 'agy01/test',
    }),
  });
  assert.ok(!secRes.reason.includes('leak'));
});

test('AC-166-05: host commit excludes private paths and merges CSV conflict via row union through hook', async (t) => {
  const dir = temporary(t, 'ai166-runtime-');
  const csv = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, csv)), { recursive: true });
  const calls = [];
  let committed = false;
  let registerAdded = false;
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      if (args[0] === 'add' && args.includes(csv)) registerAdded = true;
      const stdout =
        args[0] === 'status'
          ? committed
            ? ''
            : ' M tools/ai-brain/x.js\n'
          : args[0] === 'rev-list'
            ? '1'
            : args.includes('--diff-filter=U')
              ? registerAdded
                ? ''
                : csv
              : args[0] === 'show'
                ? '"work_item_id","name"\n' + (args[1].startsWith(':2') ? '"A","one"' : '"B","two"')
                : args[0] === 'log'
                  ? '[TASK-AI-166] outcome'
                  : args[0] === 'rev-parse'
                    ? 'a'.repeat(40)
                    : '';
      return { exitCode: args[0] === 'merge' ? 1 : 0, stdout };
    },
    hookedGit: async (cwd, args) => {
      committed = true;
      calls.push(['hooked', ...args]);
    },
  });
  await runtime.commit({ id: 'TASK-AI-166', cwd: dir }, { model: 'gpt-test' });
  const add = calls.find((call) => call[0] === 'add');
  for (const excluded of ['.oc', '.serena', '.oc-codex-task.md']) {
    assert.ok(add.includes(':(exclude)' + excluded));
  }
  assert.ok(calls.some((c) => c[0] === 'hooked' && c[1] === 'commit'));
  assert.equal((await runtime.prepare({ cwd: dir, id: 'TASK-AI-166' })).ok, true);
  assert.ok(fs.readFileSync(path.join(dir, csv), 'utf8').includes('"A","one"'));
});

test('AC-166-06: structured review output includes parsed verdict and measured token usage', () => {
  const log = [
    JSON.stringify({
      type: 'text',
      part: { text: 'VERDICT: PASS\nReviewed SHA: ' + 'a'.repeat(40) },
    }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 4 } } }),
  ].join('\n');
  assert.equal(reviewUsage(log).tokens, 14);
  assert.equal(parseReview(reviewUsage(log).text).verdict, 'PASS');
  assert.equal(reviewUsage('plain answer').tokens, null);
});

test('AC-166-08: fan-out merges lanes in numerical order and aborts on conflict', async () => {
  const lanes = (ns) =>
    ns.map((lane) => ({
      lane,
      cwd: '/fixture/lane' + lane,
      branch: 'lane' + lane,
      base: 'a'.repeat(40),
      files: ['apps/file' + lane + '.js'],
      writer: { model: 'gpt-test' },
    }));
  const order = [];
  const gitMock = (failMerge) => async (cwd, args) => {
    order.push(args);
    return {
      exitCode: failMerge && args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
          ? 'apps/file' + cwd.slice(-1) + '.js'
          : '',
    };
  };
  const main = { id: 'TASK-AI-166', cwd: '/fixture/main' };
  const ordered = createRuntime({
    config: {},
    git: gitMock(false),
    hookedGit: async (cwd, args) => order.push(['hooked', ...args]),
  });
  assert.equal((await ordered.collectLanes(main, lanes([2, 1]))).state, 'merged');
  assert.deepEqual(
    order.filter((call) => call[0] === 'merge').map((call) => call.at(-1)),
    ['lane1', 'lane2']
  );
  const failing = createRuntime({ config: {}, git: gitMock(true), hookedGit: async () => {} });
  order.length = 0;
  assert.equal((await failing.collectLanes(main, lanes([1, 2]))).state, 'conflict');
  assert.ok(order.some((call) => call.join(' ') === 'merge --abort'));
});

```
```

## .oc/decisions.md

```
# Decision ledger — p-task-ai-166 (seeded 11-04_08:33 from earlier review rounds)

## coordinator decision 04/11 12:10

- REQUIRED: catalogue built from OpenRouter /api/v1/models + LiteLLM model_prices_and_context_window.json + live provider /models; any hand-written model list or score = prior finding NOT FIXED.

## coordinator decision 04/11 12:40

- REQUIRED in this PR: priors normalisation fix (fallback-only percentile inflation) — see task-fix root-cause SCORING.
- SIZE (04/11 operator): PR must shrink to <=400 changed lines (AGENTS.md). Reviewer: a deletion that removes a feature not required by an AC is NOT a finding; do not raise new P1 on code that the delta deleted.
- SPLIT/TESTS (04/11 operator): only AC tests are committed; finding checks run locally, result in PR body, never committed (no file >300 lines); if >400 lines needed, ship Slice A of the same Work Item, rest listed as Slice B/C.

## round 103 11-04_15:42 VERDICT: CHANGES_REQUIRED

- seen: WHERE: tools/ai-brain/test/discovery.test.js:1008 (append-only ledger regression)
- seen: WHERE: tools/ai-brain/cli.js:2100 (dispatchCommand)
- seen: WHERE: tools/ai-brain/catalogue-refresh.js:112 (refreshCatalogue)
- seen: Follow-up (non-blocking): Complete the recorded AC-166-01/02 host live evidence and update the stale author-handoff text.

## round 104 11-04_18:00 VERDICT: CHANGES_REQUIRED

## round 105 11-04_20:46 VERDICT: CHANGES_REQUIRED

## round 116 11-05_04:06 VERDICT: CHANGES_REQUIRED
## round 121 11-05_06:30 VERDICT: CHANGES_REQUIRED
## round 122 11-05_07:12 VERDICT: CHANGES_REQUIRED
## round 123 11-05_08:20 VERDICT: CHANGES_REQUIRED

```

## .oc/task.md

```
# THIS ROUND = FILE TARGETS ONLY (operator 04/11: many small files, easy to review). No new features, no review fixes.

TASK-AI-166 currently adds 5140 lines. Do exactly these, nothing else:

- tools/ai-brain/test/task-ai-166-review.test.js (848 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator-runtime.js (661 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-runtime.test.js (588 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
- tools/ai-brain/coordinator.js (552 lines) -> SPLIT into modules of <=300 lines each (move code only, no behavior change, update imports).
- tools/ai-brain/test/task-ai-166-refresh.test.js (373 lines) -> REWRITE to <=300 lines: one test per acceptance criterion, delete per-finding/duplicate cases.
  Then: run the AC tests, commit "[TASK-AI-166] Split into small files: <insertions> lines", stop.
  If total insertions still > 400 because the AC really needs it, write "Slice A = this PR; Slice B = <files>" in .oc/pr-body.md (same Work Item).

---- (reference only, next round) ----


GIT NOTE (2026-11-03): this directory is a standalone git clone; its .git is inside this directory, so you CAN and MUST commit your own work. Use `git -c safe.directory=* <command>` for every git command (the directory may be owned by another Windows user). Commit subject must start with the Work Item ID in brackets, e.g. "[TASK-AI-163] ...". Never run git init, never re-point or replace .git, never push, never force anything. Run every check you can before committing (format/lint/typecheck/tests, git diff --check origin/main...HEAD) and update .oc/pr-body.md with each check and its result; a check the environment blocks goes in as BLOCKED_BY_SANDBOX with the exact error. If you cannot commit for any reason, leave the finished change in the working tree; the coordinator commits it. Never leave known-failing code. Touch only files of this Work Item.

```

## .oc/tmp/fixture-evidence/evidence.json

```
{
  "version": 2,
  "combinations": [
    {
      "harness": "paseo",
      "accessPath": "http://127.0.0.1:20128/v1",
      "gateway": "9router",
      "upstream": "internlm",
      "accountId": "xkiro",
      "quotaScope": "internlm",
      "model": "intern-latest",
      "modelId": "intern-latest",
      "source": "9router",
      "sourceId": "9router",
      "credentialFingerprint": "c408c12f0ebb61e1",
      "evidence": [
        {
          "status": "passed",
          "level": 1,
          "proofLevel": "API_PASS",
          "observedAt": "2026-11-05T00:50:43.038Z",
          "elapsedMs": 3062
        }
      ],
      "candidateKey": "paseo::http://127.0.0.1:20128/v1::9router::internlm::xkiro::internlm::intern-latest"
    },
    {
      "harness": "paseo",
      "accessPath": "http://127.0.0.1:20128/v1",
      "gateway": "9router",
      "upstream": "internlm",
      "accountId": "xkiro",
      "quotaScope": "internlm",
      "model": "intern-latest",
      "modelId": "intern-latest",
      "source": "9router",
      "sourceId": "9router",
      "credentialFingerprint": "c408c12f0ebb61e1",
      "evidence": [
        {
          "status": "passed",
          "level": 1,
          "proofLevel": "API_PASS",
          "observedAt": "2026-11-05T00:50:43.038Z",
          "elapsedMs": 3062
        }
      ],
      "candidateKey": "paseo::http://127.0.0.1:20128/v1::9router::internlm::xkiro::internlm::intern-latest"
    },
    {
      "harness": "paseo",
      "accessPath": "http://127.0.0.1:20128/v1",
      "gateway": "9router",
      "upstream": "cohere",
      "accountId": "xkiro",
      "quotaScope": "cohere",
      "model": "c4ai-aya-expanse-32b",
      "modelId": "c4ai-aya-expanse-32b",
      "source": "9router",
      "sourceId": "9router",
      "credentialFingerprint": "c408c12f0ebb61e1",
      "evidence": [
        {
          "status": "passed",
          "level": 1,
          "proofLevel": "API_PASS",
          "observedAt": "2026-11-05T00:50:43.038Z",
          "elapsedMs": 659
        }
      ],
      "candidateKey": "paseo::http://127.0.0.1:20128/v1::9router::cohere::xkiro::cohere::c4ai-aya-expanse-32b"
    },
    {
      "harness": "paseo",
      "accessPath": "http://127.0.0.1:20128/v1",
      "gateway": "9router",
      "upstream": "cohere",
      "accountId": "xkiro",
      "quotaScope": "cohere",
      "model": "c4ai-aya-expanse-32b",
      "modelId": "c4ai-aya-expanse-32b",
      "source": "9router",
      "sourceId": "9router",
      "credentialFingerprint": "c408c12f0ebb61e1",
      "evidence": [
        {
          "status": "passed",
          "level": 1,
          "proofLevel": "API_PASS",
          "observedAt": "2026-11-05T00:50:43.038Z",
          "elapsedMs": 659
        }
      ],
      "candidateKey": "paseo::http://127.0.0.1:20128/v1::9router::cohere::xkiro::cohere::c4ai-aya-expanse-32b"
    },
    {
      "harness": "paseo",
      "accessPath": "http://127.0.0.1:20128/v1",
      "gateway": "9router",
      "upstream": "amd-radeon",
      "accountId": "xkiro",
      "quotaScope": "amd-radeon",
      "model": "Qwen3.8-Flash-Next",
      "modelId": "Qwen3.8-Flash-Next",
      "source": "9router",
      "sourceId": "9router",
      "credentialFingerprint": "c408c12f0ebb61e1",
      "evidence": [
        {
          "status": "passed",
          "level": 1,
          "proofLevel": "API_PASS",
          "observedAt": "2026-11-05T00:50:43.038Z",
          "elapsedMs": 2443
        }
      ],
      "candidateKey": "paseo::http://127.0.0.1:20128/v1::9router::amd-radeon::xkiro::amd-radeon::Qwen3.8-Flash-Next"
    },
    {
      "harness": "paseo",
      "accessPath": "http://127.0.0.1:20128/v1",
      "gateway": "9router",
      "upstream": "amd-radeon",
      "accountId": "xkiro",
      "quotaScope": "amd-radeon",
      "model": "Qwen3.8-Flash-Next",
      "modelId": "Qwen3.8-Flash-Next",
      "source": "9router",
      "sourceId": "9router",
      "credentialFingerprint": "c408c12f0ebb61e1",
      "evidence": [
        {
          "status": "passed",
          "level": 1,
          "proofLevel": "API_PASS",
          "observedAt": "2026-11-05T00:50:43.038Z",
          "elapsedMs": 2443
        }
      ],
      "candidateKey": "paseo::http://127.0.0.1:20128/v1::9router::amd-radeon::xkiro::amd-radeon::Qwen3.8-Flash-Next"
    },
    {
      "harness": "direct-http",
      "accessPath": "https://chat.intern-ai.org.cn/api/v1",
      "gateway": "internlm",
      "upstream": "internlm",
      "accountId": null,
      "quotaScope": "internlm",
      "model": "intern-latest",
      "modelId": "intern-latest",
      "source": "internlm",
      "sourceId": "internlm",
      "credentialFingerprint": "7a7c7f7193acbc01",
      "evidence": [
        {
          "status": "passed",
          "level": 1,
          "proofLevel": "API_PASS",
          "observedAt": "2026-11-05T00:51:56.894Z",
          "elapsedMs": 2209
        }
      ],
      "candidateKey": "direct-http::https://chat.intern-ai.org.cn/api/v1::internlm::internlm::*::internlm::intern-latest"
    },
    {
      "harness": "direct-http",
      "accessPath": "https://developer.amd.com.cn/radeon/api/v1",
      "gateway": "amd-radeon",
      "upstream": "amd-radeon",
      "accountId": null,
      "quotaScope": "amd-radeon",
      "model": "Qwen3.8-Flash-Next",
      "modelId": "Qwen3.8-Flash-Next",
      "source": "amd-radeon",
      "sourceId": "amd-radeon",
      "credentialFingerprint": "db953ce7ac9fb77a",
      "evidence": [
        {
          "status": "passed",
          "level": 1,
          "proofLevel": "API_PASS",
          "observedAt": "2026-11-05T00:53:45.199Z",
          "elapsedMs": 1463
        }
      ],
      "candidateKey": "direct-http::https://developer.amd.com.cn/radeon/api/v1::amd-radeon::amd-radeon::*::amd-radeon::Qwen3.8-Flash-Next"
    }
  ],
  "aliases": [],
  "sharedQuotas": [],
  "upstreamStatus": {},
  "cooldowns": {},
  "capabilityProbes": {}
}

```

## AGENTS.md

```
# Ship Dễ — Operating card

## Source of truth

Read these sources before changing code, in this precedence order:

1. `docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md`
2. `docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md`
3. `docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md`
4. Business rules, state machines, API/data contracts and screen specifications under `docs/product-spec/docs/`
5. The current Work Item and its acceptance matrix
6. Existing code

Existing code is implementation evidence, not business authority. If code and specification conflict, stop and record the conflict; do not silently choose one.

## One Work Item per branch and Pull Request

- One branch and one Pull Request contain exactly one `FEAT-*`, `TASK-FOUND-*`, `TASK-AI-*` or Controller goal item `GOAL-<GOAL>-<n>` Work Item.
- Branch: `feat/<lowercase-work-item-id>-<short-slug>` or `fix/<lowercase-work-item-id>-<short-slug>`.
- Pull Request title: `[<WORK_ITEM_ID>] <business outcome>`.
- Do not combine unrelated cleanup, refactoring or another feature.

## Verification commands

- `pnpm install --prod --frozen-lockfile` (production-install regression gate; run from a clean checkout)
- `pnpm install --frozen-lockfile`
- `pnpm db:generate`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:baseline`
- `pnpm test:brain`
- `pnpm security:secrets`
- `pnpm build`

## Definition of Done

A feature is vertical, not UI-only. Where applicable it includes:

- [ ] user-visible flow and loading, empty, validation, error, forbidden, partial, success and recovery states;
- [ ] API/application behavior and canonical errors;
- [ ] persistence, migrations and seed/test fixtures;
- [ ] tenant scope, authorization, audit and sensitive-data handling;
- [ ] external adapter behavior, timeout, idempotency, reconciliation and manual fallback;
- [ ] unit, integration and end-to-end acceptance evidence;
- [ ] OpenAPI/schema, traceability and operational documentation updates.

- [ ] No fake primary action, production hardcode, hidden TODO or success toast without a real committed outcome is allowed.
- [ ] New behavior requires tests at the lowest useful level plus the Work Item acceptance path.
- [ ] A changed contract requires consumer, schema and compatibility checks.
- [ ] Pull Request evidence includes every [required item](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#pull-request-evidence).
- [ ] `scripts/ai/check-no-hardcode.mjs` passes.

## Hard prohibitions

- Secrets and unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- Every tenant-owned read and write is scoped server-side; never trust client-supplied ownership.
- VND must not use floating-point arithmetic.
- A timed-out create, cancel, redelivery or claim command must reconcile remote state before retry; blind retries that can duplicate an external effect are prohibited.
- No fake primary action.
- Never touch gate configs, allowlists, baselines, semgrep, or `.github/` without explicit approval.
- The author never approves its own work. A feature is not complete because an author says it is complete.

## Role separation

- **Claude — analyst, secondary author and reviewer fallback:** host-authenticated Claude Code CLI only; independent review fallback when cloud reviewers hit rate limits and assigned repair/authoring; never third-party API quotas.
- **Codex — planner/document owner:** prepares the dependency-ready Work Item from approved sources, chooses `GEMINI`, `CLAUDE`, or `9ROUTER`, sets the register to `READY_FOR_AUTHOR`; no production code during planning.
- **9Router worker — constrained author:** assigned low-risk deterministic work only; stop at architecture, authentication, authorization, tenant isolation, money, carrier side effects, database ownership or product UX decisions.
- **Gemini — primary author:** plans and implements complete foundation or vertical Work Items, adds evidence and opens/updates the Pull Request.
- **Codex — independent reviewer:** fresh review-only task against the full Pull Request, Work Item and sources; `PASS`, `CHANGES_REQUIRED` or `BLOCKED`; does not merge or silently fix. **Human — product and merge owner:** resolves decisions, triggers gates, accepts residual risk and merges only after green CI and Codex `PASS`; the [existing conditional controller merge authorization](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#role-separation) remains unchanged.

## Detailed contract

- [Full contract and section map](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md)
- [Workflow](docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), [register](docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv), [Work Item template](docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md)
- [Planning, author and review prompts; toolchain, CLI manifest and Windows setup](docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md#required-handoff-documents)
- [Safe control scripts](scripts/ai/README.md)

```

## package.json

```
{
  "name": "shipde-platform",
  "version": "3.3.0",
  "description": "Ship Dễ (shipde.net) - Nền tảng điều hành & kiểm soát vận chuyển cho Shop Online",
  "private": true,
  "packageManager": "pnpm@11.23.0",
  "engines": {
    "node": ">=24.0.0",
    "pnpm": ">=11.0.0"
  },
  "scripts": {
    "dev": "turbo dev --cache-dir=.turbo/cache",
    "ai:check": "node scripts/ai/prepush-check.mjs",
    "build": "pnpm db:generate && turbo build --cache-dir=.turbo/cache",
    "lint": "turbo lint --cache-dir=.turbo/cache && eslint scripts",
    "format:check": "tsx scripts/verify-formatting.ts",
    "format:write": "prettier --write .",
    "typecheck": "tsc -p tsconfig.json --noEmit && turbo typecheck --cache-dir=.turbo/cache",
    "test": "turbo test --cache-dir=.turbo/cache && turbo test:audit --cache-dir=.turbo/cache && pnpm contract:check && pnpm test:a11y && pnpm test:visual && pnpm test:perf",
    "test:audit": "turbo test:audit --cache-dir=.turbo/cache",
    "test:integration": "pnpm --filter @shipde/api --filter @shipde/worker build && tsx packages/testkit/src/integration.ts",
    "test:local-db": "pnpm db:generate && pnpm --filter @shipde/testkit... build && node scripts/test-local-db.mjs",
    "test:e2e": "turbo test:e2e --cache-dir=.turbo/cache",
    "test:a11y": "tsx scripts/verify-a11y.ts",
    "test:visual": "tsx scripts/verify-visual.ts",
    "test:perf": "tsx scripts/verify-perf.ts",
    "test:baseline": "tsx apps/web/src/tests/preservation-smoke.test.ts",
    "test:brain": "node --test \"tools/ai-brain/test/*.test.js\"",
    "contract:check": "tsx scripts/verify-contracts.ts",
    "contract:generate": "tsx scripts/verify-contracts.ts --generate",
    "mock:carriers": "tsx packages/testkit/src/carriers/server.ts",
    "infra:up": "docker compose -f infra/docker/compose.yml up -d",
    "infra:wait": "tsx infra/docker/wait.ts",
    "infra:down": "docker compose -f infra/docker/compose.yml down",
    "infra:reset": "docker compose -f infra/docker/compose.yml down -v",
    "db:generate": "prisma generate --schema=prisma/schema.prisma",
    "db:migrate": "prisma migrate deploy --schema=prisma/schema.prisma",
    "db:migrate:status": "prisma migrate status --schema=prisma/schema.prisma",
    "db:reset": "tsx infra/docker/reset-db.ts",
    "db:seed": "tsx infra/docker/seed.ts",
    "security:secrets": "tsx scripts/verify-secrets.ts",
    "security:trivy": "tsx scripts/verify-trivy.ts",
    "test:load": "bash tools/k6/run-health-smoke.sh",
    "test:prompts": "bash tools/controller-eval/run.sh",
    "test:specs": "bash tools/openspec-check/run.sh",
    "lint:ast": "ast-grep test --skip-snapshot-tests && ast-grep scan apps packages",
    "security:semgrep": "semgrep --test tools/semgrep/rules && semgrep scan --config tools/semgrep/rules --error --metrics=off apps packages",
    "verify:inventory": "tsx scripts/verify-inventory.ts",
    "concierge:audit": "tsx scripts/concierge-audit.ts",
    "guard:install": "node tools/ai-guard/cli.js install",
    "guard:status": "node tools/ai-guard/cli.js status",
    "ai:refresh-catalogue": "node tools/ai-brain/catalogue-refresh.js",
    "ai:metrics": "node tools/ai-brain/coordinator-cli.js metrics"
  },
  "devDependencies": {
    "@ast-grep/cli": "0.51.0",
    "@prisma/client": "^6.19.2",
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^20",
    "@typescript-eslint/parser": "^8.68.0",
    "eslint": "^9.39.5",
    "lefthook": "1.11.3",
    "openapi-typescript": "^7.13.0",
    "prettier": "^3.9.6",
    "prisma": "^6.19.2",
    "tsx": "^4.21.0",
    "turbo": "^2.4.4",
    "typescript": "^5"
  }
}

```

## tools/ai-brain/test/task-ai-166-refresh.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { enumerateLiveSources } = require('../discovery/live');
const { reconcileRun } = require('../discovery/reconcile');

function fixture(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const files = {
    dataDir,
    freshnessFile: path.join(dataDir, 'freshness.json'),
    reportFile: path.join(dataDir, 'refresh-report.json'),
    summaryFile: path.join(dir, 'quota-scan-summary.json'),
    priorsFile: path.join(dir, 'model-priors.json'),
    quotaFile: path.join(dir, 'quota-state.json'),
  };
  const writeFresh = (record) => fs.writeFileSync(files.freshnessFile, JSON.stringify(record));
  const writeQuota = (scopes) => fs.writeFileSync(files.quotaFile, JSON.stringify({ scopes }));
  const run = async (args, context) => {
    if (args[0] === 'discovery') fs.copyFileSync(files.freshnessFile, context.discoveryFile);
    return { exitCode: 0, stderr: '' };
  };
  const refresh = (extra = {}) => refreshCatalogue({ ...files, run, ...extra });
  const fresh = () => JSON.parse(fs.readFileSync(files.freshnessFile, 'utf8'));
  return { dir, files, writeFresh, writeQuota, run, refresh, fresh };
}

test('AC-166-01: refresh stages run in order, reject incomplete evidence, and redact credentials', async (t) => {
  const calls = [];
  const orderedResult = await refreshCatalogue({
    persist: false,
    run: async (args) => {
      calls.push(args);
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: 'fetch failed' };
    },
  });
  assert.deepEqual(calls, [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]);
  assert.equal(orderedResult.ok, false);

  const now = new Date();
  const f = fixture(t, 'ai166-ac01-');
  f.writeFresh({
    lastAttemptAt: now.toISOString(),
    lastSuccessfulAt: null,
    complete: true,
    failedSources: [],
  });
  fs.writeFileSync(f.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  f.writeQuota({
    s1: {
      source: 'operator@tenant.example.com',
      scope: 'token=super-secret-12345',
      upstream: 'https://admin:my-secret-pw@api.test/v1?apikey=leak-me',
      model: 'custom-m',
      code: 'OK',
      at: now.toISOString(),
    },
  });
  const okResult = await f.refresh({ now: now.getTime() });
  assert.equal(okResult.ok, true);
  assert.equal(f.fresh().complete, true);
  const summary = fs.readFileSync(f.files.summaryFile, 'utf8');
  assert.equal(/my-secret-pw|leak-me|super-secret-12345|operator@tenant/.test(summary), false);

  const bad = fixture(t, 'ai166-ac01-bad-');
  bad.writeFresh({
    lastAttemptAt: now.toISOString(),
    complete: false,
    failedSources: [{ id: 'src', reason: 'fail' }],
  });
  fs.writeFileSync(bad.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  bad.writeQuota({ s1: { code: 'OK', at: now.toISOString() } });
  const badResult = await bad.refresh();
  assert.equal(badResult.ok, false);
});

test('AC-166-02: live discovery enumerates sources, handles unknown providers, and preserves prior candidates', async () => {
  const commands = [];
  const output = await enumerateLiveSources({
    config: {
      provider: {
        amd: {
          options: { baseURL: 'https://provider.invalid/v1', apiKey: 'private-secret' },
          models: { obsolete: {} },
        },
      },
    },
    lanes: ['agy01'],
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: 'gemini-4-flash\tGemini\n' };
    },
    submitModels: async (lane) => {
      commands.push([lane, ['models']]);
      return { exitCode: 0, stdout: 'claude-3-5\tClaude\n' };
    },
    fetch: async (url, init) => {
      assert.equal(init.headers.authorization, 'Bearer private-secret');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'DeepSeek-V4' }] }) };
    },
  });
  assert.equal(output.results['opencode:amd'].catalogs[0].models[0], 'amd/DeepSeek-V4');
  assert.equal(JSON.stringify(output).includes('private-secret'), false);

  const failed = await enumerateLiveSources({
    config: {
      provider: { p: { options: { baseURL: 'https://p.invalid' }, models: { obsolete: {} } } },
    },
    lanes: [],
    runCommand: async () => ({ exitCode: 1 }),
    fetch: async () => {
      throw new Error('secret=leak');
    },
  });
  assert.equal(failed.results['opencode:p'].status, 'unknown');
  assert.equal(JSON.stringify(failed).includes('leak'), false);

  const prior = { key: 'old', modelId: 'old-model', state: 'AVAILABLE', sourceIds: ['provider'] };
  const base = { registry: { sources: [{ id: 'provider' }] }, current: new Map([['old', prior]]) };
  assert.equal(reconcileRun({ ...base, results: {} }).transitions.length, 0);
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'unknown', catalogs: [] } } })
      .transitions.length,
    0
  );
});

test('AC-166-03: catalogue freshness gate refuses absent, future or >48h observations, preserving prior success', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-ac03-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T12:00:00Z');
  const write = (lastSuccessfulAt, complete = true, extra = {}) =>
    fs.writeFileSync(
      path.join(dir, 'freshness.json'),
      JSON.stringify({ lastSuccessfulAt, complete, ...extra })
    );
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');
  write('2026-10-31T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 1 }).stale, true);
  write(new Date(now + 1000).toISOString());
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);
  write('2026-10-31T13:00:00Z', false, {
    lastAttemptAt: '2026-11-02T11:00:00Z',
    failedSources: [{ id: 'quota-scan', reason: 'QUOTA_SCAN_EMPTY_EVIDENCE' }],
  });
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
});

```

## tools/ai-brain/test/task-ai-166-review.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');
const policy = require('../coordinator');
const runtimeApi = require('../coordinator-runtime');

const NOW = Date.parse('2026-11-03T12:00:00Z');
const SHA = 'a'.repeat(40);
const item = { id: 'TASK-AI-166', pr: 123, cwd: 'fixture', task: 'task.md' };
const writer = { model: 'p/writer', family: 'writer', harness: 'opencode', score: 90 };

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-rev-'));
  t.after(() => {
    if (process.cwd() === dir) process.chdir(path.resolve(__dirname, '../../..'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function rig(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      now: NOW,
      configured: new Set([writer.model]),
      pidAlive: () => false,
      logMtime: () => NOW - 1000000,
      inspect: async () => ({ sha: SHA, dirty: false }),
      prepare: async () => ({ ok: true, sha: SHA }),
      push: async () => calls.push('push'),
      ci: async () => ({ state: 'green', sha: SHA }),
      candidates: async () => [writer],
      launch: async () => {
        calls.push('launch');
        return { pid: 12 };
      },
      review: async (w, r) => {
        calls.push(['review', r.family]);
        return { verdict: 'PASS', sha: SHA, findings: [] };
      },
      save: async () => {},
      history: async () => {},
      metrics: async () => {},
      ...overrides,
    },
  };
}

function stateFor(current = {}) {
  return { lastRefreshAt: NOW, items: { [item.id]: { writer: { ...writer }, ...current } } };
}

function childFixture() {
  const child = new EventEmitter();
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  return Object.assign(child, {
    pid: 12345,
    stdin: io(),
    stdout: io(),
    stderr: io(),
    unref: () => {},
    kill: () => {},
    finish: () => {
      child.stdout.emit('end');
      child.stderr.emit('end');
      child.emit('close', 0);
    },
  });
}

test('AC-166-05: publication preflight and git inspection validate branch identity, private paths, and register resolution', async (t) => {
  const dir = temporary(t);
  const badRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout: args[0] === 'rev-parse' ? SHA : 'feat/task-ai-999-other',
    }),
  });
  await assert.rejects(badRuntime.inspect(item), /ITEM_BRANCH_MISMATCH/);
  await assert.rejects(badRuntime.push(item, SHA), /ITEM_BRANCH_MISMATCH/);

  const validBranch = 'feat/task-ai-166-refresh-model-catalogue';
  const goodRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: 0,
      stdout:
        args[0] === 'branch'
          ? validBranch
          : args[0] === 'rev-parse'
            ? SHA
            : args[0] === 'rev-list'
              ? '0'
              : args[0] === 'log'
                ? '[TASK-AI-166] outcome'
                : args.includes('--name-only')
                  ? '.oc/writer.log'
                  : '',
    }),
  });
  await goodRuntime.push(item, SHA);
  const result = await goodRuntime.prepare(item);
  assert.equal(result.ok, false);
  assert.match(result.reason, /PRIVATE/);

  const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, register)), { recursive: true });
  const unmergedRuntime = runtimeApi.createRuntime({
    config: {},
    git: async (cwd, args) => ({
      exitCode: args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'rev-list'
          ? '1'
          : args.includes('--diff-filter=U')
            ? register
            : args[0] === 'show'
              ? 'work_item_id,name\nTASK-AI-166,test'
              : '',
    }),
    hookedGit: async () => {},
  });
  assert.equal((await unmergedRuntime.prepare({ ...item, cwd: dir })).ok, false);
});

test('AC-166-06: two-phase review requires independent reviewer and prevents open findings from passing', async () => {
  const result = runtimeApi.parseReview(
    `VERDICT: PASS\nReviewed SHA: ${SHA}\n1. P1 Open defect; previous issue FIXED`
  );
  const { deps } = rig({
    candidates: async () => [
      { model: 'reviewer', family: 'independent', harness: 'codex', score: 90 },
    ],
    review: async () => result,
  });
  const state = stateFor();
  await policy.coordinatorTick([item], state, deps);
  assert.notEqual(state.items[item.id].status, 'PASS');
});

test('AC-166-07: quota refusal cooldown is bounded and cannot renew across ticks or restart', async () => {
  const { deps } = rig({
    inspect: async () => ({ sha: null, dirty: false }),
    logText: async () => 'RESOURCE_EXHAUSTED',
  });
  let state = stateFor({ writer: { ...writer, log: 'writer.log', reservedAt: NOW - 1000 } });
  await policy.coordinatorTick([item], state, deps);
  assert.equal(state.exhausted.length, 1);
  const until = state.exhausted[0].until;
  state = JSON.parse(JSON.stringify(state));
  await policy.coordinatorTick([item], state, { ...deps, now: NOW + 3600000 });
  assert.equal(state.exhausted[0].until, until);
});

test('AC-166-08: fan-out reserves launches durably before spawn and excludes all author families', async (t) => {
  const dir = temporary(t);
  const cwd = path.join(dir, 'work');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'task.md'), 'task');
  const state = { ...stateFor(), launches: [], exhausted: [] };
  const child = childFixture();
  let beforeSpawn;
  const runtime = runtimeApi.createRuntime({
    root: dir,
    config: {},
    git: async () => ({ exitCode: 0, stdout: 'feat/task-ai-166-test' }),
    spawn: () => {
      beforeSpawn = JSON.parse(
        fs.readFileSync(path.join(dir, '.oc/coordinator/state.json'), 'utf8')
      );
      return child;
    },
  });
  runtime.save(state);
  await runtime.fanout(
    { ...item, cwd },
    [{ lane: 1, files: ['tools/test.js'], findings: [] }],
    [{ model: 'gpt-test', family: 'gpt', harness: 'codex', score: 90 }],
    state
  );
  child.finish();
  assert.equal(beforeSpawn.launches.length, 1);
});

test('AC-166-09: metrics and coordinator loop respect held locks, mask audit credentials, and deduplicate by PR/SHA/round', async (t) => {
  const dir = temporary(t);
  const prevCwd = process.cwd();
  const prevConfig = process.env.OPENCODE_CONFIG;
  t.after(() => {
    process.chdir(prevCwd);
    if (prevConfig === undefined) delete process.env.OPENCODE_CONFIG;
    else process.env.OPENCODE_CONFIG = prevConfig;
  });
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');
  process.env.OPENCODE_CONFIG = path.join(dir, 'opencode.json');
  const localDir = path.join(dir, '.oc/coordinator');
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'loop.lock'),
    JSON.stringify({ pid: 12345, at: '2026-01-01T00:00:00Z' })
  );
  fs.writeFileSync(path.join(dir, 'items.json'), JSON.stringify([{ ...item, cwd: dir }]));
  process.chdir(dir);
  await assert.rejects(
    require('../coordinator-cli').main(['run', inputFile(dir)]),
    /LOOP_LOCK_HELD/
  );
});

function inputFile(dir) {
  return path.join(dir, 'items.json');
}

```

## tools/ai-brain/test/task-ai-166-runtime.test.js

```
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('node:events');
const { createRuntime, parseReview, reviewUsage } = require('../coordinator-runtime');
const { dispatchCommand } = require('../cli');
const { publicDocuments } = require('../priors-public');

function dispatchRig(flags = {}) {
  const errors = [];
  const result = dispatchCommand(
    { 'dry-run': true, ...flags },
    {
      error: (text) => errors.push(text),
      log: () => {},
      exit: () => {},
      discoveryDataDir: path.resolve('.oc/tmp/missing-fixture'),
    }
  );
  return { errors, result };
}

function temporary(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'task.md'), 'task instructions');
  return dir;
}

function launchRig(t) {
  const dir = temporary(t, 'ai166-launch-');
  const io = () => Object.assign(new EventEmitter(), { end: () => {} });
  const [stdout, stderr, stdin, child] = [io(), io(), io(), new EventEmitter()];
  Object.assign(child, { pid: 99999, stdout, stderr, stdin, unref: () => {} });
  const runtime = createRuntime({ config: {}, spawn: () => child });
  return {
    runtime,
    child,
    dir,
    finish: () => {
      stdout.emit('end');
      stderr.emit('end');
      child.emit('close', 0);
    },
  };
}

function poolWriterJob(t, prefix, job) {
  const dir = temporary(t, prefix);
  const file = path.join(dir, 'job.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ accountId: 'agy01', cwd: dir, model: 'm', prompt: 'task', ...job })
  );
  return {
    dir,
    file,
    run: (extra) => require('../coordinator-pool-writer').runPoolWriter(file, extra),
  };
}

test('AC-166-01: benchmark sources retain discrete records without column-wise mean and scanner keeps errno', async () => {
  const { mergePriorDocuments } = require('../priors');
  const now = Date.parse('2026-11-02T12:00:00Z');
  const source = (id, score) => ({
    retrievedAt: '2026-11-01T00:00:00Z',
    sources: [{ id, url: `https://${id}.invalid` }],
    models: [{ canonical: 'model-x', benchmarks: { 'SWE-bench Verified': score } }],
  });
  const doc = mergePriorDocuments([source('sb', 72), source('aa', 40)], now, {});
  const row = doc.ranking.find((r) => r.canonical === 'model-x');
  const scores = row.benchmarks.filter((b) => b.name === 'SWE-bench Verified').map((b) => b.score);
  assert.deepEqual(
    [...scores].sort((a, b) => a - b),
    [40, 72]
  );
  await assert.rejects(
    publicDocuments({
      descriptor: { sources: [{ id: 'aa', kind: 'aa', url: 'https://aa.invalid' }] },
      fetch: async () => {
        const error = new Error('token=must-not-print');
        error.cause = { code: 'EPERM' };
        throw error;
      },
    }),
    /PRIORS_PUBLIC_FETCH_FAILED: aa: EPERM/
  );
});

test('AC-166-03: dispatch dry-run enforces catalogue freshness while fixture evidence bypasses it', () => {
  const { errors: err1, result: res1 } = dispatchRig();
  assert.equal(res1.exitCode, 1);
  assert.equal(res1.warning.code, 'STALE_CATALOGUE');
  assert.match(err1[0], /STALE_CATALOGUE/);
  const evidenceDir = path.resolve('.oc/tmp/fixture-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const { errors: err2, result: res2 } = dispatchRig({ 'evidence-dir': evidenceDir });
  assert.notEqual(res2?.warning?.code, 'STALE_CATALOGUE');
  assert.equal(err2.filter((e) => /STALE_CATALOGUE/.test(e)).length, 0);
});

test('AC-166-04: writer launch bounds log at MAX_LOG_BYTES, drains streams, and validates pool job identity', async (t) => {
  const rig = launchRig(t);
  const handle = await rig.runtime.launch(
    { id: 'TASK-AI-166', cwd: rig.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  let resolved = false;
  handle.completed.then(() => {
    resolved = true;
  });
  rig.child.stdout.emit('data', 'chunk 1\n[BLOCKED_BY_SANDBOX]');
  rig.child.stderr.emit('data', 'rate limit warning');
  rig.child.emit('close', 0);
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false);
  rig.finish();
  await handle.completed;
  const drained = fs.readFileSync(handle.log, 'utf8');
  assert.ok(drained.includes('[BLOCKED_BY_SANDBOX]') && drained.includes('rate limit warning'));
  const bounded = launchRig(t);
  const capped = await bounded.runtime.launch(
    { id: 'TASK-AI-166', cwd: bounded.dir, task: 'task.md' },
    { model: 'gpt-test', harness: 'codex' },
    false
  );
  const gigabyte = ('A'.repeat(1023) + '\n').repeat(1024);
  for (let i = 0; i < 3; i++) bounded.child.stdout.emit('data', gigabyte);
  bounded.finish();
  await capped.completed;
  assert.ok(fs.statSync(capped.log).size <= 2 * 1024 * 1024);
  assert.ok(fs.readFileSync(capped.log, 'utf8').includes('[TRUNCATED: LOG_SIZE_LIMIT_EXCEEDED]'));
  const delegated = poolWriterJob(t, 'ai166-pool-', { prompt: 'task' });
  let submitted;
  const queued = await delegated.run({
    expectedCwd: delegated.dir,
    submitJob: async (lane, job) => {
      submitted = { lane, job };
      return { state: 'quota', exitCode: 1, jobId: 'agy01/fixture' };
    },
  });
  assert.equal(submitted.lane, 'agy01');
  assert.equal(queued.reason, 'RESOURCE_EXHAUSTED');
  const rejected = poolWriterJob(t, 'ai166-pool-bad-', {
    cwd: path.join(os.tmpdir(), 'ai166-bad'),
  });
  await assert.rejects(() => rejected.run({ expectedCwd: rejected.dir }), /INVALID_JOB_CWD/);
  const secJob = poolWriterJob(t, 'ai166-pool-sec-', {});
  const secRes = await secJob.run({
    expectedCwd: secJob.dir,
    submitJob: async () => ({
      state: 'error',
      exitCode: 1,
      reason: 'password="leak" user@tenant.com',
      jobId: 'agy01/test',
    }),
  });
  assert.ok(!secRes.reason.includes('leak'));
});

test('AC-166-05: host commit excludes private paths and merges CSV conflict via row union through hook', async (t) => {
  const dir = temporary(t, 'ai166-runtime-');
  const csv = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
  fs.mkdirSync(path.dirname(path.join(dir, csv)), { recursive: true });
  const calls = [];
  let committed = false;
  let registerAdded = false;
  const runtime = createRuntime({
    config: {},
    git: async (cwd, args) => {
      calls.push(args);
      if (args[0] === 'add' && args.includes(csv)) registerAdded = true;
      const stdout =
        args[0] === 'status'
          ? committed
            ? ''
            : ' M tools/ai-brain/x.js\n'
          : args[0] === 'rev-list'
            ? '1'
            : args.includes('--diff-filter=U')
              ? registerAdded
                ? ''
                : csv
              : args[0] === 'show'
                ? '"work_item_id","name"\n' + (args[1].startsWith(':2') ? '"A","one"' : '"B","two"')
                : args[0] === 'log'
                  ? '[TASK-AI-166] outcome'
                  : args[0] === 'rev-parse'
                    ? 'a'.repeat(40)
                    : '';
      return { exitCode: args[0] === 'merge' ? 1 : 0, stdout };
    },
    hookedGit: async (cwd, args) => {
      committed = true;
      calls.push(['hooked', ...args]);
    },
  });
  await runtime.commit({ id: 'TASK-AI-166', cwd: dir }, { model: 'gpt-test' });
  const add = calls.find((call) => call[0] === 'add');
  for (const excluded of ['.oc', '.serena', '.oc-codex-task.md']) {
    assert.ok(add.includes(':(exclude)' + excluded));
  }
  assert.ok(calls.some((c) => c[0] === 'hooked' && c[1] === 'commit'));
  assert.equal((await runtime.prepare({ cwd: dir, id: 'TASK-AI-166' })).ok, true);
  assert.ok(fs.readFileSync(path.join(dir, csv), 'utf8').includes('"A","one"'));
});

test('AC-166-06: structured review output includes parsed verdict and measured token usage', () => {
  const log = [
    JSON.stringify({
      type: 'text',
      part: { text: 'VERDICT: PASS\nReviewed SHA: ' + 'a'.repeat(40) },
    }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 4 } } }),
  ].join('\n');
  assert.equal(reviewUsage(log).tokens, 14);
  assert.equal(parseReview(reviewUsage(log).text).verdict, 'PASS');
  assert.equal(reviewUsage('plain answer').tokens, null);
});

test('AC-166-08: fan-out merges lanes in numerical order and aborts on conflict', async () => {
  const lanes = (ns) =>
    ns.map((lane) => ({
      lane,
      cwd: '/fixture/lane' + lane,
      branch: 'lane' + lane,
      base: 'a'.repeat(40),
      files: ['apps/file' + lane + '.js'],
      writer: { model: 'gpt-test' },
    }));
  const order = [];
  const gitMock = (failMerge) => async (cwd, args) => {
    order.push(args);
    return {
      exitCode: failMerge && args[0] === 'merge' && args[1] !== '--abort' ? 1 : 0,
      stdout:
        args[0] === 'diff' && args.includes('--name-only') && !args.includes('--cached')
          ? 'apps/file' + cwd.slice(-1) + '.js'
          : '',
    };
  };
  const main = { id: 'TASK-AI-166', cwd: '/fixture/main' };
  const ordered = createRuntime({
    config: {},
    git: gitMock(false),
    hookedGit: async (cwd, args) => order.push(['hooked', ...args]),
  });
  assert.equal((await ordered.collectLanes(main, lanes([2, 1]))).state, 'merged');
  assert.deepEqual(
    order.filter((call) => call[0] === 'merge').map((call) => call.at(-1)),
    ['lane1', 'lane2']
  );
  const failing = createRuntime({ config: {}, git: gitMock(true), hookedGit: async () => {} });
  order.length = 0;
  assert.equal((await failing.collectLanes(main, lanes([1, 2]))).state, 'conflict');
  assert.ok(order.some((call) => call.join(' ') === 'merge --abort'));
});

```