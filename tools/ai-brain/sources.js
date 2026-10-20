'use strict';

/**
 * Ship Dễ — Source registry (TASK-AI-49)
 *
 * The dashboard lists twelve "sources" side by side, which invites a mistake
 * this module exists to prevent: treating them as twelve suppliers of model
 * capacity. They are not the same kind of thing.
 *
 *   model-source     brings its own capacity and its own quota (xKiro, B.AI,
 *                    Tencent)
 *   router           forwards to somebody else's capacity (9Router, Requesty,
 *                    TokenHarbor). Its catalog is the union of the accounts
 *                    logged into it, so a model listed here proves a route
 *                    exists, never that capacity does.
 *   agent-cli        a program that runs a coding session (Cline, Codex, agy,
 *                    OpenCode, Qwen, AutoClaw). Most carry no models at all.
 *   harness          plans, uses tools and delegates to subagents (Hermes)
 *   orchestrator     opens, watches, stops and resumes sessions (Paseo)
 *   decision-service closed-question answers only (Jev)
 *
 * Counting a router or a harness as a model source double-counts capacity that
 * does not exist: 9Router's 660 ids resolve to the same handful of accounts the
 * registry already knows, and dispatching against the catalog size would plan
 * work no account can pay for.
 *
 * Adding a source is an entry in sources.json plus a qualification probe.
 * Nothing in the dispatch path may branch on a source id — that is the rule the
 * `if/else` chains in dispatch.sh broke, and every new source paid for it.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(__dirname, 'sources.json');
const DEFAULT_DISPATCH = require('./sources.json').dispatch;

const Kind = Object.freeze({
  MODEL_SOURCE: 'model-source',
  ROUTER: 'router',
  AGENT_CLI: 'agent-cli',
  HARNESS: 'harness',
  ORCHESTRATOR: 'orchestrator',
  DECISION_SERVICE: 'decision-service',
});

const KNOWN_KINDS = new Set(Object.values(Kind));

/** Kinds that can be asked to produce tokens. A harness is not one of them.
 * Routers are not capacity: 9Router's catalog is the union of the accounts
 * logged into it, so a model id proves routing, never supply. Counting a
 * router double-counts capacity that no account can pay for. */
const CAPACITY_KINDS = new Set([Kind.MODEL_SOURCE]);

function readJson(file) {
  // The agy pool writes JSON with a BOM; JSON.parse rejects it outright.
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  return JSON.parse(raw);
}

/**
 * @param options { file }
 * @returns { version, sources: [...], retired: [...] }
 */
