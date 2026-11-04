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

test('checks separate acceptance sections once and locates every missing Proof', () => {
  const result = checkWorkItemReady(
    `${valid}\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n| AC-03 | TBD |\n`
  );
  assert.equal(result.problems.length, 2);
  assert.ok(result.problems.every((problem) => /^line \d+:.*Proof/.test(problem)));
});

test('rejects duplicated Proof headers and surplus cells that shift a blank Proof', () => {
  for (const content of [
    valid.replace('| Scenario |', '| Proof |'),
    valid.replace('Existing behaviour', 'A | B').replace('`preserves-existing-behaviour`', ''),
  ]) {
    assert.equal(checkWorkItemReady(content).ok, false);
  }
});

test('checks compact Markdown delimiter rows instead of skipping their missing Proof', () => {
  assert.equal(
    checkWorkItemReady(valid.replace('| --- | --- | --- |', '| :- | -: | :-: |')).ok,
    true
  );
  const text = `${valid}\n| AC | Proof |\n| - | - |\n| AC-02 | |\n`;
  assert.ok(checkWorkItemReady(text).problems.some((problem) => problem.includes('Proof')));
});

test('reports every marker, including multiline questions, at its opening line', () => {
  const text = `${valid}\n[NEEDS CLARIFICATION: first\nquestion] [NEEDS CLARIFICATION]\n`;
  const lines = text.split('\n');
  const result = checkWorkItemReady(text);
  assert.deepEqual(result.problems, [
    `line ${lines.indexOf('[NEEDS CLARIFICATION: first') + 1}: unresolved NEEDS CLARIFICATION marker`,
    `line ${lines.indexOf('question] [NEEDS CLARIFICATION]') + 1}: unresolved NEEDS CLARIFICATION marker`,
  ]);
});

test('fenced questions without a marker still block authoring', () => {
  const text = valid.replace('## Open questions', '## Open questions\n\n```\nWho owns this?\n```');
  assert.ok(
    checkWorkItemReady(text).problems.some((problem) => problem.includes('Open questions'))
  );
});

test('fenced evidence cannot provide an acceptance matrix or source reference', () => {
  assert.equal(
    checkWorkItemReady(valid.replace('## Acceptance matrix', '## Acceptance matrix\n\n```')).ok,
    false
  );
  assert.equal(checkWorkItemReady(valid.replace(source, `~~~~md\n${source}\n~~~\n~~~~`)).ok, false);
});

test('a comment token inside a fenced example does not hide subsequent acceptance rows', () => {
  const text = `${valid}\n\`\`\`html\n<!--\n\`\`\`\n\n### Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  assert.ok(checkWorkItemReady(text).problems.some((problem) => problem.includes('Proof')));
});

test('headings in comments or fences do not close the real source section', () => {
  const text = valid.replace(
    source,
    `<!--\n## Fake\n-->\n\n\`\`\`md\n## Fake\n\`\`\`\n\n${source}`
  );
  assert.equal(checkWorkItemReady(text).ok, true);
});

test('unchanged behaviour cannot consist solely of an empty table', () => {
  const text = valid.replace(
    /## Unchanged behaviour[\s\S]*?(?=## Acceptance)/,
    '## Unchanged behaviour\n\n| Behaviour | Regression test |\n| --- | --- |\n\n'
  );
  assert.ok(
    checkWorkItemReady(text).problems.some((problem) => problem.includes('Unchanged behaviour'))
  );
});

const withBehaviour = (body) =>
  valid.replace(
    /## Unchanged behaviour[\s\S]*?(?=## Acceptance)/,
    `## Unchanged behaviour\n\n${body}\n\n`
  );
const provedBehaviour =
  '- Existing CLI input remains read-only; regression test: `ready-cli-does-not-write`.';
const provedTable =
  '| Preserved behaviour | Regression test |\n| --- | --- |\n| CLI remains read-only | `ready-cli-does-not-write` |';

for (const [name, body] of [
  ['bullet before a table', `- Existing diagnostics stay masked.\n\n${provedTable}`],
  ['bullet after a table', `${provedTable}\n\n- Existing diagnostics stay masked.`],
  ['paragraph after a table', `${provedTable}\n\nExisting diagnostics stay masked.`],
  [
    'nested section after a table',
    `${provedTable}\n\n### Diagnostics\n\n- Existing diagnostics stay masked.`,
  ],
  [
    'paragraph across a heading',
    'Existing diagnostics stay masked.\n### CLI\nExisting CLI input remains read-only; regression test: `ready-cli-does-not-write`.',
  ],
  ['regression mentioned without proof', '- Existing regression coverage remains available.'],
  [
    'regression word prefix without proof',
    '- Existing behaviour and regression testing remain available.',
  ],
  [
    'regression words before a placeholder proof',
    '- Existing regression tests remain available; regression test: TODO: choose a test',
  ],
]) {
  test(`rejects unproved Unchanged behaviour: ${name}`, () => {
    const result = checkWorkItemReady(withBehaviour(body));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('Unchanged behaviour')));
  });
}

