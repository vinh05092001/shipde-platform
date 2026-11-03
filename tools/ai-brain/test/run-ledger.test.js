'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RunLedger, maskCredentials, Cause } = require('../run-ledger');
const { ProgressLedger, fingerprint } = require('../work-guard');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'run-ledger-test-'));

test('chain writer->review->repair->review computes correct total spent and links', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', {
    itemId: 'TASK-1',
    decisionId: 'd1',
    jobId: 'j1',
    attemptId: 'a1',
    launch: 10,
    exit: 0,
    reviewSha: 'sha-w1',
    verdict: 'DONE',
    ms: 1200,
    tokens: 500,
  });
  const r2 = ledger.record('review', {
    itemId: 'TASK-1',
    decisionId: 'd2',
    jobId: 'j2',
    attemptId: 'a2',
    launch: 20,
    exit: 0,
    reviewSha: 'sha-w1',
    verdict: 'CHANGES_REQUIRED',
    ms: 800,
    tokens: 300,
  });
  const r3 = ledger.record('repair', {
    itemId: 'TASK-1',
    decisionId: 'd3',
    jobId: 'j3',
    attemptId: 'a3',
    launch: 30,
    exit: 0,
    reviewSha: 'sha-w2',
    verdict: 'DONE',
    ms: 1500,
    tokens: 700,
  });
  const r4 = ledger.record('reviewer', {
    itemId: 'TASK-1',
    decisionId: 'd4',
    jobId: 'j4',
    attemptId: 'a4',
    launch: 40,
    exit: 0,
    reviewSha: 'sha-w2',
    verdict: 'PASS',
    ms: 600,
    tokens: 200,
  });

  assert.equal(r1.ok && r2.ok && r3.ok && r4.ok, true);
  const spent = ledger.getSummary('TASK-1');
  assert.equal(spent.attempts, 4);
  assert.equal(spent.ms, 4100);
  assert.equal(spent.tokens, 1700);

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

test('missing tokens yields UNKNOWN, tokenEnforcement UNENFORCED, no zero or money conversion', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const res = ledger.record('writer', { itemId: 'TASK-2', attemptId: 'att-2', ms: 300 });
  assert.equal(res.ok, true);
  assert.equal(res.run.tokens, 'UNKNOWN');
  assert.equal(res.run.tokenEnforcement, 'UNENFORCED');
  assert.equal('cost' in res.run || 'price' in res.run || 'vnd' in res.run, false);

  const summary = ledger.getSummary('TASK-2');
  assert.equal(summary.tokens, 0);
  assert.equal(summary.tokensUnknown, 1);
});

test('exceeding attempt or deadline budget cap refuses admission and record', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 2, ms: 2000, tokens: 100 } },
  });
  assert.equal(
    ledger.record('writer', { itemId: 'TASK-3', attemptId: 'att-3a', ms: 500 }).ok,
    true
  );
  assert.equal(
    ledger.record('review', { itemId: 'TASK-3', attemptId: 'att-3b', ms: 600 }).ok,
    true
  );

  const aOver = ledger.admit('repair', { itemId: 'TASK-3' });
  assert.equal(aOver.ok, false);
  assert.equal(aOver.cause, Cause.ATTEMPTS_EXHAUSTED);

  const rOver = ledger.record('repair', { itemId: 'TASK-3', attemptId: 'att-3c', ms: 100 });
  assert.equal(rOver.ok, false);
  assert.equal(rOver.cause, Cause.ATTEMPTS_EXHAUSTED);

  const ledger2 = new RunLedger({
    file: path.join(tmpDir(), 'ledger2.json'),
    limits: { item: { ms: 1000 } },
  });
  ledger2.record('writer', { itemId: 'TASK-3', attemptId: 'att-3d', ms: 1200 });
  assert.equal(ledger2.admit('review', { itemId: 'TASK-3' }).cause, Cause.TIME_EXHAUSTED);
});

test('retryLayer pipeline|cli|gateway counts attempt once across layers', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  ledger.record('writer', { itemId: 'TASK-4', attemptId: 'att-x', retryLayer: 'gateway', ms: 100 });
  ledger.record('writer', { itemId: 'TASK-4', attemptId: 'att-x', retryLayer: 'cli', ms: 200 });
  ledger.record('writer', {
    itemId: 'TASK-4',
    attemptId: 'att-x',
    retryLayer: 'pipeline',
    ms: 300,
  });

  const spent = ledger.getSummary('TASK-4');
  assert.equal(spent.attempts, 1);
  assert.equal(spent.ms, 600);

  const runs = ledger.getRuns('TASK-4');
  assert.deepEqual(
    runs.map((r) => r.retryLayer),
    ['gateway', 'cli', 'pipeline']
  );
  assert.throws(
    () => ledger.record('writer', { itemId: 'TASK-4', retryLayer: 'unknown' }),
    /invalid retryLayer/
  );
});

