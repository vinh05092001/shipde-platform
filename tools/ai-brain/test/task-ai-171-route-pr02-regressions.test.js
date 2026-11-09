'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { dispatchCommand, dispatchProfileCommand } = require('../cli');
const evidence = require('../evidence');
const routing = require('../routing');
const { buildTaskProfile } = require('../orchestrate');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr02-regressions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('PR02 regression: profile dispatch keeps explicit required-health admission', async (t) => {
  const dir = tempDir(t);
  const profile = path.join(dir, 'profile.json');
  fs.writeFileSync(profile, JSON.stringify({ taskId: 'FIXTURE-TASK', role: 'writer' }));
  const candidates = [
    {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'fixture',
      upstream: 'vendor',
      accountId: 'account-b',
      quotaScope: 'account-b',
      modelId: 'vendor/model',
    },
  ];
  const original = routing.runProfileDispatch;
  routing.runProfileDispatch = (_args, deps) => deps.candidates;
  try {
    const actual = await dispatchProfileCommand(
      { profile, root: dir, 'dry-run': true },
      {
        candidates,
        accounts: [],
        registry: { sources: [], dispatch: { providers: {} } },
        routeHealth: { version: 1, paths: {}, events: [] },
        requireRouteHealth: true,
        evidenceDir: path.join(dir, 'empty-evidence'),
        dryRunOffline: true,
        home: dir,
      }
    );
    assert.equal(
      actual.length,
      0,
      'unknown-health route reached runProfileDispatch despite explicit required health'
    );
  } finally {
    routing.runProfileDispatch = original;
  }
});

test('PR02 regression: legacy unverified evidence cannot admit an account-bound offline route', (t) => {
  const dir = tempDir(t);
  const candidate = {
    source: 'fixture',
    gateway: 'fixture',
    upstream: 'vendor',
    harness: 'opencode',
    accountId: 'account-b',
    modelId: 'vendor/Exact.Case',
  };
  const data = evidence.migrateEvidence({
    version: 1,
    combinations: [
      {
        harness: 'opencode',
        gateway: 'fixture',
        upstream: 'vendor',
        modelId: candidate.modelId,
        evidence: [{ status: 'passed' }],
      },
    ],
  });
  assert.equal(data.combinations[0].legacy, true, 'migrated row must be legacy');
  assert.equal(data.combinations[0].verified, false, 'migrated row must be unverified');
  const snapshot = {
    candidates: [candidate],
    launcherModels: ['registry/' + candidate.modelId],
    registry: { sources: [], dispatch: { providers: { fixture: { modelPrefix: 'registry/' } } } },
    profile: buildTaskProfile({ id: 'TASK-AI-171' }, { enforceProofFloors: false }),
    evidenceData: data,
  };
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(snapshot));
  const result = dispatchCommand(
    {
      offline: true,
      root: dir,
      runtime: '.',
      cwd: '.',
      task: 'task.md',
      item: 'TASK-AI-171',
      snapshot: 'snapshot.json',
      'code-sha': 'a'.repeat(40),
    },
    { log: () => {}, error: () => {} }
  );
  assert.ok(result.output, 'offline dispatch must produce a decision');
  assert.equal(
    result.output.chosen,
    null,
    'unverified accountless evidence admitted an account-bound route'
  );
});

test('PR02 regression: pre-upgrade keys keep literal percent-encoded identity fields', () => {
  const { readDiscoveryCatalogue } = require('../discovery/read');
  const identity = {
    harness: 'paseo',
    accessPath: 'https://fixture.invalid/a%3Ab',
    gateway: 'fixture',
    upstream: 'vendor',
    account: 'account-b',
    quotaScope: '',
    modelId: 'vendor/model%25',
  };
  const legacyKey = [
    identity.harness,
    identity.accessPath,
    identity.gateway,
    identity.upstream,
    identity.account,
    identity.quotaScope,
    identity.modelId,
  ].join('::');
  const catalogue = readDiscoveryCatalogue({
    lines: [],
    evidence: [{ key: legacyKey, passes: 1, attempts: 1 }],
  });
  const actual = catalogue.candidates[0];
  assert.deepEqual(
    { modelId: actual.modelId, accessPath: actual.accessPath },
    { modelId: identity.modelId, accessPath: identity.accessPath }
  );
});
