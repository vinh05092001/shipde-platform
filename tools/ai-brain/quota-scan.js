'use strict';

/**
 * Ship Dễ — Quota Scan (TASK-AI-142 T4)
 *
 * Periodic quota scanner per source and per key/prefix:
 * - Scans each source in registry with a cheap 1-token request per representative model.
 * - Decomposes 9router into separate quota scopes by upstream model prefix (cl/, kr/, ocz/, ag/...).
 * - Uses 9router HTTP APIs (/v1/models and /v1/chat/completions) without inspecting credential stores.
 * - Classifies response status using canonical codes:
 *     401 → AUTH
 *     402 → QUOTA
 *     403 tier → TIER
 *     429 → RATE
 *     451 → REGION
 *     503 → NO_CHANNEL
 * - Persists quota state to data/quota-state.json with timestamp and retryAfter.
 * - capability-probe and probe-order / dry-run consult quota-state.json to skip dead scopes.
 */

const fs = require('fs');
const path = require('path');
const sourcesApi = require('./sources');

const DEFAULT_QUOTA_STATE_FILE = path.join(__dirname, 'data', 'quota-state.json');

const QUOTA_STATUS_CODES = Object.freeze({
  OK: 'OK',
  AUTH: 'AUTH',
  QUOTA: 'QUOTA',
  TIER: 'TIER',
  RATE: 'RATE',
  REGION: 'REGION',
  NO_CHANNEL: 'NO_CHANNEL',
  ERROR: 'ERROR',
  TIMEOUT: 'TIMEOUT',
  UNAVAILABLE: 'UNAVAILABLE',
});

const BLOCKING_CODES = new Set(['QUOTA', 'AUTH', 'REGION']);

function getHeader(headers, name) {
  if (!headers) return null;
  const target = String(name).toLowerCase();
  if (typeof headers.get === 'function') {
    return headers.get(target);
  }
  if (headers instanceof Map) {
    return headers.get(target) || headers.get(name) || null;
  }
  if (typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === target) return v;
    }
  }
  return null;
}

function classifyQuotaResponse(status, body, headers, now = Date.now()) {
  const bodyStr = typeof body === 'object' ? JSON.stringify(body) : String(body || '');
  let retryAfter = null;

  const retryHeader = getHeader(headers, 'retry-after');
  if (retryHeader) {
    if (/^\d+$/.test(retryHeader)) {
      retryAfter = now + parseInt(retryHeader, 10) * 1000;
    } else {
      const parsed = Date.parse(retryHeader);
      if (!Number.isNaN(parsed)) retryAfter = parsed;
    }
  } else {
    const resetHeader = getHeader(headers, 'x-ratelimit-reset');
    if (resetHeader) {
      if (/^\d+$/.test(resetHeader)) {
        const val = parseInt(resetHeader, 10);
        retryAfter = val > 1e11 ? val : val > 1e9 ? val * 1000 : now + val * 1000;
      }
    }
  }

  if (status === 200) {
    return {
      status,
      code: QUOTA_STATUS_CODES.OK,
      reason: 'OK',
      retryAfter,
    };
  }

  // Check body for balance/credit insufficient keywords
  if (
    status === 402 ||
    /balance\s+is\s+insufficient|recharge\s+your\s+account|insufficient[_\s]credits|out\s+of\s+credits|insufficient[_\s]quota/i.test(
      bodyStr
    )
  ) {
    return {
      status: status || 402,
      code: QUOTA_STATUS_CODES.QUOTA,
      reason: 'QUOTA',
      retryAfter,
    };
  }

  if (status === 401 || /unauthorized|invalid[_\s]api[_\s]key/i.test(bodyStr)) {
    return {
      status: status || 401,
      code: QUOTA_STATUS_CODES.AUTH,
      reason: 'AUTH',
      retryAfter,
    };
  }

  if (
    status === 451 ||
    /region|country|geo[_\s]blocked|not\s+supported\s+in\s+your\s+country|unavailable\s+for\s+legal\s+reasons/i.test(
      bodyStr
    )
  ) {
    return {
      status: status || 451,
      code: QUOTA_STATUS_CODES.REGION,
      reason: 'REGION',
      retryAfter,
    };
  }

  if (status === 403) {
    if (
      /tier|deposit|ultra\s+and\s+power\s+plans|requires\s+an\s+active\s+paid\s+plan/i.test(bodyStr)
    ) {
      return {
        status: 403,
        code: QUOTA_STATUS_CODES.TIER,
        reason: 'TIER',
        retryAfter,
      };
    }
    return {
      status: 403,
      code: QUOTA_STATUS_CODES.AUTH,
      reason: 'AUTH',
      retryAfter,
    };
  }

  if (status === 429 || /rate\s+limit|too\s+many\s+requests/i.test(bodyStr)) {
    return {
      status: status || 429,
      code: QUOTA_STATUS_CODES.RATE,
      reason: 'RATE',
      retryAfter,
    };
  }

  if (
    status === 503 ||
    /no\s+channel|model_not_found|no\s+healthy\s+upstream|không\s+có\s+kênh/i.test(bodyStr)
  ) {
    return {
      status: status || 503,
      code: QUOTA_STATUS_CODES.NO_CHANNEL,
      reason: 'NO_CHANNEL',
      retryAfter,
    };
  }

  return {
    status: status || 500,
    code: status ? `HTTP_${status}` : QUOTA_STATUS_CODES.ERROR,
    // Never persist the provider body: it can echo request headers or credentials.
    reason: status ? `HTTP_${status}` : QUOTA_STATUS_CODES.ERROR,
    retryAfter,
  };
}

