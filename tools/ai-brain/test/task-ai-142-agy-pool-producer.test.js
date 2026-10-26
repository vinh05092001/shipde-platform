'use strict';

// The controller only accepts a pool result that names the submitted job. This
// runs the versioned pool producer (scripts/ai/agy-pool/worker-core.ps1) end to
// end behind the real submitJob, with a stand-in agy binary, so the identity and
// time-limit contract is proven against the producer's actual output format.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const pool = require('../agy-pool-runtime');

const producer = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'ai',
  'agy-pool',
  'worker-core.ps1'
);
const isWin = process.platform === 'win32';

function findShell() {
  for (const exe of isWin ? ['powershell.exe', 'pwsh'] : ['pwsh']) {
    const res = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (res.status === 0) return exe;
  }
  return null;
}

const shell = findShell();
// CI runners ship PowerShell; there the contract must run, never silently skip.
if (!shell && process.env.CI)
  throw new Error('PowerShell is required in CI to verify the pool producer');
const skip = shell ? false : 'no PowerShell available to run the pool producer';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-producer-'));
  const profile = path.join(root, 'profile');
  fs.mkdirSync(profile, { recursive: true });
  const argsFile = path.join(root, 'agy-args.txt');
  let agy;
  if (isWin) {
    agy = path.join(root, 'agy.cmd');
    fs.writeFileSync(
      agy,
      `@echo %* >> "${argsFile}"\r\n@echo {"status":"SUCCESS","response":"done"}\r\n`
    );
  } else {
    agy = path.join(root, 'agy');
    fs.writeFileSync(
      agy,
      `#!/bin/sh\necho "$*" >> '${argsFile}'\necho '{"status":"SUCCESS","response":"done"}'\n`
    );
    fs.chmodSync(agy, 0o755);
  }
  const runProducer = (dir, name) =>
    spawnSync(
      shell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        producer,
        '-Name',
        name,
        '-RunsDir',
        path.dirname(dir),
        '-AgyExe',
        agy,
      ],
      { encoding: 'utf8', windowsHide: true, env: { ...process.env, USERPROFILE: profile } }
    );
  return { root, argsFile, agy, profile, runProducer };
}

function readResult(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8').replace(/^﻿/, ''));
}

test(
  'the real pool producer echoes the submitted jobId and honours the stamped limit',
  { skip },
  () => {
    const f = fixture();
    const adapter = path.join(f.root, 'adapter.js');
    fs.writeFileSync(
      adapter,
      [
        "const { spawnSync } = require('child_process');",
        "const path = require('path');",
        'const [dir, name] = process.argv.slice(2);',
        `const res = spawnSync(${JSON.stringify(shell)}, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ${JSON.stringify(producer)}, '-Name', name, '-RunsDir', path.dirname(dir), '-AgyExe', ${JSON.stringify(f.agy)}], { stdio: 'inherit', env: { ...process.env, USERPROFILE: ${JSON.stringify(f.profile)} } });`,
        'process.exit(res.status === null ? 1 : res.status);',
      ].join('\n')
    );
    try {
      const result = pool.submitJob(
        'agy01',
        { prompt: 'p', candidateKey: 'k' },
        {
          fakeRunsDir: f.root,
          adapterScript: adapter,
          adapterTimeoutMs: 120000,
          timeoutMs: 7000,
          dispatch: { agyPoolTimeoutMs: 7000 },
        }
      );
      assert.equal(result.state, 'ok', JSON.stringify(result));
      const written = readResult(path.join(f.root, 'agy01'));
      assert.equal(written.jobId, result.jobId, 'producer must echo the submitted jobId');
      assert.match(written.jobId, /^agy01\//);
      const job = JSON.parse(fs.readFileSync(path.join(f.root, 'agy01', 'job.json'), 'utf8'));
      assert.equal(job.printTimeoutSec, 7);
      const calls = fs.readFileSync(f.argsFile, 'utf8');
      assert.match(calls, /--print-timeout 7s/, 'agy runs under the stamped pool limit');
      assert.doesNotMatch(calls, /--print-timeout (?!7s)/);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  }
);

test('the pool producer refuses a job without a stamped limit', { skip }, () => {
  const f = fixture();
  const dir = path.join(f.root, 'agy02');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify({ prompt: 'p', jobId: 'agy02/x' }));
  try {
    const res = f.runProducer(dir, 'agy02');
    assert.equal(res.status, 1, res.stderr);
    const written = readResult(dir);
    assert.equal(written.state, 'error');
    assert.equal(written.reason, 'NO_PRINT_TIMEOUT');
    assert.equal(written.jobId, 'agy02/x');
    assert.equal(fs.existsSync(f.argsFile), false, 'agy must not run without a limit');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
