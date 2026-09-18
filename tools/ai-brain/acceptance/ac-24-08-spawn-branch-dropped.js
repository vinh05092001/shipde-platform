'use strict';
// AC-AI-24-08 — negative proof for the executor half of the contract.
//
// The rule is `./lib/dispatch-executor-contract.js`, the same module
// `ac-24-07-spawn-contract.js` requires. The REAL controller is read and must be
// accepted as a CONTROL; a COPY written to `os.tmpdir()` then loses the
// `"--branch", $Item.Branch` pair inside `New-ShipDeAoSpawnArguments` — the
// edit that would let a worker start on whatever branch it happened to be on —
// and the same rule must reject it. Nothing on disk is modified.
//
// Exit 1 when the tamper is detected. Exit 2 when the proof cannot be made,
// including when a regression stops the rule detecting it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CONTROLLER_PATH,
  spawnFunctionBody,
  spawnViolations,
} = require('./lib/dispatch-executor-contract');

if (!fs.existsSync(CONTROLLER_PATH)) {
  console.error('SOURCE_MISSING: ' + CONTROLLER_PATH);
  process.exit(2);
}

const real = fs.readFileSync(CONTROLLER_PATH, 'utf8');
const control = spawnViolations(real);
if (control === null || control.length !== 0) {
  console.error('CONTROL_FAILED: the real launcher is absent or already violates the contract');
  process.exit(2);
}

const body = spawnFunctionBody(real);
const branchPair = /\r?\n\s*"--branch",\s*\$Item\.Branch,/;
if (!branchPair.test(body)) {
  console.error('CONTROL_FAILED: the real launcher has no "--branch", $Item.Branch pair to remove');
  process.exit(2);
}
const tampered = real.replace(body, body.replace(branchPair, ''));

const tmp = path.join(os.tmpdir(), 'shipde-ac24-08-' + process.pid + '.ps1');
fs.writeFileSync(tmp, tampered);
const violations = spawnViolations(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);

if (violations === null || violations.length === 0) {
  console.error('SPAWN_BRANCH_DROP_NOT_DETECTED');
  process.exit(2);
}
console.error('SPAWN_CONTRACT_VIOLATED: ' + violations.join('; '));
process.exit(1);
