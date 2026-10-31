# TASK-AI-156 — Advisory pr-agent first-pass PR review

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-156` |
| Feature ID | `N/A — advisory PR reviewer toolchain integration` |
| Status | `IN_PROGRESS` |
| Delivery order | `269` |
| Dependencies | `TASK-AI-151` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `.github/workflows/pr-agent.yml`; `.pr_agent.toml`; `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`; `docs/product-spec/work-items/TASK-AI-156.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`; `.oc/pr-body.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-156-pr-agent` |
| Pull Request | `N/A — local authoring stage` |

## Business outcome

Enable automated advisory first-pass PR reviews using `qodo-ai/pr-agent` (MIT) to surface repository quality and specification issues early—specifically server-side tenant scoping, empty tenant scope denial, endpoint RBAC guards, masked PII/secrets, VND without floating-point math, carrier timeout reconciliation, and test coverage for new behaviors. This cuts down iterative `CHANGES_REQUIRED` review rounds with the independent reviewer while ensuring the advisory workflow can never block merges or replace independent Codex reviews.

## Source references

- `AGENTS.md` (Code review rules, Source of truth, Role separation, Unit of delivery)
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` (Advisory first-pass PR review: qodo-ai/pr-agent)
- Business rules: `BR-PRA-01`, `BR-PRA-02`, `BR-PRA-03`, `BR-PRA-04`, `BR-PRA-05`
- Acceptance criteria: `AC-AI-156-01`, `AC-AI-156-02`, `AC-AI-156-03`, `AC-AI-156-04`, `AC-AI-156-05`, `AC-AI-156-06`

## Preconditions and dependencies

- Operator approval granted on 2026-10-31 for introducing `qodo-ai/pr-agent` (MIT) and its dedicated `.github/workflows/pr-agent.yml` workflow.
- Preceding toolchain and workflow tasks merged into baseline.

## Author boundary

GEMINI is assigned as author for configuring the GitHub Actions workflow, repository review settings, toolchain documentation, register tracking, and handoff artifacts. The author is prohibited from modifying any other workflow, gate configuration, security allowlist, baseline, or semgrep rule, and must ensure `pr-agent` remains strictly advisory and non-blocking.

## In scope

- Create `.github/workflows/pr-agent.yml` triggered on `pull_request` (`opened`, `synchronize`, `ready_for_review`), running official `qodo-ai/pr-agent` pinned to release commit SHA `efdde4afe14aa401a3889012c7f3e9ef3081a430` (`v0.49.0`).
- Configure automated `/review` and `/improve` commands via environment variables and repository configuration.
- Wire OpenAI-compatible endpoint configuration via repository secrets: `PR_AGENT_API_BASE`, `PR_AGENT_API_KEY`, `PR_AGENT_MODEL`, with no hardcoded credentials or models.
- Implement preflight check in workflow that skips cleanly with a GitHub Actions notice and succeeds (exit 0) when secrets are absent or when the PR originates from a fork.
- Enforce strict permissions (`contents: read`, `pull-requests: write` only), 20-minute timeout, and `continue-on-error: true`.
- Create `.pr_agent.toml` at repo root with English review instructions drawn from `AGENTS.md` Code Review Rules (tenant scoping, empty scope denial, RBAC guards per endpoint, masked audit/PII, no floating-point VND, carrier timeout reconciliation, and tests for new behavior).
- Configure `.pr_agent.toml` to ignore lockfiles, generated files, and migration snapshots, and set max patch tokens sized for ~100KB chunks (`max_model_tokens = 25000`).
- Document toolchain adoption in `AI-TOOLCHAIN-DECISIONS.md`.
- Register the Work Item in `FEATURE-DELIVERY-REGISTER.csv` with status `IN_PROGRESS`.
- Author `.oc/pr-body.md` following `.oc/pr-body-template.md`.

## Out of scope

- Modifying existing workflows (`ai-brain-tests.yml`, `current-application.yml`, `feature-contract-gate.yml`, `product-spec-validation.yml`, `security-baseline.yml`).
- Adding `pr-agent` as a required status check in branch protection or gating scripts.
- Modifying controller state machines, supervisor logic, or gate validators.

## Business rules and edge cases

- `BR-PRA-01`: Advisory and non-blocking — `pr-agent` serves purely as an advisory pre-review tool. It must never block PR merges; `continue-on-error: true` is mandatory.
- `BR-PRA-02`: No credentials in repository — all endpoint credentials and model configurations are injected exclusively via repository secrets (`PR_AGENT_API_BASE`, `PR_AGENT_API_KEY`, `PR_AGENT_MODEL`). Hardcoding keys or models is strictly prohibited.
- `BR-PRA-03`: Clean skip on forks and missing secrets — when secrets are absent or when a PR originates from a fork, the job must skip cleanly with a notice and succeed (exit 0).
- `BR-PRA-04`: Independent review preservation — `pr-agent` comments never substitute or satisfy the independent Codex-family review required by `AGENTS.md`.
- `BR-PRA-05`: Least privilege permissions — workflow permissions are strictly restricted to `contents: read` and `pull-requests: write`.

## UI states

N/A — CI/CD workflow and toolchain configuration; no UI components modified.

## API, event and data impact

- Zero application APIs, database migrations, or persistent schemas modified.
- Added GitHub Actions workflow `.github/workflows/pr-agent.yml` reacting to `pull_request` events.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-AI-156-01 | Workflow configuration | Triggers on pull_request (opened, synchronize, ready_for_review), pinned to release commit SHA, commands /review and /improve, 20m timeout, continue-on-error: true | File inspection of `.github/workflows/pr-agent.yml` |
| AC-AI-156-02 | Skip cleanly logic | Preflight step emits notice and skips cleanly on forks or absent secrets without failing | Preflight step in `.github/workflows/pr-agent.yml` |
| AC-AI-156-03 | Repository review rules | `.pr_agent.toml` review instructions encode AGENTS.md rules (tenancy, RBAC, PII, VND no floats, carrier timeout reconcile, tests) | File inspection of `.pr_agent.toml` |
| AC-AI-156-04 | File ignore & chunk sizing | `.pr_agent.toml` ignores lockfiles, generated files, migration snapshots; max patch tokens sized for ~100KB chunks | File inspection of `.pr_agent.toml` |
| AC-AI-156-05 | Toolchain documentation | `AI-TOOLCHAIN-DECISIONS.md` records purpose, advisory boundary, and required operator secrets | File inspection of `AI-TOOLCHAIN-DECISIONS.md` |
| AC-AI-156-06 | Non-interference | No other workflow, gate config, allowlist, baseline, or semgrep rule modified | `git diff --name-only origin/main...HEAD` |

## Verification commands

- `pnpm exec prettier --check .github/workflows/pr-agent.yml`
- `npx --yes yaml-lint .github/workflows/pr-agent.yml`
- `npx --yes @taplo/cli check .pr_agent.toml`
- `pnpm lint`
- `pnpm format:check`
- `git diff --check origin/main...HEAD`

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | pending | pending | N/A |

## Residual limitations

None
