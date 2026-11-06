'use strict';

/**
 * Ship Dease — TASK-AI-171: structured route decision with one score scale.
 *
 * Reads the real fixture (already sanitized) and checks each point from the
 * task: failure classification, budget filtering, one-scale ranking, combo
 * identity, AGY account separation, BLOCKED when nothing ranks, and
 * determinism. No network or model call; no fixture edit.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  classifyFailure,
  filterEligible,
  rankByScale,
  decide,
  routeKey,
} = require('../route-decision');

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures', 'routing-replay', 'runs.json'),
    'utf8'
  )
);

const CASES = FIXTURE.cases;
const CANDIDATES = FIXTURE.candidates;
const REQUEST = FIXTURE.request;

function candidateAt(index) {
  return CANDIDATES[index];
}

test('every fixture case yields its expected class', () => {
  for (const [name, c] of Object.entries(CASES)) {
    const got = classifyFailure(c.text);
    assert.equal(
      got.class,
      c.expect.class,
      name + ' class is ' + c.expect.class
    );
  }
});

test('credit_402 yields requested 32000 and affordable 1305', () => {
  const got = classifyFailure(CASES.credit_402.text);
  assert.equal(got.class, 'CREDIT_BUDGET');
  assert.equal(got.requested, 32000);
  assert.equal(got.affordable, 1305);
});

test('luna is rejected BUDGET_BELOW_REQUEST for a 32000-token request', () => {
  const luna = candidateAt(0);
  const { rejected } = filterEligible([luna], REQUEST);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].candidate, luna);
  assert.equal(rejected[0].reason, 'BUDGET_BELOW_REQUEST');
});

test('luna is not rejected for a 1000-token request', () => {
  const luna = candidateAt(0);
  const { rejected } = filterEligible([luna], { outputTokens: 1000 });
  assert.equal(rejected.length, 0);
});

test('a state on one account never touches another account of the same modelId', () => {
  const modelId = 'gemini-3.8-flash-high';
  const base = {
    routeKind: 'agy-pool',
    source: 'agy-pool',
    harness: 'agy',
    modelId,
  };
  const acctA = Object.assign({}, base, { account: 'acct-A' });
  const acctB = Object.assign({}, base, { account: 'acct-B' });
  const states = { [routeKey(acctA)]: { auth: false } };
  const { eligible, rejected } = filterEligible(
    [acctA, acctB],
    { outputTokens: 1000 },
    states,
    '2026-11-06T10:00:00+07:00'
  );
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].candidate, acctA);
  assert.equal(rejected[0].reason, 'AUTH_FAILED');
  assert.equal(eligible.length, 1);
  assert.equal(eligible[0].account, 'acct-B');
});

test('quota EXHAUSTED and a future cooldown each reject their own route', () => {
  const base = { routeKind: 'model', source: '9router', harness: 'opencode', modelId: 'm' };
  const quota = Object.assign({}, base, { account: 'q' });
  const cooling = Object.assign({}, base, { account: 'c' });
  const states = {
    [routeKey(quota)]: { quota: 'EXHAUSTED' },
    [routeKey(cooling)]: { cooldownUntil: '2026-11-06T11:00:00+07:00' },
  };
  const { eligible, rejected } = filterEligible(
    [quota, cooling],
    { outputTokens: 1000 },
    states,
    '2026-11-06T10:00:00+07:00'
  );
  assert.equal(eligible.length, 0);
  assert.equal(rejected.length, 2);
  assert.equal(rejected[0].reason, 'QUOTA_EXHAUSTED');
  assert.equal(rejected[1].reason, 'COOLDOWN_ACTIVE');
});

test('a cooldown that has already passed leaves the route eligible', () => {
  const c = { routeKind: 'model', source: '9router', harness: 'opencode', modelId: 'm', account: 'c' };
  const states = { [routeKey(c)]: { cooldownUntil: '2026-11-06T09:00:00+07:00' } };
  const { eligible, rejected } = filterEligible(
    [c],
    { outputTokens: 1000 },
    states,
    '2026-11-06T10:00:00+07:00'
  );
  assert.equal(rejected.length, 0);
  assert.equal(eligible.length, 1);
});

test('decide forwards now so a cooled-down account is rejected before ranking', () => {
  const result = decide({
    runId: 'r-now',
    candidates: CANDIDATES,
    request: { outputTokens: 1000 },
    states: {
      [routeKey(CANDIDATES[4])]: { auth: false },
    },
    now: '2026-11-06T10:00:00+07:00',
    scale: 'aa-v5-percentile',
  });
  const rejectedRoutes = result.rejected.map((r) => r.candidate.account);
  assert.ok(rejectedRoutes.includes('acct-A'));
});

test('a right-scale candidate with no numeric score goes to unknown; score 0 stays ranked', () => {
  const noScore = {
    routeKind: 'model',
    source: 's',
    harness: 'h',
    modelId: 'no-score',
    account: null,
    quality: { scale: 'aa-v5-percentile', version: 'v' },
  };
  const zero = {
    routeKind: 'model',
    source: 's',
    harness: 'h',
    modelId: 'zero',
    account: null,
    quality: { scale: 'aa-v5-percentile', score: 0, version: 'v' },
  };
  const { ranked, unknown } = rankByScale([noScore, zero], 'aa-v5-percentile');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].modelId, 'zero');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].modelId, 'no-score');
});

test('scale aa-v5-percentile ranks deepseek then gemini flash; dots and luna go to unknown', () => {
  const { ranked, unknown } = rankByScale(CANDIDATES, 'aa-v5-percentile');
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].modelId, 'deepseek-v4.1-flash');
  assert.equal(ranked[1].modelId, 'gemini-3.8-flash-high');
  const unknownIds = unknown.map((c) => c.modelId);
  assert.ok(unknownIds.includes('openrouter/openai/gpt-5.6-luna'));
  assert.ok(unknownIds.includes('kgw/dots-studio/dots-3-note-preview:free'));
});

test('combo is never chosen; it lands in unknownQuality with null quality', () => {
  const result = decide({
    runId: 'r-1',
    candidates: CANDIDATES,
    request: REQUEST,
    scale: 'aa-v5-percentile',
  });
  assert.notEqual(result.chosen, null);
  assert.notEqual(result.chosen.modelId, 'vinh');
  const combo = result.unknownQuality.find((c) => c.modelId === 'vinh');
  assert.ok(combo, 'combo appears in unknownQuality');
  assert.equal(combo.quality, null);
});

test('decide never moves a score onto the combo', () => {
  const result = decide({
    runId: 'r-2',
    candidates: CANDIDATES,
    request: REQUEST,
    scale: 'aa-v5-percentile',
  });
  const combo = result.unknownQuality.find((c) => c.modelId === 'vinh');
  assert.ok(combo, 'combo is in unknownQuality');
  assert.equal(combo.quality, null, 'combo keeps null quality; no score moved onto it');
  assert.equal(result.chosen.quality.source, 'aa-v5-percentile');
});

test('two AGY accounts stay two routes; modelId and account verbatim in chosen', () => {
  const agy = CANDIDATES.filter((c) => c.source === 'agy-pool');
  assert.equal(agy.length, 2);
  const { ranked } = rankByScale(agy, 'aa-v5-percentile');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].account, 'acct-A');
  assert.equal(ranked[0].modelId, 'gemini-3.8-flash-high');
  const result = decide({
    runId: 'r-3',
    candidates: agy,
    request: { outputTokens: 1000 },
    scale: 'aa-v5-percentile',
  });
  assert.equal(result.chosen.account, 'acct-A');
  assert.equal(result.chosen.modelId, 'gemini-3.8-flash-high');
});

test('no eligible route with the scale gives BLOCKED and no chosen', () => {
  const { ranked } = rankByScale(CANDIDATES, 'aa-v5-percentile');
  assert.ok(ranked.length > 0, 'sanity: fixture has ranked candidates');
  const result = decide({
    runId: 'r-4',
    candidates: CANDIDATES,
    request: REQUEST,
    scale: 'nonexistent-scale',
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.chosen, null);
});

test('same input gives identical output twice', () => {
  const a = decide({
    runId: 'r-5',
    candidates: CANDIDATES,
    request: REQUEST,
    scale: 'aa-v5-percentile',
  });
  const b = decide({
    runId: 'r-5',
    candidates: CANDIDATES,
    request: REQUEST,
    scale: 'aa-v5-percentile',
  });
  assert.deepEqual(a, b);
});