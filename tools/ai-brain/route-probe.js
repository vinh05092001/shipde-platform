'use strict';

const CLASSIFIER_VERSION = 2;
const DEFAULT_TIMEOUT_MS = 8000;

/** Shared OpenAI-compatible route preflight for Hermes and isolated workers. */
async function probeRoute(candidate, apiKeyEnv, env, options) {
  const opts = options || {};
  const apiKey = env && env[apiKeyEnv];
  if (!apiKey) return { ok: false, status: 0, body: 'Missing provider credential' };
  const rawBase =
    (/^https?:\/\//i.test(candidate.accessPath) && candidate.accessPath) ||
    candidate.endpoint ||
    candidate.sourceEndpoint ||
    candidate.accessPath ||
    '';
  const baseUrl = String(rawBase).replace(/\/+$/, '');
  const url = /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const response = await (opts.fetch || globalThis.fetch)(url, {
      method: 'POST',
      headers: {
        ...(candidate.headers && typeof candidate.headers === 'object' ? candidate.headers : {}),
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
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
    if (!response.ok)
      opts.onHttpFailure?.({
        ok: false,
        status: response.status,
        body: 'Upstream error response body unavailable',
      });
    const remaining = {};
    response.headers?.forEach((value, name) => {
      if (/^x-ratelimit-remaining-/i.test(name) && /^\d+(?:\.\d+)?$/.test(value))
        remaining[name.toLowerCase()] = Number(value);
    });
    // Headers already prove an upstream refusal. A broken error stream must
    // not replace that HTTP cause with a transport timeout.
    let body;
    let bodyTimer;
    try {
      body = response.ok
        ? await response.text()
        : await Promise.race([
            response.text(),
            new Promise((resolve) => {
              bodyTimer = setTimeout(
                () => {
                  controller.abort();
                  resolve('Upstream error response body unavailable');
                },
                Math.min(250, Math.max(1, (opts.timeoutMs || DEFAULT_TIMEOUT_MS) / 2))
              );
            }),
          ]);
    } catch (error) {
      if (response.ok) throw error;
      body = 'Upstream error response body unavailable';
    } finally {
      clearTimeout(bodyTimer);
    }
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
  if (status !== 0) {
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
  }
  if (result && result.reasonCode) return result.reasonCode;
  if (/probe budget exhausted/i.test(body)) return 'PROBE_BUDGET_EXHAUSTED';
  // One premium model locked behind a purchase says nothing about the account's
  // other models; it must not be read as account-wide credit or entitlement loss.
  if (/model_requires_purchase|is locked on your account/i.test(body)) return 'MODEL_LOCKED';
  if (/entitlement|not entitled|subscription required/i.test(body)) return 'ENTITLEMENT_REQUIRED';
  if (/missing provider credential|authentication required|invalid api.?key/i.test(body))
    return 'AUTH_NEEDED';
  if (status === 402 || /insufficient|credit exhausted|quota|recharg/i.test(body))
    return 'UPSTREAM_CREDIT_OR_QUOTA';
  if (status === 404 && /model_not_found/i.test(body)) return 'ROUTE_UNAVAILABLE';
  if (/alias.?mismatch|unknown model|model not found|no such model/i.test(body))
    return 'ALIAS_MISMATCH';
  if (status === 401 || (status >= 500 && /\b401\b[^\n]*re-?auth/i.test(body)))
    return 'AUTH_NEEDED';
  if (
    status === 451 ||
    (status >= 500 && /\b451\b[^\n]*(?:location|geo|region|country)/i.test(body))
  )
    return 'GEO_BLOCKED';
  if (status === 403) return 'UPSTREAM_FORBIDDEN';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UPSTREAM_UNAVAILABLE';
  if (status === 0) return /timeout|timed out/i.test(body) ? 'TIMEOUT' : 'PROBE_NO_RESPONSE';
  return `HTTP_${status}`;
}

async function boundedProbe(probeFn, candidate, apiKeyEnv, env, options) {
  const opts = options || {};
  const timeoutMs = Math.max(1, Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  let timer;
  let httpFailure;
  const startedAt = Date.now();
  const timed = (result) =>
    result && typeof result === 'object'
      ? { ...result, elapsedMs: Date.now() - startedAt }
      : result;
  try {
    return timed(
      await Promise.race([
        Promise.resolve().then(() =>
          probeFn(candidate, apiKeyEnv, env, {
            ...opts,
            signal: controller.signal,
            onHttpFailure: (result) => {
              httpFailure = result;
            },
          })
        ),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(httpFailure || { ok: false, status: 0, body: 'Probe request timeout' });
          }, timeoutMs);
        }),
      ])
    );
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
  CLASSIFIER_VERSION,
  DEFAULT_TIMEOUT_MS,
  tokenLimitEvidence,
  probeRoute,
  classifyProbeFailure,
  boundedProbe,
  failureReason,
};
