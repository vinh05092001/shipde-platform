'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dispatchCommand } = require('../cli');
const { getHarness } = require('../harness');
const { readSessionId } = require('../executor');
const { candidateKey } = require('../candidates');
const decisions = require('../decisions');
const quota = require('../quota-store');
const BASE = '0123456789abcdef0123456789abcdef01234567';

function dispatch(t, kind, mode = 'ack') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-lifecycle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const prompt = path.join(root, 'prompt.md');
  fs.writeFileSync(prompt, 'Bounded fixture task.');
  const usageFile = path.join(root, 'usage.json');
  const checkpoint = path.join(root, 'checkpoint.json');
  const c = {
    harness: kind,
    source: kind === 'agy-pool' ? 'agy-pool' : '9router',
    accessPath: kind === 'agy-pool' ? 'ShipDe\\ShipDe-agy01' : 'http://127.0.0.1:20128/v1',
    gateway: kind === 'agy-pool' ? '' : '9router',
    upstream: kind === 'agy-pool' ? 'antigravity' : 'cmc',
    modelId: kind === 'agy-pool' ? 'gemini-4-argon-high' : 'cmc/moonshotai/Kimi-K3.1-Pro',
    accountId: 'agy01',
    quotaScope: 'agy01:gemini',
    quality: 90,
    cost: 1,
    qualifiedRoles: ['author.foundation'],
  };
  const key = candidateKey(c);
  quota.recordReservation('OTHER-WORK', 'writer', 'agy02', 'other-key', 10, { home: root });
  const registry = structuredClone(require('../sources').loadSources());
  for (const source of registry.sources) {
    delete source.credential;
    delete source.apiKeyEnv;
  }
  const actual = getHarness(kind);
  let calls = 0;
  const adapter = {
    ...actual,
    onLaunchFailed(job, result) {
      return actual.onLaunchFailed?.(job, result, { fakeRunsDir: path.join(root, 'pool') });
    },
    launch(job) {
      return actual.launch(job, { fakeRunsDir: path.join(root, 'pool') });
    },
  };
  const result = dispatchCommand(
    {
      execute: true,
      json: true,
      cwd: root,
      item: 'TASK-AI-171-LIFECYCLE',
      'base-sha': BASE,
      'prompt-file': prompt,
      ...(mode === 'no-report' ? {} : { 'usage-report': usageFile }),
    },
    {
      candidates: [c],
      registry,
      maxAttempts: 1,
      concurrency: 1,
      checkpointFile: checkpoint,
      quotaState: { scopes: {} },
      routeHealth: { version: 1, paths: {}, events: [] },
      scoringPolicyFile: path.join(root, 'no-scoring-policy.json'),
      home: root,
      decisionDir: root,
      evidenceDir: root,
      baseSha: BASE,
      gitRoot: () => root,
      commitExists: () => true,
      log: () => {},
      error: () => {},
      exit: () => {},
      harnessAdapter: adapter,
      probeEvidence: () => true,
      run: () => {
        calls++;
        if (kind === 'hermes') {
          fs.writeFileSync(usageFile, JSON.stringify({ session_id: 'hermes-run-ended' }));
          return { exitCode: mode === 'failure' ? 1 : 0, stdout: '' };
        }
        if (mode === 'wrong-account') {
          const report = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
          report.accountId = 'agy02';
          fs.writeFileSync(usageFile, JSON.stringify(report));
        }
        if (mode === 'invalid-handle') {
          const report = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
          report.nativeJobId = '';
          fs.writeFileSync(usageFile, JSON.stringify(report));
        }
        if (mode === 'malformed-report') fs.writeFileSync(usageFile, 'not-json');
        if (mode === 'timeout') return { exitCode: -1, stdout: '', stderr: 'scheduler timeout' };
        if (mode === 'failure') return { exitCode: 1, stdout: '', stderr: 'scheduler refused' };
        return kind === 'agy-pool'
          ? { exitCode: 0, stdout: 'scheduler accepted' }
          : {
              exitCode: 0,
              stdout:
                mode === 'missing-handle'
                  ? '{}'
                  : JSON.stringify({ agentId: 'paseo-native', status: 'running' }),
            };
      },
    }
  );
  return {
    root,
    c,
    key,
    result,
    calls,
    usageFile,
    checkpoint,
    records: decisions.readDecisionsDetailed({ dir: root }).records,
    reservations: quota.getReservations({ home: root }),
  };
}

