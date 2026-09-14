# TASK-AI-40 — Retire superseded or mis-described manifest entries

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-40` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `173` |
| Dependencies | `TASK-AI-17` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-40.md` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-40-manifest-retire` |
| Pull Request | https://github.com/vinh05092001/shipde-platform/pull/27 |

## Business outcome

The Ship Dễ governed ecosystem catalog (`tools/ecosystem-manifest.json`) is the
machine-readable source of truth for tooling adoption, execution harnesses, and
quality gates across all AI agents and human contributors. Under repository
operating principles (`AGENTS.md` and policy `AI-TOOL-10`), the catalog must
strictly reflect reality: declared capabilities must exist, and absent or
mis-described tools must never be recorded as adopting or enforcing roles they do
not perform. "Removing a wrong entry is worth more than satisfying it."

Foundation reconciliation (`TASK-AI-17`) exposed that the ecosystem manifest
contained entries that either duplicate native internal systems or misrepresent
external repositories:

1. **`token-tracker` (`xiufengsun/TokenTracker`) is superseded**:
   Declared as an npm development tool for "Token usage tracking, telemetry budget
   auditing, and agent expense visibility". However, comprehensive token usage
   tracking and quota observability were already natively implemented in the
   repository under `TASK-AI-15`:
   - `tools/ai-brain/usage-adapter.js` provides multi-ledger token ingestion
     (Claude Code JSONL transcript ledger with turn summing, resumed session
     deduplication, cached token pricing, and home directory redaction; 9Router
     SQLite ledger with cost extraction).
   - `tools/ai-dashboard` provides real-time visibility, provider telemetry, pool
     utilization gauges, and quota ceiling monitoring, verified by 458 automated
     tests.
   Adopting `token-tracker` as an external dependency duplicates existing,
   tested internal functionality and creates conflicting sources of truth. It
   must be formally retired.

2. **`sylph` (`getnao/sylph`) is mis-described**:
   Declared in `tools/ecosystem-manifest.json` as an "AI agent execution harness,
   policy enforcement, and sandboxing" with source of truth boundary "Agent
   sandbox boundary; enforces single-writer and tool permission constraints" and
   health check `Test-Path tools/snapshots/sylph`. In reality, `getnao/sylph` is a
   collection of static Markdown prompt specifications with no backend runtime,
   no execution sandbox, and no programmatic policy enforcement mechanism.
   Furthermore, single-writer workspace protection is already implemented natively
   in `tools/ai-guard` (single-writer claim guard, pre-commit hook preventing
   cross-session collisions) under `TASK-AI-15` and `TASK-AI-16`. Claiming that
   `sylph` acts as an active policy runtime or execution harness is a severe
   mis-description that misleads operators and agents. It must be formally retired
   from its false role.

`TASK-AI-40` establishes the authoritative specification for retiring both
superseded and mis-described entries from the ecosystem catalog, defining:
1. The architectural justification and evidence for retiring `token-tracker`
   and `sylph`.
2. The clean removal of `token-tracker` and `sylph` from `tools/ecosystem-manifest.json`,
   `tools/ecosystem-profiles.json`, `tools/ai-brain/manifest-audit.js`,
   `scripts/ai/ecosystem.ps1`, and `AI-TOOLCHAIN-DECISIONS.md`.
3. Invariant boundaries: preservation of active CI gates (`gitleaks 8.24.0`
   `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned`), preservation of genuine pending
   gates (`lefthook`, `trivy`, `axe-core`, `lighthouse-ci`, `agent-scan`), and
   strict enforcement of zero manifest audit errors (`node tools/ai-brain/cli.js manifest`).

## Source references

- `AGENTS.md` § Source of truth — Precedence order: specifications govern,
  existing code is implementation evidence.
- `AGENTS.md` § Role separation — Author never approves own work; independent
  Codex review gate.
- `AGENTS.md` § Unit of delivery — Required status flow through `READY_FOR_CODEX`.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-01` — Installed does not imply
  integrated, enabled or blocking; capabilities must be verified.
- `tools/ecosystem-manifest.json` policy `AI-TOOL-10` — Declared lifecycle states
  must match reality; mis-described entries must not be maintained to fake coverage.
- `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md` § Governed
  Ecosystem Catalog — Entries for `token-tracker` and `sylph`.
- `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` row 173 —
  `TASK-AI-40`: "token-tracker duplicates the built usage adapter; sylph is markdown,
  not a policy runtime".
- `docs/product-spec/work-items/TASK-AI-15.md` — Native token usage adapter and
  realtime cockpit dashboard implementation.
- `docs/product-spec/work-items/TASK-AI-16.md` & PR #17 — Native single-writer
  claim guard in `tools/ai-guard`.
