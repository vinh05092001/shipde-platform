'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadSession,
  saveSession,
  linkGoalToSession,
  selectReasoningCandidate,
  writeProvidersConfig,
  buildHermesArgv,
  launchHermesSession,
  goalSessionCommand,
  chatCommand,
  sessionFilePath,
  configFilePath,
  skillFilePath,
  generateSessionId,
  HERMES_MIN_CONTEXT,
} = require('../hermes-session');
const { candidateKey } = require('../discovery/identity');
const decisions = require('../decisions');
const { main } = require('../cli');

function fixtureRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'hermes-session-test-'));
}

function sampleRegistry() {
  return {
    version: 2,
    sources: [
      {
        id: '9router',
        kind: 'router',
        harness: 'hermes',
        endpoint: 'http://127.0.0.1:20128/v1',
        accessPath: 'http://127.0.0.1:20128/v1',
        credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
        servesModels: true,
      },
      {
        id: 'rqsty',
        kind: 'router',
        harness: 'hermes',
        endpoint: 'https://router.requesty.ai/v1',
        accessPath: 'https://router.requesty.ai/v1',
        credential: { type: 'api-key', env: 'REQUESTY_API_KEY' },
        servesModels: true,
      },
    ],
  };
}

function sampleCandidate(overrides) {
  const c = Object.assign(
    {
      harness: 'hermes',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'kr',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'kr/gemini-2.5-pro',
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
      cost: 5,
      quality: 90,
      latencyMs: 1200,
      evidence: [
        {
          status: 'passed',
          proofLevel: 'WORK_ITEM_PASS',
          latencyMs: 1200,
        },
      ],
    },
    overrides || {}
  );
  c.candidateKey = candidateKey(c);
  return c;
}

