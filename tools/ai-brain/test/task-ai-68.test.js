const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function writePoolAdapter(dir) {
  const script = path.join(dir, 'fake-pool-adapter.js');
  fs.writeFileSync(
    script,
    [
      "const fs = require('fs');",
      "const path = require('path');",
      'const dir = process.argv[2];',
      "const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));",
      "fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(state.result));",
      "if (state.out !== undefined) fs.writeFileSync(path.join(dir, 'out.txt'), state.out);",
    ].join('\n')
  );
  return script;
}

const { test, describe } = require('node:test');

describe('TASK-AI-68: pool candidates reach the live ranking', () => {
  test('with redirected HOME, agy-pool candidates are pinned properly based on runs dir quota', () => {
    const home = tmpDir('ai68-home-');
    const localApp = path.join(home, 'AppData', 'Local');
    const runsDir = path.join(localApp, 'agy-runs');
    fs.mkdirSync(runsDir, { recursive: true });
    const adapterScript = writePoolAdapter(runsDir);

    // Fake agy01: 100% quota
    fs.mkdirSync(path.join(runsDir, 'agy01'));
    writeJson(path.join(runsDir, 'agy01', 'state.json'), {
      result: { state: 'ok' },
      out: JSON.stringify({
        groups: [
          {
            id: 'gemini',
            models: ['gemini-test-pro'],
            weekly: { remaining: 1 },
            fiveHour: { remaining: 1 },
          },
        ],
      }),
    });

    // Fake agy02: 0% quota
    fs.mkdirSync(path.join(runsDir, 'agy02'));
    writeJson(path.join(runsDir, 'agy02', 'state.json'), {
      result: {
        state: 'quota',
        resetsAt: new Date(Date.now() + 86400000).toISOString(),
      },
      out: JSON.stringify({
        groups: [
          {
            id: 'gemini',
            models: ['gemini-test-pro'],
            weekly: { remaining: 0 },
            fiveHour: { remaining: 0 },
          },
        ],
      }),
    });

    // We must run refresh quota so the evidence/ranking stores the quota
    const refreshScript = path.join(__dirname, '..', 'refresh-quota.js');
    const refreshCode = `
      const { refreshAll } = require(String.raw\`${refreshScript}\`);
      refreshAll([], { home: String.raw\`${home}\` });
    `;
    const resRefresh = spawnSync('node', ['-e', refreshCode], {
      env: Object.assign({}, process.env, {
        LOCALAPPDATA: localApp,
        AGY_POOL_RUNS_DIR: runsDir,
        AGY_POOL_ADAPTER_SCRIPT: adapterScript,
        HOME: home,
        USERPROFILE: home,
      }),
    });
    if (resRefresh.status !== 0) throw new Error('refresh failed: ' + resRefresh.stderr.toString());

    const root = tmpDir('ai68-root-');
    const profileFile = path.join(root, 'profile.json');
    writeJson(profileFile, {
      taskId: 'TASK-AI-68-T',
      role: 'writer',
      complexity: 'short',
      requiredCapabilities: [],
      proofFloor: 'NONE',
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

    const cliPath = path.join(__dirname, '..', 'cli.js');
    const res = spawnSync(
      'node',
      [cliPath, 'dispatch', '--dry-run', '--profile', profileFile, '--json'],
      {
        env: Object.assign({}, process.env, {
          LOCALAPPDATA: localApp,
          AGY_POOL_RUNS_DIR: runsDir,
          HOME: home,
          USERPROFILE: home,
        }),
        cwd: root,
      }
    );

    const out = res.stdout.toString() + '\n' + res.stderr.toString();

    assert.match(out, /Pinned.*:\s+agy-pool::.*::agy01/, 'agy01 should be pinned');
    assert.doesNotMatch(out, /Pinned.*:\s+agy-pool::.*::agy02/, 'agy02 should NOT be pinned');

    // Check that agy02 is in the rejected list or ranked low
    assert.match(out, /agy02/, 'agy02 should appear in the output (e.g. rejected for quota)');
  });
});