test('rejects Unchanged behaviour table rows with missing or surplus cells', () => {
  for (const body of [
    provedTable.replace(
      'CLI remains read-only |',
      'CLI remains read-only | Unproved extra behaviour |'
    ),
    provedTable
      .replace('| Regression test |', '| Regression test | Notes |')
      .replace('| --- | --- |', '| --- | --- | --- |'),
  ]) {
    const result = checkWorkItemReady(withBehaviour(body));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('Unchanged behaviour')));
  }
});

test('rejects an unproved Unchanged behaviour table beside a proved bullet', () => {
  const result = checkWorkItemReady(
    withBehaviour(
      `${provedBehaviour}\n\n| Behaviour | Regression test |\n| --- | --- |\n| Existing diagnostics stay masked | |`
    )
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Unchanged behaviour')));
});

test('rejects commented Unchanged behaviour beside an empty code span', () => {
  const result = checkWorkItemReady(
    withBehaviour(
      '- ` ` <!-- Existing CLI input remains read-only; regression test: ready-cli-does-not-write -->'
    )
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Unchanged behaviour')));
});

test('dependency-free CLI accepts a valid Work Item after production install', () => {
  const scriptPath = fileURLToPath(new URL('../ready-check.mjs', import.meta.url));
  const fixturePath = fileURLToPath(new URL('fixtures/ready-check/valid.md', import.meta.url));
  const result = spawnSync(process.execPath, [scriptPath, fixturePath], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /PASS: Work Item is ready for authoring/);
});

for (const label of ['**regression test**:', 'regression **proof**:', '*regression command*:']) {
  test(`rejects placeholder Unchanged behaviour proof after ${label}`, () => {
    const result = checkWorkItemReady(
      withBehaviour(`- Existing CLI input remains read-only; ${label} TODO: choose a test`)
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('Unchanged behaviour')));
  });
}

test('accepts Unchanged behaviour with complete mixed and continued regression proofs', () => {
  for (const body of [
    `${provedBehaviour}\n\n${provedTable}\n\nExisting diagnostics stay masked; regression proof: \`ready-cli-masks-errors\`.`,
    '- Existing CLI input remains read-only;\n  regression test: `ready-cli-does-not-write`.',
    '- Existing CLI input remains read-only.\n  - Regression test: `ready-cli-does-not-write`.',
    '1. Existing CLI input remains read-only; **regression test**: `ready-cli-does-not-write`.',
    provedTable.replace(/^\| | \|$/gm, '').replaceAll('\n', '\r\n'),
  ]) {
    assert.deepEqual(checkWorkItemReady(withBehaviour(body)), { ok: true, problems: [] });
  }
});

for (const proof of [
  '`TODO`—choose a test',
  '**TBD**; verification command',
  '[TODO] choose a test',
  '[TBD](#planned-check)',
  'TBD： verification command',
  'TODO! choose a test',
]) {
  test(`rejects placeholder Proof with punctuation: ${proof}`, () => {
    const result = checkWorkItemReady(valid.replace('`preserves-existing-behaviour`', proof));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes('Proof')));
  });
}

test('accepts named Proof and commands that discuss unresolved placeholders', () => {
  for (const proof of [
    '`rejects TODO and TBD placeholders`',
    '`node --test scripts/ai/test/ready-check.test.mjs`',
    '`pendingWorkItemTests`',
  ]) {
    assert.deepEqual(checkWorkItemReady(valid.replace('`preserves-existing-behaviour`', proof)), {
      ok: true,
      problems: [],
    });
  }
});

test('rejects angle-placeholder Proof with explanatory suffix', () => {
  const result = checkWorkItemReady(
    valid.replace(
      '`preserves-existing-behaviour`',
      '<test name or runnable command> — select after assignment'
    )
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('Proof')));
});

test('rejects source links inside blockquoted fenced examples', () => {
  const result = checkWorkItemReady(
    valid.replace(source, '> ~~~text\n> https://example.com/spec\n> ~~~')
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

test('rejects source links inside list-nested fenced examples', () => {
  const result = checkWorkItemReady(
    valid.replace(source, '- Example:\n\n    ~~~text\n    https://example.com/spec\n    ~~~')
  );
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.includes('source-document')));
});

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
  assert.deepEqual(currentPkg.devDependencies, originPkg.devDependencies);
  assert.deepEqual(currentPkg.peerDependencies, originPkg.peerDependencies);
  assert.deepEqual(currentPkg.optionalDependencies, originPkg.optionalDependencies);
});

function runCliOnText(text) {
  const tmpPath = join(tmpdir(), `ready-check-boundary-${Date.now()}-${Math.random().toString(36).slice(2)}.md`);
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

test('production CLI rejects blank Proof after a complete backtick code span', () => {
  const text = `${valid}\n\`\`\`example\`\`\`\n\n## Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`;
  const result = runCliOnText(text);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Proof/);
});
