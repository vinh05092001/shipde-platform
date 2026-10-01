'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { candidateKey } = require('../candidates');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function writePoolAdapter(root) {
  const script = path.join(root, 'fake-pool-adapter.js');
  fs.writeFileSync(
    script,
    [
      "const fs = require('fs');",
      "const path = require('path');",
      'const dir = process.argv[2];',
      "const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));",
      "const quota = JSON.parse(fs.readFileSync(path.join(dir, 'quota-state.json'), 'utf8'));",
      "if (job.command === 'quota') {",
      "  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(quota.result));",
      "  fs.writeFileSync(path.join(dir, 'out.txt'), JSON.stringify(quota.out));",
      '  process.exit(0);',
      '}',
      "fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'ok', exitCode: 0 }));",
    ].join('\n'),
    'utf8'
  );
  return script;
}

function envFor(home, runsDir, adapterScript) {
  return Object.assign({}, process.env, {
    HOME: home,
    USERPROFILE: home,
    TEMP: path.join(home, 'Temp'),
    TMP: path.join(home, 'Temp'),
    AGY_POOL_RUNS_DIR: runsDir,
    AGY_POOL_ADAPTER_SCRIPT: adapterScript,
  });
}

function runCli(args, env, cwd) {
  const cli = path.join(__dirname, '..', 'cli.js');
  return spawnSync(process.execPath, [cli].concat(args), {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });
}

function profileFile(root, proofFloor) {
  const file = path.join(root, 'profile.json');
  writeJson(file, {
    taskId: 'TASK-AI-69-T',
    role: 'writer',
    complexity: 'short',
    requiredCapabilities: [],
    proofFloor,
    contextSize: 64000,
    expectedDuration: 600000,
    latencyPriority: 'normal',
    qualityFloor: 0,
    costCeiling: 1000,
    requiredHarness: 'agy-pool',
    forbiddenFailureDomains: [],
    resourceCeiling: 4,
    currentWorkload: 1,
  });
  return file;
}

