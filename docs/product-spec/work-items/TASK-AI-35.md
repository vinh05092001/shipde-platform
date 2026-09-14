# TASK-AI-35 — Secret scanning gate evaluation: Gitleaks preservation vs Betterleaks replacement

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-35` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `168` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-35.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-35-betterleaks` |
| Pull Request | `<URL>` |

## Business outcome

The Ship Dễ delivery pipeline must prevent secret and credential leaks before
code is committed or merged into `main`. The repository's existing secret
scanning gate is `gitleaks`: it is NOT missing. Gitleaks is `ADOPTED`, a
`BLOCKING_GATE`, `install_method: ci-provisioned`, installed at pinned version
`8.24.0` in `.github/workflows/security-baseline.yml` and
`.github/workflows/current-application.yml`, and actively enforced on every Pull
Request and push to `main`. It is wrapped by `scripts/verify-secrets.ts` with
fail-closed execution and a demonstrated negative failure proof (`AC-FOUND-01-06`).

In contrast, other tooling entries such as `lefthook` (pre-commit hooks) and
`trivy` (container and dependency vulnerability scanning) are genuinely absent
and truthfully documented as `PENDING` (owned by `TASK-AI-36` and `TASK-AI-37`).

`TASK-AI-35` defines the architectural specification and evidence-based criteria
for evaluating whether to REPLACE the currently working, blocking Gitleaks gate
with `betterleaks` (a Byte-Pair Encoding-based successor developed by the same
author, Zach Rice), or to retain Gitleaks indefinitely. Under `AGENTS.md` and
repository policy `AI-TOOL-01`, a production security gate cannot be replaced on
claims or novelty. Replacement requires verified proof of non-regression in
detection capability, negative proof parity (exact exit code 1), dual git-range
and working tree scanning, local and CI portability, zero telemetry, and a formal
human architectural decision.

## Source references

- `AGENTS.md` § Carrier integrations & Security and tenancy — Secrets and
  unnecessary PII must not appear in logs, snapshots, errors or fixtures.
- `AGENTS.md` § Role separation — Codex as independent reviewer; author never
  approves its own work. Handoff progresses through `READY_FOR_CODEX`.
- `tools/ecosystem-manifest.json` — Entry `gitleaks` (`ADOPTED`, `BLOCKING_GATE`,
  `ci-provisioned`, pinned `8.24.0`).
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply
  integrated, enabled or blocking; conversely, an active blocking gate must not
  be reported as missing.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — Declared lifecycle state
  must reflect machine reality.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § `gitleaks`
  was never absent, and the check was wrong (TASK-AI-17).
- `.github/workflows/security-baseline.yml` — Jobs `secret-scan` with pinned
  Gitleaks 8.24.0 and negative proof step `pnpm security:secrets -- --test-negative`.
- `.github/workflows/current-application.yml` — Security baseline execution on
  workflow branches.
- `scripts/verify-secrets.ts` — Fail-closed scanning harness supporting
  `gitleaks git --log-opts` and `gitleaks dir`.
- `.gitleaks.toml` — Custom rules (`shipde-carrier-live-token`, `generic-api-key`,
  `private-key`, `aws-secret-key`) extending default rules.
- `docs/product-spec/work-items/TASK-FOUND-01.md` § `AC-FOUND-01-06` — Negative
  failure proof detecting secret leak fixtures with exact exit code 1 and
  guaranteed cleanup.

## Preconditions and dependencies

- `TASK-AI-17` reconciled the ecosystem manifest against reality, establishing
  that `gitleaks` is `ADOPTED` / `ci-provisioned` while `lefthook` and `trivy`
  are `PENDING`.
- Pinned `gitleaks 8.24.0` is provisioned and running in CI
  (`.github/workflows/security-baseline.yml`).
- `pnpm security:secrets` and `pnpm security:secrets -- --test-negative` execute
  and pass cleanly in the current baseline.
- `node tools/ai-brain/cli.js manifest` reports 0 errors and confirms that
  the manifest matches reality for all checkable tools.

## Author boundary

`GEMINI` is appropriate as primary author: this Work Item defines a foundational
security gate evaluation and specification across tooling, CI workflows, and
developer worktrees.

Bounded scope: authoring the specification in `docs/product-spec/work-items/TASK-AI-35.md`.

Prohibited in this Work Item:
- Modifying `.github/workflows/*`, `scripts/verify-*`, `.gitleaks.toml`, or
  `docs/product-spec/scripts/*`.
- Declaring Gitleaks absent, removing Gitleaks from CI, or downgrading its
  `lifecycle_state` or `blocking_policy`.
- Installing or switching to Betterleaks without human decision approval and
  verified parity benchmarks.
- Author never approves own work.

## In scope

- Define the technical comparison between Gitleaks (regex + Shannon entropy)
  and Betterleaks (regex + Byte-Pair Encoding tokenization).
