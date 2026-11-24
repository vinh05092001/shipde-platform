'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN_DIR = path.resolve(__dirname, '..');
const cli = require('../cli');

test('Lat C-2b-2: legacy cli/dispatch.js is deleted and cli.js no longer exports dispatchCommand or executeDispatchLaunch', () => {
  assert.equal(
    fs.existsSync(path.join(BRAIN_DIR, 'cli', 'dispatch.js')),
    false,
    'tools/ai-brain/cli/dispatch.js must be deleted'
  );
  assert.equal(cli.dispatchCommand, undefined);
  assert.equal(cli.executeDispatchLaunch, undefined);
  assert.equal(typeof cli.intakeCommand, 'function');
  assert.equal(typeof cli.orchestrateCommand, 'function');
});

test('Lat C-2b-2: cli.js dispatch fails closed with DISPATCH_RETIRED and exitCode 1', () => {
  const errors = [];
  const origError = console.error;
  const prevExitCode = process.exitCode;
  console.error = (msg) => errors.push(String(msg));
  try {
    const res = cli.main(['dispatch', '--dry-run']);
    assert.equal(res && res.exitCode, 1);
    assert.equal(res && res.error, 'DISPATCH_RETIRED');
    assert.equal(process.exitCode, 1);
    assert.ok(errors.some((line) => line.includes('DISPATCH_RETIRED')));
  } finally {
    console.error = origError;
    process.exitCode = prevExitCode;
  }
});
