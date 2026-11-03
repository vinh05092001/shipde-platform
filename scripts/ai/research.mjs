#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { isIP, isIPv4, isIPv6 } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.6.1';
const INSTALL_HINT = `uv tool install https://github.com/Panniantong/Agent-Reach/releases/download/v${VERSION}/agent-reach.zip\nSee https://github.com/Panniantong/Agent-Reach/blob/v${VERSION}/docs/install.md. Never install agent-reach from PyPI.\n`;
// Pinned channel metadata: force anonymous backends, including Reddit's
// public-only route. Never permit a caller to select a browser/gh backend.
const ACTIONS = new Map([
  ['web read', ['read', 'jina']],
  ['web search', ['search', 'exa']],
  ['github read', ['read', 'github-api']],
  ['github search', ['search', 'github-api']],
  ['reddit read', ['read', 'public-web']],
  ['reddit search', ['search', 'public-web']],
  ['youtube transcript', ['subtitle', 'yt-dlp']],
]);
const SENSITIVE =
  /(?:cookie|token|secret|password|passwd|authorization|auth|credential|session|environment|^env$|api[_-]?key|access[_-]?key|(?:^|[_-])(?:key|sig(?:nature)?)(?:[_-]|$))/i;
// Only values of credential-shaped variables are scrubbed verbatim; scrubbing
// every inherited value would corrupt ordinary output (e.g. the word "true").
const SENSITIVE_ENV =
  /(?:cookie|token|secret|password|passwd|authorization|auth|credential|session|private|proxy|api[_-]?key|access[_-]?key|(?:^|[_-])(?:key|sig(?:nature)?)(?:[_-]|$))/i;
const NON_SECRET_ENV_VALUES = new Set(['true', 'false', '0', '1', 'utf-8', 'utf8']);
const PUBLIC_ERROR_CODES = new Set([
  'BAD_INPUT',
  'TIMEOUT',
  'RATE_LIMITED',
  'NOT_FOUND',
  'UPSTREAM_BROKEN',
  'PLATFORM_BLOCKED',
  'UNSUPPORTED',
  'BUSY',
]);
const positiveInteger = (value) =>
  /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const refused = (message, maxChars = 20000) => ({
  code: 1,
  exitCode: 1,
  stdout: '',
  stderr: truncate(`${message}\n`, maxChars),
});

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b, c, d] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
    return true;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateHost(host) {
  let h = host.toLowerCase().trim();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (!h || h === 'localhost') return true;
  if (!h.includes('.') && !isIP(h)) return true;
  if (
    /\.(localhost|local|internal|lan|home|corp|arpa|priv|private|test|invalid|example)$/i.test(h)
  )
    return true;
  if (isIPv4(h)) return isPrivateIPv4(h);
  if (isIPv6(h)) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd]/i.test(h) || /^fe[89ab]/i.test(h) || /^ff/i.test(h) || /^::ffff:/i.test(h))
      return true;
    if (/^(100::|2001:db8:|2001:10:)/i.test(h)) return true;
    return false;
  }
  const match = h.match(/\b(?:\d{1,3}[.-]){3}\d{1,3}\b/);
  if (match && isPrivateIPv4(match[0].replace(/-/g, '.'))) return true;
  return false;
}

