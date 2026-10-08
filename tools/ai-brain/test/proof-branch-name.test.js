'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { slugify } = require('../slugify');
const { branchNameFor, BRANCH_NAME_INPUT_INVALID } = require('../branch-name');

function assertCoded(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'error is an Error');
    assert.equal(error.code, code);
    return true;
  });
}

test('branchNameFor derives feat/<lower-cased work item id>-<slugified title>', () => {
  assert.equal(
    branchNameFor('TASK-AI-112', 'Add Branch Name Helper!'),
    'feat/task-ai-112-add-branch-name-helper'
  );
});

test('branchNameFor composes feat/<lower-cased id>-<slugify(title)> with the shared helper', () => {
  const id = 'TASK-AI-112';
  const title = 'Add Branch Name Helper!';
  assert.equal(branchNameFor(id, title), 'feat/' + id.toLowerCase() + '-' + slugify(title));
});

test('branchNameFor always emits the feat prefix and lower-cases a FEAT id', () => {
  assert.equal(branchNameFor('FEAT-12', 'Fix the thing'), 'feat/feat-12-fix-the-thing');
});

test('branchNameFor keeps digits and the TASK-FOUND family', () => {
  assert.equal(branchNameFor('TASK-FOUND-02', 'E1 R1 2026'), 'feat/task-found-02-e1-r1-2026');
});

test('branchNameFor slugs the title exactly like the shared helper', () => {
  assert.equal(branchNameFor('TASK-AI-112', 'a -- b'), 'feat/task-ai-112-a-b');
  assert.equal(branchNameFor('TASK-AI-112', '  spaced out  '), 'feat/task-ai-112-spaced-out');
  const long = 'w'.repeat(60);
  assert.equal(branchNameFor('TASK-AI-112', long), 'feat/task-ai-112-' + slugify(long));
  assert.equal(branchNameFor('TASK-AI-112', long).length, 'feat/task-ai-112-'.length + 48);
});

test('branchNameFor throws BRANCH_NAME_INPUT_INVALID for a lower-case work item id', () => {
  assertCoded(
    () => branchNameFor('task-ai-112', 'Add Branch Name Helper'),
    BRANCH_NAME_INPUT_INVALID
  );
});

test('branchNameFor throws BRANCH_NAME_INPUT_INVALID outside the TASK and FEAT families', () => {
  for (const bad of ['BUG-1', 'TASKX-1', 'FEAT', 'TASK-', 'TASK-AI-112 extra']) {
    assertCoded(() => branchNameFor(bad, 'Add Branch Name Helper'), BRANCH_NAME_INPUT_INVALID);
  }
});

test('branchNameFor throws BRANCH_NAME_INPUT_INVALID for a non-string or empty id', () => {
  for (const bad of [null, undefined, 42, {}, [], '', '   ']) {
    assertCoded(() => branchNameFor(bad, 'Add Branch Name Helper'), BRANCH_NAME_INPUT_INVALID);
  }
});

test('branchNameFor reuses the TASK-AI-111 slugify helper instead of re-implementing it', () => {
  const slugifyPath = require.resolve('../slugify');
  const branchPath = require.resolve('../branch-name');
  const slugifyExports = require.cache[slugifyPath].exports;
  const cachedBranch = require.cache[branchPath];
  const originalSlugify = slugifyExports.slugify;
  delete require.cache[branchPath];
  try {
    slugifyExports.slugify = () => 'patched-slug';
    const fresh = require('../branch-name');
    assert.equal(
      fresh.branchNameFor('TASK-AI-112', 'Any Title'),
      'feat/task-ai-112-patched-slug'
    );
  } finally {
    slugifyExports.slugify = originalSlugify;
    delete require.cache[branchPath];
    if (cachedBranch) require.cache[branchPath] = cachedBranch;
  }
  assert.equal(
    branchNameFor('TASK-AI-112', 'Any Title'),
    'feat/task-ai-112-' + slugify('Any Title')
  );
});

test('branchNameFor surfaces SLUGIFY_INPUT_INVALID for a title the shared helper refuses', () => {
  for (const bad of [null, undefined, 42, '!!!', '   ']) {
    assertCoded(() => branchNameFor('TASK-AI-112', bad), 'SLUGIFY_INPUT_INVALID');
  }
});

test('branchNameFor is pure across calls', () => {
  const id = 'TASK-AI-112';
  const title = 'Repeat  Me!!';
  const first = branchNameFor(id, title);
  const second = branchNameFor(id, title);
  assert.equal(first, second);
  assert.equal(first, 'feat/task-ai-112-repeat-me');
  assert.equal(title, 'Repeat  Me!!');
});
