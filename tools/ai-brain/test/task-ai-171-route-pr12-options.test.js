'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dispatchCommand, parseArgs } = require('../cli');
const { buildTaskProfile } = require('../orchestrate');
const output = require('../dispatch-output');
const root = path.resolve('fixture-root');
const options = () => ({
  offline: true,
  root,
  runtime: 'runtime',
  cwd: 'checkout',
  task: 'task.md',
  item: 'TASK-AI-171',
  snapshot: 'discovery.json',
  'code-sha': 'a'.repeat(40),
});
const candidate = {
  source: 'fixture',
  gateway: 'fixture',
  upstream: 'vendor',
  harness: 'opencode',
  accountId: 'account-a',
  modelId: 'vendor/Exact.Case',
  capabilities: { contextWindow: 128000 },
  scanLiveness: { status: 'passed' },
};
const snapshot = () => ({
  candidates: [candidate],
  launcherModels: ['registry/' + candidate.modelId],
  registry: { sources: [], dispatch: { providers: { fixture: { modelPrefix: 'registry/' } } } },
  profile: buildTaskProfile({ id: 'TASK-AI-171' }, { enforceProofFloors: false }),
});
function guarded(t, data) {
  const effects = [];
  const forbidden = () => {
    effects.push('side effect');
    throw new Error('OFFLINE_SIDE_EFFECT');
  };
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
    t.mock.method(require('node:child_process'), name, forbidden);
  t.mock.method(globalThis, 'fetch', forbidden);
  for (const name of ['node:http', 'node:https', 'node:net'])
    for (const key of ['request', 'get', 'connect', 'createConnection'])
      if (require(name)[key]) t.mock.method(require(name), key, forbidden);
  for (const name of 'writeFile appendFile mkdir rename unlink rm'.split(' ')) {
    for (const api of [fs, fs.promises]) t.mock.method(api, name, forbidden);
    t.mock.method(fs, name + 'Sync', forbidden);
  }
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    if (String(file) === path.resolve(root, 'runtime', 'discovery.json'))
      return JSON.stringify(data);
    assert.doesNotMatch(String(file), /\.env|\.shipde|(?:auth|opencode)\.json|note\.txt/i);
    return read.call(this, file, ...args);
  });
  const lines = [];
  const deps = {
    log: (s) => lines.push(s),
    error: (s) => lines.push(s),
    exit: () => {},
    candidates: [],
    accounts: [],
    registry: { sources: [] },
    jevAsk: forbidden,
    readDispatchComboConfig: forbidden,
    probeCapabilities: forbidden,
    refreshRoutes: true,
  };
  return { effects, lines, run: (args = options()) => dispatchCommand(args, deps) };
}
test('B01/B02: explicit roots, runtime, task-relative cwd and decision/ordinary validation', () => {
  const normalize = require('../coordinator-options').coordinatorOptions;
  const a = normalize(options());
  assert.equal(a.cwd, path.resolve(root, 'checkout'));
  assert.equal(a.task, path.resolve(a.cwd, 'task.md'));
  assert.equal(a.input, path.resolve(root, 'runtime', 'discovery.json'));
  assert.equal(a.role, 'author.foundation');
  assert.notEqual(normalize({ ...options(), root: path.resolve('other-root') }).input, a.input);
  for (const field of ['root', 'runtime', 'cwd', 'task', 'item', 'snapshot', 'code-sha'])
    for (const value of [undefined, true, ''])
      assert.throws(() => normalize({ ...options(), [field]: value }), /COORDINATOR_INPUT/);
  for (const extra of 'execute=true offline=true dry-run=true typo=true decision=d.json'.split(
    ' '
  )) {
    const [key, value] = extra.split('=');
    assert.throws(() => normalize({ ...options(), [key]: value }), /COORDINATOR_INPUT/);
  }
  const { task, item, snapshot: unused, ...base } = options();
  assert.equal(normalize({ ...base, decision: 'd.json' }).role, a.role);
});
test('B03/B15/B54: import needs no scratch note, user configuration or process setup', (t) => {
  const { effects } = guarded(t, snapshot());
  delete require.cache[require.resolve('../cli')];
  assert.equal(typeof require('../cli').dispatchCommand, 'function');
  assert.equal(typeof require('../coordinator-options').coordinatorOptions, 'function');
  assert.deepEqual(effects, []);
});
test('B75: offline ordinary dispatch uses Controller ranking with zero side effects', async (t) => {
  const { run, effects, lines } = guarded(t, snapshot());
  const values = Object.entries(options()).filter(([, v]) => typeof v === 'string');
  const argv = values.flatMap(([k, v]) => ['--' + k, v]);
  const result = await run(parseArgs(['dispatch', '--offline', '--dry-run', ...argv]));
  assert.equal(result.exitCode, 0);
  assert.equal(result.output.selected.modelId, candidate.modelId);
  assert.equal(result.output.codeSha, options()['code-sha']);
  assert.deepEqual(JSON.parse(lines.at(-1)), result.output);
  assert.deepEqual(effects, []);
});
test('B23/B74: discovery updates launcher eligibility; all 401 refusals retain identity', async (t) => {
  const data = snapshot();
  data.candidates = Array.from({ length: 401 }, (_, i) => ({
    ...candidate,
    accountId: 'account-' + i,
  }));
  data.launcherModels = [];
  const { run, effects } = guarded(t, data);
  const first = await run();
  assert.equal(first.output.chosen, null);
  assert.equal(first.output.rejected.length, data.candidates.length);
  assert.ok(
    first.output.rejected.every((r) => r.reasonCode === 'LAUNCHER_MODEL_UNKNOWN' && r.accountId)
  );
  data.launcherModels.push(candidate.modelId);
  assert.equal((await run()).output.chosen, null, 'a bare model cannot prove the launch prefix');
  data.launcherModels.push('registry/' + candidate.modelId);
  assert.equal((await run()).output.selected.modelId, candidate.modelId);
  assert.deepEqual(effects, []);
});
test('B02/B75: invalid offline flags refuse before selection or maintenance', async (t) => {
  const { run, effects } = guarded(t, snapshot());
  for (const extra of [{ execute: true }, { checkpoint: 'cache.json' }, { task: true }])
    assert.equal((await run({ ...options(), ...extra })).exitCode, 2);
  assert.deepEqual(effects, []);
});
test('B02/B74: decision mode preserves chosen-null and refuses inconsistent identity', async (t) => {
  const data = output.dispatchOutput({}, {}, [candidate], { chosen: null, ranking: [candidate] });
  const { run, effects } = guarded(t, data);
  const { task, item, snapshot: unused, ...args } = options();
  const result = await run({ ...args, decision: 'discovery.json' });
  assert.equal(result.output.chosen, null);
  assert.equal(result.output.selected, null);
  Object.assign(data, { chosen: data.ranking[0].candidateKey, selected: data.ranking[0] });
  const pinned = await run({ ...args, decision: 'discovery.json' });
  assert.deepEqual(pinned.output.selected, data.selected);
  data.chosen = 'unrecorded-route';
  assert.equal((await run({ ...args, decision: 'discovery.json' })).exitCode, 2);
  assert.deepEqual(effects, []);
});
for (const chosen of ['route', null]) {
  test(`B02/B74: decision mode rejects duplicate route identities with chosen ${chosen}`, async (t) => {
    const row = { ...candidate, candidateKey: 'route' };
    const data = {
      schemaVersion: 1,
      chosen,
      selected: chosen ? row : null,
      ranking: [row, { ...row }],
      rejected: [],
    };
    const { run, effects, lines } = guarded(t, data);
    const { task, item, snapshot: unused, ...args } = options();
    assert.equal(
      require('../route-handoff').decisionFromDispatch(data).reasonCode,
      'CONTROLLER_DECISION_INVALID'
    );
    const result = await run({ ...args, decision: 'discovery.json' });
    assert.equal(result.exitCode, 2);
    assert.match(lines.at(-1), /COORDINATOR_DECISION_INVALID/);
    assert.deepEqual(effects, []);
  });
}