const CREDENTIAL_REFUSAL = 'Research refused: public HTTP(S) URLs without credentials only.';
const USERINFO = /^(?:[^\s:@/?#]*:[^\s@/?#]*@|[^\s:@/?#]+@)/;
const STRIP_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

function refuseEmbeddedCredentials(candidate) {
  const raw = String(candidate).trim();
  const schemeless = raw.replace(STRIP_SCHEME, '').replace(/^\/\//, '');
  if (!schemeless) return;

  if (USERINFO.test(schemeless)) {
    throw new Error(CREDENTIAL_REFUSAL);
  }

  const queryStart = schemeless.indexOf('?');
  const hashStart = schemeless.indexOf('#');

  if (queryStart >= 0) {
    const queryPart =
      hashStart > queryStart
        ? schemeless.slice(queryStart + 1, hashStart)
        : schemeless.slice(queryStart + 1);
    for (const [key] of new URLSearchParams(queryPart)) {
      const decodedKey = decodeURIComponent(key).replace(/\s+/g, '_');
      if (SENSITIVE.test(key) || SENSITIVE.test(decodedKey)) {
        throw new Error(CREDENTIAL_REFUSAL);
      }
    }
  }

  if (hashStart >= 0) {
    const hashPart = schemeless.slice(hashStart + 1);
    if (SENSITIVE.test(hashPart)) {
      throw new Error(CREDENTIAL_REFUSAL);
    }
    for (const [key] of new URLSearchParams(hashPart)) {
      const decodedKey = decodeURIComponent(key).replace(/\s+/g, '_');
      if (SENSITIVE.test(key) || SENSITIVE.test(decodedKey)) {
        throw new Error(CREDENTIAL_REFUSAL);
      }
    }
  }
}

function cleanCandidateToken(raw) {
  let token = raw.trim();
  while (
    (token.startsWith('(') && token.endsWith(')')) ||
    (token.startsWith('<') && token.endsWith('>')) ||
    (token.startsWith('{') && token.endsWith('}')) ||
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'")) ||
    (token.startsWith('`') && token.endsWith('`')) ||
    (token.startsWith('[') &&
      token.endsWith(']') &&
      !/^\[[a-fA-F0-9:.]+\](?::\d+)?(?:\/.*)?$/i.test(token))
  ) {
    token = token.slice(1, -1).trim();
  }
  while (/[,;:"'>`})]+$/.test(token)) {
    token = token.replace(/[,;:"'>`})]+$/, '');
  }
  if (token.endsWith('.') && !/\[[a-fA-F0-9:.]+\]$/.test(token)) {
    token = token.slice(0, -1);
  }
  return token;
}

function validatePublicUrl(candidate) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('Research refused: invalid public URL.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    [...url.searchParams.keys()].some((key) => SENSITIVE.test(key)) ||
    isPrivateHost(url.hostname)
  ) {
    throw new Error(CREDENTIAL_REFUSAL);
  }

  for (const [key, val] of url.searchParams.entries()) {
    if (SENSITIVE.test(key)) {
      throw new Error('Research refused: public HTTP(S) URLs without credentials only.');
    }
    if (val && typeof val === 'string') {
      const trimmed = val.trim();
      if (
        /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ||
        trimmed.startsWith('//') ||
        /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/|\?|$)/i.test(trimmed) ||
        /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|\?|$)/.test(trimmed) ||
        /^localhost(?::\d+)?(?:\/|\?|$)/i.test(trimmed) ||
        /^\[[a-fA-F0-9:]+\](?::\d+)?(?:\/|\?|$)/i.test(trimmed)
      ) {
        const dest = trimmed.startsWith('//')
          ? `${url.protocol}${trimmed}`
          : trimmed.includes('://')
            ? trimmed
            : `https://${trimmed}`;
        validatePublicUrl(dest);
      }
    }
  }

  const embeddedInPath = url.pathname.match(/[a-z][a-z0-9+.-]*:\/\/[^\s/]+/gi);
  if (embeddedInPath) {
    for (const embedded of embeddedInPath) {
      validatePublicUrl(embedded);
    }
  }

  if (url.hash) {
    const rawHash = url.hash.replace(/^#/, '');
    if (SENSITIVE.test(rawHash)) {
      throw new Error('Research refused: public HTTP(S) URLs without credentials only.');
    }
    const hashParams = new URLSearchParams(rawHash);
    for (const [key, val] of hashParams.entries()) {
      if (SENSITIVE.test(key)) {
        throw new Error('Research refused: public HTTP(S) URLs without credentials only.');
      }
      if (val && typeof val === 'string') {
        const trimmed = val.trim();
        if (
          /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ||
          trimmed.startsWith('//') ||
          /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/|\?|$)/i.test(trimmed) ||
          /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|\?|$)/.test(trimmed) ||
          /^localhost(?::\d+)?(?:\/|\?|$)/i.test(trimmed) ||
          /^\[[a-fA-F0-9:]+\](?::\d+)?(?:\/|\?|$)/i.test(trimmed)
        ) {
          const dest = trimmed.startsWith('//')
            ? `${url.protocol}${trimmed}`
            : trimmed.includes('://')
              ? trimmed
              : `https://${trimmed}`;
          validatePublicUrl(dest);
        }
      }
    }
    const embeddedInHash = rawHash.match(/[a-z][a-z0-9+.-]*:\/\/[^\s/]+/gi);
    if (embeddedInHash) {
      for (const embedded of embeddedInHash) {
        validatePublicUrl(embedded);
      }
    }
  }
}

function extractSearchUrls(target) {
  const urls = [];

  for (const rawToken of target.split(/\s+/)) {
    const token = cleanCandidateToken(rawToken);
    if (!token) continue;

    // Check explicit scheme
    if (token.includes('://')) {
      refuseEmbeddedCredentials(token);
      urls.push(token);
      continue;
    }

    // Check userinfo (e.g. user:pass@host, reader:pw@[::1], SECRETVALUE@intranet?token=...)
    if (USERINFO.test(token)) {
      // Must not be an npm package like react@18.2.0
      const atIdx = token.lastIndexOf('@');
      const rest = token.slice(atIdx + 1);
      const isSemver = !token.slice(0, atIdx).includes(':') && /^\d+\.\d+\.\d+/.test(rest);
      if (!isSemver) {
        refuseEmbeddedCredentials(token);
        urls.push(`https://${token}`);
        continue;
      }
    }

    // Check single label or domain with sensitive query param (e.g. shopee?token=123, intranet?token=123)
    if (token.includes('?')) {
      const qIdx = token.indexOf('?');
      const queryPart = token.slice(qIdx + 1);
      let hasSensitive = false;
      for (const [key] of new URLSearchParams(queryPart)) {
        const decodedKey = decodeURIComponent(key).replace(/\s+/g, '_');
        if (SENSITIVE.test(key) || SENSITIVE.test(decodedKey)) {
          hasSensitive = true;
          break;
        }
      }
      if (hasSensitive) {
        refuseEmbeddedCredentials(token);
        urls.push(`https://${token}`);
        continue;
      }
    }

    // Explicit IP address: IPv4 or IPv6
    if (
      /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/.*)?$/i.test(token) ||
      /^\[[a-fA-F0-9:.]+\](?::\d+)?(?:\/.*)?$/i.test(token)
    ) {
      refuseEmbeddedCredentials(token);
      urls.push(`https://${token}`);
      continue;
    }

    // Localhost with port or path
    if (/^localhost(?::\d+)?(?:\/.*)?$/i.test(token)) {
      refuseEmbeddedCredentials(token);
      urls.push(`https://${token}`);
      continue;
    }

    // Dotted domain with port, path, query, or fragment (MUST have a delimiter, not just React.useEffect)
    if (/^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?::\d+|[/?#])[^\s]*$/i.test(token)) {
      refuseEmbeddedCredentials(token);
      urls.push(`https://${token}`);
      continue;
    }
  }

  // Also catch unspaced punctuation like `lookup(https://docs.example.com?token=123)`
  const embeddedSchemes =
    target.match(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'`()<>[\]{}]+/gi) || [];
  for (const u of embeddedSchemes) {
    refuseEmbeddedCredentials(u);
    if (!urls.includes(u)) urls.push(u);
  }

  return urls;
}

async function defaultResolveHost(hostname) {
  let h = hostname;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (isIP(h)) return [h];
  try {
    const results = await lookup(h, { all: true, verbatim: true });
    return results.map((r) => r.address);
  } catch {
    throw new Error(`Research refused: cannot resolve host "${hostname}". Public HTTP(S) URLs only.`);
  }
}

const MAX_REDIRECT_HOPS = 5;
const RETRIEVAL_TIMEOUT_MS = 10000;
const PRIVATE_DESTINATION = 'Research refused: destination resolves to a private or restricted address.';
const REDIRECT_VERIFY_FAILED = 'Research refused: unable to verify destination redirects.';
const UNSUPPORTED_SCHEME = 'Research refused: unsupported protocol.';
const UNFOLLOWABLE_REDIRECT = 'Research refused: destination redirect has no usable public location.';
const TOO_MANY_REDIRECTS = 'Research refused: too many redirects.';
const RETRIEVAL_TIMEOUT = 'Research refused: retrieval timed out.';

function unpinHost(hostname) {
  let h = hostname || '';
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  return h;
}

function isRefusedMessage(message) {
  return typeof message === 'string' && message.startsWith('Research refused:');
}

// Resolve once and refuse the whole set if any address is private or restricted.
// The caller then connects to exactly one of these addresses, so the address
// that was validated is the address that is actually connected to.
async function resolvePublicAddresses(url, resolveHost) {
  const parsed = new URL(url);
  refuseEmbeddedCredentials(url);
  validatePublicUrl(url);
  const host = unpinHost(parsed.hostname);
  const ips = isIP(host)
    ? [host]
    : await resolveHost(host).catch(() => {
        throw new Error(`Research refused: cannot resolve host "${parsed.hostname}".`);
      });
  if (!ips || !Array.isArray(ips) || ips.length === 0) {
    throw new Error(`Research refused: cannot resolve host "${parsed.hostname}".`);
  }
  for (const ip of ips) {
    if (isPrivateHost(ip) || isPrivateIPv4(ip)) throw new Error(PRIVATE_DESTINATION);
  }
  return { parsed, addresses: ips };
}

// One request to one already-validated hop. The `lookup` hook never consults DNS:
// it returns the pinned address chosen above, so a rebinding answer between the
// check and the connect can never redirect the connection. Redirects are never
// followed automatically; the caller inspects and validates each hop first.
function requestOnce(url, { method, address, timeoutMs = RETRIEVAL_TIMEOUT_MS }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      rejectPromise(new Error(UNSUPPORTED_SCHEME));
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const expectedFamily = isIPv6(address) ? 6 : 4;
    let settled = false;

    const onDone = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (err) rejectPromise(isRefusedMessage(err.message) ? err : new Error(REDIRECT_VERIFY_FAILED));
      else resolvePromise(result);
    };

    let req;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      if (req) req.destroy(new Error(RETRIEVAL_TIMEOUT));
      onDone(new Error(RETRIEVAL_TIMEOUT));
    }, timeoutMs);

    try {
      // A dedicated agent per request: the global (possibly proxy-aware) agent
      // is never consulted, so inherited proxy settings cannot be used.
      const agent =
        parsed.protocol === 'https:'
          ? new https.Agent({ keepAlive: false })
          : new http.Agent({ keepAlive: false });
      const requestOptions = {
        method,
        agent,
        headers: { connection: 'close' },
        // Node 24 requires the array form of the lookup result; the boxed
        // (address, family) form yields "Invalid IP address" and never connects.
        lookup: (_hostname, _options, callback) =>
          callback(null, [{ address, family: expectedFamily }]),
      };
      req = client.request(parsed, requestOptions, (res) => {
        const location = res.headers.location;
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          onDone(null, {
            status: res.statusCode ?? 0,
            headers: res.headers,
            location: Array.isArray(location) ? location[0] : location,
            body: res.statusCode === 200 ? Buffer.concat(chunks).toString('utf8') : undefined,
          });
        });
        res.on('error', (err) => onDone(err));
      });
      req.on('error', (err) => onDone(err));
      req.end();
    } catch {
      onDone(new Error(REDIRECT_VERIFY_FAILED));
    }
  });
}

