# TASK-AI-108 — The Controller imports a model evaluation file

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-108` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `221` |
| Dependencies | `TASK-AI-62`; `TASK-AI-107` |
| Assigned author | `GEMINI` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/evaluation-import.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/evidence.js`; `tools/ai-brain/test/task-ai-108.test.js`; `tools/ai-brain/test/fixtures/model-evaluation-sample.json`; `docs/product-spec/work-items/TASK-AI-108.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-108-import-model-evaluation` |
| Pull Request | `Pending` |

## Business Outcome

The Controller can turn a real model evaluation file (`shipde-model-evaluation/1`) into
evidence instead of re-probing everything by hand. One command,
`node tools/ai-brain/cli.js evidence import-evaluation --file <path>`, validates the file,
records `API_PASS` evidence for every `ALIVE` candidate, sets or refreshes a cooldown for
every `QUOTA` candidate, and prints `imported alive` / `cooldowns set` / `skipped` /
`rejected` counts. It writes only through the existing `evidence.js` store — no second
store and no new file format — so routing keeps reading one source of truth. Import is
idempotent and all-or-nothing: a malformed file is refused whole with a named error and
nothing is written.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| EV-R01 | CLI `evidence import-evaluation --file <path> [--evidence-dir <dir>] [--dry-run]` | Validates the schema id, writes through `evidence.js`, prints `imported alive`, `cooldowns set`, `skipped`, `rejected`; `--json` prints the same counts; missing `--file` is exit 2; an unreadable file is exit 1 with `INPUT_UNREADABLE` | `node --test tools/ai-brain/test/task-ai-108.test.js` (EV-R01 CLI suite, spawns `cli.js`) |
| EV-R02 | An `ALIVE` candidate | Records `API_PASS` with `observedAt` and source `model-evaluation`; never `HARNESS_PASS`/`WORK_ITEM_PASS`; never lowers an existing higher proof level; non-alive, non-quota candidates create no combination | EV-R02 suite in `tools/ai-brain/test/task-ai-108.test.js` |
| EV-R03 | A `QUOTA` candidate | Sets/refreshes a cooldown using `resetAt` when present, else the failure-classifier default; `isCandidateBlocked` true before the reset and false after; a later observation refreshes and an older one does not regress it | EV-R03 suite in `tools/ai-brain/test/task-ai-108.test.js` |
| EV-R04 | `callContract` notes | Stored on the combination (omitted params, max concurrency); selection logic unchanged | EV-R04 suite in `tools/ai-brain/test/task-ai-108.test.js` |
| EV-R05 | Re-import the same file | Idempotent: no duplicate evidence items, byte-identical store, same cooldowns | EV-R05 suite in `tools/ai-brain/test/task-ai-108.test.js` |
| EV-R06 | Malformed input | Wrong schema, a `candidateKey` that is not 7 parts, `ALIVE` without `API_PASS`, or a `proofLevel` above `API_PASS` is refused with a named error and nothing is written (an existing store stays byte-identical) | EV-R06 suite in `tools/ai-brain/test/task-ai-108.test.js` |
| EV-R07 | Fixture hygiene | `node:test` coverage of EV-R01..EV-R06 with temp evidence dirs and a fixture of at most 20 candidates copied from `.eval-input.json`, no secrets; existing tests untouched | `tools/ai-brain/test/task-ai-108.test.js`, `tools/ai-brain/test/fixtures/model-evaluation-sample.json` |
| EV-R08 | Handoff metadata | Work Item file and one register row `221`, `READY_FOR_CODEX`, branch `feat/task-ai-108-import-model-evaluation` | This document and the register diff |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-108.test.js tools/ai-brain/test/task-ai-75.test.js tools/ai-brain/test/task-ai-107.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/evaluation-import.js tools/ai-brain/cli.js tools/ai-brain/evidence.js tools/ai-brain/test/task-ai-108.test.js docs/product-spec/work-items/TASK-AI-108.md docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv`
- `git diff --check`

## Residual Limitations

- `callContract` is stored as notes on the combination only (`notes`, `omitParams`, `maxConcurrency`). It does not change selection, concurrency or dispatch behaviour; enforcing it is a later Work Item.
- Cooldown refresh is ordered by the candidate's `observedAt`. An evaluation file with a missing or unparseable `observedAt` for a `QUOTA` candidate cannot claim to be newer and is skipped rather than guessed at.
- The importer recognises the statuses named by the evaluation schema. An `ALIVE` candidate must carry `API_PASS`; any other proof level is refused (`PROOF_LEVEL_TOO_HIGH`) because this source can never prove a harness or work-item outcome.
- The fixture is a 16-candidate copy from the real (uncommitted) `.eval-input.json`; the real file, the spec and `PROMPT` files are not committed.
- `evidence.js` gains one export (`findCombo`) so callers can look a combination up without touching raw JSON. No existing behaviour or test is weakened.
