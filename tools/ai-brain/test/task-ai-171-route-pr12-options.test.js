'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// The coordinator dispatch command, its options module and its output formatter
// were retired with the legacy profile dispatch (Lat C-3c-1). What still holds:
// loading the CLI starts no process, network call or file write.
function guardSideEffects(t) {
  const effects = [];
  const forbidden = () => {
    effects.push('side effect');
    throw new Error('OFFLINE_SIDE_EFFECT');
  };
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
    t.mock.method(require('node:child_process'), name, forbidden);
  t.mock.method(globalThis, 'fetch', forbidden);
  for (const name of ['node:http', 'node:https', 'node:net'])
    for (const key of ['request', 'get', 'connect', 'createConnection'])
      if (require(name)[key]) t.mock.method(require(name), key, forbidden);
  for (const name of 'writeFile appendFile mkdir rename unlink rm'.split(' ')) {
    for (const api of [fs, fs.promises]) t.mock.method(api, name, forbidden);
    t.mock.method(fs, name + 'Sync', forbidden);
  }
  return effects;
}

test('B03/B15/B54: import needs no scratch note, user configuration or process setup', (t) => {
  const effects = guardSideEffects(t);
  delete require.cache[require.resolve('../cli')];
  assert.equal(typeof require('../cli').orchestrateCommand, 'function');
  assert.deepEqual(effects, []);
});
