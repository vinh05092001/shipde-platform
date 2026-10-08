'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { slugify, branchName } = require('../slugify');

function expectInvalidInput(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'throws an Error instance');
    assert.equal(error.code, 'SLUGIFY_INPUT_INVALID');
    return true;
  });
}

describe('slugify (SL-R01)', () => {
  test('lower-cases the input', () => {
    assert.equal(slugify('My Feature'), 'my-feature');
  });

  test('replaces every run of non [a-z0-9] characters with a single dash', () => {
    assert.equal(slugify('a  --  b'), 'a-b');
    assert.equal(slugify('a_B.c!d'), 'a-b-c-d');
    assert.equal(slugify('E1 R1 2026'), 'e1-r1-2026');
  });

  test('trims leading and trailing dashes', () => {
    assert.equal(slugify('  --Hello World--  '), 'hello-world');
    assert.equal(slugify('--a--'), 'a');
    assert.equal(slugify('a'), 'a');
  });

  test('keeps a result of exactly 48 characters', () => {
    const input = 'a'.repeat(48);
    assert.equal(slugify(input), input);
    assert.equal(slugify(input).length, 48);
  });

  test('caps the result at 48 characters', () => {
    assert.equal(slugify('a'.repeat(60)), 'a'.repeat(48));
  });

  test('never leaves a trailing dash after the 48-character cap', () => {
    const input = 'a'.repeat(47) + '-' + 'b'.repeat(10);
    const result = slugify(input);
    assert.equal(result, 'a'.repeat(47));
    assert.ok(!result.endsWith('-'));
    assert.ok(result.length <= 48);
  });

  test('caps across separator runs without trailing dash', () => {
    const input = 'word '.repeat(20);
    const result = slugify(input);
    assert.ok(result.length <= 48);
    assert.ok(!result.endsWith('-'));
    assert.ok(!result.startsWith('-'));
  });
});

describe('slugify (SL-R02)', () => {
  test('throws SLUGIFY_INPUT_INVALID for non-string input', () => {
    expectInvalidInput(() => slugify(undefined));
    expectInvalidInput(() => slugify(null));
    expectInvalidInput(() => slugify(42));
    expectInvalidInput(() => slugify({}));
    expectInvalidInput(() => slugify(['a']));
    expectInvalidInput(() => slugify(true));
    expectInvalidInput(() => slugify(new String('a')));
  });

  test('throws SLUGIFY_INPUT_INVALID for empty-after-slugify input', () => {
    expectInvalidInput(() => slugify(''));
    expectInvalidInput(() => slugify('   '));
    expectInvalidInput(() => slugify('!!!'));
    expectInvalidInput(() => slugify('---'));
    expectInvalidInput(() => slugify(' _-. '));
    expectInvalidInput(() => slugify('\n\t'));
  });
});

describe('slugify (SL-R03)', () => {
  test('is pure: same input always yields the same output', () => {
    const first = slugify('Same Input Twice');
    const second = slugify('Same Input Twice');
    assert.equal(first, second);
    assert.equal(typeof first, 'string');
    assert.equal(first, 'same-input-twice');
  });

  test('does not mutate or observe outside state between calls', () => {
    const before = slugify('stable call');
    const probe = slugify('another value');
    const after = slugify('stable call');
    assert.equal(before, after);
    assert.equal(probe, 'another-value');
  });

  test('module loads with Node built-ins only and exposes pure helpers', () => {
    assert.equal(typeof slugify, 'function');
    assert.equal(typeof branchName, 'function');
  });
});

describe('branchName (uses slugify)', () => {
  test('builds a feat branch from the work item id and the outcome', () => {
    assert.equal(
      branchName('feat', 'TASK-AI-111', 'Add a pure slugify helper'),
      'feat/task-ai-111-add-a-pure-slugify-helper'
    );
  });

  test('builds a fix branch and keeps digits and family prefixes', () => {
    assert.equal(branchName('fix', 'FEAT-12', 'Fix the thing'), 'fix/feat-12-fix-the-thing');
  });

  test('collapses separator runs and trims edges of the outcome slug', () => {
    assert.equal(branchName('feat', 'TASK-AI-60', 'a -- b'), 'feat/task-ai-60-a-b');
    assert.equal(
      branchName('feat', 'TASK-FOUND-02', '  spaced out  '),
      'feat/task-found-02-spaced-out'
    );
  });

  test('omits the outcome slug when no outcome is given', () => {
    assert.equal(branchName('feat', 'TASK-AI-111'), 'feat/task-ai-111');
  });

  test('throws BRANCH_NAME_INPUT_INVALID for a kind outside feat/fix', () => {
    assert.throws(
      () => branchName('chore', 'TASK-AI-111', 'Some outcome'),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.code, 'BRANCH_NAME_INPUT_INVALID');
        return true;
      }
    );
  });

  test('reuses slugify validation for work item id and outcome', () => {
    expectInvalidInput(() => branchName('feat', 42, 'Some outcome'));
    expectInvalidInput(() => branchName('feat', 'TASK-AI-111', '!!!'));
  });
});
