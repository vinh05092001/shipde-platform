'use strict';
// Shared rule for the forbidden install lifecycle scripts.
//
// AC-AI-07-12 (the invariant) and AC-AI-07-13 (its negative proof) both require
// this module, so the rule exists in exactly ONE place: editing the rule here
// changes both the gate and the proof of the gate. Before this module each
// script carried its own copy of the list, so the two could silently drift and
// the negative proof would prove nothing about the invariant it claims to test.
const fs = require('fs');

// The lifecycle hooks a package install may run on its own. A manifest that
// declares any of these executes code outside the pinned, reviewed install path.
const FORBIDDEN_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];

/**
 * Given a parsed manifest object, return the forbidden lifecycle script names
 * it declares (empty when the manifest is clean).
 * @param {object} manifest parsed package.json
 * @returns {string[]}
 */
function forbiddenLifecycleScripts(manifest) {
  const scripts = (manifest && manifest.scripts) || {};
  return FORBIDDEN_LIFECYCLE_SCRIPTS.filter((name) => scripts[name]);
}

/**
 * Given a manifest path, read and parse it, then return the forbidden lifecycle
 * script names it declares.
 * @param {string} manifestPath path to a package.json
 * @returns {string[]}
 */
function forbiddenLifecycleScriptsInFile(manifestPath) {
  return forbiddenLifecycleScripts(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
}

module.exports = {
  FORBIDDEN_LIFECYCLE_SCRIPTS,
  forbiddenLifecycleScripts,
  forbiddenLifecycleScriptsInFile,
};