- `docs/product-spec/work-items/TASK-AI-17.md` — Reconcile the ecosystem manifest
  against reality.

## Preconditions and dependencies

- `TASK-AI-17` merged (`1f587dd`), unblocking `TASK-AI-40` and establishing
  truthful `PENDING` states for absent tools while keeping `gitleaks` `ADOPTED`
  and `ci-provisioned`.
- `tools/ai-brain/cli.js manifest` reports 0 errors and exactly 1 warning
  (`PINNED_VERSION_DRIFT` for `codex-cli`).
- `tools/ai-brain/cli.js reconcile` reports 0 errors and 1 warning (`TASK-AI-07`).
- Native usage adapter (`tools/ai-brain/usage-adapter.js`) and dashboard
  (`tools/ai-dashboard`) are active, tested, and passing all unit tests.
- Native claim guard (`tools/ai-guard/cli.js`) is active, tested, and guarding
  worktree sessions.

## Author boundary

`GEMINI` is the assigned author for this Work Item. Scope is strictly bounded
to authoring the specification in `docs/product-spec/work-items/TASK-AI-40.md`.

Prohibited in this Work Item:
- Modifying `.github/workflows/*`, `scripts/verify-*`, `.gitleaks.toml`, or
  `docs/product-spec/scripts/*`.
- Declaring `gitleaks` absent, removing `gitleaks` from CI, or downgrading its
  `lifecycle_state` or `blocking_policy`.
- Modifying `tools/ecosystem-manifest.json` or `tools/ecosystem-profiles.json` in
  this specification PR (retirement execution belongs to the subsequent
  implementation commit/phase).
- Dropping, skipping, or weakening any verification gate.
- Author never approves own work; handoff stops at `READY_FOR_CODEX`.

## In scope

- Detail the architectural rationale and empirical evidence for the formal
  retirement of `token-tracker` (`xiufengsun/TokenTracker`).
- Detail the factual analysis and evidence demonstrating that `sylph` (`getnao/sylph`)
  is Markdown documentation without an executable sandbox or runtime, and record
  its formal retirement from its mis-described role in the manifest.
- Specify the complete inventory of manifest files, profile arrays, audit maps,
  and documentation to be updated during the implementation phase:
  1. `tools/ecosystem-manifest.json`: Remove entries for `token-tracker` and `sylph`.
  2. `tools/ecosystem-profiles.json`: Remove `token-tracker` from `FOUNDATION` and
     `NIGHTLY_MAINTENANCE`; remove `sylph` from `FOUNDATION` and `SECURITY_REVIEW`.
  3. `tools/ai-brain/manifest-audit.js`: Remove package alias mapping `'token-tracker': 'tokentracker'`.
  4. `scripts/ai/ecosystem.ps1`: Remove `getnao/sylph` from repository clone list.
  5. `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`: Update
     catalog count from 37 to 35 adopted repositories, explicitly recording the
     formal retirement of `token-tracker` and `sylph`.
- Formulate business rules (`AI-40-R01` through `AI-40-R07`) governing manifest
  truthfulness, non-duplication of native capabilities, and zero-error manifest
  audit enforcement.
- Formulate the acceptance matrix (`AC-AI-40-01` through `AC-AI-40-06`) defining
  verifiable criteria for review and delivery.
- Author complete Work Item specification `TASK-AI-40.md`.

## Out of scope

- Modifying `package.json` or installing any new dependencies.
- Re-implementing or altering `tools/ai-brain/usage-adapter.js` or `tools/ai-guard`.
- Retiring or modifying any genuine quality gate (`gitleaks`, `lefthook`, `trivy`,
  `axe-core`, `lighthouse-ci`, `agent-scan`).
- Upgrading or changing `codex-cli` pinned version (governed human decision).

## Business rules and edge cases

