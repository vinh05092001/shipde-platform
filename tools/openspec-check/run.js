'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { render } = require('./render');

const rootDir = path.resolve(__dirname, '../..');
const bin = process.env.OPENSPEC_BIN;
const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-openspec-'));
const workItemsDir = 'docs/product-spec/work-items';
const { rendered, skipped } = render(path.join(rootDir, workItemsDir), outRoot);
// Gate only the Work Items this change touches; legacy matrices are reported, not blocking.
const base = process.env.BASE_SHA || 'origin/main';
let changed = null;
if (!process.env.OPENSPEC_GATE_ALL) {
  // A failed diff must not gate nothing: fall back to gating every Work Item.
  const diff = spawnSync('git', ['diff', '--name-only', `${base}...HEAD`, '--', workItemsDir], {
    cwd: rootDir,
    encoding: 'utf8',
  });
  if (diff.status === 0) {
    changed = diff.stdout
      .split(/\r?\n/)
      .filter((f) => f.endsWith('.md'))
      .map((f) => path.basename(f, '.md').toLowerCase());
  } else {
    console.error(`OPENSPEC_CHECK: git diff against ${base} failed; gating every Work Item`);
  }
}
const result = spawnSync(bin, ['validate', '--specs', '--strict', '--json', '--no-interactive'], {
  cwd: outRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32', // npm .cmd shim on Windows; fixed args only
  env: { ...process.env, OPENSPEC_TELEMETRY: '0' },
});
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  console.error(result.stdout, result.stderr);
  console.error('OPENSPEC_CHECK: validator output was not JSON');
  process.exit(1);
}
const invalid = report.items.filter((item) => !item.valid);
const failed = changed ? invalid.filter((item) => changed.includes(item.id)) : invalid;
for (const item of failed) {
  for (const issue of item.issues)
    console.error(`${item.id}: ${issue.level} ${issue.path || ''} ${issue.message}`);
}
console.log(
  `OPENSPEC_CHECK: ${report.items.length - invalid.length}/${report.items.length} Work Item acceptance matrices valid; ${skipped.length} without matrix; gated ${changed ? changed.length + ' changed' : 'all'}, ${failed.length} failing`
);
fs.rmSync(outRoot, { recursive: true, force: true });
if (failed.length || report.items.length !== rendered.length) process.exitCode = 1;
