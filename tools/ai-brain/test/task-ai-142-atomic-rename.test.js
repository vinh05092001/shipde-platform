'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { atomicRenameSync } = require('../atomic-rename');
const routeHealth = require('../route-health');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-rename-test-'));
}

describe('TASK-AI-142 — Atomic writes retry transient Windows rename errors', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    }
  });

  test('saveStore with injected fs whose renameSync throws EPERM twice then succeeds (expect success, 3 calls)', () => {
    const healthFile = path.join(tempDir, 'data', 'model-route-health.json');
    const tmpFile = healthFile + '.tmp';
    const store = { version: 1, paths: { 'route-a': { status: 'AVAILABLE' } }, events: [] };

    let renameCalls = 0;
    const epermError = new Error('EPERM: operation not permitted, rename');
    epermError.code = 'EPERM';

    const injectedFs = Object.assign({}, fs, {
      renameSync(src, dst) {
        renameCalls++;
        if (renameCalls <= 2) {
          throw epermError;
        }
        return fs.renameSync(src, dst);
      },
    });

    // Option delays: [10, 10] to keep the test snappy while testing the retry loop
    routeHealth.saveStore(healthFile, store, { fs: injectedFs, delays: [10, 10] });

    assert.equal(renameCalls, 3, 'renameSync must be called exactly 3 times before succeeding');
    assert.equal(fs.existsSync(healthFile), true, 'target store file should exist');
    assert.equal(fs.existsSync(tmpFile), false, 'temporary file should be renamed away');

    const loaded = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    assert.equal(loaded.version, 1);
    assert.ok(loaded.paths['route-a']);
  });

  test('saveStore with injected fs whose renameSync always throws (expect original error and no .tmp left)', () => {
    const healthFile = path.join(tempDir, 'data', 'model-route-health.json');
    const tmpFile = healthFile + '.tmp';
    const store = { version: 1, paths: {}, events: [] };

    let renameCalls = 0;
    const persistentError = new Error('EPERM: operation not permitted, rename');
    persistentError.code = 'EPERM';

    const alwaysThrowingFs = Object.assign({}, fs, {
      renameSync(src, dst) {
        renameCalls++;
        throw persistentError;
      },
    });

    let caughtError = null;
    try {
      routeHealth.saveStore(healthFile, store, {
        fs: alwaysThrowingFs,
        maxAttempts: 10,
        delays: [5, 5, 5, 5, 5, 5, 5, 5, 5],
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'saveStore must throw when rename consistently fails');
    assert.equal(caughtError, persistentError, 'must throw the original error');
    assert.equal(renameCalls, 10, 'must attempt rename up to 10 times before failing');
    assert.equal(
      fs.existsSync(tmpFile),
      false,
      'leftover .tmp file must be removed on final failure'
    );
  });

  test('atomicRenameSync with injected fs whose renameSync throws EPERM twice then succeeds (expect success, 3 calls)', () => {
    const targetFile = path.join(tempDir, 'sample.json');
    const tmpFile = targetFile + '.tmp';
    fs.writeFileSync(tmpFile, '{"hello":"world"}\n', 'utf8');

    let renameCalls = 0;
    const epermError = new Error('EPERM: operation not permitted, rename');
    epermError.code = 'EPERM';

    const injectedFs = Object.assign({}, fs, {
      renameSync(src, dst) {
        renameCalls++;
        if (renameCalls <= 2) {
          throw epermError;
        }
        return fs.renameSync(src, dst);
      },
    });

    atomicRenameSync(tmpFile, targetFile, { fs: injectedFs, delays: [10, 10] });

    assert.equal(renameCalls, 3, 'atomicRenameSync must retry twice and succeed on 3rd call');
    assert.equal(fs.existsSync(targetFile), true, 'destination file must exist');
    assert.equal(fs.existsSync(tmpFile), false, 'source .tmp must no longer exist');
    assert.equal(fs.readFileSync(targetFile, 'utf8'), '{"hello":"world"}\n');
  });

  test('atomicRenameSync with injected fs whose renameSync always throws (expect original error and no .tmp left)', () => {
    const targetFile = path.join(tempDir, 'sample-fail.json');
    const tmpFile = targetFile + '.tmp';
    fs.writeFileSync(tmpFile, '{"test":"fail"}\n', 'utf8');

    let renameCalls = 0;
    const persistentError = new Error('EPERM: operation not permitted, rename');
    persistentError.code = 'EPERM';

    const alwaysThrowingFs = Object.assign({}, fs, {
      renameSync(src, dst) {
        renameCalls++;
        throw persistentError;
      },
    });

    let caughtError = null;
    try {
      atomicRenameSync(tmpFile, targetFile, {
        fs: alwaysThrowingFs,
        maxAttempts: 10,
        delays: [5, 5, 5, 5, 5, 5, 5, 5, 5],
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'must throw after attempts are exhausted');
    assert.equal(caughtError, persistentError, 'must throw the original error');
    assert.equal(renameCalls, 10, 'must execute 10 attempts');
    assert.equal(fs.existsSync(tmpFile), false, 'leftover .tmp file must be removed');
  });

  test('atomicRenameSync retries on EBUSY and EACCES', () => {
    const targetFile = path.join(tempDir, 'ebusy.json');
    const tmpFile = targetFile + '.tmp';
    fs.writeFileSync(tmpFile, 'ok\n', 'utf8');

    let renameCalls = 0;
    const ebusyError = new Error('EBUSY: resource busy or locked');
    ebusyError.code = 'EBUSY';
    const eaccesError = new Error('EACCES: permission denied');
    eaccesError.code = 'EACCES';

    const injectedFs = Object.assign({}, fs, {
      renameSync(src, dst) {
        renameCalls++;
        if (renameCalls === 1) throw ebusyError;
        if (renameCalls === 2) throw eaccesError;
        return fs.renameSync(src, dst);
      },
    });

    atomicRenameSync(tmpFile, targetFile, { fs: injectedFs, delays: [5, 5] });
    assert.equal(renameCalls, 3);
    assert.equal(fs.existsSync(targetFile), true);
  });

  test('atomicRenameSync does not retry non-transient errors (e.g. ENOENT)', () => {
    const targetFile = path.join(tempDir, 'nonexistent-parent', 'sample.json');
    const tmpFile = path.join(tempDir, 'sample-enoent.tmp');
    fs.writeFileSync(tmpFile, 'enoent\n', 'utf8');

    let renameCalls = 0;
    const enoentError = new Error('ENOENT: no such file or directory');
    enoentError.code = 'ENOENT';

    const injectedFs = Object.assign({}, fs, {
      renameSync(src, dst) {
        renameCalls++;
        throw enoentError;
      },
    });

    let caughtError = null;
    try {
      atomicRenameSync(tmpFile, targetFile, { fs: injectedFs, delays: [5] });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.equal(caughtError.code, 'ENOENT');
    assert.equal(renameCalls, 1, 'must fail immediately without retrying on non-retryable error');
    assert.equal(
      fs.existsSync(tmpFile),
      false,
      'must remove .tmp file even on non-retryable failure'
    );
  });

  test('atomicRenameSync works with default backoff schedule (no options.delays passed)', () => {
    const targetFile = path.join(tempDir, 'sample-default.json');
    const tmpFile = targetFile + '.tmp';
    fs.writeFileSync(tmpFile, 'default-delays\n', 'utf8');

    let renameCalls = 0;
    const epermError = new Error('EPERM: operation not permitted, rename');
    epermError.code = 'EPERM';

    const injectedFs = Object.assign({}, fs, {
      renameSync(src, dst) {
        renameCalls++;
        if (renameCalls <= 2) {
          throw epermError;
        }
        return fs.renameSync(src, dst);
      },
    });

    const start = Date.now();
    atomicRenameSync(tmpFile, targetFile, { fs: injectedFs });
    const elapsed = Date.now() - start;

    assert.equal(renameCalls, 3);
    assert.equal(fs.existsSync(targetFile), true);
    assert.equal(fs.existsSync(tmpFile), false);
    assert.ok(elapsed >= 100, 'elapsed time should reflect default backoff delays');
  });
});
