'use strict';

/**
 * Ship Dễ — Model discovery: source → catalogue adapters (W2)
 *
 * The registry (`sources.json`) is the only list of what exists. An adapter's
 * only job is to read the catalogue a source can legitimately expose and to
 * say honestly which sources it cannot or must not read. A source is
 * enumerated only through data, never by a code branch on a source id: the
 * switch here is on `kind`, the behaviour a source declares, which is the one
 * place the registry may not invent.
 *
 * Rules that live in the matrix:
 *
 *  - router:          GET its /models endpoint. A gateway's catalogue is the
 *                     union of the accounts logged into it (9Router's own
 *                     comment) so the group an id comes from is recorded, and
 *                     the id themselves are evidence of routing, never of
 *                     capacity. Split by `owned_by` when the gateway reports
 *                     more than one; one owner collapses into the gateway.
 *  - model-source:    enumerated when the registry declares an endpoint;
 *                     otherwise mapped through its `reachedVia` gateway when
 *                     the gateway exposes it under `routerAlias`; otherwise
 *                     honestly `unknown` — never invented.
 *  - agent-cli:       carries no models of its own when `servesModels:false`.
 *                     When `servesModels:true` this workspace cannot enumerate
 *                     it without either running a model call or reading another
 *                     Windows user's credential, so it is presence-checked and
 *                     reported `unknown` — that is the honest answer, and the
 *                     presence comes from the same resolver the executor uses.
 *  - orchestrator:    exposes the dispatch table's providers through its own
 *                     `provider models` listing. Providers routed to a banned
 *                     CLI are not-permitted and are skipped before anything runs.
 *  - harness (planning): resolves its model per task; no catalogue of its own.
 *  - decision-service: provides no language models at all.
 *
 * RECALL: a source under retirement is never enumerated. If enumeration would
 * persist a model from a recalled source the pipeline is required to refuse,
 * which is what `recall()` exists for.
 */

const path = require('path');

const DEFAULT_MODELS_PATH = '/models';

const NOT_PERMITTED = {
  codex:
    'the operator has banned the codex CLI for plan/review-only slots; its models are never enumerated',
};

const RECALL = {
  ao: 'retired 2026-09-22, replaced by paseo',
  'agy-docker': 'retired 2026-09-22, native agy pool replaced it',
  '9a-overlay': 'retired; overlay catalogue must not be re-imported',
};

/**
 * A catalog is one coherent collection of models reachable through one route.
 */
function catalog({ upstream, gateway, accessPath, harness, account, quotaScope, models }) {
  return {
    upstream: String(upstream),
    gateway: gateway === null || gateway === undefined ? '' : String(gateway),
    accessPath: String(accessPath),
    harness: String(harness),
    account: account === null || account === undefined ? '' : String(account),
    quotaScope: quotaScope === null || quotaScope === undefined ? '' : String(quotaScope),
    count: models.length,
    models,
  };
}

/**
 * Group an OpenAI-style models listing. Grouping key is the reported owner,
 * but only when the gateway reports several distinct ones; a single owner
 * (Requesty's `system`, TokenHarbor's virtual account) means the gateway
 * itself is the route the id rides.
 */
function groupByOwner(data, fallbackUpstream) {
  const owners = new Set();
  for (const entry of data) {
    if (entry && typeof entry.owned_by === 'string' && entry.owned_by.trim() !== '') {
      owners.add(entry.owned_by.trim());
    }
  }
  const groups = new Map();
  if (owners.size <= 1) {
    groups.set(String(fallbackUpstream), []);
    for (const entry of data) {
      if (entry && typeof entry.id === 'string' && entry.id.trim() !== '') {
        groups.get(String(fallbackUpstream)).push(entry.id.trim());
      }
    }
    return groups;
  }
  for (const owner of owners) groups.set(owner, []);
  for (const entry of data) {
    if (entry && typeof entry.id === 'string' && entry.id.trim() !== '') {
      const owner = (entry.owned_by || '').trim() || String(fallbackUpstream);
      if (groups.has(owner)) groups.get(owner).push(entry.id.trim());
    }
  }
  return groups;
}

function joinUrl(root, suffix) {
  return String(root).replace(/\/$/, '') + String(suffix);
}

