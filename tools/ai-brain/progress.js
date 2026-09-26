'use strict';
/**
 * Progress detection utilities (TASK-AI-50 slice C1).
 *
 * A session can be in one of three high-level verdicts from the perspective of
 * progress:
 *   - "ALIVE": evidence of forward motion (a diff, a new commit, a test run,
 *     a checkpoint written, or healthy log growth).
 *   - "STALLED": no forward motion across the configured window, or the session
 *     repeatedly produced the same error without modifying the worktree.
 *   - "UNKNOWN": insufficient or unmeasurable signals to decide (never guessed as ALIVE).
 *
 * Windows and Leases:
 *   Progress extends the lease. No progress across the lease window marks the session STALLED.
 *   One progress signal resets the window.
 *
 * Default Window:
 *   DEFAULT_WINDOW_MS = 10 * 60 * 1000 (10 minutes, 600,000 ms).
 *   Reason: LLM coding agents may spend 2-3 minutes analyzing code or running tools
 *   on complex prompts, but exceeding 10 minutes without any forward signal (git diff,
 *   commit, test run, checkpoint, or log growth) indicates a hung process, an infinite
 *   retry loop on provider error, or an unrecoverable deadlock.
 */

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Evaluates progress between two snapshots, taking window/lease and repeated errors into account.
 *
 * @param {Object|null} prev - Previous snapshot/state (may be null on initial run).
 * @param {Object} curr - Current snapshot.
 * @param {Object} [options] - Options (windowMs, now, etc.).
 * @returns {{ verdict: 'ALIVE'|'STALLED'|'UNKNOWN', cause?: string, lastProgressAt?: number }}
 */
function evaluateProgress(prev, curr, options) {
  const opts = options || {};
  const windowMs = Number.isFinite(opts.windowMs)
    ? opts.windowMs
    : Number.isFinite(curr && curr.windowMs)
      ? curr.windowMs
      : DEFAULT_WINDOW_MS;
  const now = Number.isFinite(opts.now)
    ? opts.now
    : Number.isFinite(curr && curr.timestamp)
      ? curr.timestamp
      : Date.now();

  if (!curr || typeof curr !== 'object') {
    return { verdict: 'UNKNOWN', cause: 'missing current snapshot' };
  }

  // Worktree change flags - definitive forward motion in the workspace.
  const worktreeChanged = Boolean(
    curr.diffChanged || curr.commitChanged || curr.testRan || curr.checkpointWritten
  );

  // Check for repeating identical error.
  const hasPrevError =
    prev && typeof prev === 'object' && typeof prev.error === 'string' && prev.error.trim() !== '';
  const hasCurrError = typeof curr.error === 'string' && curr.error.trim() !== '';
  const sameErrorRepeating =
    hasPrevError && hasCurrError && prev.error.trim() === curr.error.trim();

  // If the same error repeats and the worktree never changed: STALLED.
  // Log growth alone from repeating error output does NOT count as progress.
  if (sameErrorRepeating && !worktreeChanged) {
    const cause = curr.error.trim();
    if (curr && typeof curr === 'object') curr.cause = cause;
    return {
      verdict: 'STALLED',
      cause,
      lastProgressAt: prev && prev.lastProgressAt !== undefined ? prev.lastProgressAt : now,
    };
  }

  // Check for any forward motion.
  // Worktree change or log growth without repeating error counts as forward progress.
  const logGrew = Boolean(curr.logGrew && !sameErrorRepeating);
  const forwardMotion = worktreeChanged || logGrew;

  if (forwardMotion) {
    const lastProgressAt = now;
    if (curr && typeof curr === 'object') curr.cause = undefined;
    return { verdict: 'ALIVE', lastProgressAt };
  }

  // No forward motion in this snapshot. Check the window / lease.
  const lastProgressAt =
    prev && Number.isFinite(prev.lastProgressAt)
      ? prev.lastProgressAt
      : prev && Number.isFinite(prev.timestamp)
        ? prev.timestamp
        : Number.isFinite(curr.timestamp)
          ? curr.timestamp
          : now;

  const elapsed = now - lastProgressAt;
  if (prev && elapsed >= windowMs) {
    const cause =
      'NO_PROGRESS_ACROSS_WINDOW: no forward progress observed for ' +
      Math.round(elapsed / 1000) +
      's (window: ' +
      Math.round(windowMs / 1000) +
      's)';
    if (curr && typeof curr === 'object') curr.cause = cause;
    return {
      verdict: 'STALLED',
      cause,
      lastProgressAt,
    };
  }

  // If there are no measurable signals at all, return UNKNOWN (never ALIVE).
  const hasMeasurableSignals = Boolean(
    curr.diffChanged !== undefined ||
    curr.commitChanged !== undefined ||
    curr.testRan !== undefined ||
    curr.checkpointWritten !== undefined ||
    curr.logGrew !== undefined ||
    hasCurrError
  );

  if (!hasMeasurableSignals) {
    return { verdict: 'UNKNOWN', cause: 'unmeasurable signals', lastProgressAt };
  }

  return { verdict: 'UNKNOWN', lastProgressAt };
}

/**
 * Assesses progress between two snapshots. Returns string verdict.
 * @param {Object|null} prev
 * @param {Object} curr
 * @param {Object} [options]
 * @returns {'ALIVE'|'STALLED'|'UNKNOWN'}
 */
function assessProgress(prev, curr, options) {
  const res = evaluateProgress(prev, curr, options);
  if (curr && typeof curr === 'object' && res.cause) {
    curr.cause = res.cause;
  }
  return res.verdict;
}

module.exports = {
  assessProgress,
  evaluateProgress,
  DEFAULT_WINDOW_MS,
};
