'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

test('TASK-AI-142 P1-1: sweep-import derives candidates from dispatch config so live candidates are excluded', () => {
  const sweepImport = require('../sweep-import');
  const cli = require('../cli');
  const evidence = require('../evidence');
  const { candidateKey } = require('../discovery/identity');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p1-dispatch-'));
  const evidenceDir = path.join(tmpDir, 'evidence');
  const sweepFile = path.join(tmpDir, 'sweep.json');

  // Registry and accounts configuring this live candidate
  const registry = {
    version: 2,
    sources: [
      {
        id: 'aihubmix',
        kind: 'model-source',
        servesModels: true,
        harness: 'opencode',
        accessPath: 'cli',
        endpoint: 'https://aihubmix.com/v1',
      },
    ],
    dispatch: {
      rateLimitCooldownMs: 300000,
    },
  };
  const accounts = [
    {
      id: 'live-acc-prod',
      provider: 'aihubmix',
      source: 'aihubmix',
      models: ['aihubmix/qwen3.8-max'],
    },
  ];

  // Live candidate derived directly from dispatch config
  const liveCandidates = cli.assembleForDispatch({ candidates: [] }, accounts, registry, {
    allowUnprobedCandidates: true,
  });
  const liveCandidate = liveCandidates[0];
  const liveKey = liveCandidate.key || candidateKey(liveCandidate);

  // Sweep row reports account-scoped failure (QUOTA) without supplying account/quota identifiers
  fs.writeFileSync(
    sweepFile,
    JSON.stringify({
      at: '2026-10-19T08:00:00.000Z',
      rows: [
        {
          source: 'aihubmix',
          model: 'aihubmix/qwen3.8-max',
          status: 'HTTP_402',
          err: 'Payment required: balance insufficient',
        },
      ],
    }),
    'utf8'
  );

  // Normal import via CLI or runSweepImport without passing an explicit candidates array
  cli.main(['sweep-import', sweepFile, '--evidence-dir', evidenceDir], {
    registry,
    accounts,
  });

  const evData = evidence.loadEvidence(evidenceDir);

  // The cooldown must match the live candidate's exact candidateKey from dispatch config
  assert.ok(
    evData.cooldowns[liveKey],
    `Cooldown must be recorded under live candidateKey: ${liveKey}`
  );
  assert.equal(evData.cooldowns[liveKey].cause, 'QUOTA');

  // Verify dispatch --dry-run excludes the live candidate with QUOTA
  const dispatchRes = cli.dispatchCommand(
    { 'dry-run': true },
    {
      candidates: liveCandidates,
      evidenceDir,
      registry,
      accounts,
      now: Date.parse('2026-10-19T08:00:00.000Z') + 1000,
      items: [{ workItemId: 'TASK-AI-142', role: 'writer' }],
      log: () => {},
      exit: () => {},
    }
  );

  const rejected = dispatchRes.decision.rejected || [];
  const found = rejected.find((r) => (r.offeringId || r.candidateKey) === liveKey);
  assert.ok(found, 'Dispatch must exclude the live candidate matching dispatch config');
  assert.equal(found.reason, 'QUOTA');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1-2: older failure does not overwrite newer successful probe cooldown', () => {
  const sweepImport = require('../sweep-import');
  const evidence = require('../evidence');
  const { candidateKey } = require('../discovery/identity');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p1-reverse-order-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const cand = {
    harness: 'direct-http',
    accessPath: 'https://aihubmix.com/v1',
    gateway: 'aihubmix',
    upstream: 'aihubmix',
    accountId: 'acc-order',
    quotaScope: 'scope-order',
    modelId: 'aihubmix/qwen3.8-max',
    source: 'aihubmix',
  };
  cand.candidateKey = candidateKey(cand);

  const tNewerSuccess = '2026-10-19T02:00:00.000Z';
  const tOlderFailure = '2026-10-19T01:00:00.000Z';

  // Step 1: Import newer success at T2
  const sweepPass = {
    at: tNewerSuccess,
    rows: [
      {
        source: 'aihubmix',
        model: 'aihubmix/qwen3.8-max',
        accountId: 'acc-order',
        quotaScope: 'scope-order',
        status: 'TOOLS_OK',
        ms: 150,
      },
    ],
  };
  sweepImport.importSweep(sweepPass, {
    evidenceDir,
    candidates: [cand],
    persist: true,
  });

  let evData = evidence.loadEvidence(evidenceDir);
  assert.equal(
    evData.cooldowns?.[cand.candidateKey],
    undefined,
    'Route must not have cooldown after successful probe'
  );

  // Step 2: Import older failure at T1 (before T2)
  const sweepOldFail = {
    at: tOlderFailure,
    rows: [
      {
        source: 'aihubmix',
        model: 'aihubmix/qwen3.8-max',
        accountId: 'acc-order',
        quotaScope: 'scope-order',
        status: 'HTTP_402',
        err: 'Payment required: out of credit',
      },
    ],
  };
  sweepImport.importSweep(sweepOldFail, {
    evidenceDir,
    candidates: [cand],
    persist: true,
  });

  evData = evidence.loadEvidence(evidenceDir);
  // Re-importing an older failure must NOT re-block the route!
  assert.equal(
    evData.cooldowns?.[cand.candidateKey],
    undefined,
    'Older failure must not overwrite cooldown when newer success exists'
  );

  const blockedCheck = evidence.isCandidateBlocked(evData, cand, {
    now: Date.parse(tNewerSuccess) + 1000,
  });
  assert.equal(
    blockedCheck.blocked,
    false,
    'Candidate must remain unblocked after older failure import'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P1-3: RATE failures derive finite cooldown from sources.json dispatch configuration', () => {
  const sweepImport = require('../sweep-import');
  const evidence = require('../evidence');
  const sources = require('../sources');
  const { candidateKey } = require('../discovery/identity');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p1-rate-limit-'));
  const evidenceDir = path.join(tmpDir, 'evidence');

  const cand = {
    harness: 'direct-http',
    accessPath: 'https://fastapi.com/v1',
    gateway: 'fastapi',
    upstream: 'fastapi',
    accountId: 'source-fastapi',
    quotaScope: 'source-fastapi',
    modelId: 'fast-429',
    source: 'fastapi',
  };
  cand.candidateKey = candidateKey(cand);

  const atTime = '2026-10-19T05:00:00.000Z';
  const atMs = Date.parse(atTime);

  // Registry with dispatch configuration specifying rateLimitCooldownMs
  const configuredRateCooldownMs = 120000; // 2 minutes
  const registry = {
    version: 2,
    sources: [
      {
        id: 'fastapi',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://fastapi.com/v1',
      },
    ],
    dispatch: {
      rateLimitCooldownMs: configuredRateCooldownMs,
    },
  };

  const sweepData = {
    at: atTime,
    rows: [
      {
        source: 'fastapi',
        model: 'fast-429',
        status: 'HTTP_429',
        err: 'Rate limit exceeded: 429 too many requests',
      },
    ],
  };

  const res = sweepImport.importSweep(sweepData, {
    evidenceDir,
    registry,
    candidates: [cand],
    persist: true,
  });

  const cd = res.evidenceData.cooldowns[cand.candidateKey];
  assert.ok(cd, 'Cooldown must be recorded for RATE failure');
  assert.equal(cd.cause, 'RATE');

  // cooldownMs must NOT be null; it must derive from dispatch configuration
  assert.notEqual(cd.cooldownMs, null, 'RATE failure must not have cooldownMs: null');
  assert.equal(
    cd.cooldownMs,
    configuredRateCooldownMs,
    'cooldownMs must match rateLimitCooldownMs from dispatch configuration'
  );

  // Before expiry: candidate is blocked
  const beforeExpiry = evidence.isCandidateBlocked(res.evidenceData, cand, {
    now: atMs + configuredRateCooldownMs - 1000,
  });
  assert.equal(beforeExpiry.blocked, true, 'Candidate must be blocked before cooldown expiry');

  // After expiry: candidate recovers on time alone without another sweep import
  const afterExpiry = evidence.isCandidateBlocked(res.evidenceData, cand, {
    now: atMs + configuredRateCooldownMs + 1000,
  });
  assert.equal(afterExpiry.blocked, false, 'Candidate must be unblocked after cooldown expiry');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TASK-AI-142 P2: cli.js sweep-import translates --evidence-dir to options.evidenceDir', () => {
  const cli = require('../cli');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-p2-evidence-dir-'));
  const isolatedEvidenceDir = path.join(tmpDir, 'custom-evidence-store');
  const sweepFile = path.join(tmpDir, 'sweep.json');

  fs.writeFileSync(
    sweepFile,
    JSON.stringify({
      at: '2026-10-19T09:00:00.000Z',
      rows: [
        {
          source: 'aihubmix',
          model: 'qwen3.8-max',
          accountId: 'acc-p2',
          status: 'HTTP_401',
          err: 'Unauthorized: invalid token',
        },
      ],
    }),
    'utf8'
  );

  assert.equal(
    fs.existsSync(isolatedEvidenceDir),
    false,
    'Evidence directory must not exist before import'
  );

  cli.main(['sweep-import', sweepFile, '--evidence-dir', isolatedEvidenceDir]);

  // Evidence file MUST be saved in isolatedEvidenceDir, not default store
  const savedEvidenceFile = path.join(isolatedEvidenceDir, 'evidence.json');
  assert.ok(fs.existsSync(savedEvidenceFile), `Evidence file must exist at ${savedEvidenceFile}`);

  const raw = fs.readFileSync(savedEvidenceFile, 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(parsed.cooldowns, 'Saved evidence must contain cooldowns');
  assert.ok(
    Object.keys(parsed.cooldowns).length > 0,
    'Saved evidence in custom-evidence-store must have cooldown records'
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
