'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { parseCandidateKey } = require('./discovery/identity');
const { serializeDispatchOutput } = require('./dispatch-output');

/**
 * Resolves repository root and commit SHA for runtime provenance.
 * Process count contract: executes at most 1 synchronous `git rev-parse HEAD`
 * process when repoSha is not pre-supplied in deps.
 */
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

/**
 * The launch outcome from the dispatch subprocess itself: exit code plus the
 * JSON result `dispatch --execute --json` prints (#578). Only exit 0 with an
 * outcome status `completed` is a worker launch; a refusal line or a nonzero
 * exit is a refusal; anything else is an unknown launch state, never success.
 */
function outcomeFromDispatch(code, text) {
  const refusal = /Dispatch refused: ([A-Z_]+)/.exec(text || '');
  let parsed = null;
  const lines = String(text || '').split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0 && !parsed; i -= 1) {
    if (!lines[i].startsWith('{')) continue;
    try {
      parsed = JSON.parse(lines.slice(i).join('\n'));
    } catch {}
  }
  const outcome = parsed && parsed.outcome;
  const sessionId =
    (outcome && (outcome.sessionId || (outcome.payload && outcome.payload.sessionId))) || null;
  if (code === 0 && outcome && outcome.status === 'completed') {
    return { launched: true, status: 'worker_launched', ...(sessionId ? { sessionId } : {}) };
  }
  if (refusal || code !== 0) {
    return {
      launched: false,
      status: 'refused',
      reason: (refusal && refusal[1]) || (outcome && outcome.reason) || 'DISPATCH_EXIT_' + code,
    };
  }
  return { launched: false, status: 'launch_state_unknown', reason: 'NO_LAUNCH_RECEIPT' };
}

function withCompletion(result) {
  const p = Promise.resolve(result);
  result.completion = p;
  result.promise = p;
  result.wait = () => p;
  return result;
}

/**
 * Executes or refuses route launch based on Controller decision.
 *
 * Process-count contract:
 * - When decision.chosen is null / refused: exactly 0 child processes of any kind
 *   run (neither git rev-parse nor execution dispatch).
 * - When decision.chosen is present:
 *   - If deps.repoSha is provided: 0 git subprocesses, exactly 1 execution dispatch spawn.
 *   - If deps.repoSha is omitted: exactly 1 bounded synchronous git subprocess
 *     (`git rev-parse HEAD`) for provenance, followed by exactly 1 execution dispatch spawn.
 *     Total bounded child processes: 2 (1 provenance + 1 dispatch).
 */
