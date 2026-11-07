'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { refreshCatalogue, catalogueFreshness } = require('../catalogue-refresh');
const { scanScope } = require('../quota-scan');
const { dispatchCommand } = require('../cli');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(__dirname, 'refresh-fixture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const opts = { dataDir: dir, priorsFile: path.join(dir, 'priors.json'), log: () => {} };
  fs.writeFileSync(opts.priorsFile, JSON.stringify({ ranking: [] }));
  let posts = 0;
  const fetch = async (_url, init) => {
    if (init?.method === 'POST') posts++;
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'fixture' } }] }),
    };
  };
  const run = async (args, ctx) => {
    if (args[0] === 'discovery') {
      const at = new Date().toISOString();
      fs.writeFileSync(
        ctx.discoveryFile,
        JSON.stringify({
          lastAttemptAt: at,
          lastSuccessfulAt: at,
          listedSources: 1,
          complete: false,
          failedSources: [{ id: 'bad', reason: 'FETCH_FAILED' }],
          sources: [
            { id: 'ok', status: 'enumerated', durationMs: 1 },
            { id: 'bad', status: 'unknown', reason: 'FETCH_FAILED', durationMs: 2 },
          ],
        })
      );
    }
    if (args[0] === 'quota-scan')
      await scanScope(
        { endpoint: 'https://fixture.invalid/v1', model: 'fixture-model', source: 'fixture' },
        { fetch, env: {}, registry: { sources: [] } }
      );
    return { exitCode: 0 };
  };
  return { dir, opts, run, fetch, posts: () => posts };
}

test('refresh defaults to lists only: zero inference POSTs', async (t) => {
  const f = fixture(t);
  const report = await refreshCatalogue({ ...f.opts, run: f.run });
  assert.equal(f.posts(), 0);
  assert.equal(report.ok, true);
  assert.equal(catalogueFreshness({ dataDir: f.dir }).stale, false);
  assert.deepEqual(
    report.sources.map((s) => s.id),
    ['ok', 'bad']
  );
  assert.ok(report.stages.every((s) => Number.isFinite(s.durationMs)));
});

test('explicit probe runs inference after discovery freshness is durable', async (t) => {
  const f = fixture(t);
  await refreshCatalogue({
    ...f.opts,
    probe: true,
    verifyEvidence: false,
    run: async (args, ctx) => {
      if (args[0] === 'quota-scan') {
        assert.equal(catalogueFreshness({ dataDir: f.dir }).stale, false);
      }
      return f.run(args, ctx);
    },
  });
  assert.ok(f.posts() > 0);
});

test('dry-run makes no inference call through onboarding, route probes or JEV', async (t) => {
  const f = fixture(t);
  const rolling = require('../rolling-onboard');
  t.mock.method(rolling, 'autoOnboardNewSources', async () => {
    await f.fetch('https://fixture.invalid/chat/completions', { method: 'POST' });
  });
  await dispatchCommand(
    { item: 'TASK-AI-166', 'dry-run': true },
    {
      registry: {
        sources: [{ id: 'fixture', servesModels: true, credential: { env: 'FIXTURE_KEY' } }],
      },
      env: { FIXTURE_KEY: 'fake' },
      discoveryCatalogue: { candidates: [] },
      evidenceDir: f.dir,
      decisionDir: f.dir,
      accounts: [],
      home: f.dir,
      storePath: path.join(f.dir, 'quota.json'),
      refreshRoutes: true,
      routeHealth: { models: {} },
      readDispatchComboConfig: async () => ({ name: 'fixture', state: 'READ', members: [] }),
      probeRoute: async () => {
        throw new Error('unexpected route probe');
      },
      jevAsk: async () => {
        await f.fetch('https://fixture.invalid/chat/completions', { method: 'POST' });
        throw new Error('fixture');
      },
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );
  assert.equal(f.posts(), 0);
});