function loadSources(options) {
  const opts = options || {};
  const file = opts.file || DEFAULT_PATH;
  const doc = readJson(file);
  const sources = Array.isArray(doc.sources) ? doc.sources : [];
  const retired = Array.isArray(doc.retired) ? doc.retired : [];
  // Locally discovered direct API sources enter the same candidate pipeline as
  // reviewed registry sources. Only env-addressable credentials can be routed;
  // file-field credentials remain inventory metadata until a safe adapter is
  // available. Parked sources remain visible but cannot be selected.
  // A caller that names its own registry file gets only that file unless it
  // also names a discovered file: this machine's discovery data must not leak
  // into an explicit registry (tests, isolated workers).
  // AI_BRAIN_DISCOVERED_SOURCES=none turns machine discovery data off (the
  // host brain gate sets it so the suite sees what CI sees).
  const machineDataOff =
    process.env.AI_BRAIN_DISCOVERED_SOURCES === 'none' ||
    process.env.AI_BRAIN_MACHINE_DATA === 'none';
  const discoveredFile =
    opts.discoveredFile ||
    (opts.file || machineDataOff ? null : path.join(__dirname, 'data', 'sources.json'));
  try {
    if (!discoveredFile) throw new Error('NO_DISCOVERED_FILE');
    const discovered = readJson(discoveredFile);
    for (const entry of discovered.sources || []) {
      if (!entry || !entry.id) continue;
      const existing = sources.find((source) => source.id === entry.id);
      if (existing) {
        if (entry.modelMeta && typeof entry.modelMeta === 'object') {
          existing.modelMeta = Object.assign({}, existing.modelMeta || {}, entry.modelMeta);
        }
        continue;
      }
      if (!entry.endpoint) continue;
      const credential =
        entry.credential && entry.credential.type === 'env' ? entry.credential : null;
      if (!credential || !credential.name) continue;
      const sourceKind = entry.kind || Kind.MODEL_SOURCE;
      sources.push({
        id: entry.id,
        label: entry.name || entry.id,
        kind: sourceKind,
        servesModels: entry.status === 'available',
        // Discovered rows are model sources, so they use the direct HTTP
        // adapter. Keep this derived from the source kind rather than the
        // discovery tool that happened to find the endpoint.
        harness: sourceKind === Kind.MODEL_SOURCE ? 'direct-http' : null,
        accessPath: 'direct',
        endpoint: entry.endpoint,
        ...(entry.headers && typeof entry.headers === 'object' ? { headers: entry.headers } : {}),
        credential: { type: 'api-key', env: credential.name },
        ...(typeof entry.opencodeProvider === 'string' && entry.opencodeProvider
          ? { opencodeProvider: entry.opencodeProvider }
          : {}),
        models: Array.isArray(entry.models) ? entry.models : [],
        modelMeta: entry.modelMeta && typeof entry.modelMeta === 'object' ? entry.modelMeta : {},
        discovered: true,
        discoveryStatus: entry.status || 'discovered',
        reason: entry.reason || null,
        nextCheckAt: entry.nextCheckAt || null,
      });
    }
  } catch {
    // Discovery is optional; the reviewed static registry remains usable.
  }

  for (const source of sources) {
    if (!source || !source.id) throw new Error('sources.json: an entry has no id');
    if (!KNOWN_KINDS.has(source.kind)) {
      // An unknown kind is refused rather than defaulted. Defaulting to
      // model-source is exactly the error this file exists to stop, and it
      // would be invisible until the scheduler over-planned against it.
      throw new Error('sources.json: ' + source.id + ' has unknown kind "' + source.kind + '"');
    }
    if (!source.modelMeta || typeof source.modelMeta !== 'object') {
      source.modelMeta = {};
    }
  }
  return { version: doc.version || 0, sources, retired, dispatch: doc.dispatch || {}, file };
}

function bySource(registry) {
  const map = new Map();
  for (const source of registry.sources) map.set(source.id, source);
  return map;
}

/** The source with this id, or null. Retired ids resolve to null by design. */
function getSource(id, registry) {
  return bySource(registry).get(String(id)) || null;
}

function isRetired(id, registry) {
  return (registry.retired || []).some((r) => r.id === String(id));
}

/**
 * Whether a source is recorded but deferred (e.g. a compromised credential).
 * A deferred source is kept in the registry for audit but must never produce a
 * candidate. Returns the disposition reason, or null when the source is active.
 */
function isDeferred(id, registry) {
  const source = getSource(id, registry);
  if (!source) return null;
  const disposition = source.disposition;
  if (disposition === 'deferred' || disposition === 'compromised-credential') {
    return source.dispositionReason || disposition;
  }
  return null;
}

/**
 * Why a source may not be dispatched to, or null when it may.
 *
 * Retirement is checked first and separately: AO was removed because its idle
 * controller cost RAM, and a caller that reaches for it is making the mistake
 * that removal was meant to end, not merely naming something unknown.
 */
function refuseReason(id, registry) {
  if (isRetired(id, registry)) {
    const entry = (registry.retired || []).find((r) => r.id === String(id));
    return 'RETIRED: ' + (entry && entry.reason ? entry.reason : String(id));
  }
  const deferred = isDeferred(id, registry);
  if (deferred) return 'DEFERRED: ' + deferred;
  const source = getSource(id, registry);
  if (!source) return 'UNKNOWN_SOURCE: ' + String(id);
  return null;
}

/** Sources that can supply tokens — the only ones a capacity plan may count. */
function capacitySources(registry) {
  return registry.sources.filter((s) => CAPACITY_KINDS.has(s.kind) && s.servesModels !== false);
}

