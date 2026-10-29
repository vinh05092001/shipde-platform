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
  STATE_ERROR: 'STATE_ERROR',
  DISCOVERY_FAILED: 'DISCOVERY_FAILED',
  UNSCANNABLE: 'UNSCANNABLE',
  UNVERIFIED: 'UNVERIFIED',
});

// DISCOVERY_FAILED blocks: without a catalogue there is no quota evidence for router candidates.
const BLOCKING_CODES = new Set(['QUOTA', 'AUTH', 'REGION', 'STATE_ERROR', 'DISCOVERY_FAILED']);

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

const ALLOWED_REASONS = new Set([
  'OK',
  'QUOTA',
  'AUTH',
  'TIER',
  'RATE',
  'REGION',
  'NO_CHANNEL',
  'TIMEOUT',
  'FETCH_FAILED',
  'ERROR',
  'UNAVAILABLE',
  'STATE_ERROR',
  'DISCOVERY_FAILED',
  'UNSCANNABLE',
  'SCAN_FAILED',
  'UNVERIFIED',
]);

function sanitizeStatusDescription(str, fallback = 'ERROR') {
  if (typeof str === 'string') {
    const trimmed = str.trim();
    if (ALLOWED_REASONS.has(trimmed) || /^HTTP_\d{3}$/.test(trimmed)) {
      return trimmed;
    }
  }
  if (typeof fallback === 'string') {
    const trimmedFallback = fallback.trim();
    if (ALLOWED_REASONS.has(trimmedFallback) || /^HTTP_\d{3}$/.test(trimmedFallback)) {
      return trimmedFallback;
    }
  }
  return 'ERROR';
}

function isCompletionBody(body) {
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body);
    } catch {
      return false;
    }
  }
  if (!parsed || typeof parsed !== 'object' || parsed.error) return false;
  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : null;
  if (!choice || typeof choice !== 'object') return false;
  return Boolean(
    (choice.message && typeof choice.message === 'object') ||
    typeof choice.text === 'string' ||
    choice.finish_reason
  );
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

  // HTTP 200 is OK only with positive completion evidence. Routers may return quota, auth or
  // balance errors inside a 200 envelope; those fall through to the body classification below.
  if (status === 200 && isCompletionBody(body)) {
    return {
      status,
      code: QUOTA_STATUS_CODES.OK,
      reason: 'OK',
      retryAfter,
    };
  }

  // Authoritative HTTP statuses map first; body keywords only classify other statuses.
  if (status === 401) {
    return { status, code: QUOTA_STATUS_CODES.AUTH, reason: 'AUTH', retryAfter };
  }
  if (status === 451) {
    return { status, code: QUOTA_STATUS_CODES.REGION, reason: 'REGION', retryAfter };
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

  if (status === 200) {
    return {
      status,
      code: QUOTA_STATUS_CODES.UNVERIFIED,
      reason: 'UNVERIFIED',
      retryAfter,
    };
  }

  return {
    status: status || 500,
    code: status ? `HTTP_${status}` : QUOTA_STATUS_CODES.ERROR,
    reason: status ? `HTTP_${status}` : 'ERROR',
    retryAfter,
  };
}

function loadQuotaState(options = {}) {
  if (options.quotaState && typeof options.quotaState === 'object') {
    return options.quotaState;
  }
  if (options.state && typeof options.state === 'object') {
    return options.state;
  }
  const filePath = options.quotaStateFile || options.outFile || DEFAULT_QUOTA_STATE_FILE;
  if (!fs.existsSync(filePath)) {
    return { updatedAt: null, sourceFreshness: {}, scopes: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(`Malformed quota state: root must be an object (${filePath})`);
    }
    if (data.scopes && (typeof data.scopes !== 'object' || Array.isArray(data.scopes))) {
      throw new Error(`Malformed quota state: scopes must be an object (${filePath})`);
    }
    return {
      updatedAt: data.updatedAt || null,
      sourceFreshness:
        (data &&
          typeof data.sourceFreshness === 'object' &&
          !Array.isArray(data.sourceFreshness) &&
          data.sourceFreshness) ||
        {},
      scopes: (data && typeof data.scopes === 'object' && data.scopes) || {},
    };
  } catch (err) {
    if (options.throwOnError) {
      throw err;
    }
    const errorScope = {
      code: QUOTA_STATUS_CODES.STATE_ERROR,
      status: 500,
      reason: 'STATE_ERROR',
      error: err,
      at: new Date().toISOString(),
    };
    const targetObj = {};
    const fallbackScopes = new Proxy(targetObj, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string' && prop !== 'toJSON') {
          return errorScope;
        }
        return target[prop];
      },
      set(target, prop, val) {
        target[prop] = val;
        return true;
      },
    });
    return {
      updatedAt: null,
      scopes: fallbackScopes,
      error: err,
      stateError: err.message,
    };
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

function expandSourceAliases(id, registryOrOptions) {
  return sourcesApi.getSourceAliases(id, registryOrOptions);
}

