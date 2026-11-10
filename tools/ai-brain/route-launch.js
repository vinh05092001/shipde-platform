'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { parseCandidateKey } = require('./discovery/identity');
const { serializeDispatchOutput } = require('./dispatch-output');

function getTreeProvenance(treePath, deps = {}) {
  const tree = path.resolve(treePath || path.resolve(__dirname, '../..'));
  if (typeof deps.repoSha === 'string' && deps.repoSha.length >= 7) {
    return { repoSha: deps.repoSha, treePath: tree };
  }
  const execFile = deps.execFileSync || execFileSync;
  try {
    const sha = execFile('git', ['-c', 'safe.directory=*', 'rev-parse', 'HEAD'], {
      cwd: tree,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return sha && sha.length >= 7
      ? { repoSha: sha, treePath: tree }
      : { repoSha: null, treePath: tree };
  } catch {
    return { repoSha: null, treePath: tree };
  }
}

function appendLog(fsApi, logFile, logsDir, entry) {
  try {
    fsApi.mkdirSync(logsDir, { recursive: true });
    fsApi.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch {}
}

function routeLaunchStep(decision, options = {}, deps = {}) {
  const item = options.item || (decision && decision.workItemId) || 'UNKNOWN';
  const role = options.role || (decision && decision.role) || 'author.foundation';
  const cwd = options.cwd || process.cwd();
  const taskFile = options.task || options.taskFile || path.join(cwd, '.oc', 'task.md');
  const logErr = deps.error || console.error;
  const mainTree = deps.mainTree || path.resolve(__dirname, '../..');
  const fsApi = deps.fs || fs;
  const spawnFn = deps.spawn || spawn;
  const logsDir = deps.logsDir || path.join(mainTree, '.worktrees/logs/night');
  const logFile = path.join(logsDir, 'route-log.jsonl');

  const chosenKey = decision && decision.chosen !== undefined ? decision.chosen : null;
  if (!chosenKey) {
    const raw =
      (decision && (decision.reason || decision.rejectionReason)) ||
      'Controller ranked candidates but none survived filtering; no re-pick allowed';
    const detail = raw.startsWith('NO_CONTROLLER_CHOICE') ? raw : `NO_CONTROLLER_CHOICE: ${raw}`;
    logErr(`NO_CONTROLLER_CHOICE ${item}: ${detail}`);
    const cands = Array.isArray(decision && decision.ranking) ? decision.ranking.length : 0;
    appendLog(fsApi, logFile, logsDir, {
      at: new Date().toISOString(),
      item,
      role,
      cwd,
      repoSha: null,
      treePath: path.resolve(mainTree),
      controllerCandidates: cands,
      choice: null,
      noControllerChoice: detail,
    });
    return {
      launched: false,
      choice: null,
      reason: 'NO_CONTROLLER_CHOICE',
      detail,
      exitCode: 3,
      spawns: 0,
      provenance: { repoSha: null, treePath: path.resolve(mainTree) },
    };
  }

  const provenance = getTreeProvenance(mainTree, deps);
  if (!provenance || !provenance.repoSha) {
    const detail = 'Missing or unavailable git commit SHA';
    logErr(`PROVENANCE_UNAVAILABLE ${item}: ${detail}`);
    return {
      launched: false,
      choice: chosenKey,
      reason: 'PROVENANCE_UNAVAILABLE',
      detail,
      exitCode: 1,
      spawns: 0,
      provenance: provenance || { repoSha: null, treePath: path.resolve(mainTree) },
    };
  }

  const chosenCandidate = (decision.candidates || []).find(
    (c) => (c.offeringId || c.candidateKey) === chosenKey
  ) ||
    (decision.ranking || []).find((r) => r.candidateKey === chosenKey) || { key: chosenKey };
  const parsedIdentity = parseCandidateKey(chosenKey) || {};
  const payload = {
    ...chosenCandidate,
    key: chosenKey,
    role,
    identity: parsedIdentity,
    model: parsedIdentity.modelId || chosenCandidate.model,
    kind: parsedIdentity.harness || chosenCandidate.kind,
  };

  const tag = options.tag || chosenCandidate.tag || `${item}-${Date.now()}`;
  const log = path.join(logsDir, `route-${tag}.log`);
  const disc = options.discoveryDir || path.join(mainTree, 'tools/ai-brain/data/discovery');
  const dispatchArgs = [
    path.join(mainTree, 'tools/ai-brain/cli.js'),
    'dispatch',
    '--execute',
    '--json',
    '--cwd',
    cwd,
    '--prompt-file',
    taskFile,
    '--item',
    item,
    '--role',
    role,
    '--offering',
    chosenKey,
  ];
  if (process.env.ROUTE_SCAN_FILE) dispatchArgs.push('--scan-file', process.env.ROUTE_SCAN_FILE);
  if (fsApi.existsSync && fsApi.existsSync(disc)) dispatchArgs.push('--discovery-dir', disc);

  const record = {
    at: new Date().toISOString(),
    item,
    role,
    cwd,
    repoSha: provenance.repoSha,
    treePath: provenance.treePath,
    choice: { key: chosenKey, identity: parsedIdentity },
    launch: { how: 'cli.js dispatch --execute', log, tag, dispatchArgs },
  };
  try {
    if (decision)
      record.dispatchOutput = serializeDispatchOutput(decision, {
        codeSha: provenance.repoSha,
      });
  } catch {}

  try {
    fsApi.mkdirSync(logsDir, { recursive: true });
    fsApi.appendFileSync(logFile, JSON.stringify(record) + '\n');
  } catch (err) {
    const detail = `Failed to persist runtime provenance record: ${err.message}`;
    logErr(`PROVENANCE_PERSIST_FAILED ${item}: ${detail}`);
    return {
      launched: false,
      choice: chosenKey,
      reason: 'PROVENANCE_UNAVAILABLE',
      detail,
      exitCode: 1,
      spawns: 0,
      provenance,
    };
  }

  const launchDeps = { spawn: spawnFn, fs: fsApi, logsDir, mainTree };
  let launchRecord = null;
  if (deps.launcher) {
    try {
      launchRecord = deps.launcher(payload, cwd, taskFile, item, launchDeps);
    } catch (err) {
      logErr(`LAUNCHER_ERROR ${item}: ${err.message}`);
      return {
        launched: false,
        choice: chosenKey,
        reason: 'LAUNCHER_ERROR',
        detail: err.message,
        spawns: 0,
        provenance,
      };
    }
    if (!launchRecord || typeof launchRecord !== 'object') {
      return {
        launched: false,
        choice: chosenKey,
        reason: 'INVALID_LAUNCHER_RESULT',
        detail: 'Custom launcher returned invalid result without fallback',
        spawns: 0,
        provenance,
      };
    }
  } else {
    let fd = null;
    try {
      try {
        if (typeof fsApi.openSync === 'function') fd = fsApi.openSync(log, 'w');
      } catch {}
      const stdio = fd !== null ? ['ignore', fd, fd] : ['ignore', 'pipe', 'pipe'];
      let child = null;
      try {
        child = spawnFn(process.execPath, dispatchArgs, {
          cwd: mainTree,
          detached: true,
          stdio,
          env: { ...process.env },
        });
      } catch (spawnErr) {
        logErr(`SPAWN_ERROR ${item}: ${spawnErr.message}`);
        return {
          launched: false,
          choice: chosenKey,
          reason: 'SPAWN_ERROR',
          detail: spawnErr.message,
          spawns: 0,
          provenance,
        };
      }
      if (child && typeof child.unref === 'function') child.unref();
      if (child && typeof child.on === 'function') {
        child.on('error', (err) => {
          logErr(`CHILD_SPAWN_ASYNC_ERROR ${item}: ${err.message || err}`);
          appendLog(fsApi, logFile, logsDir, {
            at: new Date().toISOString(),
            item,
            role,
            cwd,
            repoSha: provenance.repoSha,
            treePath: provenance.treePath,
            choice: { key: chosenKey, identity: parsedIdentity },
            status: 'spawn_failed',
            error: err && err.message ? err.message : String(err),
          });
        });
      }
      launchRecord = {
        how: `cli.js dispatch --execute pid ${child ? child.pid : 0}`,
        log,
        child,
        tag,
        dispatchArgs,
      };
    } finally {
      if (fd !== null && typeof fsApi.closeSync === 'function') {
        try {
          fsApi.closeSync(fd);
        } catch {}
      }
    }
  }

  return {
    launched: true,
    choice: chosenKey,
    argvIdentity: parsedIdentity,
    launchRecord,
    spawns: 1,
    provenance,
  };
}

module.exports = { getTreeProvenance, routeLaunchStep };