/** Sources that can run a coding session. */
function harnessSources(registry) {
  return registry.sources.filter(
    (s) => s.kind === Kind.AGENT_CLI || s.kind === Kind.HARNESS || s.kind === Kind.ORCHESTRATOR
  );
}

/**
 * Whether the credential this source needs is present — presence only.
 *
 * The value is never read into the return, and never logged. accounts.js makes
 * the same split for the same reason: anything that opens 9router's SQLite to
 * read usage also sees working `sk-ant-oat01-…` tokens, and a health check that
 * returned them would widen that hole while claiming to close it.
 *
 * @param options { env, fileExists } — injectable for tests
 */
function credentialPresence(source, options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const exists = opts.fileExists || ((p) => fs.existsSync(p));
  const cred = (source && source.credential) || { type: 'none' };

  if (cred.type === 'none') return { required: false, present: true, how: 'no credential needed' };

  if (cred.env) {
    const value = env[cred.env];
    if (value !== undefined && String(value).trim() !== '') {
      return { required: true, present: true, how: 'env ' + cred.env };
    }
  }
  if (cred.store && cred.store.startsWith('~/')) {
    const home = opts.home || require('os').homedir();
    const target = path.join(home, cred.store.slice(2));
    // A glob in the store path (~/.cline-*) means "any of these": the presence
    // question is whether one exists, not which.
    if (target.includes('*')) {
      const dir = path.dirname(target);
      const pattern = new RegExp('^' + path.basename(target).replace(/\*/g, '.*') + '$');
      let entries = [];
      try {
        entries = fs.readdirSync(dir);
      } catch (_) {
        entries = [];
      }
      if (entries.some((e) => pattern.test(e))) {
        return { required: true, present: true, how: 'store ' + cred.store };
      }
    } else if (exists(target)) {
      return { required: true, present: true, how: 'store ' + cred.store };
    }
  }
  if (cred.type === 'oauth' || cred.type === 'account') {
    // An OAuth session living in a credential manager or a CLI's own state
    // cannot be confirmed from here. Unknown is reported as unknown; claiming
    // absence would retire a working account, and claiming presence would
    // plan against one that is logged out.
    return {
      required: true,
      present: null,
      how: 'not observable from here: ' + (cred.store || cred.type),
    };
  }
  return {
    required: true,
    present: false,
    how: cred.env ? 'env ' + cred.env + ' unset' : 'no credential found',
  };
}

/**
 * A one-line-per-source report of what each thing is and whether its
 * credential is there. Dashboard-safe: it carries no secret values.
 */
function describeAll(options) {
  const registry = (options && options.registry) || loadSources(options);
  return registry.sources.map((source) => {
    const presence = credentialPresence(source, options);
    return {
      id: source.id,
      label: source.label || source.id,
      kind: source.kind,
      servesModels: source.servesModels !== false,
      countsAsCapacity: CAPACITY_KINDS.has(source.kind) && source.servesModels !== false,
      harness: source.harness || null,
      reachedVia: source.reachedVia || null,
      credentialRequired: presence.required,
      credentialPresent: presence.present,
      credentialHow: presence.how,
    };
  });
}

/**
 * How a registry account's `provider` reaches a running session.
 *
 * Returns { harness, provider, modelPrefix } or null. The lookup lives in
 * sources.json so that adding a provider is a row rather than a branch in the
 * executor — the `if/else` chain in dispatch.sh is what this replaces.
 */
function dispatchRoute(provider, registry) {
  const reg = registry || loadSources();
  const table = ((reg && reg.dispatch) || {}).providers || {};
  const route = table[String(provider || '').toLowerCase()];
  if (!route) return null;
  return {
    harness: route.harness,
    provider: route.provider,
    modelPrefix: route.modelPrefix || '',
  };
}

/** The model id as the harness expects it, prefix applied once. */
function qualifyModel(model, route) {
  const name = String(model || '');
  const prefix = (route && route.modelPrefix) || '';
  if (!name || !prefix || name.startsWith(prefix)) return name;
  return prefix + name;
}

