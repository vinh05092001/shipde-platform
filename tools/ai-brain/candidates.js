'use strict';

/**
 * Ship Dễ — Candidate Generator (Slices B+C)
 *
 * Generates seven-part candidates from the source registry, a live model
 * catalogue and the account registry. A candidate is always:
 *
 *   (harness, accessPath, gateway, upstream, accountId, quotaScope, modelId)
 *
 * The same model reached two different ways is two candidates, because they
 * fail independently and they are limited independently. The same model on
 * the same route through two different accounts is also two candidates,
 * because each account carries its own quota. `gateway` names the router that
 * forwards the request (9Router, Requesty, TokenHarbor) or is empty for a
 * direct CLI route. `quotaScope` names the budget the candidate draws from:
 * the account for per-account quota, the upstream prefix for a shared gateway,
 * or the CLI source for a harness that runs models itself.
 *
 * 9Router is a gateway, not a source. Its catalogue is the union of the
 * accounts logged into it, so a model id proves routing, never capacity.
 * Each upstream prefix (cl, kr, gh, ag, …) is an independent failure and
 * quota domain.
 *
 * No model name, harness name or access path is hard-coded here. Every value
 * comes from data: the live catalogue, evidence.json, the caller-supplied
 * account list, or the source registry. A name in the code is the bug; a
 * name in the data is fine. A source that declares no harness or no access
 * path is skipped rather than guessed, because guessing a harness is how a
 * candidate that can never run gets planned.
 */

const fs = require('fs');
const path = require('path');
const sourcesApi = require('./sources');
const evidence = require('./evidence');
const { toPositiveInteger } = require('./source-discovery');

/**
 * Parse upstream prefix from a gateway model id.
 * e.g. "gh/gpt-4o" → { upstream: "gh", model: "gpt-4o" }
 */
function parsePrefix(modelId) {
  const str =
    typeof modelId === 'string'
      ? modelId
      : (modelId && (modelId.modelId || modelId.model || modelId.id)) || '';
  const idx = str.indexOf('/');
  if (idx < 1) return null;
  return { upstream: str.slice(0, idx), model: str.slice(idx + 1) };
}

/**
 * Resolves a model ID against a router/gateway source.
 * A router forwards requests to upstream providers, so every valid model
 * reachable through a router MUST carry an upstream prefix (e.g. "cl/...", "ag/...").
 *
 * If the model ID starts with the router's prefix (from source.modelPrefix,
 * source.id + '/', or dispatch table), that prefix is stripped to uncover
 * the inner model ID.
 *
 * Returns { upstream, innerModelId } if valid, or null if the inner model has no
 * upstream prefix (bare model, e.g. "gpt-6-astra", "muse-spark-1-3") or refers
 * to the router itself as upstream.
 */
function resolveRouterModel(modelId, routerSource, registry, cliSource) {
  if (!modelId) return null;
  const routerId = routerSource && routerSource.id;
  if (routerId === 'agy-gateway' || (cliSource && cliSource.id === 'agy-gateway')) return null;
  const raw =
    typeof modelId === 'string'
      ? modelId
      : (modelId && (modelId.modelId || modelId.model || modelId.id)) || '';
  if (!raw) return null;

  const prefixes = new Set();
  if (routerSource && routerSource.modelPrefix) prefixes.add(routerSource.modelPrefix);
  if (cliSource && cliSource.modelPrefix) prefixes.add(cliSource.modelPrefix);
  if (routerId) prefixes.add(routerId + '/');
  if (cliSource && cliSource.id) prefixes.add(cliSource.id + '/');

  const dispatch = (registry && registry.dispatch && registry.dispatch.providers) || {};
  if (routerId && dispatch[routerId]?.modelPrefix) prefixes.add(dispatch[routerId].modelPrefix);
  if (cliSource && cliSource.id && dispatch[cliSource.id]?.modelPrefix) {
    prefixes.add(dispatch[cliSource.id].modelPrefix);
  }

  let inner = raw;
  const sortedPrefixes = Array.from(prefixes).sort((a, b) => b.length - a.length);
  for (const prefix of sortedPrefixes) {
    const p = prefix.endsWith('/') ? prefix : prefix + '/';
    if (inner.startsWith(p)) {
      inner = inner.slice(p.length);
      break;
    }
  }

  const parsed = parsePrefix(inner);
  if (!parsed) {
    const itemUpstream = typeof modelId === 'object' && modelId ? modelId.upstream : null;
    if (itemUpstream) {
      return { upstream: itemUpstream, innerModelId: inner };
    }
    if (routerSource && (!routerSource.modelPrefix || routerSource.id === 'thb')) {
      return { upstream: routerSource.id, innerModelId: inner };
    }
    return null;
  }

  for (const prefix of sortedPrefixes) {
    const clean = prefix.replace(/\/$/, '');
    if (parsed.upstream === clean) return null;
  }
  if (routerId && parsed.upstream === routerId) return null;
  if (cliSource && cliSource.id && parsed.upstream === cliSource.id) return null;

  return { upstream: parsed.upstream, innerModelId: inner };
}

const { candidateKey } = require('./discovery/identity');

/**
 * The harness a source reaches its models through. A router or agent-cli
 * names its own harness; a model-source reached via a router uses the
 * gateway's harness, because that is the program that actually launches the
 * session. Returns null when the registry says nothing — the caller skips
 * the source rather than guessing.
 */
function harnessOf(source, registry) {
  if (source.kind === 'router' || source.kind === 'agent-cli') {
    return source.harness || null;
  }
  if (source.reachedVia) {
    const router = registry.sources.find((s) => s.id === source.reachedVia);
    return (router && router.harness) || null;
  }
  return null;
}

/**
 * The access path a source is reachable on. A router uses its own endpoint.
 * An agent-cli uses its declared accessPath ('cli'). A model-source reached via
 * a router uses the router's endpoint. Returns null when undeclared (fails closed).
 */
function accessPathOf(source, registry) {
  if (source.kind === 'router' || source.kind === 'agent-cli') {
    return source.accessPath || source.endpoint || null;
  }
  if (source.reachedVia) {
    const router = registry.sources.find((s) => s.id === source.reachedVia);
    return (router && (router.accessPath || router.endpoint)) || null;
  }
  return source.accessPath || null;
}

/** Accounts bound to a source id. */
function accountsFor(accounts, sourceId, registry) {
  const source = registry?.sources?.find((s) => s.id === sourceId);
  const providers = new Set([sourceId, ...(source?.accountProviders || [])]);
  return (accounts || []).filter(
    (a) => providers.has(a.sourceId) || providers.has(a.source) || providers.has(a.provider)
  );
}

