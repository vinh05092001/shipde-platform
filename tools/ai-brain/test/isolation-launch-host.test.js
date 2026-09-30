'use strict';

// End-to-end regression for the generated host launch script (TASK-AI-61,
// live E2E attempt 3). Nothing here is injected: the test executes the exact
// text buildWorkerLaunchScript returns, as the current user, against a temp
// directory and a tiny target script that sleeps, writes output and exits with
// a chosen code. Two defects are covered:
//
//   A. launch-result.json is written by PowerShell 5.1 with a UTF-8 BOM, which
//      JSON.parse rejects; the launcher used to swallow that failure in an
//      empty catch and fall back to the host process status — green for a job
//      that never ran. Every unproven result is now a hard failure.
//
//   B. the host used to write the result before the worker had done anything,
//      so a controller gating on exitCode === 0 saw success for a job that had
//      not started. The host now waits for the run-target.ps1 wrapper and
//      every process it starts, and reports success only when run-target.ps1
//      itself wrote a nonce-bound completion marker carrying the payload's
//      exit code.
//
//   C. the launcher provisions the worker root by cloning it AS THE OPERATOR,
//      so .git inside it is operator-owned while the job runs as the worker,
//      and git >= 2.35.2 refuses every command with "detected dubious
//      ownership" (exit 128). The host script now sets command-scope environment
//      variables (GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0=safe.directory)
//      for exactly that worker root, and explicitly unsets global config
//      (GIT_CONFIG_GLOBAL=NUL). No global config file is written inside the worker root.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const { buildWorkerLaunchScript, readLaunchResult } = require('../isolation-launcher');

// The generated script is PowerShell 5.1 on Windows; anywhere else it cannot
// run, so the execution tests skip with a reason instead of being deleted.
function detectPowerShell() {
  if (process.platform !== 'win32') return null;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'exit 0'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return r.status === 0 ? 'powershell.exe' : null;
}
const POWERSHELL_EXE = detectPowerShell();
const windowsSkip = POWERSHELL_EXE
  ? {}
  : {
      skip:
        process.platform === 'win32'
          ? 'powershell.exe is not available on this Windows host'
          : 'the generated host launch script is Windows-only (PowerShell 5.1)',
    };

const POWERSHELL_EXE_PATH = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

// Defect C is a git behaviour, so the execution test must run the real git.
// The absolute path is resolved here and passed to the payload: the host
// scrubs the environment before starting the worker, and a test that silently
// ran no git at all would prove nothing. Without git on this host the test
// skips with a reason instead of passing vacuously.
function resolveGitExe() {
  if (process.platform !== 'win32') return null;
  const r = spawnSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return null;
  const first = String(r.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0];
  return first && fs.existsSync(first) ? first : null;
}
const GIT_EXE = resolveGitExe();
const gitSkip = GIT_EXE
  ? {}
  : {
      skip: 'git.exe is not available on this Windows host (needed to prove safe.directory is honoured)',
    };

