'use strict';
// AC-AI-24-02 — the executor's argument vector has the shape that
// New-ShipDeAoSpawnArguments in scripts/ai/control.ps1 builds, read from the
// file on disk rather than copied. Control: a reordered vector is rejected by
// the same comparison. Exit 0 proven, 1 violated, 2 cannot measure.
const fs = require('fs');
const path = require('path');

const EXECUTOR = 'tools/ai-brain/executor.js';
const CONTROL_PS1 = 'scripts/ai/control.ps1';
for (const f of [EXECUTOR, CONTROL_PS1]) {
  if (!fs.existsSync(f)) {
    console.error('SOURCE_MISSING: ' + f + ' (run from the repository root)');
    process.exit(2);
  }
}
const { executePlan, Outcome } = require(path.resolve(EXECUTOR));

const src = fs.readFileSync(CONTROL_PS1, 'utf8');
const m = src.match(/function New-ShipDeAoSpawnArguments[\s\S]*?return @\(([\s\S]*?)\)\s*\}/);
if (!m) {
  console.error('SOURCE_MISSING: New-ShipDeAoSpawnArguments return vector not found');
  process.exit(2);
}
// Literal tokens are quoted strings; everything else is a PowerShell variable.
const expected = (m[1].match(/"[^"]*"|\$[\w.]+/g) || []).map((t) =>
  t.startsWith('"') ? { literal: t.slice(1, -1) } : { variable: t }
);
console.log(
  'CONTROL_PS1_VECTOR: ' +
    expected.map((t) => (t.literal !== undefined ? t.literal : t.variable)).join(' ')
);

function matches(vector) {
  if (!Array.isArray(vector) || vector.length !== expected.length) return false;
  return expected.every((tok, i) =>
    tok.literal !== undefined ? vector[i] === tok.literal : !String(vector[i]).startsWith('--')
  );
}

const calls = [];
const result = executePlan(
  {
    assignments: [
      {
        workItemId: 'TASK-AI-99',
        role: 'author.foundation',
        branch: 'feat/a',
        provider: 'antigravity',
      },
    ],
    deferred: [],
    utilisation: { maxImplementation: 1 },
  },
  {
    dryRun: false,
    promptFor: () => 'prompt',
    runAo: (args) => (calls.push(args), { exitCode: 0, stdout: '{"id":"s"}', stderr: '' }),
  }
);
const actual = calls[0];
console.log('EXECUTOR_VECTOR: ' + JSON.stringify(actual));

const reordered = actual.slice();
reordered.splice(1, 2, actual[3], actual[4]);
reordered.splice(3, 2, actual[1], actual[2]);
if (matches(reordered)) {
  console.error('CONTROL_FAILED: a reordered vector was accepted');
  process.exit(2);
}
console.log('CONTROL: reordered vector ' + JSON.stringify(reordered.slice(0, 5)) + ' rejected');

const ok = result.records[0].outcome === Outcome.LAUNCHED && matches(actual);
console.log('SPAWN_ARGS_MATCH_CONTROL_PS1: ' + ok);
process.exit(ok ? 0 : 1);
