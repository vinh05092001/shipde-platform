'use strict';

/**
 * Ship Dễ — Rolling Source Onboarding (TASK-AI-142 T8)
 *
 * Automatically detects newly added sources in sources.json or newly present keys in env,
 * executes qualification probe and quota scan for that source, and records passing evidence
 * into route evidence and route health so the new source seamlessly enters Controller ranking
 * without requiring code modifications.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const evidenceApi = require('./evidence');
const routeHealthApi = require('./route-health');
const candidatesApi = require('./candidates');
const sourcesApi = require('./sources');
const quotaScan = require('./quota-scan');

// One-way, truncated digest: identifies which key produced the evidence without storing it.
function credentialFingerprint(apiKey) {
  if (!apiKey) return null;
  return crypto.createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 16);
}

function sourceHasPassingEvidence(combinations, sourceId, fingerprint) {
  return combinations.some((combination) => {
    if (
      !combination ||
      combination.legacy ||
      combination.verified === false ||
      ![combination.source, combination.sourceId, combination.gateway].includes(sourceId)
    ) {
      return false;
    }
    // Evidence earned with another (or an unrecorded) key does not prove the current one.
    if (fingerprint && combination.credentialFingerprint !== fingerprint) {
      return false;
    }

    const items = Array.isArray(combination.evidence) ? combination.evidence : [];
    return items.at(-1)?.status === evidenceApi.Status.PASSED;
  });
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

    // A failed latest observation is not onboarding proof, and neither is a pass
    // earned with a different key: a replaced credential is probed again.
    const combinations = evidenceData?.combinations || [];
    const fingerprint = credentialFingerprint(apiKeyEnv ? envObj[apiKeyEnv] : null);
    const hasEvidence = sourceHasPassingEvidence(combinations, src.id, fingerprint);

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

  // The quota scan names the source's scopes from configuration or, for a router, from its
  // live model list; its first scope supplies the probe model when none is configured.
  const scanOptions = { ...options, registry, env, fetch: fetchFn, now };
  const scanTargets = await quotaScan.scanTargetsForSource(src, scanOptions);
  const repModel =
    (Array.isArray(src.models) && src.models.find((model) => typeof model === 'string' && model)) ||
    src.verify?.model ||
    scanTargets[0]?.model;

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
        max_tokens: dispatchConfig.quotaProbeMaxOutputTokens,
      }),
      signal: controller.signal,
    });
    probeStatus = res.status;
    try {
      probeBody = await res.text();
    } catch {}
    if (res.ok) {
      const completion = quotaScan.validateCompletion(probeBody);
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

  let quotaResults = [];
  if (probeOk) {
    quotaResults = await quotaScan.scanSourceQuotas(src, { ...scanOptions, targets: scanTargets });
    const refused = quotaResults.find((result) => quotaScan.BLOCKING_CODES.has(result.code));
    if (refused) {
      // A source whose quota scan refuses it is not onboarded: no evidence, no ranking.
      probeOk = false;
      probeReason = `QUOTA_${refused.code}`;
    }
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
      credentialFingerprint: credentialFingerprint(apiKey),
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

    return {
      ok: true,
      sourceId: src.id,
      model: repModel,
      status: probeStatus,
      quota: quotaResults.map((r) => ({ scope: r.scope, code: r.code })),
    };
  }

  return {
    ok: false,
    sourceId: src.id,
    model: repModel,
    status: probeStatus,
    reason: probeReason,
    quota: quotaResults.map((result) => ({ scope: result.scope, code: result.code })),
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
  credentialFingerprint,
  detectNewSources,
  onboardSourceRolling,
  autoOnboardNewSources,
};
