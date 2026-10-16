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
    const remaining = {};
    response.headers?.forEach((value, name) => {
      if (/^x-ratelimit-remaining-/i.test(name) && /^\d+(?:\.\d+)?$/.test(value))
        remaining[name.toLowerCase()] = Number(value);
    });
    const body = await response.text();
    const tpm = tokenLimitEvidence(response.headers, body);
    return {
      ok: response.ok,
      status: response.status,
      body,
      ...tpm,
      quota: {
        status: Object.keys(remaining).length
          ? Object.values(remaining).some((n) => n === 0)
            ? 'exhausted'
            : 'open'
          : 'unknown',
        remaining,
        source: 'probe-response-headers',
        observedAt: new Date().toISOString(),
      },
    };
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

/**
 * Per-minute token limit a provider exposes: the x-ratelimit-limit-tokens
 * response header, or a 413/429 body of the form "tokens per minute (TPM):
 * Limit N, Requested M". Nothing is returned when neither is present.
 */
function tokenLimitEvidence(headers, body) {
  const out = {};
  let headerLimit;
  headers?.forEach?.((value, name) => {
    if (/^x-ratelimit-limit-tokens$/i.test(name) && /^\d+$/.test(String(value).trim()))
      headerLimit = Number(value);
  });
  const text = String(body || '');
  const limit = text.match(/tokens per minute[^]*?Limit\s+(\d+)/i);
  const requested = text.match(/tokens per minute[^]*?Requested\s+(\d+)/i);
  const n = headerLimit ?? (limit ? Number(limit[1]) : undefined);
  if (n > 0) out.tokensPerMinuteLimit = n;
  if (requested) out.requestedTokens = Number(requested[1]);
  return out;
}

function classifyProbeFailure(result) {
  const status = Number(result && result.status) || 0;
  const body = String((result && result.body) || 'Probe failed');
  const providerMatch = body.match(/No active credentials for provider:\s*([\w.-]+)/i);
  if (providerMatch) {
    const obj = { reason: 'PROVIDER_UNAVAILABLE', provider: providerMatch[1] };
    Object.defineProperty(obj, 'toString', {
      value() {
        return this.reason;
      },
      enumerable: false,
    });
    return obj;
  }
  if (result && result.reasonCode) return result.reasonCode;
  if (/probe budget exhausted/i.test(body)) return 'PROBE_BUDGET_EXHAUSTED';
  if (/entitlement|not entitled|subscription required/i.test(body)) return 'ENTITLEMENT_REQUIRED';
  if (/missing provider credential|authentication required|invalid api.?key/i.test(body))
    return 'AUTH_NEEDED';
  if (status === 402 || /insufficient[_ ]credits?|credit exhausted|quota/i.test(body))
    return 'UPSTREAM_CREDIT_OR_QUOTA';
  if (/alias.?mismatch|unknown model|model not found|no such model/i.test(body))
    return 'ALIAS_MISMATCH';
  if (status === 403) return 'UPSTREAM_FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UPSTREAM_UNAVAILABLE';
  if (status === 0) return /timeout|timed out/i.test(body) ? 'TIMEOUT' : 'ROUTE_UNAVAILABLE';
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
  } catch (_) {
    // Injected probes can reject too. Never let an untrusted error body (which
    // may contain credentials) escape into controller output.
    return { ok: false, status: 0, body: 'Probe exception', reasonCode: 'PROBE_EXCEPTION' };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

function failureReason(cause) {
  if (cause && typeof cause === 'object')
    return failureReason(cause.reasonCode || cause.reason || cause.cause || 'PROBE_FAILED');
  return String(cause || 'PROBE_FAILED');
}

module.exports = {
  tokenLimitEvidence,
  probeRoute,
  classifyProbeFailure,
  boundedProbe,
  failureReason,
};
