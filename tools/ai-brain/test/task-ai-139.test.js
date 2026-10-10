'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const cp = require('node:child_process');

const sourcesDoc = require('../sources.json');
const sourcesApi = require('../sources');
const candidates = require('../candidates');
const discovery = require('../discovery');
const { httpGetModels } = require('../discovery/http');
const decisions = require('../decisions');
const launcher = require('../isolation-launcher');
const { getHarness } = require('../harness');

const providers = [
  { id: 'poolside', env: 'POOLSIDE_API_KEY' },
  { id: 'internlm', env: 'INTERNLM_API_KEY' },
];

function source(id) {
  return sourcesDoc.sources.find((item) => item.id === id);
}

function makeDynamicModel(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

test('both direct providers discover runtime models and generate candidates from the registered listing path', async () => {
  const dynamicModels = {
    poolside: [makeDynamicModel('dyn-ps')],
    internlm: [makeDynamicModel('dyn-ilm')],
  };
  const serverRequests = [];

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      serverRequests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
      });

      let models = [];
      if (
        req.url.startsWith('/poolside') ||
        req.headers.authorization?.includes('fake-poolside-key')
      ) {
        models = dynamicModels.poolside;
      } else if (
        req.url.startsWith('/internlm') ||
        req.headers.authorization?.includes('fake-internlm-key')
      ) {
        models = dynamicModels.internlm;
      } else {
        models = [makeDynamicModel('dyn-other')];
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: models.map((id) => ({ id, owned_by: 'upstream' })),
        })
      );
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    for (const item of providers) {
      const registered = source(item.id);
      assert.ok(registered, `source ${item.id} must exist in sources.json`);
      assert.match(registered.endpoint, /^https:\/\//);
      assert.equal(registered.credential.type, 'api-key');
      assert.equal(registered.credential.env, item.env);
      assert.equal(registered.verify.method, 'models-list');
      assert.equal(registered.verify.path, '/models');
      assert.equal(Object.hasOwn(registered, 'models'), false);

      const fakeKey = `fake-${item.id}-key`;
      const env = { [item.env]: fakeKey };
      const testSource = { ...registered, endpoint: `http://127.0.0.1:${port}/${item.id}` };

      const result = await discovery.enumerateRegistry(
        { sources: [testSource] },
        {
          registry: { sources: [testSource] },
          httpGet: (url, opts) => httpGetModels(url, { ...opts, env }),
        }
      );

      const catalog = result.get(item.id);
      assert.equal(catalog.status, 'enumerated');
      assert.deepEqual(catalog.catalogs[0].models, dynamicModels[item.id]);

      const req = serverRequests.find((r) => r.url === `/${item.id}${registered.verify.path}`);
      assert.ok(req, `server must receive request for /${item.id}${registered.verify.path}`);
      assert.equal(req.method, 'GET');
      assert.equal(req.authorization, `Bearer ${fakeKey}`);

      const generated = candidates.generateCandidates({
        registry: {
          sources: [testSource],
          dispatch: { providers: { [item.id]: { harness: 'direct-http', accessPath: 'direct' } } },
          retired: [],
        },
        catalogue: dynamicModels[item.id],
        accounts: [{ id: `${item.id}-account`, sourceId: item.id, models: dynamicModels[item.id] }],
      });

      const candidate = generated.find((c) => c.modelId === dynamicModels[item.id][0]);
      assert.ok(candidate, `candidate must exist for dynamic model ${dynamicModels[item.id][0]}`);
      assert.equal(candidate.harness, 'direct-http');
      assert.equal(candidate.accessPath, 'direct');
      assert.equal(candidate.upstream, item.id);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('an unset provider credential is a local refusal and source endpoints remain registry data', () => {
  for (const item of providers) {
    const registered = source(item.id);
    assert.ok(registered);
    assert.match(registered.endpoint, /^https:\/\//);
    assert.equal(registered.credential.type, 'api-key');
    assert.equal(registered.credential.env, item.env);
    assert.equal(Object.hasOwn(registered, 'models'), false);
    assert.equal(registered.verify.method, 'models-list');
  }
  assert.equal(source('poolside').endpoint, 'https://inference.poolside.ai/v1');
  assert.equal(source('internlm').endpoint, 'https://chat.intern-ai.org.cn/api/v1');

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
      const direct = getHarness('opencode-direct');
      const dynamicModel = makeDynamicModel('dyn-refusal');
      const args = direct.launch({
        isolatedWorker: true,
        model: dynamicModel,
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
            candidateKey: `opencode-direct::direct::${item.id}::${item.id}::*::UNKNOWN::${dynamicModel}`,
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

test('sentinel credential values stay out of registry, decisions, stdout, and worker files', async () => {
  const sentinel = 'TASK_AI_139_FAKE_SENTINEL_SECRET_TOKEN_XYZ';
  const previousEnv = {};
  for (const item of providers) {
    previousEnv[item.env] = process.env[item.env];
    process.env[item.env] = sentinel;
  }

  const dynamicSentinelModels = {
    poolside: [makeDynamicModel('dyn-sentinel-ps')],
    internlm: [makeDynamicModel('dyn-sentinel-ilm')],
  };

  const discoveryRequests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      discoveryRequests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
      });

      let models = [];
      if (req.url.startsWith('/poolside')) {
        models = dynamicSentinelModels.poolside;
      } else if (req.url.startsWith('/internlm')) {
        models = dynamicSentinelModels.internlm;
      } else {
        models = [makeDynamicModel('dyn-sentinel-fallback')];
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: models.map((id) => ({ id, owned_by: 'upstream' })),
        })
      );
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;

  const launchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-139-sentinel-root-'));
  const host = path.join(launchRoot, 'host');
  const worker = path.join(launchRoot, 'worker');
  const decisionsDir = path.join(launchRoot, 'decisions');
  fs.mkdirSync(path.join(host, 'scripts', 'ai', 'isolation'), { recursive: true });
  fs.mkdirSync(worker, { recursive: true });
  fs.mkdirSync(decisionsDir, { recursive: true });

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

  let capturedStdout = '';
  let capturedLaunchScript = '';
  const originalSpawn = cp.spawnSync;
  const originalTemp = process.env.TEMP;
  process.env.TEMP = path.join(launchRoot, 'temp');
  fs.mkdirSync(process.env.TEMP);
  cp.spawnSync = (command, args) => {
    if (command === 'git') {
      if (args && args[0] === 'clone') {
        fs.mkdirSync(path.join(args[args.length - 1], '.git', 'info'), { recursive: true });
      }
      if (args && args.includes('rev-parse')) {
        return { status: 0, stdout: '0123456789012345678901234567890123456789\n' };
      }
      return { status: 0, stdout: '' };
    }
    if (command === 'powershell.exe') {
      const fileIdx = args ? args.indexOf('-File') : -1;
      if (fileIdx !== -1 && args[fileIdx + 1] && fs.existsSync(args[fileIdx + 1])) {
        capturedLaunchScript = fs.readFileSync(args[fileIdx + 1], 'utf8');
      }
      capturedStdout = 'worker execution simulated';
      return { status: 0, stdout: capturedStdout };
    }
    return originalSpawn.apply(cp, arguments);
  };

  try {
    // 1. Real code path: sources load
    const loadedRegistry = sourcesApi.loadSources();
    assert.ok(loadedRegistry.sources.some((s) => s.id === 'poolside'));
    assert.ok(loadedRegistry.sources.some((s) => s.id === 'internlm'));
    assert.equal(
      JSON.stringify(loadedRegistry).includes(sentinel),
      false,
      'loaded registry must not contain sentinel'
    );

    const descriptions = sourcesApi.describeAll({ registry: loadedRegistry, env: process.env });
    assert.equal(
      JSON.stringify(descriptions).includes(sentinel),
      false,
      'describeAll must not contain sentinel'
    );

    for (const item of providers) {
      const src = sourcesApi.getSource(item.id, loadedRegistry);
      assert.ok(src);
      assert.equal(JSON.stringify(src).includes(sentinel), false);
      const presence = sourcesApi.credentialPresence(src, { env: process.env });
      assert.equal(presence.present, true);
      assert.equal(JSON.stringify(presence).includes(sentinel), false);
    }

    // 2. Real code path: discovery
    const registryForDiscovery = {
      sources: loadedRegistry.sources
        .filter((s) => s.id === 'poolside' || s.id === 'internlm')
        .map((s) => ({ ...s, endpoint: `http://127.0.0.1:${serverPort}/${s.id}` })),
    };

    const discoveryCtx = {
      registry: registryForDiscovery,
      httpGet: (url, opts) => httpGetModels(url, { ...opts, env: process.env }),
    };

    const discoveryResults = await discovery.enumerateRegistry(registryForDiscovery, discoveryCtx);
    assert.ok(discoveryResults.has('poolside'));
    assert.ok(discoveryResults.has('internlm'));

    assert.ok(discoveryRequests.length >= 2);
    for (const dr of discoveryRequests) {
      assert.equal(dr.authorization, `Bearer ${sentinel}`);
    }

    const discoverySerialized = JSON.stringify(Object.fromEntries(discoveryResults));
    assert.equal(
      discoverySerialized.includes(sentinel),
      false,
      'discovery output must not contain sentinel'
    );

    // 3. Real code path: candidate building
    const allDiscoveredModels = [
      ...dynamicSentinelModels.poolside,
      ...dynamicSentinelModels.internlm,
    ];
    const generatedCandidates = candidates.generateCandidates({
      registry: loadedRegistry,
      catalogue: allDiscoveredModels,
      accounts: [
        { id: 'ps-acct', sourceId: 'poolside', models: dynamicSentinelModels.poolside },
        { id: 'ilm-acct', sourceId: 'internlm', models: dynamicSentinelModels.internlm },
      ],
    });

    assert.ok(generatedCandidates.length >= 2);
    assert.equal(
      JSON.stringify(generatedCandidates).includes(sentinel),
      false,
      'candidates must not contain sentinel'
    );

    // 4. Real code path: the decision log
    for (const cand of generatedCandidates) {
      const record = decisions.recordDecision(
        {
          stage: decisions.Stage.SELECTED,
          workItemId: 'TASK-AI-139',
          role: 'writer',
          chosen: cand,
          candidates: generatedCandidates.map((c) => ({
            offeringId: c.candidateKey,
            grade: 'A',
          })),
          sessionId: 'session-sentinel',
          branch: 'feat/task-ai-139-sentinel',
        },
        { dir: decisionsDir }
      );
      assert.equal(
        JSON.stringify(record).includes(sentinel),
        false,
        'decision record must not contain sentinel'
      );
    }

    const decisionFiles = fs.readdirSync(decisionsDir);
    assert.ok(decisionFiles.length > 0);
    for (const df of decisionFiles) {
      const content = fs.readFileSync(path.join(decisionsDir, df), 'utf8');
      assert.equal(
        content.includes(sentinel),
        false,
        `decision file ${df} must not contain sentinel`
      );
    }

    // 5. Real code path: the launcher env
    const direct = getHarness('opencode-direct');
    for (const item of providers) {
      const model = dynamicSentinelModels[item.id][0];
      const launchArgs = direct.launch({
        isolatedWorker: true,
        model,
        cwd: worker,
        prompt: 'containment prompt',
      });
      const run = launcher.getIsolatedLauncher();
      const result = run(direct, launchArgs, {
        cwd: host,
        workerRoot: worker,
        verdictPath,
        getWorkerSid: () => 'test-sid',
        verifyBoundary: () => true,
        baseSha: '0123456789012345678901234567890123456789',
        candidateKey: `opencode-direct::direct::${item.id}::${item.id}::*::UNKNOWN::${model}`,
      });

      assert.equal(
        JSON.stringify(result || {}).includes(sentinel),
        false,
        'launcher result must not contain sentinel'
      );

      const opencodeJsonPath = path.join(worker, 'opencode.json');
      assert.ok(fs.existsSync(opencodeJsonPath));
      const opencodeContent = fs.readFileSync(opencodeJsonPath, 'utf8');
      assert.equal(
        opencodeContent.includes(sentinel),
        false,
        'opencode.json must not contain sentinel'
      );
      assert.ok(
        opencodeContent.includes(`{env:${item.env}}`),
        'opencode.json must reference env var by name'
      );
      const parsedConfig = JSON.parse(opencodeContent);
      assert.equal(
        parsedConfig.provider[item.id].options.baseURL,
        source(item.id).endpoint,
        'baseURL must come from sources.json'
      );

      for (const f of fs.readdirSync(worker)) {
        const p = path.join(worker, f);
        if (fs.statSync(p).isFile()) {
          const c = fs.readFileSync(p, 'utf8');
          assert.equal(c.includes(sentinel), false, `worker file ${f} must not contain sentinel`);
        }
      }

      for (const f of fs.readdirSync(host)) {
        const p = path.join(host, f);
        if (fs.statSync(p).isFile()) {
          const c = fs.readFileSync(p, 'utf8');
          assert.equal(c.includes(sentinel), false, `host file ${f} must not contain sentinel`);
        }
      }

      assert.equal(capturedStdout.includes(sentinel), false, 'stdout must not contain sentinel');
      assert.equal(
        capturedLaunchScript.includes(sentinel),
        false,
        'launch script must not contain sentinel'
      );
    }
  } finally {
    for (const item of providers) {
      if (previousEnv[item.env] === undefined) delete process.env[item.env];
      else process.env[item.env] = previousEnv[item.env];
    }
    cp.spawnSync = originalSpawn;
    if (originalTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = originalTemp;
    fs.rmSync(launchRoot, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
});
