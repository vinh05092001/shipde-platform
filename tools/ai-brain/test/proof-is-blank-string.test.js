'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { isBlankString, BLANK_INPUT_INVALID } = require('../is-blank-string');

function assertBlankCode(err) {
  assert.ok(err instanceof Error, `expected an Error, got ${typeof err}`);
  assert.equal(err.code, BLANK_INPUT_INVALID);
  return true;
}

describe('isBlankString — BS-R01: empty and whitespace-only text is blank', () => {
  test('the empty string is blank', () => {
    assert.equal(isBlankString(''), true);
  });

  test('ASCII whitespace only is blank', () => {
    for (const value of [' ', '\t', '\n', '\r', '\f', '\v']) {
      assert.equal(isBlankString(value), true, `expected blank: ${JSON.stringify(value)}`);
    }
    assert.equal(isBlankString('  \t\n\r  '), true);
  });

  test('Unicode whitespace only is blank', () => {
    assert.equal(isBlankString('\u00A0'), true);
    assert.equal(isBlankString('\u2003'), true);
    assert.equal(isBlankString('\u00A0\u2003\u00A0'), true);
    assert.equal(isBlankString(' \t\n\u00A0\u2003 '), true);
    assert.equal(isBlankString('\u2000\u2001\u2002\u2028\u2029\u3000'), true);
  });
});

describe('isBlankString — BS-R02: text carrying content is not blank', () => {
  test('any non-whitespace character makes the string non-blank', () => {
    for (const value of ['a', '0', '.', ' a ', '\u00A0a', 'a\u00A0', '\u2003x\u2003', '\ta\t']) {
      assert.equal(isBlankString(value), false, `expected non-blank: ${JSON.stringify(value)}`);
    }
  });

  test('a zero-width character that is not whitespace is still content', () => {
    assert.equal(isBlankString('\u200D'), false);
    assert.equal(isBlankString('\u200B'), false);
  });
});

describe('isBlankString — BS-R03: non-string input is refused, not guessed', () => {
  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['number 0', 0],
    ['number 1', 1],
    ['number NaN', NaN],
    ['object', { length: 0 }],
    ['array', []],
    ['boolean', true],
    ['function', () => {}],
  ]) {
    test(`${label} throws BLANK_INPUT_INVALID`, () => {
      assert.throws(() => isBlankString(value), assertBlankCode);
    });
  }

  test('the refusal is an Error carrying the documented code', () => {
    try {
      isBlankString(null);
      assert.fail('expected isBlankString(null) to throw');
    } catch (err) {
      assertBlankCode(err);
      assert.match(err.message, /expects a string/);
    }
  });
});
