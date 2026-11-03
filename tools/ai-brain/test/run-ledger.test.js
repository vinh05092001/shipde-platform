'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RunLedger, maskCredentials, Cause } = require('../run-ledger');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'run-ledger-test-'));

test('chain writer->review->repair->review computes correct total spent and links', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', { itemId: 'TASK-1', decisionId: 'd1', jobId: 'j1', attemptId: 'a1', launch: 10, exit: 0, reviewSha: 'sha-w1', verdict: 'DONE', ms: 1200, tokens: 500 });
  const r2 = ledger.record('review', { itemId: 'TASK-1', decisionId: 'd2', jobId: 'j2', attemptId: 'a2', launch: 20, exit: 0, reviewSha: 'sha-w1', verdict: 'CHANGES_REQUIRED', ms: 800, tokens: 300 });
  const r3 = ledger.record('repair', { itemId: 'TASK-1', decisionId: 'd3', jobId: 'j3', attemptId: 'a3', launch: 30, exit: 0, reviewSha: 'sha-w2', verdict: 'DONE', ms: 1500, tokens: 700 });
  const r4 = ledger.record('reviewer', { itemId: 'TASK-1', decisionId: 'd4', jobId: 'j4', attemptId: 'a4', launch: 40, exit: 0, reviewSha: 'sha-w2', verdict: 'PASS', ms: 600, tokens: 200 });

  assert.equal(r1.ok && r2.ok && r3.ok && r4.ok, true);
  const spent = ledger.getSummary('TASK-1');
  assert.equal(spent.attempts, 4);
  assert.equal(spent.ms, 4100);
  assert.equal(spent.tokens, 1700);

  const chain = ledger.getChain('TASK-1');
  assert.equal(chain.length, 4);
  assert.deepEqual(chain.map((c) => [c.decisionId, c.attemptId, c.reviewSha, c.verdict]), [
    ['d1', 'a1', 'sha-w1', 'DONE'], ['d2', 'a2', 'sha-w1', 'CHANGES_REQUIRED'],
    ['d3', 'a3', 'sha-w2', 'DONE'], ['d4', 'a4', 'sha-w2', 'PASS'],
  ]);
});

test('missing tokens yields UNKNOWN, tokenEnforcement UNENFORCED, no zero or money conversion', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const res = ledger.record('writer', { itemId: 'TASK-2', ms: 300 });
  assert.equal(res.ok, true);
  assert.equal(res.run.tokens, 'UNKNOWN');
  assert.equal(res.run.tokenEnforcement, 'UNENFORCED');
  assert.equal('cost' in res.run || 'price' in res.run || 'vnd' in res.run, false);

  const summary = ledger.getSummary('TASK-2');
  assert.equal(summary.tokens, 0);
  assert.equal(summary.tokensUnknown, 1);
});

test('exceeding attempt or deadline budget cap refuses admission and record', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json'), limits: { item: { attempts: 2, ms: 2000, tokens: 100 } } });
  assert.equal(ledger.record('writer', { itemId: 'TASK-3', ms: 500 }).ok, true);
  assert.equal(ledger.record('review', { itemId: 'TASK-3', ms: 600 }).ok, true);

  const aOver = ledger.admit('repair', { itemId: 'TASK-3' });
  assert.equal(aOver.ok, false);
  assert.equal(aOver.cause, Cause.ATTEMPTS_EXHAUSTED);

  const rOver = ledger.record('repair', { itemId: 'TASK-3', ms: 100 });
  assert.equal(rOver.ok, false);
  assert.equal(rOver.cause, Cause.ATTEMPTS_EXHAUSTED);

  const ledger2 = new RunLedger({ file: path.join(tmpDir(), 'ledger2.json'), limits: { item: { ms: 1000 } } });
  ledger2.record('writer', { itemId: 'TASK-3', ms: 1200 });
  assert.equal(ledger2.admit('review', { itemId: 'TASK-3' }).cause, Cause.TIME_EXHAUSTED);
});

test('retryLayer pipeline|cli|gateway counts attempt once across layers', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  ledger.record('writer', { itemId: 'TASK-4', attemptId: 'att-x', retryLayer: 'gateway', ms: 100 });
  ledger.record('writer', { itemId: 'TASK-4', attemptId: 'att-x', retryLayer: 'cli', ms: 200 });
  ledger.record('writer', { itemId: 'TASK-4', attemptId: 'att-x', retryLayer: 'pipeline', ms: 300 });

  const spent = ledger.getSummary('TASK-4');
  assert.equal(spent.attempts, 1);
  assert.equal(spent.ms, 600);

  const runs = ledger.getRuns('TASK-4');
  assert.deepEqual(runs.map((r) => r.retryLayer), ['gateway', 'cli', 'pipeline']);
  assert.throws(() => ledger.record('writer', { itemId: 'TASK-4', retryLayer: 'unknown' }), /invalid retryLayer/);
});

test('route identity masks credentials', () => {
  const masked = maskCredentials({
    provider: 'anthropic', apiKey: 'sk-ant-api03-abcdefghijklmn', secret: 'mysecret',
    token: 'jwt.token.here', endpoint: 'https://user:pass123@api.anthropic.com/v1',
  });
  assert.equal(masked.apiKey, '[REDACTED]');
  assert.equal(masked.secret, '[REDACTED]');
  assert.equal(masked.token, '[REDACTED]');
  assert.equal(masked.endpoint, 'https://user:***@api.anthropic.com/v1');
  assert.equal(masked.provider, 'anthropic');
});

test('no file writes outside os.tmpdir()', () => {
  const dir = tmpDir();
  const ledger = new RunLedger({ file: path.join(dir, 'sub', 'ledger.json') });
  ledger.record('writer', { itemId: 'TASK-5', ms: 50 });

  const normTmp = os.tmpdir().toLowerCase().replace(/\\/g, '/');
  const checkDir = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name).replace(/\\/g, '/').toLowerCase();
      assert.equal(p.startsWith(normTmp), true);
      if (entry.isDirectory()) checkDir(path.join(d, entry.name));
    }
  };
  checkDir(dir);
});
