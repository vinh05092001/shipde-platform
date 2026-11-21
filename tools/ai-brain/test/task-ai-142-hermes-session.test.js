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
  syncControllerMemory,
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

test('H3 live: source headers reach Hermes custom_providers with YAML quoting', () => {
  const root = fixtureRoot('hermes-headers-');
  try {
    const registry = sampleRegistry();
    const headers = { 'User-Agent': 'fixture "cli": agent', 'X-Route': 'value # tag' };
    registry.sources[0].headers = headers;
    const res = writeProvidersConfig(sampleCandidate(), { rootDir: root }, { registry });
    const content = fs.readFileSync(res.configPath, 'utf8');
    const custom = content.slice(content.indexOf('custom_providers:'));
    assert.ok(custom.includes('    extra_headers:\n'));
    for (const [key, value] of Object.entries(headers)) {
      assert.ok(custom.includes(`      ${JSON.stringify(key)}: ${JSON.stringify(value)}\n`));
    }
    assert.equal(fs.readFileSync(res.legacyConfigPath, 'utf8'), content);
    assert.deepEqual(res.headers, headers);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3 live: config disables every installed skill except the Controller skill', () => {
  const root = fixtureRoot('hermes-skills-');
  try {
    const home = getHermesHomeDir(root);
    const mk = (rel, name) => {
      const dir = path.join(home, 'skills', ...rel);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: x\n---\nbody\n`
      );
    };
    mk(['email', 'himalaya'], 'himalaya');
    mk(['creative', 'ascii-art'], 'ascii-art');
    mk(['shipde-controller'], 'shipde-controller');
    const res = writeProvidersConfig(
      sampleCandidate(),
      { rootDir: root },
      { registry: sampleRegistry() }
    );
    const content = fs.readFileSync(res.configPath, 'utf8');
    assert.match(content, /skills:\n {2}disabled:\n {4}- "ascii-art"\n {4}- "himalaya"\n/);
    assert.ok(!content.includes('"shipde-controller"'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3 live: Controller memory block is replaced and user text outside markers is kept', () => {
  const root = fixtureRoot('hermes-memory-');
  try {
    const home = getHermesHomeDir(root);
    const memPath = path.join(home, 'memories', 'MEMORY.md');
    fs.mkdirSync(path.dirname(memPath), { recursive: true });
    fs.writeFileSync(memPath, 'user note A');
    const state = (status) => ({
      goalId: 'g1',
      status,
      lastOutcome: 'ITEM-1 review PASS tests ok',
      items: [{ workItemId: 'ITEM-1', state: 'MERGED' }],
    });
    syncControllerMemory(home, state('RUNNING'), fs);
    let text = fs.readFileSync(memPath, 'utf8');
    assert.ok(text.startsWith('user note A\n§\n'));
    assert.ok(text.includes('goal: g1 status RUNNING') && text.includes('ITEM-1: MERGED'));
    fs.writeFileSync(memPath, text + '\nuser note B');
    syncControllerMemory(home, state('COMPLETED'), fs);
    text = fs.readFileSync(memPath, 'utf8');
    assert.ok(text.includes('status COMPLETED') && !text.includes('status RUNNING'));
    assert.ok(text.includes('user note A') && text.endsWith('user note B'));
    assert.equal(text.split('shipde-controller:begin').length, 2);
    assert.ok(text.length <= 2200);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('H3 live: absent or empty source headers leave YAML unchanged', () => {
  const root = fixtureRoot('hermes-no-headers-');
  try {
    const registry = sampleRegistry();
    const res = writeProvidersConfig(sampleCandidate(), { rootDir: root }, { registry });
    const before = fs.readFileSync(res.configPath, 'utf8');
    assert.ok(!before.includes('extra_headers'));
    assert.ok(before.endsWith('    key_env: "NINEROUTER_API_KEY"\n'));
    registry.sources[0].headers = {};
    writeProvidersConfig(sampleCandidate(), { rootDir: root }, { registry });
    assert.equal(fs.readFileSync(res.configPath, 'utf8'), before);
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

    const authFailure = await defaultSpawn(
      process.execPath,
      [
        '-e',
        "process.stderr.write('API call failed (attempt 1/1): Error code: 401 invalid api key\n'); setInterval(() => {}, 1000);",
      ],
      { stdio: ['inherit', 'pipe', 'pipe'] }
    );
    assert.match(authFailure.routeFailure, /401/);
    assert.notEqual(authFailure.exitCode, 0);

    // Hermes reports a missing provider login and exits 0; that is route evidence.
    const missingLogin = await defaultSpawn(
      process.execPath,
      [
        '-e',
        "process.stdout.write('\\u001b[1;31mNo Codex credentials stored. Run hermes auth add openai-codex to\\u001b[0m\\nGoodbye!\\n'); setTimeout(() => process.exit(0), 30);",
      ],
      { stdio: ['inherit', 'pipe', 'pipe'] }
    );
    assert.match(missingLogin.routeFailure, /^No Codex credentials stored/);
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

test('writeProvidersConfig uses upstream when gateway is empty, avoiding builtin openai providerName', () => {
  const root = fixtureRoot('hermes-cfg-empty-gw-');
  try {
    const candidate = {
      candidateKey:
        'hermes::https://developer.amd.com.cn/radeon/api/v1::::amd-radeon::*::deepseek-ai/deepseek-v3.1',
      modelId: 'deepseek-ai/deepseek-v3.1',
    };
    const registry = {
      sources: [
        {
          id: 'amd-radeon',
          endpoint: 'https://developer.amd.com.cn/radeon/api/v1',
          credential: { type: 'env', env: 'AMD_RADEON_API_KEY' },
        },
      ],
    };
    const res = writeProvidersConfig(candidate, { rootDir: root }, { registry });
    assert.notEqual(
      res.providerName,
      'openai',
      'candidate with empty gateway must not fall back to openai'
    );
    assert.equal(res.providerName, 'amd-radeon', 'candidate with empty gateway must use upstream');
    const content = fs.readFileSync(res.configPath, 'utf8');
    assert.ok(
      !content.includes('provider: "openai"'),
      'config.yaml must not contain provider: "openai"'
    );
    assert.ok(
      content.includes('provider: "amd-radeon"'),
      'config.yaml must configure upstream provider'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
