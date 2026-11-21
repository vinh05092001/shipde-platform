'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const { parseCsvRecords } = require('../reconcile');
const {
  WORKER_USERNAME,
  WORKER_ROOT,
  DEFAULT_WORKER_TIMEOUT_MS,
  isWorkerConfigKeyAllowed,
  cleanGitEnv,
  isPathInside,
  workerGitPaths,
  gitConfigCheckTimeoutMs,
  validateConfigFile,
  validateWorkerGitConfig,
  resolveInstalledHook,
  controllerGit,
  hookedControllerGit,
  retargetSharedDepsWorkspaceLinks,
  retainedRootHasOwnWriterRecord,
  commitNativeWriterChanges,
  commitWorkerMetadata,
  isolationVerdictPath,
  stageContextPack,
  workerRootFor,
  isWorkerPath,
  readClosedIsolationVerdict,
  getFolderHash,
  isSecretFileName,
  queryWorkerSid,
} = require('./git-workspace');

const CARRY_IDENTITY = [
  '-c',
  'user.name=Ship De Carry-over',
  '-c',
  'user.email=carry-over@shipde.invalid',
];

function carryRef(branch) {
  return 'refs/shipde/carry/' + branch;
}

function carryGit(cwd, args, extraSafe) {
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const safe = path.resolve(cwd).split(path.sep).join('/');
  return cp.spawnSync(
    'git',
    [
      '-c',
      'core.hooksPath=' + nul,
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.attributesFile=' + nul,
      '-c',
      'diff.external=',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'safe.directory=' + safe,
      '-c',
      'safe.directory=' +
        path
          .resolve(extraSafe || cwd)
          .split(path.sep)
          .join('/'),
    ].concat(args),
    {
      cwd,
      windowsHide: true,
      encoding: 'utf8',
      env: Object.assign({}, process.env, {
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: nul,
        GIT_CONFIG_SYSTEM: nul,
        GIT_TERMINAL_PROMPT: '0',
      }),
    }
  );
}

/**
 * Before a worker root is deleted, keep a previous writer's work: commit any
 * uncommitted change on the target branch as a WIP commit and fetch the branch
 * into a private ref of the host repo. Fail closed: never throws.
 */
function carryOverSave(hostCwd, oldRoot, branch, headSha) {
  try {
    if (!branch || !fs.existsSync(path.join(oldRoot, '.git'))) return false;
    const cur = carryGit(oldRoot, ['symbolic-ref', '--short', 'HEAD']);
    if (cur.status !== 0 || cur.stdout.trim() !== branch) return false;
    const status = carryGit(oldRoot, [
      'status',
      '--porcelain',
      '--',
      '.',
      ':!.shipde',
      ':!.shipde-bin',
      ':!run-target.ps1',
      ':!run-target.complete.json',
      ':!temp',
      ':!.config',
      ':!.local',
      ':!Microsoft',
    ]);
    if (status.status === 0 && status.stdout.trim()) {
      carryGit(oldRoot, [
        'add',
        '-A',
        '--',
        '.',
        ':!.shipde',
        ':!.shipde-bin',
        ':!run-target.ps1',
        ':!run-target.complete.json',
        ':!temp',
        ':!.config',
        ':!.local',
        ':!Microsoft',
      ]);
      carryGit(
        oldRoot,
        CARRY_IDENTITY.concat([
          'commit',
          '--no-verify',
          '--no-gpg-sign',
          '-m',
          'WIP: carried over from an interrupted writer attempt',
        ])
      );
    }
    const ref = carryRef(branch);
    const fetched = carryGit(
      hostCwd,
      ['fetch', '--no-tags', oldRoot, '+refs/heads/' + branch + ':' + ref],
      oldRoot
    );
    if (fetched.status !== 0) return false;
    const anc = carryGit(hostCwd, ['merge-base', '--is-ancestor', ref, headSha]);
    if (anc.status === 0) {
      carryGit(hostCwd, ['update-ref', '-d', ref]);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * After the fresh checkout of branch at headSha: merge the carried work if any.
 * Returns 'merged' | 'conflict' | 'none'. Fail closed to the plain checkout.
 */
function carryOverRestore(hostCwd, newRoot, branch, eolConfig) {
  try {
    if (!branch) return 'none';
    const ref = carryRef(branch);
    if (carryGit(hostCwd, ['rev-parse', '--verify', '--quiet', ref]).status !== 0) return 'none';
    const local = 'refs/shipde/carry/incoming';
    const f = carryGit(newRoot, ['fetch', '--no-tags', hostCwd, '+' + ref + ':' + local], hostCwd);
    if (f.status !== 0) return 'none';
    validateWorkerGitConfig(newRoot, 'WORKER_COMMIT_FAILED');
    // Same line-ending config as the checkout, or every file looks modified.
    const eol = [];
    if (eolConfig && eolConfig.autocrlf !== null && eolConfig.autocrlf !== undefined)
      eol.push('-c', 'core.autocrlf=' + eolConfig.autocrlf);
    if (eolConfig && eolConfig.eol !== null && eolConfig.eol !== undefined)
      eol.push('-c', 'core.eol=' + eolConfig.eol);
    if (process.platform === 'win32') eol.push('-c', 'core.filemode=false');
    const commit = hookedControllerGit({
      hostRoot: hostCwd,
      workerRoot: newRoot,
      failure: 'WORKER_COMMIT_FAILED',
      gitConfig: [...CARRY_IDENTITY, ...eol],
    });
    const m = carryGit(
      newRoot,
      CARRY_IDENTITY.concat(eol, ['merge', '--no-commit', '--no-ff', local])
    );
    if (m.status === 0) {
      if (carryGit(newRoot, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).status === 0) {
        try {
          commit(['commit', '-m', 'Restore interrupted writer work']);
        } catch (error) {
          carryGit(newRoot, ['merge', '--abort']);
          throw error;
        }
      }
      carryGit(hostCwd, ['update-ref', '-d', ref]);
      carryGit(newRoot, ['update-ref', '-d', local]);
      return 'merged';
    }
    carryGit(newRoot, ['merge', '--abort']);
    carryGit(newRoot, ['reset', '--hard', 'ORIG_HEAD']);
    carryGit(newRoot, ['update-ref', '-d', local]);
    return 'conflict';
  } catch (error) {
    if (String(error.message).startsWith('WORKER_COMMIT_FAILED:')) throw error;
    return 'none';
  }
}

function appendGitInfoExclude(workerRoot, entries) {
  const excludePath = path.join(workerRoot, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludePath), { recursive: true });
  const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, 'utf8') : '';
  const present = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  );
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length === 0) return;
  const prefix = existing.length > 0 && !/\r?\n$/.test(existing) ? '\n' : '';
  fs.appendFileSync(excludePath, prefix + missing.join('\n') + '\n', 'utf8');
}

