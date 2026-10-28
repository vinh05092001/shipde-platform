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
const { computeBinding } = require('./capability-probe');

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

function detectNewSources(registry, evidenceData, env, options = {}) {
  const sources = (registry && registry.sources) || [];
  const envObj = env || process.env;
  const newSources = [];

  for (const src of sources) {
    if (!src || src.servesModels === false) continue;

    // Check credential if required
    const apiKeyEnv = src.credential?.env;
    if (!apiKeyEnv || !envObj[apiKeyEnv]) {
      continue; // Key not in env or source has no env credential, cannot onboard
    }

    // A failed latest observation is not onboarding proof, and neither is a pass
    // earned with a different key: a replaced credential is probed again.
    const combinations = evidenceData?.combinations || [];
    const fingerprint = credentialFingerprint(apiKeyEnv ? envObj[apiKeyEnv] : null);
    const hasEvidence = sourceHasPassingEvidence(combinations, src.id, fingerprint);
    const lacksTools =
      options.requireTools === true &&
      !combinations.some(
        (c) =>
          [c.source, c.sourceId, c.gateway].includes(src.id) &&
          (c.capabilities?.tools === true || c.capabilityEvidence?.tools?.ok === true)
      );

    if (!hasEvidence || lacksTools) {
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
  let repModel =
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

  async function probeModel(modelToProbe) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), dispatchConfig.probeTimeoutMs);
    try {
      const res = await quotaScan.withinSignal(
        fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelToProbe,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: dispatchConfig.quotaProbeMaxOutputTokens,
            stream: false,
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
        probeOk = false;
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
    return probeOk;
  }

  await probeModel(repModel);
  if (!probeOk && scanTargets.length > 1) {
    for (const target of scanTargets) {
      if (target.model && target.model !== repModel) {
        const ok = await probeModel(target.model);
        if (ok) {
          repModel = target.model;
          break;
        }
      }
    }
  }

  let quotaResults = [];
  let usable = [];
  if (probeOk) {
    quotaResults = await quotaScan.scanSourceQuotas(src, { ...scanOptions, targets: scanTargets });
    usable = quotaResults.filter((result) => result.code === quotaScan.QUOTA_STATUS_CODES.OK);
    if (usable.length === 0) {
      probeOk = false;
      const refused = quotaResults[0];
      probeReason = refused ? `QUOTA_${refused.code}` : 'QUOTA_UNSCANNED';
      if (refused && refused.status) {
        probeStatus = refused.status;
      }
    } else {
      repModel = usable[0].model;
    }
  }

  const TOOL_NAME = 'capability_probe';

  async function probeToolCapability(modelToProbe) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), dispatchConfig.probeTimeoutMs);
    const nonce = crypto.randomUUID
      ? crypto.randomUUID()
      : `probe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tools = [
      {
        type: 'function',
        function: {
          name: TOOL_NAME,
          description: 'Return the probe nonce without side effects.',
          parameters: {
            type: 'object',
            additionalProperties: false,
            required: ['nonce'],
            properties: { nonce: { type: 'string', enum: [nonce] } },
          },
        },
      },
    ];
    try {
      const res = await quotaScan.withinSignal(
        fetchFn(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: modelToProbe,
            messages: [
              {
                role: 'user',
                content: `Call ${TOOL_NAME} with nonce ${nonce}. Do not execute commands.`,
              },
            ],
            tools,
            tool_choice: { type: 'function', function: { name: TOOL_NAME } },
            max_tokens: options.toolProbeMaxOutputTokens || 128,
            stream: false,
          }),
          signal: controller.signal,
        }),
        controller.signal
      );
      if (!res.ok) {
        return { ok: false, status: res.status, reason: `HTTP_${res.status}` };
      }
      const bodyText = await quotaScan.withinSignal(res.text(), controller.signal);
      let data;
      try {
        data = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText;
      } catch {
        return { ok: false, reason: 'INVALID_JSON' };
      }
      const message = data?.choices?.[0]?.message;
      const call = message?.tool_calls?.find(
        (c) => c.type === 'function' && c.function?.name === TOOL_NAME
      );
      let args;
      try {
        args =
          typeof call?.function?.arguments === 'string'
            ? JSON.parse(call.function.arguments)
            : call?.function?.arguments;
      } catch {}
      if (args?.nonce === nonce) {
        return {
          ok: true,
          method: 'http-forced-tool-call',
          observedAt: new Date(now).toISOString(),
        };
      }
      return { ok: false, reason: 'TOOL_CALL_NOT_OBSERVED' };
    } catch (err) {
      return {
        ok: false,
        reason: err && err.name === 'AbortError' ? 'TIMEOUT' : 'PROBE_FAILED',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const toolCapabilityMap = new Map();
  if (probeOk && options.probeTools !== false) {
    for (const target of usable) {
      const model = target.model || repModel;
      if (model && !toolCapabilityMap.has(model)) {
        let toolRes;
        if (typeof options.probeToolCapability === 'function') {
          toolRes = await options.probeToolCapability(model, src, options);
        } else {
          toolRes = await probeToolCapability(model);
        }
        toolCapabilityMap.set(model, toolRes);
      }
    }
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
      const model = result.model || repModel;
      const toolProof = toolCapabilityMap.get(model);
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
      if (toolProof?.ok === true) {
        combo.capabilities = { ...(combo.capabilities || {}), tools: true };
        combo.capabilityEvidence = { ...(combo.capabilityEvidence || {}), tools: toolProof };
      }
      combo.candidateKey = candidatesApi.candidateKey(combo);
      return combo;
    });
    evidenceData.combinations.push(...combos);
    evidenceData.capabilityProbes = evidenceData.capabilityProbes || {};

    const allBound = (accounts || []).filter(
      (account) => account && (account.source === src.id || account.provider === src.id)
    );

    // Bind each stored proof with the same route dispatch resolves for that
    // candidate, so probeCapabilities() finds it under an equal binding.
    const prefix = src.modelPrefix || src.id + '/';
    const stripPrefix = (id) => {
      const text = String(id || '');
      return text.startsWith(prefix) ? text.slice(prefix.length) : text;
    };
    const recordProof = (cand, tools) => {
      const key = candidatesApi.candidateKey(cand);
      const route = require('./orchestrate').routeProbeCandidate(
        cand,
        { model: cand.modelId },
        registry,
        false
      );
      evidenceData.capabilityProbes[key] = { binding: computeBinding(key, route), tools };
    };
    for (const combo of combos) {
      if (combo.capabilities?.tools === true && combo.capabilityEvidence?.tools) {
        const tools = combo.capabilityEvidence.tools;
        recordProof(combo, tools);
        for (const acc of allBound) {
          recordProof({ ...combo, accountId: acc.id, quotaScope: acc.id }, tools);
        }
        if (src.kind === 'router') {
          for (const acc of allBound.length ? allBound : [{ id: bound ? bound.id : null }]) {
            recordProof(
              {
                harness: 'opencode',
                accessPath: 'cli',
                gateway: src.id,
                upstream: combo.upstream,
                accountId: acc.id,
                quotaScope: acc.id,
                modelId: `${prefix}${stripPrefix(combo.modelId)}`,
              },
              tools
            );
          }
        }
      }
    }

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
      for (const acc of allBound) {
        routeHealthApi.rememberProbe(
          { ...combo, accountId: acc.id, quotaScope: acc.id },
          { ok: true, status: probeStatus, body: probeBody },
          { ...healthOptions, routeHealth: store, now }
        );
      }
    }

    return {
      ok: true,
      sourceId: src.id,
      model: repModel,
      models: combos.map((combo) => combo.modelId),
      status: probeStatus,
      quota: quotaResults.map((result) => ({ scope: result.scope, code: result.code })),
      tools: Array.from(toolCapabilityMap.entries()).map(([model, res]) => ({
        model,
        ok: res.ok,
        ...(res.reason ? { reason: res.reason } : {}),
      })),
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
