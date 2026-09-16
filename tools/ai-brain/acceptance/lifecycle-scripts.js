'use strict';
// The one forbidden-install-lifecycle rule for TASK-AI-39.
//
// AC-AI-39-06 (the invariant) and AC-AI-39-07 (its negative proof) both call
// these functions. AC-AI-39-07 used to carry a private copy of the FORBIDDEN
// list, which meant "rejected by the same rule" was false: the proof was
// rejected by its own copy, and editing the rule CI runs left the proof green.
// One rule, required by both rows, is the only arrangement in which a green
// negative proof is evidence about the rule the invariant actually runs.
//
// The rule is a manifest reader: it takes a path on disk, not an object handed
// to it, so every caller exercises the same "read the file the way CI reads it"
// path. This mirrors how the real bundled rule evaluates a package manifest.
const fs = require('fs');

const FORBIDDEN = ['preinstall', 'install', 'postinstall', 'prepare'];

/**
 * Forbidden lifecycle script names present on a parsed package manifest.
 *
 * @param {object} manifest parsed package.json
 * @returns {string[]} names from FORBIDDEN that the manifest declares
 */
function findForbiddenScripts(manifest) {
  if (!manifest || typeof manifest !== 'object') return [];
  const scripts = manifest.scripts || {};
  return FORBIDDEN.filter((name) => scripts[name]);
}

/**
 * Reads a package manifest from disk and returns the forbidden scripts in it.
 *
 * @param {string} manifestPath path to a package.json on disk
 * @returns {string[]} names from FORBIDDEN that the file declares
 */
function forbiddenScriptsInFile(manifestPath) {
  return findForbiddenScripts(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
}

module.exports = { FORBIDDEN, findForbiddenScripts, forbiddenScriptsInFile };
