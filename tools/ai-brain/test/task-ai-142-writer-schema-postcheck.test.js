'use strict';

// Writers are not required to prove jsonSchema before selection. Live 18/10
// trials 10-13 of goal G-F622511E: every agy-pool and Codex writer was refused
// because the pre-selection jsonSchema proof (a full CLI launch) timed out or
// ran out of budget. The writer result is still schema-checked after the run
// (writer-schema.js WRITER_RESULT_INVALID_JSON), and the host gate and the
// exact-SHA review still gate the commit. Planner and reviewer keep the check.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ROLE_CAPABILITIES } = require('../planner');

test('writer roles do not require a jsonSchema proof before selection', () => {
  assert.equal(ROLE_CAPABILITIES['author.foundation'].jsonSchema, false);
  assert.equal(ROLE_CAPABILITIES['author.lowrisk'].jsonSchema, false);
  assert.equal(ROLE_CAPABILITIES['author.foundation'].tools, true);
});

test('planner and reviewer roles still require jsonSchema', () => {
  assert.equal(ROLE_CAPABILITIES['planner.default'].jsonSchema, true);
  assert.equal(ROLE_CAPABILITIES['reviewer.primary'].jsonSchema, true);
});
