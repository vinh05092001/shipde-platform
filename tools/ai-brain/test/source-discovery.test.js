'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverSources, probeSource, discover, sanitizeEndpoint } = require('../source-discovery');
const candidatesApi = require('../candidates');
const sourcesApi = require('../sources');
const intakeApi = require('../intake');

function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

test('discovers OpenCode provider endpoint and env reference without retaining its value', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const secret = 'NEVER-PERSIST-THIS';
  put(path.join(home, '.config/opencode/opencode.json'), {
    provider: {
      thegrid: {
        options: { baseURL: 'https://grid.example/v1', apiKey: '{env:THEGRID_API_KEY}' },
        models: { 'grid/model-a': { name: 'A' } },
      },
    },
  });
  const sources = discoverSources({
    home,
    env: { THEGRID_API_KEY: secret, UNKNOWN_TOKEN: 'hidden' },
    localAppData: path.join(home, 'local'),
  });
  assert.ok(
    sources.some(
      (source) =>
        source.endpoint === 'https://grid.example/v1' && source.models.includes('grid/model-a')
    )
  );
  assert.ok(
    sources.some((source) => source.credential && source.credential.name === 'UNKNOWN_TOKEN')
  );
  assert.equal(JSON.stringify(sources).includes(secret), false);
});

test('models.dev cache maps environment credentials to API endpoints', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const local = path.join(home, 'local');
  put(path.join(local, 'hermes/models_dev_cache.json'), {
    providers: {
      regolo: {
        api: 'https://api.regolo.ai/v1',
        env: ['REGOLO_API_KEY'],
        models: { 'r/model': {} },
      },
    },
  });
  const sources = discoverSources({ home, localAppData: local, env: { REGOLO_API_KEY: 'secret' } });
  assert.ok(sources.some((source) => source.id === 'regolo' && source.models.includes('r/model')));
});

test('discovered env-backed source and intake account produce a selectable candidate', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const staticFile = path.join(dir, 'registry.json');
  const discoveredFile = path.join(dir, 'data/sources.json');
  put(staticFile, { version: 1, sources: [], retired: [] });
  put(discoveredFile, {
    sources: [
      {
        id: 'regolo',
        endpoint: 'https://api.regolo.ai/v1',
        status: 'available',
        credential: { type: 'env', name: 'REGOLO_API_KEY' },
      },
    ],
  });
  const registry = sourcesApi.loadSources({ file: staticFile, discoveredFile });
  const generated = candidatesApi.generateCandidates({
    registry,
    accounts: [{ id: 'source-regolo', sourceId: 'regolo', models: ['r/model'] }],
    catalogue: ['r/model'],
    discoverPool: false,
  });
  assert.ok(
    generated.some(
      (candidate) =>
        candidate.modelId === 'r/model' &&
        candidate.accountId === 'source-regolo' &&
        candidate.accessPath === 'direct'
    )
  );
  assert.equal(
    generated.find((candidate) => candidate.accountId === 'source-regolo').harness,
    'direct-http'
  );
});

test('only successfully probed sources can become selectable candidates', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-gates-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const staticFile = path.join(dir, 'registry.json');
  put(staticFile, { version: 1, sources: [], retired: [] });

  for (const status of ['discovered', 'unprobed', 'unavailable', 'parked', 'available']) {
    const discoveredFile = path.join(dir, status + '.json');
    put(discoveredFile, {
      sources: [
        {
          id: 'fake-' + status,
          endpoint: 'https://fake.example/v1',
          kind: 'model-source',
          status,
          reason: status === 'available' ? null : 'probe not successful',
          nextCheckAt: '2026-10-11T01:00:00.000Z',
          credential: { type: 'env', name: 'FAKE_API_KEY' },
        },
      ],
    });
    const registry = sourcesApi.loadSources({ file: staticFile, discoveredFile });
    const source = registry.sources.find((entry) => entry.id === 'fake-' + status);
    assert.ok(source, `${status} source remains listed`);
    assert.equal(source.servesModels, status === 'available');
    assert.equal(source.harness, 'direct-http');
    assert.equal(source.discoveryStatus, status);
    assert.equal(source.nextCheckAt, '2026-10-11T01:00:00.000Z');

    const generated = candidatesApi.generateCandidates({
      registry,
      accounts: [{ id: 'source-fake', sourceId: source.id, models: ['fake/model'] }],
      catalogue: ['fake/model'],
      discoverPool: false,
    });
    assert.equal(
      generated.some((candidate) => candidate.accountId === 'source-fake'),
      status === 'available',
      `${status} source candidate eligibility`
    );
  }
});

