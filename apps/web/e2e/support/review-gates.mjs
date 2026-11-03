import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { scanFileForA11y } from '../../../../scripts/verify-a11y.ts';

// Run with node --test: these checks do not require React or database services.
// SHIPDE_REVIEW_REVISION allows the same tests to inspect the reviewed commit
// without replacing dirty files, rebasing, resetting or changing any gate.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const revision = process.env.SHIPDE_REVIEW_REVISION;
const gitShow = (ref, file) => execFileSync('git', ['show', `${ref}:${file}`], { cwd: root });
const source = (file) => (revision ? gitShow(revision, file) : readFileSync(join(root, file)));
const normalized = (buffer) => buffer.toString('utf8').replaceAll('\r\n', '\n').trimEnd();
const register = 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv';
const rows = (buffer) => normalized(buffer).split('\n');
const isTask = (row) => row.split('","')[3] === 'TASK-AI-155';

test('review 1: ported components pass the actual application accessibility scanner', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'task-ai-155-a11y-'));
  try {
    for (const directory of ['data-table', 'dashboard']) {
      const relative = `apps/web/src/components/${directory}`;
      for (const name of readdirSync(join(root, relative)).filter((name) => /\.tsx?$/.test(name))) {
        const fixture = join(scratch, name);
        writeFileSync(fixture, source(`${relative}/${name}`));
        assert.deepEqual(scanFileForA11y(fixture), [], `${relative}/${name}`);
      }
    }
    // Verify the actual scanner still rejects a hidden interactive control.
    const forbidden = join(scratch, 'hidden-button.tsx');
    writeFileSync(forbidden, '<button aria-hidden="true">Thử lại</button>');
    assert.ok(scanFileForA11y(forbidden).includes(
      'Found interactive element incorrectly marked with aria-hidden="true"'
    ));
  } finally {
    // scratch is the exact directory returned by mkdtemp, inside the OS tempdir.
    assert.equal(dirname(resolve(scratch)), resolve(tmpdir()));
    rmSync(scratch, { recursive: true });
  }
});

test('review 6: approved handoff documents match origin/main', () => {
  for (const file of [
    'docs/product-spec/work-items/FEAT-COM-09.md',
    'docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md',
    'docs/product-spec/docs/00-control/TRACEABILITY.md',
  ]) {
    assert.equal(normalized(source(file)), normalized(gitShow('origin/main', file)), file);
  }
});

test('review 6: every unrelated delivery register row is preserved', () => {
  const actual = rows(source(register)).filter((row) => !isTask(row));
  const expected = rows(gitShow('origin/main', register)).filter((row) => !isTask(row));
  assert.deepEqual(actual, expected, 'Only the TASK-AI-155 register row may differ');
});

test('review 6: delivery register has one row per Work Item', () => {
  const entries = rows(source(register)).slice(1);
  assert.equal(entries.filter(isTask).length, 1, 'Exactly one TASK-AI-155 row');
  const ids = entries.map((row) => row.split('","')[3]);
  assert.equal(new Set(ids).size, ids.length, 'No duplicate Work Item rows');
});

test('review 5: void gate findings remain outside the PR delta', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
    cwd: root, encoding: 'utf8',
  }).trim().split('\n');
  assert.deepEqual(changed.filter((file) => file.startsWith('.github/') || file === '.gitleaksignore'), []);
});
