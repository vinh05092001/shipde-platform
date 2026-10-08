'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { slugify } = require('../slugify');
const { branchNameFor } = require('../branch-name');

function assertCoded(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.code, code);
    return true;
  });
}

test('branchNameFor derives feat/<lower-cased id>-<slug(title)>', () => {
  assert.equal(
    branchNameFor('TASK-AI-112', 'add a pure branch-name helper'),
    'feat/task-ai-112-add-a-pure-branch-name-helper'
  );
});

test('branchNameFor always prefixes feat and lower-cases a FEAT id', () => {
  assert.equal(branchNameFor('FEAT-12', 'Fix the thing'), 'feat/feat-12-fix-the-thing');
});

test('branchNameFor keeps digits and TASK-FOUND ids', () => {
  assert.equal(branchNameFor('TASK-FOUND-02', 'E1 R1 2026'), 'feat/task-found-02-e1-r1-2026');
});

test('branchNameFor slugs the title exactly like the slugify helper', () => {
  assert.equal(branchNameFor('TASK-AI-60', 'a -- b'), 'feat/task-ai-60-a-b');
  assert.equal(branchNameFor('TASK-AI-60', '  spaced out  '), 'feat/task-ai-60-spaced-out');
  assert.equal(
    branchNameFor('TASK-AI-60', 'w'.repeat(60)),
    'feat/task-ai-60-' + slugify('w'.repeat(60))
  );
  assert.equal(branchNameFor('TASK-AI-60', 'w'.repeat(60)).length, 'feat/task-ai-60-'.length + 48);
});

test('branchNameFor throws BRANCH_NAME_INPUT_INVALID for a lower-case work item id', () => {
  assertCoded(() => branchNameFor('task-ai-112', 'add a pure branch-name helper'), 'BRANCH_NAME_INPUT_INVALID');
});

test('branchNameFor throws BRANCH_NAME_INPUT_INVALID outside the TASK and FEAT families', () => {
  for (const bad of ['BUG-1', 'TASKX-1', 'FEAT', 'TASK-', 'TASK-AI-112 extra']) {
    assertCoded(() => branchNameFor(bad, 'add a pure branch-name helper'), 'BRANCH_NAME_INPUT_INVALID');
  }
});

test('branchNameFor throws BRANCH_NAME_INPUT_INVALID for a non-string or empty work item id', () => {
  for (const bad of [null, undefined, 42, {}, [], '', '   ']) {
    assertCoded(() => branchNameFor(bad, 'add a pure branch-name helper'), 'BRANCH_NAME_INPUT_INVALID');
  }
});

test('branchNameFor accepts every work item id family the pattern allows', () => {
  for (const id of ['TASK-AI-112', 'TASK-FOUND-02', 'FEAT-12', 'TASK-1', 'FEAT-A-B-9']) {
    assert.equal(typeof branchNameFor(id, 'add a pure branch-name helper'), 'string');
  }
});

test('branchNameFor lets the reused slugify helper reject a bad title', () => {
  for (const bad of [null, undefined, 42, '!!!', '   ']) {
    assertCoded(() => branchNameFor('TASK-AI-112', bad), 'SLUGIFY_INPUT_INVALID');
  }
});

test('branchNameFor is pure and deterministic', () => {
  const id = 'TASK-AI-112';
  const title = 'Repeat  Me!!';
  const first = branchNameFor(id, title);
  const second = branchNameFor(id, title);
  assert.equal(first, second);
  assert.equal(first, 'feat/task-ai-112-repeat-me');
  assert.equal(title, 'Repeat  Me!!');
});

test('branchNameFor reuses the slugify helper from TASK-AI-111 instead of re-implementing it', () => {
  const slugifyPath = require.resolve('../slugify');
  const branchPath = require.resolve('../branch-name');
  const branchModule = require.cache[branchPath];
  const slugifyExports = require.cache[slugifyPath].exports;
  const originalSlugify = slugifyExports.slugify;
  delete require.cache[branchPath];
  try {
    slugifyExports.slugify = () => 'patched-slug';
    const fresh = require('../branch-name');
    assert.equal(typeof fresh.branchNameFor, 'function');
    assert.equal(fresh.branchNameFor('TASK-AI-112', 'Any Title'), 'feat/task-ai-112-patched-slug');
  } finally {
    slugifyExports.slugify = originalSlugify;
    delete require.cache[branchPath];
    if (branchModule) require.cache[branchPath] = branchModule;
  }
  assert.equal(
    branchNameFor('TASK-AI-112', 'Any Title'),
    'feat/task-ai-112-' + slugify('Any Title')
  );
});
