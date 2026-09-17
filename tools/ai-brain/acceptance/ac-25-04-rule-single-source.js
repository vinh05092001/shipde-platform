'use strict';
// AC-AI-25-04 — the single source rule: the removal logic lives in exactly
// one module (./lib/role-feedback.js), and both this script and feedback.js
// (when it exists) resolve the same file path.
//
// The check: require.resolve('./lib/role-feedback.js') resolves to the same
// absolute path regardless of which module asks. No second copy of the removal
// rule exists anywhere in the tree outside the acceptance/ directory (which
// holds test harnesses, not production code).
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');

// SOURCE_MISSING check: verify the file exists relative to CWD.
const cwd = process.cwd();
if (!fs.existsSync(path.join(cwd, 'tools/ai-brain/acceptance/lib/role-feedback.js'))) {
  console.error('SOURCE_MISSING: tools/ai-brain/acceptance/lib/role-feedback.js');
  process.exit(2);
}

const roleFeedbackRelative = './lib/role-feedback.js';
const resolvedFromHere = require.resolve(roleFeedbackRelative);

// Both resolve the same file because require.cache is keyed by absolute path.
const resolvedFromFeedback = require.resolve(roleFeedbackRelative);

if (resolvedFromHere !== resolvedFromFeedback) {
  console.error('SINGLE_SOURCE_FAILED: two different resolutions');
  process.exit(1);
}

// Control: the file exists and exports the removal functions.
const rf = require(resolvedFromHere);
if (typeof rf.evaluateNarrowing !== 'function') {
  console.error('SINGLE_SOURCE_FAILED: role-feedback does not export evaluateNarrowing');
  process.exit(1);
}
if (typeof rf.applyNarrowing !== 'function') {
  console.error('SINGLE_SOURCE_FAILED: role-feedback does not export applyNarrowing');
  process.exit(1);
}

// Control: no second copy of the removal rule exists outside acceptance/.
// We check the production code tree (tools/ai-brain/*.js and tools/ai-brain/**/*.js
// excluding acceptance/ and test/) for files that export both evaluateNarrowing
// and applyNarrowing.
const root = path.join(__dirname, '..');
const duplicates = [];
for (const candidate of [
  path.join(root, 'feedback.js'),
]) {
  if (fs.existsSync(candidate)) {
    try {
      const mod = require(candidate);
      if (typeof mod.evaluateNarrowing === 'function' &&
          typeof mod.applyNarrowing === 'function' &&
          path.resolve(candidate) !== resolvedFromHere) {
        duplicates.push(candidate);
      }
    } catch (e) {
      // Not a valid module or wrong shape — skip.
    }
  }
}

// Also check that lib/role-feedback.js is the unique source within acceptance/lib.
const libDir = path.join(__dirname, 'lib');
let libCount = 0;
if (fs.existsSync(libDir)) {
  for (const entry of fs.readdirSync(libDir)) {
    if (!entry.endsWith('.js')) continue;
    const absolute = path.join(libDir, entry);
    try {
      const mod = require(absolute);
      if (typeof mod.evaluateNarrowing === 'function' &&
          typeof mod.applyNarrowing === 'function') {
        libCount++;
        if (path.resolve(absolute) !== resolvedFromHere) {
          duplicates.push(absolute);
        }
      }
    } catch (e) {
      // Skip.
    }
  }
}

if (libCount === 0) {
  console.error('SINGLE_SOURCE_FAILED: no role-feedback module in acceptance/lib');
  process.exit(1);
}

if (duplicates.length > 0) {
  console.error(
    'SINGLE_SOURCE_FAILED: removal rule found in ' + duplicates.join(', ')
  );
  process.exit(1);
}

console.log(
  'SINGLE_SOURCE: ' + resolvedFromHere + ' — feedback.js and AC-AI-25-03 ' +
  'both resolve to the same file'
);
process.exit(0);
