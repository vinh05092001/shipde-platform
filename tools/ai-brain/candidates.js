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

const sourcesApi = require('./sources');
const evidence = require('./evidence');

/**
 * Parse upstream prefix from a gateway model id.
 * e.g. "gh/gpt-4o" → { upstream: "gh", model: "gpt-4o" }
 */
function parsePrefix(modelId) {
  const idx = modelId.indexOf('/');
  if (idx < 1) return null;
  return { upstream: modelId.slice(0, idx), model: modelId.slice(idx + 1) };
}

/**
 * Canonical seven-part identity for a candidate:
 *   harness :: accessPath :: gateway :: upstream :: accountId :: quotaScope :: modelId
 *
 * This is the ONE identity everywhere: evidence, cooldowns, aliases, shared quota,
 * decision log, deduplication, and catalogue lookup.
 */
function candidateKey(c) {
  if (!c) return '';
  if (typeof c === 'string') return c;
  return [
    c.harness || '',
    c.accessPath || '',
    c.gateway || '',
    c.upstream || '',
    c.accountId || '*',
    c.quotaScope || '',
    c.modelId || c.model || '',
  ].join('::');
}

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
function accountsFor(accounts, sourceId) {
  return (accounts || []).filter((a) => a.sourceId === sourceId || a.source === sourceId);
}