function deriveCredentialAccountId(source) {
  const envName = String(
    (source && source.credential && (source.credential.env || source.credential.name)) ||
      (source && source.apiKeyEnv) ||
      ''
  ).trim();
  if (!envName) return source.id;
  const suffix = envName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${source.id}-${suffix}`;
}

/** Model names an account declares, normalised to strings. */
function accountModels(account) {
  const declared = (account && account.models) || [];
  return declared.map((m) => (typeof m === 'string' ? m : m && m.model)).filter(Boolean);
}

/**
 * Native agy accounts take their model ids from the live `agy models` listing
 * (the same discovery the pool uses) when it is available: declared ids the CLI
 * no longer lists are dropped, listed ids are added. With no listing, the
 * declared ids stand.
 */
function liveAgyAccountModels(acc, source, models, o) {
  const isAgy = source && source.harness === 'agy';
  if (!isAgy || !o || o.discoverPool === false) return models;
  if (!o.__agyListing) {
    let listed = [];
    try {
      listed = require('./agy-pool-runtime').discoverPoolModels(o);
    } catch {}
    Object.defineProperty(o, '__agyListing', {
      value: new Set((listed || []).filter(Boolean)),
      enumerable: false,
    });
  }
  const live = o.__agyListing;
  if (live.size === 0) return models;
  const out = [];
  for (const model of models) {
    if (live.has(model)) out.push(model);
    else if (Array.isArray(o.candidateGenerationRejections)) {
      o.candidateGenerationRejections.push({ modelId: model, reasonCode: 'AGY_MODEL_NOT_LISTED' });
    }
  }
  for (const model of live) if (!out.includes(model)) out.push(model);
  return out;
}

/**
 * A Codex CLI the operator is already logged into is a bound account without a
 * registry entry: existence of ~/.codex/auth.json (never its content) proves the
 * login and the model ids come only from ~/.codex/config.toml. The same helpers
 * the Hermes brain uses decide both, so writer and brain see the same Codex.
 * Registry-declared accounts take precedence (the caller only asks when none is bound).
 */
function implicitCliLoginAccount(source, registry, o) {
  if (!source || source.kind !== 'agent-cli' || source.modelsFrom !== 'account') return null;
  if (harnessOf(source, registry) !== 'codex') return null;
  // Without injected options the login is looked up under the process home only
  // (CODEX_HOME, else USERPROFILE/HOME), so an isolated HOME stays isolated.
  const env = process.env;
  const codexOpts =
    o.codexOpts ||
    (env.CODEX_HOME
      ? { codexDir: env.CODEX_HOME }
      : { homeDir: env.USERPROFILE || env.HOME || require('os').homedir() });
  // Lazy: hermes-session requires this module.
  const hermes = require('./hermes-session');
  if (!hermes.hasCodexAuth(codexOpts, codexOpts)) return null;
  const models = hermes.readCodexConfigModels(
    Object.assign({}, codexOpts, { strict: true }),
    codexOpts
  );
  if (!models.length) return null;
  return {
    id: `${source.id}-cli`,
    sourceId: source.id,
    models,
    binding: 'cli-login',
    evidence: 'cli-login',
    quota: source.quota,
  };
}

function accountModelRow(account, model) {
  const declared = (account && account.models) || [];
  return declared.find((m) => m && typeof m === 'object' && m.model === model) || null;
}

function isOpenAiCompatibleSource(source, registry) {
  if (!source || typeof source !== 'object') return false;
  if (sourcesApi.isRetired(source.id, registry)) return false;
  if (sourcesApi.isDeferred(source.id, registry)) return false;
  if (source.servesModels === false) return false;
  if (source.status === 'parked' || source.discoveryStatus === 'parked') return false;

  const endpoint =
    source.endpoint ||
    (source.accessPath && /^https?:\/\//i.test(source.accessPath) ? source.accessPath : null);
  if (!endpoint || typeof endpoint !== 'string') return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  } catch {
    return false;
  }

  const cred = source.credential;
  let envKey = null;
  if (typeof cred === 'string') envKey = cred;
  else if (cred && typeof cred === 'object') {
    if (cred.env && typeof cred.env === 'string') envKey = cred.env;
    else if (cred.type === 'env' && cred.name && typeof cred.name === 'string') envKey = cred.name;
    else if (cred.name && typeof cred.name === 'string') envKey = cred.name;
  }
  if (!envKey && source.apiKeyEnv && typeof source.apiKeyEnv === 'string')
    envKey = source.apiKeyEnv;
  if (!envKey || !/^[A-Za-z0-9_]+$/.test(envKey)) return false;

  return true;
}

function resolveCandidateContextMeta(candidate, registry) {
  if (!candidate) return null;
  const modelId = candidate.modelId || candidate.model;
  if (!modelId) return null;

  const sources = (registry && registry.sources) || [];
  let src = null;
  const srcId = candidate.sourceId || candidate.source;
  const endpoint = candidate.sourceEndpoint || candidate.endpoint;

  if (srcId) {
    src = sources.find((s) => s && s.id === srcId) || null;
  } else if (endpoint) {
    src = sources.find((s) => s && s.endpoint === endpoint) || null;
  } else if (candidate.gateway) {
    src = sources.find((s) => s && s.id === candidate.gateway) || null;
  }
  if (!src || !src.modelMeta) return null;
  const m = src.modelMeta[modelId];
  if (!m || typeof m !== 'object') return null;
  const cw = toPositiveInteger(m.contextWindow);
  if (cw === undefined) return null;
  return {
    ...m,
    contextWindow: cw,
    maxOutputTokens: toPositiveInteger(m.maxOutputTokens),
  };
}

// Public model catalog (models.dev) evidence. Used ONLY when the model's own
// metadata reports no context window, so a route such as 9router, whose
// /v1/models lists ids without limits, still gets documented evidence.
const CATALOG_EVIDENCE = 'catalog:models.dev';
let ambientModelCatalog;
const catalogFileCache = new Map();
const catalogIndexCache = new WeakMap();

function catalogLeaf(id) {
  if (typeof id !== 'string' || !id.trim()) return '';
  const leaf = id.trim().toLowerCase().split('/').pop().split('@')[0];
  return leaf.replace(/:[a-z0-9_-]+$/, '').replace(/[._\s]+/g, '-');
}

function loadModelCatalog(opts = {}) {
  if (opts.modelCatalog && typeof opts.modelCatalog === 'object') return opts.modelCatalog;
  if (ambientModelCatalog && typeof ambientModelCatalog === 'object') return ambientModelCatalog;
  let file = opts.modelCatalogPath;
  // AI_BRAIN_MACHINE_DATA=none: no machine caches (the host brain gate sets
  // it so the suite sees what CI sees). An explicit catalogue path still counts.
  if (!file && process.env.AI_BRAIN_MACHINE_DATA === 'none') return null;
  if (!file) {
    try {
      const home =
        opts.hermesHome ||
        require('./hermes-session').getHermesHomeDir(opts.rootDir || process.cwd());
      file = path.join(home, 'models_dev_cache.json');
    } catch {
      return null;
    }
  }
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = catalogFileCache.get(file);
    if (hit && hit.mtime === mtime) return hit.data;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    catalogFileCache.set(file, { mtime, data });
    return data;
  } catch {
    return null;
  }
}

function catalogIndex(catalog) {
  let index = catalogIndexCache.get(catalog);
  if (index) return index;
  index = new Map();
  const providers = catalog.providers || catalog;
  for (const provider of Object.values(providers)) {
    const models = provider && typeof provider === 'object' ? provider.models : null;
    if (!models || typeof models !== 'object') continue;
    for (const [key, m] of Object.entries(models)) {
      const leaf = catalogLeaf((m && m.id) || key);
      if (!leaf || !m || typeof m !== 'object') continue;
      const list = index.get(leaf) || [];
      list.push(m);
      index.set(leaf, list);
    }
  }
  catalogIndexCache.set(catalog, index);
  return index;
}

/**
 * Looks a model up by its canonical leaf id (router/upstream prefixes dropped).
 * Several providers list the same model; the most conservative window wins.
 */
function catalogEvidenceFor(modelId, catalog) {
  if (!catalog || typeof catalog !== 'object') return null;
  const matches = catalogIndex(catalog).get(catalogLeaf(modelId));
  if (!matches) return null;
  const windows = matches
    .map((m) => toPositiveInteger(m.limit && m.limit.context))
    .filter((v) => v !== undefined);
  if (!windows.length) return null;
  return {
    contextWindow: Math.min(...windows),
    tools: matches.every((m) => m.tool_call === true) ? true : undefined,
    jsonSchema: matches.every((m) => m.structured_output === true) ? true : undefined,
  };
}

/**
 * Resolves per-model capabilities for a candidate.
 * Router/gateway accounts cannot declare blanket capabilities (such as a 200k
 * context window) for arbitrary upstream models. Capabilities derive from
 * the model itself (modelMeta, catalogue entry, or account model row),
 * preventing models with smaller context windows (e.g. Groq 120b) from falsely
 * bypassing context requirements.
 */
function resolveCandidateCapabilities(acc, modelId, opts = {}) {
  const { item, row, source, routerSource, innerId } = opts;
  const isGatewayRoute = Boolean(
    (source && source.kind === 'router') || (source && source.reachedVia)
  );

  const baseCaps = Object.assign({}, (acc && acc.capabilities) || {});
  delete baseCaps.tools;
  delete baseCaps.jsonSchema;
  delete baseCaps.contextWindow;
  if (isGatewayRoute) {
    // Gateway accounts cannot grant blanket context window to unverified models
    delete baseCaps.contextWindow;
  }

  // 1. Model metadata from item (catalogue)
  let contextWindow = undefined;
  if (
    item &&
    typeof item === 'object' &&
    (item.contextWindow !== undefined ||
      (item.capabilities && item.capabilities.contextWindow !== undefined))
  ) {
    contextWindow = toPositiveInteger(
      item.contextWindow !== undefined
        ? item.contextWindow
        : item.capabilities && item.capabilities.contextWindow
    );
  }

  // 2. Model metadata from account row
  if (contextWindow === undefined && row && typeof row === 'object') {
    if (
      row.contextWindow !== undefined ||
      (row.capabilities && row.capabilities.contextWindow !== undefined)
    ) {
      contextWindow = toPositiveInteger(
        row.contextWindow !== undefined
          ? row.contextWindow
          : row.capabilities && row.capabilities.contextWindow
      );
    }
  }

  // 3. Model metadata from source / routerSource modelMeta
  const metaLookup = (src) => {
    if (!src || !src.modelMeta) return null;
    if (src.modelMeta[modelId]) return src.modelMeta[modelId];
    if (innerId && src.modelMeta[innerId]) return src.modelMeta[innerId];
    if (typeof modelId === 'string' && modelId.includes('/')) {
      const stripped = modelId.slice(modelId.indexOf('/') + 1);
      if (src.modelMeta[stripped]) return src.modelMeta[stripped];
      if (stripped.includes('/')) {
        const strippedAgain = stripped.slice(stripped.indexOf('/') + 1);
        if (src.modelMeta[strippedAgain]) return src.modelMeta[strippedAgain];
      }
    }
    return null;
  };
  const meta = metaLookup(source) || metaLookup(routerSource);
  if (contextWindow === undefined && meta && meta.contextWindow !== undefined) {
    contextWindow = toPositiveInteger(meta.contextWindow);
  }

  let catalogHit = null;
  if (contextWindow === undefined) {
    const catalog = loadModelCatalog(opts);
    catalogHit =
      catalogEvidenceFor(modelId, catalog) || catalogEvidenceFor(innerId, catalog) || null;
    if (catalogHit) contextWindow = catalogHit.contextWindow;
  }

  const finalCaps = Object.assign({}, baseCaps);
  if (item && typeof item === 'object' && item.capabilities) {
    Object.assign(finalCaps, item.capabilities);
  }
  if (row && typeof row === 'object' && row.capabilities) {
    Object.assign(finalCaps, row.capabilities);
  }
  if (meta) {
    if (meta.tools !== undefined) finalCaps.tools = meta.tools;
    if (meta.jsonSchema !== undefined) finalCaps.jsonSchema = meta.jsonSchema;
  }

  if (catalogHit) {
    if (finalCaps.tools === undefined && catalogHit.tools !== undefined)
      finalCaps.tools = catalogHit.tools;
    if (finalCaps.jsonSchema === undefined && catalogHit.jsonSchema !== undefined)
      finalCaps.jsonSchema = catalogHit.jsonSchema;
    finalCaps.contextEvidence = CATALOG_EVIDENCE;
  }

  if (contextWindow !== undefined) {
    finalCaps.contextWindow = contextWindow;
  } else if (isGatewayRoute) {
    delete finalCaps.contextWindow;
  }

  return {
    capabilities: finalCaps,
    contextWindow,
    maxOutputTokens: meta ? toPositiveInteger(meta.maxOutputTokens) : undefined,
    contextSource: catalogHit ? CATALOG_EVIDENCE : meta ? meta.contextSource : undefined,
  };
}

function openAiCompatibleCandidates(opts) {
  const o = opts || {};
  const registry = o.registry || sourcesApi.loadSources(o.sourceOpts);
  if (!registry || !Array.isArray(registry.sources)) return [];

  const accounts = o.accounts || [];
  const catalogue = o.catalogue || [];
  const harness = o.harness || 'hermes';
  const out = [];

  for (const source of registry.sources) {
    if (!isOpenAiCompatibleSource(source, registry)) continue;

    const endpoint =
      source.endpoint ||
      (source.accessPath && /^https?:\/\//i.test(source.accessPath) ? source.accessPath : null);

    const gateway =
      source.kind === sourcesApi.Kind.ROUTER
        ? source.id
        : source.reachedVia || source.gateway || '';

    const modelSet = new Set();
    if (source.modelMeta && typeof source.modelMeta === 'object') {
      for (const m of Object.keys(source.modelMeta)) {
        if (!m) continue;
        if (source.kind === 'router') {
          const resolved = resolveRouterModel(m, source, registry);
          if (resolved) modelSet.add(resolved.innerModelId);
        } else {
          modelSet.add(m);
        }
      }
    }
    if (Array.isArray(source.models)) {
      for (const m of source.models) {
        const id = typeof m === 'string' ? m : m && m.model;
        if (!id) continue;
        if (source.kind === 'router') {
          const resolved = resolveRouterModel(id, source, registry);
          if (resolved) modelSet.add(resolved.innerModelId);
        } else {
          modelSet.add(id);
        }
      }
    }
    if (source.kind === 'router' && source.servesModels !== false && source.id !== 'agy-gateway') {
      if (Array.isArray(catalogue)) {
        for (const item of catalogue) {
          const id =
            typeof item === 'string' ? item : item && (item.modelId || item.model || item.id);
          if (!id) continue;
          const resolved = resolveRouterModel(id, source, registry);
          if (!resolved) continue;
          if (
            item &&
            typeof item === 'object' &&
            item.upstream &&
            item.upstream !== resolved.upstream
          )
            continue;
          modelSet.add(resolved.innerModelId);
        }
      }
    } else if (source.kind === 'model-source' && source.servesModels !== false) {
      if (source.reachedVia && source.routerAlias) {
        const prefix = source.routerAlias + '/';
        if (Array.isArray(catalogue)) {
          for (const item of catalogue) {
            const id =
              typeof item === 'string' ? item : item && (item.modelId || item.model || item.id);
            if (!id || !id.startsWith(prefix)) continue;
            modelSet.add(id);
          }
        }
      } else if (Array.isArray(catalogue)) {
        for (const item of catalogue) {
          if (
            item &&
            typeof item === 'object' &&
            (item.source === source.id || item.gateway === source.id)
          ) {
            const id = item.modelId || item.model || item.id;
            if (id) modelSet.add(id);
          }
        }
      }
    }

    if (source.id === 'agy-gateway') {
      if (modelSet.size === 0 && o.discoverPool !== false) {
        const pool = require('./agy-pool-runtime');
        const accounts = pool.discoverAccounts(o);
        for (const acc of accounts) {
          const models =
            typeof pool.readAccountModels === 'function' ? pool.readAccountModels(acc, o) : [];
          for (const m of models) modelSet.add(m);
        }
        if (modelSet.size === 0) {
          for (const m of pool.discoverPoolModels(o)) modelSet.add(m);
        }
      }
      for (const m of Array.from(modelSet)) {
        if (typeof m === 'string' && m.includes('/')) modelSet.delete(m);
      }
    }

    if (modelSet.size === 0) continue;

    let bound = accountsFor(accounts, source.id, registry).filter((a) => a && a.id && a.id !== '*');
    if (bound.length === 0 && source.reachedVia) {
      bound = accountsFor(accounts, source.reachedVia, registry).filter(
        (a) => a && a.id && a.id !== '*'
      );
    }
    if (
      bound.length === 0 &&
      source.credential &&
      source.credential.type === 'api-key' &&
      source.credential.env
    ) {
      const envName = source.credential.env;
      const envVal = o.env && o.env[envName] !== undefined ? o.env[envName] : process.env[envName];
      const hasKey = Boolean(envVal && String(envVal).trim().length > 0);
      const accId = deriveCredentialAccountId(source);
      const credentialAcc = {
        id: accId,
        source: source.id,
        models: Array.from(modelSet),
        enabled: true,
        status: 'available',
        credentialEnvMissing: !hasKey,
      };
      bound = [credentialAcc];
    }

    const defaultUpstream =
      source.upstream ||
      source.routerAlias ||
      (gateway && gateway !== source.id ? gateway : '') ||
      String(source.id)
        .replace(/^opencode-provider-/, '')
        .replace(/-options$/, '');

    for (const modelId of modelSet) {
      if (source.id === 'agy-gateway' && typeof modelId === 'string' && modelId.includes('/')) {
        continue;
      }
      const parsed = parsePrefix(modelId);
      const upstream = (parsed && parsed.upstream) || defaultUpstream || source.id;

      let contextWindow = undefined;
      let maxOutputTokens = undefined;
      let contextSource = undefined;
      if (source.modelMeta && source.modelMeta[modelId]) {
        const meta = source.modelMeta[modelId];
        contextWindow = toPositiveInteger(meta.contextWindow);
        maxOutputTokens = toPositiveInteger(meta.maxOutputTokens);
        contextSource = meta.contextSource || 'provider-models-endpoint';
      }

      const caps = {};
      if (contextWindow !== undefined) {
        caps.contextWindow = contextWindow;
      }

      if (bound.length > 0) {
        for (const acc of bound) {
          const accCaps = Object.assign({}, acc.capabilities || {});
          if (gateway || source.kind === 'router' || source.reachedVia) {
            delete accCaps.contextWindow;
          }
          if (contextWindow !== undefined) {
            accCaps.contextWindow = contextWindow;
          }
          const c = {
            harness,
            accessPath: endpoint,
            gateway,
            upstream,
            accountId: acc.id,
            quotaScope: acc.id,
            modelId,
            source: source.id,
            sourceId: source.id,
            endpoint,
            sourceEndpoint: endpoint,
            kind: source.kind,
            capabilities: accCaps,
            cost: acc.cost,
            contextWindow,
            maxOutputTokens,
            contextSource,
            sharedQuota: 'unknown',
            ...(acc.credentialEnvMissing
              ? {
                  credentialEnvMissing: true,
                  blocked: true,
                  blockReason: 'CREDENTIAL_ENV_MISSING',
                  blockScope: 'credential',
                }
              : {}),
          };
          c.candidateKey = candidateKey(c);
          out.push(c);
        }
      } else {
        const c = {
          harness,
          accessPath: endpoint,
          gateway,
          upstream,
          accountId: source.id,
          quotaScope: source.id,
          modelId,
          source: source.id,
          sourceId: source.id,
          endpoint,
          sourceEndpoint: endpoint,
          kind: source.kind,
          capabilities: Object.assign({}, caps),
          contextWindow,
          maxOutputTokens,
          contextSource,
          sharedQuota: 'unknown',
        };
        c.candidateKey = candidateKey(c);
        out.push(c);
      }
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const c of out) {
    if (!seen.has(c.candidateKey)) {
      seen.add(c.candidateKey);
      deduped.push(c);
    }
  }

  return deduped;
}

/**
 * Generate candidates.
 *
 * @param {object} opts
 * @param {string[]} [opts.catalogue] – model ids from the gateway's /v1/models
 * @param {string[]} [opts.openCodeIds] – model ids from `opencode models --json`
 * @param {object[]} [opts.accounts] – accounts bound to sources:
 * { id, sourceId, upstream?, models? }
 * @param {object} [opts.evidenceData] – pre-loaded evidence (avoids re-read)
 * @param {object} [opts.registry] – pre-loaded source registry
 * @param {object} [opts.sourceOpts] – options passed to loadSources
 * @returns {object[]} array of candidate objects
 */
/**
 * A direct OpenAI-compatible source (or a probed provider source) is reachable
 * by the isolated writer as `<providerKey>/<model>`. If source.opencodeProvider is
 * not explicitly set, the provider key falls back to source.id.
 *
 * Eligible sources must:
 * - Be active (not retired, not deferred, servesModels !== false, enabled !== false)
 * - Expose an OpenAI-compatible endpoint (http: or https:)
 * - Have a declared credential environment variable name (credential.env, credential.name, or apiKeyEnv)
 * - Not declare a dedicated CLI harness (kind !== 'agent-cli' and accessPath !== 'cli')
 *
 * Capabilities leave tools and jsonSchema undefined so Codex's capability probe
 * can determine live capability without hardcoded assumptions.
 */
function pushOpencodeProviderWriters(out, source, o, bound) {
  if (!source || source.enabled === false || source.servesModels === false) return;
  if (source.disposition === 'deferred') return;
  if (source.kind === 'agent-cli' || source.accessPath === 'cli') return;

  const endpoint = source.endpoint;
  if (!endpoint || typeof endpoint !== 'string' || !/^https?:\/\//i.test(endpoint.trim())) {
    return;
  }

  const credentialEnv =
    (source.credential &&
      (typeof source.credential.env === 'string' && source.credential.env.trim()
        ? source.credential.env.trim()
        : typeof source.credential.name === 'string' && source.credential.name.trim()
          ? source.credential.name.trim()
          : null)) ||
    (typeof source.apiKeyEnv === 'string' && source.apiKeyEnv.trim()
      ? source.apiKeyEnv.trim()
      : null);
  if (!credentialEnv) return;

  const key = source.opencodeProvider || source.id;
  if (!key) return;

  const opts = o || {};
  const excluded = new Set((opts.excludeModels || []).map((id) => String(id).toLowerCase()));

  // Collect model IDs from all declared source descriptors:
  // 1. source.models
  // 2. source.modelMeta
  // 3. opts.sourceModels[source.id]
  // 4. bound accounts
  // 5. opts.catalogue entries belonging to this source
  const modelSet = new Set();
  const add = (m) => {
    const id = typeof m === 'string' ? m : m && (m.id || m.model || m.modelId);
    if (typeof id === 'string' && id.trim()) {
      modelSet.add(id.trim());
    }
  };

  if (Array.isArray(source.models)) {
    for (const m of source.models) add(m);
  }
  if (source.modelMeta && typeof source.modelMeta === 'object') {
    for (const m of Object.keys(source.modelMeta)) add(m);
  }
  if (opts.sourceModels && typeof opts.sourceModels === 'object') {
    const cleanKey = (k) =>
      String(k || '')
        .toLowerCase()
        .replace(/^opencode-provider-/, '')
        .replace(/-options$/, '')
        .replace(/-ai$/, '')
        .replace(/-tokenhub$/, '');
    const targetKey = cleanKey(source.id);
    const targetProvider = key ? cleanKey(key) : targetKey;
    for (const [k, models] of Object.entries(opts.sourceModels)) {
      if (!Array.isArray(models)) continue;
      const ck = cleanKey(k);
      if (k === source.id || (key && k === key) || ck === targetKey || ck === targetProvider) {
        for (const m of models) add(m);
      }
    }
  }
  if (Array.isArray(bound)) {
    for (const acc of bound) {
      if (acc && acc.enabled !== false) {
        for (const m of accountModels(acc)) add(m);
      }
    }
  }
  if (Array.isArray(opts.catalogue)) {
    const prefix = key + '/';
    const altPrefix = source.id + '/';
    for (const item of opts.catalogue) {
      if (!item) continue;
      if (typeof item === 'string') {
        const s = item.trim();
        if (s.startsWith(prefix)) {
          modelSet.add(s.slice(prefix.length).trim());
        } else if (s.startsWith(altPrefix)) {
          modelSet.add(s.slice(altPrefix.length).trim());
        }
        continue;
      }
      const itemSource =
        item.gateway ||
        item.source ||
        item.sourceId ||
        item.upstream ||
        (Array.isArray(item.sourceIds) ? item.sourceIds[0] : null);
      const matchesSource =
        itemSource === source.id ||
        (key && itemSource === key) ||
        (Array.isArray(item.sourceIds) &&
          (item.sourceIds.includes(source.id) || (key && item.sourceIds.includes(key))));
      if (matchesSource) {
        const id =
          typeof item === 'string' ? item : item && (item.modelId || item.model || item.id);
        if (typeof id === 'string' && id.trim()) {
          const wireId = id.startsWith(prefix)
            ? id.slice(prefix.length)
            : id.startsWith(altPrefix)
              ? id.slice(altPrefix.length)
              : id;
          modelSet.add(wireId.trim());
        }
      }
    }
  }
  if (opts.discoveryCatalogue && Array.isArray(opts.discoveryCatalogue.candidates)) {
    const prefix = key + '/';
    const altPrefix = source.id + '/';
    for (const dc of opts.discoveryCatalogue.candidates) {
      if (!dc) continue;
      const srcIds = Array.isArray(dc.sourceIds) ? dc.sourceIds : [];
      const dcSource = dc.gateway || dc.source || dc.sourceId || dc.upstream || srcIds[0];
      const matches =
        dcSource === source.id ||
        (key && dcSource === key) ||
        srcIds.includes(source.id) ||
        (key && srcIds.includes(key));
      if (matches) {
        const id = dc.modelId || dc.model || dc.id;
        if (typeof id === 'string' && id.trim()) {
          const wireId = id.startsWith(prefix)
            ? id.slice(prefix.length)
            : id.startsWith(altPrefix)
              ? id.slice(altPrefix.length)
              : id;
          modelSet.add(wireId.trim());
        }
      }
    }
  }

  const envVal =
    opts.env && opts.env[credentialEnv] !== undefined
      ? opts.env[credentialEnv]
      : process.env[credentialEnv];
  const hasKey = Boolean(envVal && String(envVal).trim().length > 0);
  const accId =
    Array.isArray(bound) && bound.length > 0 && bound[0] && bound[0].id
      ? bound[0].id
      : deriveCredentialAccountId(source);
  const isMissing =
    !hasKey || (Array.isArray(bound) && bound.some((a) => a && a.credentialEnvMissing));

  for (const model of modelSet) {
    if (
      !model ||
      excluded.has(model.toLowerCase()) ||
      excluded.has((key + '/' + model).toLowerCase())
    ) {
      continue;
    }
    const meta = (source.modelMeta && source.modelMeta[model]) || {};
    let contextWindow = toPositiveInteger(meta.contextWindow);
    let maxOutputTokens = toPositiveInteger(meta.maxOutputTokens);
    let catEntry = null;
    if (Array.isArray(opts.catalogue)) {
      catEntry = opts.catalogue.find(
        (e) =>
          typeof e === 'object' &&
          e &&
          ((e.modelId || e.model || e.id) === model ||
            (e.modelId || e.model || e.id) === key + '/' + model) &&
          (!e.gateway || e.gateway === source.id) &&
          (!e.source || e.source === source.id)
      );
      if (catEntry) {
        if (contextWindow === undefined && catEntry.contextWindow !== undefined) {
          contextWindow = toPositiveInteger(catEntry.contextWindow);
        } else if (
          contextWindow === undefined &&
          catEntry.capabilities &&
          catEntry.capabilities.contextWindow !== undefined
        ) {
          contextWindow = toPositiveInteger(catEntry.capabilities.contextWindow);
        }
        if (maxOutputTokens === undefined && catEntry.maxOutputTokens !== undefined) {
          maxOutputTokens = toPositiveInteger(catEntry.maxOutputTokens);
        }
      }
    }
    let dcEntry = null;
    if (opts.discoveryCatalogue && Array.isArray(opts.discoveryCatalogue.candidates)) {
      dcEntry = opts.discoveryCatalogue.candidates.find(
        (e) =>
          e &&
          ((e.modelId || e.model || e.id) === model ||
            (e.modelId || e.model || e.id) === key + '/' + model ||
            (e.modelId || e.model || e.id) === source.id + '/' + model)
      );
      if (dcEntry) {
        if (contextWindow === undefined && dcEntry.contextWindow !== undefined) {
          contextWindow = toPositiveInteger(dcEntry.contextWindow);
        } else if (
          contextWindow === undefined &&
          dcEntry.capabilities &&
          dcEntry.capabilities.contextWindow !== undefined
        ) {
          contextWindow = toPositiveInteger(dcEntry.capabilities.contextWindow);
        }
        if (maxOutputTokens === undefined && dcEntry.maxOutputTokens !== undefined) {
          maxOutputTokens = toPositiveInteger(dcEntry.maxOutputTokens);
        }
      }
    }

    const metaCaps = Object.assign({}, meta.capabilities || {});
    if (meta.tools !== undefined) metaCaps.tools = meta.tools;
    if (meta.jsonSchema !== undefined) metaCaps.jsonSchema = meta.jsonSchema;
    if (catEntry && catEntry.capabilities) {
      Object.assign(metaCaps, catEntry.capabilities);
    }
    if (dcEntry && dcEntry.capabilities) {
      Object.assign(metaCaps, dcEntry.capabilities);
    }
    if (contextWindow !== undefined) {
      metaCaps.contextWindow = contextWindow;
    }

    out.push({
      harness: 'opencode-direct',
      accessPath: source.endpoint,
      gateway: source.id,
      upstream: key,
      accountId: accId,
      quotaScope: accId,
      modelId: key + '/' + model,
      source: source.id,
      sourceId: source.id,
      endpoint: source.endpoint,
      sourceEndpoint: source.endpoint,
      kind: source.kind,
      capabilities: metaCaps,
      contextWindow,
      maxOutputTokens,
      sharedQuota: 'unknown',
      ...(isMissing
        ? {
            credentialEnvMissing: true,
            blocked: true,
            blockReason: 'CREDENTIAL_ENV_MISSING',
            blockScope: 'credential',
          }
        : {}),
    });
  }
}

// Inventory/registry capabilities are declarations. A runtime probe supplies evidence.
function markCapabilityDeclarations(candidates) {
  for (const c of candidates) {
    c.capabilityDeclarations = { ...c.capabilityDeclarations };
    if (
      c.capabilities?.contextWindow !== undefined &&
      c.contextWindow === undefined &&
      !c.contextSource &&
      !c.capabilities.contextEvidence
    ) {
      c.capabilities = { ...c.capabilities };
      delete c.capabilities.contextWindow;
    }
    for (const cap of ['jsonSchema', 'tools']) {
      if (typeof c.capabilities?.[cap] === 'boolean') c.capabilityDeclarations[cap] = true;
    }
  }
  return candidates;
}

function generateCandidates(opts) {
  const previous = ambientModelCatalog;
  ambientModelCatalog = (opts && opts.modelCatalog) || previous;
  try {
    return markCapabilityDeclarations(generateCandidatesWithCatalog(opts));
  } finally {
    ambientModelCatalog = previous;
  }
}

function generateCandidatesWithCatalog(opts) {
  const o = opts || {};
  const registry = o.registry || sourcesApi.loadSources(o.sourceOpts);
  const catalogue = o.catalogue || [];
  const openCodeIds = o.openCodeIds || [];
  const accounts = o.accounts || [];
  const candidates = [];

  if (o.harness === 'hermes') {
    return openAiCompatibleCandidates(o);
  }

  for (const source of registry.sources) {
    if (source.enabled === false) continue;
    if (sourcesApi.isRetired(source.id, registry)) continue;
    if (sourcesApi.isDeferred(source.id, registry)) continue;
    let bound = accountsFor(accounts, source.id, registry);
    if (bound.length === 0 && source.reachedVia) {
      bound = accountsFor(accounts, source.reachedVia, registry);
    }
    // Disabled discovery inventory is not a bound CLI login. Intake snapshots
    // can contain such a source without any account models.
    if (source.kind === 'agent-cli' && !source.reachedVia) {
      bound = bound.filter((a) => a.enabled !== false && !a.endpoint);
    }
    const hasConcreteAccounts = (accounts || []).some((a) => a && a.id && a.id !== '*');
    let sharedArc = bound.length === 0 && !hasConcreteAccounts;
    if (bound.length === 0) {
      const implicit = implicitCliLoginAccount(source, registry, o);
      if (implicit) {
        bound = [implicit];
        sharedArc = false;
      } else if (
        source.credential &&
        source.credential.type === 'api-key' &&
        source.credential.env
      ) {
        const envName = source.credential.env;
        const envVal =
          o.env && o.env[envName] !== undefined ? o.env[envName] : process.env[envName];
        const hasKey = Boolean(envVal && String(envVal).trim().length > 0);
        const accId = deriveCredentialAccountId(source);
        const credentialAcc = {
          id: accId,
          source: source.id,
          models: source.models || (source.verify?.model ? [source.verify.model] : []),
          enabled: true,
          status: 'available',
          credentialEnvMissing: !hasKey,
        };
        bound = [credentialAcc];
        sharedArc = false;
      }
    }

    // Some gateways expose bare wire ids and a registry-declared writer adapter.
    // Keep their writer inventory scoped to the live listing of this endpoint.
    if (source.kind === 'router' && source.writerHarness && source.servesModels !== false) {
      const models =
        (source.writerInventory?.status === 'listed'
          ? source.models
          : o.sourceModels?.[source.id]) ||
        source.models ||
        bound.filter((a) => a.enabled !== false && a.status === 'available').flatMap(accountModels);
      pushOpencodeProviderWriters(candidates, { ...source, models }, o, bound);
      continue;
    }

    if (source.kind === 'router' && source.servesModels !== false) {
      // Gateway: expand catalogue into (upstream, model) pairs.
      // Each upstream prefix is an independent failure domain.
      const harness = harnessOf(source, registry);
      const accessPath = accessPathOf(source, registry);
      if (!harness || !accessPath) continue;
      // The router's own inventory is independent of the OpenCode CLI catalogue.
      // Scope additions to this source; an ID listed by another gateway is no proof here.
      const existingIds = new Set(
        catalogue.map((item) =>
          typeof item === 'string'
            ? item
            : item &&
              (!item.gateway || item.gateway === source.id) &&
              (item.modelId || item.model || item.id)
        )
      );
      // A router only offers models it lists itself: its own live listing
      // (options.sourceModels[id]) or its source.models. Without either, the
      // merged catalogue is no proof, so no catalogue-derived candidate exists.
      const ownIds = new Set();
      const named = (m) => (typeof m === 'string' ? m : m && (m.id || m.model || m.modelId));
      const perSource = o.sourceModels && o.sourceModels[source.id];
      const sourceModelsList = source.models || (source.verify?.model ? [source.verify.model] : []);
      for (const m of [].concat(Array.isArray(perSource) ? perSource : [], sourceModelsList)) {
        const id = named(m);
        if (id) ownIds.add(id);
      }
      const ownCatalogue = catalogue.filter((item) => {
        if (item && typeof item === 'object' && item.gateway) return item.gateway === source.id;
        const id = named(item);
        return Boolean(id) && ownIds.has(id);
      });
      const unlisted = catalogue.some(
        (item) => !(item && typeof item === 'object' && item.gateway) && named(item)
      );
      if (ownIds.size === 0 && unlisted && Array.isArray(o.candidateGenerationRejections)) {
        o.candidateGenerationRejections.push({
          modelId: '',
          sourceId: source.id,
          reasonCode: 'ROUTER_LISTING_UNKNOWN',
        });
      }
      const routerCatalogue = ownCatalogue.concat(
        sourceModelsList
          .map((model) => ({
            modelId: typeof model === 'string' ? model : model && (model.id || model.model),
            gateway: source.id,
          }))
          .filter((item) => item.modelId && !existingIds.has(item.modelId))
      );
      for (const item of routerCatalogue) {
        if (item && typeof item === 'object' && item.gateway && item.gateway !== source.id)
          continue;
        const fullId =
          typeof item === 'string' ? item : (item && (item.modelId || item.model || item.id)) || '';
        const resolved = resolveRouterModel(item || fullId, source, registry);
        if (!resolved) continue;
        if (
          item &&
          typeof item === 'object' &&
          item.upstream &&
          item.upstream !== resolved.upstream
        )
          continue;
        if (sharedArc) {
          const { capabilities: caps, contextWindow } = resolveCandidateCapabilities(null, fullId, {
            item,
            source,
            innerId: resolved.innerModelId,
          });
          candidates.push({
            harness,
            accessPath,
            gateway: source.id,
            upstream: resolved.upstream,
            accountId: '*',
            quotaScope: resolved.upstream,
            modelId: resolved.innerModelId,
            source: source.id,
            sourceId: source.id,
            endpoint: source.endpoint,
            sourceEndpoint: source.endpoint,
            kind: source.kind,
            capabilities: caps,
            contextWindow,
            sharedQuota: 'unknown',
          });
        } else {
          for (const acc of bound) {
            const { capabilities: caps, contextWindow } = resolveCandidateCapabilities(
              acc,
              fullId,
              { item, source, innerId: resolved.innerModelId }
            );
            candidates.push({
              harness,
              accessPath,
              gateway: source.id,
              upstream: resolved.upstream,
              accountId: acc.id,
              quotaScope: acc.id,
              modelId: resolved.innerModelId,
              source: source.id,
              sourceId: source.id,
              endpoint: source.endpoint,
              sourceEndpoint: source.endpoint,
              kind: source.kind,
              capabilities: caps,
              contextWindow,
              cost: acc.cost,
              sharedQuota: 'unknown',
              ...(acc.credentialEnvMissing
                ? {
                    credentialEnvMissing: true,
                    blocked: true,
                    blockReason: 'CREDENTIAL_ENV_MISSING',
                    blockScope: 'credential',
                  }
                : {}),
            });
          }
        }
      }
    }

    if (source.kind === 'model-source' && source.servesModels !== false) {
      // Direct model source: if reached via a router, expand catalogue for
      // that router alias. Otherwise, the source provides its own models
      // through evidence or caller-supplied data.
      if (source.reachedVia && source.routerAlias) {
        const harness = harnessOf(source, registry);
        const accessPath = accessPathOf(source, registry);
        if (!harness || !accessPath) continue;
        const prefix = source.routerAlias + '/';
        const routerSource = source.reachedVia
          ? registry.sources.find((s) => s.id === source.reachedVia)
          : null;
        for (const item of catalogue) {
          const fullId =
            typeof item === 'string'
              ? item
              : (item && (item.modelId || item.model || item.id)) || '';
          if (!fullId.startsWith(prefix)) continue;
          if (sharedArc) {
            const { capabilities: caps, contextWindow } = resolveCandidateCapabilities(
              null,
              fullId,
              { item, source, routerSource }
            );
            candidates.push({
              harness,
              accessPath,
              gateway: source.reachedVia,
              upstream: source.routerAlias,
              accountId: '*',
              quotaScope: source.routerAlias,
              modelId: fullId,
              source: source.id,
              sourceId: source.id,
              endpoint: source.endpoint,
              sourceEndpoint: source.endpoint,
              kind: source.kind,
              reachedVia: source.reachedVia,
              capabilities: caps,
              contextWindow,
              sharedQuota: 'unknown',
            });
          } else {
            for (const acc of bound) {
              const row = accountModelRow(acc, fullId) || {};
              const { capabilities: caps, contextWindow } = resolveCandidateCapabilities(
                acc,
                fullId,
                { item, row, source, routerSource }
              );
              candidates.push({
                harness,
                accessPath,
                gateway: source.reachedVia,
                upstream: source.routerAlias,
                accountId: acc.id,
                quotaScope: acc.id,
                modelId: fullId,
                source: source.id,
                sourceId: source.id,
                endpoint: source.endpoint,
                sourceEndpoint: source.endpoint,
                kind: source.kind,
                reachedVia: source.reachedVia,
                capabilities: caps,
                contextWindow,
                cost: acc.cost,
                sharedQuota: 'unknown',
                ...(acc.credentialEnvMissing
                  ? {
                      credentialEnvMissing: true,
                      blocked: true,
                      blockReason: 'CREDENTIAL_ENV_MISSING',
                      blockScope: 'credential',
                    }
                  : {}),
              });
            }
          }
        }
      } else {
        const route =
          registry.dispatch &&
          registry.dispatch.providers &&
          registry.dispatch.providers[String(source.id).toLowerCase()];
        const harness = (route && route.harness) || source.harness || null;
        const accessPath =
          (route && route.accessPath) || source.accessPath || source.endpoint || null;
        if (harness && accessPath) {
          for (const acc of bound) {
            const catalogueModelIds = new Set(
              catalogue
                .map((e) => (typeof e === 'string' ? e : e && (e.modelId || e.model || e.id)))
                .filter(Boolean)
            );
            const models = liveAgyAccountModels(acc, source, accountModels(acc), o).filter(
              (model) =>
                // A direct source's own inventory is authoritative for its wire ids.
                // Another gateway's catalogue may use entirely different aliases.
                (Array.isArray(source.models) && source.models.includes(model)) ||
                catalogue.length === 0 ||
                catalogue.includes(model) ||
                catalogueModelIds.has(model)
            );
            for (const model of models) {
              const row = accountModelRow(acc, model) || {};
              let contextWindow = undefined;
              const catEntry = catalogue.find(
                (e) =>
                  typeof e === 'object' &&
                  e &&
                  (e.modelId || e.model || e.id) === model &&
                  (!e.gateway || e.gateway === source.id) &&
                  (!e.source || e.source === source.id)
              );
              if (
                catEntry &&
                (catEntry.contextWindow !== undefined ||
                  (catEntry.capabilities && catEntry.capabilities.contextWindow !== undefined))
              ) {
                contextWindow = toPositiveInteger(
                  catEntry.contextWindow !== undefined
                    ? catEntry.contextWindow
                    : catEntry.capabilities.contextWindow
                );
              }
              if (contextWindow === undefined && source.modelMeta && source.modelMeta[model]) {
                contextWindow = toPositiveInteger(source.modelMeta[model].contextWindow);
              }
              const caps = Object.assign({}, acc.capabilities || {});
              if (contextWindow !== undefined) {
                caps.contextWindow = contextWindow;
              } else {
                delete caps.contextWindow;
              }
              candidates.push({
                harness,
                accessPath,
                gateway: source.id,
                upstream: source.id,
                accountId: acc.id,
                quotaScope: acc.id,
                modelId: model,
                source: source.id,
                sourceId: source.id,
                endpoint: source.endpoint,
                sourceEndpoint: source.endpoint,
                kind: source.kind,
                capabilities: caps,
                contextWindow,
                quality: row.quality,
                cost: acc.cost,
                sharedQuota: 'unknown',
                ...(acc.credentialEnvMissing
                  ? {
                      credentialEnvMissing: true,
                      blocked: true,
                      blockReason: 'CREDENTIAL_ENV_MISSING',
                      blockScope: 'credential',
                    }
                  : {}),
              });
            }
          }
        }
        pushOpencodeProviderWriters(candidates, source, o, bound);
      }
    }

    if (source.kind === 'agent-cli') {
      // CLI harness (agy, cline, qwen, codex, opencode).
      // If it reaches through a router, we expand those catalogue ids.
      const harness = harnessOf(source, registry);
      const accessPath = accessPathOf(source, registry);
      if (!harness || !accessPath) continue;
      if (source.reachedVia) {
        // OpenCode reaches 9Router models via ninerouter/ prefix.
        // Its own namespace is in openCodeIds.
        const routerSource = (registry.sources || []).find((s) => s && s.id === source.reachedVia);
        const mp =
          source.modelPrefix ||
          (routerSource && routerSource.modelPrefix) ||
          registry.dispatch?.providers?.[source.id]?.modelPrefix ||
          registry.dispatch?.providers?.[source.reachedVia]?.modelPrefix ||
          '';
        const prefix = mp ? (mp.endsWith('/') ? mp : mp + '/') : '';
        for (const ocId of openCodeIds) {
          const resolved = resolveRouterModel(ocId, routerSource, registry, source);
          if (!resolved || (prefix && !String(ocId).startsWith(prefix))) {
            if (Array.isArray(o.candidateGenerationRejections)) {
              o.candidateGenerationRejections.push({ modelId: ocId, reasonCode: 'ALIAS_MISMATCH' });
            }
            continue;
          }
          const innerId = String(ocId).startsWith(mp)
            ? String(ocId).slice(mp.length)
            : resolved.innerModelId;
          const catItem = catalogue.find((ci) => {
            const fid = typeof ci === 'string' ? ci : ci && (ci.modelId || ci.model || ci.id);
            return fid === innerId || fid === ocId;
          });
          if (sharedArc) {
            const { capabilities: caps, contextWindow } = resolveCandidateCapabilities(null, ocId, {
              item: catItem,
              source,
              routerSource,
              innerId,
            });
            candidates.push({
              harness,
              accessPath,
              gateway: source.reachedVia,
              upstream: resolved.upstream,
              accountId: '*',
              quotaScope: source.id,
              modelId: ocId,
              source: source.id,
              kind: source.kind,
              capabilities: caps,
              contextWindow,
              sharedQuota: 'unknown',
            });
          } else {
            for (const acc of bound) {
              const row =
                accountModelRow(acc, ocId) || accountModelRow(acc, resolved.innerModelId) || {};
              const { capabilities: caps, contextWindow } = resolveCandidateCapabilities(
                acc,
                ocId,
                { item: catItem, row, source, routerSource, innerId }
              );
              candidates.push({
                harness,
                accessPath,
                gateway: source.reachedVia,
                upstream: resolved.upstream,
                accountId: acc.id,
                quotaScope: acc.id,
                modelId: ocId,
                source: source.id,
                kind: source.kind,
                capabilities: caps,
                contextWindow,
                quality: row.quality,
                latencyMs: row.latencyMs,
                cost: acc.cost,
                sharedQuota: 'unknown',
              });
            }
          }
        }
        // Also the ninerouter/ models from the HTTP catalogue, accessible
        // through OpenCode's ninerouter/ prefix.
        if (prefix) {
          for (const item of catalogue) {
            if (
              item &&
              typeof item === 'object' &&
              item.gateway &&
              item.gateway !== source.reachedVia
            )
              continue;
            const fullId =
              typeof item === 'string'
                ? item
                : (item && (item.modelId || item.model || item.id)) || '';
            const resolved = resolveRouterModel(fullId, routerSource, registry, source);
            if (!resolved) continue;
            const prefixed = prefix + resolved.innerModelId;
            if (sharedArc) {
              const { capabilities: caps, contextWindow } = resolveCandidateCapabilities(
                null,
                prefixed,
                { item, source, routerSource, innerId: fullId }
              );
              candidates.push({
                harness,
                accessPath,
                gateway: source.reachedVia,
                upstream: resolved.upstream,
                accountId: '*',
                quotaScope: source.id,
                modelId: prefixed,
                source: source.id,
                kind: source.kind,
                capabilities: caps,
                contextWindow,
                sharedQuota: 'unknown',
              });
            } else {
              for (const acc of bound) {
                const row =
                  accountModelRow(acc, prefixed) ||
                  accountModelRow(acc, resolved.innerModelId) ||
                  accountModelRow(acc, fullId) ||
                  {};
                const { capabilities: caps, contextWindow } = resolveCandidateCapabilities(
                  acc,
                  prefixed,
                  { item, row, source, routerSource, innerId: fullId }
                );
                candidates.push({
                  harness,
                  accessPath,
                  gateway: source.reachedVia,
                  upstream: resolved.upstream,
                  accountId: acc.id,
                  quotaScope: acc.id,
                  modelId: prefixed,
                  source: source.id,
                  kind: source.kind,
                  capabilities: caps,
                  contextWindow,
                  quality: row.quality,
                  latencyMs: row.latencyMs,
                  cost: acc.cost,
                  sharedQuota: 'unknown',
                });
              }
            }
          }
        }
      } else if (source.servesModels !== false) {
        if (source.id === 'agy-pool') continue;
        // Self-contained CLI (agy, qwen).
        // Models are not enumerable from the live catalogue; they come from
        // evidence or from the accounts bound to this source. With a bound
        // account we emit one concrete candidate per declared model. Without
        // one we emit a '*' placeholder that the chooser must resolve — an
        // unresolved wildcard is rejected, never silently passed through.
        if (Array.isArray(source.accounts) && Array.isArray(source.models)) {
          for (const accId of source.accounts) {
            for (const model of source.models) {
              candidates.push({
                harness,
                accessPath,
                gateway: '',
                upstream: source.id,
                accountId: accId,
                quotaScope: source.id,
                modelId: model,
                source: source.id,
                kind: source.kind,
                sharedQuota: 'unknown',
              });
            }
          }
        } else if (Array.isArray(source.models)) {
          if (sharedArc) {
            for (const model of source.models) {
              candidates.push({
                harness,
                accessPath,
                gateway: '',
                upstream: source.id === 'autoclaw' ? 'zai' : source.id,
                accountId: source.id === 'autoclaw' ? 'autoclaw' : '*',
                quotaScope: source.id === 'autoclaw' ? 'zai' : source.id,
                modelId: model,
                source: source.id,
                kind: source.kind,
                sharedQuota: 'unknown',
              });
            }
          } else {
            for (const acc of bound) {
              for (const model of source.models) {
                candidates.push({
                  harness,
                  accessPath,
                  gateway: '',
                  upstream: source.id === 'autoclaw' ? 'zai' : source.id,
                  accountId: acc.id,
                  quotaScope: source.id === 'autoclaw' ? 'zai' : source.id,
                  modelId: model,
                  source: source.id,
                  kind: source.kind,
                  capabilities: acc.capabilities || {},
                  cost: acc.cost,
                  sharedQuota: 'unknown',
                  ...(acc.credentialEnvMissing
                    ? {
                        credentialEnvMissing: true,
                        blocked: true,
                        blockReason: 'CREDENTIAL_ENV_MISSING',
                        blockScope: 'credential',
                      }
                    : {}),
                });
              }
            }
          }
        } else if (sharedArc) {
          candidates.push({
            harness,
            accessPath,
            gateway: '',
            upstream: source.id,
            accountId: '*',
            quotaScope: source.id,
            modelId: '*',
            source: source.id,
            kind: source.kind,
            sharedQuota: 'unknown',
          });
        } else {
          for (const acc of bound) {
            const models = liveAgyAccountModels(acc, source, accountModels(acc), o);
            for (const model of models) {
              candidates.push({
                harness,
                accessPath,
                gateway: '',
                upstream: source.id,
                accountId: acc.id,
                quotaScope: acc.id,
                modelId: model,
                source: source.id,
                kind: source.kind,
                capabilities: acc.capabilities || {},
                cost: acc.cost,
                sharedQuota: 'unknown',
                // The binding is provenance; candidate.evidence is the list of test results.
                ...(acc.binding ? { binding: acc.binding } : {}),
              });
            }
          }
        }
      }
    }
  }

  candidates.push(...poolAccountCandidates(o));

  return candidates;
}

function isPoolEnabled(options) {
  const o = options || {};
  const hasAliasedCatalogueModel = Array.isArray(o.catalogue)
    ? o.catalogue.some((model) => typeof model === 'string' && /^(?:ag|antigravity)\//.test(model))
    : false;
  if (
    o.discoverPool === false &&
    (!Array.isArray(o.models) || o.models.length === 0) &&
    !hasAliasedCatalogueModel
  ) {
    return false;
  }
  if (o.enablePool === true || o.poolEnabled === true || o.pool === true) return true;
  if (o.discoverPool === true) return true;
  if (Boolean(o.fakeRunsDir || o.runsDir || o.poolRuntimeDir)) return true;
  if (Array.isArray(o.models) && o.models.length > 0) return true;

  const ew = o.externalWorkers || o['external-workers'];
  if (typeof ew === 'string') {
    const list = ew.split(',').map((s) => s.trim());
    if (list.includes('agy-pool')) return true;
  } else if (Array.isArray(ew)) {
    if (ew.includes('agy-pool')) return true;
  }

  if (Array.isArray(o.accounts)) {
    if (
      o.accounts.some(
        (a) =>
          a && (a.provider === 'agy-pool' || a.sourceId === 'agy-pool' || a.harness === 'agy-pool')
      )
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Generate agy-pool candidates.
 */
function poolAccountCandidates(opts) {
  const o = opts || {};
  if (!isPoolEnabled(o)) {
    return [];
  }
  const registry = o.registry || sourcesApi.loadSources();
  if (
    o.registry &&
    Array.isArray(o.registry.sources) &&
    !o.registry.sources.some((s) => s && s.id === 'agy-pool')
  ) {
    return [];
  }
  const pool = require('./agy-pool-runtime');
  const { familyOf } = require('./agy-quota');
  const agySource =
    (registry && registry.sources && registry.sources.find((s) => s.id === 'agy-pool')) || {};

  // 1. Discover models (AC-R01)
  const poolModels = new Set();
  const needsAliasValidation = (o.catalogue || []).some(
    (model) => typeof model === 'string' && /^(?:ag|antigravity)\//.test(model)
  );
  const discoveredPoolModels = new Set(
    o.discoverPool === false
      ? needsAliasValidation
        ? pool.discoverPoolModels({ ...o, discoverPool: true, models: undefined, cacheFile: null })
        : []
      : pool.discoverPoolModels(o)
  );
  if (o.discoverPool === false) {
    if (Array.isArray(o.models) && o.models.length > 0) {
      for (const m of o.models) {
        if (!m) continue;
        const model = String(m);
        if (/^(?:ag|antigravity)\/$/.test(model)) {
          if (Array.isArray(o.candidateGenerationRejections)) {
            o.candidateGenerationRejections.push({ modelId: '', reasonCode: 'EMPTY_MODEL_ID' });
          }
        } else if (/^(?:ag|antigravity)\//.test(model)) {
          if (Array.isArray(o.candidateGenerationRejections)) {
            o.candidateGenerationRejections.push({ modelId: model, reasonCode: 'ALIAS_MISMATCH' });
          }
        } else if (model && familyOf(model)) poolModels.add(model);
        else if (Array.isArray(o.candidateGenerationRejections)) {
          o.candidateGenerationRejections.push({
            modelId: model,
            reasonCode: model ? 'UNKNOWN_MODEL_FAMILY' : 'EMPTY_MODEL_ID',
          });
        }
      }
    }
  } else {
    if (Array.isArray(o.models) && o.models.length > 0) {
      for (const m of o.models) {
        if (!m) continue;
        const model = String(m);
        if (/^(?:ag|antigravity)\/$/.test(model)) {
          if (Array.isArray(o.candidateGenerationRejections)) {
            o.candidateGenerationRejections.push({ modelId: '', reasonCode: 'EMPTY_MODEL_ID' });
          }
        } else if (/^(?:ag|antigravity)\//.test(model)) {
          if (Array.isArray(o.candidateGenerationRejections)) {
            o.candidateGenerationRejections.push({ modelId: model, reasonCode: 'ALIAS_MISMATCH' });
          }
        } else if (familyOf(model) && discoveredPoolModels.has(model)) poolModels.add(model);
        else if (Array.isArray(o.candidateGenerationRejections)) {
          o.candidateGenerationRejections.push({
            modelId: model,
            reasonCode: model && familyOf(model) ? 'AGY_MODEL_ID_UNMAPPED' : 'UNKNOWN_MODEL_FAMILY',
          });
        }
      }
    } else {
      for (const m of discoveredPoolModels) {
        if (m) poolModels.add(m);
      }
    }

    const accounts = o.accounts || [];
    const native = accounts.find((a) => a.provider === 'antigravity' || a.id === 'agy-native-a');
    if (native) {
      for (const m of accountModels(native)) poolModels.add(m);
    }

    const catalogue = o.catalogue || [];
    const externalWorkers = o.externalWorkers || o['external-workers'];
    const explicitlyEnabled = Array.isArray(externalWorkers)
      ? externalWorkers.includes('agy-pool')
      : typeof externalWorkers === 'string' &&
        externalWorkers.split(',').some((worker) => worker.trim() === 'agy-pool');
    for (const c of catalogue) {
      // Intake persists merged catalogue entries as plain model-id strings.
      // Unprefixed models are pool candidates only when intake enabled the lane.
      if (typeof c === 'string') {
        const model = c.replace(/^(?:ag|antigravity)\//, '');
        if (model && familyOf(model) && /^(?:ag|antigravity)\//.test(c)) {
          // Gateway aliases identify backend models; they are not agy CLI model ids.
          // Accept only when agy discovery independently advertises the same id.
          if (discoveredPoolModels.has(model)) poolModels.add(model);
          else if (Array.isArray(o.candidateGenerationRejections)) {
            o.candidateGenerationRejections.push({
              modelId: model,
              reasonCode: 'AGY_MODEL_ID_UNMAPPED',
            });
          }
        } else if (!familyOf(model) && Array.isArray(o.candidateGenerationRejections)) {
          o.candidateGenerationRejections.push({
            modelId: model,
            reasonCode: model ? 'UNKNOWN_MODEL_FAMILY' : 'EMPTY_MODEL_ID',
          });
        }
        continue;
      }
      if (typeof c === 'object' && c) {
        if (c.upstream === 'antigravity' || c.source === 'antigravity' || c.upstream === 'ag') {
          const m = c.modelId || c.model;
          const model = m ? m.replace(/^(ag|antigravity)\//, '') : '';
          if (model && familyOf(model)) poolModels.add(model);
          else if (Array.isArray(o.candidateGenerationRejections)) {
            o.candidateGenerationRejections.push({
              modelId: model,
              reasonCode: model ? 'UNKNOWN_MODEL_FAMILY' : 'EMPTY_MODEL_ID',
            });
          }
        }
      }
    }

    if (o.evidenceData && o.evidenceData.combinations) {
      for (const combo of o.evidenceData.combinations) {
        if (
          combo.upstream === 'antigravity' ||
          combo.source === 'antigravity' ||
          combo.upstream === 'ag'
        ) {
          const m = combo.modelId || combo.model;
          const model = m ? m.replace(/^(ag|antigravity)\//, '') : '';
          if (model && familyOf(model)) poolModels.add(model);
          else if (Array.isArray(o.candidateGenerationRejections)) {
            o.candidateGenerationRejections.push({
              modelId: model,
              reasonCode: model ? 'UNKNOWN_MODEL_FAMILY' : 'EMPTY_MODEL_ID',
            });
          }
        }
      }
    }

    for (const modelId of pool.modelIdsFromRuntime(o)) {
      const runtimeModelId = String(modelId);
      if (familyOf(runtimeModelId)) poolModels.add(runtimeModelId);
      else if (Array.isArray(o.candidateGenerationRejections)) {
        o.candidateGenerationRejections.push({
          modelId: runtimeModelId,
          reasonCode: 'ALIAS_MISMATCH',
        });
      }
    }
  }

  if (poolModels.size === 0) return [];

  // 2. Discover & filter accounts (AC-R03)
  const candidateAccounts = new Set();
  const shouldDiscoverPool = o.discoverPool !== false;
  const runtimeDir = pool.runsDir(o);
  let hasRunsDir = false;
  try {
    hasRunsDir = Boolean(shouldDiscoverPool && runtimeDir && fs.existsSync(runtimeDir));
  } catch {}

  if (shouldDiscoverPool) {
    for (const accountId of pool.discoverAccounts(o)) candidateAccounts.add(accountId);
  }

  if (candidateAccounts.size === 0) {
    if (Array.isArray(o.accounts)) {
      for (const a of o.accounts) {
        if (a && pool.isValidAccountId(a.id)) candidateAccounts.add(a.id);
        else if (typeof a === 'string' && pool.isValidAccountId(a)) candidateAccounts.add(a);
      }
    }
    if (candidateAccounts.size === 0 && Array.isArray(agySource.accounts)) {
      for (const acc of agySource.accounts) {
        if (pool.isValidAccountId(acc)) candidateAccounts.add(acc);
      }
    }
  }

  if (candidateAccounts.size === 0) return [];

  const usableAccounts = [];
  for (const acc of candidateAccounts) {
    if (hasRunsDir) {
      let accDirExists = false;
      try {
        const accDir = pool.accountDir(acc, o);
        accDirExists = fs.existsSync(accDir);
      } catch {}
      if (!accDirExists) continue;

      const result = pool.readResult(acc, o);
      const outText = pool.readOutText(acc, o);
      if (!result && !outText) continue;

      if (
        result &&
        (result.state === 'login-required' ||
          result.state === 'AUTH_FAILED' ||
          result.reason === 'AUTH_FAILED')
      ) {
        continue;
      }
      try {
        const stateFile = path.join(pool.accountDir(acc, o), 'state.json');
        if (fs.existsSync(stateFile)) {
          const stateDoc = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
          if (
            stateDoc &&
            (stateDoc.reason === 'AUTH_FAILED' ||
              (stateDoc.result &&
                (stateDoc.result.state === 'login-required' ||
                  stateDoc.result.reason === 'AUTH_FAILED')))
          ) {
            continue;
          }
        }
      } catch {}
    }
    usableAccounts.push(acc);
  }

  // 3. Harness capabilities from sources.json (never force tools true)
  const harnessCapabilities = Object.assign({}, agySource.capabilities || {});

  // 4. Candidate generation
  const candidates = [];
  const accounts = o.accounts || [];
  const native = accounts.find((a) => a.provider === 'antigravity' || a.id === 'agy-native-a');
  const catalogue = o.catalogue || [];

  for (const acc of usableAccounts) {
    let quotaReading = null;
    if (hasRunsDir) {
      const outText = pool.readOutText(acc, o);
      if (outText) {
        quotaReading = pool.parseQuotaOutput(outText);
        if (quotaReading.available === false && quotaReading.reason === 'AUTH_FAILED') {
          continue;
        }
      }
    }

    for (const model of poolModels) {
      const routeHealth = o.routeHealth;
      if (routeHealth && !o.allowUnprobedCandidates) {
        const health = require('./route-health');
        const normalized = health.normalizeModelId(model);
        const modelRows = catalogue.filter((entry) => {
          if (!entry || typeof entry !== 'object') return false;
          const entryModel = entry.modelId || entry.model || entry.id || '';
          return health.normalizeModelId(entryModel) === normalized;
        });
        if (
          !modelRows.some((entry) => {
            const routeId = entry.gateway;
            const record =
              routeId &&
              health.getPathRecord(routeHealth, model, { id: routeId, accountId: acc.id });
            return Boolean(
              (record &&
                health.isEligible(routeHealth, model, { id: routeId, accountId: acc.id }, o.now)) ||
              (o.probeEvidence && o.probeEvidence(model, { id: routeId, accountId: acc.id }))
            );
          })
        )
          continue;
      }
      const family =
        familyOf(model) ||
        (model.includes('gemini')
          ? 'gemini'
          : model.includes('claude') || model.includes('gpt')
            ? 'claude-gpt'
            : null);
      if (!family) continue;

      // Keep exhausted routes in the candidate set so Controller can record
      // the quota rejection in the structured dispatch decision.
      let quotaExhausted = false;
      if (hasRunsDir && quotaReading && Array.isArray(quotaReading.rows)) {
        const familyRows = quotaReading.rows.filter((r) => r.family === family);
        if (familyRows.length > 0) {
          const isZero = familyRows.some(
            (r) => r.remainingPercent === 0 || r.remainingPercent <= 0 || r.disabled === true
          );
          if (isZero) {
            if (!o.keepExhausted) continue;
            quotaExhausted = true;
          }
        }
      }

      // Look up catalogue entry for the SAME backend model ID
      let modelCapabilities = null;
      let contextWindow = undefined;

      if (Array.isArray(catalogue)) {
        for (const entry of catalogue) {
          if (!entry || typeof entry !== 'object') continue;
          const entryModel = entry.modelId || entry.model || entry.id || '';
          const isAgScoped =
            entry.upstream === 'ag' ||
            entry.upstream === 'antigravity' ||
            entryModel.startsWith('ag/') ||
            entryModel.startsWith('antigravity/');
          const matchBackend = isAgScoped
            ? entryModel === model ||
              entryModel === 'ag/' + model ||
              entryModel === 'antigravity/' + model ||
              entryModel.replace(/^(ag|antigravity)\//, '') === model ||
              (entry.base && entry.base === model)
            : !entry.upstream &&
              (entryModel === model ||
                entryModel === 'ag/' + model ||
                entryModel === 'antigravity/' + model);
          if (matchBackend) {
            if (entry.capabilities && Object.keys(entry.capabilities).length > 0) {
              modelCapabilities = Object.assign({}, entry.capabilities);
            }
            if (
              (entry.gateway === 'agy-pool' ||
                entry.gateway === 'agy' ||
                entry.gateway === 'antigravity' ||
                (!entry.gateway &&
                  (!entry.upstream ||
                    entry.upstream === 'ag' ||
                    entry.upstream === 'antigravity'))) &&
              (entryModel === model || entryModel.replace(/^(ag|antigravity)\//, '') === model)
            ) {
              const cw = toPositiveInteger(
                entry.contextWindow !== undefined
                  ? entry.contextWindow
                  : entry.capabilities && entry.capabilities.contextWindow
              );
              if (cw !== undefined) contextWindow = cw;
            }
            break;
          }
        }
      }

      if (contextWindow === undefined && agySource && agySource.modelMeta) {
        const meta = agySource.modelMeta[model];
        if (meta && meta.contextWindow !== undefined) {
          contextWindow = toPositiveInteger(meta.contextWindow);
        }
      }

      // Effective capabilities: model AND harness (never override an explicit false)
      let effectiveCapabilities = {};
      if (modelCapabilities && Object.keys(modelCapabilities).length > 0) {
        effectiveCapabilities = Object.assign({}, modelCapabilities);
        for (const [k, v] of Object.entries(harnessCapabilities)) {
          if (typeof modelCapabilities[k] === 'boolean' && typeof v === 'boolean') {
            effectiveCapabilities[k] = modelCapabilities[k] && v;
          } else if (modelCapabilities[k] === undefined) {
            effectiveCapabilities[k] = v;
          }
        }
      }

      if (contextWindow !== undefined) {
        effectiveCapabilities.contextWindow = contextWindow;
      } else {
        delete effectiveCapabilities.contextWindow;
      }

      candidates.push({
        harness: 'agy-pool',
        accessPath: `ShipDe\\ShipDe-${acc}`,
        gateway: '',
        upstream: 'antigravity',
        accountId: acc,
        quotaScope: `${acc}:${family}`,
        modelId: model,
        source: 'agy-pool',
        kind: 'agent-cli',
        blocked: quotaExhausted,
        blockReason: quotaExhausted ? 'QUOTA_EXHAUSTED' : undefined,
        blockScope: quotaExhausted ? 'account' : undefined,
        capabilities: effectiveCapabilities,
        contextWindow,
        cost: native && native.cost,
        sharedQuota: 'unknown',
      });
    }
  }

  return markCapabilityDeclarations(candidates);
}

/**
 * The concrete accounts that reach a gateway, with the route each one uses.
 *
 * A registry account carries `provider`, not `sourceId`, and the provider is
 * what `dispatchRoute` resolves. An account whose route lands on a gateway that
 * actually serves models is a real credential on that gateway, so every model
 * the gateway advertises is reachable through it — the same models the gateway
 * hands out over HTTP, but reached the way this account reaches them.
 *
 * This is the seam TASK-AI-66 exists for. Before it, a candidate existed only
 * if an operator had hand-written the model into `accounts.registry.json`. The
 * gateway advertises hundreds of aliases (`ag`, `gcli`, `ocz`, `gh`, `cl`, …);
 * the hand-written list held eight. Every alias left off that list was
 * invisible to the Controller, so evidence recorded against its seven-part key
 * could never be matched and its Work Item could never be routed again.
 *
 * Nothing here names a model, an alias or a provider. The route comes from the
 * registry and the model list comes from the gateway's own advertised
 * catalogue; a gateway that advertises nothing yields nothing, and a source
 * that is retired or deferred is skipped rather than dispatched to.
 *
 * @param {object} opts
 * @param {object} opts.registry – the source registry
 * @param {object[]} opts.accounts – accounts with a concrete id
 * @param {object[]} opts.catalogue – advertised rows (discovery catalogue shape)
 * @returns {object[]} candidates on the concrete account's own route
 */
function gatewayAccountCandidates(opts) {
  const o = opts || {};
  const registry = o.registry;
  const accounts = o.accounts || [];
  const catalogueInput = o.catalogue || [];
  const routeHealth = o.routeHealth;
  const probeOk = o.probeOk;
  const excluded = new Set((o.excludeModels || []).map((id) => String(id).toLowerCase()));
  const routeNow = Number(o.now) || Date.now();
  if (!registry || catalogueInput.length === 0) return [];
  const catalogue = catalogueInput;

  const sourceById = new Map();
  for (const s of registry.sources || []) sourceById.set(s.id, s);
  const routes = (registry.dispatch && registry.dispatch.providers) || {};
  const out = [];

  for (const account of accounts) {
    if (!account || !account.id || account.enabled === false) continue;
    const route = routes[String(account.provider || '').toLowerCase()];
    if (!route || !route.harness) continue;

    // The account reaches a gateway when the source its provider names is a
    // gateway itself, or when that source declares the gateway it rides.
    const source = sourceById.get(account.provider);
    if (!source || sourcesApi.isRetired(source.id, registry)) continue;
    if (sourcesApi.isDeferred(source.id, registry)) continue;

    const gateway = source.kind === sourcesApi.Kind.ROUTER ? source.id : source.reachedVia || null;
    if (!gateway) continue;

    const gatewaySource = sourceById.get(gateway);
    if (!gatewaySource) continue;
    if (sourcesApi.isRetired(gateway, registry) || sourcesApi.isDeferred(gateway, registry))
      continue;
    if (gatewaySource.servesModels === false) continue;

    // The harness that actually launches the session is the one the route
    // names; the access path is the CLI the provider is reached through.
    // Both come from the registry, so a new gateway needs no branch here.
    const harness = route.harness;
    const accessPath = accessPathOf(source, registry) || '';
    if (!harness || !accessPath) continue;

    const accountModels = account.models;
    const excludes = new Set(
      (Array.isArray(accountModels) ? accountModels : [])
        .filter((entry) => entry && typeof entry === 'object' && entry.exclude === true)
        .map((entry) => String(entry.model || '').toLowerCase())
    );
    const additions = new Set(
      (Array.isArray(accountModels) ? accountModels : [])
        .filter((entry) => typeof entry === 'string' || (entry && entry.exclude !== true))
        .map((entry) => String(typeof entry === 'string' ? entry : entry.model || '').toLowerCase())
        .filter((modelId) => modelId && !excludes.has(modelId))
    );
    let contributed = 0;
    const catalogueRows = catalogue.filter((row) => {
      if (!row || row.gateway !== gateway) return false;
      const modelId = row.modelId || row.model || '';
      const parsed = parsePrefix(modelId);
      return Boolean(parsed && (!row.upstream || row.upstream === parsed.upstream));
    });
    const catalogueModelIds = new Set(
      catalogueRows.map((row) => String(row.modelId || row.model || '').toLowerCase())
    );
    const rowsByModel = new Map(
      catalogueRows.map((row) => [String(row.modelId || row.model || '').toLowerCase(), row])
    );
    const eligibleRows = catalogueRows.slice();
    for (const modelId of additions) {
      if (!catalogueModelIds.has(modelId) && !excludes.has(modelId)) {
        const health = routeHealth && require('./route-health');
        const routePath = { id: gateway, accountId: account.id };
        const record = health && health.getPathRecord(routeHealth, modelId, routePath);
        const probed = Boolean(
          (record && health.isEligible(routeHealth, modelId, routePath, routeNow)) ||
          (probeOk && probeOk(modelId, gateway)) ||
          (o.probeEvidence && o.probeEvidence(modelId, gateway))
        );
        if (!probed) continue;
        const prefix = parsePrefix(modelId);
        if (!prefix) continue;
        const addition = {
          gateway,
          upstream: prefix.upstream,
          modelId,
          handAdded: true,
        };
        rowsByModel.set(modelId, addition);
        eligibleRows.push(addition);
      }
    }
    for (const row of eligibleRows) {
      if (!row) continue;
      const upstream = row.upstream || '';
      const modelId = row.modelId || row.model || '';
      if (!modelId || excluded.has(modelId.toLowerCase()) || excludes.has(modelId.toLowerCase()))
        continue;
      if (routeHealth) {
        const health = require('./route-health');
        const routePath = { id: gateway, accountId: account.id };
        const routeRecord = health.getPathRecord(routeHealth, modelId, routePath);
        const available = routeRecord
          ? health.isEligible(routeHealth, modelId, routePath, routeNow)
          : Boolean(
              o.allowMissingRouteHealth === true ||
              (probeOk && probeOk(modelId, gateway)) ||
              (o.probeEvidence && o.probeEvidence(modelId, routePath)) ||
              (!o.requireRouteHealth &&
                !o.routeHealthExplicit &&
                !o.routeHealth &&
                !probeOk &&
                !o.probeEvidence)
            );
        if (!available) continue;
      } else if (probeOk && !probeOk(modelId, gateway)) {
        continue;
      }
      // An alias is the prefix the model id itself carries. A row whose id
      // does not begin with its own upstream names no reachable alias, and
      // inventing one is exactly how a candidate that can never run is planned.
      if (!upstream || !modelId.startsWith(upstream + '/')) continue;
      if (!parsePrefix(modelId)) continue;
      const candidateUpstream = upstream;
      const candidateCapabilities = Object.assign({}, account.capabilities || {});
      delete candidateCapabilities.tools;
      delete candidateCapabilities.jsonSchema;
      let contextWindow = undefined;
      if (
        row.contextWindow !== undefined ||
        (row.capabilities && row.capabilities.contextWindow !== undefined)
      ) {
        contextWindow = toPositiveInteger(
          row.contextWindow !== undefined
            ? row.contextWindow
            : row.capabilities && row.capabilities.contextWindow
        );
      }
      if (contextWindow === undefined && gatewaySource && gatewaySource.modelMeta) {
        const meta = gatewaySource.modelMeta[modelId];
        if (meta && meta.contextWindow !== undefined) {
          contextWindow = toPositiveInteger(meta.contextWindow);
        }
      }
      if (contextWindow !== undefined) {
        candidateCapabilities.contextWindow = contextWindow;
      } else {
        delete candidateCapabilities.contextWindow;
      }
      out.push({
        harness,
        accessPath,
        gateway,
        upstream: candidateUpstream,
        accountId: account.id,
        quotaScope: account.id,
        modelId,
        source: gateway,
        sourceId: gatewaySource ? gatewaySource.id : gateway,
        endpoint: gatewaySource ? gatewaySource.endpoint || gatewaySource.accessPath : undefined,
        sourceEndpoint: gatewaySource
          ? gatewaySource.endpoint || gatewaySource.accessPath
          : undefined,
        kind: gatewaySource.kind,
        advertised: true,
        capabilities: candidateCapabilities,
        contextWindow,
        // A gateway catalogue proves a route exists, never that the account may
        // use it. Quality and cost stay undeclared until evidence supplies them,
        // so an advertised model is never scored as if it were measured.
        quality: undefined,
        cost: undefined,
        sharedQuota: 'unknown',
      });
      contributed += 1;
    }
    if (typeof o.onAccountCount === 'function') o.onAccountCount(account.id, contributed);
  }

  return markCapabilityDeclarations(out);
}

function resolveComboCapabilities(combo, accounts) {
  const accountId = combo && (combo.accountId || combo.account);
  if (accountId && accountId !== '*' && accountId !== 'UNPINNED' && Array.isArray(accounts)) {
    const acc = accounts.find((a) => a && a.id === accountId);
    if (acc && acc.capabilities && Object.keys(acc.capabilities).length > 0) {
      return Object.assign({}, acc.capabilities);
    }
  }
  if (combo && combo.capabilities && Object.keys(combo.capabilities).length > 0) {
    return Object.assign({}, combo.capabilities);
  }
  return {};
}

/**
 * Expand evidence-known combinations into candidates that the live catalogue
 * may have missed (e.g. models that were probed before but aren't currently
 * listed).
 *
 * Legacy four-part rows without account/quotaScope are preserved strictly as
 * unverified history; they are never assigned default account '*' or quotaScope
 * and never treated as verified active candidates.
 */
function candidatesFromEvidence(evidenceData, options) {
  const accounts =
    options && Array.isArray(options.accounts)
      ? options.accounts
      : Array.isArray(options)
        ? options
        : [];
  const out = [];
  for (const combo of (evidenceData && evidenceData.combinations) || []) {
    const isLegacy = combo.legacy || (!combo.accountId && !combo.quotaScope);
    if (isLegacy) {
      out.push({
        harness: combo.harness,
        accessPath: combo.accessPath,
        gateway: combo.gateway || '',
        upstream: combo.upstream,
        accountId: null,
        quotaScope: null,
        modelId: combo.modelId || combo.model,
        source: combo.source || combo.upstream,
        kind: 'evidence-history',
        legacy: true,
        verified: false,
        status: 'unknown',
        sharedQuota: 'unknown',
      });
    } else {
      const evidenceList = Array.isArray(combo.evidence)
        ? combo.evidence.map((e) => Object.assign({}, e))
        : [];
      const cand = {
        harness: combo.harness,
        accessPath: combo.accessPath,
        gateway: combo.gateway || '',
        upstream: combo.upstream,
        accountId: combo.accountId || combo.account || '*',
        quotaScope: combo.quotaScope || combo.upstream || '',
        modelId: combo.modelId || combo.model,
        source: combo.source || combo.upstream,
        kind: 'evidence',
        sharedQuota: 'unknown',
        evidence: evidenceList,
        capabilities: resolveComboCapabilities(combo, accounts),
      };
      if (combo.capabilityEvidence) {
        cand.capabilityEvidence = Object.assign({}, combo.capabilityEvidence);
      }
      if (combo.cost !== undefined) cand.cost = combo.cost;
      if (combo.quality !== undefined) cand.quality = combo.quality;
      if (combo.latencyMs !== undefined) cand.latencyMs = combo.latencyMs;
      if (combo.qualifiedRoles) cand.qualifiedRoles = combo.qualifiedRoles;
      out.push(cand);
    }
  }
  return markCapabilityDeclarations(out);
}

/**
 * Merge two candidate arrays, deduplicating by the seven-part key.
 */
function mergeCandidates(a, b) {
  const seen = new Set();
  const out = [];
  for (const c of [...a, ...b]) {
    const key = candidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Annotate candidates with evidence status and blocking state.
 *
 * Mutates candidates in-place, adding: status, blocked, blockReason, evidence[].
 */
function annotateCandidates(candidates, evidenceData, opts) {
  const annotOpts =
    opts && Object.prototype.hasOwnProperty.call(opts, 'quotaState')
      ? opts
      : Object.assign({}, opts, {
          quotaState:
            !opts || opts.loadQuotaState !== false
              ? require('./quota-scan').loadQuotaState(opts || {})
              : null,
        });
  for (const c of candidates) {
    if (c.legacy) {
      c.evidence = [];
      c.status = 'unknown';
      c.blocked = false;
      continue;
    }
    const ev = evidence.getEvidence(evidenceData, c);
    c.evidence = ev && ev.length > 0 ? ev : c.evidence || [];
    c.status = evidence.candidateStatus(evidenceData, c);

    const block = evidence.isCandidateBlocked
      ? evidence.isCandidateBlocked(evidenceData, c, annotOpts)
      : evidence.isUpstreamBlocked(evidenceData, c, annotOpts);
    c.blocked = block.blocked;
    if (block.blocked) {
      c.blockReason = block.reason;
      c.blockScope = block.scope || 'account';
    }
  }
  return candidates;
}

module.exports = {
  loadModelCatalog,
  parsePrefix,
  resolveRouterModel,
  candidateKey,
  harnessOf,
  accessPathOf,
  generateCandidates,
  markCapabilityDeclarations,
  gatewayAccountCandidates,
  poolAccountCandidates,
  candidatesFromEvidence,
  mergeCandidates,
  annotateCandidates,
  isOpenAiCompatibleSource,
  openAiCompatibleCandidates,
  resolveCandidateContextMeta,
  resolveCandidateCapabilities,
  catalogEvidenceFor,
  deriveCredentialAccountId,
};
