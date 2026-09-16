'use strict';
// AC-AI-33-02 — negative proof that a shadow which disagrees with the register
// is reported, not reconciled, and that the register is never rewritten.
//
// A real edge is read from the real register. The shadow is projected and a
// CONTROL confirms it agrees. One edge is then removed from a COPY of the shadow
// in os.tmpdir(), and the comparison must name exactly that edge as
// MISSING_IN_SHADOW — while the register's bytes stay identical, because a
// shadow that could edit the authority to match itself would not be a shadow.
//
// The rule is ./lib/dependency-graph.js, required by AC-AI-33-01 and AC-AI-33-03
// as well, so the gate and the proof of the gate cannot drift apart. Exit 2,
// never 1, when run outside the repository.
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

// A real edge, preferably one whose absence would matter: the register's declared
// dependencies on the reconciler this Work Item builds on.
const edge =
  registerGraph.edges.find((candidate) => candidate.to === 'TASK-AI-19') || registerGraph.edges[0];
if (!edge) {
  console.error('SOURCE_MISSING: the register declares no dependency edge to remove');
  process.exit(2);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-ac-33-02-'));
try {
  const shadowPath = path.join(tmpDir, 'shadow.json');
  fs.writeFileSync(shadowPath, toShadowJson(registerGraph));
  const shadowGraph = fromShadowJson(fs.readFileSync(shadowPath, 'utf8'));

  // CONTROL: the untouched shadow must agree, or rejecting a tampered one proves
  // nothing about the rule.
  if (diffGraphs(registerGraph, shadowGraph).length !== 0) {
    console.error('CONTROL_FAILED: the untampered shadow already diverges from the register');
    process.exit(2);
  }

  const tampered = {
    nodes: shadowGraph.nodes,
    edges: shadowGraph.edges.filter(
      (candidate) => !(candidate.from === edge.from && candidate.to === edge.to)
    ),
  };
  fs.writeFileSync(shadowPath, JSON.stringify(tampered, null, 2) + '\n');
  const divergences = diffGraphs(
    registerGraph,
    fromShadowJson(fs.readFileSync(shadowPath, 'utf8'))
  );

  const after = digest(fs.readFileSync(REGISTER_PATH));
  if (after !== before) {
    console.error('SHADOW_WROTE_THE_REGISTER: ' + before + ' -> ' + after);
    process.exit(1);
  }

  const found = divergences.find(
    (divergence) =>
      divergence.type === EDGE_TYPE.MISSING_IN_SHADOW &&
      divergence.from === edge.from &&
      divergence.to === edge.to
  );
  if (!found) {
    console.error('SHADOW_DIVERGENCE_NOT_DETECTED');
    process.exit(0);
  }
  console.error('SHADOW_DIVERGENCE_DETECTED: MISSING_IN_SHADOW ' + edge.from + ' -> ' + edge.to);
  process.exit(1);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
