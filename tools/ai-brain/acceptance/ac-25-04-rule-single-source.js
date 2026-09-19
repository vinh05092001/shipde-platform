'use strict';
// AC-AI-25-04 — the single source rule: the removal logic lives in exactly
// one module (./lib/role-feedback.js), and both this script and feedback.js
// (when it exists) resolve the same file path.
//
// The check: two genuinely different requiring modules — this acceptance row,
// whose base directory is acceptance/, and the production wrapper
// tools/ai-brain/feedback.js, whose base directory is tools/ai-brain/ — must
// resolve the removal rule to the identical absolute path. The two bases are
// different modules, so the comparison can fail; if they ever resolve two
// different files, production and proof no longer share one rule.
//
// A second control refuses a private copy of the rule: a module that exports
// evaluateNarrowing/applyNarrowing as *different function objects* than this
// module's is a re-implementation, wherever it lives. A sanctioned re-export
// (`module.exports = require('./acceptance/lib/role-feedback')`) forwards the
// identical references and is not a duplicate, which is what lets the
// production wrapper be introduced without breaking this row.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

// SOURCE_MISSING check: verify the file exists relative to CWD.
const cwd = process.cwd();
if (!fs.existsSync(path.join(cwd, 'tools/ai-brain/acceptance/lib/role-feedback.js'))) {
  console.error('SOURCE_MISSING: tools/ai-brain/acceptance/lib/role-feedback.js');
  process.exit(2);
}

const root = path.join(__dirname, '..');

// Requiring module 1: this acceptance row. Base directory: acceptance/.
const resolvedFromHere = require.resolve('./lib/role-feedback.js');

// Requiring module 2: the production wrapper feedback.js, whether or not it
// exists yet. createRequire() only builds the resolution base that file would
// use, so this is a real second requiring module, not the same literal resolved
// twice from one base.
const productionRequire = createRequire(path.join(root, 'feedback.js'));
let resolvedFromProduction;
try {
  resolvedFromProduction = productionRequire.resolve('./acceptance/lib/role-feedback.js');
} catch (err) {
  console.error(
    'SINGLE_SOURCE_FAILED: production base cannot resolve acceptance/lib/role-feedback.js: ' +
      err.message
  );
  process.exit(1);
}

if (resolvedFromHere !== resolvedFromProduction) {
  console.error(
    'SINGLE_SOURCE_FAILED: production base resolves ' +
      resolvedFromProduction +
      ' but acceptance base resolves ' +
      resolvedFromHere
  );
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

// Control: no second copy of the removal rule exists in the production tree.
// A module carries a private copy when it exports the same names but not the
// same function objects as the rule module: a re-implementation always builds
// new functions, while a sanctioned re-export forwards the identical
// references. Identity, not the file's location, is what separates the two.
const isPrivateCopy = (mod) =>
  typeof mod.evaluateNarrowing === 'function' &&
  typeof mod.applyNarrowing === 'function' &&
  (mod.evaluateNarrowing !== rf.evaluateNarrowing || mod.applyNarrowing !== rf.applyNarrowing);

const duplicates = [];
for (const candidate of [path.join(root, 'feedback.js')]) {
  if (fs.existsSync(candidate)) {
    try {
      const mod = require(candidate);
      if (isPrivateCopy(mod)) {
        duplicates.push(candidate);
      }
    } catch (e) {
      // Not a valid module or wrong shape — skip.
    }
  }
}

// Control: when feedback.js (production) exists, it must re-export the same
// removal rule rather than carrying a private copy. feedback.js is allowed to
// forward via require('./acceptance/lib/role-feedback.js') or any
// re-export that resolves to the same absolute path. A private copy of the
// rule inside feedback.js is the defect this row exists to catch.
const feedbackPath = path.join(root, 'feedback.js');
if (fs.existsSync(feedbackPath)) {
  const feedbackSrc = fs.readFileSync(feedbackPath, 'utf8');
  if (
    /evaluateNarrowing\s*[:=]\s*function/.test(feedbackSrc) ||
    /function\s+evaluateNarrowing\s*\(/.test(feedbackSrc)
  ) {
    console.error(
      'SINGLE_SOURCE_FAILED: tools/ai-brain/feedback.js defines evaluateNarrowing locally; it must re-export acceptance/lib/role-feedback.js'
    );
    process.exit(1);
  }
  if (
    /applyNarrowing\s*[:=]\s*function/.test(feedbackSrc) ||
    /function\s+applyNarrowing\s*\(/.test(feedbackSrc)
  ) {
    console.error(
      'SINGLE_SOURCE_FAILED: tools/ai-brain/feedback.js defines applyNarrowing locally; it must re-export acceptance/lib/role-feedback.js'
    );
    process.exit(1);
  }
  // The wrapper must resolve to the same file the acceptance tree resolves.
  // Extract the specifier it actually requires and resolve it from the
  // production base, so a lookalike path that merely contains the expected
  // substring cannot pass.
  const specifier = feedbackSrc.match(/require\(\s*['"]([^'"]*role-feedback[^'"]*)['"]\s*\)/);
  if (!specifier) {
    console.error(
      'SINGLE_SOURCE_FAILED: tools/ai-brain/feedback.js does not require acceptance/lib/role-feedback.js'
    );
    process.exit(1);
  }
  let resolvedFromFeedback;
  try {
    resolvedFromFeedback = productionRequire.resolve(specifier[1]);
  } catch (err) {
    console.error(
      'SINGLE_SOURCE_FAILED: tools/ai-brain/feedback.js requires ' +
        specifier[1] +
        ' which does not resolve: ' +
        err.message
    );
    process.exit(1);
  }
  if (resolvedFromFeedback !== resolvedFromHere) {
    console.error(
      'SINGLE_SOURCE_FAILED: feedback.js resolves ' +
        resolvedFromFeedback +
        ' but the acceptance tree resolves ' +
        resolvedFromHere
    );
    process.exit(1);
  }
}

// Also check that lib/role-feedback.js is the unique source within
// acceptance/lib: a second module there that re-implements the rule is a
// duplicate too, while a re-export of this module is not.
const libDir = path.join(__dirname, 'lib');
let libCount = 0;
if (fs.existsSync(libDir)) {
  for (const entry of fs.readdirSync(libDir)) {
    if (!entry.endsWith('.js')) continue;
    const absolute = path.join(libDir, entry);
    try {
      const mod = require(absolute);
      if (typeof mod.evaluateNarrowing === 'function' && typeof mod.applyNarrowing === 'function') {
        libCount++;
        if (isPrivateCopy(mod)) {
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
  console.error('SINGLE_SOURCE_FAILED: removal rule found in ' + duplicates.join(', '));
  process.exit(1);
}

console.log(
  'SINGLE_SOURCE: ' +
    resolvedFromHere +
    ' — production base (tools/ai-brain/feedback.js) and ' +
    'acceptance base (acceptance/) resolve the same file; no private copy of the removal rule'
);
process.exit(0);
