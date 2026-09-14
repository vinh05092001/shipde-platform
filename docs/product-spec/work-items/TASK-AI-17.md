# TASK-AI-17 — Reconcile the ecosystem manifest against reality

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-17` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `150` |
| Dependencies | `TASK-AI-16` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `tools/ecosystem-manifest.json`, `docs/product-spec/work-items/TASK-AI-17.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-17-manifest-truth` |
| Pull Request | `<URL>` |

## Business outcome

The ecosystem manifest `tools/ecosystem-manifest.json` is the repository's
machine-readable source of truth for tooling and quality gates. However, the
automated manifest audit (`node tools/ai-brain/cli.js manifest`) revealed that
the manifest overclaims reality: 7 quality gates (`lighthouse-ci`, `agent-scan`,
`token-tracker`, `lefthook`, `gitleaks`, `axe-core`, `trivy`) and 1 UI tool
(`storybook`) were declared `ADOPTED` despite being absent from the machine and
monorepo workspace.

An absent tool declared as `ADOPTED` is dangerous because every code path,
workflow, and operator assumes that the corresponding quality gate is actively
enforced. Reconciling the manifest against reality restores truthfulness by
downgrading absent entries to `PENDING` with non-blocking policies until
dedicated implementation work items (`TASK-AI-35` through `TASK-AI-40`) formally
install, configure, and integrate them. Additionally, the observed version drift
for `codex-cli` (manifest pinned at `0.151.0` vs. host CLI installed at
`0.154.0`) is explicitly recorded rather than hidden.

## Source references

- `AGENTS.md` § Source of truth — A declared `lifecycle_state` must match what
  is actually on the machine; never flip a state to make an audit pass.
- `AGENTS.md` § Role separation — Author never approves own work; handoff
  progresses through `READY_FOR_CODEX`.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply
  integrated, enabled or blocking.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — A failed or partial
  installation reports exact state; must not be recorded as installed or
  healthy.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Codex
  CLI version dependency (TASK-AI-16).
- `tools/ai-brain/manifest-audit.js` — Truth-checking logic for adopted
  ecosystem entries.

## Preconditions and dependencies

- `TASK-AI-16` complete; manifest audit CLI (`tools/ai-brain/cli.js manifest`)
  available.
- Manifest audit baseline reports 37 repos declared, 27 checkable, 19 present,
  8 missing:
  - 7 ERRORS `QUALITY_GATE_MISSING`: `lighthouse-ci`, `agent-scan`,
    `token-tracker`, `lefthook`, `gitleaks`, `axe-core`, `trivy`.
  - 1 WARNING `DECLARED_ADOPTED_BUT_ABSENT`: `storybook`.
- `codex` on PATH reports `codex-cli 0.154.0` while `tools/ecosystem-manifest.json`
  pins `0.151.0`.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded
to the four allowed paths:
`tools/ecosystem-manifest.json`,
`docs/product-spec/work-items/TASK-AI-17.md`,
`docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, and
`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`.

Prohibited in this Work Item:
- Modifying review verdict logic, merge gates, or trusted reviewer lists.
- Installing machine-level binaries or editing `package.json` (owned by
  subsequent dedicated tasks `TASK-AI-35`..`39`).
- Silently flipping states or bypassing audit rules to force a pass.
- Bumping the pinned `codex-cli` version without a formal upgrade decision.

## In scope

- Audit each of the 8 absent tools in `tools/ecosystem-manifest.json`
  (`lighthouse-ci`, `agent-scan`, `token-tracker`, `lefthook`, `gitleaks`,
  `axe-core`, `trivy`, `storybook`): downgrade `lifecycle_state` from
  `ADOPTED` to `PENDING`, set `default_enabled: false`, and set
  `blocking_policy: "NON_BLOCKING"`.
- Document the downgrade rationale and downstream ownership for each tool in
  `tools/ecosystem-manifest.json` boundaries and `AI-TOOLCHAIN-DECISIONS.md`.