- Define the strict parity and non-regression benchmarks required before any
  replacement can be considered:
  1. Full configuration compatibility: drop-in execution with `.gitleaks.toml`,
     including `[extend] useDefault = true`, custom `[[rules]]`, and `[allowlist]`.
  2. Negative failure proof parity: detection of synthetic carrier tokens
     (`shipde-carrier-live-token`) with exact exit code 1 and guaranteed cleanup.
  3. Git history range scanning parity: `--log-opts=<base>...HEAD` support for
     PR validation.
  4. Working tree scanning parity: directory traversal honoring `.gitignore` and
     build output exclusions (`.next`, `.turbo`, `.pnpm-store`).
  5. Fail-closed error handling: exit code 2 on operational faults (missing binary,
     unparseable config, invalid arguments), never exiting zero on failure.
  6. Multi-platform portability: native binary availability for Linux x64
     (CI runner) and Windows x64 (local worktrees) with cryptographic checksums.
  7. Zero network behavior: strictly offline execution with zero telemetry.
- Define the formal human decision gate in `AI-TOOLCHAIN-DECISIONS.md` required
  to authorize any future migration.
- Author complete Work Item specification `TASK-AI-35.md`.

## Out of scope

- Editing existing CI workflows (`.github/workflows/security-baseline.yml`,
  `.github/workflows/current-application.yml`).
- Modifying `scripts/verify-secrets.ts` or `.gitleaks.toml`.
- Installing the Betterleaks binary into production CI or local environments.
- Installing or configuring `lefthook` (owned by `TASK-AI-36`) or `trivy`
  (owned by `TASK-AI-37`).
- Weakening or relaxing any existing secret scanning rule or allowlist.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-35-R01` | Gitleaks baseline preservation: Gitleaks 8.24.0 remains the active, blocking, adopted CI secret scanning gate until all replacement criteria are proven and human decision is granted. Gitleaks is never treated as absent. |
| `AI-35-R02` | Negative proof parity: Any proposed replacement scanner must detect all `.gitleaks.toml` custom rules (e.g., `shipde-carrier-live-token`) and built-in rules with exact exit code 1 in negative test fixtures, matching `AC-FOUND-01-06`. |
| `AI-35-R03` | Git range and tree scanning parity: The scanner must scan both the PR commit range (`BASE_SHA...HEAD`) and uncommitted working directory targets without traversing ignored paths (`.git`, `node_modules`, `.next`, `.turbo`, `.pnpm-store`). |
| `AI-35-R04` | Fail-closed behavior: Missing binary, invalid CLI flags, unparseable configuration, or empty report on exit code 1 must result in an operational failure (exit code 2) and block the CI pipeline, never silently exiting zero. |
| `AI-35-R05` | Local and CI platform portability: The scanner must provide verified pre-compiled binaries or npm-managed native executables for both Linux x64 (GitHub Actions runner) and Windows x64 (local developer worktrees), with zero telemetry or network calls during scan. |
| `AI-35-R06` | Human authorization gate: Replacement of Gitleaks with Betterleaks requires explicit human approval in `AI-TOOLCHAIN-DECISIONS.md`. In the absence of an approved replacement decision or if Betterleaks fails any parity requirement, Gitleaks remains the sole authoritative blocking gate. |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer- and CI-facing
outputs are CLI logs from `pnpm security:secrets` and GitHub Actions job
`secret-scan`. Output states:
- Clean pass: Exit code 0, 0 leaks found across PR commit range and directory targets.
- Finding detected: Exit code 1, list of file:line, RuleID, and redacted secret preview.
- Operational failure: Exit code 2, diagnostic error explaining missing binary, corrupt config, or execution failure.
- Negative test verification: Exit code 1 expected; exiting 0 or 2 fails the gate.

## API, event and data impact

No schema, database, or runtime API change. Governs security quality gate contracts
and verification scripts.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-35-01` | Truthfulness of baseline gate status | Gitleaks is accurately recorded as `ADOPTED`, `BLOCKING_GATE`, `ci-provisioned`, and active in `.github/workflows/security-baseline.yml`; `lefthook` and `trivy` are accurately documented as `PENDING` | `tools/ecosystem-manifest.json` and workflow review |
| `AC-AI-35-02` | Replacement evaluation criteria specification | The Work Item specifies quantitative and qualitative parity criteria (recall, BPE vs Shannon entropy, false positive rate, execution speed) required before replacing Gitleaks | Specification text in `TASK-AI-35.md` |
| `AC-AI-35-03` | Negative failure proof parity requirement | Specification mandates exact exit code 1 on synthetic leak fixtures (`ghn_live_...`) with guaranteed cleanup in `finally`, matching existing `scripts/verify-secrets.ts` | Specification text and rule `AI-35-R02` |
| `AC-AI-35-04` | Dual-mode scanning parity requirement | Specification mandates full support for PR commit range (`BASE_SHA...HEAD`) and safe working tree directory scanning | Specification text and rule `AI-35-R03` |
| `AC-AI-35-05` | Fail-closed and zero-telemetry requirement | Specification requires operational failure (code 2) on missing binary or invalid config, and verifies zero outbound network requests | Specification text and rules `AI-35-R04`, `AI-35-R05` |
| `AC-AI-35-06` | Human decision gate enforcement | Specification requires formal human approval in `AI-TOOLCHAIN-DECISIONS.md` before executing any replacement | Specification text and rule `AI-35-R06` |

## Verification commands

```
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js"
python docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

Betterleaks is an actively evolving project; while its BPE tokenization promises
higher accuracy and faster scans, its drop-in compatibility with complex custom
rules and broad multi-platform binary distributions across diverse developer
environments must be verified empirically before any migration is triggered.
Until such verification is conducted and human approval is granted under
`AI-35-R06`, Gitleaks 8.24.0 remains the sole blocking gate.
