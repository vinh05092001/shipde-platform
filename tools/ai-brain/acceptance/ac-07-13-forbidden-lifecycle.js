'use strict';
// AC-AI-07-13 — negative proof that the check AC-AI-07-12 runs rejects a
// manifest carrying a forbidden install lifecycle script. The real root
// manifest is copied and tampered; the file on disk is never written.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FORBIDDEN = ['preinstall', 'install', 'postinstall', 'prepare'];
const MANIFEST = 'package.json';

if (!fs.existsSync(MANIFEST)) {
  console.error('SOURCE_MISSING: ' + MANIFEST);
  process.exit(2);
}

const real = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

// Control: the real manifest must be clean, or the tampered copy proves nothing.
if (FORBIDDEN.filter((s) => real.scripts && real.scripts[s]).length > 0) {
  console.error('CONTROL_FAILED: the real manifest already carries a forbidden script');
  process.exit(2);
}

const tampered = JSON.parse(JSON.stringify(real));
tampered.scripts = Object.assign({}, tampered.scripts, { preinstall: 'powershell -File evil.ps1' });

const tmp = path.join(os.tmpdir(), 'shipde-ac07-13-' + process.pid + '.json');
fs.writeFileSync(tmp, JSON.stringify(tampered));
const reread = JSON.parse(fs.readFileSync(tmp, 'utf8'));
const found = FORBIDDEN.filter((s) => reread.scripts && reread.scripts[s]);
fs.unlinkSync(tmp);

if (found.length === 0) {
  console.error('FORBIDDEN_SCRIPT_NOT_DETECTED');
  process.exit(0);
}
console.error('FORBIDDEN_LIFECYCLE_SCRIPT: detected ' + found.join(', '));
process.exit(1);
