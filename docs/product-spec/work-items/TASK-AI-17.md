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
| Allowed paths | `tools/ecosystem-manifest.json`, `docs/product-spec/work-items/TASK-AI-17.md`, `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`, `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`, `tools/ai-brain/acceptance/ac-17-*.js`, `tools/ai-brain/acceptance/lib/reconcile-expectations.js`, `tools/ai-brain/manifest-audit.js`, `tools/ai-brain/test/manifest-audit.test.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-17-manifest-truth` (PR #19), `fix/task-ai-17-matrix-audit` (PR #55), `fix/task-ai-17-review-findings` (review repair) |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/19 (merge `1f587dd`), https://github.com/vinh05092001/shipde-platform/pull/55 (merge `d45a5d1`), https://github.com/vinh05092001/shipde-platform/pull/82 (review repair, this change) |

## Business outcome

The ecosystem manifest `tools/ecosystem-manifest.json` is the repository's
machine-readable source of truth for tooling and quality gates. However, the
automated manifest audit (`node tools/ai-brain/cli.js manifest`) revealed that
the manifest overclaims reality: 6 quality gates (`lighthouse-ci`,
`agent-scan`, `token-tracker`, `lefthook`, `axe-core`, `trivy`) and 1 UI tool
(`storybook`) were declared `ADOPTED` despite being absent from the machine and
monorepo workspace.

A seventh, `gitleaks`, was reported missing by the same run and was not. It is
installed by CI at the pinned version and enforced as a blocking gate on every
Pull Request; the audit could not see it because it probed the local host. That
one is resolved by correcting the check, never the record — downgrading a live
blocking gate would be understatement of exactly the kind this Work Item
exists to prevent.

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

- `TASK-AI-16` recorded as complete; manifest audit CLI (`tools/ai-brain/cli.js
  manifest`) available. **Current state (2026-09-16): holds** — register row 151
  records `TASK-AI-16` as `MERGED` (PR #58). **Historical measurement at the
  PR #55 audit, kept for traceability: the precondition did not hold then.** At that audit, register row 151 then recorded `TASK-AI-16` at `READY_FOR_AUTHOR`, and
  `TASK-AI-16.md` then recorded it at `READY_FOR_CODEX`; neither was `MERGED`, and the
  live `ao doctor` then reported `WARN codex-launch-flags` (see
  `TASK-AI-16.md` § Acceptance matrix audit). The reconciliation in this Work
  Item does not depend on that health check, so it is measured and disclosed
  here rather than asserted.
- Manifest audit baseline reports 37 repos declared, 27 checkable, 19 present,
  8 missing:
  - 7 ERRORS `QUALITY_GATE_MISSING`: `lighthouse-ci`, `agent-scan`,
    `token-tracker`, `lefthook`, `gitleaks`, `axe-core`, `trivy`.
  - 1 WARNING `DECLARED_ADOPTED_BUT_ABSENT`: `storybook`.
- `codex` on PATH reports `codex-cli 0.154.0` while `tools/ecosystem-manifest.json`
  pins `0.151.0`.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded
to the allowed paths listed in `## Control`:
`tools/ecosystem-manifest.json`,
`docs/product-spec/work-items/TASK-AI-17.md`,
`docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`,
`docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`,
`tools/ai-brain/acceptance/ac-17-*.js`,
`tools/ai-brain/acceptance/lib/reconcile-expectations.js`,
`tools/ai-brain/manifest-audit.js`, and
`tools/ai-brain/test/manifest-audit.test.js`.

The last two are allowed only for the `gitleaks` correction required by In
scope: the audit, not the record, was wrong, so the `ci-provisioned` install
class and its tests had to live in the audit module (delivered in PR #19,
commit `520f30d`). They were omitted from this list when it was first written;
the list is corrected to match the work the item orders.

Prohibited in this Work Item:
- Modifying review verdict logic, merge gates, or trusted reviewer lists.
- Installing machine-level binaries or editing `package.json` (owned by
  subsequent dedicated tasks `TASK-AI-35`..`39`).
- Silently flipping states or bypassing audit rules to force a pass.
- Bumping the pinned `codex-cli` version without a formal upgrade decision.

## In scope

- Audit each tool the first run reported absent in `tools/ecosystem-manifest.json`.
  For the 7 genuinely absent (`lighthouse-ci`, `agent-scan`, `token-tracker`,
  `lefthook`, `axe-core`, `trivy`, `storybook`): downgrade `lifecycle_state`
  from `ADOPTED` to `PENDING`, set `default_enabled: false`, and set
  `blocking_policy: "NON_BLOCKING"`.
- For `gitleaks`, which is present via CI: keep `ADOPTED` / `BLOCKING_GATE` and
  fix the audit instead, adding an `install_method: ci-provisioned` class that
  is verified against the workflow installing it.
- Document the downgrade rationale and downstream ownership for each tool in
  `tools/ecosystem-manifest.json` boundaries and `AI-TOOLCHAIN-DECISIONS.md`.
- Record observed `codex-cli` version drift (`0.154.0` observed vs. `0.151.0`
  pin) in `tools/ecosystem-manifest.json` metadata and link to
  `AI-TOOLCHAIN-DECISIONS.md`.
- Author this complete Work Item specification `TASK-AI-17.md`.
- Update `FEATURE-DELIVERY-REGISTER.csv` to record `TASK-AI-17` as
  `READY_FOR_CODEX`.
- Verify that `node tools/ai-brain/cli.js manifest` reports **0 errors and no
  warning other than the real `PINNED_VERSION_DRIFT` for `codex-cli`**. The
  earlier wording said "0 errors and 0 warnings", which the module cannot
  satisfy: `AI-17-R04` requires the `codex-cli` drift to be recorded, and a
  recorded drift is exactly what `PINNED_VERSION_DRIFT` reports. A run with zero
  warnings would mean the drift had been hidden, not settled. `AC-AI-17-01`
  already stated the correct condition; this bullet is corrected to agree with
  it. See Defect D2.

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
output is `node tools/ai-brain/cli.js manifest`, which must report 0 errors, no
warning other than the real `PINNED_VERSION_DRIFT` for `codex-cli` (Defect D2),
and confirm that the manifest matches reality for all checkable entries.

## API, event and data impact

No schema, database, or runtime API change. Changes are strictly bounded to
governed configuration files (`tools/ecosystem-manifest.json`), the delivery
register, and toolchain decision documentation.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-17-01` | Manifest audit reports zero blocking errors against the real manifest, and the audit is demonstrably live | `node tools/ai-brain/acceptance/ac-17-01-manifest-audit-clean.js` exits 0 and prints `MANIFEST_AUDIT_ERRORS: 0` | command stdout, including the `CONTROL:` line showing a tampered copy rejected with an overstatement finding |
| `AC-AI-17-02` | Register reconciler reports zero errors against the real register, and the reconciler is demonstrably live | `node tools/ai-brain/acceptance/ac-17-02-reconcile-clean.js` exits 0 and prints `RECONCILE_ERRORS: 0` | command stdout, including the `CONTROL:` line showing a tampered register (duplicated id) rejected |
| `AC-AI-17-03` | The `ai-brain` and `ai-dashboard` suites ran and reported zero failures (the pass count drifts and is not pinned) | `node tools/ai-brain/acceptance/ac-17-03-suite-invariant.js` exits 0 and prints `AC-AI-17-03 suite invariant held: fail 0` | command stdout carrying the measured test and suite counts |
| `AC-AI-17-04` | The absent tools are reconciled as claimed and the CI-provisioned gate is untouched by the downgrade | `node tools/ai-brain/acceptance/ac-17-04-manifest-reconciliation.js` exits 0 and prints `AC-AI-17-04 reconciliation held: 0 violation(s)` | command stdout, including the two `CONTROL:` lines; the rule lives in `tools/ai-brain/acceptance/lib/reconcile-expectations.js` and is also required by `AC-AI-17-01` |
| `AC-AI-17-05` | The `codex-cli` pin is intact and the observed drift is recorded in both the manifest and the decisions document | `node tools/ai-brain/acceptance/ac-17-05-codex-cli-drift.js` exits 0 and prints `AC-AI-17-05 drift recorded, pin intact` | command stdout, including the `CONTROL:` line showing a silently re-pinned copy rejected |
| `AC-AI-17-06` | The delivery register records `TASK-AI-17` at `READY_FOR_CODEX` | `node tools/ai-brain/acceptance/ac-17-06-register-status.js` exits 0 and prints `AC-AI-17-06 register status held` | command stdout, including the `CONTROL:` line showing a tampered copy read as `MERGED` |

## Acceptance matrix audit (defects found and repaired)

Every row of the acceptance matrix above was extracted programmatically from
the markdown table and executed as stored, on Windows, Node v24.15.0, from the
repository root. What follows is the measurement, the classification of every
row that did not hold, and the replacement. The rows that did hold are not
rewritten in substance; their claim is moved into a committed script so the
`## Acceptance matrix` table carries a command a reader can run.

There was no pre-existing acceptance-script pair for this Work Item. The rule
that `AC-AI-17-01` and `AC-AI-17-04` both need is therefore committed once, to
`tools/ai-brain/acceptance/lib/reconcile-expectations.js`, and both rows
`require` it; the coupling is proved by mutation below.

### Step 1 measurement (rows as originally stored)

Historical snapshot taken at the PR #55 audit (2026-09-14); counts are not
pinned. At the review-repair re-run (2026-09-16) `AC-AI-17-03` measured the
larger live counts reported in `## Codex review record`, still `fail 0`; that run's exact output is quoted in `## Codex review record`.

| Row | Stored as a command? | Exit | Measured |
|---|---|---|---|
| `AC-AI-17-01` | no — prose only | 0 (`cli.js manifest`) | 37 declared, 27 checkable, 19 present, 8 missing; `0 lỗi, 1 cảnh báo, 2 ghi chú`; warning is `PINNED_VERSION_DRIFT` naming `codex-cli` (`0.151.0` pin vs `0.154.0` observed); `trustworthy` true |
| `AC-AI-17-02` | no — prose only | 0 (`cli.js reconcile`) | 178 items checked; `0 lỗi, 0 cảnh báo, 149 ghi chú` |
| `AC-AI-17-03` | yes | 0 | `fail 0` with `tests > 0` (the invariant `ac-17-03` asserts); the historical count at this snapshot is recorded in D2, not pinned here |
| `AC-AI-17-04` | no — prose only | n/a | the 7 named entries are `PENDING` / `default_enabled: false` / `NON_BLOCKING`; `gitleaks` is `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned` |
| `AC-AI-17-05` | no — prose only | n/a | pin `0.151.0`; `observed_version_or_commit: "0.154.0"`; `version_drift_note` present |
| `AC-AI-17-06` | no — prose only | n/a | register row 152, `status = READY_FOR_CODEX` |

### D1 — all six rows: unrunnable as stored

**Defect class:** unrunnable. Five of the six rows carried no command at all;
`AC-AI-17-03` was the only executable one. A matrix row that names a surface but
stores no command cannot be executed "as written", so it cannot fail and is not
a gate.

**Replacement:** six committed scripts under `tools/ai-brain/acceptance/`, each
reading real repository files, each with a `CONTROL:` step that tampers a copy
and requires the real check to reject it, and each exiting `2` outside the
repository instead of passing. They follow
`tools/ai-brain/acceptance/ac-43-02-manifest-zero-errors.js`.

### D2 — `AC-AI-17-03`: a stale pin, and an assertion that proves nothing

**Defect class:** stale pin *and* vacuous assertion.

**Measurement:** the stored row asserted "All 380 tests pass". The real command
`node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js"`
exits `0` with `tests 499 / pass 499 / fail 0` — 119 more tests than the pin,
because the pin recorded a count from the day it was written. Separately, the
same command run from an empty temporary directory with no repository present
exits `0` and prints `fail 0`, so the row could not tell a green suite from an
empty one.

**Replacement:** `tools/ai-brain/acceptance/ac-17-03-suite-invariant.js`, which
asserts the invariant the row meant (`fail 0`) with a non-vacuity guard
(directories exist, hold test files, `tests > 0`) and never pins a count.

### D3 — the register summary overstated the reconciliation by one

**Defect class:** false claim.

**Measurement:** register row 152 read "Reconcile 8 absent adopted tools to
PENDING". The manifest audit reports 8 absent checkable entries, but only 7 were
downgraded: `gitleaks` was reported missing by a host probe and was not absent
— it is `ADOPTED` / `BLOCKING_GATE` / `install_method: ci-provisioned` in
`tools/ecosystem-manifest.json` today. Counting it would describe the mistake
this Work Item corrected, not the correction.

**Replacement:** the row now reads "Reconcile 7 absent adopted tools to PENDING
and document codex-cli version drift".

### D4 — the document contradicted itself on warnings

**Defect class:** false claim (internal contradiction).

**Measurement:** In scope and UI states required the manifest audit to pass
"with 0 errors and 0 warnings". The real run reports `0 lỗi, 1 cảnh báo`, and
`AC-AI-17-01` — in the same document — explicitly permits that one warning
because `AI-17-R04` requires the `codex-cli` drift to be recorded. Zero warnings
would mean the drift had been hidden. The two statements cannot both be true.

**Replacement:** In scope and UI states now read "0 errors and no warning other
than the real `PINNED_VERSION_DRIFT` for `codex-cli`", matching `AC-AI-17-01`.

### D5 — the precondition asserted a completion the register denies

**Defect class:** false claim.

**Measurement (at the PR #55 audit, 2026-09-14):** Preconditions opened with "`TASK-AI-16` complete". At that audit register row
151 then recorded `TASK-AI-16` at `READY_FOR_AUTHOR`, `TASK-AI-16.md` then recorded it at
`READY_FOR_CODEX`, and the live `ao doctor` then reported
`WARN codex-launch-flags`. No reading of the register at that time supported "complete".
Row 151 has since been recorded `MERGED` (PR #58); see the current-state note under Preconditions.

**Replacement:** the precondition is annotated with the measured status and
states that this Work Item's reconciliation does not depend on it.

### Coupling proof for the shared rule

`tools/ai-brain/acceptance/lib/reconcile-expectations.js` holds the
reconciliation claim once; `AC-AI-17-01` and `AC-AI-17-04` both `require` it,
and neither restates it.

| Step | `ac-17-04` | `ac-17-01` |
|---|---|---|
| Module intact (baseline) | exit `0`, `AC-AI-17-04 reconciliation held: 0 violation(s)` | exit `0`, `MANIFEST_AUDIT_ERRORS: 0` |
| Rule disabled in the module (`reconciliationViolations` returns `[]`) | exit `2`, `CONTROL_FAILED: the rule accepted an absent gate declared ADOPTED` | exit `0` (it uses the module's code list, not the claim) |
| Module restored from a file backup | exit `0` | exit `0` |

The negative row goes red the moment the rule stops firing, so the pair cannot
drift apart silently. The backup was taken with `cp` to a temp path and restored
by copying it back; no `git checkout --` was run against uncommitted work.

### Exit codes of the new acceptance scripts

| Script | In repository | From an empty directory, no repository |
|---|---|---|
| `ac-17-01-manifest-audit-clean.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-17-02-reconcile-clean.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-17-03-suite-invariant.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-17-04-manifest-reconciliation.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-17-05-codex-cli-drift.js` | `0` | `2` (`SOURCE_MISSING`) |
| `ac-17-06-register-status.js` | `0` | `2` (`SOURCE_MISSING`) |

## Verification commands

```
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js"
node tools/ai-brain/acceptance/ac-17-01-manifest-audit-clean.js
node tools/ai-brain/acceptance/ac-17-02-reconcile-clean.js
node tools/ai-brain/acceptance/ac-17-03-suite-invariant.js
node tools/ai-brain/acceptance/ac-17-04-manifest-reconciliation.js
node tools/ai-brain/acceptance/ac-17-05-codex-cli-drift.js
node tools/ai-brain/acceptance/ac-17-06-register-status.js
python docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `4b0fa4b` — the `origin/main` tip actually checked out and read by the reviewer; it contains the PR #55 merge `d45a5d1`, and TASK-AI-17's delivered files are unchanged between `d45a5d1` and `4b0fa4b` | `CHANGES_REQUIRED` (cline-free/muse-spark-1.3-contributor) | Findings 1-5 in the PR #55 review comment, resolved in branch `fix/task-ai-17-review-findings`: allowed-path lists aligned (1, 2); PR/branch/review placeholders filled (3); precondition and Step 1 snapshot marked current/historical (4, 5); re-run 2026-09-16: all six `ac-17-*` scripts exit 0, suite `514/514` across 116 suites, `manifest` 0 errors / 1 drift warning, `reconcile` 0 errors |
| 3 | `a3412e9` (PR #82 head) | `CHANGES_REQUIRED` (cline-free/muse-spark-1.3-contributor) | round-2 findings 2-4 confirmed resolved and 5 confirmed disclosed; residual present-tense history in § D5 put in past tense |
| 2 | `897d3cb` (PR #82 head) | `CHANGES_REQUIRED` (cline-free/muse-spark-1.3-contributor; verdict posted on PR #82) | (1) historical precondition sentence now in past tense; (2) Step 1 table no longer pins a count, and the re-run output is quoted below; (3) round 1 commit explained as the reviewed tip containing `d45a5d1`; (4) PR #82 added to the Pull Request field; (5) retroactive allowed-path expansion is left for the merge owner to confirm, as disclosed |

Re-run at `897d3cb`, 2026-09-17, exact final lines:

```
ac-17-01-manifest-audit-clean.js   exit 0  MANIFEST_AUDIT_ERRORS: 0
ac-17-02-reconcile-clean.js        exit 0  RECONCILE_ERRORS: 0
ac-17-03-suite-invariant.js        exit 0  AC-AI-17-03 suite invariant held: fail 0 with 514 passing of 514 tests across 116 suites (count not pinned)
ac-17-04-manifest-reconciliation.js exit 0 AC-AI-17-04 reconciliation held: 0 violation(s)
ac-17-05-codex-cli-drift.js        exit 0  AC-AI-17-05 drift recorded, pin intact
ac-17-06-register-status.js        exit 0  AC-AI-17-06 register status held
```

## Residual limitations

Downgrading absent quality gates to `PENDING` accurately represents current
reality, but means automated security, accessibility, and performance gates are
not enforced in local development until `TASK-AI-35` through `TASK-AI-39` are
implemented. `codex-cli` pin remains `0.151.0` pending a formal upgrade decision
by the human owner per `AI-TOOLCHAIN-DECISIONS.md`.
