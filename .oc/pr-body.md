## Work Item

- Work Item ID: TASK-AI-164
- Feature ID: N/A — AI delivery workflow
- Assigned implementation author: Codex, explicit operator repair assignment on 2026-11-03
- Reviewed starting commit: f1796fb685b81f646cb5a8c2e866712820edd940
- Business outcome: reject incomplete Work Items before handoff with concrete acceptance proofs, regression expectations and source references.

## Source requirements

Sources: [Work Item](../docs/product-spec/work-items/TASK-AI-164.md), [baseline](../docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md), [product boundaries](../docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md), [template](../docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md), [workflow](../docs/product-spec/docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md), and [agent contract](../docs/product-spec/docs/10-ai-collaboration/AGENT-CONTRACT-DETAILS.md). Scope remains READY-01 through READY-05 and AC-READY-01 through AC-READY-07. Read `.oc/review.txt` and all of `.oc/history.md` (Round 72); retain the earlier behaviour-proof, placeholder-proof and PR-contract regressions.

## Scope integrity

- [x] One Work Item and the current branch; no push, rebase, reset or force operation.
- [x] Only this item's register row changes. Its order is the coordinator-assigned `297`; all other rows remain intact, and when merging main both rows are kept.
- [x] No gate configuration, allowlist, baseline, semgrep rule or workflow changes.
- [x] The latest operator Git authorization supersedes the old sandbox text in this Work Item.

The initial command `git -c safe.directory=* fetch origin` failed with `error: cannot open '.git/FETCH_HEAD': Permission denied`. The dependent merge could not run. All base comparisons use the existing local `origin/main` reference; no fresh remote state is claimed.

## Implementation

This pass fixes the P1 findings from `.oc/review.txt` (Round 72 review at reviewed SHA 34d5bf1):

