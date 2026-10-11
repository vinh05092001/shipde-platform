'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverSources, probeSource, discover } = require('../source-discovery');
const candidatesApi = require('../candidates');
const sourcesApi = require('../sources');

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
});

test('parks authentication and quota responses with reason and recheck time', async () => {
  const source = { id: 'fake', endpoint: 'https://fake.example/v1', models: [], credential: null };
  const result = await probeSource(source, {
    now: '2026-10-11T00:00:00.000Z',
    fetch: async () => ({ ok: false, status: 429 }),
  });
  assert.equal(result.status, 'parked');
  assert.equal(result.reason, 'HTTP 429');
  assert.equal(result.nextCheckAt, '2026-10-11T00:15:00.000Z');
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