// The network boundary lives on the retrieval itself: every hop is resolved and
// validated before its connection is opened, and redirects are followed
// manually up to MAX_REDIRECT_HOPS, so a late private redirect is refused
// before any private content is read.
//
// `connectTo` is a test-only seam (never set by production callers): it replaces
// the pinned address with a local listener so the boundary can be exercised
// offline. Validation still runs on the resolved addresses, and the redirect
// hops below are still validated before each connection.
//
// `request` is a test-only seam (never set by production callers): each hop is
// still resolved, validated and re-checked before `request` is asked to
// fetch it, so a test transport cannot widen the boundary.
export async function defaultRetrieve(
  url,
  {
    method = 'GET',
    resolveHost = defaultResolveHost,
    maxHops = MAX_REDIRECT_HOPS,
    connectTo,
    request,
  } = {}
) {
  let current = String(url);
  for (let hops = 0; ; hops++) {
    const { addresses } = await resolvePublicAddresses(current, resolveHost);
    const pinned = connectTo ?? addresses[0];
    const response = request
      ? await request(current, { method, address: pinned })
      : await requestOnce(current, { method, address: pinned });
    const location = response.location;
    if (response.status >= 300 && response.status < 400 && location) {
      if (hops + 1 > maxHops) throw new Error(TOO_MANY_REDIRECTS);
      let next;
      try {
        next = new URL(location, current).href;
      } catch {
        throw new Error(UNFOLLOWABLE_REDIRECT);
      }
      current = next;
      continue;
    }
    return response;
  }
}

