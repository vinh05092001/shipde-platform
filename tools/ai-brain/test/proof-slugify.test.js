'use strict';

/**
 * Ship Dễ — TASK-AI-111: proof for the pure slugify helper and the Work Item
 * branch-name helper built on it.
 *
 * SL-R01: slugify(text) lower-cases, replaces runs of non [a-z0-9] with a
 *   single '-', trims leading/trailing '-', and caps the result at 48
 *   characters without a trailing '-'.
 * SL-R02: throws Error with code SLUGIFY_INPUT_INVALID for non-string input
 *   and for input that slugs to nothing.
 * SL-R03: pure and Node built-ins only.
 * BN-R01: branchNameFor derives kind/<lower-cased work item id>-<slugified
 *   title> so Work Item branches are consistent.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  slugify,
  branchNameFor,
  SLUG_MAX_LENGTH,
  SLUGIFY_INPUT_INVALID,
} = require('../slugify');

function throwsInvalid(fn) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'error is an Error');
    assert.equal(error.code, SLUGIFY_INPUT_INVALID);
    return true;
  });
}

test('slugify lower-cases the input', () => {
  assert.equal(slugify('ABC'), 'abc');
  assert.equal(slugify('MiXeD CaSe'), 'mixed-case');
});

test('slugify replaces runs of non [a-z0-9] with a single dash', () => {
  assert.equal(slugify('a  b__c!!d'), 'a-b-c-d');
  assert.equal(slugify('Hello,   World!'), 'hello-world');
  assert.equal(slugify('Résumé 2024'), 'r-sum-2024');
});

test('slugify trims leading and trailing dashes', () => {
  assert.equal(slugify('--Hello--World--'), 'hello-world');
  assert.equal(slugify('++Hello++'), 'hello');
});

test('slugify caps the result at 48 characters', () => {
  const result = slugify('x'.repeat(60));
  assert.equal(result, 'x'.repeat(48));
  assert.equal(result.length, SLUG_MAX_LENGTH);
});

test('slugify never ends with a dash after the cap', () => {
  const result = slugify('a'.repeat(47) + ' b');
  assert.equal(result, 'a'.repeat(47));
  assert.ok(!result.endsWith('-'));
});

test('slugify throws SLUGIFY_INPUT_INVALID for non-string input', () => {
  for (const value of [null, undefined, 42, {}, [], true]) {
    throwsInvalid(() => slugify(value));
  }
});

test('slugify throws SLUGIFY_INPUT_INVALID when the input slugs to nothing', () => {
  for (const value of ['', '   ', '---', '!!!', '___']) {
    throwsInvalid(() => slugify(value));
  }
});

test('slugify is pure across calls', () => {
  const input = 'Hello World';
  const first = slugify(input);
  const second = slugify(input);
  assert.equal(first, second);
  assert.equal(input, 'Hello World');
});

test('slugify ships no dependencies beyond Node built-ins', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'slugify.js'), 'utf8');
  const specifiers = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(
    (match) => match[1],
  );
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith('node:'), `unexpected dependency ${specifier} in slugify.js`);
  }
});

test('branchNameFor returns feat/ plus lower-cased work item id and slugified title', () => {
  assert.equal(
    branchNameFor('feat', 'TASK-AI-111', 'Add slugify Helper!'),
    'feat/task-ai-111-add-slugify-helper',
  );
});

test('branchNameFor omits the title when none is given', () => {
  assert.equal(branchNameFor('feat', 'TASK-AI-111'), 'feat/task-ai-111');
  assert.equal(branchNameFor('feat', 'TASK-AI-111', null), 'feat/task-ai-111');
});

test('branchNameFor derives fix branches the same way', () => {
  assert.equal(
    branchNameFor('fix', 'TASK-AI-120', 'Resume After Fail Before'),
    'fix/task-ai-120-resume-after-fail-before',
  );
});

test('branchNameFor propagates SLUGIFY_INPUT_INVALID for unusable input', () => {
  throwsInvalid(() => branchNameFor('feat', 'TASK-AI-111', '!!!'));
  throwsInvalid(() => branchNameFor('feat', 42));
  throwsInvalid(() => branchNameFor(null, 'TASK-AI-111'));
});
