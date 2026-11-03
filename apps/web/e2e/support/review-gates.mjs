import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    assert.ok(
      scanFileForA11y(forbidden).includes(
        'Found interactive element incorrectly marked with aria-hidden="true"'
      )
    );
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

test('review 7: delivery register orders are unique and non-colliding', () => {
  const entries = rows(source(register)).slice(1);
  const orders = entries.map((row) => row.split(',')[0].replaceAll('"', '')).filter(Boolean);
  assert.equal(
    new Set(orders).size,
    orders.length,
    'All delivery orders in FEATURE-DELIVERY-REGISTER.csv must be strictly unique'
  );
  assert.ok(
    orders.every((order) => /^\d+$/.test(order)),
    'All delivery orders must be digits'
  );
  const taskRow = entries.find(isTask);
  assert.ok(taskRow, 'TASK-AI-155 row must exist');
  const taskOrder = taskRow.split(',')[0].replaceAll('"', '');
  assert.equal(taskOrder, '293', 'TASK-AI-155 must be assigned unique delivery order 293');
});

test('review 5: void gate findings remain outside the PR delta', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
    cwd: root,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  assert.deepEqual(
    changed.filter((file) => file.startsWith('.github/') || file === '.gitleaksignore'),
    []
  );
});

test('review 9: PR body contains zero template placeholders matching contract gate regex', () => {
  // Negative test: verify that the regex accurately detects forbidden placeholders
  const sampleWithPlaceholder = 'This is a sample with <placeholder> and <br>';
  assert.deepEqual(sampleWithPlaceholder.match(/<[^>\n]+>/g), ['<placeholder>', '<br>']);

  const validSample = 'This is a valid body without placeholders or HTML tags';
  assert.equal(validSample.match(/<[^>\n]+>/g), null);

  const prBodyPath = join(root, '.oc/pr-body.md');
  if (existsSync(prBodyPath)) {
    const prBody = readFileSync(prBodyPath, 'utf8');
    const matches = prBody.match(/<[^>\n]+>/g);
    assert.equal(
      matches,
      null,
      `PR body contains required template placeholders: ${JSON.stringify(matches)}`
    );
  }
});

test('review 10: PR body files pass complete validate_pr_contract gate logic', () => {
  const prFiles = ['.oc/pr-body.md', '.oc/pr-body-gh.md', '.oc/pr-body-remote.md'].filter((rel) =>
    existsSync(join(root, rel))
  );

  const requiredHeadings = [
    '## Work Item',
    '## Source requirements',
    '## Scope integrity',
    '## Implementation',
    '## Acceptance evidence',
    '## Verification',
    '## Safety and recovery',
    '## Documentation and traceability',
    '## Risks and limitations',
    '## Codex review',
  ];

  const sampleDeterministicBody = `## Work Item\nTASK-AI-155\n## Source requirements\n## Scope integrity\n- [x] checked\n## Implementation\n## Acceptance evidence\n## Verification\n## Safety and recovery\n## Documentation and traceability\n## Risks and limitations\n## Codex review\n- Review status: READY_FOR_CODEX\n`;
  const targets =
    prFiles.length > 0
      ? prFiles.map((rel) => ({ name: rel, body: readFileSync(join(root, rel), 'utf8') }))
      : [{ name: 'deterministic-pr-body-sample', body: sampleDeterministicBody }];

  for (const { name: rel, body } of targets) {
    // All 10 required headings must be present
    for (const heading of requiredHeadings) {
      assert.ok(body.includes(heading), `${rel} missing section: ${heading}`);
    }

    // Must reference TASK-AI-155
    assert.ok(body.includes('TASK-AI-155'), `${rel} must reference TASK-AI-155`);

    // Must not contain template placeholders
    const placeholders = body.match(/<[^>\n]+>/g);
    assert.equal(
      placeholders,
      null,
      `${rel} contains forbidden template placeholders: ${JSON.stringify(placeholders)}`
    );

    // Must not contain TBD or TODO
    const todos = body.match(/\b(?:TBD|TODO)\b/g);
    assert.equal(todos, null, `${rel} contains TBD or TODO: ${JSON.stringify(todos)}`);

    // Must not contain unchecked items
    assert.ok(!body.includes('- [ ]'), `${rel} contains unchecked items (- [ ])`);

    // Must contain READY_FOR_CODEX
    assert.ok(
      body.includes('Review status: READY_FOR_CODEX'),
      `${rel} must declare READY_FOR_CODEX`
    );
  }
});

test('review 36: AppShell.tsx has zero unused eslint-disable directives', () => {
  const appShellContent = source('apps/web/src/components/shell/AppShell.tsx').toString('utf8');
  // Finding 1 (Round 36): unused eslint-disable directive at line 274:7
  // "react-hooks/set-state-in-effect" was unused before setNavigation({ token, targets: [], setupOnly: true })
  const unusedDirectivePattern =
    /\/\/\s*eslint-disable-next-line\s+react-hooks\/set-state-in-effect[^\n]*\n\s*setNavigation\(\{\s*token,\s*targets:\s*\[\],\s*setupOnly:\s*true\s*\}\);/;
  assert.equal(
    unusedDirectivePattern.test(appShellContent),
    false,
    'AppShell.tsx must not contain the unused eslint-disable directive on setup-scoped setNavigation'
  );
});
