'use strict';

// Durable, path-scoped model health. A failed route is parked, never deleted;
// callers can keep alternate routes for the same normalized model eligible.
const fs = require('fs');
const path = require('path');
const sourcesApi = require('./sources');
const { atomicRenameSync } = require('./atomic-rename');
const { candidateKey } = require('./discovery/identity');
const { CLASSIFIER_VERSION } = require('./route-probe');
const PROBE_BODY_LIMIT = 500;

const BACKOFF_MS = [30 * 60e3, 2 * 60 * 60e3, 6 * 60 * 60e3, 24 * 60 * 60e3];

const GENUINE_STATUSES = new Set([
  'AVAILABLE',
  'GEO_BLOCKED',
  'AUTH_NEEDED',
  'NO_CREDIT',
  'UPSTREAM_CREDIT_OR_QUOTA',
  'RATE_LIMITED',
  'UPSTREAM_FORBIDDEN',
  'PROVIDER_UNAVAILABLE',
  'ENTITLEMENT_REQUIRED',
  'ALIAS_MISMATCH',
]);

const GENUINE_HTTP_STATUSES = new Set([401, 402, 403, 429, 451]);

function isLegacyUnverified(record) {
  if (!record || typeof record !== 'object') return false;
  if (Number(record.classifierVersion) >= (CLASSIFIER_VERSION || 2)) return false;
  if (record.status === 'AVAILABLE') return false;
  if (GENUINE_STATUSES.has(record.status)) return false;
  if (record.httpStatus && GENUINE_HTTP_STATUSES.has(Number(record.httpStatus))) return false;
  if (record.probeCause) {
    const cause = String(record.probeCause).toUpperCase();
    for (const genuine of GENUINE_STATUSES) {
      if (cause.includes(genuine)) return false;
    }
  }
  if (
    record.status === 'UNAVAILABLE_NOW' ||
    /TIMEOUT|PROBE_NO_RESPONSE|PROBE_EXCEPTION|PROBE_FAILED/i.test(String(record.probeCause || ''))
  ) {
    return true;
  }
  return false;
}

/**
 * Route health is kept per routed model id: the upstream prefix (ag/, zd/,
 * cl/ ...) is a different provider with its own failures. Live 17/10: a
 * GEO_BLOCKED from one upstream blocked ag/gemini-3.8-flash, which answered.
 */
function routeModelKey(value, routeId) {
  const id = String(value || '')
    .trim()
    .toLowerCase();
  const route = String(routeId || '').toLowerCase();
  // A prefix that names the route itself is redundant (ag/x on route ag).
  return route && id.startsWith(route + '/') ? id.slice(route.length + 1) : id;
}

function normalizeModelId(value) {
  let id = String(value || '')
    .trim()
    .toLowerCase();
  while (/^(?:ag|antigravity|zd|cl|kc|bzl|bpm|alims-intl)\//.test(id)) {
    id = id.slice(id.indexOf('/') + 1);
  }
  return id;
}

function classifyFailure(status, message) {
  const s = Number(status || 0);
  const text = String(message || '').toLowerCase();
  if (s === 451 || /geo.?block|unavailable in your location/.test(text)) return 'GEO_BLOCKED';
  if (s === 402 || /no.?credit|payment required|insufficient credit/.test(text)) return 'NO_CREDIT';
  if (s === 429 || /rate.?limit|too many requests/.test(text)) return 'RATE_LIMITED';
  if (s === 401 || (s === 403 && !/unsupported model|model not found/.test(text)))
    return 'AUTH_NEEDED';
  if (s === 404 || /unsupported model|model not found/.test(text)) return 'UNSUPPORTED';
  return 'UNAVAILABLE_NOW';
}

function loadStore(file, options) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data && data.version === 1 && data.paths) return data;
    throw new Error('invalid model route health store');
  } catch (error) {
    if (options && options.allowMissing === true && error && error.code === 'ENOENT')
      return { version: 1, paths: {}, events: [] };
    throw new Error('cannot load model route health store: ' + file, { cause: error });
  }
}

function saveStore(file, store, options) {
  const fsApi = (options && options.fs) || fs;
  fsApi.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fsApi.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n');
  atomicRenameSync(tmp, file, Object.assign({}, options, { fs: fsApi }));
}

function dueAt(record, now) {
  return (
    record &&
    Number.isFinite(Date.parse(record.nextCheckAt)) &&
    Date.parse(record.nextCheckAt) <= now
  );
}

// Missing transport evidence is not evidence that a provider refused the route.
function isUnverifiedProbe(result) {
  if (result?.ok || Number(result?.status) > 0 || result?.cause || result?.reasonCode) return false;
  const cause = require('./route-probe').classifyProbeFailure({
    ...result,
    body: result?.body || result?.message || result?.error,
  });
  return cause === 'PROBE_NO_RESPONSE';
}

function unverifiedRecord(record) {
  return Boolean(
    record &&
    (record.status === 'PROBE_NO_RESPONSE' ||
      (record.status === 'UNAVAILABLE_NOW' && !record.httpStatus && !record.probeCause))
  );
}

function recordUnknownProbe(modelId, routeId, result, now, options) {
  const o = options || {};
  if (!o.decisionDir) return;
  const decisions = require('./decisions');
  const redact = decisions.createSecretRedactor({ ...process.env, ...o.env });
  decisions.recordDecision(
    {
      stage: decisions.Stage.WARNING,
      workItemId: o.workItemId,
      modelId,
      routeId,
      cause: o.cause || 'PROBE_NO_RESPONSE',
      probeResult: {
        ok: result?.ok ?? null,
        status: result?.status ?? null,
        elapsedMs: Number.isFinite(result?.elapsedMs) ? result.elapsedMs : null,
        body: redact(String(result?.body || result?.message || result?.error || '')).slice(
          0,
          PROBE_BODY_LIMIT
        ),
      },
    },
    { dir: o.decisionDir, now }
  );
}