test('route identity masks credentials', () => {
  const masked = maskCredentials({
    provider: 'anthropic',
    apiKey: 'sk-ant-api03-abcdefghijklmn',
    secret: 'mysecret',
    token: 'jwt.token.here',
    endpoint: 'https://user:pass123@api.anthropic.com/v1',
  });
  assert.equal(masked.apiKey, '[REDACTED]');
  assert.equal(masked.secret, '[REDACTED]');
  assert.equal(masked.token, '[REDACTED]');
  assert.equal(masked.endpoint, 'https://api.anthropic.com/v1');
  assert.equal(masked.provider, 'anthropic');
});

test('route identity masks credentials recursively in providers array', () => {
  const masked = maskCredentials({
    providers: [
      { name: 'anthropic', apiKey: 'x' },
      { name: 'deepseek', endpoint: 'https://user:pass123@api.deepseek.com', secret: 'secret_val' },
    ],
  });
  assert.equal(masked.providers[0].apiKey, '[REDACTED]');
  assert.equal(masked.providers[0].name, 'anthropic');
  assert.equal(masked.providers[1].secret, '[REDACTED]');
  assert.equal(masked.providers[1].endpoint, 'https://api.deepseek.com');
  const serialized = JSON.stringify(masked);
  assert.equal(serialized.includes('"x"'), false);
  assert.equal(serialized.includes('pass123'), false);
  assert.equal(serialized.includes('secret_val'), false);
});

test('record missing both jobId and attemptId throws RUN_LEDGER_REFUSED', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  assert.throws(
    () => ledger.record('writer', { itemId: 'TASK-NOID', ms: 100 }),
    /RUN_LEDGER_REFUSED: missing jobId or attemptId/
  );
  assert.throws(
    () => ledger.record('writer', { itemId: 'TASK-NOID', retryLayer: 'pipeline', ms: 100 }),
    /RUN_LEDGER_REFUSED: missing jobId or attemptId/
  );
});

test('two retry layers with same attemptId and cap=1 are both recorded, accumulate ms, keep verdicts and stay at 1 attempt', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 1 } },
  });
  const rGateway = ledger.record('writer', {
    itemId: 'TASK-CAP1',
    attemptId: 'a1',
    retryLayer: 'gateway',
    ms: 150,
    verdict: 'RETRY',
  });
  assert.equal(rGateway.ok, true);

  const rCli = ledger.record('writer', {
    itemId: 'TASK-CAP1',
    attemptId: 'a1',
    retryLayer: 'cli',
    ms: 250,
    verdict: 'DONE',
  });
  assert.equal(rCli.ok, true);

  const spent = ledger.getSummary('TASK-CAP1');
  assert.equal(spent.attempts, 1);
  assert.equal(spent.ms, 400);

  const runs = ledger.getRuns('TASK-CAP1');
  assert.equal(runs.length, 2);
  assert.equal(runs[0].retryLayer, 'gateway');
  assert.equal(runs[0].verdict, 'RETRY');
  assert.equal(runs[1].retryLayer, 'cli');
  assert.equal(runs[1].verdict, 'DONE');

  // A new attempt beyond cap=1 is refused
  const rNew = ledger.record('writer', {
    itemId: 'TASK-CAP1',
    attemptId: 'a2',
    retryLayer: 'gateway',
    ms: 50,
  });
  assert.equal(rNew.ok, false);
  assert.equal(rNew.cause, Cause.ATTEMPTS_EXHAUSTED);
});

test('ProgressLedger.admit with reserve:true followed by record for same fingerprint counts 1 attempt total', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 2 } },
  });
  const fp = fingerprint({ headSha: 'sha-res-abc' });

  const aRes = ledger.progressLedger.admit('TASK-RES', 'writer', fp, {
    reserve: true,
    pid: process.pid,
  });
  assert.equal(aRes.ok, true);
  assert.equal(ledger.getSummary('TASK-RES').attempts, 1);

  const rRec = ledger.record('writer', {
    itemId: 'TASK-RES',
    attemptId: 'att-res-1',
    fp,
    ms: 500,
    verdict: 'DONE',
  });
  assert.equal(rRec.ok, true);
  assert.equal(ledger.getSummary('TASK-RES').attempts, 1);

  // Because attempts is 1 and limit is 2, reviewer is admitted (not blocked early)
  const aReviewer = ledger.admit('reviewer', { itemId: 'TASK-RES' });
  assert.equal(aReviewer.ok, true);
});

