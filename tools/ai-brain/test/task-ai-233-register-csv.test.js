'use strict';

// TASK-AI-233: the real delivery register must pass the same strict CSV parser
// the PR contract gate uses (validate_pr_contract.read_register). 21 records
// once carried an extra empty trailing field, which made every maintenance PR
// touching the register fail closed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..', '..');
const SCRIPTS = path.join(repo, 'docs', 'product-spec', 'scripts');
const REGISTER = path.join(
  repo,
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'FEATURE-DELIVERY-REGISTER.csv'
);
const python = ['python', 'python3'].find(
  (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0
);

test('the checked-out register passes the gate strict CSV parser', () => {
  // No silent skip: without Python the gate itself cannot run, so this check must fail.
  assert.ok(python, 'Python is required to run the PR contract parser');
  const program = [
    'import sys',
    'sys.path.insert(0, sys.argv[1])',
    'import validate_pr_contract as v',
    'text = open(sys.argv[2], encoding="utf-8", newline="").read()',
    'header, rows = v.read_register(text, "checkout")',
    'print(len(header), len(rows))',
  ].join('\n');
  const res = spawnSync(python, ['-c', program, SCRIPTS, REGISTER], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const [columns, rows] = res.stdout.trim().split(/\s+/).map(Number);
  assert.equal(columns, 14);
  assert.ok(rows > 300, `expected the full register, got ${rows} rows`);
});
