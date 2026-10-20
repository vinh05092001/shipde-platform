'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const sweepImport = require('../sweep-import');
const cli = require('../cli');
const sourcesApi = require('../sources');
const { candidateKey } = require('../discovery/identity');

const item = { workItemId: 'TASK-AI-142', role: 'writer', requiredCapabilities: [] };

function writeSweep(dir, at, rows) {
  const file = path.join(dir, `sweep-${Date.parse(at)}.json`);
  fs.writeFileSync(file, JSON.stringify({ at, rows }), 'utf8');
  return file;
}

function rejectedKeys(evidenceDir, candidates, at) {
  const res = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates,
      items: [item],
      evidenceDir,
      now: Date.parse(at) + 1000,
      log: () => {},
      exit: () => {},
    }
  );
  return (res.decision.rejected || []).map((r) => r.offeringId || r.candidateKey);
}

test('TASK-AI-142 P1: failure on one harness does not exclude another credential path sharing account, gateway and model', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-harness-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const shared = {
    gateway: src.id,
    upstream: src.id,
    accountId: 'acc-shared',
    quotaScope: 'acc-shared',
    modelId: `${src.id}/shared-model`,
    source: src.id,
  };
  const candHttp = { ...shared, harness: 'direct-http', accessPath: 'https://a.example/v1' };
  candHttp.candidateKey = candidateKey(candHttp);
  const candCli = { ...shared, harness: 'opencode-direct', accessPath: 'https://a.example/v1' };
  candCli.candidateKey = candidateKey(candCli);
  const candidates = [candHttp, candCli];

  const at = '2026-10-20T01:00:00.000Z';
  const file = writeSweep(tmpDir, at, [
    {
      source: src.id,
      model: `${src.id}/shared-model`,
      accountId: 'acc-shared',
      harness: 'direct-http',
      accessPath: 'https://a.example/v1',
      status: 'HTTP_401',
      err: 'Unauthorized: invalid token',
    },
  ]);
  sweepImport.runSweepImport(file, { evidenceDir, registry, candidates });

  const rej = rejectedKeys(evidenceDir, candidates, at);
  assert.ok(rej.includes(candHttp.candidateKey), 'probed route must be excluded');
  assert.ok(!rej.includes(candCli.candidateKey), 'unprobed harness must stay routable');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: failure row without harness is not attributed to every credential path', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-ambig-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const shared = {
    gateway: src.id,
    upstream: src.id,
    accountId: 'acc-shared',
    quotaScope: 'acc-shared',
    modelId: `${src.id}/shared-model`,
    source: src.id,
    accessPath: 'https://a.example/v1',
  };
  const candHttp = { ...shared, harness: 'direct-http' };
  candHttp.candidateKey = candidateKey(candHttp);
  const candCli = { ...shared, harness: 'opencode-direct' };
  candCli.candidateKey = candidateKey(candCli);
  const candidates = [candHttp, candCli];

  const at = '2026-10-20T01:10:00.000Z';
  const file = writeSweep(tmpDir, at, [
    {
      source: src.id,
      model: `${src.id}/shared-model`,
      accountId: 'acc-shared',
      status: 'HTTP_401',
      err: 'Unauthorized: invalid token',
    },
  ]);
  sweepImport.runSweepImport(file, { evidenceDir, registry, candidates });

  const rej = rejectedKeys(evidenceDir, candidates, at);
  assert.ok(!rej.includes(candCli.candidateKey));
  assert.ok(!rej.includes(candHttp.candidateKey));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: router NO_CHANNEL stays gateway-scoped and does not block a direct route', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-nochannel-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const routerSrc = registry.sources.find((s) => s.kind === 'router');
  const upstreamId = 'up-p5';
  const candRouter = {
    harness: 'paseo',
    accessPath: 'http://127.0.0.1:20128/v1',
    gateway: routerSrc.id,
    upstream: upstreamId,
    accountId: upstreamId,
    quotaScope: upstreamId,
    modelId: `${upstreamId}/m1`,
    source: routerSrc.id,
  };
  candRouter.candidateKey = candidateKey(candRouter);
  const candDirect = {
    harness: 'direct-http',
    accessPath: 'https://up.example/v1',
    gateway: '',
    upstream: upstreamId,
    accountId: 'acc-direct',
    quotaScope: 'acc-direct',
    modelId: `${upstreamId}/m1`,
    source: upstreamId,
  };
  candDirect.candidateKey = candidateKey(candDirect);
  const candidates = [candRouter, candDirect];

  const at = '2026-10-20T01:20:00.000Z';
  const file = writeSweep(tmpDir, at, [
    {
      source: routerSrc.id,
      model: `${upstreamId}/m1`,
      status: 'HTTP_503',
      err: 'no channel available for this model',
    },
  ]);
  const res = sweepImport.runSweepImport(file, { evidenceDir, registry, candidates });
  assert.equal(res.evidenceData.cooldowns[`model::${upstreamId}::${upstreamId}/m1`], undefined);
  assert.equal(res.evidenceData.cooldowns[`model::${upstreamId}::m1`], undefined);

  const rej = rejectedKeys(evidenceDir, candidates, at);
  assert.ok(
    !rej.includes(candDirect.candidateKey),
    'direct route must not inherit router NO_CHANNEL'
  );
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P2: generic HTTP 403 is not classified as TIER without plan evidence', () => {
  assert.equal(
    sweepImport.classifySweepRow({ status: 'HTTP_403', err: 'Forbidden' }).code,
    'HTTP_403'
  );
  assert.equal(
    sweepImport.classifySweepRow({
      status: 'HTTP_403',
      err: 'This model requires an active paid plan',
    }).code,
    'TIER'
  );
});

