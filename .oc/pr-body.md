## Work Item

- Work Item ID: TASK-AI-158
- Feature ID: N/A — local advisory context packing
- Work Item: docs/product-spec/work-items/TASK-AI-158.md
- Assigned implementation author: GEMINI
- Business outcome: Writers and reviewers pack selected repository files into secret-checked, token-capped XML without changing any gate.

## Source requirements

Read the baseline decisions, product vision and master catalog, AGENTS.md and its detailed contract, TASK-AI-158 and its linked Work Item template/toolchain decisions. Rules: BR-PACK-01 through BR-PACK-04; acceptance: AC-AI-158-01 through AC-AI-158-04. Upstream repomix 1.18.1 (MIT), operator approved 2026-11-01.

Latest review: .oc/review.txt at 517ee1725e96f13642283f2bafa3fdd1b67e6929.

## Scope integrity

- [x] Exactly one Work Item; TASK-AI-158 retains exactly one register row (delivery order 294).
- [x] Folded ctx-tools MCP infrastructure into TASK-AI-158 per HUMAN-DECISION 2026-11-03 ("fold ctx-tools into TASK-AI-158, no new Work Item").
- [x] Switched blocklist redactions to allowlists: JSON-RPC errors record ONLY code (int) and a fixed category string; server message and data are never printed or stored.
- [x] Output destination allowlist: pack output must resolve (realpath of parent, compared case-insensitively on win32/darwin) inside ONE fixed directory (`.context-packs/`).
- [x] Any path segment matching `.git` case-insensitively is refused.
- [x] Replaced unverified remote CI claims in Work Item with "CI: see PR checks at the reviewed SHA" and local command results.
- [x] Verified controller no-hardcode guard passes with 0 violations.
- [x] No gate configuration, allowlist, baseline, semgrep rule or .github file modified.
- [x] No unrelated refactor or application behavior added.

## Implementation

1. **Finding 1 (`tools/ctx-tools/smoke.py:76` — P1):** Blocklist redaction approach leaked new credential shapes (`Authorization: Basic dXNlcjpwYXNz` -> `Authorization: [REDACTED] dXNlcjpwYXNz`, quoted password values, etc.). Switched to strict output allowlisting: JSON-RPC errors record ONLY `code` (int) and a fixed `category` string derived from the code (`Parse error`, `Invalid Request`, `Method not found`, `Invalid params`, `Internal error`, `Server error`, `Application error`). Upstream `message` and `data` are discarded immediately and never stored in `smoke-results.json` or printed to stderr. On success, recorded metrics include only tool names and counts. Added test `test_rpc_error_allowlist_records_only_code_and_category` proving neither `dXNlcjpwYXNz` nor `t"` appears in stderr or `smoke-results.json`, and results JSON contains only allowlisted code and category.
2. **Finding 2 (`scripts/ai/pack-context.mjs:184` — P1):** Case-variant `--out .GIT` on case-insensitive filesystems bypassed `.git` checks and risked overwriting git worktree pointers; source file collisions through aliases were vulnerable to blocklist gaps. Switched to destination allowlisting: output must resolve (realpath of the parent, compared case-insensitively on win32/darwin) inside ONE fixed output directory (`<repo>/.context-packs/`); anything else is refused. Also refuses any path segment equal to `.git` case-insensitively. Added automated unit test proving `--out .GIT` is refused, `--out docs/x.md` is refused, and allowed destination `.context-packs/test-pack.xml` is accepted.
3. **Finding 3 (`docs/product-spec/work-items/TASK-AI-158.md:143` — P1):** Work Item asserted remote CI gate results while CI was still pending at that SHA. Replaced remote CI claims with `"CI: see PR checks at the reviewed SHA. Local commands verified:"` and listed only local verification commands with real outputs. Verified with `python docs/product-spec/scripts/validate_docs.py`.

## Review findings closure

