'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { enumerateLiveSources } = require('../discovery/live');
const { reconcileRun } = require('../discovery/reconcile');

test('refresh runs own CLI stages in order even after failure; no false success', async () => {
  const calls = [];
  const result = await refreshCatalogue({
    persist: false,
    run: async (args) => {
      calls.push(args);
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: 'fetch failed' };
    },
  });
  assert.deepEqual(calls, [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]);
  assert.equal(result.ok, false);
  assert.equal(result.stages[0].error, 'fetch failed');
});

test('freshness uses successful observation; absent, future and >48h refuse', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-fresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');
  const write = (lastSuccessfulAt) =>
    fs.writeFileSync(path.join(dir, 'freshness.json'), JSON.stringify({ lastSuccessfulAt }));
  write('2026-10-31T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  // Exactly 48h is still fresh; one millisecond beyond it is stale.
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 1 }).stale, true);
  write('2026-11-03T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);
});

test('failed or unobserved listings never remove a prior candidate', () => {
  const prior = { key: 'old', modelId: 'old-model', state: 'AVAILABLE', sourceIds: ['provider'] };
  const base = { registry: { sources: [{ id: 'provider' }] }, current: new Map([['old', prior]]) };
  for (const results of [{}, { provider: { status: 'unknown', catalogs: [] } }])
    assert.equal(reconcileRun({ ...base, results }).transitions.length, 0);
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'enumerated', catalogs: [] } } })
      .transitions[0].state,
    'REMOVED'
  );
});

test('own live listing includes current account, each lane, and provider /models; secrets never leave adapter', async () => {
  const commands = [];
  const output = await enumerateLiveSources({
    config: {
      provider: {
        amd: {
          options: { baseURL: 'https://provider.invalid/v1', apiKey: 'test-private-value' },
          models: { obsolete: {} },
        },
      },
    },
    lanes: ['agy01', 'agy02'],
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: 'gemini-4-argon-high\tGemini\n' };
    },
    submitModels: async (lane) => {
      commands.push([lane, ['models']]);
      return { exitCode: 0, stdout: 'claude-opus-5-5-high\tClaude\n' };
    },
    fetch: async (url, init) => {
      assert.equal(url, 'https://provider.invalid/v1/models');
      assert.equal(init.headers.authorization, 'Bearer test-private-value');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'DeepSeek-V4.1-Flash' }] }),
      };
    },
  });
  assert.equal(output.results['opencode:amd'].catalogs[0].models[0], 'amd/DeepSeek-V4.1-Flash');
  assert.equal(output.results['agy01'].catalogs[0].account, 'agy01');
  assert.equal(output.results['agy-local'].catalogs[0].models[0], 'gemini-4-argon-high');
  assert.equal(commands.length, 3);
  assert.equal(JSON.stringify(output).includes('test-private-value'), false);
});

test('provider failed listing is unknown and never falls back to configured obsolete model', async () => {
  const output = await enumerateLiveSources({
    config: { provider: { p: { options: { baseURL: 'https://p.invalid' }, models: { old: {} } } } },
    lanes: [],
    runCommand: async () => ({ exitCode: 1 }),
    fetch: async () => {
      throw new Error('secret=do-not-persist');
    },
  });
  assert.equal(output.results['opencode:p'].status, 'unknown');
  assert.deepEqual(output.results['opencode:p'].catalogs, []);
  assert.equal(JSON.stringify(output).includes('do-not-persist'), false);
});

