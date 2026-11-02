import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkWorkItemReady } from '../ready-check.mjs';

const fixture = (name) =>
  fileURLToPath(new URL(`fixtures/ready-check/${name}.md`, import.meta.url));
const valid = readFileSync(fixture('valid'), 'utf8');
const check = (content) => checkWorkItemReady(content, true);
const cli = (...args) =>
  spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../ready-check.mjs', import.meta.url)), ...args],
    { encoding: 'utf8' }
  );

test('passes a complete Work Item fixture', () => {
  assert.deepEqual(check(valid), { ok: true, problems: [] });
});

for (const marker of [
  '[NEEDS CLARIFICATION]',
  '[NEEDS CLARIFICATION: owner?]',
  '`[NEEDS CLARIFICATION: owner?]`',
  '<!-- [NEEDS CLARIFICATION: owner?] -->',
  '```text\n[NEEDS CLARIFICATION: owner?]\n```',
  '~~~text\n[NEEDS CLARIFICATION: owner?]\n~~~',
]) {
  test(`rejects marker anywhere: ${JSON.stringify(marker)}`, () => {
    const result = check(`${valid}\n${marker}`);
    assert.equal(result.ok, false);
    assert.equal(result.problems.filter((p) => p.includes('CLARIFICATION')).length, 1);
  });
}

for (const proof of [
  '',
  '   ',
  '` `',
  '<!-- add proof -->',
  '`<test name or runnable command>`',
  'TBD',
  'N/A',
  'TODO: choose a test',
  'TBD: verification command',
  'TBD - verification command',
  'Pending: verification',
  'N/A: not applicable',
  '[TODO: choose a test]',
  'TBA: to be announced',
  'WIP: work in progress',
  'FIXME: broken proof',
  'placeholder: choose command',
  'TODO/TBD',
  '(TODO: choose a test)',
  'TODO (choose a test)',
  'Not applicable: no proof',
  'TBC: to be confirmed',
]) {
  test(`rejects missing or placeholder Proof: ${JSON.stringify(proof)}`, () => {
    const result = check(valid.replace('`preserves-existing-behaviour`', proof));
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes('Proof')));
  });
}

test('rejects a missing Proof column and a missing acceptance matrix', () => {
  for (const content of [
    valid.replace(
      '| AC/Test ID | Scenario | Proof |\n| --- | --- | --- |\n| AC-READY-01 | Existing behaviour | `preserves-existing-behaviour` |',
      '| AC/Test ID | Scenario |\n| --- | --- |\n| AC-READY-01 | Existing behaviour |'
    ),
    valid.slice(0, valid.indexOf('## Acceptance matrix')),
    valid.slice(0, valid.indexOf('| AC-READY-01')),
  ])
    assert.equal(check(content).ok, false);
});

test('does not mistake dashes in a scenario for a table separator', () => {
  const result = check(
    valid
      .replace('Existing behaviour', 'Handles --- literally')
      .replace('`preserves-existing-behaviour`', '')
  );
  assert.equal(result.ok, false);
});

test('checks every acceptance table, including nested sections', () => {
  const result = check(
    `${valid}\n### Acceptance recovery\n\n| AC | Proof |\n| --- | --- |\n| AC-02 | |\n`
  );
  assert.equal(result.ok, false);
  assert.equal(result.problems.filter((p) => p.includes('Proof')).length, 1);
});

test('supports CRLF, optional outer pipes, reordered Proof and escaped pipes', () => {
  assert.equal(check(valid.replaceAll('\n', '\r\n')).ok, true);
  assert.equal(check(valid.replace(/^\| | \|$/gm, '')).ok, true);
  const prefix = valid.slice(0, valid.indexOf('| AC/Test ID'));
  assert.equal(
    check(`${prefix}| Proof | Scenario |\n| :--- | ---: |\n| test-name | A \\| B |\n`).ok,
    true
  );
  assert.equal(
    check(
      valid.replace('Existing behaviour', 'A \\| B').replace('`preserves-existing-behaviour`', '')
    ).ok,
    false
  );
});

for (const body of [
  '',
  '<!--\nFill this later\n-->',
  '### Regression\n\n- ',
  '- `<behaviour>`: `<test>`',
  '- `<Existing behaviour to preserve>`: regression test `<test name or command>`',
  '- Existing CLI input remains read-only.',
  '- Existing CLI input remains read-only; regression test: `ready-cli-does-not-write`.\n- Preserved behaviour without regression proof.',
  '- Existing CLI input remains read-only; regression test: TODO: choose a test',
  '- Existing CLI input remains read-only; regression test: TBD: verification command',
  '- Existing CLI input remains read-only; regression test: WIP',
  '- Existing CLI input remains read-only; regression test: TBA: to be announced',
  '- Existing CLI input remains read-only (regression test: TODO)',
  '- Existing CLI input remains read-only; regression test:',
  '| Preserved behaviour | Regression test |\n| --- | --- |\n| CLI remains read-only | TODO: write test |',
  '| Preserved behaviour | Regression test |\n| --- | --- |\n| CLI remains read-only | `ready-cli-does-not-write` |\n| Another behaviour | |',
]) {
  test(`rejects empty or unproved Unchanged behaviour: ${JSON.stringify(body)}`, () => {
    const result = check(
      valid.replace(
        /## Unchanged behaviour[\s\S]*?(?=## Acceptance)/,
        `## Unchanged behaviour\n\n${body}\n\n`
      )
    );
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.includes('Unchanged behaviour')));
  });
}

