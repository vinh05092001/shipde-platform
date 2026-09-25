'use strict';
/**
 * Progress detection utilities (TASK-AI-50 slice C1).
 *
 * A session can be in one of three high‑level verdicts from the perspective of
 * progress:
 *   - "ALIVE": evidence of forward motion (a diff, a new commit, a test run,
 *     a checkpoint written, or the log grew).
 *   - "STALLED": no forward motion *and* the session repeatedly produced the
 *     same error.
 *   - "UNKNOWN": insufficient signal to decide (e.g. no prior snapshot).
 *
 * The implementation is intentionally minimal – it only compares two snapshot
 * objects supplied by the caller. Each snapshot may contain the following
 * optional boolean properties:
 *   diffChanged, commitChanged, testRan, checkpointWritten, logGrew, error
 *
 * The function returns the string verdict.
 */

/**
 * Assess progress between two snapshots.
 * @param {Object|null} prev - The previous snapshot (may be null for first run).
 * @param {Object} curr - The current snapshot.
 * @returns {'ALIVE'|'STALLED'|'UNKNOWN'} verdict.
 */
function assessProgress(prev, curr) {
  if (!curr || typeof curr !== 'object') return 'UNKNOWN';

  // Any forward‑motion flag means ALIVE.
  const forwardFlags = [
    'diffChanged',
    'commitChanged',
    'testRan',
    'checkpointWritten',
    'logGrew',
  ];
  for (const f of forwardFlags) {
    if (curr[f]) return 'ALIVE';
  }

  // No forward motion. If we have a previous snapshot and the error repeats,
  // we classify as STALLED. Otherwise we cannot know – UNKNOWN.
  if (prev && typeof prev === 'object' && curr.error && prev.error && curr.error === prev.error) {
    return 'STALLED';
  }

  return 'UNKNOWN';
}

module.exports = { assessProgress };
