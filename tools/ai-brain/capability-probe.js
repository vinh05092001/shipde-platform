'use strict';

const crypto = require('crypto');
const { candidateKey } = require('./candidates');
const evidence = require('./evidence');
const schemaApi = require('./writer-schema');
const routeProbe = require('./route-probe');
const { createSecretRedactor } = require('./decisions');

const sourcesApi = require('./sources');
const { loadPriors, priorFor } = require('./priors');
const routeEvidence = require('./route-evidence');
const { hasPriorWorkPass } = routeEvidence;

// Shared with the Controller route probes; capability checks get no extra window.
const { PROBE_BUDGET_MS } = require('./orchestrate');
const CAPABILITIES = ['jsonSchema', 'tools'];
const TOOL_NAME = 'capability_probe';

const ACCOUNT_LEVEL_FAILURES = new Set([
  'UPSTREAM_CREDIT_OR_QUOTA',
  'AUTH_NEEDED',
  'ENTITLEMENT_REQUIRED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_NOT_FOUND',
  'BILLING_ISSUE',
]);

function pending(reason) {
  return { reason, unverified: true };
}

function computeBinding(key, route) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        key,
        endpoint: route?.accessPath,
        model: route?.modelId,
        credentialEnv: route?.apiKeyEnv,
        headers: route?.headers,
      })
    )
    .digest('hex');
}

