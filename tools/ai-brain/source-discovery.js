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

function walk(node, visit, prefix = []) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    const fields = prefix.concat(key);
    visit(key, value, fields, node);
    if (value && typeof value === 'object') walk(value, visit, fields);
  }
}

function idOf(value) {
  return String(value || 'source')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 70);
}

// Persist only a routable host and ordinary API prefix. Inline credentials,
// query parameters, and common secret/project path values are removed.
function sanitizeEndpoint(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
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

function discoverSources(options = {}) {
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  const local = options.localAppData || env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const result = new Map();
  const add = (source) => {
    const endpoint = source.endpoint ? sanitizeEndpoint(source.endpoint) : null;
    if (source.endpoint && !endpoint) return;
    const key = source.id + '|' + endpoint;
    const old = result.get(key);
    if (old) {
      old.models = [...new Set([...old.models, ...(source.models || [])])];
      if (!old.credential && source.credential) old.credential = source.credential;
      return;
    }
    result.set(key, {
      id: source.id,
      name: source.name || source.id,
      kind: source.kind || 'model-source',
      endpoint,
      models: [...new Set(source.models || [])],
      credential: source.credential || null,
      status: 'discovered',
      lastProbeAt: null,
      nextCheckAt: null,
      reason: null,
    });
  };
  const scanConfig = (file, label) => {
    const data = readJson(file);
    if (!data) return;
    walk(data, (key, value, fields, parent) => {
      if (key === 'baseURL' || key === 'baseUrl' || key === 'base_url' || key === 'url') {
        if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return;
        const providerName = fields.find((part) => data.provider && data.provider[part]);
        const provider = (providerName && data.provider[providerName]) || parent;
        const envRef = JSON.stringify(provider).match(/\{env:([A-Z0-9_]+)\}/i);
        const credKey = Object.keys(provider).find(
          (k) => SECRET_KEY.test(k) && typeof provider[k] === 'string'
        );
        const modelIds = [];
        const modelsNode = provider.models || provider.model;
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
          credential: envRef
            ? { type: 'env', name: envRef[1] }
            : credKey
              ? {
                  type: 'file-field',
                  path: file,
                  field: fields.slice(0, -1).concat(credKey).join('.'),
                }
              : null,
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
        if (child.isDirectory()) visit(target, depth + 1);
        else if (/\.json$/i.test(child.name))
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
  for (const name of Object.keys(env)) {
    if (!/(?:_API_KEY|_TOKEN)$/.test(name) || !env[name]) continue;
    const known = [...result.values()].some(
      (source) => source.credential && source.credential.name === name
    );
    if (!known)
      add({
        id: idOf(name.replace(/(?:_API_KEY|_TOKEN)$/i, '')),
        name: name.replace(/(?:_API_KEY|_TOKEN)$/i, ''),
        endpoint: null,
        credential: { type: 'env', name },
      });
  }
  discoverNineRouterDb(options, add);
  return [...result.values()];
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
  if (credential.type === 'file-field') {
    const config = readJson(credential.path);
    secret =
      credential.field.split('.').reduce((value, key) => value && value[key], config) || null;
  }
  const record = { ...source, lastProbeAt: now.toISOString() };
  if (!fetcher)
    return { ...record, status: 'unavailable', reason: 'fetch unavailable', nextCheckAt: null };
  try {
    const response = await fetcher(source.endpoint.replace(/\/$/, '') + '/models', {
      headers: secret ? { Authorization: 'Bearer ' + secret } : {},
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
      status: old.status || entry.status,
      lastProbeAt: old.lastProbeAt || null,
      nextCheckAt: old.nextCheckAt || null,
      reason: old.reason || null,
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

module.exports = { discoverSources, probeSource, discover, modelIds, sanitizeEndpoint };
