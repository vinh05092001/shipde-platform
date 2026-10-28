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
    // If a model-level entry was explicitly found and not blocked, model is usable
    if (activeModelEntry && !isScopeBlocked(activeModelEntry, now, opts)) {
      const source = scopes[sid] || null;
      return { source, upstream: activeModelEntry, blocked: null };
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

async function discover9RouterScopes(source, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  const apiKey = (options.env || process.env)[source.credential?.env] || '';
  const endpoint = String(source.endpoint || '').replace(/\/+$/, '');
  const url = `${endpoint}/models`;

  const headers = {};
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
  let modelsList = [];

  try {
    const fetchPromise = (async () => {
      const res = await fetchFn(url, { method: 'GET', headers, signal: controller.signal });
      if (res.ok) {
        let data;
        if (typeof res.json === 'function') {
          data = await res.json();
        } else {
          const raw = await res.text();
          data = JSON.parse(raw);
        }
        if (controller.signal.aborted) {
          throw new Error('Request timed out');
        }
        if (Array.isArray(data?.data)) {
          return data.data.map((m) => m.id || m.model || m).filter(Boolean);
        }
      }
      return [];
    })();

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const err = new Error('Request timed out');
        err.name = 'AbortError';
        reject(err);
      }, timeoutMs);
    });

    modelsList = await Promise.race([fetchPromise, timeoutPromise]);
  } catch {
    // Timeout or fetch error falls through to live catalogue fallback
  } finally {
    clearTimeout(timer);
  }

  const parsePrefixedGroups = (list) => {
    const map = new Map();
    const ownPrefixes = [source.id, source.routerAlias, 'ninerouter', '9router']
      .filter(Boolean)
      .map((p) => `${p}/`);
    for (const mId of list) {
      const raw = String(mId);
      const own = ownPrefixes.find((p) => raw.startsWith(p));
      const cleanId = own ? raw.slice(own.length) : raw;
      const prefixMatch = cleanId.match(/^([A-Za-z0-9_-]+)\//);
      if (!prefixMatch) continue;
      const prefix = prefixMatch[1];
      if (!map.has(prefix)) {
        map.set(prefix, cleanId);
      }
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
    const sourceId = source.id || '9router';
    const matching = candidates.filter((c) => {
      if (typeof c === 'string') return true;
      if (!c) return false;
      if (c.sourceIds && Array.isArray(c.sourceIds) && c.sourceIds.includes(sourceId)) return true;
      if (c.gateway === sourceId || c.accessPath === sourceId) return true;
      return false;
    });
    const candidatePool = matching.length > 0 ? matching : sourceId === '9router' ? candidates : [];
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

    if (src.kind === 'router' || src.id === '9router') {
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
      let repModel = (Array.isArray(src.models) && src.models[0]) || src.verify?.model || null;
      if (!repModel && options.catalogue) {
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

      if (!repModel) {
        const existing = quotaState.scopes[src.id] || quotaState.scopes[`${src.id}::${src.id}`];
        if (existing && BLOCKING_CODES.has(existing.code) && isScopeBlocked(existing, now)) {
          continue;
        }
        const unscannableEntry = {
          source: src.id,
          scope: src.id,
          upstream: src.routerAlias || src.id,
          model: null,
          code: QUOTA_STATUS_CODES.UNSCANNABLE,
          status: null,
          reason: 'UNSCANNABLE',
          at: new Date(now).toISOString(),
          retryAfter: null,
        };
        quotaState.scopes[`${src.id}::${src.id}`] = unscannableEntry;
        quotaState.scopes[src.id] = unscannableEntry;
        // No quota evidence was gathered, so the source is not marked fresh and the next due
        // check retries it. UNSCANNABLE stays non-blocking: absence of a probe target is the
        // same as an unscanned source, which routing already treats as unproven.
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
  const intervalMin = requireConfiguredLimit(
    options.intervalMin ?? dispatchConfig.quotaScanIntervalMin,
    'quotaScanIntervalMin'
  );
  const intervalMs = intervalMin * 60 * 1000;

  let initialPromise = null;
  if (options.initialScan !== false) {
    initialPromise = (async () => {
      try {
        return await scanAllQuotas(options);
      } catch (err) {
        if (typeof options.onError === 'function') options.onError(err);
      }
    })();
  }

  const timer = setInterval(async () => {
    try {
      await scanAllQuotas(options);
    } catch (err) {
      if (typeof options.onError === 'function') options.onError(err);
    }
  }, intervalMs);

  if (options.unref && timer.unref) timer.unref();
  return {
    timer,
    intervalMin,
    intervalMs,
    initialPromise,
    stop: () => clearInterval(timer),
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
  const hasText =
    (typeof content === 'string' && content.trim().length > 0) ||
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
  scanSourceQuotas,
  scanTargetsForSource,
  validateCompletion,
  withinSignal,
};
