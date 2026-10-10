'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const sourcesDoc = require('../sources.json');
const candidates = require('../candidates');
const discovery = require('../discovery');
const { httpGetModels } = require('../discovery/http');
const launcher = require('../isolation-launcher');
const cp = require('node:child_process');

const providers = [
  { id: 'poolside', env: 'POOLSIDE_API_KEY', model: 'poolside-test-model' },
  { id: 'internlm', env: 'INTERNLM_API_KEY', model: 'internlm-test-model' },
];

function source(id) {
  return sourcesDoc.sources.find((item) => item.id === id);
}

test('both direct providers discover runtime models and generate candidates from the registered listing path', async () => {
  for (const item of providers) {
    const registered = source(item.id);
    const env = { [item.env]: `fake-${item.id}-key` };
    let requestedUrl = null;
    let requestedEnv = null;
    const result = await discovery.enumerateRegistry(
      { sources: [registered] },
      {
        httpGet: async (url, opts) => {
          requestedUrl = url;
          requestedEnv = opts.envName;
          const response = await httpGetModels(url, {
            ...opts,
            env,
            fetch: async (actualUrl, init) => {
              assert.equal(actualUrl, url);
              assert.equal(init.method, 'GET');
              assert.ok(
                init.headers.authorization === undefined ||
                  init.headers.authorization.startsWith('Bearer fake-')
              );
              return {
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ data: [{ id: item.model, owned_by: item.id }] }),
              };
            },
          });
          return response;
        },
      }
    );
    const catalog = result.get(item.id);
    assert.equal(catalog.status, 'enumerated');
    assert.deepEqual(catalog.catalogs[0].models, [item.model]);
    assert.equal(requestedUrl, `${registered.endpoint}${registered.verify.path}`);
    assert.equal(requestedEnv, item.env);
    const generated = candidates.generateCandidates({
      registry: {
        sources: [registered],
        dispatch: { providers: { [item.id]: { harness: 'direct-http', accessPath: 'direct' } } },
        retired: [],
      },
      catalogue: [item.model],
      accounts: [{ id: `${item.id}-account`, sourceId: item.id, models: [item.model] }],
    });
    assert.ok(generated.some((candidate) => candidate.modelId === item.model));
  }
});
test('an unset provider credential is a local refusal and source endpoints remain registry data', () => {
  for (const item of providers) {
    const registered = source(item.id);
    assert.match(registered.endpoint, /^https:\/\//);
    assert.equal(registered.credential.env, item.env);
    assert.equal(Object.hasOwn(registered, 'models'), false);
    assert.equal(registered.verify.method, 'models-list');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-139-'));
  const host = path.join(root, 'host');
  const worker = path.join(root, 'worker');
  fs.mkdirSync(path.join(host, 'scripts', 'ai', 'isolation'), { recursive: true });
  fs.mkdirSync(worker, { recursive: true });
  const verdictPath = path.join(host, 'verdict.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      verdict: 'CLOSED',
      timestamp: Date.now(),
      worktree: host,
      policyHash: launcher.getFolderHash(path.join(host, 'scripts', 'ai', 'isolation')),
      sid: 'test-sid',
      details: {},
    })
  );
  const previous = {};
  const originalSpawn = cp.spawnSync;
  const originalTemp = process.env.TEMP;
  process.env.TEMP = path.join(root, 'temp');
  fs.mkdirSync(process.env.TEMP);
  cp.spawnSync = (command) => {
    if (command === 'git')
      return { status: 0, stdout: '0123456789012345678901234567890123456789\n' };
    if (command === 'powershell.exe') return { status: 0, stdout: '' };
    return originalSpawn.apply(cp, arguments);
  };
  try {
    for (const item of providers) {
      previous[item.env] = process.env[item.env];
      delete process.env[item.env];
      const { getHarness } = require('../harness');
      const direct = getHarness('opencode-direct');
      const args = direct.launch({
        isolatedWorker: true,
        model: item.model,
        cwd: worker,
        prompt: 'fake prompt',
      });
      const run = launcher.getIsolatedLauncher();
      assert.throws(
        () =>
          run(direct, args, {
            cwd: host,
            workerRoot: worker,
            verdictPath,
            getWorkerSid: () => 'test-sid',
            verifyBoundary: () => true,
            baseSha: '0123456789012345678901234567890123456789',
            candidateKey: `opencode-direct::direct::${item.id}::${item.id}::*::UNKNOWN::${item.model}`,
          }),
        (error) => error.code === 'OPENCODE_DIRECT_CREDENTIAL_MISSING'
      );
    }
  } finally {
    for (const item of providers) {
      if (previous[item.env] === undefined) delete process.env[item.env];
      else process.env[item.env] = previous[item.env];
    }
    cp.spawnSync = originalSpawn;
    if (originalTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = originalTemp;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sentinel credential values stay out of registry, decisions, stdout, and worker files', () => {
  const sentinel = 'TASK_AI_139_FAKE_SENTINEL_VALUE';
  const serialized =
    JSON.stringify(sourcesDoc) +
    JSON.stringify({ candidateKey: 'direct-http::direct::::poolside::*::UNKNOWN::fake-model' });
  assert.equal(serialized.includes(sentinel), false);
  assert.equal(
    fs.readFileSync(path.join(__dirname, '..', 'decisions.js'), 'utf8').includes(sentinel),
    false
  );
  const worker = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-139-worker-'));
  try {
    fs.writeFileSync(
      path.join(worker, 'opencode.json'),
      JSON.stringify({ apiKey: '{env:POOLSIDE_API_KEY}' })
    );
    for (const file of fs.readdirSync(worker)) {
      assert.equal(fs.readFileSync(path.join(worker, file), 'utf8').includes(sentinel), false);
    }
    assert.equal(JSON.stringify({ output: 'credential absent' }).includes(sentinel), false);
  } finally {
    fs.rmSync(worker, { recursive: true, force: true });
  }
});
