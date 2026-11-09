'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { parseCandidateKey } = require('./discovery/identity');
const { serializeDispatchOutput } = require('./dispatch-output');

function getTreeProvenance(treePath) {
  const tree = path.resolve(treePath || path.resolve(__dirname, '../..'));
  try {
    const sha = execFileSync('git', ['-c', 'safe.directory=*', 'rev-parse', 'HEAD'], {
      cwd: tree,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return { repoSha: sha, treePath: tree };
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
  const exitFn = deps.exit || process.exit;
  const logErr = deps.error || console.error;
  const mainTree = deps.mainTree || path.resolve(__dirname, '../..');
  const fsApi = deps.fs || fs;
  const spawnFn = deps.spawn || spawn;
  const logsDir = deps.logsDir || path.join(mainTree, '.worktrees/logs/night');
  const provenance = getTreeProvenance(mainTree);
  const logFile = path.join(logsDir, 'route-log.jsonl');

  const chosenKey = decision && decision.chosen !== undefined ? decision.chosen : null;
  if (!chosenKey) {
    const raw =
      (decision && (decision.reason || decision.rejectionReason)) ||
      'Controller ranked candidates but none survived filtering; no re-pick allowed';
    const reason = raw.startsWith('NO_CONTROLLER_CHOICE') ? raw : `NO_CONTROLLER_CHOICE: ${raw}`;
    logErr(`NO_CONTROLLER_CHOICE ${item}: ${reason}`);
    const cands = Array.isArray(decision && decision.ranking) ? decision.ranking.length : 0;
    appendLog(fsApi, logFile, logsDir, {
      at: new Date().toISOString(),
      item,
      role,
      cwd,
      repoSha: provenance.repoSha,
      treePath: provenance.treePath,
      controllerCandidates: cands,
      choice: null,
      noControllerChoice: reason,
    });
    exitFn(3);
    return { launched: false, choice: null, reason, exitCode: 3, spawns: 0, provenance };
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
  const launchDeps = { spawn: spawnFn, fs: fsApi, logsDir, mainTree };
  let launchRecord = deps.launcher ? deps.launcher(payload, cwd, taskFile, item, launchDeps) : null;
  if (!launchRecord) {
    const tag = options.tag || chosenCandidate.tag || `${item}-${Date.now()}`;
    const log = path.join(logsDir, `route-${tag}.log`);
    let fd = null;
    try {
      fsApi.mkdirSync(logsDir, { recursive: true });
      fd = fsApi.openSync(log, 'w');
    } catch {}
    const disc = options.discoveryDir || path.join(mainTree, 'tools/ai-brain/data/discovery');
    const dispatchArgs = [
      path.join(mainTree, 'tools/ai-brain/cli.js'),
      'dispatch',
      '--execute',
      '--json',
    ];
    dispatchArgs.push('--cwd', cwd, '--prompt-file', taskFile);
    dispatchArgs.push('--item', item, '--role', role, '--candidate', chosenKey);
    if (process.env.ROUTE_SCAN_FILE) dispatchArgs.push('--scan-file', process.env.ROUTE_SCAN_FILE);
    if (fsApi.existsSync(disc)) dispatchArgs.push('--discovery-dir', disc);
    const stdio = fd !== null ? ['ignore', fd, fd] : ['ignore', 'pipe', 'pipe'];
    const child = spawnFn(process.execPath, dispatchArgs, {
      cwd: mainTree,
      detached: true,
      stdio,
      env: { ...process.env },
    });
    if (child && typeof child.unref === 'function') child.unref();
    launchRecord = {
      how: `cli.js dispatch --execute pid ${child ? child.pid : 0}`,
      log,
      child,
      tag,
      dispatchArgs,
    };
  }

  const record = {
    at: new Date().toISOString(),
    item,
    role,
    cwd,
    repoSha: provenance.repoSha,
    treePath: provenance.treePath,
    choice: { key: chosenKey, identity: parsedIdentity },
    launch: launchRecord
      ? { how: launchRecord.how, log: launchRecord.log, tag: launchRecord.tag }
      : null,
  };
  try {
    if (decision) {
      record.dispatchOutput = serializeDispatchOutput(decision, {
        launch: launchRecord && launchRecord.child ? { pid: launchRecord.child.pid } : null,
        codeSha: provenance.repoSha,
      });
    }
  } catch {}
  appendLog(fsApi, logFile, logsDir, record);
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