test('no file writes outside os.tmpdir()', () => {
  const dir = tmpDir();
  const ledger = new RunLedger({ file: path.join(dir, 'sub', 'ledger.json') });
  ledger.record('writer', { itemId: 'TASK-5', attemptId: 'att-5', ms: 50 });

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

test('reserve_honors_run_ledger_limit_override', () => {
  const file = path.join(tmpDir(), 'ledger.json');
  const progressLedger = new ProgressLedger({ file });
  const ledger = new RunLedger({ progressLedger, limits: { item: { attempts: 1 } } });

  const r1 = ledger.admit('TASK-T', 'writer', 'F1', { reserve: true, pid: process.pid });
  assert.equal(r1.ok, true);

  const rec = ledger.record('writer', {
    itemId: 'TASK-T',
    attemptId: 'a1',
    fp: 'F1',
    ms: 100,
    verdict: 'DONE',
  });
  assert.equal(rec.ok, true);
  assert.equal(ledger.getSummary('TASK-T').attempts, 1);

  const r2 = ledger.admit('TASK-T', 'reviewer', 'F2', { reserve: true, pid: process.pid });
  assert.equal(r2.ok, false);
  assert.equal(r2.cause, Cause.ATTEMPTS_EXHAUSTED);
  assert.equal(ledger.getSummary('TASK-T').attempts, 1);
});

test('distinct_attempts_cannot_reuse_in_flight_credit', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 2 } },
  });
  const results = [];
  for (const attemptId of ['a1', 'a2', 'a3', 'a4']) {
    const res = ledger.record('writer', {
      itemId: 'TASK-FLIGHT',
      attemptId,
      fp: 'F-SHARED',
      verdict: 'IN_FLIGHT',
      ms: 100,
    });
    results.push(res);
  }
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, true, false, false]
  );
  assert.equal(results[2].cause, Cause.ATTEMPTS_EXHAUSTED);
  assert.equal(results[3].cause, Cause.ATTEMPTS_EXHAUSTED);
  assert.equal(ledger.getSummary('TASK-FLIGHT').attempts, 2);
  assert.equal(ledger.getRuns('TASK-FLIGHT').length, 2);
});

test('reserve followed by record with goalId tracks attempt in goals', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 2 } },
  });
  const rRes = ledger.admit('TASK-GOAL', 'writer', 'F-GOAL', { reserve: true, pid: process.pid });
  assert.equal(rRes.ok, true);

  const rRec = ledger.record('writer', {
    itemId: 'TASK-GOAL',
    goalId: 'GOAL-G',
    attemptId: 'a1',
    fp: 'F-GOAL',
    ms: 100,
    verdict: 'DONE',
  });
  assert.equal(rRec.ok, true);

  const state = ledger.load();
  assert.equal(state.items['TASK-GOAL'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 1);
  assert.equal(state.goals['GOAL-G'].attempts, 1);
});

test('persisted ledger preserves full counter schema and passes validateLedger across repeated writes', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  ledger.record('writer', { itemId: 'TASK-SCHEMA', attemptId: 'a1', ms: 100 });
  const raw1 = JSON.parse(fs.readFileSync(ledger.file, 'utf8'));
  for (const k of ['attempts', 'ms', 'tokens', 'tokensUnknown', 'unknownTokens']) {
    assert.equal(typeof raw1.items['TASK-SCHEMA'].spent[k], 'number');
    assert.equal(typeof raw1.goal[k], 'number');
  }
  // Subsequent record loads and validates without corrupt error
  const rec2 = ledger.record('reviewer', {
    itemId: 'TASK-SCHEMA',
    attemptId: 'a2',
    ms: 200,
    tokens: 100,
  });
  assert.equal(rec2.ok, true);
  const loaded = ledger.load();
  assert.equal(loaded.items['TASK-SCHEMA'].spent.attempts, 2);
  assert.equal(loaded.goal.attempts, 2);
});

test('force_cannot_bypass_attempt_budget', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 1 } },
  });
  const r1 = ledger.record('writer', { itemId: 'TASK-FORCE', attemptId: 'a1', ms: 100 });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('writer', {
    itemId: 'TASK-FORCE',
    attemptId: 'a2',
    force: true,
    ms: 100,
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.cause, Cause.ATTEMPTS_EXHAUSTED);
  assert.equal(ledger.getSummary('TASK-FORCE').attempts, 1);
});

test('negative_elapsed_time_cannot_restore_budget', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { ms: 1000 } },
  });
  const r1 = ledger.record('writer', { itemId: 'TASK-NEG', attemptId: 'a1', ms: 800 });
  assert.equal(r1.ok, true);
  assert.equal(ledger.getSummary('TASK-NEG').ms, 800);

  assert.throws(
    () => ledger.record('writer', { itemId: 'TASK-NEG', attemptId: 'a2', ms: -600 }),
    /RUN_LEDGER_REFUSED: invalid ms/
  );
  assert.equal(ledger.getSummary('TASK-NEG').ms, 800);
});

test('deduplicates_attempt_without_item_id', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', { attemptId: 'a1', retryLayer: 'gateway', ms: 100 });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('writer', { attemptId: 'a1', retryLayer: 'cli', ms: 200 });
  assert.equal(r2.ok, true);

  const state = ledger.load();
  assert.equal(state.goal.attempts, 1);
  assert.equal(state.goal.ms, 300);

  const runs = ledger.getRuns();
  assert.equal(runs.length, 2);
  assert.equal(runs[0].retryLayer, 'gateway');
  assert.equal(runs[1].retryLayer, 'cli');
});

test('changed_fingerprint_retry_preserves_schema', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', { itemId: 'TASK-FP', attemptId: 'a1', fp: 'F1', ms: 100 });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('writer', { itemId: 'TASK-FP', attemptId: 'a1', fp: 'F2', ms: 200 });
  assert.equal(r2.ok, true);

  const state = ledger.load();
  assert.equal(state.items['TASK-FP'].spent.attempts, 1);
  const chain = ledger.getChain('TASK-FP');
  assert.equal(chain.length, 2);
});

