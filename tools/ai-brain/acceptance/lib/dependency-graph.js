'use strict';
// TASK-AI-33 — the register's dependency graph and its shadow, in one place.
//
// The delivery register stays authoritative. A Beads-style shadow store may be
// projected from it, but the shadow owns no state: any edge it disagrees about
// is a divergence to report, never a register edit to make. AC-AI-33-01 (the
// parity row), AC-AI-33-02 (its negative proof) and AC-AI-33-03 (the coupling
// row) all require this module, so the comparison exists once.
//
// Two rules are re-used rather than restated:
//   * the edge rule IS the reconciler's own `parseDependencies`, re-exported by
//     reference as `parseEdges`. A shadow that parsed `dependencies` differently
//     from reconciliation would report divergences that are an artefact of two
//     parsers, not of two graphs.
//   * the register is read by the canonical RFC 4180 parser in
//     tools/ai-dashboard/register-adapter.js — a second CSV parser is a second
//     answer to what the register says.
//
// Exit codes used by the scripts that require this file:
//   0 the graphs agree   1 they diverge   2 the comparison cannot be measured

const path = require('path');
const { parseRegisterCsv } = require('../../../ai-dashboard/register-adapter');
const { parseDependencies } = require('../../reconcile');

const REGISTER_PATH = path.join(
  'docs',
  'product-spec',
  'docs',
  '10-ai-collaboration',
  'FEATURE-DELIVERY-REGISTER.csv'
);

const EDGE_TYPE = {
  MISSING_IN_SHADOW: 'MISSING_IN_SHADOW',
  EXTRA_IN_SHADOW: 'EXTRA_IN_SHADOW',
};

// The reconciler's own dependency parser, not a copy of it.
const parseEdges = parseDependencies;

/** Register rows, parsed by the canonical adapter. `rootDir` is not consulted. */
function registerRows(text) {
  return parseRegisterCsv(text, null);
}

function edgeKey(edge) {
  return edge.from + ' -> ' + edge.to;
}

/** Sorted, de-duplicated graph so two runs and two stores compare byte-for-byte. */
function normalize(graph) {
  const nodes = Array.from(new Set(graph.nodes)).sort();
  const seen = new Set();
  const edges = [];
  for (const edge of graph.edges) {
    const key = edgeKey(edge);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: edge.from, to: edge.to });
  }
  edges.sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : edgeKey(a) > edgeKey(b) ? 1 : 0));
  return { nodes, edges };
}

/** The dependency graph a set of register rows declares. */
function graphFromRows(rows) {
  const nodes = [];
  const edges = [];
  for (const row of rows) {
    if (!row.work_item_id) continue;
    nodes.push(row.work_item_id);
    for (const dep of parseEdges(row.dependencies)) edges.push({ from: row.work_item_id, to: dep });
  }
  return normalize({ nodes, edges });
}

/**
 * Divergences between the register's graph and a shadow's, as edge sets.
 *
 * The comparison is symmetric on purpose: a shadow that dropped an edge and a
 * shadow that invented one are both divergences, and neither is reconciled by
 * editing the register.
 */
function diffGraphs(expected, actual) {
  const expectedKeys = new Set(expected.edges.map(edgeKey));
  const actualKeys = new Set(actual.edges.map(edgeKey));
  const out = [];
  for (const edge of expected.edges) {
    if (!actualKeys.has(edgeKey(edge))) out.push({ type: EDGE_TYPE.MISSING_IN_SHADOW, ...edge });
  }
  for (const edge of actual.edges) {
    if (!expectedKeys.has(edgeKey(edge))) out.push({ type: EDGE_TYPE.EXTRA_IN_SHADOW, ...edge });
  }
  out.sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : 1));
  return out;
}

/** Deterministic serialization of a shadow store. */
function toShadowJson(graph) {
  return JSON.stringify(normalize(graph), null, 2) + '\n';
}

/** Read a shadow store back into a normalized graph. */
function fromShadowJson(text) {
  const parsed = JSON.parse(text);
  return normalize({ nodes: parsed.nodes || [], edges: parsed.edges || [] });
}

module.exports = {
  REGISTER_PATH,
  EDGE_TYPE,
  parseEdges,
  registerRows,
  normalize,
  graphFromRows,
  diffGraphs,
  toShadowJson,
  fromShadowJson,
};