| Rule | Behavior |
|---|---|
| `AI-40-R01` | Manifest truthfulness invariant: An ecosystem manifest entry must accurately describe the tool's actual nature, kind, and role. Falsely declaring documentation repositories as execution harnesses or policy runtimes is prohibited. |
| `AI-40-R02` | Native capability non-duplication: External tools that duplicate existing, verified native repository systems (e.g. `token-tracker` duplicating `tools/ai-brain/usage-adapter.js`) must not be adopted. Retiring redundant entries takes precedence over satisfying them. |
| `AI-40-R03` | Formal retirement of `token-tracker`: `token-tracker` is formally retired from the ecosystem manifest. The native usage adapter in `tools/ai-brain` and dashboard in `tools/ai-dashboard` remain the sole authoritative token and quota tracking system. |
| `AI-40-R04` | Formal retirement of `sylph` from runtime role: `sylph` is formally retired from the ecosystem manifest as an execution harness and sandboxing policy runtime. The single-writer invariant is strictly enforced by `tools/ai-guard/cli.js` and `scripts/ai/control.ps1`. |
| `AI-40-R05` | Atomic cleanup of manifest profiles and references: When retired in implementation, all references across `tools/ecosystem-manifest.json`, `tools/ecosystem-profiles.json`, `tools/ai-brain/manifest-audit.js`, and `scripts/ai/ecosystem.ps1` must be removed synchronously to prevent dangling profile IDs or unresolvable audit aliases. |
| `AI-40-R06` | Preservation of security baseline and quality gates: Retirement of superseded/mis-described tools must not touch, downgrade, or alter the `ADOPTED` / `BLOCKING_GATE` / `ci-provisioned` status of `gitleaks 8.24.0`, nor the `PENDING` status of genuine upcoming quality gates (`lefthook`, `trivy`, `axe-core`, `lighthouse-ci`, `agent-scan`). |
| `AI-40-R07` | Audit and reconciler green gate invariance: Retirement implementation must preserve 0 errors on `node tools/ai-brain/cli.js manifest` (with only the single `codex-cli` drift warning permitted) and 0 errors on `node tools/ai-brain/cli.js reconcile`. |

## UI states

Not applicable; this Work Item has no user-facing screen. Developer- and
operator-facing outputs are CLI logs from:
- `node tools/ai-brain/cli.js manifest`: Must report 0 errors, 1 warning (`codex-cli`),
  and reflect reconciled repository counts.
- `node tools/ai-brain/cli.js reconcile`: Must report 0 errors.

## API, event and data impact

No schema, database, migration, or runtime API change. Affects governed
ecosystem toolchain metadata files (`tools/ecosystem-manifest.json`,
`tools/ecosystem-profiles.json`, `tools/ai-brain/manifest-audit.js`,
`scripts/ai/ecosystem.ps1`) and architectural documentation.

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| `AC-AI-40-01` | Truthfulness of baseline gate status | `gitleaks` remains accurately recorded as `ADOPTED`, `BLOCKING_GATE`, `ci-provisioned`; `lefthook` and `trivy` remain `PENDING` | `tools/ecosystem-manifest.json` inspect |
| `AC-AI-40-02` | Rationale and specification for `token-tracker` retirement | Specification details how the native usage adapter in `tools/ai-brain` satisfies token tracking, proving `token-tracker` is redundant | `TASK-AI-40.md` text and rule `AI-40-R02`, `AI-40-R03` |
| `AC-AI-40-03` | Rationale and specification for `sylph` retirement | Specification documents that `getnao/sylph` is static Markdown without a policy runtime, and confirms native claim guard in `tools/ai-guard` enforces single-writer protection | `TASK-AI-40.md` text and rule `AI-40-R01`, `AI-40-R04` |
| `AC-AI-40-04` | Manifest cleanup inventory and atomic removal plan | Specification defines exact list of files and profile references to clean upon implementation (`manifest.json`, `profiles.json`, `manifest-audit.js`, `ecosystem.ps1`) | `TASK-AI-40.md` text and rule `AI-40-R05` |
| `AC-AI-40-05` | Green gates non-regression | Manifest audit reports 0 errors and 1 warning (`codex-cli` drift); reconciler reports 0 errors; all 458 tests pass | CLI test and audit stdout |
| `AC-AI-40-06` | Specification and contract gate compliance | Work Item follows `TASK-AI-16.md` structure exactly; zero angle-bracket placeholders; exactly one Work Item file changed in PR | `python docs/product-spec/scripts/validate_docs.py` & PR review |

## Verification commands

```
node tools/ai-brain/cli.js manifest
node tools/ai-brain/cli.js reconcile
node --test "tools/ai-brain/test/*.test.js" "tools/ai-dashboard/test/*.test.js" "tools/ai-guard/test/*.test.js"
python docs/product-spec/scripts/validate_docs.py
```

## Codex review record

| Review round | Commit | Verdict | Findings resolved |
|---|---|---|---|
| 1 | `<sha>` | `<PASS/CHANGES_REQUIRED/BLOCKED>` | `<links>` |

## Residual limitations

Retiring `token-tracker` and `sylph` removes misleading or redundant entries from
the catalog but does not alter developer workflow, since neither tool was ever
installed on the host or integrated into CI. Local quota visibility continues to
be provided by `tools/ai-dashboard`, and workspace isolation continues to be
enforced by `tools/ai-guard`. Pinned `codex-cli` version drift remains documented
pending a formal human upgrade decision.