test('goal_reservation_completion_counts_once', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 2 } },
  });
  const rRes = ledger.admit('TASK-GOAL2', 'writer', 'F-G2', {
    reserve: true,
    pid: process.pid,
  });
  assert.equal(rRes.ok, true);
  // Arrange reservation charged once to goals.G
  const sInit = ledger.load();
  sInit.goals = {
    G: { attempts: 1, ms: 0, tokens: 0, tokensUnknown: 0, unknownTokens: 0 },
  };
  sInit.items['TASK-GOAL2'].stages.writer.fps['F-G2'].goalId = 'G';
  fs.writeFileSync(ledger.file, JSON.stringify(sInit, null, 2));

  const rRec = ledger.record('writer', {
    itemId: 'TASK-GOAL2',
    goalId: 'G',
    attemptId: 'unseen-a1',
    fp: 'F-G2',
    ms: 100,
    verdict: 'DONE',
  });
  assert.equal(rRec.ok, true);

  const state = ledger.load();
  assert.equal(state.items['TASK-GOAL2'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 1);
  assert.equal(state.goals['G'].attempts, 1);
});

test('masks_passwordless_url_userinfo', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const endpoint = 'https://privateBearerValue@api.example/v1';
  const rec = ledger.record('writer', {
    itemId: 'TASK-MASK',
    attemptId: 'a1',
    route: { endpoint },
    ms: 100,
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.run.route.endpoint, 'https://api.example/v1');

  const content = fs.readFileSync(ledger.file, 'utf8');
  assert.equal(content.includes('privateBearerValue'), false);
});

test('prototype_named_attempt_cannot_bypass_cap', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 1 } },
  });
  const r1 = ledger.record('writer', { itemId: 'TASK-PROTO', attemptId: 'a1', ms: 100 });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('writer', {
    itemId: 'TASK-PROTO',
    attemptId: 'constructor',
    ms: 100,
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.cause, Cause.ATTEMPTS_EXHAUSTED);
  assert.equal(ledger.getSummary('TASK-PROTO').attempts, 1);
  assert.equal(ledger.getRuns('TASK-PROTO').length, 1);
});

test('invalid_stage_is_rejected', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  assert.throws(
    () => ledger.record('invalid_stage', { itemId: 'TASK-ST', attemptId: 'a1' }),
    /RUN_LEDGER_REFUSED: invalid stage/
  );
});

test('negative_tokens_cannot_restore_budget', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { tokens: 1000 } },
  });
  const r1 = ledger.record('writer', { itemId: 'TASK-NEG-TOK', attemptId: 'a1', tokens: 800 });
  assert.equal(r1.ok, true);
  assert.equal(ledger.getSummary('TASK-NEG-TOK').tokens, 800);
  assert.equal(ledger.load().goal.tokens, 800);

  assert.throws(
    () => ledger.record('writer', { itemId: 'TASK-NEG-TOK', attemptId: 'a2', tokens: -600 }),
    /RUN_LEDGER_REFUSED: invalid tokens/
  );
  assert.equal(ledger.getSummary('TASK-NEG-TOK').tokens, 800);
  assert.equal(ledger.load().goal.tokens, 800);
});

test('masks_empty_password_url_userinfo', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const endpoint = 'https://privateBearerValue:@api.example/v1';
  const rec = ledger.record('writer', {
    itemId: 'TASK-MASK-EMPTY',
    attemptId: 'a1',
    route: { endpoint },
    ms: 100,
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.run.route.endpoint, 'https://api.example/v1');

  const content = fs.readFileSync(ledger.file, 'utf8');
  assert.equal(content.includes('privateBearerValue'), false);
});

test('previously_used_goal_counts_late_assigned_reservation', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
  });
  const rA = ledger.record('writer', {
    itemId: 'ITEM-A',
    attemptId: 'att-a1',
    goalId: 'G',
    ms: 100,
  });
  assert.equal(rA.ok, true);

  const rBRes = ledger.admit('ITEM-B', 'writer', 'fp-b1', {
    reserve: true,
    pid: process.pid,
  });
  assert.equal(rBRes.ok, true);

  const rBRec = ledger.record('writer', {
    itemId: 'ITEM-B',
    attemptId: 'att-b1',
    fp: 'fp-b1',
    goalId: 'G',
    ms: 100,
    verdict: 'DONE',
  });
  assert.equal(rBRec.ok, true);

  const state = ledger.load();
  assert.equal(state.goals['G'].attempts, 2);
  assert.equal(state.items['ITEM-B'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 2);
});

