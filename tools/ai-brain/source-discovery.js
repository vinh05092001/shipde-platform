'use strict';

// Local model-source inventory. Secret values are held only in local variables
// for an optional request; returned and persisted records contain locations.
const fs = require('fs');
const path = require('path');
const os = require('os');

const SECRET_KEY = /(?:api[_-]?key|token|secret|credential)/i;
const AUTH_STATUSES = new Set([401, 402, 403, 429, 451]);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function walk(node, visit, prefix = [], parentNode = null, parentKey = null) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    const fields = prefix.concat(key);
    visit(key, value, fields, node, parentNode, parentKey);
    if (value && typeof value === 'object') walk(value, visit, fields, node, key);
  }
}

function idOf(value) {
  return String(value || 'source')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 70);
}

function isTencentTokenHub(hostname) {
  if (typeof hostname !== 'string') return false;
  const host = hostname.toLowerCase();
  return (
    /(?:^|\.)tokenhub.*tencentcloud(?:maas)?\.com$/.test(host) ||
    /(?:^|\.)(?:api\.)?tencentcloudmaas\.com$/.test(host)
  );
}

// Persist only a routable host and ordinary API prefix. Inline credentials,
// query parameters, and common secret/project path values are removed.
function sanitizeEndpoint(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (isTencentTokenHub(url.hostname)) {
      url.protocol = 'https:';
      url.hostname = 'tokenhub-intl.tencentcloudmaas.com';
    }
    if (url.username || url.password) {
      url.username = 'REDACTED';
      url.password = '';
    }
    url.search = '';
    url.hash = '';
    const parts = url.pathname.split('/');
    for (let i = 0; i < parts.length; i += 1) {
      if (/^(?:token|api[_-]?key|secret|credential|project|projects)$/i.test(parts[i])) {
        if (parts[i + 1]) parts[i + 1] = '[REDACTED]';
      } else if (/^(?:sk-|key-|tok_)[a-z0-9._~-]{8,}$/i.test(parts[i])) {
        parts[i] = '[REDACTED]';
      }
    }
    url.pathname = parts.join('/').replace(/\/$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function extractCredentialFromObject(obj, basePath, file) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY.test(k) && typeof v === 'string') {
      const match = v.match(/\{env:([A-Z0-9_]+)\}/i);
      if (match) return { type: 'env', name: match[1] };
    }
  }
  // Never treat an arbitrary {env:...} field as authorization. It must be
  // attached to an auth-shaped field on this endpoint's own options object.
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY.test(k) && typeof v === 'string' && v.trim()) {
      return {
        type: 'file-field',
        path: file,
        field: basePath ? `${basePath}.${k}` : k,
      };
    }
  }
  return null;
}

function discoverNineRouterDb(options, add) {
  const env = options.env || process.env;
  const appData = env.APPDATA || path.join(options.home || os.homedir(), 'AppData', 'Roaming');
  const files = [
    path.join(appData, '9router', 'db', 'data.sqlite'),
    path.join(appData, '9router', 'data.sqlite'),
  ];
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return;
  }
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((row) => row.name)
        .filter((name) => /provider|model/i.test(name));
      for (const table of tables) {
        const quoted = '"' + String(table).replace(/"/g, '""') + '"';
        const columns = db
          .prepare('PRAGMA table_info(' + quoted + ')')
          .all()
          .map((row) => row.name);
        const allowed = columns.filter((column) =>
          /^(provider|name|model|modelId|baseURL|endpoint|url)$/i.test(column)
        );
        if (!allowed.length) continue;
        const projection = allowed
          .map((column) => '"' + column.replace(/"/g, '""') + '"')
          .join(', ');
        for (const row of db.prepare('SELECT ' + projection + ' FROM ' + quoted).all()) {
          const endpoint = row.baseURL || row.endpoint || row.url || null;
          const provider = row.provider || row.name || '9router-' + table;
          add({
            id: idOf('9router-' + provider),
            name: String(provider),
            endpoint,
            models: [row.modelId || row.model].filter((model) => typeof model === 'string'),
            credential: {
              type: 'file-field',
              path: file + ':' + table,
              field: 'credential (value not read)',
            },
          });
        }
      }
    } catch {
      // The optional local DB may be absent, locked, or use another schema.
    } finally {
      if (db) db.close();
    }
  }
}

// Credential env name -> env var that overrides the base URL of its source.
const BASE_URL_ENV_BY_CREDENTIAL = {
  TENCENT_TOKENHUB_API_KEY: 'TENCENT_TOKENHUB_BASE_URL',
};

