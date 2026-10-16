'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dispatchCommand } = require('../cli');
const routing = require('../routing');
const { buildTaskProfile } = require('../orchestrate');

test('dispatch dry-run scores and orders different priors exactly like live profile ranking', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dryrun-priors-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.now();
  const candidates = ['weak', 'strong'].map((name) => ({
    harness: 'opencode',
    accessPath: 'https://fixture.example/v1',
    gateway: 'fixture',
    upstream: 'fixture',
    accountId: name,
    quotaScope: name,
    modelId: `fixture/${name}`,
    capabilities: { contextWindow: 128000 },
    contextWindow: 128000,
    qualifiedRoles: ['author.foundation'],
    quality: 90,
    cost: 1,
    evidence: [],
  }));
  const priors = {
    generatedAt: new Date(now).toISOString(),
    ranking: [
      { canonical: 'weak', codingTier: 'T4', reviewTier: 'T4', benchmarks: { aaCodingIndex: 20 } },
      {
        canonical: 'strong',
        codingTier: 'T1',
        reviewTier: 'T1',
        benchmarks: { aaCodingIndex: 90 },
      },
    ],
  };
  const item = { workItemId: 'TASK-AI-142', role: 'author.foundation', qualityFloor: 0 };
  const profile = buildTaskProfile({ ...item, id: item.workItemId }, { enforceProofFloors: false });
  const assessment = { weights: routing.WEIGHT_PROFILES.BALANCED, weightProfile: 'BALANCED' };
  const context = {
    now,
    priors,
    headrooms: { default: 'open' },
    explorationBudget: candidates.length,
  };
  const expected = routing.rankForProfile(candidates, profile, assessment, context);
  assert.equal(expected.ranking.length, candidates.length);
  assert.notEqual(expected.ranking[0].score, expected.ranking[1].score);
  const actual = dispatchCommand(
    { 'dry-run': true, root },
    {
      candidates,
      items: [item],
      accounts: [],
      registry: { sources: [] },
      now,
      priors,
      assessment,
      headrooms: context.headrooms,
      evidenceDir: path.join(root, 'evidence'),
      decisionDir: path.join(root, 'decisions'),
      log: () => {},
      exit: () => {},
    }
  );
  assert.equal(actual.exitCode, 0);
  const scores = (rows) => rows.map((c) => [c.candidateKey || c.offeringId, c.score]);
  assert.deepEqual(scores(actual.decision.candidates), scores(expected.ranking));
  assert.equal(fs.existsSync(path.join(root, 'decisions')), false, 'ranking remains read only');
  let asks = 0;
  const ask = async () => {
    asks += 1;
    return {
      scores: {
        qualityImportance: { score: 9, confidence: 0.9 },
        latencyImportance: { score: 1, confidence: 0.9 },
        costImportance: { score: 1, confidence: 0.9 },
      },
    };
  };
  const advisedAssessment = await routing.assessTask(profile, { ask });
  asks = 0;
  const advised = await dispatchCommand(
    { 'dry-run': true, root },
    {
      candidates,
      items: [item],
      accounts: [],
      registry: { sources: [] },
      now,
      priors,
      jevAsk: ask,
      headrooms: context.headrooms,
      evidenceDir: path.join(root, 'evidence'),
      decisionDir: path.join(root, 'decisions'),
      log: () => {},
      exit: () => {},
    }
  );
  assert.equal(asks, 1, 'dry-run uses the live writer assessment path once');
  assert.deepEqual(
    scores(advised.decision.candidates),
    scores(routing.rankForProfile(candidates, profile, advisedAssessment, context).ranking)
  );
  assert.equal(
    fs.existsSync(path.join(root, 'decisions')),
    false,
    'advisory ranking remains read only'
  );
});
