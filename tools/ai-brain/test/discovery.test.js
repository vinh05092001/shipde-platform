'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { candidateKey, modelBase, registryPrefixes } = require('../discovery/identity');
const { buildSnapshot } = require('../discovery/snapshot');
const { reconcileRun } = require('../discovery/reconcile');
const {
  readCatalogue,
  appendLine,
  DISCOVERY_WRITABLE,
  currentState,
} = require('../discovery/store');
const { importCheckpoint, isProbeInvalid } = require('../discovery/import');
const { enumerate, NOT_PERMITTED } = require('../discovery/adapters');

function registryOnly(registry) {
  const sources = (registry.sources || []).filter((s) => s && s.id);
  const dispatch = (registry.dispatch || {}).providers || {};
  return {
    registry,
    sourcesById: Object.fromEntries(sources.map((s) => [s.id, s])),
    dispatch,
  };
}

function okHttp(entries) {
  return (url) =>
    Promise.resolve({
      ok: true,
      status: 200,
      body: JSON.stringify(entries),
      parsed: { object: 'list', data: entries },
      request: { url },
      error: null,
    });
}

function makeRegistry() {
  return {
    sources: [
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        endpoint: 'http://127.0.0.1:20128/v1',
        modelPrefix: 'ninerouter/',
        verify: { method: 'models-list', path: '/models' },
      },
      {
        id: 'xkiro',
        kind: 'model-source',
        servesModels: true,
        reachedVia: '9router',
        routerAlias: 'kr',
      },
      { id: 'bai', kind: 'model-source', servesModels: true },
      {
        id: 'tencent',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://tokenhub.example/v1',
        verify: { method: 'completion' },
      },
      { id: 'codex', kind: 'agent-cli', servesModels: false },
      { id: 'cline', kind: 'agent-cli', servesModels: false },
      { id: 'paseo', kind: 'orchestrator', servesModels: false, harness: 'paseo' },
      { id: 'hermes', kind: 'harness', servesModels: false },
      { id: 'jev', kind: 'decision-service', servesModels: false },
      { id: 'agy-local', kind: 'agent-cli', servesModels: true, harness: 'agy' },
    ],
    dispatch: {
      providers: {
        'claude-code': { harness: 'paseo', provider: 'claude' },
        '9router': { harness: 'paseo', provider: 'opencode', modelPrefix: 'ninerouter/' },
        codex: { harness: 'paseo', provider: 'codex' },
      },
    },
  };
}

function runResults(overrides) {
  const base = { status: 'enumerated', reason: null };
  return Object.assign({}, overrides);
}

test('candidateKey is stable, unique per route and contains no secret', () => {
  const a = {
    harness: 'http',
    accessPath: '9router',
    gateway: '9router',
    upstream: 'gh',
    account: '',
    modelId: 'gh/gpt-4.1-2025-04-14',
  };
  const b = {
    harness: 'paseo',
    accessPath: 'paseo',
    gateway: 'opencode',
    upstream: 'ninerouter',
    account: '',
    modelId: 'ninerouter/gh/gpt-4.1',
  };
  const again = {
    harness: 'http',
    accessPath: '9router',
    gateway: '9router',
    upstream: 'gh',
    account: '',
    modelId: 'gh/gpt-4.1-2025-04-14',
  };
  assert.equal(candidateKey(a), candidateKey(again));
  assert.notEqual(candidateKey(a), candidateKey(b));
  const k = candidateKey(a);
  assert.equal(k.indexOf('9router') !== -1, true);
  assert.equal(k.indexOf('Bearer'), -1);
  assert.equal(k.indexOf('sk-'), -1);
});

test('modelBase collapses routing prefixes and version dates, respects bare dates', () => {
  const prefixes = ['ninerouter/'];
  assert.equal(modelBase('ninerouter/gh/gpt-4.1', prefixes), 'gh/gpt-4.1');
  assert.equal(modelBase('gh/gpt-4.1-2025-04-14', prefixes), 'gh/gpt-4.1');
  assert.equal(modelBase('kr/some-2025-04-14', prefixes), 'kr/some');
  assert.equal(modelBase('gh/gpt-4.1-2025-04-14\r', prefixes), 'gh/gpt-4.1');
});

