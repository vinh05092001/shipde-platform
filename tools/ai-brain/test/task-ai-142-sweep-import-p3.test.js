const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const sweepImport = require('../sweep-import');
const evidence = require('../evidence');
const cli = require('../cli');
const { candidateKey } = require('../discovery/identity');

test('TASK-AI-142 P1: account-scoped failure omits account with two accounts sharing model does not block unrelated accounts', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p3-account-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const registry = {
    version: 2,
    sources: [
      {
        id: 'provider-shared',
        kind: 'model-source',
        servesModels: true,
        harness: 'opencode',
        accessPath: 'cli',
        endpoint: 'https://api.shared.example/v1',
      },
    ],
  };

  const accounts = [
    {
      id: 'acc-alpha',
      provider: 'provider-shared',
      source: 'provider-shared',
      models: ['shared/model-x'],
    },
    {
      id: 'acc-beta',
      provider: 'provider-shared',
      source: 'provider-shared',
      models: ['shared/model-x'],
    },
  ];

  const candA = {
    harness: 'opencode',
    accessPath: 'cli',
    gateway: 'provider-shared',
    upstream: 'provider-shared',
    accountId: 'acc-alpha',
    quotaScope: 'acc-alpha',
    modelId: 'shared/model-x',
    source: 'provider-shared',
  };
  candA.candidateKey = candidateKey(candA);

  const candB = {
    harness: 'opencode',
    accessPath: 'cli',
    gateway: 'provider-shared',
    upstream: 'provider-shared',
    accountId: 'acc-beta',
    quotaScope: 'acc-beta',
    modelId: 'shared/model-x',
    source: 'provider-shared',
  };
  candB.candidateKey = candidateKey(candB);

  // Row omits account and reports account-scoped failure (AUTH HTTP_401)
  const sweepAmbiguous = {
    at: '2026-10-19T09:00:00.000Z',
    rows: [
      {
        source: 'provider-shared',
        model: 'shared/model-x',
        status: 'HTTP_401',
        err: 'Unauthorized',
      },
    ],
  };

  const resAmbiguous = sweepImport.importSweep(sweepAmbiguous, {
    evidenceDir,
    registry,
    candidates: [candA, candB],
    accounts,
  });

  // Since two accounts share the model and row omitted account, account match is ambiguous.
  // Must NOT apply account-scoped cooldown to either account.
  assert.equal(
    resAmbiguous.evidenceData.cooldowns?.[candA.candidateKey],
    undefined,
    'Ambiguous account-scoped failure must not block candA'
  );
  assert.equal(
    resAmbiguous.evidenceData.cooldowns?.[candB.candidateKey],
    undefined,
    'Ambiguous account-scoped failure must not block candB'
  );

  // Dispatch dry-run: neither candidate is rejected
  const dispatchRes = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [candA, candB],
      evidenceDir,
      registry,
      accounts,
      now: Date.parse('2026-10-19T09:00:00.000Z') + 1000,
      items: [{ workItemId: 'TASK-AI-142', role: 'writer' }],
      log: () => {},
      exit: () => {},
    }
  );
  const rej = dispatchRes.decision.rejected || [];
  assert.equal(
    rej.find((r) => (r.offeringId || r.candidateKey) === candA.candidateKey),
    undefined,
    'candA must not be rejected when account is ambiguous'
  );
  assert.equal(
    rej.find((r) => (r.offeringId || r.candidateKey) === candB.candidateKey),
    undefined,
    'candB must not be rejected when account is ambiguous'
  );

  // In contrast, when row explicitly specifies account, unambiguous exclusion applies ONLY to that account
  const sweepExplicit = {
    at: '2026-10-19T09:05:00.000Z',
    rows: [
      {
        source: 'provider-shared',
        model: 'shared/model-x',
        account: 'acc-alpha',
        status: 'HTTP_401',
        err: 'Unauthorized',
      },
    ],
  };

  const resExplicit = sweepImport.importSweep(sweepExplicit, {
    evidenceDir,
    registry,
    candidates: [candA, candB],
    accounts,
  });

  assert.ok(
    resExplicit.evidenceData.cooldowns?.[candA.candidateKey],
    'Explicit account match must record cooldown for candA'
  );
  assert.equal(
    resExplicit.evidenceData.cooldowns?.[candB.candidateKey],
    undefined,
    'Unrelated account candB must not have cooldown'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1: single NO_TOOL_CALL probe remains route-scoped and does not block model across providers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p3-notool-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const registry = {
    version: 2,
    sources: [
      {
        id: 'prov-one',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://api.one.example/v1',
      },
      {
        id: 'prov-two',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://api.two.example/v1',
      },
    ],
  };

  const candOne = {
    harness: 'direct-http',
    accessPath: 'https://api.one.example/v1',
    gateway: 'prov-one',
    upstream: 'prov-one',
    accountId: 'acc-1',
    quotaScope: 'acc-1',
    modelId: 'vendor/model-t',
    source: 'prov-one',
  };
  candOne.candidateKey = candidateKey(candOne);

  const candTwo = {
    harness: 'direct-http',
    accessPath: 'https://api.two.example/v1',
    gateway: 'prov-two',
    upstream: 'prov-two',
    accountId: 'acc-2',
    quotaScope: 'acc-2',
    modelId: 'vendor/model-t',
    source: 'prov-two',
  };
  candTwo.candidateKey = candidateKey(candTwo);

  // Single NO_TOOL_CALL on prov-one without model-wide scope
  const sweepRoute = {
    at: '2026-10-19T10:00:00.000Z',
    rows: [
      {
        source: 'prov-one',
        model: 'vendor/model-t',
        status: 'NO_TOOL_CALL',
        err: 'Model failed to produce tool call',
      },
    ],
  };

  const resRoute = sweepImport.importSweep(sweepRoute, {
    evidenceDir,
    registry,
    candidates: [candOne, candTwo],
  });

  // Global cooldown model::::vendor/model-t must NOT be created
  assert.equal(
    resRoute.evidenceData.cooldowns?.[`model::::vendor/model-t`],
    undefined,
    'Single route NO_TOOL_CALL must not create global model cooldown'
  );

  // Route-scoped cooldown must be applied to candOne
  assert.ok(
    resRoute.evidenceData.cooldowns?.[candOne.candidateKey],
    'candOne must receive route-scoped cooldown'
  );
  assert.equal(
    resRoute.evidenceData.cooldowns?.[candTwo.candidateKey],
    undefined,
    'Unrelated provider candTwo must not receive cooldown'
  );

  // Dispatch dry-run: candOne is rejected, candTwo is not
  const dispatchRes = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: [candOne, candTwo],
      evidenceDir,
      registry,
      now: Date.parse('2026-10-19T10:00:00.000Z') + 1000,
      items: [{ workItemId: 'TASK-AI-142', role: 'writer' }],
      log: () => {},
      exit: () => {},
    }
  );
  const rej = dispatchRes.decision.rejected || [];
  assert.ok(
    rej.some((r) => (r.offeringId || r.candidateKey) === candOne.candidateKey),
    'candOne must be rejected'
  );
  assert.equal(
    rej.find((r) => (r.offeringId || r.candidateKey) === candTwo.candidateKey),
    undefined,
    'Healthy route candTwo on unrelated provider must not be rejected'
  );

  // In contrast, when sweep explicitly establishes a genuinely global condition (scope: model), global cooldown applies
  const sweepGlobal = {
    at: '2026-10-19T10:05:00.000Z',
    rows: [
      {
        source: 'prov-one',
        model: 'vendor/model-t',
        status: 'NO_TOOL_CALL',
        scope: 'model',
        err: 'Model does not support tools globally',
      },
    ],
  };
  const resGlobal = sweepImport.importSweep(sweepGlobal, {
    evidenceDir,
    registry,
    candidates: [candOne, candTwo],
  });
  assert.ok(
    resGlobal.evidenceData.cooldowns?.[`model::::vendor/model-t`],
    'Explicit global scope must create model:::: cooldown'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P2: generic OK and PASSED rows do not receive API_PASS proof', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p3-proof-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const registry = {
    version: 2,
    sources: [
      {
        id: 'prov-test',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://api.test.example/v1',
        harness: 'opencode-direct',
        accounts: ['acc-test'],
      },
    ],
  };

  const sweep = {
    at: '2026-10-19T11:00:00.000Z',
    rows: [
      {
        source: 'prov-test',
        model: 'model-tools',
        status: 'TOOLS_OK',
        ms: 100,
      },
      {
        source: 'prov-test',
        model: 'model-ok',
        status: 'OK',
        ms: 100,
      },
      {
        source: 'prov-test',
        model: 'model-passed',
        status: 'PASSED',
        ms: 100,
      },
    ],
  };

  const res = sweepImport.importSweep(sweep, {
    evidenceDir,
    registry,
  });

  const combos = res.evidenceData.combinations || [];
  const comboTools = combos.find((c) => c.model === 'model-tools');
  const comboOk = combos.find((c) => c.model === 'model-ok');
  const comboPassed = combos.find((c) => c.model === 'model-passed');

  assert.ok(comboTools, 'model-tools combo must exist');
  assert.ok(comboOk, 'model-ok combo must exist');
  assert.ok(comboPassed, 'model-passed combo must exist');

  // TOOLS_OK demonstrates tool capability and receives API_PASS proof
  assert.equal(comboTools.evidence[0].status, 'passed');
  assert.equal(comboTools.evidence[0].proofLevel, 'API_PASS');
  assert.equal(comboTools.evidence[0].level, 1);

  // Generic OK and PASSED do NOT demonstrate tool capability and must not receive API_PASS proof
  assert.equal(comboOk.evidence[0].status, 'passed');
  assert.notEqual(
    comboOk.evidence[0].proofLevel,
    'API_PASS',
    'Generic OK must not receive API_PASS proof'
  );
  assert.equal(comboOk.evidence[0].proofLevel, undefined);
  assert.equal(comboOk.evidence[0].level, undefined);

  assert.equal(comboPassed.evidence[0].status, 'passed');
  assert.notEqual(
    comboPassed.evidence[0].proofLevel,
    'API_PASS',
    'Generic PASSED must not receive API_PASS proof'
  );
  assert.equal(comboPassed.evidence[0].proofLevel, undefined);
  assert.equal(comboPassed.evidence[0].level, undefined);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