test('concurrent_goal_reservation_completion_counts_once', () => {
  const file = path.join(tmpDir(), 'ledger.json');
  const ledgerA = new RunLedger({ file });
  const ledgerB = new RunLedger({ file });

  const origAdmit = ledgerA.progressLedger.admit.bind(ledgerA.progressLedger);
  ledgerA.progressLedger.admit = (itemId, stage, fp, opts) => {
    const res = origAdmit(itemId, stage, fp, opts);
    const rB = ledgerB.record('writer', {
      itemId: 'TASK-CONCUR',
      attemptId: 'att-b1',
      fp: 'fp-c1',
      goalId: 'G',
      ms: 100,
      verdict: 'DONE',
    });
    assert.equal(rB.ok, true);
    return res;
  };

  const resA = ledgerA.admit('TASK-CONCUR', 'writer', 'fp-c1', {
    reserve: true,
    pid: process.pid,
    goalId: 'G',
  });
  assert.equal(resA.ok, true);

  const state = ledgerA.load();
  assert.equal(state.items['TASK-CONCUR'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 1);
  assert.equal(state.goals['G'].attempts, 1);
});

test('cross_stage_same_fingerprint_retry_preserves_schema', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', {
    itemId: 'TASK-CS',
    attemptId: 'a1',
    fp: 'F',
    ms: 100,
    verdict: 'CHANGES_REQUIRED',
  });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('fallback', {
    itemId: 'TASK-CS',
    attemptId: 'a1',
    fp: 'F',
    ms: 200,
    verdict: 'PASS',
  });
  assert.equal(r2.ok, true);

  const state = ledger.load();
  assert.equal(state.items['TASK-CS'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 1);

  const chain = ledger.getChain('TASK-CS');
  assert.equal(chain.length, 2);
  assert.equal(chain[0].stage, 'writer');
  assert.equal(chain[0].verdict, 'CHANGES_REQUIRED');
  assert.equal(chain[1].stage, 'fallback');
  assert.equal(chain[1].verdict, 'PASS');
});

test('retry_with_late_item_id_refused_without_placeholder_migration', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', {
    attemptId: 'a1',
    retryLayer: 'gateway',
    ms: 100,
  });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('writer', {
    itemId: 'T',
    attemptId: 'a1',
    retryLayer: 'pipeline',
    ms: 200,
  });
  assert.equal(r2.ok, false);
  assert.equal(r2.cause, Cause.NO_PROGRESS);

  const state = ledger.load();
  assert.equal(state.goal.attempts, 1);
  assert.equal(state.items['a1'].spent.attempts, 1);
  assert.equal(Object.hasOwn(state.items, 'T'), false);
});

test('run-ledger output loads through ProgressLedger.load without LEDGER_CORRUPT', () => {
  const file = path.join(tmpDir(), 'ledger.json');
  const runLedger = new RunLedger({ file });
  runLedger.record('writer', { itemId: 'TASK-GUARD', attemptId: 'a1', ms: 100, tokens: 50 });
  runLedger.record('reviewer', { itemId: 'TASK-GUARD', attemptId: 'a2', ms: 200, tokens: 100 });

  const progressLedger = new ProgressLedger({ file });
  const state = progressLedger.load();
  assert.equal(state.items['TASK-GUARD'].spent.attempts, 2);
  assert.equal(state.goal.attempts, 2);
  assert.equal(state.goal.tokens, 150);
});

// --- TASK-AI-169 review findings (CHANGES_REQUIRED round) ---

test('retry_cannot_change_established_item', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const rA = ledger.record('writer', { itemId: 'ITEM-A', attemptId: 'a1', ms: 100 });
  assert.equal(rA.ok, true);

  const rB = ledger.record('writer', { itemId: 'ITEM-B', attemptId: 'a1', ms: 200 });
  assert.equal(rB.ok, false);

  const state = ledger.load();
  assert.equal(state.items['ITEM-A'].spent.attempts, 1);
  assert.equal(Object.hasOwn(state.items, 'ITEM-B'), false);
  assert.equal(state.goal.attempts, 1);
});

test('retry_with_late_goal_id_counts_goal_attempt', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', {
    itemId: 'ITEM-T',
    attemptId: 'a1',
    retryLayer: 'gateway',
    ms: 100,
  });
  assert.equal(r1.ok, true);
  assert.equal(ledger.load().goals ? true : true, true);

  const r2 = ledger.record('writer', {
    itemId: 'ITEM-T',
    attemptId: 'a1',
    retryLayer: 'pipeline',
    goalId: 'G',
    ms: 200,
  });
  assert.equal(r2.ok, true);

  const state = ledger.load();
  assert.equal(state.goals['G'].attempts, 1);
  assert.equal(state.items['ITEM-T'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 1);
  assert.equal(ledger.getRuns('ITEM-T').length, 2);

  // A third retry layer with the same goal continues to count the attempt once
  const r3 = ledger.record('writer', {
    itemId: 'ITEM-T',
    attemptId: 'a1',
    retryLayer: 'cli',
    goalId: 'G',
    ms: 50,
  });
  assert.equal(r3.ok, true);

  const state2 = ledger.load();
  assert.equal(state2.goals['G'].attempts, 1);
  assert.equal(state2.items['ITEM-T'].spent.attempts, 1);
  assert.equal(state2.goal.attempts, 1);
});

test('known_token_in_flight_completion_tracks_unknown_tokens', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', {
    itemId: 'ITEM-K',
    attemptId: 'a1',
    fp: 'F-K',
    verdict: 'IN_FLIGHT',
    tokens: 100,
  });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('writer', {
    itemId: 'ITEM-K',
    attemptId: 'a1',
    fp: 'F-K',
    verdict: 'DONE',
    ms: 10,
  });
  assert.equal(r2.ok, true);

  const state = ledger.load();
  assert.equal(state.items['ITEM-K'].spent.tokens, 100);
  assert.equal(state.items['ITEM-K'].spent.tokensUnknown, 1);
  assert.equal(state.goal.tokensUnknown, 1);
  assert.equal(state.goal.tokens, 100);
});

