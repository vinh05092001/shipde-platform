#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
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
  /(?:cookie|token|secret|password|passwd|authorization|auth|credential|environment|^env$|(?:^|[_-])(?:key|sig(?:nature)?)(?:[_-]|$))/i;
// Only values of credential-shaped variables are scrubbed verbatim; scrubbing
// every inherited value would corrupt ordinary output (e.g. the word "true").
const SENSITIVE_ENV =
  /(?:cookie|token|secret|password|passwd|authorization|auth|credential|private|proxy|api[_-]?key|access[_-]?key|(?:^|[_-])(?:key|sig(?:nature)?)(?:[_-]|$))/i;
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
  if (isIP(hostname)) return [hostname];
  try {
    const results = await lookup(hostname, { all: true, verbatim: true });
    return results.map((r) => r.address);
  } catch {
    throw new Error(`Research refused: cannot resolve host "${hostname}". Public HTTP(S) URLs only.`);
  }
}

async function defaultRetrieve(url, { method = 'GET' } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
    });
    return {
      status: res.status,
      headers: {
        location: res.headers.get('location'),
      },
      location: res.headers.get('location'),
      body: res.status === 200 ? await res.text().catch(() => '') : undefined,
    };
  } catch {
    throw new Error('Research refused: unable to verify destination redirects.');
  } finally {
    clearTimeout(timeoutId);
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

    const ips = await resolver(parsed.hostname);
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
      resp = await transport(current, { method: 'GET' });
    } catch (err) {
      throw new Error(err.message || 'Research refused: unable to verify destination redirects.');
    }

    // Verify destination IP after retrieval to protect against DNS rebinding
    const postIps = await resolver(parsed.hostname);
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
    return { maxChars, cliArgs: [channel, policy[0], target, ...options, '--backend', policy[1]] };
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

function sanitizeUrlInText(text) {
  return text.replace(/https?:\/\/[^\s"'`()<>[\]{}]+/gi, (rawUrl) => {
    try {
      const u = new URL(rawUrl);
      let modified = false;
      for (const [key] of [...u.searchParams.entries()]) {
        const decodedKey = decodeURIComponent(key).replace(/\s+/g, '_');
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
            const decodedKey = decodeURIComponent(key).replace(/\s+/g, '_');
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
  });
}

function redact(value, envValues) {
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
      /((?:(?<=[?&"'\s]|^)(?:(?:[a-z0-9_-]+[_-])?(?:token|key|sig(?:nature)?)|api[_-]?key|access[_-]?key|password|passwd|auth(?:orization)?|credential|secret(?:[_-]?key)?|cookies?)\b)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s&;,"'<>]+)/gi,
      '$1[REDACTED]'
    )
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
  } = {}
) {
  let request;
  try {
    request = await parse(argv, { resolveHost, fetchUrl, retrieve });
  } catch (error) {
    return refused(error.message, error.maxChars);
  }
  const fail = (message) => ({
    code: 1,
    exitCode: 1,
    stdout: '',
    stderr: truncate(`${message}\n`, request.maxChars),
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
    const envValues = [
      ...new Set(
        [...Object.values(env), ...Object.values(childEnv)].filter(
          (value) =>
            typeof value === 'string' &&
            value.length > 0 &&
            !NON_SECRET_ENV_VALUES.has(value.toLowerCase().trim())
        )
      ),
    ].sort((a, b) => b.length - a.length);
    return {
      code: 0,
      exitCode: 0,
      stdout: truncate(
        JSON.stringify(redact(payload, envValues), null, 2) + '\n',
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
