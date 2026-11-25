'use strict';

/**
 * Combo-only candidate surface (TASK-AI-171, re-plan 2026-11-19).
 *
 * The Controller no longer generates, ranks or probes individual model routes:
 * every model call goes through ONE 9router combo, and 9router itself orders the
 * members, fails over between them and tracks their health. The large route
 * pool (generateCandidates, gateway/account/pool candidates, the OpenCode writer
 * discovery and the catalogue/capability machinery) is gone.
 *
 * What remains is the small surface the live combo path still uses:
 *   - candidateKey: the stable identity of a candidate (re-exported).
 *   - annotateCandidates: evidence-driven block state for the combo candidate.
 *   - routeStatusOf: the per-route health/quota snapshot annotateCandidates reads.
 */

const evidence = require('./evidence');
const { candidateKey } = require('./discovery/identity');

function isNineRouterCandidate(c) {
  if (!c || typeof c !== 'object') return false;
  return Boolean(
    c.gateway === '9router' ||
    c.source === '9router' ||
    c.sourceId === '9router' ||
    c.reachedVia === '9router' ||
    c.gateway === 'opencode-provider-ninerouter-options' ||
    c.source === 'opencode-provider-ninerouter-options' ||
    c.sourceId === 'opencode-provider-ninerouter-options' ||
    c.upstream === 'ninerouter' ||
    c.upstream === '9router' ||
    (typeof c.modelId === 'string' &&
      (c.modelId.startsWith('ninerouter/') || c.modelId.startsWith('9router/'))) ||
    c.accountId === 'ninerouter' ||
    c.quotaScope === 'ninerouter'
  );
}

function isIndividualNineRouterCandidate(c, comboName) {
  if (!isNineRouterCandidate(c)) return false;
  if (c.comboMembers) return false;
  if (comboName) {
    if (c.modelId === comboName) return false;
    if (c.modelId === `ninerouter/${comboName}` || c.modelId === `9router/${comboName}`)
      return false;
  }
  return true;
}

// direct-http and opencode-direct reach the same endpoint, gateway, account and
// model; a capability proved on one route is the same model capability on the other.
const HTTP_ROUTE_HARNESSES = new Set(['direct-http', 'opencode-direct']);
function siblingRouteProbe(key, probes) {
  if (!probes) return null;
  const parts = String(key).split('::');
  if (!HTTP_ROUTE_HARNESSES.has(parts[0])) return null;
  // Same gateway (endpoint and its key) and the same model once the router's own
  // "<gateway-alias>/" prefix is removed; account ids are spelled per harness.
  const gateway = parts[2];
  const upstream = parts[3];
  const account = parts[4];
  if (!account || account === '*') return null;
  const alias = String(gateway || '')
    .replace(/^opencode-provider-/, '')
    .replace(/-options$/, '');
  const bare = (model) =>
    String(model || '').startsWith(alias + '/')
      ? String(model).slice(alias.length + 1)
      : String(model || '');
  const model = bare(parts[parts.length - 1]);
  for (const [other, probe] of Object.entries(probes)) {
    const o = other.split('::');
    if (
      other !== key &&
      HTTP_ROUTE_HARNESSES.has(o[0]) &&
      o[2] === gateway &&
      o[3] === upstream &&
      o[4] === account &&
      o[4] !== '*' &&
      bare(o[o.length - 1]) === model
    )
      return probe;
  }
  return null;
}

// Reads only records of this exact route. Another gateway's record, or one made
// under another account, says nothing about it, so the answer stays UNKNOWN.
function routeStatusOf(c, routeHealth, quotaState) {
  const healthKey =
    routeHealth && routeHealth.paths
      ? require('./route-health').healthKey(c.modelId, {
          id: c.gateway,
          accountId: c.accountId,
        })
      : null;
  const h = healthKey ? routeHealth?.paths?.[healthKey] : null;
  const scopes = quotaState?.scopes || {};
  const q = [scopes[`${c.gateway}::${c.upstream}`], scopes[c.upstream]].find(
    (r) => r && r.source === c.gateway && r.upstream === c.upstream
  );
  return {
    health: h ? { state: h.status, key: healthKey, at: h.lastCheckedAt } : 'UNKNOWN',
    quota: q
      ? {
          state: q.code,
          scope: q.scope,
          sampleModel: q.model,
          exactModel: q.model === c.modelId,
          at: q.at,
        }
      : 'UNKNOWN',
    executionAccount: 'UNKNOWN',
  };
}

