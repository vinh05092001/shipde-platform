# TASK-AI-124 — Draft PR bodies never trip the placeholder rule, and titles fall back to the run goal on publish

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-124` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Delivery order | `237` |
| Dependencies | `TASK-AI-123` |
| Assigned author | `9ROUTER` |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/orchestrate.js`; `tools/ai-brain/publisher.js`; `tools/ai-brain/test/task-ai-124.test.js`; `docs/product-spec/work-items/TASK-AI-124.md`; `docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv` |
| Reviewer | `Codex — fresh independent task` |
| Branch | `fix/task-ai-124-draft-body-and-title` |
| Pull Request | `Pending` |

## Business Outcome

Draft PR #240 (TASK-AI-112) failed the Feature contract gate with "PR body still contains required template placeholders". `docs/product-spec/scripts/validate_pr_contract.py` rejects any `<...>` in the body (regex `<[^>\n]+>`).
The body includes a verbatim test name, "returns feat/<lower-cased work item id>-<slugified title>", in the pass-after test lines that publisher.js/orchestrate.js build.

Both drafts #239 and #240 were titled "[TASK-AI-11x] work item". The gate5 specs have no outcome/title/name. TASK-AI-123's draftTitleForItem falls back to the run goal, but the publish path did not pass the goal, so it used the literal "work item".

PB-R01: every free-text fragment the publisher puts in a PR body (test names and test output lines, fail-before output, finding text, outcome) is neutralised. Replace `<` with `‹` and `>` with `›` (or an equivalent that the validate_pr_contract.py regex does not match), so the body never matches `<[^>\n]+>` unless the text is a real template placeholder the publisher itself intends. Template headings and links are unaffected.

PB-R02: on the publish path the run goal (the --goal file content, first non-empty line) is passed to draftTitleForItem. The literal "work item" is used only when there is no goal at all.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| PB-R01 | Neutralise free-text in PR bodies | Replace `<` and `>` in tests, outputs, and findings so PR body passes the gate regex | PB-R01 test in `task-ai-124.test.js` |
| PB-R02 | Draft title falls back to run goal | Title derived from goal, truncated to 72 chars, exactly 1 ID, no "work item" if goal is present | PB-R02 test |
| PB-R03 | Tests fail on origin/main | Tests fail before the fix | Fail-before run |
| PB-R04 | Work Item and register | `TASK-AI-124.md` added; row 237 appended to `FEATURE-DELIVERY-REGISTER.csv` | `git diff origin/main --numstat` is `1 0` for register |

## Verification Commands

- `node --test tools/ai-brain/test/task-ai-124.test.js tools/ai-brain/test/task-ai-123.test.js tools/ai-brain/test/task-ai-122.test.js tools/ai-brain/test/task-ai-102.test.js tools/ai-brain/test/task-ai-104.test.js tools/ai-brain/test/task-ai-64.test.js`
- `./node_modules/.bin/prettier --write tools/ai-brain/orchestrate.js tools/ai-brain/publisher.js tools/ai-brain/test/task-ai-124.test.js docs/product-spec/work-items/TASK-AI-124.md`
- `git diff --check`

## Fail-Before / Pass-After

- Fail-before: PB-R01 and PB-R02 fail.
- Pass-after: Both tests pass.

## Residual Limitations

- Only `<` and `>` characters are neutralised to `‹` and `›`; other placeholder-like syntaxes are not modified.
- Template formatting relies strictly on replacing angle brackets to bypass validation script regex.
