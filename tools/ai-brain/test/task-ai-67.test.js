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

test('Defect 3: stale reservation reclaimed after documented TTL (2h), 30min stays busy', () => {
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
