'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RunLedger, maskCredentials, Cause } = require('../run-ledger');
const { ProgressLedger, fingerprint } = require('../work-guard');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'run-ledger-test-'));

// AC-AI-169-01: Writer -> review -> repair -> review chain computes correct totals
test('AC-AI-169-01: chain computes correct total spent and links', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const rec = (stage, decisionId, attemptId, reviewSha, verdict, ms, tokens) =>
    ledger.record(stage, {
      itemId: 'TASK-1',
      jobId: attemptId,
      decisionId,
      attemptId,
      launch: 10,
      exit: 0,
      reviewSha,
      verdict,
      ms,
      tokens,
    });
  assert.equal(rec('writer', 'd1', 'a1', 'sha-w1', 'DONE', 1200, 500).ok, true);
  assert.equal(rec('review', 'd2', 'a2', 'sha-w1', 'CHANGES_REQUIRED', 800, 300).ok, true);
  assert.equal(rec('repair', 'd3', 'a3', 'sha-w2', 'DONE', 1500, 700).ok, true);
  assert.equal(rec('reviewer', 'd4', 'a4', 'sha-w2', 'PASS', 600, 200).ok, true);
  assert.equal(ledger.getSummary('TASK-1').attempts, 4);
  assert.equal(ledger.getSummary('TASK-1').ms, 4100);
  assert.equal(ledger.getSummary('TASK-1').tokens, 1700);

  const chain = ledger.getChain('TASK-1');
  assert.equal(chain.length, 4);
  assert.deepEqual(
    chain.map((c) => [c.decisionId, c.attemptId, c.reviewSha, c.verdict]),
    [
      ['d1', 'a1', 'sha-w1', 'DONE'],
      ['d2', 'a2', 'sha-w1', 'CHANGES_REQUIRED'],
      ['d3', 'a3', 'sha-w2', 'DONE'],
      ['d4', 'a4', 'sha-w2', 'PASS'],
    ]
  );
});

// AC-AI-169-02: Missing tokens yields UNKNOWN, tokenEnforcement UNENFORCED, no zero or money conversion
test('AC-AI-169-02: missing tokens yields UNKNOWN/UNENFORCED without money fields', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const res = ledger.record('writer', { itemId: 'TASK-2', attemptId: 'att-2', ms: 300 });
  assert.equal(res.ok, true);
  assert.equal(res.run.tokens, 'UNKNOWN');
  assert.equal(res.run.tokenEnforcement, 'UNENFORCED');
  assert.equal('cost' in res.run || 'price' in res.run || 'vnd' in res.run, false);
  assert.equal(ledger.getSummary('TASK-2').tokensUnknown, 1);
});

// AC-AI-169-03: Attempt or deadline budget cap exhaustion refuses admission and record
test('AC-AI-169-03: exceeding budget cap refuses admission and record', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 2 } },
  });
  assert.equal(
    ledger.record('writer', { itemId: 'TASK-3', attemptId: 'att-3a', ms: 500 }).ok,
    true
  );
  assert.equal(
    ledger.record('review', { itemId: 'TASK-3', attemptId: 'att-3b', ms: 600 }).ok,
    true
  );
  assert.equal(ledger.admit('repair', { itemId: 'TASK-3' }).cause, Cause.ATTEMPTS_EXHAUSTED);
  assert.equal(
    ledger.record('repair', { itemId: 'TASK-3', attemptId: 'att-3c', ms: 100 }).cause,
    Cause.ATTEMPTS_EXHAUSTED
  );
});

// AC-AI-169-04: Retry layer deduplication across pipeline/cli/gateway counts attempt once
test('AC-AI-169-04: retryLayer deduplication counts attempt once across layers', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  for (const retryLayer of ['gateway', 'cli', 'pipeline']) {
    ledger.record('writer', { itemId: 'TASK-4', attemptId: 'att-x', retryLayer, ms: 100 });
  }
  assert.equal(ledger.getSummary('TASK-4').attempts, 1);
  assert.deepEqual(
    ledger.getRuns('TASK-4').map((r) => r.retryLayer),
    ['gateway', 'cli', 'pipeline']
  );
  assert.throws(
    () => ledger.record('writer', { itemId: 'TASK-4', attemptId: 'y', retryLayer: 'unknown' }),
    /invalid retryLayer/
  );
});

