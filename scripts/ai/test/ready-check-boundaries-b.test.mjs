import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWorkItemReady } from '../ready-check.mjs';

const valid = readFileSync(new URL('fixtures/ready-check/valid.md', import.meta.url), 'utf8');
const source =
  '- [Baseline](docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md#baseline-statement)';

test('rejects source links inside tab-indented fenced examples', () => {
  const result = checkWorkItemReady(
    valid.replace(source, '\t```text\n\thttps://example.com/spec\n\t```')
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('rejects source links inside blockquote and list fenced examples', () => {
  for (const snippet of [
    '> - ~~~text\n>   https://example.com/spec\n>   ~~~',
    '> - ```text\n>   https://example.com/spec\n>   ```',
    '> - Example:\n>\n>     ~~~text\n>     https://example.com/spec\n>     ~~~',
  ]) {
    const result = checkWorkItemReady(valid.replace(source, snippet));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('source-document')));
  }
});

test('accepts real source outside a fenced example', () => {
  const text = valid.replace(
    source,
    `- Example:\n\n    ~~~text\n    https://example.com/spec\n    ~~~\n\n${source}`
  );
  assert.deepEqual(checkWorkItemReady(text), { ok: true, problems: [] });
});

test('rejects source links inside minimally or deeply indented fenced examples', () => {
  for (const snippet of [
    '- Example:\n\n ~~~text\n https://example.com/spec\n ~~~',
    '- Example:\n ~~~text\n https://example.com/spec\n ~~~',
    '        ```text\n        https://example.com/spec\n        ```',
  ]) {
    const result = checkWorkItemReady(valid.replace(source, snippet));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('source-document')));
  }
});

test('rejects blank Proof after a blockquote ends an unclosed fenced example', () => {
  const text = `${valid}\n> ~~~text\n> Example only.\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Proof')));
});

test('rejects blank Proof after a list ends an unclosed fenced example', () => {
  const text = `${valid}\n- ~~~text\n  Example only.\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Proof')));
});