test('registryPrefixes is data-driven and longest-first', () => {
  const prefixes = registryPrefixes(makeRegistry());
  assert.deepEqual(prefixes, ['ninerouter/']);
  const two = registryPrefixes({
    sources: [
      { id: 'a', modelPrefix: 'ab/' },
      { id: 'b', modelPrefix: 'a/' },
    ],
    dispatch: { providers: { c: { harness: 'paseo', provider: 'p', modelPrefix: 'abc/' } } },
  });
  assert.deepEqual(two, ['abc/', 'ab/', 'a/']);
});

// ---------- reconcile: two access paths, different catalogues ----------

function fixtureTwoPaths() {
  const registry = makeRegistry();
  const prefixes = registryPrefixes(registry);
  const results = runResults({
    '9router': {
      status: 'enumerated',
      catalogs: [
        {
          upstream: 'gh',
          gateway: '9router',
          accessPath: '9router',
          harness: 'http',
          count: 1,
          models: ['gh/gpt-4.1-2025-04-14'],
        },
        {
          upstream: 'kr',
          gateway: '9router',
          accessPath: '9router',
          harness: 'http',
          count: 1,
          models: ['kr/claude-sonnet-4-6'],
        },
      ],
    },
    paseo: {
      status: 'enumerated',
      catalogs: [
        {
          upstream: 'ninerouter',
          gateway: 'opencode',
          accessPath: 'paseo',
          harness: 'paseo',
          count: 1,
          models: ['ninerouter/gh/gpt-4.1'],
        },
      ],
    },
  });
  return { registry, prefixes, results, now: '2026-09-24T12:00:00.000Z', runId: 't1' };
}

test('reconcile keeps two access paths as two candidates', () => {
  const fix = fixtureTwoPaths();
  const out = reconcileRun({ ...fix, current: new Map() });
  assert.equal(out.snapshot.candidates.length, 3);
  const http = out.snapshot.candidates.find(
    (c) => c.harness === 'http' && c.modelId === 'gh/gpt-4.1-2025-04-14'
  );
  const paseo = out.snapshot.candidates.find((c) => c.harness === 'paseo');
  assert.ok(http);
  assert.ok(paseo);
  assert.notEqual(http.key, paseo.key);
  assert.equal(http.base, 'gh/gpt-4.1');
  assert.equal(paseo.base, 'gh/gpt-4.1');
  assert.equal(http.modelId, 'gh/gpt-4.1-2025-04-14'); // raw identity preserved
  assert.equal(out.transitions.length, 3);
  assert.ok(out.transitions.every((t) => t.state === 'UNKNOWN'));
  assert.ok(out.transitions.every((t) => DISCOVERY_WRITABLE.has(t.state)));
});

test('alias differs by path and sharedQuota is unknown unless proven', () => {
  const fix = fixtureTwoPaths();
  const out = reconcileRun({ ...fix, current: new Map() });
  const alias = out.snapshot.aliases.find((a) => a.base === 'gh/gpt-4.1');
  assert.ok(alias);
  assert.equal(alias.paths.length, 2);
  const byAp = Object.fromEntries(alias.paths.map((p) => [p.accessPath, p]));
  assert.ok(byAp['9router']);
  assert.ok(byAp.paseo);
  assert.notEqual(byAp['9router'].modelId, byAp.paseo.modelId);
  assert.notEqual(byAp['9router'].key, byAp.paseo.key);
  assert.equal(alias.sharedQuota, 'unknown');
  assert.ok(alias.evidence);
});

test('injectable shared-quota comparator can prove a verdict with evidence', () => {
  const fix = fixtureTwoPaths();
  const out = reconcileRun({
    ...fix,
    current: new Map(),
    classifyShared: () => ({
      sharedQuota: 'same',
      evidence: 'both paths terminate on the same gateway account; verified without secrets',
    }),
  });
  const alias = out.snapshot.aliases.find((a) => a.base === 'gh/gpt-4.1');
  assert.equal(alias.sharedQuota, 'same');
  assert.equal(
    alias.evidence,
    'both paths terminate on the same gateway account; verified without secrets'
  );
});