function sharedRoute(src) {
  return {
    gateway: src.id,
    upstream: src.id,
    accountId: 'acc-shared',
    quotaScope: 'acc-shared',
    modelId: `${src.id}/shared-model`,
    source: src.id,
    accessPath: 'https://a.example/v1',
  };
}

test('TASK-AI-142 P1: a row naming an unmatched harness does not fall back to a different route', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-nofallback-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const candHttp = { ...sharedRoute(src), harness: 'direct-http' };
  candHttp.candidateKey = candidateKey(candHttp);

  const at = '2026-10-20T02:00:00.000Z';
  const file = writeSweep(tmpDir, at, [
    {
      source: src.id,
      model: `${src.id}/shared-model`,
      accountId: 'acc-shared',
      harness: 'opencode',
      accessPath: 'https://a.example/v1',
      status: 'HTTP_401',
      err: 'Unauthorized: invalid token',
    },
  ]);
  sweepImport.runSweepImport(file, { evidenceDir, registry, candidates: [candHttp] });
  assert.ok(!rejectedKeys(evidenceDir, [candHttp], at).includes(candHttp.candidateKey));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: a success on another credential path does not withhold a later failure', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-othersuccess-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const candHttp = { ...sharedRoute(src), harness: 'direct-http' };
  candHttp.candidateKey = candidateKey(candHttp);
  const candCli = { ...sharedRoute(src), harness: 'opencode-direct' };
  candCli.candidateKey = candidateKey(candCli);
  const candidates = [candHttp, candCli];
  const base = {
    source: src.id,
    model: `${src.id}/shared-model`,
    accountId: 'acc-shared',
    accessPath: 'https://a.example/v1',
  };

  const tFail = '2026-10-20T02:10:00.000Z';
  const tPass = '2026-10-20T02:20:00.000Z';
  // Success on opencode-direct imported first but observed later than the direct-http failure.
  sweepImport.runSweepImport(
    writeSweep(tmpDir, tPass, [{ ...base, harness: 'opencode-direct', status: 'OK' }]),
    { evidenceDir, registry, candidates }
  );
  sweepImport.runSweepImport(
    writeSweep(tmpDir, tFail, [
      { ...base, harness: 'direct-http', status: 'HTTP_401', err: 'Unauthorized' },
    ]),
    { evidenceDir, registry, candidates }
  );
  const rej = rejectedKeys(evidenceDir, candidates, tPass);
  assert.ok(rej.includes(candHttp.candidateKey), 'failed route must stay excluded');
  assert.ok(!rej.includes(candCli.candidateKey));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: a generic OK does not clear a model-wide NO_TOOL_CALL; TOOLS_OK does', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-toolproof-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const cand = { ...sharedRoute(src), harness: 'direct-http' };
  cand.candidateKey = candidateKey(cand);
  const base = {
    source: src.id,
    model: `${src.id}/shared-model`,
    accountId: 'acc-shared',
    harness: 'direct-http',
    accessPath: 'https://a.example/v1',
  };
  const opts = { evidenceDir, registry, candidates: [cand] };
  const globalKey = `model::::${src.id}/shared-model`;

  const r1 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T03:00:00.000Z', [
      { ...base, status: 'NO_TOOL_CALL', scope: 'model', err: 'no tool calls' },
    ]),
    opts
  );
  assert.ok(r1.evidenceData.cooldowns[globalKey]);

  const r2 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T03:10:00.000Z', [{ ...base, status: 'OK' }]),
    opts
  );
  assert.ok(r2.evidenceData.cooldowns[globalKey], 'generic OK must not lift NO_TOOL_CALL');

  const r3 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T03:20:00.000Z', [{ ...base, status: 'TOOLS_OK' }]),
    opts
  );
  assert.equal(r3.evidenceData.cooldowns[globalKey], undefined, 'TOOLS_OK disproves NO_TOOL_CALL');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: ambiguous failure records nothing even when the registry default route equals a candidate', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-ambig-default-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router' && !s.reachedVia);
  const defaultHarness = src.harness || 'direct-http';
  const other = defaultHarness === 'opencode-direct' ? 'direct-http' : 'opencode-direct';
  const accessPath = src.accessPath || src.endpoint || 'direct';
  const shared = {
    gateway: src.id,
    upstream: src.id,
    accountId: 'acc-shared',
    quotaScope: 'acc-shared',
    modelId: `${src.id}/shared-model`,
    source: src.id,
    accessPath,
  };
  const candDefault = { ...shared, harness: defaultHarness };
  candDefault.candidateKey = candidateKey(candDefault);
  const candOther = { ...shared, harness: other };
  candOther.candidateKey = candidateKey(candOther);
  const candidates = [candDefault, candOther];

  const at = '2026-10-20T04:00:00.000Z';
  const res = sweepImport.runSweepImport(
    writeSweep(tmpDir, at, [
      {
        source: src.id,
        model: `${src.id}/shared-model`,
        accountId: 'acc-shared',
        status: 'HTTP_401',
        err: 'Unauthorized',
      },
    ]),
    { evidenceDir, registry, candidates }
  );
  assert.deepEqual(Object.keys(res.evidenceData.cooldowns || {}), []);
  const rej = rejectedKeys(evidenceDir, candidates, at);
  assert.ok(!rej.includes(candDefault.candidateKey));
  assert.ok(!rej.includes(candOther.candidateKey));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: account-specific failure does not attach to a wildcard-account candidate', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-wildcard-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const candWild = {
    ...sharedRoute(src),
    harness: 'direct-http',
    accountId: '*',
    quotaScope: src.id,
  };
  candWild.candidateKey = candidateKey(candWild);

  const at = '2026-10-20T04:10:00.000Z';
  const res = sweepImport.runSweepImport(
    writeSweep(tmpDir, at, [
      {
        source: src.id,
        model: `${src.id}/shared-model`,
        accountId: 'acc-one',
        harness: 'direct-http',
        accessPath: 'https://a.example/v1',
        status: 'HTTP_401',
        err: 'Unauthorized',
      },
    ]),
    { evidenceDir, registry, candidates: [candWild] }
  );
  // Dispatch rejects wildcard accounts on its own (WILDCARD_ACCOUNT), so check the evidence:
  // no cooldown may be recorded under the wildcard candidate's key.
  assert.equal(res.evidenceData.cooldowns[candWild.candidateKey], undefined);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: scope "model" never widens account-scoped failures or NO_CHANNEL', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-scope-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const routerSrc = registry.sources.find((s) => s.kind === 'router');
  const cand = { ...sharedRoute(src), harness: 'direct-http' };
  cand.candidateKey = candidateKey(cand);
  const res = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T05:00:00.000Z', [
      {
        source: src.id,
        model: `${src.id}/shared-model`,
        accountId: 'acc-shared',
        harness: 'direct-http',
        accessPath: 'https://a.example/v1',
        scope: 'model',
        status: 'HTTP_402',
        err: 'insufficient quota',
      },
      {
        source: routerSrc.id,
        model: 'up-p5/m2',
        scope: 'model',
        status: 'HTTP_503',
        err: 'no channel available for this model',
      },
    ]),
    { evidenceDir, registry, candidates: [cand] }
  );
  const modelKeys = Object.keys(res.evidenceData.cooldowns || {}).filter((k) =>
    k.startsWith('model::')
  );
  assert.deepEqual(modelKeys, []);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: an account-less success does not clear cooldowns on several accounts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-passambig-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const candA = {
    ...sharedRoute(src),
    harness: 'direct-http',
    accountId: 'acc-a',
    quotaScope: 'acc-a',
  };
  candA.candidateKey = candidateKey(candA);
  const candB = {
    ...sharedRoute(src),
    harness: 'direct-http',
    accountId: 'acc-b',
    quotaScope: 'acc-b',
  };
  candB.candidateKey = candidateKey(candB);
  const candidates = [candA, candB];
  const base = {
    source: src.id,
    model: `${src.id}/shared-model`,
    harness: 'direct-http',
    accessPath: 'https://a.example/v1',
  };
  const opts = { evidenceDir, registry, candidates };
  sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T05:10:00.000Z', [
      { ...base, accountId: 'acc-a', status: 'HTTP_401', err: 'Unauthorized' },
      { ...base, accountId: 'acc-b', status: 'HTTP_402', err: 'insufficient quota' },
    ]),
    opts
  );
  const res = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T05:20:00.000Z', [{ ...base, status: 'OK' }]),
    opts
  );
  assert.ok(res.evidenceData.cooldowns[candA.candidateKey], 'acc-a cooldown must remain');
  assert.ok(res.evidenceData.cooldowns[candB.candidateKey], 'acc-b cooldown must remain');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: unattributed account-scoped failures create no evidence; cooldowns use only the route quota scope', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-failclosed-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');

  // No candidate and no account: nothing recorded.
  const r1 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T06:00:00.000Z', [
      { source: src.id, model: `${src.id}/m-none`, status: 'HTTP_401', err: 'Unauthorized' },
    ]),
    { evidenceDir, registry, candidates: [] }
  );
  assert.deepEqual(Object.keys(r1.evidenceData.cooldowns || {}), []);

  // Account-less AUTH row and a wildcard candidate: ambiguous, nothing recorded.
  const candWild = {
    ...sharedRoute(src),
    harness: 'direct-http',
    accountId: '*',
    quotaScope: src.id,
  };
  candWild.candidateKey = candidateKey(candWild);
  const r2 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T06:10:00.000Z', [
      {
        source: src.id,
        model: `${src.id}/shared-model`,
        harness: 'direct-http',
        accessPath: 'https://a.example/v1',
        status: 'HTTP_401',
        err: 'Unauthorized',
      },
    ]),
    { evidenceDir, registry, candidates: [candWild] }
  );
  assert.equal(r2.evidenceData.cooldowns[candWild.candidateKey], undefined);

  // Two candidates differing only in quota scope: a failure matched to scope-a excludes only it.
  const candA = { ...sharedRoute(src), harness: 'direct-http', quotaScope: 'scope-a' };
  candA.candidateKey = candidateKey(candA);
  const candAcct = { ...sharedRoute(src), harness: 'direct-http', quotaScope: 'acc-shared' };
  candAcct.candidateKey = candidateKey(candAcct);
  const r3 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T06:20:00.000Z', [
      {
        source: src.id,
        model: `${src.id}/shared-model`,
        accountId: 'acc-shared',
        quotaScope: 'scope-a',
        harness: 'direct-http',
        accessPath: 'https://a.example/v1',
        status: 'HTTP_402',
        err: 'insufficient quota',
      },
    ]),
    { evidenceDir, registry, candidates: [candA, candAcct] }
  );
  assert.ok(r3.evidenceData.cooldowns[candA.candidateKey]);
  assert.equal(r3.evidenceData.cooldowns[candAcct.candidateKey], undefined);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: route-scoped failures and passes are attributed only to an exact, unambiguous account', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-exact-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const mk = (acct) => {
    const c = { ...sharedRoute(src), harness: 'direct-http', accountId: acct, quotaScope: acct };
    c.candidateKey = candidateKey(c);
    return c;
  };
  const candA = mk('acc-a');
  const candB = mk('acc-b');
  const candWild = mk('*');
  const base = {
    source: src.id,
    model: `${src.id}/shared-model`,
    harness: 'direct-http',
    accessPath: 'https://a.example/v1',
  };

  // Account-less NO_TOOL_CALL over two accounts: ambiguous, nothing recorded.
  const r1 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T07:00:00.000Z', [{ ...base, status: 'NO_TOOL_CALL' }]),
    { evidenceDir, registry, candidates: [candA, candB] }
  );
  assert.equal(r1.evidenceData.cooldowns[candA.candidateKey], undefined);
  assert.equal(r1.evidenceData.cooldowns[candB.candidateKey], undefined);

  // A row naming acc-a does not attach to the wildcard candidate.
  const r2 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T07:10:00.000Z', [
      { ...base, accountId: 'acc-a', status: 'NO_TOOL_CALL' },
    ]),
    { evidenceDir, registry, candidates: [candA, candWild] }
  );
  assert.ok(r2.evidenceData.cooldowns[candA.candidateKey]);
  assert.equal(r2.evidenceData.cooldowns[candWild.candidateKey], undefined);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: a pass clears only the cooldown with its own quota scope', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-clearscope-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const candA = { ...sharedRoute(src), harness: 'direct-http', quotaScope: 'scope-a' };
  candA.candidateKey = candidateKey(candA);
  const candS = { ...sharedRoute(src), harness: 'direct-http', quotaScope: 'scope-b' };
  candS.candidateKey = candidateKey(candS);
  const base = {
    source: src.id,
    model: `${src.id}/shared-model`,
    accountId: 'acc-shared',
    harness: 'direct-http',
    accessPath: 'https://a.example/v1',
  };
  const opts = { evidenceDir, registry };
  sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T07:20:00.000Z', [
      { ...base, quotaScope: 'scope-a', status: 'HTTP_402', err: 'insufficient quota' },
      { ...base, quotaScope: 'scope-b', status: 'HTTP_402', err: 'insufficient quota' },
    ]),
    { ...opts, candidates: [candA, candS] }
  );
  const res = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T07:30:00.000Z', [
      { ...base, quotaScope: 'scope-a', status: 'OK' },
    ]),
    { ...opts, candidates: [candA, candS] }
  );
  assert.equal(res.evidenceData.cooldowns[candA.candidateKey], undefined, 'own route cleared');
  assert.ok(res.evidenceData.cooldowns[candS.candidateKey], 'other quota scope must remain');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: a newer success on another quota scope does not discard an older failure (reverse import order)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-reverse-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const candA = { ...sharedRoute(src), harness: 'direct-http', quotaScope: 'scope-a' };
  candA.candidateKey = candidateKey(candA);
  const candB = { ...sharedRoute(src), harness: 'direct-http', quotaScope: 'scope-b' };
  candB.candidateKey = candidateKey(candB);
  const candidates = [candA, candB];
  const base = {
    source: src.id,
    model: `${src.id}/shared-model`,
    accountId: 'acc-shared',
    harness: 'direct-http',
    accessPath: 'https://a.example/v1',
  };
  sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T08:10:00.000Z', [
      { ...base, quotaScope: 'scope-b', status: 'OK' },
    ]),
    { evidenceDir, registry, candidates }
  );
  const res = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T08:00:00.000Z', [
      { ...base, quotaScope: 'scope-a', status: 'HTTP_402', err: 'insufficient quota' },
    ]),
    { evidenceDir, registry, candidates }
  );
  assert.ok(res.evidenceData.cooldowns[candA.candidateKey], 'scope-a failure must be recorded');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P2: RATE failure without a finite configured cooldown is not a permanent exclusion', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-rate-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const live = sourcesApi.loadSources();
  const registry = { ...live, dispatch: { ...(live.dispatch || {}) } };
  delete registry.dispatch.rateLimitCooldownMs;
  const src = registry.sources.find((s) => s.kind !== 'router');
  const cand = { ...sharedRoute(src), harness: 'direct-http' };
  cand.candidateKey = candidateKey(cand);
  const res = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T08:20:00.000Z', [
      {
        source: src.id,
        model: `${src.id}/shared-model`,
        accountId: 'acc-shared',
        harness: 'direct-http',
        accessPath: 'https://a.example/v1',
        status: 'HTTP_429',
        err: 'Rate limit exceeded',
      },
    ]),
    { evidenceDir, registry, candidates: [cand] }
  );
  const cd = res.evidenceData.cooldowns[cand.candidateKey];
  assert.ok(!cd || (Number.isFinite(cd.cooldownMs) && cd.cooldownMs > 0));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: rows matching several quota scopes or upstreams are not attributed', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-multi-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = sourcesApi.loadSources();
  const src = registry.sources.find((s) => s.kind !== 'router');
  const routerSrc = registry.sources.find((s) => s.kind === 'router');
  const candA = { ...sharedRoute(src), harness: 'direct-http', quotaScope: 'scope-a' };
  candA.candidateKey = candidateKey(candA);
  const candB = { ...sharedRoute(src), harness: 'direct-http', quotaScope: 'scope-b' };
  candB.candidateKey = candidateKey(candB);
  const r1 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T09:00:00.000Z', [
      {
        source: src.id,
        model: `${src.id}/shared-model`,
        accountId: 'acc-shared',
        harness: 'direct-http',
        accessPath: 'https://a.example/v1',
        status: 'NO_TOOL_CALL',
      },
    ]),
    { evidenceDir, registry, candidates: [candA, candB] }
  );
  assert.equal(r1.evidenceData.cooldowns[candA.candidateKey], undefined);
  assert.equal(r1.evidenceData.cooldowns[candB.candidateKey], undefined);

  const viaRouter = (up) => {
    const c = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: routerSrc.id,
      upstream: up,
      accountId: 'acc-r',
      quotaScope: 'acc-r',
      modelId: `${up}/m3`,
      source: routerSrc.id,
    };
    c.candidateKey = candidateKey(c);
    return c;
  };
  const upA = viaRouter('up-a');
  const upB = viaRouter('up-b');
  const r2 = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T09:10:00.000Z', [
      { source: routerSrc.id, model: 'm3', accountId: 'acc-r', status: 'NO_TOOL_CALL' },
    ]),
    { evidenceDir, registry, candidates: [upA, upB] }
  );
  assert.equal(r2.evidenceData.cooldowns[upA.candidateKey], undefined);
  assert.equal(r2.evidenceData.cooldowns[upB.candidateKey], undefined);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P2: no synthetic route when neither row nor registry establishes it', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p5-nosynth-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const registry = {
    version: 2,
    sources: [{ id: 'prov-bare', kind: 'model-source', servesModels: true }],
  };
  const res = sweepImport.runSweepImport(
    writeSweep(tmpDir, '2026-10-20T09:20:00.000Z', [
      { source: 'prov-bare', model: 'm-ok', status: 'TOOLS_OK' },
      { source: 'prov-bare', model: 'm-nt', status: 'NO_TOOL_CALL' },
    ]),
    { evidenceDir, registry, candidates: [] }
  );
  assert.deepEqual(res.evidenceData.combinations || [], []);
  assert.deepEqual(Object.keys(res.evidenceData.cooldowns || {}), []);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
