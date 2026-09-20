'use strict';
// AC-AI-32-06 — negative proof that any attempt to invoke mutation or write
// operations during code retrieval is strictly rejected (AI-32-R01).
//
// The rule lives in `./lib/serena-pilot.js`. When a call requests write or
// mutation, the pilot must refuse with code MUTATION_REFUSED.
//
// Run outside the repository it exits 2, never 1, so the negative proof cannot
// pass by accident where no repository exists.
const fs = require('fs');
const path = require('path');
const { lookupSymbols, lookupReferences, measureTokenEfficiency } = require('./lib/serena-pilot');

const TARGET_FILE = 'tools/ai-brain/serena.js';
if (!fs.existsSync(TARGET_FILE)) {
  console.error('SOURCE_MISSING: ' + TARGET_FILE.split(path.sep).join('/'));
  process.exit(2);
}

// Control: normal read operation must succeed, otherwise refusing below proves nothing
try {
  const control = lookupSymbols({ symbol: 'estimateTokens', file: TARGET_FILE });
  if (control.count < 1) {
    console.error('CONTROL_FAILED: read lookup failed to find estimateTokens');
    process.exit(2);
  }
} catch (err) {
  console.error('CONTROL_FAILED: ' + err.message);
  process.exit(2);
}

// Tampered / mutating attempts: must be refused
const attempts = [
  () => lookupSymbols({ symbol: 'estimateTokens', file: TARGET_FILE, write: true }),
  () => lookupReferences({ symbol: 'estimateTokens', file: TARGET_FILE, mutate: true }),
  () => measureTokenEfficiency({ symbol: 'estimateTokens', file: TARGET_FILE, edit: true }),
];

let allRefused = true;
for (const attempt of attempts) {
  let threw = false;
  let code = null;
  try {
    attempt();
  } catch (err) {
    threw = true;
    code = err.code;
  }

  if (!threw || code !== 'MUTATION_REFUSED') {
    allRefused = false;
    console.error('MUTATION_NOT_REFUSED: expected MUTATION_REFUSED but got ' + code);
    break;
  }
}

if (!allRefused) {
  console.error('MUTATION_FAILURE: mutation attempt was not properly rejected');
  process.exit(0);
}

console.error('MUTATION_REFUSED: all mutating retrieval invocations were strictly rejected');
process.exit(1);