// ---------- reconcile: model on one path only, then disappears ----------

test('a model seen on one path then absent is REMOVED with history intact', () => {
  const fix = fixtureTwoPaths();
  const run1 = reconcileRun({ ...fix, current: new Map() });
  const storeLines = [];
  for (const t of run1.transitions) storeLines.push(t);
  const current1 = readCatalogueFrom(storeLines);

  const run2Results = runResults({
    '9router': {
      status: 'enumerated',
      catalogs: [
        {
          upstream: 'gh',
          gateway: '9router',
          accessPath: '9router',
          harness: 'http',
          count: 1,
          models: ['gh/gpt-4.1-2025-04-14'],
        },
        {
          upstream: 'kr',
          gateway: '9router',
          accessPath: '9router',
          harness: 'http',
          count: 1,
          models: ['kr/claude-sonnet-4-6'],
        },
      ],
    },
    paseo: { status: 'enumerated', catalogs: [] },
  });
  const run2 = reconcileRun({
    ...fix,
    results: run2Results,
    current: current1,
    now: '2026-09-24T13:00:00.000Z',
    runId: 't2',
  });

  assert.equal(run2.transitions.length, 1);
  const removed = run2.transitions[0];
  assert.equal(removed.state, 'REMOVED');
  assert.equal(removed.modelId, 'ninerouter/gh/gpt-4.1');

  // Append-only: the run-1 UNKNOWN line is still in the ledger.
  const current2 = readCatalogueFrom([...storeLines, ...run2.transitions]);
  assert.equal(
    current2.get('paseo\u241fpaseo\u241fopencode\u241fninerouter\u241f\u241fninerouter/gh/gpt-4.1')
      .state,
    'REMOVED'
  );
  const records = [...storeLines, ...run2.transitions];
  const history = records.filter((l) => l.modelId === 'ninerouter/gh/gpt-4.1');
  assert.deepEqual(
    history.map((l) => l.state),
    ['UNKNOWN', 'REMOVED']
  );
});

test('unchanged advertisement is a no-op (state UNKNOWN stays UNKNOWN)', () => {
  const fix = fixtureTwoPaths();
  const run1 = reconcileRun({ ...fix, current: new Map() });
  const run2 = reconcileRun({
    ...fix,
    current: readCatalogueFrom(run1.transitions),
    now: '2026-09-24T13:00:00.000Z',
    runId: 't2',
  });
  assert.equal(run2.transitions.length, 0);
  assert.equal(run2.perState.UNKNOWN, run1.transitions.length);
});

test('a re-advertised REMOVED candidate returns to UNKNOWN, never AVAILABLE', () => {
  const fix = fixtureTwoPaths();
  const run1 = reconcileRun({ ...fix, current: new Map() });
  const current1 = readCatalogueFrom(run1.transitions);
  const run2 = reconcileRun({
    ...fix,
    results: runResults({
      '9router': { status: 'enumerated', catalogs: [] },
      paseo: { status: 'enumerated', catalogs: [] },
    }),
    current: current1,
    now: '2026-09-24T13:00:00.000Z',
    runId: 't2',
  });
  const run3 = reconcileRun({
    ...fix,
    current: readCatalogueFrom([...run1.transitions, ...run2.transitions]),
    now: '2026-09-24T14:00:00.000Z',
    runId: 't3',
  });
  const states = run3.transitions.map((t) => t.state);
  assert.deepEqual(states, ['UNKNOWN', 'UNKNOWN', 'UNKNOWN']);
  assert.equal(states.includes('AVAILABLE'), false);
});

