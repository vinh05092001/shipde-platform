'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { acceptanceRows, renderSpec, render } = require('../../openspec-check/render');

const matrix = `# X

## Acceptance matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| AC-1 | user submits \`code\` | session is issued | e2e |
| AC-2 | wrong code | error shown | unit |

## Verification commands
| not | a | row | here |
`;

test('reads only the acceptance matrix rows', () => {
  assert.deepEqual(acceptanceRows(matrix), [
    { id: 'AC-1', scenario: 'user submits `code`', expected: 'session is issued' },
    { id: 'AC-2', scenario: 'wrong code', expected: 'error shown' },
  ]);
  assert.equal(acceptanceRows('# no matrix'), null);
});

test('renders one OpenSpec requirement and scenario per row', () => {
  const spec = renderSpec('FEAT-X', acceptanceRows(matrix));
  assert.match(spec, /### Requirement: AC-1\nThe Work Item SHALL satisfy: session is issued/);
  assert.match(spec, /- \*\*WHEN\*\* user submits code\n- \*\*THEN\*\* session is issued/);
});

test('writes ephemeral specs and reports items without a matrix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osc-'));
  fs.mkdirSync(path.join(dir, 'wi'));
  fs.writeFileSync(path.join(dir, 'wi', 'FEAT-X.md'), matrix);
  fs.writeFileSync(path.join(dir, 'wi', 'TASK-Y.md'), '# none');
  const out = render(path.join(dir, 'wi'), path.join(dir, 'out'));
  assert.deepEqual(out, { rendered: [{ id: 'FEAT-X', requirements: 2 }], skipped: ['TASK-Y'] });
  assert.ok(fs.existsSync(path.join(dir, 'out/openspec/specs/feat-x/spec.md')));
  fs.rmSync(dir, { recursive: true, force: true });
});
