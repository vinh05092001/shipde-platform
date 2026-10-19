'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { candidateKey } = require('../discovery/identity');
const cap = require('../capability-probe');
const order = require('../probe-order');
const c = {
  harness: 'agy-pool',
  accessPath: 'cli',
  gateway: 'source-a',
  upstream: 'vendor-a',
  accountId: 'account-a',
  quotaScope: 'quota-a',
  modelId: 'vendor-a/model',
};
function combination(patch = {}, evidence = [{ proofLevel: 'WORK_ITEM_PASS' }]) {
  return { ...c, model: c.modelId, ...patch, evidence };
}

test('work proof never crosses source, upstream, full model, account, quota, path or harness identity', () => {
  assert.equal(cap.hasPriorWorkPass(c, [combination()]), true);
  for (const patch of [
    { gateway: '' },
    { gateway: 'source-b' },
    { upstream: 'vendor-b' },
    { modelId: 'vendor-b/model', model: 'vendor-b/model' },
    { sourceId: 'different-source' },
    { accountId: '*' },
    { quotaScope: '' },
    { accessPath: 'other' },
    { harness: 'opencode' },
  ]) {
    assert.equal(cap.hasPriorWorkPass(c, [combination(patch)]), false, JSON.stringify(patch));
  }
});

test('API proof cannot short circuit writer capability verification', async () => {
  for (const e of [
    { status: 'passed', level: 1 },
    { status: 'passed', level: 'API' },
    { proofLevel: 'API_PASS' },
  ]) {
    assert.equal(cap.hasPriorWorkPass(c, [combination({}, [e])]), false);
  }
});

test('probe order uses measured elapsed cost and configured fallback independent of harness name', () => {
  const slow = { ...c, elapsedMs: 700 };
  const fast = { ...c, harness: 'unlisted-harness', modelId: 'different', elapsedMs: 30 };
  const unknown = { ...c, harness: 'codex', modelId: 'unknown' };
  assert.deepEqual(
    cap.orderCandidatesForProbe(
      [slow, unknown, fast],
      { role: 'writer' },
      {
        registry: { sources: [], dispatch: { probeTimeoutMs: 100 } },
        routeHealth: { paths: {} },
        capabilityEvidence: {},
      }
    ),
    [fast, unknown, slow]
  );
});

test('representative rejections cover arbitrary harness and reason without named lane quotas', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    candidateKey: `bulk::cli::::a::q::m${i}`,
    reason: 'BUDGET',
  }));
  rows.push({ candidateKey: 'new-harness::cli::::a::q::m', reason: 'NEW_FAILURE' });
  const result = order.preferKnownGood({ rejected: rows }, [], { routeHealth: { paths: {} } });
  assert.ok(result.isolatedLaneRejected.some((r) => r.reason === 'NEW_FAILURE'));
});