test('a listing never promotes or demotes a judged state', () => {
  const fix = fixtureTwoPaths();
  const current = new Map();
  const httpKey = 'http\u241f9router\u241f9router\u241fgh\u241f\u241fgh/gpt-4.1-2025-04-14';
  current.set(httpKey, {
    key: httpKey,
    harness: 'http',
    accessPath: '9router',
    gateway: '9router',
    upstream: 'gh',
    account: '',
    modelId: 'gh/gpt-4.1-2025-04-14',
    base: 'gh/gpt-4.1',
    sourceIds: ['9router'],
    state: 'AVAILABLE',
    ts: '2026-09-24T10:00:00.000Z',
  });
  const out = reconcileRun({ ...fix, current, now: '2026-09-24T13:00:00.000Z', runId: 't-judged' });
  // AVAILABLE is not in DISCOVERY_WRITABLE, so no transition is emitted for it.
  const touched = out.transitions.filter((t) => t.key === httpKey);
  assert.equal(touched.length, 0);
});

// ---------- snapshot: durability, sourceIds ----------

test('snapshot is versioned and path-precise', () => {
  const fix = fixtureTwoPaths();
  const snap = buildSnapshot({
    registry: fix.registry,
    prefixes: fix.prefixes,
    results: fix.results,
    now: '2026-09-24T12:00:00.000Z',
    runId: 't1',
  });
  assert.equal(snap.schema, 'shipde/discovery-snapshot');
  assert.equal(snap.version, 1);
  assert.equal(snap.generatedAt, '2026-09-24T12:00:00.000Z');
  assert.equal(snap.catalogues.length, 2, 'only sources with a result are recorded');
  const nine = snap.catalogues.find((c) => c.sourceId === '9router');
  assert.deepEqual(nine.catalogs.map((c) => c.upstream).sort(), ['gh', 'kr']);
});

// ---------- reconcile: source added through data only ----------

test('a source added to registry data enumerates without any code change', () => {
  const registry = makeRegistry();
  registry.sources.push({
    id: 'newvendor',
    kind: 'model-source',
    servesModels: true,
    endpoint: 'https://new.example/v1',
    verify: { method: 'completion' },
  });
  const results = runResults({
    '9router': {
      status: 'enumerated',
      catalogs: [
        {
          upstream: 'gh',
          gateway: '9router',
          accessPath: '9router',
          harness: 'http',
          count: 1,
          models: ['gh/gpt-4.1-2025-04-14'],
        },
      ],
    },
    newvendor: {
      status: 'enumerated',
      catalogs: [
        {
          upstream: 'newvendor',
          gateway: '',
          accessPath: 'newvendor',
          harness: 'http',
          count: 1,
          models: ['ka-1'],
        },
      ],
    },
  });
  const out = reconcileRun({
    registry,
    prefixes: registryPrefixes(registry),
    results,
    current: new Map(),
    now: '2026-09-24T12:00:00.000Z',
    runId: 't-new',
  });
  const newCand = out.snapshot.candidates.find((c) => c.upstream === 'newvendor');
  assert.ok(newCand);
  assert.deepEqual(newCand.sourceIds, ['newvendor']);
});

test('a source removed from registry data is absent with no enumeration path left', () => {
  // Simulate: pipeline results carry nothing for a source that is gone.
  const fix = fixtureTwoPaths();
  const out = reconcileRun({
    ...fix,
    results: runResults({ '9router': { status: 'enumerated', catalogs: [] } }),
    current: new Map(),
  });
  assert.equal(
    out.snapshot.catalogues.some((c) => c.sourceId === 'paseo'),
    false
  );
});

// ---------- adapters: data-driven, no completions, no banned CLI ----------

test('9router adapter splits catalogues by owned_by (multi-account gateway)', async () => {
  const seen = [];
  const res = await enumerate(makeRegistry().sources[0], {
    httpGet: (url, opts) => {
      seen.push(url);
      return okHttp([
        { id: 'gh/a', owned_by: 'gh' },
        { id: 'kr/b', owned_by: 'kr' },
        { id: 'gh/c', owned_by: 'gh' },
      ])(url);
    },
  });
  assert.equal(res.status, 'enumerated');
  assert.deepEqual(res.catalogs.map((c) => c.upstream).sort(), ['gh', 'kr']);
  assert.equal(res.catalogs.find((c) => c.upstream === 'gh').models.length, 2);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /\/models$/);
});

