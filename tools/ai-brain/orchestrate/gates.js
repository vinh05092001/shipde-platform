'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const decisions = require('../decisions');
const { hardenedGitEnv, hardenedGitArgs, runHardenedGit } = require('./hardened-git');
const { SHA_40, roleOf } = require('./shared');

const FormatGate = Object.freeze({
  PASSED: 'PASSED',
  REFUSED: 'REFUSED',
  UNAVAILABLE: 'UNAVAILABLE',
});

const ToolGate = Object.freeze({
  PASSED: 'PASSED',
  REFUSED: 'REFUSED',
  UNAVAILABLE: 'UNAVAILABLE',
});

/** The file types `prettier --check` can judge. */
const PRETTIER_FILE = /\.(js|jsx|ts|tsx|json|md|html|css|scss|less|yaml|yml)$/i;

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * The repository's own prettier, resolved from this module instead of from the
 * process cwd: DT-R02 is a host-side gate and the worker's files sit in a
 * worker root that carries no node_modules of its own.
 */
function prettierEntry() {
  const pkgPath = require.resolve('prettier/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.prettier;
  return bin ? path.join(path.dirname(pkgPath), bin) : null;
}

/**
 * The worker's changed files between the handoff base and the commit under
 * review, filtered to the ones prettier can check and that still exist.
 */
function changedPrettierFiles(workerRoot, baseSha, targetSha) {
  const diff = spawnSync('git', ['diff', '--name-only', baseSha + '..' + targetSha], {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (diff.error || diff.status !== 0) {
    const detail =
      (diff.error && diff.error.message) || String(diff.stderr || '').trim() || 'git diff failed';
    return { files: [], detail: 'changed files are unknown: ' + stripAnsi(detail).trim() };
  }
  const names = String(diff.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);
  const files = names
    .filter((name) => PRETTIER_FILE.test(name) && fs.existsSync(path.join(workerRoot, name)))
    .map((name) => path.join(workerRoot, name));
  return { files, detail: null };
}

/** Normalise file path to repository-relative forward-slash path. */
function toRepoRelative(workerRoot, file) {
  if (!file) return '';
  const abs = path.isAbsolute(file) ? file : path.resolve(workerRoot, file);
  return path.relative(workerRoot, abs).replace(/\\/g, '/');
}

/** `prettier --check` over exactly these files, run from the host repository. */
function prettierCheck(files, options) {
  let entry = null;
  try {
    entry = prettierEntry();
  } catch (err) {
    return { status: 'UNAVAILABLE', detail: 'prettier is not installed: ' + (err && err.message) };
  }
  if (!entry) return { status: 'UNAVAILABLE', detail: 'prettier has no executable entry point' };
  const hostCwd = path.resolve(__dirname, '..', '..', '..');

  // TASK-AI-190: when checking a committed SHA, feed the raw Git blob bytes
  // (LF as stored in Git and checked by Linux CI) to `prettier --check --stdin-filepath`
  // so Windows `core.autocrlf=true` CRLF checkouts do not false-fail `endOfLine: "lf"`.
  const opts = options || {};
  if (opts.workerRoot && opts.sha && SHA_40.test(String(opts.sha))) {
    const failingFiles = [];
    let firstDetail = null;
    for (const file of files) {
      const relative = toRepoRelative(opts.workerRoot, file);
      const blob = spawnSync(
        'git',
        hardenedGitArgs(opts.workerRoot).concat(['show', opts.sha + ':' + relative]),
        {
          cwd: opts.workerRoot,
          windowsHide: true,
          env: hardenedGitEnv(),
          maxBuffer: 20 * 1024 * 1024,
        }
      );
      if (!blob || blob.status !== 0) {
        failingFiles.push(file);
        if (!firstDetail) firstDetail = 'git show failed for ' + relative;
        continue;
      }
      const res = spawnSync(
        process.execPath,
        [entry, '--check', '--stdin-filepath', relative],
        { cwd: hostCwd, input: blob.stdout, windowsHide: true }
      );
      if (res.error) return { status: 'UNAVAILABLE', detail: String(res.error.message) };
      const out = stripAnsi(String(res.stderr || '') + String(res.stdout || ''));
      if (/Cannot find module/.test(out)) {
        return {
          status: 'UNAVAILABLE',
          detail: out.split(/\r?\n/)[0] || 'prettier could not be loaded',
        };
      }
      if (res.status !== 0) {
        failingFiles.push(file);
        if (!firstDetail) {
          firstDetail =
            out
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)[0] || 'prettier --check exited with code ' + res.status;
        }
      }
    }
    if (failingFiles.length === 0) return { status: 'PASSED', detail: null, files: [] };
    return { status: 'FAILED', detail: firstDetail, files: failingFiles };
  }

  const result = spawnSync(
    process.execPath,
    [entry, '--check', '--ignore-unknown', '--'].concat(files),
    { cwd: hostCwd, encoding: 'utf8', windowsHide: true }
  );
  if (result.error) return { status: 'UNAVAILABLE', detail: String(result.error.message) };
  const fullOutput = stripAnsi(String(result.stderr || '') + String(result.stdout || ''));
  const lines = fullOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Checking formatting/.test(line));
  if (/Cannot find module/.test(lines.join('\n'))) {
    return { status: 'UNAVAILABLE', detail: lines[0] || 'prettier could not be loaded' };
  }
  if (result.status === 0) return { status: 'PASSED', detail: null, files: [] };

  const failingFiles = [];
  for (const rawLine of fullOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    let m = line.match(/^\[warn\]\s+(.*)$/);
    if (m) {
      const candidate = m[1].trim();
      if (/^Code style issues found/.test(candidate)) continue;
      const abs = path.resolve(hostCwd, candidate).toLowerCase();
      const matched = files.find((f) => path.resolve(hostCwd, f).toLowerCase() === abs);
      if (matched && !failingFiles.includes(matched)) failingFiles.push(matched);
      continue;
    }
    m = line.match(/^\[error\]\s+(.*?)(?::\s+.*)?$/);
    if (m) {
      const candidate = m[1].trim();
      const abs = path.resolve(hostCwd, candidate).toLowerCase();
      const matched = files.find((f) => path.resolve(hostCwd, f).toLowerCase() === abs);
      if (matched && !failingFiles.includes(matched)) failingFiles.push(matched);
      continue;
    }
  }
  const failedSubset = failingFiles.length > 0 ? failingFiles : files;
  return {
    status: 'FAILED',
    detail: lines[0] || 'prettier --check exited with code ' + result.status,
    files: failedSubset,
  };
}

/** Apply the repository formatter inside the worker checkout, then commit only its failing paths. */
function autoFormatWorkerFiles(workerRoot, files, options) {
  const paths = files.map((file) => toRepoRelative(workerRoot, file));
  const status = spawnSync(
    'git',
    hardenedGitArgs(workerRoot).concat(['status', '--porcelain=v1', '--untracked-files=all']),
    { cwd: workerRoot, encoding: 'utf8', windowsHide: true, timeout: 30000, env: hardenedGitEnv() }
  );
  if (!status || status.status !== 0) {
    return { status: 'REFUSED', reason: 'WORKER_TREE_DIRTY: unable to verify worker tree status' };
  }
  const dirtyEntries = String(status.stdout || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !/^\?\? node_modules(?:\/|\\|$)/.test(line));
  if (dirtyEntries.length > 0) {
    return { status: 'REFUSED', reason: 'WORKER_TREE_DIRTY' };
  }

  const bin = path.join(workerRoot, 'node_modules', '.bin', 'prettier');
  const candidates =
    process.platform === 'win32' ? [bin + '.cmd', bin + '.CMD', bin + '.exe', bin] : [bin];
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) return { status: 'FAILED', reason: 'worker prettier executable is unavailable' };
  const prettierArgs = ['--write'].concat(paths);
  let command = executable;
  let commandArgs = prettierArgs;
  if (process.platform === 'win32' && /\.cmd$/i.test(executable)) {
    const ps1 = executable.replace(/\.cmd$/i, '.ps1');
    if (fs.existsSync(ps1)) {
      command = 'powershell.exe';
      commandArgs = [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        ps1,
        '--write',
      ].concat(paths);
    } else {
      command = process.env.ComSpec || 'cmd.exe';
      commandArgs = ['/d', '/s', '/c', executable, '--write'].concat(paths);
    }
  }
  const formatted = spawnSync(command, commandArgs, {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    env: process.env,
  });
  if (!formatted || formatted.error || formatted.status !== 0) {
    return {
      status: 'FAILED',
      reason: String(
        (formatted && (formatted.stderr || formatted.stdout)) ||
          (formatted && formatted.error && formatted.error.message) ||
          'prettier --write failed'
      ).trim(),
    };
  }

  const formatterHead = spawnSync(
    'git',
    hardenedGitArgs(workerRoot).concat(['rev-parse', 'HEAD']),
    { cwd: workerRoot, encoding: 'utf8', windowsHide: true, env: hardenedGitEnv() }
  );
  const currentHead = String((formatterHead && formatterHead.stdout) || '').trim();
  if (!SHA_40.test(currentHead))
    return { status: 'FAILED', reason: 'formatter worker HEAD is unavailable' };

  const check = prettierCheck(paths.map((file) => path.join(workerRoot, file)));
  if (check.status !== 'PASSED')
    return { status: 'FAILED', reason: check.detail || 'prettier --check failed after write' };

  if (options.expectedHead && currentHead !== options.expectedHead) {
    return { status: 'FAILED', reason: 'formatter worker HEAD does not match the reviewed commit' };
  }

  const changed = spawnSync('git', hardenedGitArgs(workerRoot).concat(['diff', '--name-only']), {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: hardenedGitEnv(),
  });
  if (!changed || changed.status !== 0)
    return { status: 'FAILED', reason: 'unable to inspect formatter diff' };
  const changedPaths = String(changed.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .sort();
  if (changedPaths.some((file) => !paths.includes(file))) {
    return { status: 'FAILED', reason: 'formatter changed paths outside the failing file list' };
  }
  if (changedPaths.length === 0) {
    return { status: 'FAILED', reason: 'formatter made no changes' };
  }

  const add = spawnSync(
    'git',
    hardenedGitArgs(workerRoot).concat(['add', '--']).concat(changedPaths),
    {
      cwd: workerRoot,
      encoding: 'utf8',
      windowsHide: true,
      env: hardenedGitEnv(),
    }
  );
  if (!add || add.status !== 0)
    return { status: 'FAILED', reason: 'git add failed for formatter paths' };
  const staged = spawnSync(
    'git',
    hardenedGitArgs(workerRoot).concat(['diff', '--cached', '--name-only']),
    { cwd: workerRoot, encoding: 'utf8', windowsHide: true, env: hardenedGitEnv() }
  );
  const stagedPaths =
    staged && staged.status === 0
      ? String(staged.stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim().replace(/\\/g, '/'))
          .filter(Boolean)
          .sort()
      : [];
  if (
    stagedPaths.length === 0 ||
    stagedPaths.some((file) => !paths.includes(file)) ||
    JSON.stringify(stagedPaths) !== JSON.stringify(changedPaths.slice().sort())
  ) {
    return { status: 'FAILED', reason: 'staged paths differ from failing file list' };
  }
  const commit = spawnSync(
    'git',
    hardenedGitArgs(workerRoot).concat([
      'commit',
      '-m',
      '[' + (options.workItemId || 'TASK-AI-140') + '] Apply repo formatter (prettier --write)',
    ]),
    { cwd: workerRoot, encoding: 'utf8', windowsHide: true, env: hardenedGitEnv() }
  );
  if (!commit || commit.status !== 0)
    return {
      status: 'FAILED',
      reason:
        'formatter commit failed: ' +
        String((commit && (commit.stderr || commit.stdout)) || '').trim(),
    };
  const head = spawnSync('git', hardenedGitArgs(workerRoot).concat(['rev-parse', 'HEAD']), {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: hardenedGitEnv(),
  });
  const sha = String((head && head.stdout) || '').trim();
  return SHA_40.test(sha)
    ? { status: 'PASSED', sha, files: stagedPaths }
    : { status: 'FAILED', reason: 'formatter commit has invalid HEAD' };
}

/**
 * The worker's changed names between the handoff base and the commit under
 * review — the same host-side `git diff` the format gate judges, without the
 * prettier filter (TM-R03).
 */
function changedFileNames(workerRoot, baseSha, targetSha) {
  const diff = spawnSync('git', ['diff', '--name-only', baseSha + '..' + targetSha], {
    cwd: workerRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (diff.error || diff.status !== 0) {
    const detail =
      (diff.error && diff.error.message) || String(diff.stderr || '').trim() || 'git diff failed';
    return { names: [], detail: 'changed files are unknown: ' + stripAnsi(detail).trim() };
  }
  const names = String(diff.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, '/'))
    .filter(Boolean);
  return { names, detail: null };
}

/**
 * A manifest `command` is the repository's package.json script name (the same
 * convention as the eslint/prettier/prisma entries), so a gate runs as
 * `pnpm run <command>` host-side in the worker root — the tree that carries
 * the reviewed SHA.
 */
function runGateCommand(o, gateTool, workerRoot) {
  const check = o.spawnSync || spawnSync;
  return check('pnpm', ['run', String(gateTool.command)], {
    cwd: workerRoot,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    timeout: o.timeoutMs || 300000,
  });
}

/** A gate that cannot run here is UNAVAILABLE, never a failing scan. */
function gateUnavailableReason(res) {
  if (res && res.error) return String(res.error.message || res.error);
  const text = String((res && res.stdout) || '') + String((res && res.stderr) || '');
  if (/cannot find module|is not recognized|command not found|ENOENT/i.test(text)) {
    return 'gate command is not runnable here: ' + (text.trim().split(/\r?\n/)[0] || '');
  }
  return null;
}

/** Scrubbed tail of the tool output — the only place raw output survives. */
function gateOutput(res) {
  return decisions
    .scrubText(String((res && res.stdout) || '') + String((res && res.stderr) || ''))
    .slice(-2000);
}

/**
 * TM-R03: the tool gates, run after a worker commit and before review the
 * same way as the format gate (DT-R02): host-side against the reviewed SHA.
 *
 * Every gatesFor() tool that applies to the changed files (or to the item's
 * risk domains) and carries a command runs in the worker root. A failing gate
 * gets exactly one bounded repair round carrying its tool output; if the
 * repaired commit still fails, the item is refused — never reviewed, never
 * published. A gate with no command, or one that is not installed or cannot
 * run here, records TOOL_GATE_UNAVAILABLE, does not block, and is never
 * counted as a pass. Decision entries carry the tool id and pass/fail only
 * (TM-R04); the scrubbed tool output goes only into the repair finding.
 */
async function runToolGates(params) {
  const o = params.o;
  const item = params.item;
  const log = params.log;
  const logOpts = params.logOpts;
  const workerRoot = params.workerRoot;
  const baseSha = params.baseSha;
  const targetSha = params.targetSha;
  const repair = params.repair;

  let currentSha = targetSha;
  const record = (toolId, status, entry) => {
    const value = Object.assign(
      { workItemId: item.id, status, tool: toolId, baseSha: baseSha || null, sha: currentSha },
      entry || {}
    );
    if (log) {
      if (!Array.isArray(log.toolGates)) log.toolGates = [];
      log.toolGates.push(value);
    }
    if (typeof o.log === 'function') o.log('TOOL_GATE_' + status, value);
    if (logOpts) {
      try {
        const decisions = require('../decisions');
        decisions.recordDecision(
          {
            stage: decisions.Stage.TOOL_GATE,
            workItemId: item.id,
            role: roleOf(item),
            tool: toolId,
            toolStatus: status,
            code: 'TOOL_GATE_' + status,
          },
          logOpts
        );
      } catch (err) {
        // A broken decision log must not break the gate verdict.
      }
    }
    return value;
  };

  let tm;
  try {
    tm = require('../tool-manifest');
  } catch (err) {
    record('tool-manifest', ToolGate.UNAVAILABLE, {
      reason: 'tool manifest missing or unreadable',
    });
    return {
      status: ToolGate.UNAVAILABLE,
      reason: 'tool manifest missing or unreadable',
      sha: currentSha,
    };
  }

  let gates;
  try {
    gates = tm.gatesFor();
  } catch (err) {
    record('tool-manifest', ToolGate.UNAVAILABLE, { reason: 'tool manifest is unreadable' });
    return { status: ToolGate.UNAVAILABLE, reason: 'tool manifest is unreadable', sha: currentSha };
  }

  const changed = changedFileNames(workerRoot, baseSha, targetSha);
  if (!changed.detail && changed.names.length === 0) {
    return { status: ToolGate.PASSED, sha: currentSha };
  }
  // Unnamed changed files cannot narrow applicability; the risk domains can.
  const changedFiles = changed.names;
  const riskDomains =
    (item && (item.riskDomains || (item.roleRequirement && item.roleRequirement.riskDomains))) ||
    [];

  for (const gateTool of gates) {
    if (!tm.appliesTo(gateTool, changedFiles, riskDomains)) continue;

    if (!gateTool.command || gateTool.installed !== true) {
      record(gateTool.id, ToolGate.UNAVAILABLE, {
        reason: gateTool.command ? 'gate tool is not installed' : 'gate tool has no command',
      });
      continue;
    }

    const first = runGateCommand(o, gateTool, workerRoot);
    const unavailable = gateUnavailableReason(first);
    if (unavailable) {
      record(gateTool.id, ToolGate.UNAVAILABLE, { reason: unavailable });
      continue;
    }
    if (first && first.status === 0) {
      record(gateTool.id, ToolGate.PASSED, { exitCode: 0 });
      continue;
    }

    record(gateTool.id, 'FAILED', {
      exitCode: first ? first.status : -1,
      reason: gateTool.id + ' gate failed',
    });
    const findings = [
      {
        id: 'TOOL_GATE_FAILED',
        status: 'open',
        summary:
          gateTool.id +
          ' gate failed on ' +
          changedFiles.length +
          ' changed file(s): ' +
          changedFiles.slice(0, 5).join(', '),
        detail: gateTool.id + ' gate failed:\n' + gateOutput(first),
        dirtyPaths: changedFiles,
      },
    ];
    const repaired = await repair(findings, currentSha);
    const repairedSha = repaired && repaired.sha ? String(repaired.sha) : '';
    if (!SHA_40.test(repairedSha)) {
      const reason =
        'TOOL_GATE_FAILED: ' +
        gateTool.id +
        ' gate failed and the repair round produced no reviewable commit';
      record(gateTool.id, 'REFUSED', { reason, exitCode: first ? first.status : -1 });
      return { status: ToolGate.REFUSED, reason, gate: gateTool.id, sha: currentSha };
    }

    const second = runGateCommand(o, gateTool, workerRoot);
    const secondUnavailable = gateUnavailableReason(second);
    if (secondUnavailable) {
      record(gateTool.id, ToolGate.UNAVAILABLE, { reason: secondUnavailable, sha: repairedSha });
      return {
        status: ToolGate.UNAVAILABLE,
        reason: secondUnavailable,
        gate: gateTool.id,
        sha: repairedSha,
      };
    }
    if (second && second.status === 0) {
      currentSha = repairedSha;
      record(gateTool.id, ToolGate.PASSED, { exitCode: 0, sha: currentSha, repaired: true });
      continue;
    }

    const reason = 'TOOL_GATE_FAILED: ' + gateTool.id + ' gate still fails after the repair round';
    record(gateTool.id, 'REFUSED', {
      reason,
      exitCode: second ? second.status : -1,
      sha: repairedSha,
    });
    return { status: ToolGate.REFUSED, reason, gate: gateTool.id, sha: repairedSha };
  }

  return { status: ToolGate.PASSED, sha: currentSha };
}

/**
 * DT-R02: the format gate, run after a worker commit and before review.
 *
 * Every verdict is written to the run's `formatChecks` list and emitted through
 * `o.log` as FORMAT_CHECK_PASSED / FORMAT_CHECK_FAILED / FORMAT_CHECK_UNAVAILABLE
 * / FORMAT_CHECK_REFUSED, so a missing prettier is a recorded warning rather
 * than a silent pass. A failing check gets one bounded repair round through the
 * existing repair path; if the repaired commit still does not format the item
 * is refused — never reviewed, never published.
 */
async function runFormatGate(params) {
  const o = params.o;
  const item = params.item;
  const log = params.log;
  const logOpts = params.logOpts;
  const workerRoot = params.workerRoot;
  const baseSha = params.baseSha;
  const targetSha = params.targetSha;
  const repair = params.repair;
  const commitFormatFix = params.commitFormatFix || autoFormatWorkerFiles;
  const repoNames = (files) =>
    (files || []).map((file) => toRepoRelative(workerRoot, file) || file);
  const record = (status, entry) => {
    const value = Object.assign(
      { workItemId: item.id, status, baseSha: baseSha || null, sha: targetSha },
      entry || {}
    );
    if (log && Array.isArray(log.formatChecks)) log.formatChecks.push(value);
    if (typeof o.log === 'function') o.log('FORMAT_CHECK_' + status, value);
    return value;
  };

  const changed = changedPrettierFiles(workerRoot, baseSha, targetSha);
  if (changed.detail) {
    // The changed files cannot be named, so nothing can be verified. That is the
    // same situation as a missing prettier: recorded, never a silent pass.
    record('UNAVAILABLE', { reason: changed.detail });
    return { status: FormatGate.UNAVAILABLE, reason: changed.detail };
  }
  if (changed.files.length === 0) return { status: FormatGate.PASSED, files: [] };

  const first = prettierCheck(changed.files, { workerRoot, sha: targetSha });
  if (first.status === 'UNAVAILABLE') {
    record('UNAVAILABLE', { files: repoNames(changed.files), reason: first.detail });
    return { status: FormatGate.UNAVAILABLE, reason: first.detail };
  }
  if (first.status === 'PASSED') {
    record('PASSED', { files: repoNames(changed.files) });
    return { status: FormatGate.PASSED, files: changed.files, sha: targetSha };
  }

  // The failing subset of files that need formatting
  const failingFiles = first.files && first.files.length > 0 ? first.files : changed.files;
  const failingNames = repoNames(failingFiles);

  record('FAILED', { files: failingNames, reason: first.detail });
  const formatted = await commitFormatFix(workerRoot, failingFiles, {
    workItemId: item.id,
    expectedHead: targetSha,
  });
  if (formatted.status === 'REFUSED') {
    const reason = formatted.reason;
    record('REFUSED', { files: failingNames, reason });
    return { status: FormatGate.REFUSED, reason, files: failingFiles };
  }
  if (formatted.status === 'FAILED') {
    record('FAILED', { files: failingNames, reason: formatted.reason });
    if (typeof o.log === 'function') o.log('FORMAT_AUTOFIX_FAILED', { reason: formatted.reason });
  }
  if (
    formatted.status === 'FAILED' &&
    formatted.reason === 'worker prettier executable is unavailable'
  ) {
    // Syntax/formatter failures can be handled by the existing repair lane.
  }
  if (formatted.status === 'PASSED') {
    const verification = prettierCheck(changed.files, { workerRoot, sha: formatted.sha });
    if (verification.status === 'PASSED') {
      const fixedNames = formatted.files ? repoNames(formatted.files) : failingNames;
      decisions.recordDecision(
        {
          stage: 'format_autofixed',
          workItemId: item.id,
          role: roleOf(item),
          branch: (params.session && params.session.branch) || null,
          sha: formatted.sha,
          files: fixedNames,
          detail: 'Repository Prettier applied without a model repair.',
        },
        logOpts
      );
      record('PASSED', { files: fixedNames, sha: formatted.sha, autoFixed: true });
      return { status: FormatGate.PASSED, files: changed.files, sha: formatted.sha };
    }
  }
  const findings = [
    {
      id: 'FORMAT_CHECK_FAILED',
      status: 'open',
      summary:
        'prettier --check failed on ' +
        failingFiles.length +
        ' changed file(s): ' +
        failingNames.slice(0, 5).join(', '),
      detail:
        'Run exactly `./node_modules/.bin/prettier --write ' +
        failingNames.join(' ') +
        '` in the worker checkout. This is a format-only repair: do not change behavior, logic, or any other content. The diff must contain formatting changes only.',
      formatOnly: true,
      dirtyPaths: failingNames,
      headSha: targetSha,
      baseSha,
    },
  ];
  const repaired = await repair(findings, targetSha);
  const repairedSha = repaired && repaired.sha ? String(repaired.sha) : '';
  if (!SHA_40.test(repairedSha)) {
    const reason = 'FORMAT_CHECK_FAILED: the repair round produced no reviewable commit';
    record('REFUSED', { files: failingNames, reason });
    return { status: FormatGate.REFUSED, reason, files: failingFiles };
  }

  const again = changedPrettierFiles(workerRoot, baseSha, repairedSha);
  if (again.detail) {
    record('UNAVAILABLE', { files: failingNames, reason: again.detail });
    return { status: FormatGate.UNAVAILABLE, reason: again.detail };
  }
  const repairedNames = changedFileNames(workerRoot, targetSha, repairedSha);
  const allowedNames = failingNames;
  if (repairedNames.detail || repairedNames.names.some((name) => !allowedNames.includes(name))) {
    const reason =
      'REPAIR_SCOPE_EXCEEDED: format-only repair changed files outside the failing file list';
    record('REFUSED', { files: repoNames(again.files), reason, sha: repairedSha });
    return { status: FormatGate.REFUSED, reason, files: again.files, sha: repairedSha };
  }
  let scopeExceeded = false;
  for (const relative of failingNames) {
    const before = runHardenedGit(workerRoot, ['show', targetSha + ':' + relative]);
    if (!before || before.status !== 0) continue;
    const formatResult = spawnSync(
      process.execPath,
      [prettierEntry(), '--write', '--stdin-filepath', relative],
      {
        cwd: path.resolve(__dirname, '..', '..', '..'),
        input: before.stdout,
        encoding: 'utf8',
        windowsHide: true,
      }
    );
    if (!formatResult || formatResult.status !== 0) continue;
    const after = runHardenedGit(workerRoot, ['show', repairedSha + ':' + relative]);
    if (
      !after ||
      after.status !== 0 ||
      String(after.stdout || '').replace(/\r\n/g, '\n') !==
        String(formatResult.stdout || '').replace(/\r\n/g, '\n')
    ) {
      scopeExceeded = true;
      break;
    }
  }
  if (scopeExceeded) {
    const reason =
      'REPAIR_SCOPE_EXCEEDED: format-only repair differs from the repository Prettier output';
    record('REFUSED', { files: repoNames(again.files), reason, sha: repairedSha });
    return { status: FormatGate.REFUSED, reason, files: again.files, sha: repairedSha };
  }
  const second =
    again.files.length === 0
      ? { status: 'PASSED', detail: null }
      : prettierCheck(again.files, { workerRoot, sha: repairedSha });
  if (second.status === 'UNAVAILABLE') {
    record('UNAVAILABLE', { files: repoNames(again.files), reason: second.detail });
    return { status: FormatGate.UNAVAILABLE, reason: second.detail };
  }
  if (second.status === 'PASSED') {
    record('PASSED', { files: repoNames(again.files), sha: repairedSha, repaired: true });
    return { status: FormatGate.PASSED, files: again.files, sha: repairedSha };
  }
  const againNames = repoNames(again.files);
  const reason =
    'FORMAT_CHECK_FAILED: prettier --check still fails after the repair round: ' +
    againNames.slice(0, 5).join(', ');
  record('REFUSED', { files: againNames, reason });
  return { status: FormatGate.REFUSED, reason, files: again.files, sha: repairedSha };
}

/** TASK-AI-140 test seam for the worker format gate. */
async function runFormatGateForTest(params) {
  const item = params.item || { id: 'TASK-AI-140', role: 'author.foundation' };
  const log = params.log || { formatChecks: [] };
  return runFormatGate(
    Object.assign(
      {
        o: { log: () => {} },
        item,
        log,
        logOpts: params.logOpts || {
          dir: params.decisionDir,
          now: Date.parse('2026-10-10T12:00:00Z'),
        },
        workerRoot: params.workerRoot,
        baseSha: params.baseSha,
        targetSha: params.targetSha,
        repair: params.repair || (async () => ({})),
      },
      params
    )
  );
}

module.exports = {
  FormatGate,
  ToolGate,
  PRETTIER_FILE,
  stripAnsi,
  prettierEntry,
  changedPrettierFiles,
  toRepoRelative,
  prettierCheck,
  autoFormatWorkerFiles,
  changedFileNames,
  runGateCommand,
  gateUnavailableReason,
  gateOutput,
  runToolGates,
  runFormatGate,
  runFormatGateForTest,
};
