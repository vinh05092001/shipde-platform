# TASK-AI-85 — The live orchestrate CLI loads the evidence store

## Control

- Work Item ID: TASK-AI-85
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION agy-pool agy05 (google)
- Dependencies: TASK-AI-82

## Business Outcome

Live proof 8 showed the CLI passed its own candidate list, which orchestrate treats as test-injected, so no evidence was loaded and every candidate failed the proof floor. The CLI now passes the evidence directory explicitly; hermetic tests stay isolated.

## Acceptance Matrix

- V-R01 the orchestrate CLI passes evidenceDir explicitly: --evidence-dir <dir> when given, otherwise tools/ai-brain/data/evidence, so live runs always read the evidence store.
- V-R02 hermetic tests that inject candidates without evidenceDir still read no host evidence (existing tests keep passing unchanged).
- V-R03 test: invoking the CLI orchestrate code path (in-process with injected launcher/exit, or a dry selection mode) with a temp --evidence-dir holding WORK_ITEM_PASS for a key absent from --accounts ranks that key; without --evidence-dir the default path is passed (assert the option value), never null.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-85.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None recorded by the author; see review.
