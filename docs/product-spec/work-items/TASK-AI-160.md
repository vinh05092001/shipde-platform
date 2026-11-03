# TASK-AI-160 — Read-only web research for agents via Agent-Reach

## Control

| Field           | Value                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Item ID    | `TASK-AI-160`                                                                                                                                                                                                                                                                                                                                                                   |
| Feature ID      | `N/A` — internal author/reviewer research tooling                                                                                                                                                                                                                                                                                                                               |
| Status          | `IN_PROGRESS`                                                                                                                                                                                                                                                                                                                                                                   |
| Delivery order  | `273`                                                                                                                                                                                                                                                                                                                                                                           |
| Dependencies    | `TASK-FOUND-02` — MERGED; existing Node/pnpm workspace                                                                                                                                                                                                                                                                                                                          |
| Assigned author | `CODEX` — explicitly assigned by operator on 2026-11-02                                                                                                                                                                                                                                                                                                                         |
| Risk            | `LOW` — public read-only research, no product runtime change                                                                                                                                                                                                                                                                                                                    |
| Allowed paths   | `scripts/ai/research.mjs`, `scripts/ai/test/research.test.mjs`, `scripts/ai/test/fixtures/agent-reach.mjs`, `package.json`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, this file, `.oc/pr-body.md` |
| Reviewer        | `Codex — fresh independent task`                                                                                                                                                                                                                                                                                                                                                |
| Branch          | `feat/task-ai-160-agent-reach`                                                                                                                                                                                                                                                                                                                                                  |
| Pull Request    | None; working-tree handoff for coordinator commit; no push                                                                                                                                                                                                                                                                                                                      |

## Business outcome

Writers and reviewers can consult real carrier API documentation, library examples and public reference repositories instead of guessing uncertain external behavior, reducing review rounds. Sources remain advisory and must be cited by URL in the Pull Request.

## Source references

- Operator approval and assignment, 2026-11-02: adopt `Panniantong/Agent-Reach` (MIT) at tag `v1.6.1`, with public read-only access and no accounts.
- [Baseline and Decisions](../docs/00-control/BASELINE-AND-DECISIONS.md), “Evidence levels”: official and community evidence remain distinct.
- [Product Vision and Scope](../docs/01-product/PRODUCT-VISION-SCOPE.md), “Boundaries”: no invented carrier outcomes or capabilities.
- [Master Feature Catalog](../docs/01-product/MASTER-FEATURE-CATALOG.md), `FEAT-CAR-06`: capability evidence remains required; this task implements no product feature.
- [AI Toolchain Decisions](../docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md), `AI-TOOL-01`, `AI-TOOL-10`, `AI-TOOL-11`: advisory adoption, truthful installation evidence and fail-closed pinning.
- Upstream [install guide](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/docs/install.md), “Install and set up”; [CLI](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/runtime/cli.py), action/version commands; channel definitions [web](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/channels/web.py), [GitHub](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/channels/github.py), [Reddit](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/channels/reddit.py), [YouTube](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/channels/youtube.py).

## Preconditions and dependencies

The isolated branch starts at `c6e71fcb9354cd2b14d1f5dcaed794abff306991`. Node 24 and pnpm 11 are available. The operator installs the optional CLI from the pinned GitHub release; the wrapper reports a missing binary without installing anything. Tests launch a local Node fixture executable and require no network.

## Ambiguity and clarification markers

None unresolved. Pinned source inspection resolves `youtube transcript` to upstream `youtube subtitle` (captions, no keyed transcription). Reddit is forced to `public-web`; GitHub is forced to `github-api`. Management commands, browser backends and keyed audio transcription are outside the approved access boundary.

## Author boundary

The operator explicitly assigned this bounded tooling implementation to Codex. Only the allowed paths may change. No production feature, database, carrier action, gate configuration, existing policy allowlist/baseline, Semgrep rule or `.github/` file may change. The author cannot issue an independent review verdict or merge.

## Slice sizing rule

One Work Item and one branch; no UI slice. Keep the wrapper and offline tests focused. Required handoff documentation shares this delivery. The operator's sandbox note prohibits Git writes; the coordinator owns the commit.

## In scope

- Dependency-free Node wrapper and root `ai:research` script.
- Seven public channel/action combinations, safe arguments, isolated account-free child environment, pinned version check and safe failures.
- Redacted output with a default 20,000-character budget and `--max-chars` override.
- Offline fixture tests, toolchain installation/usage documentation, author checklist, one register row and ten-section PR body.

## Out of scope

Posting, mutation, login, account import, cookies, API keys, private research, automatic installation/update, audio transcription and gate/controller/product changes. No push or Pull Request creation.

## Business rules and edge cases

- `AI-160-R01`: Only `web read/search`, `github search/read`, `reddit read/search`, and `youtube transcript` are accepted; reject unknown channels/actions/options before launching the CLI.
- `AI-160-R02`: Select anonymous backends explicitly. Never inherit operator account/configuration files, tokens, cookies, proxies or runtime injection variables. Do not invoke login or browser commands.
- `AI-160-R03`: A missing or mismatched CLI reports the pinned GitHub install hint. Never install the unrelated PyPI package or fall back to latest.
- `AI-160-R04`: Redact sensitive fields, credential patterns and inherited environment values before truncation. Never relay raw child stderr. The total emitted output fits the selected positive integer budget, including any truncation marker.
- `AI-160-R05`: Failures, timeouts, rate limits and login challenges remain failures; no account acquisition or credential fallback.
- `AI-160-R06`: Research is advisory. Cite source URLs and preserve product specification authority and official/community evidence distinctions.