test('model-source without endpoint and without reachedVia is honest unknown', async () => {
  const bai = makeRegistry().sources.find((s) => s.id === 'bai');
  const res = await enumerate(bai, {});
  assert.equal(res.status, 'unknown');
  assert.match(res.reason, /no endpoint/);
});

test('reachedVia model-source maps through gateway alias and its candidates collide with the route', async () => {
  const registry = makeRegistry();
  const routerResult = {
    status: 'enumerated',
    catalogs: [
      {
        upstream: 'kr',
        gateway: '9router',
        accessPath: '9router',
        harness: 'http',
        count: 2,
        models: ['kr/m1', 'kr/m2'],
      },
    ],
  };
  const res = await enumerate(
    registry.sources.find((s) => s.id === 'xkiro'),
    { lookupRoute: () => routerResult }
  );
  assert.equal(res.status, 'enumerated-via-route');
  assert.deepEqual(res.mapped, { via: '9router', upstream: 'kr' });
  assert.equal(res.catalogs[0].models.length, 2);
});

test('codex agent-cli is not-permitted and nothing is invoked for it', async () => {
  const codex = makeRegistry().sources.find((s) => s.id === 'codex');
  let spawned = 0;
  const res = await enumerate(codex, {
    runCommand: async () => {
      spawned += 1;
      return { exitCode: 0, stdout: '', stderr: '' };
    },
    resolveCommand: () => ({ found: true }),
  });
  assert.equal(res.status, 'not-permitted');
  assert.match(res.reason, /banned/);
  assert.equal(spawned, 0);
});

test('agent-cli servesModels:false resolves to no-models without enumeration', async () => {
  const cline = makeRegistry().sources.find((s) => s.id === 'cline');
  const res = await enumerate(cline, {});
  assert.equal(res.status, 'no-models');
});

test('agy-local presents presence and reports unknown catalogue (cannot drive other users)', async () => {
  const agy = makeRegistry().sources.find((s) => s.id === 'agy-local');
  let resolved = 0;
  const res = await enumerate(agy, {
    resolveCommand: (name) => {
      resolved += 1;
      return { found: true, kind: 'exe', file: 'C:/agy/agy.exe' };
    },
  });
  assert.equal(res.status, 'unknown');
  assert.equal(res.presence.found, true);
  assert.ok(resolved >= 1);
  assert.match(res.reason, /Windows user/, 'the reason names the Windows-user boundary');
});

test('hermes and jev expose no catalogue', async () => {
  assert.equal(
    (
      await enumerate(
        makeRegistry().sources.find((s) => s.id === 'hermes'),
        {}
      )
    ).status,
    'no-models'
  );
  assert.equal(
    (
      await enumerate(
        makeRegistry().sources.find((s) => s.id === 'jev'),
        {}
      )
    ).status,
    'no-models'
  );
});

test('orchestrator lists dispatch providers but skips the banned codex provider', async () => {
  const paseo = makeRegistry().sources.find((s) => s.id === 'paseo');
  const calls = [];
  const res = await enumerate(paseo, {
    registry: makeRegistry(),
    runCommand: async (file, args) => {
      const provider = args[2];
      calls.push(provider);
      if (provider === 'claude')
        return { exitCode: 0, stdout: JSON.stringify([{ id: 'claude-opus-5' }]) };
      if (provider === 'opencode')
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ id: 'ninerouter/gh/gpt-4.1' }, { id: 'requesty/gpt-5.5' }]),
        };
      return { exitCode: 1, stdout: '', stderr: 'missing' };
    },
  });
  assert.equal(calls.includes('codex'), false, 'codex provider is never invoked');
  const runners = res.catalogs;
  assert.ok(runners.some((c) => c.upstream === 'claude'));
  assert.ok(runners.some((c) => c.upstream === 'ninerouter'));
  assert.ok(runners.some((c) => c.upstream === 'requesty'));
  assert.equal(
    runners.every((c) => c.harness === 'paseo'),
    true
  );
});