/**
 * Derives the harness/toolchain provider id from a modelPrefix, source, or qualified model string.
 *
 * e.g. 'ninerouter/' -> 'ninerouter'
 *      'ninerouter/ag/' -> 'ninerouter'
 *      'ninerouter/ag/gemini-3.1-pro-low' -> 'ninerouter'
 */
function providerFromPrefix(target) {
  if (!target) return '';
  const raw =
    typeof target === 'object' ? target.modelPrefix || target.prefix || '' : String(target);
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return trimmed.split('/')[0].trim();
}

/**
 * Whether a harness name runs the OpenCode CLI (e.g. 'opencode' or 'paseo'),
 * decided from registry data (sources.json harness field), never by hard-coding
 * a model or provider.
 */
function runsOpenCodeHarness(harnessName, registry) {
  if (!harnessName) return false;
  const name = String(harnessName).toLowerCase();
  const reg = registry || loadSources();
  const sources = reg && Array.isArray(reg.sources) ? reg.sources : [];
  const openCodeHarnesses = new Set(
    sources
      .map((s) => s && s.harness && String(s.harness).toLowerCase())
      .filter((h) => h === 'opencode' || h === 'paseo')
  );
  openCodeHarnesses.add('opencode');
  openCodeHarnesses.add('paseo');
  return openCodeHarnesses.has(name);
}

function getDispatchConfig(registry, options = {}) {
  let dispatch = {};
  try {
    dispatch = (registry && registry.dispatch) || {};
  } catch {
    dispatch = {};
  }
  const probeBudgetMs = Number(options.probeBudgetMs ?? dispatch.probeBudgetMs) || 180000;
  const maxConcurrentProbes =
    Number(options.maxConcurrentProbes ?? dispatch.maxConcurrentProbes) || 8;
  const probeTimeoutMs = Number(options.probeTimeoutMs ?? dispatch.probeTimeoutMs) || 8000;
  const safetyMarginMs =
    Number(
      options.probeSafetyMarginMs ??
        options.safetyMarginMs ??
        dispatch.probeSafetyMarginMs ??
        dispatch.safetyMarginMs
    ) || 2000;
  const schemaProbeBudgetMs =
    Number(
      options.schemaProbeBudgetMs ??
        options.schemaBudgetMs ??
        dispatch.schemaProbeBudgetMs ??
        dispatch.schemaBudgetMs ??
        probeBudgetMs
    ) || probeBudgetMs;
  const routeEvidenceMaxAgeMs = Number(
    options.routeEvidenceMaxAgeMs ??
      dispatch.routeEvidenceMaxAgeMs ??
      DEFAULT_DISPATCH.routeEvidenceMaxAgeMs
  );
  const defaults = require('./sources.json').dispatch;
  const configuredLimit = (key) => {
    const value = Number(options[key] ?? dispatch[key] ?? defaults[key]);
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('DISPATCH_CONFIG_INVALID: ' + key + ' must be a positive integer');
    }
    return value;
  };
  const configuredNonNegativeLimit = (key, fallbackKey) => {
    const optVal = options[key] ?? (fallbackKey ? options[fallbackKey] : undefined);
    const dispVal = dispatch[key] ?? (fallbackKey ? dispatch[fallbackKey] : undefined);
    const defVal = defaults[key] ?? (fallbackKey ? defaults[fallbackKey] : undefined);
    const value = Number(optVal ?? dispVal ?? defVal);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('DISPATCH_CONFIG_INVALID: ' + key + ' must be a non-negative integer');
    }
    return value;
  };
  return {
    routeEvidenceMaxAgeMs,
    maxWriterSelectionRounds: configuredLimit('maxWriterSelectionRounds'),
    maxLocalWriterFallbacks: configuredNonNegativeLimit('maxLocalWriterFallbacks'),
    maxItemDurationMs: configuredLimit('maxItemDurationMs'),
    probeBudgetMs,
    maxConcurrentProbes,
    probeTimeoutMs,
    safetyMarginMs,
    schemaProbeBudgetMs,
    probeRoundRobinBatch: configuredLimit('probeRoundRobinBatch'),
    quotaProbeMaxOutputTokens: configuredLimit('quotaProbeMaxOutputTokens'),
    maxPromptCommandOutputChars: configuredLimit('maxPromptCommandOutputChars'),
    maxHostGateSummaryChars: configuredLimit('maxHostGateSummaryChars'),
    rateLimitCooldownMs: configuredLimit('rateLimitCooldownMs'),
    headroomUnknownPenalty: configuredNonNegativeLimit(
      'headroomUnknownPenalty',
      'unknownHeadroomPenalty'
    ),
    headroomTightPenalty: configuredNonNegativeLimit(
      'headroomTightPenalty',
      'tightHeadroomPenalty'
    ),
    unknownHeadroomPenalty: configuredNonNegativeLimit(
      'headroomUnknownPenalty',
      'unknownHeadroomPenalty'
    ),
    tightHeadroomPenalty: configuredNonNegativeLimit(
      'headroomTightPenalty',
      'tightHeadroomPenalty'
    ),
  };
}

