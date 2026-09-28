'use strict';

/**
 * Ship Dễ — Session supervisor (TASK-AI-60, dry-run level).
 *
 * Classifies a session from real progress signals: diff, commits, tests, log
 * growth, tool activity, process tree, heartbeat and repeated errors. An empty
 * SUCCESS is COMPLETED_EMPTY, never a completion with an artifact; a dead
 * process with an empty log is FAILED; a live session that stopped making
 * progress is STALLED.
 */

const { progressVerdict, ProgressStatus } = require('./harness');

const Status = Object.freeze({
  RUNNING_WITH_PROGRESS: 'RUNNING_WITH_PROGRESS',
  STALLED: 'STALLED',
  FAILED: 'FAILED',
  COMPLETED_WITH_ARTIFACT: 'COMPLETED_WITH_ARTIFACT',
  COMPLETED_EMPTY: 'COMPLETED_EMPTY',
  UNKNOWN: 'UNKNOWN',
});

function hasArtifact(session) {
  if (!session) return false;
  if (session.artifact) return true;
  return Array.isArray(session.artifacts) && session.artifacts.length > 0;
}

/**
 * @param session {
 *   exitCode?, dead?, processTreeGone?, output?, stdout?, artifact?, artifacts?,
 *   startedAt?, lastProgressAt?, progress?, heartbeats?, repeatedErrors?
 * }
 * @param opts  passed through to progressVerdict (stallMs, now)
 */
function classifySession(session, opts) {
  const s = session || {};
  const output = s.output !== undefined ? s.output : s.stdout !== undefined ? s.stdout : '';
  const text = String(output || '').trim();

  // A clean exit is success; the question is only whether it produced anything.
  if (s.exitCode === 0) {
    if (hasArtifact(s) || text.length > 0) return Status.COMPLETED_WITH_ARTIFACT;
    return Status.COMPLETED_EMPTY;
  }

  const dead =
    s.dead === true ||
    s.processTreeGone === true ||
    (s.exitCode !== undefined && s.exitCode !== null && Number(s.exitCode) !== 0);

  if (dead) return Status.FAILED;

  // Still alive: judge progress from real signals.
  const verdict = progressVerdict(s, opts);
  if (verdict.status === ProgressStatus.STALLED) return Status.STALLED;
  if (verdict.status === ProgressStatus.RUNNING_WITH_PROGRESS) {
    return Status.RUNNING_WITH_PROGRESS;
  }
  return Status.UNKNOWN;
}

module.exports = { Status, classifySession };