function routerAdapter() {
  return async function enumerateRouter(source, ctx) {
    const endpoint = source.endpoint;
    if (!endpoint) {
      return {
        status: 'unknown',
        reason: 'registry declares no endpoint for an HTTP router',
        catalogs: [],
      };
    }
    const verifyPath = (source.verify && source.verify.path) || DEFAULT_MODELS_PATH;
    const url = joinUrl(endpoint, verifyPath);
    const res = await ctx.httpGet(url, {
      envName: source.credential && source.credential.env,
      timeoutMs: 10000,
    });
    if (!res.ok || !res.parsed || !Array.isArray(res.parsed.data)) {
      const isUnavailable =
        !res.ok &&
        (res.status === 0 || (res.error && /abort|timeout|refused|reset|fetch/i.test(res.error)));
      return {
        status: isUnavailable ? 'unavailable' : 'error',
        reason: isUnavailable
          ? 'catalogue unavailable at this moment'
          : res.ok
            ? 'catalogue did not contain a data array'
            : `catalogue request failed with http ${res.status}`,
        catalogs: [],
        requests: [res.request],
      };
    }
    const groups = groupByOwner(res.parsed.data, source.id);
    const catalogs = [];
    const routerAccount = source.account || (source.credential && source.credential.account) || '';
    const routerQuotaScope = (source.quota && source.quota.scope) || source.quotaScope || '';
    for (const [upstream, ids] of groups) {
      catalogs.push(
        catalog({
          upstream,
          gateway: source.id,
          accessPath: source.id,
          harness: 'http',
          account: routerAccount,
          quotaScope: routerQuotaScope,
          models: ids,
        })
      );
    }
    return { status: 'enumerated', reason: null, catalogs, requests: [res.request] };
  };
}

function modelSourceAdapter() {
  return async function enumerateModelSource(source, ctx) {
    const endpoint = source.endpoint;
    if (endpoint) {
      const verifyPath = (source.verify && source.verify.path) || DEFAULT_MODELS_PATH;
      const url = joinUrl(endpoint, verifyPath);
      const res = await ctx.httpGet(url, { envName: source.credential && source.credential.env });
      if (!res.ok || !res.parsed || !Array.isArray(res.parsed.data)) {
        return {
          status: 'error',
          reason: res.ok
            ? 'catalogue did not contain a data array'
            : `catalogue request failed with http ${res.status}`,
          catalogs: [],
          requests: [res.request],
        };
      }
      const groups = groupByOwner(res.parsed.data, source.id);
      const catalogs = [];
      const keyDirs =
        source.credential && Array.isArray(source.credential.keyDirs)
          ? source.credential.keyDirs
          : null;
      const accounts =
        keyDirs && keyDirs.length > 0
          ? keyDirs
          : [source.account || (source.credential && source.credential.account) || ''];
      const quotaScope = (source.quota && source.quota.scope) || source.quotaScope || '';
      for (const acc of accounts) {
        for (const [upstream, ids] of groups) {
          catalogs.push(
            catalog({
              upstream,
              gateway: '',
              accessPath: source.id,
              harness: 'http',
              account: acc,
              quotaScope,
              models: ids,
            })
          );
        }
      }
      return { status: 'enumerated', reason: null, catalogs, requests: [res.request] };
    }

    // No endpoint: a gateway-routed source maps through the gateway's listing
    // when the registry says how it is aliased there.
    if (source.reachedVia && source.routerAlias) {
      const via = source.reachedVia;
      const gatewayResult = ctx.lookupRoute(via);
      const matched =
        gatewayResult && gatewayResult.status === 'enumerated'
          ? gatewayResult.catalogs.find((c) => c.upstream === source.routerAlias)
          : null;
      if (matched) {
        return {
          status: 'enumerated-via-route',
          reason: null,
          mapped: { via, upstream: source.routerAlias },
          catalogs: [
            catalog({
              upstream: source.routerAlias,
              gateway: via,
              accessPath: via,
              harness: 'http',
              account:
                source.account ||
                (source.credential && source.credential.account) ||
                (matched && matched.account) ||
                '',
              quotaScope:
                (source.quota && source.quota.scope) ||
                source.quotaScope ||
                (matched && matched.quotaScope) ||
                '',
              models: matched.models,
            }),
          ],
        };
      }
      return {
        status: 'unknown',
        reason: `registry declares no endpoint and gateway \`${via}\` did not expose alias \`${source.routerAlias}\``,
        catalogs: [],
      };
    }

    return {
      status: 'unknown',
      reason: 'registry declares no endpoint and no reachedVia route for this source',
      catalogs: [],
    };
  };
}

function agentCliAdapter() {
  return async function enumerateAgentCli(source, ctx) {
    const banned = NOT_PERMITTED[source.id];
    if (banned) {
      return { status: 'not-permitted', reason: banned, catalogs: [] };
    }
    if (source.servesModels === false) {
      return {
        status: 'no-models',
        reason:
          'harness carries no models of its own; every model arrives through a configured gateway',
        catalogs: [],
      };
    }
    // servesModels: true but no catalogue endpoint. Enumerating would require
    // a model call, or (agy) reading another Windows user's credential — both
    // outside this slice's remit. Presence is recorded from the resolver only.
    const harness = source.harness || source.id;
    const presence = ctx.resolveCommand ? ctx.resolveCommand(harness) : null;
    return {
      status: 'unknown',
      reason:
        source.id === 'agy-local'
          ? 'one credential per Windows user, readable only by that user session; cannot enumerate an account catalogue from this workspace'
          : 'CLI harness resolves its models at call time; the registry declares no catalogue endpoint',
      catalogs: [],
      presence,
    };
  };
}

