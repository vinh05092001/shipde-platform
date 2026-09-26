'use strict';
/**
 * Small helper invoked by the hermes harness `inspect` probe.
 * It receives a session identifier (the workspace directory) as its first
 * argument, reads the previous progress snapshot from a temporary file, then
 * gathers the current signals and emits a JSON object.
 *
 * The snapshot format matches what `executor.js` expects:
 *   {
 *     progress: 'alive'|'stalled'|'unknown',
 *     error: <string|undefined>,
 *     diffChanged: <bool>,
 *     commitChanged: <bool>,
 *     testRan: <bool>,
 *     checkpointWritten: <bool>,
 *     logGrew: <bool>
 *   }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assessProgress } = require('./progress');

function readPrev(tmpPath) {
  try { return JSON.parse(fs.readFileSync(tmpPath, 'utf8')); } catch (_) { return null; }
}

function gatherSignals(workspace) {
  // 1. Diff vs HEAD – simple git diff --quiet; if non‑zero there is change.
  let diffChanged = false;
  try { const res = require('child_process').spawnSync('git', ['diff', '--quiet'], { cwd: workspace });
    diffChanged = res.status !== 0;
  } catch (_) {}

  // 2. Commit changed – compare HEAD SHA now with a stored one.
  let commitChanged = false;
  const commitFile = path.join(workspace, '.lastCommit');
  try {
    const current = require('child_process').execSync('git rev-parse HEAD', { cwd: workspace }).toString().trim();
    const prev = fs.readFileSync(commitFile, 'utf8').trim();
    commitChanged = current !== prev;
    fs.writeFileSync(commitFile, current);
  } catch (_) {}

  // 3. Test ran – look for a recent test result file (placeholder).
  let testRan = false;
  const testFile = path.join(workspace, 'testResult.json');
  if (fs.existsSync(testFile)) {
    try { const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      testRan = !!data.ran;
    } catch (_) {}
  }

  // 4. Checkpoint written – a timestamp file updated by the writer (placeholder).
  let checkpointWritten = false;
  const cpFile = path.join(workspace, '.checkpoint');
  if (fs.existsSync(cpFile)) {
    try { const mtime = fs.statSync(cpFile).mtimeMs;
      const prevM = parseFloat(fs.readFileSync(cpFile + '.prev', 'utf8')) || 0;
      checkpointWritten = mtime > prevM;
      fs.writeFileSync(cpFile + '.prev', String(mtime));
    } catch (_) {}
  }

  // 5. Log grew – count lines in the writer log.
  let logGrew = false;
  const logFile = path.join(workspace, 'writer.log');
  const sizeFile = path.join(workspace, '.logSize');
  if (fs.existsSync(logFile)) {
    try {
      const cur = fs.statSync(logFile).size;
      const prev = parseInt(fs.readFileSync(sizeFile, 'utf8'), 10) || 0;
      logGrew = cur > prev;
      fs.writeFileSync(sizeFile, String(cur));
    } catch (_) {}
  }

  // 6. Last error – read from a file the executor writes when refusing.
  let error = undefined;
  const errFile = path.join(workspace, '.lastError');
  if (fs.existsSync(errFile)) {
    try { error = fs.readFileSync(errFile, 'utf8').trim(); } catch (_) {}
  }

  return { diffChanged, commitChanged, testRan, checkpointWritten, logGrew, error };
}

function main() {
  const session = process.argv[2] || '';
  const workspace = session.replace(/^dir:/, '');
  const tmpPath = path.join(os.tmpdir(), 'progress_' + workspace.replace(/[\/]/g, '_') + '.json');
  const prev = readPrev(tmpPath);
  const curr = gatherSignals(workspace);
  const verdict = assessProgress(prev, curr);
  const out = { ...curr, progress: verdict };
  // persist for next call
  try { fs.writeFileSync(tmpPath, JSON.stringify(out), 'utf8'); } catch (_) {}
  console.log(JSON.stringify(out));
}

if (require.main === module) main();
