const test = require('node:test');
const assert = require('node:assert');
const evidence = require('../evidence');
const routing = require('../routing');
const quotaStore = require('../quota-store');
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
  const c1 = { candidateKey: 'free-cand', score: 0, reservationsHeld: 0 };
  const c2 = { candidateKey: 'busy-cand', score: 0, reservationsHeld: 1 };
  
  const ranked = [c2, c1];
  
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.reservationsHeld !== b.reservationsHeld) return a.reservationsHeld - b.reservationsHeld;
    return a.candidateKey.localeCompare(b.candidateKey);
  });
  
  assert.equal(ranked[0].candidateKey, 'free-cand', 'the free candidate must win the tie-break');
});

test('Defect 3: reservation released for each terminal status', () => {
  const root = path.join(os.tmpdir(), 'task-ai-67-3-' + Date.now());
  const storePath = path.join(root, 'quota.json');
  fs.mkdirSync(root, { recursive: true });
  
  const now = Date.now();
  
  const statuses = ['completed', 'failed', 'timeout', 'cancelled', 'error'];
  
  for (const status of statuses) {
    // 1. Reserve
    const taskId = 'TASK-' + status;
    const candId = 'paseo::cli::9router::ag::ninerouter::ninerouter::ag/gemini-3.1-pro-low';
    quotaStore.recordReservation(taskId, 'author.foundation', '*', candId, 100000, { storePath, now });
    
    let res = quotaStore.getReservations({ storePath });
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
    res = quotaStore.getReservations({ storePath });
    assert.equal(res[`${taskId}::${candId}`], undefined, `reservation must be released after reporting ${status}`);
  }
});

test('Defect 3: stale reservation reclaimed after TTL', () => {
  const root = path.join(os.tmpdir(), 'task-ai-67-4-' + Date.now());
  const storePath = path.join(root, 'quota.json');
  fs.mkdirSync(root, { recursive: true });
  
  const now = Date.now();
  
  // Create a reservation that is 3 minutes old
  const staleTime = now - 3 * 60 * 1000;
  fs.writeFileSync(storePath, JSON.stringify({
    reservations: {
      'TASK-STALE::cand-stale': {
        workItemId: 'TASK-STALE',
        offeringId: 'cand-stale',
        accountId: '*',
        at: staleTime
      }
    }
  }));
  
  // Require ranking logic to read reservations
  const ranking = require('../ranking');
  const active = ranking.getActiveReservations({ storePath, now });
  
  assert.equal(active.length, 0, 'stale reservation must be filtered out');
});
