const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');
const os = require('node:os');
const { getIsolatedLauncher, getFolderHash } = require('../isolation-launcher');
const supervisor = require('../supervisor');

const BASE_SHA = '0123456789abcdef0123456789abcdef01234567';

function tmpDir(prefix) {
  const dir = path.join(
    process.env.TEMP || os.tmpdir(),
    'shipde-iso-usage-' + prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeVerdict(hostCwd) {
  const verdictDir = path.join(hostCwd, 'scripts', 'ai', 'isolation');
  fs.mkdirSync(verdictDir, { recursive: true });
  fs.writeFileSync(path.join(verdictDir, 'policy.txt'), 'mock-policy\n', 'utf8');

  const verdictPath = path.join(hostCwd, 'verdict.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      verdict: 'CLOSED',
      worktree: hostCwd,
      timestamp: new Date(Date.now() - 10000).toISOString(),
      policyHash: getFolderHash(verdictDir),
      sid: 'mock-sid',
      details: { check: 'PASS' },
    }),
    'utf8'
  );
  return verdictPath;
}

function installLaunchMocks(t, workerRoot, stdoutTelemetry) {
  const protectedRoot = path.resolve(workerRoot).toLowerCase();
  const realRmSync = fs.rmSync.bind(fs);
  t.mock.method(fs, 'rmSync', (target, options) => {
    if (path.resolve(String(target)).toLowerCase() === protectedRoot) return undefined;
    return realRmSync(target, options);
  });

  t.mock.method(cp, 'spawnSync', (command, args, options) => {
    if (command === 'powershell.exe') {
      const script = fs.readFileSync(args[args.length - 1], 'utf8');
      const nonceMatch = script.match(/\$completionNonce = "([^"]+)"/);
      const nonce = nonceMatch ? nonceMatch[1] : 'mock-nonce';
      const resultPathMatch = script.match(/\$output \| ConvertTo-Json.*Out-File "([^"]+)"/);
      const resultPath = resultPathMatch ? resultPathMatch[1] : null;
      if (resultPath) {
        fs.mkdirSync(path.dirname(resultPath), { recursive: true });
        fs.writeFileSync(
          resultPath,
          JSON.stringify({
            exitCode: 0,
            stdout: stdoutTelemetry,
            stderr: '',
            timedOut: false,
            completed: true,
            completionNonce: nonce,
          }),
          'utf8'
        );
      }
      return { status: 0, stdout: stdoutTelemetry, stderr: '' };
    }
    return { status: 0, stdout: BASE_SHA + '\n', stderr: '' };
  });

  t.mock.method(supervisor, 'withCleanGitEnv', (dir, callback) => callback('safegit'));
  t.mock.method(supervisor, 'safeGit', () => ({ status: 0, stdout: BASE_SHA }));
}

test('TASK-AI-142 H3: isolated launcher lazily imports writeUsageReportFromHarnessResult and writes usage file', (t) => {
  const area = tmpDir('h3');
  const hostCwd = path.join(area, 'host');
  const workerRoot = path.join(area, 'worker');
  const usageFile = path.join(area, 'reports', 'usage-' + Date.now() + '.json');

  fs.mkdirSync(hostCwd, { recursive: true });
  fs.mkdirSync(workerRoot, { recursive: true });

  const stdoutTelemetry = JSON.stringify({
    sessionID: 'isolated-session-42',
    tokens: { input: 120, output: 45, total: 165 },
  });

  installLaunchMocks(t, workerRoot, stdoutTelemetry);
  const verdictPath = writeVerdict(hostCwd);

  assert.strictEqual(fs.existsSync(usageFile), false, 'usageFile must not exist before launch');

  const launcher = getIsolatedLauncher();
  const res = launcher({ id: 'opencode-direct', command: 'opencode' }, [], {
    verdictPath,
    cwd: hostCwd,
    workerRoot,
    baseSha: BASE_SHA,
    getWorkerSid: () => 'mock-sid',
    verifyBoundary: () => true,
    usageFile,
    model: 'opencode/test-model',
    upstream: 'test-upstream',
  });

  assert.strictEqual(res.exitCode, 0, 'launcher must complete successfully');
  assert.strictEqual(fs.existsSync(usageFile), true, 'usageFile must be written by launcher');

  const report = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
  assert.strictEqual(report.session_id, 'isolated-session-42');
  assert.strictEqual(report.model, 'opencode/test-model');
  assert.strictEqual(report.provider, 'test-upstream');
  assert.strictEqual(report.usage.input, 120);
  assert.strictEqual(report.usage.output, 45);
  assert.strictEqual(report.usage.total, 165);

  // Clean up
  try {
    fs.rmSync(area, { recursive: true, force: true });
  } catch (_) {}
});
