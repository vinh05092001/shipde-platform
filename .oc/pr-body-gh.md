# [TASK-AI-169] Step 1: Fixed token and time accounting bugs in ProgressLedger

## Work Item

- Work Item ID: TASK-AI-169

## Changes

Fixed two root causes in `tools/ai-brain/work-guard.js`:

1. **Token accounting for reserved attempts** (lines 400-405): The token exhaustion check incorrectly validated against the current counted tokens (including imputed tokens from reservation) without accounting for the fact that recording known tokens **replaces** the imputed tokens, not adds to them.

2. **Time exhaustion check in record()** (removed lines 394-398): The record method refused to record attempts that exceeded the time cap. However, time is consumed during execution, not at record time. Refusing the record doesn't undo elapsed time—it just hides accounting. Time caps are properly enforced during `admit` via `inFlightMs` calculations.

## Verification

- [x] `node --test tools/ai-brain/test/run-ledger.test.js tools/ai-brain/test/*work-guard*.test.js` - all 67 tests pass
- [x] `npx prettier --check tools/ai-brain/work-guard.js` - formatting passes

## Diagnosis

See `.oc/diagnosis.md` for detailed root cause analysis.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
