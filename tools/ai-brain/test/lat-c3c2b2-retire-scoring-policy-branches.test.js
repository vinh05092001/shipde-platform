'use strict';

// Lat C-3c-2b-ii: nothing produces assessment.scoringPolicy since the policy module was
// retired, so ranking.js and routing.js no longer read it. Residual: cli/dispatch-helpers.js
// buildDryRunLog still copies scoringPolicyStatus and is retired separately (C-3c-2b-iii).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RETIRED = [
  'scoringPolicy',
  'scoringPolicyStatus',
  'scoreMeasurements',
  'SCORING_INPUTS_UNVERIFIED',
  'profile-measurements',
];

test('Lat C-3c-2b-ii: ranking.js and routing.js no longer read the retired scoring policy', () => {
  const offenders = [];
  for (const file of ['ranking.js', 'routing.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const name of RETIRED) if (src.includes(name)) offenders.push(file + ': ' + name);
  }
  assert.deepEqual(offenders, []);
  assert.equal(require('../routing').scoreMeasurements, undefined);
});

test('Lat C-3c-2b-ii: a leftover scoringPolicy field no longer changes ranking', () => {
  const routing = require('../routing');
  const now = Date.parse('2026-11-01T12:00:00.000Z');
  const row = (modelId, quality) => ({
    harness: 'opencode-direct',
    accessPath: 'cli',
    gateway: 'gw',
    upstream: modelId.split('/')[0],
    accountId: 'acc',
    quotaScope: 'acc',
    modelId,
    quality,
    contextWindow: 128000,
    cost: 5,
    latency: 500,
    qualifiedRoles: ['researcher'],
    evidence: [],
  });
  const profile = {
    taskId: 'T',
    role: 'researcher',
    proofFloor: 'NONE',
    requiredCapabilities: [],
    qualityFloor: 70,
    contextSize: 1,
    costCeiling: 100,
  };
  const ctx = { now, loadQuotaState: false, useStoredQuota: false, quotaState: {}, profile };
  const rows = [row('a/low', 15), row('b/high', 85), row('c/unknown', null)];
  const plain = routing.rankForProfile(structuredClone(rows), profile, {}, ctx);
  const stale = routing.rankForProfile(
    structuredClone(rows),
    profile,
    { scoringPolicy: { version: 'stale', dimensions: { quality: { weight: 1 } } } },
    ctx
  );
  assert.equal(plain.chosen, stale.chosen);
  assert.deepEqual(
    stale.ranking.map((c) => [c.modelId, c.score]),
    plain.ranking.map((c) => [c.modelId, c.score])
  );
  assert.ok(plain.rejected.some((r) => r.reasonCode === 'QUALITY_FLOOR_NOT_MET'));
});
