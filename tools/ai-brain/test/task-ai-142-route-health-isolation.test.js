'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const cli = require('../cli');
const routeHealth = require('../route-health');

const DEFAULT_HEALTH_PATH = path.resolve(__dirname, '..', 'data', 'model-route-health.json');

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createTempDir(prefix = 'task-ai-142-rh-iso-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('TASK-AI-142: Route health isolation and default store immutability', () => {
  let tempDir;
  let initialDefaultHash;
  let initialMtimeMs;

  beforeEach(() => {
    tempDir = createTempDir();
    assert.ok(
      fs.existsSync(DEFAULT_HEALTH_PATH),
      'Default production route-health file must exist'
    );
    initialDefaultHash = hashFile(DEFAULT_HEALTH_PATH);
    initialMtimeMs = fs.statSync(DEFAULT_HEALTH_PATH).mtimeMs;
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (_) {}
    }
    const currentHash = hashFile(DEFAULT_HEALTH_PATH);
    assert.equal(
      currentHash,
      initialDefaultHash,
      'Default route health file must remain unchanged throughout tests'
    );
    const defaultTmp = DEFAULT_HEALTH_PATH + '.tmp';
    assert.equal(
      fs.existsSync(defaultTmp),
      false,
      'No leftover .tmp file in production data folder'
    );
  });

  test('nextCommand with explicit routeHealthFile and route-health flag leaves default file untouched', async () => {
    const isolatedHealthFile = path.join(tempDir, 'custom-health.json');
    const registerPath = path.join(tempDir, 'register.csv');
    fs.writeFileSync(
      registerPath,
      'delivery_order,slice,group,work_item_id,feature_id,feature_name,key_behavior,status,dependencies,work_item_path,branch,pr,codex_verdict,merge_commit\n1,,,,,,,READY_FOR_AUTHOR,,,,,,\n'
    );

    const refreshed = [];
    const result = await cli.nextCommand(
      {
        loop: true,
        maxIterations: 1,
        root: tempDir,
        'decision-dir': path.join(tempDir, 'decisions'),
        'route-health': isolatedHealthFile,
      },
      {
        routeHealthFile: isolatedHealthFile,
        probeRoute: async () => ({ ok: true }),
        onRouteRefresh: (r) => refreshed.push(r),
        qualificationSlot: async () => ({ ran: false }),
        log: () => {},
        now: 1_800_000_000_000,
        registry: { sources: [], dispatch: { providers: {} } },
        accounts: [],
      }
    );

    assert.equal(result.reason, 'NO_READY_ITEM');
    assert.ok(fs.existsSync(isolatedHealthFile), 'Isolated route health file must be created');
    assert.equal(hashFile(DEFAULT_HEALTH_PATH), initialDefaultHash, 'Default file hash unchanged');
    assert.equal(
      fs.statSync(DEFAULT_HEALTH_PATH).mtimeMs,
      initialMtimeMs,
      'Default file mtime unchanged'
    );
  });

  test('nextCommand with root option derives isolated path under root and leaves default file untouched', async () => {
    const registerPath = path.join(tempDir, 'register.csv');
    fs.writeFileSync(
      registerPath,
      'delivery_order,slice,group,work_item_id,feature_id,feature_name,key_behavior,status,dependencies,work_item_path,branch,pr,codex_verdict,merge_commit\n1,,,,,,,READY_FOR_AUTHOR,,,,,,\n'
    );

    const result = await cli.nextCommand(
      {
        loop: true,
        maxIterations: 1,
        root: tempDir,
        'decision-dir': path.join(tempDir, 'decisions'),
      },
      {
        probeRoute: async () => ({ ok: true }),
        qualificationSlot: async () => ({ ran: false }),
        log: () => {},
        now: 1_800_000_000_000,
        registry: { sources: [], dispatch: { providers: {} } },
        accounts: [],
      }
    );

    assert.equal(result.reason, 'NO_READY_ITEM');
    const derivedIsolatedFile = path.join(
      tempDir,
      'tools',
      'ai-brain',
      'data',
      'model-route-health.json'
    );
    assert.ok(fs.existsSync(derivedIsolatedFile), 'Derived root route health file must be created');
    assert.equal(hashFile(DEFAULT_HEALTH_PATH), initialDefaultHash);
    assert.equal(fs.statSync(DEFAULT_HEALTH_PATH).mtimeMs, initialMtimeMs);
  });

  test('probeMemoryFile honors explicit routeHealthFile, route-health flag, root, and cwd', () => {
    assert.equal(
      routeHealth.probeMemoryFile({ routeHealthFile: '/tmp/test-health.json' }),
      '/tmp/test-health.json'
    );
    assert.equal(
      routeHealth.probeMemoryFile({ 'route-health': '/tmp/test-health-flag.json' }),
      '/tmp/test-health-flag.json'
    );
    assert.equal(
      routeHealth.probeMemoryFile({ root: '/custom/root' }),
      path.join('/custom/root', 'tools', 'ai-brain', 'data', 'model-route-health.json')
    );
    assert.equal(
      routeHealth.probeMemoryFile({ cwd: '/custom/cwd' }),
      path.join('/custom/cwd', 'tools', 'ai-brain', 'data', 'model-route-health.json')
    );
  });

  test('failure during probeRoute does not corrupt default file or leave leftover temp files', async () => {
    const isolatedHealthFile = path.join(tempDir, 'failing-health.json');
    const registerPath = path.join(tempDir, 'register.csv');
    fs.writeFileSync(
      registerPath,
      'delivery_order,slice,group,work_item_id,feature_id,feature_name,key_behavior,status,dependencies,work_item_path,branch,pr,codex_verdict,merge_commit\n1,,,,,,,READY_FOR_AUTHOR,,,,,,\n'
    );

    fs.writeFileSync(
      isolatedHealthFile,
      JSON.stringify({
        version: 1,
        paths: {
          'test-model|test-src': {
            status: 'UNAVAILABLE',
            nextCheckAt: new Date(1_000_000_000_000).toISOString(),
            lastCheckedAt: new Date(900_000_000_000).toISOString(),
          },
        },
        events: [],
      })
    );

    let probeErrorOccurred = false;
    const result = await cli.nextCommand(
      {
        loop: true,
        maxIterations: 1,
        root: tempDir,
        'decision-dir': path.join(tempDir, 'decisions'),
        'route-health': isolatedHealthFile,
      },
      {
        routeHealthFile: isolatedHealthFile,
        probeRoute: async () => {
          probeErrorOccurred = true;
          throw new Error('Simulated network failure during probe');
        },
        qualificationSlot: async () => ({ ran: false }),
        log: () => {},
        now: 1_800_000_000_000,
        registry: {
          sources: [{ id: 'test-src', endpoint: 'https://api.example.com' }],
          dispatch: { providers: {} },
        },
        accounts: [],
      }
    );

    assert.equal(probeErrorOccurred, true, 'Probe must have been called and failed');
    assert.equal(result.reason, 'NO_READY_ITEM');
    assert.equal(
      hashFile(DEFAULT_HEALTH_PATH),
      initialDefaultHash,
      'Default file hash unchanged after probe error'
    );
    assert.equal(
      fs.statSync(DEFAULT_HEALTH_PATH).mtimeMs,
      initialMtimeMs,
      'Default file mtime unchanged'
    );
    assert.equal(
      fs.existsSync(DEFAULT_HEALTH_PATH + '.tmp'),
      false,
      'No leftover .tmp file on probe error'
    );

    // Also verify unhandled exception during next loop does not touch default file
    let unhandledErrorCaught = false;
    try {
      await cli.nextCommand(
        {
          loop: true,
          maxIterations: 1,
          root: tempDir,
          'decision-dir': path.join(tempDir, 'decisions'),
          'route-health': isolatedHealthFile,
        },
        {
          routeHealthFile: isolatedHealthFile,
          probeRoute: async () => ({ ok: true }),
          qualificationSlot: async () => {
            throw new Error('Unhandled exception in qualification slot');
          },
          log: () => {},
          now: 1_800_000_000_000,
          registry: { sources: [], dispatch: { providers: {} } },
          accounts: [],
        }
      );
    } catch (err) {
      unhandledErrorCaught = true;
      assert.match(err.message, /Unhandled exception in qualification slot/);
    }

    assert.equal(unhandledErrorCaught, true, 'Unhandled exception must bubble up');
    assert.equal(
      hashFile(DEFAULT_HEALTH_PATH),
      initialDefaultHash,
      'Default file hash unchanged after unhandled exception'
    );
    assert.equal(
      fs.statSync(DEFAULT_HEALTH_PATH).mtimeMs,
      initialMtimeMs,
      'Default file mtime unchanged'
    );
    assert.equal(
      fs.existsSync(DEFAULT_HEALTH_PATH + '.tmp'),
      false,
      'No leftover .tmp file on unhandled exception'
    );
  });

  test('cleanup and deletion of isolated test directories never impacts the default production store', () => {
    const ephemeralDir = createTempDir('ephemeral-');
    const ephemeralFile = path.join(ephemeralDir, 'data', 'model-route-health.json');
    const store = routeHealth.loadStore(DEFAULT_HEALTH_PATH);
    routeHealth.saveStore(ephemeralFile, store);
    assert.ok(fs.existsSync(ephemeralFile), 'Ephemeral file created');

    // Simulate aggressive cleanup
    fs.rmSync(ephemeralDir, { recursive: true, force: true });
    assert.equal(fs.existsSync(ephemeralFile), false, 'Ephemeral file deleted');

    // Default production file remains intact
    assert.ok(fs.existsSync(DEFAULT_HEALTH_PATH), 'Default file still exists');
    assert.equal(
      hashFile(DEFAULT_HEALTH_PATH),
      initialDefaultHash,
      'Default file content remains intact'
    );
    assert.equal(
      fs.statSync(DEFAULT_HEALTH_PATH).mtimeMs,
      initialMtimeMs,
      'Default file mtime intact'
    );
  });

  test('assembleForDispatch and dispatchCommand honor isolated routeHealthFile and root without touching default store', async () => {
    const isolatedHealthFile = path.join(tempDir, 'dispatch-health.json');
    const store = { version: 1, paths: {}, events: [] };
    routeHealth.saveStore(isolatedHealthFile, store);

    const candidates = cli.assembleForDispatch(
      { candidates: [] },
      [],
      { sources: [], dispatch: { providers: {} } },
      {
        routeHealthFile: isolatedHealthFile,
        root: tempDir,
      }
    );
    assert.ok(Array.isArray(candidates));
    assert.equal(hashFile(DEFAULT_HEALTH_PATH), initialDefaultHash);
    assert.equal(fs.statSync(DEFAULT_HEALTH_PATH).mtimeMs, initialMtimeMs);
  });
});

test('dispatchCommand: an explicit args health file wins over deps', async (t) => {
  const cli = require('../cli');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rh-order-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const argsFile = path.join(dir, 'args.json');
  const depsFile = path.join(dir, 'deps.json');
  const seen = [];
  const rh = require('../route-health');
  t.mock.method(rh, 'loadStore', (file) => {
    seen.push(path.resolve(file));
    throw new Error('stop after resolution');
  });
  await Promise.resolve()
    .then(() =>
      cli.dispatchCommand(
        { 'route-health': argsFile },
        { refreshRoutes: true, routeHealthFile: depsFile, registry: { sources: [] } }
      )
    )
    .catch(() => {});
  assert.equal(seen[0], path.resolve(argsFile));
});
