'use strict';
// AC-AI-39-05 — negative proof that falsely declaring agent-scan ADOPTED /
// BLOCKING_GATE is caught by the real manifest audit.
//
// The audit is not reimplemented here: this calls the same `auditManifest`
// function `node tools/ai-brain/cli.js manifest` runs. The tampered manifest is
// WRITTEN to os.tmpdir() and RE-READ from disk before it is audited, so the
// proof exercises a manifest that arrived the way the real one does — through a
// file — rather than an object mutated in memory. No repository file is written.
//
// The presence probe is injected as "absent". Without it the outcome would
// depend on whether snyk-agent-scan happens to be installed on the machine
// running the proof: ADOPTED-but-present is not a missing gate. The premise
// this row proves is ADOPTED-while-absent, so absence is pinned, not guessed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const { auditManifest } = require('../manifest-audit');

const SOURCE = path.join('tools', 'ecosystem-manifest.json');
// The probe replaces only the machine-dependent part of the audit; the manifest
// itself is still read, tampered, written and re-read on disk.
const ABSENT = { onPath: () => false, dependencies: new Set(), rootDir: process.cwd() };

if (!fs.existsSync(SOURCE)) {
  console.error('SOURCE_MISSING: ' + SOURCE);
  process.exit(2);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
} catch (err) {
  console.error('SOURCE_UNREADABLE: ' + SOURCE + ': ' + err.message);
  process.exit(2);
}

const entry = (manifest.adopted || []).find((x) => x.id === 'agent-scan');
if (!entry) {
  console.error('ENTRY_MISSING: agent-scan');
  process.exit(2);
}

// Control: the untouched manifest must not already report agent-scan as a
// missing quality gate, or promoting it proves nothing.
const before = auditManifest(JSON.parse(JSON.stringify(manifest)), ABSENT);
if (before.findings.some((f) => f.id === 'agent-scan' && f.code === 'QUALITY_GATE_MISSING')) {
  console.error('CONTROL_FAILED: agent-scan already reports QUALITY_GATE_MISSING as PENDING');
  process.exit(2);
}

entry.lifecycle_state = 'ADOPTED';
entry.blocking_policy = 'BLOCKING_GATE';

const tmp = path.join(os.tmpdir(), 'shipde-ac39-05-' + process.pid + '.json');
let reread;
try {
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
  reread = JSON.parse(fs.readFileSync(tmp, 'utf8'));
} catch (err) {
  console.error('TAMPER_COPY_FAILED: ' + err.message);
  process.exit(2);
} finally {
  try {
    fs.unlinkSync(tmp);
  } catch (e) {
    /* the copy is in the OS temp directory; a failed cleanup is not a finding */
  }
}

const after = auditManifest(reread, ABSENT);
const found = after.findings.find(
  (f) => f.id === 'agent-scan' && f.code === 'QUALITY_GATE_MISSING' && f.severity === 'error'
);

if (!found) {
  console.error(
    'QUALITY_GATE_CLASSIFIER_REGRESSION: agent-scan declared ADOPTED did not raise QUALITY_GATE_MISSING'
  );
  process.exit(0);
}

console.error('QUALITY_GATE_MISSING: ' + found.id);
process.exit(1);
