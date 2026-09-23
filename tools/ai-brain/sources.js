'use strict';

/**
 * Ship Dễ — Source registry (TASK-AI-48)
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

const Kind = Object.freeze({
  MODEL_SOURCE: 'model-source',
  ROUTER: 'router',
  AGENT_CLI: 'agent-cli',
  HARNESS: 'harness',
  ORCHESTRATOR: 'orchestrator',
  DECISION_SERVICE: 'decision-service',
});

const KNOWN_KINDS = new Set(Object.values(Kind));

/** Kinds that can be asked to produce tokens. A harness is not one of them. */
const CAPACITY_KINDS = new Set([Kind.MODEL_SOURCE, Kind.ROUTER]);

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

  for (const source of sources) {
    if (!source || !source.id) throw new Error('sources.json: an entry has no id');
    if (!KNOWN_KINDS.has(source.kind)) {
      // An unknown kind is refused rather than defaulted. Defaulting to
      // model-source is exactly the error this file exists to stop, and it
      // would be invisible until the scheduler over-planned against it.
      throw new Error('sources.json: ' + source.id + ' has unknown kind "' + source.kind + '"');
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
  const table = ((registry && registry.dispatch) || {}).providers || {};
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

module.exports = {
  Kind,
  CAPACITY_KINDS,
  DEFAULT_PATH,
  loadSources,
  getSource,
  isRetired,
  refuseReason,
  capacitySources,
  harnessSources,
  credentialPresence,
  describeAll,
  dispatchRoute,
  qualifyModel,
};
