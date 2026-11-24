'use strict';

/**
 * Ship Dễ — 9router combo configuration reader (extracted from writer-combo.js, TASK-AI-192).
 *
 * Read-only GET /api/combos client and fixture reader used by intake, cli/dispatch,
 * and combo-member selection — without pulling in legacy combo-sync or priors code.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

function resolveEndpoint(opts = {}) {
  let endpoint = opts.endpoint;
  if (!endpoint) {
    try {
      const sourcesApi = require('./sources');
      const reg = opts.registry || (sourcesApi.loadSources ? sourcesApi.loadSources() : null);
      const src = (reg?.sources || []).find((s) => s.id === '9router' || s.kind === 'router');
      endpoint = src?.endpoint;
    } catch {}
  }
  if (!endpoint) {
    const protocol = opts.protocol ? String(opts.protocol).toLowerCase() : null;
    const defaultPort = protocol === 'https:' ? 443 : protocol === 'http:' ? 80 : null;
    return {
      protocol,
      host: opts.host || null,
      port: opts.port ? Number(opts.port) : defaultPort,
    };
  }
  try {
    const url = new URL(endpoint);
    const protocol = (opts.protocol || url.protocol || '').toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') {
      return { protocol: null, host: null, port: null };
    }
    const defaultPort = protocol === 'https:' ? 443 : 80;
    return {
      protocol,
      host: opts.host || url.hostname,
      port: opts.port ? Number(opts.port) : url.port ? Number(url.port) : defaultPort,
    };
  } catch {
    return { protocol: null, host: null, port: null };
  }
}

function resolveComboName(opts = {}) {
  if (opts.name) return opts.name;
  try {
    const sourcesApi = require('./sources');
    const reg = opts.registry || (sourcesApi.loadSources ? sourcesApi.loadSources() : null);
    const dispatch = reg?.dispatch || {};
    return dispatch.nineRouterWriterCombo || dispatch.writerCombo || null;
  } catch {
    return null;
  }
}

const DEFAULT_COMBO_NAME = resolveComboName();
const CLI_TOKEN_SALT = '9r-cli-auth';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const REQUEST_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_SOCKET_CLOSED',
  'ABORT_ERR',
]);

function classifyRequestErrorCode(err) {
  const code = err && typeof err.code === 'string' ? err.code : '';
  return REQUEST_ERROR_CODES.has(code) ? code : 'UNKNOWN';
}

function assertLoopbackHost(host) {
  const norm = String(host || '')
    .trim()
    .toLowerCase();
  if (!LOOPBACK_HOSTS.has(norm)) {
    throw new Error(
      'NON_LOOPBACK_HOST: 9router combo sync is only permitted to loopback hosts; got ' + host
    );
  }
}

function get9routerDataDir() {
  if (process.env.NINEROUTER_DATA_DIR) return process.env.NINEROUTER_DATA_DIR;
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
      '9router'
    );
  }
  return path.join(require('os').homedir(), '.9router');
}

function loadCliToken() {
  const dataDir = get9routerDataDir();
  const machineIdFile = path.join(dataDir, 'machine-id');
  const secretFile = path.join(dataDir, 'auth', 'cli-secret');

  let rawMachineId = '';
  try {
    rawMachineId = fs.readFileSync(machineIdFile, 'utf8').trim();
  } catch {}

  let secret = '';
  try {
    secret = fs.readFileSync(secretFile, 'utf8').trim();
  } catch {}

  if (!secret) return '';

  if (rawMachineId) {
    return crypto
      .createHash('sha256')
      .update(rawMachineId + CLI_TOKEN_SALT + secret)
      .digest('hex')
      .substring(0, 16);
  }

  return secret;
}

function httpRequest({
  host,
  port,
  protocol,
  path: reqPath,
  method,
  headers,
  body,
  endpoint,
  registry,
  signal,
  transport: injectedTransport,
  httpTransport = http,
  httpsTransport = https,
}) {
  const resolved = resolveEndpoint({ host, port, protocol, endpoint, registry });
  if (!resolved.host || !resolved.port || !resolved.protocol) {
    return Promise.reject(
      new Error('CONFIG_MISSING: 9router host, port, and valid protocol are required')
    );
  }
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return Promise.reject(
      new Error(`INVALID_PROTOCOL: Only http: and https: are supported, got ${resolved.protocol}`)
    );
  }
  const hasInjectedTransport =
    Boolean(injectedTransport) || httpTransport !== http || httpsTransport !== https;
  if (!hasInjectedTransport) {
    try {
      assertLoopbackHost(resolved.host);
    } catch (err) {
      return Promise.reject(err);
    }
  }
  const transport =
    injectedTransport || (resolved.protocol === 'https:' ? httpsTransport : httpTransport);
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (payload && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = transport.request(
      {
        protocol: resolved.protocol,
        hostname: resolved.host,
        port: resolved.port,
        path: reqPath,
        method: method || 'GET',
        headers: reqHeaders,
        signal,
        ...(hasInjectedTransport ? {} : { agent: false }),
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, data: json, raw: data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function resolveComboConfig(opts) {
  const name = opts?.nineRouterWriterCombo ?? resolveComboName(opts || {});
  const config = opts?.nineRouterComboConfig;
  return config?.name === name ? config : null;
}

function resolveComboMembers(opts) {
  const config = resolveComboConfig(opts);
  if (opts?.nineRouterComboConfig && !config) return [];
  if (Array.isArray(config?.members)) return config.members;
  if (Array.isArray(opts?.nineRouterComboMembers)) return opts.nineRouterComboMembers;
  return [];
}

// GET only. Returns names and member IDs, never the admin token or a raw body.
async function readComboConfig(opts = {}) {
  const name = resolveComboName(opts);
  const env = opts.env || process.env;
  const fixtureDir =
    opts.fixtureDir || (opts.env && opts.env.SHIPDE_FIXTURE_DIR) || env.SHIPDE_FIXTURE_DIR;
  const fixture =
    opts.comboFixture ||
    opts.comboConfigFixture ||
    opts.fixture ||
    (opts.env && opts.env.SHIPDE_COMBO_FIXTURE) ||
    env.SHIPDE_COMBO_FIXTURE ||
    (fixtureDir ? path.join(fixtureDir, 'combos.json') : undefined);

  if (fixture) {
    let raw;
    if (typeof fixture === 'object') {
      raw = fixture;
    } else {
      const fsMod = opts.fs || fs;
      try {
        raw = JSON.parse(fsMod.readFileSync(fixture, 'utf8'));
      } catch {
        return {
          name,
          members: null,
          state: 'COMBO_CONFIG_UNAVAILABLE',
          status: 'FIXTURE_READ_FAILED',
        };
      }
    }
    let combo = null;
    if (raw && Array.isArray(raw.combos)) {
      combo = name ? raw.combos.find((c) => c && c.name === name) || null : raw.combos[0] || null;
    } else if (Array.isArray(raw)) {
      combo = name ? raw.find((c) => c && c.name === name) || null : raw[0] || null;
    } else if (raw && typeof raw === 'object') {
      if (name && raw.name && raw.name !== name) {
        combo = null;
      } else {
        combo = raw;
      }
    }
    const resolvedName = name || combo?.name || null;
    if (!combo) {
      return {
        name: resolvedName,
        members: null,
        state: 'COMBO_CONFIG_UNAVAILABLE',
        status: 'COMBO_NOT_FOUND',
      };
    }
    const members = (combo.members || combo.models || []).filter((m) => typeof m === 'string');
    return {
      name: resolvedName,
      state: combo.state || (members.length ? 'READ' : 'EMPTY'),
      strategy: combo.strategy || 'UNKNOWN',
      members,
      readVia:
        opts.readVia ||
        combo.readVia ||
        (typeof fixture === 'string' ? `fixture:${fixture}` : 'fixture'),
      readAt: combo.readAt || new Date().toISOString(),
    };
  }

  const resolved = resolveEndpoint(opts);
  if (!name || !resolved.host || !resolved.port || !resolved.protocol) {
    throw new Error('CONFIG_MISSING: combo name and 9router endpoint are required');
  }
  const unavailable = (status, error) => ({
    name,
    members: null,
    state: 'COMBO_CONFIG_UNAVAILABLE',
    status,
    ...(error ? { error } : {}),
  });
  const cliToken = (opts.loadCliToken || loadCliToken)();
  let res;
  try {
    res = await (opts.httpRequest || httpRequest)({
      host: resolved.host,
      port: resolved.port,
      protocol: resolved.protocol,
      path: '/api/combos',
      method: 'GET',
      signal: opts.signal,
      headers: cliToken ? { 'x-9r-cli-token': cliToken } : {},
    });
  } catch (err) {
    return unavailable('REQUEST_FAILED', classifyRequestErrorCode(err));
  }
  if (res.status !== 200 || !res.data) return unavailable(res.status);
  const combo = (res.data.combos || []).find((c) => c && c.name === name);
  if (!combo) return unavailable('COMBO_NOT_FOUND');
  const members = (combo.models || []).filter((m) => typeof m === 'string');
  return {
    name,
    state: members.length ? 'READ' : 'EMPTY',
    strategy: combo.strategy || 'UNKNOWN',
    members,
    readVia: 'GET /api/combos',
    readAt: new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_COMBO_NAME,
  resolveEndpoint,
  resolveComboName,
  assertLoopbackHost,
  loadCliToken,
  httpRequest,
  resolveComboConfig,
  resolveComboMembers,
  readComboConfig,
};