function isAgyPoolWriterEnabled(registry, options = {}) {
  if (options.allowAgyPoolWriter !== undefined) return Boolean(options.allowAgyPoolWriter);
  let dispatch = {};
  try {
    dispatch = registry?.dispatch || {};
  } catch {
    dispatch = {};
  }
  let sources = [];
  try {
    sources = registry?.sources || [];
  } catch {
    sources = [];
  }
  const source = sources.find((s) => s.id === 'agy-pool');
  if (source?.writerEnabled !== undefined) {
    const enabled = Boolean(source.writerEnabled);
    if (!enabled) return false;
    if (options.externalWorkers !== undefined) {
      return String(options.externalWorkers || '')
        .split(',')
        .includes('agy-pool');
    }
    return true;
  }
  if (source?.allowWriter !== undefined) {
    const enabled = Boolean(source.allowWriter);
    if (!enabled) return false;
    if (options.externalWorkers !== undefined) {
      return String(options.externalWorkers || '')
        .split(',')
        .includes('agy-pool');
    }
    return true;
  }
  if (dispatch.agyPoolWriterEnabled !== undefined) {
    return Boolean(dispatch.agyPoolWriterEnabled);
  }
  if (options.externalWorkers !== undefined) {
    return String(options.externalWorkers || '')
      .split(',')
      .includes('agy-pool');
  }
  return false;
}

function resolveProbeTimeout(candidate, record, dispatchConfig, remainingMs) {
  const cfg = dispatchConfig || {};
  const safetyMarginMs = Number(cfg.probeSafetyMarginMs ?? cfg.safetyMarginMs) || 2000;
  const defaultTimeout = Number(cfg.probeTimeoutMs) || 8000;
  let measuredElapsedMs = candidate?.elapsedMs ?? record?.elapsedMs;
  if (!measuredElapsedMs && candidate?.harness === 'agy-pool') {
    try {
      const pool = require('./agy-pool-runtime');
      if (typeof pool.readLastRunElapsedMs === 'function') {
        measuredElapsedMs = pool.readLastRunElapsedMs(candidate.accountId);
      }
    } catch {}
  }
  const fallbackTimeout =
    candidate?.harness === 'agy-pool'
      ? Number(cfg.schemaProbeBudgetMs) || defaultTimeout
      : defaultTimeout;
  const baseTimeout =
    Number.isFinite(measuredElapsedMs) && measuredElapsedMs > 0
      ? measuredElapsedMs + safetyMarginMs
      : fallbackTimeout;
  return Number.isFinite(remainingMs)
    ? Math.max(1, Math.min(baseTimeout, remainingMs))
    : Math.max(1, baseTimeout);
}

module.exports = {
  Kind,
  CAPACITY_KINDS,
  DEFAULT_PATH,
  loadSources,
  getSource,
  isRetired,
  isDeferred,
  refuseReason,
  capacitySources,
  harnessSources,
  credentialPresence,
  describeAll,
  dispatchRoute,
  qualifyModel,
  providerFromPrefix,
  runsOpenCodeHarness,
  getDispatchConfig,
  isAgyPoolWriterEnabled,
  resolveProbeTimeout,
};
