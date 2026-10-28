const decisions = require('../decisions');
const {
  isolationVerdictBlockReason,
  ISOLATION_VERDICT_HUMAN_ACTION,
} = require('../failure-classifier');

/**
 * TASK-AI-121 LF-R01: the launcher's own message for a failed launch — the
 * error a throw carried, the refusal a route returned, then the process text.
 * This is the "real error message" the failed decision entry must keep.
 */
function launchFailureText(res) {
  return String((res && (res.stderr || res.refusal || res.failureReason || res.body)) || '');
}

/**
 * A "failed" decision entry keeps the classified cause for provider failures,
 * but for a local launch infrastructure failure (LF-R01) the cause alone threw
 * the real message away — the exact thing a supervisor needs. The message is
 * scrubbed of secrets and capped at 300 chars.
 */
function failureMessageOf(res) {
  return decisions.scrubText(launchFailureText(res)).trim().slice(0, 300);
}

function failedDecisionDetail(classification, res) {
  const message = failureMessageOf(res);
  if (classification.scope === 'local' && message) return message;
  return classification.cause;
}

/**
 * LF-R02: a stale or missing isolation verdict fails every candidate the same
 * way, so the run records why it stopped and the operator action that clears
 * it. The first detection wins; the stop travels on the run log.
 */
function markIsolationVerdictStop(log, res, classification) {
  if (!log || (classification && classification.scope !== 'local')) return null;
  const reasonCode = isolationVerdictBlockReason(launchFailureText(res));
  if (!reasonCode) return null;
  if (!log.isolationStop) {
    log.isolationStop = {
      reasonCode,
      reason: failureMessageOf(res) || reasonCode,
      humanAction: ISOLATION_VERDICT_HUMAN_ACTION,
    };
  }
  return log.isolationStop;
}

module.exports = {
  launchFailureText,
  failureMessageOf,
  failedDecisionDetail,
  markIsolationVerdictStop,
};
