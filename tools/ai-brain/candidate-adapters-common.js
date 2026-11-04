'use strict';

const { getQuotaFamily } = require('./route-identity');

function modelQuotaGroup(model) {
  const m = String(model || '').toLowerCase();
  if (/argon/i.test(m)) return 'argon';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('claude') || m.includes('gpt') || m.includes('opus') || m.includes('sonnet'))
    return 'external';
  return 'external';
}

function modelFamily(model) {
  return modelQuotaGroup(model);
}

function modelId(model) {
  return typeof model === 'string'
    ? model.trim()
    : String(model?.id || model?.modelId || model?.model || model?.configuredModelId || '').trim();
}

function modelEvidence(model, options, source = {}) {
  const id = modelId(model);
  const evidence = typeof model === 'object' && model ? model : {};
  const metadata = {
    ...source.metadata,
    ...evidence,
    ...evidence.metadata,
    ...options.modelMetadata?.[id],
  };
  const explicitGroup = evidence.quotaGroup || metadata.quotaGroup;
  const explicitFamily = evidence.quotaFamily || metadata.quotaFamily;
  const familyToGroup = explicitFamily
    ? /argon/i.test(explicitFamily)
      ? 'argon'
      : /claude|gpt|3p|external/i.test(explicitFamily)
        ? 'external'
        : /gemini/i.test(explicitFamily)
          ? 'gemini'
          : explicitFamily
    : undefined;

  const quotaGroup = explicitGroup || familyToGroup;
  const quotaFamily = explicitFamily || (quotaGroup ? getQuotaFamily(quotaGroup) : undefined);
  return {
    ...metadata,
    ...(quotaGroup ? { quotaGroup } : {}),
    ...(quotaFamily ? { quotaFamily } : {}),
    capabilities:
      options.modelCapabilities?.[id] ?? metadata.capabilities ?? source.capabilities ?? [],
  };
}

module.exports = {
  modelQuotaGroup,
  modelFamily,
  modelId,
  modelEvidence,
};
