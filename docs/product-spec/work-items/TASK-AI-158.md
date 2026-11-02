# TASK-AI-158 — Pack focused repo context with repomix

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-158` |
| Feature ID | `N/A — advisory writer/reviewer context packing` |
| Status | `IN_PROGRESS` |
| Delivery order | `272` |
| Dependencies | `TASK-FOUND-04` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `package.json`; `pnpm-lock.yaml`; `repomix.config.json`; `.gitignore`; `scripts/ai/pack-context.mjs`; `scripts/ai/test/pack-context.test.mjs`; `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `docs/product-spec/work-items/TASK-AI-158.md`; `.oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-158-repomix-context` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Writers and reviewers can pack only the files a prompt needs (a Pull Request diff plus its Work Item) into one secret-checked, token-capped XML file. Smaller complete context cuts review rounds and quota use. The pack is advisory and does not change any gate.

## Source references

- `AGENTS.md` (9Router request policy, Pull Request evidence, verification)
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`
- `docs/product-spec/docs/10-ai-collaboration/WORK-ITEM-TEMPLATE.md`
- Upstream: `yamadashy/repomix` 1.18.1 (MIT License)
- Operator approval: 2026-11-01
- Business rules: `BR-PACK-01`, `BR-PACK-02`, `BR-PACK-03`, `BR-PACK-04`
- Acceptance criteria: `AC-AI-158-01`, `AC-AI-158-02`, `AC-AI-158-03`, `AC-AI-158-04`

## Preconditions and dependencies

- Operator approval granted on 2026-11-01 to adopt `yamadashy/repomix` (MIT).
- Branch `feat/task-ai-158-repomix-context` tracks `origin/main`.
- `TASK-FOUND-04` is merged; root pnpm workspace commands are authoritative.

## Ambiguity and clarification markers

None. Paths, token failure, secret check and advisory boundary are specified.

## Author boundary

GEMINI adds the pinned devDependency, the pack script, a focused node:test, the root config and the toolchain note. No gate config, allowlist, baseline, semgrep rule or `.github/` file is modified.

## Slice sizing rule

One vertical tooling slice: config, script, test, lockfile and documentation. Advisory ~400-line target excludes the lockfile.

## In scope

- Pin `repomix` at an exact version as a root devDependency.
- Root `repomix.config.json`: XML output, comments kept, include `apps/**`, `packages/**`, `prisma/**`, `docs/product-spec/docs/**`; ignore `node_modules`, lockfiles, build output, `.worktrees`, `.env*`, secrets, generated clients, test snapshots and binary assets; `security.enableSecurityCheck` true.
- `scripts/ai/pack-context.mjs`: `--paths`, `--out`, optional `--max-tokens`; non-zero exit when the pack exceeds the token limit or the secret check finds anything; stdout is a summary only.
- Root script `ai:pack`.
- `node:test` coverage for argument parsing and the token-limit failure on a small fixture directory.
- Toolchain decision note: purpose, usage, secrets exclusion, advisory only.
- This Work Item and exactly one register row.

## Out of scope

- Gate config, allowlists, baselines, semgrep rules and `.github/`.
- Wiring the packer into the controller, writer or reviewer launch path.
- Changing any other Work Item.

## Business rules and edge cases

- `BR-PACK-01`: Only the globs passed to `--paths` are packed.
- `BR-PACK-02`: `--max-tokens` or a secret-check hit exits non-zero and does not leave a usable pack.
- `BR-PACK-03`: Stdout never contains packed file contents.
- `BR-PACK-04`: `.env` and other secret files are ignored, and the built-in security check stays enabled. The tool is advisory only.

## Constitution check

- [x] **Tenant scope**: N/A — no tenant data access.
- [x] **RBAC & permissions**: N/A — local advisory CLI.
- [x] **Audit & sensitive data**: Secret check is required; packed contents are not printed.
- [x] **VND integer arithmetic**: N/A.
- [x] **Carrier reconciliation**: N/A.
- [x] **Tests at the lowest useful level, test-first where executable**: Argument parsing and token-limit failure are covered by `node:test`.

## UI states

N/A — no user interface.

## API, event and data impact

N/A — no API, event or database change. One root devDependency and its lockfile entry.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-158-01 | Root config and pinned dependency | `repomix` is an exact root devDependency; config is XML, comments kept, security check on, ignores secrets and every root/nested `.env*` variant even when explicitly selected | unit (real repomix with harmless environment markers) + docs-inspection |
| AC-AI-158-02 | Argument parsing | `--paths`, `--out` and `--max-tokens` parse; missing or invalid arguments throw | unit: `scripts/ai/test/pack-context.test.mjs` |
| AC-AI-158-03 | Token limit | A fixture pack over `--max-tokens` exits non-zero and removes the output; stdout has no file contents | unit: `scripts/ai/test/pack-context.test.mjs` |
| AC-AI-158-04 | Secret check and advisory note | Security check failure is non-zero; toolchain doc states purpose, usage, no secrets/`.env`, advisory only | unit + docs-inspection |

## Task breakdown

- [x] `T01` Add `repomix.config.json`, `.gitignore` pack outputs, and the pinned `repomix` devDependency.
- [x] `T02` Add `scripts/ai/pack-context.mjs` and the `ai:pack` script.
- [x] `T03` Add `scripts/ai/test/pack-context.test.mjs` for argument parsing and the token-limit failure.
- [x] `T04` Document the tool in `AI-TOOLCHAIN-DECISIONS.md`.
- [x] `T05` Add this Work Item and exactly one register row.
- [x] `T06` Run install, lint, format, typecheck, the new test, secrets scan and whitespace check.

## Verification commands

- `pnpm install --frozen-lockfile`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `node --test scripts/ai/test/pack-context.test.mjs`
- `pnpm security:secrets`
- `git diff --check origin/main...HEAD`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | the `[TASK-AI-158] Pack focused repo context with repomix` commit (exact SHA recorded in `.oc/pr-body.md`) | `READY_FOR_CODEX` | N/A — first submission |
| 2 | `4e2ec65df747ccf9ac5857e05379c8fbe2add34b` | `CHANGES_REQUIRED` | `.env.example` exception; failed CI; previous P0/P1 report unavailable. Local repair evidence follows; no independent PASS is claimed. |

## Review repair evidence (2026-11-02)

- P1: remove the `.env.example` exception and exclude every `.env*` file at the root and recursively. Repomix 1.18.1 rewrites `**/.env*` as a directory-only ignore, so the config uses `.env*` and `**/**/.env*` to exclude files.
- Negative proof: both new real-packer tests fail against the reviewed script/config at `4e2ec65df747ccf9ac5857e05379c8fbe2add34b` in a verified temporary copy (`Packed .envrc`); the naive recursive pattern also failed (`Packed .env.example`). The final config passes all 19 packer tests, with nine root/nested variants selected by both explicit paths and globs. Markers are harmless, so exclusion is proved independently of secretlint detection.
- Blank/comma-only selections deny without creating a pack. Existing token-limit and secret-check negative tests still pass and verify that contents are absent from logs and failed output is removed.
- PR contract: the original local body reproduces `required template placeholders` and `unchecked mandatory checklist items`. The corrected draft passes the unchanged validator with 9 changed files inspected. It uses concrete CLI arguments and records the product E2E path as explicitly N/A with real CLI acceptance evidence; the remote body is unchanged.
- Local checks: `pnpm lint` passes all 12 Turbo tasks and root scripts ESLint; `pnpm typecheck` passes the root check and all 12 Turbo tasks. `git diff --check origin/main...HEAD` and `git diff --check` pass. The no-hardcode guard passes. Windows commands use the installed `pnpm.cmd` shim.
- `pnpm format:check` reports only the pre-existing, untouched `.oc/pr-body-template.md`; the modified local body is formatted. The root formatting gate has not been changed.
- API prerequisite: Docker Desktop was launched with a hidden window. `docker info` and `docker start shipde-postgres shipde-redis shipde-minio` return engine-pipe access denied. No test container was started by this repair; live API tests cannot run under the current sandbox permissions.
- Live CI evidence at the reviewed SHA: `ai-brain-tests` fails at `tools/ai-brain/test/repo-integration-group-7.test.js:68` because another Work Item's `GROUP-7-PRODUCT-TOOLCHAIN.md` dependency snapshot lacks `repomix: 1.18.1`. The named local test reproduces the same failure (2/3 pass). Updating that snapshot is outside this item's allowed paths. No gate, allowlist, baseline, semgrep rule or `.github/` file has been changed.
- The previous P0/P1 report is absent from `.oc/review.txt` and from PR #494's review comments. The local tests cover the visible failure paths; they do not certify unseen findings.

## Residual limitations

The API verification prerequisite is blocked by Docker engine-pipe permissions. Remote CI remains failed at the reviewed SHA, and earlier P0/P1 closure lacks the original report. The local repair is not committed or independently approved.