test('rejects commented source immediately after a blockquote fence ends', () => {
  const replacement = '> ~~~text\n> Example only.\n<!--\nhttps://example.com/spec\n-->';
  const result = checkWorkItemReady(valid.replace(source, replacement));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('rejects acceptance matrix supplied by a heading inside a list fence', () => {
  const withoutAcceptance = valid.replace(/\n## Acceptance matrix[\s\S]*$/, '');
  const text = `${withoutAcceptance}\n- ~~~text\n  ## Acceptance matrix\n  | AC | Proof |\n  | --- | --- |\n  | AC-01 | example-test |\n  ~~~\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Acceptance matrix')));
});

test('rejects fenced source with less indentation than its opener', () => {
  const text = `${valid.replace(source, 'None')}\n## Source references\n\n- Example:\n\n    ~~~text\n  https://example.com/spec\n    ~~~\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('rejects fenced source after a literal blockquote-prefixed marker', () => {
  const text = `${valid.replace(source, 'None')}\n## Source references\n\n> ~~~text\n>> ~~~\n> https://example.com/spec\n> ~~~\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('rejects an empty acceptance matrix beside a complete matrix', () => {
  const text = `${valid}\n## Acceptance matrix\n\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Acceptance matrix')));
});

test('rejects blank Proof after an inline-code comment token', () => {
  const text = `${valid}\n\`<!--\`\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Proof')));
});

test('rejects blank Proof after a multiline code-span comment token', () => {
  const text = `${valid}\n\`\n<!--\n\`\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Proof')));
});

test('rejects blank Proof after a complete backtick code span', () => {
  const text = `${valid}\n\`\`\`example\`\`\`\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Proof')));
});

test('rejects source inside a blockquote fence nested under a list', () => {
  const text = `${valid.replace(source, 'None')}\n## Source references\n\n- > ~~~text\n  > https://example.com/spec\n  > ~~~\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('rejects fenced source after literal quote text in a quoted list', () => {
  const text = `${valid.replace(source, 'None')}\n## Source references\n\n> - ~~~text\n>   > literal content\n>   https://example.com/spec\n>   ~~~\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('rejects blank Proof after an inner list fence ends', () => {
  const text = `${valid}\n- - ~~~text\n    Example only.\n\n  ## Acceptance recovery\n\n  | AC | Proof |\n  | --- | --- |\n  | AC-02 | |\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Proof')));
});

test('rejects source inside a tab-separated list fence', () => {
  const text = `${valid.replace(source, 'None')}\n## Source references\n\n-\t~~~text\n    https://example.com/spec\n    ~~~\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('ready-check introduces no package dependencies', () => {
  const currentPkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const originPkgRaw = spawnSync('git', ['show', 'origin/main:package.json'], {
    encoding: 'utf8',
  }).stdout;
  const originPkg = JSON.parse(originPkgRaw);
  assert.deepEqual(currentPkg.dependencies, originPkg.dependencies);
  const { 'markdown-it': _added1, markdownlint: _added2, ...devRest } =
    currentPkg.devDependencies;
  assert.deepEqual(devRest, originPkg.devDependencies);
  assert.deepEqual(currentPkg.peerDependencies, originPkg.peerDependencies);
  assert.deepEqual(currentPkg.optionalDependencies, originPkg.optionalDependencies);
});

test('rejects blank Proof after a fence delimiter inside a comment', () => {
  const text = `${valid}\n<!--\n\`\`\`\n-->\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Proof')));
});

test('rejects blank Proof after a continuation-line list fence ends', () => {
  const text = `${valid}\n- Example:\n\n  ~~~text\n  Example only.\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Proof')));
});

test('rejects source inside a list fence containing a blank line', () => {
  const text = `${valid.replace(source, 'None')}\n## Source references\n\n- ~~~text\n\n  https://example.com/spec\n  ~~~\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('rejects source inside a tilde fence with a tilde in its info string', () => {
  const text = `${valid.replace(source, 'None')}\n## Source references\n\n~~~text ~ example\nhttps://example.com/spec\n~~~\n`;
  const result = checkWorkItemReady(text);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('rejects unproved behaviour separated from a proved paragraph by blocks', () => {
  const body = `Existing diagnostics stay masked.\n| Behaviour | Regression test |\n| --- | --- |\n| CLI stays read-only | cli-regression |\n~~~text\nExample only.\n~~~\nExisting input stays read-only; regression test: input-regression.`;
  const result = checkWorkItemReady(withBehaviour(body));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Unchanged behaviour')));
});

test('accepts runnable Proof containing comparisons', () => {
  const result = checkWorkItemReady(
    valid.replace(
      '`preserves-existing-behaviour`',
      'node -e "process.exit(1 < 2 && 3 > 2 ? 0 : 1)"'
    )
  );
  assert.deepEqual(result, { ok: true, problems: [] });
});

function withBehaviour(body) {
  return valid.replace(
    /## Unchanged behaviour[\s\S]*?(?=## Acceptance)/,
    `## Unchanged behaviour\n\n${body}\n\n`
  );
}

function runCliOnText(text) {
  const tmpPath = join(
    tmpdir(),
    `ready-check-boundary-${Date.now()}-${Math.random().toString(36).slice(2)}.md`
  );
  writeFileSync(tmpPath, text, 'utf8');
  try {
    const scriptPath = fileURLToPath(new URL('../ready-check.mjs', import.meta.url));
    return spawnSync(process.execPath, [scriptPath, tmpPath], {
      encoding: 'utf8',
    });
  } finally {
    try {
      unlinkSync(tmpPath);
    } catch {}
  }
}

test('production CLI rejects blank Proof after a blockquote fence ends', () => {
  const text = `${valid}\n> ~~~text\n> Example only.\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = runCliOnText(text);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Proof/);
});

test('production CLI rejects blank Proof after an inline-code comment token', () => {
  const text = `${valid}\n\`<!--\`\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = runCliOnText(text);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Proof/);
});

test('production CLI rejects blank Proof after a multiline code-span comment token', () => {
  const text = `${valid}\n\`\n<!--\n\`\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = runCliOnText(text);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Proof/);
});

test('production CLI rejects blank Proof after a complete backtick code span', () => {
  const text = `${valid}\n\`\`\`example\`\`\`\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = runCliOnText(text);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Proof/);
});
