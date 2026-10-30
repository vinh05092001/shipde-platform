'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncWriterCombo } = require('../ninerouter-combo');
const { readLaunchResult } = require('../isolation-launcher');

test('syncWriterCombo never replaces a combo with an empty member list', async () => {
  const res = await syncWriterCombo({ models: [], port: 1 });
  assert.equal(res.skipped, 'EMPTY_MODEL_LIST');
  assert.equal(res.updated, false);
  assert.equal(res.created, false);
});

test('readLaunchResult keeps the opencode API error from stdout when stderr is empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-'));
  const file = path.join(dir, 'r.json');
  const nonce = 'abc';
  const event = {
    type: 'error',
    error: { name: 'APIError', data: { message: 'Invalid model format', statusCode: 400 } },
  };
  fs.writeFileSync(
    file,
    JSON.stringify({
      exitCode: 1,
      completed: true,
      completionNonce: nonce,
      stdout: JSON.stringify(event) + '\r\n',
      stderr: '',
    })
  );
  const res = readLaunchResult(file, nonce, {});
  assert.equal(res.exitCode, 1);
  assert.match(res.stderr, /OPENCODE_ERROR: Invalid model format \(HTTP 400\)/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readLaunchResult adds no opencode error on success', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-'));
  const file = path.join(dir, 'r.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ exitCode: 0, completed: true, completionNonce: 'n', stdout: '', stderr: '' })
  );
  assert.equal(readLaunchResult(file, 'n', {}).stderr, '');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('UNPARSED host gate failure records exit status, signal and output tail', () => {
  const { runHostBrainGate } = require('../orchestrate');
  const spawnSync = () => ({
    status: null,
    signal: 'SIGTERM',
    stdout: 'line one\n',
    stderr: 'Error: Cannot find module x\n',
  });
  const res = runHostBrainGate({ baseSha: 'f'.repeat(40) }, { spawnSync, baseCache: new Map() });
  assert.deepEqual(res.failures, ['UNPARSED_FAILURE']);
  assert.match(res.summary[0], /exit status=none signal=SIGTERM/);
  assert.ok(res.summary.some((l) => /Cannot find module x/.test(l)));
});