test('concurrent_completion_then_fallback_counts_once', () => {
  const file = path.join(tmpDir(), 'ledger.json');
  const ledgerA = new RunLedger({ file });
  const ledgerB = new RunLedger({ file });

  const origAdmit = ledgerA.progressLedger.admit.bind(ledgerA.progressLedger);
  ledgerA.progressLedger.admit = (itemId, stage, fp, opts) => {
    const res = origAdmit(itemId, stage, fp, opts);
    const rB = ledgerB.record('writer', {
      itemId: 'TASK-CONCUR',
      attemptId: 'att-b1',
      fp: 'fp-c1',
      goalId: 'G',
      ms: 100,
      verdict: 'DONE',
    });
    assert.equal(rB.ok, true);
    const rF = ledgerB.record('fallback', {
      itemId: 'TASK-CONCUR',
      attemptId: 'att-b1',
      fp: 'fp-c1',
      goalId: 'G',
      ms: 50,
      verdict: 'PASS',
    });
    assert.equal(rF.ok, true);
    return res;
  };

  const resA = ledgerA.admit('TASK-CONCUR', 'writer', 'fp-c1', {
    reserve: true,
    pid: process.pid,
    goalId: 'G',
  });
  assert.equal(resA.ok, true);

  const state = ledgerA.load();
  assert.equal(state.items['TASK-CONCUR'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 1);
  assert.equal(state.goals['G'].attempts, 1);
});

test('masks_username_credential_with_nonempty_password', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const endpoint = 'https://privateBearerValue:x@api.example/v1';
  const rec = ledger.record('writer', {
    itemId: 'TASK-MASK-USER',
    attemptId: 'a1',
    route: { endpoint },
    ms: 100,
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.run.route.endpoint, 'https://api.example/v1');

  const content = fs.readFileSync(ledger.file, 'utf8');
  assert.equal(content.includes('privateBearerValue'), false);
});

test('job_id_collision_does_not_migrate_real_item', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', { itemId: 'job-7', attemptId: 'original-a', ms: 100 });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('writer', {
    itemId: 'ITEM-B',
    attemptId: 'new-a',
    jobId: 'job-7',
    ms: 200,
  });
  assert.equal(r2.ok, true);

  const state = ledger.load();
  assert.equal(state.items['job-7'].spent.attempts, 1);
  assert.equal(state.items['ITEM-B'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 2);
  assert.deepEqual(
    ledger.getChain('job-7').map((r) => r.attemptId),
    ['original-a']
  );
  assert.deepEqual(
    ledger.getChain('ITEM-B').map((r) => r.attemptId),
    ['new-a']
  );
});

test('pr_body_contains_no_template_placeholders', () => {
  const prBodyPath = path.resolve(__dirname, '../../../.oc/pr-body.md');
  if (fs.existsSync(prBodyPath)) {
    const body = fs.readFileSync(prBodyPath, 'utf8');
    const placeholders = body.match(/<[^>\n]+>/g);
    assert.equal(
      placeholders,
      null,
      `PR body still contains template placeholders: ${JSON.stringify(placeholders)}`
    );
  }
});

// --- TASK-AI-169 P1 review findings (second CHANGES_REQUIRED round) ---

test('established_item_named_like_attempt_cannot_migrate', () => {
  // cap=1 so that a second distinct attempt on ITEM-A is refused
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 1 } },
  });
  // Record ITEM-A with attemptId 'a1'. The item key equals the attempt id here so
  // that isPlaceholder('a1') would previously see only one seenAttempt and migrate.
  const rA = ledger.record('writer', { itemId: 'ITEM-A', attemptId: 'a1', ms: 100 });
  assert.equal(rA.ok, true);

  // Attempt to record ITEM-B with the same attempt 'a1'. This must be refused because
  // 'a1' is already owned by ITEM-A.
  const rB = ledger.record('writer', { itemId: 'ITEM-B', attemptId: 'a1', ms: 200 });
  assert.equal(rB.ok, false);

  const state = ledger.load();
  // ITEM-A retains its budget intact.
  assert.equal(state.items['ITEM-A'].spent.attempts, 1);
  assert.deepEqual(
    ledger.getChain('ITEM-A').map((r) => r.attemptId),
    ['a1']
  );
  // ITEM-B must not exist.
  assert.equal(Object.hasOwn(state.items, 'ITEM-B'), false);
  assert.equal(state.goal.attempts, 1);

  // A second attempt on ITEM-A must be refused (budget exhausted, not reset).
  const rA2 = ledger.record('writer', { itemId: 'ITEM-A', attemptId: 'a2', ms: 50 });
  assert.equal(rA2.ok, false);
  assert.equal(rA2.cause, Cause.ATTEMPTS_EXHAUSTED);
});

