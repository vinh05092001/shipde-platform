'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  launchFromDecision,
  firstLaunch,
  afterFailure,
  normalizeTicket,
  buildLaunchPrompt,
  executeLaunch,
} = require('../route-handoff');

const prov = (harness, provider, modelPrefix) => ({
  harness,
  provider,
  ...(modelPrefix ? { modelPrefix } : {}),
});
const registry = {
  sources: [{ id: 'gw' }, { id: 'codex' }, { id: 'direct' }, { id: 'agy' }],
  dispatch: {
    launchModes: {
      opencode: ['full-access', 'auto'],
      codex: ['full-access'],
      schtasks: ['full-access'],
    },
    providers: {
      gw: prov('paseo', 'opencode', 'gateway/'),
      codex: prov('codex', 'codex'),
      direct: prov('opencode-direct', 'opencode'),
      agy: prov('agy-pool', 'schtasks'),
    },
  },
};
const cand = (id, harness, provider, model, extra = {}) => ({
  offeringId: id,
  candidateKey: id,
  harness,
  gateway: provider,
  upstream: provider,
  modelId: model,
  ...extra,
});
const decided = (c) => ({
  controllerStatus: 'READY',
  selected: c.offeringId,
  chosen: c.offeringId,
  candidates: [c],
  ranking: [c],
  rejected: [],
  workItemId: 'TASK-AI-171',
  schemaVersion: 1,
});
const req = { prompt: 'do task', cwd: 'C:/wt', title: 'TASK-AI-171' };

test('B50: AGY, native Codex, direct, and 9Router decisions each produce exact argv; unknown harness refused', () => {
  const launches = [
    [cand('c1', 'agy-pool', 'agy', 'm', { accountId: 'agy01' }), req],
    [cand('c2', 'codex', 'codex', 'm', { effort: 'high' }), req],
    [cand('c3', 'opencode-direct', 'direct', 'm'), { ...req, isolatedWorker: true }],
    [cand('c4', 'paseo', 'gw', 'm'), req],
  ].map(([c, r]) => launchFromDecision(decided(c), r, registry));
  assert.deepEqual(launches[0].args, ['/run', '/tn', 'ShipDe\\ShipDe-agy01']);
  assert.ok(launches[1].args.includes('model_reasoning_effort=high'));
  assert.ok(launches[2].args.includes('m'));
  assert.ok(launches[3].args.includes('gateway/m'));
  launches.forEach((l) => assert.deepEqual(executeLaunch(l, { fake: true }).args, l.args));
  assert.equal(executeLaunch({ offeringId: 'b', harness: 'unknown', args: [] }).status, 'refused');
});

test('B41: native Codex preserves high/max effort in argv array without shell interpolation, even with metacharacters', () => {
  const c = cand('c', 'codex', 'codex', 'm;touch /evil', { effort: 'max' });
  const l = launchFromDecision(decided(c), req, registry);
  assert.ok(l.args.includes('model_reasoning_effort=max'));
  assert.equal(l.args[l.args.indexOf('-m') + 1], 'm;touch /evil');
  assert.deepEqual(executeLaunch(l, { fake: true }).args, l.args);
});

test('B39: AGY launch derives lane, account, model and timeout from input; busy lane refused', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-'));
  try {
    const c = cand('c', 'agy-pool', 'agy', 'm-agy', { accountId: 'agy03' });
    const l = launchFromDecision(decided(c), req, registry);
    const r = executeLaunch(l, { runsDir: d, workerTimeoutMs: 1800000, fake: true });
    assert.equal(r.accountId, 'agy03');
    assert.equal(r.timeoutSec, 1800);
    fs.mkdirSync(path.join(d, 'agy03'));
    fs.writeFileSync(path.join(d, 'agy03', 'job.json'), '{"prompt":"active"}');
    assert.equal(executeLaunch(l, { runsDir: d }).reason, 'LANE_BUSY');
    assert.equal(fs.readFileSync(path.join(d, 'agy03', 'job.json'), 'utf8'), '{"prompt":"active"}');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('B42: OpenCode launch preserves task path with spaces, no oc-continue, and bounds continuation', () => {
  const c = cand('c', 'opencode-direct', 'direct', 'm');
  const l = launchFromDecision(
    decided(c),
    { ...req, cwd: 'dir with spaces', isolatedWorker: true },
    registry
  );
  assert.equal(l.args[l.args.indexOf('--dir') + 1], 'dir with spaces');
  assert.ok(!l.args.some((a) => String(a).includes('oc-continue')));
  assert.equal(executeLaunch(l, { fake: true }).status, 'spawned');
  const stop = afterFailure(
    decided(c),
    { workItemId: 'TASK-AI-171', maxFallbacks: 1 },
    { ledger: { fallbacksUsed: 1 } },
    { offeringId: 'c', status: 500, workerStopped: true }
  );
  assert.equal(stop.action, 'STOP');
  assert.equal(stop.reason, 'FALLBACK_LIMIT');
});

test('B38: prompt construction reports fetch failure, preserves dirty diff, and forbids scope adding paths', () => {
  assert.equal(
    buildLaunchPrompt('task', { fetchCheck: { failed: true, error: 'timeout' } }).error,
    'FETCH_FAILED'
  );
  const withDiff = buildLaunchPrompt('task', { base: 'origin/main', dirtyDiff: '+diff' });
  assert.ok(
    withDiff.prompt.includes('Pinned base: origin/main') && withDiff.prompt.includes('+diff')
  );
  assert.equal(
    buildLaunchPrompt('task', { allowedPaths: ['tools/a.js'], scopeText: 'edit apps/b.js' }).error,
    'SCOPE_EXPANSION_FORBIDDEN'
  );
});

test('B47: ticket normalization preserves mode and tokenBudget; health changed since decision refuses launch', () => {
  const t = normalizeTicket({ workItemId: 'TASK-AI-171', mode: 'auto', tokenBudget: 50000 });
  assert.equal(t.mode, 'auto');
  assert.equal(t.tokenBudget, 50000);
  const c = cand('c', 'paseo', 'gw', 'm-h');
  const ctx = {
    now: 1000,
    routeHealth: { 'm-h': { gw: { status: 'failed', lastFailure: 999, cooldownUntil: 2000 } } },
    ledger: {},
  };
  assert.equal(firstLaunch(decided(c), t, ctx, registry).reason, 'CONTROLLER_CHOICE_UNAVAILABLE');
  assert.throws(() => launchFromDecision(decided(c), t.request, registry, ctx), /LAUNCH_REFUSED/);
});
