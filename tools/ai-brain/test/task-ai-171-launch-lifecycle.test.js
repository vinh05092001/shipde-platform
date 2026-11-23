'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getHarness } = require('../harness');
const { readSessionId } = require('../executor');

test('native AGY allocation identity reaches the existing receipt consumer and owned stop', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-native-handle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const usageFile = path.join(dir, 'report.json');
  const adapter = getHarness('agy-pool');
  const job = {
    accountId: 'agy01',
    model: 'gemini-4-argon-high',
    prompt: 'fixture',
    cwd: dir,
    usageFile,
  };
  const argv = adapter.launch(job, { fakeRunsDir: path.join(dir, 'pool') });
  assert.ok(Array.isArray(argv));
  const allocated = JSON.parse(
    fs.readFileSync(path.join(dir, 'pool', 'agy01', 'job.json'), 'utf8')
  );
  const handle = readSessionId(adapter, job, { exitCode: 0, stdout: 'scheduler accepted' }).id;
  assert.equal(handle, 'agy01/' + allocated.jobId);
  assert.deepEqual(adapter.stop(handle), ['/end', '/tn', 'ShipDe\\ShipDe-agy01']);
  assert.equal(readSessionId(adapter, { ...job, accountId: 'agy02' }, { exitCode: 0 }).id, null);
  assert.equal(readSessionId(adapter, job, { exitCode: 1 }).id, null);
  assert.equal(readSessionId(adapter, job, { exitCode: 0, accountId: 'agy02' }).id, null);
});

test('AGY report collision refuses before allocation and preserves the previous receipt', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-report-collision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const usageFile = path.join(dir, 'report.json');
  fs.writeFileSync(usageFile, 'prior receipt');
  assert.throws(
    () =>
      getHarness('agy-pool').launch(
        {
          accountId: 'agy01',
          cwd: dir,
          model: 'gemini-4-argon-high',
          prompt: 'fixture',
          usageFile,
        },
        { fakeRunsDir: path.join(dir, 'pool') }
      ),
    /EEXIST/
  );
  assert.equal(fs.readFileSync(usageFile, 'utf8'), 'prior receipt');
  assert.equal(fs.existsSync(path.join(dir, 'pool', 'agy01', 'job.json')), false);
});

test('locked writer result published between cleanup inspection and save is preserved', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-cleanup-race-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const adapter = getHarness('agy-pool');
  const lane = require('../lane-launcher');
  const job = {
    accountId: 'agy01',
    candidateKey: 'owned',
    cwd: root,
    prompt: 'fixture',
    model: 'gemini-4-argon-high',
    usageFile: path.join(root, 'usage.json'),
  };
  const opts = { fakeRunsDir: path.join(root, 'pool') };
  adapter.launch(job, opts);
  const dir = path.join(root, 'pool', 'agy01');
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
  const original = lane.saveResult;
  lane.saveResult = (dir, stored, outcome, options) => {
    original(dir, stored, { state: 'ok', exitCode: 0, reason: 'NATIVE_RESULT' });
    return original(dir, stored, outcome, options);
  };
  try {
    assert.equal(adapter.onLaunchFailed(job, { exitCode: 1 }, opts).pending, true);
    assert.equal(lane.readResult(dir, stored).reason, 'NATIVE_RESULT');
  } finally {
    lane.saveResult = original;
  }
});