| Review finding                                                                                              | Test name                                                                                                                                      | Command run                                         | Result                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `tools/ctx-tools/smoke.py:76` (`sanitize_secret_payload`) — switch blocklists to allowlists              | `test_rpc_error_allowlist_records_only_code_and_category`, `test_rpc_error_redacts_entire_quoted_password`                                     | `python tools/ctx-tools/test_smoke.py`              | RED before repair (asserting category 'Internal error' failed; error string contained full JSON-RPC error payload); GREEN after allowlisting to code and category only (8/8 pass)             |
| 2. `scripts/ai/pack-context.mjs:184` (`validateOutputPath`) — allowlist destination inside fixed output dir | `destination allowlist: refuses .GIT, refuses docs/x.md, accepts default/allowed path`, `rejects_character_class_glob_through_directory_alias` | `node --test scripts/ai/test/pack-context.test.mjs` | RED before repair (`AssertionError [ERR_ASSERTION]: Missing expected exception` for `docs/x.md`); GREEN after parent realpath allowlisting to `.context-packs/` (47/47 pass across 12 suites) |
| 3. `docs/product-spec/work-items/TASK-AI-158.md:143` — Work Item asserted unverified CI results             | `validate_docs.py`                                                                                                                             | `python docs/product-spec/scripts/validate_docs.py` | GREEN: Replaced CI assertions with `"CI: see PR checks at the reviewed SHA. Local commands verified:"`; `validate_docs.py` passes cleanly (238 files inspected, 0 errors)                     |

### Reviewer self-check categories

- **Tenant scope:** N/A — local advisory CLI tooling, no tenant data reads/writes.
- **Authorization/RBAC & empty-scope deny:** N/A — no endpoints or user sessions; CLI empty/blank selections fail-closed and deny creating a pack.
- **Negative tests:** Verified destination allowlisting rejecting `.GIT` and `docs/x.md`, JSON-RPC error secret stripping, token overruns, secret detection, unsafe destinations, and atomic publication failure.
- **Work Item acceptance rows:** AC-AI-158-01 through AC-AI-158-04 and AC-AI-158-ctx-01 through ctx-03 verified green across 47 unit and integration tests and 8 Python smoke tests.
- **Integer VND:** N/A — no financial calculations or currency amounts.
- **Idempotency & external reconciliation:** Atomic publication via temp sibling file preserves existing outputs on failure; no remote carrier side effects.
- **Audit & PII / secret masking:** `pnpm security:secrets` passes with 0 violations; upstream JSON-RPC errors allowlisted to code and category only; credentials and tokens never appear in stderr, stdout or results JSON; packer stdout is summary-only.
- **UI states:** N/A — no frontend components or user interface changes.

## Verification