test('intake catalogue excludes every discovered source without a successful probe', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-catalogue-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  put(path.join(root, 'tools/ai-brain/data/sources.json'), {
    sources: [
      ...['discovered', 'unavailable', 'parked', 'available'].map((status) => ({
        id: status,
        status,
        models: ['model/' + status],
        reason: status === 'available' ? null : 'probe not successful',
        nextCheckAt: '2026-10-11T01:00:00.000Z',
        credential: { type: 'env', name: 'FAKE_API_KEY' },
      })),
      {
        id: 'file-credential',
        status: 'available',
        models: ['model/file-credential'],
        credential: { type: 'file-field', path: 'config.json', field: 'token' },
      },
    ],
  });
  const catalogue = await intakeApi.buildCatalogue({
    root,
    read9routerModels: async () => ({ ok: true, models: ['base/model'] }),
    readAgyModels: async () => ({ ok: true, models: [] }),
    readEvidenceModels: async () => ({ ok: true, models: [] }),
  });
  assert.deepEqual(catalogue.models, ['base/model', 'model/available']);
});

test('intake keeps nonselectable source inventory reasons and recheck times', () => {
  const accounts = intakeApi.mergeDiscoveredSources(
    [],
    [
      {
        id: 'unprobed',
        endpoint: 'https://fake.example/v1',
        models: ['fake/model'],
        status: 'discovered',
        reason: null,
        nextCheckAt: null,
        credential: { type: 'env', name: 'FAKE_API_KEY' },
      },
      {
        id: 'no-route',
        endpoint: 'https://other.example/v1',
        models: ['other/model'],
        status: 'available',
        credential: { type: 'file-field', path: 'config.json', field: 'token' },
      },
    ]
  );
  assert.equal(accounts[0].enabled, false);
  assert.equal(accounts[0].reason, 'discovered');
  assert.equal(accounts[0].nextCheckAt, null);
  assert.equal(accounts[1].enabled, false);
  assert.match(accounts[1].reason, /not routable/);
});

test('persisted endpoints redact userinfo, query secrets and secret path values', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-redaction-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'sources.json');
  const secrets = ['user-secret', 'query-secret', 'project-secret'];
  await discover({
    output,
    root: dir,
    sources: [
      {
        id: 'sensitive-endpoint',
        endpoint:
          'https://user-secret:pass-secret@fake.example/v1/projects/project-secret?token=query-secret',
        models: [],
        credential: null,
      },
    ],
  });
  const serialized = fs.readFileSync(output, 'utf8');
  for (const secret of [...secrets, 'pass-secret'])
    assert.equal(serialized.includes(secret), false);
  assert.match(serialized, /fake\.example\/v1\/projects\/\[REDACTED\]/);
});

test('parks authentication and quota responses with reason and recheck time', async () => {
  const source = { id: 'fake', endpoint: 'https://fake.example/v1', models: [], credential: null };
  for (const status of [401, 402, 403, 429, 451]) {
    const result = await probeSource(source, {
      now: '2026-10-11T00:00:00.000Z',
      fetch: async () => ({ ok: false, status }),
    });
    assert.equal(result.status, 'parked', `HTTP ${status} should be parked`);
    assert.equal(result.reason, 'HTTP ' + status);
    assert.equal(
      result.nextCheckAt,
      status === 429 ? '2026-10-11T00:15:00.000Z' : '2026-10-11T01:00:00.000Z'
    );
  }
});

test('probe reads a credential in memory but persists only its location', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const secret = 'PRIVATE-KEY-DO-NOT-STORE';
  const output = path.join(dir, 'sources.json');
  const source = {
    id: 'fake',
    endpoint: 'https://fake.example/v1',
    models: [],
    credential: { type: 'env', name: 'FAKE_API_KEY' },
  };
  let authorization;
  await discover({
    root: dir,
    output,
    sources: [source],
    probe: true,
    now: '2026-10-11T00:00:00Z',
    env: { FAKE_API_KEY: secret },
    fetch: async (_url, options) => {
      authorization = options.headers.Authorization;
      return { ok: true, json: async () => ({ data: [{ id: 'model-x' }] }) };
    },
  });
  const stored = fs.readFileSync(output, 'utf8');
  assert.equal(authorization, 'Bearer ' + secret);
  assert.equal(stored.includes(secret), false);
  assert.equal(stored.includes('FAKE_API_KEY'), true);
  assert.match(stored, /model-x/);
});