/**
 * Provisioning ends on the requested base. When carry-over merged the previous
 * attempt's work, HEAD is that merge commit and its first parent must be the
 * base; otherwise HEAD must be the base itself. Live 17/10: every retry of
 * GOAL-G-F622511E-1 failed PROVISION_BASE_MISMATCH because the carry-over
 * merge commit was compared with the base directly.
 */
function provisionedHeadMatchesBase(workerRoot, provisionedHeadSha, baseSha, carriedOver, run) {
  if (!provisionedHeadSha || !baseSha) return false;
  const head = provisionedHeadSha.toLowerCase();
  const base = baseSha.toLowerCase();
  if (head === base) return true;
  if (carriedOver !== 'merged') return false;
  const git = run || cp.spawnSync;
  const res = git('git', ['rev-parse', '--verify', '--quiet', head + '^1'], {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  return Boolean(res && res.status === 0 && String(res.stdout).trim().toLowerCase() === base);
}

function ensureGoalRegistrationInWorker(hostCwd, workerRoot, workItemId) {
  if (!workItemId || typeof workItemId !== 'string') return;
  const isGoal = workItemId.toUpperCase().startsWith('GOAL-');
  if (!isGoal) return;

  const regRel = path.join(
    'docs',
    'product-spec',
    'docs',
    '10-ai-collaboration',
    'FEATURE-DELIVERY-REGISTER.csv'
  );
  const specRel = path.join('docs', 'product-spec', 'work-items', `${workItemId}.md`);

  const hostSpec = path.join(hostCwd, specRel);
  const workerSpec = path.join(workerRoot, specRel);
  if (!fs.existsSync(workerSpec) && fs.existsSync(hostSpec)) {
    fs.mkdirSync(path.dirname(workerSpec), { recursive: true });
    fs.copyFileSync(hostSpec, workerSpec);
  }

  const hostReg = path.join(hostCwd, regRel);
  const workerReg = path.join(workerRoot, regRel);
  if (fs.existsSync(hostReg) && fs.existsSync(workerReg)) {
    const workerContent = fs.readFileSync(workerReg, 'utf8');
    const workerRecords = parseCsvRecords(workerContent);
    const workerIdColumn = workerRecords[0]?.fields.indexOf('work_item_id') ?? -1;
    if (workerIdColumn < 0) return;
    if (!workerRecords.slice(1).some((record) => record.fields[workerIdColumn] === workItemId)) {
      const hostContent = fs.readFileSync(hostReg, 'utf8');
      const hostRecords = parseCsvRecords(hostContent);
      const hostIdColumn = hostRecords[0]?.fields.indexOf('work_item_id') ?? -1;
      if (hostIdColumn < 0) return;
      const matchingRecord = hostRecords
        .slice(1)
        .find((record) => record.fields[hostIdColumn] === workItemId);
      if (matchingRecord) {
        const matchingLine = matchingRecord.raw.replace(/(?:\r\n|\n|\r)$/, '');
        const eol =
          /\r\n|\n|\r/.exec(workerContent)?.[0] || /\r\n|\n|\r/.exec(hostContent)?.[0] || '\n';
        const updated = workerContent.endsWith('\n')
          ? workerContent + matchingLine + eol
          : workerContent + eol + matchingLine + eol;
        fs.writeFileSync(workerReg, updated, 'utf8');
      }
    }
  }
}

const EXERCISE_CASES = path.join(__dirname, '..', 'exercise', 'e1-branch-name.cases.json');
const EXERCISE_RUNNER = path.join('tools', 'ai-brain', 'test', 'e1-branch-name.test.js');
const THROWS = 'THROWS:';

function exerciseCasesPath(exerciseName) {
  const name = String(exerciseName || 'e1-branch-name').trim();
  if (name === 'e1' || name === 'e1-branch-name' || name === 'true' || !name) {
    return EXERCISE_CASES;
  }
  const candidate = path.join(__dirname, '..', 'exercise', `${name}.cases.json`);
  if (fs.existsSync(candidate)) return candidate;
  return EXERCISE_CASES;
}

/**
 * Captures fail-before host-side in workerRoot at the pinned base SHA.
 *
 * Runs the exercise runner command (node --test tools/ai-brain/test/e1-branch-name.test.js)
 * in workerRoot before the agent begins work. Because tools/ai-brain/branch-name.js
 * does not exist at the base SHA, the command exits non-zero (missing module error).
 * This real captured execution transcript provides honest fail-before evidence.
 */
function captureFailBefore(workerRoot, options) {
  const o = options || {};
  const spawn = o.spawnSync || cp.spawnSync;
  const runnerRel = path.join('tools', 'ai-brain', 'test', 'e1-branch-name.test.js');
  const runnerPosix = runnerRel.replace(/\\/g, '/');
  const runnerFull = path.join(workerRoot, runnerRel);
  if (!fs.existsSync(runnerFull)) {
    throw new Error('FAIL_BEFORE_RUNNER_MISSING: ' + runnerFull);
  }

  const baseSha = o.baseSha ? String(o.baseSha).trim() : null;
  if (baseSha) {
    const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const normWorkerRoot = path.resolve(workerRoot).replace(/\\/g, '/');
    const ancestryCheck = spawn(
      'git',
      [
        '-c',
        'safe.directory=' + normWorkerRoot,
        '-c',
        'core.hooksPath=' + nulDevice,
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.attributesFile=' + nulDevice,
        'merge-base',
        '--is-ancestor',
        baseSha,
        'HEAD',
      ],
      {
        cwd: workerRoot,
        windowsHide: true,
        env: Object.assign({}, process.env, {
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: nulDevice,
          GIT_CONFIG_SYSTEM: nulDevice,
        }),
      }
    );
    if (!ancestryCheck || ancestryCheck.status !== 0) {
      const err = new Error(
        'FAIL_BEFORE_ANCESTRY_MISMATCH: base SHA ' +
          baseSha +
          ' is not an ancestor of worker root HEAD'
      );
      err.code = 'FAIL_BEFORE_ANCESTRY_MISMATCH';
      throw err;
    }
  }

  const command =
    (o.verification && o.verification.command) || o.exerciseCommand || `node --test ${runnerPosix}`;

  const childEnv = Object.assign({}, process.env, o.env || {});
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;

  let res;
  if (!o.verification && !o.exerciseCommand) {
    const execPath = o.nodePath || process.execPath;
    res = spawn(execPath, ['--test', runnerPosix], {
      cwd: workerRoot,
      env: childEnv,
      encoding: 'utf8',
      windowsHide: true,
      timeout: o.timeoutMs || 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } else {
    res = spawn(command, {
      cwd: workerRoot,
      env: childEnv,
      encoding: 'utf8',
      shell: true,
      windowsHide: true,
      timeout: o.timeoutMs || 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
  }

  const stdout = String((res && res.stdout) || '');
  const stderr = String((res && res.stderr) || '');
  const exitCode = res ? (res.status !== null && res.status !== undefined ? res.status : -1) : -1;
  const output = (stdout + (stderr ? (stdout ? '\n' : '') + stderr : '')).slice(-2000);

  return {
    command,
    exitCode,
    stdout,
    stderr,
    output,
    capturedAt: new Date().toISOString(),
    pass: exitCode === 0,
    ancestry: true,
  };
}

/**
 * Materialises the exercise's runner INSIDE the worker root, from the committed
 * case data, AFTER the worker root has been provisioned.
 *
 * Keeps the runner untracked by adding it to .git/info/exclude in the worker clone,
 * and captures fail-before at the base SHA in the provisioned tree.
 */
function materialiseExercise(workerRoot, options) {
  const o = options || {};
  if (!workerRoot) {
    throw new Error(
      'EXERCISE_ROOT_MISSING: the exercise runner may only be written into a worker root'
    );
  }
  const root = path.resolve(workerRoot);
  const checkWorker = (o && o.isWorkerPath) || isWorkerPath;
  if (!checkWorker(root)) {
    throw new Error('EXERCISE_ROOT_INVALID: refusing to write the runner outside the worker root');
  }
  const target = path.join(root, EXERCISE_RUNNER);
  if (path.relative(root, target).startsWith('..') || !path.isAbsolute(target)) {
    throw new Error('EXERCISE_ROOT_INVALID: refusing to write the runner outside the worker root');
  }
  const casesFile = exerciseCasesPath(o.exercise);
  if (!fs.existsSync(casesFile)) {
    throw new Error('EXERCISE_CASES_MISSING: ' + casesFile);
  }
  const cases = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('EXERCISE_CASES_EMPTY: ' + casesFile);
  }
  const body = [
    "'use strict';",
    '',
    '// Materialised inside the worker root from tools/ai-brain/exercise/e1-branch-name.cases.json.',
    '// Never committed: the test:brain glob would pick this file up on the integration',
    '// branch. Run it with: node --test tools/ai-brain/test/e1-branch-name.test.js',
    '',
    "const { test } = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const cases = require('../exercise/e1-branch-name.cases.json');",
    "const { normalizeWorkItemBranch } = require('../branch-name');",
    '',
    'const THROWS = ' + JSON.stringify(THROWS) + ';',
    '',
    'for (const c of cases) {',
    '  test(c.name, () => {',
    '    if (typeof c.expect === "string" && c.expect.startsWith(THROWS)) {',
    '      const code = c.expect.slice(THROWS.length);',
    '      assert.throws(',
    '        () => normalizeWorkItemBranch(c.workItemId, c.kind, c.outcome),',
    '        (err) => {',
    '          const named = String((err && err.code) || "") + " " + String((err && err.message) || "");',
    '          assert.ok(',
    '            named.includes(code),',
    '            "expected the thrown error to be " + code + ", got: " + named',
    '          );',
    '          return true;',
    '        }',
    '      );',
    '      return;',
    '    }',
    '    assert.equal(normalizeWorkItemBranch(c.workItemId, c.kind, c.outcome), c.expect);',
    '  });',
    '}',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, 'utf8');

  // Keep it untracked in git
  appendGitInfoExclude(root, ['tools/ai-brain/test/e1-branch-name.test.js']);

  let failBefore = null;
  if (!o.skipFailBefore) {
    try {
      failBefore = captureFailBefore(root, o);
    } catch (err) {
      if (err && err.code === 'FAIL_BEFORE_ANCESTRY_MISMATCH') {
        throw err;
      }
      failBefore = {
        command:
          (o.verification && o.verification.command) ||
          'node --test tools/ai-brain/test/e1-branch-name.test.js',
        exitCode: -1,
        stdout: '',
        stderr: String((err && err.message) || err),
        output: String((err && err.message) || err),
        capturedAt: new Date().toISOString(),
        pass: false,
        error: String((err && err.message) || err),
      };
    }
  }

  return { path: target, cases: cases.length, failBefore };
}

/**
 * WD-R03: a shared-deps failure must never block the launch, but it must leave
 * a warning where operators look — the real append-only decision log
 * (decisions.js), not a caller-supplied hook that nothing wires. The record is
 * best-effort: a log that cannot be written must not turn a warning into a
 * block either.
 */
function recordWorkerDepsUnavailable(opts, workerRoot, err) {
  try {
    const decisions = require('../decisions');
    const code = err && err.code ? String(err.code) : 'UNKNOWN';
    const rawMessage = String((err && err.message) || err).replace(/[\r\n]+/g, ' ');
    const detailMessage =
      err && err.code === 'WORKER_DEPS_SOURCE_MISSING'
        ? `failed to copy dependencies from host: ${rawMessage}`
        : rawMessage;
    const detail = detailMessage.replace(/[A-Za-z]:\\[^'\"]+/g, '[path]').slice(0, 220);
    const failedPath =
      err && err.relativePath ? String(err.relativePath).replace(/\\/g, '/') : null;
    decisions.recordDecision(
      {
        stage: decisions.Stage.WARNING,
        warning: 'WORKER_DEPS_UNAVAILABLE',
        detail: `code=${code}; message=${detail}${failedPath ? `; path=${failedPath}` : ''}`.slice(
          0,
          300
        ),
        workItemId: (opts && opts.workItemId) || null,
        branch: (opts && opts.branch) || null,
        worktree: workerRoot || null,
      },
      { dir: (opts && opts.decisionDir) || undefined }
    );
  } catch (logErr) {
    console.error(logErr);
  }
}

function resolvePnpmCommand() {
  if (process.platform !== 'win32') return 'pnpm';
  const appData = process.env.APPDATA;
  if (appData) {
    const native = path.join(appData, 'npm', 'node_modules', 'pnpm', 'pnpm.exe');
    if (fs.existsSync(native)) return native;
  }
  return 'pnpm.exe';
}

function offlineStoreMiss(error) {
  const message = String((error && error.message) || '').toLowerCase();
  return /offline|no matching version|not found in.*store|missing.*store|store.*missing/.test(
    message
  );
}

function enforceTokenBudget(launchResult, tokenBudget, usageFile) {
  if (!tokenBudget || Number(tokenBudget.maxTokens) <= 0) return launchResult;
  if (launchResult && launchResult.failureReason) return launchResult;
  let failureReason = null;
  let budgetWarning = null;
  let total = null;
  try {
    if (!usageFile || !fs.existsSync(usageFile)) throw new Error('usage report missing');
    const report = JSON.parse(fs.readFileSync(usageFile, 'utf8'));
    const usage = report.usage || {};
    const hasTotal = usage.total_tokens != null || usage.total != null;
    const hasInput = usage.input_tokens != null || usage.input != null;
    const hasCacheRead =
      usage.cache_read_tokens != null || usage.cacheRead != null || usage.cache_read != null;
    const hasOutput = usage.output_tokens != null || usage.output != null;
    if (!hasTotal && !hasInput && !hasCacheRead && !hasOutput)
      throw new Error('usage total missing');
    const accountedTotal =
      Number(usage.input_tokens ?? usage.input ?? 0) +
      Number(usage.cache_read_tokens ?? usage.cacheRead ?? usage.cache_read ?? 0) +
      Number(usage.output_tokens ?? usage.output ?? 0);
    total = hasTotal
      ? Math.max(Number(usage.total_tokens ?? usage.total), accountedTotal)
      : accountedTotal;
    if (!Number.isFinite(total)) throw new Error('usage total invalid');
    if (total > Number(tokenBudget.maxTokens)) failureReason = 'TOKEN_BUDGET_EXCEEDED';
  } catch (_) {
    budgetWarning = 'TOKEN_BUDGET_UNVERIFIED';
  }
  if (budgetWarning) {
    launchResult.budgetWarning = budgetWarning;
    launchResult.budgetVerified = false;
    launchResult.stderr =
      (launchResult.stderr || '') +
      '\n' +
      budgetWarning +
      ': configured token budget could not be verified';
  }
  if (failureReason) {
    launchResult.exitCode = 1;
    launchResult.failureReason = failureReason;
    launchResult.stderr =
      (launchResult.stderr || '') +
      '\n' +
      failureReason +
      ': ' +
      (failureReason === 'TOKEN_BUDGET_EXCEEDED'
        ? 'session exceeded configured token budget'
        : 'configured token budget could not be verified');
  }
  return launchResult;
}

module.exports = {
  carryRef,
  carryGit,
  carryOverSave,
  carryOverRestore,
  appendGitInfoExclude,
  provisionedHeadMatchesBase,
  ensureGoalRegistrationInWorker,
  exerciseCasesPath,
  captureFailBefore,
  materialiseExercise,
  recordWorkerDepsUnavailable,
  resolvePnpmCommand,
  offlineStoreMiss,
  enforceTokenBudget,
};
