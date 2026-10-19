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
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({state:'ok',exitCode:0}));`
  );
  const opts = { fakeRunsDir: root, adapterScript: script };
  const proof = await schemaApi.verify(candidate('agy-pool'), opts);
  assert.equal(proof.ok, true);
  assert.equal(proof.method, 'agy-worker-result-json');
  const submitted = JSON.parse(fs.readFileSync(path.join(root, 'agy01', 'job.json')));
  fs.writeFileSync(
    script,
    `const fs=require('fs');const path=require('path');fs.writeFileSync(path.join(process.argv[2],'result.json'),JSON.stringify({state:'ok',exitCode:0}));`
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

test('Controller makes writers eligible only after proof and records precise rejection', async (t) => {
  const isolation = require('../isolation-launcher');
  const oldRead = isolation.readClosedIsolationVerdict;
  isolation.readClosedIsolationVerdict = () => ({ verdict: 'CLOSED' });
  t.after(() => {
    isolation.readClosedIsolationVerdict = oldRead;
  });
  const root = temp(t);
  const item = {
    id: 'TASK-AI-142',
    roleRequirement: { role: 'writer' },
    requiredCapabilities: ['jsonSchema'],
  };
  const choose = (c, o) =>
    selectCandidateForProfile(
      item,
      [c],
      [],
      {},
      { registry: { sources: [] }, ...o },
      { dir: root },
      Date.now()
    );
  const unproven = candidate();
  unproven.capabilities.jsonSchema = true;
  const noLaunch = await choose(unproven, {});
  assert.equal(noLaunch.result.rejected[0].reasonCode, 'CAPABILITY_UNVERIFIED:jsonSchema');
  assert.equal(noLaunch.result.rejected[0].reason, 'WRITER_SCHEMA_LAUNCH_NOT_AUTHORIZED');
  let calls = 0;
  const o = {
    isolatedWorker: true,
    run: (job) => {
      calls++;
      return { exitCode: 0, stdout: answer(job) };
    },
  };
  const selected = await choose(candidate(), o);
  assert.ok(
    !selected.result.rejected.some((r) => r.reasonCode === 'CAPABILITY_MISSING:jsonSchema')
  );
  assert.equal(calls, 1);
  assert.equal(selected.decisionRecorded.ranking[0].jsonSchemaEvidence.ok, true);
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

test('Controller caches proof only for the same seven-part route, and refuses bad results', async (t) => {
  const root = temp(t);
  const isolation = require('../isolation-launcher');
  const original = isolation.readClosedIsolationVerdict;
  isolation.readClosedIsolationVerdict = () => ({ verdict: 'CLOSED' });
  t.after(() => {
    isolation.readClosedIsolationVerdict = original;
  });
  let calls = 0;
  const o = {
    registry: { sources: [] },
    isolatedWorker: true,
    run: (job) => {
      calls++;
      return { exitCode: 0, stdout: job.model === 'bad-model' ? '{}' : answer(job) };
    },
  };
  const item = { id: 'TASK-AI-142', requiredCapabilities: ['jsonSchema'] };
  const select = (c) => selectCandidateForProfile(item, [c], [], {}, o, { dir: root }, Date.now());
  const a = candidate();
  await select(a);
  await select(candidate());
  assert.equal(calls, 1);
  const other = candidate();
  other.accountId = 'another-account';
  await select(other);
  assert.equal(calls, 2);
  const rejected = await select(candidate('codex', 'bad-model'));
  assert.equal(calls, 3);
  assert.equal(rejected.result.rejected[0].reason, 'WRITER_RESULT_CANDIDATE_MISMATCH');
});

test('a failing pool account is proven once, not once per model on it', async (t) => {
  const root = temp(t);
  const item = {
    id: 'TASK-AI-142',
    roleRequirement: { role: 'writer' },
    requiredCapabilities: ['jsonSchema'],
  };
  const models = ['m-high', 'm-medium', 'm-low'].map((m) => candidate('agy-pool', m));
  let calls = 0;
  t.mock.method(schemaApi, 'verify', async () => {
    calls++;
    return { ok: false, reason: 'WRITER_SCHEMA_POOL_POOL_TIMEOUT' };
  });
  const decision = await selectCandidateForProfile(
    item,
    models,
    [],
    {},
    { registry: { sources: [] }, externalWorkers: 'agy-pool' },
    { dir: root },
    Date.now()
  );
  assert.equal(calls, 1, 'one busy pool account must not launch a proof per model');
  const reasons = decision.result.rejected
    .filter((r) => r.reasonCode === 'CAPABILITY_MISSING:jsonSchema')
    .map((r) => r.reason);
  assert.deepEqual(reasons, Array(3).fill('WRITER_SCHEMA_POOL_POOL_TIMEOUT'));
});

test('schema proofs stop at the probe budget and leave the rest unverified, not failed', async (t) => {
  const root = temp(t);
  const item = {
    id: 'TASK-AI-142',
    roleRequirement: { role: 'writer' },
    requiredCapabilities: ['jsonSchema'],
  };
  const first = candidate('agy-pool', 'm-first');
  const second = Object.assign(candidate('agy-pool', 'm-second'), { accountId: 'agy02' });
  let clock = 1_000_000;
  t.mock.method(Date, 'now', () => clock);
  let calls = 0;
  t.mock.method(schemaApi, 'verify', async (_c, o) => {
    calls++;
    assert.ok(o.schemaTimeoutMs > 0, 'the proof gets the remaining budget');
    clock += 10 * 60 * 1000;
    return { ok: false, reason: 'WRITER_SCHEMA_POOL_POOL_TIMEOUT' };
  });
  const o = { registry: { sources: [] }, externalWorkers: 'agy-pool', maxConcurrentProbes: 1 };
  const decision = await selectCandidateForProfile(
    item,
    [first, second],
    [],
    {},
    o,
    { dir: root },
    clock
  );
  assert.equal(calls, 1);
  const secondRejection = decision.result.rejected.find(
    (r) => r.candidateKey === candidateKey(second)
  );
  assert.equal(secondRejection.reason, 'WRITER_SCHEMA_NOT_VERIFIED_BUDGET');
  assert.equal(o.writerSchemaEvidence.has(candidateKey(second)), false, 'retried next selection');
});

test('pool schema failure records redacted state, reason and output tail in rejection', async (t) => {
  const secret = 'fixture-pool-credential-value';
  const env = { FIXTURE_POOL_API_KEY: secret };
  t.mock.method(pool, 'readResult', () => null);
  t.mock.method(pool, 'submitJob', () => ({
    state: 'error',
    exitCode: 7,
    reason: `adapter failed using ${secret}`,
  }));
  t.mock.method(pool, 'readOutText', () =>
    [
      'discard-this-old-line',
      ...Array.from({ length: 20 }, (_, i) => `output ${i} ${secret}`),
    ].join('\n')
  );
  const proof = await schemaApi.verify(candidate('agy-pool'), { env });
  assert.equal(proof.reason, 'WRITER_SCHEMA_POOL_error');
  assert.match(proof.detail, /state=error/);
  assert.match(proof.detail, /exitCode=7/);
  assert.match(proof.detail, /reason=adapter failed/);
  assert.match(proof.detail, /output 19/);
  assert.ok(!proof.detail.includes('discard-this-old-line'));
  assert.ok(!proof.detail.includes(secret));
  assert.match(proof.detail, /REDACTED_SECRET/);
  const root = temp(t);
  const selected = await selectCandidateForProfile(
    {
      id: 'TASK-AI-142',
      roleRequirement: { role: 'writer' },
      requiredCapabilities: ['jsonSchema'],
    },
    [candidate('agy-pool')],
    [],
    {},
    { registry: { sources: [] }, externalWorkers: 'agy-pool', env },
    { dir: root },
    Date.now()
  );
  const rejection = selected.result.rejected.find(
    (r) => r.reasonCode === 'CAPABILITY_MISSING:jsonSchema'
  );
  assert.equal(rejection.reason, proof.reason);
  assert.equal(rejection.detail, proof.detail);
  assert.ok(!JSON.stringify(selected).includes(secret));
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

test('A failed Codex schema proof keeps its reason and records redacted exit code and stderr tail', async (t) => {
  const secret = 'fake-secret-value-123456';
  const env = { FAKE_API_TOKEN: secret };
  const run = () => ({
    exitCode: 1,
    stdout: '',
    stderr: `boom unexpected failure\nusing credential ${secret} here\n`,
  });
  const proof = await schemaApi.verify(candidate(), { run, env });
  assert.equal(proof.ok, false);
  assert.equal(proof.reason, 'WRITER_SCHEMA_CODEX_LAUNCH_FAILED');
  assert.match(proof.detail, /exitCode=1/);
  assert.match(proof.detail, /boom unexpected failure/);
  assert.ok(!proof.detail.includes(secret));
  assert.match(proof.detail, /REDACTED_SECRET/);

  const isolation = require('../isolation-launcher');
  const oldRead = isolation.readClosedIsolationVerdict;
  isolation.readClosedIsolationVerdict = () => ({ verdict: 'CLOSED' });
  t.after(() => {
    isolation.readClosedIsolationVerdict = oldRead;
  });
  const root = temp(t);
  const item = {
    id: 'TASK-AI-142',
    roleRequirement: { role: 'writer' },
    requiredCapabilities: ['jsonSchema'],
  };
  const selected = await selectCandidateForProfile(
    item,
    [candidate()],
    [],
    {},
    { registry: { sources: [] }, isolatedWorker: true, run, env },
    { dir: root },
    Date.now()
  );
  const rejection = selected.result.rejected.find(
    (r) => r.reasonCode === 'CAPABILITY_MISSING:jsonSchema'
  );
  assert.equal(rejection.reason, 'WRITER_SCHEMA_CODEX_LAUNCH_FAILED');
  assert.match(rejection.detail, /boom unexpected failure/);
  assert.ok(!JSON.stringify(rejection).includes(secret));
});
