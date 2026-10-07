'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { slugify } = require('../slugify');
const { branchNameFor } = require('../branch-name');

function assertInvalidInput(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'thrown value must be an Error');
    assert.equal(error.code, code);
    return true;
  });
}

describe('BN-R01 branchNameFor derivation', () => {
  test('returns feat/ + lowercased work item id + slugified title', () => {
    assert.equal(
      branchNameFor('TASK-AI-112', 'Branch Name Helper'),
      'feat/task-ai-112-branch-name-helper'
    );
    assert.equal(
      branchNameFor('FEAT-AUTH-01', 'Self registration'),
      'feat/feat-auth-01-self-registration'
    );
    assert.equal(
      branchNameFor('TASK-FOUND-02', 'E1 R1 2026'),
      'feat/task-found-02-e1-r1-2026'
    );
  });

  test('lower-cases the work item id and keeps its structure', () => {
    assert.equal(branchNameFor('TASK-AI-112', 'x').startsWith('feat/task-ai-112-'), true);
    assert.equal(branchNameFor('FEAT-12', 'x'), 'feat/feat-12-x');
    assert.equal(branchNameFor('TASK-FOUND-02', 'x'), 'feat/task-found-02-x');
    assert.equal(branchNameFor('FEAT-AUTH-01', 'x'), 'feat/feat-auth-01-x');
  });

  test('derives the title segment exactly as the slugify helper does', () => {
    const titles = [
      'Hello World',
      '  spaced out  ',
      'a -- b',
      'Order 42 v2',
      '!!!Hello World!!!',
      'Tiếng Việt',
      'y'.repeat(60),
      `${'a'.repeat(47)}-b`,
    ];
    for (const title of titles) {
      assert.equal(
        branchNameFor('TASK-AI-112', title),
        `feat/task-ai-112-${slugify(title)}`
      );
    }
  });

  test('BN-R01 reuses the TASK-AI-111 slugify helper instead of re-implementing it', () => {
    const slugifyPath = require.resolve('../slugify');
    const branchNamePath = require.resolve('../branch-name');
    const originalExports = require.cache[slugifyPath].exports;
    try {
      require.cache[slugifyPath].exports = {
        ...originalExports,
        slugify: (text) => `REUSED-${originalExports.slugify(text)}`,
      };
      delete require.cache[branchNamePath];
      const reloaded = require('../branch-name');
      assert.equal(
        reloaded.branchNameFor('TASK-AI-112', 'Hello World'),
        'feat/task-ai-112-REUSED-hello-world'
      );
    } finally {
      require.cache[slugifyPath].exports = originalExports;
      delete require.cache[branchNamePath];
    }
    assert.equal(branchNameFor('TASK-AI-112', 'Hello World'), 'feat/task-ai-112-hello-world');
  });

  test('branch-name.js requires ./slugify and carries no slug rules of its own', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'branch-name.js'), 'utf8');
    assert.match(source, /require\((['"])\.\/slugify\1\)/);
    assert.doesNotMatch(source, /function\s+slugify\b/);
    assert.doesNotMatch(source, /\[\^a-z0-9\]/);
    assert.doesNotMatch(source, /SLUG_MAX_LENGTH/);
  });

  test('surfaces the slugify helper error for a title it cannot slugify', () => {
    assertInvalidInput(() => branchNameFor('TASK-AI-112', '!!!'), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => branchNameFor('TASK-AI-112', ''), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => branchNameFor('TASK-AI-112', undefined), 'SLUGIFY_INPUT_INVALID');
    assertInvalidInput(() => branchNameFor('TASK-AI-112', null), 'SLUGIFY_INPUT_INVALID');
  });
});

describe('BN-R02 workItemId validation', () => {
  test('throws BRANCH_NAME_INPUT_INVALID when workItemId does not match the pattern', () => {
    const invalid = [
      '',
      'task-ai-64',
      'TASK',
      'TASK-',
      'FEAT',
      'FEAT-',
      'BUG-1',
      'TASK_ai_1',
      'TASK ai 1',
      'TASK-AI-112 ',
      ' TASK-AI-112',
      'TASK-AI-112!',
      'X-TASK-AI-112',
      undefined,
      null,
      42,
      true,
      {},
      ['TASK-AI-112'],
    ];
    for (const workItemId of invalid) {
      assertInvalidInput(
        () => branchNameFor(workItemId, 'x'),
        'BRANCH_NAME_INPUT_INVALID'
      );
    }
  });

  test('accepts TASK- and FEAT- ids built from A-Z, 0-9 and hyphens', () => {
    for (const workItemId of ['TASK-AI-112', 'TASK-FOUND-02', 'FEAT-AUTH-01', 'FEAT-1', 'TASK-1', 'FEAT-A-']) {
      assert.equal(typeof branchNameFor(workItemId, 'x'), 'string');
    }
    assert.equal(branchNameFor('TASK-AI-112', 'x'), 'feat/task-ai-112-x');
  });

  test('the enforced pattern is exactly /^(TASK|FEAT)-[A-Z0-9-]+$/', () => {
    const pattern = /^(TASK|FEAT)-[A-Z0-9-]+$/;
    const sample = [
      'TASK-AI-112',
      'FEAT-AUTH-01',
      'TASK-FOUND-02',
      'task-ai-64',
      'BUG-1',
      'TASK-',
      '',
    ];
    for (const workItemId of sample) {
      const accepted = pattern.test(workItemId);
      const outcome = () => branchNameFor(workItemId, 'x');
      if (accepted) {
        assert.equal(typeof outcome(), 'string');
      } else {
        assertInvalidInput(outcome, 'BRANCH_NAME_INPUT_INVALID');
      }
    }
  });
});

describe('BN-R03 proof harness', () => {
  test('the proof runs under node:test', () => {
    assert.equal(typeof test, 'function');
    assert.equal(typeof describe, 'function');
  });
});