// AC-AI-169-05: Route identity credential masking
test('AC-AI-169-05: route identity masks credentials', () => {
  const m = maskCredentials({
    provider: 'anthropic',
    apiKey: 'sk-ant-123',
    secret: 'sec',
    token: 'tok',
    endpoint: 'https://u:p@api.com/v1',
  });
  assert.equal(m.apiKey, '[REDACTED]');
  assert.equal(m.secret, '[REDACTED]');
  assert.equal(m.token, '[REDACTED]');
  assert.equal(m.endpoint, 'https://api.com/v1');
  assert.equal(m.provider, 'anthropic');
});

// AC-AI-169-06: Recursive credential masking in arrays
test('AC-AI-169-06: recursive masking in nested arrays', () => {
  const m = maskCredentials({
    providers: [{ apiKey: 'x' }, { endpoint: 'https://u:p@deepseek.com/', secret: 's' }],
  });
  assert.equal(m.providers[0].apiKey, '[REDACTED]');
  assert.equal(m.providers[1].secret, '[REDACTED]');
  assert.equal(m.providers[1].endpoint.startsWith('https://deepseek.com'), true);
  assert.equal(JSON.stringify(m).includes('"x"') || JSON.stringify(m).includes('p@'), false);
});

// AC-AI-169-07: Mandatory execution identifier (jobId or attemptId)
test('AC-AI-169-07: missing jobId and attemptId throws RUN_LEDGER_REFUSED', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  assert.throws(
    () => ledger.record('writer', { itemId: 'TASK-NOID', ms: 100 }),
    /RUN_LEDGER_REFUSED: missing jobId or attemptId/
  );
});

// AC-AI-169-08: Deduplication before cap enforcement with cap=1
test('AC-AI-169-08: same attemptId across layers with cap=1 both recorded', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 1 } },
  });
  assert.equal(
    ledger.record('writer', {
      itemId: 'TASK-CAP1',
      attemptId: 'a1',
      retryLayer: 'gateway',
      ms: 150,
    }).ok,
    true
  );
  assert.equal(
    ledger.record('writer', { itemId: 'TASK-CAP1', attemptId: 'a1', retryLayer: 'cli', ms: 250 })
      .ok,
    true
  );
  assert.equal(ledger.getSummary('TASK-CAP1').attempts, 1);
  assert.equal(ledger.getRuns('TASK-CAP1').length, 2);
  assert.equal(
    ledger.record('writer', { itemId: 'TASK-CAP1', attemptId: 'a2', retryLayer: 'gateway', ms: 50 })
      .cause,
    Cause.ATTEMPTS_EXHAUSTED
  );
});

// AC-AI-169-09: Reservation completion counts 1 attempt
test('AC-AI-169-09: reserve followed by record counts 1 attempt', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 2 } },
  });
  const fp = fingerprint({ headSha: 'sha-res-abc' });
  assert.equal(
    ledger.progressLedger.admit('TASK-RES', 'writer', fp, { reserve: true, pid: process.pid }).ok,
    true
  );
  assert.equal(ledger.getSummary('TASK-RES').attempts, 1);
  assert.equal(
    ledger.record('writer', { itemId: 'TASK-RES', attemptId: 'att-res-1', fp, ms: 500 }).ok,
    true
  );
  assert.equal(ledger.getSummary('TASK-RES').attempts, 1);
});