function routeLaunchStep(decision, options = {}, deps = {}) {
  const item = options.item || (decision && decision.workItemId) || 'UNKNOWN';
  const role = options.role || (decision && decision.role) || 'author.foundation';
  // One path rule: cwd and task resolve once against the caller's working
  // directory (absolute inputs are kept), never against the dispatch tree.
  const invocationCwd = options.invocationCwd || process.cwd();
  const cwd = path.resolve(invocationCwd, options.cwd || '.');
  const rawTask = options.task || options.taskFile;
  const taskFile = rawTask
    ? path.resolve(invocationCwd, rawTask)
    : path.join(cwd, '.oc', 'task.md');
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
    return withCompletion({
      launched: false,
      choice: null,
      reason: 'NO_CONTROLLER_CHOICE',
      detail,
      exitCode: 3,
      spawns: 0,
      provenance: { repoSha: null, treePath: path.resolve(mainTree) },
    });
  }

  if (typeof fsApi.existsSync === 'function') {
    const missing = [cwd, taskFile].filter((p) => !fsApi.existsSync(p));
    if (missing.length) {
      const detail = `Path does not exist: ${missing.join(', ')}`;
      logErr(`TARGET_PATH_INVALID ${item}: ${detail}`);
      return withCompletion({
        launched: false,
        choice: chosenKey,
        reason: 'TARGET_PATH_INVALID',
        detail,
        exitCode: 1,
        spawns: 0,
        provenance: { repoSha: null, treePath: path.resolve(mainTree) },
      });
    }
  }

  const rawTimeout =
    options.timeoutMs !== undefined
      ? options.timeoutMs
      : options.workerTimeoutMs !== undefined
        ? options.workerTimeoutMs
        : undefined;

  let validatedTimeoutMs = null;
  if (rawTimeout !== undefined) {
    if (typeof rawTimeout === 'number') {
      if (Number.isFinite(rawTimeout) && Number.isInteger(rawTimeout) && rawTimeout > 0) {
        validatedTimeoutMs = rawTimeout;
      }
    } else if (typeof rawTimeout === 'string' && /^\s*\d+\s*$/.test(rawTimeout)) {
      const parsed = Number(rawTimeout);
      if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0) {
        validatedTimeoutMs = parsed;
      }
    }
    if (validatedTimeoutMs === null) {
      const detail = `Invalid worker timeout: ${rawTimeout}`;
      logErr(`TIMEOUT_INVALID ${item}: ${detail}`);
      return withCompletion({
        launched: false,
        choice: chosenKey,
        reason: 'TIMEOUT_INVALID',
        detail,
        exitCode: 1,
        spawns: 0,
        provenance: {
          repoSha:
            typeof deps.repoSha === 'string' && deps.repoSha.length >= 7 ? deps.repoSha : null,
          treePath: path.resolve(mainTree),
        },
      });
    }
  }

  const provenance = getTreeProvenance(mainTree, deps);
  if (!provenance || !provenance.repoSha) {
    const detail = 'Missing or unavailable git commit SHA';
    logErr(`PROVENANCE_UNAVAILABLE ${item}: ${detail}`);
    return withCompletion({
      launched: false,
      choice: chosenKey,
      reason: 'PROVENANCE_UNAVAILABLE',
      detail,
      exitCode: 1,
      spawns: 0,
      provenance: provenance || { repoSha: null, treePath: path.resolve(mainTree) },
    });
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
  if (validatedTimeoutMs !== null) {
    dispatchArgs.push('--timeout-ms', String(validatedTimeoutMs));
  }
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
    return withCompletion({
      launched: false,
      choice: chosenKey,
      reason: 'PROVENANCE_UNAVAILABLE',
      detail,
      exitCode: 1,
      spawns: 0,
      provenance,
    });
  }

  let launcherSpawns = 0;
  const wrappedSpawn = (...args) => {
    launcherSpawns += 1;
    return spawnFn(...args);
  };
  const launchDeps = { spawn: wrappedSpawn, fs: fsApi, logsDir, mainTree };
  let launchRecord = null;
  if (deps.launcher) {
    try {
      launchRecord = deps.launcher(payload, cwd, taskFile, item, launchDeps);
    } catch (err) {
      logErr(`LAUNCHER_ERROR ${item}: ${err.message}`);
      const detail =
        launcherSpawns > 0
          ? `${err.message} (launch state unknown/failed; dispatch may have occurred)`
          : err.message;
      return withCompletion({
        launched: false,
        status: launcherSpawns > 0 ? 'launch_state_unknown/failed' : 'failed',
        choice: chosenKey,
        reason: 'LAUNCHER_ERROR',
        detail,
        spawns: launcherSpawns,
        provenance,
      });
    }
    if (!launchRecord || typeof launchRecord !== 'object') {
      const detail =
        launcherSpawns > 0
          ? 'Custom launcher returned invalid result after dispatch (launch state unknown/failed)'
          : 'Custom launcher returned invalid result without fallback (no execution occurred)';
      return withCompletion({
        launched: false,
        status: launcherSpawns > 0 ? 'launch_state_unknown/failed' : 'failed',
        choice: chosenKey,
        reason: 'INVALID_LAUNCHER_RESULT',
        detail,
        spawns: launcherSpawns,
        provenance,
      });
    }
    // A launcher that reports its own refusal or failure is not a launch.
    const refused =
      launchRecord.launched === false ||
      (launchRecord.exitCode !== undefined && launchRecord.exitCode !== 0);
    if (refused) {
      return withCompletion({
        launched: false,
        status: 'refused',
        choice: chosenKey,
        reason: launchRecord.reason || 'LAUNCHER_REFUSED',
        detail: launchRecord.detail,
        launchRecord,
        exitCode: 1,
        spawns: launcherSpawns,
        provenance,
      });
    }
    return withCompletion({
      launched: true,
      choice: chosenKey,
      argvIdentity: parsedIdentity,
      launchRecord,
      spawns: launcherSpawns > 0 ? launcherSpawns : 1,
      provenance,
    });
  }

  let fd = null;
  if (typeof fsApi.openSync === 'function') {
    try {
      fd = fsApi.openSync(log, 'w');
    } catch (err) {
      const detail = `Failed to open execution output log: ${err.message}`;
      logErr(`LOG_OPEN_FAILED ${item}: ${detail}`);
      return withCompletion({
        launched: false,
        choice: chosenKey,
        reason: 'LOG_OPEN_FAILED',
        detail,
        exitCode: 1,
        spawns: 0,
        provenance,
      });
    }
  }

  const stdio = fd !== null ? ['ignore', fd, fd] : ['ignore', 'ignore', 'ignore'];
  let child = null;
  try {
    try {
      child = spawnFn(process.execPath, dispatchArgs, {
        cwd: mainTree,
        detached: true,
        stdio,
        env: { ...process.env },
      });
    } catch (spawnErr) {
      logErr(`SPAWN_ERROR ${item}: ${spawnErr.message}`);
      return withCompletion({
        launched: false,
        choice: chosenKey,
        reason: 'SPAWN_ERROR',
        detail: spawnErr.message,
        exitCode: 1,
        spawns: 0,
        provenance,
      });
    }

    launchRecord = {
      how: `cli.js dispatch --execute pid ${child ? child.pid : 0}`,
      log,
      child,
      tag,
      dispatchArgs,
    };

    let resolveCompletion;
    const completionPromise = new Promise((resolve) => {
      resolveCompletion = resolve;
    });

    // Starting the dispatch subprocess is not a worker launch. `launched` turns
    // true only on the completion outcome, when dispatch exits with a receipt.
    const result = {
      launched: false,
      status: 'subprocess_started',
      choice: chosenKey,
      argvIdentity: parsedIdentity,
      launchRecord,
      spawns: 1,
      provenance,
      completion: completionPromise,
      promise: completionPromise,
      wait: () => completionPromise,
    };

    let settled = false;
    const notifyCompletion = (outcome) => {
      if (settled) return;
      settled = true;
      resolveCompletion(outcome);
      if (typeof options.onCompletion === 'function') {
        try {
          options.onCompletion(outcome);
        } catch {}
      }
      if (typeof deps.onCompletion === 'function') {
        try {
          deps.onCompletion(outcome);
        } catch {}
      }
    };

    if (child && typeof child.unref === 'function') child.unref();

    if (child && typeof child.on === 'function') {
      child.on('close', (code) => {
        let text = '';
        try {
          if (typeof fsApi.readFileSync === 'function')
            text = String(fsApi.readFileSync(log, 'utf8'));
        } catch {}
        const outcome = outcomeFromDispatch(code, text);
        appendLog(fsApi, logFile, logsDir, {
          at: new Date().toISOString(),
          item,
          role,
          cwd,
          repoSha: provenance.repoSha,
          treePath: provenance.treePath,
          choice: { key: chosenKey, identity: parsedIdentity },
          status: outcome.status,
          ...(outcome.reason ? { reason: outcome.reason } : {}),
          ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}),
          dispatchExitCode: code,
        });
        result.launched = outcome.launched;
        result.status = outcome.status;
        if (outcome.reason) result.reason = outcome.reason;
        notifyCompletion({
          ...outcome,
          choice: chosenKey,
          argvIdentity: parsedIdentity,
          launchRecord,
          spawns: 1,
          provenance,
          ...(outcome.launched ? {} : { exitCode: 1 }),
        });
      });
      child.on('error', (err) => {
        const detail = err && err.message ? err.message : String(err);
        logErr(`CHILD_SPAWN_ASYNC_ERROR ${item}: ${detail}`);
        appendLog(fsApi, logFile, logsDir, {
          at: new Date().toISOString(),
          item,
          role,
          cwd,
          repoSha: provenance.repoSha,
          treePath: provenance.treePath,
          choice: { key: chosenKey, identity: parsedIdentity },
          status: 'spawn_failed',
          error: detail,
        });
        result.launched = false;
        result.status = 'failed';
        result.reason = 'SPAWN_ERROR';
        result.detail = detail;
        result.spawns = 0;
        notifyCompletion({
          launched: false,
          status: 'failed',
          choice: chosenKey,
          reason: 'SPAWN_ERROR',
          detail,
          exitCode: 1,
          spawns: 0,
          provenance,
          launchRecord: {
            ...launchRecord,
            status: 'failed',
            error: detail,
          },
        });
      });
    }

    if (options.waitCompletion || options.async) {
      return completionPromise;
    }
    return result;
  } finally {
    if (fd !== null && typeof fsApi.closeSync === 'function') {
      try {
        fsApi.closeSync(fd);
      } catch {}
    }
  }
}

module.exports = { getTreeProvenance, routeLaunchStep };
