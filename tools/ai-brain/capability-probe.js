'use strict';

const crypto = require('crypto');
const { candidateKey } = require('./candidates');
const evidence = require('./evidence');
const schemaApi = require('./writer-schema');
const routeProbe = require('./route-probe');
const { createSecretRedactor } = require('./decisions');

// Shared with the Controller route probes; capability checks get no extra window.
const { PROBE_BUDGET_MS } = require('./orchestrate');
const CAPABILITIES = ['jsonSchema', 'tools'];
const TOOL_NAME = 'capability_probe';

function pending(reason) {
  return { reason, unverified: true };
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
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(routeProbe.DEFAULT_TIMEOUT_MS, remaining)
  );
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

async function probeCapabilities(candidates, profile, options = {}) {
  const o = options;
  const data = o.evidenceDir
    ? evidence.loadEvidence(o.evidenceDir)
    : o.capabilityEvidence || (o.capabilityEvidence = {});
  const records = data.capabilityProbes || (data.capabilityProbes = {});
  const deadline = o.deadline ?? Date.now() + PROBE_BUDGET_MS;

  for (const c of candidates) {
    if (c.blocked || c.credentialEnvMissing || !c.accountId || c.accountId === '*') continue;
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
    const direct =
      c.harness === 'direct-http' ||
      (c.harness === 'opencode-direct' && Boolean(source?.endpoint)) ||
      (source?.kind === require('./sources').Kind.MODEL_SOURCE &&
        !source.harness &&
        !require('./harness').HARNESSES[c.harness]);
    const binding = crypto
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
    const cached = records[key]?.binding === binding ? records[key] : { binding };
    c.capabilities = { ...c.capabilities };
    for (const cap of CAPABILITIES.filter((cap) =>
      (profile.requiredCapabilities || []).includes(cap)
    )) {
      // Normalized observed values remain usable; registry declarations always require a probe.
      const forceSchema = cap === 'jsonSchema' && ['codex', 'agy-pool'].includes(c.harness);
      if (
        c.capabilities[cap] !== undefined &&
        !forceSchema &&
        c.harness !== 'agy-pool' &&
        !c.capabilityDeclarations?.[cap]
      )
        continue;
      const authorized =
        c.harness !== 'agy-pool' ||
        String(o.externalWorkers || '')
          .split(',')
          .includes('agy-pool');
      let proof = authorized ? cached[cap] : pending('WRITER_SCHEMA_LAUNCH_NOT_AUTHORIZED');
      if (
        proof?.ok === false &&
        Date.now() - Date.parse(proof.observedAt) >=
          require('./route-health').probeCooldownMs(proof.reason)
      )
        proof = undefined;
      if (!proof) {
        if (Date.now() >= deadline) proof = pending('WRITER_SCHEMA_NOT_VERIFIED_BUDGET');
        else if (direct && route && o.allowNetwork === false && typeof o.fetch !== 'function')
          proof = pending('CAPABILITY_PROBE_TRANSPORT_NOT_INJECTED');
        else if (direct && route)
          proof = await routeProbe.boundedProbe(
            (_c, _key, _env, probeOptions) =>
              httpProof(c, cap, route, { ...o, deadline, ...probeOptions }),
            c,
            route.apiKeyEnv,
            o.env,
            { timeoutMs: Math.min(routeProbe.DEFAULT_TIMEOUT_MS, deadline - Date.now()) }
          );
        else if (typeof o.probeCli === 'function')
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
  }
  return candidates;
}

module.exports = { PROBE_BUDGET_MS, probeCapabilities };