- Finding 1: `.oc/pr-body.md` Prettier column padding and formatting normalized across all changed and untracked `.oc/` handoff files.
- Finding 2 (`scripts/ai/ready-check.mjs:42`): Removed `HEADING.test(afterQuote)` inside fence container checks so headings inside fenced code blocks are treated as literal text and do not prematurely terminate fence tracking.
- Finding 3 (`scripts/ai/ready-check.mjs:101`): For fences opened inside a list item, `fenceListIndent` inherits `currentListIndent` directly rather than `Math.max(currentListIndent, openerIndent)`, ensuring content at standard list indentation remains within the fence.
- Finding 4 (`scripts/ai/ready-check.mjs:80`): Fenced closer matching now requires `lineQuotePrefix === (fenceQuotePrefix || '')` and a clean closer regex (`/^[ \t]*(`{3,}|~{3,})[ \t]*$/`), preventing literal extra container characters like `>> ~~~` from prematurely closing an outer blockquote fence.
- Finding 5 (`scripts/ai/ready-check.mjs:338`): Implemented per-section acceptance table counting with `sectionTableCount` map, ensuring that empty acceptance matrix sections are rejected even if another complete matrix exists.
- Delivery order: `docs/product-spec/work-items/TASK-AI-164.md:10` and register row 270 both say `297`; `ready-check-delivery-register.test.mjs` passes.

No application route, persistence, migration, event, job or screen changes.

## Acceptance evidence

All seven rows are locally PASS. Command: `node --test scripts/ai/test/*.mjs` — exit 0, 108 tests passed, zero skipped (43 boundary tests).

| Row         | Proof exercised                                                                                                            | Result |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| AC-READY-01 | `CLI accepts a Work Item path without mutating the file`                                                                   | PASS   |
| AC-READY-02 | Marker-anywhere cases and `nonempty Open questions must return to planning even without a marker`                          | PASS   |
| AC-READY-03 | Missing, empty, nested and placeholder Proof cases, including suffixed placeholders                                        | PASS   |
| AC-READY-04 | Missing/commented/placeholder/unproved behaviour and mixed table/list proof isolation cases                                | PASS   |
| AC-READY-05 | Missing/commented/out-of-section sources denied; repository and external links accepted offline                            | PASS   |
| AC-READY-06 | CLI bad arguments, missing paths, directories, multiple problems, masked diagnostics and preserved bytes                   | PASS   |
| AC-READY-07 | `pnpm.cmd ai:ready docs/product-spec/work-items/TASK-AI-164.md`; inspect workflow planning and author handoff requirements | PASS   |

Finding-to-test evidence for every finding in the current review (`.oc/review.txt`, CHANGES_REQUIRED at 34d5bf1):

| Finding                                                                                        | Test or command                                                       | Before fix                                                                             | After fix / limitation                                                                                     |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P1 .oc/pr-body.md:51: Prettier padding on the finding-to-test table                            | `npx prettier --check .oc/pr-body.md`; `pnpm format:check`            | Exit 1 in verification; inconsistent column padding                                    | Exit 0 this pass; table formatted and all changed/untracked files normalized with Prettier                 |
| P1 scripts/ai/ready-check.mjs:42: Heading inside list fence terminates fence tracking          | `rejects acceptance matrix supplied by a heading inside a list fence` | Exit 1 at 34d5bf1: readiness returned ok true; heading inside fence closed fence       | Fixed this pass: removed heading trigger inside fence; test green; asserts ok false with matrix warning    |
| P1 scripts/ai/ready-check.mjs:101: Opener indentation requirement ends list fence prematurely  | `rejects fenced source with less indentation than its opener`         | Exit 1 at 34d5bf1: readiness returned ok true; Math.max set fenceListIndent too high   | Fixed this pass: list container indent used without Math.max; test green; asserts ok false with diagnostic |
| P1 scripts/ai/ready-check.mjs:80: Literal blockquote-prefixed marker inside fence closes it    | `rejects fenced source after a literal blockquote-prefixed marker`    | Exit 1 at 34d5bf1: readiness returned ok true; extra blockquote marker closed fence    | Fixed this pass: closer requires lineQuotePrefix matching container; test green; asserts ok false          |
| P1 scripts/ai/ready-check.mjs:338: Empty acceptance matrix beside a complete matrix            | `rejects an empty acceptance matrix beside a complete matrix`         | Exit 1 at 34d5bf1: readiness returned ok true; global table count masked empty matrix  | Fixed this pass: per-section table check reports empty matrix at section index; test green                 |
| Follow-up P2 (non-blocking): `concrete` rejects runnable Proofs containing `<`/`>` comparisons | not addressed in this pass                                            | `` `node -e "process.exit(1 < 2 && 3 > 2 ? 0 : 1)"` `` treated as an angle placeholder | Deferred: this pass is P0/P1-only per assignment; no NEEDS_DECISION invented                               |

## Verification

All evidence and temporary files are under `.oc/tmp` in this worktree. `pnpm.cmd` selects the pnpm CLI on Windows. Direct Git commands use `git -c safe.directory=*`.

| Command                                                         | Result                                                                     | Evidence                                                                                                                                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd lint`                                                 | PASS, exit 0; 12 Turbo tasks, one pre-existing web warning; app code clean | 12 Turbo tasks successful                                                                                                                                                                                 |
| `pnpm.cmd typecheck`                                            | PASS, exit 0; 12 Turbo tasks; app code clean                               | 12 Turbo tasks successful                                                                                                                                                                                 |
| `pnpm.cmd format:check`                                         | PASS, exit 0 this pass                                                     | 13 in-scope files comply 100% with Prettier                                                                                                                                                               |
| `npx prettier --check .oc/pr-body.md`                           | PASS, exit 0 (`pr-body-format-at-reviewed-head`)                           | All matched files use Prettier code style                                                                                                                                                                 |
| `node --test scripts/ai/test/*.mjs`                             | PASS, 108/108, exit 0                                                      | All ready-check tests pass (43 boundary tests)                                                                                                                                                            |
| `pnpm.cmd security:secrets`                                     | PASS, exit 0                                                               | Gitleaks scanned PR commit history and working tree: 0 violations                                                                                                                                         |
| `pnpm.cmd ai:ready docs/product-spec/work-items/TASK-AI-164.md` | PASS, exit 0                                                               | CLI reports ready                                                                                                                                                                                         |
| `node scripts/ai/check-no-hardcode.mjs`                         | PASS, exit 0                                                               | 0 new instances                                                                                                                                                                                           |
| `git -c safe.directory=* diff --check origin/main...HEAD`       | PASS, exit 0                                                               | Clean diff check                                                                                                                                                                                          |
| `git -c safe.directory=* diff --check`                          | PASS, exit 0                                                               | Clean working tree diff                                                                                                                                                                                   |
| `pnpm.cmd test:brain`                                           | BLOCKED_BY_SANDBOX: pre-existing sandbox CRLF / pnpm ENOENT issues         | Byte-exact vendored tests fail because this sandbox checks out LF blobs with CRLF (global `core.autocrlf=true`); task-ai-136 tests fail on pnpm.exe ENOENT; 0 failures in files touched by this Work Item |

Additional verification and commit results:

| Command                                                                          | Result                                                                                                                 | Evidence                                                                                                        |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd test` with default local environment                                   | FAIL, exit 1: Prisma Windows engine DLL rename receives `EPERM` while the concurrent API process has loaded it         | `.oc/tmp/test-default.log`; does not supersede the CI-mode store blocker                                        |
| `pnpm.cmd --filter @shipde/api test` with default local environment              | FAIL / incomplete: earlier unit and HTTP suites progress; invitations HTTP acceptance suite interrupted at test 14     | `.oc/tmp/api-default.log`; no successful aggregate API-test claim                                               |
| `git -c safe.directory=* add` and `git -c safe.directory=* commit` for this pass | PASS, exit 0 under the 2026-11-03 operator Git authorization; the earlier index.lock permission error no longer occurs | Subject starts with `[TASK-AI-164]`; working tree clean after commit; no push, rebase, reset or force operation |

Production-install testing requires a clean checkout and is not claimed. Existing dependencies support lint, typecheck and the focused tests. No package or lockfile is changed to work around the pnpm store failure.

## Safety and recovery

| Review category         | Self-check                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Tenant scope            | N/A: no tenant data access or application endpoint changes                                                                       |
| RBAC / empty-scope deny | N/A: no authorization path changes; no empty scope is interpreted as permission by this checker                                  |
| Negative tests          | All existing checker/CLI negative cases retained; delivery collision and missing committed evidence reproduced red before repair |
| Work Item acceptance    | All seven rows exercised and PASS; semantic review remains independent                                                           |
| Integer VND             | N/A: no money arithmetic                                                                                                         |
| Idempotency             | CLI never executes proofs, fetches sources or mutates inputs; repeated checks preserve bytes                                     |
| Audit / PII masking     | No audit write; existing CLI negative tests verify diagnostics do not echo document contents or disclose details                 |
| UI states               | CLI success, validation problems, invocation failure and recovery-to-planning covered; no app UI changes                         |

Docker lifecycle attempted as instructed. Docker Desktop start requested with a hidden window after unsuccessful `docker info`. A subsequent `docker info`, `docker start shipde-postgres shipde-redis shipde-minio` and cleanup `docker stop shipde-postgres shipde-redis shipde-minio` are denied: `permission denied while trying to connect to the docker API at npipe:////./pipe/docker_engine`. Container startup/shutdown cannot be confirmed. Logs: `.oc/tmp/docker-after-start.err.log`, `.oc/tmp/docker-start.log`, `.oc/tmp/docker-stop.log`. Local Docker configuration is confined to `.oc/tmp/docker`.

## Documentation and traceability

- [x] Work Item records the latest author boundary, corrected order, review round and current verification limits.
- [x] Template and workflow retain every earlier acceptance requirement and passing-before-handoff rule.
- [x] Register has one row for this Work Item and globally unique delivery orders.
- [x] Contract tests exercise the real gate without editing it.
- [x] API/schema, migrations, operational UI screenshots and external carrier evidence are N/A.

## Risks and limitations

Known limitations: full brain CI and full application/API tests are not claimed as no DB or backend services are touched by this workflow checker change. `pnpm test:brain` fails only on pre-existing sandbox CRLF / pnpm ENOENT conditions documented above, with zero findings or failures in files this Work Item touches; fixing them needs gate-allowlist or machine changes outside scope. All five review P1s are resolved and verified locally with negative regression tests and 108 passing ready-check tests; the non-blocking P2 follow-up (`concrete` rejecting runnable Proofs containing comparisons) is deferred to a later pass because this pass is P0/P1-only. No product decision is required; no NEEDS_DECISION is invented. Readiness checks document structure, not proof execution or business completeness. No author approval, independent PASS, remote CI success, merge or push is claimed.

## Codex review

- Review status: READY_FOR_CODEX is the required contract marker; actual delivery remains blocked on the documented local verification limits and fresh independent review.
- Previous verdict: CHANGES_REQUIRED at reviewed SHA 34d5bf1480a813f56de5b712dd3f8c3f7e02b609.
- This pass addresses that review: finding 1 re-verified (prettier exit 0), findings 2–5 fixed in `scripts/ai/ready-check.mjs` with negative regression tests in `scripts/ai/test/ready-check-boundaries.test.mjs`. The non-blocking P2 follow-up is deferred per P0/P1-only scope.
- Local commits: 34d5bf1 [TASK-AI-164] Lock fence-indent root cause with regression test and record review-round evidence, then this pass's commit. Prior commits: a768263, 3f50af5, 65a4214, 906fc38, a52c6cf. No push created.
