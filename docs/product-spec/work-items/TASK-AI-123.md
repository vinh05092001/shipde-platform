# TASK-AI-123 — Draft PR titles use the Work Item outcome, and worker commits pass the format gate before review

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-123` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `236` |
| Dependencies | `TASK-AI-122` |
| Assigned author | `9ROUTER` |
| Risk | `MEDIUM` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/test/task-ai-123.test.js`; `docs/product-spec/work-items/TASK-AI-123.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-123-draft-title-and-format-gate` |
| Pull Request | `Pending` |

## Business Outcome

Evidence from draft PR #237 (TASK-AI-112, head 256ae42): the title was "[TASK-AI-112] BN-R01: branchNameFor(...) ... from TASK-AI-111 ...". The title is the first acceptance criterion, not the Work Item outcome. It contains a second Work Item ID, so the Feature contract gate failed with "PR title must contain exactly one Work Item ID". #236 has the same kind of title.

Additionally, worker commits passed review without prettier formatting. Only after the item was published did the "Current application checks" job fail its prettier check on the changed files.

DT-R01: the draft PR title is "[<workItemId>] <outcome>". <outcome> comes from the spec item's title/outcome field (the Work Item title as given in the specs file: title, or outcome, or name; check the gate5 specs.json shape copied at .upstream-tmp/gate5-specs.json). It never comes from acceptance criteria text.

- Truncate to 72 characters.
- Strip any other Work Item ID pattern (FEAT-*, TASK-FOUND-*, TASK-AI-*) from <outcome> so the title contains exactly one ID.
- Apply the same rule to the PR body's first line.

DT-R02: after a worker commit and BEFORE review, the Controller runs a host-side format check on the worker's changed files only (`git diff --name-only base..workerSha`, filtered to files prettier supports, run with the repo's ./node_modules/.bin/prettier --check, read-only).

- If it fails, the item goes to a bounded repair round with a finding listing the files (reuse the existing repair path). It is never reviewed or published unformatted.
- If prettier is unavailable, record FORMAT_CHECK_UNAVAILABLE as a warning and do not block.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| DT-R01 | Title from outcome with exactly one ID | Title "[<workItemId>] <outcome>" where outcome is from spec (not acceptance criteria); other Work Item IDs stripped from outcome; truncated to 72 chars | DT-R01 tests in `tools/ai-brain/test/task-ai-123.test.js` |
| DT-R02 | Badly formatted worker file triggers repair | Format check fails for bad file; item goes to repair instead of review; never published unformatted | DT-R02 test (bad file) |
| DT-R02 | Well-formatted worker file goes to review | Format check passes; item proceeds to review | DT-R02 test (good file) |
| DT-R03 | Tests fail on origin/main | All new tests fail before change, pass after | Fail-before / pass-after run |
| DT-R04 | Work Item and register | `TASK-AI-123.md` with standard sections; exactly one appended register row `236` (`READY_FOR_CODEX`, branch `fix/task-ai-123-draft-title-and-format-gate`) | `git diff origin/main --numstat` for the register is `1 0` |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-123.test.js tools/ai-brain/test/task-ai-122.test.js tools/ai-brain/test/task-ai-121.test.js tools/ai-brain/test/task-ai-120.test.js tools/ai-brain/test/task-ai-119.test.js tools/ai-brain/test/task-ai-114.test.js tools/ai-brain/test/task-ai-102.test.js tools/ai-brain/test/task-ai-105.test.js tools/ai-brain/test/task-ai-64.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/orchestrate.js tools/ai-brain/test/task-ai-123.test.js docs/product-spec/work-items/TASK-AI-123.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before (unchanged code): DT-R02 tests fail (format check not implemented); DT-R01 tests may pass (title generation already exists but ID stripping needs implementation)
- Pass-after: all 5 tests pass; DT-R01 correctly strips IDs from outcome; DT-R02 format check runs before review

## Residual Limitations

- Format check only runs on files prettier supports; files outside that set bypass the check
- If prettier is unavailable, format check is skipped with a warning rather than blocking
- Repair rounds reuse the existing path; custom formatting-specific findings are generic