function discoverSources(options = {}) {
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const local = options.localAppData || env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const result = new Map();
  const add = (source) => {
    const baseUrlEnv =
      source.credential && source.credential.type === 'env'
        ? BASE_URL_ENV_BY_CREDENTIAL[source.credential.name]
        : null;
    const override =
      baseUrlEnv && env[baseUrlEnv] ? String(env[baseUrlEnv]).replace(/\/+$/, '') : null;
    if (override) source = { ...source, endpoint: override };
    const endpoint = source.endpoint ? sanitizeEndpoint(source.endpoint) : null;
    if (source.endpoint && !endpoint) return;
    // Repository and web links found in session metadata are not model APIs.
    if (endpoint && NON_API_ENDPOINT.test(endpoint)) return;
    // Endpoint identity matters when one provider id exposes multiple URLs.
    const baseId = idOf(source.id);
    const collision = [...result.values()].some(
      (entry) => entry.id === baseId && entry.endpoint !== endpoint
    );
    const id =
      collision && endpoint
        ? baseId +
          '-' +
          require('crypto').createHash('sha1').update(endpoint).digest('hex').slice(0, 10)
        : baseId;
    const key = id + '|' + endpoint;
    const old = result.get(key);
    if (old) {
      old.models = [...new Set([...old.models, ...(source.models || [])])];
      if (source.modelMeta) {
        old.modelMeta = Object.assign({}, old.modelMeta || {}, source.modelMeta);
      }
      if (!old.credential && source.credential) old.credential = source.credential;
      if (source.headers && !old.headers) old.headers = { ...source.headers };
      return;
    }
    result.set(key, {
      id,
      name: source.name || source.id,
      kind: source.kind || 'model-source',
      endpoint,
      models: [...new Set(source.models || [])],
      modelMeta: source.modelMeta ? { ...source.modelMeta } : {},
      credential: source.credential || null,
      ...(source.headers ? { headers: { ...source.headers } } : {}),
      status: 'discovered',
      lastProbeAt: null,
      nextCheckAt: null,
      reason: null,
    });
  };
  const scanConfig = (file, label) => {
    const data = readJson(file);
    if (!data) return;
    walk(data, (key, value, fields, node, parentNode, parentKey) => {
      if (/^(?:base[_-]?url|endpoint|api[_-]?base(?:url)?|url)$/i.test(key)) {
        if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return;
        // Generic URLs describe MCP servers, docs, icons and webhooks too.
        // Only API-shaped fields or entries with explicit model metadata are
        // eligible to be model sources.
        const modelHint =
          node.models || node.model || (parentNode && (parentNode.models || parentNode.model));
        if (/^url$/i.test(key) && !modelHint) return;
        let credential = extractCredentialFromObject(node, fields.slice(0, -1).join('.'), file);
        if (!credential && parentKey === 'options' && parentNode) {
          credential = extractCredentialFromObject(parentNode, fields.slice(0, -2).join('.'), file);
        }
        if (!credential && node && node.options && typeof node.options === 'object') {
          credential = extractCredentialFromObject(
            node.options,
            fields.slice(0, -1).concat('options').join('.'),
            file
          );
        }
        const modelIds = [];
        const modelsNode =
          node.models ||
          node.model ||
          (parentKey === 'options' && parentNode && (parentNode.models || parentNode.model));
        if (Array.isArray(modelsNode))
          modelIds.push(
            ...modelsNode
              .map((m) => (typeof m === 'string' ? m : m && (m.id || m.name)))
              .filter(Boolean)
          );
        else if (modelsNode && typeof modelsNode === 'object')
          modelIds.push(...Object.keys(modelsNode));
        add({
          id: idOf(label + '-' + fields.slice(0, -1).join('-')),
          name: label,
          endpoint: value,
          models: modelIds,
          credential,
        });
      }
    });
  };

  // OpenCode providers include explicit {env:NAME} references.
  scanConfig(path.join(home, '.config', 'opencode', 'opencode.json'), 'opencode');
  // Known local tool configuration trees. Only endpoint/model metadata and a
  // credential's location are retained.
  let entries = [];
  try {
    entries = fs.readdirSync(home);
  } catch {}
  for (const entry of entries.filter((name) => /^\.cline/i.test(name))) {
    const dir = path.join(home, entry);
    for (const file of ['cline_mcp_settings.json', 'settings.json', 'config.json'])
      scanConfig(path.join(dir, file), 'cline-' + entry);
  }
  for (const [file, label] of [
    [path.join(home, '.qwen', 'settings.json'), 'qwen'],
    [path.join(home, '.codex', 'config.toml'), 'codex'],
    [path.join(home, '.continue', 'config.json'), 'continue'],
    [path.join(home, '.kiro', 'settings', 'mcp.json'), 'kiro'],
    [path.join(home, '.gemini', 'settings.json'), 'gemini'],
    [path.join(local, 'hermes', 'config.yaml'), 'hermes'],
  ]) {
    if (file.endsWith('.json')) scanConfig(file, label);
    else {
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {}
      const urls = [
        ...text.matchAll(
          /(?:base[_-]?url|endpoint|api[_-]?base)\s*[:=]\s*["']?(https?:\/\/[^\s"']+)/gi
        ),
      ];
      for (const match of urls)
        add({ id: idOf(label), name: label, endpoint: match[1], models: [], credential: null });
    }
  }
  for (const entry of entries.filter((name) => /^\.openclaw/i.test(name)))
    scanConfig(path.join(home, entry, 'openclaw.json'), 'openclaw-' + entry);

  // Also inspect JSON config files nested in the local tool trees; versions of
  // these applications use different filenames and subdirectories.
  for (const entry of entries.filter((name) =>
    /^(\.cline|\.gemini|\.continue|\.kiro)/i.test(name)
  )) {
    const base = path.join(home, entry);
    const visit = (dir, depth = 0) => {
      if (depth > 4) return;
      let children = [];
      try {
        children = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const child of children) {
        const target = path.join(dir, child.name);
        if (child.isDirectory()) {
          // Session history, agent scratch and caches hold copies of URLs, not
          // configured providers.
          if (!NON_CONFIG_DIR.test(child.name)) visit(target, depth + 1);
        } else if (/\.json$/i.test(child.name))
          scanConfig(target, entry + '-' + path.relative(base, target));
      }
    };
    visit(base);
  }

  // Environment sources are addressable via matching models.dev metadata.
  const cache = readJson(path.join(local, 'hermes', 'models_dev_cache.json')) || {};
  const providers = cache.providers || cache;
  for (const [name, provider] of Object.entries(providers)) {
    if (!provider || typeof provider !== 'object') continue;
    const envNames = Array.isArray(provider.env)
      ? provider.env
      : typeof provider.env === 'string'
        ? [provider.env]
        : [];
    const available = envNames.find((item) => typeof item === 'string' && env[item]);
    if (!available || !/(?:_API_KEY|_TOKEN)$/.test(available)) continue;
    const api =
      typeof provider.api === 'string'
        ? provider.api
        : provider.api && (provider.api.url || provider.api.baseURL);
    if (api && /^https?:\/\//i.test(api))
      add({
        id: idOf(name),
        name,
        endpoint: api,
        credential: { type: 'env', name: available },
        models: Object.keys(provider.models || {}),
      });
  }
  const OPERATOR_ENDPOINTS = {
    AIHUBMIX_API_KEY: { id: 'aihubmix', name: 'aihubmix', endpoint: 'https://aihubmix.com/v1' },
    THEGRID_API_KEY: { id: 'thegrid', name: 'thegrid', endpoint: 'https://api.thegrid.ai/v1' },
    THEGRID_API_KEY_2: {
      id: 'thegrid-2',
      name: 'thegrid-2',
      endpoint: 'https://api.thegrid.ai/v1',
    },
    SCALEWAY_API_KEY: { id: 'scaleway', name: 'scaleway', endpoint: 'https://api.scaleway.ai/v1' },
    SCALEWAY_API_KEY_2: {
      id: 'scaleway-2',
      name: 'scaleway-2',
      endpoint: 'https://api.scaleway.ai/v1',
    },
    PGSGROVE_API_KEY: { id: 'pgsgrove', name: 'pgsgrove', endpoint: 'https://api.pgsgrove.com/v1' },
    SOVINFRA_API_KEY: { id: 'sovinfra', name: 'sovinfra', endpoint: 'https://api.sovinfra.ai/v1' },
    INTERNLM_API_KEY: {
      id: 'internlm',
      name: 'internlm',
      endpoint: 'https://chat.intern-ai.org.cn/api/v1',
    },
    AGENTROUTER_API_KEY: {
      id: 'agentrouter',
      name: 'agentrouter',
      endpoint: 'https://agentrouter.org/v1',
      headers: { 'User-Agent': 'claude-cli/1.0.0 (external, cli)' },
    },
  };

  function getOperatorEndpoint(envName) {
    if (OPERATOR_ENDPOINTS[envName]) return OPERATOR_ENDPOINTS[envName];
    const baiMatch = envName.match(/^BAI_API_KEY(?:_([2-9]|\d{2,}))?$/i);
    if (baiMatch) {
      const suffix = baiMatch[1] ? `-${baiMatch[1]}` : '';
      return { id: `bai${suffix}`, name: `bai${suffix}`, endpoint: 'https://api.b.ai/v1' };
    }
    const gridMatch = envName.match(/^THEGRID_API_KEY_(\d+)$/i);
    if (gridMatch) {
      return {
        id: `thegrid-${gridMatch[1]}`,
        name: `thegrid-${gridMatch[1]}`,
        endpoint: 'https://api.thegrid.ai/v1',
      };
    }
    const scwMatch = envName.match(/^SCALEWAY_API_KEY_(\d+)$/i);
    if (scwMatch) {
      return {
        id: `scaleway-${scwMatch[1]}`,
        name: `scaleway-${scwMatch[1]}`,
        endpoint: 'https://api.scaleway.ai/v1',
      };
    }
    const aihubMatch = envName.match(/^AIHUBMIX_API_KEY_(\d+)$/i);
    if (aihubMatch) {
      return {
        id: `aihubmix-${aihubMatch[1]}`,
        name: `aihubmix-${aihubMatch[1]}`,
        endpoint: 'https://aihubmix.com/v1',
      };
    }
    return null;
  }

  for (const name of Object.keys(env)) {
    if (!/(?:_API_KEY|_TOKEN)(?:_\d+)?$/i.test(name) || !env[name]) continue;
    const known = [...result.values()].some(
      (source) => source.credential && source.credential.name === name
    );
    if (!known) {
      const op = getOperatorEndpoint(name);
      add({
        // Keep a numbered suffix: KEY_1 and KEY_2 are separate credentials.
        id: op ? op.id : idOf(name.replace(/_(?:API_KEY|TOKEN)(_\d+)?$/i, '$1')),
        name: op ? op.name : name.replace(/_(?:API_KEY|TOKEN)(_\d+)?$/i, '$1'),
        endpoint: op ? op.endpoint : null,
        headers: op ? op.headers : undefined,
        credential: { type: 'env', name },
      });
    }
  }
  discoverNineRouterDb(options, add);
  return dropUncredentialedDuplicates([...result.values()]);
}

const NON_API_ENDPOINT =
  /^https?:\/\/(?:[^/]*\.)?(?:github\.com|gitlab\.com|bitbucket\.org)(?:[/:]|$)|\.git$/i;
const NON_CONFIG_DIR =
  /^(?:sessions|tasks|brain|scratch|conversations|history|cache|caches|logs?|checkpoints|workspaceStorage|globalStorage|node_modules|tmp|temp)$/i;

// A copy of an endpoint found in a file carries no usable credential. When the
// same endpoint is already known with an env credential, the copy only adds a
// guaranteed 401, so it is dropped.
function dropUncredentialedDuplicates(sources) {
  const credentialed = new Set(
    sources
      .filter((source) => source.endpoint && source.credential && source.credential.type === 'env')
      .map((source) => source.endpoint.replace(/\/+$/, '').toLowerCase())
  );
  return sources.filter(
    (source) =>
      !source.endpoint ||
      (source.credential && source.credential.type === 'env') ||
      !credentialed.has(source.endpoint.replace(/\/+$/, '').toLowerCase())
  );
}

function toPositiveInteger(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return undefined;
  if (typeof value === 'object') return undefined;
  if (typeof value === 'string' && !/^\s*\d+\s*$/.test(value)) return undefined;
  const num = Number(value);
  if (Number.isInteger(num) && num > 0) return num;
  return undefined;
}

function modelMeta(body) {
  const rows = body && (body.data || body.models || body.items || body);
  if (!Array.isArray(rows)) return {};
  const meta = {};
  for (const row of rows) {
    const id = typeof row === 'string' ? row : row && (row.id || row.name);
    if (typeof id !== 'string' || !id) continue;
    const contextWindow =
      row && typeof row === 'object'
        ? (toPositiveInteger(row.capabilities?.contextWindow) ??
          toPositiveInteger(row.context_length) ??
          toPositiveInteger(row.context_window) ??
          toPositiveInteger(row.max_context_length))
        : undefined;
    const maxOutputTokens =
      row && typeof row === 'object' ? toPositiveInteger(row.max_completion_tokens) : undefined;
    const existing = meta[id];
    meta[id] = {
      contextWindow: contextWindow !== undefined ? contextWindow : existing?.contextWindow,
      maxOutputTokens: maxOutputTokens !== undefined ? maxOutputTokens : existing?.maxOutputTokens,
      contextSource: 'provider-models-endpoint',
    };
  }
  return meta;
}

function modelIds(body) {
  const rows = body && (body.data || body.models || body.items || body);
  return Array.isArray(rows)
    ? rows
        .map((row) => (typeof row === 'string' ? row : row && (row.id || row.name)))
        .filter((id) => typeof id === 'string' && id)
    : [];
}

async function probeSource(source, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (
    source.status === 'parked' &&
    source.nextCheckAt &&
    Date.parse(source.nextCheckAt) > now.getTime()
  )
    return source;
  const fetcher = options.fetch || globalThis.fetch;
  const credential = source.credential || {};
  let secret = null;
  if (credential.type === 'env') secret = (options.env || process.env)[credential.name] || null;
  // File-backed values are inventory-only. Reading arbitrary config fields
  // as bearer tokens can leak credentials to unrelated endpoints.
  const record = { ...source, lastProbeAt: now.toISOString() };
  if (!fetcher)
    return { ...record, status: 'unavailable', reason: 'fetch unavailable', nextCheckAt: null };
  const targetEndpoint = (source.endpoint && sanitizeEndpoint(source.endpoint)) || source.endpoint;
  try {
    const response = await fetcher(targetEndpoint.replace(/\/$/, '') + '/models', {
      headers: {
        ...(source.headers && typeof source.headers === 'object' ? source.headers : {}),
        ...(secret ? { Authorization: 'Bearer ' + secret } : {}),
      },
    });
    if (!response.ok) {
      const status = response.status;
      const parked = AUTH_STATUSES.has(status);
      return {
        ...record,
        status: parked ? 'parked' : 'unavailable',
        reason: 'HTTP ' + status,
        nextCheckAt: new Date(now.getTime() + (status === 429 ? 15 : 60) * 60_000).toISOString(),
      };
    }
    const body = await response.json();
    return {
      ...record,
      models: [...new Set([...record.models, ...modelIds(body)])],
      modelMeta: Object.assign({}, record.modelMeta || {}, modelMeta(body)),
      status: 'available',
      reason: null,
      nextCheckAt: null,
    };
  } catch (error) {
    return {
      ...record,
      status: 'unavailable',
      reason: String((error && error.message) || 'request failed').replace(
        /https?:\/\/\S+/g,
        '[endpoint]'
      ),
      nextCheckAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    };
  }
}

async function discover(options = {}) {
  const file = options.output || path.join(options.root || __dirname, 'data', 'sources.json');
  let prior = [];
  try {
    prior = JSON.parse(fs.readFileSync(file, 'utf8')).sources || [];
  } catch {}
  const current = (options.sources || discoverSources(options)).map((source) => ({
    ...source,
    endpoint: source.endpoint ? sanitizeEndpoint(source.endpoint) : null,
  }));
  prior = prior.map((source) => ({
    ...source,
    endpoint: source.endpoint ? sanitizeEndpoint(source.endpoint) : null,
  }));
  const keyed = new Map(prior.map((entry) => [entry.id + '|' + entry.endpoint, entry]));
  const sources = current.map((entry) => {
    const old = keyed.get(entry.id + '|' + entry.endpoint);
    if (!old) return entry;
    keyed.delete(entry.id + '|' + entry.endpoint);
    return {
      ...entry,
      models: [...new Set([...(old.models || []), ...(entry.models || [])])],
      modelMeta: Object.assign({}, old.modelMeta || {}, entry.modelMeta || {}),
      // A fresh discovery invalidates old availability until a new probe.
      status: 'discovered',
      lastProbeAt: null,
      nextCheckAt: null,
      reason: null,
    };
  });
  for (const old of keyed.values()) sources.push(old);
  const now = options.now ? new Date(options.now) : new Date();
  const probed = options.probe
    ? await Promise.all(
        sources.map((source) => (source.endpoint ? probeSource(source, options) : source))
      )
    : sources;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, updatedAt: now.toISOString(), sources: probed }, null, 2)
  );
  return { version: 1, updatedAt: now.toISOString(), sources: probed };
}

module.exports = {
  discoverSources,
  probeSource,
  discover,
  modelIds,
  modelMeta,
  modelMetadata: modelMeta,
  sanitizeEndpoint,
  toPositiveInteger,
};
