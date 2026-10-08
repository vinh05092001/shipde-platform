# TASK-AI-96 — The isolated launcher sends 9Router the model id it knows

## Control

- Work Item ID: TASK-AI-96
- Status: READY_FOR_CODEX
- Assigned author: Claude supervisor at operator request (2026-10-05), reviewed by non-Claude reviewers
- Dependencies: TASK-AI-94

## Business Outcome

Live proof 12 failed every launch with alias_mismatch: for `--model cl/cline-free/mimo-v2.6-flash` the generated worker `opencode.json` mapped the short model to id `cline-free/mimo-v2.6-flash`, which 9Router rejects ("Model not found"). Only the router's own prefix (`ninerouter/`) may be stripped; an upstream prefix (`cl/`, `xmtp/`, ...) is part of the 9Router id and is now sent whole.

## Acceptance Matrix

- L96-R01: for an upstream-prefixed model every generated model entry carries the full 9Router id.
- L96-R02: for a `ninerouter/`-prefixed model the short entry keeps the stripped id (unchanged behaviour).
- L96-R03: tests fail on 6af81b4 for L96-R01 and pass after; L96-R02 passes on both.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-96.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None.
