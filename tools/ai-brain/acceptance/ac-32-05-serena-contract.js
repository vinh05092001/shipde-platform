'use strict';
// AC-AI-32-05 — the Serena pilot contract holds: symbol and reference lookup
// succeeds, resolves definitions, extracts line spans and signatures, and satisfies
// permissions ast-index-read under profile RESEARCH_ONLY.
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');
const {
  checkHealth,
  evaluatePilotContract,
  PERMISSIONS_REQUIRED,
  SERENA_PROFILE,
} = require('./lib/serena-pilot');

const TARGET_FILE = 'tools/ai-brain/serena.js';
const TARGET_SYMBOL = 'estimateTokens';
const SNAPSHOT_DIR = 'tools/snapshots/serena';
const MANIFEST = 'tools/ecosystem-manifest.json';

for (const source of [TARGET_FILE, SNAPSHOT_DIR, MANIFEST]) {
  if (!fs.existsSync(source)) {
    console.error('SOURCE_MISSING: ' + source.split(path.sep).join('/'));
    process.exit(2);
  }
}

const health = checkHealth();
if (!health.healthy) {
  console.error(
    'SERENA_HEALTH_FAILED: healthy=false, snapshot=' +
      health.snapshotPresent +
      ', manifest=' +
      health.manifestEntryPresent
  );
  process.exit(1);
}

if (health.permissions !== PERMISSIONS_REQUIRED) {
  console.error(
    'SERENA_PERMISSIONS_MISMATCH: expected ' +
      PERMISSIONS_REQUIRED +
      ' but got ' +
      health.permissions
  );
  process.exit(1);
}

if (!health.profiles.includes(SERENA_PROFILE)) {
  console.error(
    'SERENA_PROFILE_MISMATCH: expected profile ' +
      SERENA_PROFILE +
      ' in ' +
      JSON.stringify(health.profiles)
  );
  process.exit(1);
}

try {
  const evalResult = evaluatePilotContract(TARGET_SYMBOL, TARGET_FILE, process.cwd());
  console.log(
    'SERENA_PILOT_CONTRACT_HOLDS: symbol ' +
      TARGET_SYMBOL +
      ' resolved (' +
      evalResult.definitions +
      ' defs, ' +
      evalResult.references +
      ' refs, ' +
      evalResult.savingsPercent +
      '% savings)'
  );
  process.exit(0);
} catch (err) {
  console.error('PILOT_CONTRACT_FAILED: ' + err.message);
  process.exit(1);
}