test('trial14 fixture: dispatch dry-run and actual goal selection preserve identical candidates at each layer', async (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const routing = require('../routing');
  const candidates = require('../candidates');
  const cli = require('../cli');
  const goal = require('../orchestrate');
  const { parseCandidateKey } = require('../discovery/identity');
  const fixture = require('./fixtures/trial14-selection.json');
  const pool = require('../agy-pool-runtime');
  t.mock.method(pool, 'readLastRunElapsedMs', () => null);
  for (const method of ['runAdapter', 'submitJob']) {
    t.mock.method(pool, method, () => {
      throw Error('fixture forbids pool adapter/scheduler launch');
    });
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trial14-parity-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const accepted = new Set(fixture.ranking.map((r) => r.candidateKey));
  const rows = [...fixture.ranking, ...fixture.rejected].map((row) => ({
    ...parseCandidateKey(row.candidateKey),
    candidateKey: row.candidateKey,
    accountId: parseCandidateKey(row.candidateKey).account,
    source:
      parseCandidateKey(row.candidateKey).gateway || parseCandidateKey(row.candidateKey).harness,
    kind: 'agent-cli',
    quality: 70,
    cost: 1,
    capabilities: {},
  }));
  const registry = {
    sources: [{ id: 'agy-pool', kind: 'agent-cli', writerEnabled: true }],
    dispatch: { probeTimeoutMs: 2000 },
  };
  const item = {
    ...fixture.profile,
    id: fixture.profile.taskId,
    roleRequirement: { role: 'writer' },
  };
  const profile = goal.buildTaskProfile(item, {});
  const state = { paths: {}, events: [] };
  const assessment = { weightProfile: 'BALANCED', weights: routing.WEIGHT_PROFILES.BALANCED };
  const stages = { dry: {}, goal: {} };
  let lane = 'dry';
  const snapshot = (cs) =>
    cs
      .map((c) => ({ key: candidateKey(c), tools: c.capabilities?.tools }))
      .sort((a, b) => a.key.localeCompare(b.key));
  const originalProbe = cap.probeCapabilities;
  t.mock.method(cap, 'probeCapabilities', async (cs, p, o) => {
    stages[lane].beforeCapability ??= snapshot(cs);
    await originalProbe(cs, p, {
      ...o,
      allowNetwork: false,
      probeCli: async (c) =>
        accepted.has(candidateKey(c))
          ? { ok: true, method: 'fixture-observed-tool' }
          : { unverified: true, reason: 'WRITER_SCHEMA_NOT_VERIFIED_BUDGET' },
    });
    stages[lane].afterCapability ??= snapshot(cs);
  });
  const originalRank = routing.rankForProfile;
  t.mock.method(routing, 'rankForProfile', (cs, ...args) => {
    stages[lane].beforeRanking ??= snapshot(cs);
    const result = originalRank(cs, ...args);
    stages[lane].ranked ??= result.ranking.map((r) => r.candidateKey).sort();
    stages[lane].rejected ??= result.rejected
      .map((r) => ({ key: r.candidateKey, reason: r.reasonCode }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return result;
  });
  const options = {
    candidates: structuredClone(rows),
    accounts: [],
    registryAccounts: [],
    listAccounts: () => [],
    home: dir,
    storePath: path.join(dir, 'quota.json'),
    fakeRunsDir: path.join(dir, 'pool'),
    discoverPool: false,
    registry,
    routeHealth: state,
    evidenceDir: path.join(dir, 'dry-evidence'),
    decisionDir: path.join(dir, 'dry-decisions'),
    probeEvidence: () => true,
    persistRouteHealth: false,
    root: dir,
    cwd: dir,
    isolatedWorker: true,
    externalWorkers: 'agy-pool',
    assessment,
    taskProfile: profile,
    capabilitiesPrepared: false,
    env: {},
    ranking: { priors: {}, enforceKnownQuota: false },
    log: () => {},
    error: () => {},
    exit: () => {},
    now: Date.parse('2026-10-18T07:43:43.631Z'),
  };
  stages.dry.generated = snapshot(cli.assembleForDispatch(null, [], registry, options));
  const dry = await cli.dispatchCommand(
    { 'dry-run': true, item: fixture.profile.taskId, root: dir },
    options
  );
  lane = 'goal';
  const goalOptions = {
    ...options,
    candidates: structuredClone(rows),
    evidenceDir: path.join(dir, 'goal-evidence'),
    decisionDir: path.join(dir, 'goal-decisions'),
    jevAsk: async () => {
      throw Error('fixture offline');
    },
  };
  const generated = goal.buildCandidates(goalOptions, {});
  stages.goal.generated = snapshot(generated);
  const { spawnSync } = require('node:child_process');
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@shipde.test']);
  fs.writeFileSync(path.join(dir, 'fixture.txt'), 'trial14\n');
  git(['add', 'fixture.txt']);
  git(['commit', '-q', '-m', 'fixture']);
  const sha = git(['rev-parse', 'HEAD']);
  const launched = [];
  const run = await goal.runOrchestration('trial14 fixture replay', {
    ...goalOptions,
    baseSha: sha,
    sha,
    workerRoot: dir,
    persistRouteHealth: false,
    specs: [{ ...item, files: ['fixture.txt'], acceptanceCriteria: ['fixture completes'] }],
    routeProbe: async () => ({ ok: true, status: 200, body: 'fixture' }),
    run: (job) => {
      launched.push(job.candidateKey);
      return {
        exitCode: 0,
        stdout: '{"sessionID":"fixture-session"}',
        stderr: '',
        workerSha: sha,
        completionNonce: 'fixture-nonce',
      };
    },
    tests: () => ({ pass: true }),
    hostGate: () => ({ pass: true, failures: [] }),
    reviewer: () => ({ pass: true, sha, verdict: 'PASS', findings: [] }),
  });
  const selected = run.selections[0].decision;
  assert.equal(launched[0], fixture.ranking[0].candidateKey);
  assert.deepEqual(stages.goal, stages.dry);
  assert.equal(dry.decision.chosen, selected.chosen);
  assert.equal(selected.chosen, fixture.ranking[0].candidateKey);
  assert.equal(stages.goal.generated.length, 12);
  assert.equal(stages.goal.ranked.length, 2);
  assert.equal(stages.goal.rejected.length, 10);
});

test('route liveness has configurable freshness, exact evidence identity, and no work proof promotion', () => {
  const routeEvidence = require('../route-evidence');
  const now = Date.parse('2026-10-18T07:43:43.631Z');
  const observation = {
    proofLevel: 'API_PASS',
    observedAt: new Date(now - 10).toISOString(),
    elapsedMs: 17,
  };
  const options = {
    now,
    registry: { sources: [], dispatch: { routeEvidenceMaxAgeMs: 20, probeTimeoutMs: 200 } },
    evidenceData: { combinations: [combination({}, [observation])] },
  };
  assert.equal(routeEvidence.recentRouteSuccess(c, { paths: {} }, options), true);
  assert.equal(routeEvidence.hasPriorWorkPass(c, options.evidenceData.combinations), false);
  assert.equal(routeEvidence.measuredProbeCost(c, { paths: {} }, options), 17);
  assert.equal(
    routeEvidence.recentRouteSuccess({ ...c, harness: 'codex' }, { paths: {} }, options),
    false
  );
  assert.equal(
    routeEvidence.recentRouteSuccess(c, { paths: {} }, { ...options, now: now + 11 }),
    false
  );
  assert.equal(
    routeEvidence.hasPriorWorkPass(c, [
      combination({}, [{ proofLevel: 'WORK_ITEM_PASS', status: 'failed' }]),
    ]),
    false
  );
});
