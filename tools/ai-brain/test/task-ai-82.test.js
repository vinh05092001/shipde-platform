'use strict';

/**
 * Ship Dễ — TASK-AI-82 contract tests:
 * Orchestrate path ranks evidence-backed candidates (TASK-AI-80 D1 applied to orchestrate).
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

const NOW = Date.parse('2026-10-04T12:00:00.000Z');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sampleCandidate(overrides) {
  const o = overrides || {};
  const c = Object.assign(
    {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'xkiro',
      quotaScope: 'xkiro',
      modelId: 'ag/gemini-3.1-pro-low',
      quality: 85,
      latencyMs: 1000,
      capabilities: { tools: true, contextWindow: 64000 },
      evidence: [],
    },
    o
  );
  if (o.capabilities) c.capabilities = Object.assign({ contextWindow: 64000 }, o.capabilities);
  c.candidateKey = candidatesApi.candidateKey(c);
  return c;
}

function sampleItem(overrides) {
  return Object.assign(
    {
      id: 'TASK-AI-82-ITEM',
      roleRequirement: { role: 'writer' },
      complexity: 'standard',
      proofFloor: 'WORK_ITEM_PASS',
      verification: { command: 'node -e "process.exit(0)"', expect: '' },
    },
    overrides || {}
  );
}

describe('TASK-AI-82: orchestrate ranks evidence-backed candidates', () => {
  let tempRoot, evidenceDir, decisionDir;

  beforeEach(() => {
    tempRoot = tmpDir('task-ai-82-');
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

  // O-R01: candidate list includes candidatesFromEvidence merged with accounts/catalogue and deduplicated
  test('O-R01: candidate list includes candidatesFromEvidence, merged and deduplicated', () => {
    const candInAccounts = sampleCandidate({ accountId: 'ninerouter', quotaScope: 'ninerouter' });
    const candEvidenceOnly = sampleCandidate({
      accountId: 'xkiro',
      quotaScope: 'xkiro',
      upstream: 'ag-evidence',
      modelId: 'ag-evidence/model-1',
    });
    evidence.recordProbe(evidenceDir, candEvidenceOnly, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'writer',
      taskId: 'FEAT-RECORDED-1',
    });
    const evData = evidence.loadEvidence(evidenceDir);
    assert.equal(
      typeof orchestrate.buildCandidates,
      'function',
      'buildCandidates must be exported'
    );
    const result = orchestrate.buildCandidates(
      { candidates: [candInAccounts, candInAccounts] },
      evData
    );
    const keys = result.map((c) => candidatesApi.candidateKey(c));
    assert.ok(keys.includes(candEvidenceOnly.candidateKey), 'must include evidence-only candidate');
    assert.ok(keys.includes(candInAccounts.candidateKey), 'must include catalogue candidate');
    assert.equal(
      keys.length,
      new Set(keys).size,
      'all candidate keys must be unique (deduplicated)'
    );
  });

  // O-R02: evidence-only candidates keep evidence, capabilities, account; gateway unpinned stays 'UNPINNED'
  test('O-R02: evidence-only candidates preserve evidence, capabilities, account (UNPINNED stays UNPINNED)', async () => {
    const candCustomCaps = sampleCandidate({
      gateway: '9router',
      upstream: 'xupstream',
      accountId: 'UNPINNED',
      quotaScope: 'xupstream',
      modelId: 'xupstream/test-model',
      capabilities: { customCap: true, contextWindow: 128000 },
    });
    evidence.recordProbe(evidenceDir, candCustomCaps, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'writer',
      taskId: 'FEAT-CAPS-CHECK',
    });
    const evData = evidence.loadEvidence(evidenceDir);
    const combo = evData.combinations.find(
      (c) => candidatesApi.candidateKey(c) === candCustomCaps.candidateKey
    );
    combo.capabilities = { customCap: true, contextWindow: 128000 };
    evidence.saveEvidence(evidenceDir, evData);

    const reloadedEvData = evidence.loadEvidence(evidenceDir);
    const candidates = orchestrate.buildCandidates({ candidates: [] }, reloadedEvData);
    const found = candidates.find(
      (c) => candidatesApi.candidateKey(c) === candCustomCaps.candidateKey
    );
    assert.ok(found, 'candidate must be present');
    assert.equal(found.accountId, 'UNPINNED', 'account must stay UNPINNED');
    assert.equal(found.capabilities.customCap, true, 'capabilities must be preserved');
    assert.ok(
      Array.isArray(found.evidence) && found.evidence.length > 0,
      'evidence must be preserved'
    );

    const item = sampleItem({ requiredCapabilities: ['customCap'], proofFloor: 'WORK_ITEM_PASS' });
    const decision = await orchestrate.selectCandidateForProfile(
      item,
      [],
      [],
      reloadedEvData,
      { decisionDir },
      { dir: decisionDir, now: NOW },
      NOW
    );
    assert.equal(decision.chosen, candCustomCaps.candidateKey, 'UNPINNED candidate is chosen');
    const chosenRank = decision.result.ranking.find(
      (r) => r.candidateKey === candCustomCaps.candidateKey
    );
    assert.equal(chosenRank.accountId, 'UNPINNED', 'ranking must record accountId as UNPINNED');

    const decFiles = fs.readdirSync(decisionDir).filter((f) => f.endsWith('.jsonl'));
    const decLines = fs
      .readFileSync(path.join(decisionDir, decFiles[decFiles.length - 1]), 'utf8')
      .trim()
      .split('\n');
    const lastDec = JSON.parse(decLines[decLines.length - 1]);
    const loggedRank = lastDec.ranking.find((r) => r.candidateKey === candCustomCaps.candidateKey);
    assert.equal(
      loggedRank.account,
      'UNPINNED',
      'decision log ranking must record account as UNPINNED'
    );
  });

  // O-R03: forbidden failure domains and reviewer independence apply to evidence-only candidates
  test('O-R03: forbidden failure domains and reviewer independence apply to evidence-only candidates', async () => {
    const writerCand = sampleCandidate({
      gateway: 'gw-shared',
      upstream: 'up-writer',
      accountId: 'acc-writer',
      quotaScope: 'up-writer',
      modelId: 'up-writer/model-writer',
    });
    const reviewerSameDomain = sampleCandidate({
      gateway: 'gw-shared',
      upstream: 'up-writer',
      accountId: 'acc-reviewer-1',
      quotaScope: 'up-writer',
      modelId: 'up-writer/model-rev1',
    });
    const reviewerDiffDomain = sampleCandidate({
      gateway: 'gw-shared',
      upstream: 'up-reviewer-diff',
      accountId: 'acc-reviewer-2',
      quotaScope: 'up-reviewer-diff',
      modelId: 'up-reviewer-diff/model-rev2',
    });

    // 1. Reviewer equals writer is refused
    const evDir1 = path.join(tempRoot, 'ev1');
    evidence.recordProbe(evDir1, writerCand, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'reviewer',
      taskId: 'FEAT-REV-1',
    });
    const decSame = await orchestrate.selectCandidateForProfile(
      {
        id: 'T-REV-1',
        roleRequirement: { role: 'reviewer' },
        writerCandidateKey: writerCand.candidateKey,
      },
      [writerCand],
      [],
      evidence.loadEvidence(evDir1),
      { decisionDir },
      { dir: decisionDir, now: NOW },
      NOW
    );
    assert.equal(decSame.chosen, null, 'reviewer equals writer must be refused');
    assert.ok(decSame.result.rejected.some((r) => r.reasonCode === 'REVIEWER_EQUALS_WRITER'));

    // 2. Reviewer sharing canonical failure domain is refused with FORBIDDEN_FAILURE_DOMAIN
    const evDir2 = path.join(tempRoot, 'ev2');
    evidence.recordProbe(evDir2, reviewerSameDomain, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'reviewer',
      taskId: 'FEAT-REV-2',
    });
    const writerDomain = writerCand.upstream || writerCand.gateway;
    const decDomain = await orchestrate.selectCandidateForProfile(
      {
        id: 'T-REV-2',
        roleRequirement: { role: 'reviewer' },
        writerCandidateKey: writerCand.candidateKey,
      },
      [reviewerSameDomain],
      [writerDomain],
      evidence.loadEvidence(evDir2),
      { decisionDir },
      { dir: decisionDir, now: NOW },
      NOW
    );
    assert.equal(decDomain.chosen, null, 'reviewer in same failure domain must be refused');
    assert.ok(decDomain.result.rejected.some((r) => r.reasonCode === 'FORBIDDEN_FAILURE_DOMAIN'));

    // 3. Reviewer with different failure domain is accepted
    const evDir3 = path.join(tempRoot, 'ev3');
    evidence.recordProbe(evDir3, reviewerDiffDomain, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'reviewer',
      taskId: 'FEAT-REV-3',
    });
    const decDiff = await orchestrate.selectCandidateForProfile(
      {
        id: 'T-REV-3',
        roleRequirement: { role: 'reviewer' },
        writerCandidateKey: writerCand.candidateKey,
      },
      [reviewerDiffDomain],
      [writerDomain],
      evidence.loadEvidence(evDir3),
      { decisionDir },
      { dir: decisionDir, now: NOW },
      NOW
    );
    assert.equal(
      decDiff.chosen,
      reviewerDiffDomain.candidateKey,
      'reviewer in distinct domain is chosen'
    );
  });

  // O-R04: evidence store with WORK_ITEM_PASS for key K absent from accounts/catalogue ranks and pins K;
  // with K's domain forbidden -> refused with FORBIDDEN_FAILURE_DOMAIN
  test('O-R04: key K with WORK_ITEM_PASS absent from accounts/catalogue is ranked and pinned; refused when domain forbidden', async () => {
    const candK = sampleCandidate({
      gateway: 'gw-k',
      upstream: 'up-k',
      accountId: 'acc-k',
      quotaScope: 'up-k',
      modelId: 'up-k/model-k',
    });
    evidence.recordProbe(evidenceDir, candK, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'writer',
      taskId: 'FEAT-PROOF-K',
    });
    const evData = evidence.loadEvidence(evidenceDir);
    const item = sampleItem({ proofFloor: 'WORK_ITEM_PASS' });

    // Case 1: absent from --accounts/--catalogue -> ranks and pins K
    const decChosen = await orchestrate.selectCandidateForProfile(
      item,
      [],
      [],
      evData,
      { decisionDir },
      { dir: decisionDir, now: NOW },
      NOW
    );
    assert.equal(decChosen.chosen, candK.candidateKey, 'evidence candidate K is ranked and pinned');

    // Case 2: K's domain forbidden -> refused with FORBIDDEN_FAILURE_DOMAIN
    const canonicalDomainK = routing.canonicalFailureDomain(candK);
    const decForbidden = await orchestrate.selectCandidateForProfile(
      item,
      [],
      [canonicalDomainK],
      evData,
      { decisionDir },
      { dir: decisionDir, now: NOW },
      NOW
    );
    assert.equal(decForbidden.chosen, null, 'must be refused when domain is forbidden');
    assert.ok(
      decForbidden.result.rejected.some((r) => r.reasonCode === 'FORBIDDEN_FAILURE_DOMAIN')
    );
  });

  test('O-R04 (orchestrate loop): runOrchestration ranks evidence-backed candidate absent from accounts/catalogue', async () => {
    const candK = sampleCandidate({
      gateway: 'gw-orch',
      upstream: 'up-orch',
      accountId: 'acc-orch',
      quotaScope: 'up-orch',
      modelId: 'up-orch/model-orch',
    });
    evidence.recordProbe(evidenceDir, candK, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'writer',
      taskId: 'FEAT-PROOF-ORCH',
    });
    let launchedJob = null;
    await orchestrate.runOrchestration('Goal for TASK-AI-82', {
      specs: [
        {
          id: 'ITEM-82',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'WORK_ITEM_PASS',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [],
      evidenceDir,
      decisionDir,
      now: NOW,
      run: (job) => {
        launchedJob = job;
        if (job.usageFile)
          fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-82' }));
        return { exitCode: 0, stdout: 'ok' };
      },
      tests: () => ({ pass: true, findings: [] }),
      reviewer: () => ({
        sha: '0123456789012345678901234567890123456789',
        verdict: 'PASS',
        findings: [],
        reviewPath: path.join(tempRoot, 'review.md'),
      }),
      baseSha: '0123456789012345678901234567890123456789',
    });
    assert.ok(launchedJob, 'job must be launched');
    assert.equal(
      launchedJob.candidateKey,
      candK.candidateKey,
      'launched job must pin candidate K from evidence'
    );
    assert.equal(launchedJob.accountId, 'acc-orch', 'accountId must be acc-orch');
  });

  test('O-R03/O-R04: runOrchestration reviewer selection chooses evidence-backed reviewer candidate', async () => {
    const writerCand = sampleCandidate({
      gateway: 'gw-a',
      upstream: 'up-a',
      accountId: 'acc-a',
      quotaScope: 'up-a',
      modelId: 'up-a/model-a',
    });
    const reviewerCand = sampleCandidate({
      gateway: 'gw-b',
      upstream: 'up-b',
      accountId: 'acc-b',
      quotaScope: 'up-b',
      modelId: 'up-b/model-b',
    });
    evidence.recordProbe(evidenceDir, writerCand, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'writer',
      taskId: 'FEAT-PROOF-W',
    });
    evidence.recordProbe(evidenceDir, reviewerCand, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'reviewer',
      taskId: 'FEAT-PROOF-R',
    });
    let selectedReviewerKey = null;
    await orchestrate.runOrchestration('Goal for reviewer test', {
      specs: [
        {
          id: 'ITEM-REV',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'WORK_ITEM_PASS',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [],
      evidenceDir,
      decisionDir,
      now: NOW,
      run: (job) => {
        if (job.usageFile)
          fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-rev' }));
        if (job.isReview) {
          selectedReviewerKey = job.candidateKey;
          fs.writeFileSync(
            job.verdictFile || path.join(job.cwd, 'verdict.json'),
            JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
          );
          return { exitCode: 0, stdout: JSON.stringify({ session_id: 'sess-review' }) };
        }
        return { exitCode: 0, stdout: JSON.stringify({ session_id: 'sess-writer' }) };
      },
      tests: () => ({ pass: true, findings: [] }),
      sha: '0123456789012345678901234567890123456789',
      baseSha: '0123456789012345678901234567890123456789',
    });
    assert.equal(
      selectedReviewerKey,
      reviewerCand.candidateKey,
      'evidence-only reviewer candidate must be selected for reviewer job'
    );
  });
});