function recordResult(store, modelId, routeId, result, now, options) {
  const key = healthKey(modelId, routeId);
  const previous = store.paths[key] || { failures: 0 };
  const lastCheckedAt = new Date(now).toISOString();
  if (result && result.ok) {
    store.paths[key] = {
      modelId: String(modelId),
      normalizedModelId: normalizeModelId(modelId),
      routeId,
      status: 'AVAILABLE',
      failures: previous.failures || 0,
      lastCheckedAt,
      nextCheckAt: null,
      classifierVersion: CLASSIFIER_VERSION || 2,
      ...(Number.isFinite(result && result.elapsedMs)
        ? { elapsedMs: result.elapsedMs }
        : Number.isFinite(previous.elapsedMs)
          ? { elapsedMs: previous.elapsedMs }
          : {}),
    };
    if (previous.status && previous.status !== 'AVAILABLE')
      store.events.push({
        type: 'route_restored',
        modelId: normalizeModelId(modelId),
        routeId,
        at: lastCheckedAt,
      });
    return { key, eligible: true };
  }
  const status = Number(result && result.status) || 0;
  const unverified = isUnverifiedProbe(result);
  const reason = unverified
    ? 'PROBE_NO_RESPONSE'
    : classifyFailure(status, result && (result.message || result.error));
  const failures = unverified ? previous.failures : previous.failures + 1;
  const explicit = result && (result.resetAt || result.retryAt);
  let delay = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
  if (reason === 'GEO_BLOCKED' || reason === 'AUTH_NEEDED') delay = 24 * 60 * 60e3;
  const operatorChange =
    result && (result.networkChanged === true || result.credentialsChanged === true);
  const nextCheck =
    unverified || operatorChange ? now : explicit ? Date.parse(explicit) : now + delay;
  store.paths[key] = {
    modelId: String(modelId),
    normalizedModelId: normalizeModelId(modelId),
    routeId,
    status: reason,
    httpStatus: status,
    failures,
    lastCheckedAt,
    nextCheckAt: new Date(Number.isFinite(nextCheck) ? nextCheck : now + delay).toISOString(),
    classifierVersion: CLASSIFIER_VERSION || 2,
    ...(Number.isFinite(result && result.elapsedMs)
      ? { elapsedMs: result.elapsedMs }
      : Number.isFinite(previous.elapsedMs)
        ? { elapsedMs: previous.elapsedMs }
        : {}),
  };
  // Due refreshes must retain the same cause-based policy as live preflight.
  // Every failed probe leaves its redacted raw result (and duration when
  // known) in the run decision log, so a recorded cause can be checked
  // against what the route actually answered.
  recordUnknownProbe(modelId, routeId, result, now, { ...options, cause: reason });
  if (unverified) {
    store.paths[key].probeCause = reason;
  } else if (previous.probeCause) {
    const cause = require('./route-probe').classifyProbeFailure({
      ...result,
      body: result && (result.body || result.message || result.error),
    });
    store.paths[key].candidateKey = previous.candidateKey;
    store.paths[key].probeCause = require('./route-probe').failureReason(cause);
    store.paths[key].nextCheckAt = new Date(now + probeCooldownMs(cause)).toISOString();
  }
  store.events.push({
    type: 'route_parked',
    modelId: normalizeModelId(modelId),
    routeId,
    reason,
    at: lastCheckedAt,
  });
  if (reason === 'AUTH_NEEDED') {
    store.events.push({
      type: 'operator_action_required',
      modelId: normalizeModelId(modelId),
      routeId,
      action: 'check_account_authentication',
      at: lastCheckedAt,
    });
  }
  return { key, eligible: false, reason };
}

