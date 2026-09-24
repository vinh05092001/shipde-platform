# TASK-AI-32 — Serena read-only pilot for code retrieval

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-32` |
| Feature ID | `N/A` |
| Status | `BLOCKED_DEPENDENCY` |
| Delivery order | `165` |
| Dependencies | `TASK-AI-31` |
| Assigned author | `GEMINI` |
| Risk | `LOW` |
| Allowed paths | `docs/product-spec/work-items/TASK-AI-32.md`<br>`docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`<br>`tools/snapshots/serena/README.md`<br>`tools/snapshots/serena/snapshot-manifest.json`<br>`tools/ai-brain/serena.js`<br>`tools/ai-brain/cli.js`<br>`tools/ai-brain/test/serena.test.js`<br>`tools/ai-brain/acceptance/ac-32-*.js`<br>`tools/ai-brain/acceptance/lib/serena-pilot.js` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-32-impl-d-180059` |
| Pull Request | Pending |

## Status transition ledger

```
BACKLOG
  │
  ▼
BLOCKED_DEPENDENCY   ◄── current stage (register row 165)
  │
  ▼
READY_FOR_AUTHOR
  │
  ▼
IN_PROGRESS
  │
  ▼
READY_FOR_CODEX
  │
  ▼
CHANGES_REQUIRED
  │
  ▼
READY_FOR_CODEX
  │
  ▼
CODEX_PASS
  │
  ▼
MERGED
```

