import { isPrivateIp } from 'ssrf-guard';
import { safeFetch } from 'ssrf-guard/node';

export const SENSITIVE =
  /(?:cookie|token|secret|password|passwd|authorization|auth|credential|session|environment|^env$|api[_-]?key|access[_-]?key|(?:^|[_-])(?:key|sig(?:nature)?)(?:[_-]|$))/i;
const NON_SECRET = /^(?:true|false|0|1|utf-?8)$/i;
const CREDENTIAL_REFUSAL = 'Research refused: public HTTP(S) URLs without credentials only.';
const PRIVATE_REFUSAL = 'Research refused: destination resolves to a private or restricted address.';
const TIMEOUT = 'Research refused: retrieval timed out.';
const PRIVATE_ERROR = /private|loopback|link-local|metadata|reserved|blocked|not allowed|denied/i;

function hostOf(hostname) {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

export function isPrivateDestination(hostname) {
  const host = hostOf(hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }
  if (isPrivateIp(host)) return true;
  return !host.includes('.') && !host.includes(':');
}

export function assertPublicTarget(raw) {
  const candidate = String(raw).includes('://') ? String(raw) : `https://${raw}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Research refused: invalid public URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(CREDENTIAL_REFUSAL);
  }
  for (const key of url.searchParams.keys()) {
    if (SENSITIVE.test(key) || SENSITIVE.test(decodeURIComponent(key).replace(/\s+/g, '_'))) {
      throw new Error(CREDENTIAL_REFUSAL);
    }
  }
  if (url.hash) {
    const hash = url.hash.slice(1);
    if (SENSITIVE.test(hash)) throw new Error(CREDENTIAL_REFUSAL);
    for (const key of new URLSearchParams(hash).keys()) {
      if (SENSITIVE.test(key)) throw new Error(CREDENTIAL_REFUSAL);
    }
  }
  if (isPrivateDestination(url.hostname)) throw new Error(PRIVATE_REFUSAL);
  return url;
}

export function scanQueryForUnsafeUrls(query) {
  const urls = query.match(/https?:\/\/[^\s"'`()<>[\]{}]+/gi) ?? [];
  for (const candidate of urls) assertPublicTarget(candidate.replace(/[),.;:!?]+$/, ''));
}

export async function retrieve(url, timeoutMs = 10000) {
  assertPublicTarget(url);
  try {
    const response = await safeFetch(url, {
      maxRedirects: 5,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return {
      status: response.status,
      body: response.status === 200 ? await response.text() : undefined,
    };
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(TIMEOUT);
    }
    if (error?.name === 'UnsafeUrlError' || PRIVATE_ERROR.test(error?.message ?? '')) {
      throw new Error(PRIVATE_REFUSAL);
    }
    throw new Error('Research refused: unable to retrieve a public source.');
  }
}

export function collectSecrets(env) {
  return [
    ...new Set(
      Object.entries(env)
        .filter(
          ([key, value]) =>
            SENSITIVE.test(key) &&
            typeof value === 'string' &&
            value.length > 0 &&
            !NON_SECRET.test(value.trim())
        )
        .map(([, value]) => value)
    ),
  ].sort((a, b) => b.length - a.length);
}

export function redact(value, secrets = []) {
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE.test(key) ? '[REDACTED]' : redact(item, secrets),
      ])
    );
  }
  if (typeof value !== 'string') return value;
  let text = value
    .replace(/\b(?:set-cookie|cookie|authorization)\s*:\s*[^\n]+/gi, '[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[^\s"<>]+/gi, '$1 [REDACTED]')
    .replace(/([?&](?:token|key|sig(?:nature)?|secret|api[_-]?key|access[_-]?key|password|passwd|session|auth|credential)=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g, '[REDACTED]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]');
  for (const secret of secrets) {
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text =
      secret.length < 4
        ? text.replace(
            new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu'),
            '[REDACTED]'
          )
        : text.split(secret).join('[REDACTED]');
  }
  return text;
}

export function truncate(text, budget) {
  if (text.length <= budget) return text;
  const notice = '\n[truncated]\n';
  let prefix = text.slice(0, Math.max(0, budget - notice.length));
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return (prefix + notice).slice(0, budget);
}