/**
 * Annotate candidates with evidence status and blocking state.
 *
 * Mutates candidates in-place, adding: status, blocked, blockReason, evidence[].
 */
function annotateCandidates(candidates, evidenceData, opts) {
  const annotOpts =
    opts && Object.prototype.hasOwnProperty.call(opts, 'quotaState')
      ? opts
      : Object.assign({}, opts, {
          quotaState:
            opts && (opts.loadQuotaState === false || opts.useStoredQuota === false)
              ? null
              : require('./quota-scan').loadQuotaState(opts || {}),
        });
  for (const c of candidates) {
    if (c.legacy) {
      c.evidence = [];
      c.status = 'unknown';
      c.blocked = false;
      continue;
    }
    c.routeStatus = routeStatusOf(c, annotOpts.routeHealth, annotOpts.quotaState);
    const key = candidateKey(c);
    const probe =
      evidenceData?.capabilityProbes?.[key] ||
      siblingRouteProbe(key, evidenceData?.capabilityProbes);
    if (probe) {
      c.capabilityEvidence = Object.assign({}, probe, c.capabilityEvidence);
      for (const [cap, pr] of Object.entries(probe)) {
        if (pr && pr.ok === true) {
          if (!c.capabilities) c.capabilities = {};
          c.capabilities[cap] = true;
        }
      }
    }
    const combo = evidence.findCombo(evidenceData, c);
    if (combo && combo.capabilityEvidence) {
      c.capabilityEvidence = Object.assign({}, combo.capabilityEvidence, c.capabilityEvidence);
      for (const [cap, pr] of Object.entries(combo.capabilityEvidence)) {
        if (pr && pr.ok === true) {
          if (!c.capabilities) c.capabilities = {};
          c.capabilities[cap] = true;
        }
      }
    }
    const ev = evidence.getEvidence(evidenceData, c);
    c.evidence = ev && ev.length > 0 ? ev : c.evidence || [];
    c.status = evidence.candidateStatus(evidenceData, c);

    const block = evidence.isCandidateBlocked
      ? evidence.isCandidateBlocked(evidenceData, c, annotOpts)
      : evidence.isUpstreamBlocked(evidenceData, c, annotOpts);
    // A quota block measured while assembling the route (for example an AGY lane whose live quota
    // reads zero) is evidence of its own; evidence that merely finds no block must not clear it.
    const assembledQuotaBlock =
      c.blocked === true &&
      (String(c.blockReason || '').startsWith('QUOTA_EXHAUSTED') ||
        c.blockReason === 'QUOTA_GROUP_UNKNOWN');
    if (assembledQuotaBlock && !block.blocked) continue;
    // A missing credential is a fact about this process, not evidence about the
    // route, so evidence that finds no block must not clear it (#605, F2).
    if (c.credentialEnvMissing === true) {
      c.blocked = true;
      c.blockReason = 'CREDENTIAL_ENV_MISSING';
      c.blockScope = c.blockScope || 'credential';
      continue;
    }
    c.blocked = block.blocked;
    if (block.blocked) {
      c.blockReason = block.reason;
      c.blockScope = block.scope || 'account';
    } else if (c.budget === 'UNKNOWN') {
      c.blocked = true;
      c.blockReason = 'BUDGET_UNKNOWN';
      c.blockScope = 'budget';
    }
  }
  return candidates;
}

module.exports = {
  candidateKey,
  annotateCandidates,
  routeStatusOf,
  isNineRouterCandidate,
  isIndividualNineRouterCandidate,
};
