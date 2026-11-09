'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const isolation = require('../isolation-launcher');
const {
  launchFromDecision,
  firstLaunch,
  normalizeTicket,
  buildLaunchPrompt,
  executeLaunch,
} = require('../route-handoff');

isolation.readClosedIsolationVerdict = () => ({ verdict: 'CLOSED' });

const SHA = 'a'.repeat(40);
const reg = {
  dispatch: {
    launchModes: {
      opencode: ['full-access', 'auto'],
      codex: ['full-access'],
      schtasks: ['full-access'],
    },
    providers: {
      gw: { harness: 'paseo', provider: 'opencode', modelPrefix: 'g/' },
      codex: { harness: 'codex', provider: 'codex' },
      direct: { harness: 'opencode-direct', provider: 'opencode' },
      agy: { harness: 'agy-pool', provider: 'schtasks' },
    },
  },
};
const cand = (id, harness, gateway, modelId, x = {}) => ({
  offeringId: id,
  candidateKey: id,
  harness,
  gateway,
  upstream: gateway,
  modelId,
  ...x,
});
const dec = (c) => ({
  controllerStatus: 'READY',
  selected: c.offeringId,
  chosen: c.offeringId,
  candidates: [c],
  workItemId: 'TASK-AI-171',
});
const req = { prompt: 'do task', cwd: 'C:/wt', title: 'TASK-AI-171' };
const rec = (calls) => (adapter, args, opts) => (
  calls.push({ adapter, args, opts }),
  { exitCode: 0 }
);
const ctxFor = (c) => ({
  now: 0,
  ledger: {},
  evidenceData: {
    combinations: [{ ...c, evidence: [{ status: 'passed', proofLevel: 'HARNESS_PASS' }] }],
  },
});
const ticketFor = (c, x = {}) => ({
  workItemId: 'TASK-AI-171',
  outputTokens: 100,
  minProof: 'HARNESS_PASS',
  maxFallbacks: 1,
  request: req,
  ...x,
});
const codexReq = {
  ...req,
  cwd: 'C:\\ShipDeWorker\\task',
  isolatedWorker: true,
  isolationVerdict: { verdict: 'CLOSED' },
};

test('B50/B1/B41/B4/B42: exact argv per harness, injected receipt, codex refusal and effort', () => {
  const ls = [
    [cand('c1', 'agy-pool', 'agy', 'm', { accountId: 'agy01' }), req],
    [cand('c2', 'codex', 'codex', 'm', { effort: 'high' }), codexReq],
    [
      cand('c3', 'opencode-direct', 'direct', 'm'),
      { ...req, cwd: 'dir with spaces', isolatedWorker: true },
    ],
    [cand('c4', 'paseo', 'gw', 'm'), req],
  ].map(([c, r]) => launchFromDecision(dec(c), r, reg));
  assert.deepEqual(ls[0].args, ['/run', '/tn', 'ShipDe\\ShipDe-agy01']);
  assert.ok(ls[1].args.includes('model_reasoning_effort=high'));
  assert.ok(
    ls[2].args.includes('dir with spaces') &&
      !ls[2].args.some((a) => String(a).includes('oc-continue'))
  );
  const calls = [];
  const res = executeLaunch(ls[3], { run: rec(calls), timeoutMs: 5000 });
  assert.deepEqual(
    [calls[0].args, calls[0].opts.timeoutMs, res.status],
    [ls[3].args, 5000, 'spawned']
  );
  assert.equal(executeLaunch({ harness: 'unknown', args: [] }).reason, 'UNKNOWN_HARNESS');
  const evil = cand('x', 'codex', 'codex', 'm;touch /evil', { effort: 'max' });
  const l = launchFromDecision(dec(evil), codexReq, reg);
  assert.ok(l.args.includes('model_reasoning_effort=max'));
  assert.equal(l.args[l.args.indexOf('--model') + 1], 'm;touch /evil');
  assert.throws(() => launchFromDecision(dec(evil), req, reg), /CODEX_REQUIRES_ISOLATION/);
});

