'use strict';

/**
 * Ship Dễ — TASK-AI-80 contract tests:
 * Controller selector defects (catalogue/evidence sync, zero scores,
 * canonical failure domain, real pinned launch).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const routing = require('../routing');
const candidatesApi = require('../candidates');
const evidence = require('../evidence');
const quotaStore = require('../quota-store');
const { dispatchCommand, assembleForDispatch } = require('../cli');

const NOW = Date.parse('2026-10-04T12:00:00.000Z');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sampleProfile(overrides) {
  return Object.assign(
    {
      taskId: 'TASK-AI-80-TEST',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      contextSize: 4000,
      expectedDuration: 30000,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 10000,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 4,
      currentWorkload: 0,
    },
    overrides || {}
  );
}

function readLastDecision(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  if (files.length === 0) return null;
  const content = fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  return lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : null;
}

function sampleCandidate(overrides) {
  const o = overrides || {};
  const c = Object.assign(
    {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'gw-80',
      upstream: 'up-80',
      accountId: 'acct-80',
      quotaScope: 'acct-80',
      modelId: 'up-80/model-80',
      contextWindow: 64000,
      evidence: [],
    },
    o,
    {
      capabilities: Object.assign({ contextWindow: 64000 }, o.capabilities || {}),
    }
  );
  c.candidateKey = candidatesApi.candidateKey(c);
  return c;
}

describe('TASK-AI-80 Controller selector contract tests', () => {
  let tempRoot;
  let evidenceDir;
  let decisionDir;
  let homeDir;
  let storePath;

  beforeEach(() => {
    tempRoot = tmpDir('task-ai-80-test-');
    evidenceDir = path.join(tempRoot, 'evidence');
    decisionDir = path.join(tempRoot, 'decisions');
    homeDir = path.join(tempRoot, 'home');
    storePath = path.join(homeDir, 'quota.json');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(decisionDir, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify({ reservations: {} }), 'utf8');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  });

  // D1 catalogue/evidence sync: E-R01
  test('E-R01: a candidate whose 7-part key has passed evidence is included in candidate list even when absent from catalogue', async () => {
    const passedCandidate = sampleCandidate({
      gateway: 'gw-ev-only',
      upstream: 'up-ev-only',
      accountId: 'acc-ev-only',
      modelId: 'up-ev-only/model-only-in-evidence',
    });

    // Record WORK_ITEM_PASS evidence into evidence store for this key
    evidence.recordProbe(evidenceDir, passedCandidate, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'writer',
      taskId: 'FEAT-PREV-PASS',
    });

    const prof = sampleProfile({
      proofFloor: 'WORK_ITEM_PASS',
    });
    const profFile = path.join(tempRoot, 'profile-e-r01.json');
    fs.writeFileSync(profFile, JSON.stringify(prof, null, 2), 'utf8');

    // Run dispatchCommand in dry-run with an EMPTY discovery catalogue
    const lines = [];
    const res = await dispatchCommand(
      {
        profile: profFile,
        'dry-run': true,
        'evidence-dir': evidenceDir,
        'decision-dir': decisionDir,
      },
      {
        home: homeDir,
        storePath,
        evidenceDir,
        decisionDir,
        discoveryDataDir: path.join(tempRoot, 'empty-discovery'),
        now: NOW,
        log: (s) => lines.push(String(s)),
        error: (s) => lines.push('ERR: ' + String(s)),
        exit: () => {},
      }
    );

    assert.equal(res.exitCode, 0, 'dispatch dry-run must succeed: ' + lines.join('\n'));
    assert.equal(
      res.pinnedCandidateKey,
      passedCandidate.candidateKey,
      'passed candidate from evidence is ranked and pinned'
    );
    assert.ok(res.ranking.some((c) => c.candidateKey === passedCandidate.candidateKey));
  });

  // D2 zero scores: E-R02, E-R03, E-R04
  test('E-R02: rankForProfile computes non-zero, differentiated scores from evidence and reports unknown components as null', () => {
    const prof = sampleProfile();
    const assessment = {
      jevOutcome: 'DECIDED',
      weightProfile: 'BALANCED',
      weights: { latency: 34, quality: 33, cost: 33 },
    };

    // Candidate 1 has WORK_ITEM_PASS evidence + latency
    const c1 = sampleCandidate({
      accountId: 'acct-1',
      latencyMs: 1000,
      evidence: [
        { status: 'passed', proofLevel: 'WORK_ITEM_PASS', ts: new Date(NOW - 1000).toISOString() },
      ],
    });

    // Candidate 2 has HARNESS_PASS evidence, older timestamp
    const c2 = sampleCandidate({
      accountId: 'acct-2',
      latencyMs: 5000,
      evidence: [
        {
          status: 'passed',
          proofLevel: 'HARNESS_PASS',
          ts: new Date(NOW - 10 * 86400000).toISOString(),
        },
        { status: 'failed', ts: new Date(NOW - 11 * 86400000).toISOString() },
      ],
    });

    // Candidate 3 has no evidence, no latency, no cost
    const c3 = sampleCandidate({
      accountId: 'acct-3',
      evidence: [],
    });

    const res = routing.rankForProfile([c1, c2, c3], prof, assessment, { now: NOW });
    const r1 = res.ranking.find((c) => c.candidateKey === c1.candidateKey);
    const r2 = res.ranking.find((c) => c.candidateKey === c2.candidateKey);
    const r3 = res.ranking.find((c) => c.candidateKey === c3.candidateKey);

    assert.ok(r1.score > 0, 'c1 has positive score');
    assert.ok(r2.score > 0, 'c2 has positive score');
    assert.ok(
      r1.score > r2.score,
      'c1 with WORK_ITEM_PASS and fresh evidence scores higher than c2'
    );
    assert.equal(r3.score, 0, 'c3 without evidence or measurements scores 0');

    // Check breakdown has nulls for unknown components and never 50
    assert.notEqual(r3.scoreBreakdown.quality, 50);
    assert.notEqual(r3.scoreBreakdown.cost, 50);
    assert.notEqual(r3.scoreBreakdown.latency, 50);
    assert.strictEqual(r3.scoreBreakdown.quality, null);
    assert.strictEqual(r3.scoreBreakdown.reliability, null);
    assert.strictEqual(r3.scoreBreakdown.latency, null);
    assert.strictEqual(r3.scoreBreakdown.cost, null);

    // Reliability calculation: c1 has 1 pass 0 fail = 100%, c2 has 1 pass 1 fail = 50%
    assert.equal(r1.scoreBreakdown.reliability, 100);
    assert.equal(r2.scoreBreakdown.reliability, 50);
  });

  test('E-R03: when every candidate scores 0, reasonCode is MODEL_SELECTION_NOT_PROVEN and --execute refuses unless exploration-budget > 0', async () => {
    const prof = sampleProfile({ taskId: 'TASK-E-R03' });
    const profFile = path.join(tempRoot, 'profile-e-r03.json');
    fs.writeFileSync(profFile, JSON.stringify(prof, null, 2), 'utf8');

    const cZero = sampleCandidate({ accountId: 'acc-unproven', evidence: [] });

    // 1. Without exploration budget: --execute refuses to reserve and exits 1
    let exitCodeNoBudget = null;
    const linesNoBudget = [];
    const resNoBudget = await routing.runProfileDispatch(
      { profile: profFile, execute: true },
      {
        candidates: [cZero],
        storePath,
        home: homeDir,
        decisionDir,
        now: NOW,
        log: (s) => linesNoBudget.push(String(s)),
        error: (s) => linesNoBudget.push('ERR: ' + String(s)),
        exit: (code) => {
          exitCodeNoBudget = code;
        },
      }
    );

    assert.equal(exitCodeNoBudget, 1, 'must exit 1 when all candidates score 0');
    assert.equal(resNoBudget.exitCode, 1);
    assert.equal(resNoBudget.refused, 'MODEL_SELECTION_NOT_PROVEN');

    // 2. With exploration budget > 0: --execute allows selection and records EXPLORATION
    let exitCodeBudget = null;
    const linesBudget = [];
    const resBudget = await routing.runProfileDispatch(
      { profile: profFile, execute: true, 'exploration-budget': 1 },
      {
        candidates: [cZero],
        storePath,
        home: homeDir,
        decisionDir,
        explorationBudget: 1,
        now: NOW,
        log: (s) => linesBudget.push(String(s)),
        error: (s) => linesBudget.push('ERR: ' + String(s)),
        exit: (code) => {
          exitCodeBudget = code;
        },
      }
    );

    assert.equal(exitCodeBudget, 0, 'must exit 0 with exploration budget');
    assert.equal(resBudget.exitCode, 0);
    assert.equal(resBudget.pinnedCandidateKey, cZero.candidateKey);

    // Verify decision log recorded EXPLORATION
    const lastDec = readLastDecision(decisionDir);
    assert.ok(lastDec, 'decision log exists');
    assert.ok(
      lastDec.reasonCode === 'EXPLORATION' ||
        lastDec.detail === 'EXPLORATION' ||
        (lastDec.reason && lastDec.reason.includes('EXPLORATION'))
    );
  });

  test('E-R04: three candidates with different evidence get different scores and changing evidence changes order', () => {
    const prof = sampleProfile();
    const assessment = {
      jevOutcome: 'DECIDED',
      weightProfile: 'QUALITY_FIRST',
      weights: { latency: 10, quality: 65, cost: 25 },
    };

    const cA = sampleCandidate({
      accountId: 'acc-a',
      evidence: [
        { status: 'passed', proofLevel: 'WORK_ITEM_PASS', ts: new Date(NOW - 1000).toISOString() },
      ],
    });
    const cB = sampleCandidate({
      accountId: 'acc-b',
      evidence: [
        { status: 'passed', proofLevel: 'HARNESS_PASS', ts: new Date(NOW - 1000).toISOString() },
      ],
    });
    const cC = sampleCandidate({
      accountId: 'acc-c',
      evidence: [
        { status: 'passed', proofLevel: 'API_PASS', ts: new Date(NOW - 1000).toISOString() },
      ],
    });

    const res1 = routing.rankForProfile([cA, cB, cC], prof, assessment, { now: NOW });
    assert.equal(res1.chosen, cA.candidateKey, 'cA ranks first with WORK_ITEM_PASS');
    assert.equal(res1.top3[1].candidateKey, cB.candidateKey);
    assert.equal(res1.top3[2].candidateKey, cC.candidateKey);

    // Now change evidence: cC gets WORK_ITEM_PASS, cA gets failed outcomes
    cC.evidence = [
      { status: 'passed', proofLevel: 'WORK_ITEM_PASS', ts: new Date(NOW).toISOString() },
      { status: 'passed', proofLevel: 'WORK_ITEM_PASS', ts: new Date(NOW).toISOString() },
    ];
    cA.evidence = [
      { status: 'failed', ts: new Date(NOW).toISOString() },
      { status: 'failed', ts: new Date(NOW).toISOString() },
    ];

    const res2 = routing.rankForProfile([cA, cB, cC], prof, assessment, { now: NOW });
    assert.equal(res2.chosen, cC.candidateKey, 'cC now ranks first after evidence change');
  });

  // D3 canonical failure domain: E-R05
  test('E-R05: canonicalFailureDomain accepts "ocz", "9router/ocz", 7-part key and candidate object, and forbiddenFailureDomains excludes all', () => {
    assert.equal(typeof routing.canonicalFailureDomain, 'function');

    const key = 'paseo::cli::9router::ocz::ninerouter::ninerouter::ocz/big-pickle';
    const candObj = { gateway: '9router', upstream: 'ocz' };

    const fd1 = routing.canonicalFailureDomain('ocz');
    const fd2 = routing.canonicalFailureDomain('9router/ocz');
    const fd3 = routing.canonicalFailureDomain(key);
    const fd4 = routing.canonicalFailureDomain(candObj);

    assert.equal(fd1, '9router/ocz');
    assert.equal(fd2, '9router/ocz');
    assert.equal(fd3, '9router/ocz');
    assert.equal(fd4, '9router/ocz');

    // Verify forbiddenFailureDomains excluding candidate with any of those forms
    const testCandidate = sampleCandidate({ gateway: '9router', upstream: 'ocz' });
    const assessment = {
      jevOutcome: 'DECIDED',
      weightProfile: 'BALANCED',
      weights: { latency: 34, quality: 33, cost: 33 },
    };

    for (const forbiddenForm of ['ocz', '9router/ocz', key, candObj]) {
      const p = sampleProfile({ forbiddenFailureDomains: [forbiddenForm] });
      const ranked = routing.rankForProfile([testCandidate], p, assessment, { now: NOW });
      assert.equal(
        ranked.chosen,
        null,
        'must exclude candidate when forbidden is: ' + JSON.stringify(forbiddenForm)
      );
      assert.ok(ranked.rejected.some((r) => r.reasonCode === 'FORBIDDEN_FAILURE_DOMAIN'));
    }
  });

  // D4 real pinned launch: E-R06, E-R07, E-R08
  test('E-R06: dispatch --execute returns structured launchRequest and calls injectable launcher without modifying identity', async () => {
    const c = sampleCandidate({
      gateway: 'gw-pin',
      upstream: 'up-pin',
      accountId: 'acc-pin',
      modelId: 'up-pin/model-pin',
      latencyMs: 1000,
      evidence: [{ status: 'passed', proofLevel: 'API_PASS', ts: new Date(NOW).toISOString() }],
    });
    const prof = sampleProfile({ taskId: 'TASK-PIN-01' });
    const profFile = path.join(tempRoot, 'profile-e-r06.json');
    fs.writeFileSync(profFile, JSON.stringify(prof, null, 2), 'utf8');

    let capturedLaunchRequest = null;
    const fakeLauncher = async (req) => {
      capturedLaunchRequest = Object.assign({}, req);
      return { status: 'completed', exitCode: 0 };
    };

    const res = await routing.runProfileDispatch(
      { profile: profFile, execute: true, launch: true },
      {
        candidates: [c],
        launcher: fakeLauncher,
        storePath,
        home: homeDir,
        decisionDir,
        now: NOW,
        log: () => {},
        error: () => {},
        exit: () => {},
      }
    );

    assert.equal(res.exitCode, 0);
    assert.ok(res.launchRequest, 'must return structured launchRequest');
    assert.equal(res.launchRequest.candidateKey, c.candidateKey);
    assert.equal(res.launchRequest.harness, c.harness);
    assert.equal(res.launchRequest.accessPath, c.accessPath);
    assert.equal(res.launchRequest.gateway, c.gateway);
    assert.equal(res.launchRequest.upstream, c.upstream);
    assert.equal(res.launchRequest.account, c.accountId);
    assert.equal(res.launchRequest.modelId, c.modelId);
    assert.ok(res.launchRequest.reservationId, 'must include reservationId');

    assert.deepEqual(capturedLaunchRequest, res.launchRequest);
  });

  test('E-R07: launch failure releases reservation and records outcome against reservationId; success records outcome', async () => {
    const c = sampleCandidate({
      gateway: 'gw-pin-fail',
      upstream: 'up-pin-fail',
      accountId: 'acc-pin-fail',
      latencyMs: 1000,
      evidence: [{ status: 'passed', proofLevel: 'API_PASS', ts: new Date(NOW).toISOString() }],
    });
    const prof = sampleProfile({ taskId: 'TASK-PIN-FAIL' });
    const profFile = path.join(tempRoot, 'profile-e-r07.json');
    fs.writeFileSync(profFile, JSON.stringify(prof, null, 2), 'utf8');

    // 1. Failing launcher
    let exitCode = null;
    const failingLauncher = async () => {
      return { status: 'failed', exitCode: 1, reason: 'SIMULATED_CRASH' };
    };

    const res = await routing.runProfileDispatch(
      { profile: profFile, execute: true, launch: true },
      {
        candidates: [c],
        launcher: failingLauncher,
        storePath,
        home: homeDir,
        decisionDir,
        now: NOW,
        log: () => {},
        error: () => {},
        exit: (code) => {
          exitCode = code;
        },
      }
    );

    assert.equal(exitCode, 1, 'failing launch must exit 1');

    // Reservation must be released in quota store
    const reservations = quotaStore.getReservations({ home: homeDir, path: storePath });
    assert.equal(
      Object.keys(reservations).filter((k) => k.startsWith('TASK-PIN-FAIL::')).length,
      0,
      'reservation must be released on launch failure'
    );

    // Decision log must record failure with the reservationId
    const failDec = readLastDecision(decisionDir);
    assert.ok(failDec);
    assert.equal(failDec.reservationId, res.launchRequest.reservationId);
    assert.equal(failDec.stage, 'failed');

    // 2. Successful launcher
    const profSuccess = sampleProfile({ taskId: 'TASK-PIN-SUCCESS' });
    const profFileSuccess = path.join(tempRoot, 'profile-e-r07-success.json');
    fs.writeFileSync(profFileSuccess, JSON.stringify(profSuccess, null, 2), 'utf8');

    const successLauncher = async () => {
      return { status: 'completed', exitCode: 0 };
    };

    const resSuccess = await routing.runProfileDispatch(
      { profile: profFileSuccess, execute: true, launch: true },
      {
        candidates: [c],
        launcher: successLauncher,
        storePath,
        home: homeDir,
        decisionDir,
        now: NOW,
        log: () => {},
        error: () => {},
        exit: () => {},
      }
    );

    assert.equal(resSuccess.exitCode, 0);
    const successDec = readLastDecision(decisionDir);
    assert.ok(successDec);
    assert.equal(successDec.reservationId, resSuccess.launchRequest.reservationId);
    assert.ok(successDec.stage === 'completed' || successDec.stage === 'selected');
  });

  test('E-R08: a candidate whose account cannot be pinned is recorded as account "UNPINNED" everywhere', async () => {
    const c = sampleCandidate({
      gateway: 'gw-unpinned',
      upstream: 'up-unpinned',
      accountId: 'UNPINNED',
      latencyMs: 1000,
      evidence: [{ status: 'passed', proofLevel: 'API_PASS', ts: new Date(NOW).toISOString() }],
    });
    const prof = sampleProfile({ taskId: 'TASK-UNPINNED' });
    const profFile = path.join(tempRoot, 'profile-e-r08.json');
    fs.writeFileSync(profFile, JSON.stringify(prof, null, 2), 'utf8');

    const res = await routing.runProfileDispatch(
      { profile: profFile, execute: true },
      {
        candidates: [c],
        storePath,
        home: homeDir,
        decisionDir,
        now: NOW,
        log: () => {},
        error: () => {},
        exit: () => {},
      }
    );

    assert.equal(res.exitCode, 0);
    assert.equal(res.launchRequest.account, 'UNPINNED');

    // Reservation in quota-store must record accountId as UNPINNED
    const reservations = quotaStore.getReservations({ home: homeDir, path: storePath });
    const resEntry = Object.values(reservations).find((r) => r.workItemId === 'TASK-UNPINNED');
    assert.ok(resEntry, 'reservation recorded');
    assert.equal(resEntry.accountId, 'UNPINNED');

    // Decision log must record account as UNPINNED
    const decFiles = fs.readdirSync(decisionDir);
    const lastDec = JSON.parse(
      fs.readFileSync(path.join(decisionDir, decFiles[decFiles.length - 1]), 'utf8')
    );
    const chosenRank = lastDec.ranking.find((r) => r.candidateKey === res.pinnedCandidateKey);
    assert.equal(chosenRank.account, 'UNPINNED');
  });
});