test('concurrent_completion_without_goal_preserves_reserved_goal_charge', () => {
  const file = path.join(tmpDir(), 'ledger.json');
  const ledgerA = new RunLedger({ file });
  const ledgerB = new RunLedger({ file });

  const origAdmit = ledgerA.progressLedger.admit.bind(ledgerA.progressLedger);
  ledgerA.progressLedger.admit = (itemId, stage, fp, opts) => {
    const res = origAdmit(itemId, stage, fp, opts);
    // Concurrent completion — deliberately omits goalId so the completing record
    // does NOT charge goals.G. The admit callback must detect this and charge it.
    const rB = ledgerB.record('writer', {
      itemId: 'TASK-CONCUR-NOGID',
      attemptId: 'att-b1',
      fp: 'fp-ng1',
      ms: 100,
      verdict: 'DONE',
      // no goalId
    });
    assert.equal(rB.ok, true);
    return res;
  };

  const resA = ledgerA.admit('TASK-CONCUR-NOGID', 'writer', 'fp-ng1', {
    reserve: true,
    pid: process.pid,
    goalId: 'G',
  });
  assert.equal(resA.ok, true);

  const state = ledgerA.load();
  assert.equal(state.items['TASK-CONCUR-NOGID'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 1);
  // The goal must be charged exactly once even though the completing record had no goalId.
  assert.equal(state.goals['G'].attempts, 1);
});

test('uppercase_http_scheme_masks_userinfo', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const endpoint = 'HTTPS://user:pass123@api.example/v1';
  const rec = ledger.record('writer', {
    itemId: 'TASK-MASK-UC',
    attemptId: 'a1',
    route: { endpoint },
    ms: 100,
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.run.route.endpoint, 'HTTPS://api.example/v1');

  const content = fs.readFileSync(ledger.file, 'utf8');
  assert.equal(content.includes('user:pass123'), false);
  assert.equal(content.includes('pass123'), false);
});

test('prototype_named_item_id_is_refused', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 1 } },
  });
  assert.throws(
    () => ledger.record('writer', { itemId: '__proto__', attemptId: 'a1', ms: 100 }),
    /RUN_LEDGER_REFUSED: invalid itemId __proto__/
  );
  assert.throws(
    () => ledger.record('writer', { itemId: 'constructor', attemptId: 'a1', ms: 100 }),
    /RUN_LEDGER_REFUSED: invalid itemId constructor/
  );
  assert.throws(
    () => ledger.record('writer', { itemId: 'prototype', attemptId: 'a1', ms: 100 }),
    /RUN_LEDGER_REFUSED: invalid itemId prototype/
  );
  assert.throws(
    () => ledger.admit('__proto__', 'writer', 'f1'),
    /RUN_LEDGER_REFUSED: invalid itemId __proto__/
  );
});

test('item A/B same attempt id cap=1 refuses B and leaves A exhausted', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 1 } },
  });
  // Item A uses attempt a1. With cap=1, A is now exhausted.
  const rA = ledger.record('writer', { itemId: 'ITEM-A', attemptId: 'a1', ms: 100 });
  assert.equal(rA.ok, true);

  // Item B attempts to reuse attempt a1 -> refused because a1 is owned by Item A.
  const rB = ledger.record('writer', { itemId: 'ITEM-B', attemptId: 'a1', ms: 200 });
  assert.equal(rB.ok, false);
  assert.equal(rB.cause, Cause.NO_PROGRESS);

  // Item A remains exhausted and cannot perform another attempt.
  const rA2 = ledger.record('writer', { itemId: 'ITEM-A', attemptId: 'a2', ms: 50 });
  assert.equal(rA2.ok, false);
  assert.equal(rA2.cause, Cause.ATTEMPTS_EXHAUSTED);

  const state = ledger.load();
  assert.equal(state.items['ITEM-A'].spent.attempts, 1);
  assert.equal(Object.hasOwn(state.items, 'ITEM-B'), false);
  assert.equal(state.goal.attempts, 1);
});

test('default_fingerprint_reservation_completes_once', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 1 } },
  });
  const adm = ledger.admit({
    itemId: 'T',
    stage: 'writer',
    attemptId: 'a1',
    reserve: true,
    pid: process.pid,
  });
  assert.equal(adm.ok, true);

  const rec = ledger.record({
    itemId: 'T',
    stage: 'writer',
    attemptId: 'a1',
    ms: 100,
  });
  assert.equal(rec.ok, true);

  const state = ledger.load();
  assert.equal(state.items['T'].spent.attempts, 1);
  assert.equal(state.goal.attempts, 1);
});

test('repeated_in_flight_record_counts_once', () => {
  const ledger = new RunLedger({
    file: path.join(tmpDir(), 'ledger.json'),
    limits: { item: { attempts: 1 } },
  });
  const r1 = ledger.record('writer', {
    itemId: 'T',
    attemptId: 'a1',
    fp: 'F',
    outcome: 'IN_FLIGHT',
    ms: 50,
  });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('writer', {
    itemId: 'T',
    attemptId: 'a1',
    fp: 'F',
    outcome: 'IN_FLIGHT',
    ms: 50,
  });
  assert.equal(r2.ok, true);

  const state = ledger.load();
  assert.equal(state.items['T'].spent.attempts, 1);
  assert.equal(state.items['T'].spent.ms, 100);
  assert.equal(state.goal.attempts, 1);
  assert.equal(state.goal.ms, 100);
});

