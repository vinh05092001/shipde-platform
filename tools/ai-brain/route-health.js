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
  if (s === 401 || s === 403) return 'AUTH_NEEDED';
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
  return { key, eligible: false, reason };
}

function isEligible(store, modelId, routeId, now) {
  const record = store.paths[normalizeModelId(modelId) + '|' + String(routeId)];
  return !record || record.status === 'AVAILABLE' || dueAt(record, now);
}

async function routeFallback(modelId, failedPath, paths, probe, store, options) {
  const o = options || {};
  const now = Number(o.now) || Date.now();
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
    let result;
    try {
      result = await probe(modelId, route);
    } catch (error) {
      result = { ok: false, error: String(error) };
    }
    const recorded = recordResult(store, modelId, route.id, result, now);
    if (recorded.eligible) {
      store.events.push({
        type: 'route_fallback',
        modelId: normalizeModelId(modelId),
        failedPath,
        reason: o.failureReason || 'UNAVAILABLE_NOW',
        chosenPath: route.id,
        at: new Date(now).toISOString(),
      });
      return { ok: true, route, failures };
    }
    failures.push({ path: route.id, reason: recorded.reason });
  }
  return { ok: false, unavailable: true, modelId: normalizeModelId(modelId), failures };
}

async function recheckDue(store, probe, options) {
  const o = options || {};
  const now = Number(o.now) || Date.now();
  const cap = Math.max(0, Number(o.cap) || 20);
  const due = Object.values(store.paths)
    .filter((row) => dueAt(row, now))
    .slice(0, cap);
  const restored = [];
  for (const row of due) {
    let result;
    try {
      result = await probe(row.modelId, row.routeId);
    } catch (error) {
      result = { ok: false, error: String(error) };
    }
    const outcome = recordResult(store, row.modelId, row.routeId, result, now);
    if (outcome.eligible) restored.push(row.modelId + '|' + row.routeId);
  }
  return { checked: due.length, restored };
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
  recheckDue,
  probeGatewayModel,
  runDueCli,
  BACKOFF_MS,
};
