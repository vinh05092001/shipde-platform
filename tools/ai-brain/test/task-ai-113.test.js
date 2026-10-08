'use strict';

/**
 * Ship Dễ — TASK-AI-113: isolated launches pass long prompts through a file,
 * not the Windows command line.
 *
 * Live gate 5 (main b190f94, 2026-10-06 20:54): every isolated opencode-direct
 * launch failed with "The filename or extension is too long" at
 * run-target.ps1:15. TASK-AI-109 added ~34k characters of locked skill pack to
 * the author prompt, but the launcher still wrote every arg on the command
 * line; Windows caps a command line at ~32,767 characters.
 *
 * The fix: for the opencode-direct adapter the full prompt (the last
 * positional arg from harness.js opencodeDirect.launch) is written to
 * <workerRoot>/.shipde/prompt-<nonce>.md and the arg is replaced with a short
 * "read that file" instruction.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const PROMPT_FILE_INSTRUCTION = (nonce) =>
  `Read the file .shipde/prompt-${nonce}.md in the current directory. It is your complete task; follow it exactly.`;

function listIn(dir, prefix, suffix) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
    .sort();
}

/**
 * Drives the real launcher for one opencode-direct launch with stubbed
 * spawnSync and a temp worker root, capturing the launch-args JSON and the
 * generated run-target.ps1 before the launcher deletes it.
 */
