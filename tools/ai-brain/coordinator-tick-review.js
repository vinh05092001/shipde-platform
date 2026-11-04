'use strict';
const { sanitizeErrorSnippet } = require('./quota-scan');
const { safeText } = require('./coordinator-text');
const { POLICY, family, chooseWriter, reviewPrompt } = require('./coordinator-policy');

function applyVerdict(current, result, sha, now) {
  current.rounds = (current.rounds || 0) + 1;
  current.lastVerdict = result.verdict;
  current.reviewedSha = sha;
  current.previous = safeText(sanitizeErrorSnippet(result.text || result.reason || JSON.stringify(result.findings || []), 20000));
  current.status = result.verdict === 'PASS' ? 'PASS' : result.verdict === 'BLOCKED' || current.rounds >= POLICY.maxRounds ? 'STUCK' : 'CHANGES_REQUIRED';
}

async function runReview(item, current, deps, state, candidates, observed, prepared, now, save) {
  let result, sha = prepared.sha || observed.sha;
  if (!prepared.ok) {
    result = { verdict: 'CHANGES_REQUIRED', sha, reason: prepared.reason, findings: [{ text: prepared.reason }], tokens: 0 };
  } else {
    await deps.push(item, sha);
    const ci = await deps.ci(item, sha);
    if (ci.sha !== sha || ci.state === 'pending') { current.status = 'WAITING_CI'; await save(); return null; }
    if (ci.state === 'red') {
      result = { verdict: 'CHANGES_REQUIRED', sha, reason: ci.reason || 'CI_RED', findings: [{ text: ci.reason || 'CI_RED' }], tokens: 0, ciRed: true };
    } else if (ci.state !== 'green') {
      current.status = 'STUCK'; current.error = 'CI_UNKNOWN'; await save(); return null;
    } else {
      const writerFamily = current.writer?.family || family(current.writer?.model);
      if (!writerFamily) { current.status = 'STUCK'; current.error = 'WRITER_FAMILY_UNKNOWN'; await save(); return null; }
      const reviewerCandidates = await deps.candidates(item, 'reviewer');
      const reviewer = chooseWriter(reviewerCandidates, { now, configured: deps.configured, excludeFamilies: current.authorFamilies, exhausted: state.exhausted, highRisk: item.risk === 'HIGH' });
      if (!reviewer) { current.status = 'NO_INDEPENDENT_REVIEWER'; await save(); return null; }
      current.status = 'REVIEW_PENDING'; await save();
      try {
        result = await deps.review(item, reviewer, reviewPrompt(item, sha, current.previous), sha);
      } catch (error) {
        result = { verdict: 'BLOCKED', sha, reason: error.code || 'REVIEW_FAILED', tokens: null };
      }
      if (result.sha !== sha || !['PASS', 'CHANGES_REQUIRED', 'BLOCKED'].includes(result.verdict) || (result.verdict === 'PASS' && result.findings?.some((f) => !f.closed && f.severity !== 'P2'))) {
        result = { verdict: 'BLOCKED', sha, reason: 'REVIEW_INVALID_OR_STALE', tokens: result.tokens ?? null };
      }
    }
  }
  return { result, sha };
}

module.exports = { applyVerdict, runReview };