// ---------- import ----------

test('PROBE_INVALID rows are never reported as model failures', async () => {
  const probeRow = {
    timestamp: '2026-09-24T09:32:27.789Z',
    harness: 'http',
    accessPath: '9router',
    upstreamOrAccount: 'ag',
    model: 'ag/gemini-3.8-flash-high',
    modelIdHttp: 'ag/gemini-3.8-flash-high',
    modelIdOpenCode: null,
    levelAttempted: 1,
    levelName: 'API_ANSWERS',
    status: 'FAIL',
    latencyMs: 48,
    reason: 'answered',
    errorClass: 'unknown',
    scope: 'unknown',
    attemptCount: 1,
    cost: null,
    contentLength: 0,
  };
  const failRow = {
    timestamp: '2026-09-24T09:33:21.409Z',
    harness: 'paseo',
    accessPath: 'opencode',
    upstreamOrAccount: 'agentrouter',
    model: 'agentrouter/claude-opus-4-8\r',
    modelIdHttp: null,
    modelIdOpenCode: 'agentrouter/claude-opus-4-8\r',
    status: 'FAIL',
    reason: 'exit code 1',
    errorClass: 'budget',
    contentLength: 0,
  };
  const passRow = {
    timestamp: '2026-09-24T09:34:00.000Z',
    harness: 'http',
    accessPath: '9router',
    upstreamOrAccount: 'gh',
    model: 'gh/bar',
    modelIdHttp: 'gh/bar',
    modelIdOpenCode: null,
    status: 'PASS',
    reason: 'ok',
    errorClass: null,
    contentLength: 5,
  };
  const file = makeTempFile([probeRow, failRow, passRow].map((r) => JSON.stringify(r)).join('\n'));
  const entry = await importCheckpoint(file, { prefixes: ['ninerouter/'] });
  assert.equal(entry.probeInvalid, 1);
  assert.equal(entry.failureTotal, 1);
  assert.deepEqual(entry.failuresByClass, { budget: 1 });
  assert.equal(entry.passes, 1);
  assert.equal(entry.rowsWithModel, 3, 'all three model ids are still advertising evidence');
  assert.equal(isProbeInvalid(probeRow), true);
  assert.equal(isProbeInvalid(failRow), false);

  const paseoCand = entry.candidates.find((c) => c.accessPath === 'opencode');
  assert.equal(paseoCand.modelId, 'agentrouter/claude-opus-4-8', 'trailing CR trimmed');
  assert.equal(paseoCand.upstream, 'agentrouter', 'upstream follows the id prefix rule');
  assert.equal(paseoCand.base, 'agentrouter/claude-opus-4-8');
});

function makeTempFile(text) {
  const os = require('os');
  const path = require('path');
  const f = path.join(
    os.tmpdir(),
    `discovery-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`
  );
  require('fs').writeFileSync(f, text, 'utf8');
  return f;
}

function readCatalogueFrom(records) {
  return currentState(records.map((r) => JSON.parse(JSON.stringify(r))));
}

test('store appends and reads catalogue, last line per key wins', () => {
  const lines = [];
  const io = { appendFile: (p, text) => lines.push(text), readFile: () => lines.join('') };
  const file = 'ledger.jsonl';
  appendLine(file, { type: 'transition', ts: 't1', key: 'k1', state: 'UNKNOWN' }, io);
  appendLine(file, { type: 'transition', ts: 't2', key: 'k2', state: 'UNKNOWN' }, io);
  appendLine(file, { type: 'transition', ts: 't3', key: 'k1', state: 'REMOVED' }, io);
  const out = readCatalogue(file, io);
  assert.equal(out.length, 3);
  assert.equal(out[0].key, 'k1');
  assert.equal(out[2].state, 'REMOVED');
});

test('discovery may only write UNKNOWN and REMOVED', () => {
  assert.deepEqual([...DISCOVERY_WRITABLE].sort(), ['REMOVED', 'UNKNOWN']);
  assert.ok(NOT_PERMITTED.codex);
});
