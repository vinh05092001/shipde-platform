'use strict';

/**
 * Ship Dễ — Model discovery: minimal catalogue reader (W2)
 *
 * Discovery reads *catalogues* — the model lists a gateway or provider
 * advertises. It never issues a completion, and this module is the reason:
 * the only request it knows is a GET of the models list an OpenAI-style
 * endpoint exposes, and it refuses every other shape.
 *
 * The credential, when the registry declares one, is read from the process
 * environment at call time, placed on the wire for that single request and
 * never returned, logged, stored or snapshot. `describeLastRequest` exposes
 * the URL but never headers, so an evidence record can name what was called
 * without being able to echo the secret that called it.
 */

const DEFAULT_TIMEOUT_MS = 90000;

/**
 * GET an OpenAI-style models catalogue.
 *
 * @param url
 * @param opts { timeoutMs, fetch, env, envName }
 * @returns Promise<{ ok, status, body, parsed, error, request: { url, hadCredential } }>
 */
async function httpGetModels(url, opts) {
  const o = opts || {};
  const fetchFn = o.fetch || ((u, init) => fetch(u, init));
  const timeoutMs = o.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : o.timeoutMs;
  const env = o.env || process.env;

  const headers = { 'content-type': 'application/json' };
  let hadCredential = false;
  if (o.envName) {
    const value = env[o.envName];
    if (value !== undefined && String(value).trim() !== '') {
      headers.authorization = 'Bearer ' + String(value);
      hadCredential = true;
    }
  }

  const controller = o.signal ? undefined : new AbortController();
  const signal = o.signal || (controller && controller.signal);
  const timer = o.signal ? null : setTimeout(() => controller && controller.abort(), timeoutMs);

  const request = { url: String(url), hadCredential };
  try {
    const res = await fetchFn(String(url), { headers, signal, method: 'GET' });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      body: text,
      parsed,
      request,
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: '',
      parsed: null,
      request,
      error: String(e && e.message ? e.message : e),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The safe, storable description of the request that just happened.
 *
 * Exposes the URL and whether a credential was attached, never the header. A
 * snapshot line built from this can prove "the 9Router catalogue was read with
 * its API key" without being able to print the key.
 */
function describeRequest(request) {
  return {
    url: (request && request.url) || '',
    auth: request && request.hadCredential ? 'credentialed' : 'none',
  };
}

module.exports = { httpGetModels, describeRequest, DEFAULT_TIMEOUT_MS };
