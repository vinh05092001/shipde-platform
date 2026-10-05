'use strict';

/**
 * Ship Dễ — TASK-AI-93 contract tests:
 * Per-domain attempt cap and failure evidence apply to every lane (writer, repair, reviewer).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const orchestrate = require('../orchestrate');
const routing = require('../routing');
const candidatesApi = require('../candidates');
const evidence = require('../evidence');

const NOW = Date.parse('2026-10-05T09:00:00.000Z');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sampleCandidate(overrides) {
  const o = overrides || {};
  const c = Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'xmtp',
      accountId: 'ninerouter',
      quotaScope: 'ninerouter',
      modelId: 'xmtp/mimo-v2.6-pro',
      quality: 90,
      latencyMs: 1000,
      capabilities: { tools: true, jsonSchema: true, contextWindow: 64000 },
      evidence: [],
    },
    o
  );
  if (o.capabilities) c.capabilities = Object.assign({ contextWindow: 64000 }, o.capabilities);
  c.candidateKey = candidatesApi.candidateKey(c);
  return c;
}

describe('TASK-AI-93: per-domain attempt cap and failure evidence across all lanes', () => {
  let tempRoot, evidenceDir, decisionDir;

  beforeEach(() => {
    tempRoot = tmpDir('task-ai-93-');
    evidenceDir = path.join(tempRoot, 'evidence');
    decisionDir = path.join(tempRoot, 'decisions');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(decisionDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  });

  // A-R01: domainAttempts is work-item scoped and shared by writer, repair and reviewer selection;
  // the third attempt in a domain is refused and the next candidate outside it is chosen,
  // or the item ends BLOCKED NO_ALTERNATE_FAILURE_DOMAIN.
  test('A-R01: domainAttempts is shared across writer, reviewer, and repair; 3rd attempt in domain is refused and next outside chosen', async () => {
    // candX1, candX2, candX3 in domain X
    const candX1 = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-x',
      modelId: 'domain-x/model-1',
      quality: 99,
    });
    const candX2 = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-x',
      modelId: 'domain-x/model-2',
      quality: 98,
    });
    const candX3 = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-x',
      modelId: 'domain-x/model-3',
      quality: 97,
    });
    // candY in domain Y
    const candY = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-y',
      modelId: 'domain-y/model-1',
      quality: 85,
    });
    // candZ in domain Z (reviewer)
    const candZ = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-z',
      modelId: 'domain-z/model-1',
      quality: 75,
    });

    const launchedKeys = [];
    const repairKeys = [];
    const run = (job) => {
      launchedKeys.push(job.candidateKey);
      if (job.title && String(job.title).includes('repair')) {
        repairKeys.push(job.candidateKey);
      }
      if (job.usageFile) {
        fs.writeFileSync(
          job.usageFile,
          JSON.stringify({ session_id: 'sess-' + launchedKeys.length })
        );
      }
      // Model-scoped failure for candX1 in writer
      if (job.candidateKey === candX1.candidateKey) {
        return { exitCode: 1, httpStatus: 404, stderr: 'model not found' };
      }
      return { exitCode: 0, stdout: 'ok' };
    };

    let reviewRound = 0;
    const reviewer = (sha) => {
      reviewRound += 1;
      if (reviewRound === 1) {
        return {
          sha,
          verdict: 'CHANGES_REQUIRED',
          findings: [{ id: 'NEED_FIX', open: true }],
        };
      }
      return { sha, verdict: 'PASS', findings: [] };
    };

    // Candidate candX1 used attempt 1 in domain X (writer, failed).
    // Candidate candX2 used attempt 2 in domain X (writer, succeeded).
    // Review requires changes.
    // Domain X now has 2 attempts.
    // Repair lane must NOT select domain X (candX3 has quality 97, higher than candY at 85).
    // Third attempt in domain X must be refused, selecting candY instead!
    const result = await orchestrate.runOrchestration('Goal for A-R01', {
      specs: [
        {
          id: 'ITEM-93-R01',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candX1, candX2, candX3, candY, candZ],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
      reviewer,
      sha: '1111111111111111111111111111111111111111',
      baseSha: '1111111111111111111111111111111111111111',
    });

    assert.equal(launchedKeys[0], candX1.candidateKey, 'attempt 1: candX1');
    assert.equal(launchedKeys[1], candX2.candidateKey, 'attempt 2: candX2');
    assert.ok(repairKeys.length > 0, 'repair round was executed');
    assert.ok(
      !repairKeys.includes(candX3.candidateKey),
      'candX3 was refused because domain X already had 2 attempts'
    );
    assert.ok(
      !repairKeys.some((k) => k.includes('domain-x')),
      'repair lane never selected domain X for attempt 3'
    );
    assert.equal(repairKeys[0], candY.candidateKey, 'repair chose candY outside domain X');
  });

  test('A-R01: item ends BLOCKED NO_ALTERNATE_FAILURE_DOMAIN when all domains reach attempt cap', async () => {
    const candD1 = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-single',
      modelId: 'dom-single/m1',
      quality: 95,
    });
    const candD2 = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-single',
      modelId: 'dom-single/m2',
      quality: 90,
    });

    const launchedKeys = [];
    const run = (job) => {
      launchedKeys.push(job.candidateKey);
      if (job.usageFile) {
        fs.writeFileSync(
          job.usageFile,
          JSON.stringify({ session_id: 'sess-' + launchedKeys.length })
        );
      }
      return { exitCode: 1, httpStatus: 404, stderr: 'model not found' };
    };

    const result = await orchestrate.runOrchestration('Goal for A-R01 Blocked', {
      specs: [
        {
          id: 'ITEM-93-R01-BLOCKED',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candD1, candD2],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
    });

    const outcomes = (result.log && result.log.outcomes) || result.outcomes;
    assert.ok(outcomes && outcomes.length > 0);
    const outcome = outcomes[0];
    assert.equal(String(outcome.status).toLowerCase(), 'blocked');
    assert.equal(outcome.reasonCode, 'NO_ALTERNATE_FAILURE_DOMAIN');
    assert.ok(Array.isArray(outcome.triedKeys));
    assert.equal(outcome.triedKeys.length, 2);
  });

  // A-R02: a repair-lane launch failure is recorded through the same evidence path and directory as a writer failure.
  test('A-R02: repair-lane launch failure is recorded through the same evidence path and directory as writer failure', async () => {
    const candWriter = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-w',
      modelId: 'dom-w/m1',
      quality: 90,
    });
    const candRepair = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-rep',
      modelId: 'dom-rep/m1',
      quality: 95,
    });
    const candReviewer = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-rev',
      modelId: 'dom-rev/m1',
      quality: 80,
    });

    const run = (job) => {
      if (job.usageFile) {
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-a-r02' }));
      }
      if (job.title && String(job.title).includes('repair')) {
        // Repair launch failure
        return {
          exitCode: 1,
          httpStatus: 500,
          stderr: 'internal error during repair',
        };
      }
      return { exitCode: 0, stdout: 'ok' };
    };

    let reviewRound = 0;
    const reviewer = (sha) => {
      reviewRound += 1;
      if (reviewRound === 1) {
        return {
          sha,
          verdict: 'CHANGES_REQUIRED',
          findings: [{ id: 'NEED_REPAIR', open: true }],
        };
      }
      return { sha, verdict: 'PASS', findings: [] };
    };

    const result = await orchestrate.runOrchestration('Goal for A-R02', {
      specs: [
        {
          id: 'ITEM-93-R02',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candWriter, candRepair, candReviewer],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
      reviewer,
      sha: '2222222222222222222222222222222222222222',
      baseSha: '2222222222222222222222222222222222222222',
    });

    // Evidence must be persisted in evidenceDir just like writer failure
    const evData = evidence.loadEvidence(evidenceDir);
    assert.ok(evData, 'evidence data exists on disk');
    const repairEvidence = evidence.getEvidence(evData, candRepair);
    assert.ok(
      repairEvidence.length > 0,
      'repair failure must appear in evidence store for candidate'
    );
    assert.equal(repairEvidence[0].status, 'failed');
    assert.equal(repairEvidence[0].exitCode, 1);
  });

  // A-R03: tests: writer fails twice in domain X (model scope) then repair must not select X; repair failure appears in the run's evidence data.
  test('A-R03: writer fails twice in domain X (model scope) then repair must not select X; repair failure appears in the runs evidence data', async () => {
    const candX1 = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-x',
      modelId: 'domain-x/model-1',
      quality: 99,
    });
    const candX2 = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-x',
      modelId: 'domain-x/model-2',
      quality: 98,
    });
    const candX3 = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-x',
      modelId: 'domain-x/model-3',
      quality: 97,
    });
    const candY = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-y',
      modelId: 'domain-y/model-1',
      quality: 85,
    });

    // Unit test check on repairRound:
    // If writer attempted domain X twice, repairRound must not select domain X
    const item = {
      id: 'ITEM-93-UNIT',
      files: ['file.js'],
      roleRequirement: { role: 'writer' },
      failedKeys: new Set([candX1.candidateKey, candX2.candidateKey]),
      domainAttempts: new Map([[routing.canonicalFailureDomain(candX1), 2]]),
    };

    let repairRoundLaunchedKey = null;
    const repairFn = orchestrate.repairRound(
      { specs: [item] },
      item,
      { candidateKey: candY.candidateKey },
      { goal: 'repair goal', review: { review: { repairCount: 0 } } },
      {},
      (job) => {
        repairRoundLaunchedKey = job.candidateKey;
        return { exitCode: 1, stderr: 'repair launch failed' };
      },
      tempRoot,
      NOW,
      [candX1, candX2, candX3, candY],
      null,
      null,
      {
        failedKeys: item.failedKeys,
        domainAttempts: item.domainAttempts,
        evidenceDir,
      }
    );

    await repairFn([{ id: 'FINDING', open: true }], '3333333333333333333333333333333333333333');

    // 1. Repair must NOT select candidate in domain X (even candX3 with quality 97 > 85)
    assert.equal(
      repairRoundLaunchedKey,
      candY.candidateKey,
      'repairRound selected candY, never domain X'
    );

    // 2. Repair failure appears in the run's evidence data
    const evData = evidence.loadEvidence(evidenceDir);
    assert.ok(evData, 'evidence must be saved to disk');
    const repairEvidence = evidence.getEvidence(evData, candY);
    assert.ok(repairEvidence.length > 0, 'repair failure appears in evidence data');
    assert.equal(repairEvidence[0].status, 'failed');
  });

  test('A-R03 end-to-end: writer fails twice in domain X (model scope) then repair selects outside X, and repair failure appears in runs evidence data', async () => {
    const candX1 = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-x',
      modelId: 'dom-x/m1',
      quality: 99,
    });
    const candX2 = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-x',
      modelId: 'dom-x/m2',
      quality: 98,
    });
    const candX3 = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-x',
      modelId: 'dom-x/m3',
      quality: 97,
    });
    const candY = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-y',
      modelId: 'dom-y/m1',
      quality: 85,
    });
    const candZ = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-z',
      modelId: 'dom-z/m1',
      quality: 75,
    });

    const launchedKeys = [];
    const repairKeys = [];
    const run = (job) => {
      launchedKeys.push(job.candidateKey);
      if (job.title && String(job.title).includes('repair')) {
        repairKeys.push(job.candidateKey);
        // Repair fails
        return { exitCode: 1, httpStatus: 500, stderr: 'repair launch failed' };
      }
      if (job.usageFile) {
        fs.writeFileSync(
          job.usageFile,
          JSON.stringify({ session_id: 'sess-' + launchedKeys.length })
        );
      }
      // Writer fails twice in domain X (candX1 and candX2 with model-scoped failure)
      if (job.candidateKey === candX1.candidateKey || job.candidateKey === candX2.candidateKey) {
        return { exitCode: 1, httpStatus: 404, stderr: 'model not found' };
      }
      return { exitCode: 0, stdout: 'ok' };
    };

    let reviewRound = 0;
    const reviewer = (sha) => {
      reviewRound += 1;
      if (reviewRound === 1) {
        return {
          sha,
          verdict: 'CHANGES_REQUIRED',
          findings: [{ id: 'NEED_FIX_2', open: true }],
        };
      }
      return { sha, verdict: 'PASS', findings: [] };
    };

    const result = await orchestrate.runOrchestration('Goal for A-R03 e2e', {
      specs: [
        {
          id: 'ITEM-93-R03-E2E',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candX1, candX2, candX3, candY, candZ],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
      reviewer,
      sha: '4444444444444444444444444444444444444444',
      baseSha: '4444444444444444444444444444444444444444',
    });

    // 1. Writer attempted candX1 and candX2 (both failed in domain X)
    assert.equal(launchedKeys[0], candX1.candidateKey);
    assert.equal(launchedKeys[1], candX2.candidateKey);
    // Writer succeeded with candY
    assert.equal(launchedKeys[2], candY.candidateKey);

    // 2. Repair must NOT select domain X (candX3)
    assert.ok(repairKeys.length > 0, 'repair was invoked');
    assert.ok(
      !repairKeys.some((k) => k.includes('dom-x')),
      'repair must not select any candidate in domain dom-x'
    );
    assert.equal(repairKeys[0], candY.candidateKey);

    // 3. Repair failure appears in the run's evidence data
    const evData = evidence.loadEvidence(evidenceDir);
    assert.ok(evData, 'evidence persisted to disk');
    const repairEv = evidence.getEvidence(evData, candY);
    assert.ok(repairEv.length > 0, 'repair failure recorded in evidence store');
    assert.equal(repairEv[0].status, 'failed');

    // Also check result.evidenceData / result.log.evidenceData
    const runEvData = (result.log && result.log.evidenceData) || result.evidenceData;
    assert.ok(runEvData, 'run log carries evidenceData');
    const runRepairEv = evidence.getEvidence(runEvData, candY);
    assert.ok(runRepairEv.length > 0, 'repair failure appears in runs evidence data');
  });
});
