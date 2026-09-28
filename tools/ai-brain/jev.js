'use strict';

const Outcome = Object.freeze({
  DECIDED: 'DECIDED',
  UNDECIDED: 'UNDECIDED',
});

const DEFAULT_MIN_CONFIDENCE = 0.7;

function undecided(reason) {
  return {
    outcome: Outcome.UNDECIDED,
    choice: null,
    confidence: 0,
    reason,
  };
}

function validateClosedQuestion(question) {
  const q = question || {};
  const options = Array.isArray(q.options) ? q.options : [];
  if (options.length < 2) return 'INSUFFICIENT_OPTIONS';
  const seen = new Set();
  for (const option of options) {
    const value = String(option || '').trim();
    if (!value || seen.has(value)) return 'MALFORMED_OPTIONS';
    seen.add(value);
  }
  if (!q.evidence || String(q.evidence).trim() === '') return 'INSUFFICIENT_EVIDENCE';
  return null;
}

async function advise(question, options) {
  const invalid = validateClosedQuestion(question);
  if (invalid) return undecided(invalid);

  const opts = options || {};
  const minConfidence = Number.isFinite(Number(opts.minConfidence))
    ? Number(opts.minConfidence)
    : DEFAULT_MIN_CONFIDENCE;
  const ask = opts.ask;
  if (typeof ask !== 'function') return undecided('UNREACHABLE');

  let raw;
  try {
    raw = await ask({
      kind: question.kind || 'advisory',
      prompt: String(question.prompt || ''),
      evidence: String(question.evidence),
      options: question.options.slice(),
    });
  } catch (err) {
    return undecided('UNREACHABLE');
  }

  if (!raw || typeof raw !== 'object') return undecided('MALFORMED_OUTPUT');
  const choice = raw.choice === undefined ? null : String(raw.choice);
  const confidence = Number(raw.confidence);
  if (!question.options.includes(choice)) return undecided('MALFORMED_OUTPUT');
  if (!Number.isFinite(confidence)) return undecided('MALFORMED_OUTPUT');
  if (confidence < minConfidence) return undecided('LOW_CONFIDENCE');

  return {
    outcome: Outcome.DECIDED,
    choice,
    confidence,
    reason: raw.reason || null,
  };
}

async function adviseOrReason(question, options) {
  const result = await advise(question, options);
  if (result.outcome !== Outcome.UNDECIDED) {
    return Object.assign({ handledBy: 'jev' }, result);
  }
  const controller = options && options.reasoningController;
  if (typeof controller !== 'function') {
    return Object.assign({ handledBy: 'none' }, result);
  }
  const fallback = await controller(question, result);
  return {
    outcome: fallback && fallback.outcome ? fallback.outcome : Outcome.DECIDED,
    choice: fallback && fallback.choice !== undefined ? fallback.choice : null,
    confidence: fallback && fallback.confidence !== undefined ? fallback.confidence : null,
    reason: fallback && fallback.reason ? fallback.reason : result.reason,
    handledBy: 'reasoning-controller',
    jev: result,
  };
}

function roleQuestion(workItem, roles) {
  const ids = Object.keys(roles || {});
  return {
    kind: 'classify-work-item-role',
    prompt: 'Pick the registered role for this Work Item.',
    evidence: JSON.stringify(workItem || {}),
    options: ids,
  };
}

function transcriptQuestion(transcript, states) {
  return {
    kind: 'classify-transcript',
    prompt: 'Classify this transcript state.',
    evidence: String(transcript || ''),
    options: states || ['RUNNING_WITH_PROGRESS', 'STALLED', 'FAILED', 'COMPLETED'],
  };
}

module.exports = {
  Outcome,
  DEFAULT_MIN_CONFIDENCE,
  advise,
  adviseOrReason,
  roleQuestion,
  transcriptQuestion,
};
