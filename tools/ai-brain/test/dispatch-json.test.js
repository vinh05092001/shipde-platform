'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { main } = require('../cli');
const { buildTaskProfile } = require('../orchestrate');
const routing = require('../routing');
const { candidateKey } = require('../candidates');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'dispatch-fixture-'));
  t.after(() => {
    process.exitCode = 0;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    assert.doesNotMatch(
      String(file),
      /(?:^|[\\/])(?:\.env[^\\/]*|auth[^\\/]*|\.pgpass|\.credentials[^\\/]*)$/i
    );
    return read.call(this, file, ...args);
  });
  const blocked = () => {
    throw new Error('NETWORK_OR_PROCESS_FORBIDDEN');
  };
  t.mock.method(globalThis, 'fetch', blocked);
  for (const module of ['node:http', 'node:https', 'node:net', 'node:child_process']) {
    const api = require(module);
    for (const key of [
      'request',
      'get',
      'connect',
      'createConnection',
      'spawn',
      'spawnSync',
      'execFileSync',
    ]) {
      if (typeof api[key] === 'function') t.mock.method(api, key, blocked);
    }
  }
  const profile = buildTaskProfile(
    { id: 'TASK-FIXTURE', role: 'author.foundation' },
    { enforceProofFloors: false }
  );
  fs.writeFileSync(path.join(root, 'profile.json'), JSON.stringify(profile));
  const candidates = ['eligible', 'unsupported'].map((name) => ({
    source: 'fixture',
    harness: name === 'unsupported' ? 'missing-writer' : 'opencode',
    accessPath: 'https://fixture.invalid/v1',
    gateway: 'fixture',
    upstream: 'fixture',
    accountId: name,
    quotaScope: name,
    modelId: `vendor/${name}:Exact.Case`,
    contextWindow: 128000,
    capabilities: { contextWindow: 128000 },
    qualifiedRoles: ['author.foundation'],
    quality: 90,
    cost: 1,
  }));
  const deps = {
    rootDir: root,
    home: root,
    accounts: [],
    candidates,
    priors: { ranking: [] },
    taskProfile: profile,
    now: Date.now(),
    routeHealthFile: path.join(root, 'health.json'),
    allowUnprobedCandidates: true,
    registry: {
      sources: [],
      dispatch: {
        providers: {
          fixture: { harness: 'opencode-direct', provider: 'fixture', modelPrefix: 'registry/' },
        },
      },
    },
    evidenceDir: path.join(root, 'evidence'),
    decisionDir: path.join(root, 'decisions'),
    quotaState: { accounts: {} },
    headrooms: { default: 'open' },
    assessment: await routing.assessTask(profile, {}),
    ask: async () => ({ outcome: 'UNDECIDED' }),
    readDispatchComboConfig: blocked,
  };
  const run = async (extra, overrides = {}) => {
    const lines = [];
    const code = await new Promise((resolve) => {
      main(['dispatch', '--dry-run', '--json', '--root', root, ...extra], {
        ...deps,
        ...overrides,
        log: (line) => lines.push(line),
        error: (line) => lines.push(line),
        exit: resolve,
      });
    });
    await new Promise((resolve) => setImmediate(resolve));
    process.exitCode = 0;
    // Profile dispatch prints its banner first; the decision is the last JSON block.
    return { code, value: JSON.parse(lines.filter((l) => String(l).startsWith('{')).pop()) };
  };
  return { run, deps, candidates, root };
}

test('successful item/profile ranking and registry-qualified launch argv agree', async (t) => {
  const { run, deps, candidates } = await fixture(t);
  const item = await run(['--item', 'TASK-FIXTURE']);
  const profile = await run(['--profile', 'profile.json']);
  assert.equal(profile.code, item.code);
  assert.equal(profile.value.chosen, item.value.chosen);
  assert.deepEqual(profile.value.ranking, item.value.ranking);
  const { resolveRoute } = require('../executor');
  const { qualifyModel } = require('../sources');
  const route = resolveRoute(
    { provider: 'fixture', model: candidates[0].modelId },
    {},
    deps.registry
  );
  const argv = require('../harness')
    .getHarness(route.harness || route.harnessName)
    .launch({ model: route.model, prompt: 'fake', isolatedWorker: true, cwd: 'fixture-worktree' });
  assert.ok(argv.includes('registry/' + candidates[0].modelId));
  assert.equal(qualifyModel(route.model, { modelPrefix: 'registry/' }), route.model);
});