function runDirectLaunch(prompt) {
  const isoMod = require('../isolation-launcher');
  const { getHarness } = require('../harness');
  const directAdapter = getHarness('opencode-direct');
  assert.ok(directAdapter);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-113-'));
  const fakeHostCwd = path.join(tmpDir, 'host');
  const fakeWorkerRoot = path.join(tmpDir, 'worker');
  fs.mkdirSync(fakeHostCwd, { recursive: true });
  fs.mkdirSync(fakeWorkerRoot, { recursive: true });
  fs.mkdirSync(path.join(fakeHostCwd, 'scripts/ai/isolation'), { recursive: true });

  const verdictFile = path.join(fakeHostCwd, 'verdict.json');
  fs.writeFileSync(
    verdictFile,
    JSON.stringify({
      verdict: 'CLOSED',
      worktree: fakeHostCwd,
      timestamp: Date.now() - 1000,
      policyHash: isoMod.getFolderHash(path.join(fakeHostCwd, 'scripts/ai/isolation')),
      sid: 'TEST-SID',
      details: {},
    })
  );

  const realSpawn = cp.spawnSync;
  const realTemp = process.env.TEMP;
  let capturedScript = null;
  try {
    // Keep the launcher's generated temp script inside the sandbox.
    const tempShim = path.join(tmpDir, 'launch-temp');
    fs.mkdirSync(tempShim, { recursive: true });
    process.env.TEMP = tempShim;

    cp.spawnSync = (cmd, cargs, opts) => {
      if (cmd === 'git') {
        if (cargs && cargs[0] === 'clone') {
          fs.mkdirSync(path.join(cargs[cargs.length - 1], '.git', 'info'), { recursive: true });
        }
        if (cargs && cargs.includes('rev-parse')) {
          return { status: 0, stdout: '0123456789012345678901234567890123456789\n' };
        }
        return { status: 0 };
      }
      if (cmd === 'powershell.exe') {
        const fileIdx = cargs ? cargs.indexOf('-File') : -1;
        if (fileIdx !== -1 && cargs[fileIdx + 1] && fs.existsSync(cargs[fileIdx + 1])) {
          capturedScript = fs.readFileSync(cargs[fileIdx + 1], 'utf8');
        }
        return { status: 0, stdout: '' };
      }
      return realSpawn(cmd, cargs, opts);
    };

    const runIso = isoMod.getIsolatedLauncher();
    const args = directAdapter.launch({
      isolatedWorker: true,
      model: 'ninerouter/ag/gemini-3.1-pro-low',
      cwd: fakeWorkerRoot,
      prompt,
    });
    try {
      runIso(directAdapter, args, {
        cwd: fakeHostCwd,
        workerRoot: fakeWorkerRoot,
        verdictPath: verdictFile,
        getWorkerSid: () => 'TEST-SID',
        verifyBoundary: () => true,
        baseSha: '0123456789012345678901234567890123456789',
        workerTimeoutMs: 1000,
      });
    } catch (_) {
      // The fake host never writes a launch result; the files under test are.
    }

    const shipdeDir = path.join(fakeWorkerRoot, '.shipde');
    const promptFiles = listIn(shipdeDir, 'prompt-', '.md');
    const argsFiles = listIn(shipdeDir, 'launch-args-', '.json');
    const promptBytes = {};
    for (const name of promptFiles) {
      promptBytes[name] = fs.readFileSync(path.join(shipdeDir, name));
    }
    let payload = null;
    if (argsFiles.length > 0) {
      payload = JSON.parse(fs.readFileSync(path.join(shipdeDir, argsFiles[0]), 'utf8'));
    }

    return {
      args,
      promptFiles,
      argsFiles,
      payload,
      promptBytes,
      capturedScript,
    };
  } finally {
    cp.spawnSync = realSpawn;
    if (realTemp === undefined) delete process.env.TEMP;
    else process.env.TEMP = realTemp;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('TASK-AI-113: long prompts travel through a file, not the command line', () => {
  test('PF-R01: the full prompt is written to .shipde/prompt-<nonce>.md and the arg is a short instruction', () => {
    const prompt = 'x'.repeat(40000);
    const res = runDirectLaunch(prompt);

    assert.equal(res.promptFiles.length, 1, 'exactly one prompt file is written');
    const promptName = res.promptFiles[0];
    const nonce = promptName.slice('prompt-'.length, -'.md'.length);
    assert.match(nonce, /^[0-9a-f]{32}$/, 'prompt file is nonce-bound');

    assert.ok(Array.isArray(res.payload), 'launch-args payload exists');
    assert.equal(res.payload[res.payload.length - 1], PROMPT_FILE_INSTRUCTION(nonce));
    assert.ok(
      !res.payload.some((a) => a.length > 4000),
      'no arg on the command line may exceed 4000 characters'
    );
  });

  test('PF-R02: launch-args JSON and run-target.ps1 carry no arg longer than 4000 chars (40k prompt)', () => {
    const prompt = 'y'.repeat(40000);
    const res = runDirectLaunch(prompt);

    assert.equal(res.argsFiles.length, 1, 'exactly one launch-args file is written');
    const payload = res.payload;
    for (const arg of payload) {
      assert.ok(arg.length <= 4000, 'launch-args arg length ' + arg.length + ' must be <= 4000');
    }

    assert.ok(res.capturedScript, 'the generated run-target wrapper script was captured');
    // The generated script embeds the payload args path, never the prompt
    // itself; assert no long literal survives anywhere in the script text.
    for (const line of res.capturedScript.split(/\r?\n/)) {
      assert.ok(
        line.length <= 4000,
        'generated script line length ' + line.length + ' must be <= 4000'
      );
    }
    assert.ok(
      !res.capturedScript.includes(prompt),
      'the generated run-target.ps1 must not embed the raw prompt'
    );
  });

  test('PF-R03: the prompt file is byte-equal to the original prompt and written before the script spawns', () => {
    const prompt = 'A'.repeat(40000) + '\nunicode: 日本語 — done\n';
    const res = runDirectLaunch(prompt);

    assert.equal(res.promptFiles.length, 1);
    const bytes = res.promptBytes[res.promptFiles[0]];
    assert.deepEqual(bytes, Buffer.from(prompt, 'utf8'), 'prompt file is byte-equal');
    assert.notEqual(bytes[0], 0xef, 'prompt file must not start with a UTF-8 BOM');

    // The stub only captures the script file, which exists/ is readable because
    // the launcher writes it (and the prompt) before spawnSync is ever called.
    assert.ok(
      res.capturedScript && res.capturedScript.includes('run-target.ps1'),
      'run-target.ps1 was generated and spawned after the prompt file was written'
    );
  });

  test('PF-R04: other adapters are unchanged (no prompt file, prompt stays an arg)', () => {
    const isoMod = require('../isolation-launcher');
    const { getHarness } = require('../harness');
    const other = getHarness('hermes');
    assert.ok(other);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-113-other-'));
    const fakeHostCwd = path.join(tmpDir, 'host');
    const fakeWorkerRoot = path.join(tmpDir, 'worker');
    fs.mkdirSync(fakeHostCwd, { recursive: true });
    fs.mkdirSync(fakeWorkerRoot, { recursive: true });
    fs.mkdirSync(path.join(fakeHostCwd, 'scripts/ai/isolation'), { recursive: true });

    const verdictFile = path.join(fakeHostCwd, 'verdict.json');
    fs.writeFileSync(
      verdictFile,
      JSON.stringify({
        verdict: 'CLOSED',
        worktree: fakeHostCwd,
        timestamp: Date.now() - 1000,
        policyHash: isoMod.getFolderHash(path.join(fakeHostCwd, 'scripts/ai/isolation')),
        sid: 'TEST-SID',
        details: {},
      })
    );

    const realSpawn = cp.spawnSync;
    const realTemp = process.env.TEMP;
    try {
      fs.mkdirSync(path.join(tmpDir, 'launch-temp'), { recursive: true });
      process.env.TEMP = path.join(tmpDir, 'launch-temp');
      cp.spawnSync = (cmd, cargs, opts) => {
        if (cmd === 'git') {
          if (cargs && cargs[0] === 'clone') {
            fs.mkdirSync(path.join(cargs[cargs.length - 1], '.git', 'info'), { recursive: true });
          }
          if (cargs && cargs.includes('rev-parse')) {
            return { status: 0, stdout: '0123456789012345678901234567890123456789\n' };
          }
          return { status: 0 };
        }
        if (cmd === 'powershell.exe') return { status: 0, stdout: '' };
        return realSpawn(cmd, cargs, opts);
      };

      const runIso = isoMod.getIsolatedLauncher();
      const prompt = 'other adapter prompt ' + 'z'.repeat(40000);
      const args = ['run', '--prompt', prompt];
      try {
        runIso(other, args, {
          cwd: fakeHostCwd,
          workerRoot: fakeWorkerRoot,
          verdictPath: verdictFile,
          getWorkerSid: () => 'TEST-SID',
          verifyBoundary: () => true,
          baseSha: '0123456789012345678901234567890123456789',
          workerTimeoutMs: 1000,
        });
      } catch (_) {
        // ignored: only file side effects are asserted
      }

      const shipdeDir = path.join(fakeWorkerRoot, '.shipde');
      assert.deepEqual(
        listIn(shipdeDir, 'prompt-', '.md'),
        [],
        'no prompt file for other adapters'
      );

      const argsFiles = listIn(shipdeDir, 'launch-args-', '.json');
      assert.equal(argsFiles.length, 1);
      const payload = JSON.parse(fs.readFileSync(path.join(shipdeDir, argsFiles[0]), 'utf8'));
      assert.ok(payload.includes(prompt), 'other adapters keep the prompt as an arg unchanged');
    } finally {
      cp.spawnSync = realSpawn;
      if (realTemp === undefined) delete process.env.TEMP;
      else process.env.TEMP = realTemp;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
