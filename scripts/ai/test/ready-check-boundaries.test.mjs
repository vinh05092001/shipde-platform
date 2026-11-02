import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
