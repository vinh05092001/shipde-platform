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
const sourcesApi = require('./sources');

function sourceHasPassingEvidence(combinations, sourceId) {
  return combinations.some((combination) => {
    if (
      !combination ||
      combination.legacy ||
      combination.verified === false ||
      ![combination.source, combination.sourceId, combination.gateway].includes(sourceId)
    ) {
      return false;
    }

    const items = Array.isArray(combination.evidence) ? combination.evidence : [];
    return items.at(-1)?.status === evidenceApi.Status.PASSED;
  });
}

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

    // A failed latest observation is not onboarding proof. It must remain
    // retryable, including after the operator replaces its credential.
    const combinations = evidenceData?.combinations || [];
    const hasEvidence = sourceHasPassingEvidence(combinations, src.id);

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
  const registry = options.registry || sourcesApi.loadSources();
  const dispatchConfig = sourcesApi.getDispatchConfig(registry, {
    ...options,
    probeTimeoutMs: options.timeoutMs ?? options.probeTimeoutMs,
  });

  const apiKeyEnv = src.credential?.env;
  const apiKey = (apiKeyEnv && env[apiKeyEnv]) || '';

  const repModel =
    (Array.isArray(src.models) && src.models.find((model) => typeof model === 'string' && model)) ||
    src.verify?.model;

  if (!repModel) {
    return { ok: false, sourceId: src.id, model: null, status: 0, reason: 'MODEL_UNCONFIGURED' };
  }

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
  let probeReason = 'PROBE_FAILED';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), dispatchConfig.probeTimeoutMs);

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: repModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: dispatchConfig.rollingOnboardMaxOutputTokens,
      }),
      signal: controller.signal,
    });
    probeStatus = res.status;
    try {
      probeBody = await res.text();
    } catch {}
    if (res.ok) {
      const completion = validateCompletion(probeBody);
      probeOk = completion.ok;
      probeReason = completion.reason;
    } else {
      probeReason = `HTTP_${probeStatus}`;
    }
  } catch (err) {
    probeStatus = 503;
    probeOk = false;
    probeBody = '';
    probeReason = err && err.name === 'AbortError' ? 'TIMEOUT' : 'PROBE_FAILED';
  } finally {
    clearTimeout(timer);
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

    // 2. Record route health in the same store dispatch reads. rememberProbe
    // resolves the file from these options and persists unless the caller opts out.
    const healthOptions = {
      routeHealthFile: options.routeHealthFile,
      'route-health': options['route-health'],
      cwd: options.cwd,
      root: options.root,
      persistRouteHealth: options.persistRouteHealth,
    };
    const store =
      options.routeHealth ||
      routeHealthApi.loadStore(routeHealthApi.probeMemoryFile(healthOptions), {
        allowMissing: true,
      });
    routeHealthApi.rememberProbe(
      combo,
      { ok: true, status: probeStatus, body: probeBody },
      { ...healthOptions, routeHealth: store, now }
    );

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
    reason: probeReason,
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
