'use strict';

/**
 * Ship Dễ — Model discovery: reconcile pipeline (W2)
 *
 * One run:
 *
 *   1. enumerate every registry source through its kind adapter;
 *   2. build one snapshot (what was advertised, no judgement);
 *   3. diff against the last written state of the evidence store;
 *   4. write only true transitions — newly advertised candidates become
 *      UNKNOWN, candidates that stopped being advertised become REMOVED,
 *      EVERYTHING ELSE is a no-op that is left alone. The executor's slice
 *      owns the states that require judgement; this slice never writes them.
 *
 * A candidate that was AVAILABLE and is simply not advertised any more is
 * REMOVED with its full history retained — disappearance is news the machine
 * must act on, never erased history.
 */

const { STATES, DISCOVERY_WRITABLE } = require('./store');
const { buildSnapshot } = require('./snapshot');
const { enumerate } = require('./adapters');

function reconcileRun(opts) {
  const o = opts || {};
  const registry = o.registry || {};
  const prefixes = o.prefixes || [];
  const results = o.results || {};
  const current = o.current || new Map(); // key -> last catalogue line
  const runId = o.runId;
  const now = o.now || new Date().toISOString();

  const snapshot = buildSnapshot({
    registry,
    prefixes,
    results,
    now,
    runId,
    classifyShared: o.classifyShared,
  });

  const transitions = [];
  const seenKeys = new Set();

  for (const cand of snapshot.candidates) {
    seenKeys.add(cand.key);
    const prior = current.get(cand.key);
    const priorState = prior ? (prior.state || '').toUpperCase() : null;

    let state;
    let note;
    if (priorState === null) {
      state = 'UNKNOWN';
      note = 'first catalogue advertisement';
    } else if (priorState === 'REMOVED') {
      state = 'UNKNOWN';
      note = 'advertised again after REMOVED';
    } else if (priorState === 'UNKNOWN' || priorState === 'PROBING') {
      state = priorState; // never promoted/demoted by a listing
      note = 'unchanged advertisement';
    } else {
      // AVAILABLE, DEGRADED, COOLDOWN, UNAVAILABLE: the listing neither
      // confirms not denies; leave the model alone.
      state = priorState;
      note = 'listing is not availability evidence';
    }

    if (priorState === state && prior) continue;

    if (state !== 'UNKNOWN' && !DISCOVERY_WRITABLE.has(state)) continue;

    transitions.push(
      catalogueLine({ runId, now, cand, state, note, snapshotRunId: snapshot.runId })
    );
  }

  // Candidates previously recorded that no advertised source still carries.
  for (const [key, prior] of current) {
    if (seenKeys.has(key)) continue;
    const priorState = (prior.state || '').toUpperCase();
    if (priorState === 'REMOVED') continue; // already gone
    const line = catalogueLine({
      runId,
      now,
      cand: {
        key,
        harness: prior.harness,
        accessPath: prior.accessPath,
        gateway: prior.gateway,
        upstream: prior.upstream,
        account: prior.account,
        modelId: prior.modelId,
        base: prior.base,
        sourceIds: prior.sourceIds || [],
      },
      state: 'REMOVED',
      note: 'no longer advertised by any enumerated source',
      snapshotRunId: snapshot.runId,
    });
    transitions.push(line);
  }

  return {
    snapshot,
    transitions,
    perState: stateBreakdown(snapshot, transitions, current),
    perSourceNarrow: perSourceBreakdown(snapshot),
  };
}

function catalogueLine({ runId, now, cand, state, note, snapshotRunId }) {
  return {
    type: 'transition',
    ts: now,
    runId,
    snapshot: snapshotRunId,
    key: cand.key,
    harness: cand.harness,
    accessPath: cand.accessPath,
    gateway: cand.gateway,
    upstream: cand.upstream,
    account: cand.account || '',
    modelId: cand.modelId,
    base: cand.base,
    sourceIds: cand.sourceIds || [],
    state,
    note,
  };
}

function stateBreakdown(snapshot, transitions, current) {
  const counts = {};
  for (const s of STATES) counts[s] = 0;
  for (const t of transitions) counts[t.state] = (counts[t.state] || 0) + 1;
  // Legacy: candidates that stayed put count toward their prior state.
  for (const [, prior] of current) {
    const s = (prior.state || '').toUpperCase();
    if (STATES.indexOf(s) === -1) continue;
    counts[s] = (counts[s] || 0) + 1;
  }
  counts._candidates = snapshot.candidates.length;
  counts._transitions = transitions.length;
  counts._aliases = snapshot.aliases.length;
  return counts;
}

function perSourceBreakdown(snapshot) {
  const counts = {};
  for (const c of snapshot.catalogues) {
    counts[c.sourceId] = {
      status: c.status,
      advertised: 0,
      catalogs: c.catalogs || [],
      reason: c.reason,
    };
  }
  // Advertised = unique candidates this source is a recorded advertiser of.
  for (const cand of snapshot.candidates) {
    for (const sid of cand.sourceIds || []) {
      if (!counts[sid]) counts[sid] = { status: 'n/a', advertised: 0 };
      counts[sid].advertised += 1;
    }
  }
  return counts;
}

module.exports = { reconcileRun, catalogueLine };
