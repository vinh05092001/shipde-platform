'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { enumerateLiveSources } = require('../discovery/live');
const { reconcileRun } = require('../discovery/reconcile');

function fixture(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataDir = path.join(dir, 'discovery');
  fs.mkdirSync(dataDir, { recursive: true });
  const files = {
    dataDir,
    freshnessFile: path.join(dataDir, 'freshness.json'),
    reportFile: path.join(dataDir, 'refresh-report.json'),
    summaryFile: path.join(dir, 'quota-scan-summary.json'),
    priorsFile: path.join(dir, 'model-priors.json'),
    quotaFile: path.join(dir, 'quota-state.json'),
  };
  const writeFresh = (record) => fs.writeFileSync(files.freshnessFile, JSON.stringify(record));
  const writeQuota = (scopes) => fs.writeFileSync(files.quotaFile, JSON.stringify({ scopes }));
  const run = async (args, context) => {
    if (args[0] === 'discovery') fs.copyFileSync(files.freshnessFile, context.discoveryFile);
    return { exitCode: 0, stderr: '' };
  };
  const refresh = (extra = {}) => refreshCatalogue({ ...files, run, ...extra });
  const fresh = () => JSON.parse(fs.readFileSync(files.freshnessFile, 'utf8'));
  return { dir, files, writeFresh, writeQuota, run, refresh, fresh };
}

// AC-166-01: Refresh runs stages in order, rejects incomplete evidence, and redacts credentials
test('AC-166-01: refresh stages run in order, reject incomplete evidence, and redact credentials', async (t) => {
  const calls = [];
  const orderedResult = await refreshCatalogue({
    persist: false,
    run: async (args) => {
      calls.push(args);
      return { exitCode: calls.length === 1 ? 1 : 0, stderr: 'fetch failed' };
    },
  });
  assert.deepEqual(calls, [['priors', 'refresh'], ['discovery', 'run'], ['quota-scan']]);
  assert.equal(orderedResult.ok, false);
  assert.equal(orderedResult.stages[0].error, 'fetch failed');

  const now = new Date();
  const f = fixture(t, 'ai166-ac01-');
  f.writeFresh({ lastAttemptAt: now.toISOString(), lastSuccessfulAt: null, complete: true, failedSources: [] });
  fs.writeFileSync(f.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  f.writeQuota({
    s1: {
      source: 'operator@tenant.example.com',
      scope: 'token=super-secret-12345',
      upstream: 'https://admin:my-secret-pw@api.test/v1?apikey=leak-me',
      model: 'custom-m',
      code: 'OK',
      at: now.toISOString(),
    },
  });
  const okResult = await f.refresh({ now: now.getTime() });
  assert.equal(okResult.ok, true);
  assert.equal(f.fresh().complete, true);
  assert.equal(f.fresh().lastSuccessfulAt, okResult.finishedAt);

  const summary = fs.readFileSync(f.files.summaryFile, 'utf8');
  assert.equal(/my-secret-pw|leak-me|super-secret-12345|operator@tenant/.test(summary), false);
  assert.deepEqual(JSON.parse(summary).statusCounts, { OK: 1 });

  // Incomplete evidence rejects exit 0
  const bad = fixture(t, 'ai166-ac01-bad-');
  bad.writeFresh({ lastAttemptAt: now.toISOString(), complete: false, failedSources: [{ id: 'src', reason: 'fail' }] });
  fs.writeFileSync(bad.files.priorsFile, JSON.stringify({ ranking: [{ canonical: 'm-a' }] }));
  bad.writeQuota({ s1: { code: 'OK', at: now.toISOString() } });
  const badResult = await bad.refresh();
  assert.equal(badResult.ok, false);
  assert.equal(badResult.stages[1].error, 'DISCOVERY_INCOMPLETE');
});

// AC-166-02: Live discovery enumerates sources, handles unknown providers, and preserves prior candidates
test('AC-166-02: live discovery enumerates sources, handles unknown providers, and preserves prior candidates', async () => {
  const commands = [];
  const output = await enumerateLiveSources({
    config: {
      provider: {
        amd: {
          options: { baseURL: 'https://provider.invalid/v1', apiKey: 'private-secret' },
          models: { obsolete: {} },
        },
      },
    },
    lanes: ['agy01'],
    runCommand: async (cmd, args) => {
      commands.push([cmd, args]);
      return { exitCode: 0, stdout: 'gemini-4-flash\tGemini\n' };
    },
    submitModels: async (lane) => {
      commands.push([lane, ['models']]);
      return { exitCode: 0, stdout: 'claude-3-5\tClaude\n' };
    },
    fetch: async (url, init) => {
      assert.equal(init.headers.authorization, 'Bearer private-secret');
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'DeepSeek-V4' }] }) };
    },
  });
  assert.equal(output.results['opencode:amd'].catalogs[0].models[0], 'amd/DeepSeek-V4');
  assert.equal(output.results['agy01'].catalogs[0].account, 'agy01');
  assert.equal(output.results['agy-local'].catalogs[0].models[0], 'gemini-4-flash');
  assert.equal(JSON.stringify(output).includes('private-secret'), false);

  // Failed provider is marked unknown, does not fall back to obsolete
  const failed = await enumerateLiveSources({
    config: { provider: { p: { options: { baseURL: 'https://p.invalid' }, models: { obsolete: {} } } } },
    lanes: [],
    runCommand: async () => ({ exitCode: 1 }),
    fetch: async () => {
      throw new Error('secret=leak');
    },
  });
  assert.equal(failed.results['opencode:p'].status, 'unknown');
  assert.deepEqual(failed.results['opencode:p'].catalogs, []);
  assert.equal(JSON.stringify(failed).includes('leak'), false);

  // Reconciliation: failed or unobserved listings never remove prior candidates
  const prior = { key: 'old', modelId: 'old-model', state: 'AVAILABLE', sourceIds: ['provider'] };
  const base = { registry: { sources: [{ id: 'provider' }] }, current: new Map([['old', prior]]) };
  assert.equal(reconcileRun({ ...base, results: {} }).transitions.length, 0);
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'unknown', catalogs: [] } } }).transitions.length,
    0
  );
  assert.equal(
    reconcileRun({ ...base, results: { provider: { status: 'enumerated', catalogs: [] } } }).transitions[0].state,
    'REMOVED'
  );
});