## Constitution check

- [x] Tenant scope: N/A — no product data access.
- [x] RBAC & permissions: public read-only command boundary; no product routes.
- [x] Audit & sensitive data: sanitized arguments/environment/output; no credential file reads.
- [x] VND integer arithmetic: N/A — no money calculations.
- [x] Carrier reconciliation: N/A — no carrier commands or external mutations.
- [x] Tests at the lowest useful level: 35 executable-fixture tests pass without network. This run reproduced four failures before fixing public-only target boundary enforcement, schemeless credential URL query handling, sensitive access_key/passwd masking, and duplicate budget validation.
- [ ] When external API/library behaviour is uncertain, research it with pnpm ai:research and cite the URL.

## UI states

N/A — terminal tooling only. Validation, missing installation, failure, success and truncated output are covered by CLI tests.

## API, event and data impact

No API, event, database, migration, job or screen changes. The wrapper issues only public research queries/reads; temporary CLI state/captions are confined to a fresh directory and removed after each call. Search queries and public target URLs go to the selected research services.

## Acceptance matrix

| AC/Test ID   | Scenario                                                                | Expected result                                                                                                                                                            | Evidence required                                             |
| ------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| AC-AI-160-01 | Each allowed pair and public backend                                    | Correct CLI argv; transcript maps to subtitle                                                                                                                              | integration: offline executable fixture                       |
| AC-AI-160-02 | Mutation, login, unknown pair/option, malformed budget or unsafe target | Nonzero refusal before CLI launch; no input echo                                                                                                                           | integration: refusal/marker tests                             |
| AC-AI-160-03 | Missing binary, wrong version or invalid version response               | Nonzero, pinned GitHub-only install hint                                                                                                                                   | integration: missing/fixture version tests                    |
| AC-AI-160-04 | Long output, small budget, Unicode or secrets                           | Output is redacted before truncation and fits budget                                                                                                                       | integration: output/secret fixture tests                      |
| AC-AI-160-05 | Existing operator environment/config or upstream failure                | Credentials/config inaccessible to child; no raw stderr or login fallback                                                                                                  | integration: isolated environment/error fixture tests         |
| AC-AI-160-06 | Writer needs uncertain external behavior                                | Pinned installation, allowlist, advisory/citation guidance and exact checklist sentence documented                                                                         | docs-inspection; test not applicable: guidance and provenance |
| AC-AI-160-07 | Local handoff                                                           | IN_PROGRESS Work Item and exactly one register row; ten-section PR body READY_FOR_CODEX; checks recorded truthfully; working tree handed to coordinator without Git writes | log/docs-inspection; test not applicable: handoff metadata    |

## Task breakdown

- [x] `T01` Inspect approved repository sources and upstream pinned installation/channel contracts; prepare this Work Item.
- [x] `T02` Write offline fixture tests for AC-AI-160-01 through AC-AI-160-05 and observe failing cases before final implementation repairs.
- [x] `T03` Implement the wrapper/root script to pass T02.
- [x] `T04` Document installation, anonymous access, citation rules, checklist and register row.
- [x] `T05` Run the requested checks, complete PR evidence, and leave the working tree for the coordinator. Do not commit, create a Git bundle, or push.

## Verification commands

Run from the isolated worktree:

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
node --test scripts/ai/test/research.test.mjs
node scripts/ai/check-no-hardcode.mjs
git diff --check origin/main...HEAD
```

Verification results are recorded in `.oc/pr-body.md`; no remote CI or independent PASS is claimed by this author.

On Windows the commands use `pnpm.cmd`. In this run, frozen installation passed with all eight workspace projects already up to date; lint and typecheck each passed all 12 tasks. The fixture suite passes 35 tests. The initial formatting check found only a pre-existing formatting issue in `.oc-codex-task.md`; it was corrected without changing its instructions. Final check results, including the explicit working-file hardcode scan, are recorded in `.oc/pr-body.md`. `git diff --check origin/main...HEAD` checks the existing HEAD, not these uncommitted changes, so working-tree whitespace and new-file LF checks are recorded separately.

## Codex review record

| Review round | Commit                                                              | Verdict                                        | Findings resolved                                                                                               |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Round 1      | Uncommitted working tree; coordinator must supply the new exact SHA | `READY_FOR_CODEX` — independent review not run | .oc/review.txt absent (no prior findings); resolved worker boolean env corruption; pruned `.serena/.gitignore` |
| Round 8      | `916b67331477f7646bdbc06c2b67207d0112e7b7`                          | `CHANGES_REQUIRED`                             | Resolved duplicate delivery order (272 -> 273), fixing CI failures in ai-brain-tests, contract, and validate     |
| Round 9      | `a885a9c0f5335e8945125c5639b54b50e00d59d8`                          | `READY_FOR_CODEX`                              | Resolved P1 finding 4 (public-only target boundary & redirects), P1 finding 7 (credential-bearing search URLs & passwd/access_key masking), and P2 finding 10 (duplicate budget validation under small limit) |

## Residual limitations

Anonymous services may be rate-limited or blocked; captionless videos return failure rather than keyed transcription. Operator owns installation and retries or uses another approved public source. Live Agent-Reach network execution is not claimed by offline fixture evidence.

The shared Git metadata is read-only under the operator's sandbox decision. No Git write or commit is attempted in this run. The coordinator commits the working tree with `[TASK-AI-160] Read-only web research for agents via Agent-Reach` and supplies the exact SHA for independent review. Work Item/register remain `IN_PROGRESS` as requested. Host installation, live research execution, commit hooks, remote CI and independent review are not claimed by local fixture checks.
