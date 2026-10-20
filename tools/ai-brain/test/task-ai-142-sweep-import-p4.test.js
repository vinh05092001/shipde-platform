'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const sweepImport = require('../sweep-import');
const evidence = require('../evidence');
const cli = require('../cli');
const sourcesApi = require('../sources');
const { candidateKey } = require('../discovery/identity');

test('TASK-AI-142 P1: candidate matching requires gateway to match so direct provider probe failure does not attach to router candidate', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p4-gw-match-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const registry = sourcesApi.loadSources();
  const routerSrc = (registry.sources || []).find((s) => s.kind === 'router') || { id: '9router' };
  const directSrc = (registry.sources || []).find((s) => s.kind !== 'router') || { id: 'prov-p' };

  // Router candidate reaching directSrc.id via routerSrc.id
  const candRouter = {
    harness: 'paseo',
    accessPath: 'http://127.0.0.1:20128/v1',
    gateway: routerSrc.id,
    upstream: directSrc.id,
    accountId: 'acc-shared',
    quotaScope: directSrc.id,
    modelId: `${directSrc.id}/shared-model`,
    source: routerSrc.id,
  };
  candRouter.candidateKey = candidateKey(candRouter);

  // Direct candidate reaching directSrc.id directly (empty or direct gateway)
  const candDirect = {
    harness: 'direct-http',
    accessPath: 'direct',
    gateway: '',
    upstream: directSrc.id,
    accountId: 'acc-shared',
    quotaScope: directSrc.id,
    modelId: `${directSrc.id}/shared-model`,
    source: directSrc.id,
  };
  candDirect.candidateKey = candidateKey(candDirect);

  // Sweep row from a direct provider probe (probed directSrc directly, not routerSrc)
  const sweepAt = '2026-10-19T08:00:00.000Z';
  const sweepData = {
    at: sweepAt,
    rows: [
      {
        source: directSrc.id,
        model: `${directSrc.id}/shared-model`,
        accountId: 'acc-shared',
        status: 'HTTP_401',
        err: 'Unauthorized: invalid token',
      },
    ],
  };

  const res = sweepImport.importSweep(sweepData, {
    evidenceDir,
    registry,
    candidates: [candRouter, candDirect],
    persist: true,
  });

  // Direct candidate must be cooled down
  assert.ok(
    res.evidenceData.cooldowns[candDirect.candidateKey],
    'Direct candidate must receive cooldown from direct probe failure'
  );
  assert.equal(res.evidenceData.cooldowns[candDirect.candidateKey].cause, 'AUTH');

  // Router candidate must NOT receive cooldown because the router route was not probed
  assert.equal(
    res.evidenceData.cooldowns[candRouter.candidateKey],
    undefined,
    'Router candidate must NOT receive cooldown from direct provider probe'
  );

  // Router candidate must not be rejected in dispatch
  const item = {
    workItemId: 'TASK-AI-142',
    role: 'writer',
    requiredCapabilities: [],
  };

  const dispatchResult = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [candRouter],
      items: [item],
      evidenceDir,
      now: Date.parse(sweepAt) + 1000,
      log: () => {},
      exit: () => {},
    }
  );

  const rejected = dispatchResult.decision.rejected || [];
  const findRej = rejected.find(
    (r) => (r.offeringId || r.candidateKey) === candRouter.candidateKey
  );
  assert.equal(findRej, undefined, 'Router candidate must not be rejected in dispatch');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: failed probe does not create cooldown keys for other harnesses or guessed endpoints', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p4-harness-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const registry = {
    version: 2,
    sources: [
      {
        id: 'prov-indep',
        kind: 'model-source',
        servesModels: true,
        harness: 'direct-http',
        accessPath: 'direct',
        endpoint: 'https://api.prov-indep.example/v1',
      },
    ],
  };

  // Direct HTTP candidate that will be probed and fail
  const candDirect = {
    harness: 'direct-http',
    accessPath: 'direct',
    gateway: 'prov-indep',
    upstream: 'prov-indep',
    accountId: 'acc-direct',
    quotaScope: 'acc-direct',
    modelId: 'prov-indep/model-z',
    source: 'prov-indep',
  };
  candDirect.candidateKey = candidateKey(candDirect);

  // Independently authenticated OpenCode CLI candidate that was NOT probed
  const candCli = {
    harness: 'opencode',
    accessPath: 'cli',
    gateway: 'prov-indep',
    upstream: 'prov-indep',
    accountId: 'acc-cli',
    quotaScope: 'acc-cli',
    modelId: 'prov-indep/model-z',
    source: 'prov-indep',
  };
  candCli.candidateKey = candidateKey(candCli);

  const sweepAt = '2026-10-19T09:00:00.000Z';
  const sweepData = {
    at: sweepAt,
    rows: [
      {
        source: 'prov-indep',
        model: 'prov-indep/model-z',
        accountId: 'acc-direct',
        status: 'HTTP_401',
        err: 'Unauthorized: key expired',
      },
    ],
  };

  const res = sweepImport.importSweep(sweepData, {
    evidenceDir,
    registry,
    candidates: [candDirect, candCli],
    persist: true,
  });

  // candDirect must receive cooldown
  assert.ok(
    res.evidenceData.cooldowns[candDirect.candidateKey],
    'Direct candidate must receive cooldown'
  );

  // candCli must NOT receive cooldown
  assert.equal(
    res.evidenceData.cooldowns[candCli.candidateKey],
    undefined,
    'Independently authenticated CLI candidate must NOT receive cooldown'
  );

  // Verify no guessed endpoints or unrelated harnesses exist in cooldowns
  const cooldownKeys = Object.keys(res.evidenceData.cooldowns || {});
  for (const k of cooldownKeys) {
    assert.ok(
      !k.includes('api.prov-indep.ai') &&
        !k.includes('prov-indep.ai') &&
        !k.includes('api.prov-indep.com'),
      `Cooldown key must not contain guessed endpoints: ${k}`
    );
    if (k.includes('::')) {
      const parts = k.split('::');
      if (parts.length === 7) {
        const [kHarness] = parts;
        assert.notEqual(
          kHarness,
          'opencode',
          'Cooldown key must not be synthesized for opencode CLI harness'
        );
        assert.notEqual(
          kHarness,
          'paseo',
          'Cooldown key must not be synthesized for paseo router harness'
        );
      }
    }
  }

  // candCli must be unblocked in dispatch
  const blockedCheck = evidence.isCandidateBlocked(res.evidenceData, candCli, {
    now: Date.parse(sweepAt) + 1000,
  });
  assert.equal(blockedCheck.blocked, false, 'candCli must not be blocked');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: generic HTTP 500/503 failures do not create indefinite candidate cooldown or exclude route in dispatch', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p4-http500-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const registry = {
    version: 2,
    sources: [
      {
        id: 'prov-transient',
        kind: 'model-source',
        servesModels: true,
        harness: 'direct-http',
        accessPath: 'direct',
        endpoint: 'https://api.prov-transient.example/v1',
      },
    ],
  };

  const cand = {
    harness: 'direct-http',
    accessPath: 'direct',
    gateway: 'prov-transient',
    upstream: 'prov-transient',
    accountId: 'acc-t',
    quotaScope: 'acc-t',
    modelId: 'prov-transient/model-500',
    source: 'prov-transient',
  };
  cand.candidateKey = candidateKey(cand);

  const sweepAt = '2026-10-19T10:00:00.000Z';
  const sweepData = {
    at: sweepAt,
    rows: [
      {
        source: 'prov-transient',
        model: 'prov-transient/model-500',
        accountId: 'acc-t',
        status: 'HTTP_500',
        err: 'Internal Server Error',
      },
    ],
  };

  const res = sweepImport.importSweep(sweepData, {
    evidenceDir,
    registry,
    candidates: [cand],
    persist: true,
  });

  // Recorded in import counts and combinations
  assert.equal(res.imported, 1);
  assert.equal(res.failed, 1);
  assert.equal(res.breakdown.OTHER, 1);

  const combos = res.evidenceData.combinations || [];
  assert.equal(combos.length, 1);
  assert.equal(combos[0].evidence.length, 1);
  assert.equal(combos[0].evidence[0].status, 'failed');
  assert.equal(combos[0].evidence[0].httpStatus, 500);

  // Must NOT create an indefinite cooldown (cooldownMs: null) for generic HTTP 500
  const cd = res.evidenceData.cooldowns?.[cand.candidateKey];
  assert.equal(cd, undefined, 'Generic HTTP 500 must not create indefinite candidate cooldown');

  // Candidate must not be blocked in dispatch
  const blockedCheck = evidence.isCandidateBlocked(res.evidenceData, cand, {
    now: Date.parse(sweepAt) + 1000,
  });
  assert.equal(
    blockedCheck.blocked,
    false,
    'Candidate must not be blocked by transient HTTP 500 error'
  );

  // Candidate must not be rejected in dispatchCommand dry-run
  const item = {
    workItemId: 'TASK-AI-142',
    role: 'writer',
    requiredCapabilities: [],
  };

  const dispatchResult = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [cand],
      items: [item],
      evidenceDir,
      now: Date.parse(sweepAt) + 1000,
      log: () => {},
      exit: () => {},
    }
  );

  const rejected = dispatchResult.decision.rejected || [];
  const findRej = rejected.find((r) => (r.offeringId || r.candidateKey) === cand.candidateKey);
  assert.equal(
    findRej,
    undefined,
    'Candidate must not be rejected in dispatch due to transient HTTP 500'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
