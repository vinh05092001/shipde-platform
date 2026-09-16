'use strict';

/**
 * Ship Dễ — Declared account limits and what follows from them.
 *
 * A vendor percentage is not a quantity. "12% remaining" answers nothing on its
 * own: twelve percent of what, over which window? Without a declared ceiling the
 * honest answer is that the budget is unknown, and this module keeps that answer
 * visible rather than filling it with a default that reads like knowledge.
 *
 * Every number carries where it came from. A ceiling with no provenance is
 * refused, because an unattributed figure cannot be checked or withdrawn.
 */

const { WINDOWS, inferLimits, readLedger } = require('./ceiling');

/**
 * Where a ceiling came from, in descending authority.
 *
 * `vendor-documented` is published by the provider. `operator-declared` is a
 * figure the operator asserts and takes responsibility for. `observed` is
 * derived from the ledger, and is the only one this code can produce by itself.
 */
const PROVENANCE = ['vendor-documented', 'operator-declared', 'observed'];

/** A declared ceiling older than this is reported stale, never silently used. */
const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;

/** Below this many observations an inferred ceiling is a guess, not evidence. */
const EVIDENCE_FLOOR = 20;

function isDeclaredEntry(entry) {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry);
}

/**
 * The limits in force for one account, window by window.
 *
 * Each window resolves to either a known ceiling with its provenance, or
 * `unknownBudget: true`. There is no third state and no default: a window this
 * code cannot speak to says so.
 */
function resolveLimits(account, options) {
  const opts = options || {};
  const now = Number(opts.now) || Date.now();
  const declared = (account && account.limits) || {};
  const observed = opts.skipLedger ? {} : inferLimits(account && account.id, opts);

  // inferWindow reports a ceiling but not how much evidence produced it, so the
  // evidence floor is counted here: an observation of this account that names
  // the window. A ceiling inferred from three data points is a guess wearing a
  // number, and the guess is the thing this Work Item exists to stop.
  const ledger = opts.skipLedger ? [] : opts.observations || readLedger(opts.file);
  const samplesFor = (window) =>
    ledger.filter(
      (o) =>
        o &&
        o.accountId === (account && account.id) &&
        o.consumed &&
        o.consumed[window] !== undefined
    ).length;

  const windows = {};
  const rejected = [];

  for (const window of WINDOWS) {
    const entry = declared[window];
    const seen = observed[window];
    const observedCeiling =
      seen && Number(seen.ceiling) > 0 && samplesFor(window) >= EVIDENCE_FLOOR
        ? Number(seen.ceiling)
        : null;

    if (isDeclaredEntry(entry)) {
      const value = Number(entry.value);
      const provenance = String(entry.provenance || '');
      if (!(value > 0) || PROVENANCE.indexOf(provenance) === -1) {
        // Named, so the operator can find the row that has to be fixed.
        rejected.push({
          accountId: (account && account.id) || '(no id)',
          window,
          reason: !(value > 0)
            ? 'ceiling is not a positive number'
            : 'provenance is missing or unrecognised',
        });
        windows[window] = { unknownBudget: true };
        continue;
      }
      const assertedAt = Number(entry.assertedAt) || null;
      const stale = assertedAt !== null && now - assertedAt > STALE_AFTER_MS;
      windows[window] = {
        unknownBudget: false,
        ceiling: value,
        provenance,
        assertedAt,
        stale,
        // A declared figure wins, but the observed one is kept rather than
        // discarded: a large divergence is the operator's signal that the
        // declaration is wrong.
        observedCeiling,
      };
      continue;
    }

    if (observedCeiling !== null) {
      windows[window] = {
        unknownBudget: false,
        ceiling: observedCeiling,
        provenance: 'observed',
        assertedAt: null,
        stale: false,
        samples: samplesFor(window),
      };
      continue;
    }

    windows[window] = { unknownBudget: true };
  }

  return { accountId: (account && account.id) || null, windows, rejected };
}

/**
 * Turn a vendor percentage into a quantity, or refuse.
 *
 * The ceiling must belong to the same window the percentage describes. A
 * tokensPerDay ceiling cannot interpret a weekly percentage, and applying it
 * anyway would produce a number that looks like an answer.
 */
function runwayFor(account, window, percentRemaining, options) {
  const resolved = resolveLimits(account, options);
  const w = resolved.windows[window];

  if (!w || w.unknownBudget) {
    return { known: false, reason: 'no ceiling declared for ' + window, window };
  }
  const pct = Number(percentRemaining);
  if (!(pct >= 0 && pct <= 100)) {
    return { known: false, reason: 'percentage is out of range', window };
  }

  return {
    known: true,
    window,
    remaining: Math.floor((w.ceiling * pct) / 100),
    ceiling: w.ceiling,
    provenance: w.provenance,
    stale: Boolean(w.stale),
  };
}

/**
 * Capacity across accounts, for one window.
 *
 * Percentages are never summed: two accounts at 50% of unknown ceilings is not
 * one account at 100%. Only accounts with a known ceiling contribute, and the
 * count of those left out is reported so the total is read as partial.
 */
function aggregateRemaining(accounts, window, options) {
  const opts = options || {};
  const percentages = opts.percentages || {};
  let total = 0;
  let counted = 0;
  const unknown = [];

  for (const account of accounts || []) {
    if (account && account.enabled === false) {
      unknown.push({ accountId: account.id, reason: 'disabled' });
      continue;
    }
    const pct = percentages[account && account.id];
    const r = runwayFor(account, window, pct === undefined ? 100 : pct, opts);
    if (!r.known) {
      unknown.push({ accountId: account && account.id, reason: r.reason });
      continue;
    }
    total += r.remaining;
    counted += 1;
  }

  return { window, total, counted, unknownCount: unknown.length, unknown };
}

module.exports = {
  PROVENANCE,
  STALE_AFTER_MS,
  EVIDENCE_FLOOR,
  WINDOWS,
  resolveLimits,
  runwayFor,
  aggregateRemaining,
};
