# TASK-AI-111 — Work Item branch names derive from one pure slugify helper

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-111` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `223` |
| Dependencies |  |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/slugify.js`; `tools/ai-brain/test/proof-slugify.test.js`; `docs/product-spec/work-items/TASK-AI-111.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-111` |
| Pull Request | `Pending` |

## Business Outcome

`AGENTS.md` requires one branch shape per Work Item,
`feat/<lowercase-work-item-id>-<short-slug>` (or `fix/...`), but the repository
had no single place that derived it. Each caller spelled its own casing,
separator and truncation rules, so the same Work Item could produce different
branch names across runs and hosts, and the register, the controller and the
worker could not be reconciled on the branch string alone.

This Work Item adds a pure `slugify(text)` helper and a `branchName` helper that
uses it. `slugify` lower-cases, collapses every run of non `[a-z0-9]` characters
to a single `-`, trims leading and trailing `-`, and caps the result at 48
characters with no trailing `-`; input that is not a string or that normalizes to
nothing throws `SLUGIFY_INPUT_INVALID`. `branchName(workItemId, shortSlug, kind)`
returns `feat/<lowercase-work-item-id>-<short-slug>`, with `kind` defaulting to
`feat` and restricted to `feat` or `fix`. The module is pure and uses no
dependencies at all, so every host derives the identical name from the identical
Work Item.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| SL-R01 | `slugify(text)` normalization | Lower-cased; runs of non `[a-z0-9]` become one `-`; leading/trailing `-` trimmed; result capped at 48 characters with no trailing `-` | SL-R01 tests in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R02 | Non-string input, or input that is empty after slugify | Throws `Error` with code `SLUGIFY_INPUT_INVALID` | SL-R02 tests in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R03 | Purity and tooling | `slugify.js` loads no dependencies at all (Node built-ins not even needed), calls are deterministic and stateless, proof runs under `node:test` | SL-R03 tests in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R04 | Documentation and register | This Work Item document exists with Control, Business Outcome, Acceptance Matrix, Verification Commands and Residual Limitations; register gains row `223` for `TASK-AI-111`, status `READY_FOR_CODEX`, branch `feat/task-ai-111` | `docs/product-spec/work-items/TASK-AI-111.md` and the appended row in `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| SL-R05 | `branchName(workItemId, shortSlug, kind)` | Returns `feat/<lowercase-work-item-id>-<short-slug>` or `fix/...` with both segments derived through `slugify`; `kind` defaults to `feat` and must be `feat` or `fix`, otherwise `Error` with code `BRANCH_NAME_INPUT_INVALID`; invalid text segments surface `SLUGIFY_INPUT_INVALID` | SL-R05 tests in `tools/ai-brain/test/proof-slugify.test.js` |

## Verification Commands

- `node --test tools/ai-brain/test/proof-slugify.test.js`
- `git diff --check`

## Residual Limitations

- `slugify` deliberately keeps only `[a-z0-9]`, so non-ASCII letters (for example accented Vietnamese) become `-` runs and are lost from the slug; the helper derives branch names, not display labels.
- The 48-character cap is applied after normalization and may shorten a long short-slug; two different long titles can therefore collapse to the same slug, and the caller keeps ownership of uniqueness.
- `branchName` restricts `kind` to `feat` and `fix` per `AGENTS.md`; any future branch kind needs a deliberate change here rather than a free-form string.
- Invalid text segments report `SLUGIFY_INPUT_INVALID` (the delegated failure) rather than a branch-specific code; only the `kind` argument reports `BRANCH_NAME_INPUT_INVALID`.