test('Finding 1 & 4: refresh rejects exit 0 with incomplete evidence, and advances freshness only when all stages genuinely succeed', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-ref-evidence-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const freshnessFile = path.join(dataDir, 'freshness.json');
  const reportFile = path.join(dataDir, 'refresh-report.json');
  const priorsFile = path.join(dir, 'model-priors.json');
  const quotaFile = path.join(dir, 'quota-state.json');

  const summaryFile = path.join(dir, 'quota-scan-summary.json');

  // Case A: discovery exits 0 but its own run-specific observation reports incomplete
  const nowA = new Date();
  fs.writeFileSync(
    freshnessFile,
    JSON.stringify({
      lastAttemptAt: nowA.toISOString(),
      lastSuccessfulAt: null,
      complete: false,
      failedSources: [{ id: 'agy-gateway', reason: 'unavailable' }],
    })
  );
  fs.writeFileSync(priorsFile, JSON.stringify({ ranking: [{ canonical: 'model-a' }] }));
  fs.writeFileSync(
    quotaFile,
    JSON.stringify({
      scopes: {
        s1: {
          source: 'src',
          scope: 'sc',
          upstream: 'http://up',
          model: 'm',
          code: 'OK',
          at: nowA.toISOString(),
        },
      },
    })
  );

  const resA = await refreshCatalogue({
    dataDir,
    reportFile,
    freshnessFile,
    priorsFile,
    quotaFile,
    summaryFile,
    run: async (args, context) => {
      if (args[0] === 'discovery') fs.copyFileSync(freshnessFile, context.discoveryFile);
      return { exitCode: 0, stderr: '' };
    },
  });
  assert.equal(resA.ok, false);
  assert.equal(resA.stages[1].exitCode, 1);
  assert.equal(resA.stages[1].error, 'DISCOVERY_INCOMPLETE');
  const freshA = JSON.parse(fs.readFileSync(freshnessFile, 'utf8'));
  assert.equal(freshA.complete, false);
  assert.equal(freshA.lastSuccessfulAt, null);
  // The discovery stage's per-source detail is preserved, not clobbered.
  assert.deepEqual(freshA.failedSources[0], { id: 'agy-gateway', reason: 'unavailable' });

  // Case B: quota-scan exits 0 but wrote 0 recent observations
  fs.writeFileSync(
    freshnessFile,
    JSON.stringify({
      lastAttemptAt: new Date().toISOString(),
      lastSuccessfulAt: null,
      complete: true,
      failedSources: [],
    })
  );
  fs.writeFileSync(quotaFile, JSON.stringify({ scopes: {} }));

  const resB = await refreshCatalogue({
    dataDir,
    reportFile,
    freshnessFile,
    priorsFile,
    quotaFile,
    summaryFile,
    run: async (args, context) => {
      if (args[0] === 'discovery') fs.copyFileSync(freshnessFile, context.discoveryFile);
      return { exitCode: 0, stderr: '' };
    },
  });
  assert.equal(resB.ok, false);
  assert.equal(resB.stages[2].exitCode, 1);
  assert.equal(resB.stages[2].error, 'QUOTA_SCAN_EMPTY_EVIDENCE');

  // Case C: Genuine success across all 3 stages advances freshness
  const now = new Date();
  fs.writeFileSync(
    freshnessFile,
    JSON.stringify({
      lastAttemptAt: now.toISOString(),
      lastSuccessfulAt: null,
      complete: true,
      failedSources: [],
    })
  );
  fs.writeFileSync(
    quotaFile,
    JSON.stringify({
      scopes: {
        s1: {
          source: 's',
          scope: 'sc',
          upstream: 'http://up',
          model: 'm',
          code: 'OK',
          at: now.toISOString(),
        },
      },
    })
  );

  const resC = await refreshCatalogue({
    dataDir,
    reportFile,
    freshnessFile,
    priorsFile,
    quotaFile,
    summaryFile,
    now: now.getTime(),
    run: async (args, context) => {
      if (args[0] === 'discovery') fs.copyFileSync(freshnessFile, context.discoveryFile);
      return { exitCode: 0, stderr: '' };
    },
  });
  assert.equal(resC.ok, true);
  const freshC = JSON.parse(fs.readFileSync(freshnessFile, 'utf8'));
  assert.equal(freshC.complete, true);
  assert.equal(freshC.lastSuccessfulAt, resC.finishedAt);
  assert.equal(catalogueFreshness({ dataDir, now: Date.parse(resC.finishedAt) }).stale, false);

  // Case D: discovery exits 0 but only left a STALE observation from a previous
  // run (exit-0 partial run that wrote nothing) must not be reported fresh.
  fs.writeFileSync(
    freshnessFile,
    JSON.stringify({
      lastAttemptAt: '2026-10-01T00:00:00Z',
      lastSuccessfulAt: null,
      complete: true,
      failedSources: [],
    })
  );
  const resD = await refreshCatalogue({
    dataDir,
    reportFile,
    freshnessFile,
    priorsFile,
    quotaFile,
    summaryFile,
    run: async (args, context) => {
      if (args[0] === 'discovery') fs.copyFileSync(freshnessFile, context.discoveryFile);
      return { exitCode: 0, stderr: '' };
    },
  });
  assert.equal(resD.ok, false);
  assert.equal(resD.stages[1].exitCode, 1);
  assert.equal(resD.stages[1].error, 'DISCOVERY_EVIDENCE_STALE');
});

