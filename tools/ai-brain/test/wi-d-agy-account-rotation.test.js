'use strict';

// WI-D: within one run, an agy-pool account that failed is skipped. The same
// model moves to its next eligible account; with none left it drops out and the
// selection falls back to 9router. Failures from another run never exclude.

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
      jev: { maxOptions: 4 },
    },
    sources: [
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
    {
      canonical: 'claude-sonnet-5.5',
      codingTier: 'T2',
      benchmarks: [{ name: 'aaCodingIndex', score: 70 }],
    },
  ],
};

function snapshot(claude) {
  return {
    groups: [
      {
        name: 'Claude and GPT models',
        description: 'Models within this group: Claude Opus 5.5, Claude Sonnet 5.5',
        buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: claude }],
      },
    ],
  };
}
// agy02 has the most headroom, so it is the model's first account.
const QUOTA = { agy02: snapshot(0.85), agy03: snapshot(0.3) };
const ENV = { NINEROUTER_API_KEY: 'test-key' };

// JEV picks an offered agy-pool member (best score, or worst with pickAgyLowest),
// otherwise the first option. Scores tell the two agy models apart.
function agyPicker(lowest) {
  return async (question) => {
    const members = (JSON.parse(question.evidence).members || []).filter((m) => m.headroomStatus);
    members.sort((a, b) => (lowest ? a.score - b.score : b.score - a.score));
    const choice = members.length ? members[0].option : question.options[0];
    return { choice, confidence: 0.9, reason: 'fixture' };
  };
}
const pickAgy = agyPicker(false);
const pickAgyLowest = agyPicker(true);

async function select({ failedKeys = [], enabled = true, evidenceData = {}, jevAsk = pickAgy }) {
  const reg = registry(enabled);
  const pool = [combo.comboCandidate({ registry: reg, env: ENV }).candidate];
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-wi-d-'));
  try {
    const decision = await selectCandidateForProfile(
      { id: 'TASK-WI-D', complexity: 'high', risk: 'HIGH', allowedPaths: ['a.js'] },
      pool,
      [],
      evidenceData,
      {
        registry: reg,
        env: ENV,
        priors: PRIORS,
        comboMembers: ['gh/gpt-5.2-high'],
        agyPoolOptions: { quotaSnapshots: QUOTA },
        jevAsk,
      },
      { dir: logDir, now: Date.UTC(2026, 10, 24), runId: 'test-wi-d' },
      Date.UTC(2026, 10, 24),
      { failedKeys: new Set(failedKeys) }
    );
    return decision;
  } finally {
    fs.rmSync(logDir, { recursive: true, force: true });
  }
}

const accountOf = (decision) => {
  const parsed = parseCandidateKey(decision.chosen);
  return parsed && parsed.harness === 'agy-pool' ? parsed.account : null;
};

test('WI-D: the first choice uses the agy account with the most headroom', async () => {
  const decision = await select({});
  assert.equal(accountOf(decision), 'agy02');
});

test('WI-D: a failed agy account moves the same model to the next eligible account', async () => {
  const first = await select({});
  const second = await select({ failedKeys: [first.chosen] });
  assert.equal(accountOf(second), 'agy03');
  assert.equal(parseCandidateKey(second.chosen).modelId, parseCandidateKey(first.chosen).modelId);
});

test('WI-D: an account-exhausted mark excludes that account too', async () => {
  const decision = await select({ failedKeys: ['account-exhausted::agy-pool::agy02'] });
  assert.equal(accountOf(decision), 'agy03');
});

test('WI-D: with every eligible account failed the model drops out and 9router is chosen', async () => {
  const decision = await select({
    failedKeys: ['account-exhausted::agy-pool::agy02', 'account-exhausted::agy-pool::agy03'],
  });
  assert.ok(decision.chosen);
  assert.equal(accountOf(decision), null);
  assert.notEqual(parseCandidateKey(decision.chosen).harness, 'agy-pool');
});

test('WI-D: a failure recorded by another run does not exclude the account', async () => {
  const first = await select({});
  const otherRun = {
    cooldowns: {
      [first.chosen]: { lastStatus: 'blocked', failCount: 3, cause: 'QUOTA_EXHAUSTED' },
    },
  };
  const decision = await select({ evidenceData: otherRun });
  assert.equal(accountOf(decision), 'agy02');
});

test('WI-D: with the agy flag off, failed agy keys change nothing', async () => {
  const asked = [];
  const record = async (question) => {
    asked.push(question.options);
    return { choice: question.options[0], confidence: 0.9, reason: 'fixture' };
  };
  const plain = await select({ enabled: false, jevAsk: record });
  const withFailures = await select({
    enabled: false,
    jevAsk: record,
    failedKeys: ['account-exhausted::agy-pool::agy02'],
  });
  assert.equal(withFailures.chosen, plain.chosen);
  assert.deepEqual(asked[1], asked[0]);
  assert.equal(accountOf(plain), null, 'no agy-pool member is offered while the flag is off');
});

const modelOf = (decision) => parseCandidateKey(decision.chosen).modelId;

test('WI-D: a failed model on an account leaves the other model on that account', async () => {
  const opus = await select({});
  const sonnet = await select({ jevAsk: pickAgyLowest });
  assert.notEqual(modelOf(opus), modelOf(sonnet));
  assert.equal(accountOf(sonnet), 'agy02');

  const opusAgain = await select({ failedKeys: [opus.chosen] });
  assert.equal(modelOf(opusAgain), modelOf(opus));
  assert.equal(accountOf(opusAgain), 'agy03');

  const sonnetAgain = await select({ failedKeys: [opus.chosen], jevAsk: pickAgyLowest });
  assert.equal(modelOf(sonnetAgain), modelOf(sonnet));
  assert.equal(
    accountOf(sonnetAgain),
    'agy02',
    'a failed Opus key does not exclude Sonnet on agy02'
  );
});

test('WI-D: an account-exhausted mark excludes every model on that account', async () => {
  const failedKeys = ['account-exhausted::agy-pool::agy02'];
  assert.equal(accountOf(await select({ failedKeys })), 'agy03');
  assert.equal(accountOf(await select({ failedKeys, jevAsk: pickAgyLowest })), 'agy03');
});
