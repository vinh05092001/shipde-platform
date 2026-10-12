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

test('H2-15: candidate selection enforces route-health gates on production discovery path and fails closed with NO_REASONING_CANDIDATE', async () => {
  const root = fixtureRoot('hermes-health-gates-');
  try {
    let assembleOptions = null;
    const fakeAssemble = (discovery, accounts, registry, options) => {
      assembleOptions = options;
      return []; // No candidates pass route health
    };

    const res = selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        readDiscoveryCatalogue: () => ({ candidates: [{ id: 'unprobed-1' }] }),
        assembleForDispatch: fakeAssemble,
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.ok(assembleOptions, 'assembleForDispatch must be called');
    assert.equal(assembleOptions.requireRouteHealth, true, 'requireRouteHealth must be true');
    assert.equal(
      assembleOptions.allowUnprobedCandidates,
      undefined,
      'allowUnprobedCandidates must not be true'
    );
    assert.equal(res.chosen, null, 'Must fail closed when no candidate qualifies');
    assert.equal(res.candidate, null);
    assert.equal(res.refused, 'NO_REASONING_CANDIDATE');
    assert.ok(res.reason.includes('NO_REASONING_CANDIDATE'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-16: discovery read errors are refusals and not swallowed', async () => {
  const root = fixtureRoot('hermes-disc-err-');
  try {
    const res = selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        readDiscoveryCatalogue: () => {
          throw new Error('EACCES: catalogue read error');
        },
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.equal(res.chosen, null);
    assert.equal(res.candidate, null);
    assert.equal(res.refused, 'DISCOVERY_READ_ERROR');
    assert.ok(res.reason.includes('DISCOVERY_READ_ERROR'));
    assert.ok(res.reason.includes('EACCES: catalogue read error'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-17: candidate with unknown or too-small context is rejected without flooring or inventing contextWindow', async () => {
  const root = fixtureRoot('hermes-context-floor-');
  try {
    const cSmall = sampleCandidate({
      upstream: 'kr',
      modelId: 'kr/small-context',
      contextWindow: 16000,
      capabilities: { contextWindow: 16000 },
    });
    const cMissing = sampleCandidate({
      upstream: 'rq',
      modelId: 'rq/missing-context',
      contextWindow: undefined,
      capabilities: {},
    });

    const res = selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [cSmall, cMissing],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.equal(res.chosen, null, 'No candidate with < 32k or missing context may be chosen');
    assert.equal(res.candidate, null);
    assert.equal(res.refused, 'NO_REASONING_CANDIDATE');

    const rejectedSmall = res.rejected.find((r) => r.candidateKey.includes('small-context'));
    assert.ok(rejectedSmall, 'cSmall must be in rejected');
    assert.ok(
      rejectedSmall.reasonCode.includes('CONTEXT_TOO_SMALL'),
      'cSmall must be rejected for CONTEXT_TOO_SMALL'
    );

    const rejectedMissing = res.rejected.find((r) => r.candidateKey.includes('missing-context'));
    assert.ok(rejectedMissing, 'cMissing must be in rejected');
    assert.ok(
      rejectedMissing.reasonCode.includes('CONTEXT_WINDOW_UNVERIFIED'),
      'cMissing must be rejected for CONTEXT_WINDOW_UNVERIFIED'
    );

    // If a candidate with valid context >= 32000 is present, it is selected over cSmall
    const cValid = sampleCandidate({
      upstream: 'kr',
      modelId: 'kr/valid-context',
      contextWindow: 32000,
      capabilities: { contextWindow: 32000 },
      quality: 85,
    });
    const resWithValid = selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [cSmall, cValid],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );
    assert.equal(resWithValid.candidate.modelId, 'kr/valid-context');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-18: excludedCandidates excludes candidates by their final post-adaptation candidateKey', async () => {
  const root = fixtureRoot('hermes-exclude-final-');
  try {
    const c1 = sampleCandidate({
      harness: 'cli',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/gemini-2.5-pro',
      quality: 95,
    });
    const c2 = sampleCandidate({
      harness: 'cli',
      accessPath: 'cli',
      gateway: 'rqsty',
      upstream: 'rq',
      modelId: 'rq/gpt-4o',
      quality: 85,
    });

    const c1FinalKey =
      'hermes::http://127.0.0.1:20128/v1::9router::kr::acc-1::acc-1::kr/gemini-2.5-pro';

    const res = selectReasoningCandidate(
      {
        rootDir: root,
        excludedCandidates: [c1FinalKey],
        forbiddenFailureDomains: [],
        skipDecisionLog: true,
      },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.ok(res.chosen, 'Candidate must be chosen');
    assert.equal(
      res.chosen.includes('rq/gpt-4o'),
      true,
      'c1 must be excluded by its post-adaptation key even without forbidden domains'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-19: stored candidate binding is reused when reselect is false and candidate is still usable', async () => {
  const root = fixtureRoot('hermes-reuse-binding-');
  try {
    const c1 = sampleCandidate({
      upstream: 'kr',
      modelId: 'kr/gemini-2.5-pro',
      latencyMs: 5000,
      cost: 20,
    });
    const c2 = sampleCandidate({
      upstream: 'rq',
      modelId: 'rq/gpt-4o',
      latencyMs: 200,
      cost: 1,
    });

    // Save initial session binding to c1
    saveSession(
      {
        sessionId: 'hermes_reuse_test_sess',
        candidateKey: c1.candidateKey,
        goalIds: ['GOAL-REUSE'],
      },
      { rootDir: root }
    );

    const calls = [];
    const fakeSpawn = async (cmd, args) => {
      calls.push({ cmd, args });
      return { exitCode: 0, status: 0 };
    };

    // First launch with reselect: false (default)
    const res1 = await launchHermesSession(
      { rootDir: root, reselect: false, skipDecisionLog: true },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        spawn: fakeSpawn,
      }
    );

    assert.equal(
      res1.candidateKey,
      c1.candidateKey,
      'Stored binding c1 must be reused when still usable and reselect is false'
    );
    const session1 = loadSession({ rootDir: root });
    assert.equal(session1.candidateKey, c1.candidateKey, 'Session file maintains binding to c1');

    // Second launch with explicit reselect: true -> switches to higher-quality c2
    const res2 = await launchHermesSession(
      { rootDir: root, reselect: true, skipDecisionLog: true },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        spawn: fakeSpawn,
      }
    );

    assert.equal(res2.candidateKey, c2.candidateKey, 'reselect: true selects new candidate c2');
    const session2 = loadSession({ rootDir: root });
    assert.equal(session2.candidateKey, c2.candidateKey, 'Session file updated to c2 on reselect');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-20: decision-log write failure fails the selection', async () => {
  const root = fixtureRoot('hermes-dec-fail-');
  try {
    const candidate = sampleCandidate();
    const mockDecisions = {
      Stage: decisions.Stage,
      recordDecision: () => {
        const err = new Error('ENOSPC: no space left on device');
        err.code = 'ENOSPC';
        throw err;
      },
    };

    let thrown = null;
    try {
      selectReasoningCandidate(
        { rootDir: root, skipDecisionLog: false },
        {
          candidates: [candidate],
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
          decisions: mockDecisions,
        }
      );
    } catch (e) {
      thrown = e;
    }

    assert.ok(thrown, 'Must throw when decision log write fails');
    assert.equal(thrown.code, 'DECISION_LOG_WRITE_FAILURE');
    assert.ok(thrown.message.includes('ENOSPC'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-21: unknown endpoints and unknown API key env vars refuse, and YAML values are validated and escaped', async () => {
  const root = fixtureRoot('hermes-unknown-ep-');
  try {
    const emptyRegistry = { version: 2, sources: [] };

    // 1. Unknown endpoint: candidate has no accessPath and registry has no source
    assert.throws(
      () => {
        writeProvidersConfig(
          { gateway: 'unknown-gw', upstream: 'unknown-up' },
          { rootDir: root },
          { registry: emptyRegistry }
        );
      },
      (err) => err.code === 'UNKNOWN_ENDPOINT'
    );

    // 2. Source exists with endpoint, but NO credential env var configured: refuse without guessing
    const noCredRegistry = {
      version: 2,
      sources: [
        {
          id: 'test-gw',
          endpoint: 'https://api.testgw.ai/v1',
          accessPath: 'https://api.testgw.ai/v1',
        },
      ],
    };
    assert.throws(
      () => {
        writeProvidersConfig(
          { gateway: 'test-gw', accessPath: 'https://api.testgw.ai/v1' },
          { rootDir: root },
          { registry: noCredRegistry }
        );
      },
      (err) => err.code === 'UNKNOWN_CREDENTIAL_ENV'
    );

    // 3. Invalid provider name with illegal characters
    const validCredRegistry = {
      version: 2,
      sources: [
        {
          id: 'bad gw!',
          endpoint: 'https://api.testgw.ai/v1',
          credential: { env: 'TEST_KEY' },
        },
      ],
    };
    assert.throws(
      () => {
        writeProvidersConfig(
          { gateway: 'bad gw!', accessPath: 'https://api.testgw.ai/v1' },
          { rootDir: root },
          { registry: validCredRegistry }
        );
      },
      (err) => err.code === 'INVALID_PROVIDER_NAME'
    );

    // 4. Safe YAML value escaping: quotes in URL are escaped via JSON.stringify
    const quoteRegistry = {
      version: 2,
      sources: [
        {
          id: 'quote-gw',
          endpoint: 'https://api.testgw.ai/v1?arg="quoted"',
          credential: { env: 'QUOTE_KEY' },
        },
      ],
    };
    const res = writeProvidersConfig(
      { gateway: 'quote-gw', accessPath: 'https://api.testgw.ai/v1?arg="quoted"' },
      { rootDir: root },
      { registry: quoteRegistry }
    );
    const content = fs.readFileSync(res.configPath, 'utf8');
    assert.ok(content.includes('\\"quoted\\"'), 'Quotes in URL must be escaped in YAML');

    // 5. Unsafe newline in baseUrl throws YAML_VALUE_UNSAFE
    const nlRegistry = {
      version: 2,
      sources: [
        {
          id: 'nl-gw',
          endpoint: 'https://api.testgw.ai/v1\ninjected: true',
          credential: { env: 'NL_KEY' },
        },
      ],
    };
    assert.throws(() => {
      writeProvidersConfig(
        { gateway: 'nl-gw', accessPath: 'https://api.testgw.ai/v1\ninjected: true' },
        { rootDir: root },
        { registry: nlRegistry }
      );
    }, /YAML_VALUE_UNSAFE|UNKNOWN_ENDPOINT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-22: explorationBudget defaults to 0 ensuring deterministic ranking', async () => {
  const root = fixtureRoot('hermes-explor-');
  try {
    let capturedRankCtx = null;
    const mockRank = (annotated, profile, assessment, rankCtx) => {
      capturedRankCtx = rankCtx;
      return {
        chosen: annotated[0]?.candidateKey || null,
        ranking: annotated,
        top3: annotated.slice(0, 3),
        rejected: [],
        refused: null,
        reason: 'ok',
      };
    };

    const c = sampleCandidate();
    selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [c],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        rankForProfile: mockRank,
      }
    );

    assert.ok(capturedRankCtx, 'rankForProfile must be called');
    assert.equal(
      capturedRankCtx.explorationBudget,
      0,
      'Default explorationBudget must be 0 for deterministic ranking'
    );

    // Explicit explorationBudget override is respected when provided
    selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true, explorationBudget: 3 },
      {
        candidates: [c],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        rankForProfile: mockRank,
      }
    );
    assert.equal(capturedRankCtx.explorationBudget, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-23: default non-injected launch path attempts real spawnSync of hermes and chatCommand returns Hermes exit code', async () => {
  const root = fixtureRoot('hermes-default-spawn-');
  try {
    const candidate = sampleCandidate();

    // 1. Calling launchHermesSession without deps.spawn attempts real spawn
    // When hermes binary is absent or invalid, it throws LOCAL_LAUNCH_FAILURE (never returns { status: 'ready' })
    await assert.rejects(
      async () => {
        await launchHermesSession(
          { rootDir: root, skipDecisionLog: true },
          {
            candidates: [candidate],
            registry: sampleRegistry(),
            priorsData: { ranking: [] },
          }
        );
      },
      (err) => {
        assert.ok(
          err.code === 'LOCAL_LAUNCH_FAILURE',
          'Must attempt real spawn and fail with LOCAL_LAUNCH_FAILURE when hermes not found'
        );
        return true;
      }
    );

    // 2. chatCommand returns Hermes exit code directly
    const mockSpawn = async () => ({
      exitCode: 42,
      status: 42,
      stderr: 'non-quota exit',
    });
    const chatRes = await chatCommand(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        spawn: mockSpawn,
      }
    );
    assert.equal(chatRes.exitCode, 42, 'chatCommand must return Hermes exit code 42');
    assert.equal(chatRes.result.status, 'exited');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-24: unclassified and user-exit failures stop immediately with exit code and do not rotate candidates', async () => {
  const root = fixtureRoot('hermes-unclassified-exit-');
  try {
    const c1 = sampleCandidate({ modelId: 'kr/gemini-2.5-pro' });
    const c2 = sampleCandidate({ modelId: 'rq/gpt-4o' });

    let spawnCalls = 0;
    const fakeSpawnSigint = async () => {
      spawnCalls += 1;
      return { exitCode: 130, status: 130, stderr: '' };
    };

    // User exit (SIGINT 130) stops with exitCode 130 without rotating models
    const resSigint = await launchHermesSession(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        spawn: fakeSpawnSigint,
      }
    );

    assert.equal(resSigint.status, 'exited');
    assert.equal(resSigint.exitCode, 130);
    assert.equal(spawnCalls, 1, 'Must NOT retry or rotate candidates on user exit');

    // Unclassified exit (e.g. 42 with unknown stderr) also stops without rotating models
    let spawnCalls42 = 0;
    const fakeSpawn42 = async () => {
      spawnCalls42 += 1;
      return { exitCode: 42, status: 42, stderr: 'unclassified internal error' };
    };

    const res42 = await launchHermesSession(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        spawn: fakeSpawn42,
      }
    );

    assert.equal(res42.status, 'exited');
    assert.equal(res42.exitCode, 42);
    assert.equal(spawnCalls42, 1, 'Must NOT retry or rotate candidates on unclassified failure');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-25: explicit --session keeps stored candidateKey and goalIds', async () => {
  const root = fixtureRoot('hermes-session-keep-');
  try {
    const candidate = sampleCandidate();
    const sessionId = 'hermes-keep-stored-100';

    // Seed session in data/hermes/session.json
    saveSession(
      {
        sessionId,
        candidateKey: candidate.candidateKey,
        goalIds: ['GOAL-1', 'GOAL-2'],
      },
      { rootDir: root }
    );

    // Call launchHermesSession with explicit --session matching stored session
    const res = await launchHermesSession(
      {
        rootDir: root,
        session: sessionId,
        dryRun: true,
      },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.equal(res.sessionId, sessionId);
    assert.equal(
      res.candidateKey,
      candidate.candidateKey,
      'Stored candidateKey must NOT be dropped'
    );

    // Verify stored session maintains goalIds
    const loaded = loadSession({ rootDir: root });
    assert.deepEqual(loaded.goalIds, ['GOAL-1', 'GOAL-2'], 'Stored goalIds must NOT be dropped');

    // Adding goal updates goalIds while preserving candidateKey
    const resWithGoal = await launchHermesSession(
      {
        rootDir: root,
        session: sessionId,
        goal: 'GOAL-3',
        dryRun: true,
      },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );
    assert.equal(resWithGoal.candidateKey, candidate.candidateKey);
    const loadedAfterGoal = loadSession({ rootDir: root });
    assert.deepEqual(loadedAfterGoal.goalIds, ['GOAL-1', 'GOAL-2', 'GOAL-3']);

    // goalSessionCommand also preserves candidateKey and goalIds with explicit session
    const origLog = console.log;
    console.log = () => {};
    let goalRes;
    try {
      goalRes = await goalSessionCommand(
        {
          rootDir: root,
          session: sessionId,
          goal: 'GOAL-4',
        },
        {
          candidates: [candidate],
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
        }
      );
    } finally {
      console.log = origLog;
    }
    assert.equal(goalRes.exitCode, 0);
    assert.deepEqual(goalRes.result.goalIds, ['GOAL-1', 'GOAL-2', 'GOAL-3', 'GOAL-4']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-26: decision log defaults to tools/ai-brain/data/decisions, never ~/.shipde', async () => {
  const root = fixtureRoot('hermes-decision-dir-');
  try {
    const candidate = sampleCandidate();

    // selectReasoningCandidate without decisionDir or skipDecisionLog writes under root
    const sel = selectReasoningCandidate(
      { rootDir: root },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );

    assert.ok(sel.chosen);
    const expectedDir = path.join(root, 'tools', 'ai-brain', 'data', 'decisions');
    assert.ok(fs.existsSync(expectedDir), 'Decision dir under rootDir must be created');
    const files = fs.readdirSync(expectedDir);
    assert.ok(
      files.length > 0,
      'Decision file must be written under rootDir/tools/ai-brain/data/decisions'
    );

    // goalSessionCommand also defaults to decisionDir under rootDir
    const origLog = console.log;
    console.log = () => {};
    let goalRes;
    try {
      goalRes = await goalSessionCommand(
        { rootDir: root, goal: 'GOAL-NO-HOME' },
        {
          candidates: [candidate],
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
        }
      );
    } finally {
      console.log = origLog;
    }
    assert.equal(goalRes.exitCode, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-27: cli.js reports GOAL_MODULE_UNAVAILABLE on H1 load/sync failures without swallowing', async () => {
  const errOutput = [];
  const origErr = console.error;
  const origExitCode = process.exitCode;
  console.error = (msg) => errOutput.push(msg);

  try {
    // 1. Injected failing loadGoals throws error
    main(['goal', 'start', '--text', 'test'], {
      loadGoals: () => {
        throw new Error('Simulated H1 goals.js failure');
      },
    });

    assert.ok(errOutput.length > 0);
    const lastErr = JSON.parse(errOutput[errOutput.length - 1]);
    assert.equal(lastErr.status, 'error');
    assert.ok(
      lastErr.error.includes('GOAL_MODULE_UNAVAILABLE: Simulated H1 goals.js failure'),
      'Must report GOAL_MODULE_UNAVAILABLE on load failure'
    );
    assert.ok(!lastErr.error.includes('UNKNOWN_GOAL_SUBCOMMAND'));

    // 2. Direct require of nonexistent goals module also reports GOAL_MODULE_UNAVAILABLE
    main(['goal', 'start', '--text', 'test']);
    assert.ok(errOutput.length > 1);
    const directRequireErr = JSON.parse(errOutput[errOutput.length - 1]);
    assert.equal(directRequireErr.status, 'error');
    assert.ok(
      directRequireErr.error.includes('GOAL_MODULE_UNAVAILABLE'),
      'Direct require must report GOAL_MODULE_UNAVAILABLE'
    );
  } finally {
    console.error = origErr;
    process.exitCode = origExitCode;
  }
});

test('H2-28: scripts/ai/hermes-chat.ps1 executes Set-Location to repo root before running node', async () => {
  const scriptPath = path.resolve(__dirname, '../../../scripts/ai/hermes-chat.ps1');
  const content = fs.readFileSync(scriptPath, 'utf8');

  assert.ok(
    content.includes('Set-Location -LiteralPath $repoRoot'),
    'hermes-chat.ps1 must include Set-Location -LiteralPath $repoRoot'
  );

  const setLocationIndex = content.indexOf('Set-Location -LiteralPath $repoRoot');
  const nodeIndex = content.indexOf('& node $cliPath chat');
  assert.ok(setLocationIndex > 0, 'Set-Location must be present');
  assert.ok(nodeIndex > setLocationIndex, 'Set-Location must occur before invoking node');
});

test('H2-29: candidate selection uses HERMES_MIN_CONTEXT in profile contextSize', async () => {
  const root = fixtureRoot('hermes-min-ctx-');
  try {
    let capturedProfile = null;
    const mockRank = (annotated, profile) => {
      capturedProfile = profile;
      return {
        chosen: annotated[0]?.candidateKey || null,
        ranking: annotated,
        top3: annotated.slice(0, 3),
        rejected: [],
        refused: null,
        reason: 'ok',
      };
    };

    const c = sampleCandidate();
    selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [c],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        rankForProfile: mockRank,
      }
    );

    assert.ok(capturedProfile, 'Profile must be captured');
    assert.equal(
      capturedProfile.contextSize,
      HERMES_MIN_CONTEXT,
      'profile.contextSize must use HERMES_MIN_CONTEXT (32000)'
    );
    assert.equal(HERMES_MIN_CONTEXT, 32000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
