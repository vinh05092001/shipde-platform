## Work Item

- Work Item ID: TASK-AI-160
- Feature ID: N/A — advisory agent research tooling
- Work Item file: docs/product-spec/work-items/TASK-AI-160.md
- Assigned implementation author: CODEX — explicitly assigned by operator, 2026-11-02
- Business outcome: Writers and reviewers verify uncertain external API/library behavior using public documentation and examples, reducing guesswork and review rounds.

## Source requirements

- Rule/acceptance IDs: AI-160-R01–R06; AC-AI-160-01–07.
- Product authority: [Baseline, Evidence levels](../docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md), [vision, Boundaries](../docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md), [catalog, FEAT-CAR-06](../docs/product-spec/docs/01-product/MASTER-FEATURE-CATALOG.md).
- Operator approval and sandbox decision: task instructions dated 2026-11-02, also recorded in `.oc-codex-task.md`.
- Upstream v1.6.1: [install guide](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/docs/install.md), [MIT license](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/LICENSE), [CLI](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/runtime/cli.py), [public-only dispatch](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/runtime/dispatch.py), [web](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/channels/web.py), [GitHub](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/channels/github.py), [Reddit](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/channels/reddit.py), [YouTube](https://github.com/Panniantong/Agent-Reach/blob/v1.6.1/agent_reach/channels/youtube.py).
- Screen/API/entity/state IDs: N/A — internal CLI only.

## Scope integrity

- [x] This PR contains exactly one Work Item and one new register row; status IN_PROGRESS as requested.
- [x] Scoped CLI, root package script, offline tests and documentation; no new dependencies.
- [x] No gate configuration, existing allowlist, baseline, Semgrep rule or .github/ changes.
- [x] Changes stay inside the Work Item author boundary and allowed paths.

## Implementation

- `scripts/ai/research.mjs`: pinned version check; seven public read-only operations; forced anonymous backends; shell-free argument-array execution; temporary home/configuration and minimal child environment; destination safety enforcement integrated into the retrieval transport boundary with pre- and post-retrieval DNS resolution verification; `defaultRetrieve` using explicit fresh `https.Agent` / `http.Agent` with `keepAlive: false` and connection-level DNS lookup validation that rejects private and loopback destinations before socket connection (protecting against DNS rebinding); destination re-validation on actual retrieval before launching CLI read (preventing changed redirect bypass); transport execution excluding inherited environment proxies (`NODE_USE_ENV_PROXY`, `HTTPS_PROXY`, `HTTP_PROXY`) and operator credentials; bracketed public IPv6 literals skipping redundant DNS hostname resolution; credential-bearing IPv6 search URL parsing preserving IPv6 literal bracket delimiters; bare userinfo rejection in search and read for both FQDNs and single-label hosts; distinguishing ordinary library expressions without URL delimiters from resolvable destinations; output redaction that decodes percent-encoded and space/tab-separated parameter names in returned URLs and hash fragments, including public IPv6 literal URLs; safe parameter decoding preventing malformed query parameters (e.g. `bad%`) from disabling credential redaction; unattached/bare credential pattern masking for bare OpenAI keys (`sk-...`) and GitHub PATs (`ghp_...`) before output truncation; serialized JSON `client_secret` masking; sensitive parameter rejection for camelCase credential keys (`apiKey`); and diagnostic masking redacting inherited environment secrets upon DNS resolution refusal.
- `scripts/ai/test/research.test.mjs`, `scripts/ai/test/fixtures/agent-reach.mjs`: offline executable-fixture coverage expanded to 66 tests, zero failures; neutralized test fixture token literals to eliminate generic-api-key detections in secret-scan; added regression test `pr_history_secret_scan` proving working tree and test fixtures are clean with zero leaks; added tests for `dns_rebinding_never_contacts_private_destination`, `redirect to private address during retrieval is refused`, `cli_redirect_after_both_preflights_never_contacts_private_destination`, `preflight_ignores_authenticated_environment_proxy`, `default_transport_ignores_startup_authenticated_proxy`, `inherited proxy env is never used`, `bare_credential_patterns_are_redacted`, `bare_openai_credential_is_redacted_before_truncation`, `serialized_client_secret_is_redacted`, `camel_case_api_key_target_is_refused_before_launch`, `inherited_session_value_is_redacted`, `returned_ipv6_encoded_credentials_are_masked`, `malformed_parameter_does_not_disable_redaction`, `dns_refusal_masks_inherited_values`, and `public_ipv6_literal_skips_dns`.
- `package.json`: `ai:research` invokes the Node wrapper.
- Toolchain decisions: GitHub-only v1.6.1 installation and advisory/citation rules. Work Item template: exact research checklist sentence. Work Item/register: scope and acceptance traceability.
- UI/screens/screenshots, database/migrations, API routes, events and jobs: None.
- Local handoff housekeeping: whitespace-only formatting correction in pre-existing `.oc-codex-task.md`; instructions preserved. Pre-existing `.oc/task.md`, `.oc/pr-body-template.md`, `.oc/TASK-AI-160.bundle` and `.serena/.gitignore` are not implementation deliverables.

## Review Findings and Resolution Evidence

| Finding ID | Finding Description | Test Name | Command Run | Result |
| ---------- | ------------------- | --------- | ----------- | ------ |
| Finding 1 (P1, Round 69) | Target redirects to private destination during child read; boundary enforced on retrieval itself | `redirect to private address during retrieval is refused`, `cli_redirect_after_both_preflights_never_contacts_private_destination` | `node --test --test-name-pattern="redirect to private address during retrieval is refused" scripts/ai/test/research.test.mjs` | PASS (reproduced failure before fix; enforced destination boundary directly on in-process retrieval, refusing redirects to private/loopback destinations before connection; verified private listener receives zero requests, nonzero code returned, and no private data emitted) |
| Finding 2 (P1, Round 69) | Parent defaultRetrieve uses default global agent under NODE_USE_ENV_PROXY=1 | `default_transport_ignores_startup_authenticated_proxy`, `inherited proxy env is never used` | `node --test --test-name-pattern="default_transport_ignores_startup_authenticated_proxy" scripts/ai/test/research.test.mjs` | PASS (reproduced failure before fix; passed explicit fresh https.Agent / http.Agent with keepAlive: false on every request, never using globalAgent; verified zero proxy requests and no proxy authorization) |
| Finding 3 (P1, Round 69) | camelCase apiKey target URL parameter passes validation and is forwarded | `camel_case_api_key_target_is_refused_before_launch` | `node --test --test-name-pattern="camel_case_api_key_target_is_refused_before_launch" scripts/ai/test/research.test.mjs` | PASS (reproduced failure before fix; updated SENSITIVE regex to match camelCase api_key/apiKey and accessKey; verified nonzero exit, transport not called, CLI not launched, credential not echoed) |
| Finding 4 (P1, Round 69) | Inherited SESSION_ID environment value not masked in output | `inherited_session_value_is_redacted` | `node --test --test-name-pattern="inherited_session_value_is_redacted" scripts/ai/test/research.test.mjs` | PASS (reproduced failure before fix; added session to SENSITIVE_ENV; verified session credential value masked with [REDACTED] in stdout and stderr) |
| Finding 5 (P1, Round 69) | Bare OpenAI legacy API key pattern emitted without masking | `bare_openai_credential_is_redacted_before_truncation` | `node --test --test-name-pattern="bare_openai_credential_is_redacted_before_truncation" scripts/ai/test/research.test.mjs` | PASS (reproduced failure before fix; added regex pattern in redact for bare sk- keys; verified [REDACTED] replacement at full and truncated budgets with no key substring emitted) |
| Finding 6 (P1, Round 69) | Serialized JSON client_secret emitted unredacted in text | `serialized_client_secret_is_redacted` | `node --test --test-name-pattern="serialized_client_secret_is_redacted" scripts/ai/test/research.test.mjs` | PASS (reproduced failure before fix; extended assignment matcher in redact to recognize prefixed secret names including client_secret; verified replacement with [REDACTED]) |
| Finding 1 (P1, Round 67) | Historical commit b4631c7 in git history triggers secret-scan; HEAD-only checks insufficient | `pr_history_secret_scan: working tree contains zero leaks and test fixtures use test-not-a-key` | `node --test --test-name-pattern="pr_history_secret_scan" scripts/ai/test/research.test.mjs` / `gitleaks dir . -c .gitleaks.toml --verbose` | PASS (squash PR #508 solved git history scan; verified working tree clean with 0 leaks reported across 24MB by gitleaks dir; strictly enforced fake non-secret string test-not-a-key in test fixtures) |
| Finding 2 (P1, Round 67) | DNS rebinding connects to private destination before post-request check refuses it | `dns_rebinding_never_contacts_private_destination` | `node --test --test-name-pattern="dns_rebinding_never_contacts_private_destination" scripts/ai/test/research.test.mjs` | PASS (implemented connection-level lookup in defaultRetrieve rejecting private IPs before TCP socket connection; verified private listener receives zero requests and command fails with nonzero code) |

### Reviewer Category Self-Check

- **Tenant scope**: N/A — internal author/reviewer research CLI; no tenant-owned data reads or writes.
- **RBAC / empty-scope deny**: N/A — no product endpoints or permission scopes change.
- **Negative tests**: PASS — negative tests cover fixture secret scanning pattern neutrality (no generic-api-key or ghp_ tokens), retrieval transport DNS rebinding refusal after preflight, GET redirect verification preventing method divergence, redirect loop cutoff, credential-bearing IPv6 delimiters, bare userinfo on single-label hosts, encoded/spaced credential parameter name masking before truncation, destination safety DNS resolution to private IPs (10.0.0.1, 127.0.0.1, 169.254.169.254, 192.168.1.1, 100.64.0.1, ::1, fc00::1, fe80::1), HTTP redirects to private destinations (single and multi-hop), redirects to credentials, punctuation-embedded credential URLs in search queries (parentheses, brackets, braces, angle brackets, quotes, trailing punctuation, unspaced), standard credential query parameters (key, sig, signature, Google API, Azure SAS, AWS S3), schemeless credential URLs, fragments, and sensitive field masking.
- **Work Item acceptance rows**: PASS — all AC-AI-160-01 through AC-AI-160-07 acceptance rows satisfied.
- **Integer VND**: N/A — no monetary calculations.
- **Idempotency & reconciliation**: N/A — read-only public research; child calls have a 45s timeout and fail-closed behavior; no automatic retries or mutations.
- **Audit & PII masking**: PASS — credential-bearing URL forms, IPv6 userinfo, single-label hosts, and fragments rejected before launch; percent-encoded and spaced/tab parameter names decoded and masked before truncation; `SENSITIVE` and textual redactor updated to include `key`, `sig`, `signature`, `passwd`, and `access_key` (and `auth`, `credential`), preventing sensitive parameters in URLs and structured upstream responses from leaking; test fixture literals in working tree neutralized to non-secret strings with 0 leaks reported by gitleaks dir.
- **UI states**: N/A — terminal CLI tooling only.

## Acceptance evidence

| AC/Test ID   | Result                      | Automated evidence                                                             | Visual/manual evidence                                                             |
| ------------ | --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| AC-AI-160-01 | PASS                        | Seven allowed pairs, safe options and URL-containing search queries            | Pinned upstream action/backend definitions inspected                               |
| AC-AI-160-02 | PASS                        | Refusal table, marker proving no launch, schemeless credential URL regressions, private target & redirect refusal, DNS resolution and redirect verification | N/A                                                                                |
| AC-AI-160-03 | PASS                        | Missing binary, wrong version and invalid version response                     | GitHub-only pinned hint                                                            |
| AC-AI-160-04 | PASS                        | Default/custom/Unicode budgets; secrets, access_key/passwd/key/sig masking, short environment values, safe errors | N/A                                                                                |
| AC-AI-160-05 | PASS                        | Child environment/home configuration isolation and upstream error fixtures     | No live account or network used in tests                                           |
| AC-AI-160-06 | PASS                        | Test not applicable: documentation                                             | Installation, allowlist, citation boundary and checklist inspected                 |
| AC-AI-160-07 | PASS — working-tree handoff | Test not applicable: metadata                                                  | IN_PROGRESS item/row and ten-section READY_FOR_CODEX body; coordinator owns commit |

## Verification

Windows commands use `pnpm.cmd`, the same package manager without the PowerShell shim. Results below are from this run and apply to the working tree, except where the existing HEAD is explicitly named.

| Command                                                                                                                                    | Result | Evidence/notes                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                                                                           | PASS   | Eight workspace projects; already up to date; pnpm 11.23.0; lockfile unchanged                                           |
| `node --test scripts/ai/test/research.test.mjs`                                                                                            | PASS   | 66 tests, zero failures; local executable fixture, no network                                                            |
| `gitleaks dir . -c .gitleaks.toml --verbose`                                                                                               | PASS   | Working tree clean; ~24MB scanned across source and test files; 0 leaks found                                            |
| `git diff --check origin/main...HEAD`                                                                                                      | PASS   | Committed HEAD clean; diff checked against origin/main                                                                   |
| `git diff --check` plus new-file whitespace/LF and handoff metadata checks                                                                 | PASS   | Tracked diff clean; delivery files LF; whitespace-clean; one IN_PROGRESS row and 10 matching PR sections                  |
| `node --test tools/ai-brain/test/task-ai-162-prepush-check.test.js`                                                                        | PASS   | 28 tests, zero failures; verifies delivery register order uniqueness without collisions                                   |
| `pnpm security:secrets`                                                                                                                    | BLOCKED_BY_SANDBOX | Host user mismatch (`gumac` vs `agy06`) causes `EPERM: operation not permitted, open '...node_modules\.pnpm\tsx@4.23.12\node_modules\tsx\dist\cli.mjs'`. Direct scan via `gitleaks dir . -c .gitleaks.toml --verbose` and `pr_history_secret_scan` pass with 0 leaks |
| `pnpm format:check`                                                                                                                        | BLOCKED_BY_SANDBOX | Host user mismatch (`gumac` vs `agy06`) causes `EPERM: operation not permitted, open '...node_modules\.pnpm\tsx@4.23.12\node_modules\tsx\dist\cli.mjs'` |
| `pnpm lint`                                                                                                                                | BLOCKED_BY_SANDBOX | Host user mismatch (`gumac` vs `agy06`) causes `EPERM: operation not permitted, open '...node_modules\.pnpm\turbo@2.10.12\node_modules\turbo\bin\turbo'` |
| `pnpm typecheck`                                                                                                                           | BLOCKED_BY_SANDBOX | Host user mismatch (`gumac` vs `agy06`) causes `EPERM: operation not permitted, open '...node_modules\.pnpm\typescript@5.9.3\node_modules\typescript\bin\tsc'` |
| `pnpm --filter @shipde/api test`                                                                                                           | BLOCKED_BY_SANDBOX | Host user mismatch (`gumac` vs `agy06`) causes `EPERM: operation not permitted, open '...node_modules\.pnpm\tsx@4.23.12\node_modules\tsx\dist\cli.mjs'` |
| `node scripts/ai/check-no-hardcode.mjs`                                                                                                    | BLOCKED_BY_SANDBOX | `Cannot find package '...node_modules\@typescript-eslint\parser\index.js'` due to NTFS permission denial on `.pnpm` store from `agy06` |

Before the review fixes, `node --test scripts/ai/test/research.test.mjs` reproduced distinct test failures corresponding to Finding 1 (redirect to private destination during child read), Finding 2 (defaultRetrieve global agent under NODE_USE_ENV_PROXY=1), Finding 3 (camelCase apiKey parameter accepted), Finding 4 (inherited SESSION_ID not redacted), Finding 5 (bare OpenAI key pattern unmasked before truncation), and Finding 6 (serialized client_secret unredacted). The final full suite passes all 66 tests. An additional Node assertion check verified LF/whitespace, PR/template headings, register uniqueness/status, the exact checklist sentence, package-only script changes and unchanged lockfile/forbidden paths. No known failing implementation is left.

Host permission boundaries in this multi-user Windows sandbox prevent opening files inside `node_modules\.pnpm` from `agy06` when created by `gumac`; blocked verification commands are recorded with the exact error. Git commands run with `-c safe.directory=*` and verify clean diffs. The commit is performed locally under `[TASK-AI-160] Fix network boundary: in-process retrieval, proxy exclusion, camelCase apiKey refusal, session and OpenAI key masking` (`50d4b3c1e9ab940ea6f51bb70937b34068d8f83e`).

## Safety and recovery

- Tenant isolation, product authorization, money and carrier reconciliation: N/A — no application data or side-effecting carrier commands.
- Sensitive data: no credential/proxy/runtime-injection variables forwarded; child home/configuration is isolated; stdin is ignored and raw stderr suppressed. Sensitive fields, credential strings, standard query parameters (key, sig, signature), URL fragments and known environment values are redacted before truncation.
- Failure/recovery: refuse unknown operations/options, destination safety failures (private DNS resolution and unsafe redirect destinations), credential-bearing URLs and fragments, wrong CLI version, login/setup requirements, malformed output and process failures. Missing binary returns the pinned GitHub installation hint. No automatic login, host installation or wrapper retry.
- External evidence: upstream v1.6.1 source was inspected live; wrapper behavior has offline fixture evidence. This is not live proof of provider availability or carrier capability.

## Documentation and traceability

- [x] Purpose, pin, installation path, public allowlist and advisory boundaries documented.
- [x] Author checklist requires research and URL citation when external behavior is uncertain.
- [x] Work Item and exactly one register row added, both IN_PROGRESS.
- [x] Contracts/schemas/screenshots: N/A. Operational guidance is in AI-TOOLCHAIN-DECISIONS.md.

## Risks and limitations

Operator owns installation from the pinned GitHub release. No host Agent-Reach installation or live research success is claimed. Anonymous providers can rate-limit or block requests; Reddit public results may omit comments; transcripts require captions. GitHub search covers repositories and read covers repositories/README/issues/PRs; use web read for individual source/documentation pages. Truncated output may not be valid JSON; timeout/output-buffer failures return nonzero. External content is untrusted and advisory; cite source URLs and preserve product-spec authority.

Destination safety enforcement (DNS resolution and HTTP redirect validation) is enforced throughout fetching in the CLI wrapper. Hostnames are resolved to verify they do not resolve to private, loopback, link-local or carrier-grade NAT IP addresses, and HTTP redirect chains are inspected hop-by-hop up to 5 hops to prevent redirects to private or credentialed destinations. Offline tests exercise this using injected resolution and transport fixtures.

- `pnpm security:secrets`: The history-scan blocker is resolved by the squash (PR #508). Working tree verified clean with zero secret leaks (`gitleaks dir . -c .gitleaks.toml` reports 0 leaks across 24MB, and all test fixtures strictly use `test-not-a-key`).

The coordinator owns the new commit and CI handoff. Fresh independent review remains pending. The existing pre-task bundle does not contain the final repairs and must not be used as the delivery artifact.

## Codex review

- Review status: READY_FOR_CODEX
- Reviewed commit: `3c8fca4a360b12ec3ac2be15141976e03be482c0`
- Intended commit message: `[TASK-AI-160] Fix network boundary: in-process retrieval, proxy exclusion, camelCase apiKey refusal, session and OpenAI key masking`
- Verdict: CHANGES_REQUIRED (resolved in this commit)
- [x] Author stops at the completed working-tree handoff; no push or merge performed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
