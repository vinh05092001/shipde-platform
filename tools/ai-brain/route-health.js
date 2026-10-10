'use strict';

// Durable, path-scoped model health. A failed route is parked, never deleted;
// callers can keep alternate routes for the same normalized model eligible.
const fs = require('fs');
const path = require('path');
const sourcesApi = require('./sources');

const BACKOFF_MS = [30 * 60e3, 2 * 60 * 60e3, 6 * 60 * 60e3, 24 * 60 * 60e3];

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

function loadStore(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && data.version === 1 && data.paths ? data : { version: 1, paths: {}, events: [] };
  } catch {
    return { version: 1, paths: {}, events: [] };
  }
}

function saveStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function dueAt(record, now) {
  return (
    record &&
    Number.isFinite(Date.parse(record.nextCheckAt)) &&
    Date.parse(record.nextCheckAt) <= now
  );
}

function recordResult(store, modelId, routeId, result, now) {
  const key = normalizeModelId(modelId) + '|' + String(routeId);
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
    };
    store.events.push({
      type: 'route_restored',
      modelId: normalizeModelId(modelId),
      routeId,
      at: lastCheckedAt,
    });
    return { key, eligible: true };
  }
  const status = Number(result && result.status) || 0;
  const reason = classifyFailure(status, result && (result.message || result.error));
  const failures = previous.failures + 1;
  const explicit = result && (result.resetAt || result.retryAt);
  let delay = BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)];
  if (reason === 'GEO_BLOCKED' || reason === 'AUTH_NEEDED') delay = 24 * 60 * 60e3;
  const nextCheck = explicit ? Date.parse(explicit) : now + delay;
  store.paths[key] = {
    modelId: String(modelId),
    normalizedModelId: normalizeModelId(modelId),
    routeId,
    status: reason,
    httpStatus: status,
    failures,
    lastCheckedAt,
    nextCheckAt: new Date(Number.isFinite(nextCheck) ? nextCheck : now + delay).toISOString(),
  };
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

function isEligible(store, modelId, routeId, now) {
  const record = store.paths[normalizeModelId(modelId) + '|' + String(routeId)];
  // A due route is eligible only after a successful probe changes its status
  // back to AVAILABLE. Selection must never become the implicit re-check.
  return !record || record.status === 'AVAILABLE';
}

