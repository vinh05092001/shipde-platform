'use strict';
// AC-AI-32-07 — TokenPerMergedItem efficiency proof: symbol and reference
// retrieval achieves measurable token reduction compared to full file loading,
// staying well within TOKENS_PER_MERGED_CEILING (AI-32-R03).
//
// Run outside the repository it exits 2, never 1.
const fs = require('fs');
const path = require('path');
const { measureTokenEfficiency, TOKENS_PER_MERGED_CEILING } = require('./lib/serena-pilot');

const TARGET_FILE = 'tools/ai-brain/serena.js';
if (!fs.existsSync(TARGET_FILE)) {
  console.error('SOURCE_MISSING: ' + TARGET_FILE.split(path.sep).join('/'));
  process.exit(2);
}

const targetSymbols = ['estimateTokens', 'lookupSymbols', 'runSerenaCli'];
let totalFocused = 0;
let totalFull = 0;

for (const sym of targetSymbols) {
  const result = measureTokenEfficiency({
    symbol: sym,
    file: TARGET_FILE,
  });

  if (!result.withinCeiling) {
    console.error(
      'CEILING_EXCEEDED: ' +
        sym +
        ' consumed ' +
        result.focusedTokens +
        ' exceeding ceiling ' +
        TOKENS_PER_MERGED_CEILING
    );
    process.exit(1);
  }

  if (result.tokensSaved <= 0 || result.savingsPercent <= 0) {
    console.error('NO_SAVINGS_OBSERVED: ' + sym + ' did not save tokens vs full file');
    process.exit(1);
  }

  totalFocused += result.focusedTokens;
  totalFull += result.fullFilesTokens;
}

const aggregateSaved = totalFull - totalFocused;
const aggregatePercent = Number(((aggregateSaved / totalFull) * 100).toFixed(1));

console.log(
  'TOKEN_EFFICIENCY_VERIFIED: symbol retrieval achieves ' +
    aggregatePercent +
    '% token savings vs full file context (' +
    totalFocused +
    ' focused vs ' +
    totalFull +
    ' full tokens across ' +
    targetSymbols.length +
    ' symbols)'
);
process.exit(0);
