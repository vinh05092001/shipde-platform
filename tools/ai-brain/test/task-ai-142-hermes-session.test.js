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
  resolveHermesLaunchCommand,
  resolveHermesLaunch,
  resolveHermesCommand,
  launchHermesSession,
  goalSessionCommand,
  chatCommand,
  sessionFilePath,
  configFilePath,
  skillFilePath,
  installedSkillFilePath,
  CONTROLLER_SKILL_NAME,
  installSkillFile,
  generateSessionId,
  defaultSpawn,
  probeHermesCandidate,
  getHermesHomeDir,
  HERMES_MIN_CONTEXT,
  getCandidateProviderKey,
  isProviderLevelFailure,
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

test('H3-08: route probe excludes quota failure and launches the next candidate without logging credentials', async () => {
  const root = fixtureRoot('hermes-probe-fallback-');
  const secret = 'test-secret-never-log';
  const decisionDir = path.join(root, 'decisions');
  try {
    const c1 = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/first',
      quality: 99,
    });
    const c2 = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'rq',
      modelId: 'rq/second',
      quality: 90,
    });
    const launched = [];
    const res = await launchHermesSession(
      {
        rootDir: root,
        decisionDir,
        env: { NINEROUTER_API_KEY: secret, REQUESTY_API_KEY: secret },
      },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (candidate, envName, env) => {
          assert.equal(env[envName], secret);
          return candidate.candidateKey === c1.candidateKey
            ? { ok: false, status: 503, body: '{"error":{"message":"402 insufficient_credits"}}' }
            : { ok: true, status: 200, body: '{}' };
        },
        spawn: async (cmd, args) => {
          launched.push(args);
          return { exitCode: 0 };
        },
      }
    );
    assert.equal(res.candidateKey, c2.candidateKey);
    assert.equal(launched.length, 1);
    const logs = fs
      .readdirSync(decisionDir)
      .map((file) => fs.readFileSync(path.join(decisionDir, file), 'utf8'))
      .join('\n');
    assert.match(logs, /HERMES_ROUTE_PROBE_FAILED/);
    assert.doesNotMatch(JSON.stringify(res) + logs, new RegExp(secret));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3 realistic probe uses the candidate output limit and a substantial prompt', async () => {
  let request;
  const result = await probeHermesCandidate(
    Object.assign(sampleCandidate(), { maxOutputTokens: 4096 }),
    'NINEROUTER_API_KEY',
    { NINEROUTER_API_KEY: 'probe-secret-value' },
    {
      fetch: async (_url, init) => {
        request = JSON.parse(init.body);
        return { ok: true, status: 200, text: async () => 'OK' };
      },
    }
  );
  assert.equal(result.ok, true);
  assert.equal(request.max_tokens, 4096);
  assert.ok(request.messages[0].content.length >= 8000);
  assert.match(request.messages[0].content, /^Reply only OK/);
});