test('rediscovery resets stale availability and preserves distinct endpoints for one provider id', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'sources.json');
  put(output, {
    sources: [
      {
        id: 'same',
        endpoint: 'https://one.example/v1',
        status: 'available',
        models: ['one/model'],
        credential: { type: 'env', name: 'ONE_API_KEY' },
      },
    ],
  });
  const result = await discover({
    output,
    sources: [
      {
        id: 'same',
        endpoint: 'https://one.example/v1',
        status: 'discovered',
        models: ['one/model'],
        credential: { type: 'env', name: 'ONE_API_KEY' },
      },
      {
        id: 'same',
        endpoint: 'https://two.example/v1',
        status: 'discovered',
        models: ['two/model'],
        credential: { type: 'env', name: 'TWO_API_KEY' },
      },
    ],
  });
  assert.equal(result.sources.length, 2);
  assert.equal(
    result.sources.find((row) => row.endpoint === 'https://one.example/v1').status,
    'discovered'
  );
  assert.ok(result.sources.find((row) => row.endpoint === 'https://two.example/v1'));
});

test('binds endpoint auth only to its own env reference and never probes file-field values', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-isolation-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const secretA = 'SECRET-A-KEY';

  put(path.join(home, '.config/opencode/opencode.json'), {
    provider: {
      providerA: {
        options: { baseURL: 'https://a.example/v1', apiKey: '{env:PROVIDER_A_KEY}' },
        models: { 'a/model': {} },
      },
      providerB: {
        options: { baseURL: 'https://b.example/v1' },
        models: { 'b/model': {} },
      },
      providerC: {
        options: { baseURL: 'https://c.example/v1', apiKey: '{file:credential-store}' },
        documentation: { url: 'https://docs.c.example' },
        icon: { url: 'https://icon.c.example/logo.png' },
        mcp: {
          weather: { url: 'https://weather.mcp.example/sse' },
        },
      },
    },
    mcpServers: {
      providerA: {
        url: 'https://unrelated-mcp.example',
      },
    },
  });

  const sources = discoverSources({
    home,
    env: { PROVIDER_A_KEY: secretA },
    localAppData: path.join(home, 'local'),
  });

  const sourceA = sources.find((s) => s.endpoint === 'https://a.example/v1');
  const sourceB = sources.find((s) => s.endpoint === 'https://b.example/v1');
  const sourceC = sources.find((s) => s.endpoint === 'https://c.example/v1');
  const sourceDocs = sources.find((s) => s.endpoint === 'https://docs.c.example');
  const sourceMcp = sources.find((s) => s.endpoint === 'https://weather.mcp.example/sse');
  const sourceUnrelated = sources.find((s) => s.endpoint === 'https://unrelated-mcp.example');

  assert.ok(sourceA, 'providerA is discovered');
  assert.deepEqual(sourceA.credential, { type: 'env', name: 'PROVIDER_A_KEY' });

  assert.ok(sourceB, 'providerB is discovered');
  assert.equal(sourceB.credential, null, 'providerB never inherits providerA credential');

  assert.ok(sourceC, 'providerC is discovered');
  assert.equal(sourceC.credential.type, 'file-field');
  assert.equal(
    sourceC.credential.field,
    'provider.providerC.options.apiKey',
    'providerC credential references its own field'
  );

  assert.equal(sourceDocs, undefined, 'documentation URL is not treated as a model endpoint');
  assert.equal(sourceMcp, undefined, 'MCP URL is not treated as a model endpoint');
  assert.equal(sourceUnrelated, undefined, 'unrelated MCP URL is not treated as a model endpoint');

  // Behavioral test with probes: verify Authorization header is only sent when authorized
  const probedHeaders = new Map();
  for (const s of [sourceA, sourceB, sourceC]) {
    await probeSource(s, {
      env: { PROVIDER_A_KEY: secretA },
      fetch: async (url, opts) => {
        probedHeaders.set(url, opts.headers || {});
        return { ok: true, json: async () => ({ data: [] }) };
      },
    });
  }

  assert.equal(
    probedHeaders.get('https://a.example/v1/models').Authorization,
    'Bearer ' + secretA,
    'providerA receives its own Authorization header'
  );
  assert.equal(
    probedHeaders.get('https://b.example/v1/models').Authorization,
    undefined,
    'providerB probe sends no Authorization header'
  );
  assert.equal(
    probedHeaders.get('https://c.example/v1/models').Authorization,
    undefined,
    'providerC file-field credential is inventory-only and never read for a probe'
  );
  assert.equal(probedHeaders.size, 3, 'only model endpoints are probed');
});

