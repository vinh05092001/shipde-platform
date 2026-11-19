'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorktreeClaim } = require('./helpers/worktree-claim');

// Install before requiring the CLI: even a swallowed connection error fails teardown.
function offline(t, expectedAttempts = []) {
  const attempts = [];
  const deny = (api) => () => {
    attempts.push(api);
    throw new Error('OFFLINE_REPLAY_FORBIDDEN: ' + api);
  };
  t.mock.method(require('node:net').Socket.prototype, 'connect', deny('socket.connect'));
  t.mock.method(require('node:tls'), 'connect', deny('tls.connect'));
  t.mock.method(require('node:http2'), 'connect', deny('http2.connect'));
  t.mock.method(require('node:dgram'), 'createSocket', deny('dgram.createSocket'));
  for (const dns of [require('node:dns'), require('node:dns/promises')]) {
    for (const api of Object.keys(dns).filter((key) => /^(lookup|resolve|reverse)/.test(key))) {
      t.mock.method(dns, api, deny('dns.' + api));
    }
  }
  for (const m of [require('node:http'), require('node:https')]) {
    for (const fn of ['request', 'get']) {
      t.mock.method(m, fn, deny('http.' + fn));
    }
  }
  t.mock.method(globalThis, 'fetch', deny('fetch'));
  const cp = require('node:child_process');
  for (const api of [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
  ]) {
    t.mock.method(cp, api, deny('child_process.' + api));
  }
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', function (file, ...args) {
    const name = path.basename(String(file));
    if (/^(\.env.*|\.pgpass|.*auth.*\.json|credentials.*)$/i.test(name)) {
      return deny('credential read')();
    }
    return read.call(this, file, ...args);
  });
  t.after(() =>
    assert.deepEqual(
      attempts,
      expectedAttempts,
      'no unexpected network, credential reads or real workers'
    )
  );
}

test('offline guard intercepts socket connects and swallowed transport errors before dispatch', (t) => {
  offline(t, ['socket.connect', 'tls.connect', 'fetch', 'child_process.spawn', 'credential read']);
  const socket = new (require('node:net').Socket)();
  assert.throws(() => socket.connect({ host: 'fixture.invalid', port: 1 }), /FORBIDDEN/);
  socket.destroy();
  // A caller may catch these errors; the teardown still checks every attempted effect.
  assert.throws(() => require('node:tls').connect({ host: 'fixture.invalid' }), /FORBIDDEN/);
  assert.throws(() => fetch('https://fixture.invalid'), /FORBIDDEN/);
  assert.throws(() => require('node:child_process').spawn('fake-worker'), /FORBIDDEN/);
  assert.throws(() => fs.readFileSync('fake/.env.offline'), /FORBIDDEN/);
});

const fixtureDir = path.join(__dirname, 'fixtures');
const json = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
const text = (name) => fs.readFileSync(path.join(fixtureDir, 'compression-eval', name), 'utf8');