const defaultFetchUrl = defaultRetrieve;

async function validateDestinationSafety(
  targetUrl,
  { resolveHost = defaultResolveHost, fetchUrl, retrieve, isFetch = false } = {}
) {
  let current = targetUrl;
  let hops = 0;
  const maxHops = 5;

  let transport = defaultRetrieve;
  let transportResolver;

  if (retrieve) {
    if (typeof retrieve === 'function') {
      transport = retrieve;
    } else if (typeof retrieve === 'object') {
      transport = retrieve.retrieve || defaultRetrieve;
      if (retrieve.resolveEnteredHost) {
        let fn = retrieve.resolveEnteredHost;
        if (typeof fn === 'function') {
          try {
            const maybeFn = fn();
            if (typeof maybeFn === 'function') {
              fn = maybeFn;
            }
          } catch {}
        }
        transportResolver = fn;
      }
    }
  } else if (fetchUrl) {
    transport = async (url, opts) => {
      const resp = await fetchUrl(url, opts);
      return {
        ...resp,
        location: resp?.location || resp?.headers?.location,
      };
    };
  }

  const resolver = transportResolver || resolveHost;

  while (hops <= maxHops) {
    refuseEmbeddedCredentials(current);
    validatePublicUrl(current);
    const parsed = new URL(current);
    let host = parsed.hostname;
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

    let ips;
    if (isIP(host)) {
      ips = [host];
    } else {
      try {
        ips = await resolver(host);
      } catch (err) {
        const msg = err.message || '';
        throw new Error(
          msg.startsWith('Research refused:')
            ? msg
            : `Research refused: cannot resolve host "${parsed.hostname}".`
        );
      }
    }
    if (!ips || !Array.isArray(ips) || ips.length === 0) {
      throw new Error(`Research refused: cannot resolve host "${parsed.hostname}".`);
    }
    for (const ip of ips) {
      if (isPrivateHost(ip) || isPrivateIPv4(ip)) {
        throw new Error('Research refused: destination resolves to a private or restricted address.');
      }
    }

    if (!isFetch) {
      break;
    }

    let resp;
    try {
      resp = await transport(current, { method: 'GET', resolveHost: resolver });
    } catch (err) {
      throw new Error(err.message || 'Research refused: unable to verify destination redirects.');
    }

    // Verify destination IP after retrieval to protect against DNS rebinding
    const postIps = isIP(host) ? [host] : await resolver(host);
    if (postIps && Array.isArray(postIps)) {
      for (const ip of postIps) {
        if (isPrivateHost(ip) || isPrivateIPv4(ip)) {
          throw new Error('Research refused: destination resolves to a private or restricted address.');
        }
      }
    }

    const nextLocation = resp?.location || resp?.headers?.location;
    if (resp && resp.status >= 300 && resp.status < 400 && nextLocation) {
      hops++;
      if (hops > maxHops) {
        throw new Error('Research refused: too many redirects.');
      }
      current = new URL(nextLocation, current).href;
    } else {
      break;
    }
  }
}

