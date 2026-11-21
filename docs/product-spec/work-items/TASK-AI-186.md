# TASK-AI-186 — Combo-only follow-ups: fast intake combo check, credential re-check on resume

## Control

| Field | Value |
|---|---|
| Work Item ID | `TASK-AI-186` |
| Feature ID | `N/A` |
| Status | `READY_FOR_CODEX` |
| Dependencies | `TASK-AI-171`, `TASK-AI-182` (both merged) |
| Assigned author | Claude Code, from agy08's proposals B and C (operator instruction 2026-11-21: fix what is failing) |
| Risk | `LOW` |
| Allowed paths | `tools/ai-brain/intake.js`; `tools/ai-brain/combo.js`; `tools/ai-brain/cli/dispatch.js`; `tools/ai-brain/test/task-ai-186-combo-followups.test.js`; this file; the delivery register |
| Reviewer | Independent reviewer on a model other than Claude or agy08 |
| Branch | `feat/task-ai-186-combo-followups` |

## Business outcome

Under combo-only routing the Controller needs only one fact from 9router: does it serve the configured combo?

Intake currently answers that by downloading the whole model listing, which is about 3,700 models and takes about 18 s on every run. After this change intake asks for the combo directly, which takes milliseconds.

A dispatch that resumes from a checkpoint also stops launching a candidate whose credential has disappeared since the checkpoint was written. This was the P2 deferred in the #605 review.

## Scope and acceptance

1. Intake reads the combo with `GET /api/combos` (`writer-combo.readComboConfig`) when the registry configures a combo:
   - A readable combo with members puts the combo name in the 9router catalogue. `/v1/models` is not called.
   - A down router, a missing combo, a 5xx response or an empty combo fails closed with `9router combo "<name>" unavailable: <status>`.
   - Only an endpoint without `/api/combos` (404/405), or an injected `httpGet`, falls back to the existing models listing.
2. `combo.js` exports `configuredCombo`.
3. When `dispatchCommand` resumes a checkpointed choice, it re-checks the credential: the candidate's own flag first, then the source's `credential.env` in the current env.
   - If the credential is missing, the resume is refused with `CREDENTIAL_ENV_MISSING`, naming the env variable but never its value, and nothing is launched.
   - A saved fallback is resumed only while it is neither blocked nor credential-less.

## Verification

- `node --test tools/ai-brain/test/task-ai-186-combo-followups.test.js` (4 tests). Three of them fail on the previous code.
- Live: `buildCatalogue` 9router collector takes about 24 ms against the real 9router, where `/v1/models` took about 18 s.
- Full `tools/ai-brain` suite.
