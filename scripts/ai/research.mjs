#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
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
  /cookie|token|secret|password|passwd|authorization|auth|credential|api[_-]?key|access[_-]?key|environment|^env$/i;
// Only values of credential-shaped variables are scrubbed verbatim; scrubbing
// every inherited value would corrupt ordinary output (e.g. the word "true").
const SENSITIVE_ENV =
  /cookie|token|secret|password|passwd|authorization|auth|credential|private|proxy|api[_-]?key|access[_-]?key/i;
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
    throw new Error('Research refused: public HTTP(S) URLs without credentials only.');
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

function parse(argv) {
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
      for (const token of target.split(/\s+/)) {
        if (token.includes('://')) {
          urls.push(token);
        } else if (
          /^(?:[^\s:@]+:[^\s:@]+@)?(?:(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|(?:\d{1,3}\.){3}\d{1,3}|localhost|\[[a-fA-F0-9:]+\])(?::\d+)?(?:\/[^\s]*)?(?:\?[^\s]*)?(?:#[^\s]*)?$/i.test(
            token
          )
        ) {
          urls.push(`https://${token}`);
        }
      }
    } else {
      if (channel === 'github' && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(target)) {
        // Safe GitHub repository path (owner/repo)
      } else if (channel === 'youtube' && /^[a-zA-Z0-9_-]{11}$/.test(target)) {
        // Safe YouTube 11-char video ID
      } else {
        urls.push(target.includes('://') ? target : `https://${target}`);
      }
    }
    for (const candidate of urls) {
      validatePublicUrl(candidate);
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
  let text = value
    .replace(/\r\n?/g, '\n')
    .replace(/\b(?:set-cookie|cookie|authorization)\s*:\s*[^\n]+/gi, '[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[^\s"<>]+/gi, '$1 [REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(
      /((?:token|api[_-]?key|access[_-]?key|password|passwd|auth(?:orization)?|credential|secret(?:[_-]?key)?|cookies?)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s&;,"'<>]+)/gi,
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
export function runResearch(
  argv,
  { binary = 'agent-reach', prefixArgs = [], command, env = process.env } = {}
) {
  let request;
  try {
    request = parse(argv);
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
  const result = runResearch(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
