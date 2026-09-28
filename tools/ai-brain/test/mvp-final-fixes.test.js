'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const cli = require('../cli');
const failureClassifier = require('../failure-classifier');

describe('Final MVP Fixes', () => {
  test('HTTP 000 locks gateway even without ECONNREFUSED', () => {
    const result = failureClassifier.classifyFailure({
      exitCode: 1,
      httpStatus: 0,
      body: '',
      stderr: 'something else went wrong',
      accountId: 'acc1',
    });
    assert.equal(result.cause, 'unknown');
    assert.equal(result.scope, 'gateway');
  });

  test('404 model-not-found locks model scope', () => {
    const result = failureClassifier.classifyFailure({
      exitCode: 1,
      httpStatus: 404,
      body: 'Model not found',
      stderr: '',
      accountId: 'acc1',
    });
    assert.equal(result.cause, 'alias_mismatch');
    assert.equal(result.scope, 'model');
  });
});
