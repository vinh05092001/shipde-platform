'use strict';
// Author-family memory and per-launch quota cooldown observation.
const { POLICY, family, modelKey, quotaFromLog } = require('./coordinator-policy');

function rememberAuthor(current, writer) {
  const value = writer?.family || family(writer?.model);
  if (!value) return false;
  current.authorFamilies = [...new Set([...(current.authorFamilies || []), value])];
  return true;
}

async function observeQuota(writer, state, deps, now) {
  if (!writer?.model) return;
  const matches = (entry) => modelKey(entry.model) === modelKey(writer.model);
  const exclude = (at) => {
    state.exhausted = state.exhausted.filter((entry) => !matches(entry));
    if (at + POLICY.quotaCooldownMs > now)
      state.exhausted.push({ model: writer.model, at, until: at + POLICY.quotaCooldownMs });
  };
  // Each launch owns one classification. Persist the observation even when
  // there is no alternative writer, so restarts cannot extend an old refusal.
  if (writer.logClassifiedAt == null && deps.logText) {
    writer.logClassifiedAt = now;
    if (quotaFromLog(await deps.logText(writer))) exclude(now);
  }
  const evidence = await deps.quotaEvidence?.(writer);
  const at = Date.parse(evidence?.at);
  const previous = state.exhausted
    .filter(matches)
    .reduce(
      (latest, entry) => Math.max(latest, entry.at ?? entry.until - POLICY.quotaCooldownMs),
      0
    );
  if (
    !Number.isFinite(at) ||
    at > now ||
    at <= Math.max(previous, writer.quotaEvidenceAt || 0, writer.logClassifiedAt || 0)
  )
    return;
  writer.quotaEvidenceAt = at;
  if (evidence.code === 'OK') state.exhausted = state.exhausted.filter((entry) => !matches(entry));
  else if (['QUOTA', 'RATE'].includes(evidence.code)) exclude(at);
}

module.exports = {
  rememberAuthor,
  observeQuota,
};
