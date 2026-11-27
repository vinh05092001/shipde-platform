'use strict';

/**
 * Ship Dễ — one answer to "is this text empty?".
 *
 * Validators that each invent their own idea of emptiness disagree at exactly
 * the inputs that matter: a field holding only a non-breaking space is empty to
 * a human and non-empty to `value !== ''`. This module settles the question
 * once — Unicode whitespace is empty, anything carrying a non-whitespace
 * character is content — and refuses to guess at values that are not strings.
 *
 * The refusal is the point. `null`, `undefined` and a number are not blank text;
 * they are not text at all, and silently answering `true` for them would let a
 * missing field pass a "must not be empty" check. They are rejected instead.
 */

const BLANK_INPUT_INVALID = 'BLANK_INPUT_INVALID';

/**
 * The whitespace set: space, tab, newline and the Unicode separators (including
 * NBSP U+00A0 and EM SPACE U+2003). Anchored and unanchored-repeat, so an empty
 * string is blank and any non-whitespace character makes a string non-blank.
 */
const WHITESPACE_ONLY = /^\s*$/;

function describeInput(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function blankInputError(value) {
  const error = new Error(`isBlankString expects a string; received ${describeInput(value)}`);
  error.code = BLANK_INPUT_INVALID;
  return error;
}

/**
 * Whether `value` is empty or holds only Unicode whitespace.
 *
 * @param {unknown} value
 * @returns {boolean}
 * @throws {Error} code `BLANK_INPUT_INVALID` when `value` is not a string.
 */
function isBlankString(value) {
  if (typeof value !== 'string') {
    throw blankInputError(value);
  }
  return WHITESPACE_ONLY.test(value);
}

module.exports = { isBlankString, BLANK_INPUT_INVALID };