async function parse(argv, { resolveHost, fetchUrl, retrieve }) {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let maxChars = 20000;
  try {
    let budgetSeen = false;
    for (let i = 0; i < args.length; i++) {
      if (args[i] !== '--max-chars' && !args[i].startsWith('--max-chars=')) continue;
      const inline = args[i].startsWith('--max-chars=');
      const value = inline ? args[i].slice('--max-chars='.length) : args[i + 1];
      if (budgetSeen || !positiveInteger(value ?? ''))
        throw new Error('Research refused: --max-chars requires one positive safe integer.');
      budgetSeen = true;
      maxChars = Number(value);
      args.splice(i--, inline ? 1 : 2);
    }
    const [channel, action, ...rest] = args;
    const policy = ACTIONS.get(`${channel} ${action}`);
    if (!policy)
      throw new Error(
        'Research refused: only web/github/reddit read/search and youtube transcript are allowed. Usage: pnpm ai:research -- <channel> <action> <target or query> [--max-chars N]'
      );
    const words = [],
      options = [];
    for (let i = 0; i < rest.length; i++) {
      const value = rest[i];
      if (/[\x00-\x1f\x7f]/.test(value))
        throw new Error('Research refused: control characters in arguments.');
      if (!value.startsWith('-')) {
        words.push(value);
        continue;
      }
      const next = rest[++i];
      if (
        (value === '--limit' && action === 'search' && positiveInteger(next ?? '')) ||
        (value === '--lang' &&
          action === 'transcript' &&
          /^[A-Za-z][A-Za-z0-9,-]*$/.test(next ?? ''))
      ) {
        if (options.includes(value)) throw new Error('Research refused: duplicate option.');
        options.push(value, next);
      } else
        throw new Error(
          'Research refused: unsupported option; login, credentials and backend overrides are prohibited.'
        );
    }
    const target = words.join(' ').trim();
    if (!target || (action !== 'search' && words.length !== 1))
      throw new Error('Research refused: supply a query or one public target.');
    // Search text may contain URLs alongside prose. Read targets also accept
    // upstream's schemeless forms, which still must not carry credentials.
    const urls = [];
    if (action === 'search') {
      urls.push(...extractSearchUrls(target));
    } else {
      if (channel === 'github' && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(target)) {
        // Safe GitHub repository path (owner/repo)
      } else if (channel === 'youtube' && /^[a-zA-Z0-9_-]{11}$/.test(target)) {
        // Safe YouTube 11-char video ID
      } else {
        refuseEmbeddedCredentials(target);
        urls.push(target.includes('://') ? target : `https://${target}`);
      }
    }
    for (const candidate of urls) {
      await validateDestinationSafety(candidate, {
        resolveHost,
        fetchUrl,
        retrieve,
        isFetch: action !== 'search',
      });
    }
    return {
      maxChars,
      action,
      channel,
      urls,
      cliArgs: [channel, policy[0], target, ...options, '--backend', policy[1]],
    };
  } catch (error) {
    error.maxChars = maxChars;
    throw error;
  }
}