test('rewrites Tencent TokenHub endpoints to the -intl host for scanned configs and models.dev cache', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'source-discovery-tencent-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const local = path.join(home, 'local');

  // 1. Scanned config (OpenCode and Cline settings)
  put(path.join(home, '.config/opencode/opencode.json'), {
    provider: {
      'tencent-scanned': {
        options: {
          baseURL: 'https://tokenhub.tencentcloudmaas.com/v1',
          apiKey: '{env:TENCENT_API_KEY}',
        },
        models: { 'tencent/hy3': {} },
      },
    },
  });

  put(path.join(home, '.cline/settings.json'), {
    apiBaseUrl: 'https://api.tokenhub.tencentcloudmaas.com/v1',
    apiKey: '{env:TENCENT_API_KEY}',
  });

  // 2. models.dev cache
  put(path.join(local, 'hermes/models_dev_cache.json'), {
    providers: {
      'tencent-cache': {
        api: 'https://tokenhub.tencentcloud.com/v1',
        env: ['TENCENT_CACHE_TOKEN'],
        models: { 'tencent/hy4': {} },
      },
      'tencent-maas-api': {
        api: 'https://api.tencentcloudmaas.com/v1',
        env: ['TENCENT_CACHE_TOKEN'],
        models: { 'tencent/hy4': {} },
      },
    },
  });

  const sources = discoverSources({
    home,
    localAppData: local,
    env: {
      TENCENT_API_KEY: 'test-tencent-key',
      TENCENT_CACHE_TOKEN: 'test-cache-token',
    },
  });

  const scannedOpencode = sources.find((s) => s.id === 'opencode-provider-tencent-scanned-options');
  assert.ok(scannedOpencode, 'scanned OpenCode source is discovered');
  assert.equal(
    scannedOpencode.endpoint,
    'https://tokenhub-intl.tencentcloudmaas.com/v1',
    'OpenCode TokenHub endpoint is rewritten to -intl host'
  );

  const scannedCline = sources.find((s) => s.id.startsWith('cline-'));
  assert.ok(scannedCline, 'scanned Cline source is discovered');
  assert.equal(
    scannedCline.endpoint,
    'https://tokenhub-intl.tencentcloudmaas.com/v1',
    'Cline TokenHub endpoint is rewritten to -intl host'
  );

  const cacheSource = sources.find((s) => s.id === 'tencent-cache');
  assert.ok(cacheSource, 'models.dev cache Tencent source is discovered');
  assert.equal(
    cacheSource.endpoint,
    'https://tokenhub-intl.tencentcloudmaas.com/v1',
    'models.dev cache TokenHub endpoint is rewritten to -intl host'
  );

  const cacheMaasSource = sources.find((s) => s.id === 'tencent-maas-api');
  assert.ok(cacheMaasSource, 'models.dev cache Maas source is discovered');
  assert.equal(
    cacheMaasSource.endpoint,
    'https://tokenhub-intl.tencentcloudmaas.com/v1',
    'models.dev cache Maas endpoint is rewritten to -intl host'
  );

  // Behavioral test with probeSource: verifies probe fetches the -intl host
  let probedUrl = null;
  await probeSource(
    {
      id: 'tencent-probe-test',
      endpoint: 'https://tokenhub.tencentcloudmaas.com/v1',
      models: [],
      credential: { type: 'env', name: 'TENCENT_API_KEY' },
    },
    {
      env: { TENCENT_API_KEY: 'secret' },
      fetch: async (url) => {
        probedUrl = url;
        return { ok: true, json: async () => ({ data: [] }) };
      },
    }
  );
  assert.equal(
    probedUrl,
    'https://tokenhub-intl.tencentcloudmaas.com/v1/models',
    'probeSource requests the -intl endpoint'
  );

  // Direct sanitizeEndpoint tests
  assert.equal(
    sanitizeEndpoint('https://tokenhub.tencentcloudmaas.com/v1'),
    'https://tokenhub-intl.tencentcloudmaas.com/v1'
  );
  assert.equal(
    sanitizeEndpoint('https://api.tokenhub.tencentcloudmaas.com/v1'),
    'https://tokenhub-intl.tencentcloudmaas.com/v1'
  );
  assert.equal(
    sanitizeEndpoint('https://tokenhub-intl.tencentcloudmaas.com/v1'),
    'https://tokenhub-intl.tencentcloudmaas.com/v1'
  );
  assert.equal(
    sanitizeEndpoint('https://tokenhub.tencentcloud.com/v1'),
    'https://tokenhub-intl.tencentcloudmaas.com/v1'
  );
  assert.equal(
    sanitizeEndpoint('https://api.tencentcloudmaas.com/v1'),
    'https://tokenhub-intl.tencentcloudmaas.com/v1'
  );
  assert.equal(
    sanitizeEndpoint('https://tokenhub.example/v1'),
    'https://tokenhub.example/v1',
    'non-Tencent host is not rewritten'
  );
});