/** Model names an account declares, normalised to strings. */
function accountModels(account) {
  const declared = (account && account.models) || [];
  return declared.map((m) => (typeof m === 'string' ? m : m && m.model)).filter(Boolean);
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
function generateCandidates(opts) {
  const o = opts || {};
  const registry = o.registry || sourcesApi.loadSources(o.sourceOpts);
  const catalogue = o.catalogue || [];
  const openCodeIds = o.openCodeIds || [];
  const accounts = o.accounts || [];
  const candidates = [];

  for (const source of registry.sources) {
    if (sourcesApi.isRetired(source.id, registry)) continue;
    const bound = accountsFor(accounts, source.id);
    const sharedArc = bound.length === 0;

    if (source.kind === 'router' && source.servesModels !== false) {
      // Gateway: expand catalogue into (upstream, model) pairs.
      // Each upstream prefix is an independent failure domain.
      const harness = harnessOf(source, registry);
      const accessPath = accessPathOf(source, registry);
      if (!harness || !accessPath) continue;
      for (const fullId of catalogue) {
        const parsed = parsePrefix(fullId);
        if (!parsed) continue;
        if (sharedArc) {
          candidates.push({
            harness,
            accessPath,
            gateway: source.id,
            upstream: parsed.upstream,
            accountId: '*',
            quotaScope: parsed.upstream,
            modelId: fullId,
            source: source.id,
            kind: source.kind,
            sharedQuota: 'unknown',
          });
        } else {
          for (const acc of bound) {
            candidates.push({
              harness,
              accessPath,
              gateway: source.id,
              upstream: parsed.upstream,
              accountId: acc.id,
              quotaScope: acc.id,
              modelId: fullId,
              source: source.id,
              kind: source.kind,
              sharedQuota: 'unknown',
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
        for (const fullId of catalogue) {
          if (!fullId.startsWith(prefix)) continue;
          if (sharedArc) {
            candidates.push({
              harness,
              accessPath,
              gateway: source.reachedVia,
              upstream: source.routerAlias,
              accountId: '*',
              quotaScope: source.routerAlias,
              modelId: fullId,
              source: source.id,
              kind: source.kind,
              reachedVia: source.reachedVia,
              sharedQuota: 'unknown',
            });
          } else {
            for (const acc of bound) {
              candidates.push({
                harness,
                accessPath,
                gateway: source.reachedVia,
                upstream: source.routerAlias,
                accountId: acc.id,
                quotaScope: acc.id,
                modelId: fullId,
                source: source.id,
                kind: source.kind,
                reachedVia: source.reachedVia,
                sharedQuota: 'unknown',
              });
            }
          }
        }
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
        for (const ocId of openCodeIds) {
          const parsed = parsePrefix(ocId);
          if (sharedArc) {
            candidates.push({
              harness,
              accessPath,
              gateway: source.reachedVia,
              upstream: parsed ? parsed.upstream : source.id,
              accountId: '*',
              quotaScope: source.id,
              modelId: ocId,
              source: source.id,
              kind: source.kind,
              sharedQuota: 'unknown',
            });
          } else {
            for (const acc of bound) {
              candidates.push({
                harness,
                accessPath,
                gateway: source.reachedVia,
                upstream: parsed ? parsed.upstream : source.id,
                accountId: acc.id,
                quotaScope: acc.id,
                modelId: ocId,
                source: source.id,
                kind: source.kind,
                sharedQuota: 'unknown',
              });
            }
          }
        }
        // Also the ninerouter/ models from the HTTP catalogue, accessible
        // through OpenCode's ninerouter/ prefix.
        const mp =
          source.modelPrefix || registry.dispatch?.providers?.[source.id]?.modelPrefix || '';
        if (mp) {
          for (const fullId of catalogue) {
            const prefixed = mp + fullId;
            if (sharedArc) {
              candidates.push({
                harness,
                accessPath,
                gateway: source.reachedVia,
                upstream: parsePrefix(fullId)?.upstream || source.id,
                accountId: '*',
                quotaScope: source.id,
                modelId: prefixed,
                source: source.id,
                kind: source.kind,
                sharedQuota: 'unknown',
              });
            } else {
              for (const acc of bound) {
                candidates.push({
                  harness,
                  accessPath,
                  gateway: source.reachedVia,
                  upstream: parsePrefix(fullId)?.upstream || source.id,
                  accountId: acc.id,
                  quotaScope: acc.id,
                  modelId: prefixed,
                  source: source.id,
                  kind: source.kind,
                  sharedQuota: 'unknown',
                });
              }
            }
          }
        }
      } else if (source.servesModels !== false) {
        // Self-contained CLI (agy, qwen).
        // Models are not enumerable from the live catalogue; they come from
        // evidence or from the accounts bound to this source. With a bound
        // account we emit one concrete candidate per declared model. Without
        // one we emit a '*' placeholder that the chooser must resolve — an
        // unresolved wildcard is rejected, never silently passed through.
        if (sharedArc) {
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
            const models = accountModels(acc);
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
                sharedQuota: 'unknown',
              });
            }
          }
        }
      }
    }
  }

  return candidates;
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
function candidatesFromEvidence(evidenceData) {
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
      out.push({
        harness: combo.harness,
        accessPath: combo.accessPath,
        gateway: combo.gateway || '',
        upstream: combo.upstream,
        accountId: combo.accountId || '*',
        quotaScope: combo.quotaScope || combo.upstream,
        modelId: combo.modelId || combo.model,
        source: combo.source || combo.upstream,
        kind: 'evidence',
        sharedQuota: 'unknown',
      });
    }
  }
  return out;
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
  for (const c of candidates) {
    if (c.legacy) {
      c.evidence = [];
      c.status = 'unknown';
      c.blocked = false;
      continue;
    }
    const ev = evidence.getEvidence(evidenceData, c);
    c.evidence = ev;
    c.status = evidence.candidateStatus(evidenceData, c);

    const block = evidence.isCandidateBlocked
      ? evidence.isCandidateBlocked(evidenceData, c, opts)
      : evidence.isUpstreamBlocked(evidenceData, c, opts);
    c.blocked = block.blocked;
    if (block.blocked) {
      c.blockReason = block.reason;
      c.blockScope = block.scope || 'account';
    }
  }
  return candidates;
}

module.exports = {
  parsePrefix,
  candidateKey,
  harnessOf,
  accessPathOf,
  generateCandidates,
  candidatesFromEvidence,
  mergeCandidates,
  annotateCandidates,
};
