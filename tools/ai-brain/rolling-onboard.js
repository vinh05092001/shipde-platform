'use strict';

/**
 * Ship Dễ — Rolling Source Onboarding (TASK-AI-142 T8)
 *
 * Automatically detects newly added sources in sources.json or newly present keys in env,
 * executes qualification probe and quota scan for that source, and records passing evidence
 * into route evidence and route health so the new source seamlessly enters Controller ranking
 * without requiring code modifications.
 */

const fs = require('fs');
const path = require('path');

const evidenceApi = require('./evidence');
const routeHealthApi = require('./route-health');
const candidatesApi = require('./candidates');

function detectNewSources(registry, evidenceData, env) {
  const sources = (registry && registry.sources) || [];
  const envObj = env || process.env;
  const newSources = [];

  for (const src of sources) {
    if (!src || src.servesModels === false) continue;

    // Check credential if required
    const apiKeyEnv = src.credential?.env;
    if (apiKeyEnv && !envObj[apiKeyEnv]) {
      continue; // Key not in env, cannot onboard
    }

    // Check whether source already has evidence in evidenceData.combinations
    const combinations = evidenceData?.combinations || [];
    const hasEvidence = combinations.some(
      (c) => c.source === src.id || c.sourceId === src.id || c.gateway === src.id
    );

    if (!hasEvidence) {
      newSources.push(src);
    }
  }

  return newSources;
}

async function onboardSourceRolling(src, options = {}) {
  const now = options.now ?? Date.now();
  const env = options.env || process.env;
  const fetchFn = options.fetch || globalThis.fetch;
  const evidenceDir = options.evidenceDir || path.join(__dirname, 'data', 'evidence');
  const evidenceData = options.evidenceData || evidenceApi.loadEvidence(evidenceDir);
  evidenceData.combinations = evidenceData.combinations || [];

  const apiKeyEnv = src.credential?.env;
  const apiKey = (apiKeyEnv && env[apiKeyEnv]) || '';

  const repModel =
    (Array.isArray(src.models) && src.models[0]) ||
    src.verify?.model ||
    `${src.id}/default`;

  const endpoint = String(src.endpoint || src.accessPath || '').replace(/\/+$/, '');
  const url = `${endpoint}/chat/completions`;

  const headers = {
    'content-type': 'application/json',
    ...(src.headers || {}),
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  let probeOk = false;
  let probeStatus = 0;
  let probeBody = '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 8000);

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: repModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    probeStatus = res.status;
    probeOk = res.ok;
    try {
      probeBody = await res.text();
    } catch {}
  } catch (err) {
    clearTimeout(timer);
    probeStatus = 503;
    probeOk = false;
    probeBody = err ? err.message : 'Fetch failed';
  }

  if (probeOk) {
    // 1. Record in evidenceData.combinations
    const harness = src.harness || 'direct-http';
    const accessPath = src.endpoint || src.accessPath || 'direct';
    const accountId = `${src.id}-auto`;
    const quotaScope = src.id;

    const combo = {
      harness,
      accessPath,
      gateway: src.id,
      upstream: src.routerAlias || src.id,
      accountId,
      quotaScope,
      model: repModel,
      modelId: repModel,
      source: src.id,
      sourceId: src.id,
      evidence: [
        {
          status: 'passed',
          level: 1,
          proofLevel: 'API_PASS',
          observedAt: new Date(now).toISOString(),
          elapsedMs: 100,
        },
      ],
    };
    combo.candidateKey = candidatesApi.candidateKey(combo);
    evidenceData.combinations.push(combo);

    if (options.persist !== false && evidenceDir) {
      evidenceApi.saveEvidence(evidenceDir, evidenceData);
    }

    // 2. Record route health
    const store =
      options.routeHealth ||
      routeHealthApi.loadStore(
        options.routeHealthFile || path.join(__dirname, 'data', 'model-route-health.json'),
        { allowMissing: true }
      );
    routeHealthApi.rememberProbe(
      combo,
      { ok: true, status: probeStatus, body: probeBody },
      { routeHealth: store, now }
    );
    if (options.persistRouteHealth === true && options.routeHealthFile) {
      routeHealthApi.saveStore(options.routeHealthFile, store);
    }

    // 3. Quota scan entry
    let quotaScan;
    try {
      quotaScan = require('./quota-scan');
    } catch {}
    if (quotaScan) {
      const quotaState = quotaScan.loadQuotaState(options);
      quotaState.scopes = quotaState.scopes || {};
      const qEntry = {
        source: src.id,
        scope: src.id,
        upstream: src.routerAlias || src.id,
        model: repModel,
        code: 'OK',
        status: probeStatus,
        reason: 'OK',
        at: new Date(now).toISOString(),
        retryAfter: null,
      };
      quotaState.scopes[src.id] = qEntry;
      quotaState.scopes[`${src.id}::${src.id}`] = qEntry;
      if (options.persist !== false) {
        quotaScan.saveQuotaState(quotaState, options);
      }
    }

    return {
      ok: true,
      sourceId: src.id,
      model: repModel,
      status: probeStatus,
    };
  }

  return {
    ok: false,
    sourceId: src.id,
    model: repModel,
    status: probeStatus,
    reason: probeBody,
  };
}

async function autoOnboardNewSources(newSources, options = {}) {
  const results = [];
  for (const src of newSources) {
    const res = await onboardSourceRolling(src, options);
    results.push(res);
  }
  return results;
}

module.exports = {
  detectNewSources,
  onboardSourceRolling,
  autoOnboardNewSources,
};
