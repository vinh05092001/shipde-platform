'use strict';

// Lat C-3c-2b-iii: the dry-run log builder and its helpers lost their last caller with
// cli/dispatch.js. Guard that neither the CLI nor the dispatch helpers export them again.

const test = require('node:test');
const assert = require('node:assert/strict');

const RETIRED = ['buildDryRunLog', 'sevenFields', 'quotaSnapshot', 'applyDryRunBlocks'];

test('Lat C-3c-2b-iii: the dry-run log helpers are no longer exported', () => {
  const cli = require('../cli');
  const helpers = require('../cli/dispatch-helpers');
  for (const name of RETIRED) {
    assert.equal(cli[name], undefined, 'cli.' + name);
    assert.equal(helpers[name], undefined, 'dispatch-helpers.' + name);
  }
  // The live runtime helpers stay re-exported for orchestrate.js.
  assert.equal(typeof cli.applyFailureBlocks, 'function');
  assert.equal(typeof cli.LIVE_BLOCK_CODES, 'object');
});