function fixture(t, kind) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-replay-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registry = json('task-ai-73/sources-new-provider.json');
  const profile = json('task-ai-73/sample-task-profile.json');
  const account = json('task-ai-73/accounts-new-provider.json').accounts[0];
  const template = json('task-ai-73/catalogue-new-provider.jsonl');
  const router = registry.sources.find((s) => s.kind === 'router');
  const external = registry.sources.find((s) => s.id === account.provider);
  registry.sources = [router, external];
  // All identities are synthetic; limits and quality come from existing fake fixtures.
  const branch = 'fake/member';
  const combo = 'fake-combo';
  registry.dispatch = {
    nineRouterWriterCombo: combo,
    providers: {
      [router.id]: { harness: template.harness, provider: 'opencode', modelPrefix: 'gateway/' },
      [external.id]: { harness: template.harness, provider: 'opencode', modelPrefix: 'external/' },
    },
    launchModes: { opencode: ['full-access'] },
  };
  const route = (source, modelId, extra = {}) => ({
    source: source.id,
    gateway: source.id,
    modelId,
    upstream: source.id,
    accountId: source.id + '-fixture',
    ...extra,
  });
  const definitions = [
    route(router, branch, { upstream: 'fake' }),
    route(router, combo, { isCombo: true, comboMembers: [branch] }),
    route(external, 'fake/external'),
    route(router, 'fake/unhealthy'),
    route(external, 'fake/no-budget', { budget: 'UNKNOWN' }),
  ];
  const now = Date.parse(template.ts);
  const selectedIndex = ['individual', 'combo', 'external'].indexOf(kind);
  const rows = definitions.map((row, index) => ({
    ...template,
    ...row,
    account: undefined,
    harness: template.harness,
    accessPath: 'cli',
    contextWindow: profile.contextSize,
    latencyMs: index === selectedIndex ? template.latencyMs : profile.expectedDuration,
    capabilities: { ...account.capabilities, 'workspace-edit': true },
    capabilityEvidence: Object.fromEntries(
      profile.requiredCapabilities.map((cap) => [
        cap,
        { ok: true, observedAt: template.ts, source: 'fixture-probe' },
      ])
    ),
    qualifiedRoles: ['author.foundation'],
    cost: index === selectedIndex ? template.latencyMs : profile.costCeiling,
    evidence: [{ status: 'passed', proofLevel: template.proofLevel, at: template.ts }],
  }));
  const routeHealth = {
    paths: Object.fromEntries(
      rows.map((c) => [
        `${c.modelId}|${c.gateway}@${c.accountId}`,
        {
          status: c.modelId === definitions[3].modelId ? 'AUTH_NEEDED' : 'AVAILABLE',
          lastCheckedAt: template.ts,
        },
      ])
    ),
  };
  const request = {
    workItemId: 'TASK-AI-171',
    outputTokens: profile.contextSize,
    minProof: template.proofLevel,
    maxFallbacks: 1,
    request: {
      cwd: root,
      branch: 'feat/task-ai-171-offline-replay',
      prompt: 'Replay a synthetic ticket offline',
      base: 'origin/main',
    },
  };
  return {
    root,
    registry,
    profile: { ...profile, taskId: request.workItemId },
    now,
    rows,
    routeHealth,
    request,
    selectedIndex,
  };
}

for (const kind of ['individual', 'combo', 'external']) {
}

