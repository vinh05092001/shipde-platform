'use strict';

/**
 * Ship Dễ — TASK-AI-94 contract tests:
 * Reviewer lane re-selects after a reviewer launch failure and counts every reviewer launch.
 *
 * R-R01: after a reviewer launch failure, the next review round re-selects a reviewer
 *        excluding failed keys and excluded domains; the failed reviewer is never launched
 *        again for that work item.
 * R-R02: every reviewer launch (not only the first selection) counts once toward the shared
 *        per-domain attempt cap; a third reviewer launch in one domain is refused and the lane
 *        falls back or the item ends BLOCKED NO_ALTERNATE_FAILURE_DOMAIN.
 * R-R03: tests: reviewer R fails in round 1 -> round 2 uses a different reviewer;
 *        three reviewer failures in one domain -> no fourth launch in that domain.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const orchestrate = require('../orchestrate');
const candidatesApi = require('../candidates');

const NOW = Date.parse('2026-10-05T10:00:00.000Z');

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

describe('TASK-AI-94: reviewer lane re-selection and launch attempt counting', () => {
  let tempRoot, evidenceDir, decisionDir;

  beforeEach(() => {
    tempRoot = tmpDir('task-ai-94-');
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

  // R-R01 / R-R03: reviewer R fails in round 1 -> round 2 uses a different reviewer
  // The failed reviewer key is never launched again for that work item.
  test('R-R01 / R-R03: reviewer R fails in round 1 -> round 2 uses a different reviewer; failed reviewer never re-launched', async () => {
    const candWriter = sampleCandidate({
      gateway: '9router',
      upstream: 'up-0-writer',
      modelId: 'up-0-writer/m1',
      quality: 100,
    });
    const candRev1 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-1-rev',
      modelId: 'up-1-rev/m1',
      quality: 95,
    });
    const candRev2 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-2-rev',
      modelId: 'up-2-rev/m1',
      quality: 90,
    });
    const candRepair = sampleCandidate({
      gateway: '9router',
      upstream: 'up-3-repair',
      modelId: 'up-3-repair/m1',
      quality: 85,
    });

    const launchedReviewers = [];
    const run = (job) => {
      if (job.usageFile) {
        fs.writeFileSync(
          job.usageFile,
          JSON.stringify({ session_id: 'sess-rr01-' + Date.now() + Math.random() })
        );
      }
      if (job.isReview || (job.title && String(job.title).includes('review'))) {
        launchedReviewers.push(job.candidateKey);
        // Round 1 reviewer candRev1 fails launch
        if (job.candidateKey === candRev1.candidateKey) {
          return { exitCode: 1, httpStatus: 500, stderr: '500 internal server error' };
        }
        // Round 2 reviewer candRev2 succeeds and writes pass verdict
        if (job.candidateKey === candRev2.candidateKey) {
          const vFile = job.verdictFile || path.join(job.cwd, 'verdict.json');
          try {
            fs.writeFileSync(
              vFile,
              JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
            );
          } catch (_) {}
          return { exitCode: 0, stdout: 'review ok' };
        }
      }
      return { exitCode: 0, stdout: 'writer/repair ok' };
    };

    const result = await orchestrate.runOrchestration('Goal for R-R01', {
      specs: [
        {
          id: 'ITEM-94-R01',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candWriter, candRev1, candRev2, candRepair],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
      sha: '1010101010101010101010101010101010101010',
      baseSha: '1010101010101010101010101010101010101010',
    });

    // Round 1 must launch candRev1
    assert.equal(launchedReviewers[0], candRev1.candidateKey, 'round 1 launched candRev1');
    // Round 2 must re-select and launch candRev2 (different reviewer!)
    assert.equal(
      launchedReviewers[1],
      candRev2.candidateKey,
      'round 2 re-selected and launched candRev2'
    );
    // The failed reviewer candRev1 must NEVER be launched again
    assert.ok(
      !launchedReviewers.slice(1).includes(candRev1.candidateKey),
      'failed reviewer candRev1 must never be launched again'
    );
    assert.equal(launchedReviewers.length, 2, 'exactly two reviewer launches occurred');

    const outcomes = (result.log && result.log.outcomes) || result.outcomes;
    assert.ok(outcomes && outcomes.length > 0);
    assert.equal(String(outcomes[0].status).toLowerCase(), 'completed', 'item completed');
  });

  // R-R02: every reviewer launch counts once toward shared per-domain attempt cap;
  // a third reviewer launch in one domain is refused and the lane falls back.
  test('R-R02: every reviewer launch counts toward domain attempt cap; 3rd in domain is refused and lane falls back', async () => {
    const candWriter = sampleCandidate({
      gateway: '9router',
      upstream: 'up-0-writer',
      modelId: 'up-0-writer/m1',
      quality: 100,
    });
    // Three candidates in domain A
    const candA1 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-dom-a',
      modelId: 'up-dom-a/m1',
      quality: 95,
    });
    const candA2 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-dom-a',
      modelId: 'up-dom-a/m2',
      quality: 94,
    });
    const candA3 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-dom-a',
      modelId: 'up-dom-a/m3',
      quality: 93,
    });
    // Alternate domain B
    const candB = sampleCandidate({
      gateway: '9router',
      upstream: 'up-dom-b',
      modelId: 'up-dom-b/m1',
      quality: 80,
    });
    const candRepair = sampleCandidate({
      gateway: '9router',
      upstream: 'up-repair-r02',
      modelId: 'up-repair-r02/m1',
      quality: 70,
    });

    const launchedReviewers = [];
    const run = (job) => {
      if (job.usageFile) {
        fs.writeFileSync(
          job.usageFile,
          JSON.stringify({ session_id: 'sess-rr02-' + Date.now() + Math.random() })
        );
      }
      if (job.isReview || (job.title && String(job.title).includes('review'))) {
        launchedReviewers.push(job.candidateKey);
        // candA1 fails (attempt 1 in domain A) - model level error
        if (job.candidateKey === candA1.candidateKey) {
          return { exitCode: 1, httpStatus: 404, stderr: '404 model not found' };
        }
        // candA2 fails (attempt 2 in domain A) - model level error
        if (job.candidateKey === candA2.candidateKey) {
          return { exitCode: 1, httpStatus: 404, stderr: '404 model not found' };
        }
        // candB in domain B succeeds
        if (job.candidateKey === candB.candidateKey) {
          const vFile = job.verdictFile || path.join(job.cwd, 'verdict.json');
          try {
            fs.writeFileSync(
              vFile,
              JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
            );
          } catch (_) {}
          return { exitCode: 0, stdout: 'review ok' };
        }
      }
      return { exitCode: 0, stdout: 'writer/repair ok' };
    };

    const result = await orchestrate.runOrchestration('Goal for R-R02 Fallback', {
      specs: [
        {
          id: 'ITEM-94-R02',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candWriter, candA1, candA2, candA3, candB, candRepair],
      evidenceDir,
      decisionDir,
      now: NOW,
      run,
      tests: () => ({ pass: true, findings: [] }),
      sha: '2020202020202020202020202020202020202020',
      baseSha: '2020202020202020202020202020202020202020',
    });

    // First attempt launched candA1 (attempt 1 in domain A)
    assert.equal(launchedReviewers[0], candA1.candidateKey, 'first reviewer launch is candA1');
    // Second attempt launched candA2 (attempt 2 in domain A)
    assert.equal(launchedReviewers[1], candA2.candidateKey, 'second reviewer launch is candA2');
    // Third attempt in domain A (candA3) was REFUSED; lane fell back to candB in domain B!
    assert.equal(
      launchedReviewers[2],
      candB.candidateKey,
      'third launch fell back to candB outside domain A'
    );
    assert.ok(
      !launchedReviewers.includes(candA3.candidateKey),
      'candA3 in domain A was never launched'
    );
    assert.equal(
      launchedReviewers.filter((k) => k.includes('up-dom-a')).length,
      2,
      'domain A had exactly 2 attempts, not 3'
    );

    const outcomes = (result.log && result.log.outcomes) || result.outcomes;
    assert.ok(outcomes && outcomes.length > 0);
    assert.equal(String(outcomes[0].status).toLowerCase(), 'completed', 'item completed');
  });

  // R-R03 / R-R02: three reviewer failures in one domain -> no fourth launch in that domain;
  // item ends BLOCKED NO_ALTERNATE_FAILURE_DOMAIN when all reviewer domains reach attempt cap.
  test('R-R03: three reviewer failures in one domain -> no fourth launch in that domain; ends BLOCKED NO_ALTERNATE_FAILURE_DOMAIN', async () => {
    const candWriter = sampleCandidate({
      gateway: '9router',
      upstream: 'up-0-writer',
      modelId: 'up-0-writer/m1',
      quality: 100,
    });
    // Four candidates all in single failure domain up-single-rev
    const candR1 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-single-rev',
      modelId: 'up-single-rev/m1',
      quality: 95,
    });
    const candR2 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-single-rev',
      modelId: 'up-single-rev/m2',
      quality: 94,
    });
    const candR3 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-single-rev',
      modelId: 'up-single-rev/m3',
      quality: 93,
    });
    const candR4 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-single-rev',
      modelId: 'up-single-rev/m4',
      quality: 92,
    });
    const candRepair = sampleCandidate({
      gateway: '9router',
      upstream: 'up-repair-r03',
      modelId: 'up-repair-r03/m1',
      quality: 70,
    });

    const launchedReviewers = [];
    const run = (job) => {
      if (job.usageFile) {
        fs.writeFileSync(
          job.usageFile,
          JSON.stringify({ session_id: 'sess-rr03-' + Date.now() + Math.random() })
        );
      }
      if (job.isReview || (job.title && String(job.title).includes('review'))) {
        launchedReviewers.push(job.candidateKey);
        // All reviewer launches fail with model error
        return { exitCode: 1, httpStatus: 404, stderr: '404 model not found' };
      }
      return { exitCode: 0, stdout: 'writer/repair ok' };
    };

    const result = await orchestrate.runOrchestration('Goal for R-R03 Bounded Reviewer', {
      specs: [
        {
          id: 'ITEM-94-R03',
          roleRequirement: { role: 'writer' },
          files: ['file.js'],
          acceptanceCriteria: ['works'],
          proofFloor: 'NONE',
          verification: { command: 'node -e "process.exit(0)"', expect: '' },
        },
      ],
      candidates: [candWriter, candR1, candR2, candR3, candR4, candRepair],
      evidenceDir,
      decisionDir,
      now: NOW,
      reviewBudget: 5,
      run,
      tests: () => ({ pass: true, findings: [] }),
      sha: '3030303030303030303030303030303030303030',
      baseSha: '3030303030303030303030303030303030303030',
    });

    // Reviewer domain cap is 2 attempts:
    // Domain up-single-rev must have strictly at most 2 launches (no 3rd and no 4th launch!)
    assert.ok(
      launchedReviewers.length <= 2,
      'reviewer launches in domain must be capped at 2, got ' + launchedReviewers.length
    );
    assert.ok(
      !launchedReviewers.includes(candR3.candidateKey),
      'no third launch in domain (candR3)'
    );
    assert.ok(
      !launchedReviewers.includes(candR4.candidateKey),
      'no fourth launch in domain (candR4)'
    );

    // Work item must end BLOCKED with NO_ALTERNATE_FAILURE_DOMAIN
    const outcomes = (result.log && result.log.outcomes) || result.outcomes;
    assert.ok(outcomes && outcomes.length > 0);
    const outcome = outcomes[0];
    assert.equal(String(outcome.status).toLowerCase(), 'blocked');
    assert.equal(outcome.reasonCode, 'NO_ALTERNATE_FAILURE_DOMAIN');
    assert.ok(Array.isArray(outcome.triedKeys), 'outcome includes triedKeys');
    assert.ok(outcome.triedKeys.includes(candR1.candidateKey), 'triedKeys includes candR1');
    assert.ok(outcome.triedKeys.includes(candR2.candidateKey), 'triedKeys includes candR2');
  });

  test('configured reviewer fallback is refused when its key or failure domain is ineligible', async () => {
    const candWriter = sampleCandidate({
      gateway: '9router',
      upstream: 'up-config-writer',
      modelId: 'up-config-writer/m1',
    });
    const configuredReviewer = sampleCandidate({
      gateway: '9router',
      upstream: 'up-config-reviewer',
      modelId: 'up-config-reviewer/m1',
    });
    const reviewerDomain = '9router/up-config-reviewer';
    const sha = '4040404040404040404040404040404040404040';
    const cases = [
      { name: 'failed key', failedKeys: new Set([configuredReviewer.candidateKey]) },
      { name: 'excluded domain', excludedDomains: new Set([reviewerDomain]) },
      { name: 'two-attempt cap', domainAttempts: new Map([[reviewerDomain, 2]]) },
    ];

    for (const refusal of cases) {
      const launches = [];
      const item = { id: 'ITEM-94-CONFIG-' + refusal.name.replace(/\W+/g, '-') };
      const result = await orchestrate.reviewItem(
        {
          reviewerIdentity: configuredReviewer.candidateKey,
          decisionDir,
          evidenceDir,
          reviewBudget: 1,
          tests: () => ({ pass: true, findings: [] }),
        },
        item,
        {
          candidateKey: candWriter.candidateKey,
          headSha: sha,
          baseSha: sha,
          branch: 'feat/task-ai-94-reviewer-fallback',
        },
        { goal: 'configured reviewer refusal', reviews: [] },
        { dir: decisionDir, now: NOW },
        async (job) => {
          launches.push(job.candidateKey);
          return { exitCode: 1, httpStatus: 500, stderr: 'unexpected reviewer launch' };
        },
        path.join(tempRoot, 'usage'),
        NOW,
        [candWriter, configuredReviewer],
        null,
        { sources: [] },
        Object.assign(
          {
            failedKeys: new Set(),
            excludedDomains: new Set(),
            domainAttempts: new Map(),
            triedKeys: new Set(),
            evidenceDir,
          },
          refusal
        )
      );

      assert.deepEqual(launches, [], refusal.name + ' must not launch configured reviewer');
      assert.equal(result.status, 'BLOCKED', refusal.name + ' blocks the reviewer lane');
      assert.equal(
        result.reason,
        'NO_ALTERNATE_FAILURE_DOMAIN',
        refusal.name + ' uses the canonical no-alternate reason'
      );
    }
  });

  test('reviewer keeps the work-item quality floor and increments supplied attempt numbers', async () => {
    const candWriter = sampleCandidate({
      gateway: '9router',
      upstream: 'up-floor-writer',
      modelId: 'up-floor-writer/m1',
      quality: 100,
    });
    const candReviewer1 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-floor-reviewer-1',
      modelId: 'up-floor-reviewer-1/m1',
      quality: 90,
    });
    const candReviewer2 = sampleCandidate({
      gateway: '9router',
      upstream: 'up-floor-reviewer-2',
      modelId: 'up-floor-reviewer-2/m1',
      quality: 70,
    });
    const sha = '5050505050505050505050505050505050505050';
    const launched = [];
    const result = await orchestrate.reviewItem(
      { decisionDir, evidenceDir, reviewBudget: 2, tests: () => ({ pass: true, findings: [] }) },
      { id: 'ITEM-94-QUALITY-FLOOR', qualityFloor: 50 },
      {
        candidateKey: candWriter.candidateKey,
        headSha: sha,
        baseSha: sha,
        branch: 'feat/task-ai-94-quality-floor',
      },
      { goal: 'configured reviewer quality floor', reviews: [] },
      { dir: decisionDir, now: NOW },
      async (job) => {
        launched.push(job.candidateKey);
        if (job.candidateKey === candReviewer1.candidateKey) {
          return { exitCode: 1, httpStatus: 500, stderr: 'reviewer launch failed' };
        }
        fs.writeFileSync(
          job.verdictFile,
          JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
        );
        return { exitCode: 0, stdout: 'review ok' };
      },
      path.join(tempRoot, 'usage'),
      NOW,
      [candWriter, candReviewer1, candReviewer2],
      null,
      { sources: [] },
      {
        failedKeys: new Set(),
        excludedDomains: new Set(),
        domainAttempts: new Map(),
        triedKeys: new Set(),
        evidenceDir,
        attempt: 7,
      }
    );

    assert.deepEqual(launched, [candReviewer1.candidateKey, candReviewer2.candidateKey]);
    assert.equal(result.status, 'COMPLETED');

    const decisionsList = fs
      .readFileSync(path.join(decisionDir, '2026-10-05.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const reviewerSelections = decisionsList.filter(
      (decision) =>
        decision.stage === 'reviewer-selection' &&
        decision.workItemId === 'ITEM-94-QUALITY-FLOOR-review'
    );
    assert.deepEqual(
      reviewerSelections.map((decision) => decision.attempt),
      [7, 8],
      'reviewer selection attempt numbers advance from the caller-supplied attempt'
    );
    assert.deepEqual(
      reviewerSelections.map((decision) => decision.attemptNumber),
      [7, 8],
      'reviewer selection attemptNumber values advance on every round'
    );
  });
  test('configured reviewer outside the candidate pool counts against its canonical domain', async () => {
    const candWriter = sampleCandidate({
      gateway: '9router',
      upstream: 'up-pool-writer',
      modelId: 'up-pool-writer/m1',
    });
    const outOfPool = sampleCandidate({
      gateway: '9router',
      upstream: 'up-out-of-pool',
      modelId: 'up-out-of-pool/m1',
    });
    const outOfPoolDomain = require('../routing').canonicalFailureDomain(outOfPool);
    const sha = '6060606060606060606060606060606060606060';
    const launched = [];
    const result = await orchestrate.reviewItem(
      {
        reviewerIdentity: outOfPool.candidateKey,
        decisionDir,
        evidenceDir,
        reviewBudget: 3,
        tests: () => ({ pass: true, findings: [] }),
        repairer: async (_item, currentSha) => ({ sha: currentSha }),
      },
      { id: 'ITEM-94-OUT-OF-POOL' },
      {
        candidateKey: candWriter.candidateKey,
        headSha: sha,
        baseSha: sha,
        branch: 'feat/task-ai-94-out-of-pool',
      },
      { goal: 'configured reviewer outside the pool', reviews: [] },
      { dir: decisionDir, now: NOW },
      async (job) => {
        launched.push(job.candidateKey);
        fs.writeFileSync(
          job.verdictFile,
          JSON.stringify({
            sha: job.baseSha,
            verdict: 'CHANGES_REQUIRED',
            findings: [{ id: 'F-1', severity: 'P2', open: true, detail: 'keep reviewing' }],
          })
        );
        return { exitCode: 0, stdout: 'review changes required' };
      },
      path.join(tempRoot, 'usage'),
      NOW,
      [],
      null,
      { sources: [] },
      {
        failedKeys: new Set(),
        excludedDomains: new Set(),
        domainAttempts: new Map([[outOfPoolDomain, 1]]),
        triedKeys: new Set(),
        evidenceDir,
      }
    );

    assert.equal(
      launched.length,
      1,
      'one earlier attempt plus one reviewer launch reaches the two-attempt cap for the domain'
    );
    assert.equal(result.status, 'BLOCKED');
  });
});
