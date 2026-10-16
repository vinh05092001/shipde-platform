'use strict';

// validate_docs.py treats Controller goal rows (feature id GOAL-*) in the
// delivery register as planned goal items, not as product features missing
// from the catalogue. Live 16/10: PR #356 [GOAL-AUTOCLAW-REPOS-1] failed CI
// with "feature-register-extra: GOAL-AUTOCLAW-REPOS".

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..', '..', '..');
const python = ['python', 'python3'].find(
  (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0
);

test(
  'a goal row in the delivery register is not a feature-register-extra',
  { skip: !python },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-docs-'));
    try {
      const spec = path.join(root, 'docs', 'product-spec');
      fs.cpSync(path.join(repo, 'docs', 'product-spec'), spec, { recursive: true });
      // Repository-level control files the validator also requires.
      const list = spawnSync(
        python,
        [
          '-c',
          'import sys; sys.path.insert(0, sys.argv[1]); import validate_docs as v; print("\\n".join(v.REPOSITORY_REQUIRED))',
          path.join(spec, 'scripts'),
        ],
        { encoding: 'utf8' }
      );
      for (const rel of list.stdout.split(/\r?\n/).filter(Boolean)) {
        const from = path.join(repo, rel);
        if (!fs.existsSync(from)) continue;
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.copyFileSync(from, path.join(root, rel));
      }
      const register = path.join(
        spec,
        'docs',
        '10-ai-collaboration',
        'FEATURE-DELIVERY-REGISTER.csv'
      );
      const header = fs.readFileSync(register, 'utf8').split(/\r?\n/)[0];
      const columns = header.split(',').length;
      const cells = [
        '9001',
        'GOAL',
        'Goal: CANARY',
        'GOAL-CANARY-1',
        'GOAL-CANARY',
        'Canary',
        'Canary row',
        'BACKLOG',
      ];
      while (cells.length < columns) cells.push('');
      fs.appendFileSync(register, cells.map((c) => `"${c}"`).join(',') + '\n');

      const res = spawnSync(python, [path.join(spec, 'scripts', 'validate_docs.py')], {
        cwd: root,
        encoding: 'utf8',
      });
      const out = res.stdout + res.stderr;
      assert.ok(!/feature-register-extra: GOAL-CANARY/.test(out), out);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);
