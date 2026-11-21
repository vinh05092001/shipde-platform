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
  return (
    list.find((s) => s && s.kind === 'router' && s.servesModels !== false && s.endpoint) || null
  );
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
  if (!source)
    return { error: 'COMBO_ROUTER_MISSING: no source with kind "router" and an endpoint' };

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

/**
 * The configured combo: dispatch.nineRouterWriterCombo on the router source.
 * Returns null when the registry does not describe one.
 */
function configuredCombo(registry) {
  const reg = loadRegistry(registry);
  const name = reg && reg.dispatch && reg.dispatch.nineRouterWriterCombo;
  const source = routerSource(reg);
  return name && source ? { name, source } : null;
}

const sameEndpoint = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.replace(/[/]+$/, '') === b.replace(/[/]+$/, '');

/**
 * True only for the configured combo itself: its name is the configured
 * combo name, it is reached through the router source, and, when it carries an
 * endpoint, that is the router endpoint. Member metadata alone, another combo
 * name, another source, or an individual 9router model do not qualify
 * (review of #605, F1).
 */
function isComboCandidate(c, registry) {
  if (!c || typeof c !== 'object') return false;
  const cfg = configuredCombo(registry);
  if (!cfg) return false;
  const model = c.modelId || c.model;
  if (model !== cfg.name) return false;
  if (c.combo !== undefined && c.combo !== cfg.name) return false;
  // Every source field the identity carries must name the router source; one
  // matching alias next to a contradicting one is refused (#605 round 3, F1).
  const via = [c.gateway, c.source, c.sourceId, c.upstream, c.provider].filter(
    (v) => v !== undefined && v !== null && v !== ''
  );
  if (via.length === 0 || via.some((v) => v !== cfg.source.id)) return false;
  const endpoint = c.endpoint || c.accessPath || c.sourceEndpoint;
  return endpoint === undefined || sameEndpoint(endpoint, cfg.source.endpoint);
}

/**
 * The same test for a candidate identity: a `combo::<endpoint>::<name>` key, a
 * candidate key string, or an already parsed identity object.
 */
function isComboIdentity(identity, registry) {
  if (!identity) return false;
  const cfg = configuredCombo(registry);
  if (!cfg) return false;
  if (typeof identity === 'string' && identity.startsWith('combo::')) {
    const rest = identity.slice('combo::'.length);
    const cut = rest.lastIndexOf('::');
    if (cut < 0) return false;
    return (
      rest.slice(cut + 2) === cfg.name && sameEndpoint(rest.slice(0, cut), cfg.source.endpoint)
    );
  }
  let parsed = identity;
  if (typeof identity === 'string') {
    try {
      parsed = require('./discovery/identity').parseCandidateKey(identity);
    } catch (_) {
      return false;
    }
  }
  return isComboCandidate(parsed, registry);
}

module.exports = {
  comboCandidate,
  routerSource,
  configuredCombo,
  isComboCandidate,
  isComboIdentity,
};
