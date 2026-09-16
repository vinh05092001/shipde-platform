'use strict';
// AC-AI-37-06 — the real root and web manifests carry none of the four
// forbidden install-lifecycle scripts. The row could not be run as stored: it
// was an inline `node -e` one-liner whose private copy of the rule no other row
// shared. The rule now lives in ./lib/lifecycle-forbidden.js, the same module
// the negative proof AC-AI-37-07 requires.
//
// Exits 2 outside the repository (the sources are missing) rather than 0, so it
// cannot pass where nothing exists.
const fs = require('fs');
const path = require('path');
const {
  FORBIDDEN_INSTALL_SCRIPTS,
  findForbiddenLifecycleScripts,
} = require('./lib/lifecycle-forbidden.js');

const SOURCES = ['package.json', path.join('apps', 'web', 'package.json')];

// CONTROL 1: the shared rule must be able to fire at all. A module whose list
// has been emptied would make this row pass no matter what the manifests hold.
const probe = FORBIDDEN_INSTALL_SCRIPTS[0] || 'preinstall';
const sentinel = { scripts: { [probe]: 'true' } };
if (findForbiddenLifecycleScripts(sentinel).length === 0) {
  console.error('CONTROL_FAILED: the shared rule cannot detect ' + probe);
  process.exit(2);
}

// CONTROL 2: and it must not fire on a manifest that carries only benign
// scripts, or "clean" would be meaningless.
if (findForbiddenLifecycleScripts({ scripts: { build: 'tsc' } }).length !== 0) {
  console.error('CONTROL_FAILED: the shared rule fires on a benign manifest');
  process.exit(2);
}

const loaded = [];
for (const source of SOURCES) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source.split(path.sep).join('/'));
    process.exit(2);
  }
  try {
    loaded.push({ source, manifest: JSON.parse(fs.readFileSync(source, 'utf8')) });
  } catch (err) {
    console.error('SOURCE_UNREADABLE: ' + source + ': ' + err.message);
    process.exit(2);
  }
}

const found = [];
for (const { source, manifest } of loaded) {
  for (const script of findForbiddenLifecycleScripts(manifest)) {
    found.push(source.split(path.sep).join('/') + ':' + script);
  }
}

if (found.length > 0) {
  console.error('FORBIDDEN_LIFECYCLE_SCRIPT: ' + found.join(', '));
  process.exit(1);
}
console.log('CONTROL: shared rule fires on a sentinel and stays silent on a benign manifest');
console.log('Zero forbidden lifecycle scripts present in root and web manifests');
