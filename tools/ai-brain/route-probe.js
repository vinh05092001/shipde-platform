'use strict';

/** Shared OpenAI-compatible route preflight for Hermes and isolated workers. */
async function probeRoute(candidate, apiKeyEnv, env, options) {
  const opts = options || {};
  const apiKey = env && env[apiKeyEnv];
  if (!apiKey) return { ok: false, status: 0, body: 'Missing provider credential' };
  const baseUrl = String(candidate.accessPath || candidate.endpoint || '').replace(/\/+$/, '');
  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || 8000);
  try {
    const response = await (opts.fetch || globalThis.fetch)(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: candidate.modelId || candidate.model,
        messages: [
          {
            role: 'user',
            content: `Reply only OK. ${'The shipment planning reference contains operational context, constraints, dependencies, and acceptance evidence. '.repeat(130)}`,
          },
        ],
        // Operator-approved PR #288: prepaid gateways pre-deduct max_tokens;
        // a 1-token probe passed while real requests failed 403. Keep a realistic
        // budget; the one-word reply instruction keeps actual output spend tiny.
        max_tokens: Number(candidate.maxOutputTokens || candidate.max_output_tokens || 8192),
      }),
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: error && error.name === 'AbortError' ? 'Request timeout' : 'Probe request failed',
    };
  } finally {
    clearTimeout(timeout);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

function classifyProbeFailure(result) {
  const status = Number(result && result.status) || 0;
  const body = String((result && result.body) || 'Probe failed');
  if (/probe budget exhausted/i.test(body)) return 'PROBE_BUDGET_EXHAUSTED';
  if (status === 402 || /insufficient[_ ]credits?|credit exhausted|quota/i.test(body))
    return 'UPSTREAM_CREDIT_OR_QUOTA';
  if (/alias.?mismatch|unknown model|model not found|no such model/i.test(body))
    return 'ALIAS_MISMATCH';
  if (status === 403) return 'UPSTREAM_FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UPSTREAM_UNAVAILABLE';
  if (status === 0) return /timeout/i.test(body) ? 'TIMEOUT' : 'ROUTE_UNAVAILABLE';
  return `HTTP_${status}`;
}

async function boundedProbe(probeFn, candidate, apiKeyEnv, env, options) {
  const opts = options || {};
  const timeoutMs = Math.max(1, Number(opts.timeoutMs) || 8000);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() =>
        probeFn(candidate, apiKeyEnv, env, { ...opts, signal: controller.signal })
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ ok: false, status: 0, body: 'Probe request timeout' });
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

module.exports = { probeRoute, classifyProbeFailure, boundedProbe };
