'use strict';

/**
 * Ship Dễ — Serena Read-Only Pilot Governance Library (TASK-AI-32)
 *
 * Single-source definitions and invariant checks for the Serena code retrieval
 * pilot under AI toolchain decision AI-TOOL-01 and ecosystem profile RESEARCH_ONLY.
 */

const serena = require('../../serena');

const RULES = Object.freeze({
  R01_READ_ONLY: 'AI-32-R01',
  R02_SOURCE_OF_TRUTH: 'AI-32-R02',
  R03_TOKEN_PER_MERGED: 'AI-32-R03',
  R04_DETERMINISTIC_EXTRACTION: 'AI-32-R04',
  R05_REFERENCE_RESOLUTION: 'AI-32-R05',
  R06_FAIL_CLOSED: 'AI-32-R06',
});

const PERMISSIONS_REQUIRED = 'ast-index-read';
const SERENA_PROFILE = 'RESEARCH_ONLY';
const TOKENS_PER_MERGED_CEILING = serena.TOKENS_PER_MERGED_CEILING;

/**
 * Asserts that invoking the retrieval function with write/mutation flags
 * throws MUTATION_REFUSED error.
 */
function verifyReadOnlyRefusal(retrievalFn) {
  let threw = false;
  let code = null;

  try {
    retrievalFn({ write: true });
  } catch (err) {
    threw = true;
    code = err.code;
  }

  if (!threw || code !== 'MUTATION_REFUSED') {
    throw new Error(
      'MUTATION_INVARIANT_VIOLATED: Expected MUTATION_REFUSED but got ' + (code || 'no throw')
    );
  }

  return true;
}

/**
 * Validates the core pilot contract:
 * - Symbol lookup returns valid startLine, endLine, declaration, content
 * - Reference lookup returns occurrences with line numbers and file paths
 * - Token efficiency measurement demonstrates savings vs full files
 */
function evaluatePilotContract(targetSymbol, targetFile, rootDir) {
  const symResult = serena.lookupSymbols({
    symbol: targetSymbol,
    file: targetFile,
    root: rootDir,
  });

  if (symResult.count < 1) {
    throw new Error(
      'PILOT_CONTRACT_FAILED: Symbol ' + targetSymbol + ' not found in ' + targetFile
    );
  }

  const firstDef = symResult.definitions[0];
  if (!firstDef.declaration || !firstDef.startLine || !firstDef.endLine || !firstDef.content) {
    throw new Error('PILOT_CONTRACT_FAILED: Malformed definition returned for ' + targetSymbol);
  }
  if (firstDef.endLine < firstDef.startLine) {
    throw new Error('PILOT_CONTRACT_FAILED: Invalid line bounds for ' + targetSymbol);
  }

  const refResult = serena.lookupReferences({
    symbol: targetSymbol,
    file: targetFile,
    root: rootDir,
  });

  if (refResult.count < 1) {
    throw new Error('PILOT_CONTRACT_FAILED: No references found for ' + targetSymbol);
  }

  const measurement = serena.measureTokenEfficiency({
    symbol: targetSymbol,
    file: targetFile,
    root: rootDir,
  });

  if (measurement.focusedTokens >= measurement.fullFilesTokens) {
    throw new Error('PILOT_CONTRACT_FAILED: Focused retrieval did not save tokens vs full files');
  }

  if (measurement.focusedTokens > TOKENS_PER_MERGED_CEILING) {
    throw new Error(
      'PILOT_CONTRACT_FAILED: Focused retrieval exceeded ceiling ' + TOKENS_PER_MERGED_CEILING
    );
  }

  return {
    valid: true,
    definitions: symResult.count,
    references: refResult.count,
    savingsPercent: measurement.savingsPercent,
    focusedTokens: measurement.focusedTokens,
    fullFilesTokens: measurement.fullFilesTokens,
  };
}

module.exports = {
  RULES,
  PERMISSIONS_REQUIRED,
  SERENA_PROFILE,
  TOKENS_PER_MERGED_CEILING,
  estimateTokens: serena.estimateTokens,
  extractSymbolsFromFile: serena.extractSymbolsFromFile,
  lookupSymbols: serena.lookupSymbols,
  lookupReferences: serena.lookupReferences,
  measureTokenEfficiency: serena.measureTokenEfficiency,
  checkHealth: serena.checkHealth,
  runSerenaCli: serena.runSerenaCli,
  verifyReadOnlyRefusal,
  evaluatePilotContract,
};