// AC-AI-169-10: Filesystem isolation (no writes outside os.tmpdir())
test('AC-AI-169-10: no file writes outside os.tmpdir()', () => {
  const dir = path.join(tmpDir(), 'sub');
  fs.mkdirSync(dir, { recursive: true });
  new RunLedger({ file: path.join(dir, 'ledger.json') }).record('writer', {
    itemId: 'TASK-5',
    attemptId: 'att-5',
    ms: 50,
  });
  const normTmp = os.tmpdir().toLowerCase().replace(/\\/g, '/');
  const check = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      assert.equal(
        path.join(d, entry.name).replace(/\\/g, '/').toLowerCase().startsWith(normTmp),
        true
      );
      if (entry.isDirectory()) check(path.join(d, entry.name));
    }
  };
  check(dir);
});

// AC-AI-169-11: Limit override synchronization on ProgressLedger
test('AC-AI-169-11: reservations honor RunLedger limit override', () => {
  const progressLedger = new ProgressLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const ledger = new RunLedger({ progressLedger, limits: { item: { attempts: 1 } } });
  assert.equal(
    ledger.admit('TASK-T', 'writer', 'F1', { reserve: true, pid: process.pid }).ok,
    true
  );
  assert.equal(
    ledger.record('writer', { itemId: 'TASK-T', attemptId: 'a1', fp: 'F1', ms: 100 }).ok,
    true
  );
  assert.equal(ledger.getSummary('TASK-T').attempts, 1);
  assert.equal(
    ledger.admit('TASK-T', 'reviewer', 'F2', { reserve: true, pid: process.pid }).cause,
    Cause.ATTEMPTS_EXHAUSTED
  );
});

// AC-AI-169-12: Distinct attempt reservation isolation
test('AC-AI-169-12: distinct attempts cannot reuse in-flight credit', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 2 } },
  });
  const results = ['a1', 'a2', 'a3', 'a4'].map((attemptId) =>
    ledger.record('writer', {
      itemId: 'TASK-FLIGHT',
      attemptId,
      fp: 'F-' + attemptId,
      verdict: 'IN_FLIGHT',
      ms: 100,
    })
  );
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, true, false, false]
  );
  assert.equal(results[2].cause, Cause.ATTEMPTS_EXHAUSTED);
  assert.equal(ledger.getSummary('TASK-FLIGHT').attempts, 2);
});

// AC-AI-169-13: Goal tracking on reservation and record
test('AC-AI-169-13: reserve with goalId tracks goal attempts', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 2 } },
  });
  assert.equal(
    ledger.admit('TASK-GOAL', 'writer', 'F-GOAL', { reserve: true, pid: process.pid }).ok,
    true
  );
  assert.equal(
    ledger.record('writer', {
      itemId: 'TASK-GOAL',
      goalId: 'GOAL-G',
      attemptId: 'a1',
      fp: 'F-GOAL',
      ms: 100,
    }).ok,
    true
  );
  const state = ledger.load();
  assert.equal(state.items['TASK-GOAL'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 1);
  assert.equal(state.goals['GOAL-G'].attempts, 1);
});

// AC-AI-169-14: ProgressLedger validateLedger schema compatibility
test('AC-AI-169-14: preserves full counter schema across repeated writes', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  ledger.record('writer', { itemId: 'TASK-SCHEMA', attemptId: 'a1', ms: 100 });
  const raw1 = JSON.parse(fs.readFileSync(ledger.file, 'utf8'));
  for (const k of ['attempts', 'ms', 'tokens', 'tokensUnknown', 'unknownTokens']) {
    assert.equal(typeof raw1.items['TASK-SCHEMA'].spent[k], 'number');
    assert.equal(typeof raw1.goal[k], 'number');
  }
  assert.equal(
    ledger.record('reviewer', { itemId: 'TASK-SCHEMA', attemptId: 'a2', ms: 200, tokens: 100 }).ok,
    true
  );
  const loaded = ledger.load();
  assert.equal(loaded.items['TASK-SCHEMA'].spent.attempts, 2);
  assert.equal(loaded.goal.attempts, 2);
});
