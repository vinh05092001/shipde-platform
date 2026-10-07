'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { slugify, normalizeWorkItemBranch } = require('../slugify');

function assertCoded(fn, code) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof Error);
    assert.equal(err.code, code);
    return true;
  });
}

test('slugify lower-cases the input', () => {
  assert.equal(slugify('Foo BAR'), 'foo-bar');
});

test('slugify replaces each run of non [a-z0-9] with a single dash', () => {
  assert.equal(slugify('a--b__c!!d'), 'a-b-c-d');
  assert.equal(slugify('a!!!b'), 'a-b');
});

test('slugify trims leading and trailing dashes', () => {
  assert.equal(slugify('  spaced out  '), 'spaced-out');
  assert.equal(slugify('--x--'), 'x');
});

test('slugify keeps digits', () => {
  assert.equal(slugify('E1 R1 2026'), 'e1-r1-2026');
});

test('slugify maps letters outside a-z to separators', () => {
  assert.equal(slugify('ÜBER-Cool'), 'ber-cool');
});

test('slugify caps the result at 48 characters', () => {
  const out = slugify('w'.repeat(60));
  assert.equal(out, 'w'.repeat(48));
  assert.equal(out.length, 48);
});

test('slugify allows a result of exactly 48 characters', () => {
  assert.equal(slugify('a'.repeat(48)), 'a'.repeat(48));
});

test('slugify caps without leaving a trailing dash', () => {
  assert.equal(slugify('a'.repeat(47) + '-' + 'b'.repeat(10)), 'a'.repeat(47));
});

test('slugify throws SLUGIFY_INPUT_INVALID for non-string input', () => {
  for (const bad of [null, undefined, 42, {}, [], true]) {
    assertCoded(() => slugify(bad), 'SLUGIFY_INPUT_INVALID');
  }
});

test('slugify throws SLUGIFY_INPUT_INVALID when the input slugs to empty', () => {
  for (const bad of ['', '   ', '!!!', '-', '--']) {
    assertCoded(() => slugify(bad), 'SLUGIFY_INPUT_INVALID');
  }
});

test('slugify is pure and deterministic', () => {
  const input = 'Repeat  Me!!';
  const first = slugify(input);
  const second = slugify(input);
  assert.equal(first, second);
  assert.equal(first, 'repeat-me');
  assert.equal(input, 'Repeat  Me!!');
});

test('normalizeWorkItemBranch derives a default feat branch', () => {
  assert.equal(
    normalizeWorkItemBranch('TASK-AI-64', 'feat', 'add a pure branch-name helper'),
    'feat/task-ai-64-add-a-pure-branch-name-helper'
  );
});

test('normalizeWorkItemBranch defaults the kind to feat', () => {
  assert.equal(
    normalizeWorkItemBranch('TASK-AI-64', undefined, 'add a pure branch-name helper'),
    'feat/task-ai-64-add-a-pure-branch-name-helper'
  );
});

test('normalizeWorkItemBranch keeps the fix kind and the FEAT prefix', () => {
  assert.equal(
    normalizeWorkItemBranch('FEAT-12', 'fix', 'Fix the thing'),
    'fix/feat-12-fix-the-thing'
  );
});

test('normalizeWorkItemBranch collapses inner separator runs and trims ends', () => {
  assert.equal(normalizeWorkItemBranch('TASK-AI-60', 'feat', 'a -- b'), 'feat/task-ai-60-a-b');
  assert.equal(
    normalizeWorkItemBranch('TASK-AI-60', 'feat', '  spaced out  '),
    'feat/task-ai-60-spaced-out'
  );
});

test('normalizeWorkItemBranch keeps digits and TASK-FOUND ids', () => {
  assert.equal(
    normalizeWorkItemBranch('TASK-FOUND-02', 'feat', 'E1 R1 2026'),
    'feat/task-found-02-e1-r1-2026'
  );
});

test('normalizeWorkItemBranch allows a result of exactly 60 characters', () => {
  const out = normalizeWorkItemBranch('TASK-FOUND-02', 'feat', 'w'.repeat(41));
  assert.equal(out, 'feat/task-found-02-' + 'w'.repeat(41));
  assert.equal(out.length, 60);
});

test('normalizeWorkItemBranch throws BRANCH_TOO_LONG at 61 characters instead of truncating', () => {
  assertCoded(
    () => normalizeWorkItemBranch('TASK-FOUND-02', 'feat', 'w'.repeat(42)),
    'BRANCH_TOO_LONG'
  );
});

test('normalizeWorkItemBranch throws OUTCOME_SLUG_EMPTY when the outcome slugs to nothing', () => {
  assertCoded(() => normalizeWorkItemBranch('TASK-AI-64', 'feat', '!!!'), 'OUTCOME_SLUG_EMPTY');
});

test('normalizeWorkItemBranch throws BRANCH_KIND_INVALID outside feat and fix', () => {
  assertCoded(
    () => normalizeWorkItemBranch('TASK-AI-64', 'chore', 'add a pure branch-name helper'),
    'BRANCH_KIND_INVALID'
  );
});

test('normalizeWorkItemBranch throws WORK_ITEM_ID_INVALID outside the three families', () => {
  assertCoded(
    () => normalizeWorkItemBranch('task-ai-64', 'feat', 'add a pure branch-name helper'),
    'WORK_ITEM_ID_INVALID'
  );
  assertCoded(
    () => normalizeWorkItemBranch('BUG-1', 'feat', 'add a pure branch-name helper'),
    'WORK_ITEM_ID_INVALID'
  );
});

test('normalizeWorkItemBranch lets slugify reject a non-string outcome', () => {
  assertCoded(() => normalizeWorkItemBranch('TASK-AI-64', 'feat', null), 'SLUGIFY_INPUT_INVALID');
});

test('normalizeWorkItemBranch is pure and deterministic', () => {
  const args = ['TASK-AI-64', 'feat', 'add a pure branch-name helper'];
  assert.equal(normalizeWorkItemBranch(...args), normalizeWorkItemBranch(...args));
  assert.equal(args[2], 'add a pure branch-name helper');
});