test('native AGY allocation identity reaches the existing receipt consumer and owned stop', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-native-handle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const usageFile = path.join(dir, 'report.json');
  const adapter = getHarness('agy-pool');
  const job = {
    accountId: 'agy01',
    model: 'gemini-4-argon-high',
    prompt: 'fixture',
    cwd: dir,
    usageFile,
  };
  const argv = adapter.launch(job, { fakeRunsDir: path.join(dir, 'pool') });
  assert.ok(Array.isArray(argv));
  const allocated = JSON.parse(
    fs.readFileSync(path.join(dir, 'pool', 'agy01', 'job.json'), 'utf8')
  );
  const handle = readSessionId(adapter, job, { exitCode: 0, stdout: 'scheduler accepted' }).id;
  assert.equal(handle, 'agy01/' + allocated.jobId);
  assert.deepEqual(adapter.stop(handle), ['/end', '/tn', 'ShipDe\\ShipDe-agy01']);
  assert.equal(readSessionId(adapter, { ...job, accountId: 'agy02' }, { exitCode: 0 }).id, null);
  assert.equal(readSessionId(adapter, job, { exitCode: 1 }).id, null);
  assert.equal(readSessionId(adapter, job, { exitCode: 0, accountId: 'agy02' }).id, null);
});

for (const kind of ['paseo', 'agy-pool']) {
}

for (const [kind, mode] of [
  ['agy-pool', 'wrong-account'],
  ['agy-pool', 'invalid-handle'],
  ['agy-pool', 'malformed-report'],
  ['agy-pool', 'failure'],
  ['paseo', 'missing-handle'],
]) {
}

test('AGY missing durable report refuses before allocating a lane or scheduling', (t) => {
  const x = dispatch(t, 'agy-pool', 'no-report');
  assert.notEqual(x.result.exitCode, 0);
  assert.equal(x.calls, 0);
  assert.equal(fs.existsSync(path.join(x.root, 'pool', 'agy01', 'job.json')), false);
});

test('AGY report collision refuses before allocation and preserves the previous receipt', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-report-collision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const usageFile = path.join(dir, 'report.json');
  fs.writeFileSync(usageFile, 'prior receipt');
  assert.throws(
    () =>
      getHarness('agy-pool').launch(
        {
          accountId: 'agy01',
          cwd: dir,
          model: 'gemini-4-argon-high',
          prompt: 'fixture',
          usageFile,
        },
        { fakeRunsDir: path.join(dir, 'pool') }
      ),
    /EEXIST/
  );
  assert.equal(fs.readFileSync(usageFile, 'utf8'), 'prior receipt');
  assert.equal(fs.existsSync(path.join(dir, 'pool', 'agy01', 'job.json')), false);
});

test('synchronous process outcome compatibility is unchanged, not proof of task success', (t) => {
  const ok = dispatch(t, 'hermes');
  assert.equal(ok.result.exitCode, 0);
  assert.equal(
    ok.records.some((r) => r.stage === decisions.Stage.COMPLETED),
    true
  );
  const failed = dispatch(t, 'hermes', 'failure');
  assert.notEqual(failed.result.exitCode, 0);
  assert.equal(
    failed.records.some((r) => r.stage === decisions.Stage.COMPLETED),
    false
  );
});

test('locked writer result published between cleanup inspection and save is preserved', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-cleanup-race-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const adapter = getHarness('agy-pool');
  const lane = require('../lane-launcher');
  const job = {
    accountId: 'agy01',
    candidateKey: 'owned',
    cwd: root,
    prompt: 'fixture',
    model: 'gemini-4-argon-high',
    usageFile: path.join(root, 'usage.json'),
  };
  const opts = { fakeRunsDir: path.join(root, 'pool') };
  adapter.launch(job, opts);
  const dir = path.join(root, 'pool', 'agy01');
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
  const original = lane.saveResult;
  lane.saveResult = (dir, stored, outcome, options) => {
    original(dir, stored, { state: 'ok', exitCode: 0, reason: 'NATIVE_RESULT' });
    return original(dir, stored, outcome, options);
  };
  try {
    assert.equal(adapter.onLaunchFailed(job, { exitCode: 1 }, opts).pending, true);
    assert.equal(lane.readResult(dir, stored).reason, 'NATIVE_RESULT');
  } finally {
    lane.saveResult = original;
  }
});