function probeMemoryFile(o) {
  const opts = o || {};
  return (
    opts.routeHealthFile ||
    opts['route-health'] ||
    (opts.cwd || opts.root
      ? path.join(opts.cwd || opts.root, 'tools', 'ai-brain', 'data', 'model-route-health.json')
      : null) ||
    path.join(__dirname, 'data', 'model-route-health.json')
  );
}
function probeIdentity(c) {
  return {
    model: String(c.modelId || c.model || '').replace(/^ninerouter\//i, ''),
    route: { id: c.gateway || c.sourceId || c.source, accountId: c.accountId },
  };
}

// Stable partition of ranked routes; health changes probe order, never scores.
function orderProbeRoutes(ranked, options) {
  const o = options || {};
  const store = o.routeHealth || loadStore(probeMemoryFile(o), { allowMissing: true });
  const now = o.now ?? Date.now();
  const live = [],
    unknown = [],
    failed = [];
  for (const candidate of ranked) {
    const identity = probeIdentity(candidate);
    const record = getPathRecord(store, identity.model, identity.route);
    if (require('./probe-order').recentRouteSuccess(candidate, store, { ...o, now }))
      live.push(candidate);
    else if (
      !record ||
      record.status === 'AVAILABLE' ||
      unverifiedRecord(record) ||
      isLegacyUnverified(record)
    )
      unknown.push(candidate);
    else failed.push(candidate);
  }
  return [...live, ...unknown, ...failed];
}

function extractProvider(modelId) {
  const stripped = String(modelId || '')
    .trim()
    .replace(/^ninerouter\//i, '')
    .replace(/^\/+/, '');
  const slash = stripped.indexOf('/');
  return slash > 0 ? stripped.slice(0, slash) : '';
}

function setProviderRecord(store, gateway, provider, entry) {
  if (!store.providers) store.providers = {};
  const g = String(gateway || '')
    .toLowerCase()
    .trim();
  const p = String(provider || '')
    .toLowerCase()
    .trim();
  const rawG = String(gateway || '').trim();
  const rawP = String(provider || '').trim();
  const keys = new Set([
    `${g}:${p}`,
    `${g}|${p}`,
    `${g}/${p}`,
    `${g}+${p}`,
    `${g}${p}`,
    `${rawG}:${rawP}`,
    `${rawG}|${rawP}`,
    `${rawG}/${rawP}`,
    `${rawG}+${rawP}`,
    `${rawG}${rawP}`,
  ]);
  for (const k of keys) {
    store.providers[k] = entry;
  }
}

function deleteProviderRecord(store, gateway, provider) {
  if (!store || !store.providers) return;
  const g = String(gateway || '')
    .toLowerCase()
    .trim();
  const p = String(provider || '')
    .toLowerCase()
    .trim();
  const rawG = String(gateway || '').trim();
  const rawP = String(provider || '').trim();
  const keys = [
    `${g}:${p}`,
    `${g}|${p}`,
    `${g}/${p}`,
    `${g}+${p}`,
    `${g}${p}`,
    `${rawG}:${rawP}`,
    `${rawG}|${rawP}`,
    `${rawG}/${rawP}`,
    `${rawG}+${rawP}`,
    `${rawG}${rawP}`,
  ];
  for (const k of keys) {
    delete store.providers[k];
  }
}

function getProviderRecord(store, gateway, provider) {
  if (!store || !store.providers) return null;
  const g = String(gateway || '')
    .toLowerCase()
    .trim();
  const p = String(provider || '')
    .toLowerCase()
    .trim();
  const rawG = String(gateway || '').trim();
  const rawP = String(provider || '').trim();
  return (
    store.providers[`${g}:${p}`] ||
    store.providers[`${g}|${p}`] ||
    store.providers[`${g}/${p}`] ||
    store.providers[`${g}+${p}`] ||
    store.providers[`${g}${p}`] ||
    store.providers[`${rawG}:${rawP}`] ||
    store.providers[`${rawG}|${rawP}`] ||
    store.providers[`${rawG}/${rawP}`] ||
    store.providers[`${rawG}+${rawP}`] ||
    store.providers[`${rawG}${rawP}`] ||
    null
  );
}

function extractAccountKey(candidate, options) {
  if (!candidate) return null;
  const key =
    typeof candidate === 'string'
      ? candidate
      : candidate.candidateKey ||
        (candidate.identity && candidate.identity.candidateKey) ||
        (typeof candidateKey === 'function' ? candidateKey(candidate) : '');
  if (key && typeof key === 'string' && key.includes('::')) {
    const fields = key.split('::');
    if (fields.length >= 4) {
      let base = (fields[1] || '').replace(/\/+$/, '');
      if (
        (base === 'cli' || !base.startsWith('http')) &&
        options &&
        options.registry &&
        options.registry.sources
      ) {
        const src = options.registry.sources.find((s) => s.id === fields[2] || s.id === fields[3]);
        if (src && (src.endpoint || src.accessPath)) {
          base = (src.accessPath || src.endpoint).replace(/\/+$/, '');
        }
      }
      if (base === 'http://127.0.0.1:20128/v1' && fields[4]) {
        return `${fields[2]}::${fields[3]}::${fields[4]}`;
      }
      return `${fields[2]}::${fields[3]}`;
    }
  }
  const base = (candidate.accessPath || candidate.endpoint || '').replace(/\/+$/, '');
  const gw = candidate.gateway || candidate.sourceId || candidate.source || '';
  const up = candidate.upstream || '';
  const acc = candidate.account !== undefined ? candidate.account : candidate.accountId || '';
  if (base === 'http://127.0.0.1:20128/v1' && acc) {
    return `${gw}::${up}::${acc}`;
  }
  return `${gw}::${up}`;
}

function setAccountRecord(store, account, entry) {
  if (!store.accounts) store.accounts = {};
  store.accounts[account] = entry;
}

function getAccountRecord(store, account) {
  if (!store || !store.accounts || !account) return null;
  return store.accounts[account] || null;
}

function deleteAccountRecord(store, account) {
  if (!store || !store.accounts || !account) return;
  delete store.accounts[account];
}

function rememberAccountCooldown(candidate, cause, expiryIso, options) {
  const o = options || {};
  const file = probeMemoryFile(o);
  const store = o.routeHealth || loadStore(file, { allowMissing: true });
  const now = o.now ?? Date.now();
  const account = extractAccountKey(candidate, o);
  if (!account) return null;
  const causeStr =
    typeof cause === 'string'
      ? cause
      : (cause && (cause.reason || cause.reasonCode)) || 'ACCOUNT_COOLDOWN';
  const nextCheckAt = expiryIso || new Date(now + probeCooldownMs(causeStr)).toISOString();
  const record = {
    account,
    status: causeStr,
    probeCause: causeStr,
    lastCheckedAt: new Date(now).toISOString(),
    nextCheckAt,
  };
  setAccountRecord(store, account, record);
  if (o.persistRouteHealth !== false) saveStore(file, store, o);
  return record;
}

function probeCooldown(candidate, options) {
  const o = options || {};
  if (candidate.harness === 'agy-pool') return null;
  const store = o.routeHealth || loadStore(probeMemoryFile(o), { allowMissing: true });
  const now = o.now ?? Date.now();
  const identity = probeIdentity(candidate);
  const gateway = identity.route?.id || candidate.gateway || candidate.sourceId || candidate.source;
  const provider = extractProvider(identity.model);
  if (gateway && provider) {
    const providerRecord = getProviderRecord(store, gateway, provider);
    if (
      providerRecord &&
      providerRecord.nextCheckAt &&
      Date.parse(providerRecord.nextCheckAt) > now
    ) {
      return `PROBE_COOLDOWN: PROVIDER_UNAVAILABLE until ${providerRecord.nextCheckAt}`;
    }
  }
  const account = extractAccountKey(candidate, o);
  if (account && store.accounts && store.accounts[account]) {
    const accountRecord = store.accounts[account];
    if (accountRecord && accountRecord.nextCheckAt && Date.parse(accountRecord.nextCheckAt) > now) {
      return `PROBE_COOLDOWN_ACCOUNT: ${account} until ${accountRecord.nextCheckAt}`;
    }
  }
  const record = getPathRecord(store, identity.model, identity.route);
  if (!record || !record.probeCause || record.status === 'AVAILABLE' || unverifiedRecord(record))
    return null;
  if (Date.parse(record.nextCheckAt) <= now) return null;
  return `PROBE_COOLDOWN: ${record.probeCause} until ${record.nextCheckAt}`;
}

function probeCooldownMs(cause) {
  const causeStr =
    typeof cause === 'object' && cause !== null
      ? cause.reason || cause.reasonCode || ''
      : String(cause || '');
  const hours =
    /PROVIDER_UNAVAILABLE|CREDIT|QUOTA|ENTITLEMENT|AUTH|FORBIDDEN|HTTP_40[123]|RATE_LIMITED/i.test(
      causeStr
    )
      ? 6
      : /HTTP_404|ALIAS|GEO_BLOCKED/i.test(causeStr)
        ? 24
        : 0.5;
  return hours * 3600000;
}

/** Keep the learned per-minute token limit and the largest request it refused. */
function applyTpmEvidence(record, evidence) {
  if (!evidence) return;
  if (evidence.tokensPerMinuteLimit > 0)
    record.tokensPerMinuteLimit = evidence.tokensPerMinuteLimit;
  if (evidence.requestedTokens > 0)
    record.requestedTokens = Math.max(record.requestedTokens || 0, evidence.requestedTokens);
}

/** Record a real launch's TPM 413 so the next selection can refuse the route. */
function rememberLaunchTpm(candidate, text, options) {
  const o = options || {};
  const evidence = require('./route-probe').tokenLimitEvidence(null, text);
  if (!evidence.tokensPerMinuteLimit && !evidence.requestedTokens) return null;
  const file = probeMemoryFile(o);
  const store = o.routeHealth || loadStore(file, { allowMissing: true });
  const identity = probeIdentity(candidate);
  const record = getPathRecord(store, identity.model, identity.route);
  if (!record) return null;
  applyTpmEvidence(record, evidence);
  if (o.persistRouteHealth !== false) saveStore(file, store, o);
  return record;
}

/** ROUTE_TPM_TOO_SMALL when the known limit is below a request it already refused. */
function tpmTooSmall(candidate, options) {
  const o = options || {};
  const store = o.routeHealth || loadStore(probeMemoryFile(o), { allowMissing: true });
  const identity = probeIdentity(candidate);
  const record = getPathRecord(store, identity.model, identity.route);
  if (!record || !(record.tokensPerMinuteLimit > 0) || !(record.requestedTokens > 0)) return null;
  return record.tokensPerMinuteLimit < record.requestedTokens
    ? `ROUTE_TPM_TOO_SMALL: limit ${record.tokensPerMinuteLimit} < request ${record.requestedTokens}`
    : null;
}

const CONTEXT_OVERFLOW_PATTERN =
  /context[ _]length[ _]exceeded|maximum context length|exceeds? (?:the )?(?:model'?s? )?(?:maximum )?context (?:window|length)|too many tokens|prompt is too long|context_length_exceeded/i;

/** Context overflow is a per-request size failure, distinct from the per-minute TPM 413. */
function contextOverflowEvidence(text) {
  const body = String(text || '');
  if (!CONTEXT_OVERFLOW_PATTERN.test(body)) return null;
  if (/tokens per minute/i.test(body)) return null;
  const limit =
    body.match(/maximum context length(?: is|:)?\s*(\d[\d,]*)/i) ||
    body.match(/context (?:window|length) (?:is|of|:)\s*(\d[\d,]*)/i) ||
    body.match(/limit(?: is|:)?\s*(\d[\d,]*) tokens/i);
  const observed = limit ? Number(limit[1].replace(/,/g, '')) : undefined;
  return { observedContextLimit: observed > 0 ? observed : undefined };
}

/** Record a launch that failed because the request exceeded the model context. */
function rememberLaunchContextOverflow(candidate, text, options) {
  const o = options || {};
  const evidence = contextOverflowEvidence(text);
  if (!evidence) return null;
  const file = probeMemoryFile(o);
  const store = o.routeHealth || loadStore(file, { allowMissing: true });
  const identity = probeIdentity(candidate);
  const record = getPathRecord(store, identity.model, identity.route);
  if (!record) return null;
  record.contextOverflowObserved = true;
  if (evidence.observedContextLimit) record.observedContextLimit = evidence.observedContextLimit;
  if (o.persistRouteHealth !== false) saveStore(file, store, o);
  return record;
}

/** CONTEXT_OVERFLOW_OBSERVED when a real launch already overflowed this model's context. */
function contextOverflowObserved(candidate, options) {
  const o = options || {};
  const store = o.routeHealth || loadStore(probeMemoryFile(o), { allowMissing: true });
  const identity = probeIdentity(candidate);
  const record = getPathRecord(store, identity.model, identity.route);
  if (!record || !record.contextOverflowObserved) return null;
  return record.observedContextLimit
    ? `CONTEXT_OVERFLOW_OBSERVED: context limit ${record.observedContextLimit}`
    : 'CONTEXT_OVERFLOW_OBSERVED';
}

function rememberProbe(candidate, result, options) {
  const o = options || {};
  const cause = result && result.ok ? null : require('./route-probe').classifyProbeFailure(result);
  if (cause === 'PROBE_BUDGET_EXHAUSTED' || cause === 'PROBE_ROUTE_CONFIGURATION_UNAVAILABLE')
    return;
  const file = probeMemoryFile(o);
  const store = o.routeHealth || loadStore(file, { allowMissing: true });
  const identity = probeIdentity(candidate);
  const now = o.now ?? Date.now();
  const recorded = recordResult(
    store,
    identity.model,
    identity.route,
    { ...result, message: result?.body || result?.message || result?.error },
    now,
    o
  );
  const record = store.paths[recorded.key];
  record.candidateKey = candidate.candidateKey || null;
  const causeCode =
    typeof cause === 'object' && cause !== null ? cause.reason || cause.reasonCode : cause;
  record.probeCause = causeCode;
  applyTpmEvidence(record, result);
  if (cause && !isUnverifiedProbe(result)) {
    record.nextCheckAt = new Date(now + probeCooldownMs(cause)).toISOString();
  }
  const gateway = identity.route?.id || candidate.gateway || candidate.sourceId || candidate.source;
  const provider =
    (typeof cause === 'object' && cause?.provider) || extractProvider(identity.model);
  if (result && result.ok) {
    if (gateway && provider && store.providers) {
      deleteProviderRecord(store, gateway, provider);
    }
    const acc = extractAccountKey(candidate, o);
    if (acc && store.accounts) {
      deleteAccountRecord(store, acc);
    }
  } else if (causeCode === 'PROVIDER_UNAVAILABLE' && (!result || result.status !== 0)) {
    if (gateway && provider) {
      record.status = 'PROVIDER_UNAVAILABLE';
      setProviderRecord(store, gateway, provider, {
        gateway,
        provider,
        status: 'PROVIDER_UNAVAILABLE',
        probeCause: 'PROVIDER_UNAVAILABLE',
        lastCheckedAt: new Date(now).toISOString(),
        nextCheckAt: new Date(now + 6 * 3600000).toISOString(),
      });
    }
  }

  const rawCause =
    result && (result.cause || result.reasonCode || (typeof cause === 'string' ? cause : ''));
  const bodyText = String((result && (result.body || result.message)) || '');
  let matchedAccountCause = null;
  const targetCauses = [
    'upstream_credit_exhausted',
    'quota_exhausted',
    'account_auth_failed',
    'upstream_entitlement',
  ];
  for (const tc of targetCauses) {
    if (rawCause === tc || new RegExp(`\\b${tc}\\b`, 'i').test(bodyText)) {
      matchedAccountCause = tc;
      break;
    }
  }
  if (matchedAccountCause && (!result || result.status !== 0)) {
    const account = extractAccountKey(candidate, o);
    if (account) {
      const expiryIso =
        record.nextCheckAt || new Date(now + probeCooldownMs(matchedAccountCause)).toISOString();
      setAccountRecord(store, account, {
        account,
        status: matchedAccountCause,
        probeCause: matchedAccountCause,
        lastCheckedAt: new Date(now).toISOString(),
        nextCheckAt: expiryIso,
      });
    }
  }

  if (o.persistRouteHealth !== false) saveStore(file, store, o);
  return record;
}

function healthKey(modelId, routeId) {
  const pathId =
    routeId && typeof routeId === 'object'
      ? String(routeId.id) + (routeId.accountId ? '@' + routeId.accountId : '')
      : String(routeId);
  const routeName = routeId && typeof routeId === 'object' ? routeId.id : routeId;
  return routeModelKey(modelId, routeName) + '|' + pathId;
}

function isDue(store, modelId, routeId, now) {
  const record = getPathRecord(store, modelId, routeId);
  return Boolean(
    record &&
    record.status !== 'AVAILABLE' &&
    (unverifiedRecord(record) || dueAt(record, Number(now) || Date.now()))
  );
}

function getPathRecord(store, modelId, routeId) {
  if (!store || !store.paths) return undefined;
  const pathId =
    routeId && typeof routeId === 'object'
      ? String(routeId.id) + (routeId.accountId ? '@' + routeId.accountId : '')
      : String(routeId);
  const rawKey = String(modelId) + '|' + pathId;
  if (store.paths[rawKey]) return store.paths[rawKey];
  const exact = store.paths[healthKey(modelId, routeId)];
  if (exact) return exact;
  if (routeId && typeof routeId === 'object' && routeId.accountId) {
    const gatewayRecord =
      store.paths[String(modelId) + '|' + routeId.id] ||
      store.paths[healthKey(modelId, routeId.id)];
    if (gatewayRecord) return gatewayRecord;
  }
  const id = routeId && typeof routeId === 'object' ? String(routeId.id) : String(routeId);
  const prefix = routeModelKey(modelId, id) + '|' + id + '@';
  const rawPrefix = String(modelId) + '|' + id + '@';
  const related = Object.entries(store.paths).filter(
    ([key]) => key.startsWith(prefix) || key.startsWith(rawPrefix)
  );
  if (routeId && typeof routeId === 'object' && routeId.accountId)
    return related.find(
      ([key]) => key === prefix + routeId.accountId || key === rawPrefix + routeId.accountId
    )?.[1];
  return undefined;
}

function isEligible(store, modelId, routeId, now) {
  const gateway = routeId && typeof routeId === 'object' ? routeId.id : routeId;
  const provider = extractProvider(modelId);
  if (gateway && provider) {
    const providerRecord = getProviderRecord(store, gateway, provider);
    if (
      providerRecord &&
      providerRecord.nextCheckAt &&
      Date.parse(providerRecord.nextCheckAt) > (now ?? Date.now())
    ) {
      return false;
    }
  }
  const record = getPathRecord(store, modelId, routeId);
  if (record)
    return (
      record.status === 'AVAILABLE' ||
      unverifiedRecord(record) ||
      Boolean(record.probeCause && dueAt(record, now ?? Date.now())) ||
      isLegacyUnverified(record)
    );
  if (routeId && typeof routeId === 'object' && routeId.accountId) return false;
  const id = routeId && typeof routeId === 'object' ? routeId.id : routeId;
  const accountRows = Object.entries(store.paths || {}).filter(([key]) =>
    key.startsWith(routeModelKey(modelId, id) + '|' + id + '@')
  );
  return accountRows.length === 1 && accountRows[0][1].status === 'AVAILABLE';
}

function isRouteHealthy(store, modelId, routeId) {
  const gateway = routeId && typeof routeId === 'object' ? routeId.id : routeId;
  const provider = extractProvider(modelId);
  if (gateway && provider) {
    const providerRecord = getProviderRecord(store, gateway, provider);
    if (
      providerRecord &&
      providerRecord.nextCheckAt &&
      Date.parse(providerRecord.nextCheckAt) > Date.now()
    ) {
      return false;
    }
  }
  const exact = store.paths[healthKey(modelId, routeId)];
  if (exact) return exact.status === 'AVAILABLE';
  const id = routeId && typeof routeId === 'object' ? routeId.id : routeId;
  const rows = Object.entries(store.paths || {}).filter(([key]) =>
    key.startsWith(routeModelKey(modelId, id) + '|' + id + '@')
  );
  return Boolean(rows.length === 1 && rows[0][1].status === 'AVAILABLE');
}

function hasProbeEvidence(store, modelId, routeId, options) {
  return Boolean(
    getPathRecord(store, modelId, routeId) ||
    (options && options.probeEvidence && options.probeEvidence(modelId, routeId.id || routeId))
  );
}

function isSelectable(store, modelId, routeId, now) {
  const gateway = routeId && typeof routeId === 'object' ? routeId.id : routeId;
  const provider = extractProvider(modelId);
  if (gateway && provider) {
    const providerRecord = getProviderRecord(store, gateway, provider);
    if (
      providerRecord &&
      providerRecord.nextCheckAt &&
      Date.parse(providerRecord.nextCheckAt) > (now ?? Date.now())
    ) {
      return false;
    }
  }
  const record = getPathRecord(store, modelId, routeId);
  return (
    !record ||
    record.status === 'AVAILABLE' ||
    unverifiedRecord(record) ||
    isLegacyUnverified(record)
  );
}

async function routeFallback(modelId, failedPath, paths, probe, store, options) {
  const o = options || {};
  const now = Number(o.now) || Date.now();
  const failedRecord = getPathRecord(store, modelId, failedPath);
  const failureReason =
    o.failureReason || (failedRecord && failedRecord.status) || 'UNAVAILABLE_NOW';
  const retryFailedPath =
    failureReason === 'UNAVAILABLE_NOW' &&
    failedRecord &&
    failedRecord.status === 'UNAVAILABLE_NOW' &&
    !isEligible(store, modelId, failedPath, now);
  const failedAccountId = failedRecord && failedRecord.routeId && failedRecord.routeId.accountId;
  const sameGatewayAccounts =
    failureReason === 'AUTH_NEEDED' && failedAccountId
      ? (paths || []).filter(
          (route) =>
            route &&
            route.id === failedRecord.routeId.id &&
            route.accountId &&
            route.accountId !== failedAccountId
        )
      : [];
  const ordered = (paths || [])
    .filter((p) => p && (p.id !== failedPath || retryFailedPath || Boolean(p.accountId)))
    .slice();
  ordered.sort((a, b) => Number(b.evidence || 0) - Number(a.evidence || 0));
  if (sameGatewayAccounts.length) {
    const otherPaths = ordered.filter((route) => !sameGatewayAccounts.includes(route));
    ordered.splice(0, ordered.length, ...sameGatewayAccounts, ...otherPaths);
  }
  const failures = [];
  for (const route of ordered) {
    const accountPath = route;
    if (route.id === failedPath && route.accountId && failedAccountId === route.accountId) {
      failures.push({ path: route.id, reason: failedRecord && failedRecord.status });
      continue;
    }
    if (route.id === failedPath && failedRecord && !failedAccountId) {
      failures.push({ path: route.id, reason: failedRecord.status });
      continue;
    }
    if (!isSelectable(store, modelId, accountPath, now)) {
      failures.push({
        path: route.id,
        reason: getPathRecord(store, modelId, accountPath)?.status,
      });
      continue;
    }
    if (route.geoBlocked === true) {
      failures.push({ path: route.id, reason: 'GEO_BLOCKED' });
      continue;
    }
    let result;
    const attempts = 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        result = await probe(modelId, route, {
          attempt,
          backoffMs: attempt ? (o.retryBackoffMs ?? 1000) : 0,
        });
      } catch (error) {
        result = { ok: false, error: String(error) };
      }
      if (result && result.ok) break;
      const retryReason = classifyFailure(
        result && result.status,
        result && (result.message || result.error)
      );
      if (attempt !== 0 || retryReason !== 'UNAVAILABLE_NOW') break;
      if (o.sleep) await o.sleep(o.retryBackoffMs ?? 1000);
      else await new Promise((resolve) => setTimeout(resolve, o.retryBackoffMs ?? 1000));
    }
    const recorded = recordResult(
      store,
      modelId,
      route.accountId ? { id: route.id, accountId: route.accountId } : route.id,
      result,
      now,
      o
    );
    if (recorded.eligible) {
      store.events.push({
        type: 'route_fallback',
        modelId: normalizeModelId(modelId),
        failedPath,
        reason: failureReason,
        chosenPath: route.id,
        at: new Date(now).toISOString(),
      });
      return { ok: true, route, failures, failedPath, reason: failureReason };
    }
    failures.push({ path: route.id, reason: recorded.reason });
  }
  if (failedRecord) failures.unshift({ path: failedRecord.routeId, reason: failedRecord.status });
  store.events.push({
    type: 'model_unavailable',
    modelId: normalizeModelId(modelId),
    failures: failures.map((failure) => ({ ...failure })),
    at: new Date(now).toISOString(),
  });
  return {
    ok: false,
    unavailable: true,
    modelId: normalizeModelId(modelId),
    failures,
  };
}

async function routeFallbackDiscovered(
  modelId,
  failedPath,
  registry,
  accounts,
  catalogue,
  probe,
  store,
  options
) {
  const paths = discoverModelPaths(modelId, registry, accounts, catalogue);
  for (const row of catalogue || []) {
    const id = row && (row.modelId || row.model);
    if (!id || normalizeModelId(id) !== normalizeModelId(modelId) || !row.gateway) continue;
    if (!paths.some((route) => route.id === row.gateway))
      paths.push({
        id: row.gateway,
        gateway: row.gateway,
        evidence: Number(row.evidence || 0),
        geoBlocked: row.geoBlocked === true || row.status === 'GEO_BLOCKED',
      });
  }
  return routeFallback(modelId, failedPath, paths, probe, store, options);
}

function discoverModelPaths(modelId, registry, accounts, catalogue) {
  const normalized = normalizeModelId(modelId);
  const sources = new Map(((registry && registry.sources) || []).map((s) => [s.id, s]));
  const providers = (registry && registry.dispatch && registry.dispatch.providers) || {};
  const known = new Map();
  const addPath = (id, source, account, evidence) => {
    if (
      !id ||
      (source &&
        (sourcesApi.isRetired(source.id, registry) || sourcesApi.isDeferred(source.id, registry)))
    )
      return;
    const dispatch =
      providers[String((account && account.provider) || (source && source.id) || '').toLowerCase()];
    const routeId = String(id);
    const key =
      account && account.id && (id === source?.id || id === source?.reachedVia)
        ? routeId + '@' + account.id
        : routeId;
    if (known.has(key)) {
      const existing = known.get(key);
      existing.evidence = Math.max(existing.evidence, Number(evidence || 0));
      if (account && !existing.accountId) {
        existing.accountId = account.id;
        existing.harness = (dispatch && dispatch.harness) || existing.harness;
        existing.accessPath =
          (source && (source.accessPath || source.endpoint)) || existing.accessPath;
      }
      return;
    }
    known.set(key, {
      id: routeId,
      gateway: (source && (source.kind === 'router' ? source.id : source.reachedVia)) || routeId,
      accountId: account && account.id,
      harness: (dispatch && dispatch.harness) || (source && source.harness) || null,
      accessPath: (source && (source.accessPath || source.endpoint)) || routeId,
      evidence: Number(evidence || 0),
      geoBlocked: Boolean(source && source.geoBlocked),
    });
  };
  for (const account of accounts || []) {
    const source = sources.get(account && account.provider);
    const dispatch = providers[String((account && account.provider) || '').toLowerCase()];
    if (!account || account.enabled === false || !source || !dispatch) continue;
    const gateway = source.kind === 'router' ? source.id : source.reachedVia || null;
    for (const model of catalogue || []) {
      const id = model && (model.modelId || model.model);
      if (!id || normalizeModelId(id) !== normalized) continue;
      if (gateway && model.gateway === gateway) {
        const geoBlocked = model.geoBlocked === true || model.status === 'GEO_BLOCKED';
        addPath(gateway, source, account, model.evidence);
        const route = known.get(account && account.id ? gateway + '@' + account.id : gateway);
        if (route && geoBlocked) route.geoBlocked = true;
      }
      if (!gateway && source.servesModels !== false)
        addPath(source.id, source, account, model.evidence);
    }
  }
  for (const model of catalogue || []) {
    const id = model && (model.modelId || model.model);
    if (!id || normalizeModelId(id) !== normalized || !model.gateway) continue;
    const routeKey = model.gateway;
    if (![...known.keys()].some((key) => key === routeKey || key.startsWith(routeKey + '@')))
      addPath(model.gateway, sources.get(model.gateway), null, model.evidence);
  }
  for (const source of (registry && registry.sources) || []) {
    if (
      !source ||
      source.servesModels === false ||
      sourcesApi.isRetired(source.id, registry) ||
      sourcesApi.isDeferred(source.id, registry)
    )
      continue;
    const accountsForSource = (accounts || []).filter(
      (account) => account && account.enabled !== false && account.provider === source.id
    );
    if (!accountsForSource.length) continue;
    const declared = accountsForSource.some((account) =>
      (Array.isArray(account.models) ? account.models : []).some((entry) => {
        const id = typeof entry === 'string' ? entry : entry && entry.model;
        return id && normalizeModelId(id) === normalized;
      })
    );
    if (declared || source.servesModels === true)
      for (const account of accountsForSource) addPath(source.id, source, account, 0);
  }
  // Harness-specific and CLI routes are represented by the same registry
  // sources/accounts as gateway paths. Include declared models from each
  // enabled account so opencode, agy CLI, codex, paseo, and future harnesses
  // participate without hard-coded harness names.
  for (const account of accounts || []) {
    if (!account || account.enabled === false) continue;
    const source = sources.get(account.provider);
    if (
      !source ||
      sourcesApi.isRetired(source.id, registry) ||
      sourcesApi.isDeferred(source.id, registry)
    )
      continue;
    const declared = (Array.isArray(account.models) ? account.models : []).some((entry) => {
      const id = typeof entry === 'string' ? entry : entry && entry.model;
      return id && normalizeModelId(id) === normalized;
    });
    const excluded = (Array.isArray(account.models) ? account.models : []).some((entry) => {
      const id = typeof entry === 'string' ? entry : entry && entry.model;
      return id && normalizeModelId(id) === normalized && entry && entry.exclude === true;
    });
    if ((declared && !excluded) || source.servesModels === true)
      addPath(source.id, source, account, account.evidence);
  }
  // A gateway catalogue route can also be used by another enabled account
  // whose dispatch provider rides that gateway. Keep each account route
  // distinct so quota, harness and retry health remain path scoped.
  for (const account of accounts || []) {
    if (!account || account.enabled === false) continue;
    const source = sources.get(account.provider);
    const dispatch = providers[String(account.provider || '').toLowerCase()];
    if (
      !source ||
      !dispatch ||
      sourcesApi.isRetired(source.id, registry) ||
      sourcesApi.isDeferred(source.id, registry)
    )
      continue;
    const gateway = source.kind === 'router' ? source.id : source.reachedVia || null;
    if (!gateway) continue;
    const routeCatalogue = (catalogue || []).filter((row) => {
      const id = row && (row.modelId || row.model);
      return id && normalizeModelId(id) === normalized && row.gateway === gateway;
    });
    if (routeCatalogue.length) {
      const gatewaySource = sources.get(gateway);
      const routeKey = gateway + '@' + account.id;
      const hasRoute =
        known.has(routeKey) || (known.has(gateway) && known.get(gateway).accountId === account.id);
      if (!hasRoute) {
        known.set(routeKey, {
          id: gateway,
          gateway,
          accountId: account.id,
          harness: dispatch.harness || source.harness || null,
          accessPath: source.accessPath || source.endpoint || gateway,
          evidence: Number(routeCatalogue[0].evidence || 0),
          geoBlocked: false,
        });
      }
    }
  }
  return [...known.values()];
}

async function refreshCatalogueRoutes(catalogue, registry, accounts, store, probe, options) {
  const o = options || {};
  const cap = Math.max(0, Number(o.cap ?? 20));
  const timeoutMs = Math.max(1, Number(o.timeoutMs) || 10000);
  const now = Number(o.now) || Date.now();
  const seen = new Set();
  const checked = [];
  for (const row of catalogue || []) {
    const modelId = row && (row.modelId || row.model);
    const routeId = row && { id: row.gateway, accountId: row.accountId };
    if (!modelId || !routeId) continue;
    const key = healthKey(modelId, routeId);
    if (seen.has(key) || (o.skipKeys && o.skipKeys.has(key))) continue;
    const record = store.paths[key] || getPathRecord(store, modelId, routeId);
    if (record && record.status === 'AVAILABLE') continue;
    if (record && !isDue(store, modelId, routeId, now)) continue;
    if (record && record.status !== 'AVAILABLE' && !isDue(store, modelId, routeId, now)) continue;
    if (o.allowUnprobed !== true && !(o.probeEvidence && o.probeEvidence(modelId, routeId.id)))
      continue;
    seen.add(key);
    if (checked.length >= cap) break;
    let result;
    try {
      result = await probe(modelId, routeId, { timeoutMs, registry });
    } catch (error) {
      result = { ok: false, status: 0, error: String(error) };
    }
    const outcome = recordResult(store, modelId, routeId, result, now, o);
    checked.push({ modelId, routeId, ...outcome });
  }
  return { checked, count: checked.length };
}

async function recheckDue(store, probe, options) {
  const o = options || {};
  const now = Number(o.now) || Date.now();
  const cap = Math.max(0, Number(o.cap ?? 20));
  const due = Object.values(store.paths)
    .filter((row) => unverifiedRecord(row) || dueAt(row, now))
    .slice(0, cap);
  const checkedKeys = due.map((row) => healthKey(row.modelId, row.routeId));
  const restored = [];
  for (const row of due) {
    let result;
    try {
      result = await probe(row.modelId, row.routeId, {
        timeoutMs: o.timeoutMs || 10000,
        registry: o.registry,
      });
    } catch (error) {
      result = { ok: false, error: String(error) };
    }
    const outcome = recordResult(store, row.modelId, row.routeId, result, now, o);
    if (outcome.eligible) restored.push(row.modelId + '|' + row.routeId);
  }
  return { checked: due.length, checkedKeys, restored };
}

async function recheckBeforeSelection(store, probe, options) {
  const o = options || {};
  const now = Number(o.now) || Date.now();
  const due = await recheckDue(store, probe, o);
  const checkedDue = new Set(due.checkedKeys || []);
  const freshCatalogue = (o.catalogue || []).filter((row) => {
    const modelId = row && (row.modelId || row.model);
    return (
      !modelId || !checkedDue.has(healthKey(modelId, { id: row.gateway, accountId: row.accountId }))
    );
  });
  const refreshed = await refreshCatalogueRoutes(
    freshCatalogue,
    o.registry,
    o.accounts || [],
    store,
    probe,
    Object.assign({}, o, {
      cap: Math.max(0, Number(o.cap ?? 20) - due.checked),
      skipKeys: new Set(checkedDue),
    })
  );
  const fallback =
    o.skipFallbackDiscovery || !o.registry
      ? { checked: 0 }
      : await refreshFailedFallbacks(store, probe, o, now);
  return {
    checked: due.checked + refreshed.count + fallback.checked,
    count: due.checked + refreshed.count + fallback.checked,
    restored: due.restored,
    refreshed: refreshed.count,
    fallback: fallback.checked,
  };
}

async function refreshFailedFallbacks(store, probe, options, now) {
  const o = options || {};
  const catalogue = o.fallbackCatalogue || o.catalogue || [];
  const byModel = new Map();
  for (const row of catalogue) {
    const id = row && (row.modelId || row.model);
    if (!id) continue;
    const normalized = normalizeModelId(id);
    if (!byModel.has(normalized)) byModel.set(normalized, []);
    byModel.get(normalized).push(row);
  }
  const models = new Set(byModel.keys());
  for (const [key, record] of Object.entries(store.paths || {})) {
    if (record && record.modelId) models.add(normalizeModelId(record.modelId));
  }
  for (const normalized of models) {
    if (byModel.has(normalized)) continue;
    const record = Object.values(store.paths || {}).find(
      (row) => row && normalizeModelId(row.modelId) === normalized && row.status !== 'AVAILABLE'
    );
    if (record) byModel.set(normalized, [{ modelId: record.modelId, gateway: record.routeId }]);
  }
  let checked = 0;
  const cap = Math.max(
    0,
    Number(o.fallbackProbeCap ?? o.cap ?? 20) - Number(o.checkedBeforeFallback || 0)
  );
  for (const [normalized, rows] of byModel) {
    const failed = rows.find((row) => {
      const record =
        row.gateway &&
        getPathRecord(store, normalized, { id: row.gateway, accountId: row.accountId });
      return record && record.status !== 'AVAILABLE' && !dueAt(record, now);
    });
    if (!failed || checked >= cap) continue;
    const discovered = discoverModelPaths(normalized, o.registry, o.accounts || [], catalogue);
    const paths = new Map(discovered.map((route) => [healthKey(normalized, route), route]));
    for (const row of rows) {
      const rowPath = { id: row.gateway, accountId: row.accountId };
      const rowKey = healthKey(normalized, rowPath);
      if (row.gateway && !paths.has(rowKey)) {
        paths.set(rowKey, {
          id: row.gateway,
          accountId: row.accountId,
          evidence: Number(row.evidence || 0),
          geoBlocked: row.geoBlocked === true,
        });
      }
    }
    const probePaths = [...paths.values()].filter(
      (route) => route.id !== failed.gateway && isSelectable(store, normalized, route, now)
    );
    const boundedPaths = probePaths.slice(0, Math.max(0, cap - checked));
    if (!boundedPaths.length) continue;
    checked += boundedPaths.length;
    await routeFallback(
      normalized,
      failed.gateway,
      boundedPaths,
      (modelId, route) =>
        probe(modelId, route.id, { timeoutMs: o.timeoutMs || 10000, registry: o.registry }),
      store,
      {
        now,
        failureReason: getPathRecord(store, normalized, {
          id: failed.gateway,
          accountId: failed.accountId,
        }).status,
        sleep: o.sleep,
        retryBackoffMs: o.retryBackoffMs,
      }
    );
  }
  return { checked };
}

async function refreshDueFile(file, probe, options) {
  const store = loadStore(file);
  const result = await recheckDue(store, probe, options);
  saveStore(file, store);
  return { store, ...result };
}

async function probeGatewayModel(modelId, routeId, options) {
  const o = options || {};
  const registry = o.registry || sourcesApi.loadSources();
  const routeKey = routeId && typeof routeId === 'object' ? routeId : { id: routeId };
  const source = (registry.sources || []).find((row) => row.id === routeKey.id);
  if (!source || !source.endpoint)
    return { ok: false, status: 0, error: 'route has no probe endpoint' };
  const envName = source.credential && (source.credential.env || source.credential.name);
  let configuredUrl;
  try {
    configuredUrl = new URL(source.endpoint);
  } catch {
    return { ok: false, status: 0, error: 'route endpoint is invalid' };
  }
  // A credential may travel over plain HTTP only to this machine (the local
  // router listens on loopback); anything else must be HTTPS. Live 17/10: the
  // guard refused 9router at 127.0.0.1 before any request, so every intake
  // probe of a working route failed with status 0.
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(configuredUrl.hostname);
  if (envName && configuredUrl.protocol !== 'https:' && !loopback)
    return { ok: false, status: 0, error: 'credentialed probe endpoint must use HTTPS' };
  const token = envName && process.env[envName];
  if (envName && !token) return { ok: false, status: 401, error: 'route credential unavailable' };
  const endpoint = configuredUrl.toString().replace(/\/+$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs || 10000);
  try {
    const response = await (o.fetch || fetch)(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 1,
      }),
    });
    const body = await response.text();
    const retry = response.headers && response.headers.get('retry-after');
    const resetAt = retry
      ? /^\d+$/.test(retry)
        ? new Date(Date.now() + Number(retry) * 1000).toISOString()
        : new Date(retry).toISOString()
      : null;
    return {
      ok: response.ok,
      status: response.status,
      message: body.slice(0, PROBE_BODY_LIMIT),
      resetAt,
    };
  } catch (error) {
    return { ok: false, status: 0, error: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function runDueCli(options) {
  const o = options || {};
  const file =
    o.file ||
    o.routeHealthFile ||
    o['route-health'] ||
    (o.cwd || o.root
      ? path.join(o.cwd || o.root, 'tools', 'ai-brain', 'data', 'model-route-health.json')
      : null) ||
    path.join(__dirname, 'data', 'model-route-health.json');
  const store = loadStore(file);
  const result = await recheckDue(
    store,
    o.probe || ((modelId, routeId) => probeGatewayModel(modelId, routeId)),
    { cap: o.cap || 20, registry: o.registry }
  );
  saveStore(file, store);
  (o.log || console.log)(JSON.stringify(result));
  return result.checked > 0 && result.restored.length === 0 ? 1 : 0;
}

module.exports = {
  atomicRenameSync,
  probeCooldown,
  probeMemoryFile,
  rememberProbe,
  isUnverifiedProbe,
  rememberLaunchTpm,
  tpmTooSmall,
  rememberLaunchContextOverflow,
  contextOverflowObserved,
  contextOverflowEvidence,
  orderProbeRoutes,
  normalizeModelId,
  classifyFailure,
  loadStore,
  saveStore,
  recordResult,
  healthKey,
  getPathRecord,
  isEligible,
  isRouteHealthy,
  isSelectable,
  hasProbeEvidence,
  isDue,
  routeFallback,
  routeFallbackDiscovered,
  recheckDue,
  recheckBeforeSelection,
  refreshDueFile,
  discoverModelPaths,
  refreshCatalogueRoutes,
  probeGatewayModel,
  runDueCli,
  BACKOFF_MS,
  getProviderRecord,
  extractProvider,
  extractAccountKey,
  rememberAccountCooldown,
  setAccountRecord,
  getAccountRecord,
  deleteAccountRecord,
  probeCooldownMs,
  isLegacyUnverified,
  probeIdentity,
};
