'use strict';
// AC-AI-24-07 — the invariant: the controller's real launcher passes every flag
// an executor must preserve.
//
// The rule is `./lib/dispatch-executor-contract.js`, the same module the
// negative proof `ac-24-08-spawn-branch-dropped.js` requires. The launcher is
// read from `scripts/ai/control.ps1` on disk.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const {
  CONTROLLER_PATH,
  REQUIRED_SPAWN_FLAGS,
  spawnViolations,
} = require('./lib/dispatch-executor-contract');

if (!fs.existsSync(CONTROLLER_PATH)) {
  console.error('SOURCE_MISSING: ' + CONTROLLER_PATH);
  process.exit(2);
}

const violations = spawnViolations(fs.readFileSync(CONTROLLER_PATH, 'utf8'));
if (violations === null) {
  console.error('SOURCE_MISSING: New-ShipDeAoSpawnArguments is not defined in ' + CONTROLLER_PATH);
  process.exit(2);
}
if (violations.length > 0) {
  console.error('SPAWN_CONTRACT_VIOLATED: ' + violations.join('; '));
  process.exit(1);
}

console.log(
  'SPAWN_CONTRACT_HOLDS: New-ShipDeAoSpawnArguments passes spawn with ' +
    REQUIRED_SPAWN_FLAGS.join(' ')
);