test('B39/B10: AGY busy lane refuses first; configured paths and timeout govern', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'));
  const prev = process.env.AGY_POOL_RUNS_DIR;
  process.env.AGY_POOL_RUNS_DIR = d;
  try {
    const c = cand('c', 'agy-pool', 'agy', 'm-agy', { accountId: 'agy03' });
    const l = launchFromDecision(dec(c), { ...req, tokenBudget: 9, outputTokens: 3 }, reg);
    const job = path.join(d, 'agy03', 'job.json');
    fs.mkdirSync(path.dirname(job), { recursive: true });
    fs.writeFileSync(job, '{}');
    const calls = [];
    assert.equal(executeLaunch(l, { runsDir: d, run: rec(calls) }).reason, 'LANE_BUSY');
    assert.deepEqual([calls.length, fs.readFileSync(job, 'utf8')], [0, '{}']);
    const alt = {
      busyFiles: { job: path.join(d, 'j'), result: path.join(d, 'r') },
      run: rec(calls),
    };
    fs.writeFileSync(alt.busyFiles.job, '{}');
    assert.equal(executeLaunch(l, alt).reason, 'LANE_BUSY');
    fs.writeFileSync(alt.busyFiles.result, '{}');
    assert.equal(executeLaunch(l, alt).timeoutSec, 1800);
    assert.deepEqual([calls.at(-1).opts.tokenBudget, calls.at(-1).opts.outputTokens], [9, 3]);
  } finally {
    if (prev === undefined) delete process.env.AGY_POOL_RUNS_DIR;
    else process.env.AGY_POOL_RUNS_DIR = prev;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('B11/B5/B6/B3: immutable base, scope refusal, pre-execution refusal, dispatch re-check', () => {
  assert.equal(buildLaunchPrompt('t', { fetchCheck: { failed: true } }).error, 'FETCH_FAILED');
  assert.equal(buildLaunchPrompt('t', {}).error, 'BASE_NOT_IMMUTABLE');
  assert.equal(buildLaunchPrompt('t', { base: 'origin/main' }).error, 'BASE_NOT_IMMUTABLE');
  assert.ok(buildLaunchPrompt('t', { base: SHA }).prompt.includes(`Pinned base: ${SHA}`));
  const o = { base: SHA, allowedPaths: ['tools/a.js'] };
  const err = (scopeText) => buildLaunchPrompt('t', { ...o, scopeText }).error;
  assert.deepEqual(
    [err('edit apps/b.js'), err('edit .github/workflows/build.yml'), err('edit C:\\x\\y.js')],
    ['SCOPE_EXPANSION_FORBIDDEN', 'SCOPE_EXPANSION_FORBIDDEN', 'SCOPE_EXPANSION_FORBIDDEN']
  );
  assert.equal(
    buildLaunchPrompt('t', { base: SHA, scopeText: 'edit tools/a.js' }).error,
    'SCOPE_UNAUTHORIZED'
  );
  const c = cand('c', 'paseo', 'gw', 'm-h');
  const f = firstLaunch(dec(c), ticketFor(c, { fetchCheck: { failed: true } }), ctxFor(c), reg);
  assert.deepEqual([f.action, f.reason, f.launch], ['BLOCKED', 'FETCH_FAILED', undefined]);
  const s = firstLaunch(
    dec(c),
    ticketFor(c, { base: SHA, allowedPaths: ['tools/a.js'], scopeText: 'edit apps/b.js' }),
    ctxFor(c),
    reg
  );
  assert.deepEqual([s.reason, s.launch], ['SCOPE_EXPANSION_FORBIDDEN', undefined]);
  const context = {
    now: 1000,
    routeHealth: { 'm-h': { gw: { status: 'failed', lastFailure: 999, cooldownUntil: 2000 } } },
    ledger: {},
  };
  const calls = [];
  assert.equal(
    executeLaunch(launchFromDecision(dec(c), req, reg), { context, run: rec(calls) }).reason,
    'ROUTE_UNHEALTHY'
  );
  assert.equal(calls.length, 0);
});

test('B9/B8: budgets stay distinct, ceiling uses output, request effort survives', () => {
  const t = normalizeTicket({ tokenBudget: 50000, outputTokens: 2000 });
  assert.deepEqual([t.tokenBudget, t.outputTokens], [50000, 2000]);
  const c = cand('c', 'paseo', 'gw', 'm-bud', {
    budget: 'FREE_ALLOWANCE',
    budgetRemainingTokens: 60000,
    maxOutputTokens: 8000,
  });
  const ticket = ticketFor(c, { tokenBudget: 50000, outputTokens: 2000 });
  assert.equal(firstLaunch(dec(c), ticket, ctxFor(c), reg).action, 'LAUNCH');
  const x = cand('x', 'codex', 'codex', 'm-eff');
  const out = firstLaunch(
    dec(x),
    ticketFor(x, { request: { ...codexReq, effort: 'max' } }),
    ctxFor(x),
    reg
  );
  assert.ok(out.launch.args.includes('model_reasoning_effort=max'));
});
