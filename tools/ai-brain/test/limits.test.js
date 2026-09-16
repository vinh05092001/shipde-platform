'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  PROVENANCE,
  STALE_AFTER_MS,
  EVIDENCE_FLOOR,
  WINDOWS,
  resolveLimits,
  runwayFor,
  aggregateRemaining,
} = require('../limits');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 16);

function account(overrides) {
  return Object.assign({ id: 'acct-1', enabled: true, limits: {} }, overrides || {});
}

function declared(value, provenance, assertedAt) {
  return { value, provenance: provenance || 'vendor-documented', assertedAt: assertedAt || NOW };
}

/**
 * Observations shaped as ceiling.js records them.
 *
 * Every fifth one is a refusal, because inferWindow reports a ceiling only once
 * it has been refused: successes alone establish a floor, never a ceiling. A
 * fixture of pure successes would leave the ceiling null for that reason rather
 * than because of the evidence floor, and the floor would go untested.
 */
function observations(count, window) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      accountId: 'acct-1',
      outcome: i % 5 === 0 ? 'refused' : 'accepted',
      reason: 'quota',
      consumed: { [window]: 100 + i },
      at: new Date(NOW - i * 1000).toISOString(),
    });
  }
  return out;
}

describe('limits — a declared ceiling', () => {
  test('a declared ceiling turns a percentage into a runway', () => {
    const a = account({ limits: { tokensPerDay: declared(1000) } });
    const r = runwayFor(a, 'tokensPerDay', 12, { skipLedger: true, now: NOW });
    assert.equal(r.known, true);
    assert.equal(r.remaining, 120);
  });

  test('an undeclared window stays unknown and gets no default', () => {
    const a = account({ limits: { tokensPerDay: declared(1000) } });
    const r = resolveLimits(a, { skipLedger: true, now: NOW });
    assert.equal(r.windows.requestsPerDay.unknownBudget, true);
    assert.equal('ceiling' in r.windows.requestsPerDay, false);
  });

  test('a limit with no source is rejected by account id and window', () => {
    const a = account({ id: 'acct-9', limits: { tokensPerDay: { value: 500 } } });
    const r = resolveLimits(a, { skipLedger: true, now: NOW });
    assert.equal(r.rejected.length, 1);
    assert.equal(r.rejected[0].accountId, 'acct-9');
    assert.equal(r.rejected[0].window, 'tokensPerDay');
    assert.equal(r.windows.tokensPerDay.unknownBudget, true);
  });

  test('a tokensPerDay ceiling never interprets a weekly percentage', () => {
    // The scheduler has no weekly window at all; asking for one must refuse
    // rather than fall through to the daily ceiling, which would return a
    // number that reads like an answer.
    const a = account({ limits: { tokensPerDay: declared(1000) } });
    const r = runwayFor(a, 'tokensPerWeek', 50, { skipLedger: true, now: NOW });
    assert.equal(r.known, false);
    assert.equal(WINDOWS.includes('tokensPerWeek'), false);
  });

  test('a ceiling asserted over 90 days ago reports stale', () => {
    const a = account({
      limits: { tokensPerDay: declared(1000, 'operator-declared', NOW - 91 * DAY) },
    });
    const r = resolveLimits(a, { skipLedger: true, now: NOW });
    assert.equal(r.windows.tokensPerDay.stale, true);
    // Still usable, but the staleness travels with the answer.
    assert.equal(runwayFor(a, 'tokensPerDay', 50, { skipLedger: true, now: NOW }).stale, true);
  });

  test('a ceiling asserted inside the window is not stale', () => {
    const a = account({
      limits: { tokensPerDay: declared(1000, 'operator-declared', NOW - 89 * DAY) },
    });
    assert.equal(
      resolveLimits(a, { skipLedger: true, now: NOW }).windows.tokensPerDay.stale,
      false
    );
  });
});

describe('limits — evidence from the ledger', () => {
  test('fewer than 20 observations yields no ceiling', () => {
    const obs = observations(EVIDENCE_FLOOR - 1, 'tokensPerDay');
    const r = resolveLimits(account(), { observations: obs, now: NOW });
    assert.equal(r.windows.tokensPerDay.unknownBudget, true);
    // Control: the same ledger with enough observations DOES yield a ceiling,
    // so the floor is what refused it and not a shortage of evidence shape.
    const enough = resolveLimits(account(), {
      observations: observations(EVIDENCE_FLOOR + 5, 'tokensPerDay'),
      now: NOW,
    });
    assert.equal(enough.windows.tokensPerDay.unknownBudget, false);
  });

  test('declared wins and keeps the observed value as an alternative', () => {
    const obs = observations(EVIDENCE_FLOOR + 5, 'tokensPerDay');
    const a = account({ limits: { tokensPerDay: declared(1000) } });
    const r = resolveLimits(a, { observations: obs, now: NOW });
    assert.equal(r.windows.tokensPerDay.ceiling, 1000);
    assert.equal(r.windows.tokensPerDay.provenance, 'vendor-documented');
    assert.equal('observedCeiling' in r.windows.tokensPerDay, true);
  });

  test('runway names the ceiling value, window and source', () => {
    const a = account({ limits: { tokensPerDay: declared(2000, 'operator-declared') } });
    const r = runwayFor(a, 'tokensPerDay', 25, { skipLedger: true, now: NOW });
    assert.equal(r.ceiling, 2000);
    assert.equal(r.window, 'tokensPerDay');
    assert.equal(r.provenance, 'operator-declared');
    assert.equal(r.remaining, 500);
  });
});

describe('limits — across accounts', () => {
  test('aggregate excludes unknown accounts and says how many', () => {
    const known = account({ id: 'k', limits: { tokensPerDay: declared(1000) } });
    const unknown = account({ id: 'u' });
    const r = aggregateRemaining([known, unknown], 'tokensPerDay', {
      skipLedger: true,
      now: NOW,
      percentages: { k: 50, u: 50 },
    });
    assert.equal(r.total, 500);
    assert.equal(r.counted, 1);
    assert.equal(r.unknownCount, 1);
    assert.equal(r.unknown[0].accountId, 'u');
  });

  test('a disabled account retains limits and contributes no capacity', () => {
    const off = account({ id: 'd', enabled: false, limits: { tokensPerDay: declared(1000) } });
    const r = aggregateRemaining([off], 'tokensPerDay', { skipLedger: true, now: NOW });
    assert.equal(r.total, 0);
    assert.equal(r.counted, 0);
    // The limits are still resolvable; it is participation that stops.
    assert.equal(
      resolveLimits(off, { skipLedger: true, now: NOW }).windows.tokensPerDay.ceiling,
      1000
    );
  });
});

describe('limits — the shape of the rules themselves', () => {
  test('every provenance is one of the three named sources', () => {
    assert.deepEqual(PROVENANCE, ['vendor-documented', 'operator-declared', 'observed']);
  });

  test('an unrecognised provenance is refused, not trusted', () => {
    const a = account({ limits: { tokensPerDay: { value: 1, provenance: 'guessed' } } });
    const r = resolveLimits(a, { skipLedger: true, now: NOW });
    assert.equal(r.rejected.length, 1);
    assert.match(r.rejected[0].reason, /provenance/);
  });

  test('the staleness window and the evidence floor are the stated numbers', () => {
    assert.equal(STALE_AFTER_MS, 90 * DAY);
    assert.equal(EVIDENCE_FLOOR, 20);
  });
});
