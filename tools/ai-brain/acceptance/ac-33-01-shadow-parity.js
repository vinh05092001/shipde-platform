'use strict';
// AC-AI-33-01 — the register's dependency graph and its shadow agree, and the
// comparison never writes the register.
//
// The shadow is projected from the real register by the same rule the comparison
// uses, exported to a store in os.tmpdir(), and read back. The row asserts two
// invariants: zero divergences, and the register's bytes identical before and
// after the run — a shadow that owned state would have had to change the
// authority to say so.
//
// CONTROL: one edge is dropped from a copy of the shadow and the comparison must
// report exactly that divergence as MISSING_IN_SHADOW. A comparator that always
// answered "no divergence" would pass the parity half and fail this probe, so
// the probe is what stops the row from being vacuous.
//
// The rule is ./lib/dependency-graph.js, required by AC-AI-33-02 and AC-AI-33-03
// as well. Exit 2, never 1, when run outside the repository.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  REGISTER_PATH,
  EDGE_TYPE,
  registerRows,
  graphFromRows,
  diffGraphs,
  toShadowJson,
  fromShadowJson,
} = require('./lib/dependency-graph');

if (!fs.existsSync(REGISTER_PATH)) {
  console.error('SOURCE_MISSING: ' + REGISTER_PATH.split(path.sep).join('/'));
  process.exit(2);
}

const digest = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const registerBytes = fs.readFileSync(REGISTER_PATH);
const before = digest(registerBytes);

const registerGraph = graphFromRows(registerRows(registerBytes.toString('utf8')));
const dropped = registerGraph.edges[0];
if (!dropped) {
  console.error('SOURCE_MISSING: the register declares no dependency edge to probe with');
  process.exit(2);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-33-01-'));
try {
  const shadowPath = path.join(tmpDir, 'shadow.json');
  fs.writeFileSync(shadowPath, toShadowJson(registerGraph));
  const shadowGraph = fromShadowJson(fs.readFileSync(shadowPath, 'utf8'));

  // CONTROL: a dropped edge must be reported, or "zero divergences" means nothing.
  const tampered = {
    nodes: shadowGraph.nodes,
    edges: shadowGraph.edges.filter(
      (edge) => !(edge.from === dropped.from && edge.to === dropped.to)
    ),
  };
  fs.writeFileSync(shadowPath, JSON.stringify(tampered));
  const control = diffGraphs(registerGraph, fromShadowJson(fs.readFileSync(shadowPath, 'utf8')));
  if (
    control.length !== 1 ||
    control[0].type !== EDGE_TYPE.MISSING_IN_SHADOW ||
    control[0].from !== dropped.from ||
    control[0].to !== dropped.to
  ) {
    console.error('CONTROL_FAILED: a dropped shadow edge was not reported as MISSING_IN_SHADOW');
    process.exit(2);
  }

  const divergences = diffGraphs(registerGraph, shadowGraph);
  const after = digest(fs.readFileSync(REGISTER_PATH));
  if (after !== before) {
    console.error('SHADOW_WROTE_THE_REGISTER: ' + before + ' -> ' + after);
    process.exit(1);
  }
  for (const divergence of divergences) {
    console.error(
      'SHADOW_DIVERGENCE: ' + divergence.type + ' ' + divergence.from + ' -> ' + divergence.to
    );
  }
  if (divergences.length > 0) process.exit(1);

  console.log(
    'SHADOW_PARITY_EVIDENCE: ' +
      registerGraph.nodes.length +
      ' nodes, ' +
      registerGraph.edges.length +
      ' edges'
  );
  console.log('CONTROL: the comparator reported the dropped edge as MISSING_IN_SHADOW');
  console.log('SHADOW_PARITY: 0 divergences, register unchanged');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
