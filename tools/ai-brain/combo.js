'use strict';

/**
 * Combo-only model selection.
 *
 * Every model call goes through ONE 9router combo. 9router itself orders the
 * members, fails over between them and tracks their health, so the Controller
 * no longer generates, ranks or probes individual model routes.
 *
 * Everything is read from the sources registry (no hardcoded host, key or name):
 *   sources[]: the entry with kind "router" (endpoint, credential.env)
 *   dispatch.nineRouterWriterCombo: combo name
 *   dispatch.nineRouterWriterComboLimits: { contextWindow, maxOutputTokens }
 */

const sourcesApi = require('./sources');

function loadRegistry(registry) {
  return registry || sourcesApi.loadSources();
}

function routerSource(registry) {
  const list = Array.isArray(registry && registry.sources) ? registry.sources : [];
  return list.find((s) => s && s.kind === 'router' && s.servesModels !== false && s.endpoint) || null;
}

/**
 * Returns the single combo candidate, or { error } when the registry cannot
 * describe one. Never throws; callers turn the error into their own refusal.
 */
function comboCandidate(options) {
  const opts = options || {};
  const registry = loadRegistry(opts.registry);
  const dispatch = (registry && registry.dispatch) || {};
  const name = opts.comboName || dispatch.nineRouterWriterCombo;
  if (!name) return { error: 'COMBO_NOT_CONFIGURED: dispatch.nineRouterWriterCombo is empty' };
  const source = routerSource(registry);
  if (!source) return { error: 'COMBO_ROUTER_MISSING: no source with kind "router" and an endpoint' };

  const keyEnv = (source.credential && source.credential.env) || null;
  const env = opts.env || process.env;
  const limits = dispatch.nineRouterWriterComboLimits || {};
  const candidate = {
    candidateKey: `combo::${source.endpoint}::${name}`,
    harness: 'opencode-direct',
    gateway: source.id,
    source: source.id,
    sourceId: source.id,
    provider: source.id,
    upstream: source.id,
    accountId: source.id,
    quotaScope: source.id,
    endpoint: source.endpoint,
    accessPath: source.endpoint,
    sourceEndpoint: source.endpoint,
    kind: source.kind,
    modelId: name,
    model: name,
    combo: name,
    apiKeyEnv: keyEnv,
    capabilities: {},
    sharedQuota: 'unknown',
  };
  if (limits.contextWindow !== undefined) candidate.contextWindow = limits.contextWindow;
  if (limits.maxOutputTokens !== undefined) candidate.maxOutputTokens = limits.maxOutputTokens;
  if (keyEnv && !env[keyEnv]) {
    candidate.credentialEnvMissing = true;
    candidate.blocked = true;
    candidate.blockReason = 'CREDENTIAL_ENV_MISSING';
  }
  return { candidate };
}

module.exports = { comboCandidate, routerSource };
