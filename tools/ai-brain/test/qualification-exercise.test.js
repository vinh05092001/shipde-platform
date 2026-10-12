'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const enabled =
  process.env.SHIPDE_QUALIFICATION_EXERCISE === '1' ||
  process.argv.includes('--enable-qualification-exercise');

if (enabled) {
  const { summarizeFindings } = require('../qualification-exercises/QUALIFY-CODE-REVIEW-01');

  test('summarizeFindings counts open and total findings and requests changes', () => {
    assert.deepEqual(summarizeFindings([{ open: true }, { open: false }, { open: true }]), {
      totalFindings: 3,
      openFindings: 2,
      verdict: 'CHANGES_REQUIRED',
    });
  });

  test('summarizeFindings returns PASS when there are no open findings', () => {
    assert.deepEqual(summarizeFindings([{ open: false }]), {
      totalFindings: 1,
      openFindings: 0,
      verdict: 'PASS',
    });
  });
} else {
  test('qualification exercise runs only when explicitly enabled', { skip: true }, () => {});
}
