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
});
