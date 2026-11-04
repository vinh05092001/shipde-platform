# TASK-AI-160 — Pull Request body

## Slice A = this PR; Slice B = docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md, docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md (non-core guidance)

All files are under 300 lines (max is `scripts/ai/research.mjs` at 254). No further splitting needed.

## Work Item

- ID: `TASK-AI-160`
- Feature ID: `N/A` — internal author/reviewer research tooling
- Branch: `feat/task-ai-160-agent-reach`
- Author: `CODEX`
- Reviewer: `Codex — fresh independent task`

## Business outcome

Writers and reviewers can consult real carrier API documentation, library examples and public reference repositories instead of guessing uncertain external behavior, reducing review rounds. Sources remain advisory and must be cited by URL in the Pull Request.

## Files changed

| File                                                                       | Lines | Purpose                                                                                                                                 |
| -------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ai/research.mjs`                                                  | 254   | Root `ai:research` wrapper: argument validation, isolated child env, pinned version check, redaction/truncation, public-target boundary |
| `scripts/ai/research-safety.mjs`                                           | 131   | Shared safety helpers: public-target assertion, secret collection, redaction, query URL scanning, budget truncation, ssrf-guard fetch   |
| `scripts/ai/test/research.test.mjs`                                        | 150   | Offline AC fixture tests (8 suites / 72 assertions)                                                                                     |
| `scripts/ai/test/fixtures/agent-reach.mjs`                                 | 67    | Local Node fixture executable simulating Agent-Reach CLI                                                                                |
| `package.json`                                                             | +4    | `ai:research` script registration                                                                                                       |
| `pnpm-lock.yaml`                                                           | +26   | `ssrf-guard@1.0.0` dependency pinning                                                                                                   |
| `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`     | +34   | `AI-TOOL-01`, `AI-TOOL-10`, `AI-TOOL-11` advisory adoption entries                                                                      |
| `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`         | +1    | Template clarification                                                                                                                  |
| `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` | +1    | Register row for TASK-AI-160                                                                                                            |
| `docs/product-spec/work-items/TASK-AI-160.md`                              | 153   | Work Item specification                                                                                                                 |

## Acceptance matrix

| AC           | Result | Evidence                                                                                                                           |
| ------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| AC-AI-160-01 | PASS   | Offline fixture: each allowed pair uses the pinned anonymous backend; transcript maps to subtitle                                  |
| AC-AI-160-02 | PASS   | Offline fixture: mutation, login, unknown pair/option, malformed budget and unsafe target refused before CLI launch; no input echo |
| AC-AI-160-03 | PASS   | Offline fixture: missing binary, wrong version and invalid version response report the pinned GitHub-only install hint             |
| AC-AI-160-04 | PASS   | Offline fixture: output redacted before truncation and fits the `--max-chars` budget                                               |
| AC-AI-160-05 | PASS   | Offline fixture: child environment cannot inherit credentials, proxies or operator config; no raw stderr or login fallback         |
| AC-AI-160-06 | PASS   | Docs inspection: installation, anonymous access, citation rules, checklist and register row documented                             |
| AC-AI-160-07 | PASS   | Log/docs inspection: IN_PROGRESS Work Item, one register row, ten-section PR body, checks recorded truthfully                      |

## Commands run

| Command                                         | Result                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                | PASS — all 8 workspace projects up to date                                                                                                          |
| `pnpm lint`                                     | PASS — 12/12 tasks, 0 errors (1 pre-existing warning in `apps/web/src/components/shell/AppShell.tsx`, unrelated)                                    |
| `pnpm format:check`                             | BLOCKED_BY_SANDBOX — pre-existing `.oc/probe*.mjs` files fail Prettier; none are files of this Work Item. All TASK-AI-160 files are Prettier-clean. |
| `pnpm typecheck`                                | PASS — 12/12 tasks                                                                                                                                  |
| `node --test scripts/ai/test/research.test.mjs` | PASS — 8 tests, 72 assertions, 0 failures                                                                                                           |
| `node scripts/ai/check-no-hardcode.mjs`         | PASS — 0 raw instances, 0 new                                                                                                                       |
| `git diff --check origin/main...HEAD`           | PASS — no whitespace errors in committed diff                                                                                                       |

## Security, tenancy and regression notes

- No product data access; tenant scope N/A.
- Child process runs in an isolated temp directory with a minimal environment (PATH, TMP, HOME only); no credentials, proxies, cookies, tokens or operator config are inherited.
- Output is redacted before truncation; raw child stderr is never surfaced.
- `ssrf-guard@1.0.0` enforces DNS resolution and per-hop redirect validation on every retrieval hop; loopback, private, link-local, carrier-grade NAT, multicast and reserved destinations are refused.
- All tests run offline with a local Node fixture; no network access is required or claimed.

## Known limitations

- Anonymous services may be rate-limited or blocked; captionless videos return failure rather than keyed transcription.
- Live Agent-Reach network execution is not claimed by offline fixture evidence.
- Operator owns installation and retries or uses another approved public source.

## Slice

Slice A = this PR; Slice B = none (all AC-scoped files included; total exceeds 400 only if unavoidable)
