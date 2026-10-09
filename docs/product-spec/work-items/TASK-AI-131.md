# TASK-AI-131 — Controller intake: one command turns a Work Item ID into a full Controller run, with no hand-written inputs

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-131` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `244` |
| Dependencies | `None` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Complexity | `standard` |
| Allowed paths | `tools/ai-brain/intake.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/test/task-ai-131.test.js`; `docs/product-spec/work-items/TASK-AI-131.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `feat/task-ai-131-intake` |
| Pull Request | `Pending` |

## Business Outcome

Every Controller run to date needed the supervisor to hand-write five things: `goal.txt`, `specs.json` (id, roleRequirement, complexity, allowedPaths, dependencies, acceptanceCriteria, verification), `catalogue.json`, `accounts.json`, and the orchestrate command line. The hand-written catalogue even hard-coded a preferred model first, which the operator rejected. This Work Item removes that hand-authoring: `node tools/ai-brain/cli.js intake --work-item <ID> [--run] [--publish]` builds every orchestrate input from repository sources only, discovers the model catalogue live, and composes the orchestrate command from policy.

IN-R01: `intake --work-item <ID> [--run] [--publish]` reads `docs/product-spec/work-items/<ID>.md` and its register row, and derives id; role (author.foundation by default, or the role the Work Item names); complexity; allowedPaths (from the allowed files / scope); dependencies (from the register); acceptanceCriteria (from the acceptance matrix rows); verification (from the Work Item's verification commands or the AGENTS.md foundation commands); and the goal (from the business outcome). It writes them to `tools/ai-brain/data/intake/<ID>-<timestamp>/`.

IN-R02: if a required section is missing or ambiguous, intake refuses with `INTAKE_INCOMPLETE` and lists exactly what is missing. It never guesses or invents product meaning.

IN-R03: the catalogue is discovered live, never hard-coded: the 9router `/v1/models` listing (endpoint and key from the existing source config and env, never printed), the `agy models` listing when the agy CLI exists, and models already in evidence. A failing source records a warning and the others are used; if all fail it refuses with `CATALOGUE_UNAVAILABLE`. No model id literal may appear in intake code.

IN-R04: accounts come from the existing accounts registry / `listAccounts`.

IN-R05: orchestrate flags come from policy, not hand-typed values: `--isolated-worker`, `--review-budget 2`, `--worker-timeout-min 60`; `--base-sha` = the full sha of `origin/main`; `--cwd` = the repo root, absolute; `--external-workers agy-pool` when the agy pool has any account with quota; checkpoint and decision dir inside the run dir. With `--run`, intake starts orchestrate; without it, it prints the exact command and the inputs dir.

IN-R06: the isolation verdict freshness (24h) and "local main contains base" are checked before `--run`. A stale verdict refuses with `ISOLATION_VERDICT_STALE` and the exact refresh command. It does not change any ACL or policy itself.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| IN-R01 | Full derivation | id, role, complexity, allowedPaths, dependencies, acceptanceCriteria, verification and goal derived from a fixture Work Item and register row | Test |
| IN-R02 | Missing section | Refuses with `INTAKE_INCOMPLETE` listing exactly what is missing | Test |
| IN-R03 | Live catalogue, one source failing | Merges the remaining listings and records a warning for the failed source | Test |
| IN-R03 | All catalogue sources failing | Refuses with `CATALOGUE_UNAVAILABLE` | Test |
| IN-R03 | No model id literal | The intake source contains no hard-coded model id | Test |
| IN-R05 | Printed command | The printed orchestrate command carries every policy flag and value | Test |
| IN-R06 | Stale isolation verdict | Refuses with `ISOLATION_VERDICT_STALE` and the exact refresh command; does not start orchestrate | Test |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-131.test.js tools/ai-brain/test/candidates.test.js tools/ai-brain/test/task-ai-126.test.js`

## Fail-Before / Pass-After

- Fail-before (on `origin/main`, `fee07f2c`): `tools/ai-brain/intake.js` and `tools/ai-brain/test/task-ai-131.test.js` are absent entirely, so `node --test tools/ai-brain/test/task-ai-131.test.js` cannot load the suite and every one of the seven tests fails (no module, no file). The seven tests each require the new `intake` module or read `intake.js`, so none can pass without this Work Item's implementation.
- Pass-after (this revision): `node --test tools/ai-brain/test/task-ai-131.test.js tools/ai-brain/test/candidates.test.js tools/ai-brain/test/task-ai-126.test.js` with `NINEROUTER_API_KEY` removed → all three suites pass (`task-ai-131`: 7/7). `./node_modules/.bin/prettier --check` on every changed file and `git diff --check` are clean.

## Residual Limitations

- `complexity` is taken from the Work Item's `Complexity` field when it names one and otherwise falls back to the routing default `standard` (planner's own default). It is never derived from Risk or invented per item; a Work Item that wants a non-default complexity must declare it.
- The `agy models` listing is parsed best-effort (JSON or one id per whitespace-free line). A vendor output shape outside those two forms is recorded as a failing source and the other listings are used.
- The `--external-workers agy-pool` decision reads the cached quota readings; a pool account whose cache is empty or stale is treated as having no quota (the flag is omitted) rather than being probed live.
- With `--run`, intake only checks isolation freshness and base ancestry, then launches the composed orchestrate command. It does not itself validate the verdict's `CLOSED` state, SID or policy hash — the isolated launcher performs those checks at spawn time.