test('accepts valid parenthesized and bracketed regression proof in Unchanged behaviour', () => {
  for (const item of [
    '- Existing CLI input remains read-only (regression test: `ready-cli-does-not-write`)',
    '- Existing CLI input remains read-only [regression test: ready-cli-does-not-write]',
    '| Preserved behaviour | Regression test |\n| --- | --- |\n| CLI remains read-only | `ready-cli-does-not-write` |',
  ]) {
    const result = check(
      valid.replace(
        /## Unchanged behaviour[\s\S]*?(?=## Acceptance)/,
        `## Unchanged behaviour\n\n${item}\n\n`
      )
    );
    assert.equal(result.ok, true);
  }
});

test('rejects absent Unchanged behaviour and content leaking from the next section', () => {
  assert.equal(check(valid.replace('## Unchanged behaviour', '## Something else')).ok, false);
  const content = valid.replace(
    /## Unchanged behaviour[\s\S]*?(?=## Acceptance)/,
    '## Unchanged behaviour\n\n## Other section\nUnrelated text\n\n'
  );
  assert.equal(check(content).ok, false);
});

test('nonempty Open questions must return to planning even without a marker', () => {
  assert.equal(
    check(valid.replace('## Open questions', '## Open questions\n\nWho owns this?')).ok,
    false
  );
});

test('requires a source reference, not an unrelated path or commented link', () => {
  const noSource = valid.replace(
    '- [Baseline](docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md#baseline-statement)',
    'None'
  );
  for (const content of [
    noSource,
    `${noSource}\nSee docs/example.md`,
    noSource.replace('None', '<!--\nhttps://example.com/spec\n-->'),
    noSource.replace('None', '```\nhttps://example.com/spec\n```'),
    noSource.replace('None', 'docs/'),
  ]) {
    assert.equal(check(content).ok, false);
    assert.ok(check(content).problems.some((p) => p.includes('source-document')));
  }
});

test('accepts repository paths and external source links', () => {
  const source =
    '- [Baseline](docs/product-spec/docs/00-control/BASELINE-AND-DECISIONS.md#baseline-statement)';
  for (const link of [
    '- `docs/spec.md` (Rule 1)',
    '- [Spec](../spec.md#rule)',
    '- [Spec](https://example.com/spec)',
    '- <https://example.com/spec>',
    '- `AGENTS.md` (Verification)',
  ])
    assert.equal(check(valid.replace(source, link)).ok, true);
});

test('CLI accepts a Work Item path without mutating the file', () => {
  const target = fixture('valid');
  const before = readFileSync(target);
  const result = cli(target);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS/);
  assert.deepEqual(readFileSync(target), before);
});

test('CLI prints exactly one line per problem and exits 1', () => {
  const result = cli(fixture('invalid'));
  assert.equal(result.status, 1);
  const lines = result.stderr.trim().split(/\r?\n/);
  assert.equal(lines.length, 4, result.stderr);
  for (const rule of ['CLARIFICATION', 'Proof', 'Unchanged behaviour', 'source-document']) {
    assert.equal(lines.filter((line) => line.includes(rule)).length, 1, result.stderr);
  }
  assert.equal(result.stdout, '');
});

test('CLI rejects missing/extra arguments, missing files and directories without a stack trace', () => {
  for (const args of [
    [],
    [fixture('valid'), 'extra'],
    [fixture('absent')],
    [fileURLToPath(new URL('.', import.meta.url))],
  ]) {
    const result = cli(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim().split(/\r?\n/).length, 1, result.stderr);
  }
});

for (const [name, rule] of [
  ['missing-regression', 'Unchanged behaviour'],
  ['placeholder-proof', 'Proof'],
]) {
  test(`CLI rejects ${name} with a masked diagnostic and preserves the file`, () => {
    const target = fixture(name);
    const before = readFileSync(target);
    const result = cli(target);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr.trim(), new RegExp(`^line \\d+: [^\\r\\n]*${rule}[^\\r\\n]*$`));
    assert.ok(!result.stderr.includes('synthetic-review-canary'));
    assert.ok(!result.stderr.includes(target));
    assert.deepEqual(readFileSync(target), before);
    const repeated = cli(target);
    assert.equal(repeated.status, result.status);
    assert.equal(repeated.stderr, result.stderr);
    assert.equal(repeated.stdout, result.stdout);
  });
}