describe('TASK-AI-69: agy pool quota and first evidence go through the CLI', () => {
  test('quota discovers runtime accounts, excludes auth/quota failures, and profile proof floor opens after reported outcome', () => {
    const root = tmpDir('ai69-root-');
    const home = path.join(root, 'home');
    const runsDir = path.join(root, 'agy-runs');
    const evidenceDir = path.join(root, 'evidence');
    const decisionDir = path.join(root, 'decisions');
    fs.mkdirSync(path.join(home, 'Temp'), { recursive: true });
    const adapterScript = writePoolAdapter(root);

    const quotaOut = {
      groups: [
        {
          id: 'gemini',
          models: ['gemini-test-pro'],
          weekly: { remaining: 0.9, resetAt: '2026-10-02T00:00:00Z' },
          fiveHour: { remaining: 0.8, resetAt: '2026-10-01T15:00:00Z' },
        },
      ],
    };
    writeJson(path.join(runsDir, 'agy01', 'quota-state.json'), {
      result: { state: 'ok', exitCode: 0 },
      out: quotaOut,
    });
    writeJson(path.join(runsDir, 'agy02', 'quota-state.json'), {
      result: { state: 'quota', exitCode: 1, resetsAt: '2026-10-02T00:00:00Z' },
      out: {
        groups: [
          {
            id: 'gemini',
            models: ['gemini-test-pro'],
            weekly: { remaining: 0, resetAt: '2026-10-02T00:00:00Z' },
            fiveHour: { remaining: 0, resetAt: '2026-10-01T15:00:00Z' },
          },
        ],
      },
    });
    writeJson(path.join(runsDir, 'agy03', 'quota-state.json'), {
      result: { state: 'login-required', exitCode: 1 },
      out: {},
    });
    fs.mkdirSync(path.join(runsDir, 'scratch-not-account'), { recursive: true });

    const env = envFor(home, runsDir, adapterScript);
    const quota = runCli(
      ['quota', '--json', '--pool-runtime-dir', runsDir, '--pool-adapter-script', adapterScript],
      env,
      root
    );
    assert.equal(quota.status, 0, quota.stderr);
    const quotaJson = JSON.parse(quota.stdout);
    assert.deepEqual(
      quotaJson.results.map((r) => r.accountId),
      ['agy01', 'agy02', 'agy03']
    );
    assert.equal(quotaJson.results.find((r) => r.accountId === 'agy01').ok, true);
    assert.equal(quotaJson.results.find((r) => r.accountId === 'agy02').reason, 'QUOTA_EXHAUSTED');
    assert.equal(quotaJson.results.find((r) => r.accountId === 'agy03').reason, 'AUTH_FAILED');

    const profile = profileFile(root, 'API_PASS');
    const before = runCli(
      [
        'dispatch',
        '--dry-run',
        '--profile',
        profile,
        '--evidence-dir',
        evidenceDir,
        '--decision-dir',
        decisionDir,
        '--pool-runtime-dir',
        runsDir,
      ],
      env,
      root
    );
    const beforeOut = before.stdout + before.stderr;
    assert.equal(before.status, 1, beforeOut);
    assert.match(beforeOut, /EXCLUDED \d+x PROOF_FLOOR_NOT_MET:NONE/);

    const candidate = {
      harness: 'agy-pool',
      accessPath: 'ShipDe\\ShipDe-agy01',
      gateway: '',
      upstream: 'antigravity',
      accountId: 'agy01',
      quotaScope: 'agy01:gemini',
      modelId: 'gemini-test-pro',
    };
    const key = candidateKey(candidate);
    assert.equal(key.split('::').length, 7, 'pool candidate key is seven-part');

    writeJson(path.join(runsDir, 'agy01', 'result.json'), { state: 'ok', exitCode: 0 });
    const outcomeFile = path.join(root, 'outcome.json');
    writeJson(outcomeFile, { candidateKey: key, status: 'completed', taskId: 'TASK-AI-69-T' });
    const report = runCli(
      [
        'dispatch',
        '--report-outcome',
        outcomeFile,
        '--evidence-dir',
        evidenceDir,
        '--decision-dir',
        decisionDir,
        '--pool-runtime-dir',
        runsDir,
      ],
      env,
      root
    );
    assert.equal(report.status, 0, report.stdout + report.stderr);
    assert.match(report.stdout + report.stderr, /Outcome COMPLETED/);

    const after = runCli(
      [
        'dispatch',
        '--dry-run',
        '--profile',
        profile,
        '--evidence-dir',
        evidenceDir,
        '--decision-dir',
        decisionDir,
        '--pool-runtime-dir',
        runsDir,
      ],
      env,
      root
    );
    const afterOut = after.stdout + after.stderr;
    assert.equal(after.status, 0, afterOut);
    assert.match(afterOut, new RegExp('Pinned .*' + key.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
    assert.doesNotMatch(afterOut, /Pinned .*agy02/);
  });

  test('F1: runsDir on non-Windows resolves to absolute posix path and runAdapter rejects unsupported platform', () => {
    const { runsDir, runAdapter } = require('../agy-pool-runtime');
    const oldXdg = process.env.XDG_DATA_HOME;
    delete process.env.XDG_DATA_HOME;
    try {
      const posixDir = runsDir({ platform: 'linux', home: '/home/tester' });
      assert.equal(posixDir, '/home/tester/.local/share/agy-runs');
      assert.ok(path.posix.isAbsolute(posixDir));
      assert.notEqual(posixDir, 'C:\\Tools\\agy-runs');
    } finally {
      if (oldXdg !== undefined) process.env.XDG_DATA_HOME = oldXdg;
    }

    const res = runAdapter('agy01', { platform: 'linux' });
    assert.equal(res.exitCode, 1);
    assert.match(res.stderr, /UNSUPPORTED_PLATFORM/);
  });

  test('F2: adapter launch failure fails fast without waiting for timeout, and pool timeout flag is supported', () => {
    const root = tmpDir('ai69-f2-');
    const runsDir = path.join(root, 'agy-runs');
    const { submitJob } = require('../agy-pool-runtime');
    const failingScript = path.join(root, 'failing-adapter.js');
    fs.writeFileSync(
      failingScript,
      "console.error('TASK_START_FAILED'); process.exit(42);\n",
      'utf8'
    );
    const start = Date.now();
    const res = submitJob(
      'agy01',
      { command: 'quota' },
      {
        fakeRunsDir: runsDir,
        adapterScript: failingScript,
        timeoutMs: 10000,
      }
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 2000, `submitJob took ${elapsed}ms, should fail fast`);
    assert.equal(res.state, 'error');
    assert.equal(res.exitCode, 42);
    assert.match(res.reason, /TASK_START_FAILED/);
  });

  test('F3: missing or unreported quota window is not reported as QUOTA_EXHAUSTED', () => {
    const root = tmpDir('ai69-f3-');
    const runsDir = path.join(root, 'agy-runs');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, 'Temp'), { recursive: true });
    const { parseQuotaOutput } = require('../agy-pool-runtime');
    const { refreshAccount } = require('../refresh-quota');

    // 1. JSON with only resetAt (no remainingPercent, remaining, or disabled)
    const unreportedJson = JSON.stringify({
      groups: [
        {
          id: 'gemini',
          models: ['gemini-x'],
          weekly: { resetAt: '2026-10-02T00:00:00Z' },
        },
      ],
    });
    const parsed = parseQuotaOutput(unreportedJson);
    assert.equal(parsed.available, false);
    assert.match(parsed.reason, /không có số liệu quota hợp lệ/);
    assert.equal(parsed.rows.length, 0);

    // 2. Refreshing an account with unreported quota does NOT map to QUOTA_EXHAUSTED
    const adapterScript = path.join(root, 'adapter.js');
    fs.writeFileSync(
      adapterScript,
      [
        "const fs = require('fs');",
        "const path = require('path');",
        'const dir = process.argv[2];',
        "fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'ok', exitCode: 0 }));",
        'process.exit(0);',
      ].join('\n'),
      'utf8'
    );
    fs.mkdirSync(path.join(runsDir, 'agy01'), { recursive: true });
    fs.writeFileSync(path.join(runsDir, 'agy01', 'out.txt'), unreportedJson, 'utf8');

    const ref = refreshAccount(
      { id: 'agy01', provider: 'agy-pool' },
      { fakeRunsDir: runsDir, adapterScript, home, path: path.join(home, 'quota.json') }
    );
    assert.equal(ref.ok, false);
    assert.notEqual(ref.reason, 'QUOTA_EXHAUSTED');
    assert.match(ref.reason, /không có số liệu quota hợp lệ/);

    // 3. Partial reporting: weekly has remaining 40%, session has only resetAt -> valid window is kept
    const partialJson = JSON.stringify({
      groups: [
        {
          id: 'gemini',
          models: ['gemini-x'],
          weekly: { remaining: 0.4, resetAt: '2026-10-02T00:00:00Z' },
          session: { resetAt: '2026-10-01T15:00:00Z' },
        },
      ],
    });
    const partialParsed = parseQuotaOutput(partialJson);
    assert.equal(partialParsed.available, true);
    assert.equal(partialParsed.rows.length, 1);
    assert.equal(partialParsed.rows[0].remainingPercent, 40);

    fs.writeFileSync(path.join(runsDir, 'agy01', 'out.txt'), partialJson, 'utf8');
    const ref2 = refreshAccount(
      { id: 'agy01', provider: 'agy-pool' },
      { fakeRunsDir: runsDir, adapterScript, home, path: path.join(home, 'quota.json') }
    );
    assert.equal(ref2.ok, true);
    assert.equal(ref2.rows, 1);
  });

  test('F4: candidateKey account segment is validated and path traversal is refused', () => {
    const root = tmpDir('ai69-f4-');
    const home = path.join(root, 'home');
    const runsDir = path.join(root, 'agy-runs');
    fs.mkdirSync(path.join(home, 'Temp'), { recursive: true });
    const { accountDir, isValidAccountId } = require('../agy-pool-runtime');
    const { getHarness } = require('../harness');

    assert.equal(isValidAccountId('agy01'), true);
    assert.equal(isValidAccountId('../../..'), false);
    assert.equal(isValidAccountId('agy999'), false);
    assert.throws(() => accountDir('../../..', { fakeRunsDir: runsDir }), /INVALID_ACCOUNT_ID/);

    const adapter = getHarness('agy-pool');
    const mapped = adapter.mapOutcome(
      '../../..',
      'agy-pool::ShipDe\\ShipDe-agy01::::../../..::gemini::model',
      { fakeRunsDir: runsDir }
    );
    assert.equal(mapped.status, 'failed');
    assert.equal(mapped.errorClass, 'INVALID_ACCOUNT_ID');
    assert.match(mapped.reason, /INVALID_ACCOUNT_ID/);

    // CLI dispatch --report-outcome with invalid candidateKey account segment exits code 2
    const outcomeFile = path.join(root, 'bad-outcome.json');
    writeJson(outcomeFile, {
      candidateKey: 'agy-pool::ShipDe\\ShipDe-agy01::::../../..::gemini::model',
      status: 'completed',
      taskId: 'TASK-AI-69-T',
    });
    const env = envFor(home, runsDir, '');
    const cliRes = runCli(
      [
        'dispatch',
        '--report-outcome',
        outcomeFile,
        '--evidence-dir',
        path.join(root, 'evidence'),
        '--decision-dir',
        path.join(root, 'decisions'),
        '--pool-runtime-dir',
        runsDir,
      ],
      env,
      root
    );
    assert.equal(cliRes.status, 2);
    assert.match(cliRes.stderr, /OUTCOME_INVALID: invalid agy-pool account/);
  });

  test('F6/R2: candidate assembly reads advertised models from out.txt and never submits live jobs implicitly', () => {
    const root = tmpDir('ai69-f6-r2-');
    const runsDir = path.join(root, 'agy-runs');
    fs.mkdirSync(path.join(runsDir, 'agy01'), { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, 'agy01', 'out.txt'),
      JSON.stringify({
        groups: [{ id: 'gemini', models: ['gemini-static-catalog'], weekly: { remaining: 1 } }],
      }),
      'utf8'
    );
    const markerFile = path.join(root, 'adapter-called.marker');
    const adapterScript = path.join(root, 'guarded-adapter.js');
    fs.writeFileSync(
      adapterScript,
      `const fs = require('fs'); fs.writeFileSync(${JSON.stringify(markerFile)}, 'CALLED'); process.exit(0);\n`,
      'utf8'
    );

    const { modelIdsFromRuntime } = require('../agy-pool-runtime');
    const { poolAccountCandidates } = require('../candidates');

    // modelIdsFromRuntime with refresh / refreshModels options does NOT submit jobs or call adapter
    const models = modelIdsFromRuntime({
      fakeRunsDir: runsDir,
      adapterScript,
      refresh: true,
      refreshModels: true,
    });
    assert.deepEqual(models, ['gemini-static-catalog']);
    assert.equal(fs.existsSync(markerFile), false);

    // poolAccountCandidates with discoverPool and refresh does not call adapter
    const candidates = poolAccountCandidates({
      accounts: [{ id: 'agy01', provider: 'agy-pool' }],
      discoverPool: true,
      fakeRunsDir: runsDir,
      adapterScript,
      refresh: true,
    });
    assert.ok(
      candidates.some((c) => c.accountId === 'agy01' && c.modelId === 'gemini-static-catalog')
    );
    assert.equal(fs.existsSync(markerFile), false);
  });

  test('R1: unparseable reported quota value is UNKNOWN, not 0% or QUOTA_EXHAUSTED, verified through CLI', () => {
    const root = tmpDir('ai69-r1-');
    const runsDir = path.join(root, 'agy-runs');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, 'Temp'), { recursive: true });

    // 1. parseQuotaOutput unit verification: "N/A" -> null / known: false, not 0 or string 'UNKNOWN'
    const { parseQuotaOutput } = require('../agy-pool-runtime');
    const naOutput = parseQuotaOutput(
      JSON.stringify({
        groups: [
          {
            id: 'gemini',
            models: ['gemini-x'],
            weekly: { remainingPercent: 'N/A' },
            session: { remainingPercent: 5 },
          },
        ],
      })
    );
    assert.equal(naOutput.available, true);
    assert.equal(naOutput.rows[0].remainingPercent, null);
    assert.equal(naOutput.rows[0].known, false);
    assert.equal(naOutput.rows[1].remainingPercent, 5);
    assert.equal(naOutput.rows[1].known, true);

    const { headroomFor, statusFrom } = require('../agy-quota');
    const hr = headroomFor(naOutput, 'gemini-2.5-pro');
    assert.equal(hr.known, true);
    assert.equal(hr.remainingPercent, 5);
    assert.equal(hr.window, 'session');
    assert.equal(statusFrom(hr), 'tight');

    const onlyNaOutput = {
      available: true,
      rows: [{ family: 'gemini', window: 'weekly', remainingPercent: null, known: false }],
    };
    const onlyNaHr = headroomFor(onlyNaOutput, 'gemini-2.5-pro');
    assert.equal(onlyNaHr.known, false);
    assert.equal(statusFrom(onlyNaHr), 'unknown');

    // 2. Set up agy01 with unparseable quota ("N/A") and agy02 with genuine zero quota (0)
    fs.mkdirSync(path.join(runsDir, 'agy01'), { recursive: true });
    fs.mkdirSync(path.join(runsDir, 'agy02'), { recursive: true });
    fs.writeFileSync(
      path.join(runsDir, 'agy01', 'out.txt'),
      JSON.stringify({
        groups: [{ id: 'gemini', models: ['gemini-x'], weekly: { remainingPercent: 'N/A' } }],
      }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(runsDir, 'agy02', 'out.txt'),
      JSON.stringify({
        groups: [{ id: 'gemini', models: ['gemini-x'], weekly: { remainingPercent: 0 } }],
      }),
      'utf8'
    );

    const adapterScript = path.join(root, 'adapter.js');
    fs.writeFileSync(
      adapterScript,
      [
        "const fs = require('fs');",
        "const path = require('path');",
        'const dir = process.argv[2];',
        "fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ state: 'ok', exitCode: 0 }));",
        'process.exit(0);',
      ].join('\n'),
      'utf8'
    );

    const env = envFor(home, runsDir, adapterScript);

    // Run CLI quota refresh
    const quotaRes = runCli(
      ['quota', '--pool-runtime-dir', runsDir, '--pool-adapter-script', adapterScript],
      env,
      root
    );
    const quotaOut = quotaRes.stdout + quotaRes.stderr;
    assert.equal(quotaRes.status, 0, quotaOut);
    // agy01 (unparseable) is NOT exhausted -> reads 1 row
    assert.match(quotaOut, /ĐỌC ĐƯỢC agy01 — 1 dòng/);
    assert.doesNotMatch(quotaOut, /HỎNG\s+agy01\s+—\s+QUOTA_EXHAUSTED/);
    // agy02 (parsed 0) IS exhausted -> QUOTA_EXHAUSTED
    assert.match(quotaOut, /HỎNG\s+agy02\s+—\s+QUOTA_EXHAUSTED/);

    // Run CLI quota --show
    const showRes = runCli(
      ['quota', '--show', '--pool-runtime-dir', runsDir, '--pool-adapter-script', adapterScript],
      env,
      root
    );
    const showOut = showRes.stdout + showRes.stderr;
    assert.equal(showRes.status, 0, showOut);
    assert.match(showOut, /agy01\s+gemini\s+weekly\s+UNKNOWN/);
    assert.match(showOut, /agy02\s+gemini\s+weekly\s+0%/);
  });

  test('R3: agyPool.launch returns structured refusal for invalid account instead of throwing', () => {
    const { getHarness } = require('../harness');
    const poolHarness = getHarness('agy-pool');
    const traversal = poolHarness.launch({ accountId: '../../..' });
    assert.equal(traversal.state, 'error');
    assert.equal(traversal.refusal, 'INVALID_ACCOUNT_ID');
    assert.equal(traversal.exitCode, 1);
    assert.match(traversal.reason, /INVALID_ACCOUNT_ID/);

    const invalid = poolHarness.launch({ accountId: 'invalid' });
    assert.equal(invalid.state, 'error');
    assert.equal(invalid.refusal, 'INVALID_ACCOUNT_ID');
    assert.equal(invalid.exitCode, 1);

    const resumeRes = poolHarness.resume('sess1', 'prompt', { accountId: 'invalid' });
    assert.equal(resumeRes.state, 'error');
    assert.equal(resumeRes.refusal, 'INVALID_ACCOUNT_ID');
  });

  test('R3: executor.executePlan handles invalid pool account as structured failure without throwing', () => {
    const { executePlan } = require('../executor');
    const plan = {
      assignments: [
        {
          workItemId: 'TASK-AI-999',
          role: 'IMPLEMENTATION',
          branch: 'feat/test',
          offeringId: 'agy-pool::tools::none::none::invalid::standard::gemini-2.5-pro',
          accountId: 'invalid',
          harness: 'agy-pool',
        },
      ],
    };
    const root = tmpDir('ai69-r3-plan-');
    const decisionDir = path.join(root, 'decisions');
    const result = executePlan(plan, {
      dryRun: false,
      decisionDir,
    });
    assert.equal(result.summary.failed, 1);
    assert.equal(result.summary.launched, 0);
    assert.equal(result.records[0].outcome, 'FAILED');
    assert.match(result.records[0].detail, /INVALID_ACCOUNT_ID/);
  });

  test('R3: cli dispatch --plan returns structured failure on invalid pool account', () => {
    const root = tmpDir('ai69-r3-cli-plan-');
    const planFile = path.join(root, 'plan.json');
    const home = path.join(root, 'home');
    fs.mkdirSync(home, { recursive: true });
    writeJson(planFile, {
      assignments: [
        {
          workItemId: 'TASK-AI-999',
          role: 'IMPLEMENTATION',
          branch: 'feat/test',
          offeringId: 'agy-pool::tools::none::none::invalid::standard::gemini-2.5-pro',
          accountId: 'invalid',
          harness: 'agy-pool',
        },
      ],
    });
    const env = envFor(home, path.join(root, 'runs'), '');
    const res = runCli(['dispatch', '--plan', planFile, '--execute', '--json'], env, root);
    const out = res.stdout + res.stderr;
    assert.equal(res.status, 1, out);
    const parsed = JSON.parse(res.stdout);
    assert.equal(parsed.result.summary.failed, 1);
    assert.equal(parsed.result.records[0].outcome, 'FAILED');
  });

  test('R3: cli dispatch launch guard catches preparation failure and records failed decision', () => {
    const { dispatchCommand } = require('../cli');
    const { candidateKey } = require('../candidates');
    const evidence = require('../evidence');
    const root = tmpDir('ai69-r3-cli-guard-');
    const home = path.join(root, 'home');
    const decisionDir = path.join(root, 'decisions');
    const evidenceDir = path.join(root, 'evidence');
    fs.mkdirSync(decisionDir, { recursive: true });
    fs.mkdirSync(evidenceDir, { recursive: true });

    const poolCand = {
      harness: 'agy-pool',
      accessPath: 'tools',
      gateway: 'none',
      upstream: 'none',
      accountId: 'invalid',
      quotaScope: 'standard',
      modelId: 'gemini-2.5-pro',
      status: 'active',
      available: true,
      qualifiedRoles: ['IMPLEMENTATION'],
      cost: 10,
      quality: 80,
    };
    poolCand.key = candidateKey(poolCand);
    evidence.recordOutcome(evidenceDir, poolCand, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      exitCode: 0,
      source: 'seed',
    });

    let logged = [];
    const fakeLog = (msg) => logged.push(msg);

    const result = dispatchCommand(
      {
        execute: true,
        project: 'shipde-platform',
        'decision-dir': decisionDir,
        'evidence-dir': evidenceDir,
        item: 'TASK-AI-999',
        home,
      },
      {
        items: [{ workItemId: 'TASK-AI-999', role: 'IMPLEMENTATION', branch: 'feat/test' }],
        candidates: [poolCand],
        evidenceDir,
        decisionDir,
        log: fakeLog,
        exit: () => {},
      }
    );

    assert.equal(result.exitCode, 1);
    const decisionsStore = require('../decisions');
    const recorded = decisionsStore.readDecisions({ dir: decisionDir });
    const failedDecisions = recorded.filter((d) => d.stage === decisionsStore.Stage.FAILED);
    assert.equal(failedDecisions.length, 1);
    assert.match(failedDecisions[0].chosen || '', /invalid/);
    assert.match(logged.join('\n'), /Harness launch refused: INVALID_ACCOUNT_ID/);
  });

  test('R5: adapter killed by timeout reports ADAPTER_TIMEOUT instead of ADAPTER_EXIT_-1 through CLI', () => {
    const root = tmpDir('ai69-r5-');
    const runsDir = path.join(root, 'agy-runs');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(runsDir, 'agy01'), { recursive: true });
    const hangingScript = path.join(root, 'hanging-adapter.js');
    fs.writeFileSync(hangingScript, 'setInterval(() => {}, 10000);\n', 'utf8');

    const env = envFor(home, runsDir, hangingScript);
    const res = runCli(
      [
        'quota',
        '--pool-runtime-dir',
        runsDir,
        '--pool-adapter-script',
        hangingScript,
        '--pool-timeout',
        '300',
      ],
      env,
      root
    );
    const out = res.stdout + res.stderr;
    assert.match(out, /HỎNG\s+agy01\s+—\s+ADAPTER_TIMEOUT/);
    assert.doesNotMatch(out, /ADAPTER_EXIT_-1/);
  });

  test('N2: adapter termination by non-timeout signal or exit code is not reported as ADAPTER_TIMEOUT', () => {
    const root = tmpDir('ai69-n2-');
    const runsDir = path.join(root, 'agy-runs');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(runsDir, 'agy01'), { recursive: true });

    const errorScript = path.join(root, 'error-adapter.js');
    fs.writeFileSync(errorScript, 'process.exit(2);\n', 'utf8');

    const env = envFor(home, runsDir, errorScript);
    const res = runCli(
      [
        'quota',
        '--pool-runtime-dir',
        runsDir,
        '--pool-adapter-script',
        errorScript,
        '--pool-timeout',
        '5000',
      ],
      env,
      root
    );
    const out = res.stdout + res.stderr;
    assert.match(out, /HỎNG\s+agy01\s+—\s+ADAPTER_EXIT_2/);
    assert.doesNotMatch(out, /ADAPTER_TIMEOUT/);

    const pool = require('../agy-pool-runtime');
    const killedScript = path.join(root, 'killed-adapter.js');
    fs.writeFileSync(killedScript, 'process.kill(process.pid, "SIGTERM");\n', 'utf8');
    const submitRes = pool.submitJob(
      'agy01',
      { command: 'quota' },
      {
        runsDir,
        adapterScript: killedScript,
        adapterTimeoutMs: 5000,
      }
    );
    assert.equal(submitRes.state, 'error');
    assert.doesNotMatch(submitRes.reason, /ADAPTER_TIMEOUT/);
  });
});
