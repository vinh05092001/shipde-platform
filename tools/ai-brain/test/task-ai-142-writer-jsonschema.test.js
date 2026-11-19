'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const schemaApi = require('../writer-schema');
const pool = require('../agy-pool-runtime');
const { getHarness } = require('../harness');
const { candidateKey } = require('../candidates');
const { selectCandidateForProfile, resolveLauncher } = require('../orchestrate');

function candidate(harness = 'codex', model = 'fixture-model') {
  return {
    harness,
    accessPath: 'fixture',
    gateway: '',
    upstream: harness,
    accountId: harness === 'agy-pool' ? 'agy01' : 'fixture-account',
    quotaScope: 'fixture',
    modelId: model,
    capabilities: { tools: true, contextWindow: 200000 },
  };
}
function answer(job, changes = {}) {
  return JSON.stringify({
    candidateKey: job.candidateKey,
    nonce: job.resultSchema.properties.nonce.enum[0],
    status: 'completed',
    artifacts: [],
    ...changes,
  });
}
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-schema-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Codex proof requires successful launch and exact schema output, not a declared flag', async () => {
  const c = candidate();
  assert.equal((await schemaApi.verify(c)).reason, 'WRITER_SCHEMA_ISOLATED_LAUNCHER_MISSING');
  for (const [output, reason] of [
    ['OK', 'WRITER_RESULT_INVALID_JSON'],
    ['[]', 'WRITER_RESULT_NOT_OBJECT'],
    ['{}', 'WRITER_RESULT_CANDIDATE_MISMATCH'],
  ]) {
    assert.equal(
      (await schemaApi.verify(c, { run: () => ({ exitCode: 0, stdout: output }) })).reason,
      reason
    );
  }
  const proof = await schemaApi.verify(c, { run: (job) => ({ exitCode: 0, stdout: answer(job) }) });
  assert.equal(proof.ok, true);
  assert.equal(proof.candidateKey, candidateKey(c));
  assert.equal(proof.method, 'codex-exec-output-schema');
  assert.equal(
    (await schemaApi.verify(c, { run: () => ({ exitCode: 1, stdout: '{}' }) })).ok,
    false
  );
});

test('result rejects replay, wrong model binding, wrong types and extra fields', () => {
  const job = schemaApi.prepareJob({ candidateKey: 'key', prompt: 'task' });
  for (const changes of [
    { nonce: 'old' },
    { candidateKey: 'other' },
    { status: 'ok' },
    { artifacts: [42] },
    { artifacts: null },
    { injected: true },
  ]) {
    assert.equal(schemaApi.validate(answer(job, changes), job.resultSchema).ok, false);
  }
  assert.equal(schemaApi.validate('\uFEFF' + answer(job), job.resultSchema).ok, true);
});

test('pool verifies worker response, never quota telemetry or stale output', async (t) => {
  const root = temp(t);
  const script = path.join(root, 'adapter.js');
  fs.writeFileSync(
    script,
    `const fs = require('fs'); const path = require('path');
const dir = process.argv[2];
const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
const response = JSON.stringify({ candidateKey: job.candidateKey, nonce: job.resultSchema.properties.nonce.enum[0], status: 'completed', artifacts: [] });
fs.writeFileSync(path.join(dir, 'out.txt'), JSON.stringify({response}));
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({state:'ok',exitCode:0,jobId:job.jobId}));`
  );
  const opts = { fakeRunsDir: root, adapterScript: script };
  const proof = await schemaApi.verify(candidate('agy-pool'), opts);
  assert.equal(proof.ok, true);
  assert.equal(proof.method, 'agy-worker-result-json');
  const submitted = JSON.parse(fs.readFileSync(path.join(root, 'agy01', 'job.json')));
  fs.writeFileSync(
    script,
    `const fs=require('fs');const path=require('path');const dir=process.argv[2];const job=JSON.parse(fs.readFileSync(path.join(dir,'job.json'),'utf8'));fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({state:'ok',exitCode:0,jobId:job.jobId}));`
  );
  assert.equal(
    (await schemaApi.verify(candidate('agy-pool'), opts)).reason,
    'WRITER_RESULT_NONCE_MISMATCH'
  );
  fs.writeFileSync(
    path.join(root, 'agy01', 'out.txt'),
    JSON.stringify({ response: answer(submitted, { status: 'failed' }) })
  );
  assert.equal(
    getHarness('agy-pool').mapOutcome('agy01', submitted.candidateKey, opts).status,
    'failed'
  );
});

test('Codex adapter passes schema and isolated launcher validates final result', (t) => {
  const isolation = require('../isolation-launcher');
  const oldRead = isolation.readClosedIsolationVerdict;
  const oldPath = isolation.isWorkerPath;
  isolation.readClosedIsolationVerdict = () => ({ verdict: 'CLOSED' });
  isolation.isWorkerPath = () => true;
  t.after(() => {
    isolation.readClosedIsolationVerdict = oldRead;
    isolation.isWorkerPath = oldPath;
  });
  const root = temp(t);
  const job = schemaApi.prepareJob({
    harness: 'codex',
    candidateKey: 'key',
    cwd: root,
    isolatedWorker: true,
    isolationVerdict: { verdict: 'CLOSED' },
    prompt: 'task',
  });
  const args = getHarness('codex').launch(job);
  assert.equal(args[args.indexOf('--output-schema') + 1], job.resultSchemaPath);
  const launch = resolveLauncher({ isolatedWorker: true }, (_adapter, argv, opts) => {
    opts.onProvisioned(root, {});
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(root, argv[argv.indexOf('--output-schema') + 1]))),
      job.resultSchema
    );
    return { exitCode: 0, stdout: answer(job) };
  });
  assert.equal(launch(job).exitCode, 0);
  const invalid = resolveLauncher({ isolatedWorker: true }, () => ({ exitCode: 0, stdout: 'OK' }));
  assert.equal(invalid(job).failureReason, 'WRITER_RESULT_INVALID_JSON');
});

test('pool process states and schema failures never prove capability or leak error text', async (t) => {
  t.mock.method(pool, 'readOutText', () => '');
  const original = pool.submitJob;
  const originalRead = pool.readResult;
  pool.readResult = () => null;
  t.after(() => {
    pool.submitJob = original;
    pool.readResult = originalRead;
  });
  for (const state of ['quota', 'login-required', 'error']) {
    pool.submitJob = () => ({ state, exitCode: 1, reason: 'secret raw error' });
    const proof = await schemaApi.verify(candidate('agy-pool'));
    assert.equal(proof.ok, false);
    assert.ok(!proof.reason.includes('secret'));
  }
  pool.readResult = () => ({ state: 'running' });
  pool.submitJob = () => {
    throw new Error('busy account must not be overwritten');
  };
  assert.equal((await schemaApi.verify(candidate('agy-pool'))).reason, 'WRITER_SCHEMA_POOL_BUSY');
});

test('pool proof timeout is bounded by the remaining budget', async (t) => {
  let seen;
  t.mock.method(pool, 'readOutText', () => '');
  t.mock.method(pool, 'readResult', () => null);
  t.mock.method(pool, 'submitJob', (_a, _j, o) => {
    seen = o.timeoutMs;
    return { state: 'error', reason: 'POOL_TIMEOUT' };
  });
  const proof = await schemaApi.verify(candidate('agy-pool'), { schemaTimeoutMs: 5000 });
  assert.equal(seen, 5000);
  assert.equal(proof.reason, 'WRITER_SCHEMA_POOL_POOL_TIMEOUT');
});
