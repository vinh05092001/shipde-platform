'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SLUG_MAX_LENGTH, BRANCH_KINDS, slugify, branchName } = require('../slugify');

function assertInvalidInput(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'thrown value must be an Error');
    assert.equal(error.code, code);
    return true;
  });
}

describe('SL-R01 slugify normalization', () => {
  test('lower-cases the input', () => {
    assert.equal(slugify('Hello World'), 'hello-world');
    assert.equal(slugify('TASK-AI-111'), 'task-ai-111');
  });

  test('replaces runs of non [a-z0-9] with a single dash', () => {
    assert.equal(slugify('Hello---World!!Go'), 'hello-world-go');
    assert.equal(slugify('Foo__Bar--Baz'), 'foo-bar-baz');
    assert.equal(slugify('a b\tc\nd'), 'a-b-c-d');
    assert.equal(slugify('Tiếng Việt'), 'ti-ng-vi-t');
  });

  test('trims leading and trailing dashes', () => {
    assert.equal(slugify('--Hello World--'), 'hello-world');
    assert.equal(slugify('!!!Hello World!!!'), 'hello-world');
    assert.equal(slugify(' -- Hello World -- '), 'hello-world');
  });

  test('keeps letters and digits', () => {
    assert.equal(slugify('Order 42 v2'), 'order-42-v2');
    assert.equal(slugify('123'), '123');
  });

  test('caps the result at 48 characters', () => {
    assert.equal(slugify('a'.repeat(49)), 'a'.repeat(SLUG_MAX_LENGTH));
    assert.ok(slugify('x y '.repeat(30)).length <= SLUG_MAX_LENGTH);
  });

  test('never ends with a dash after the cap', () => {
    const cutAtDash = `${'a'.repeat(SLUG_MAX_LENGTH - 1)}-b`;
    assert.equal(slugify(cutAtDash), 'a'.repeat(SLUG_MAX_LENGTH - 1));
    assert.ok(!slugify(cutAtDash).endsWith('-'));
    assert.ok(!slugify('z '.repeat(40)).endsWith('-'));
  });
});

describe('SL-R02 invalid input', () => {
  test('throws SLUGIFY_INPUT_INVALID for non-string input', () => {
    assertInvalidInput(() => slugify(undefined), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => slugify(null), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => slugify(42), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => slugify(true), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => slugify({}), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => slugify(['Hello']), 'SLUGIFY_INPUT_INVALID');
  });

  test('throws SLUGIFY_INPUT_INVALID for empty-after-slugify input', () => {
    assertInvalidInput(() => slugify(''), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => slugify('   '), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => slugify('---'), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => slugify('!!!'), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => slugify(' -- !!! '), 'SLUGIFY_INPUT_INVALID');
  });
});

describe('SL-R03 purity', () => {
  test('slugify.js loads no dependencies at all', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'slugify.js'), 'utf8');
    assert.doesNotMatch(source, /require\s*\(/);
    assert.doesNotMatch(source, /\bimport\s+[\w{*]/);
  });

  test('repeated calls are deterministic and stateless', () => {
    const inputs = ['Hello World', '--Mixed   Case--', 'a'.repeat(60), 'Order 42 v2', 'Tiếng Việt'];
    for (const input of inputs) {
      const first = slugify(input);
      for (let i = 0; i < 20; i += 1) {
        assert.equal(slugify(input), first);
      }
      assert.equal(input === first, false);
    }
    assertInvalidInput(() => slugify(7), 'SLUGIFY_INPUT_INVALID');
    assert.equal(slugify('Hello World'), 'hello-world');
  });

  test('tests run under node:test with no extra dependencies', () => {
    assert.equal(typeof test, 'function');
    assert.equal(typeof describe, 'function');
  });
});

describe('SL-R05 branchName derivation', () => {
  test('builds feat/<lowercase-work-item-id>-<short-slug>', () => {
    assert.equal(
      branchName('TASK-AI-111', 'Branch Name Helper'),
      'feat/task-ai-111-branch-name-helper'
    );
    assert.equal(
      branchName('TASK-AI-111', 'RTK output filter'),
      'feat/task-ai-111-rtk-output-filter'
    );
  });

  test('derives both segments through slugify', () => {
    assert.equal(branchName('TASK AI 111', '  Crazy Name!! '), 'feat/task-ai-111-crazy-name');
    assert.equal(
      branchName('TASK-AI-111', 'y'.repeat(60)).length,
      'feat/'.length + 'task-ai-111'.length + 1 + SLUG_MAX_LENGTH
    );
  });

  test('defaults to feat and accepts fix', () => {
    assert.equal(BRANCH_KINDS.length, 2);
    assert.equal(branchName('TASK-AI-111', 'x'), branchName('TASK-AI-111', 'x', 'feat'));
    assert.equal(branchName('TASK-AI-111', 'x', 'fix'), 'fix/task-ai-111-x');
  });

  test('rejects a kind outside feat/fix', () => {
    assertInvalidInput(() => branchName('TASK-AI-111', 'x', 'chore'), 'BRANCH_NAME_INPUT_INVALID');
    assertInvalidInput(() => branchName('TASK-AI-111', 'x', 'FEAT'), 'BRANCH_NAME_INPUT_INVALID');
    assertInvalidInput(() => branchName('TASK-AI-111', 'x', null), 'BRANCH_NAME_INPUT_INVALID');
    assertInvalidInput(() => branchName('TASK-AI-111', 'x', ''), 'BRANCH_NAME_INPUT_INVALID');
  });

  test('surfaces slugify input errors for invalid text segments', () => {
    assertInvalidInput(() => branchName(null, 'x'), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => branchName('TASK-AI-111', undefined), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => branchName('TASK-AI-111', '!!!'), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => branchName('', 'x'), 'SLUGIFY_INPUT_INVALID');
  });
});