function getQuotaScopeState(candidate, quotaState, options = {}) {
  if (!candidate || !quotaState) return null;
  const now = typeof options === 'number' ? options : ((options && options.now) ?? Date.now());
  const opts = typeof options === 'number' ? { now: options } : options || {};

  // The selected route identity (sourceId/source/gateway/accessPath) is authoritative. Only when
  // none is set are `sourceIds` consulted, and then they are alternatives: the candidate is blocked
  // only if every alternative is blocked, so one exhausted source cannot reject a healthy route.
  const clean = (id) => (typeof id === 'string' && id.trim() ? id.trim() : null);
  // A gateway/accessPath is the route actually used; sourceId/source then names the upstream
  // behind it, checked as `<gateway>::<upstream>` below.
  const isHttpUrl = (val) => typeof val === 'string' && /^https?:\/\//i.test(val);
  const selectedId =
    clean(candidate.gateway) ||
    (!isHttpUrl(candidate.accessPath) ? clean(candidate.accessPath) : null) ||
    clean(candidate.sourceId) ||
    clean(candidate.source) ||
    clean(candidate.accessPath);
  const upstreamIds = [
    clean(candidate.upstream),
    clean(candidate.sourceId),
    clean(candidate.source),
  ].filter((id) => id && id !== selectedId);
  const alternativeIds = [];
  for (const sid of Array.isArray(candidate.sourceIds)
    ? candidate.sourceIds
    : [candidate.sourceIds]) {
    const id = clean(sid);
    if (id && !alternativeIds.includes(id)) alternativeIds.push(id);
  }
  const candidateSourceIds = selectedId ? [selectedId] : alternativeIds;

  if (quotaState.error) {
    return {
      source:
        candidateSourceIds[0] ||
        candidate.sourceId ||
        candidate.source ||
        candidate.gateway ||
        candidate.accessPath ||
        'unknown',
      scope: candidate.quotaScope || candidate.upstream || candidate.source || 'all',
      code: QUOTA_STATUS_CODES.STATE_ERROR,
      status: 500,
      reason: 'STATE_ERROR',
      error: quotaState.error,
      at: new Date(now).toISOString(),
      retryAfter: null,
    };
  }
  if (!quotaState.scopes) return null;
  const scopes = quotaState.scopes;

  // Direct check by candidate quotaScope or accountId
  const directScopeKey = candidate.quotaScope || candidate.accountId;
  const directScope = directScopeKey ? scopes[directScopeKey] : null;

  const modelId = candidate.modelId || candidate.model || '';
  const cleanModelId = modelId.replace(/^(ninerouter\/|9router\/)/, '');
  const prefixMatch = cleanModelId.match(/^([A-Za-z0-9_-]+)\//);
  const prefix = prefixMatch ? prefixMatch[1] : null;
  const bareModelId = cleanModelId.includes('/')
    ? cleanModelId.split('/').slice(1).join('/')
    : null;

  // Resolve source and upstream scope state for one route identity.
  const resolveIdentity = (sid) => {
    const aliases = expandSourceAliases(sid, opts.registry || options?.registry);

    // 1. Check for specific model entries across all aliases
    let activeModelEntry = null;
    for (const a of aliases) {
      const modelKeys = [
        cleanModelId ? `${a}::${cleanModelId}` : null,
        bareModelId ? `${a}::${bareModelId}` : null,
      ].filter(Boolean);
      for (const k of modelKeys) {
        const entry = scopes[k];
        if (entry) {
          if (!activeModelEntry) activeModelEntry = entry;
          if (isScopeBlocked(entry, now, opts)) {
            const source = scopes[a] || scopes[sid] || null;
            return { source, upstream: entry, blocked: entry };
          }
        }
      }
    }

    // 2. Check upstream and source entries across all aliases
    let foundSource = null;
    let foundUpstream = null;
    let foundBlocked = null;

    for (const a of aliases) {
      const source = scopes[a] || null;
      if (source && isScopeBlocked(source, now, opts)) {
        foundBlocked = foundBlocked || source;
      }
      if (source && !foundSource) foundSource = source;

      const upstreamEntries = [activeModelEntry, ...upstreamIds, candidate.accountId, prefix]
        .filter(Boolean)
        .map((id) => (typeof id === 'string' ? scopes[`${a}::${id}`] : id))
        .filter(Boolean);

      const blockedUpstream = upstreamEntries.find((entry) => isScopeBlocked(entry, now, opts));
      if (blockedUpstream) {
        foundBlocked = foundBlocked || blockedUpstream;
      }
      if (upstreamEntries[0] && !foundUpstream) foundUpstream = upstreamEntries[0];
    }

    // Blocked source takes precedence over non-blocked upstream
    if (foundSource && isScopeBlocked(foundSource, now, opts)) {
      return { source: foundSource, upstream: foundUpstream, blocked: foundSource };
    }

    return { source: foundSource, upstream: foundUpstream, blocked: foundBlocked };
  };

  const resolved = candidateSourceIds.map(resolveIdentity);
  // Selected route: its own state decides. Alternatives: blocked only when all are blocked.
  const routeBlocked = resolved.length > 0 && resolved.every((r) => r.blocked);
  if (routeBlocked) return resolved[0].blocked;
  const usable = resolved.find((r) => !r.blocked) || null;
  const sourceScope = usable ? usable.source : null;
  const upstreamScope = usable ? usable.upstream : null;

  // If direct quotaScope is blocked, return direct
  if (directScope && isScopeBlocked(directScope, now, opts)) {
    return directScope;
  }

  // None are blocked; return most specific resolved scope state (upstream > direct > source)
  return upstreamScope || directScope || sourceScope || null;
}

function resolveBlockTtlMs(scopeEntry, options = {}) {
  if (Number(scopeEntry?.ttlMs) > 0) return Number(scopeEntry.ttlMs);
  if (Number(scopeEntry?.quotaBlockTtlMs) > 0) return Number(scopeEntry.quotaBlockTtlMs);
  if (Number(scopeEntry?.blockTtlMs) > 0) return Number(scopeEntry.blockTtlMs);

  if (typeof options === 'number' && options > 0) return options;
  if (Number(options?.ttlMs) > 0) return Number(options.ttlMs);
  if (Number(options?.quotaBlockTtlMs) > 0) return Number(options.quotaBlockTtlMs);
  if (Number(options?.defaultTtlMs) > 0) return Number(options.defaultTtlMs);
  if (Number(options?.blockTtlMs) > 0) return Number(options.blockTtlMs);
  if (Number(options?.quotaBlockTtlMin) > 0) return Number(options.quotaBlockTtlMin) * 60 * 1000;

  try {
    const reg = options?.registry || sourcesApi.loadSources(options?.sourceOpts);
    const dispatchConfig =
      options?.dispatchConfig ||
      (sourcesApi.getDispatchConfig ? sourcesApi.getDispatchConfig(reg, options) : {});
    if (Number(dispatchConfig?.quotaBlockTtlMs) > 0) {
      return Number(dispatchConfig.quotaBlockTtlMs);
    }
    if (Number(dispatchConfig?.quotaBlockTtlMin) > 0) {
      return Number(dispatchConfig.quotaBlockTtlMin) * 60 * 1000;
    }
    if (Number(dispatchConfig?.quotaScanIntervalMin) > 0) {
      return Number(dispatchConfig.quotaScanIntervalMin) * 60 * 1000;
    }
  } catch {}

  const defaultDispatch = require('./sources.json').dispatch;
  if (Number(defaultDispatch?.quotaBlockTtlMin) > 0) {
    return Number(defaultDispatch.quotaBlockTtlMin) * 60 * 1000;
  }
  if (Number(defaultDispatch?.quotaScanIntervalMin) > 0) {
    return Number(defaultDispatch.quotaScanIntervalMin) * 60 * 1000;
  }
  // No configured TTL: 0 makes isScopeBlocked keep the scope blocked until the next scan.
  return 0;
}

// Limits come from dispatch configuration (validated by sources.getDispatchConfig); a missing or
// invalid value is a configuration error, never a silent literal fallback.
function requireConfiguredLimit(value, key) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error('DISPATCH_CONFIG_INVALID: ' + key + ' must be a positive number');
  }
  return n;
}

function requireConfiguredNonNegative(value, key) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('DISPATCH_CONFIG_INVALID: ' + key + ' must be a non-negative number');
  }
  return n;
}

function getSourcePrefixes(source) {
  if (!source) return [];
  const aliases = Array.isArray(source.aliases) ? source.aliases : [];
  const modelPrefix = source.modelPrefix ? source.modelPrefix.replace(/\/+$/, '') : null;
  return [source.id, ...aliases, source.routerAlias, modelPrefix]
    .filter(Boolean)
    .map((p) => `${p}/`);
}

function isScopeBlocked(scopeEntry, now = Date.now(), options = {}) {
  if (!scopeEntry) return false;
  if (scopeEntry.error && !scopeEntry.code) return true;
  if (!scopeEntry.code) return false;
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

  // Fallback TTL if neither is specified: read from dispatch configuration or live expiry data
  const atMs = scopeEntry.at
    ? typeof scopeEntry.at === 'number'
      ? scopeEntry.at
      : Date.parse(scopeEntry.at)
    : 0;
  const ttlMs = resolveBlockTtlMs(scopeEntry, options);
  if (atMs > 0 && ttlMs > 0) {
    return now - atMs < ttlMs;
  }

  return true;
}

