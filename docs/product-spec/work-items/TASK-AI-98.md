# TASK-AI-98 — A live run records a real fail-before

## Control

- Work Item ID: TASK-AI-98
- Status: READY_FOR_CODEX
- Assigned author: tokenharbor/gpt-6-luna via opencode (top benchmark rank; supervisor-selected)
- Dependencies: TASK-AI-83, TASK-AI-96

## Business Outcome

Live proof 13 produced a reviewed commit and a valid manifest, but the publisher refused because non-exercise runs never measured the verification at the base SHA. The loop now measures fail-before on the base tree plus the writer's test files and records it in the receipt.

## Acceptance Matrix

- F98-R01 Add and export measureFailBefore(workerRoot, baseSha, headSha, command, options) in tools/ai-brain/orchestrate.js. It materialises the base tree in a fresh temporary directory (for example git -c safe.directory=* -C workerRoot archive --format=tar <baseSha> extracted with tar), copies in ONLY the files changed between baseSha and headSha whose path is a test file (path contains a test/ or tests/ directory, or a name containing .test. or .spec.), runs the command with shell:true in that directory, and returns {command, exitCode, output (last 4000 chars), baseSha, headSha, testFiles, measuredBy:'supervisor-base-tree'}. It must never modify the worker repository, must delete its temporary directory, and must return null (never a fabricated result) when an input is missing or a git/tar step fails.
- F98-R02 The command must run with NODE_TEST_CONTEXT removed from its environment (a nested node --test otherwise reports to a parent test runner and exits 0).
- F98-R03 In the launch path, right after the existing `if (res && res.failBefore) { job.failBefore = res.failBefore; }`, when job.failBefore is still unset, the launch exited 0, job.cwd and job.baseSha exist, and the work item has verification.command: compute the worker head with the existing headShaOf(job.cwd) and set job.failBefore from measureFailBefore. Allow an injected o.measureFailBefore for tests.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-98.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None recorded by the author; see review.