function orchestratorAdapter() {
  return async function enumerateOrchestrator(source, ctx) {
    const dispatch = ((ctx.registry || {}).dispatch || {}).providers || {};
    const providers = new Map(); // provider name -> modelPrefix candidates
    for (const key of Object.keys(dispatch)) {
      const entry = dispatch[key] || {};
      if (entry.harness !== 'paseo') continue;
      const provider = entry.provider;
      if (!providers.has(provider)) providers.set(provider, []);
      if (entry.modelPrefix) providers.get(provider).push(entry.modelPrefix);
    }

    const catalogs = [];
    const requests = [];
    const notes = [];
    for (const provider of [...providers.keys()]) {
      if (NOT_PERMITTED[provider]) {
        notes.push(`{provider}:${provider} skipped — ${NOT_PERMITTED[provider]}`);
        continue;
      }
      const res = await ctx.runCommand('paseo', ['provider', 'models', provider, '--json'], {
        timeoutMs: 60000,
      });
      if (res.enoent) {
        notes.push(`{provider}:${provider} — paseo itself is not on PATH`);
        continue;
      }
      let parsed = null;
      try {
        parsed = JSON.parse(res.stdout.trim());
      } catch (e) {
        parsed = null;
      }
      if (res.exitCode === 0 && Array.isArray(parsed)) {
        // The id on the paseo path carries its own route prefix, e.g.
        // `paseo provider models opencode` reports `ninerouter/gh/gpt-4.1`,
        // `agentrouter/…`, `requesty/…`. Identity on this path is the raw id
        // plus the provider route as gateway; upstream is the prefix segment
        // the id itself declares, so two prefixes never collapse.
        const routeGroups = new Map();
        for (const entry of parsed) {
          const id = entry && entry.id;
          if (typeof id !== 'string' || id.trim() === '') continue;
          const cleaned = id.trim();
          const segment =
            cleaned.indexOf('/') === -1 ? provider : cleaned.slice(0, cleaned.indexOf('/'));
          if (!routeGroups.has(segment)) routeGroups.set(segment, []);
          routeGroups.get(segment).push(cleaned);
        }
        const orchAccount =
          source.account || (source.credential && source.credential.account) || '';
        const orchQuotaScope = (source.quota && source.quota.scope) || source.quotaScope || '';
        for (const [upstream, groupIds] of routeGroups) {
          catalogs.push(
            catalog({
              upstream,
              gateway: provider,
              accessPath: 'paseo',
              harness: 'paseo',
              account: orchAccount,
              quotaScope: orchQuotaScope,
              models: groupIds,
            })
          );
        }
      } else {
        notes.push(`{provider}:${provider} — models listing failed (exit ${res.exitCode})`);
        requests.push({ url: `paseo provider models ${provider}`, exitCode: res.exitCode });
      }
    }
    return { status: 'enumerated', reason: null, catalogs, notes, requests };
  };
}

function harnessAdapter() {
  return async function enumerateHarness(source) {
    return {
      status: 'no-models',
      reason: 'reasoning model is resolved per task from the registry; never pinned',
      catalogs: [],
    };
  };
}

function decisionAdapter() {
  return async function enumerateDecision(source) {
    return {
      status: 'no-models',
      reason: 'decision-service answers closed questions, not language models',
      catalogs: [],
    };
  };
}

/**
 * Every adapter keyed by the registry `kind` it serves. Active id => active
 * kind switch is prohibited; this table is the switch.
 */
const ADAPTERS = {
  router: routerAdapter,
  'model-source': modelSourceAdapter,
  'agent-cli': agentCliAdapter,
  orchestrator: orchestratorAdapter,
  harness: harnessAdapter,
  'decision-service': decisionAdapter,
};

function adapterKind(source) {
  const kind = source && source.kind;
  if (ADAPTERS[kind]) return kind;
  return null;
}

/** Refuse to persist a model from a source under retirement. */
function recall(sourceId) {
  return RECALL[sourceId] || null;
}

/**
 * Enumerate one source through its kind adapter.
 *
 * @param source registry entry
 * @param ctx    { httpGet, runCommand, resolveCommand, lookupRoute, registry }
 * @returns adapter result (never throws; resolution failures are results)
 */
async function enumerate(source, ctx) {
  if (recall(source.id)) {
    return { status: 'recalled', reason: recall(source.id), catalogs: [], presence: null };
  }
  const kind = adapterKind(source);
  if (!kind) {
    return {
      status: 'unknown',
      reason: `registry kind \`${source.kind}\` has no adapter`,
      catalogs: [],
    };
  }
  try {
    const impl = ADAPTERS[kind]();
    return await impl(source, ctx);
  } catch (e) {
    return { status: 'error', reason: String((e && e.message) || e), catalogs: [] };
  }
}

module.exports = {
  ADAPTERS,
  NOT_PERMITTED,
  RECALL,
  catalog,
  groupByOwner,
  enumerate,
  recall,
  joinUrl,
};
