# TASK-AI-122 — Each Work Item in a run publishes its own draft PR with its own review and approval

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-122` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `235` |
| Dependencies | `TASK-AI-121` |
| Assigned author | `9ROUTER` |
| Risk | `HIGH` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/cli.js`; `tools/ai-brain/publisher.js`; `tools/ai-brain/test/task-ai-122.test.js`; `docs/product-spec/work-items/TASK-AI-122.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-122-per-item-publish` |
| Pull Request | `Pending` |

## Business Outcome

Gate5g evidence (2026-10-08, one run with `TASK-AI-111` then dependent `TASK-AI-112`): both items passed review (111 at `30daa4d`, 112 at `538b9dc`), but publishing 111 was refused with `PUBLISH_REFUSED: WORK_ITEM_MISMATCH: manifest reviews TASK-AI-112` — the shared `decision-dir/review-manifest.json` is overwritten by the last reviewed item, so every earlier item validates against the wrong manifest. Only one `--approval` was accepted per run and each approval binds one reviewed SHA, so the second item could never be authorised. The draft PR that did land was created for `TASK-AI-112` at `538b9dc` with a title taken from `specs[0]` (`TASK-AI-111`), and its branch contained both Work Items' commits — a violation of "one PR = exactly one Work Item".

Now the review manifest and artifact are per Work Item (`review-manifest-<workItemId>.json` / `review-artifact-<workItemId>.md`, written at review time) and `publication()` validates each item against its own manifest, reading the legacy shared file only when no per-item file exists. `--approval ID1,ID2` accepts several approvals and each one authorises only the item whose reviewed SHA its record binds; an item without a matching approval is reported `NOT_REQUESTED` (`APPROVAL_NOT_SUPPLIED`), which is not a refusal and trips no replay guard. Each published item gets its own draft PR titled `[<workItemId>] <outcome>` from that item's own spec with a body naming only that Work Item. A dependent stacks its PR base branch on the dependency's published branch so the diff carries only its own commit(s), and is not published at all (`DEPENDENCY_NOT_PUBLISHED`) when the dependency was not published in the run.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| PI-R01 | Two reviewed items in one run, per-item manifests written at review time | Both publish; each is validated against `review-manifest-<workItemId>.json` / `review-artifact-<workItemId>.md`; no `WORK_ITEM_MISMATCH`; the legacy shared file is read only when no per-item file exists | PI-R01 test in `tools/ai-brain/test/task-ai-122.test.js` |
| PI-R02 | `--approval ID1,ID2` (comma-separated) | Both ids reach the run; each approval authorises only the item whose reviewed SHA its record binds; an item with no matching approval is `NOT_REQUESTED` (`APPROVAL_NOT_SUPPLIED`) — not a refusal, no `PUBLISH_NOT_REPLAYABLE` | PI-R02 tests (CLI parsing, two approvals, missing approval) |
| PI-R03 | Several published items, one of them a dependent | One draft PR per item, title `[<workItemId>] <outcome>` from that item's spec (never `specs[0]`), body naming only that Work Item; the dependent's PR base branch is the dependency's published branch (`--base`); a dependent whose dependency was not published is not published (`DEPENDENCY_NOT_PUBLISHED`) | PI-R03 tests (per-item titles, `createDraftPullRequest` title/base, stacked base, dependency not published) |
| PI-R04 | New tests on unchanged code and after | Every PI-R01/R02/R03 test fails on `origin/main` and passes with the change | Fail-before / pass-after run |
| PI-R05 | Work Item and register | `TASK-AI-122.md` with the standard sections; exactly one appended register row `235` (`READY_FOR_CODEX`, branch `fix/task-ai-122-per-item-publish`) | `git diff origin/main --numstat` for the register is `1 0` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-122.test.js tools/ai-brain/test/task-ai-121.test.js tools/ai-brain/test/task-ai-120.test.js tools/ai-brain/test/task-ai-119.test.js tools/ai-brain/test/task-ai-118.test.js tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-102.test.js tools/ai-brain/test/task-ai-104.test.js tools/ai-brain/test/task-ai-105.test.js tools/ai-brain/test/task-ai-64.test.js tools/ai-brain/test/isolation.test.js tools/ai-brain/test/task-ai-109.test.js tools/ai-brain/test/task-ai-109-ui.test.js tools/ai-brain/test/task-ai-117.test.js tools/ai-brain/test/task-ai-73.test.js tools/ai-brain/test/task-ai-75.test.js tools/ai-brain/test/task-ai-77.test.js tools/ai-brain/test/task-ai-83.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/orchestrate.js tools/ai-brain/cli.js tools/ai-brain/publisher.js tools/ai-brain/test/task-ai-122.test.js docs/product-spec/work-items/TASK-AI-122.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (unchanged code): all 8 tests in `tools/ai-brain/test/task-ai-122.test.js` fail (`WORK_ITEM_MISMATCH` on the first item, run-level `--approval` rejected as one id, `specs[0]` draft titles, no stacked base, dependent published without its dependency)
- Pass-after: all 8 new tests pass; the full verification list passes (274 tests, 0 failures)

## Residual Limitations

- A dependent stacks on the dependency's published branch only when the dependency was published in the same run (or carried into the run as a recorded publication); a dependency published by an older run that the checkpoint no longer reports still refuses the dependent with `DEPENDENCY_NOT_PUBLISHED`.
- The legacy singular `approvalId` request shape keeps its pass-through seam: a bound-but-wrong approval of that shape still reaches the publisher and refuses there with the binding named, instead of reporting `NOT_REQUESTED`.
- `gh pr create --base` is issued from the operator side; GitHub rejects a stacked PR whose base branch was deleted between the dependency's publish and the dependent's, and that rejection is recorded as a failed publish attempt.
