'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const combo = require('../combo');
const { selectComboMember, shortlistForJev } = require('../combo-jev-select');
const { selectCandidateForProfile } = require('../orchestrate/candidate-select');
const { orchestrateCommand } = require('../cli/commands');

const REGISTRY = {
  dispatch: { nineRouterWriterCombo: 'vinh', comboSource: '9router' },
  sources: [
    {
      id: '9router',
      kind: 'router',
      servesModels: true,
      harness: 'opencode-direct',
      endpoint: 'http://127.0.0.1:20128/v1',
      credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
    },
    {
      id: 'jev',
      kind: 'decision-service',
      servesModels: false,
      endpoint: 'https://api.typesafe.ai/v1/systemone',
      model: 'jev-latest',
      credential: { type: 'api-key', env: 'TYPESAFE_API_KEY' },
      mayWriteCode: false,
      minConfidence: 0.7,
      maxOptions: 6,
    },
  ],
};

function makeManyMembers(count) {
  const efforts = ['high', 'medium', 'low'];
  const ranking = [];
  const members = [];
  for (let i = 0; i < count; i += 1) {
    const base = `model-${String(i).padStart(3, '0')}`;
    const eff = efforts[i % efforts.length];
    members.push(`ag/${base}-${eff}`);
    ranking.push({
      canonical: base,
      codingTier: 'T1',
      reviewTier: 'T1',
      benchmarks: [{ name: 'aaCodingIndex', score: 95 - (i % 40) }],
    });
  }
  return { members, priors: { ranking } };
}

test('JEV-1: orchestrateCommand wires jevAsk and jevMaxOptions from registry for live isolated runs and respects d.jevAsk stub', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-jev1-'));
  const specsFile = path.join(dir, 'specs.json');
  fs.writeFileSync(
    specsFile,
    JSON.stringify([
      {
        id: 'TASK-JEV1',
        objective: 'test',
        allowedPaths: ['a.js'],
        acceptanceCriteria: ['ok'],
        verification: { command: 'echo ok' },
      },
    ])
  );

  // Live isolated run builds jevAsk via jev.buildJevAsk and forwards registry maxOptions/minConfidence
  let liveOpts = null;
  const exitCodes = [];
  await orchestrateCommand(
    { goal: 'jev wire goal', specs: specsFile, 'isolated-worker': true, 'decision-dir': dir },
    {
      registry: REGISTRY,
      env: { NINEROUTER_API_KEY: 'k', TYPESAFE_API_KEY: 'tk' },
      log: () => {},
      error: () => {},
      exit: (code) => exitCodes.push(code),
      runOrchestration: async (_goal, opts) => {
        liveOpts = opts;
        return { status: 'COMPLETED', outcomes: [] };
      },
    }
  );
  assert.equal(liveOpts.comboJevSelect, true);
  assert.equal(typeof liveOpts.jevAsk, 'function');
  assert.equal(liveOpts.jevMinConfidence, 0.7);
  assert.equal(liveOpts.jevMaxOptions, 6);
  assert.equal(exitCodes[0], 0);

  // Explicit d.jevAsk stub is preserved and drives comboJev.handledBy === 'jev'
  const baseCombo = combo.comboCandidate({
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'k' },
  }).candidate;
  const { members, priors } = makeManyMembers(12);
  let stubOpts = null;
  const jevStub = async () => ({ choice: 'M1', confidence: 0.92, reason: 'best fit' });
  await orchestrateCommand(
    { goal: 'jev wire goal', specs: specsFile, 'isolated-worker': true, 'decision-dir': dir },
    {
      registry: REGISTRY,
      env: { NINEROUTER_API_KEY: 'k' },
      log: () => {},
      error: () => {},
      exit: (code) => exitCodes.push(code),
      jevAsk: jevStub,
      runOrchestration: async (_goal, opts) => {
        stubOpts = opts;
        return { status: 'COMPLETED', outcomes: [] };
      },
    }
  );
  assert.equal(stubOpts.jevAsk, jevStub);
  assert.equal(exitCodes[1], 0);

  const decision = await selectCandidateForProfile(
    { id: 'TASK-JEV1', complexity: 'standard', allowedPaths: ['a.js'] },
    [baseCombo],
    [],
    {},
    {
      registry: REGISTRY,
      env: { NINEROUTER_API_KEY: 'k' },
      priors,
      comboMembers: members,
      jevAsk: stubOpts.jevAsk,
      jevMinConfidence: stubOpts.jevMinConfidence,
      jevMaxOptions: stubOpts.jevMaxOptions,
    },
    { dir, now: Date.UTC(2026, 10, 23, 6, 0, 0), runId: 'jev1' },
    Date.UTC(2026, 10, 23, 6, 0, 0),
    {}
  );
  assert.equal(decision.decisionRecorded.comboJev.handledBy, 'jev');
  assert.equal(decision.decisionRecorded.comboJev.eligibleCount, 12);
  assert.equal(decision.decisionRecorded.comboJev.shortlistCount, 6);
  assert.deepEqual(decision.decisionRecorded.comboJev.shortlistOptions, [
    'M0',
    'M1',
    'M2',
    'M3',
    'M4',
    'M5',
  ]);
});

test('JEV-2: shortlistForJev caps 269 members to configured maxOptions with effort diversity and falls back over full eligible list', async () => {
  const { members, priors } = makeManyMembers(269);
  let receivedQuestion = null;
  const res = await selectComboMember({
    item: { id: 'TASK-JEV2', complexity: 'low', risk: 'LOW', allowedPaths: ['a.js'] },
    role: 'writer',
    members,
    priors,
    registry: REGISTRY,
    env: { NINEROUTER_API_KEY: 'k' },
    jevAsk: async (q) => {
      receivedQuestion = q;
      // Undecided forces deterministicPick fallback over full eligible list
      return { choice: 'M0', confidence: 0.2, reason: 'low confidence' };
    },
  });

  assert.equal(res.ok, true);
  assert.equal(res.eligibleCount, 269);
  assert.equal(res.shortlistCount, 6);
  assert.equal(receivedQuestion.options.length, 6);
  assert.doesNotMatch(receivedQuestion.evidence, /model-|ag\//i);
  assert.equal(res.handledBy, 'fallback');

  // Verify effort diversity is preserved in shortlist
  const sample = [
    { modelId: 'a/m1-high', score: 95, effort: 'high' },
    { modelId: 'a/m2-high', score: 94, effort: 'high' },
    { modelId: 'a/m3-high', score: 93, effort: 'high' },
    { modelId: 'a/m4-high', score: 92, effort: 'high' },
    { modelId: 'a/m5-medium', score: 91, effort: 'medium' },
    { modelId: 'a/m6-low', score: 90, effort: 'low' },
  ];
  const short = shortlistForJev(sample, 4);
  assert.equal(short.length, 4);
  const efforts = new Set(short.map((m) => m.effort));
  assert.ok(efforts.has('high') && efforts.has('medium') && efforts.has('low'));
});
