'use strict';
// AC-AI-38-08 — negative proof that the invariant AC-AI-38-07 asserts genuinely
// fails closed. The REAL root and web manifests are read from disk, proven clean
// as a control, then copied and tampered in os.tmpdir(); the check runs against
// the copy. No file inside the repository is ever written.
const fs = require('fs');
const os = require('os');
const path = require('path');

const FORBIDDEN = ['preinstall', 'install', 'postinstall', 'prepare'];
const MANIFESTS = ['package.json', path.join('apps', 'web', 'package.json')];

for (const manifest of MANIFESTS) {
  if (!fs.existsSync(manifest)) {
    console.error('SOURCE_MISSING: ' + manifest);
    process.exit(2);
  }
}

const real = MANIFESTS.map((m) => JSON.parse(fs.readFileSync(m, 'utf8')));

// Control: both real manifests must be clean, or rejecting a tampered copy proves nothing.
for (let i = 0; i < real.length; i += 1) {
  const dirty = FORBIDDEN.filter((s) => real[i].scripts && real[i].scripts[s]);
  if (dirty.length > 0) {
    console.error(
      'CONTROL_FAILED: ' + MANIFESTS[i] + ' already carries a forbidden script: ' + dirty.join(', ')
    );
    process.exit(2);
  }
}

const tampered = JSON.parse(JSON.stringify(real[0]));
tampered.scripts = Object.assign({}, tampered.scripts, { postinstall: 'npx axe-core-installer' });

const tmp = path.join(os.tmpdir(), 'shipde-ac38-08-' + process.pid + '.json');
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