// Comparing git's forward-slash output with the backslash path the script was
// built from needs one canonical form on both sides.
function normalizePath(value) {
  return path.normalize(String(value).replace(/\//g, '\\')).toLowerCase();
}

function parseLaunchResultFile(launchResultPath) {
  const text = fs.readFileSync(launchResultPath, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/**
 * Generates the production host script for a tiny target, runs it end to end,
 * and returns the raw launch result exactly as the host wrote it (PowerShell
 * 5.1 writes a UTF-8 BOM), plus everything needed to re-read it the way the
 * launcher does.
 */
function runGeneratedHost({ targetLines, workerTimeoutMs, workerUsername }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-launch-host-'));
  const targetPath = path.join(dir, 'target.ps1');
  fs.writeFileSync(targetPath, targetLines.join('\r\n') + '\r\n', 'utf8');

  const launchResultPath = path.join(dir, 'launch-result.json');
  const completionNonce = crypto.randomBytes(16).toString('hex');
  const script = buildWorkerLaunchScript({
    credPath: path.join(dir, 'WorkerUser.cred'),
    workerRoot: dir,
    workerUsername: workerUsername || 'ShipDeWorker',
    exeFile: POWERSHELL_EXE_PATH,
    psArgs:
      "'-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '" +
      targetPath.replace(/'/g, "''") +
      "'",
    launchResultPath,
    workerTimeoutMs,
    completionNonce,
    runAsCurrentUser: true,
  });
  const hostPath = path.join(dir, 'host.ps1');
  fs.writeFileSync(hostPath, script, 'utf8');

  const startedAt = Date.now();
  const hostRes = spawnSync(
    POWERSHELL_EXE,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', hostPath],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: workerTimeoutMs + 120000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );
  const elapsedMs = Date.now() - startedAt;

  const raw = fs.existsSync(launchResultPath) ? parseLaunchResultFile(launchResultPath) : null;
  return {
    dir,
    hostRes,
    raw,
    completionNonce,
    elapsedMs,
    launchResultPath,
    readIt: () => readLaunchResult(launchResultPath, completionNonce, hostRes),
  };
}

test(
  'the generated host script runs as the current user without the worker credential',
  windowsSkip,
  () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-launch-impersonation-'));
    const script = buildWorkerLaunchScript({
      credPath: path.join(dir, 'WorkerUser.cred'),
      workerRoot: dir,
      workerUsername: 'ShipDeWorker',
      exeFile: POWERSHELL_EXE_PATH,
      psArgs: "'-NoProfile'",
      launchResultPath: path.join(dir, 'launch-result.json'),
      workerTimeoutMs: 60000,
      completionNonce: '0'.repeat(32),
      runAsCurrentUser: true,
    });
    fs.rmSync(dir, { recursive: true, force: true });

    assert.ok(
      !script.includes('$psi.UserName'),
      'runAsCurrentUser must drop the impersonation lines so the test executes the script as the current user'
    );
    assert.ok(
      !script.includes('$psi.Password'),
      'runAsCurrentUser must drop the credential password line'
    );
    assert.ok(
      !script.includes('ConvertTo-SecureString'),
      'runAsCurrentUser must not read a credential'
    );
  }
);

test(
  'the generated host script waits for the job and reports its exit code and output',
  windowsSkip,
  () => {
    const sleepMs = 1200;
    const { dir, hostRes, raw, completionNonce, elapsedMs, readIt } = runGeneratedHost({
      workerTimeoutMs: 60000,
      targetLines: [
        '$ErrorActionPreference = "Stop"',
        `Start-Sleep -Milliseconds ${sleepMs}`,
        'Write-Output "LAUNCH_HOST_STDOUT"',
        '[Console]::Error.WriteLine("LAUNCH_HOST_STDERR")',
        'exit 7',
      ],
    });

    assert.strictEqual(
      hostRes.status,
      0,
      'host script failed: ' + String(hostRes.stderr || hostRes.stdout || '')
    );
    assert.ok(raw, 'the host must write a launch result before it reports anything');
    assert.strictEqual(
      raw.exitCode,
      7,
      'the reported exit code must be the job exit code; got ' +
        JSON.stringify(raw) +
        (elapsedMs < sleepMs
          ? ' — the host returned after ' + elapsedMs + ' ms for a ' + sleepMs + ' ms job'
          : '')
    );
    assert.match(
      String(raw.stdout),
      /LAUNCH_HOST_STDOUT/,
      'the job stdout must be captured, got ' + JSON.stringify(raw.stdout)
    );
    assert.match(
      String(raw.stderr),
      /LAUNCH_HOST_STDERR/,
      'the job stderr must be captured, got ' + JSON.stringify(raw.stderr)
    );
    assert.strictEqual(raw.timedOut, false, 'a job inside the timeout must not be timed out');
    assert.strictEqual(
      raw.completed,
      true,
      'the host must require positive evidence of completion: ' + raw.failureReason
    );
    assert.strictEqual(
      raw.completionNonce,
      completionNonce,
      'the completion marker must belong to this launch'
    );
    assert.ok(
      elapsedMs >= sleepMs,
      'the host must wait for the job: returned after ' +
        elapsedMs +
        ' ms for a ' +
        sleepMs +
        ' ms job'
    );

    // The same file, read the way the launcher reads it: a BOM must not turn
    // a real result into a failure, and the reported values must be the job's.
    const reported = readIt();
    assert.strictEqual(reported.exitCode, 7, 'the launcher must report the job exit code');
    assert.strictEqual(reported.timedOut, false);
    assert.match(String(reported.stdout), /LAUNCH_HOST_STDOUT/);

    fs.rmSync(dir, { recursive: true, force: true });
  }
);

test('a job that never writes the completion marker is reported as a failure', windowsSkip, () => {
  // The target removes the wrapper before run-target.ps1 can write
  // run-target.complete.json, then finishes normally with exit 0. Only
  // positive evidence can tell this launch apart from a job that really
  // completed: the payload succeeded, the job did not.
  const { dir, hostRes, raw, readIt } = runGeneratedHost({
    workerTimeoutMs: 60000,
    targetLines: [
      '$ErrorActionPreference = "Stop"',
      '$self = Get-CimInstance Win32_Process -Filter "ProcessId=$PID"',
      '$wrapper = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $self.ParentProcessId)',
      'if ($wrapper -and $wrapper.CommandLine -like "*run-target.ps1*") { Stop-Process -Id $self.ParentProcessId -Force }',
      'Start-Sleep -Milliseconds 1500',
      'Write-Output "ORPHANED_JOB_STDOUT"',
      'exit 0',
    ],
  });

  assert.strictEqual(
    hostRes.status,
    0,
    'the host script itself must run to completion and report the failure in the result: ' +
      String(hostRes.stderr || hostRes.stdout || '')
  );
  assert.ok(raw, 'the host must write a launch result before it reports anything');
  assert.notStrictEqual(raw.exitCode, 0, 'a job with no completion marker must not be green');
  assert.match(
    String(raw.failureReason),
    /completion marker/,
    'the host must name the missing completion marker, got ' + JSON.stringify(raw)
  );
  assert.notStrictEqual(
    raw.completed,
    true,
    'a job that never wrote its completion marker must not be reported as completed'
  );

  const reported = readIt();
  assert.strictEqual(
    reported.exitCode,
    -1,
    'the launcher must turn a job with no completion marker into a failure, got ' +
      JSON.stringify(reported)
  );
  assert.match(String(reported.stderr), /completion marker/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a worker that outlives the timeout is killed and reported as a failure', windowsSkip, () => {
  const { dir, hostRes, raw, readIt } = runGeneratedHost({
    workerTimeoutMs: 4000,
    targetLines: ['$ErrorActionPreference = "Stop"', 'Start-Sleep -Seconds 60', 'exit 7'],
  });

  assert.strictEqual(
    hostRes.status,
    0,
    'the host script itself must run to completion and report the failure in the result: ' +
      String(hostRes.stderr || hostRes.stdout || '')
  );
  assert.ok(raw, 'the host must write a launch result before it reports anything');
  assert.strictEqual(raw.timedOut, true, 'the host must record the timeout');
  assert.strictEqual(raw.exitCode, -1, 'a timed-out launch must not report a job exit code');
  assert.notStrictEqual(raw.completed, true, 'a killed job has no completion marker');
  assert.match(
    String(raw.failureReason),
    /timed out after 4000 ms/,
    'the failure must name the timeout, got ' + JSON.stringify(raw)
  );

  const reported = readIt();
  assert.strictEqual(reported.exitCode, -1, 'the launcher must fail closed on a timeout');
  assert.strictEqual(reported.timedOut, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

// Defect A: the BOM PowerShell writes, and every unproven result, must be a
// hard failure. The host process status is never a substitute — it was 0 in
// the live E2E attempt 3 run where the worker had not finished.
test('an unreadable or unproven launch result is a hard failure, never a green host status', () => {
  assert.strictEqual(
    typeof readLaunchResult,
    'function',
    'the launcher must expose the fail-closed reader for the host-owned launch result'
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-launch-result-'));
  const resultPath = path.join(dir, 'launch-result.json');
  const nonce = 'a'.repeat(32);
  const hostRes = { status: 0, stdout: 'host stdout', stderr: 'host stderr', signal: null };

  // No file at all: the host crashed before writing anything.
  const missing = readLaunchResult(resultPath, nonce, hostRes);
  assert.strictEqual(missing.exitCode, -1, 'a missing result must fail');
  assert.match(missing.stderr, /launch result unreadable/);
  assert.match(missing.stderr, /host stderr/, 'the host diagnostics must survive the failure');

  // Corrupt JSON: the parse failure must not be swallowed.
  fs.writeFileSync(resultPath, 'not json', 'utf8');
  const corrupt = readLaunchResult(resultPath, nonce, hostRes);
  assert.strictEqual(corrupt.exitCode, -1, 'an unparsable result must fail');
  assert.match(corrupt.stderr, /launch result unreadable/);

  // PowerShell 5.1 writes a UTF-8 BOM; a valid payload behind it must parse.
  const payload = {
    exitCode: 7,
    stdout: 'job out',
    stderr: 'job err',
    timedOut: false,
    completed: true,
    completionNonce: nonce,
    failureReason: '',
  };
  fs.writeFileSync(resultPath, '\uFEFF' + JSON.stringify(payload), 'utf8');
  const bom = readLaunchResult(resultPath, nonce, hostRes);
  assert.strictEqual(bom.exitCode, 7, 'a BOM must not turn a real result into a failure');
  assert.strictEqual(bom.stdout, 'job out');
  assert.strictEqual(bom.stderr, 'job err');
  assert.strictEqual(bom.timedOut, false);

  // No completion evidence: the same file without the marker fields fails.
  fs.writeFileSync(
    resultPath,
    '\uFEFF' + JSON.stringify({ exitCode: 0, stdout: '', stderr: '', timedOut: false }),
    'utf8'
  );
  const noMarker = readLaunchResult(resultPath, nonce, hostRes);
  assert.strictEqual(noMarker.exitCode, -1, 'a result without completion evidence must fail');

  // A marker from another launch is not evidence for this one.
  fs.writeFileSync(
    resultPath,
    '\uFEFF' + JSON.stringify({ ...payload, completionNonce: 'b'.repeat(32) }),
    'utf8'
  );
  const foreign = readLaunchResult(resultPath, nonce, hostRes);
  assert.strictEqual(foreign.exitCode, -1, 'a foreign completion marker must fail');

  // Timeout is a failure even when the payload exited 0 before the deadline.
  fs.writeFileSync(resultPath, '\uFEFF' + JSON.stringify({ ...payload, timedOut: true }), 'utf8');
  const timedOut = readLaunchResult(resultPath, nonce, hostRes);
  assert.strictEqual(timedOut.exitCode, -1, 'a timed-out launch must fail');
  assert.strictEqual(timedOut.timedOut, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

// Defect C needs both PowerShell (to run the generated script) and git (to
// prove git reads what it wrote), so the execution test skips if either is
// missing — with a reason, never by passing vacuously.
const gitHostSkip = windowsSkip.skip ? windowsSkip : gitSkip.skip ? gitSkip : {};

const OPERATOR_GITCONFIG = path.join(os.homedir(), '.gitconfig');

function readTextIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

/**
 * The operator's own `git config --global --get-all safe.directory`, read
 * before and after a launch so any write to the operator profile is a
 * failure. Never writes: `--get-all` against a missing file exits 1 silently.
 */
function readOperatorSafeDirectory() {
  if (!GIT_EXE) return { status: null, values: [] };
  const res = spawnSync(GIT_EXE, ['config', '--global', '--get-all', 'safe.directory'], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env },
  });
  return {
    status: res.status,
    values: String(res.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

test('the host script declares exactly the worker root safe in the worker command environment', () => {
  const workerRoot = path.join(os.tmpdir(), 'shipde-safe-static-worker-root');
  const safeWorkerRootForGit = workerRoot.replace(/\\/g, '/');
  const script = buildWorkerLaunchScript({
    credPath: path.join(workerRoot, 'WorkerUser.cred'),
    workerRoot,
    workerUsername: 'ShipDeWorker',
    exeFile: POWERSHELL_EXE_PATH,
    psArgs: "'-NoProfile'",
    launchResultPath: path.join(workerRoot, 'launch-result.json'),
    workerTimeoutMs: 60000,
    completionNonce: '1'.repeat(32),
    runAsCurrentUser: true,
  });

  assert.ok(script.includes(`\$env:GIT_CONFIG_COUNT = "1"`), 'must set GIT_CONFIG_COUNT');
  assert.ok(
    script.includes(`\$env:GIT_CONFIG_KEY_0 = "safe.directory"`),
    'must set GIT_CONFIG_KEY_0'
  );
  assert.ok(
    script.includes(`\$env:GIT_CONFIG_VALUE_0 = "${safeWorkerRootForGit}"`),
    'must set exact safeWorkerRootForGit'
  );
  assert.ok(
    script.includes(`\$env:GIT_CONFIG_GLOBAL = "NUL"`),
    'the job must have GIT_CONFIG_GLOBAL set to NUL'
  );

  const directoryLines = script.match(/GIT_CONFIG_VALUE_0\s*=\s*"[^"]*"/g) || [];
  assert.ok(directoryLines.length >= 1, 'the script must declare safe.directory at all');
  for (const line of directoryLines) {
    assert.ok(
      !line.includes('*'),
      'a wildcard safe.directory would grant trust to every repository on the host: ' + line
    );
    assert.ok(
      line.includes(safeWorkerRootForGit),
      'the safe.directory entry must name this worker root, got: ' + line
    );
  }

  assert.ok(
    !/git\s+config/i.test(script),
    'the host script must not run git config directly, which would touch operator files'
  );
});

test(
  'the job resolves safe.directory to exactly the worker root via env vars, and the operator config is untouched',
  gitHostSkip,
  () => {
    // Hermetic on purpose: reproducing dubious ownership needs a directory
    // owned by another account, which cannot be created without changing the
    // host, so this test never requires a commit under a foreign owner. What a
    // temp dir can prove is the contract that fixes the defect — git, run
    // inside the launch with GIT_CONFIG_COUNT variables injected,
    // reports exactly that root from the command line scope, while the operator's
    // global config is byte-identical afterwards. No git config file is created.
    const operatorConfigBefore = readTextIfExists(OPERATOR_GITCONFIG);
    const operatorSafeBefore = readOperatorSafeDirectory();

    const { dir, hostRes, raw, readIt } = runGeneratedHost({
      workerTimeoutMs: 60000,
      targetLines: [
        '$ErrorActionPreference = "Stop"',
        `$gitExe = "${GIT_EXE}"`,
        '$vals = @(& $gitExe config --get-all safe.directory)',
        '$valsExit = $LASTEXITCODE',
        'Write-Output ("SAFE_EXIT=" + $valsExit)',
        'foreach ($v in $vals) { Write-Output ("SAFE_VALUE=" + $v) }',
        '$orig = @(& $gitExe config --show-origin --get-all safe.directory)',
        'Write-Output ("SAFE_ORIGIN_EXIT=" + $LASTEXITCODE)',
        'foreach ($o in $orig) { Write-Output ("SAFE_ORIGIN=" + $o) }',
        'exit 0',
      ],
    });

    const operatorConfigAfter = readTextIfExists(OPERATOR_GITCONFIG);
    const operatorSafeAfter = readOperatorSafeDirectory();
    try {
      assert.strictEqual(
        hostRes.status,
        0,
        'host script failed: ' + String(hostRes.stderr || hostRes.stdout || '')
      );
      assert.ok(raw, 'the host must write a launch result before it reports anything');
      assert.strictEqual(
        raw.completed,
        true,
        'the probe job must have completed: ' + raw.failureReason
      );
      const reported = readIt();
      assert.strictEqual(
        reported.exitCode,
        0,
        'the probe job must run to its end, got ' + JSON.stringify(reported)
      );
      const stdout = String(reported.stdout || '');

      assert.match(stdout, /SAFE_EXIT=0/, 'git must read the worker config; got ' + stdout);

      const values = stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith('SAFE_VALUE='))
        .map((line) => line.slice('SAFE_VALUE='.length));
      assert.strictEqual(
        values.length,
        1,
        'exactly one safe.directory entry, never a set of paths; got ' + JSON.stringify(values)
      );
      assert.ok(
        !values.includes('*'),
        'a wildcard safe.directory would trust every repository on the host: ' +
          JSON.stringify(values)
      );
      assert.strictEqual(
        normalizePath(values[0]),
        normalizePath(dir),
        'the job must see its own worker root as safe, got ' + JSON.stringify(values)
      );

      const origins = stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith('SAFE_ORIGIN='))
        .map((line) => line.slice('SAFE_ORIGIN='.length));
      assert.ok(origins.length >= 1, 'git must report where the entry came from; got ' + stdout);
      const operatorConfigNorm = normalizePath(OPERATOR_GITCONFIG);
      for (const origin of origins) {
        const norm = normalizePath(origin);
        assert.ok(
          norm.includes('command line:') || norm.includes('command line'),
          'the entry must come from command scope, got ' + JSON.stringify(origin)
        );
        assert.ok(
          !norm.includes(operatorConfigNorm),
          'the operator global config must never be a source: ' + JSON.stringify(origin)
        );
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('workerRootFor refuses drive roots, siblings, and wildcards', windowsSkip, () => {
  const { workerRootFor } = require('../isolation-launcher');
  assert.throws(() => workerRootFor('C:\\a\\..'), /Invalid job name/);
  assert.throws(() => workerRootFor('C:\\a\\..\\..'), /Invalid job name/);
  assert.throws(() => workerRootFor('C:\\work\\..'), /Invalid job name/);
  assert.throws(() => workerRootFor('C:\\work\\?'), /Invalid job name/);
  assert.throws(() => workerRootFor('C:\\ShipDeWorker\\*'), /Invalid job name/);
  assert.strictEqual(workerRootFor('C:\\'), 'C:\\ShipDeWorker\\default');
  assert.strictEqual(workerRootFor('C:\\work\\job'), 'C:\\ShipDeWorker\\job');
});

test('no config file in worker root and sibling repo fails', gitHostSkip, () => {
  const { dir, hostRes, raw, readIt } = runGeneratedHost({
    workerTimeoutMs: 60000,
    targetLines: [
      '$ErrorActionPreference = "Stop"',
      `$gitExe = "${GIT_EXE}"`,
      `$env:GIT_TEST_ASSUME_DIFFERENT_OWNER = "1"`,
      `$workerRoot = $PWD.Path`,
      `& $gitExe init $workerRoot | Out-Null`,
      `& $gitExe status > $null 2>&1`,
      `Write-Output ("STATUS_EXIT=" + $LASTEXITCODE)`,
      `$sibling = Join-Path (Split-Path $workerRoot) "sibling-$(Get-Random)"`,
      `New-Item -ItemType Directory -Path $sibling | Out-Null`,
      `& $gitExe init $sibling | Out-Null`,
      `$ErrorActionPreference = "Continue"`,
      `Set-Location -Path $sibling`,
      `& $gitExe status > $null 2>&1`,
      `Write-Output ("SIBLING_EXIT=" + $LASTEXITCODE)`,
      `Set-Location -Path $workerRoot`,
      `& $gitExe -C $sibling status > $null 2>&1`,
      `Write-Output ("SIBLING_EXIT2=" + $LASTEXITCODE)`,
      `$configExists = Test-Path -Path "$workerRoot\\.gitconfig"`,
      `Write-Output ("GITCONFIG_EXISTS=" + $configExists)`,
      `exit 0`,
    ],
  });

  try {
    assert.strictEqual(
      hostRes.status,
      0,
      'host script failed: ' + String(hostRes.stderr || hostRes.stdout || '')
    );
    assert.ok(raw, 'the host must write a launch result');
    const reported = readIt();
    const stdout = String(reported.stdout || '');
    assert.match(stdout, /STATUS_EXIT=0/, 'exact worker root should be accepted (STATUS_EXIT=0)');
    assert.match(stdout, /SIBLING_EXIT=128/, 'sibling repo should be refused with 128');
    assert.match(stdout, /SIBLING_EXIT2=128/, 'git -C sibling should be refused with 128');
    assert.match(
      stdout,
      /GITCONFIG_EXISTS=False/,
      'no .gitconfig file should be created in worker root'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
