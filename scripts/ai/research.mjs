#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPublicTarget,
  collectSecrets,
  isPrivateDestination,
  redact,
  retrieve as defaultRetrieve,
  scanQueryForUnsafeUrls,
  truncate,
} from './research-safety.mjs';

const VERSION = '1.6.1';
const INSTALL_HINT = `uv tool install https://github.com/Panniantong/Agent-Reach/releases/download/v${VERSION}/agent-reach.zip\nSee https://github.com/Panniantong/Agent-Reach/blob/v${VERSION}/docs/install.md. Never install agent-reach from PyPI.\n`;
const ACTIONS = new Map([
  ['web read', ['read', 'jina']],
  ['web search', ['search', 'exa']],
  ['github read', ['read', 'github-api']],
  ['github search', ['search', 'github-api']],
  ['reddit read', ['read', 'public-web']],
  ['reddit search', ['search', 'public-web']],
  ['youtube transcript', ['subtitle', 'yt-dlp']],
]);
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
const DEFAULT_BUDGET = 20000;
const positiveInteger = (value) =>
  /^\d+$/.test(value ?? '') && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function refusal(message, budget = DEFAULT_BUDGET) {
  return { code: 1, exitCode: 1, stdout: '', stderr: truncate(`${message}\n`, budget) };
}

function parse(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let maxChars = DEFAULT_BUDGET;
  let budgetSeen = false;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg !== '--max-chars' && !arg.startsWith('--max-chars=')) {
      rest.push(arg);
      continue;
    }
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : args[++i];
    if (budgetSeen || !positiveInteger(value)) {
      throw new Error('Research refused: --max-chars requires one positive safe integer.');
    }
    budgetSeen = true;
    maxChars = Number(value);
  }
  const [channel, action, ...wordsAndOptions] = rest;
  const policy = ACTIONS.get(`${channel} ${action}`);
  if (!policy) {
    throw new Error(
      'Research refused: only web/github/reddit read/search and youtube transcript are allowed. Usage: pnpm ai:research -- <channel> <action> <target or query> [--max-chars N]'
    );
  }
  const words = [];
  const options = [];
  for (let i = 0; i < wordsAndOptions.length; i++) {
    const value = wordsAndOptions[i];
    if (/[\x00-\x1f\x7f]/.test(value)) {
      throw new Error('Research refused: control characters in arguments.');
    }
    if (!value.startsWith('-')) {
      words.push(value);
      continue;
    }
    const next = wordsAndOptions[++i];
    const allowed =
      (value === '--limit' && action === 'search' && positiveInteger(next)) ||
      (value === '--lang' && action === 'transcript' && /^[A-Za-z][A-Za-z0-9,-]*$/.test(next ?? ''));
    if (!allowed || options.includes(value)) {
      throw new Error(
        'Research refused: unsupported option; login, credentials and backend overrides are prohibited.'
      );
    }
    options.push(value, next);
  }
  const target = words.join(' ').trim();
  if (!target || (action !== 'search' && words.length !== 1)) {
    throw new Error('Research refused: supply a query or one public target.');
  }
  const urls = [];
  if (action === 'search') {
    scanQueryForUnsafeUrls(target);
  } else if (channel === 'github' && /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(target)) {
    // Public repository path: the CLI contacts the fixed GitHub API.
  } else if (channel === 'youtube' && /^[a-zA-Z0-9_-]{11}$/.test(target)) {
    // Public video id: yt-dlp contacts the fixed YouTube service.
  } else if (channel === 'youtube') {
    const url = assertPublicTarget(target);
    if (!/(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname)) {
      throw new Error('Research refused: youtube transcript requires a public YouTube URL or id.');
    }
    urls.push(url.href);
  } else {
    urls.push(assertPublicTarget(target).href);
  }
  return {
    maxChars,
    action,
    channel,
    urls,
    cliArgs: [channel, policy[0], target, ...options, '--backend', policy[1]],
  };
}

function isolatedEnv(parent, home) {
  const env = {};
  for (const [key, value] of Object.entries(parent)) {
    if (/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TMP|TEMP)$/i.test(key)) env[key] = value;
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    PYTHONIOENCODING: 'utf-8',
  };
}

function ok(payload, budget, secrets) {
  return {
    code: 0,
    exitCode: 0,
    stdout: truncate(JSON.stringify(redact(payload, secrets), null, 2) + '\n', budget),
    stderr: '',
  };
}

export async function runResearch(
  argv,
  { binary = 'agent-reach', prefixArgs = [], command, env = process.env, retrieve = defaultRetrieve } = {}
) {
  const parentSecrets = collectSecrets(env);
  let request;
  try {
    request = parse(argv);
  } catch (error) {
    return refusal(redact(error.message, parentSecrets));
  }
  const fail = (message) => refusal(redact(message, parentSecrets), request.maxChars);
  let directory;
  try {
    directory = mkdtempSync(join(tmpdir(), 'shipde-research-'));
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
    if (version.error?.code === 'ENOENT') {
      return fail(
        `agent-reach is missing. Install only the operator-approved GitHub source:\n${INSTALL_HINT}`
      );
    }
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
    ) {
      return fail(`Research refused: Agent-Reach v${VERSION} is required.\n${INSTALL_HINT}`);
    }
    let fetched;
    if (request.urls.length > 0) {
      try {
        fetched = await retrieve(request.urls[0]);
      } catch (error) {
        return fail(error.message);
      }
      if (fetched.status !== 200) {
        return fail(
          'Research refused: public access failed (UPSTREAM_ERROR). Use another public source; no login or automatic retry.'
        );
      }
    }
    const inProcessRead = request.action === 'read' && request.channel !== 'github';
    if (inProcessRead) {
      return ok(
        {
          ok: true,
          items: [{ title: '', url: request.urls[0], text: fetched?.body ?? '' }],
        },
        request.maxChars,
        [...parentSecrets, ...collectSecrets(childEnv)]
      );
    }
    const result = invoke(request.cliArgs);
    if (result.error || result.signal) {
      return fail('Research refused: Agent-Reach failed or exceeded its timeout/output buffer.');
    }
    let payload;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      return fail('Research refused: malformed Agent-Reach output; raw diagnostics suppressed.');
    }
    if (!payload || typeof payload.ok !== 'boolean') {
      return fail('Research refused: invalid Agent-Reach response.');
    }
    if (/LOGIN|AUTH|NEED_SETUP/i.test(payload.error?.code ?? '')) {
      return fail(
        'Research refused: this request needs login or account/tool setup. No operator account may be used.'
      );
    }
    if (!payload.ok || result.status !== 0) {
      const code = PUBLIC_ERROR_CODES.has(payload.error?.code)
        ? payload.error.code
        : 'UPSTREAM_ERROR';
      return fail(
        `Research refused: public access failed (${code}). Use another public source; no login or automatic retry.`
      );
    }
    for (const item of Array.isArray(payload.items) ? payload.items : []) {
      if (typeof item?.url === 'string') {
        try {
          if (isPrivateDestination(new URL(item.url).hostname)) {
            return fail('Research refused: response points to a private destination.');
          }
        } catch {
          /* Untrusted URL text is redacted below, not fetched. */
        }
      }
    }
    return ok(payload, request.maxChars, [...parentSecrets, ...collectSecrets(childEnv)]);
  } catch {
    return fail('Research refused: unable to run Agent-Reach safely; raw diagnostics suppressed.');
  } finally {
    try {
      if (directory) rmSync(directory, { recursive: true, force: true });
    } catch {
      /* Suppress raw filesystem diagnostics. */
    }
  }
}

function isEntryPoint() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  const result = await runResearch(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