test('Finding 5 & 7 & 10: quota-scan-summary and refresh-report redact upstream credentials, query params, and sensitive scopes', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-ref-redact-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const freshnessFile = path.join(dataDir, 'freshness.json');
  const reportFile = path.join(dataDir, 'refresh-report.json');
  const summaryFile = path.join(dir, 'quota-scan-summary.json');
  const priorsFile = path.join(dir, 'model-priors.json');
  const quotaFile = path.join(dir, 'quota-state.json');

  const now = new Date();
  fs.writeFileSync(
    freshnessFile,
    JSON.stringify({
      lastAttemptAt: now.toISOString(),
      lastSuccessfulAt: null,
      complete: true,
      failedSources: [],
    })
  );
  fs.writeFileSync(priorsFile, JSON.stringify({ ranking: [{ canonical: 'model-a' }] }));
  fs.writeFileSync(
    quotaFile,
    JSON.stringify({
      scopes: {
        s1: {
          source: 'operator@tenant.example.com',
          scope: 'token=super-secret-key-12345',
          upstream: 'https://admin:my-secret-password@api.provider.test/v1/chat?apikey=leak-me',
          model: 'custom-model',
          code: 'RESOURCE_EXHAUSTED',
          at: now.toISOString(),
        },
      },
    })
  );

  const result = await refreshCatalogue({
    dataDir,
    reportFile,
    freshnessFile,
    summaryFile,
    priorsFile,
    quotaFile,
    now: now.getTime(),
    run: async (args, context) => {
      if (args[0] === 'discovery') fs.copyFileSync(freshnessFile, context.discoveryFile);
      return { exitCode: 0, stderr: '' };
    },
  });
  assert.equal(result.ok, true);

  const summaryRaw = fs.readFileSync(summaryFile, 'utf8');
  assert.equal(summaryRaw.includes('my-secret-password'), false, 'must not leak password');
  assert.equal(summaryRaw.includes('leak-me'), false, 'must not leak api key in query');
  assert.equal(summaryRaw.includes('super-secret-key-12345'), false, 'must not leak token');
  assert.equal(summaryRaw.includes('operator@tenant.example.com'), false, 'must not leak email');
  assert.equal(JSON.parse(summaryRaw).scopes, undefined);
  assert.deepEqual(JSON.parse(summaryRaw).statusCounts, { RESOURCE_EXHAUSTED: 1 });
});

test('Finding 1 & 4 (staleness): the gate reads the single canonical record; failed later attempts preserve the last good observation', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-skew-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const now = Date.parse('2026-11-02T12:00:00Z');
  // Future evidence is invalid even for small clock skew.
  fs.writeFileSync(
    path.join(dir, 'freshness.json'),
    JSON.stringify({ lastSuccessfulAt: new Date(now + 30000).toISOString(), complete: true })
  );
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);

  // Larger future timestamps are also stale.
  fs.writeFileSync(
    path.join(dir, 'freshness.json'),
    JSON.stringify({ lastSuccessfulAt: new Date(now + 300000).toISOString(), complete: true })
  );
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');

  // Last success 47h ago (inside the 48h window), but the newest attempt
  // failed (report ok:false, complete:false, lastSuccessfulAt preserved).
  // BR-166-01: a failed stage preserves the last good evidence and cannot
  // advance freshness; it must not either invalidate an in-window success,
  // so the catalogue remains dispatchable (no report/freshness disagreement
  // window: the gate reads only the single canonical record).
  fs.writeFileSync(
    path.join(dir, 'freshness.json'),
    JSON.stringify({
      lastAttemptAt: '2026-11-02T11:00:00Z',
      lastSuccessfulAt: '2026-10-31T13:00:00Z',
      complete: false,
      failedSources: [{ id: 'quota-scan', reason: 'QUOTA_SCAN_EMPTY_EVIDENCE' }],
    })
  );
  fs.writeFileSync(
    path.join(dir, 'refresh-report.json'),
    JSON.stringify({ finishedAt: '2026-11-02T11:00:00Z', ok: false })
  );
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);

  // Same record aged past 48h from the last success (49h): stale again
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 2 * 60 * 60 * 1000 }).stale, true);
});
