# TASK-AI-182 — Controller cleanup and module split after combo-only routing

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-182` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-171` (combo-only routing) |
| Assigned author | agy08 (cleanup and split), Claude Code (review fixes, packaging) |
| Risk | `MEDIUM`: deletes modules and moves code across files; no intended behaviour change |
| Allowed paths | `tools/ai-brain/**`; `docs/product-spec/work-items/TASK-AI-182.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | Independent reviewer on a different model from the authors |
| Branch | `feat/task-ai-182-controller-cleanup` |

## Business outcome

After TASK-AI-171 every model call goes through one 9router combo. The Controller still carries modules from the old route-generation engine, and three files are too large to review: `orchestrate.js` (about 9,000 lines), `cli.js` (about 4,300) and `isolation-launcher.js` (about 3,700). This item removes the unreachable modules and splits the large files into smaller modules, with no change in behaviour, so later Controller work can be reviewed and changed safely.

The operator approved this work on 2026-11-20. In that approval, cleanup and split were requested together, so they ship as one Work Item.

## Scope and acceptance

1. **Dead modules removed.** These modules have no remaining caller and are deleted, together with their dedicated tests and the acceptance scripts that only exercised them:
   - `qualification-auto`, `source-access`, `check-failure-task`, `output-store`, `jev-wrapper`, `qualification`
   - `route-handoff`, `coordinator-claim`, `coordinator-ledger`, `coordinator-completion`

   `git grep` finds no `require` of a deleted module.
2. **Live coverage kept.**
   - Tests that also cover live modules are trimmed, not deleted: `task-ai-78` covers `repo-map` and `scope-gate`; `task-ai-171-route-pr12-options` covers `coordinator-options` and `dispatch-output`; `task-ai-171-jev-contract` covers `jev`.
   - Two test files are deleted outright because they test the multi-route fallback chain, which combo-only routing removed: `task-ai-171-auth-scope` and `task-ai-171-fallback-chain`.
3. **Large files split by moving code only.**
   - `orchestrate.js` → `orchestrate/*.js`, `cli.js` → `cli/*.js`, `isolation-launcher.js` → `isolation/*.js`.
   - Code is moved, not rewritten. Each original file keeps its full `module.exports` surface: export parity holds for `orchestrate` (40/40, plus `verifyReceiptReviewerSeparation` exported by TASK-AI-171), `cli` (24/24) and `isolation-launcher` (29/29).
   - `cli.js` also exports `executeDispatchLaunch`, which `cli/dispatch.js` calls lazily. The function stays in `cli.js` because its baselined `maxAttempts: 1` is keyed to that file, and the hardcode baseline may only shrink (operator decision, 2026-11-20).
   - Submodules resolve data paths through the parent directory: `path.join(__dirname, '..', 'data', …)`. `test/task-ai-182-split-paths.test.js` refuses any `__dirname` path in `cli/`, `orchestrate/` or `isolation/` that does not start with `'..'`.
4. **One definition per shared constant.** `PublicationStatus`, `ACCEPTED_VERDICTS`, `SHA_40` and `roleOf` live once in `orchestrate/shared.js`.
5. **Source-text tests stay strict.** Tests that read source text read the parent file plus its submodules (`test/helpers/orchestrate-sources.js`, `test/helpers/isolation-sources.js`), so negative assertions still cover the moved code.
6. **No unresolved identifiers.** An ESLint `no-undef` scan of every split module reports none.
7. **Controller still runs.** `node tools/ai-brain/cli.js dispatch --dry-run --work-item TASK-AI-171` resolves the single 9router combo `vinh`.

## Verification

- Full suite: `node --test "tools/ai-brain/test/*.test.js"`. The only failures allowed are the known Windows-only ones (`repo-integration-vercel-skills`, `task-ai-109`, `task-ai-109-ui`, `task-ai-136`); CI Linux is authoritative.
- Move check per commit: compare the lines removed from each parent file with the lines added under its new directory. The only differences allowed are `require` path depth, module headers and exports.
- `no-undef` scan, export-parity check and Controller dry-run as above.

## Out of scope

- `tools/ai-brain/review-manifest.js:462` uses `path` without requiring it. This bug already exists on `main`, so it belongs in a separate Work Item.
- Further splitting of modules still above 800 lines (`cli/dispatch.js`, `orchestrate/review-item.js`, `cli/dispatch-helpers.js`, `orchestrate/review-lane.js`, `orchestrate/writer-loop.js`).
- Retiring the remaining old `cli.js` subcommands and their modules (`capability-probe`, `rolling-onboard`, `catalogue-refresh`, `scoring-policy`, `account-entry`, `writer-selection`).
