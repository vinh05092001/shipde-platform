'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN_DIR = path.resolve(__dirname, '..');

test('TASK-AI-189 AC2: dead Lát A modules are removed', () => {
  for (const rel of ['agy-gateway.js', 'shadow.js', 'eval/compression-eval.js']) {
    assert.equal(
      fs.existsSync(path.join(BRAIN_DIR, rel)),
      false,
      `${rel} should be deleted in Lát A`
    );
  }
});

test('TASK-AI-189 AC1: removed subcommands are no longer exported or routed', () => {
  const cli = require('../cli');
  const commands = require('../cli/commands');
  const reconcileManifest = require('../cli/reconcile-manifest');

  assert.equal(commands.shadowCommand, undefined);
  assert.equal(reconcileManifest.proveCommand, undefined);
  assert.equal(typeof cli.main, 'function');
  assert.equal(typeof cli.intakeCommand, 'function');
  assert.equal(typeof cli.orchestrateCommand, 'function');
  assert.equal(typeof cli.tokenReportCommand, 'function');

  const cliSource = fs.readFileSync(path.join(BRAIN_DIR, 'cli.js'), 'utf8');
  assert.doesNotMatch(cliSource, /command === ['"]agy-gateway['"]/);
  assert.doesNotMatch(cliSource, /command === ['"]shadow['"]/);
  assert.doesNotMatch(cliSource, /command === ['"]prove['"]/);
});
