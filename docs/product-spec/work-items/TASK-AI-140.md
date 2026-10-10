# TASK-AI-140 — Format findings with the repository formatter

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-140` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `250` |
| Dependencies | `TASK-AI-123`, `TASK-AI-129`, `TASK-AI-136` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/decisions.js`; `tools/ai-brain/test/task-ai-140.test.js`; `docs/product-spec/work-items/TASK-AI-140.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-140-auto-format` |
| Pull Request | `Pending` |

## Business Outcome

A format-only finding should be repaired deterministically by the exact repository formatter before any model is invoked. The format gate runs `./node_modules/.bin/prettier --write <files>` in the worker checkout over exactly the failing files, rechecks them, and commits only those paths with the worker's Git identity. A successful result is recorded as `format_autofixed`, and orchestration continues against that formatter commit.

If the repository formatter cannot parse the file or crashes, the existing repair round remains available. Its prompt gives the exact command and forbids logic or behavior edits. The controller compares each repaired file against Prettier's output from its pre-repair contents and refuses with `REPAIR_SCOPE_EXCEEDED` when they differ. A dirty worker tree refuses the auto-fix with `WORKER_TREE_DIRTY`.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AF-R01 | Unformatted worker file | Repo Prettier writes exactly the failing files, passes `--check`, commits them locally, records `format_autofixed`, and launches no model repair | `tools/ai-brain/test/task-ai-140.test.js` |
| AF-R02 | Syntax error or formatter crash | Existing repair path receives a prompt with exact `./node_modules/.bin/prettier --write <files>` command and format-only restriction | `tools/ai-brain/test/task-ai-140.test.js` |
| AF-R03 | Logic change in a format repair | Compare repaired content to Prettier output of pre-repair content and refuse with `REPAIR_SCOPE_EXCEEDED` | `tools/ai-brain/test/task-ai-140.test.js` |
| AF-R03 | Unrelated dirty worker changes | Do not auto-format or commit; record `WORKER_TREE_DIRTY` and refuse | `tools/ai-brain/test/task-ai-140.test.js` |
| AF-R04 | Regression proofs | Four node:test scenarios use temporary Git repositories and real installed Prettier; each fails against origin/main | `node --test tools/ai-brain/test/task-ai-140.test.js` |
| AF-R05 | Handoff metadata | Work Item is ready for review and exactly one quoted register row 250 is appended | Work Item and register diff; register numstat `1 0` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-140.test.js tools/ai-brain/test/task-ai-123.test.js tools/ai-brain/test/task-ai-129.test.js`
- `node --test tools/ai-brain/test/*.test.js` with `NINEROUTER_API_KEY` unset
- `./node_modules/.bin/prettier --check` on changed JavaScript files
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: on `origin/main`, `task-ai-140.test.js` does not exist; the new four-proof suite fails there. Existing formatter findings are sent directly to model repair instead of first trying repo Prettier.
- Pass-after: pending execution in this worktree; exact command results will be added before handoff.

## Residual Limitations

- The automatic formatter requires the worker checkout's `.bin/prettier` executable to be provisioned. Missing or unusable worker dependencies use the existing bounded repair path.
- The format-only comparison covers each originally failing file and uses the repository's installed Prettier configuration.