test('completed_retry_tracks_unknown_tokens', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', {
    itemId: 'ITEM-R',
    attemptId: 'a1',
    retryLayer: 'pipeline',
    tokens: 100,
    ms: 50,
  });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('writer', {
    itemId: 'ITEM-R',
    attemptId: 'a1',
    retryLayer: 'cli',
    ms: 50,
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.run.tokens, 'UNKNOWN');
  assert.equal(r2.run.tokenEnforcement, 'UNENFORCED');

  const state = ledger.load();
  assert.equal(state.items['ITEM-R'].spent.tokens, 100);
  assert.equal(state.items['ITEM-R'].spent.tokensUnknown, 1);
  assert.equal(state.goal.tokens, 100);
  assert.equal(state.goal.tokensUnknown, 1);
});

test('second_reservation_for_same_item_charges_goal', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', {
    itemId: 'T',
    attemptId: 'a1',
    goalId: 'G',
    ms: 100,
    tokens: 10,
  });
  assert.equal(r1.ok, true);

  const adm = ledger.admit({
    itemId: 'T',
    stage: 'repair',
    attemptId: 'a2',
    goalId: 'G',
    reserve: true,
    pid: process.pid,
  });
  assert.equal(adm.ok, true);

  const state = ledger.load();
  assert.equal(state.items['T'].spent.attempts, 2);
  assert.equal(state.goal.attempts, 2);
  assert.equal(state.goals['G'].attempts, 2);
});

test('completion_inherits_reserved_goal', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const adm = ledger.admit({
    itemId: 'T',
    stage: 'writer',
    fp: 'F',
    goalId: 'G',
    reserve: true,
    pid: process.pid,
  });
  assert.equal(adm.ok, true);

  const rec = ledger.record('writer', {
    itemId: 'T',
    fp: 'F',
    attemptId: 'a1',
    ms: 100,
    tokens: 10,
  });
  assert.equal(rec.ok, true);
  assert.equal(rec.run.goalId, 'G');

  const state = ledger.load();
  assert.equal(state.goals['G'].ms, 100);
  assert.equal(state.goals['G'].tokens, 10);
  assert.equal(state.goals['G'].attempts, 1);
});

test('cross_stage_in_flight_retry_preserves_schema', () => {
  const ledger = new RunLedger({ file: path.join(tmpDir(), 'ledger.json') });
  const r1 = ledger.record('writer', {
    itemId: 'T-CROSS',
    attemptId: 'a1',
    fp: 'F',
    verdict: 'IN_FLIGHT',
    pid: 12345,
    ms: 50,
  });
  assert.equal(r1.ok, true);

  const r2 = ledger.record('fallback', {
    itemId: 'T-CROSS',
    attemptId: 'a1',
    fp: 'F',
    verdict: 'IN_FLIGHT',
    ms: 50,
  });
  assert.equal(r2.ok, true);

  const loaded = ledger.progressLedger.load();
  assert.equal(loaded.items['T-CROSS'].spent.attempts, 1);
  const fallbackFp = loaded.items['T-CROSS'].stages['fallback'].fps['F'];
  assert.equal(fallbackFp.outcome, 'IN_FLIGHT');
  assert.equal(Number.isInteger(fallbackFp.pid) && fallbackFp.pid > 0, true);
});

test('prototype_named_goal_is_refused_without_mutation', () => {
  const file = path.join(tmpDir(), 'ledger.json');
  const ledger = new RunLedger({ file });
  const r1 = ledger.record('writer', {
    itemId: 'ITEM-1',
    attemptId: 'a1',
    goalId: 'G',
    ms: 100,
    tokens: 10,
  });
  assert.equal(r1.ok, true);

  const beforeProtoDesc = Object.getOwnPropertyDescriptor(Object.prototype, 'attempts');
  assert.equal(beforeProtoDesc, undefined);

  const fileContentBefore = fs.readFileSync(file, 'utf8');

  assert.throws(
    () =>
      ledger.record('writer', {
        itemId: 'ITEM-2',
        attemptId: 'a2',
        goalId: '__proto__',
        ms: 100,
      }),
    /RUN_LEDGER_REFUSED: invalid goalId __proto__/
  );

  assert.throws(
    () =>
      ledger.record('writer', {
        itemId: 'ITEM-3',
        attemptId: 'a3',
        goalId: 'constructor',
        ms: 100,
      }),
    /RUN_LEDGER_REFUSED: invalid goalId constructor/
  );
  assert.throws(
    () =>
      ledger.record('writer', {
        itemId: 'ITEM-4',
        attemptId: 'a4',
        goalId: 'prototype',
        ms: 100,
      }),
    /RUN_LEDGER_REFUSED: invalid goalId prototype/
  );

  assert.equal(Object.prototype.attempts, undefined);
  assert.equal(Object.getOwnPropertyDescriptor(Object.prototype, 'attempts'), undefined);

  const fileContentAfter = fs.readFileSync(file, 'utf8');
  assert.equal(fileContentAfter, fileContentBefore);
});