// AC-166-03: Catalogue freshness gate refuses absent, future or >48h observations, preserving prior success
test('AC-166-03: catalogue freshness gate refuses absent, future or >48h observations, preserving prior success', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai166-ac03-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const now = Date.parse('2026-11-02T12:00:00Z');
  const write = (lastSuccessfulAt, complete = true, extra = {}) =>
    fs.writeFileSync(path.join(dir, 'freshness.json'), JSON.stringify({ lastSuccessfulAt, complete, ...extra }));

  // Missing freshness refuses STALE_CATALOGUE
  assert.equal(catalogueFreshness({ dataDir: dir, now }).code, 'STALE_CATALOGUE');

  // Valid 48h observation is fresh; 48h + 1ms is stale
  write('2026-10-31T12:00:00Z');
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 1 }).stale, true);

  // Future timestamp is refused
  write(new Date(now + 1000).toISOString());
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, true);

  // Failed later attempt preserves last good successful observation within window
  write('2026-10-31T13:00:00Z', false, {
    lastAttemptAt: '2026-11-02T11:00:00Z',
    failedSources: [{ id: 'quota-scan', reason: 'QUOTA_SCAN_EMPTY_EVIDENCE' }],
  });
  assert.equal(catalogueFreshness({ dataDir: dir, now }).stale, false);
  // Same record aged past 48h from last success is stale
  assert.equal(catalogueFreshness({ dataDir: dir, now: now + 2 * 3600000 }).stale, true);
});
