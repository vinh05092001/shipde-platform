'use strict';
/**
 * Progress probe helper (TASK-AI-50 slice C1).
 *
 * Gathers progress signals from a workspace directory:
 *   1. Worktree diff vs HEAD (git diff / status)
 *   2. Commit changed (git rev-parse HEAD vs stored headSha)
 *   3. Test ran (testResult.json mtime or flags)
 *   4. Checkpoint written (.checkpoint mtime)
 *   5. Log grew (writer.log size)
 *   6. Last error (.lastError)
 *
 * Can be called as a module function `probeProgress(sessionOrDir, options)`
 * or invoked as a standalone CLI (`node progressProbe.js <session>`).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { evaluateProgress, DEFAULT_WINDOW_MS } = require('./progress');

function getTmpPath(workspace) {
  const safeName = String(workspace || '').replace(/[\/\\:]/g, '_');
  return path.join(os.tmpdir(), 'shipde_progress_' + safeName + '.json');
}

function readPrev(tmpPath) {
  try {
    return JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function gatherSignals(workspace, prev) {
  const dirExists = fs.existsSync(workspace);
  if (!dirExists) {
    return {
      measurable: false,
      diffChanged: false,
      commitChanged: false,
      testRan: false,
      checkpointWritten: false,
      logGrew: false,
      error: undefined,
    };
  }

  let measurable = false;

  // 1. Diff vs HEAD: git status --porcelain
  let diffChanged = false;
  try {
    const res = spawnSync('git', ['status', '--porcelain'], {
      cwd: workspace,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    if (res.status === 0) {
      measurable = true;
      diffChanged = Boolean(res.stdout && res.stdout.trim().length > 0);
    }
  } catch (_) {}

  // 2. Commit changed: git rev-parse HEAD
  let commitChanged = false;
  let headSha = null;
  try {
    const res = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: workspace,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    });
    if (res.status === 0 && res.stdout) {
      headSha = res.stdout.trim();
      measurable = true;
      if (prev && prev.headSha) {
        commitChanged = headSha !== prev.headSha;
      }
    }
  } catch (_) {}

  // 3. Test ran: testResult.json
  let testRan = false;
  let testMtime = null;
  const testFile = path.join(workspace, 'testResult.json');
  try {
    if (fs.existsSync(testFile)) {
      measurable = true;
      testMtime = fs.statSync(testFile).mtimeMs;
      if (prev && prev.testMtime !== undefined) {
        testRan = testMtime > prev.testMtime;
      } else {
        const data = JSON.parse(fs.readFileSync(testFile, 'utf8'));
        testRan = Boolean(data && data.ran);
      }
    }
  } catch (_) {}

  // 4. Checkpoint written: .checkpoint
  let checkpointWritten = false;
  let checkpointMtime = null;
  const cpFile = path.join(workspace, '.checkpoint');
  try {
    if (fs.existsSync(cpFile)) {
      measurable = true;
      checkpointMtime = fs.statSync(cpFile).mtimeMs;
      if (prev && prev.checkpointMtime !== undefined) {
        checkpointWritten = checkpointMtime > prev.checkpointMtime;
      }
    }
  } catch (_) {}

  // 5. Log grew: writer.log
  let logGrew = false;
  let logSize = null;
  const logFile = path.join(workspace, 'writer.log');
  try {
    if (fs.existsSync(logFile)) {
      measurable = true;
      logSize = fs.statSync(logFile).size;
      if (prev && prev.logSize !== undefined) {
        logGrew = logSize > prev.logSize;
      }
    }
  } catch (_) {}

  // 6. Last error: .lastError
  let error = undefined;
  const errFile = path.join(workspace, '.lastError');
  try {
    if (fs.existsSync(errFile)) {
      measurable = true;
      error = fs.readFileSync(errFile, 'utf8').trim() || undefined;
    }
  } catch (_) {}

  return {
    measurable,
    diffChanged,
    commitChanged,
    testRan,
    checkpointWritten,
    logGrew,
    error,
    headSha,
    testMtime,
    checkpointMtime,
    logSize,
  };
}

/**
 * Probes progress for a session or workspace directory.
 *
 * @param {string} sessionOrDir - Session id (e.g. 'dir:C:/w') or directory path.
 * @param {Object} [options] - Options (now, windowMs, prev, signals, persist, storePath).
 * @returns {Object} Progress snapshot with progress verdict and cause.
 */
function probeProgress(sessionOrDir, options) {
  const opts = options || {};
  const session = String(sessionOrDir || '');
  const workspace = session.startsWith('dir:') ? session.slice(4) : session;
  const tmpPath = opts.storePath || getTmpPath(workspace);
  const prev = opts.prev !== undefined ? opts.prev : readPrev(tmpPath);

  const signals = opts.signals ? Object.assign({}, opts.signals) : gatherSignals(workspace, prev);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const windowMs = Number.isFinite(opts.windowMs) ? opts.windowMs : DEFAULT_WINDOW_MS;

  const curr = {
    timestamp: now,
    windowMs,
    diffChanged: signals.diffChanged,
    commitChanged: signals.commitChanged,
    testRan: signals.testRan,
    checkpointWritten: signals.checkpointWritten,
    logGrew: signals.logGrew,
    error: signals.error,
    headSha: signals.headSha,
    testMtime: signals.testMtime,
    checkpointMtime: signals.checkpointMtime,
    logSize: signals.logSize,
    measurable: signals.measurable,
  };

  const evalRes = evaluateProgress(prev, curr, { now, windowMs });
  const verdictLower = evalRes.verdict.toLowerCase();

  const out = {
    ...curr,
    progress: verdictLower,
    verdict: evalRes.verdict,
    cause: evalRes.cause,
    lastProgressAt: evalRes.lastProgressAt,
  };

  if (opts.persist !== false) {
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(out), 'utf8');
    } catch (_) {}
  }

  return out;
}

function main() {
  const session = process.argv[2] || '';
  const out = probeProgress(session);
  console.log(JSON.stringify(out));
}

if (require.main === module) main();

module.exports = {
  gatherSignals,
  probeProgress,
  readPrev,
  getTmpPath,
};