async function httpProof(candidate, capability, route, options) {
  const o = options;
  const env = { ...process.env, ...o.env };
  if (!env[route.apiKeyEnv]) return pending('AUTH_NEEDED');
  const job = schemaApi.prepareJob({ candidateKey: candidateKey(candidate) });
  const nonce = job.resultSchema.properties.nonce.enum[0];
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
  const payload = {
    model: route.modelId,
    messages: [
      {
        role: 'user',
        content:
          capability === 'tools'
            ? `Call ${TOOL_NAME} with nonce ${nonce}. Do not execute commands.`
            : job.prompt,
      },
    ],
    ...(capability === 'tools'
      ? { tools, tool_choice: { type: 'function', function: { name: TOOL_NAME } } }
      : {
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'writer_result', strict: true, schema: job.resultSchema },
          },
        }),
  };
  const controller = new AbortController();
  const remaining = o.deadline - Date.now();
  if (remaining <= 0) return pending('WRITER_SCHEMA_NOT_VERIFIED_BUDGET');
  const timeoutMs = o.timeoutMs || Math.min(routeProbe.DEFAULT_TIMEOUT_MS, remaining);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let httpFailure;
  try {
    const response = await (o.fetch || globalThis.fetch)(
      route.accessPath.replace(/\/+$/, '') + '/chat/completions',
      {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          ...route.headers,
          authorization: `Bearer ${env[route.apiKeyEnv]}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      httpFailure = {
        ok: false,
        status: response.status,
        body: 'Upstream error response body unavailable',
      };
      o.onHttpFailure?.(httpFailure);
    }
    const body = await response.json();
    if (!response.ok) {
      const cause = routeProbe.failureReason(
        routeProbe.classifyProbeFailure({ status: response.status, body: JSON.stringify(body) })
      );
      return {
        ok: false,
        reason: cause,
        httpStatus: response.status,
        detail: createSecretRedactor(env)(String(body?.error?.message || body?.message || cause)),
      };
    }
    const message = body.choices?.[0]?.message;
    if (capability === 'jsonSchema') {
      const content = String(message?.content || '');
      if (
        /insufficient|recharg|free quota|abuse of free resources|balance is insufficient|upgrade your subscription/i.test(
          content
        )
      ) {
        return {
          ok: false,
          reason: 'UPSTREAM_CREDIT_OR_QUOTA',
          httpStatus: 200,
          detail: createSecretRedactor(env)(content.slice(0, 300)),
        };
      }
      const checked = schemaApi.validate(message?.content, job.resultSchema);
      return checked.ok && checked.value.status === 'completed' && !checked.value.artifacts.length
        ? { ok: true, method: 'http-json-schema' }
        : { ok: false, reason: checked.reason || 'WRITER_SCHEMA_PROBE_NOT_COMPLETED' };
    }
    const call = message?.tool_calls?.find(
      (c) => c.type === 'function' && c.function?.name === TOOL_NAME
    );
    let args;
    try {
      args = JSON.parse(call?.function?.arguments);
    } catch {}
    return args?.nonce === nonce &&
      Object.keys(args).length === tools[0].function.parameters.required.length
      ? { ok: true, method: 'http-forced-tool-call' }
      : { ok: false, reason: 'TOOL_CALL_NOT_OBSERVED' };
  } catch (error) {
    return {
      ok: false,
      reason: httpFailure
        ? routeProbe.failureReason(routeProbe.classifyProbeFailure(httpFailure))
        : error.name === 'AbortError'
          ? 'TIMEOUT'
          : 'PROBE_EXCEPTION',
      ...(httpFailure ? { httpStatus: httpFailure.status } : {}),
      detail: createSecretRedactor(env)(String(error.message)),
    };
  } finally {
    clearTimeout(timer);
  }
}

function candidateSourceKey(c) {
  return c.sourceId || c.gateway || c.source || c.harness || 'unknown';
}

function comparePriorScores(aScore, bScore) {
  const aHas = Number.isFinite(aScore);
  const bHas = Number.isFinite(bScore);
  if (aHas && bHas) return bScore - aScore;
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  return 0;
}

function orderCandidatesForProbe(candidates, profile, options = {}) {
  if (!Array.isArray(candidates)) return candidates;
  const store = options.routeHealth || { paths: {} };
  const data = routeEvidence.evidenceData(options);
  const context = { ...options, evidenceData: data };
  const machineDataOff = process.env.AI_BRAIN_MACHINE_DATA === 'none';
  const priors =
    options.priors !== undefined
      ? options.priors
      : options.ranking?.priors !== undefined
        ? options.ranking.priors
        : !machineDataOff
          ? loadPriors()
          : undefined;
  const role = profile?.role || options.role || 'writer';
  const now = options.now || Date.now();
  const dispatchConfig =
    options.dispatchConfig || sourcesApi.getDispatchConfig(options.registry, options);
  const rawBatchSize = options.probeRoundRobinBatch ?? dispatchConfig?.probeRoundRobinBatch;
  const batchSize = Number(rawBatchSize);
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new Error('DISPATCH_CONFIG_INVALID: probeRoundRobinBatch must be a positive integer');
  }

  const rows = candidates.map((c, index) => {
    const prior = priorFor(c, role, priors, now);
    const priorScore = Number.isFinite(prior?.score) ? prior.score : null;
    return {
      c,
      index,
      work: hasPriorWorkPass(c, data.combinations),
      live: routeEvidence.recentRouteSuccess(c, store, context),
      cost: routeEvidence.measuredProbeCost(c, store, context),
      priorScore,
    };
  });

  const buckets = new Map();
  for (const row of rows) {
    const bKey =
      (row.work ? '1' : '0') +
      ':' +
      (row.live ? '1' : '0') +
      ':' +
      (Number.isFinite(row.priorScore) ? '1' : '0');
    if (!buckets.has(bKey)) buckets.set(bKey, []);
    buckets.get(bKey).push(row);
  }

  const sortedBucketKeys = Array.from(buckets.keys()).sort((a, b) => b.localeCompare(a));
  const result = [];

  // Round-robin dispatch trade-off:
  // Candidates are partitioned by source. Inside each source, candidates are ordered
  // strictly descending by priorScore (cost and initial index as tie-breakers).
  // Cross-source round-robin interleaves up to `batchSize` models per source to prevent
  // a catalog-heavy source from monopolizing the schema probe budget window, deliberately
  // favoring source diversity and starvation prevention over global prior ordering across sources.
  for (const bKey of sortedBucketKeys) {
    const bucketRows = buckets.get(bKey);
    const sourceQueues = new Map();
    for (const row of bucketRows) {
      const src = candidateSourceKey(row.c);
      if (!sourceQueues.has(src)) sourceQueues.set(src, []);
      sourceQueues.get(src).push(row);
    }

    for (const queue of sourceQueues.values()) {
      queue.sort(
        (a, b) =>
          comparePriorScores(a.priorScore, b.priorScore) || a.cost - b.cost || a.index - b.index
      );
    }

    const sortedSources = Array.from(sourceQueues.keys()).sort((srcA, srcB) => {
      const topA = sourceQueues.get(srcA)[0];
      const topB = sourceQueues.get(srcB)[0];
      return (
        comparePriorScores(topA.priorScore, topB.priorScore) ||
        topA.cost - topB.cost ||
        topA.index - topB.index
      );
    });

    const targetLength = result.length + bucketRows.length;
    while (result.length < targetLength) {
      let takenAny = false;
      for (const src of sortedSources) {
        const queue = sourceQueues.get(src);
        if (queue && queue.length) {
          const take = queue.splice(0, batchSize);
          if (take.length > 0) {
            result.push(...take);
            takenAny = true;
          }
        }
      }
      if (!takenAny) break;
    }
  }

  return result.map((r) => r.c);
}

async function probeCapabilities(candidates, profile, options = {}) {
  const o = options;
  const dispatchConfig = sourcesApi.getDispatchConfig(o.registry, o);
  const data = o.evidenceDir
    ? evidence.loadEvidence(o.evidenceDir)
    : o.capabilityEvidence || (o.capabilityEvidence = {});
  const records = data.capabilityProbes || (data.capabilityProbes = {});
  const schemaBudget =
    o.schemaProbeBudgetMs ??
    o.schemaBudgetMs ??
    dispatchConfig.schemaProbeBudgetMs ??
    PROBE_BUDGET_MS;
  const deadline = o.deadline ?? Date.now() + schemaBudget;

  const store = o.routeHealth || null;
  const failedHttpAccounts = o.failedHttpAccounts || new Map();
  const machineDataOff = process.env.AI_BRAIN_MACHINE_DATA === 'none';
  const priors =
    o.priors !== undefined
      ? o.priors
      : o.ranking?.priors !== undefined
        ? o.ranking.priors
        : !machineDataOff
          ? loadPriors()
          : undefined;
  const orderedCandidates = orderCandidatesForProbe(candidates, profile, { ...o, priors });

  // Probes run concurrently up to dispatch.maxConcurrentProbes so the strongest
  // candidates late in the probe order are still reached inside the schema budget.
  const probeOne = async (c) => {
    if (c.blocked || c.credentialEnvMissing || !c.accountId || c.accountId === '*') return;
    const key = candidateKey(c);
    const route =
      typeof o.httpRoute === 'function'
        ? o.httpRoute(c)
        : require('./orchestrate').routeProbeCandidate(
            c,
            { model: c.modelId },
            o.registry || { sources: [] },
            false
          );
    const source = (o.registry?.sources || []).find((s) =>
      [c.sourceId, c.source, c.gateway, c.upstream].includes(s.id)
    );
    const isPureCli = ['codex', 'agy-pool'].includes(c.harness);
    const isVia9Router = [
      c.gateway,
      c.upstream,
      c.sourceId,
      c.source,
      source?.id,
      source?.reachedVia,
    ].some((id) => ['9router', 'ninerouter'].includes(String(id || '').toLowerCase()));
    const direct =
      !isPureCli &&
      (c.harness === 'direct-http' ||
        c.harness === 'opencode-direct' ||
        ((c.harness === 'opencode' || c.harness === 'paseo') && isVia9Router) ||
        (source?.kind === require('./sources').Kind.MODEL_SOURCE &&
          !source.harness &&
          !require('./harness').HARNESSES[c.harness]));
    const accountKey =
      direct && route
        ? `${route.accessPath}::${route.apiKeyEnv || c.accountId || c.sourceId || ''}`
        : null;

    const neededCaps = CAPABILITIES.filter((cap) =>
      (profile.requiredCapabilities || []).includes(cap)
    );

    const binding = computeBinding(key, route);
    const cached = records[key]?.binding === binding ? records[key] : { binding };
    c.capabilities = { ...c.capabilities };

    if (accountKey && failedHttpAccounts.has(accountKey)) {
      const failed = failedHttpAccounts.get(accountKey);
      const failProof = {
        ok: false,
        reason: failed.reason || 'UPSTREAM_CREDIT_OR_QUOTA',
        httpStatus: failed.httpStatus,
        observedAt: new Date(o.now ?? Date.now()).toISOString(),
        ...(failed.detail ? { detail: failed.detail } : {}),
      };
      for (const cap of neededCaps) {
        cached[cap] = failProof;
        c.capabilityEvidence = { ...c.capabilityEvidence, [cap]: failProof };
        if (cap === 'jsonSchema') c.jsonSchemaEvidence = failProof;
        delete c.capabilities[cap];
      }
      records[key] = cached;
      return;
    }

    const identity = require('./route-health').probeIdentity(c);
    const record = store
      ? require('./route-health').getPathRecord(store, identity.model, identity.route)
      : null;

    if (record && record.status && record.status !== 'AVAILABLE') {
      const failProof = {
        ok: false,
        reason: record.failureReason || 'ROUTE_UNAVAILABLE',
        httpStatus: record.probeResult?.status,
        observedAt: new Date(o.now ?? Date.now()).toISOString(),
      };
      for (const cap of neededCaps) {
        cached[cap] = failProof;
        c.capabilityEvidence = { ...c.capabilityEvidence, [cap]: failProof };
        if (cap === 'jsonSchema') c.jsonSchemaEvidence = failProof;
        delete c.capabilities[cap];
      }
      records[key] = cached;
      return;
    }

    // Cheap HTTP preflight before checking jsonSchema/tools
    const hasUncached = neededCaps.some((cap) => {
      const p = cached[cap];
      return !p || p.ok === false;
    });

    if (Date.now() < deadline && hasUncached && direct && route && o.preflightHttp === true) {
      const remaining = deadline - Date.now();
      const identity = require('./route-health').probeIdentity(c);
      const record = store
        ? require('./route-health').getPathRecord(store, identity.model, identity.route)
        : null;
      const timeoutMs = sourcesApi.resolveProbeTimeout(c, record, dispatchConfig, remaining);
      let preflight;
      if (o.allowNetwork === false && typeof o.fetch !== 'function') {
        preflight = { ok: false, status: 0, body: 'CAPABILITY_PROBE_TRANSPORT_NOT_INJECTED' };
      } else {
        preflight = await routeProbe.boundedProbe(
          o.routeProbe || routeProbe.probeRoute,
          route,
          route.apiKeyEnv,
          { ...process.env, ...o.env },
          { timeoutMs, fetch: o.fetch, signal: o.signal }
        );
      }
      if (!preflight.ok) {
        if (store && o.persistRouteHealth !== false) {
          require('./route-health').rememberProbe(c, preflight, { ...o, routeHealth: store });
        }
        const cause = routeProbe.failureReason(routeProbe.classifyProbeFailure(preflight));
        if (accountKey && ACCOUNT_LEVEL_FAILURES.has(cause)) {
          failedHttpAccounts.set(accountKey, { reason: cause, httpStatus: preflight.status });
        }
        const failProof = {
          ok: false,
          reason: cause,
          httpStatus: preflight.status,
          observedAt: new Date(o.now ?? Date.now()).toISOString(),
        };
        for (const cap of neededCaps) {
          cached[cap] = failProof;
          c.capabilityEvidence = { ...c.capabilityEvidence, [cap]: failProof };
          if (cap === 'jsonSchema') c.jsonSchemaEvidence = failProof;
          delete c.capabilities[cap];
        }
        records[key] = cached;
        return; // Never check schema on failed preflight
      }
    }

    for (const cap of neededCaps) {
      const isPool = c.harness === 'agy-pool';
      const forceSchema = cap === 'jsonSchema' && ['codex', 'agy-pool'].includes(c.harness);
      if (
        c.capabilities[cap] !== undefined &&
        !c.capabilityDeclarations?.[cap] &&
        !forceSchema &&
        (!isPool || sourcesApi.isAgyPoolWriterEnabled(o.registry, o))
      )
        continue;
      const authorized =
        c.harness !== 'agy-pool' || sourcesApi.isAgyPoolWriterEnabled(o.registry, o);
      let proof = authorized ? cached[cap] : pending('WRITER_SCHEMA_LAUNCH_NOT_AUTHORIZED');
      if (
        proof?.ok === false &&
        Date.now() - Date.parse(proof.observedAt) >=
          require('./route-health').probeCooldownMs(proof.reason)
      )
        proof = undefined;
      if (!proof && authorized && hasPriorWorkPass(c, data.combinations)) {
        proof = {
          ok: true,
          reason: 'PRIOR_WORK_ITEM_PASS',
          observedAt: new Date(o.now ?? Date.now()).toISOString(),
        };
      }
      if (!proof && authorized && cap === 'tools') {
        if (c.capabilityEvidence?.tools?.ok === true && c.capabilityEvidence.tools.observedAt) {
          proof = c.capabilityEvidence.tools;
        } else {
          // Gateway prefixes come from the registry (modelPrefix or "<id>/"), never a fixed name.
          const prefixes = (o.registry?.sources || [])
            .filter((s) => [c.gateway, c.source, c.sourceId, c.upstream].includes(s.id))
            .map((s) => s.modelPrefix || s.id + '/');
          const bare = (id) => {
            const text = String(id || '');
            const hit = prefixes.find((p) => text.startsWith(p));
            return hit ? text.slice(hit.length) : text;
          };
          const mId = bare(c.modelId);
          const matchingCombo = (data.combinations || []).find((combo) => {
            if (!combo) return false;
            const comboModelId = bare(combo.modelId || combo.model);
            return (
              (combo.source === c.source ||
                combo.sourceId === c.sourceId ||
                combo.gateway === c.gateway ||
                combo.upstream === c.upstream) &&
              comboModelId === mId &&
              (combo.capabilities?.tools === true || combo.capabilityEvidence?.tools?.ok === true)
            );
          });
          if (matchingCombo) {
            proof = matchingCombo.capabilityEvidence?.tools || {
              ok: true,
              method: 'http-forced-tool-call',
              observedAt:
                matchingCombo.evidence?.at(-1)?.observedAt ||
                new Date(o.now ?? Date.now()).toISOString(),
            };
          }
        }
      }
      if (!proof) {
        const remaining = deadline - Date.now();
        const identity = require('./route-health').probeIdentity(c);
        const record = store
          ? require('./route-health').getPathRecord(store, identity.model, identity.route)
          : null;
        const timeoutMs = sourcesApi.resolveProbeTimeout(c, record, dispatchConfig, remaining);

        if (Date.now() >= deadline) proof = pending('WRITER_SCHEMA_NOT_VERIFIED_BUDGET');
        else if (direct && route && o.allowNetwork === false && typeof o.fetch !== 'function')
          proof = pending('CAPABILITY_PROBE_TRANSPORT_NOT_INJECTED');
        else if (direct && route) {
          proof = await routeProbe.boundedProbe(
            (_c, _key, _env, probeOptions) =>
              httpProof(c, cap, route, { ...o, deadline, timeoutMs, ...probeOptions }),
            c,
            route.apiKeyEnv,
            o.env,
            { timeoutMs, fetch: o.fetch }
          );
          if (proof?.ok === false && accountKey && ACCOUNT_LEVEL_FAILURES.has(proof.reason)) {
            failedHttpAccounts.set(accountKey, proof);
          }
        } else if (typeof o.probeCli === 'function')
          proof = await routeProbe.boundedProbe(
            () => o.probeCli(c, cap, deadline - Date.now()),
            c,
            null,
            o.env,
            { timeoutMs: deadline - Date.now() }
          );
        else proof = pending('WRITER_SCHEMA_LAUNCH_NOT_AUTHORIZED');
        if (proof?.ok === false && !proof.reason)
          proof.reason = routeProbe.failureReason(routeProbe.classifyProbeFailure(proof));
        if (typeof proof?.ok === 'boolean' && !proof.unverified) {
          proof = { ...proof, observedAt: new Date(o.now ?? Date.now()).toISOString() };
          cached[cap] = proof;
          records[key] = cached;
          if (o.evidenceDir) {
            // Merge each observation into the latest store; never overwrite unrelated runtime evidence.
            const latest = evidence.loadEvidence(o.evidenceDir);
            latest.capabilityProbes = latest.capabilityProbes || {};
            const prior = latest.capabilityProbes[key];
            latest.capabilityProbes[key] = {
              ...(prior?.binding === binding ? prior : {}),
              binding,
              [cap]: proof,
            };
            evidence.saveEvidence(o.evidenceDir, latest);
          }
        }
      }
      if (typeof proof?.ok === 'boolean' && !proof.unverified) c.capabilities[cap] = proof.ok;
      else delete c.capabilities[cap];
      c.capabilityEvidence = { ...c.capabilityEvidence, [cap]: proof };
      if (cap === 'jsonSchema') c.jsonSchemaEvidence = proof;
    }
  };
  const concurrency = Math.max(
    1,
    Number(o.maxConcurrentProbes ?? dispatchConfig.maxConcurrentProbes) || 1
  );
  // Different accounts probe in parallel; one account's models stay serial so an
  // account-level failure still short-circuits its remaining models.
  const accountOf = (c) => String(c.harness || '') + '::' + String(c.accountId || '');
  const queue = orderedCandidates.slice();
  const busy = new Set();
  let wake = null;
  const takeNext = () => {
    const idx = queue.findIndex((c) => !busy.has(accountOf(c)));
    return idx < 0 ? null : queue.splice(idx, 1)[0];
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length > 0) {
        const c = takeNext();
        if (!c) {
          await new Promise((resolve) => {
            const prev = wake;
            wake = () => {
              if (prev) prev();
              resolve();
            };
          });
          continue;
        }
        const account = accountOf(c);
        busy.add(account);
        try {
          await probeOne(c);
        } finally {
          busy.delete(account);
          const w = wake;
          wake = null;
          if (w) w();
        }
      }
    })
  );
  return candidates;
}

module.exports = {
  PROBE_BUDGET_MS,
  probeCapabilities,
  orderCandidatesForProbe,
  hasPriorWorkPass,
  computeBinding,
};