test('offline dry-run dispatch with combo and opencode fixtures makes 0 outbound calls and yields a decision', async (t) => {
  offline(t);
  const { dispatchCommand } = require('../cli');
  const taskFixtureDir = path.join(fixtureDir, 'task-ai-171');
  const comboFixture = path.join(taskFixtureDir, 'combos.json');
  const opencodeFixture = path.join(taskFixtureDir, 'opencode-models.txt');
  const envFixture = {
    ...process.env,
    NINEROUTER_API_KEY: 'test-fake-key',
    TYPESAFE_API_KEY: 'test-fake-key',
    SHIPDE_COMBO_FIXTURE: comboFixture,
    SHIPDE_OPENCODE_MODELS_FIXTURE: opencodeFixture,
  };
  const prevEnv = process.env;
  process.env = envFixture;
  t.after(() => {
    process.env = prevEnv;
  });

  const result = await dispatchCommand(
    {
      'dry-run': true,
      json: true,
      // Pin the item: without it dispatch reads the live register relative to cwd.
      item: 'TASK-AI-171',
      'evidence-dir': path.join(__dirname, '..', 'data', 'evidence'),
      'fixture-dir': taskFixtureDir,
      'combo-fixture': comboFixture,
      'opencode-models-fixture': opencodeFixture,
    },
    {
      readDispatchComboConfig: require('../writer-combo').readComboConfig,
      evidenceDir: path.join(__dirname, '..', 'data', 'evidence'),
      fixtureDir: taskFixtureDir,
      comboFixture,
      opencodeModelsFixture: opencodeFixture,
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );

  assert.equal(result.exitCode, 0);
  assert.ok(result.decision, 'dispatch completes with a non-null decision');
  assert.ok(result.decision.candidates.length > 0, 'candidates are present in the decision');
});

test('readComboConfig and builtinOpencodeModels respect fixture overrides with zero outbound calls', async (t) => {
  offline(t);
  const combo = require('../writer-combo');
  const candidatesApi = require('../candidates');
  const taskFixtureDir = path.join(fixtureDir, 'task-ai-171');
  const comboFixture = path.join(taskFixtureDir, 'combos.json');
  const opencodeFixture = path.join(taskFixtureDir, 'opencode-models.txt');

  // Direct option override
  const comboCfg = await combo.readComboConfig({
    name: 'vinh',
    comboFixture,
  });
  assert.equal(comboCfg.name, 'vinh');
  assert.equal(comboCfg.state, 'READ');
  assert.deepEqual(comboCfg.members, ['fake-gateway/test-member-model']);
  assert.ok(comboCfg.readVia);
  assert.ok(comboCfg.readAt);

  const models = candidatesApi.builtinOpencodeModels(
    { opencodeProvider: 'opencode' },
    { opencodeModelsFixture: opencodeFixture }
  );
  assert.deepEqual(models, ['test-builtin-model-a', 'test-builtin-model-b']);

  // Environment variable override
  const origComboEnv = process.env.SHIPDE_COMBO_FIXTURE;
  const origModelsEnv = process.env.SHIPDE_OPENCODE_MODELS_FIXTURE;
  process.env.SHIPDE_COMBO_FIXTURE = comboFixture;
  process.env.SHIPDE_OPENCODE_MODELS_FIXTURE = opencodeFixture;
  t.after(() => {
    if (origComboEnv === undefined) delete process.env.SHIPDE_COMBO_FIXTURE;
    else process.env.SHIPDE_COMBO_FIXTURE = origComboEnv;
    if (origModelsEnv === undefined) delete process.env.SHIPDE_OPENCODE_MODELS_FIXTURE;
    else process.env.SHIPDE_OPENCODE_MODELS_FIXTURE = origModelsEnv;
  });

  const envComboCfg = await combo.readComboConfig({ name: 'vinh' });
  assert.equal(envComboCfg.name, 'vinh');
  assert.equal(envComboCfg.state, 'READ');
  assert.deepEqual(envComboCfg.members, ['fake-gateway/test-member-model']);

  const envModels = candidatesApi.builtinOpencodeModels({ opencodeProvider: 'opencode' }, {});
  assert.deepEqual(envModels, ['test-builtin-model-a', 'test-builtin-model-b']);
});

test('replay fixture with --execute is refused with REPLAY_FIXTURE_WITH_EXECUTE and zero launcher calls', async (t) => {
  offline(t);
  const { dispatchCommand } = require('../cli');
  const taskFixtureDir = path.join(fixtureDir, 'task-ai-171');
  const comboFixture = path.join(taskFixtureDir, 'combos.json');

  const origComboEnv = process.env.SHIPDE_COMBO_FIXTURE;
  process.env.SHIPDE_COMBO_FIXTURE = comboFixture;
  t.after(() => {
    if (origComboEnv === undefined) delete process.env.SHIPDE_COMBO_FIXTURE;
    else process.env.SHIPDE_COMBO_FIXTURE = origComboEnv;
  });

  const launcherCalls = [];
  let exitCode = null;
  const result = await dispatchCommand(
    {
      execute: true,
      item: 'TASK-AI-171-REPLAY-EXECUTE',
    },
    {
      run: (...args) => {
        launcherCalls.push(args);
        return { exitCode: 0 };
      },
      exit: (code) => {
        exitCode = code;
      },
      log: () => {},
      error: () => {},
    }
  );

  assert.equal(
    launcherCalls.length,
    0,
    'zero launcher calls when execute is attempted with fixture env'
  );
  assert.equal(result.exitCode, 2, 'exitCode is 2 on refusal');
  assert.equal(exitCode, 2, 'deps.exit called with 2');
  assert.equal(result.outcome?.status, 'refused');
  assert.equal(result.outcome?.reason, 'REPLAY_FIXTURE_WITH_EXECUTE');
  assert.equal(result.error, 'REPLAY_FIXTURE_WITH_EXECUTE');
  assert.equal(result.chosen, null);
});

test('readComboConfig returns COMBO_NOT_FOUND and no members when requested combo is missing', async (t) => {
  offline(t);
  const combo = require('../writer-combo');
  const taskFixtureDir = path.join(fixtureDir, 'task-ai-171');
  const comboFixture = path.join(taskFixtureDir, 'combos.json');

  // combos.json has only 'vinh', request 'reviewer'
  const comboCfg = await combo.readComboConfig({
    name: 'reviewer',
    comboFixture,
  });

  assert.equal(comboCfg.name, 'reviewer');
  assert.equal(comboCfg.state, 'COMBO_CONFIG_UNAVAILABLE');
  assert.equal(comboCfg.status, 'COMBO_NOT_FOUND');
  assert.equal(comboCfg.members, null);
});

test('precedence: explicit arg/dep > per-file env > directory default for combo and models', async (t) => {
  offline(t);
  const combo = require('../writer-combo');
  const candidatesApi = require('../candidates');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'precedence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const dirCombos = path.join(root, 'combos.json');
  const dirModels = path.join(root, 'opencode-models.txt');
  fs.writeFileSync(
    dirCombos,
    JSON.stringify({ combos: [{ name: 'test-combo', members: ['dir-member'] }] })
  );
  fs.writeFileSync(dirModels, 'opencode/dir-model-1\n');

  const envCombos = path.join(root, 'override-combos.json');
  const envModels = path.join(root, 'override-models.txt');
  fs.writeFileSync(
    envCombos,
    JSON.stringify({ combos: [{ name: 'test-combo', members: ['env-member'] }] })
  );
  fs.writeFileSync(envModels, 'opencode/env-model-1\n');

  const explicitCombos = path.join(root, 'explicit-combos.json');
  const explicitModels = path.join(root, 'explicit-models.txt');
  fs.writeFileSync(
    explicitCombos,
    JSON.stringify({ combos: [{ name: 'test-combo', members: ['explicit-member'] }] })
  );
  fs.writeFileSync(explicitModels, 'opencode/explicit-model-1\n');

  // Test 1: per-file env override wins over directory default
  const origDirEnv = process.env.SHIPDE_FIXTURE_DIR;
  const origComboEnv = process.env.SHIPDE_COMBO_FIXTURE;
  const origModelsEnv = process.env.SHIPDE_OPENCODE_MODELS_FIXTURE;

  process.env.SHIPDE_FIXTURE_DIR = root;
  process.env.SHIPDE_COMBO_FIXTURE = envCombos;
  process.env.SHIPDE_OPENCODE_MODELS_FIXTURE = envModels;

  t.after(() => {
    if (origDirEnv === undefined) delete process.env.SHIPDE_FIXTURE_DIR;
    else process.env.SHIPDE_FIXTURE_DIR = origDirEnv;
    if (origComboEnv === undefined) delete process.env.SHIPDE_COMBO_FIXTURE;
    else process.env.SHIPDE_COMBO_FIXTURE = origComboEnv;
    if (origModelsEnv === undefined) delete process.env.SHIPDE_OPENCODE_MODELS_FIXTURE;
    else process.env.SHIPDE_OPENCODE_MODELS_FIXTURE = origModelsEnv;
  });

  const envComboCfg = await combo.readComboConfig({ name: 'test-combo' });
  assert.deepEqual(envComboCfg.members, ['env-member'], 'env override wins over directory default');

  const envModelsList = candidatesApi.builtinOpencodeModels({ opencodeProvider: 'opencode' }, {});
  assert.deepEqual(envModelsList, ['env-model-1'], 'env override wins over directory default');

  // Test 2: explicit arg/dep wins over per-file env override
  const explicitComboCfg = await combo.readComboConfig({
    name: 'test-combo',
    comboFixture: explicitCombos,
  });
  assert.deepEqual(
    explicitComboCfg.members,
    ['explicit-member'],
    'explicit arg wins over env override'
  );

  const explicitModelsList = candidatesApi.builtinOpencodeModels(
    { opencodeProvider: 'opencode' },
    { opencodeModelsFixture: explicitModels }
  );
  assert.deepEqual(explicitModelsList, ['explicit-model-1'], 'explicit arg wins over env override');
});

test('directory containing only opencode-models.json loads models without spawning opencode', async (t) => {
  offline(t);
  const candidatesApi = require('../candidates');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'json-models-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const jsonModels = path.join(root, 'opencode-models.json');
  fs.writeFileSync(jsonModels, JSON.stringify(['json-only-model-a', 'json-only-model-b']));

  const models = candidatesApi.builtinOpencodeModels(
    { opencodeProvider: 'opencode' },
    { fixtureDir: root }
  );
  assert.deepEqual(
    models,
    ['json-only-model-a', 'json-only-model-b'],
    'loads models from opencode-models.json'
  );
});
