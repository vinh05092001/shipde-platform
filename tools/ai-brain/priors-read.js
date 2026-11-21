'use strict';

/**
 * Ship Dễ — Read-only benchmark & effort prior lookup for combo members (TASK-AI-193).
 *
 * Thin facade over the curated/live prior files with combo-local prefix resolution
 * (passing `liveIds: members` so `splitModelEffort` never enumerates the full
 * external catalogue via `priors-public.liveModelIds()`).
 */

const priors = require('./priors');

let defaultDescriptor;
try {
  defaultDescriptor = require('./priors-sources/public.json');
} catch {
  defaultDescriptor = {};
}

function buildComboConfig(options) {
  const opts = options && typeof options === 'object' ? options : {};
  const liveIds = Array.isArray(opts.liveIds) ? opts.liveIds : [];
  return { ...defaultDescriptor, ...opts, liveIds, liveModels: liveIds };
}

function loadPriors(file) {
  return priors.loadPriors(file);
}

function normaliseModelId(value) {
  return priors.normaliseModelId(value);
}

function splitModelEffort(value, options) {
  return priors.splitModelEffort(value, buildComboConfig(options));
}

function priorFor(candidate, role, loadedPriors, now) {
  return priors.priorFor(candidate, role, loadedPriors, now);
}

/**
 * Attach benchmark score, tier, and reasoning/effort level to each curated
 * member of a 9router combo (e.g. `vinh`), sorted best-first for JEV selection.
 */
function scoreComboMembers(members, role = 'writer', options = {}) {
  const list = Array.isArray(members)
    ? members.filter((m) => typeof m === 'string' && m.trim())
    : [];
  if (list.length === 0) return [];
  const loaded = options.priors || loadPriors(options.priorsFile);
  const comboConfig = buildComboConfig({
    ...(loaded && loaded.config ? loaded.config : {}),
    registry: options.registry,
    liveIds: list,
  });
  const scopedPriors = { ...(loaded || { ranking: [] }), config: comboConfig };
  const now = options.now ?? Date.now();
  const scored = list.map((modelId) => {
    const { base, effort } = priors.splitModelEffort(modelId, comboConfig);
    const prior = priorFor({ modelId }, role, scopedPriors, now) || {};
    return {
      modelId,
      base: base || normaliseModelId(modelId) || modelId,
      effort: effort || null,
      score: typeof prior.score === 'number' ? prior.score : null,
      tier: prior.tier || null,
      priorUnknown: prior.priorUnknown === true || typeof prior.score !== 'number',
    };
  });
  return scored.sort((a, b) => {
    const aKnown = typeof a.score === 'number';
    const bKnown = typeof b.score === 'number';
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (aKnown && bKnown && b.score !== a.score) return b.score - a.score;
    return a.modelId.localeCompare(b.modelId);
  });
}

module.exports = {
  loadPriors,
  normaliseModelId,
  splitModelEffort,
  priorFor,
  scoreComboMembers,
};