function isolatedEnv(parent, directory) {
  const env = {};
  for (const [key, value] of Object.entries(parent)) {
    if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TMP|TEMP)$/i.test(key)) env[key] = value;
  }
  // Agent-Reach v1.6.1 home_dir() explicitly honors child HOME on Windows.
  // No process-global home/settings are changed; only this CLI sees the temp home.
  return {
    ...env,
    HOME: directory,
    USERPROFILE: directory,
    APPDATA: directory,
    LOCALAPPDATA: directory,
    XDG_CONFIG_HOME: directory,
    XDG_CACHE_HOME: directory,
    XDG_DATA_HOME: directory,
    XDG_STATE_HOME: directory,
    PYTHONIOENCODING: 'utf-8',
  };
}

function safeDecode(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    try {
      return str.replace(/%([0-9a-fA-F]{2})/g, (m, hex) => {
        try {
          return String.fromCharCode(parseInt(hex, 16));
        } catch {
          return m;
        }
      });
    } catch {
      return str;
    }
  }
}

function sanitizeUrlInText(text) {
  return text.replace(
    /https?:\/\/(?:\[[a-fA-F0-9:.]+\](?::\d+)?(?:[^\s"'`()<>[\]{}]*)?|[^\s"'`()<>[\]{}]+)/gi,
    (rawUrl) => {
      try {
        const u = new URL(rawUrl);
        let modified = false;
        for (const [key] of [...u.searchParams.entries()]) {
          let decodedKey;
          try {
            decodedKey = safeDecode(key).replace(/\s+/g, '_');
          } catch {
            decodedKey = key;
          }
          if (SENSITIVE.test(key) || SENSITIVE.test(decodedKey)) {
            u.searchParams.set(key, '[REDACTED]');
            modified = true;
          }
        }
        if (u.hash && u.hash.length > 1) {
          const rawHash = u.hash.slice(1);
          const hashQ = rawHash.includes('?') ? rawHash.slice(rawHash.indexOf('?') + 1) : rawHash;
          const prefix = rawHash.includes('?') ? rawHash.slice(0, rawHash.indexOf('?') + 1) : '';
          if (hashQ.includes('=')) {
            const hp = new URLSearchParams(hashQ);
            let hashModified = false;
            for (const [key] of [...hp.entries()]) {
              let decodedKey;
              try {
                decodedKey = safeDecode(key).replace(/\s+/g, '_');
              } catch {
                decodedKey = key;
              }
              if (SENSITIVE.test(key) || SENSITIVE.test(decodedKey)) {
                hp.set(key, '[REDACTED]');
                hashModified = true;
              }
            }
            if (hashModified) {
              u.hash = '#' + prefix + hp.toString().replace(/%5BREDACTED%5D/gi, '[REDACTED]');
              modified = true;
            }
          }
        }
        if (modified) {
          return u.toString().replace(/%5BREDACTED%5D/gi, '[REDACTED]');
        }
      } catch {}
      return rawUrl;
    }
  );
}

function redact(value, envValues = []) {
  if (Array.isArray(value)) return value.map((item) => redact(item, envValues));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        redact(key, envValues),
        SENSITIVE.test(key) ? '[REDACTED]' : redact(item, envValues),
      ])
    );
  if (typeof value !== 'string') return value;
  let text = sanitizeUrlInText(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\b(?:set-cookie|cookie|authorization)\s*:\s*[^\n]+/gi, '[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[^\s"<>]+/gi, '$1 [REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(
      /((?:(?<=[?&"'\s]|^)(?:(?:[a-z0-9_-]+[_-])?(?:token|key|sig(?:nature)?|secret(?:[_-]?key)?)|(?:%[0-9a-fA-F]{2})+[a-z0-9_-]*|api[_-]?key|access[_-]?key|client[_-]?secret|session(?:[_-]?id)?|password|passwd|auth(?:orization)?|credential|cookies?)\b)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s&;,"'<>]+)/gi,
      '$1[REDACTED]'
    )
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g, '[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{82}\b/g, '[REDACTED]')
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\s*=\s*[^\n]+/g, '[REDACTED]');
  for (const secret of envValues) {
    // Short values match whole words so an environment value such as "1"
    // cannot destroy every occurrence of that digit within public URLs.
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

function truncate(text, budget) {
  if (text.length <= budget) return text;
  const notice = '\n[truncated]\n';
  let prefix = text.slice(0, Math.max(0, budget - notice.length));
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return prefix + notice.slice(0, budget);
}

// Explicit executable injection is for offline tests; CLI users cannot override
// the production binary or environment through arguments or environment flags.
export async function runResearch(
  argv,
  {
    binary = 'agent-reach',
    prefixArgs = [],
    command,
    env = process.env,
    resolveHost = defaultResolveHost,
    fetchUrl = defaultFetchUrl,
    retrieve,
    // Test-only seam: pin the retrieval connection to a local listener while the
    // resolver still validates the public addresses. Never used in production.
    connectTo,
    // Test-only seam: answer the in-process read retrieval offline. The read
    // boundary (resolve, reject private, re-validate every redirect hop) is
    // still the code under test; only the final socket connect is replaced.
    fetchText,
  } = {}
) {
  const envValues = [
    ...new Set(
      Object.entries(env)
        .filter(
          ([k, value]) =>
            SENSITIVE_ENV.test(k) &&
            typeof value === 'string' &&
            value.length > 0 &&
            !NON_SECRET_ENV_VALUES.has(value.toLowerCase().trim())
        )
        .map(([, v]) => v)
    ),
  ].sort((a, b) => b.length - a.length);

  let request;
  try {
    request = await parse(argv, { resolveHost, fetchUrl, retrieve });
  } catch (error) {
    return refused(redact(error.message, envValues), error.maxChars);
  }
  const fail = (message) => ({
    code: 1,
    exitCode: 1,
    stdout: '',
    stderr: truncate(`${redact(message, envValues)}\n`, request.maxChars),
  });
  let directory;
  let researchTempRoot;
  try {
    researchTempRoot = realpathSync(tmpdir());
    directory = mkdtempSync(join(researchTempRoot, 'shipde-research-'));
    const childEnv = isolatedEnv(env, directory);
    const launch = command ?? [binary, ...prefixArgs];
    const invoke = (args) =>
      spawnSync(launch[0], [...launch.slice(1), ...args], {
        encoding: 'utf8',
        env: childEnv,
        cwd: directory,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 45000,
        maxBuffer: 8 * 1024 * 1024,
      });
    const version = invoke(['version']);
    if (version.error?.code === 'ENOENT')
      return fail(
        `agent-reach is missing. Install only the operator-approved GitHub source:\n${INSTALL_HINT}`
      );
    let metadata;
    try {
      metadata = JSON.parse(version.stdout);
    } catch {
      return fail(`Research refused: cannot verify Agent-Reach v${VERSION}.\n${INSTALL_HINT}`);
    }
    if (
      version.error ||
      version.status !== 0 ||
      metadata?.ok !== true ||
      metadata.result?.version !== VERSION
    )
      return fail(`Research refused: Agent-Reach v${VERSION} is required.\n${INSTALL_HINT}`);
    if (request.urls && request.urls.length > 0) {
      for (const candidate of request.urls) {
        try {
          await validateDestinationSafety(candidate, {
            resolveHost,
            fetchUrl,
            retrieve,
            isFetch: request.action !== 'search',
          });
        } catch (err) {
          return fail(redact(err.message, envValues));
        }
      }
    }
    // Read targets are retrieved in-process so the public-destination boundary
    // is enforced on the retrieval connection itself (pinned address, manual
    // redirects, per-hop re-validation). The CLI never re-fetches that URL.
    let fetched;
    if (request.action !== 'search' && request.urls && request.urls.length > 0) {
      try {
        fetched = await defaultRetrieve(request.urls[0], { resolveHost, connectTo, request: fetchText });
      } catch (err) {
        return fail(redact(err.message || 'Research refused: unable to retrieve.', envValues));
      }
      if (fetched.status !== 200) {
        return fail(
          'Research refused: public access failed (UPSTREAM_ERROR). Use another public source; no login or automatic retry.'
        );
      }
    }
    const result = invoke(request.cliArgs);
    if (result.error || result.signal)
      return fail('Research refused: Agent-Reach failed or exceeded its timeout/output buffer.');
    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      return fail('Research refused: malformed Agent-Reach output; raw diagnostics suppressed.');
    }
    if (!payload || typeof payload.ok !== 'boolean')
      return fail('Research refused: invalid Agent-Reach response.');
    // For read targets the CLI is only a post-processor: its own item content is
    // discarded and replaced with the text this process already fetched under
    // the boundary, so any transport the CLI performed can never surface. A
    // payload that failed or a non-zero child exit stays a failure: an exit
    // status never turns an upstream failure into successful research.
    if (fetched && (payload.ok !== true || result.status !== 0)) {
      const errorCode = PUBLIC_ERROR_CODES.has(payload.error?.code)
        ? payload.error.code
        : 'UPSTREAM_ERROR';
      return fail(
        `Research refused: public access failed (${errorCode}). Use another public source; no login or automatic retry.`
      );
    }
    // Only a read produces its content through this in-process fetch. A subtitle
    // transcript is the CLI's own post-processed result and must survive: the
    // fetch above only proves the watch-page destination is public.
    if (fetched && request.cliArgs[1] === 'read') {
      const processed =
        Array.isArray(payload.items) && payload.items.length > 0 ? payload.items[0] : {};
      payload = {
        ...payload,
        ok: true,
        items: [
          {
            title: typeof processed.title === 'string' ? processed.title : '',
            url: request.urls[0],
            text: fetched.body ?? '',
          },
        ],
      };
    }
    if (Array.isArray(payload?.items)) {
      for (const item of payload.items) {
        if (item?.url && typeof item.url === 'string') {
          try {
            const itemUrl = new URL(item.url);
            if (isPrivateHost(itemUrl.hostname)) {
              return fail('Research refused: response points to a private destination.');
            }
          } catch {}
        }
      }
    }
    if (/LOGIN|AUTH|NEED_SETUP/i.test(payload.error?.code ?? ''))
      return fail(
        'Research refused: this request needs login or account/tool setup. No operator account may be used.'
      );
    if (!payload.ok || result.status !== 0) {
      const errorCode = PUBLIC_ERROR_CODES.has(payload.error?.code)
        ? payload.error.code
        : 'UPSTREAM_ERROR';
      return fail(
        `Research refused: public access failed (${errorCode}). Use another public source; no login or automatic retry.`
      );
    }
    const combinedEnvValues = [
      ...new Set(
        [
          ...envValues,
          ...Object.entries(childEnv)
            .filter(
              ([k, value]) =>
                SENSITIVE_ENV.test(k) &&
                typeof value === 'string' &&
                value.length > 0 &&
                !NON_SECRET_ENV_VALUES.has(value.toLowerCase().trim())
            )
            .map(([, v]) => v),
        ]
      ),
    ].sort((a, b) => b.length - a.length);
    return {
      code: 0,
      exitCode: 0,
      stdout: truncate(
        JSON.stringify(redact(payload, combinedEnvValues), null, 2) + '\n',
        request.maxChars
      ),
      stderr: '',
    };
  } catch {
    return fail('Research refused: unable to run Agent-Reach safely; raw diagnostics suppressed.');
  } finally {
    try {
      if (
        directory &&
        dirname(resolve(directory)) === researchTempRoot &&
        basename(directory).startsWith('shipde-research-')
      ) {
        rmSync(directory, { recursive: true, force: true });
      }
    } catch {
      /* Suppress raw filesystem diagnostics. */
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runResearch(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