test('B74: formatter redacts stable JSON and projects a scalar receipt without the child', () => {
  const launch = { pid: 17, status: 'started', child: {} };
  launch.child.self = launch.child;
  const value = {
    chosen: null,
    rejected: [{ reason: 'Bearer fake-token person@example.invalid' }],
    profile: { z: 'last', a: 'first', apiKey: 'fake-value' },
  };
  const format = (v) =>
    output.serializeDispatchOutput(v, { codeSha: options()['code-sha'], launch });
  const reordered = { ...value };
  reordered.profile = { apiKey: 'fake-value', a: 'first', z: 'last' };
  assert.equal(format(value), format(reordered));
  assert.doesNotMatch(format(value), /fake-token|person@|fake-value|child/);
  assert.deepEqual(JSON.parse(format(value)).launch, { pid: 17, status: 'started' });
});
test('B03: the sandbox note is supplied only when constructing launch argv', () => {
  const registry = { sources: [], dispatch: { providers: {} } };
  registry.dispatch.providers.fixture = {
    harness: 'paseo',
    provider: 'opencode',
    modelPrefix: 'registry/',
  };
  const decision = {
    selected: 'route',
    candidates: [{ ...candidate, harness: 'paseo', offeringId: 'route' }],
  };
  const launch = require('../route-handoff').launchFromDecision(
    decision,
    { prompt: 'task', sandboxNote: 'injected sandbox note', cwd: root },
    registry
  );
  assert.ok(launch.args.some((arg) => arg === 'task\n\ninjected sandbox note'));
});
