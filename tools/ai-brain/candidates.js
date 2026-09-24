'use strict';

/**
 * Ship Dễ — Candidate Generator (Slices B+C)
 *
 * Generates four-part candidates from the source registry and a live model
 * catalogue.  A candidate is always:
 *
 *   (harness, accessPath, upstream, modelId)
 *
 * The same model reached two different ways is two candidates, because they
 * fail independently and they are limited independently.
 *
 * 9Router is a gateway, not a source.  Its catalogue is the union of the
 * accounts logged into it, so a model id proves routing, never capacity.
 * Each upstream prefix (cl, kr, gh, ag, …) is an independent failure and
 * quota domain.
 *
 * No model name is hard-coded here.  Every name comes from data: the live
 * catalogue, evidence.json, or a caller-supplied list.  A name in the code
 * is the bug; a name in the data is fine.
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
 * Generate candidates.
 *
 * @param {object} opts
 * @param {string[]} [opts.catalogue]     – model ids from the gateway's /v1/models
 * @param {string[]} [opts.openCodeIds]   – model ids from `opencode models --json`
 * @param {object}   [opts.evidenceData]  – pre-loaded evidence (avoids re-read)
 * @param {object}   [opts.registry]      – pre-loaded source registry
 * @param {object}   [opts.sourceOpts]    – options passed to loadSources
 * @returns {object[]} array of candidate objects
 */
function generateCandidates(opts) {
  const o = opts || {};
  const registry = o.registry || sourcesApi.loadSources(o.sourceOpts);
  const catalogue = o.catalogue || [];
  const openCodeIds = o.openCodeIds || [];
  const candidates = [];

  for (const source of registry.sources) {
    if (sourcesApi.isRetired(source.id, registry)) continue;

    if (source.kind === 'router' && source.servesModels !== false) {
      // Gateway: expand catalogue into (upstream, model) pairs.
      // Each upstream prefix is an independent failure domain.
      for (const fullId of catalogue) {
        const parsed = parsePrefix(fullId);
        if (!parsed) continue;
        candidates.push({
          harness: 'paseo',
          accessPath: source.endpoint || source.id,
          upstream: parsed.upstream,
          modelId: fullId,
          source: source.id,
          kind: source.kind,
          sharedQuota: 'unknown',
        });
      }
    }

    if (source.kind === 'model-source' && source.servesModels !== false) {
      // Direct model source: if reached via a router, expand catalogue for
      // that router alias.  Otherwise, the source provides its own models
      // through evidence or caller-supplied data.
      if (source.reachedVia && source.routerAlias) {
        const prefix = source.routerAlias + '/';
        for (const fullId of catalogue) {
          if (fullId.startsWith(prefix)) {
            candidates.push({
              harness: 'paseo',
              accessPath: source.reachedVia,
              upstream: source.routerAlias,
              modelId: fullId,
              source: source.id,
              kind: source.kind,
              sharedQuota: 'unknown',
            });
          }
        }
      }
    }

    if (source.kind === 'agent-cli' && source.harness) {
      // CLI harness (agy, cline, qwen, codex, opencode).
      // If it serves models itself, it appears with its own model list.
      // If it reaches through a router, we expand those catalogue ids.
      if (source.reachedVia) {
        // OpenCode reaches 9Router models via ninerouter/ prefix.
        // Its own namespace is in openCodeIds.
        for (const ocId of openCodeIds) {
          const parsed = parsePrefix(ocId);
          candidates.push({
            harness: source.harness,
            accessPath: 'cli',
            upstream: parsed ? parsed.upstream : source.id,
            modelId: ocId,
            source: source.id,
            kind: source.kind,
            sharedQuota: 'unknown',
          });
        }
        // Also the ninerouter/ models from the HTTP catalogue, accessible
        // through OpenCode's ninerouter/ prefix.
        const mp = (source.modelPrefix || registry.dispatch?.providers?.[source.id]?.modelPrefix || '');
        if (mp) {
          for (const fullId of catalogue) {
            const prefixed = mp + fullId;
            candidates.push({
              harness: source.harness,
              accessPath: 'cli',
              upstream: parsePrefix(fullId)?.upstream || source.id,
              modelId: prefixed,
              source: source.id,
              kind: source.kind,
              sharedQuota: 'unknown',
            });
          }
        }
      } else if (source.servesModels !== false) {
        // Self-contained CLI (agy, qwen).
        // Models are not enumerable here; they come from evidence or the
        // registry's own data.  We create a placeholder that the evidence
        // and account system will fill.
        candidates.push({
          harness: source.harness,
          accessPath: 'cli',
          upstream: source.id,
          modelId: '*',
          source: source.id,
          kind: source.kind,
          sharedQuota: 'unknown',
        });
      }
    }
  }

  return candidates;
}

/**
 * Expand evidence-known combinations into candidates that the live catalogue
 * may have missed (e.g. models that were probed before but aren't currently
 * listed).
 */
function candidatesFromEvidence(evidenceData) {
  const out = [];
  for (const combo of evidenceData.combinations || []) {
    out.push({
      harness: combo.harness,
      accessPath: combo.accessPath,
      upstream: combo.upstream,
      modelId: combo.model,
      source: combo.source || combo.upstream,
      kind: 'evidence',
      sharedQuota: 'unknown',
    });
  }
  return out;
}

/**
 * Merge two candidate arrays, deduplicating by the four-part key.
 */
function mergeCandidates(a, b) {
  const seen = new Set();
  const out = [];
  for (const c of [...a, ...b]) {
    const key = evidence.candidateKey(c);
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
    const ev = evidence.getEvidence(evidenceData, c);
    c.evidence = ev;
    c.status = evidence.candidateStatus(evidenceData, c);

    const block = evidence.isUpstreamBlocked(evidenceData, c.upstream, opts);
    c.blocked = block.blocked;
    if (block.blocked) {
      c.blockReason = block.reason;
      c.blockScope = block.scope || 'upstream';
    }
  }
  return candidates;
}

module.exports = {
  parsePrefix,
  generateCandidates,
  candidatesFromEvidence,
  mergeCandidates,
  annotateCandidates,
};
