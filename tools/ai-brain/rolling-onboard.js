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
    // Evidence earned with a different, known key does not prove the current one. Evidence
    // recorded before fingerprints existed stays valid: it is not proof of a rotation.
    if (
      fingerprint &&
      combination.credentialFingerprint &&
      combination.credentialFingerprint !== fingerprint
    ) {
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
    const res = await quotaScan.withinSignal(
      fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: repModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: dispatchConfig.quotaProbeMaxOutputTokens,
        }),
        signal: controller.signal,
      }),
      controller.signal
    );
    probeStatus = res.status;
    try {
      probeBody = await quotaScan.withinSignal(res.text(), controller.signal);
    } catch (err) {
      if (controller.signal.aborted) throw err;
    }
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

  // rememberProbe resolves the file from these options and persists unless told not to.
  const healthOptions = {
    routeHealthFile: options.routeHealthFile,
    'route-health': options['route-health'],
    cwd: options.cwd,
    root: options.root,
    persistRouteHealth: options.persistRouteHealth,
  };
  let loadedHealth = options.routeHealth;
  const healthStore = () =>
    (loadedHealth =
      loadedHealth ||
      routeHealthApi.loadStore(routeHealthApi.probeMemoryFile(healthOptions), {
        allowMissing: true,
      }));

  // Evidence earned with a different, known key no longer proves this source, whatever this
  // probe found: a pass for one model under the new key says nothing about the others.
  // Unfingerprinted (pre-rotation-tracking) evidence is never retired here.
  const retireOtherKeyPasses = (status) => {
    const fingerprint = credentialFingerprint(apiKey);
    let retired = 0;
    for (const combination of evidenceData.combinations) {
      if (
        !combination ||
        ![combination.source, combination.sourceId, combination.gateway].includes(src.id) ||
        !combination.credentialFingerprint ||
        combination.credentialFingerprint === fingerprint
      ) {
        continue;
      }
      const items = Array.isArray(combination.evidence) ? combination.evidence : [];
      if (items.at(-1)?.status !== evidenceApi.Status.PASSED) continue;
      combination.evidence = items.concat({
        status: evidenceApi.Status.FAILED,
        cause: 'CREDENTIAL_NOT_REVERIFIED',
        observedAt: new Date(now).toISOString(),
      });
      retired += 1;
      // Route health is what dispatch requires, so the retirement must land there too.
      routeHealthApi.rememberProbe(
        combination,
        { ok: false, status, cause: 'CREDENTIAL_NOT_REVERIFIED' },
        { ...healthOptions, routeHealth: healthStore(), now }
      );
    }
    if (retired > 0 && options.persist !== false && evidenceDir) {
      evidenceApi.saveEvidence(evidenceDir, evidenceData);
    }
  };

  let quotaResults = [];
  let usable = [];
  if (probeOk) {
    quotaResults = await quotaScan.scanSourceQuotas(src, { ...scanOptions, targets: scanTargets });
    // Each scope stands alone: quota state is source-and-scope qualified, so a refused
    // upstream stays blocked while confirmed ones enter ranking.
    usable = quotaResults.filter((result) => result.code === quotaScan.QUOTA_STATUS_CODES.OK);
    if (usable.length === 0) {
      probeOk = false;
      const refused = quotaResults[0];
      probeReason = refused ? `QUOTA_${refused.code}` : 'QUOTA_UNSCANNED';
    }
  }

  if (probeOk) {
    // An existing registry binding owns the account; onboarding never invents one.
    const accounts =
      options.accounts !== undefined
        ? options.accounts
        : require('./accounts').listAccounts({ home: options.home }) || [];
    const bound = (accounts || []).find(
      (account) => account && (account.source === src.id || account.provider === src.id)
    );
    const harness = src.harness || 'direct-http';
    const accessPath = src.endpoint || src.accessPath || 'direct';
    const store = healthStore();
    const combos = usable.map((result) => {
      const combo = {
        harness,
        accessPath,
        gateway: src.id,
        upstream: result.upstream || src.routerAlias || src.id,
        accountId: bound ? bound.id : null,
        quotaScope: result.scope,
        model: result.model,
        modelId: result.model,
        source: src.id,
        sourceId: src.id,
        credentialFingerprint: credentialFingerprint(apiKey),
        evidence: [
          {
            status: 'passed',
            level: 1,
            proofLevel: 'API_PASS',
            observedAt: new Date(now).toISOString(),
            // Measured from the scan that confirmed this scope's completion.
            elapsedMs: result.elapsedMs,
          },
        ],
      };
      combo.candidateKey = candidatesApi.candidateKey(combo);
      return combo;
    });
    evidenceData.combinations.push(...combos);
    // Status 0: nothing was sent for those routes; the cause names why they stop ranking.
    retireOtherKeyPasses(0);

    if (options.persist !== false && evidenceDir) {
      evidenceApi.saveEvidence(evidenceDir, evidenceData);
    }

    for (const combo of combos) {
      routeHealthApi.rememberProbe(
        combo,
        { ok: true, status: probeStatus, body: probeBody },
        { ...healthOptions, routeHealth: store, now }
      );
    }

    return {
      ok: true,
      sourceId: src.id,
      model: repModel,
      models: combos.map((combo) => combo.modelId),
      status: probeStatus,
      quota: quotaResults.map((result) => ({ scope: result.scope, code: result.code })),
    };
  }

  retireOtherKeyPasses(probeStatus);

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
