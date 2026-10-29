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

test('TASK-AI-142: chatCommand parses --goal and invokes hermes with -q without implicit headless flags', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-goal-test-'));
  try {
    const registry = {
      version: 2,
      sources: [
        {
          id: '9router',
          kind: 'router',
          servesModels: true,
          endpoint: 'http://127.0.0.1:20128/v1',
          models: ['ag/claude-sonnet-4'],
          credential: { env: 'NINEROUTER_API_KEY' },
        },
      ],
      dispatch: {
        probeBudgetMs: 5000,
        probeTimeoutMs: 1000,
      },
    };

    let spawnedArgs = null;
    let spawnedCmd = null;

    const res = await chatCommand(
      {
        goal: 'FEAT-AUTH-02',
        rootDir: tmpDir,
        'dry-run': true,
        registry,
      },
      {
        registry,
        rootDir: tmpDir,
        probe: async () => ({ ok: true, status: 200 }),
      }
    );

    assert.equal(res.exitCode, 0);
    assert.equal(res.result.status, 'dry_run');
    assert.ok(res.result.argv.includes('-q'));
    const qIndex = res.result.argv.indexOf('-q');
    assert.match(res.result.argv[qIndex + 1], /FEAT-AUTH-02/);
    assert.equal(res.result.argv.includes('--yolo'), false);
    assert.equal(res.result.argv.includes('--accept-hooks'), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
