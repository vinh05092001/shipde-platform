'use strict';

const fs = require('node:fs');
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { slugify } = require('../slugify');
const { branchNameFor } = require('../branch-name');

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'throws an Error instance');
    assert.equal(error.code, code);
    return true;
  });
}

describe('branchNameFor (BN-R01)', () => {
  test('returns feat/<lower-cased work item id>-<slugified title>', () => {
    assert.equal(
      branchNameFor('TASK-AI-112', 'Add a pure branch-name helper'),
      'feat/task-ai-112-add-a-pure-branch-name-helper'
    );
    assert.equal(branchNameFor('FEAT-12', 'Fix the thing'), 'feat/feat-12-fix-the-thing');
    assert.equal(branchNameFor('TASK-FOUND-02', 'E1 R1 2026'), 'feat/task-found-02-e1-r1-2026');
  });

  test('matches the BN-R01 formula for every id and title', () => {
    const cases = [
      ['TASK-AI-112', 'A branch-name helper derives branches'],
      ['TASK-AI-60', 'a --  b'],
      ['TASK-AI-60', '  spaced out  '],
      ['FEAT-12', 'Fix the thing'],
      ['TASK-FOUND-02', 'E1 R1 2026'],
      ['TASK-AI-112', 'a'.repeat(60)],
      ['TASK-AI-112', 'a'.repeat(47) + '-' + 'b'.repeat(10)],
    ];
    for (const [workItemId, title] of cases) {
      assert.equal(
        branchNameFor(workItemId, title),
        'feat/' + workItemId.toLowerCase() + '-' + slugify(title)
      );
    }
  });

  test('lower-cases the work item id verbatim instead of slugifying it', () => {
    assert.equal(branchNameFor('TASK-AI--1', 'Outcome text'), 'feat/task-ai--1-outcome-text');
  });

  test('caps the title slug at 48 characters and never ends with a dash', () => {
    const expected = 'feat/task-ai-112-' + 'a'.repeat(48);
    assert.equal(branchNameFor('TASK-AI-112', 'a'.repeat(60)), expected);
    const capped = branchNameFor('TASK-AI-112', 'a'.repeat(47) + '-' + 'b'.repeat(10));
    assert.equal(capped, 'feat/task-ai-112-' + 'a'.repeat(47));
    assert.ok(!capped.endsWith('-'));
  });

  test('collapses title separator runs and trims title edges', () => {
    assert.equal(branchNameFor('TASK-AI-60', 'a --  b'), 'feat/task-ai-60-a-b');
    assert.equal(branchNameFor('TASK-AI-60', '  spaced out  '), 'feat/task-ai-60-spaced-out');
    assert.equal(branchNameFor('TASK-AI-60', 'Hello_World!'), 'feat/task-ai-60-hello-world');
  });
});

describe('branchNameFor (BN-R02)', () => {
  test('throws BRANCH_NAME_INPUT_INVALID for a work item id outside the pattern', () => {
    expectCode(() => branchNameFor('task-ai-112', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('feat-12', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('Task-AI-112', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('TASK-ai-112', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('BUG-1', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('CHORE-1', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('TASKAI-112', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('TASK-AI-112!', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('TASK-AI-112 ', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor(' TASK-AI-112', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('TASK-', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('FEAT-', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('TASK', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('FEAT', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor('', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor(' --- ', 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
  });

  test('throws BRANCH_NAME_INPUT_INVALID for a non-string work item id', () => {
    expectCode(() => branchNameFor(undefined, 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor(null, 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor(42, 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor(true, 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor({}, 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor(['TASK-AI-112'], 'Some outcome'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor(new String('TASK-AI-112'), 'S'), 'BRANCH_NAME_INPUT_INVALID');
    expectCode(() => branchNameFor(new String('FEAT-12'), 'S'), 'BRANCH_NAME_INPUT_INVALID');
  });

  test('validates the work item id before the title', () => {
    expectCode(() => branchNameFor('BUG-1', '!!!'), 'BRANCH_NAME_INPUT_INVALID');
  });
});

describe('branchNameFor (BN-R03) reuses the TASK-AI-111 slugify helper', () => {
  test('requires ./slugify instead of re-implementing the slug rule', () => {
    const source = fs.readFileSync(require.resolve('../branch-name'), 'utf8');
    assert.match(source, /require\((['"])\.\/slugify\1\)/);
    assert.doesNotMatch(source, /function\s+slugify/);
    assert.doesNotMatch(source, /\[\^a-z0-9\]/);
  });

  test('calls the slugify helper from ./slugify at runtime', () => {
    const slugifyPath = require.resolve('../slugify');
    const branchPath = require.resolve('../branch-name');
    const originalSlugify = require(slugifyPath).slugify;
    require(slugifyPath).slugify = () => 'patched-slug';
    delete require.cache[branchPath];
    try {
      const reloaded = require('../branch-name');
      const actual = reloaded.branchNameFor('TASK-AI-112', 'Some Title');
      assert.equal(actual, 'feat/task-ai-112-patched-slug');
    } finally {
      require(slugifyPath).slugify = originalSlugify;
      delete require.cache[branchPath];
      require('../branch-name');
    }
  });

  test('propagates slugify validation instead of duplicating it', () => {
    expectCode(() => branchNameFor('TASK-AI-112', '!!!'), 'SLUGIFY_INPUT_INVALID');
    expectCode(() => branchNameFor('TASK-AI-112', ''), 'SLUGIFY_INPUT_INVALID');
    expectCode(() => branchNameFor('TASK-AI-112', undefined), 'SLUGIFY_INPUT_INVALID');
    expectCode(() => branchNameFor('TASK-AI-112', 42), 'SLUGIFY_INPUT_INVALID');
  });
});
