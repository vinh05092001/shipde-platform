'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const runner = require('./spawn');
const pool = require('../agy-pool-runtime');

function openCodeConfig(options = {}) {
  if (options.config) return options.config;
  const file =
    options.opencodePath ||
    process.env.OPENCODE_CONFIG ||
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  // Configuration is consumed only in memory; auth stores are never opened.
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function configuredModels(config) {
  const disabled = new Set(config.disabled_providers || []);
  return new Set(
    Object.entries(config.provider || {})
      .filter(([id]) => !disabled.has(id))
      .flatMap(([id, provider]) =>
        Object.keys(provider.models || {}).map((model) => id + '/' + model)
      )
  );
}
function catalogue(source, models) {
  return {
    upstream: source.upstream || source.id,
    gateway: source.gateway || source.id,
    accessPath: source.harness,
    harness: source.harness,
    account: source.account || '',
    quotaScope: source.account || source.id,
    models,
    count: models.length,
  };
}
async function enumerateLiveSources(options = {}) {
  const sources = [],
    results = {};
  const record = (source, models, reason, request) => {
    sources.push(source);
    results[source.id] = {
      status: reason ? 'unknown' : 'enumerated',
      reason: reason || null,
      catalogs: reason ? [] : [catalogue(source, models)],
      ...(request ? { requests: [{ url: request }] } : {}),
    };
  };
  let config;
  try {
    config = openCodeConfig(options);
  } catch (error) {
    record(
      { id: 'opencode-config', kind: 'orchestrator', harness: 'opencode' },
      [],
      error.code || 'OPENCODE_CONFIG_INVALID'
    );
    config = {};
  }
  const disabled = new Set(config.disabled_providers || []);
  for (const [id, provider] of Object.entries(config.provider || {})) {
    if (disabled.has(id)) continue;
    const source = {
      id: 'opencode:' + id,
      kind: 'orchestrator',
      harness: 'opencode',
      upstream: id,
      gateway: id,
    };
    let endpoint;
    try {
      endpoint = new URL(
        provider.options?.baseURL || provider.options?.baseUrl || provider.endpoint
      );
      if (
        !['https:', 'http:'].includes(endpoint.protocol) ||
        endpoint.username ||
        endpoint.password ||
        endpoint.search
      )
        throw new Error('UNSAFE_ENDPOINT');
    } catch {
      record(source, [], 'MODELS_ENDPOINT_MISSING_OR_UNSAFE');
      continue;
    }
    const url = endpoint.href.replace(/\/$/, '') + '/models';
    try {
      const headers = {};
      const value = provider.options?.apiKey;
      const ref = typeof value === 'string' && value.match(/^\{env:([A-Z_][A-Z0-9_]*)\}$/);
      const token = ref
        ? (options.env || process.env)[ref[1]]
        : typeof value === 'string'
          ? value
          : null;
      if (token) headers.authorization = 'Bearer ' + token;
      const response = await (options.fetch || globalThis.fetch)(url, {
        headers,
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        record(source, [], 'HTTP_' + response.status, url);
        continue;
      }
      const body = await response.json();
      const rows = Array.isArray(body) ? body : body.data || body.models;
      if (!Array.isArray(rows)) throw new Error('SCHEMA_CHANGED');
      const models = [
        ...new Set(
          rows
            .map((row) => (typeof row === 'string' ? row : row?.id))
            .filter((model) => typeof model === 'string' && /^[\w./:+-]+$/.test(model))
            .map((model) => (model.startsWith(id + '/') ? model : id + '/' + model))
        ),
      ].sort();
      record(source, models, null, url);
    } catch (error) {
      record(
        source,
        [],
        error.code === 'EPERM' || error.code === 'EACCES' ? error.code : 'FETCH_FAILED',
        url
      );
    }
  }
  const local = { id: 'agy-local', kind: 'agent-cli', harness: 'agy', account: 'current-user' };
  try {
    const result = await (options.runCommand || runner.runCommand)('agy', ['models'], {
      timeoutMs: 60000,
    });
    record(
      local,
      result.exitCode === 0 ? pool.parseCliModels(result.stdout) : [],
      result.exitCode === 0 ? null : result.enoent ? 'ENOENT' : 'MODELS_COMMAND_FAILED',
      'agy models'
    );
  } catch (error) {
    record(local, [], error.code || 'MODELS_COMMAND_FAILED', 'agy models');
  }
  for (const lane of options.lanes || pool.discoverAccounts(options)) {
    const source = {
      id: lane,
      kind: 'agent-cli',
      harness: 'agy-pool',
      upstream: 'agy-local',
      gateway: 'agy-pool',
      account: lane,
    };
    try {
      const result = options.submitModels
        ? await options.submitModels(lane)
        : pool.submitJob(
            lane,
            { command: 'models', cwd: options.cwd || process.cwd() },
            { ...options, timeoutMs: 60000 }
          );
      // Read only the result for the submitted job, never a cached models-out list.
      const stdout =
        result.stdout ?? (result.exitCode === 0 ? pool.readOutText(lane, options) : '');
      record(
        source,
        result.exitCode === 0 ? pool.parseCliModels(stdout) : [],
        result.exitCode === 0
          ? null
          : result.reason?.startsWith('POOL_ACCOUNT_BUSY')
            ? 'POOL_ACCOUNT_BUSY'
            : 'MODELS_COMMAND_FAILED',
        lane + ' agy models'
      );
    } catch (error) {
      record(source, [], error.code || 'MODELS_COMMAND_FAILED', lane + ' agy models');
    }
  }
  return { sources, results };
}
module.exports = { enumerateLiveSources, openCodeConfig, configuredModels };
