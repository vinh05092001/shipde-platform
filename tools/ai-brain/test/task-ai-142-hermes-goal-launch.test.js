'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  buildHermesArgv,
  defaultGoalPrompt,
  chatCommand,
  CONTROLLER_SKILL_NAME,
} = require('../hermes-session');

test('TASK-AI-142: defaultGoalPrompt produces structured controller goal prompt', () => {
  const prompt = defaultGoalPrompt('FEAT-AUTH-02');
  assert.match(prompt, /FEAT-AUTH-02/);
  assert.match(prompt, new RegExp(CONTROLLER_SKILL_NAME));
  assert.match(prompt, /goal status FEAT-AUTH-02/);
  assert.match(prompt, /goal run FEAT-AUTH-02/);
});

test('TASK-AI-142: buildHermesArgv includes -q when a goal is provided and flags only on opt-in', () => {
  const candidate = {
    candidateKey: 'hermes::http://127.0.0.1:20128/v1::9router::ag::acc1::acc1::ag/claude-sonnet-4',
    modelId: 'ag/claude-sonnet-4',
    gateway: '9router',
  };
  const session = { sessionId: 'hermes_test_123', candidateKey: candidate.candidateKey };

  const argv = buildHermesArgv(candidate, session, {
    goal: 'FEAT-AUTH-02',
  });

  assert.ok(argv.includes('chat'), 'must include chat command');
  assert.ok(argv.includes('-q'), 'must include -q flag for single query / prompt');
  const qIndex = argv.indexOf('-q');
  assert.match(argv[qIndex + 1], /FEAT-AUTH-02/);
  assert.equal(argv.includes('--yolo'), false, 'goal alone must not add --yolo');
  assert.equal(argv.includes('--accept-hooks'), false, 'goal alone must not add --accept-hooks');

  const opted = buildHermesArgv(candidate, session, {
    goal: 'FEAT-AUTH-02',
    yolo: true,
    acceptHooks: true,
  });
  assert.ok(opted.includes('--yolo'));
  assert.ok(opted.includes('--accept-hooks'));
});

test('TASK-AI-142: buildHermesArgv prioritizes explicit query over default goal prompt', () => {
  const candidate = {
    candidateKey: 'hermes::http://127.0.0.1:20128/v1::9router::ag::acc1::acc1::ag/claude-sonnet-4',
    modelId: 'ag/claude-sonnet-4',
    gateway: '9router',
  };
  const session = { sessionId: 'hermes_test_123', candidateKey: candidate.candidateKey };

  const argv = buildHermesArgv(candidate, session, {
    goal: 'FEAT-AUTH-02',
    query: 'Plan this goal in dry-run mode first',
  });

  const qIndex = argv.indexOf('-q');
  assert.equal(argv[qIndex + 1], 'Plan this goal in dry-run mode first');
});
