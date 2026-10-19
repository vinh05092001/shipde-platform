# Verification Report — TASK-AI-142 Headroom Probe Defect

## Overview

Fixed the writer-ranking defect where candidates with unknown headroom status were always penalized with `UNKNOWN_EVIDENCE_PENALTY` (15 points), even when a successful live route probe existed for that exact candidate (`candidate.routeEvidence.probeSucceeded === true`, HTTP 200). Providers that do not return rate-limit headers (such as explabs) were consistently penalized against lower-quality providers with open headroom.

### Changes Made

1. **`tools/ai-brain/routing.js`**:
   - Updated `scoreForProfile` to inspect `candidate.routeEvidence?.probeSucceeded === true`.
   - When headroom is unknown and a successful live route probe exists for that candidate, no headroom penalty is applied (penalty is 0).
   - When headroom is unknown without a successful probe, the configured unknown headroom penalty is applied.
   - When headroom is tight, the configured tight headroom penalty is applied regardless of probe status.
   - Configured penalty values are read from dispatch config via `sourceRegistry.getDispatchConfig(ctx?.registry, ctx)`.
   - Updated `rankForProfile` to pass `dispatchConfig` in `scoreContext`.

2. **`tools/ai-brain/sources.json`**:
   - Moved hardcoded headroom penalty values into the `dispatch` block:
     - `"headroomUnknownPenalty": 15`
     - `"headroomTightPenalty": 10`

3. **`tools/ai-brain/sources.js`**:
   - Updated `getDispatchConfig` to read `headroomUnknownPenalty` and `headroomTightPenalty` (and aliases `unknownHeadroomPenalty` and `tightHeadroomPenalty`) via `configuredNonNegativeLimit`.

4. **`tools/ai-brain/test/task-ai-142-headroom-probe.test.js`**:
   - Added regression test suite covering:
     - Probed-OK unknown-headroom candidate with higher quality outranks lower-quality open-headroom candidate.
     - Unprobed unknown-headroom candidate is still penalized.
     - Tight headroom candidate is still penalized even if probe succeeded.
     - `getDispatchConfig` reads configured values and defaults correctly.

## Verification

- Pre-fix regression test: RED (failed with `AssertionError: probed-OK unknown headroom must take 0 headroom penalty: 15 !== 0`).
- Post-fix regression test: GREEN (4/4 passed).
- Existing test suite `tools/ai-brain/test/task-ai-65.test.js` passed (20/20 passed, including test 65-17).
- `git diff --check` and `prettier --check` passed.