test('H2-01: candidate selection uses existing routing/ranking with 7-part key and writes decision log', async () => {
  const root = fixtureRoot('hermes-cand-');
  const decisionDir = path.join(root, 'decisions');
  try {
    const c1 = sampleCandidate({
      upstream: 'kr',
      modelId: 'kr/gemini-2.5-pro',
      latencyMs: 500,
      cost: 2,
    });
    const c2 = sampleCandidate({
      upstream: 'gh',
      modelId: 'gh/gpt-4o',
      latencyMs: 5000,
      cost: 20,
    });

    const result = selectReasoningCandidate(
      {
        rootDir: root,
        decisionDir,
        role: 'planner.default',
      },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.ok(result.chosen, 'Candidate must be chosen');
    assert.equal(
      result.chosen.startsWith('hermes::'),
      true,
      'CandidateKey must start with hermes::'
    );
    assert.equal(result.chosen.split('::').length, 7, 'CandidateKey must have 7 parts');
    assert.equal(
      result.candidate.modelId,
      'kr/gemini-2.5-pro',
      'Highest quality meeting criteria chosen'
    );
    assert.equal(result.decisionRecord.stage, decisions.Stage.SELECTED);
    assert.equal(result.decisionRecord.harness, 'hermes');
    assert.ok(result.decisionRecord.candidates.length >= 2);

    // Verify decision record written to disk
    const logs = fs.readdirSync(decisionDir).filter((f) => f.endsWith('.jsonl'));
    assert.ok(logs.length > 0, 'Decision log file must be written');
    const content = fs.readFileSync(path.join(decisionDir, logs[0]), 'utf8');
    assert.ok(content.includes('HERMES_REASONING_SELECTION'));
    assert.ok(content.includes('kr/gemini-2.5-pro'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-02: candidate selection excludes Claude family from worker/reviewer lanes per policy', async () => {
  const root = fixtureRoot('hermes-claude-');
  try {
    const cClaude = sampleCandidate({
      modelId: 'claude-3-7-sonnet',
      upstream: 'cl',
    });
    const cGemini = sampleCandidate({
      modelId: 'kr/gemini-2.5-pro',
      upstream: 'kr',
    });

    const result = selectReasoningCandidate(
      {
        rootDir: root,
        role: 'writer',
        skipDecisionLog: true,
      },
      {
        candidates: [cClaude, cGemini],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.equal(result.chosen, cGemini.candidateKey);
    const rejectedClaude = result.rejected.find((r) => r.candidateKey.includes('claude'));
    assert.ok(rejectedClaude, 'Claude candidate must be rejected for worker lane');
    assert.equal(rejectedClaude.reasonCode, 'CLAUDE_FAMILY_EXCLUDED_BY_POLICY');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-03: candidate selection respects forbiddenFailureDomains and excludedCandidates', async () => {
  const root = fixtureRoot('hermes-forbid-');
  try {
    const c1 = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/gemini-2.5-pro',
      quality: 95,
    });
    const c2 = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'rq',
      modelId: 'rq/gpt-4o',
      quality: 85,
    });

    const result = selectReasoningCandidate(
      {
        rootDir: root,
        forbiddenFailureDomains: ['9router'],
        skipDecisionLog: true,
      },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.equal(result.chosen, c2.candidateKey);
    assert.equal(result.candidate.gateway, 'rqsty');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-04: writeProvidersConfig writes data/hermes/config.yaml with base_url and env var NAME only (no secrets)', async () => {
  const root = fixtureRoot('hermes-cfg-');
  try {
    const candidate = sampleCandidate({
      gateway: '9router',
      accessPath: 'http://127.0.0.1:20128/v1',
    });

    const res = writeProvidersConfig(candidate, { rootDir: root }, { registry: sampleRegistry() });

    assert.ok(fs.existsSync(res.configPath), 'config.yaml must exist');
    const content = fs.readFileSync(res.configPath, 'utf8');

    assert.ok(content.includes('providers:'));
    assert.ok(content.includes('base_url: "http://127.0.0.1:20128/v1"'));
    assert.ok(content.includes('api_key_env: "NINEROUTER_API_KEY"'));

    // Crucial security verification: MUST NOT contain any actual key value or secret
    assert.equal(content.includes('sk-'), false, 'Never contain key values');
    assert.equal(content.includes('Bearer'), false, 'Never contain tokens');

    const jsonPath = path.join(root, 'data', 'hermes', 'providers.json');
    assert.ok(fs.existsSync(jsonPath), 'providers.json must also exist');
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.equal(parsed.providers['9router'].base_url, 'http://127.0.0.1:20128/v1');
    assert.equal(parsed.providers['9router'].api_key_env, 'NINEROUTER_API_KEY');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-05: buildHermesArgv builds correct Hermes CLI arguments including -m, --provider, --resume, and -s', async () => {
  const root = fixtureRoot('hermes-argv-');
  try {
    const candidate = sampleCandidate({
      gateway: '9router',
      modelId: 'kr/gemini-2.5-pro',
    });
    const session = { sessionId: 'hermes_session_test_123' };

    const argv = buildHermesArgv(candidate, session, { rootDir: root });

    assert.deepEqual(argv.slice(0, 6), [
      '-m',
      'kr/gemini-2.5-pro',
      '--provider',
      '9router',
      '--resume',
      'hermes_session_test_123',
    ]);

    assert.equal(argv[6], '-s');
    assert.ok(argv[7].endsWith('SKILL.md'));

    const argvWithChat = buildHermesArgv(candidate, session, {
      rootDir: root,
      includeChatCommand: true,
    });
    assert.equal(argvWithChat[0], 'chat');
    assert.equal(argvWithChat[1], '-m');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-06: session persistence stores sessionId, candidateKey, and goalIds without secrets', async () => {
  const root = fixtureRoot('hermes-sess-');
  try {
    assert.equal(loadSession({ rootDir: root }), null, 'Initially null when file missing');

    const created = saveSession(
      {
        sessionId: 'test_sess_01',
        candidateKey:
          'hermes::http://127.0.0.1:20128/v1::9router::kr::acc-1::acc-1::kr/gemini-2.5-pro',
        goalIds: ['GOAL-01'],
      },
      { rootDir: root }
    );

    assert.equal(created.sessionId, 'test_sess_01');

    const loaded = loadSession({ rootDir: root });
    assert.deepEqual(loaded, {
      sessionId: 'test_sess_01',
      candidateKey:
        'hermes::http://127.0.0.1:20128/v1::9router::kr::acc-1::acc-1::kr/gemini-2.5-pro',
      goalIds: ['GOAL-01'],
    });

    // Link another goal ID idempotently
    linkGoalToSession('GOAL-02', { rootDir: root });
    linkGoalToSession('GOAL-01', { rootDir: root }); // Duplicate should not add twice

    const updated = loadSession({ rootDir: root });
    assert.deepEqual(updated.goalIds, ['GOAL-01', 'GOAL-02']);

    const raw = fs.readFileSync(sessionFilePath(root), 'utf8');
    assert.equal(raw.includes('apiKey'), false);
    assert.equal(raw.includes('api_key'), false);
    assert.equal(raw.includes('token'), false);
    assert.equal(raw.includes('secret'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-07: launchHermesSession executes fake spawn and returns completed status', async () => {
  const root = fixtureRoot('hermes-launch-');
  try {
    const candidate = sampleCandidate();
    let spawnCalledWith = null;

    const fakeSpawn = async (cmd, args, options) => {
      spawnCalledWith = { cmd, args, options };
      return { exitCode: 0, stdout: 'Hermes session started', stderr: '' };
    };

    const res = await launchHermesSession(
      {
        rootDir: root,
        skipDecisionLog: true,
      },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        spawn: fakeSpawn,
      }
    );

    assert.equal(res.status, 'completed');
    assert.equal(res.exitCode, 0);
    assert.ok(spawnCalledWith, 'spawn was called');
    assert.equal(spawnCalledWith.cmd, 'hermes');
    assert.ok(spawnCalledWith.args.includes('-m'));
    assert.ok(spawnCalledWith.args.includes('--resume'));
    assert.equal(spawnCalledWith.options.cwd, root);

    // Verify session was persisted
    const session = loadSession({ rootDir: root });
    assert.ok(session.sessionId);
    assert.equal(session.candidateKey, candidate.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-08: route/quota failure triggers reselection and relaunches with the same sessionId', async () => {
  const root = fixtureRoot('hermes-failover-');
  try {
    const c1 = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/gemini-2.5-pro',
      quality: 95,
    });
    const c2 = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'rq',
      modelId: 'rq/gpt-4o',
      quality: 85,
    });

    const calls = [];
    const fakeSpawn = async (cmd, args, options) => {
      calls.push({ cmd, args });
      if (calls.length === 1) {
        // First candidate fails with 429 upstream rate limit
        return {
          exitCode: 1,
          status: 1,
          stderr: 'HTTP 429 Too Many Requests: upstream_rate_limit for model kr/gemini-2.5-pro',
          httpStatus: 429,
        };
      }
      // Second candidate succeeds
      return { exitCode: 0, status: 0, stdout: 'Session resumed', stderr: '' };
    };

    const res = await launchHermesSession(
      {
        rootDir: root,
        skipDecisionLog: true,
      },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        spawn: fakeSpawn,
      }
    );

    assert.equal(res.status, 'completed');
    assert.equal(calls.length, 2, 'Must have relaunched on second candidate');

    // First attempt used candidate 1
    assert.ok(calls[0].args.includes('kr/gemini-2.5-pro'));
    // Second attempt used candidate 2
    assert.ok(calls[1].args.includes('rq/gpt-4o'));

    // Both attempts used the EXACT SAME sessionId
    const resumeIndex0 = calls[0].args.indexOf('--resume');
    const resumeIndex1 = calls[1].args.indexOf('--resume');
    assert.equal(calls[0].args[resumeIndex0 + 1], calls[1].args[resumeIndex1 + 1]);

    // Session file now points to the reselected candidate
    const session = loadSession({ rootDir: root });
    assert.equal(session.candidateKey, c2.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-09: local launch failure throws immediately without cooling down or excluding the model', async () => {
  const root = fixtureRoot('hermes-local-fail-');
  try {
    const candidate = sampleCandidate();

    const fakeSpawn = async () => {
      const err = new Error('spawn hermes ENOENT: command not found');
      err.code = 'ENOENT';
      throw err;
    };

    let thrown = null;
    try {
      await launchHermesSession(
        {
          rootDir: root,
          skipDecisionLog: true,
        },
        {
          candidates: [candidate],
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
          spawn: fakeSpawn,
        }
      );
    } catch (e) {
      thrown = e;
    }

    assert.ok(thrown, 'Must throw on local launch error');
    assert.equal(thrown.code, 'LOCAL_LAUNCH_FAILURE');
    assert.equal(thrown.scope, 'local');

    // Model was not marked in a cooldown and candidate is still valid on next selection
    const res = selectReasoningCandidate(
      {
        rootDir: root,
        skipDecisionLog: true,
      },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );
    assert.equal(res.chosen, candidate.candidateKey, 'Model was NOT cooled down');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-10: goal session CLI command returns JSON on stdout', async () => {
  const root = fixtureRoot('hermes-goal-sess-');
  try {
    const candidate = sampleCandidate();
    const stdoutLines = [];
    const origLog = console.log;
    console.log = (msg) => stdoutLines.push(msg);

    try {
      const res = await goalSessionCommand(
        {
          rootDir: root,
          goal: 'GOAL-100',
        },
        {
          candidates: [candidate],
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
        }
      );

      assert.equal(res.exitCode, 0);
      assert.ok(stdoutLines.length > 0);
      const parsed = JSON.parse(stdoutLines[stdoutLines.length - 1]);
      assert.equal(parsed.status, 'active');
      assert.ok(parsed.sessionId);
      assert.equal(parsed.candidateKey, candidate.candidateKey);
      assert.deepEqual(parsed.goalIds, ['GOAL-100']);
      assert.ok(parsed.configPath.endsWith('config.yaml'));
    } finally {
      console.log = origLog;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-11: chat CLI command with --dry-run prints launch plan without spawning', async () => {
  const root = fixtureRoot('hermes-chat-dry-');
  try {
    const candidate = sampleCandidate();

    const res = await chatCommand(
      {
        rootDir: root,
        dryRun: true,
        goal: 'GOAL-200',
      },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.equal(res.exitCode, 0);
    assert.equal(res.result.status, 'dry_run');
    assert.ok(res.result.argv.includes('--resume'));
    assert.ok(res.result.argv.includes('kr/gemini-2.5-pro'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-12: cli.js dispatches chat and goal session commands', async () => {
  const root = fixtureRoot('hermes-cli-disp-');
  try {
    const candidate = sampleCandidate();
    const stdoutLines = [];
    const origLog = console.log;
    console.log = (msg) => stdoutLines.push(msg);

    try {
      // Test goal session
      main(['goal', 'session', '--goal', 'GOAL-CLI', '--root', root], {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      });

      // Give event loop tick for promise resolution
      await new Promise((r) => setTimeout(r, 50));

      assert.ok(stdoutLines.length > 0);
      const goalOut = JSON.parse(stdoutLines[stdoutLines.length - 1]);
      assert.equal(goalOut.status, 'active');
      assert.deepEqual(goalOut.goalIds, ['GOAL-CLI']);

      // Test chat --dry-run
      main(['chat', '--dry-run', '--root', root, '--json'], {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      });

      await new Promise((r) => setTimeout(r, 50));

      const chatOut = JSON.parse(stdoutLines[stdoutLines.length - 1]);
      assert.equal(chatOut.status, 'dry_run');
    } finally {
      console.log = origLog;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-13: skill file and powershell script exist with correct contracts', () => {
  const skillFile = skillFilePath();
  assert.ok(
    fs.existsSync(skillFile),
    'tools/ai-brain/skills/shipde-controller/SKILL.md must exist'
  );
  const skillText = fs.readFileSync(skillFile, 'utf8');

  // Must enforce hard rules
  assert.ok(skillText.includes('NEVER pick your own model'), 'Skill forbids picking models');
  assert.ok(skillText.includes('NEVER spawn subagents'), 'Skill forbids spawning subagents');
  assert.ok(
    skillText.includes('NEVER claim work is complete without evidence'),
    'Skill forbids claiming completion'
  );
  assert.ok(skillText.includes('node tools/ai-brain/cli.js goal start'), 'Mentions goal start');
  assert.ok(skillText.includes('node tools/ai-brain/cli.js goal plan'), 'Mentions goal plan');
  assert.ok(skillText.includes('node tools/ai-brain/cli.js goal status'), 'Mentions goal status');

  const ps1File = path.join(process.cwd(), 'scripts', 'ai', 'hermes-chat.ps1');
  assert.ok(fs.existsSync(ps1File), 'scripts/ai/hermes-chat.ps1 must exist');
  const ps1Text = fs.readFileSync(ps1File, 'utf8');
  assert.ok(ps1Text.includes('cli.js') && ps1Text.includes('chat'), 'Invokes cli.js chat');
});

test('H2-14: TASK-AI-142.md has H2 open questions documented for supervisor verification', () => {
  const docPath = path.join(process.cwd(), 'docs', 'product-spec', 'work-items', 'TASK-AI-142.md');
  assert.ok(fs.existsSync(docPath), 'TASK-AI-142.md must exist');
  const docText = fs.readFileSync(docPath, 'utf8');
  assert.ok(docText.includes('## H2 open questions'), 'Must contain ## H2 open questions');
  assert.ok(docText.includes('Provider config format'), 'Mentions provider config format');
  assert.ok(docText.includes('Environment variable'), 'Mentions env var name question');
});
