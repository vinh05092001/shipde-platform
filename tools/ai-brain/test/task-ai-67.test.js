const test = require('node:test');
const assert = require('node:assert');
const evidence = require('../evidence');
const routing = require('../routing');
const quotaStore = require('../quota-store');
const ranking = require('../ranking');
const os = require('os');
const path = require('path');
const fs = require('fs');

test('Defect 1: cooldown honoured on first ranking', () => {
  const dir = path.join(os.tmpdir(), 'task-ai-67-1-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });

  const candidate = {
    harness: 'paseo', accessPath: 'cli', gateway: '9router', upstream: 'gcli',
    accountId: 'ninerouter', quotaScope: 'ninerouter', modelId: 'grok-4.7'
  };

  const now = new Date('2026-10-01T20:00:00.000Z');
  const future = new Date('2026-10-01T23:27:00.000Z');

  evidence.recordOutcome(dir, candidate, {
    status: 'failed',
    exitCode: 1,
    body: 'credit exhausted',
    cooldownUntil: future.toISOString(),
  });

  const loaded = evidence.loadEvidence(dir);
  const checkTime = now.getTime() + 1.5 * 60 * 60 * 1000;

  const isBlocked = evidence.isCandidateBlocked(loaded, candidate, { now: checkTime });
  assert.equal(isBlocked.blocked, true, 'candidate should still be blocked due to explicit cooldownUntil');
});

test('Defect 2: busy candidate demoted below an idle equal candidate', () => {
  const c1 = {
    harness: 'paseo', accessPath: 'cli', gateway: '9router',
    upstream: 'gcli', accountId: 'free-cand', quotaScope: 'free-cand', modelId: 'grok-4.7', quality: 50
  };
  const c2 = {
    harness: 'paseo', accessPath: 'cli', gateway: '9router',
    upstream: 'gcli', accountId: 'busy-cand', quotaScope: 'busy-cand', modelId: 'grok-4.7', quality: 50
  };

  const profile = { qualityFloor: 0, proofFloor: 'NONE' };

  const root = path.join(os.tmpdir(), 'task-ai-67-2-' + Date.now());
  fs.mkdirSync(root, { recursive: true });
  const storePath = path.join(root, 'quota.json');
  const now = Date.now();

  // Create a running reservation for busy-cand (30 minutes old)
  quotaStore.recordReservation('TASK-BUSY', 'author.foundation', 'busy-cand', 'paseo::cli::9router::gcli::busy-cand::busy-cand::grok-4.7', 100000, { path: storePath, now: now - 30 * 60 * 1000 });

  const d = { storePath, now, candidates: [c2, c1] };
  const assessment = { weightProfile: 'balanced', weights: { quality: 50, latency: 50, cost: 0 } };

  const result = routing.rankForProfile(d.candidates, profile, assessment, d);
  assert.equal(result.top3[0].candidateKey, 'paseo::cli::9router::gcli::free-cand::free-cand::grok-4.7', 'the free candidate must win the tie-break against the busy candidate');
  assert.equal(result.top3[1].candidateKey, 'paseo::cli::9router::gcli::busy-cand::busy-cand::grok-4.7');
});

test('Defect 3: reservation released for each terminal status', () => {
  const root = path.join(os.tmpdir(), 'task-ai-67-3-' + Date.now());
  const storePath = path.join(root, 'quota.json');
  fs.mkdirSync(root, { recursive: true });

  const now = Date.now();

  const statuses = ['completed', 'failed', 'timeout', 'cancelled', 'error'];

  for (const status of statuses) {
    const taskId = 'TASK-' + status;
    const candId = 'paseo::cli::9router::ag::ninerouter::ninerouter::ag/gemini-3.1-pro-low';

    // 1. Reserve via the real execution path logic
    quotaStore.recordReservation(taskId, 'author.foundation', '*', candId, 100000, { path: storePath, now });

    let res = quotaStore.getReservations({ path: storePath });
    assert.equal(res[`${taskId}::${candId}`] !== undefined, true, `reservation must be held before reporting ${status}`);

    // 2. Report terminal outcome
    const outcomePath = path.join(root, `outcome-${status}.json`);
    fs.writeFileSync(outcomePath, JSON.stringify({
      status,
      candidateKey: candId,
      taskId
    }));

    routing.reportDispatchOutcome(
      { root, 'report-outcome': `outcome-${status}.json` },
      { storePath, evidenceDir: root, now, log: () => {}, exit: () => {} }
    );

    // 3. Verify reservation is released
    res = quotaStore.getReservations({ path: storePath });
    assert.equal(res[`${taskId}::${candId}`], undefined, `reservation must be released after reporting ${status}`);
  }
});

test('Defect 4: stale reservation reclaimed after documented TTL (2h), 30min stays busy', () => {
  const root = path.join(os.tmpdir(), 'task-ai-67-4-' + Date.now());
  const storePath = path.join(root, 'quota.json');
  fs.mkdirSync(root, { recursive: true });

  const now = Date.now();

  // 1. Create a reservation that is 30 minutes old (running lane)
  const busyTime = now - 30 * 60 * 1000;
  // 2. Create a reservation that is 3 hours old (crashed/expired)
  const staleTime = now - 3 * 60 * 60 * 1000;

  fs.writeFileSync(storePath, JSON.stringify({
    accounts: {},
    reservations: {
      'TASK-BUSY::cand-busy': {
        workItemId: 'TASK-BUSY',
        offeringId: 'cand-busy',
        accountId: '*',
        at: busyTime
      },
      'TASK-STALE::cand-stale': {
        workItemId: 'TASK-STALE',
        offeringId: 'cand-stale',
        accountId: '*',
        at: staleTime
      }
    }
  }));

  const active = ranking.getActiveReservations({ storePath, now });

  const hasBusy = active.some(r => r.workItemId === 'TASK-BUSY');
  const hasStale = active.some(r => r.workItemId === 'TASK-STALE');

  assert.equal(hasBusy, true, 'a 30-minute running lane must stay busy and not be reclaimed');
  assert.equal(hasStale, false, 'a crashed reservation exceeding the 2h TTL must be reclaimed');
});

test('Defect 5: REAL cli.js dispatchCommand with --execute then --report-outcome', async () => {
  const root = path.join(os.tmpdir(), 'task-ai-67-5-' + Date.now());
  const home = path.join(root, 'home');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const originalHomedir = os.homedir;
  os.homedir = () => home;

  try {
    const cli = require('../cli');
    const taskId = 'TASK-REAL-CLI';
    const candId = 'paseo::cli::9router::gcli::acct-1::acct-1::grok-4.7';

    const profile = {
      taskId: taskId,
      role: 'writer',
      complexity: 'high',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      contextSize: 1000,
      expectedDuration: 100,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 10,
      forbiddenFailureDomains: [],
      resourceCeiling: 100,
      currentWorkload: 0
    };
    const profilePath = path.join(root, 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify(profile));

    const decisionDir = path.join(root, 'decisions');
    fs.mkdirSync(decisionDir, { recursive: true });

    let exitCode = null;
    await cli.dispatchCommand({
      profile: profilePath,
      execute: true,
      'decision-dir': decisionDir,
      root: root
    }, {
      exit: (code) => { exitCode = code; },
      log: () => {},
      error: () => {},
      candidates: [{
        candidateKey: candId,
        harness: 'paseo', accessPath: 'cli', gateway: '9router', upstream: 'gcli',
        accountId: 'acct-1', quotaScope: 'acct-1', modelId: 'grok-4.7',
        quality: 50, cost: 0.1, contextWindow: 32000, capabilities: []
      }],
      ask: async () => ({ decision: null })
    });

    const quotaStore = require('../quota-store');
    const storePath = path.join(home, '.shipde', 'agy-quota.json');
    let res = quotaStore.getReservations({ path: storePath });
    assert.equal(res[`${taskId}::${candId}`] !== undefined, true, 'reservation must be created in HOME');

    const outcomePath = path.join(root, 'outcome-completed.json');
    fs.writeFileSync(outcomePath, JSON.stringify({
      status: 'COMPLETED',
      candidateKey: candId,
      taskId: taskId
    }));

    await cli.dispatchCommand({
      'report-outcome': outcomePath,
      root: root
    }, {
      exit: (code) => { exitCode = code; },
      log: () => {},
      error: () => {}
    });

    res = quotaStore.getReservations({ path: storePath });
    assert.equal(res[`${taskId}::${candId}`], undefined, 'reservation must be released from HOME');

    assert.equal(fs.existsSync(path.join(root, '.slate')), false, '.slate should not be created');
  } finally {
    os.homedir = originalHomedir;
  }
});

test('Defect 6: resetTime is honoured at upstream scope', () => {
  const dir = path.join(os.tmpdir(), 'task-ai-67-6-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });

  const candidate = {
    harness: 'paseo', accessPath: 'cli', gateway: '9router', upstream: 'gcli',
    accountId: 'ninerouter', quotaScope: 'ninerouter', modelId: 'grok-4.7'
  };

  const now = new Date('2026-10-01T20:00:00.000Z');
  const future = new Date('2026-10-01T23:00:00.000Z');

  evidence.recordOutcome(dir, candidate, {
    status: 'failed',
    exitCode: 1,
    httpStatus: 429,
    body: 'rate limit exceeded',
    cooldownUntil: future.toISOString(),
  });

  const loaded = evidence.loadEvidence(dir);

  assert.equal(loaded.upstreamStatus['gcli'].resetTime, future.getTime(), 'upstream scope must inherit explicit resetTime');

  const blocked = evidence.isCandidateBlocked(loaded, candidate, { now: now.getTime() });
  assert.equal(blocked.blocked, true, 'candidate must be blocked');

  const later = new Date('2026-10-01T21:00:00.000Z').getTime();
  const blockedLater = evidence.isCandidateBlocked(loaded, candidate, { now: later });
  assert.equal(blockedLater.blocked, true, 'candidate must remain blocked according to explicit resetTime');
});
