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

Work Item branches were derived by hand in several shapes across the register and the Controller (`feat/task-ai-111`, `fix/task-ai-123-draft-title-and-format-gate`, `feat/` + lower-cased id inline in `orchestrate.js`). Each caller spelled its own derivation, so the same Work Item text could produce different branch names depending on where it was written.

This Work Item adds one pure helper module, `tools/ai-brain/slugify.js`, that owns the derivation:

- `slugify(text)` lower-cases, replaces runs of non `[a-z0-9]` with a single `-`, trims leading/trailing `-`, and caps the result at 48 characters without a trailing `-`.
- `branchNameFor(kind, workItemId, title?)` composes `kind/<slugified work item id>` with the slugified title appended when one is given, e.g. `feat/task-ai-111-add-slugify-helper`.
- Input that cannot produce a slug (non-string, or empty after slugifying) is refused with `Error` carrying `code = SLUGIFY_INPUT_INVALID`, never replaced with a guessed name.

The module is pure (no I/O, no clock, no state) and uses Node built-ins only, so any caller can derive the same branch name from the same Work Item text.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| SL-R01 | Lower-case | `slugify('MiXeD CaSe')` returns `mixed-case` | `slugify lower-cases the input` in `tools/ai-brain/test/proof-slugify.test.js` |
| SL-R01 | Runs of non [a-z0-9] collapse to one dash | `slugify('a  b__c!!d')` returns `a-b-c-d`; `slugify('Résumé 2024')` returns `r-sum-2024` | `slugify replaces runs of non [a-z0-9] with a single dash` |
| SL-R01 | Leading/trailing dashes trimmed | `slugify('--Hello--World--')` returns `hello-world` | `slugify trims leading and trailing dashes` |
| SL-R01 | Cap at 48 characters, no trailing dash | `slugify('x'.repeat(60))` returns 48 `x` characters; a cap that would end on a dash drops it | `slugify caps the result at 48 characters`; `slugify never ends with a dash after the cap` |
| SL-R02 | Non-string input refused | `Error` with `code = SLUGIFY_INPUT_INVALID` for `null`, `undefined`, `42`, `{}`, `[]`, `true` | `slugify throws SLUGIFY_INPUT_INVALID for non-string input` |
| SL-R02 | Empty-after-slugify input refused | `Error` with `code = SLUGIFY_INPUT_INVALID` for `''`, `'   '`, `'---'`, `'!!!'`, `'___'` | `slugify throws SLUGIFY_INPUT_INVALID when the input slugs to nothing` |
| SL-R03 | Purity | Same input gives the same output and the input is not mutated | `slugify is pure across calls` |
| SL-R03 | Node built-ins only | Every `require` specifier in `slugify.js` is a `node:` built-in (the module ships none) | `slugify ships no dependencies beyond Node built-ins` |
| BN-R01 | Branch from kind, id and title | `branchNameFor('feat', 'TASK-AI-111', 'Add slugify Helper!')` returns `feat/task-ai-111-add-slugify-helper` | `branchNameFor returns feat/ plus lower-cased work item id and slugified title` |
| BN-R01 | Title omitted | `branchNameFor('feat', 'TASK-AI-111')` returns `feat/task-ai-111` | `branchNameFor omits the title when none is given` |
| BN-R01 | `fix` kind derives the same way | `branchNameFor('fix', 'TASK-AI-120', 'Resume After Fail Before')` returns `fix/task-ai-120-resume-after-fail-before` | `branchNameFor derives fix branches the same way` |
| BN-R01 | Unusable input refused | `SLUGIFY_INPUT_INVALID` propagates for a title that slugs to nothing and for non-string kind or id | `branchNameFor propagates SLUGIFY_INPUT_INVALID for unusable input` |
| SL-R04 | Work Item and register | This document with Control, Business Outcome, Acceptance Matrix, Verification Commands, Residual Limitations; one appended register row `223` (`READY_FOR_CODEX`, branch `feat/task-ai-111`) | `git diff --numstat` for the register is `1 0` |

## Verification Commands

- `node --test tools/ai-brain/test/proof-slugify.test.js` — 13 pass, 0 fail
- `node --test "tools/ai-brain/test/*.test.js"` — 1557 pass, 48 fail, none of them related to this Work Item (see below)
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: `node --test tools/ai-brain/test/proof-slugify.test.js` fails with `Cannot find module '../slugify'` (watched and recorded before implementation).
- Pass-after: 13 pass, 0 fail on the same command.

## Residual Limitations

- `branchNameFor` caps each slug at 48 characters but does not cap the composed branch name; the worst case is `kind/` + 48 + 1 + 48 characters.
- `branchNameFor` accepts any kind that slugs cleanly (it does not restrict to `feat`/`fix`); callers own the branch-prefix policy.
- A title that is present but slugs to nothing is refused rather than dropped, so `branchNameFor('feat', 'TASK-AI-111', '!!!')` throws instead of silently returning `feat/task-ai-111`.
- `node_modules` is not installed in this workspace, so `prettier --check` could not be run; formatting follows `.prettierrc` by hand and no format gate was executed here.
- The brain suite run carries 48 pre-existing failures in files outside this Work Item's allowed paths (publisher refusal expectations, `regression 10: discovery source and test files pass prettier format check` which cannot `require('prettier')` without `node_modules`, `PowerShell WhatIf runs without changes`, gateway and isolation cases). No failing test imports `tools/ai-brain/slugify.js`; this Work Item adds new files only and touches no module those tests read.