- Current stage: `BLOCKED_DEPENDENCY` (matching delivery register row 165).
- Ledger consequences:
  - This specification must never declare `READY_FOR_CODEX` or later while the register records `BLOCKED_DEPENDENCY`.
  - Review verdict remains `NOT_REVIEWED`.
  - Dependency `TASK-AI-31` is merged in Git reality (`a7c1bc9`, PR #119).
  - Transition to `READY_FOR_AUTHOR` occurs when the reconciler updates the register.

## Business outcome

Serena (`oraios/serena`) is an AI coding agent toolkit and AST indexing assistant adopted under `RESEARCH_ONLY` in [AI-TOOLCHAIN-DECISIONS.md](../docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md).

When authors (Gemini, Claude, 9Router) implement product features, inspecting symbols, definitions, and usages across multi-hundred-line files previously required loading entire files into LLM prompts. This inflated context sizes and depleted author token budgets.

This Work Item establishes the **Serena read-only pilot for code retrieval**, delivering:

1. **Symbol Definition Retrieval**: Extracts targeted functions, classes, methods, variables, interfaces, and types with precise file paths, line bounds (`startLine`, `endLine`), signatures, and code blocks.
2. **Reference Resolution**: Scans word-boundary identifiers across codebase files to locate call sites, imports, and usages.
3. **Strict Read-Only Invariant (`AI-32-R01`)**: Retrieval operations never mutate source files or repository state; mutation attempts fail with `MUTATION_REFUSED`.
4. **TokenPerMergedItem Efficiency (`AI-32-R03`)**: Measures prompt token reduction of focused retrieval against full-file context ingestion, maintaining author token consumption well within the 500,000 ceiling (`TOKENS_PER_MERGED_CEILING` from `TASK-AI-25`).
5. **Source of Truth Boundary (`AI-32-R02`)**: Serena is a code analysis assistant; its output is implementation evidence, never business authority.

## Source references

- [BASELINE-AND-DECISIONS.md](../docs/00-control/BASELINE-AND-DECISIONS.md)
- [AI-TOOLCHAIN-DECISIONS.md](../docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md) § Governed Ecosystem Catalog, § Activation Profiles, § Serena read-only code retrieval pilot
- [SEMI-MANUAL-AI-WORKFLOW.md](../docs/10-ai-collaboration/SEMI-MANUAL-AI-WORKFLOW.md) § Backend implementation (Gemini, Serena, Context7, governed coding skills)
- [FEATURE-DELIVERY-REGISTER.csv](../docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv) row 165
- [TASK-AI-25.md](TASK-AI-25.md) (`TokenPerMergedItem`, `TOKENS_PER_MERGED_CEILING = 500000`)
- [TASK-AI-31.md](TASK-AI-31.md) (Prerequisite qualification gate)
- `tools/ecosystem-manifest.json` (`serena`, `ast-index-read`, `tools/snapshots/serena`)

## Preconditions and dependencies

- `TASK-AI-31` is merged into `origin/main` at commit `a7c1bc9b01678a1ff3f7fdf15349c6222d1d307d` (PR #119).
- Delivery register row 165 records `TASK-AI-32` as `BLOCKED_DEPENDENCY`.
- Node.js v24 runtime with standard library execution (no external network or unvetted npm packages).

## Author boundary

- Author is `GEMINI`.
- Allowed paths are strictly bounded to the 9 paths listed in the Control table.
- Prohibitions:
  - Modifying product application code (`apps/`, `packages/`, `prisma/`).
  - Mutating source files during code retrieval.
  - Adding network calls, external API dependencies, or third-party packages.
  - Modifying `FEATURE-DELIVERY-REGISTER.csv`.
  - Author self-approval.

## In scope / Out of scope

### In scope

- Reference snapshot in `tools/snapshots/serena/` (`README.md`, `snapshot-manifest.json`).
- Core module `tools/ai-brain/serena.js` implementing symbol lookup, reference lookup, read-only enforcement (`MUTATION_REFUSED`), token measurement, and CLI interface.
- CLI subcommand `serena` in `tools/ai-brain/cli.js` (`lookup`, `references`, `measure`, `health`).
- Governed pilot library in `tools/ai-brain/acceptance/lib/serena-pilot.js`.
- Deterministic unit tests in `tools/ai-brain/test/serena.test.js`.
- Acceptance test suite `tools/ai-brain/acceptance/ac-32-01` through `ac-32-10`.
- Toolchain decision entry in `docs/product-spec/docs/10-ai-collaboration/AI-TOOLCHAIN-DECISIONS.md`.

### Out of scope

- Modifying `FEATURE-DELIVERY-REGISTER.csv`.
- Modifying production runtime application code.
- Adding mutation/write capabilities to Serena.
- Calling external Python runtime or network services.

## Business rules and edge cases

- `AI-32-R01`: **Read-Only Invariant**: All code retrieval operations are strictly read-only. Any attempt to request mutation, editing, or writing immediately throws or exits with `MUTATION_REFUSED`.
- `AI-32-R02`: **Source of Truth Boundary**: Serena is a code analysis assistant; output is implementation evidence, never business authority.
- `AI-32-R03`: **TokenPerMergedItem Measurement**: Measured against the 500,000 ceiling (`TOKENS_PER_MERGED_CEILING`), reporting percentage savings over full-file context.
- `AI-32-R04`: **Deterministic Extraction**: Extracts exact signatures, line spans (`startLine`, `endLine`), and code blocks for functions, classes, methods, variables, and types.
- `AI-32-R05`: **Reference Resolution**: Locates symbol usages across codebase files by identifier boundary scanning.
- `AI-32-R06`: **Fail-Closed on Missing Source**: Missing or unreadable files report `SOURCE_MISSING` and fail gracefully.

## UI states

N/A (CLI / engine only).

CLI exit states:
- `0`: Success (lookup/references/measurement completed, health check healthy).
- `1`: Failure / refusal (mutation attempt rejected, finding detected).
- `2`: Missing arguments or missing source (`SOURCE_MISSING`).

## API, event and data impact

- Reads: Local repository source files.
- Writes: None. No database migrations, no external events, no persistent state mutations.
- Idempotency: All operations are idempotent pure reads.


## Acceptance matrix

| Criterion | Type | Description | Target |
|---|---|---|---|
| `AC-AI-32-01` | Invariant | Control table status matches register row 165 (`BLOCKED_DEPENDENCY`) | `tools/ai-brain/acceptance/ac-32-01-status-alignment.js` |
| `AC-AI-32-02` | Negative proof | Tampered specification copy is detected and rejected | `tools/ai-brain/acceptance/ac-32-02-status-divergence.js` |
| `AC-AI-32-03` | Invariant | Dependency `TASK-AI-31` declared in row 165 is verified merged in `origin/main` | `tools/ai-brain/acceptance/ac-32-03-dependency-merged.js` |
| `AC-AI-32-04` | Negative proof | Unmerged dependency (`TASK-AI-99`) is rejected | `tools/ai-brain/acceptance/ac-32-04-dependency-unproven.js` |
| `AC-AI-32-05` | Invariant | Serena pilot contract: symbol and reference lookup succeeds under `ast-index-read` | `tools/ai-brain/acceptance/ac-32-05-serena-contract.js` |
| `AC-AI-32-06` | Negative proof | Mutation attempt during code retrieval is strictly rejected (`MUTATION_REFUSED`) | `tools/ai-brain/acceptance/ac-32-06-mutation-rejected.js` |
| `AC-AI-32-07` | Invariant | TokenPerMergedItem efficiency: symbol retrieval achieves measured token savings vs full files | `tools/ai-brain/acceptance/ac-32-07-token-efficiency.js` |
| `AC-AI-32-08` | Probe | Negative proofs fail operationally (`SOURCE_MISSING`, exit 2) outside repository | `tools/ai-brain/acceptance/ac-32-08-outside-repository.js` |
| `AC-AI-32-09` | Regression | Register reconciliation passes with 0 errors | `tools/ai-brain/acceptance/ac-32-09-reconcile-clean.js` |
| `AC-AI-32-10` | Regression | Specification and documentation validation passes with 0 errors | `tools/ai-brain/acceptance/ac-32-10-docs-validate.js` |

## Verification commands

```bash
node tools/ai-brain/acceptance/ac-32-01-status-alignment.js
node tools/ai-brain/acceptance/ac-32-02-status-divergence.js
node tools/ai-brain/acceptance/ac-32-03-dependency-merged.js
node tools/ai-brain/acceptance/ac-32-04-dependency-unproven.js
node tools/ai-brain/acceptance/ac-32-05-serena-contract.js
node tools/ai-brain/acceptance/ac-32-06-mutation-rejected.js
node tools/ai-brain/acceptance/ac-32-07-token-efficiency.js
node tools/ai-brain/acceptance/ac-32-08-outside-repository.js
node tools/ai-brain/acceptance/ac-32-09-reconcile-clean.js
node tools/ai-brain/acceptance/ac-32-10-docs-validate.js
node --test tools/ai-brain/test/serena.test.js
```

## Codex review record

| Field | Value |
|---|---|
| Review round | `1` |
| Commit | `Pending` |
| Verdict | `NOT_REVIEWED` |
| Findings resolved | `None` |

## Residual limitations

None