test('route probe decision-log failure is reported but does not block fallback', async () => {
  const root = fixtureRoot('hermes-probe-log-fallback-');
  const c1 = sampleCandidate({
    gateway: '9router',
    upstream: 'kr',
    modelId: 'kr/first',
    quality: 99,
  });
  const c2 = sampleCandidate({
    gateway: 'rqsty',
    upstream: 'rq',
    modelId: 'rq/second',
    quality: 90,
  });
  const probed = [];
  try {
    const res = await launchHermesSession(
      { rootDir: root, decisionDir: path.join(root, 'missing', 'decisions') },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        decisions: {
          Stage: { SELECTED: 'SELECTED', REFUSED: 'REFUSED' },
          recordDecision(record) {
            if (record.stage === 'refused') throw new Error('read-only decision directory');
          },
        },
        probe: async (candidate) => {
          probed.push(candidate.candidateKey);
          return candidate.candidateKey === c1.candidateKey
            ? { ok: false, status: 429, body: 'rate limited' }
            : { ok: true, status: 200, body: '{}' };
        },
        spawn: async () => ({ exitCode: 0 }),
      }
    );
    assert.equal(res.candidateKey, c2.candidateKey);
    assert.ok(res.refusalReasons.some((reason) => /DECISION_LOG_WRITE_FAILURE/.test(reason)));
    assert.deepEqual(probed, [c1.candidateKey, c2.candidateKey]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-09: all route probes failing refuse with NO_REASONING_CANDIDATE and reasons', async () => {
  const root = fixtureRoot('hermes-probe-refused-');
  try {
    const candidates = [
      sampleCandidate({ gateway: '9router', upstream: 'kr', modelId: 'kr/first', quality: 99 }),
      sampleCandidate({ gateway: 'rqsty', upstream: 'rq', modelId: 'rq/second', quality: 90 }),
    ];
    await assert.rejects(
      launchHermesSession(
        { rootDir: root, skipDecisionLog: true },
        {
          candidates,
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
          probe: async () => ({ ok: false, status: 402, body: 'insufficient_credits' }),
          spawn: async () => {
            throw new Error('Hermes must not launch');
          },
        }
      ),
      (err) =>
        err.code === 'NO_REASONING_CANDIDATE' &&
        /insufficient_credits|upstream_credit_exhausted/.test(err.message)
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-20: credit failure tries all canonical model routes and probes the next ranked model', async () => {
  const root = fixtureRoot('hermes-probe-model-diversity-');
  try {
    const modelAliases = ['cl/openai/gpt-6-astra', 'ocz/gpt-6-astra', 'azure/gpt-6-astra@eastus2'];
    const sameModelRoutes = ['9router', 'rqsty', '9router'].map((gateway, index) =>
      sampleCandidate({
        gateway,
        upstream: `shared-upstream-${index}`,
        accountId: 'shared-account',
        modelId: modelAliases[index],
        accessPath: `https://route-${index}.example/v1`,
        quality: 99 - index,
      })
    );
    const nextModel = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'other-upstream',
      modelId: 'other/gpt-6-sonnet',
      accessPath: 'https://other-provider.example/v1',
      quality: 90,
    });
    const probed = [];
    const res = await launchHermesSession(
      { rootDir: root, skipDecisionLog: true, maxAttempts: 20 },
      {
        candidates: [...sameModelRoutes, nextModel],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (candidate) => {
          probed.push(candidate.modelId);
          return modelAliases.includes(candidate.modelId)
            ? { ok: false, status: 402, body: 'upstream_credit_exhausted' }
            : { ok: true, status: 200, body: '{}' };
        },
        spawn: async () => ({ exitCode: 0 }),
      }
    );
    assert.equal(res.candidateKey, nextModel.candidateKey);
    assert.ok(probed.includes(nextModel.modelId));
    assert.equal(probed.filter((model) => modelAliases.includes(model)).length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3 legacy maxAttempts is ignored; only wall-clock budget limits routes', async () => {
  const root = fixtureRoot('hermes-probe-attempt-budget-');
  try {
    const candidates = Array.from({ length: 5 }, (_, index) =>
      sampleCandidate({
        gateway: index % 2 ? 'rqsty' : '9router',
        upstream: `upstream-${index}`,
        accountId: `account-${index}`,
        modelId: `reasoner-${index}`,
        accessPath: `https://route-${index}.example/v1`,
        quality: 100 - index,
      })
    );
    let probes = 0;
    await assert.rejects(
      launchHermesSession(
        { rootDir: root, skipDecisionLog: true, maxAttempts: 1 },
        {
          candidates,
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
          probe: async () => {
            probes += 1;
            return { ok: false, status: 429, body: 'rate limited' };
          },
          spawn: async () => ({ exitCode: 0 }),
        }
      ),
      /NO_REASONING_CANDIDATE/
    );
    assert.equal(probes, 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-21: probe timeout fails closed with NO_REASONING_CANDIDATE', async () => {
  const root = fixtureRoot('hermes-probe-budget-');
  try {
    await assert.rejects(
      launchHermesSession(
        { rootDir: root, skipDecisionLog: true, probeBudgetMs: 5000, probeTimeoutMs: 20 },
        {
          candidates: [sampleCandidate()],
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
          probe: async () => new Promise(() => {}),
          spawn: async () => {
            throw new Error('Hermes must not launch');
          },
        }
      ),
      (err) => err.code === 'NO_REASONING_CANDIDATE' && /timeout/.test(err.message)
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('timed-out route probe receives an aborted signal', async () => {
  const root = fixtureRoot('hermes-probe-abort-');
  let signal;
  try {
    await assert.rejects(
      launchHermesSession(
        { rootDir: root, skipDecisionLog: true, probeBudgetMs: 5000, probeTimeoutMs: 20 },
        {
          candidates: [sampleCandidate()],
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
          probe: async (_candidate, _envName, _env, options) => {
            signal = options.signal;
            return new Promise(() => {});
          },
          spawn: async () => {
            throw new Error('Hermes must not launch');
          },
        }
      ),
      (err) => err.code === 'NO_REASONING_CANDIDATE'
    );
    assert.ok(signal);
    assert.equal(signal.aborted, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-10: dry-run does not probe unless probe is explicitly requested', async () => {
  const root = fixtureRoot('hermes-probe-dry-run-');
  try {
    const candidate = sampleCandidate();
    let calls = 0;
    const deps = {
      candidates: [candidate],
      registry: sampleRegistry(),
      priorsData: { ranking: [] },
      probe: async () => {
        calls += 1;
        return { ok: true };
      },
    };
    await launchHermesSession({ rootDir: root, dryRun: true, skipDecisionLog: true }, deps);
    assert.equal(calls, 0);
    await launchHermesSession(
      { rootDir: root, dryRun: true, probe: true, skipDecisionLog: true },
      deps
    );
    assert.equal(calls, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-02: Operator decision 2026-10-12: candidate selection keeps Claude family eligible for worker/reviewer lanes', async () => {
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

    assert.equal(result.chosen, cClaude.candidateKey);
    const rejectedClaude = result.rejected.find((r) => r.candidateKey.includes('claude'));
    assert.equal(rejectedClaude, undefined, 'Claude candidate must not be rejected by policy');
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

    assert.ok(content.includes('model:'), 'config.yaml must contain model: section');
    assert.ok(content.includes('default: "kr/gemini-2.5-pro"'), 'model: section has default model');
    assert.ok(
      content.includes('provider: "9router"'),
      'model: section has provider matching providers'
    );
    assert.ok(content.includes('providers:'));
    assert.ok(content.includes('base_url: "http://127.0.0.1:20128/v1"'));
    assert.ok(content.includes('key_env: "NINEROUTER_API_KEY"'));
    assert.ok(content.includes('api_max_retries: 1'));
    assert.ok(content.includes('auto_recovery_cycles: 0'));

    // Crucial security verification: MUST NOT contain any actual key value or secret
    assert.equal(content.includes('sk-'), false, 'Never contain key values');
    assert.equal(content.includes('Bearer'), false, 'Never contain tokens');

    const jsonPath = path.join(root, 'data', 'hermes', 'providers.json');
    assert.ok(fs.existsSync(jsonPath), 'providers.json must also exist');
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.equal(parsed.providers['9router'].base_url, 'http://127.0.0.1:20128/v1');
    assert.equal(parsed.providers['9router'].key_env, 'NINEROUTER_API_KEY');
    assert.deepEqual(parsed.model, {
      default: 'kr/gemini-2.5-pro',
      provider: '9router',
    });

    const installedSkill = path.join(
      root,
      'tools',
      'ai-brain',
      'data',
      'hermes',
      'home',
      'skills',
      'shipde-controller',
      'SKILL.md'
    );
    assert.ok(fs.existsSync(installedSkill), 'skill file must be installed under hermes home');
    const skillContent = fs.readFileSync(installedSkill, 'utf8');
    assert.ok(skillContent.includes('NEVER pick your own model'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-05: buildHermesArgv builds correct Hermes CLI arguments including chat, -m, --provider, --continue, --create-if-missing, and -s', async () => {
  const root = fixtureRoot('hermes-argv-');
  try {
    const candidate = sampleCandidate({
      gateway: '9router',
      modelId: 'kr/gemini-2.5-pro',
    });
    const session = { sessionId: 'hermes_session_test_123' };

    const argv = buildHermesArgv(candidate, session, { rootDir: root });

    assert.equal(argv[0], 'chat', 'chat subcommand must be included by default');
    assert.deepEqual(argv.slice(1, 8), [
      '-m',
      'kr/gemini-2.5-pro',
      '--provider',
      '9router',
      '--continue',
      'hermes_session_test_123',
      '--create-if-missing',
    ]);

    assert.equal(argv[8], '-s');
    assert.equal(argv[9], 'shipde-controller', 'passes skill by name, never a path');

    const argvNoChat = buildHermesArgv(candidate, session, {
      rootDir: root,
      includeChatCommand: false,
    });
    assert.equal(argvNoChat[0], '-m');
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
  const emptyDir = fixtureRoot('hermes-empty-path-');
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
        probe: async () => ({ ok: true }),
        env: { PATH: emptyDir, HERMES_BIN: emptyDir },
      }
    );

    assert.equal(res.status, 'completed');
    assert.equal(res.exitCode, 0);
    assert.ok(spawnCalledWith, 'spawn was called');
    assert.equal(spawnCalledWith.cmd, 'hermes');
    assert.ok(spawnCalledWith.args.includes('-m'));
    assert.ok(spawnCalledWith.args.includes('--continue'));
    assert.ok(spawnCalledWith.args.includes('--create-if-missing'));
    assert.equal(spawnCalledWith.options.cwd, root);

    // Verify session was persisted
    const session = loadSession({ rootDir: root });
    assert.ok(session.sessionId);
    assert.equal(session.candidateKey, candidate.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
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
        probe: async () => ({ ok: true }),
      }
    );

    assert.equal(res.status, 'completed');
    assert.equal(calls.length, 2, 'Must have relaunched on second candidate');

    // First attempt used candidate 1
    assert.ok(calls[0].args.includes('kr/gemini-2.5-pro'));
    // Second attempt used candidate 2
    assert.ok(calls[1].args.includes('rq/gpt-4o'));

    // Both attempts used the EXACT SAME sessionId
    const continueIndex0 = calls[0].args.indexOf('--continue');
    const continueIndex1 = calls[1].args.indexOf('--continue');
    assert.notEqual(continueIndex0, -1);
    assert.notEqual(continueIndex1, -1);
    assert.equal(calls[0].args[continueIndex0 + 1], calls[1].args[continueIndex1 + 1]);
    assert.ok(calls[0].args.includes('--create-if-missing'));
    assert.ok(calls[1].args.includes('--create-if-missing'));

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
          probe: async () => ({ ok: true }),
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
    assert.ok(res.result.argv.includes('--continue'));
    assert.ok(res.result.argv.includes('--create-if-missing'));
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
      // Test goal session by awaiting main's returned promise
      await main(['goal', 'session', '--goal', 'GOAL-CLI', '--root', root], {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      });

      assert.ok(stdoutLines.length > 0);
      const goalOut = JSON.parse(stdoutLines[stdoutLines.length - 1]);
      assert.equal(goalOut.status, 'active');
      assert.deepEqual(goalOut.goalIds, ['GOAL-CLI']);

      // Test chat --dry-run by awaiting main's returned promise
      await main(['chat', '--dry-run', '--root', root, '--json'], {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      });

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
      assembleOptions.allowMissingRouteHealth,
      true,
      'missing health records must be admitted for the ranked live probe'
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
        probe: async () => ({ ok: true }),
      }
    );

    assert.equal(
      res1.candidateKey,
      c1.candidateKey,
      'Stored binding c1 must be reused when still usable and reselect is false'
    );
    const session1 = loadSession({ rootDir: root });
    assert.equal(session1.candidateKey, c1.candidateKey, 'Session file maintains binding to c1');

    // Route price and latency cannot reorder equally scored distinct models.
    const res2 = await launchHermesSession(
      { rootDir: root, reselect: true, skipDecisionLog: true },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        spawn: fakeSpawn,
        probe: async () => ({ ok: true }),
      }
    );

    assert.equal(
      res2.candidateKey,
      c1.candidateKey,
      'Equal model scores use canonical model order, independent of route price'
    );
    const session2 = loadSession({ rootDir: root });
    assert.equal(
      session2.candidateKey,
      c1.candidateKey,
      'Session file retains the chosen model route'
    );
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
  const emptyDir = fixtureRoot('hermes-empty-spawn-');
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
            probe: async () => ({ ok: true }),
            env: { PATH: emptyDir, HERMES_BIN: emptyDir },
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

    // 2. Default non-injected spawn path propagates Hermes exit code
    // Uses HERMES_BIN pointing to a tiny temp .js that exits with a known code (42)
    const fakeHermesJs = path.join(root, 'fake-hermes-exit.js');
    fs.writeFileSync(
      fakeHermesJs,
      'process.stderr.write("non-quota exit\\n"); process.exit(42);\n',
      'utf8'
    );
    const chatRes = await chatCommand(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async () => ({ ok: true }),
        env: { PATH: emptyDir, HERMES_BIN: fakeHermesJs },
      }
    );
    assert.equal(chatRes.exitCode, 42, 'chatCommand must return Hermes exit code 42');
    assert.equal(chatRes.result.status, 'exited');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(emptyDir, { recursive: true, force: true });
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
        probe: async () => ({ ok: true }),
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
        probe: async () => ({ ok: true }),
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

    // 2. An injected goals module that failed to load also reports GOAL_MODULE_UNAVAILABLE
    // (goals.js now exists on main, so the failure is injected instead of required).
    main(['goal', 'start', '--text', 'test'], { goals: new Error('goals.js failed to load') });
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

test('H2-30: defaultSpawn pipes and tees stderr to process.stderr while buffering chunks', async () => {
  const origStderrWrite = process.stderr.write;
  const forwarded = [];
  process.stderr.write = (chunk) => {
    forwarded.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  };
  try {
    const res = await defaultSpawn(
      process.execPath,
      [
        '-e',
        "process.stderr.write('chunk-alpha\\n'); process.stderr.write('chunk-beta\\n'); process.exit(0);",
      ],
      { stdio: ['inherit', 'inherit', 'pipe'] }
    );

    assert.equal(res.exitCode, 0);
    assert.ok(res.stderr.includes('chunk-alpha'));
    assert.ok(res.stderr.includes('chunk-beta'));
    const combined = forwarded.join('');
    assert.ok(combined.includes('chunk-alpha'), 'Stderr chunk must be forwarded live');
    assert.ok(combined.includes('chunk-beta'), 'Stderr chunk must be forwarded live');
  } finally {
    process.stderr.write = origStderrWrite;
  }
});

test('defaultSpawn ignores model quota text and recognizes Hermes API failure lines', async () => {
  const origStderrWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const started = Date.now();
    const res = await defaultSpawn(
      process.execPath,
      [
        '-e',
        "process.stdout.write('Thinking: QUOTA_EXHAUSTED reason; insufficient quota is only an example\\n'); setTimeout(() => process.exit(0), 30);",
      ],
      {
        stdio: ['inherit', 'pipe', 'pipe'],
      }
    );
    assert.equal(res.exitCode, 0);
    assert.equal(res.routeFailure, null, 'model generated text is not route evidence');

    const apiFailure = await defaultSpawn(
      process.execPath,
      [
        '-e',
        "process.stderr.write('\\u001b[31mAPI call failed (attempt 1/1): Error code: 403 insufficient_user_quota\\u001b[0m\\n'); setInterval(() => {}, 1000);",
      ],
      { stdio: ['inherit', 'pipe', 'pipe'] }
    );
    assert.match(apiFailure.routeFailure, /API call failed.*403.*insufficient_user_quota/i);
    assert.notEqual(apiFailure.exitCode, 0);
  } finally {
    process.stderr.write = origStderrWrite;
  }
});

test('H2-31: defaultSpawn keeps at most the last 64 KB in stderr buffer', async () => {
  const origStderrWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const script = "process.stderr.write('X'.repeat(70000) + 'TAIL_TOKEN'); process.exit(0);";
    const res = await defaultSpawn(process.execPath, ['-e', script], {
      stdio: ['inherit', 'inherit', 'pipe'],
    });

    assert.equal(res.exitCode, 0);
    assert.ok(Buffer.byteLength(res.stderr, 'utf8') <= 64 * 1024);
    assert.ok(res.stderr.includes('TAIL_TOKEN'), 'Tail of buffer must be preserved');
  } finally {
    process.stderr.write = origStderrWrite;
  }
});

test('H2-32: route/quota relaunch uses piped stderr and classifies failure to trigger retry', async () => {
  const root = fixtureRoot('hermes-tee-retry-');
  try {
    const c1 = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/gemini-2.5-pro',
    });
    const c2 = sampleCandidate({ gateway: 'rqsty', upstream: 'rq', modelId: 'rq/gpt-4o' });

    let calls = 0;
    const fakeSpawn = async (cmd, args, options) => {
      calls += 1;
      assert.deepEqual(
        options.stdio,
        ['inherit', 'pipe', 'pipe'],
        'Default stdio must pipe stderr for live teeing and failure classification'
      );
      if (calls === 1) {
        return {
          exitCode: 1,
          status: 1,
          stderr: 'HTTP 429 Too Many Requests: upstream_rate_limit for model kr/gemini-2.5-pro',
        };
      }
      return { exitCode: 0, status: 0, stdout: 'OK', stderr: '' };
    };

    const res = await launchHermesSession(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        spawn: fakeSpawn,
        probe: async () => ({ ok: true }),
      }
    );

    assert.equal(res.status, 'completed');
    assert.equal(calls, 2, 'Relaunch must trigger on second candidate');
    const session = loadSession({ rootDir: root });
    assert.equal(session.candidateKey, c2.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3 runtime 403 insufficient_user_quota stops and relaunches with the same session id', async () => {
  const root = fixtureRoot('hermes-runtime-quota-');
  try {
    const secret = 'runtime-secret-never-log';
    const c1 = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      modelId: 'kr/first',
      quality: 99,
    });
    const c2 = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'rq',
      modelId: 'rq/second',
      quality: 90,
    });
    const launched = [];
    const result = await launchHermesSession(
      {
        rootDir: root,
        skipDecisionLog: true,
        env: { NINEROUTER_API_KEY: secret, REQUESTY_API_KEY: secret },
      },
      {
        candidates: [c1, c2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async () => ({ ok: true }),
        spawn: async (_cmd, args) => {
          launched.push(args);
          return launched.length === 1
            ? {
                exitCode: 1,
                stderr: 'HTTP 403 insufficient_user_quota: remaining eligible quota $0.000000',
              }
            : { exitCode: 0, stdout: 'continued', stderr: '' };
        },
      }
    );
    assert.equal(result.status, 'completed');
    assert.equal(launched.length, 2);
    const sessionArgs = launched.map((args) => args[args.indexOf('--continue') + 1]);
    assert.equal(sessionArgs[0], sessionArgs[1]);
    assert.ok(launched[1].includes('rq/second'));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-33: HERMES_HOME is passed in spawn env, HERMES_IGNORE_USER_CONFIG is removed, and config is written to HERMES_HOME', async () => {
  const root = fixtureRoot('hermes-home-env-');
  try {
    const candidate = sampleCandidate();
    let capturedOptions = null;
    const fakeSpawn = async (cmd, args, options) => {
      capturedOptions = options;
      return { exitCode: 0, status: 0, stdout: '', stderr: '' };
    };

    const res = await launchHermesSession(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        env: { HERMES_IGNORE_USER_CONFIG: '1' },
        spawn: fakeSpawn,
        probe: async () => ({ ok: true }),
      }
    );

    assert.equal(res.status, 'completed');
    const expectedHome = path.join(root, 'tools', 'ai-brain', 'data', 'hermes', 'home');
    assert.equal(
      capturedOptions.env.HERMES_HOME,
      expectedHome,
      'HERMES_HOME must point to tools/ai-brain/data/hermes/home'
    );
    assert.equal(
      capturedOptions.env.HERMES_IGNORE_USER_CONFIG,
      undefined,
      'HERMES_IGNORE_USER_CONFIG must be unset so Hermes loads config.yaml'
    );
    assert.ok(
      fs.existsSync(path.join(expectedHome, 'config.yaml')),
      'config.yaml must exist under HERMES_HOME'
    );
    const yaml = fs.readFileSync(path.join(expectedHome, 'config.yaml'), 'utf8');
    assert.ok(yaml.includes('key_env:'), 'config.yaml must use key_env per Fact 2');
    assert.equal(yaml.includes('api_key:'), false, 'Never write secret api_key');
    assert.ok(yaml.includes('model:'), 'config.yaml must include model section');
    assert.ok(yaml.includes('default:'), 'model section must include default model');
    assert.ok(yaml.includes('provider:'), 'model section must include provider');
    const installedSkill = path.join(expectedHome, 'skills', 'shipde-controller', 'SKILL.md');
    assert.ok(fs.existsSync(installedSkill), 'skill file must be installed under HERMES_HOME');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-34: writeProvidersConfig rejects userinfo and embedded secrets in endpoint URL', () => {
  const root = fixtureRoot('hermes-userinfo-');
  try {
    const candidateWithUserinfo = sampleCandidate({
      accessPath: 'http://user:secret123@127.0.0.1:20128/v1',
    });

    assert.throws(
      () => {
        writeProvidersConfig(
          candidateWithUserinfo,
          { rootDir: root },
          { registry: sampleRegistry() }
        );
      },
      (err) => {
        assert.equal(err.code, 'ENDPOINT_USERINFO_FORBIDDEN');
        return true;
      }
    );

    // Verify config file was NOT written
    assert.equal(fs.existsSync(path.join(root, 'data', 'hermes', 'config.yaml')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-35: corrupt session.json fails closed with SESSION_FILE_CORRUPT without minting a new id', async () => {
  const root = fixtureRoot('hermes-corrupt-');
  try {
    const sessionDir = path.join(root, 'data', 'hermes');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, 'session.json'),
      '{ "sessionId": "torn-write...',
      'utf8'
    );

    // 1. loadSession throws SESSION_FILE_CORRUPT
    assert.throws(
      () => {
        loadSession({ rootDir: root });
      },
      (err) => {
        assert.equal(err.code, 'SESSION_FILE_CORRUPT');
        return true;
      }
    );

    // 2. launchHermesSession fails closed rather than minting a new session
    const candidate = sampleCandidate();
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
        assert.equal(err.code, 'SESSION_FILE_CORRUPT');
        return true;
      }
    );

    // 3. saveSession writes atomically via temp file rename
    const saved = saveSession(
      { sessionId: 'valid-sess-42', candidateKey: candidate.candidateKey, goalIds: ['G1'] },
      { rootDir: root }
    );
    assert.equal(saved.sessionId, 'valid-sess-42');
    const loaded = loadSession({ rootDir: root });
    assert.equal(loaded.sessionId, 'valid-sess-42');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H2-36: chatCommand always outputs JSON status to stdout even without --json', async () => {
  const root = fixtureRoot('hermes-chat-json-');
  try {
    const candidate = sampleCandidate();
    const stdoutLines = [];
    const origLog = console.log;
    console.log = (msg) => stdoutLines.push(msg);
    try {
      const res = await chatCommand(
        { rootDir: root, dryRun: true },
        {
          candidates: [candidate],
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
        }
      );
      assert.equal(res.exitCode, 0);
      assert.ok(stdoutLines.length > 0, 'stdout must have JSON output');
      const parsed = JSON.parse(stdoutLines[stdoutLines.length - 1]);
      assert.equal(parsed.status, 'dry_run');
    } finally {
      console.log = origLog;
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-01: Hermes chat passes --continue <id> --create-if-missing on first launch and on relaunch', async () => {
  const root = fixtureRoot('hermes-continue-named-');
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
      calls.push({ cmd, args, options });
      if (calls.length === 1) {
        return {
          exitCode: 1,
          status: 1,
          stderr: 'HTTP 429 Too Many Requests: upstream_rate_limit for model kr/gemini-2.5-pro',
          httpStatus: 429,
        };
      }
      return { exitCode: 0, status: 0, stdout: 'Session continued', stderr: '' };
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
        probe: async () => ({ ok: true }),
      }
    );

    assert.equal(res.status, 'completed');
    assert.equal(calls.length, 2, 'Relaunched after failure');

    // First launch (call 0)
    const cIdx0 = calls[0].args.indexOf('--continue');
    assert.notEqual(cIdx0, -1, 'First launch must include --continue');
    const sessionId0 = calls[0].args[cIdx0 + 1];
    assert.ok(sessionId0, 'Session ID must follow --continue');
    assert.equal(
      calls[0].args[cIdx0 + 2],
      '--create-if-missing',
      'First launch must include --create-if-missing immediately after session ID'
    );

    // Relaunch (call 1)
    const cIdx1 = calls[1].args.indexOf('--continue');
    assert.notEqual(cIdx1, -1, 'Relaunch must include --continue');
    const sessionId1 = calls[1].args[cIdx1 + 1];
    assert.equal(
      sessionId1,
      sessionId0,
      'Relaunch must use the exact same session ID to preserve history'
    );
    assert.equal(
      calls[1].args[cIdx1 + 2],
      '--create-if-missing',
      'Relaunch must include --create-if-missing'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-02: Controller installs skill by name under hermesHome/skills/shipde-controller/SKILL.md, argv passes -s shipde-controller, and config.yaml contains model section', async () => {
  const root = fixtureRoot('hermes-skill-install-');
  try {
    const candidate = sampleCandidate({
      gateway: '9router',
      modelId: 'kr/gemini-2.5-pro',
    });
    const session = { sessionId: 'hermes_skill_test_session' };

    // 1. buildHermesArgv passes -s shipde-controller (the skill name), never a path
    const argv = buildHermesArgv(candidate, session, { rootDir: root });
    const sIndex = argv.indexOf('-s');
    assert.notEqual(sIndex, -1, 'argv must include -s');
    assert.equal(argv[sIndex + 1], 'shipde-controller', 'must pass skill name, never a path');
    assert.equal(
      argv.some(
        (arg) =>
          typeof arg === 'string' &&
          (arg.includes('SKILL.md') || arg.includes('\\skills\\') || arg.includes('/skills/'))
      ),
      false,
      'argv must never contain a path to SKILL.md'
    );

    // 2. writeProvidersConfig installs (copies) skill to <hermesHome>/skills/shipde-controller/SKILL.md
    const cfgRes = writeProvidersConfig(
      candidate,
      { rootDir: root },
      { registry: sampleRegistry() }
    );
    const expectedSkillPath = path.join(
      root,
      'tools',
      'ai-brain',
      'data',
      'hermes',
      'home',
      'skills',
      'shipde-controller',
      'SKILL.md'
    );
    assert.ok(
      fs.existsSync(expectedSkillPath),
      'skill must be written under hermesHome/skills/shipde-controller/SKILL.md'
    );
    const installedText = fs.readFileSync(expectedSkillPath, 'utf8');
    assert.ok(
      installedText.includes('Ship Dễ — Hermes Chat Brain & Controller Operating Contract') ||
        installedText.includes('Ship D')
    );
    assert.ok(installedText.includes('NEVER pick your own model'));

    // 3. config.yaml has model section with default and provider matching providers entry
    const yaml = fs.readFileSync(cfgRes.configPath, 'utf8');
    assert.ok(yaml.includes('model:'), 'config.yaml must have model: section');
    assert.ok(yaml.includes('default: "kr/gemini-2.5-pro"'), 'model: has default modelId');
    assert.ok(yaml.includes('provider: "9router"'), 'model: has provider matching providers entry');

    // Overwrite test: simulate an out-of-sync skill in hermes home and verify it is overwritten
    fs.writeFileSync(expectedSkillPath, 'OUTDATED STALE SKILL CONTENT', 'utf8');
    writeProvidersConfig(candidate, { rootDir: root }, { registry: sampleRegistry() });
    const refreshedText = fs.readFileSync(expectedSkillPath, 'utf8');
    assert.equal(
      refreshedText.includes('OUTDATED STALE SKILL CONTENT'),
      false,
      'must overwrite each launch/write'
    );
    assert.ok(
      refreshedText.includes('NEVER pick your own model'),
      'refreshed content restored from repo'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-03: resolveHermesLaunchCommand on win32 resolves to process.execPath with node_modules entry js when hermes.cmd and hermes.js exist in PATH', async () => {
  const root = fixtureRoot('hermes-win-spawn-');
  try {
    const cmdShim = path.join(root, 'hermes.cmd');
    fs.writeFileSync(
      cmdShim,
      '@echo off\r\nnode "%~dp0\\node_modules\\hermes-agent\\bin\\hermes.js" %*\r\n'
    );
    const jsDir = path.join(root, 'node_modules', 'hermes-agent', 'bin');
    fs.mkdirSync(jsDir, { recursive: true });
    const jsEntry = path.join(jsDir, 'hermes.js');
    fs.writeFileSync(jsEntry, '// hermes agent entry');

    const chatArgv = ['chat', '-m', 'kr/gemini-2.5-pro', '--provider', '9router'];
    const resolved = resolveHermesLaunchCommand(chatArgv, {
      platform: 'win32',
      env: { PATH: root },
    });

    assert.equal(
      resolved.command,
      process.execPath,
      'command must be process.execPath on win32 npm shim'
    );
    assert.equal(resolved.args[0], jsEntry, 'args[0] must be the npm entry hermes.js');
    assert.deepEqual(resolved.args.slice(1), chatArgv, 'remaining args must be the chat argv');

    // Also verify aliases export
    const alias1 = resolveHermesLaunch(chatArgv, { platform: 'win32', env: { PATH: root } });
    const alias2 = resolveHermesCommand(chatArgv, { platform: 'win32', env: { PATH: root } });
    assert.deepEqual(alias1, resolved);
    assert.deepEqual(alias2, resolved);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-04: resolveHermesLaunchCommand HERMES_BIN override wins over PATH discovery and win32 shim', async () => {
  const root = fixtureRoot('hermes-override-');
  try {
    // Setup win32 shim in PATH that would match if override didn't win
    fs.writeFileSync(path.join(root, 'hermes.cmd'), '@echo off\r\n');
    const jsDir = path.join(root, 'node_modules', 'hermes-agent', 'bin');
    fs.mkdirSync(jsDir, { recursive: true });
    fs.writeFileSync(path.join(jsDir, 'hermes.js'), '// shim js');

    const chatArgv = ['chat', '-m', 'kr/gemini-2.5-pro'];

    // 1. HERMES_BIN ending in .js launches via process.execPath
    const customJs = path.join(root, 'my-hermes.js');
    fs.writeFileSync(customJs, '// custom');
    const resJs = resolveHermesLaunchCommand(chatArgv, {
      platform: 'win32',
      env: { PATH: root, HERMES_BIN: customJs },
    });
    assert.equal(resJs.command, process.execPath);
    assert.equal(resJs.args[0], customJs);
    assert.deepEqual(resJs.args.slice(1), chatArgv);

    // 2. HERMES_BIN not ending in .js launches as binary directly
    const customBin = 'C:\\custom\\hermes.exe';
    const resBin = resolveHermesLaunchCommand(chatArgv, {
      platform: 'win32',
      env: { PATH: root, HERMES_BIN: customBin },
    });
    assert.equal(resBin.command, customBin);
    assert.deepEqual(resBin.args, chatArgv);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-05: resolveHermesLaunchCommand falls back to hermes when no shim or override exists', async () => {
  const root = fixtureRoot('hermes-fallback-');
  try {
    const chatArgv = ['chat', '-m', 'kr/gemini-2.5-pro'];

    // 1. win32 but directory has no hermes.cmd
    const resNoShim = resolveHermesLaunchCommand(chatArgv, {
      platform: 'win32',
      env: { PATH: root },
    });
    assert.equal(resNoShim.command, 'hermes');
    assert.deepEqual(resNoShim.args, chatArgv);

    // 2. win32 has hermes.cmd but node_modules/hermes-agent/bin/hermes.js is missing
    fs.writeFileSync(path.join(root, 'hermes.cmd'), '@echo off\r\n');
    const resMissingJs = resolveHermesLaunchCommand(chatArgv, {
      platform: 'win32',
      env: { PATH: root },
    });
    assert.equal(resMissingJs.command, 'hermes');
    assert.deepEqual(resMissingJs.args, chatArgv);

    // 3. non-win32 platform without HERMES_BIN
    const resLinux = resolveHermesLaunchCommand(chatArgv, {
      platform: 'linux',
      env: { PATH: root },
    });
    assert.equal(resLinux.command, 'hermes');
    assert.deepEqual(resLinux.args, chatArgv);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-06: launchHermesSession uses resolved command and args in spawn and reports command in dryRun output', async () => {
  const root = fixtureRoot('hermes-launch-spawn-win-');
  try {
    const candidate = sampleCandidate();
    const cmdShim = path.join(root, 'hermes.cmd');
    fs.writeFileSync(cmdShim, '@echo off\r\n');
    const jsDir = path.join(root, 'node_modules', 'hermes-agent', 'bin');
    fs.mkdirSync(jsDir, { recursive: true });
    const jsEntry = path.join(jsDir, 'hermes.js');
    fs.writeFileSync(jsEntry, '// hermes agent entry');

    // 1. dryRun output reports resolved command
    const dryRes = await launchHermesSession(
      { rootDir: root, dryRun: true, skipDecisionLog: true },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        platform: 'win32',
        env: { PATH: root, HERMES_BIN: '' },
      }
    );
    assert.equal(dryRes.status, 'dry_run');
    assert.equal(dryRes.command, process.execPath);
    assert.equal(dryRes.args[0], jsEntry);
    assert.ok(dryRes.argv.includes('--continue'));

    // 2. spawn is called with resolved command and args
    let spawnCaptured = null;
    const fakeSpawn = async (cmd, args, options) => {
      spawnCaptured = { cmd, args, options };
      return { exitCode: 0, stdout: 'started', stderr: '' };
    };

    const runRes = await launchHermesSession(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        platform: 'win32',
        env: { PATH: root, HERMES_BIN: '' },
        spawn: fakeSpawn,
        probe: async () => ({ ok: true }),
      }
    );
    assert.equal(runRes.status, 'completed');
    assert.ok(spawnCaptured, 'spawn was called');
    assert.equal(spawnCaptured.cmd, process.execPath);
    assert.equal(spawnCaptured.args[0], jsEntry);
    assert.ok(spawnCaptured.args.includes('--continue'));
    assert.equal(runRes.command, process.execPath);
    assert.equal(runRes.args[0], jsEntry);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3-07: launchHermesSession and chatCommand accept injected resolver input and resolveHermesCommand option', async () => {
  const root = fixtureRoot('hermes-injected-resolver-');
  try {
    const candidate = sampleCandidate();

    // 1. Injected resolver function in deps
    const customResolver = (argv) => ({
      command: 'custom-hermes-runner',
      args: ['--custom-flag', ...argv],
    });
    const dryResFn = await launchHermesSession(
      { rootDir: root, dryRun: true, skipDecisionLog: true },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        resolveHermesCommand: customResolver,
      }
    );
    assert.equal(dryResFn.command, 'custom-hermes-runner');
    assert.equal(dryResFn.args[0], '--custom-flag');

    // 2. Injected resolver object in options
    const dryResObj = await launchHermesSession(
      {
        rootDir: root,
        dryRun: true,
        skipDecisionLog: true,
        resolveHermesCommand: { command: 'object-bin', args: ['--obj-flag'] },
      },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );
    assert.equal(dryResObj.command, 'object-bin');
    assert.deepEqual(dryResObj.args, ['--obj-flag']);

    // 3. chatCommand forwards resolveHermesCommand option
    const chatRes = await chatCommand(
      {
        rootDir: root,
        dryRun: true,
        skipDecisionLog: true,
        resolveHermesCommand: (argv) => ({ command: 'chat-custom-bin', args: argv }),
      },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );
    assert.equal(chatRes.exitCode, 0);
    assert.equal(chatRes.result.command, 'chat-custom-bin');

    // 4. Injected resolver receives injected env, platform, and fs
    let capturedResolverDeps = null;
    await launchHermesSession(
      {
        rootDir: root,
        dryRun: true,
        skipDecisionLog: true,
      },
      {
        candidates: [candidate],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        platform: 'custom-os',
        env: { PATH: '/custom/path', HERMES_BIN: '' },
        resolveHermesCommand: (argv, opts, deps) => {
          capturedResolverDeps = deps;
          return { command: 'hermes', args: argv };
        },
      }
    );
    assert.ok(capturedResolverDeps);
    assert.equal(capturedResolverDeps.platform, 'custom-os');
    assert.equal(capturedResolverDeps.env.PATH, '/custom/path');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Hermes supplies the actual QUALITY_FIRST weights to ranking', () => {
  let observed;
  selectReasoningCandidate(
    { skipDecisionLog: true },
    {
      registry: sampleRegistry(),
      candidates: [],
      priorsData: { ranking: [] },
      rankForProfile: (rows, profile, assessment) => {
        observed = assessment;
        return { ranking: [], rejected: [], chosen: null };
      },
    }
  );
  assert.deepEqual(observed.weights, require('../routing').WEIGHT_PROFILES.QUALITY_FIRST);
  assert.equal(observed.renormalizeKnownScores, true);
});

test('H3 model-first: canonical aliases share a score and live route wins within the top model', () => {
  const root = fixtureRoot();
  try {
    const rows = [
      sampleCandidate({ modelId: 'vendor/top_model:free', quality: 95, evidence: [], cost: 0 }),
      sampleCandidate({
        modelId: 'TOP-MODEL@route',
        gateway: 'rqsty',
        accessPath: 'https://router.requesty.ai/v1',
        quality: 95,
        evidence: [],
        cost: 50,
      }),
      sampleCandidate({ modelId: 'vendor/other', quality: 90, evidence: [], cost: 0 }),
    ];
    const health = require('../route-health');
    const store = { version: 1, paths: {}, events: [] };
    health.recordResult(
      store,
      rows[1].modelId,
      { id: 'rqsty', accountId: rows[1].accountId },
      { ok: true },
      Date.now()
    );
    const result = selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: rows,
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        evidenceData: {},
        accountList: [],
        routeHealth: store,
      }
    );
    assert.deepEqual(
      result.modelRanking.map((r) => [r.modelId, r.score, r.routeCount]),
      [
        ['top-model', 95, 2],
        ['other', 90, 1],
      ]
    );
    assert.equal(result.chosen, rows[1].candidateKey);
    assert.equal(result.chosenRoute.knownGood, true);
    assert.deepEqual(result.decisionRecord.modelRanking, result.modelRanking);
    assert.equal(result.decisionRecord.chosenRoute.candidateKey, result.chosen);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3 model-first probes all routes of the top model before reaching the next distinct model', async () => {
  const root = fixtureRoot();
  try {
    const rows = Array.from({ length: 7 }, (_, i) =>
      sampleCandidate({
        modelId: i % 2 ? 'vendor/TOP_MODEL:free' : 'top-model@route',
        accountId: 'route-' + i,
        quotaScope: 'route-' + i,
        quality: 95,
        evidence: [],
      })
    );
    rows.push(sampleCandidate({ modelId: 'next-model', quality: 90, evidence: [] }));
    const seen = [];
    const result = await launchHermesSession(
      { rootDir: root, dryRun: true, probe: true, skipDecisionLog: true, reselect: true },
      {
        candidates: rows,
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        evidenceData: {},
        accountList: [],
        probe: async (c) => {
          seen.push(c.modelId);
          return c.modelId === 'next-model'
            ? { ok: true, status: 200 }
            : { ok: false, status: 503 };
        },
      }
    );
    assert.equal(seen.length, 8);
    assert.equal(seen[7], 'next-model');
    assert.equal(result.modelRanking.length, 2);
    assert.equal(result.chosenRoute.modelId, 'next-model');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3 model-first fixed maxAttempts does not cut top model routes short before all routes are tried', async () => {
  const root = fixtureRoot();
  try {
    const rows = Array.from({ length: 5 }, (_, i) =>
      sampleCandidate({
        modelId: 'top-model@route',
        accountId: 'route-' + i,
        quotaScope: 'route-' + i,
        quality: 95,
        evidence: [],
      })
    );
    rows.push(sampleCandidate({ modelId: 'next-model', quality: 90, evidence: [] }));
    const seen = [];
    await assert.rejects(
      launchHermesSession(
        { rootDir: root, dryRun: true, probe: true, skipDecisionLog: true, maxAttempts: 2 },
        {
          candidates: rows,
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
          evidenceData: {},
          accountList: [],
          probe: async (c) => {
            seen.push(c.modelId);
            return { ok: false, status: 503 };
          },
        }
      ),
      /NO_REASONING_CANDIDATE/
    );
    // All 5 routes of top-model were probed despite maxAttempts: 2
    assert.equal(seen.length, 6);
    // The operator removed all fixed count limits, including caller maxAttempts.
    assert.ok(seen.includes('next-model'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3 probe skips remaining candidates on an account that already reported exhausted credit', async () => {
  const root = fixtureRoot('hermes-probe-account-exhausted-');
  try {
    const candA1 = sampleCandidate({
      gateway: 'rqsty',
      accessPath: 'https://router.requesty.ai/v1',
      upstream: 'cl',
      modelId: 'cl/model-1',
      quality: 95,
      evidence: [],
    });
    const candA2 = sampleCandidate({
      gateway: 'rqsty',
      accessPath: 'https://router.requesty.ai/v1',
      upstream: 'ocz',
      modelId: 'ocz/model-2',
      quality: 94,
      evidence: [],
    });
    const candA3 = sampleCandidate({
      gateway: 'rqsty',
      accessPath: 'https://router.requesty.ai/v1',
      upstream: 'kr',
      modelId: 'kr/model-3',
      quality: 93,
      evidence: [],
    });
    const candB = sampleCandidate({
      gateway: '9router',
      accessPath: 'http://127.0.0.1:20128/v1',
      upstream: 'other',
      modelId: 'other/model-4',
      quality: 90,
      evidence: [],
    });
    const probed = [];
    const result = await launchHermesSession(
      { rootDir: root, dryRun: true, probe: true, skipDecisionLog: true, reselect: true },
      {
        candidates: [candA1, candA2, candA3, candB],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        evidenceData: {},
        accountList: [],
        probe: async (c) => {
          probed.push(c.candidateKey);
          if (c.candidateKey === candA1.candidateKey) {
            return { ok: false, status: 402, body: 'upstream_credit_exhausted' };
          }
          return { ok: true, status: 200, body: '{}' };
        },
      }
    );
    assert.equal(probed.length, 2);
    assert.equal(probed[0], candA1.candidateKey);
    assert.equal(probed[1], candB.candidateKey);
    assert.equal(result.chosenRoute.candidateKey, candB.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: getCandidateProviderKey and isProviderLevelFailure classify account/provider failures', () => {
  assert.equal(
    getCandidateProviderKey({ gateway: '9router', modelId: 'cl/openai/gpt-6-astra' }),
    '9router::cl'
  );
  assert.equal(
    getCandidateProviderKey({ gateway: '9router', modelId: 'ocz/gpt-6-astra' }),
    '9router::ocz'
  );
  assert.equal(
    getCandidateProviderKey({ gateway: '9router', modelId: 'ocg/qwen3.8-max' }),
    '9router::ocg'
  );
  assert.equal(
    getCandidateProviderKey({ gateway: '9router', modelId: 'ag/claude-opus-5-5' }),
    '9router::ag'
  );
  assert.equal(
    getCandidateProviderKey({ gateway: '9router', modelId: 'cc/claude-opus-5-5' }),
    '9router::cc'
  );
  assert.equal(
    getCandidateProviderKey({ gateway: 'thb', upstream: 'thb', modelId: 'claude-sonnet-5.5' }),
    'thb::thb'
  );

  assert.equal(isProviderLevelFailure('upstream_credit_exhausted'), true);
  assert.equal(isProviderLevelFailure('quota_exhausted'), true);
  assert.equal(isProviderLevelFailure('account_auth_failed'), true);
  assert.equal(isProviderLevelFailure('upstream_entitlement'), true);
  assert.equal(isProviderLevelFailure('account_quota_exhausted'), true);
  assert.equal(isProviderLevelFailure('timeout'), false);
  assert.equal(isProviderLevelFailure('alias_mismatch'), false);
  assert.equal(isProviderLevelFailure('model_unsupported'), false);
});

test('TASK-AI-142: route probe skipping: upstream provider credit/quota failure skips sibling and subsequent candidates on same gateway+upstream', async () => {
  const root = fixtureRoot('hermes-dead-provider-');
  try {
    const c1 = sampleCandidate({
      gateway: '9router',
      upstream: 'cl',
      modelId: 'cl/openai/gpt-6-astra',
      evidence: [],
      quality: 95,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
    });
    const c2 = sampleCandidate({
      gateway: '9router',
      upstream: 'cl',
      modelId: 'cl/meta/muse-spark-1.3',
      evidence: [],
      quality: 94,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
    });
    const c3 = sampleCandidate({
      gateway: '9router',
      upstream: 'ocz',
      modelId: 'ocz/gpt-6-astra',
      evidence: [],
      quality: 93,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
    });
    const c4 = sampleCandidate({
      gateway: '9router',
      upstream: 'cbai',
      modelId: 'cbai/deepseek-v4.1-flash',
      evidence: [],
      quality: 92,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
    });

    const probed = [];
    const recordedDecisions = [];
    const res = await launchHermesSession(
      { rootDir: root, dryRun: true, probe: true },
      {
        candidates: [c1, c2, c3, c4],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        decisions: {
          Stage: { SELECTED: 'SELECTED', REFUSED: 'REFUSED' },
          recordDecision(record) {
            recordedDecisions.push(record);
          },
        },
        probe: async (candidate) => {
          probed.push(candidate.modelId);
          if (candidate.modelId === 'cl/openai/gpt-6-astra') {
            return { ok: false, status: 503, body: 'upstream_credit_exhausted' };
          }
          if (candidate.modelId === 'ocz/gpt-6-astra') {
            return { ok: false, status: 503, body: 'quota_exhausted' };
          }
          if (candidate.modelId === 'cbai/deepseek-v4.1-flash') {
            return { ok: true, status: 200, body: '{}' };
          }
          return { ok: false, status: 500 };
        },
      }
    );

    // c1 was probed and failed
    assert.ok(probed.includes('cl/openai/gpt-6-astra'));
    // c2 shares 9router::cl and must be SKIPPED without probing
    assert.ok(!probed.includes('cl/meta/muse-spark-1.3'), 'c2 must not be probed');
    // c3 was probed and failed
    assert.ok(probed.includes('ocz/gpt-6-astra'));
    // c4 on 9router::cbai was probed and succeeded
    assert.ok(probed.includes('cbai/deepseek-v4.1-flash'));
    assert.equal(res.candidateKey, c4.candidateKey);

    // Refusal for c2 was recorded with explicit dead provider reason
    const c2Refusal = recordedDecisions.find(
      (d) =>
        d.stage === decisions.Stage.REFUSED &&
        Array.isArray(d.rejected) &&
        d.rejected.some((r) => r.candidateKey === c2.candidateKey)
    );
    assert.ok(c2Refusal, 'c2 refusal must be recorded in decisions');
    assert.match(
      c2Refusal.detail,
      /HERMES_ROUTE_PROBE_SKIPPED provider 9router::cl failed with upstream_credit_exhausted/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: top model gpt-6-astra logs explicit reason per skipped route in decision records and decisionRecord.rejected', async () => {
  const root = fixtureRoot('hermes-top-model-astra-');
  try {
    // 8 routes for gpt-6-astra:
    // 2 viable routes
    const cViable1 = sampleCandidate({
      gateway: '9router',
      upstream: 'cl',
      modelId: 'cl/openai/gpt-6-astra',
      evidence: [],
      quality: 95,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
    });
    const cViable2 = sampleCandidate({
      gateway: '9router',
      upstream: 'ocz',
      modelId: 'ocz/gpt-6-astra',
      evidence: [],
      quality: 94,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
    });
    // 1 route with cooldown
    const cCooldown = sampleCandidate({
      gateway: '9router',
      upstream: 'requesty',
      modelId: 'requesty/gpt-6-astra',
      evidence: [],
      quality: 93,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
    });
    // 5 routes with unverified/missing context
    const cUnverified = [
      'azure/gpt-6-astra@eastus2',
      'openai/gpt-6-astra',
      'thb/cl/openai/gpt-6-astra',
      'thb/ocz/gpt-6-astra',
      'thb/requesty/gpt-6-astra',
    ].map((modelId, idx) =>
      sampleCandidate({
        gateway: 'rqsty',
        upstream: 'rqsty',
        modelId,
        evidence: [],
        quality: 90 - idx,
        contextWindow: undefined,
        context_window: undefined,
        capabilities: undefined,
      })
    );
    // Next model with viable route
    const cNext = sampleCandidate({
      gateway: '9router',
      upstream: 'cbai',
      modelId: 'cbai/deepseek-v4.1-flash',
      evidence: [],
      quality: 85,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
    });

    const routeHealthStore = {
      version: 1,
      paths: {
        'requesty/gpt-6-astra|9router': {
          modelId: 'requesty/gpt-6-astra',
          routeId: '9router',
          status: 'UNAVAILABLE_NOW',
          probeCause: 'PROVIDER_UNAVAILABLE',
          nextCheckAt: new Date(Date.now() + 3600000).toISOString(),
        },
      },
      events: [],
    };

    const sel = selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [cViable1, cViable2, cCooldown, ...cUnverified, cNext],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        routeHealth: routeHealthStore,
      }
    );

    assert.equal(sel.modelRanking[0].modelId, 'gpt-6-astra');
    assert.equal(sel.modelRanking[0].routeCount, 2);
    // Top model skipped routes are prioritized at the top of rejected
    assert.ok(sel.skippedRoutes.length >= 6);
    assert.ok(
      sel.skippedRoutes.some(
        (r) => r.candidateKey === cCooldown.candidateKey && r.reason.includes('PROBE_COOLDOWN')
      )
    );
    for (const unv of cUnverified) {
      assert.ok(
        sel.skippedRoutes.some(
          (r) =>
            r.candidateKey === unv.candidateKey && r.reason.includes('CONTEXT_WINDOW_UNVERIFIED')
        )
      );
    }

    // Now test that launchHermesSession logs explicit refusal decisions for each skipped route
    const recordedDecisions = [];
    const probed = [];
    const launchRes = await launchHermesSession(
      { rootDir: root, dryRun: true, probe: true },
      {
        candidates: [cViable1, cViable2, cCooldown, ...cUnverified, cNext],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        routeHealth: routeHealthStore,
        decisions: {
          Stage: { SELECTED: 'SELECTED', REFUSED: 'REFUSED' },
          recordDecision(record) {
            recordedDecisions.push(record);
          },
        },
        probe: async (candidate) => {
          probed.push(candidate.modelId);
          if (candidate.modelId.includes('gpt-6-astra')) {
            return { ok: false, status: 503, body: 'upstream_credit_exhausted' };
          }
          return { ok: true, status: 200, body: '{}' };
        },
      }
    );

    // Only the 2 viable routes of gpt-6-astra were probed
    assert.equal(probed.filter((m) => m.includes('gpt-6-astra')).length, 2);
    // Next model was chosen
    assert.equal(launchRes.candidateKey, cNext.candidateKey);

    // Verify decision records have refusal entries for the skipped routes of gpt-6-astra
    const refusedKeys = new Set(
      recordedDecisions
        .filter((d) => d.stage === decisions.Stage.REFUSED && Array.isArray(d.rejected))
        .flatMap((d) => d.rejected.map((r) => r.candidateKey))
    );
    assert.ok(refusedKeys.has(cCooldown.candidateKey), 'Cooldown route must have refusal record');
    for (const unv of cUnverified) {
      assert.ok(
        refusedKeys.has(unv.candidateKey),
        `Unverified route ${unv.modelId} must have refusal record`
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: time-based probe budget allows probing past 30 probes without a fixed count limit; skipped provider candidates cost nothing', async () => {
  const root = fixtureRoot('hermes-time-budget-');
  try {
    // 26 candidates: 15 on cl, 10 on ocz, 1 on cbai (live)
    const candidates = [];
    for (let i = 0; i < 15; i++) {
      candidates.push(
        sampleCandidate({
          gateway: '9router',
          upstream: 'cl',
          modelId: `cl/model-${i}`,
          evidence: [],
          quality: 90 - i,
          contextWindow: 128000,
          capabilities: { contextWindow: 128000 },
        })
      );
    }
    for (let i = 0; i < 10; i++) {
      candidates.push(
        sampleCandidate({
          gateway: '9router',
          upstream: 'ocz',
          modelId: `ocz/model-${i}`,
          evidence: [],
          quality: 70 - i,
          contextWindow: 128000,
          capabilities: { contextWindow: 128000 },
        })
      );
    }
    const liveCandidate = sampleCandidate({
      gateway: '9router',
      upstream: 'cbai',
      modelId: 'cbai/deepseek-v4.1-flash',
      evidence: [],
      quality: 50,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
    });
    candidates.push(liveCandidate);

    const probed = [];
    const res = await launchHermesSession(
      { rootDir: root, dryRun: true, probe: true, skipDecisionLog: true, qualityFloor: 0 },
      {
        candidates,
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (candidate) => {
          probed.push(candidate.modelId);
          if (candidate.modelId.startsWith('cl/')) {
            return { ok: false, status: 503, body: 'upstream_credit_exhausted' };
          }
          if (candidate.modelId.startsWith('ocz/')) {
            return { ok: false, status: 503, body: 'account_auth_failed' };
          }
          if (candidate.modelId.startsWith('cbai/')) {
            return { ok: true, status: 200, body: '{}' };
          }
          return { ok: false, status: 500 };
        },
      }
    );

    // Only 3 probes actually performed (1 for cl, 1 for ocz, 1 for cbai)!
    assert.equal(probed.length, 3);
    assert.deepEqual(probed, ['cl/model-0', 'ocz/model-0', 'cbai/deepseek-v4.1-flash']);
    assert.equal(res.candidateKey, liveCandidate.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: eight accounts overlap, serialize their routes, and choose rank over completion time', async () => {
  const root = fixtureRoot('hermes-concurrent-');
  try {
    const candidates = Array.from({ length: 10 }, (_, index) =>
      sampleCandidate({
        upstream: `provider-${index}`,
        modelId: `provider-${index}/model`,
        quality: 99 - index,
        evidence: [],
      })
    );
    const active = new Set();
    let peak = 0;
    const finished = [];
    const result = await launchHermesSession(
      { rootDir: root, dryRun: true, probe: true, skipDecisionLog: true },
      {
        candidates,
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (candidate) => {
          assert.ok(!active.has(candidate.upstream));
          active.add(candidate.upstream);
          peak = Math.max(peak, active.size);
          await new Promise((resolve) =>
            setTimeout(resolve, candidate.candidateKey === candidates[0].candidateKey ? 40 : 5)
          );
          active.delete(candidate.upstream);
          finished.push(candidate.candidateKey);
          return { ok: true, status: 200 };
        },
      }
    );
    assert.equal(peak, 8);
    assert.notEqual(finished[0], candidates[0].candidateKey);
    assert.equal(result.candidateKey, candidates[0].candidateKey);
    assert.equal(active.size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: a live route beyond one hundred failed probes ignores legacy maxAttempts', async () => {
  const root = fixtureRoot('hermes-no-count-cap-');
  try {
    const candidates = Array.from({ length: 105 }, (_, index) =>
      sampleCandidate({
        modelId: `kr/model-${String(index).padStart(3, '0')}`,
        quality: 99,
        evidence: [],
      })
    );
    let probes = 0;
    let active = 0;
    const result = await launchHermesSession(
      { rootDir: root, dryRun: true, probe: true, skipDecisionLog: true, maxAttempts: 1 },
      {
        candidates,
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (candidate) => {
          assert.equal(active, 0);
          active += 1;
          probes += 1;
          await Promise.resolve();
          active -= 1;
          return { ok: candidate.candidateKey === candidates[104].candidateKey, status: 503 };
        },
      }
    );
    assert.equal(probes, 105);
    assert.equal(result.candidateKey, candidates[104].candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: wall-clock deadline aborts concurrent probes and never launches', async () => {
  const root = fixtureRoot('hermes-wall-clock-');
  try {
    const candidates = Array.from({ length: 20 }, (_, index) =>
      sampleCandidate({
        upstream: `provider-${index}`,
        modelId: `provider-${index}/model`,
        quality: 99,
        evidence: [],
      })
    );
    const signals = [];
    let active = 0;
    let peak = 0;
    await assert.rejects(
      launchHermesSession(
        { rootDir: root, skipDecisionLog: true, probeBudgetMs: 200 },
        {
          candidates,
          registry: sampleRegistry(),
          priorsData: { ranking: [] },
          probe: (_candidate, _key, _env, options) => {
            signals.push(options.signal);
            active += 1;
            peak = Math.max(peak, active);
            options.signal.addEventListener(
              'abort',
              () => {
                active -= 1;
              },
              { once: true }
            );
            return new Promise(() => {});
          },
          spawn: () => assert.fail('failed or timed-out probes must never launch'),
        }
      ),
      /NO_REASONING_CANDIDATE/
    );
    assert.ok(signals.length > 0);
    assert.ok(peak <= 8);
    assert.equal(active, 0);
    assert.ok(signals.every((signal) => signal.aborted));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: deadline preserves a completed live success while higher routes time out', async () => {
  const root = fixtureRoot('hermes-deadline-success-');
  try {
    const candidates = [
      sampleCandidate({ modelId: 'kr/top', quality: 99, evidence: [] }),
      sampleCandidate({ modelId: 'kr/second', quality: 98, evidence: [] }),
      sampleCandidate({ upstream: 'live', modelId: 'live/third', quality: 97, evidence: [] }),
    ];
    const result = await launchHermesSession(
      { rootDir: root, dryRun: true, probe: true, skipDecisionLog: true, probeBudgetMs: 200 },
      {
        candidates,
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: (candidate) =>
          candidate.upstream === 'live'
            ? Promise.resolve({ ok: true, status: 200 })
            : new Promise(() => {}),
      }
    );
    assert.equal(result.candidateKey, candidates[2].candidateKey);
    const healthFile = path.join(root, 'tools', 'ai-brain', 'data', 'model-route-health.json');
    const store = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    const paths = Object.values(store.paths);
    assert.ok(paths.length > 0, 'live success must be recorded in store.paths');
    assert.ok(paths.every((route) => route.status === 'AVAILABLE'));
    assert.ok(paths.some((route) => route.candidateKey === candidates[2].candidateKey));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: openai-codex candidate skips HTTP preflight without mock probe and does not fabricate route health', async () => {
  const root = fixtureRoot('hermes-codex-skip-');
  try {
    const codexCand = sampleCandidate({
      harness: 'hermes',
      accessPath: 'openai-codex',
      gateway: 'openai-codex',
      provider: 'openai-codex',
      sourceId: 'openai-codex',
      source: 'openai-codex',
      upstream: 'openai',
      accountId: 'codex',
      quotaScope: 'codex-chatgpt',
      modelId: 'gpt-6.1-sol',
      quality: 95,
      contextWindow: 128000,
      capabilities: { contextWindow: 128000 },
      candidateKey: 'hermes::openai-codex::openai-codex::openai::codex::codex-chatgpt::gpt-6.1-sol',
    });

    const spawned = [];
    const healthFile = path.join(root, 'tools', 'ai-brain', 'data', 'model-route-health.json');
    const result = await launchHermesSession(
      { rootDir: root, probe: true, skipDecisionLog: true, qualityFloor: 0 },
      {
        candidates: [codexCand],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        routeHealthFile: healthFile,
        spawn: async (_cmd, args) => {
          spawned.push(args);
          return { exitCode: 0 };
        },
      }
    );

    assert.equal(result.candidateKey, codexCand.candidateKey);
    assert.equal(spawned.length, 1);
    assert.ok(spawned[0].includes('openai-codex'));
    if (fs.existsSync(healthFile)) {
      const store = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
      const paths = Object.values(store.paths || {});
      assert.ok(!paths.some((p) => p.candidateKey === codexCand.candidateKey));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: unprobed routes remain eligible upon runtime failure and runtime reselection keeps named session', async () => {
  const root = fixtureRoot('hermes-runtime-reselect-');
  try {
    const cand1 = sampleCandidate({
      upstream: 'provider-1',
      modelId: 'provider-1/model-top',
      quality: 95,
      evidence: [],
    });
    cand1._preRewriteKey = 'legacy::provider-1::pre-cand1';

    const cand2 = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'provider-2',
      accessPath: 'https://router.requesty.ai/v1',
      endpoint: 'https://router.requesty.ai/v1',
      modelId: 'provider-2/model-second',
      quality: 85,
      evidence: [],
    });
    cand2._preRewriteKey = 'legacy::provider-2::pre-cand2';

    let spawnAttempts = 0;
    const probed = [];
    const launched = [];
    const sessions = [];

    const result = await launchHermesSession(
      { rootDir: root, probe: true, skipDecisionLog: true, qualityFloor: 0 },
      {
        candidates: [cand1, cand2],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (c) => {
          probed.push(c.candidateKey);
          return { ok: true, status: 200 };
        },
        spawn: async (_cmd, args) => {
          spawnAttempts += 1;
          const sessionIdx = args.indexOf('--continue');
          const sid = sessionIdx >= 0 ? args[sessionIdx + 1] : null;
          sessions.push(sid);
          if (spawnAttempts === 1) {
            launched.push(cand1.candidateKey);
            return {
              exitCode: 1,
              stderr: 'HTTP 429 rate limit exceeded',
              status: 1,
            };
          }
          launched.push(cand2.candidateKey);
          return { exitCode: 0, status: 0 };
        },
      }
    );

    assert.equal(spawnAttempts, 2);
    assert.equal(launched[0], cand1.candidateKey);
    assert.equal(launched[1], cand2.candidateKey);
    assert.ok(sessions[0], 'Session ID must exist');
    assert.equal(sessions[0], sessions[1], 'Runtime reselection must keep the named session');
    assert.equal(result.candidateKey, cand2.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: non-route probe failure does not abort winner selection when a higher-ranked probe succeeds', async () => {
  const root = fixtureRoot('hermes-non-route-race-');
  try {
    const candHigh = sampleCandidate({
      upstream: 'prov-high',
      modelId: 'prov-high/top-model',
      quality: 95,
      evidence: [],
    });
    const candLow = sampleCandidate({
      upstream: 'prov-low',
      modelId: 'prov-low/lower-model',
      quality: 80,
      evidence: [],
    });

    const result = await launchHermesSession(
      { rootDir: root, probe: true, skipDecisionLog: true, qualityFloor: 0 },
      {
        candidates: [candHigh, candLow],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (c) => {
          if (c.candidateKey === candLow.candidateKey) {
            return { ok: false, status: 400, body: 'Bad Request' };
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { ok: true, status: 200 };
        },
        spawn: async () => ({ exitCode: 0 }),
      }
    );

    assert.equal(result.candidateKey, candHigh.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: 503 with upstream_credential or upstream_monthly_limit suppresses sibling gateway+upstream routes', async () => {
  const root = fixtureRoot('hermes-prov-causes-');
  try {
    const cand1 = sampleCandidate({
      gateway: '9router',
      upstream: 'provider-x',
      modelId: 'provider-x/model-1',
      quality: 95,
      evidence: [],
    });
    const cand2 = sampleCandidate({
      gateway: '9router',
      upstream: 'provider-x',
      modelId: 'provider-x/model-2',
      quality: 90,
      evidence: [],
    });
    const cand3 = sampleCandidate({
      gateway: '9router',
      upstream: 'provider-y',
      modelId: 'provider-y/model-3',
      quality: 80,
      evidence: [],
    });

    const probed = [];
    const result = await launchHermesSession(
      { rootDir: root, probe: true, skipDecisionLog: true, qualityFloor: 0 },
      {
        candidates: [cand1, cand2, cand3],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (c) => {
          probed.push(c.modelId);
          if (c.modelId === 'provider-x/model-1') {
            return { ok: false, status: 503, body: 'failed with upstream_credential error' };
          }
          return { ok: true, status: 200 };
        },
        spawn: async () => ({ exitCode: 0 }),
      }
    );

    // cand2 on provider-x was skipped due to provider-level suppression!
    assert.ok(!probed.includes('provider-x/model-2'), 'Sibling candidate must be suppressed');
    assert.equal(result.candidateKey, cand3.candidateKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: exhausted account on 9router (base http://127.0.0.1:20128/v1) cools down as a whole', async () => {
  const root = fixtureRoot('hermes-account-cooldown-9router-');
  try {
    const c1 = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'kr/claude-3.5-sonnet',
      quality: 95,
    });
    const c2 = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      accountId: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'kr/gemini-2.5-pro',
      quality: 90,
    });
    const c3 = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      accountId: 'acc-2',
      quotaScope: 'acc-2',
      modelId: 'kr/gpt-4o',
      quality: 85,
    });

    const probed = [];
    const healthFile = path.join(root, 'tools', 'ai-brain', 'data', 'model-route-health.json');
    const res = await launchHermesSession(
      { rootDir: root, skipDecisionLog: true, maxAttempts: 10 },
      {
        candidates: [c1, c2, c3],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (c) => {
          probed.push(c.modelId);
          if (c.modelId === 'kr/claude-3.5-sonnet') {
            return { ok: false, status: 402, body: 'upstream_credit_exhausted' };
          }
          return { ok: true, status: 200, body: '{}' };
        },
        spawn: async () => ({ exitCode: 0 }),
      }
    );

    // c1 was probed and failed; c2 shares account 9router::kr::acc-1 and must be filtered before probing;
    // c3 on account 9router::kr::acc-2 must be selected and probed
    assert.deepEqual(probed, ['kr/claude-3.5-sonnet', 'kr/gpt-4o']);
    assert.equal(res.candidateKey, c3.candidateKey);

    // Health file must record the account-level cooldown
    const store = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    assert.ok(store.accounts && store.accounts['9router::kr::acc-1']);
    const accRecord = store.accounts['9router::kr::acc-1'];
    assert.equal(accRecord.account, '9router::kr::acc-1');
    assert.equal(accRecord.probeCause, 'upstream_credit_exhausted');
    assert.ok(Date.parse(accRecord.nextCheckAt) > Date.now());

    // Subsequent selection must reject both c1 and c2 with PROBE_COOLDOWN_ACCOUNT
    const selection = selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [c1, c2, c3],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );
    assert.equal(selection.chosen, c3.candidateKey);
    const c2Rejection = selection.rejected.find((r) => r.candidateKey === c2.candidateKey);
    assert.ok(c2Rejection, 'c2 must be in rejected list');
    assert.match(
      c2Rejection.reason,
      /^PROBE_COOLDOWN_ACCOUNT: 9router::kr::acc-1 until \d{4}-\d{2}-\d{2}T/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: exhausted account on non-9router gateway cools down as a whole (fields 2..3)', async () => {
  const root = fixtureRoot('hermes-account-cooldown-non9router-');
  try {
    const c1 = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'rq',
      accountId: 'account-alpha',
      modelId: 'rq/claude-3.5-sonnet',
      accessPath: 'https://router.requesty.ai/v1',
      quality: 95,
    });
    const c2 = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'rq',
      accountId: 'account-beta',
      modelId: 'rq/gpt-4o',
      accessPath: 'https://router.requesty.ai/v1',
      quality: 90,
    });
    const c3 = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'other-upstream',
      accountId: 'account-gamma',
      modelId: 'other/gemini',
      accessPath: 'https://router.requesty.ai/v1',
      quality: 85,
    });

    const probed = [];
    const healthFile = path.join(root, 'tools', 'ai-brain', 'data', 'model-route-health.json');
    const res = await launchHermesSession(
      { rootDir: root, skipDecisionLog: true, maxAttempts: 10 },
      {
        candidates: [c1, c2, c3],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
        probe: async (c) => {
          probed.push(c.modelId);
          if (c.modelId === 'rq/claude-3.5-sonnet') {
            return {
              ok: false,
              status: 429,
              body: 'quota_exhausted: Daily free quota limit reached',
            };
          }
          return { ok: true, status: 200, body: '{}' };
        },
        spawn: async () => ({ exitCode: 0 }),
      }
    );

    // c1 was probed and failed; c2 shares account rqsty::rq and must be filtered before probing
    assert.deepEqual(probed, ['rq/claude-3.5-sonnet', 'other/gemini']);
    assert.equal(res.candidateKey, c3.candidateKey);

    const store = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    assert.ok(store.accounts && store.accounts['rqsty::rq']);
    assert.equal(store.accounts['rqsty::rq'].probeCause, 'quota_exhausted');

    const selection = selectReasoningCandidate(
      { rootDir: root, skipDecisionLog: true },
      {
        candidates: [c1, c2, c3],
        registry: sampleRegistry(),
        priorsData: { ranking: [] },
      }
    );
    const c2Rejection = selection.rejected.find((r) => r.candidateKey === c2.candidateKey);
    assert.ok(c2Rejection, 'c2 must be rejected by account cooldown');
    assert.match(c2Rejection.reason, /^PROBE_COOLDOWN_ACCOUNT: rqsty::rq until /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: account_auth_failed and upstream_entitlement record account-level cooldown; transient does not', async () => {
  const root = fixtureRoot('hermes-causes-account-cooldown-');
  try {
    const health = require('../route-health');
    const healthFile = path.join(root, 'health.json');
    const now = 1700000000000;

    // 1. account_auth_failed
    const cAuth = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      accountId: 'acc-auth',
      modelId: 'kr/auth-fail',
    });
    health.rememberProbe(
      cAuth,
      { ok: false, status: 401, body: 'account_auth_failed: invalid api key' },
      { routeHealthFile: healthFile, now }
    );
    const store1 = health.loadStore(healthFile);
    assert.ok(store1.accounts && store1.accounts['9router::kr::acc-auth']);
    assert.equal(store1.accounts['9router::kr::acc-auth'].probeCause, 'account_auth_failed');
    const cooldownAuth = health.probeCooldown(cAuth, {
      routeHealthFile: healthFile,
      now: now + 1000,
    });
    assert.match(cooldownAuth, /^PROBE_COOLDOWN_ACCOUNT: 9router::kr::acc-auth until /);

    // 2. upstream_entitlement
    const cEnt = sampleCandidate({
      gateway: 'rqsty',
      upstream: 'ent-up',
      accountId: 'acc-ent',
      accessPath: 'https://router.requesty.ai/v1',
      modelId: 'ent-up/model',
    });
    health.rememberProbe(
      cEnt,
      { ok: false, status: 403, body: 'upstream_entitlement: subscription required' },
      { routeHealthFile: healthFile, now }
    );
    const store2 = health.loadStore(healthFile);
    assert.ok(store2.accounts && store2.accounts['rqsty::ent-up']);
    assert.equal(store2.accounts['rqsty::ent-up'].probeCause, 'upstream_entitlement');
    const cooldownEnt = health.probeCooldown(cEnt, {
      routeHealthFile: healthFile,
      now: now + 1000,
    });
    assert.match(cooldownEnt, /^PROBE_COOLDOWN_ACCOUNT: rqsty::ent-up until /);

    // 3. Transient error (e.g. 500 service unavailable or timeout) must NOT record an account cooldown
    const cTransient = sampleCandidate({
      gateway: '9router',
      upstream: 'transient-up',
      accountId: 'acc-transient',
      modelId: 'kr/transient-model',
    });
    health.rememberProbe(
      cTransient,
      { ok: false, status: 500, body: 'Internal server error' },
      { routeHealthFile: healthFile, now }
    );
    const store3 = health.loadStore(healthFile);
    assert.equal(
      store3.accounts && store3.accounts['9router::transient-up::acc-transient'],
      undefined
    );
    const cooldownTransient = health.probeCooldown(cTransient, {
      routeHealthFile: healthFile,
      now: now + 1000,
    });
    // Cooldown is route-level only, NOT account-level
    assert.ok(!cooldownTransient || !cooldownTransient.startsWith('PROBE_COOLDOWN_ACCOUNT:'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('TASK-AI-142: account cooldown expires and re-allows candidate', () => {
  const root = fixtureRoot('hermes-account-cooldown-expiry-');
  try {
    const health = require('../route-health');
    const healthFile = path.join(root, 'health.json');
    const now = 1700000000000;
    const expiry = now + 6 * 3600000;

    const c = sampleCandidate({
      gateway: '9router',
      upstream: 'kr',
      accountId: 'acc-exp',
      modelId: 'kr/exp-model',
    });

    health.rememberAccountCooldown(c, 'upstream_credit_exhausted', new Date(expiry).toISOString(), {
      routeHealthFile: healthFile,
      now,
    });

    // Before expiry: cooled down
    const beforeExpiry = health.probeCooldown(c, {
      routeHealthFile: healthFile,
      now: expiry - 1000,
    });
    assert.equal(
      beforeExpiry,
      `PROBE_COOLDOWN_ACCOUNT: 9router::kr::acc-exp until ${new Date(expiry).toISOString()}`
    );

    // At or after expiry: no longer cooled down
    const atExpiry = health.probeCooldown(c, { routeHealthFile: healthFile, now: expiry });
    assert.equal(atExpiry, null);

    const afterExpiry = health.probeCooldown(c, {
      routeHealthFile: healthFile,
      now: expiry + 1000,
    });
    assert.equal(afterExpiry, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Hermes exit "No Codex credentials stored" is an account auth failure, so the brain is reselected', () => {
  const classifier = require('../failure-classifier');
  const c = classifier.classifyFailure({
    exitCode: 1,
    stderr: '',
    body: 'No Codex credentials stored. Run `hermes auth add openai-codex --type oauth` to authenticate.',
    candidateKey: 'hermes::openai-codex::openai-codex::openai::codex::codex-chatgpt::m',
    accountId: 'codex',
  });
  assert.equal(c.cause, classifier.Cause.ACCOUNT_AUTH_FAILED);
  assert.equal(c.scope, classifier.Scope.ACCOUNT);
});
