'use strict';
// AC-AI-24-06 — the planner stays side-effect free: scheduler.js references no
// process-launching API and does not call the executor. Control: a copy of
// scheduler.js with an injected child_process require is detected by the same
// check. Exit 0 proven, 1 violated, 2 cannot measure.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCHEDULER = 'tools/ai-brain/scheduler.js';
const EXECUTOR = 'tools/ai-brain/executor.js';
for (const f of [SCHEDULER, EXECUTOR]) {
  if (!fs.existsSync(f)) {
    console.error('SOURCE_MISSING: ' + f + ' (run from the repository root)');
    process.exit(2);
  }
}

const LAUNCH =
  /require\(\s*['"](?:node:)?child_process['"]\s*\)|\b(?:spawnSync|execSync|execFileSync|execFile)\b|require\(\s*['"]\.\/executor['"]\s*\)|\bexecutePlan\b/g;
const count = (text) => (text.match(LAUNCH) || []).length;

const real = fs.readFileSync(SCHEDULER, 'utf8');
const tmp = path.join(os.tmpdir(), 'shipde-ac24-06-' + process.pid + '.js');
fs.writeFileSync(tmp, "const cp = require('child_process');\n" + real);
const tampered = count(fs.readFileSync(tmp, 'utf8'));
fs.unlinkSync(tmp);
if (tampered <= count(real)) {
  console.error('CONTROL_FAILED: injected child_process require not detected');
  process.exit(2);
}
console.log('CONTROL: tampered copy has ' + tampered + ' launch reference(s)');

const n = count(real);
console.log('SCHEDULER_LAUNCH_REFERENCES: ' + n);
process.exit(n === 0 ? 0 : 1);
