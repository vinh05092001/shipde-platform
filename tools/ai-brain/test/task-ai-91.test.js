'use strict';

/**
 * Ship Dễ — TASK-AI-91 contract tests:
 * A candidate whose launch failed is not re-selected; the Controller falls back
 * across failure domains within a bounded budget.
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

const NOW = Date.parse('2026-10-05T08:00:00.000Z');

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

function readDecisions(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const lines = [];
  for (const file of files.sort()) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const line of raw.split('\n')) {
      if (line.trim()) {
        try {
          lines.push(JSON.parse(line));
        } catch (_) {}
      }
    }
  }
  return lines;
}

describe('TASK-AI-91: failed candidate not re-selected & bounded fallback', () => {
  let tempRoot, evidenceDir, decisionDir;

  beforeEach(() => {
    tempRoot = tmpDir('task-ai-91-');
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

  // F-R01: within one run, a key whose launch failed is excluded from every later selection for the same work item (writer and reviewer lanes).
  test('F-R01: candidate whose launch failed is excluded from later writer selection and reviewer lane for the same work item', async () => {
    const candA = sampleCandidate({
      gateway: '9router',
      upstream: 'xmtp',
      modelId: 'xmtp/model-a',
      quality: 95,
      latencyMs: 500,
    });
    const candB = sampleCandidate({
      gateway: '9router',
      upstream: 'xmtp',
      modelId: 'xmtp/model-b',
      quality: 94,
      latencyMs: 500,
    });
    const candReviewer = sampleCandidate({
      gateway: '9router',
      upstream: 'other-rev',
      modelId: 'other-rev/model-r',
      quality: 80,
      latencyMs: 3000,
    });

    const launchedKeys = [];
    const run = (job) => {
      launchedKeys.push(job.candidateKey);
      if (job.usageFile)
        fs.writeFileSync(
          job.usageFile,
          JSON.stringify({ session_id: 'sess-' + launchedKeys.length })
        );
      if (job.candidateKey === candA.candidateKey) {
        // Model-scoped failure (Case 7: 404 / model not found)
        return { exitCode: 1, httpStatus: 404, stderr: 'model not found' };
      }
      if (job.isReview) {
        fs.writeFileSync(
          job.verdictFile || path.join(job.cwd, 'verdict.json'),
          JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
        );
      }
      return { exitCode: 0, stdout: 'ok' };
    };

    const result = await orchestrate.runOrchestration('Goal for F-R01', {
      specs: [
        {
          id: 'ITEM-91-R01',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candA, candB, candReviewer],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
      sha: '1111111111111111111111111111111111111111',
      baseSha: '1111111111111111111111111111111111111111',
    });

    // candA failed on attempt 1; attempt 2 must NOT be candA
    assert.equal(launchedKeys[0], candA.candidateKey, 'first attempt was candA');
    assert.equal(
      launchedKeys[1],
      candB.candidateKey,
      'second attempt must be candB, never candA again'
    );
    assert.ok(
      !launchedKeys.slice(1).includes(candA.candidateKey),
      'candA is never selected again in the run'
    );

    // Also verify unit-level selectCandidateForProfile excludes failedKeys
    const profileDecision = await orchestrate.selectCandidateForProfile(
      {
        id: 'ITEM-91-R01-UNIT',
        roleRequirement: { role: 'reviewer' },
        complexity: 'standard',
        failedKeys: [candA.candidateKey],
      },
      [candA, candB],
      [],
      null,
      {},
      null,
      NOW,
      { failedKeys: [candA.candidateKey] }
    );
    assert.notEqual(
      profileDecision.chosen,
      candA.candidateKey,
      'selectCandidateForProfile excludes failedKeys'
    );
  });

  // F-R02: the failure is recorded through the existing outcome/evidence path with its classified scope (model, upstream, gateway, account), so that an upstream- or gateway-scoped failure also excludes other candidates in the same canonical failure domain for the rest of the run
  test('F-R02: upstream failure is recorded in evidence store and excludes entire canonical failure domain for rest of run', async () => {
    const candX1 = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-x',
      modelId: 'domain-x/model-1',
      quality: 95,
    });
    const candX2 = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-x',
      modelId: 'domain-x/model-2',
      quality: 90,
    });
    const candY = sampleCandidate({
      gateway: '9router',
      upstream: 'domain-y',
      modelId: 'domain-y/model-1',
      quality: 85,
    });

    const launchedKeys = [];
    const run = (job) => {
      launchedKeys.push(job.candidateKey);
      if (job.usageFile)
        fs.writeFileSync(
          job.usageFile,
          JSON.stringify({ session_id: 'sess-' + launchedKeys.length })
        );
      if (job.upstream === 'domain-x') {
        // Upstream quota/capacity failure
        return {
          exitCode: 1,
          httpStatus: 429,
          stderr: '429 RESOURCE_EXHAUSTED: quota exhausted',
        };
      }
      return { exitCode: 0, stdout: 'ok' };
    };

    await orchestrate.runOrchestration('Goal for F-R02', {
      specs: [
        {
          id: 'ITEM-91-R02',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candX1, candX2, candY],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
      reviewer: () => ({
        sha: '2222222222222222222222222222222222222222',
        verdict: 'PASS',
        findings: [],
      }),
      sha: '2222222222222222222222222222222222222222',
      baseSha: '2222222222222222222222222222222222222222',
    });

    // Evidence must record the failure for candX1
    const evData = evidence.loadEvidence(evidenceDir);
    assert.ok(evData, 'evidence must be saved');
    const candEvidence = evidence.getEvidence(evData, candX1);
    assert.ok(candEvidence.length > 0, 'outcome must be recorded in evidence store');
    assert.equal(candEvidence[0].exitCode, 1, 'recorded exitCode is 1');

    // candX2 must NOT have been launched because candX1 failed with upstream scope!
    assert.ok(
      !launchedKeys.includes(candX2.candidateKey),
      'candX2 in same failure domain was excluded'
    );
    assert.equal(launchedKeys[0], candX1.candidateKey, 'first launch was candX1');
    assert.equal(
      launchedKeys[1],
      candY.candidateKey,
      'fallback fell across failure domain to candY'
    );
  });

  // F-R03: at most two attempts per failure domain per work item; when no eligible candidate remains the work item ends BLOCKED with reasonCode NO_ALTERNATE_FAILURE_DOMAIN and the list of tried keys, never an unbounded loop.
  test('F-R03: at most two attempts per failure domain per work item; ends BLOCKED with NO_ALTERNATE_FAILURE_DOMAIN and triedKeys', async () => {
    const candD1 = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-a',
      modelId: 'dom-a/m1',
      quality: 95,
    });
    const candD2 = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-a',
      modelId: 'dom-a/m2',
      quality: 90,
    });
    const candD3 = sampleCandidate({
      gateway: '9router',
      upstream: 'dom-a',
      modelId: 'dom-a/m3',
      quality: 85,
    });

    const launchedKeys = [];
    const run = (job) => {
      launchedKeys.push(job.candidateKey);
      if (job.usageFile)
        fs.writeFileSync(
          job.usageFile,
          JSON.stringify({ session_id: 'sess-' + launchedKeys.length })
        );
      // Model-level failure (404)
      return { exitCode: 1, httpStatus: 404, stderr: 'model not found' };
    };

    const result = await orchestrate.runOrchestration('Goal for F-R03', {
      specs: [
        {
          id: 'ITEM-91-R03',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candD1, candD2, candD3],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
    });

    // Domain dom-a has 3 candidates, but at most 2 attempts per failure domain are allowed
    assert.equal(launchedKeys.length, 2, 'at most two attempts in domain dom-a');
    assert.ok(!launchedKeys.includes(candD3.candidateKey), 'third candidate in domain was skipped');

    // Outcome must be BLOCKED with NO_ALTERNATE_FAILURE_DOMAIN and list of tried keys
    const outcomes = (result.log && result.log.outcomes) || result.outcomes;
    assert.ok(outcomes && outcomes.length > 0);
    const outcome = outcomes[0];
    assert.equal(String(outcome.status).toLowerCase(), 'blocked');
    assert.equal(outcome.reasonCode, 'NO_ALTERNATE_FAILURE_DOMAIN');
    assert.ok(Array.isArray(outcome.triedKeys), 'outcome has triedKeys array');
    assert.equal(outcome.triedKeys.length, 2);
    assert.deepEqual(outcome.triedKeys, launchedKeys);
  });

  // F-R04: the decision log records each attempt with attempt number, chosen key, failure scope and the excluded set.
  test('F-R04: decision log records attempt number, chosen key, failure scope, and excluded set', async () => {
    const cand1 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-1',
      modelId: 'up-1/m1',
      quality: 90,
    });
    const cand2 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-2',
      modelId: 'up-2/m2',
      quality: 80,
    });

    const run = (job) => {
      if (job.usageFile)
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-f-r04' }));
      if (job.candidateKey === cand1.candidateKey) {
        return { exitCode: 1, timedOut: true, stderr: 'worker timed out' };
      }
      return { exitCode: 0, stdout: 'ok' };
    };

    await orchestrate.runOrchestration('Goal for F-R04', {
      specs: [
        {
          id: 'ITEM-91-R04',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [cand1, cand2],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
      reviewer: () => ({
        sha: '3333333333333333333333333333333333333333',
        verdict: 'PASS',
        findings: [],
      }),
      sha: '3333333333333333333333333333333333333333',
      baseSha: '3333333333333333333333333333333333333333',
    });

    const decisionsList = readDecisions(decisionDir);
    const failedDecisions = decisionsList.filter((d) => d.stage === 'failed');
    assert.ok(failedDecisions.length > 0, 'must record failed stage in decision log');

    const fd = failedDecisions[0];
    assert.equal(fd.attempt, 1, 'decision log records attempt number');
    assert.equal(fd.chosen, cand1.candidateKey, 'decision log records chosen key');
    assert.equal(fd.failureScope, 'upstream', 'decision log records failure scope');
    assert.ok(Array.isArray(fd.excluded) || Array.isArray(fd.excludedSet), 'records excluded set');
    const excludedList = fd.excluded || fd.excludedSet;
    assert.ok(excludedList.includes(cand1.candidateKey), 'excluded set includes failed key');
  });

  // F-R05 test: fake launcher fails for key A (upstream X) -> next selection is a key outside X; when every candidate fails -> BLOCKED after bounded attempts with NO_ALTERNATE_FAILURE_DOMAIN; the same key is never selected twice.
  test('F-R05: launcher fails for key A (upstream X) -> next selection outside X; when all fail -> BLOCKED with NO_ALTERNATE_FAILURE_DOMAIN; same key never selected twice', async () => {
    const candA1 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-x',
      modelId: 'up-x/mA1',
      quality: 95,
    });
    const candA2 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-x',
      modelId: 'up-x/mA2',
      quality: 92,
    });
    const candB = sampleCandidate({
      gateway: '9router',
      upstream: 'up-y',
      modelId: 'up-y/mB',
      quality: 85,
    });

    const attempts = [];
    const run = (job) => {
      attempts.push(job.candidateKey);
      if (job.usageFile)
        fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + attempts.length }));
      return {
        exitCode: 1,
        httpStatus: 429,
        stderr: '429 RESOURCE_EXHAUSTED: quota exhausted',
      };
    };

    const result = await orchestrate.runOrchestration('Goal for F-R05', {
      specs: [
        {
          id: 'ITEM-91-R05',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candA1, candA2, candB],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
    });

    // 1. candA1 (upstream up-x) fails with upstream failure -> next selection must be candB (outside up-x)
    assert.equal(attempts[0], candA1.candidateKey, 'first attempt is candA1');
    assert.equal(
      attempts[1],
      candB.candidateKey,
      'next selection is candB, outside up-x (candA2 skipped)'
    );

    // 2. Same key is never selected twice
    const uniqueAttempts = new Set(attempts);
    assert.equal(uniqueAttempts.size, attempts.length, 'same key is never selected twice');

    // 3. When every candidate fails -> BLOCKED after bounded attempts with NO_ALTERNATE_FAILURE_DOMAIN
    assert.equal(attempts.length, 2, 'bounded attempts: exactly 2');
    const outcomes = (result.log && result.log.outcomes) || result.outcomes;
    assert.ok(outcomes && outcomes.length > 0);
    const outcome = outcomes[0];
    assert.equal(String(outcome.status).toLowerCase(), 'blocked');
    assert.equal(outcome.reasonCode, 'NO_ALTERNATE_FAILURE_DOMAIN');
    assert.deepEqual(outcome.triedKeys, attempts);
  });
});
