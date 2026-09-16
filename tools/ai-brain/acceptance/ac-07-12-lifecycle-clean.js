'use strict';
// AC-AI-07-12 — the root and web manifests carry no install lifecycle script.
//
// The rule (which lifecycle scripts are forbidden) lives in ONE place, the
// committed module ./lifecycle-scripts.js, which AC-AI-07-13 — the negative
// proof of this very check — also requires. Editing the rule there changes both
// the invariant and its proof; they cannot drift apart.
//
// This lives in a file because the inline form needed a JavaScript `||`, which
// a markdown table cell stores escaped as `\|\|`; the row as written could not
// be run as written.
const fs = require('fs');
const { forbiddenLifecycleScripts } = require('./lifecycle-scripts');

const MANIFESTS = ['package.json', 'apps/web/package.json'];

const missing = MANIFESTS.filter((p) => !fs.existsSync(p));
if (missing.length > 0) {
  console.error('SOURCE_MISSING: ' + missing.join(', '));
  process.exit(2);
}

const found = [];
for (const manifest of MANIFESTS) {
  const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const script of forbiddenLifecycleScripts(parsed)) {
    found.push(manifest + ':' + script);
  }
}

if (found.length > 0) {
  console.error('FORBIDDEN_LIFECYCLE_SCRIPT: ' + found.join(', '));
  process.exit(1);
}
console.log('Zero forbidden lifecycle scripts present in root and web manifests');
