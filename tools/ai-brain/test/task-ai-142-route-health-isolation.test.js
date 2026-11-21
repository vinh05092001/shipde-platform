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
