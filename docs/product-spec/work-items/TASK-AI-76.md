# TASK-AI-76 — Hermetic JEV tests for TASK-AI-65

## Control

- Work Item ID: TASK-AI-76
- Status: READY_FOR_CODEX
- Assigned author: BOOTSTRAP_SELECTION paseo 9router xmtp/mimo-v2.6-pro
- Dependencies: TASK-AI-65, TASK-AI-73

## Business Outcome

Tests 65-06 and 65-08 pass on every machine, including one that holds a real TypeSafe JEV key. Before this change they reached the real JEV service on keyed machines, received DECIDED and failed; CI without a key hid the defect.

## Source References

- tools/ai-brain/test/task-ai-65.test.js
- tools/ai-brain/jev.js (buildJevAsk options home, env, httpClient)

## In Scope

- tools/ai-brain/test/task-ai-65.test.js only: isolated home, env without TYPESAFE_API_KEY, and a JEV httpClient that throws, passed through existing dispatch options.

## Out of Scope

- Any production code change; any environment-variable seam in production.

## Acceptance Matrix

- H-R01: node --test tools/ai-brain/test/task-ai-65.test.js reports fail 0 on a machine with a real key.
- H-R02: the same command with TYPESAFE_API_KEY unset reports fail 0.
- H-R03: no TASK-AI-65 test can perform network I/O to JEV.
- H-R04: node --test "tools/ai-brain/test/*.test.js" shows no new failures.

## Verification Commands

- node --test tools/ai-brain/test/task-ai-65.test.js
- node --test "tools/ai-brain/test/*.test.js"

## Residual Limitations

None.