async function scanScope(target, options = {}) {
  const startedAt = Date.now();
  const fetchFn = options.fetch || globalThis.fetch;
  const now = options.now ?? Date.now();
  const apiKey = (options.env || process.env)[target.apiKeyEnv] || '';

  const endpoint = String(target.endpoint || '').replace(/\/+$/, '');
  const url = `${endpoint}/chat/completions`;

  const headers = {
    'content-type': 'application/json',
    ...(target.headers || {}),
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const registry = options.registry || sourcesApi.loadSources?.(options.sourceOpts);
  const dispatchConfig =
    registry && sourcesApi.getDispatchConfig ? sourcesApi.getDispatchConfig(registry, options) : {};
  const timeoutMs = requireConfiguredLimit(
    options.timeoutMs ?? dispatchConfig.probeTimeoutMs,
    'probeTimeoutMs'
  );
  const payload = {
    model: target.model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: requireConfiguredLimit(
      options.quotaScanMaxTokens ?? dispatchConfig.quotaScanMaxTokens,
      'quotaScanMaxTokens'
    ),
  };

  const controller = new AbortController();
  let timer;

  try {
    const fetchPromise = (async () => {
      const res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch (err) {
        if (controller.signal.aborted) throw err;
      }
      if (controller.signal.aborted) {
        const abortErr = new Error('Request timed out');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      return { res, bodyText };
    })();

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error('Request timed out');
        err.name = 'AbortError';
        reject(err);
      }, timeoutMs);
    });

    const { res, bodyText } = await Promise.race([fetchPromise, timeoutPromise]);
    clearTimeout(timer);

    const classification = classifyQuotaResponse(res.status, bodyText, res.headers, now);

    // Explicit caller TTL (ms or minutes) wins over dispatch configuration.
    const ttlMs =
      options.ttlMs ??
      options.quotaBlockTtlMs ??
      (Number(options.quotaBlockTtlMin) > 0
        ? Number(options.quotaBlockTtlMin) * 60 * 1000
        : undefined) ??
      dispatchConfig.quotaBlockTtlMs ??
      (dispatchConfig.quotaBlockTtlMin ? dispatchConfig.quotaBlockTtlMin * 60 * 1000 : undefined);

    const result = {
      source: target.source,
      scope: target.scope,
      upstream: target.upstream,
      model: target.model,
      code: classification.code,
      status: classification.status,
      reason: classification.reason,
      at: new Date(now).toISOString(),
      retryAfter: classification.retryAfter,
      elapsedMs: Date.now() - startedAt,
    };
    if (ttlMs) {
      result.ttlMs = ttlMs;
    }
    return result;
  } catch (err) {
    clearTimeout(timer);
    const isTimeout =
      err &&
      (err.name === 'AbortError' ||
        controller.signal.aborted ||
        /abort|timeout/i.test(err.message));
    return {
      source: target.source,
      scope: target.scope,
      upstream: target.upstream,
      model: target.model,
      code: isTimeout ? QUOTA_STATUS_CODES.TIMEOUT : QUOTA_STATUS_CODES.UNAVAILABLE,
      status: isTimeout ? 408 : 503,
      reason: isTimeout ? 'TIMEOUT' : 'FETCH_FAILED',
      at: new Date(now).toISOString(),
      retryAfter: null,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

function selectRepresentativeModel(models, options = {}) {
  if (!Array.isArray(models) || models.length === 0) return null;
  if (models.length === 1) return models[0];

  let priors = options.priors;
  if (!priors) {
    try {
      const priorsApi = require('./priors');
      priors = priorsApi.loadPriors(options.priorsFile);
    } catch {}
  }

  let priorsApi;
  try {
    priorsApi = require('./priors');
  } catch {}

  const scored = models.map((m) => {
    let score = -1;
    if (priorsApi && priors) {
      try {
        const prior = priorsApi.priorFor({ modelId: m }, 'writer', priors, options.now);
        if (prior && typeof prior.score === 'number') {
          score = prior.score;
        }
      } catch {}
    }
    return { model: m, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.model.localeCompare(b.model);
  });

  return scored[0].model;
}

async function fetchSourceModels(source, options = {}) {
  if (!source || !source.endpoint || source.servesModels === false) {
    return Array.isArray(source?.models) ? source.models : [];
  }
  const fetchFn = options.fetch || globalThis.fetch;
  const apiKey = (options.env || process.env)[source.credential?.env] || '';
  const endpoint = String(source.endpoint || '').replace(/\/+$/, '');
  const url = `${endpoint}/models`;

  const headers = {
    ...(source.headers || {}),
    ...(options.headers || {}),
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const registry = options.registry || sourcesApi.loadSources?.(options.sourceOpts);
  const dispatchConfig =
    registry && sourcesApi.getDispatchConfig ? sourcesApi.getDispatchConfig(registry, options) : {};
  const timeoutMs = requireConfiguredLimit(
    options.timeoutMs ?? dispatchConfig.probeTimeoutMs,
    'probeTimeoutMs'
  );

  const controller = new AbortController();
  let timer;

  try {
    const fetchPromise = (async () => {
      const res = await fetchFn(url, { method: 'GET', headers, signal: controller.signal });
      if (!res.ok) {
        const err = new Error(
          `FETCH_MODELS_FAILED: source ${source.id} endpoint answered HTTP ${res.status}`
        );
        err.status = res.status;
        err.source = source.id;
        throw err;
      }
      let data;
      if (typeof res.json === 'function') {
        data = await res.json();
      } else {
        const raw = await res.text();
        data = JSON.parse(raw);
      }
      if (controller.signal.aborted) {
        const abortErr = new Error('Request timed out');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      let rawList;
      if (Array.isArray(data?.data)) {
        rawList = data.data;
      } else if (Array.isArray(data?.models)) {
        rawList = data.models;
      } else if (Array.isArray(data)) {
        rawList = data;
      } else {
        const shapeErr = new Error(
          `MALFORMED_MODELS_RESPONSE: source ${source.id} returned invalid payload shape (expected array at data, models, or root)`
        );
        shapeErr.source = source.id;
        throw shapeErr;
      }

      const list = rawList.map((m, idx) => {
        let id = null;
        if (typeof m === 'string') {
          id = m.trim();
        } else if (m && typeof m === 'object') {
          if (typeof m.id === 'string') id = m.id.trim();
          else if (typeof m.model === 'string') id = m.model.trim();
        }
        if (!id) {
          const entryErr = new Error(
            `MALFORMED_MODELS_RESPONSE: source ${source.id} entry at index ${idx} is not a valid model identifier`
          );
          entryErr.source = source.id;
          throw entryErr;
        }
        return id;
      });

      return list;
    })();

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error('Request timed out');
        err.name = 'AbortError';
        reject(err);
      }, timeoutMs);
    });

    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function discover9RouterScopes(source, options = {}) {
  let modelsList = [];
  try {
    modelsList = await fetchSourceModels(source, options);
  } catch {
    // Timeout, network failure, or malformed response falls through to live catalogue fallback
  }

  const parsePrefixedGroups = (list) => {
    const prefixMap = new Map();
    const ownPrefixes = getSourcePrefixes(source);
    for (const mId of list) {
      const raw = String(mId);
      const own = ownPrefixes.find((p) => raw.startsWith(p));
      const cleanId = own ? raw.slice(own.length) : raw;
      const prefixMatch = cleanId.match(/^([A-Za-z0-9_-]+)\//);
      if (!prefixMatch) continue;
      const prefix = prefixMatch[1];
      if (!prefixMap.has(prefix)) {
        prefixMap.set(prefix, []);
      }
      prefixMap.get(prefix).push(cleanId);
    }

    const map = new Map();
    for (const [prefix, pModels] of prefixMap.entries()) {
      const rep = selectRepresentativeModel(pModels, options);
      if (rep) map.set(prefix, rep);
    }
    return map;
  };

  let groups = parsePrefixedGroups(modelsList);

  // Fallback to live catalogue data if /models returned no prefixed models
  if (groups.size === 0) {
    let catalogue = options.catalogue;
    if (!catalogue) {
      try {
        const { readDiscoveryCatalogue } = require('./discovery/read');
        const discDir =
          options.discoveryDataDir || options.dataDir || path.join(__dirname, 'data', 'discovery');
        catalogue = readDiscoveryCatalogue({ dataDir: discDir });
      } catch {}
    }
    const candidates = Array.isArray(catalogue)
      ? catalogue
      : Array.isArray(catalogue?.candidates)
        ? catalogue.candidates
        : [];
    const sourceId = source.id;
    const matching = candidates.filter((c) => {
      if (typeof c === 'string') return true;
      if (!c) return false;
      if (c.sourceIds && Array.isArray(c.sourceIds) && c.sourceIds.includes(sourceId)) return true;
      if (c.gateway === sourceId || c.accessPath === sourceId) return true;
      return false;
    });
    const candidatePool = matching;
    const catModels = candidatePool
      .map((c) => (typeof c === 'string' ? c : c.modelId || c.model || c.id))
      .filter(Boolean);
    groups = parsePrefixedGroups(catModels);
  }

  // If no live prefix models found, report discovery failure without fabricating probes
  if (groups.size === 0) {
    if (options.throwOnEmpty || Array.isArray(options.catalogue)) {
      const err = new Error(
        `Discovery failed for router ${source.id}: no live prefixed models found via /models or catalogue`
      );
      err.code = 'DISCOVERY_FAILED';
      err.source = source.id;
      throw err;
    }
    return [];
  }

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

async function scanAllQuotas(options = {}) {
  if (options.full) {
    return scanAllFullRoutes(options);
  }
  const now = options.now ?? Date.now();
  const registry = options.registry || sourcesApi.loadSources(options.sourceOpts);
  const quotaState = loadQuotaState(options);
  quotaState.scopes = quotaState.scopes || {};

  const targets = [];
  const sources = (registry && registry.sources) || [];

  const processedSources = new Set();
  const failedSources = new Set();

  for (const src of sources) {
    if (src.servesModels === false) continue;
    if (options.source && src.id !== options.source) continue;
    processedSources.add(src.id);

    if (src.kind === 'router') {
      try {
        const routerTargets = await discover9RouterScopes(src, {
          registry,
          ...options,
          throwOnEmpty: true,
        });
        targets.push(...routerTargets);
        for (const key of [src.id, `${src.id}::${src.id}`]) {
          if (quotaState.scopes[key]?.code === QUOTA_STATUS_CODES.DISCOVERY_FAILED) {
            delete quotaState.scopes[key];
          }
        }
      } catch (err) {
        // A failed discovery is not a completed scan: freshness is not advanced for this source.
        failedSources.add(src.id);
        const failureCode = QUOTA_STATUS_CODES.DISCOVERY_FAILED;
        const existing = quotaState.scopes[src.id] || quotaState.scopes[`${src.id}::${src.id}`];
        let entry = {
          source: src.id,
          scope: src.id,
          upstream: src.id,
          model: null,
          code: failureCode,
          status: err?.status || 503,
          reason: sanitizeStatusDescription(err?.message, 'DISCOVERY_FAILED'),
          at: new Date(now).toISOString(),
          retryAfter: null,
          error: sanitizeStatusDescription(err?.message, 'DISCOVERY_FAILED'),
        };
        if (existing && BLOCKING_CODES.has(existing.code) && isScopeBlocked(existing, now)) {
          entry = existing;
        }
        quotaState.scopes[`${src.id}::${src.id}`] = entry;
        quotaState.scopes[src.id] = entry;
      }
    } else if (src.kind === 'model-source' || src.endpoint) {
      let repModel = null;
      let discoveryError = null;
      if (Array.isArray(src.models) && src.models.length > 0) {
        repModel = selectRepresentativeModel(src.models, options);
      } else if (src.servesModels === true) {
        try {
          const liveModels = await fetchSourceModels(src, { registry, ...options });
          if (liveModels.length > 0) {
            repModel = selectRepresentativeModel(liveModels, options);
          }
        } catch (err) {
          discoveryError = err;
        }
      }

      if (!repModel && !discoveryError && src.verify?.model) {
        repModel = src.verify.model;
      }

      if (!repModel && !discoveryError && options.catalogue) {
        const cat = Array.isArray(options.catalogue)
          ? options.catalogue
          : options.catalogue?.candidates || [];
        const found = cat.find((c) => {
          if (!c) return false;
          if (c.sourceIds && Array.isArray(c.sourceIds) && c.sourceIds.includes(src.id))
            return true;
          if (c.gateway === src.id || c.accessPath === src.id || c.source === src.id) return true;
          return false;
        });
        if (found) {
          repModel =
            typeof found === 'string' ? found : found.modelId || found.model || found.id || null;
        }
      }

      if (discoveryError || !repModel) {
        const existing = quotaState.scopes[src.id] || quotaState.scopes[`${src.id}::${src.id}`];
        if (
          !discoveryError &&
          existing &&
          BLOCKING_CODES.has(existing.code) &&
          isScopeBlocked(existing, now)
        ) {
          continue;
        }
        const failureCode = discoveryError
          ? QUOTA_STATUS_CODES.DISCOVERY_FAILED
          : QUOTA_STATUS_CODES.UNSCANNABLE;
        const failureEntry = {
          source: src.id,
          scope: src.id,
          upstream: src.routerAlias || src.id,
          model: null,
          code: failureCode,
          status:
            discoveryError?.status || (failureCode === QUOTA_STATUS_CODES.UNSCANNABLE ? null : 503),
          reason: sanitizeStatusDescription(discoveryError?.message || 'UNSCANNABLE', failureCode),
          at: new Date(now).toISOString(),
          retryAfter: null,
          error: sanitizeStatusDescription(discoveryError?.message || 'UNSCANNABLE', failureCode),
        };
        quotaState.scopes[`${src.id}::${src.id}`] = failureEntry;
        quotaState.scopes[src.id] = failureEntry;
        for (const key of Object.keys(quotaState.scopes)) {
          if (key.startsWith(`${src.id}::`)) {
            quotaState.scopes[key] = failureEntry;
          }
        }
        failedSources.add(src.id);
        continue;
      }

      targets.push({
        source: src.id,
        scope: src.id,
        upstream: src.routerAlias || src.id,
        model: repModel,
        endpoint: src.endpoint,
        apiKeyEnv: src.credential?.env,
      });
    }
  }

  let blockedCount = 0;
  for (const target of targets) {
    try {
      const result = await scanScope(target, { registry, ...options });
      const scopeKey = `${target.source}::${target.scope}`;
      const existing =
        quotaState.scopes[scopeKey] ||
        (target.source === target.scope ? quotaState.scopes[target.source] : null);

      let effectiveResult = result;
      if (
        existing &&
        BLOCKING_CODES.has(existing.code) &&
        isScopeBlocked(existing, now) &&
        result.code !== QUOTA_STATUS_CODES.OK &&
        !BLOCKING_CODES.has(result.code)
      ) {
        effectiveResult = existing;
      }

      quotaState.scopes[scopeKey] = effectiveResult;
      if (target.source === target.scope) {
        quotaState.scopes[target.source] = effectiveResult;
      }
      if (BLOCKING_CODES.has(effectiveResult.code)) {
        blockedCount++;
      }
    } catch (err) {
      const failureKey = `${target.source}::${target.scope}`;
      const failureResult = {
        source: target.source,
        scope: target.scope,
        upstream: target.upstream,
        model: target.model,
        code: QUOTA_STATUS_CODES.ERROR,
        status: 500,
        reason: sanitizeStatusDescription(err?.message, 'ERROR'),
        at: new Date(now).toISOString(),
        retryAfter: null,
      };
      quotaState.scopes[failureKey] = failureResult;
      if (target.source === target.scope) {
        quotaState.scopes[target.source] = failureResult;
      }
    }
  }

  const isPartialScan = Boolean(options.source);
  quotaState.sourceFreshness = quotaState.sourceFreshness || {};

  const scannedSources = new Set([...processedSources, ...targets.map((t) => t.source)]);
  for (const srcId of scannedSources) {
    if (failedSources.has(srcId)) continue;
    quotaState.sourceFreshness[srcId] = new Date(now).toISOString();
  }

  // A full scan with a failed discovery is incomplete, so the global due time is not advanced.
  if (!isPartialScan && failedSources.size === 0) {
    quotaState.updatedAt = new Date(now).toISOString();
  }

  if (options.persist !== false) {
    saveQuotaState(quotaState, options);
  }

  return {
    at: quotaState.updatedAt || new Date(now).toISOString(),
    scopes: quotaState.scopes,
    count: targets.length,
    blockedCount,
  };
}

function isQuotaScanDue(quotaState, intervalMin, now = Date.now(), source = null) {
  if (!quotaState) return true;
  if (!intervalMin || intervalMin <= 0) return true;
  if (source) {
    const srcTime = quotaState.sourceFreshness && quotaState.sourceFreshness[source];
    if (!srcTime) return true;
    const lastSourceScan = new Date(srcTime).getTime();
    if (Number.isNaN(lastSourceScan)) return true;
    const elapsedMin = (now - lastSourceScan) / (60 * 1000);
    return elapsedMin >= intervalMin;
  }
  if (!quotaState.updatedAt) return true;
  const lastScan = new Date(quotaState.updatedAt).getTime();
  if (Number.isNaN(lastScan)) return true;
  const elapsedMin = (now - lastScan) / (60 * 1000);
  return elapsedMin >= intervalMin;
}

function schedulePeriodicQuotaScan(options = {}) {
  const registry = options.registry || sourcesApi.loadSources(options.sourceOpts);
  const dispatchConfig =
    registry && sourcesApi.getDispatchConfig ? sourcesApi.getDispatchConfig(registry) : {};
  let intervalMin;
  let intervalMs;
  if (typeof options.intervalMs === 'number' && options.intervalMs > 0) {
    intervalMs = options.intervalMs;
    intervalMin = intervalMs / (60 * 1000);
  } else {
    intervalMin = requireConfiguredLimit(
      options.intervalMin ?? dispatchConfig.quotaScanIntervalMin,
      'quotaScanIntervalMin'
    );
    intervalMs = intervalMin * 60 * 1000;
  }

  const upstreamLimiter = options.upstreamLimiter || {
    active: defaultSharedActivePerUpstream,
    waiters: defaultSharedUpstreamWaiters,
  };

  let inFlight = null;
  const scanFn = (opts) => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        if (typeof options.scanFn === 'function') {
          return await options.scanFn({ ...options, ...opts, upstreamLimiter });
        }
        return await scanAllFullRoutes({ ...options, ...opts, upstreamLimiter });
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  let initialPromise = null;
  if (options.initialScan !== false) {
    initialPromise = (async () => {
      try {
        return await scanFn(options);
      } catch (err) {
        if (typeof options.onError === 'function') options.onError(err);
      }
    })();
  }

  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;

  const timer = setIntervalFn(async () => {
    try {
      await scanFn(options);
    } catch (err) {
      if (typeof options.onError === 'function') options.onError(err);
    }
  }, intervalMs);

  if (options.unref && timer && timer.unref) timer.unref();
  return {
    timer,
    intervalMin,
    intervalMs,
    initialPromise,
    scanNow: (opts) => scanFn(opts),
    stop: () => clearIntervalFn(timer),
  };
}

// Settles with the promise, or rejects with an AbortError once the signal fires, so a
// stalled connect or a body that never ends cannot outlive the configured timeout.
function withinSignal(promise, signal) {
  if (!signal) return promise;
  const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

// A provider can answer HTTP 200 with an application error; only a usable completion counts.
function validateCompletion(bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { ok: false, reason: 'COMPLETION_UNREADABLE' };
  }

  if (
    !body ||
    typeof body !== 'object' ||
    body.error ||
    body.ok === false ||
    ['error', 'failed'].includes(String(body.status || '').toLowerCase())
  ) {
    return { ok: false, reason: 'APPLICATION_ERROR' };
  }

  const choice = Array.isArray(body.choices) ? body.choices[0] : null;
  const message = choice && choice.message;
  const content = message && message.content;
  const reasoning = message && (message.reasoning_content || message.reasoning);
  const hasText =
    (typeof content === 'string' && content.trim().length > 0) ||
    (typeof reasoning === 'string' && reasoning.trim().length > 0) ||
    (Array.isArray(content) &&
      content.some((part) => part && typeof part.text === 'string' && part.text.trim().length > 0));
  const hasToolCall = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
  if (!choice || !message || message.refusal || (!hasText && !hasToolCall)) {
    return { ok: false, reason: 'COMPLETION_UNUSABLE' };
  }

  return { ok: true };
}

async function scanTargetsForSource(src, options = {}) {
  if (!src || src.servesModels === false) return [];
  if (src.kind === 'router') {
    return discover9RouterScopes(src, options);
  }
  if (src.kind !== 'model-source' && !src.endpoint) return [];
  let repModel =
    (Array.isArray(src.models) && src.models.length > 0
      ? selectRepresentativeModel(src.models, options)
      : null) || src.verify?.model;

  if (!repModel && src.servesModels === true) {
    try {
      const liveModels = await fetchSourceModels(src, options);
      if (liveModels.length > 0) {
        repModel = selectRepresentativeModel(liveModels, options);
      }
    } catch {
      // Source cannot be scanned if live models fetch fails
    }
  }

  // A source with no configured, verified or live model has nothing honest to scan.
  if (!repModel) return [];
  return [
    {
      source: src.id,
      scope: src.id,
      upstream: src.routerAlias || src.id,
      model: repModel,
      endpoint: src.endpoint,
      apiKeyEnv: src.credential?.env,
      headers: src.headers,
    },
  ];
}

// Keys are always source-qualified so a router prefix can never collide with another source.
function recordScanResult(quotaState, target, result) {
  const scopeKey = `${target.source}::${target.scope}`;
  quotaState.scopes[scopeKey] = result;
  if (target.source === target.scope) {
    quotaState.scopes[target.source] = result;
  }
}

// Scans one source's quota scopes (per key, or per router upstream) and records them.
// Unlike a full scan it leaves the full-scan timestamp alone.
async function scanSourceQuotas(src, options = {}) {
  const quotaState = loadQuotaState(options);
  quotaState.scopes = quotaState.scopes || {};
  const targets = Array.isArray(options.targets)
    ? options.targets
    : await scanTargetsForSource(src, options);
  const results = await Promise.all(
    targets.map(async (target) => {
      const result = await scanScope(target, options);
      return { target, result };
    })
  );
  for (const { target, result } of results) {
    recordScanResult(quotaState, target, result);
  }
  if (targets.length > 0 && options.persist !== false) {
    saveQuotaState(quotaState, options);
  }
  return results.map((r) => r.result);
}

const defaultSharedActivePerUpstream = new Map();
const defaultSharedUpstreamWaiters = new Map();

async function scanAllFullRoutes(options = {}) {
  const now = options.now ?? Date.now();
  const quotaState = loadQuotaState(options);
  quotaState.scopes = quotaState.scopes || {};

  const registry = options.registry || sourcesApi.loadSources(options.sourceOpts);
  const dispatchConfig =
    registry && sourcesApi.getDispatchConfig ? sourcesApi.getDispatchConfig(registry, options) : {};

  const defaultDispatch = require('./sources.json').dispatch || {};
  const rawDispatch = (registry && registry.dispatch) || {};
  const upstreamConcurrencyCap = requireConfiguredLimit(
    options.maxConcurrentUpstreamProbes ??
      options.upstreamConcurrency ??
      rawDispatch.maxConcurrentUpstreamProbes ??
      dispatchConfig.maxConcurrentUpstreamProbes ??
      rawDispatch.maxConcurrentProbes ??
      dispatchConfig.maxConcurrentProbes ??
      defaultDispatch.maxConcurrentUpstreamProbes,
    'maxConcurrentUpstreamProbes'
  );
  const retryCount429 = requireConfiguredNonNegative(
    options.probeRetry429Count ??
      rawDispatch.probeRetry429Count ??
      dispatchConfig.probeRetry429Count ??
      defaultDispatch.probeRetry429Count,
    'probeRetry429Count'
  );
  const backoffMs429 = requireConfiguredLimit(
    options.probeRetry429BackoffMs ??
      rawDispatch.probeRetry429BackoffMs ??
      dispatchConfig.probeRetry429BackoffMs ??
      defaultDispatch.probeRetry429BackoffMs,
    'probeRetry429BackoffMs'
  );
  const maxRetryWaitMs =
    options.maxRetryWaitMs ??
    rawDispatch.maxRetryWaitMs ??
    dispatchConfig.rateLimitCooldownMs ??
    defaultDispatch.rateLimitCooldownMs ??
    backoffMs429 * Math.max(1, retryCount429);

  const sources = (registry && registry.sources) || [];
  const allTargets = [];
  const sourceStats = new Map();
  const failedSources = new Set();
  const scannedSources = new Set();

  for (const src of sources) {
    if (
      src.servesModels === false ||
      (sourcesApi.isRetired && sourcesApi.isRetired(src.id, registry)) ||
      (sourcesApi.isDeferred && sourcesApi.isDeferred(src.id, registry))
    ) {
      continue;
    }
    if (options.source && src.id !== options.source) continue;

    sourceStats.set(src.id, {
      sourceId: src.id,
      listed: 0,
      scanned: 0,
      alive: 0,
      quota: 0,
      auth: 0,
      region: 0,
      no_channel: 0,
      timeout: 0,
      other: 0,
    });

    if (src.kind === 'router') {
      let modelsList = [];
      let discoveryError = null;
      try {
        modelsList = await fetchSourceModels(src, { registry, ...options });
      } catch (err) {
        discoveryError = err;
      }
      sourceStats.get(src.id).listed = modelsList.length;

      if (discoveryError || modelsList.length === 0) {
        failedSources.add(src.id);
        const failureCode = QUOTA_STATUS_CODES.DISCOVERY_FAILED;
        const failureEntry = {
          source: src.id,
          scope: src.id,
          upstream: src.id,
          model: null,
          code: failureCode,
          status: discoveryError?.status || 503,
          reason: sanitizeStatusDescription(
            discoveryError?.message || 'NO_MODELS_DISCOVERED',
            'DISCOVERY_FAILED'
          ),
          at: new Date(now).toISOString(),
          retryAfter: null,
          error: sanitizeStatusDescription(
            discoveryError?.message || 'NO_MODELS_DISCOVERED',
            'DISCOVERY_FAILED'
          ),
        };
        quotaState.scopes[src.id] = failureEntry;
        quotaState.scopes[`${src.id}::${src.id}`] = failureEntry;
        for (const key of Object.keys(quotaState.scopes)) {
          if (key.startsWith(`${src.id}::`)) {
            quotaState.scopes[key] = failureEntry;
          }
        }
        continue;
      }

      scannedSources.add(src.id);
      const ownPrefixes = getSourcePrefixes(src);

      for (const mId of modelsList) {
        const raw = String(mId);
        const own = ownPrefixes.find((p) => raw.startsWith(p));
        const cleanId = own ? raw.slice(own.length) : raw;
        const prefixMatch = cleanId.match(/^([A-Za-z0-9_-]+)\//);
        const prefix = prefixMatch ? prefixMatch[1] : src.id;

        allTargets.push({
          source: src.id,
          scope: prefix,
          upstream: prefix,
          model: cleanId,
          endpoint: src.endpoint,
          apiKeyEnv: src.credential?.env,
          headers: src.headers,
        });
      }
    } else if (src.kind === 'model-source' || src.endpoint) {
      let modelsList = [];
      let discoveryError = null;
      if (Array.isArray(src.models) && src.models.length > 0) {
        modelsList = src.models;
      } else {
        try {
          modelsList = await fetchSourceModels(src, { registry, ...options });
        } catch (err) {
          discoveryError = err;
        }
      }
      if (!discoveryError && modelsList.length === 0 && src.verify?.model) {
        modelsList = [src.verify.model];
      }
      sourceStats.get(src.id).listed = modelsList.length;

      if (discoveryError || modelsList.length === 0) {
        failedSources.add(src.id);
        const failureCode = discoveryError
          ? QUOTA_STATUS_CODES.DISCOVERY_FAILED
          : QUOTA_STATUS_CODES.UNSCANNABLE;
        const failureEntry = {
          source: src.id,
          scope: src.id,
          upstream: src.routerAlias || src.id,
          model: null,
          code: failureCode,
          status:
            discoveryError?.status || (failureCode === QUOTA_STATUS_CODES.UNSCANNABLE ? 0 : 503),
          reason: sanitizeStatusDescription(
            discoveryError?.message || 'NO_MODELS_CONFIGURED',
            failureCode
          ),
          at: new Date(now).toISOString(),
          retryAfter: null,
          error: sanitizeStatusDescription(
            discoveryError?.message || 'NO_MODELS_CONFIGURED',
            failureCode
          ),
        };
        quotaState.scopes[src.id] = failureEntry;
        quotaState.scopes[`${src.id}::${src.id}`] = failureEntry;
        for (const key of Object.keys(quotaState.scopes)) {
          if (key.startsWith(`${src.id}::`)) {
            quotaState.scopes[key] = failureEntry;
          }
        }
        continue;
      }

      scannedSources.add(src.id);
      for (const mId of modelsList) {
        allTargets.push({
          source: src.id,
          scope: src.id,
          upstream: src.routerAlias || src.id,
          model: mId,
          endpoint: src.endpoint,
          apiKeyEnv: src.credential?.env,
          headers: src.headers,
        });
      }
    }
  }

  const activePerUpstream =
    options.upstreamLimiter?.active || options.activePerUpstream || defaultSharedActivePerUpstream;
  const upstreamWaiters =
    options.upstreamLimiter?.waiters || options.upstreamWaiters || defaultSharedUpstreamWaiters;

  async function acquireUpstream(upstreamKey) {
    const active = activePerUpstream.get(upstreamKey) || 0;
    if (active < upstreamConcurrencyCap) {
      activePerUpstream.set(upstreamKey, active + 1);
      return;
    }
    return new Promise((resolve) => {
      if (!upstreamWaiters.has(upstreamKey)) upstreamWaiters.set(upstreamKey, []);
      upstreamWaiters.get(upstreamKey).push(resolve);
    });
  }

  function releaseUpstream(upstreamKey) {
    const waiters = upstreamWaiters.get(upstreamKey);
    if (waiters && waiters.length > 0) {
      const next = waiters.shift();
      next();
    } else {
      const active = activePerUpstream.get(upstreamKey) || 1;
      activePerUpstream.set(upstreamKey, Math.max(0, active - 1));
    }
  }

  const aliveRows = [];
  const scopeResults = new Map();
  const sourceResults = new Map();

  async function processTarget(target) {
    const upstreamKey = `${target.source}::${target.upstream}`;
    await acquireUpstream(upstreamKey);

    let result;
    try {
      let attempt = 0;
      while (attempt <= retryCount429) {
        result = await scanScope(target, { registry, ...options });
        if (result.code === QUOTA_STATUS_CODES.RATE || result.status === 429) {
          if (attempt < retryCount429) {
            attempt++;
            const retryDelay =
              result.retryAfter && result.retryAfter > Date.now()
                ? Math.min(result.retryAfter - Date.now(), maxRetryWaitMs)
                : backoffMs429 * attempt;
            if (typeof options.sleep === 'function') {
              await options.sleep(retryDelay);
            } else {
              await new Promise((r) => setTimeout(r, retryDelay));
            }
            continue;
          }
        }
        break;
      }
    } finally {
      releaseUpstream(upstreamKey);
    }

    const st = sourceStats.get(target.source);
    if (st) {
      st.scanned++;
      if (result.code === QUOTA_STATUS_CODES.OK) st.alive++;
      else if (result.code === QUOTA_STATUS_CODES.QUOTA) st.quota++;
      else if (result.code === QUOTA_STATUS_CODES.AUTH) st.auth++;
      else if (result.code === QUOTA_STATUS_CODES.REGION) st.region++;
      else if (result.code === QUOTA_STATUS_CODES.NO_CHANNEL) st.no_channel++;
      else if (result.code === QUOTA_STATUS_CODES.TIMEOUT) st.timeout++;
      else st.other++;
    }

    const modelKey = `${target.source}::${target.model}`;
    quotaState.scopes[modelKey] = result;

    const scopeKey = `${target.source}::${target.scope}`;
    if (!scopeResults.has(scopeKey)) scopeResults.set(scopeKey, []);
    scopeResults.get(scopeKey).push({ target, result });

    if (!sourceResults.has(target.source)) sourceResults.set(target.source, []);
    sourceResults.get(target.source).push({ target, result });

    if (result.code === QUOTA_STATUS_CODES.OK) {
      aliveRows.push({
        sourceId: target.source,
        scope: target.scope,
        upstream: target.upstream,
        model: target.model,
        endpoint: target.endpoint,
        elapsedMs: result.elapsedMs || 0,
        status: 'OK',
      });
    }
  }

  const overallConcurrency = requireConfiguredLimit(
    options.concurrency ?? rawDispatch.maxConcurrentProbes ?? dispatchConfig.maxConcurrentProbes,
    'maxConcurrentProbes'
  );
  let nextIdx = 0;
  const workers = Array.from(
    { length: Math.min(overallConcurrency, allTargets.length) },
    async () => {
      while (nextIdx < allTargets.length) {
        const cur = allTargets[nextIdx++];
        await processTarget(cur);
      }
    }
  );
  await Promise.all(workers);

  function aggregateScopeOutcome(items) {
    if (!items || items.length === 0) return null;
    const okItem = items.find((it) => it.result.code === QUOTA_STATUS_CODES.OK);
    if (okItem) return okItem.result;

    const priority = [
      QUOTA_STATUS_CODES.AUTH,
      QUOTA_STATUS_CODES.REGION,
      QUOTA_STATUS_CODES.QUOTA,
      QUOTA_STATUS_CODES.TIMEOUT,
      QUOTA_STATUS_CODES.NO_CHANNEL,
      QUOTA_STATUS_CODES.RATE,
    ];
    for (const code of priority) {
      const match = items.find((it) => it.result.code === code);
      if (match) return match.result;
    }
    return items[0].result;
  }

  for (const [scopeKey, items] of scopeResults.entries()) {
    quotaState.scopes[scopeKey] = aggregateScopeOutcome(items);
  }

  for (const [srcId, items] of sourceResults.entries()) {
    const agg = aggregateScopeOutcome(items);
    quotaState.scopes[srcId] = agg;
    if (
      quotaState.scopes[`${srcId}::${srcId}`] === undefined ||
      !items.some((it) => it.target.scope === srcId)
    ) {
      quotaState.scopes[`${srcId}::${srcId}`] = agg;
    }
  }

  quotaState.sourceFreshness = quotaState.sourceFreshness || {};
  for (const srcId of scannedSources) {
    if (!failedSources.has(srcId)) {
      quotaState.sourceFreshness[srcId] = new Date(now).toISOString();
    }
  }
  quotaState.updatedAt = new Date(now).toISOString();

  if (options.persist !== false) {
    saveQuotaState(quotaState, options);
  }

  let priorsApi = null;
  let livePriors = null;
  try {
    priorsApi = require('./priors');
    livePriors = priorsApi.loadPriors(options.priorsFile);
  } catch {}

  const rankedAlive = aliveRows.map((r) => {
    const wPrior =
      priorsApi && livePriors
        ? priorsApi.priorFor({ modelId: r.model }, 'writer', livePriors, now)
        : null;
    const revPrior =
      priorsApi && livePriors
        ? priorsApi.priorFor({ modelId: r.model }, 'reviewer', livePriors, now)
        : null;
    const wScore = wPrior && typeof wPrior.score === 'number' ? wPrior.score : null;
    const revScore = revPrior && typeof revPrior.score === 'number' ? revPrior.score : null;
    return {
      ...r,
      writerPrior: wScore,
      reviewerPrior: revScore,
      tier: wPrior?.tier || '—',
      evidence: wPrior?.evidence || '—',
      candidateKey: [r.sourceId, r.scope, r.model].join('\u241f'),
    };
  });

  rankedAlive.sort((a, b) => {
    const sA = a.writerPrior !== null ? a.writerPrior : -1;
    const sB = b.writerPrior !== null ? b.writerPrior : -1;
    if (sB !== sA) return sB - sA;
    return a.elapsedMs - b.elapsedMs;
  });

  if (options.jsonlFile) {
    const jsonlContent =
      allTargets
        .map((t) => {
          const res = quotaState.scopes[`${t.source}::${t.model}`] || {};
          return JSON.stringify({ target: t, result: res });
        })
        .join('\n') + '\n';
    fs.mkdirSync(path.dirname(options.jsonlFile), { recursive: true });
    fs.writeFileSync(options.jsonlFile, jsonlContent, 'utf8');
  }

  if (options.mdFile) {
    let md = `# Route Scan Summary Report\n\n`;
    md += `- **Scan Timestamp**: ${new Date(now).toISOString()}\n`;
    md += `- **Total Routes Scanned**: ${allTargets.length}\n`;
    md += `- **Total Alive (OK)**: ${aliveRows.length}\n\n`;
    md += `## 1. Per-Source Counts\n\n`;
    md += `| Source | Listed | Scanned | Alive (OK) | Quota | Auth | Region | No Channel | Timeout | Other |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
    for (const st of sourceStats.values()) {
      md += `| ${st.sourceId} | ${st.listed} | ${st.scanned} | ${st.alive} | ${st.quota} | ${st.auth} | ${st.region} | ${st.no_channel} | ${st.timeout} | ${st.other} |\n`;
    }
    md += `\n## 2. ALIVE Models Ranked by Writer Prior\n\n`;
    md += `| Rank | Model ID | Source | Writer Prior Score | Latency (ms) |\n`;
    md += `| :---: | :--- | :--- | :---: | :---: |\n`;
    rankedAlive.forEach((r, idx) => {
      const scoreStr = r.writerPrior !== null ? r.writerPrior : '—';
      md += `| ${idx + 1} | \`${r.model}\` | ${r.sourceId} | **${scoreStr}** | ${r.elapsedMs} |\n`;
    });
    fs.mkdirSync(path.dirname(options.mdFile), { recursive: true });
    fs.writeFileSync(options.mdFile, md, 'utf8');
  }

  return {
    at: quotaState.updatedAt,
    count: allTargets.length,
    aliveCount: aliveRows.length,
    blockedCount: allTargets.length - aliveRows.length,
    sourceStats: Array.from(sourceStats.values()),
    rankedAlive,
    scopes: quotaState.scopes,
    failedSources: Array.from(failedSources),
  };
}

async function syncNinerouterModelsToOpenCode(options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  const registry = options.registry || sourcesApi.loadSources?.(options.sourceOpts);
  const routerSource =
    (registry?.sources || []).find((s) => s.kind === 'router') ||
    (registry?.sources || []).find((s) => s.routerAlias);
  if (!routerSource) {
    throw new Error('SYNC_FAILED: no router source found in registry');
  }
  const source = routerSource;
  const providerKey =
    source.aliases?.[0] ||
    (source.modelPrefix ? source.modelPrefix.replace(/\/+$/, '') : source.id);

  const modelsList = await fetchSourceModels(source, options);
  if (!Array.isArray(modelsList) || modelsList.length === 0) {
    throw new Error(`SYNC_FAILED: router ${source.id} /models returned no models`);
  }

  const defaultOcPath = path.join(
    options.env?.USERPROFILE ||
      process.env.USERPROFILE ||
      options.env?.HOME ||
      process.env.HOME ||
      '',
    '.config',
    'opencode',
    'opencode.json'
  );
  const ocPath = options.opencodePath || defaultOcPath;
  if (!fs.existsSync(ocPath)) {
    throw new Error(`SYNC_FAILED: opencode.json not found at ${ocPath}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = options.backupPath || `${ocPath}.bak-${timestamp}`;
  fs.copyFileSync(ocPath, backupPath);

  const raw = fs.readFileSync(ocPath, 'utf8').replace(/^\uFEFF/, '');
  const ocConfig = JSON.parse(raw);

  if (!ocConfig.provider || typeof ocConfig.provider !== 'object') {
    ocConfig.provider = {};
  }
  if (!ocConfig.provider[providerKey] || typeof ocConfig.provider[providerKey] !== 'object') {
    ocConfig.provider[providerKey] = {
      name: source.label || source.id,
      npm: '@ai-sdk/openai-compatible',
      options: {
        baseURL: source.endpoint,
        apiKey: `{env:${source.credential?.env}}`,
      },
      models: {},
    };
  }

  const ownPrefixes = getSourcePrefixes(source);

  const newModels = {};
  for (const mId of modelsList) {
    const raw = String(mId);
    const own = ownPrefixes.find((p) => raw.startsWith(p));
    const cleanId = own ? raw.slice(own.length) : raw;
    newModels[cleanId] = { name: cleanId, id: cleanId };
  }
  ocConfig.provider[providerKey].models = newModels;

  const tempPath = `${ocPath}.tmp-${Date.now()}-${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(ocConfig, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, ocPath);

  return {
    success: true,
    modelCount: modelsList.length,
    backupPath,
    opencodePath: ocPath,
  };
}

module.exports = {
  DEFAULT_QUOTA_STATE_FILE,
  QUOTA_STATUS_CODES,
  BLOCKING_CODES,
  sanitizeStatusDescription,
  classifyQuotaResponse,
  loadQuotaState,
  saveQuotaState,
  getQuotaScopeState,
  isScopeBlocked,
  isQuotaScanDue,
  schedulePeriodicQuotaScan,
  scanScope,
  discover9RouterScopes,
  scanAllQuotas,
  scanAllFullRoutes,
  scanSourceQuotas,
  scanTargetsForSource,
  validateCompletion,
  withinSignal,
  fetchSourceModels,
  selectRepresentativeModel,
  syncNinerouterModelsToOpenCode,
};
