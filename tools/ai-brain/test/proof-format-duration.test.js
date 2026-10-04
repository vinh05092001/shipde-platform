'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { formatDuration } = require('../format-duration');

function assertInvalid(value) {
  assert.throws(
    () => formatDuration(value),
    (err) => {
      assert.ok(err instanceof Error, `expected an Error for ${String(value)}`);
      assert.equal(err.code, 'DURATION_INVALID', `expected DURATION_INVALID for ${String(value)}`);
      return true;
    }
  );
}

describe('formatDuration — FD-R01 milliseconds', () => {
  test('0 renders as 0ms', () => {
    assert.equal(formatDuration(0), '0ms');
  });

  test('1..999 renders as whole milliseconds', () => {
    assert.equal(formatDuration(1), '1ms');
    assert.equal(formatDuration(2), '2ms');
    assert.equal(formatDuration(42), '42ms');
    assert.equal(formatDuration(500), '500ms');
    assert.equal(formatDuration(999), '999ms');
  });

  test('non-integer milliseconds floor inside the ms range', () => {
    assert.equal(formatDuration(0.4), '0ms');
    assert.equal(formatDuration(1.7), '1ms');
    assert.equal(formatDuration(500.9), '500ms');
    assert.equal(formatDuration(999.9), '999ms');
  });
});

describe('formatDuration — FD-R02 seconds', () => {
  test('1000..59999 renders as seconds with one decimal', () => {
    assert.equal(formatDuration(1000), '1.0s');
    assert.equal(formatDuration(1500), '1.5s');
    assert.equal(formatDuration(2500), '2.5s');
    assert.equal(formatDuration(10500), '10.5s');
  });

  test('the 59999 boundary truncates to tenths so it never renders as 60.0s', () => {
    assert.equal(formatDuration(59990), '59.9s');
    assert.equal(formatDuration(59999), '59.9s');
    assert.equal(formatDuration(59999.9), '59.9s');
  });
});

describe('formatDuration — FD-R03 minutes', () => {
  test('60000..3599999 renders as minutes and whole seconds', () => {
    assert.equal(formatDuration(60000), '1m0s');
    assert.equal(formatDuration(61000), '1m1s');
    assert.equal(formatDuration(90000), '1m30s');
    assert.equal(formatDuration(600000), '10m0s');
    assert.equal(formatDuration(3599000), '59m59s');
  });

  test('the 3599999 boundary truncates to whole seconds', () => {
    assert.equal(formatDuration(3599999), '59m59s');
    assert.equal(formatDuration(3599999.9), '59m59s');
  });
});

describe('formatDuration — FD-R04 hours', () => {
  test('3600000 and above renders as hours and minutes', () => {
    assert.equal(formatDuration(3600000), '1h0m');
    assert.equal(formatDuration(3660000), '1h1m');
    assert.equal(formatDuration(7140000), '1h59m');
    assert.equal(formatDuration(7199999), '1h59m');
    assert.equal(formatDuration(7200000), '2h0m');
    assert.equal(formatDuration(86400000), '24h0m');
  });

  test('the 3600000 boundary starts hours, not seconds overflow', () => {
    assert.notEqual(formatDuration(3600000), '60m0s');
    assert.equal(formatDuration(3600000), '1h0m');
  });
});

describe('formatDuration — FD-R05 invalid input', () => {
  test('negative durations throw DURATION_INVALID', () => {
    assertInvalid(-1);
    assertInvalid(-0.5);
    assertInvalid(-1000);
  });

  test('non-finite durations throw DURATION_INVALID', () => {
    assertInvalid(NaN);
    assertInvalid(Infinity);
    assertInvalid(-Infinity);
  });

  test('non-number durations throw DURATION_INVALID', () => {
    assertInvalid(undefined);
    assertInvalid(null);
    assertInvalid('1000');
    assertInvalid('1s');
    assertInvalid(true);
    assertInvalid([]);
    assertInvalid({});
    assertInvalid(() => 1000);
    assertInvalid(Symbol('1000'));
  });

  test('invalid input never returns a formatted string', () => {
    for (const value of [-1, NaN, Infinity, '1000', null, undefined, {}]) {
      assert.throws(() => formatDuration(value));
    }
  });
});
