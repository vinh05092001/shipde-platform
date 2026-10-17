'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const { buildWorkerLaunchScript, readLaunchResult } = require('../isolation-launcher');
const { classifyFailure, Cause, Scope } = require('../failure-classifier');

const POWERSHELL_EXE = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  : 'powershell.exe';
const windowsSkip = process.platform === 'win32' ? {} : { skip: 'Windows PowerShell only' };

function parseLaunchResultFile(launchResultPath) {
  const text = fs.readFileSync(launchResultPath, 'utf8');
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

function writePayloadArgs(dir, args) {
  fs.mkdirSync(dir, { recursive: true });
  const payloadArgsPath = path.join(dir, 'payload-args.json');
  fs.writeFileSync(payloadArgsPath, JSON.stringify(args), 'utf8');
  return payloadArgsPath;
}

function runGeneratedHost({
  targetLines,
  workerTimeoutMs = 30000,
  tokenBudget,
  usageFile,
  progressTimeoutMs,
  tempRoot,
  fakeClockPath,
}) {
  const dir = fs.mkdtempSync(path.join(tempRoot || os.tmpdir(), 'shipde-progress-test-'));
  const targetPath = path.join(dir, 'target.ps1');
  fs.writeFileSync(targetPath, targetLines.join('\r\n') + '\r\n', 'utf8');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', targetPath];

  const launchResultPath = path.join(dir, 'launch-result.json');
  const completionNonce = crypto.randomBytes(16).toString('hex');
  let script = buildWorkerLaunchScript({
    credPath: path.join(dir, 'WorkerUser.cred'),
    workerRoot: dir,
    workerUsername: 'ShipDeWorker',
    exeFile: POWERSHELL_EXE,
    payloadArgsPath: writePayloadArgs(dir, args),
    launchResultPath,
    workerTimeoutMs,
    completionNonce,
    runAsCurrentUser: true,
    tokenBudget,
    usageFile,
    progressTimeoutMs,
  });

  if (fakeClockPath) {
    const clockFn = `function Get-ProgressTestClock {
    try {
        if (Test-Path -LiteralPath '${fakeClockPath.replace(/'/g, "''")}') {
            $ms = [double](Get-Content -LiteralPath '${fakeClockPath.replace(/'/g, "''")}' -Raw)
            return [long]($ms * [System.Diagnostics.Stopwatch]::Frequency / 1000)
        }
    } catch {}
    return [long]0
}
`;
    script =
      clockFn +
      script.replaceAll(
        '[System.Diagnostics.Stopwatch]::GetTimestamp()',
        '(Get-ProgressTestClock)'
      );
  }

  const hostPath = path.join(dir, 'host.ps1');
  fs.writeFileSync(hostPath, script, 'utf8');

  const startedAt = Date.now();
  const hostRes = cp.spawnSync(
    POWERSHELL_EXE,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', hostPath],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: workerTimeoutMs + 30000,
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
  'B4: launcher detects 413 / Request Too Large in worker JSON error event and aborts immediately with REQUEST_TOO_LARGE',
  windowsSkip,
  () => {
    const startedAt = Date.now();
    const { hostRes, raw, readIt, dir } = runGeneratedHost({
      workerTimeoutMs: 30000,
      targetLines: [
        '$ErrorActionPreference = "Stop"',
        'Write-Output \'{"type":"error","timestamp":1791237213000,"error":{"name":"APIError","data":{"message":"[provider/model] [413]: Request too large for model context","statusCode":413}}}\'',
        'Start-Sleep -Seconds 15',
        'exit 0',
      ],
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(hostRes.status, 0, String(hostRes.stderr || hostRes.stdout || ''));
    assert.ok(raw, 'launch result must be written');
    assert.match(String(raw.failureReason), /REQUEST_TOO_LARGE/);
    assert.ok(elapsedMs < 10000, `expected fast abort on 413, took ${elapsedMs}ms`);

    const result = readIt();
    assert.equal(result.failureReason, 'REQUEST_TOO_LARGE');

    const classified = classifyFailure({
      failureReason: result.failureReason,
      stderr: result.stderr,
      stdout: result.stdout,
    });
    assert.equal(classified.scope, Scope.MODEL, 'REQUEST_TOO_LARGE must have Scope.MODEL');
    assert.equal(
      classified.cause,
      Cause.REQUEST_TOO_LARGE,
      'REQUEST_TOO_LARGE must map to Cause.REQUEST_TOO_LARGE'
    );

    fs.rmSync(dir, { recursive: true, force: true });
  }
);

test(
  'B4: launcher detects TPM limit in worker output and aborts immediately with REQUEST_TOO_LARGE',
  windowsSkip,
  () => {
    const startedAt = Date.now();
    const { hostRes, raw, readIt, dir } = runGeneratedHost({
      workerTimeoutMs: 30000,
      targetLines: [
        '$ErrorActionPreference = "Stop"',
        'Write-Output "Rate limit reached for model on tokens per minute (TPM): Limit 8000, Used 7950, Requested 2500"',
        'Start-Sleep -Seconds 15',
        'exit 0',
      ],
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(hostRes.status, 0, String(hostRes.stderr || hostRes.stdout || ''));
    assert.ok(raw, 'launch result must be written');
    assert.match(String(raw.failureReason), /REQUEST_TOO_LARGE/);
    assert.ok(elapsedMs < 10000, `expected fast abort on TPM limit, took ${elapsedMs}ms`);

    const result = readIt();
    assert.equal(result.failureReason, 'REQUEST_TOO_LARGE');

    fs.rmSync(dir, { recursive: true, force: true });
  }
);

test(
  'B5: fluctuating single-step token counts do not fool STALLED_NO_PROGRESS detector',
  windowsSkip,
  () => {
    const tempRoot = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
    fs.mkdirSync(tempRoot, { recursive: true });
    const usageFile = path.join(tempRoot, 'task-ai-142-fluctuate-usage.json');
    fs.rmSync(usageFile, { force: true });

    const startedAt = Date.now();
    const { hostRes, raw, readIt, dir } = runGeneratedHost({
      workerTimeoutMs: 30000,
      progressTimeoutMs: 1500,
      usageFile,
      tempRoot,
      targetLines: [
        '$ErrorActionPreference = "Stop"',
        'Write-Output \'{"tokens":{"input":100,"output":0,"total":5000}}\'',
        'Start-Sleep -Milliseconds 400',
        'Write-Output \'{"tokens":{"input":80,"output":0,"total":4800}}\'',
        'Start-Sleep -Milliseconds 400',
        'Write-Output \'{"tokens":{"input":110,"output":0,"total":5200}}\'',
        'Start-Sleep -Milliseconds 400',
        'Write-Output \'{"tokens":{"input":90,"output":0,"total":4900}}\'',
        'Start-Sleep -Milliseconds 400',
        'Write-Output \'{"tokens":{"input":120,"output":0,"total":5300}}\'',
        'Start-Sleep -Seconds 15',
        'exit 0',
      ],
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(hostRes.status, 0, String(hostRes.stderr || hostRes.stdout || ''));
    assert.ok(raw, 'launch result must be written');
    assert.match(String(raw.failureReason), /STALLED_NO_PROGRESS/);
    const result = readIt();
    assert.equal(result.failureReason, 'STALLED_NO_PROGRESS');

    fs.rmSync(usageFile, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
);

test('B5: genuine tool progress and file changes reset stall detection', windowsSkip, () => {
  const tempRoot = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const usageFile = path.join(tempRoot, 'task-ai-142-genuine-usage.json');
  const clockFile = path.join(tempRoot, 'task-ai-142-b5-clock.txt');
  fs.rmSync(usageFile, { force: true });
  fs.writeFileSync(clockFile, '0\r\n', 'utf8');

  const { hostRes, raw, readIt, dir } = runGeneratedHost({
    workerTimeoutMs: 30000,
    progressTimeoutMs: 1500,
    usageFile,
    tempRoot,
    fakeClockPath: clockFile,
    targetLines: [
      '$ErrorActionPreference = "Stop"',
      `Set-Content -LiteralPath '${clockFile.replace(/'/g, "''")}' -Value "0"`,
      'Write-Output \'{"tokens":{"input":100,"output":0,"total":100}}\'',
      'Start-Sleep -Milliseconds 50',
      `Set-Content -LiteralPath '${clockFile.replace(/'/g, "''")}' -Value "600"`,
      'Start-Sleep -Milliseconds 50',
      'Write-Output \'{"type":"tool_use","part":{"type":"tool","tool":"bash"}}\'',
      'Start-Sleep -Milliseconds 50',
      `Set-Content -LiteralPath '${clockFile.replace(/'/g, "''")}' -Value "1200"`,
      'Start-Sleep -Milliseconds 50',
      'Set-Content -LiteralPath "progress-file.txt" -Value "progress made"',
      'Start-Sleep -Milliseconds 50',
      `Set-Content -LiteralPath '${clockFile.replace(/'/g, "''")}' -Value "1800"`,
      'Start-Sleep -Milliseconds 50',
      'exit 0',
    ],
  });

  assert.equal(hostRes.status, 0, String(hostRes.stderr || hostRes.stdout || ''));
  assert.ok(raw, 'launch result must be written');
  assert.equal(
    raw.completed,
    true,
    'genuine progress must allow job to complete: ' + raw.failureReason
  );
  assert.equal(raw.exitCode, 0);

  const result = readIt();
  assert.equal(result.exitCode, 0);

  fs.rmSync(usageFile, { force: true });
  fs.rmSync(clockFile, { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test(
  'capability proof counts successful native command telemetry in the generated host',
  windowsSkip,
  () => {
    const events = [
      { type: 'item.completed', item: { type: 'agent_message', text: 'tools work' } },
      {
        type: 'item.completed',
        item: { type: 'command_execution', status: 'failed', exit_code: 1 },
      },
      {
        type: 'item.completed',
        item: { type: 'command_execution', status: 'completed', exit_code: 0 },
      },
    ];
    const { hostRes, raw, readIt, dir } = runGeneratedHost({
      targetLines: [...events.map((event) => `Write-Output '${JSON.stringify(event)}'`), 'exit 0'],
    });
    try {
      assert.equal(hostRes.status, 0, String(hostRes.stderr || hostRes.stdout || ''));
      assert.equal(raw.verifiedToolCalls, 1);
      assert.equal(readIt().verifiedToolCalls, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
);