async function routeFallback(modelId, failedPath, paths, probe, store, options) {
  const o = options || {};
  const now = Number(o.now) || Date.now();
  const failedRecord = store.paths[normalizeModelId(modelId) + '|' + String(failedPath)];
  const failureReason =
    o.failureReason || (failedRecord && failedRecord.status) || 'UNAVAILABLE_NOW';
  const ordered = (paths || []).filter((p) => p && p.id !== failedPath).slice();
  ordered.sort((a, b) => Number(b.evidence || 0) - Number(a.evidence || 0));
  const failures = [];
  for (const route of ordered) {
    if (!isEligible(store, modelId, route.id, now)) {
      failures.push({
        path: route.id,
        reason: store.paths[normalizeModelId(modelId) + '|' + route.id].status,
      });
      continue;
    }
    if (route.geoBlocked === true) {
      failures.push({ path: route.id, reason: 'GEO_BLOCKED' });
      continue;
    }
    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
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
      if (attempt !== 0 || !['UNAVAILABLE_NOW'].includes(retryReason)) break;
      if (o.sleep) await o.sleep(o.retryBackoffMs ?? 1000);
      else await new Promise((resolve) => setTimeout(resolve, o.retryBackoffMs ?? 1000));
    }
    const recorded = recordResult(store, modelId, route.id, result, now);
    if (recorded.eligible) {
      store.events.push({
        type: 'route_fallback',
        modelId: normalizeModelId(modelId),
        failedPath,
        reason: failureReason,
        chosenPath: route.id,
        at: new Date(now).toISOString(),
      });
      return { ok: true, route, failures };
    }
    failures.push({ path: route.id, reason: recorded.reason });
  }
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
    const key = routeId;
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
        const route = known.get(gateway);
        if (route && geoBlocked) route.geoBlocked = true;
      }
      if (!gateway && source.servesModels !== false)
        addPath(source.id, source, account, model.evidence);
    }
  }
  for (const model of catalogue || []) {
    const id = model && (model.modelId || model.model);
    if (!id || normalizeModelId(id) !== normalized || !model.gateway) continue;
    const routeKey = model.gateway + '|';
    if (!known.has(routeKey))
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
    if (declared) for (const account of accountsForSource) addPath(source.id, source, account, 0);
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
      return id && normalizeModelId(id) === normalized && !(entry && entry.exclude === true);
    });
    if (declared) addPath(source.id, source, account, account.evidence);
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
    const routeId = row && row.gateway;
    if (!modelId || !routeId) continue;
    const key = normalizeModelId(modelId) + '|' + routeId;
    if (
      seen.has(key) ||
      (o.skipKeys && o.skipKeys.has(key)) ||
      !isEligible(store, modelId, routeId, now)
    )
      continue;
    seen.add(key);
    if (checked.length >= cap) break;
    let result;
    try {
      result = await probe(modelId, routeId, { timeoutMs });
    } catch (error) {
      result = { ok: false, status: 0, error: String(error) };
    }
    const outcome = recordResult(store, modelId, routeId, result, now);
    checked.push({ modelId, routeId, ...outcome });
  }
  return { checked, count: checked.length };
}

async function recheckDue(store, probe, options) {
  const o = options || {};
  const now = Number(o.now) || Date.now();
  const cap = Math.max(0, Number(o.cap ?? 20));
  const due = Object.values(store.paths)
    .filter((row) => dueAt(row, now))
    .slice(0, cap);
  const checkedKeys = due.map((row) => normalizeModelId(row.modelId) + '|' + row.routeId);
  const restored = [];
  for (const row of due) {
    let result;
    try {
      result = await probe(row.modelId, row.routeId, { timeoutMs: o.timeoutMs || 10000 });
    } catch (error) {
      result = { ok: false, error: String(error) };
    }
    const outcome = recordResult(store, row.modelId, row.routeId, result, now);
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
    return !modelId || !checkedDue.has(normalizeModelId(modelId) + '|' + row.gateway);
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
  return {
    checked: due.checked + refreshed.count,
    count: due.checked + refreshed.count,
    restored: due.restored,
    refreshed: refreshed.count,
  };
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
  const source = (registry.sources || []).find((row) => row.id === routeId);
  if (!source || !source.endpoint)
    return { ok: false, status: 0, error: 'route has no probe endpoint' };
  const envName = source.credential && source.credential.env;
  const token = envName && process.env[envName];
  if (envName && !token) return { ok: false, status: 401, error: 'route credential unavailable' };
  const endpoint = String(source.endpoint).replace(/\/+$/, '') + '/chat/completions';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.timeoutMs || 10000);
  try {
    const response = await (o.fetch || fetch)(endpoint, {
      method: 'POST',
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
    return { ok: response.ok, status: response.status, message: body.slice(0, 500), resetAt };
  } catch (error) {
    return { ok: false, status: 0, error: String((error && error.message) || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function runDueCli(options) {
  const o = options || {};
  const file = o.file || path.join(__dirname, 'data', 'model-route-health.json');
  const store = loadStore(file);
  const result = await recheckDue(
    store,
    (modelId, routeId) => probeGatewayModel(modelId, routeId),
    { cap: o.cap || 20 }
  );
  saveStore(file, store);
  console.log(JSON.stringify(result));
  return 0;
}

module.exports = {
  normalizeModelId,
  classifyFailure,
  loadStore,
  saveStore,
  recordResult,
  isEligible,
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
};
