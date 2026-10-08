# TASK-AI-78 — Token-budget repo map, scope and drift gate, output virtualization

## Control

- Work Item ID: TASK-AI-78
- Status: READY_FOR_CODEX
- Assigned author: Controller-selected paseo::http://127.0.0.1:20128/v1::9router::ocz::xkiro::xkiro::ocz/big-pickle
- Dependencies: TASK-AI-76
- Scope amendment: diff budget 1100 + 250 for review repairs (total 1348)
- Patterns: repo map after Aider (no Aider code); scope and traceability after Spec Kit (no Spec Kit code)
- Status of integration: EXPERIMENTAL — modules are not wired into the default prompt path until a benchmark shows at least 40% input-token reduction without lower pass rate

## Business Outcome

Workers can receive a bounded repo map instead of whole files, writer diffs are checked against ownership, forbidden paths, dependency and assertion-weakening rules, and long tool output is stored as redacted artifacts with a summary handle.

## Acceptance Matrix

- R-R01 buildRepoMap({repoCwd, paths?, budgetTokens=1500}) lists file path, exported symbols, function/class signatures (one line each) and require/import edges for .js/.ts files tracked by git; never includes function bodies.
- R-R02 output size is bounded by budgetTokens using estimate tokens = ceil(chars/4); when over budget it drops lowest-ranked files first (rank = number of inbound import edges, then path) and reports {truncated:true, omitted:n}.
- R-R03 cache keyed by the git tree hash of HEAD (git rev-parse HEAD^{tree}) stored under the repo's git dir (git rev-parse --git-common-dir)/shipde-repo-map/<tree>.json; a changed tree is a cache miss; no daemon, no database.
- R-R04 expand({repoCwd, file, reason}) returns that file's full signature block and requires a non-empty reason (REASON_REQUIRED).
- S-R01 parseScope(workItem) requires workItemId, acceptanceIds[], ownedGlobs[], forbiddenGlobs[], testCommands[], maxDiffLines, repairBudget, maxToolCalls; missing -> SCOPE_INVALID.
- S-R02 checkDiff({repoCwd, base, head, scope}) refuses: OUT_OF_OWNERSHIP (file not matching ownedGlobs), FORBIDDEN_PATH, DEPENDENCY_ADDED (package.json dependencies/devDependencies or lockfile changed unless scope.allowDependencies), DIFF_BUDGET_EXCEEDED, ASSERTION_WEAKENED (an existing test file loses lines containing assert/expect/t.equal etc. while adding none), NO_EVIDENCE (claimed SUCCESS with empty diff and no test report).
- S-R03 checkTrace(actions, scope): every writer action {kind, acceptanceId} must reference a declared acceptanceId, else UNTRACED_ACTION; actions of kind push|open_pr|merge|change_candidate are refused (FORBIDDEN_ACTION).
- O-R01 virtualize(text, {thresholdBytes=8192, dir}) returns text unchanged under threshold; above it, stores redacted raw text as an artifact file named by sha256, returns {summary (head 40 lines + tail 40 lines + byte/line counts), sha256, handle}.
- O-R02 redaction before storage: reuse scrubText from tools/ai-brain/decisions.js (the one evidence.js uses) — do not write a new secret regex set; a test proves an sk-... style token and Bearer header never reach disk.
- O-R03 read(handle, {grep?, startLine?, endLine?, maxBytes=4096}) returns a bounded slice.
- O-R04 rotate({dir, maxAgeMs, maxBytes}) deletes oldest artifacts beyond limits; only inside dir.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-78.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

- Not wired into prompt compilation or the writer loop; token benchmark pending.
