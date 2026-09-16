'use strict';
// AC-AI-39-07 — negative proof that the invariant AC-AI-39-06 asserts genuinely
// fails closed.
//
// The rule under test is NOT reimplemented here. Both rows require
// tools/ai-brain/acceptance/lifecycle-scripts.js, so editing the rule changes
// AC-AI-39-06's answer and this proof together. A proof that carried its own
// copy of the rule would prove nothing about the rule the invariant runs: the
// two could drift and this row would stay green.
//
// The REAL root and web manifests are read from disk and proven clean as a
// control, then a copy is tampered in os.tmpdir() and re-read from disk through
// the same shared rule. No file inside the repository is written.
const fs = require('fs');
const os = require('os');
const path = require('path');

const { forbiddenLifecycleScriptsInFile } = require('./lifecycle-scripts');

const MANIFESTS = ['package.json', path.join('apps', 'web', 'package.json')];

for (const manifest of MANIFESTS) {
  if (!fs.existsSync(manifest)) {
    console.error('SOURCE_MISSING: ' + manifest);
    process.exit(2);
  }
}

// Control: both real manifests must be clean, or rejecting a tampered copy
// proves nothing — the shared rule would refuse the untouched manifest too.
for (const manifest of MANIFESTS) {
  let dirty;
  try {
    dirty = forbiddenLifecycleScriptsInFile(manifest);
  } catch (err) {
    console.error('SOURCE_UNREADABLE: ' + manifest + ': ' + err.message);
    process.exit(2);
  }
  if (dirty.length > 0) {
    console.error(
      'CONTROL_FAILED: ' + manifest + ' already carries a forbidden script: ' + dirty.join(', ')
    );
    process.exit(2);
  }
}

// Tamper a COPY of the real web manifest with the agent-scan install hook this
// Work Item forbids, write it to disk, and re-read it through the shared rule.
const real = JSON.parse(fs.readFileSync(MANIFESTS[1], 'utf8'));
const tampered = JSON.parse(JSON.stringify(real));
tampered.scripts = Object.assign({}, tampered.scripts, {
  postinstall: 'pip install snyk-agent-scan',
});

const tmp = path.join(os.tmpdir(), 'shipde-ac39-07-' + process.pid + '.json');
let found;
try {
  fs.writeFileSync(tmp, JSON.stringify(tampered, null, 2));
  found = forbiddenLifecycleScriptsInFile(tmp);
} catch (err) {
  console.error('TAMPER_COPY_FAILED: ' + err.message);
  process.exit(2);
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch (e) {
    /* the copy is in the OS temp directory; a failed cleanup is not a finding */
  }
}

if (found.length === 0) {
  console.error('FORBIDDEN_SCRIPT_NOT_DETECTED: the shared rule did not reject the tampered copy');
  process.exit(0);
}
console.error('FORBIDDEN_LIFECYCLE_SCRIPT: detected ' + found.join(', '));
process.exit(1);
