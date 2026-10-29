'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { loadPriors, priorFor } = require('./priors');
const evidenceApi = require('./evidence');

const DEFAULT_COMBO_NAME = 'shipde-writer';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 20128;
const CLI_TOKEN_SALT = '9r-cli-auth';

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

  // If machine-id is available, 9router uses sha256(machineId + '9r-cli-auth' + secret).substring(0, 16)
  if (rawMachineId) {
    return crypto
      .createHash('sha256')
      .update(rawMachineId + CLI_TOKEN_SALT + secret)
      .digest('hex')
      .substring(0, 16);
  }

  // Fallback if no machine-id file
  return secret;
}

function extractModelId(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw.replace(/^ninerouter\//i, '').trim();
}

/**
 * Filter 9router models that are in the live listing AND have tools.ok proof,
 * ordered by benchmark score desc (unknown last, then by id asc).
 *
 * @param {Array<string|object>} listing Live 9router models (from /v1/models)
 * @param {object} evidenceData Loaded evidence store
 * @param {object} priorsData Loaded priors
 * @param {number} [now] Current timestamp
 * @returns {string[]} Ordered 9router model IDs
 */
function buildWriterComboModels(listing, evidenceData, priorsData, now = Date.now()) {
  const liveListingSet = new Set(
    (listing || [])
      .map((m) => (typeof m === 'string' ? m : m?.id || m?.model || m?.modelId))
      .filter(Boolean)
      .map(extractModelId)
  );

  const provedModels = new Set();
  const probes = (evidenceData && evidenceData.capabilityProbes) || {};

  for (const [key, probe] of Object.entries(probes)) {
    if (!probe || !probe.tools || probe.tools.ok !== true) continue;
    const parts = String(key).split('::');
    const endpoint = parts[1] || '';
    const gateway = parts[2] || '';
    const rawModel = parts[parts.length - 1] || '';

    const is9router =
      gateway === '9router' ||
      gateway === 'ninerouter' ||
      gateway === 'opencode-provider-ninerouter-options';

    if (!is9router) continue;

    const modelId = extractModelId(rawModel);
    if (modelId && liveListingSet.has(modelId)) {
      provedModels.add(modelId);
    }
  }

  const priors = priorsData || loadPriors();
  const scored = Array.from(provedModels).map((modelId) => {
    let score = null;
    try {
      const prior = priorFor({ modelId }, 'writer', priors, now);
      if (prior && typeof prior.score === 'number') {
        score = prior.score;
      }
    } catch {}
    return { modelId, score };
  });

  scored.sort((a, b) => {
    if (a.score !== null && b.score !== null) {
      if (b.score !== a.score) return b.score - a.score;
      return a.modelId.localeCompare(b.modelId);
    }
    if (a.score !== null) return -1;
    if (b.score !== null) return 1;
    return a.modelId.localeCompare(b.modelId);
  });

  return scored.map((s) => s.modelId);
}

function httpRequest({ host, port, path: reqPath, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (payload && !reqHeaders['Content-Length']) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(
      {
        hostname: host || DEFAULT_HOST,
        port: port || DEFAULT_PORT,
        path: reqPath,
        method: method || 'GET',
        headers: reqHeaders,
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

async function fetchLiveModels({ host, port, apiKey }) {
  const key = apiKey || process.env.NINEROUTER_API_KEY || '';
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const res = await httpRequest({
    host,
    port,
    path: '/v1/models',
    method: 'GET',
    headers,
  });
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.data)) {
    throw new Error(`Failed to fetch 9router models: HTTP ${res.status}`);
  }
  return res.data.data;
}

/**
 * Synchronize the writer combo with 9router admin API.
 *
 * @param {object} [opts] Options
 * @param {string} [opts.name] Combo name (default: 'shipde-writer')
 * @param {string} [opts.host] 9router host (default: '127.0.0.1')
 * @param {number} [opts.port] 9router admin port (default: 20128)
 * @param {string} [opts.evidenceDir] Path to evidence dir
 * @param {string[]} [opts.models] Optional explicit model list overriding calculation
 * @returns {Promise<{name: string, models: string[], created: boolean, updated: boolean}>}
 */
async function syncWriterCombo(opts = {}) {
  const name = opts.name || DEFAULT_COMBO_NAME;
  const host = opts.host || DEFAULT_HOST;
  const port = opts.port || DEFAULT_PORT;

  let models = opts.models;
  if (!models) {
    const evidenceDir = opts.evidenceDir || path.join(__dirname, 'data', 'evidence');
    const evidenceData = evidenceApi.loadEvidence(evidenceDir);
    const priorsData = loadPriors();
    const liveListing = await fetchLiveModels({ host, port, apiKey: opts.apiKey });
    models = buildWriterComboModels(liveListing, evidenceData, priorsData);
  }

  // An empty member list makes 9router answer every request for the combo with
  // "Invalid model format". Never replace a combo with nothing: keep what is
  // there and report why no sync happened.
  if (!Array.isArray(models) || models.length === 0) {
    return { name, models: [], created: false, updated: false, skipped: 'EMPTY_MODEL_LIST' };
  }

  const cliToken = loadCliToken();
  const adminHeaders = {
    'Content-Type': 'application/json',
  };
  if (cliToken) {
    adminHeaders['x-9r-cli-token'] = cliToken;
  }

  // Get existing combos
  const listRes = await httpRequest({
    host,
    port,
    path: '/api/combos',
    method: 'GET',
    headers: adminHeaders,
  });

  if (listRes.status !== 200 || !listRes.data) {
    throw new Error(`Failed to fetch combos from 9router admin API: HTTP ${listRes.status}`);
  }

  const existingCombos = Array.isArray(listRes.data.combos) ? listRes.data.combos : [];
  const existing = existingCombos.find((c) => c && c.name === name);

  if (existing && existing.id) {
    // Update combo
    const updateRes = await httpRequest({
      host,
      port,
      path: `/api/combos/${existing.id}`,
      method: 'PUT',
      headers: adminHeaders,
      body: { name, models, kind: null },
    });
    if (updateRes.status !== 200) {
      throw new Error(`Failed to update combo ${name}: HTTP ${updateRes.status}`);
    }
    return { name, models, created: false, updated: true };
  } else {
    // Create combo
    const createRes = await httpRequest({
      host,
      port,
      path: '/api/combos',
      method: 'POST',
      headers: adminHeaders,
      body: { name, models, kind: null },
    });
    if (createRes.status !== 201 && createRes.status !== 200) {
      throw new Error(`Failed to create combo ${name}: HTTP ${createRes.status}`);
    }
    return { name, models, created: true, updated: false };
  }
}

function isNineRouterCandidate(c) {
  if (!c || typeof c !== 'object') return false;
  return Boolean(
    c.gateway === '9router' ||
    c.source === '9router' ||
    c.sourceId === '9router' ||
    c.reachedVia === '9router' ||
    c.gateway === 'opencode-provider-ninerouter-options' ||
    c.source === 'opencode-provider-ninerouter-options' ||
    c.sourceId === 'opencode-provider-ninerouter-options' ||
    c.upstream === 'ninerouter' ||
    c.upstream === '9router' ||
    (typeof c.modelId === 'string' &&
      (c.modelId.startsWith('ninerouter/') || c.modelId.startsWith('9router/'))) ||
    c.accountId === 'ninerouter' ||
    c.quotaScope === 'ninerouter'
  );
}

function isIndividualNineRouterCandidate(c, comboName) {
  if (!isNineRouterCandidate(c)) return false;
  if (c.comboMembers) return false;
  if (comboName) {
    if (c.modelId === comboName) return false;
    if (c.modelId === `ninerouter/${comboName}` || c.modelId === `9router/${comboName}`)
      return false;
  }
  return true;
}

function isNineRouterSource(source, key) {
  if (!source && !key) return false;
  return Boolean(
    key === 'ninerouter' ||
    key === '9router' ||
    source?.id === '9router' ||
    source?.id === 'ninerouter' ||
    source?.id === 'opencode-provider-ninerouter-options' ||
    source?.opencodeProvider === 'ninerouter' ||
    source?.reachedVia === '9router' ||
    source?.reachedVia === 'ninerouter'
  );
}

function resolveComboMembers(opts, registry, getWriterComboName) {
  if (Array.isArray(opts && opts.nineRouterComboMembers)) return opts.nineRouterComboMembers;
  const comboName =
    typeof getWriterComboName === 'function'
      ? getWriterComboName(opts, registry)
      : opts?.nineRouterWriterCombo;
  if (!comboName) return [];
  try {
    const evidenceDir = (opts && opts.evidenceDir) || path.join(__dirname, 'data', 'evidence');
    const evidenceData = (opts && opts.evidence) || evidenceApi.loadEvidence(evidenceDir);
    const priorsApi = require('./priors');
    const priorsData = (opts && opts.priors) || priorsApi.loadPriors();
    const listing =
      (opts &&
        opts.sourceModels &&
        (opts.sourceModels['9router'] || opts.sourceModels['ninerouter'])) ||
      (opts && opts.catalogue) ||
      [];
    return buildWriterComboModels(listing, evidenceData, priorsData);
  } catch {
    return [];
  }
}

module.exports = {
  DEFAULT_COMBO_NAME,
  buildWriterComboModels,
  syncWriterCombo,
  extractModelId,
  loadCliToken,
  isNineRouterCandidate,
  isIndividualNineRouterCandidate,
  isNineRouterSource,
  resolveComboMembers,
};
