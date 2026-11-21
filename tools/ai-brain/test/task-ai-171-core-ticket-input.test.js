'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dispatchCommand } = require('../cli');

const source = {
  id: 'jev',
  kind: 'decision-service',
  endpoint: 'https://fixture.invalid/ask',
  model: 'fixture-model',
  credential: { env: 'FIXTURE_JEV_KEY' },
};
const env = { FIXTURE_JEV_KEY: 'test-not-a-key' };

const candidate = (id) => ({
  harness: 'paseo',
  gateway: 'fixture',
  accessPath: 'fixture',
  upstream: 'fixture',
  accountId: id,
  quotaScope: id,
  modelId: id,
  quality: 80,
  cost: 1,
  latencyMs: 100,
  evidence: [{ status: 'passed' }],
});

const answer = (key, choice) => ({
  answers: { [key]: { type: 'choice', choice, confidence: 0.95 } },
  usage: { input_tokens: 8, output_tokens: 2, raw: 'private fixture text' },
});

function createDeps(dir, extra = {}) {
  const routeHealthFile = path.join(dir, 'model-route-health.json');
  return {
    candidates: [candidate('route-a'), candidate('route-b')],
    registry: { sources: [source], dispatch: { providers: {} } },
    accounts: [],
    env,
    home: dir,
    rootDir: dir,
    evidenceDir: path.join(dir, 'evidence'),
    routeHealthFile,
    routeHealth: require('../route-health').loadStore(routeHealthFile, { allowMissing: true }),
    storePath: path.join(dir, 'quota.json'),
    decisionDir: path.join(dir, 'decisions'),
    priors: { ranking: [] },
    reservations: [],
    headrooms: {},
    probeCapabilities: async () => {},
    log: () => {},
    error: () => {},
    exit: () => {},
    ...extra,
  };
}

test('(a) two different tickets produce different profiles and fake JEV receives ticket text/AC', async (t) => {
  const dir = fs.mkdtempSync(path.join(__dirname, 'core-ticket-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const smallPath = path.join(dir, 'ticket-small.md');
  fs.writeFileSync(
    smallPath,
    '# FIX-01 — Fixture\nGOAL (AC): Update fixture\nALLOWED FILES: fixture.json\nFORBIDDEN: src/',
    'utf8'
  );

  const riskyPath = path.join(dir, 'ticket-risky.md');
  fs.writeFileSync(
    riskyPath,
    '# FEAT-99 — Auth\nGOAL (AC): Enforce tenant isolation and secret auth\nALLOWED FILES: a.js, b.js, c.js\nFORBIDDEN: cfg/',
    'utf8'
  );

  const jevCalls = [];
  const fakeJevAsk = async (payload) => {
    jevCalls.push(payload);
    return answer('weightProfile', 'BALANCED');
  };

  const resSmall = await dispatchCommand(
    { ticket: smallPath, 'dry-run': true, json: true },
    createDeps(dir, { jevAsk: fakeJevAsk })
  );
  const resRisky = await dispatchCommand(
    { ticket: riskyPath, 'dry-run': true, json: true },
    createDeps(dir, { jevAsk: fakeJevAsk })
  );

  assert.equal(jevCalls.length, 2);
  assert.ok(
    jevCalls[0].evidence.includes('fixture') || jevCalls[0].state.ticketText?.includes('FIX-01')
  );
  assert.ok(
    jevCalls[1].prompt.includes('auth') || jevCalls[1].state.ticketText?.includes('FEAT-99')
  );

  const pSmall = resSmall.decision?.profile || resSmall.profile;
  const pRisky = resRisky.decision?.profile || resRisky.profile;
  assert.equal(pSmall.complexity, 'standard');
  assert.equal(pRisky.complexity, 'standard');
  assert.notDeepEqual(pSmall.riskDomains, pRisky.riskDomains);
  assert.ok(pRisky.riskDomains.length > 0);
  assert.notDeepEqual(pSmall.allowedFiles, pRisky.allowedFiles);
  assert.notDeepEqual(pSmall.forbiddenFailureDomains, pRisky.forbiddenFailureDomains);
});