function loadQuotaState(options = {}) {
  const filePath = options.quotaStateFile || options.outFile || DEFAULT_QUOTA_STATE_FILE;
  if (!fs.existsSync(filePath)) {
    return { updatedAt: null, scopes: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    return {
      updatedAt: data.updatedAt || null,
      scopes: (data && typeof data.scopes === 'object' && data.scopes) || {},
    };
  } catch {
    return { updatedAt: null, scopes: {} };
  }
}

function saveQuotaState(state, options = {}) {
  const filePath = options.quotaStateFile || options.outFile || DEFAULT_QUOTA_STATE_FILE;
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${filePath}.tmp-${Date.now()}-${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function getQuotaScopeState(candidate, quotaState) {
  if (!candidate || !quotaState || !quotaState.scopes) return null;
  const scopes = quotaState.scopes;

  // Direct check by candidate quotaScope
  if (candidate.quotaScope && scopes[candidate.quotaScope]) {
    return scopes[candidate.quotaScope];
  }

  // Upstream check for gateway/router
  const isRouter =
    candidate.gateway === '9router' ||
    candidate.source === '9router' ||
    candidate.sourceId === '9router';

  if (candidate.upstream) {
    if (isRouter && scopes[`9router::${candidate.upstream}`]) {
      return scopes[`9router::${candidate.upstream}`];
    }
    if (scopes[candidate.upstream]) {
      return scopes[candidate.upstream];
    }
  }

  // Model prefix check (e.g. cl/..., kr/..., ocz/...)
  const modelId = candidate.modelId || candidate.model || '';
  const cleanModelId = modelId.replace(/^(ninerouter\/|9router\/)/, '');
  const prefixMatch = cleanModelId.match(/^([A-Za-z0-9_-]+)\//);
  if (prefixMatch) {
    const p = prefixMatch[1];
    if (isRouter && scopes[`9router::${p}`]) {
      return scopes[`9router::${p}`];
    }
    if (scopes[`9router::${p}`]) {
      return scopes[`9router::${p}`];
    }
    if (scopes[p]) {
      return scopes[p];
    }
  }

  // Source ID check
  if (candidate.sourceId && scopes[candidate.sourceId]) {
    return scopes[candidate.sourceId];
  }
  if (candidate.source && scopes[candidate.source]) {
    return scopes[candidate.source];
  }

  return null;
}

function isScopeBlocked(scopeEntry, now = Date.now()) {
  if (!scopeEntry || !scopeEntry.code) return false;
  if (!BLOCKING_CODES.has(scopeEntry.code)) return false;

  // Check retryAfter / expiresAt
  const retryMs = scopeEntry.retryAfter
    ? typeof scopeEntry.retryAfter === 'number'
      ? scopeEntry.retryAfter
      : Date.parse(scopeEntry.retryAfter)
    : null;
  if (retryMs && !Number.isNaN(retryMs)) {
    return now < retryMs;
  }

  const expMs = scopeEntry.expiresAt
    ? typeof scopeEntry.expiresAt === 'number'
      ? scopeEntry.expiresAt
      : Date.parse(scopeEntry.expiresAt)
    : null;
  if (expMs && !Number.isNaN(expMs)) {
    return now < expMs;
  }

  // Default TTL if neither is specified: 60 minutes from scan
  const atMs = scopeEntry.at
    ? typeof scopeEntry.at === 'number'
      ? scopeEntry.at
      : Date.parse(scopeEntry.at)
    : 0;
  const ttlMs = Number(scopeEntry.ttlMs) > 0 ? Number(scopeEntry.ttlMs) : 60 * 60 * 1000;
  if (atMs > 0) {
    return now - atMs < ttlMs;
  }

  return true;
}

async function scanScope(target, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  const now = options.now ?? Date.now();
  const apiKey =
    (options.env && options.env[target.apiKeyEnv]) || process.env[target.apiKeyEnv] || '';

  const endpoint = String(target.endpoint || '').replace(/\/+$/, '');
  const url = `${endpoint}/chat/completions`;

  const headers = {
    'content-type': 'application/json',
    ...(target.headers || {}),
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const dispatchConfig = sourcesApi.getDispatchConfig(
    options.registry || sourcesApi.loadSources(options.sourceOpts),
    { ...options, probeTimeoutMs: options.timeoutMs ?? options.probeTimeoutMs }
  );
  const payload = {
    model: target.model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: dispatchConfig.quotaProbeMaxOutputTokens,
  };

  const controller = new AbortController();
  const timeoutMs = dispatchConfig.probeTimeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {}

    const classification = classifyQuotaResponse(res.status, bodyText, res.headers, now);

    return {
      source: target.source,
      scope: target.scope,
      upstream: target.upstream,
      model: target.model,
      code: classification.code,
      status: classification.status,
      reason: classification.reason,
      at: new Date(now).toISOString(),
      retryAfter: classification.retryAfter,
    };
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err && (err.name === 'AbortError' || /abort|timeout/i.test(err.message));
    return {
      source: target.source,
      scope: target.scope,
      upstream: target.upstream,
      model: target.model,
      code: isTimeout ? QUOTA_STATUS_CODES.TIMEOUT : QUOTA_STATUS_CODES.UNAVAILABLE,
      status: isTimeout ? 408 : 503,
      reason: isTimeout ? 'TIMEOUT' : 'UNAVAILABLE',
      at: new Date(now).toISOString(),
      retryAfter: null,
    };
  }
}

async function discover9RouterScopes(source, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  const apiKey =
    (options.env && options.env[source.credential?.env]) ||
    process.env[source.credential?.env] ||
    '';
  const endpoint = String(source.endpoint || '').replace(/\/+$/, '');
  const url = `${endpoint}/models`;

  const headers = {};
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  let modelsList = [];
  try {
    const res = await fetchFn(url, { method: 'GET', headers });
    if (res.ok) {
      const data = typeof res.json === 'function' ? await res.json() : JSON.parse(await res.text());
      if (Array.isArray(data?.data)) {
        modelsList = data.data.map((m) => m.id || m.model || m).filter(Boolean);
      }
    }
  } catch {}

  // Fallback if /models endpoint returned empty or failed
  if (modelsList.length === 0 && Array.isArray(options.catalogue)) {
    modelsList = options.catalogue
      .map((c) => (typeof c === 'string' ? c : c.modelId || c.model || c.id))
      .filter(Boolean);
  }

  // Decompose by the upstream prefix each live model id carries.
  const groups = new Map();
  for (const mId of modelsList) {
    const ownPrefixes = [source.id, source.routerAlias].filter(Boolean).map((p) => `${p}/`);
    const raw = String(mId);
    const own = ownPrefixes.find((p) => raw.startsWith(p));
    const cleanId = own ? raw.slice(own.length) : raw;
    const prefixMatch = cleanId.match(/^([A-Za-z0-9_-]+)\//);
    if (!prefixMatch) continue;
    const prefix = prefixMatch[1];
    if (!groups.has(prefix)) {
      groups.set(prefix, cleanId);
    }
  }

  // No live or catalogued model means no scope can be named honestly; scan nothing
  // rather than invent prefixes or model ids.
  const targets = [];
  for (const [prefix, repModel] of groups.entries()) {
    targets.push({
      source: source.id,
      scope: prefix,
      upstream: prefix,
      model: repModel,
      endpoint: source.endpoint,
      apiKeyEnv: source.credential?.env,
    });
  }
  return targets;
}

async function scanTargetsForSource(src, options = {}) {
  if (!src || src.servesModels === false) return [];
  if (src.kind === 'router' || src.id === '9router') {
    return discover9RouterScopes(src, options);
  }
  if (src.kind !== 'model-source' && !src.endpoint) return [];
  const repModel =
    (Array.isArray(src.models) && src.models.find((m) => typeof m === 'string' && m)) ||
    src.verify?.model;
  // A source with no configured or verified model has nothing honest to scan.
  if (!repModel) return [];
  return [
    {
      source: src.id,
      scope: src.id,
      upstream: src.routerAlias || src.id,
      model: repModel,
      endpoint: src.endpoint,
      apiKeyEnv: src.credential?.env,
    },
  ];
}

function recordScanResult(quotaState, target, result) {
  quotaState.scopes[`${target.source}::${target.scope}`] = result;
  quotaState.scopes[target.source] = result;
  quotaState.scopes[target.scope] = result;
}

// Scans one source's quota scopes (per key, or per router upstream) and records them.
// Unlike a full scan it leaves the full-scan timestamp alone.
async function scanSourceQuotas(src, options = {}) {
  const quotaState = loadQuotaState(options);
  quotaState.scopes = quotaState.scopes || {};
  const targets = await scanTargetsForSource(src, options);
  const results = [];
  for (const target of targets) {
    const result = await scanScope(target, options);
    recordScanResult(quotaState, target, result);
    results.push(result);
  }
  if (targets.length > 0 && options.persist !== false) {
    saveQuotaState(quotaState, options);
  }
  return results;
}

async function scanAllQuotas(options = {}) {
  const now = options.now ?? Date.now();
  const registry = options.registry || sourcesApi.loadSources(options.sourceOpts);
  const quotaState = loadQuotaState(options);
  quotaState.scopes = quotaState.scopes || {};

  const targets = [];
  const sources = (registry && registry.sources) || [];

  for (const src of sources) {
    if (options.source && src.id !== options.source) continue;
    targets.push(...(await scanTargetsForSource(src, options)));
  }

  let blockedCount = 0;
  for (const target of targets) {
    const result = await scanScope(target, options);
    recordScanResult(quotaState, target, result);
    if (BLOCKING_CODES.has(result.code)) {
      blockedCount++;
    }
  }

  quotaState.updatedAt = new Date(now).toISOString();

  if (options.persist !== false) {
    saveQuotaState(quotaState, options);
  }

  return {
    at: quotaState.updatedAt,
    scopes: quotaState.scopes,
    count: targets.length,
    blockedCount,
  };
}

module.exports = {
  DEFAULT_QUOTA_STATE_FILE,
  QUOTA_STATUS_CODES,
  BLOCKING_CODES,
  classifyQuotaResponse,
  loadQuotaState,
  saveQuotaState,
  getQuotaScopeState,
  isScopeBlocked,
  scanScope,
  discover9RouterScopes,
  scanAllQuotas,
  scanSourceQuotas,
};