- Record observed `codex-cli` version drift (`0.154.0` observed vs. `0.151.0`
  pin) in `tools/ecosystem-manifest.json` metadata and link to
  `AI-TOOLCHAIN-DECISIONS.md`.
- Author this complete Work Item specification `TASK-AI-17.md`.
- Update `FEATURE-DELIVERY-REGISTER.csv` to record `TASK-AI-17` as
  `READY_FOR_CODEX`.
- Verify that `node tools/ai-brain/cli.js manifest` passes with 0 errors and
  0 warnings.

## Out of scope

- Installing machine binaries or mutating `package.json` / workspace dependencies
  (assigned to `TASK-AI-35` through `TASK-AI-39`).
- Retiring `token-tracker` or rewriting `sylph` roles (assigned to `TASK-AI-40`).
- Upgrading or repinning `codex-cli` in production policy (human decision gate).
- Modifying orchestrator supervisor scripts or review verification logic.

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-17-R01` | Manifest lifecycle state must strictly reflect machine and workspace reality. A tool absent from the machine must never be declared `INSTALLED`, `INTEGRATED`, or `ADOPTED`. |
| `AI-17-R02` | Missing quality gates are resolved either by verified installation or by honest downgrade to `PENDING` with documented rationale; state-flipping without evidence is prohibited. |
| `AI-17-R03` | Tools in `PENDING` lifecycle state must have `default_enabled: false` and `blocking_policy: "NON_BLOCKING"` so missing tools cannot falsely claim to enforce pipeline gates. |
| `AI-17-R04` | Version drift between installed CLI tools and manifest pins must be explicitly documented and attributed to governed upgrade policies, never hidden. |
| `AI-17-R05` | Downstream items (`TASK-AI-19`, `TASK-AI-21`, `TASK-AI-35`..`TASK-AI-44`) that depend on `TASK-AI-17` remain blocked until `TASK-AI-17` achieves full reconciliation and independent Codex review. |

## UI states

Not applicable; this Work Item has no user-facing screen. Operator-facing
output is `node tools/ai-brain/cli.js manifest`, which must report 0 errors,
0 warnings, and confirm that the manifest matches reality for all checkable
entries.

## API, event and data impact

No schema, database, or runtime API change. Changes are strictly bounded to
governed configuration files (`tools/ecosystem-manifest.json`), the delivery
register, and toolchain decision documentation.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-17-01` | Run manifest audit via `cli.js manifest` | Reports 0 errors and trustworthy = true. The only permitted warning is `PINNED_VERSION_DRIFT` for `codex-cli`, which is real and awaits a human decision under the upgrade rule; a run with zero warnings would mean the drift had been hidden rather than settled | CLI stdout |
| `AC-AI-17-02` | Run register reconciliation via `cli.js reconcile` | Reports 0 errors | CLI stdout |
| `AC-AI-17-03` | Run test suite for `ai-brain` and `ai-dashboard` | All 380 tests pass | Test runner stdout |
| `AC-AI-17-04` | Inspect the 8 absent tools in manifest | All 8 have `lifecycle_state: "PENDING"`, `default_enabled: false`, `blocking_policy: "NON_BLOCKING"` | JSON inspect output |
| `AC-AI-17-05` | Inspect `codex-cli` manifest entry | Pin remains `0.151.0`, observed drift to `0.154.0` documented | JSON inspect output |
| `AC-AI-17-06` | Check delivery register status | `TASK-AI-17` recorded at `READY_FOR_CODEX` | CSV row inspection |

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

Downgrading absent quality gates to `PENDING` accurately represents current
reality, but means automated security, accessibility, and performance gates are
not enforced in local development until `TASK-AI-35` through `TASK-AI-39` are
implemented. `codex-cli` pin remains `0.151.0` pending a formal upgrade decision
by the human owner per `AI-TOOLCHAIN-DECISIONS.md`.
