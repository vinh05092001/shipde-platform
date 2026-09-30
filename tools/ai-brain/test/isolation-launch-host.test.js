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
function runGeneratedHost({ targetLines, workerTimeoutMs }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-launch-host-'));
  const targetPath = path.join(dir, 'target.ps1');
  fs.writeFileSync(targetPath, targetLines.join('\r\n') + '\r\n', 'utf8');

  const launchResultPath = path.join(dir, 'launch-result.json');
  const completionNonce = crypto.randomBytes(16).toString('hex');
  const script = buildWorkerLaunchScript({
    credPath: path.join(dir, 'WorkerUser.cred'),
    workerRoot: dir,
    workerUsername: 'ShipDeWorker',
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
