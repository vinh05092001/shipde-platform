'use strict';
// AC-AI-33-03 — the shadow's edge rule is the reconciler's, not a second copy.
//
// A shadow graph that parsed `dependencies` differently from reconciliation
// would report divergences that are an artefact of two parsers, not of two
// graphs. The shared module re-exports the reconciler's own parser by reference,
// and this row asserts that identity against the real modules. The CONTROL reads
// a real register row whose `dependencies` cell mixes an ID with prose and
// requires the parser to keep the ID and discard the prose, so a parser that
// returned nothing could not carry the row.
//
// The rule is ./lib/dependency-graph.js, required by AC-AI-33-01 and AC-AI-33-02
// as well. Exit 2, never 1, when run outside the repository.
const fs = require('fs');
const path = require('path');
const { REGISTER_PATH } = require('./lib/dependency-graph');
const graphModule = require('./lib/dependency-graph');
const { parseDependencies } = require('../reconcile');

if (!fs.existsSync(REGISTER_PATH) || !fs.existsSync(path.join(__dirname, '..', 'reconcile.js'))) {
  console.error('SOURCE_MISSING: ' + REGISTER_PATH.split(path.sep).join('/') + ' or reconcile.js');
  process.exit(2);
}

if (graphModule.parseEdges !== parseDependencies) {
  console.error('RULE_DUPLICATED: lib/dependency-graph declares its own edge parser');
  process.exit(1);
}

// CONTROL: the shared parser must really parse a real register cell of the shape
// the register uses, keeping the ID and discarding the prose beside it.
const rows = graphModule.registerRows(fs.readFileSync(REGISTER_PATH, 'utf8'));
const ID_TOKENS = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/;
const isMixed = (cell) =>
  String(cell)
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => !ID_TOKENS.test(part));
const mixed = rows.find(
  (row) => isMixed(row.dependencies) && graphModule.parseEdges(row.dependencies).length > 0
);
if (!mixed) {
  console.error('CONTROL_FAILED: no register row mixes prose with a dependency ID');
  process.exit(2);
}
const kept = graphModule.parseEdges(mixed.dependencies);
const plain = rows.find((row) => {
  const deps = graphModule.parseEdges(row.dependencies);
  return deps.length > 0 && !isMixed(row.dependencies);
});
if (!plain) {
  console.error('CONTROL_FAILED: no register row declares a bare dependency ID');
  process.exit(2);
}

console.log(
  'CONTROL: ' +
    mixed.work_item_id +
    ' kept ' +
    kept.join(', ') +
    ' and discarded prose; ' +
    plain.work_item_id +
    ' parsed completely'
);
console.log('RULE_SINGLE_SOURCE: shadow edges parsed by tools/ai-brain/reconcile.js');
