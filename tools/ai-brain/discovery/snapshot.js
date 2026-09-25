'use strict';

/**
 * Ship Dễ — Model discovery: snapshot builder (W2)
 *
 * A snapshot is the immutable, storable picture of exactly one enumeration
 * run: which sources were read through which route, which candidates they
 * advertised, and which aliases were seen. It carries timestamps and version
 * so two snapshots can be diffed without confusing runs, and it carries the
 * request descriptors (never headers) so a reader can later prove what was
 * called.
 *
 * A snapshot performs NO state judgement. It does not say a model is available
 * — a listing proves nothing about capacity, and the state machine refuses to
 * move to AVAILABLE from a listing. It only records what was advertised; state
 * transition is the reconcile pipeline's job.
 *
 * Aliasing never merges candidates. Two routes that carry the same model name
 * are two candidates that a human or chooser must treat separately; the alias
 * record says they probably refer to the same model family, the shared-quota
 * record says whether the two routes are known to share quota — which defaults
 * to `unknown` and may only be promoted by a comparator that proves identity
 * without using secrets or name matching.
 */

const { candidateKey, modelBase } = require('./identity');

function buildSnapshot(opts) {
  const o = opts || {};
  const registry = o.registry || {};
  const prefixes = o.prefixes || [];
  const now = o.now || new Date().toISOString();
  const runId = o.runId || `${now}|${Math.random().toString(36).slice(2, 10)}`;

  const sources = (registry.sources || []).filter((s) => s && s.id);

  const catalogues = [];
  for (const source of sources) {
    const res = o.resultFor ? o.resultFor(source.id) : o.results && o.results[source.id];
    if (!res) continue;
    const entry = {
      sourceId: source.id,
      status: res.status,
      requestedCount: -1,
    };
    if (res.reason) entry.reason = res.reason;
    if (res.mapped) entry.mapped = res.mapped;
    if (res.notes && res.notes.length) entry.notes = res.notes;
    if (res.presence) {
      entry.presence = {
        found: !!res.presence,
        kind: res.presence && res.presence.kind,
        file:
          res.presence && res.presence.file
            ? String(res.presence.file).replace(/\\/g, '/')
            : undefined,
        error: res.presence && res.presence.error ? res.presence.error : undefined,
      };
    }
    if (res.requests && res.requests.length) {
      entry.requests = res.requests.map((r) => ({
        url: r && r.url ? String(r.url).replace(/[?&]key=[^&]*/g, '') : '',
        auth: r && r.auth ? r.auth : '',
        exitCode: r && r.exitCode !== undefined ? r.exitCode : undefined,
      }));
    }
    if (res.catalogs && res.catalogs.length) {
      entry.catalogs = res.catalogs.map((c) => ({
        upstream: c.upstream,
        gateway: c.gateway,
        accessPath: c.accessPath,
        harness: c.harness,
        count: c.count,
      }));
      entry.requestedCount = res.catalogs.reduce((n, c) => n + c.count, 0);
      entry.catalogList = res.catalogs;
    } else {
      entry.catalogs = [];
    }
    catalogues.push(entry);
  }

  const candidates = buildCandidates(catalogues, prefixes);
  const aliases = buildAliases(candidates, prefixes, o.classifyShared);

  return {
    schema: 'shipde/discovery-snapshot',
    version: 1,
    generatedAt: now,
    runId,
    catalogues,
    candidates,
    aliases,
  };
}

/**
 * One identity per (route, modelId) pair. A pair that appears on more than one
 * source (same route, e.g. 9Router and xkiro mapping onto the same model) is
 * one candidate with the advertisers merged; a model on two *routes* is two
 * candidates by construction.
 */
function buildCandidates(catalogues, prefixes) {
  const byKey = new Map();
  for (const entry of catalogues) {
    for (const c of entry.catalogList || []) {
      for (const modelId of c.models) {
        const identity = {
          harness: c.harness,
          accessPath: c.accessPath,
          gateway: c.gateway,
          upstream: c.upstream,
          account: '',
          modelId,
        };
        const key = candidateKey(identity);
        const existing = byKey.get(key);
        if (existing) {
          if (existing.sourceIds.indexOf(entry.sourceId) === -1)
            existing.sourceIds.push(entry.sourceId);
          continue;
        }
        byKey.set(key, {
          key,
          harness: c.harness,
          accessPath: c.accessPath,
          gateway: c.gateway,
          upstream: c.upstream,
          account: '',
          modelId,
          base: modelBase(modelId, prefixes),
          sourceIds: [entry.sourceId],
        });
      }
    }
  }
  return [...byKey.values()];
}

/**
 * Alias detection: candidates whose normalised base names agree but whose
 * routes disagree. Per-path aliases must be recorded per path; a shared-quota
 * verdict is attached and is `unknown` unless the injected comparator proves
 * otherwise with evidence.
 */
function buildAliases(candidates, prefixes, classifyShared) {
  const classify =
    typeof classifyShared === 'function'
      ? classifyShared
      : () => ({
          sharedQuota: 'unknown',
          evidence:
            'no safe identity comparison was available; never derived from secrets or name matching',
        });

  const byBase = new Map();
  for (const c of candidates) {
    if (!byBase.has(c.base)) byBase.set(c.base, []);
    byBase.get(c.base).push(c);
  }

  const aliases = [];
  for (const [base, group] of byBase) {
    if (group.length < 2) continue;
    const paths = group.map((c) => ({
      key: c.key,
      harness: c.harness,
      accessPath: c.accessPath,
      gateway: c.gateway,
      upstream: c.upstream,
      account: c.account,
      modelId: c.modelId,
      sourceIds: c.sourceIds,
    }));
    const verdict = classify(paths);
    const entry = {
      base,
      paths,
      sharedQuota: (verdict && verdict.sharedQuota) || 'unknown',
    };
    if (verdict && verdict.evidence) entry.evidence = verdict.evidence;
    aliases.push(entry);
  }
  return aliases;
}

module.exports = { buildSnapshot, buildCandidates, buildAliases };
