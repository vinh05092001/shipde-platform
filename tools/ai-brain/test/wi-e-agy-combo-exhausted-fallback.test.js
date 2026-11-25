'use strict';

// WI-E: when the 9router combo was read but none of its members is eligible,
// agy-pool members are still offered if that lane is on. A combo that could not
// be read, agy-pool off, or agy-pool also exhausted keep the old fallback.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const combo = require('../combo');
const { parseCandidateKey } = require('../discovery/identity');
const { selectCandidateForProfile } = require('../orchestrate/candidate-select');

function registry(enabled) {
  return {
    dispatch: {
      nineRouterWriterCombo: 'vinh',
      comboSource: '9router',
      agyPoolShortlistEnabled: enabled,
      agyPool: { minHeadroom: 0.15, openHeadroom: 0.4 },
    },
    sources: [
      // The JEV shortlist cap, which a mixed agy-pool shortlist requires.
      { id: 'jev', kind: 'decision-service', servesModels: false, maxOptions: 4 },
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        harness: 'paseo',
        endpoint: 'http://127.0.0.1:20128/v1',
        credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
      },
    ],
  };
}

const PRIORS = {
  ranking: [
    { canonical: 'gpt-5.2', codingTier: 'T1', benchmarks: [{ name: 'aaCodingIndex', score: 80 }] },
    {
      canonical: 'claude-opus-5.5',
      codingTier: 'T1',
      benchmarks: [{ name: 'aaCodingIndex', score: 90 }],
    },
  ],
};

function snapshot(claude) {
  return {
    groups: [
      {
        name: 'Claude and GPT models',
        description: 'Models within this group: Claude Opus 5.5',
        buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: claude }],
      },
    ],
  };
}
const QUOTA = { agy02: snapshot(0.85), agy03: snapshot(0.3) };
const ENV = { NINEROUTER_API_KEY: 'test-key' };
const MEMBER = 'gh/gpt-5.2-high';

async function firstOption(question) {
  return { choice: question.options[0], confidence: 0.9, reason: 'fixture' };
}

async function select({ failedKeys = [], enabled = true, comboRead = 'ok', item = {} }) {
  const reg = registry(enabled);
  const pool = [combo.comboCandidate({ registry: reg, env: ENV }).candidate];
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-wi-e-'));
  const source =
    comboRead === 'ok'
      ? { comboMembers: [MEMBER] }
      : {
          readComboConfig: async () => ({
            name: 'vinh',
            members: null,
            state: 'COMBO_CONFIG_UNAVAILABLE',
          }),
        };
  try {
    return await selectCandidateForProfile(
      { id: 'TASK-WI-E', complexity: 'high', risk: 'HIGH', allowedPaths: ['a.js'], ...item },
      pool,
      [],
      {},
      {
        registry: reg,
        env: ENV,
        priors: PRIORS,
        agyPoolOptions: { quotaSnapshots: QUOTA },
        jevAsk: firstOption,
        ...source,
      },
      { dir: logDir, now: Date.UTC(2026, 10, 24), runId: 'test-wi-e' },
      Date.UTC(2026, 10, 24),
      { failedKeys: new Set(failedKeys) }
    );
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
}

const harnessOf = (decision) =>
  decision.chosen ? (parseCandidateKey(decision.chosen) || {}).harness : null;
const accountOf = (decision) =>
  harnessOf(decision) === 'agy-pool' ? parseCandidateKey(decision.chosen).account : null;

// The 9router member's own candidate key, as the selection builds it.
async function memberKey() {
  const decision = await select({ enabled: false });
  assert.notEqual(harnessOf(decision), 'agy-pool');
  return decision.chosen;
}

test('WI-E: with every 9router member failed, an agy-pool member is selected', async () => {
  const decision = await select({ failedKeys: [await memberKey()] });
  assert.equal(harnessOf(decision), 'agy-pool');
  assert.equal(accountOf(decision), 'agy02');
});

test('WI-E: with the agy flag off the old fallback is unchanged', async () => {
  const failedKeys = [await memberKey()];
  const off = await select({ failedKeys, enabled: false });
  assert.notEqual(harnessOf(off), 'agy-pool');
});

test('WI-E: a combo that could not be read does not open the agy lane', async () => {
  const unread = await select({ comboRead: 'unavailable' });
  const unreadOff = await select({ comboRead: 'unavailable', enabled: false });
  assert.notEqual(harnessOf(unread), 'agy-pool');
  assert.equal(unread.chosen, unreadOff.chosen);
  assert.equal(unread.reason, unreadOff.reason);
});

test('WI-E: with agy-pool exhausted too the result equals the flag-off fallback', async () => {
  const member = await memberKey();
  const failedKeys = [
    member,
    'account-exhausted::agy-pool::agy02',
    'account-exhausted::agy-pool::agy03',
  ];
  const on = await select({ failedKeys });
  const off = await select({ failedKeys, enabled: false });
  assert.equal(on.chosen, off.chosen);
  assert.equal(on.reason, off.reason);
});

test('WI-E: WI-D exclusions still apply on the agy-only path', async () => {
  const member = await memberKey();
  const first = await select({ failedKeys: [member] });
  const next = await select({ failedKeys: [member, first.chosen] });
  assert.equal(accountOf(next), 'agy03');
});

test('WI-E: a reviewer refusal keeps its reason when agy-pool is exhausted too', async () => {
  const writer = await memberKey();
  const reviewer = { roleRequirement: { role: 'reviewer' }, writerCandidateKey: writer };
  const failedKeys = ['account-exhausted::agy-pool::agy02', 'account-exhausted::agy-pool::agy03'];
  const on = await select({ item: reviewer, failedKeys });
  const off = await select({ item: reviewer, failedKeys, enabled: false });
  assert.equal(off.chosen, null);
  assert.equal(off.reason, 'NO_INDEPENDENT_REVIEWER');
  assert.equal(on.chosen, off.chosen);
  assert.equal(on.reason, off.reason);
});