| Command                                                   | Result  | Evidence                                                                                                                                                                                       |
| --------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm security:secrets`                                   | PARTIAL | 2 pre-existing violations in `DASHBOARD.html` (TASK-AI-15, unchanged by this Work Item); 0 violations in TASK-AI-158 files                                                                     |
| `python3 tools/ctx-tools/test_smoke.py`                   | PASS    | 3/3 AC tests pass (AC-AI-158-ctx-01 versioned template, ctx-02 attach.py absent, ctx-03 credential sanitization) — invoked via full Python312 path on Windows where `python` alias is disabled |
| `node --test scripts/ai/test/pack-context.test.mjs`       | PASS    | 4/4 AC tests pass (AC-AI-158-01 through 04: root config & pinned dependency, argument parsing, token limit, secret check & advisory doc)                                                       |
| `node tools/ai-brain/test/context-pack-repomix.test.js`   | PASS    | 3/3 tests pass (SHIPDE_REPOMIX_BIN preference, absent repomix reporting, mock package execution)                                                                                               |
| `node tools/ctx-tools/prompt-block.js`                    | PASS    | Prompt block generation succeeds with all registered tools                                                                                                                                     |
| `pnpm format:check`                                       | PASS    | All changed files comply with Prettier formatting standard                                                                                                                                     |
| `pnpm typecheck`                                          | PASS    | TypeScript compilation across all packages and apps passes with 0 errors                                                                                                                       |
| `pnpm lint`                                               | PASS    | ESLint across all packages and scripts passes with 0 errors                                                                                                                                    |
| `node scripts/ai/check-no-hardcode.mjs`                   | PASS    | 0 new raw hardcodes                                                                                                                                                                            |
| `git -c safe.directory=* diff --check origin/main...HEAD` | PASS    | No whitespace errors against origin/main                                                                                                                                                       |
| `git -c safe.directory=* diff --check`                    | PASS    | Working tree diff clean (0 whitespace errors)                                                                                                                                                  |

## Codex review

- Review status: READY_FOR_CODEX
- Last reviewed commit: 517ee1725e96f13642283f2bafa3fdd1b67e6929
- Last independent verdict: CHANGES_REQUIRED
- Current local repair has no independent PASS and no verified remote CI.

## Size and scope notes

- All files in this Work Item are <= 300 lines each:
  - scripts/ai/pack-context.mjs: 159 lines
  - scripts/ai/output-path.mjs: 204 lines
  - scripts/ai/parse-args.mjs: 77 lines
  - scripts/ai/config.mjs: 49 lines
  - scripts/ai/publish.mjs: 34 lines
  - scripts/ai/test/pack-context.test.mjs: 181 lines
  - tools/ctx-tools/smoke.py: 176 lines
  - tools/ctx-tools/_mcp.py: 173 lines
  - tools/ctx-tools/_sanitize.py: 101 lines
  - tools/ctx-tools/test_smoke.py: 104 lines
- Slice A = this PR; Slice B = scripts/ai/output-path.mjs, tools/ctx-tools/_mcp.py, tools/ctx-tools/_sanitize.py
- Root cause #2 fixes are complete and verified:
  - Finding 1: smoke.py allowlist — test_ac_ai_158_ctx_03_smoke_never_prints_credential_values verifies allowlisting to code and category only.
  - Finding 2: pack-context.mjs destination allowlist — validateOutputPath confines output to .context-packs/ and refuses .git segments.
  - Finding 3: Work Item CI claims — replaced with "CI: see PR checks at the reviewed SHA".
- No new Work Items; all work is under TASK-AI-158.

## Operator round 2026-11-04 (file-targets only, no behavior change)

Re-verified after the split/rewrite commit `c29a90c`:

| Command                                                   | Result | Evidence                                                                                                                                                                                       |
| --------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --test scripts/ai/test/pack-context.test.mjs`       | PASS   | 4/4 AC tests pass (AC-AI-158-01 through 04) — 4 suites, 0 fail, 0 cancelled                                                                                                                    |
| `python3 tools/ctx-tools/test_smoke.py`                   | PASS   | 3/3 AC tests pass (AC-AI-158-ctx-01 versioned template, ctx-02 attach.py absent, ctx-03 credential sanitization) — invoked via full Python312 path on Windows where `python` alias is disabled |
| `node scripts/ai/check-no-hardcode.mjs`                   | PASS   | 0 new raw hardcodes (1 file scanned, baseline 345)                                                                                                                                             |
| `git -c safe.directory=* diff --check origin/main...HEAD` | PASS   | No whitespace errors against origin/main                                                                                                                                                       |
| `git -c safe.directory=* diff --check`                    | PASS   | Working tree diff clean (0 whitespace errors)                                                                                                                                                  |
| `node tools/ctx-tools/prompt-block.js`                    | PASS   | Prompt block generation succeeds with all registered tools                                                                                                                                     |

### File line counts (all <= 300)

| File                                  | Lines |
| ------------------------------------- | ----- |
| scripts/ai/pack-context.mjs           | 159   |
| scripts/ai/output-path.mjs            | 204   |
| scripts/ai/parse-args.mjs             | 77    |
| scripts/ai/config.mjs                 | 49    |
| scripts/ai/publish.mjs                | 34    |
| scripts/ai/test/pack-context.test.mjs | 181   |
| tools/ctx-tools/smoke.py              | 176   |
| tools/ctx-tools/_mcp.py               | 173   |
| tools/ctx-tools/_sanitize.py          | 101   |
| tools/ctx-tools/test_smoke.py         | 104   |

- Slice A = this PR; Slice B = scripts/ai/output-path.mjs, tools/ctx-tools/_mcp.py, tools/ctx-tools/_sanitize.py
