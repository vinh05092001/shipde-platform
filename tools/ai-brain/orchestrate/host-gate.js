'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const baseGateCache = new Map();

function resolveSuiteFiles(rootDir, suite) {
  return String(suite)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((pattern) => {
      if (!pattern.includes('*')) return [pattern];
      const normalized = pattern.replace(/\\/g, '/');
      const slash = normalized.lastIndexOf('/');
      const directory = slash < 0 ? '.' : normalized.slice(0, slash);
      const basename = slash < 0 ? normalized : normalized.slice(slash + 1);
      const escaped = basename.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      const matcher = new RegExp('^' + escaped + '$');
      const targetDir = path.resolve(rootDir, directory);
      if (!fs.existsSync(targetDir)) return [];
      return fs
        .readdirSync(targetDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && matcher.test(entry.name))
        .map((entry) => path.posix.join(directory.replace(/\\/g, '/'), entry.name));
    });
}

// node --test appends the run duration to each failure line ("✖ name (12.3ms)"); the same
// failure on the base run differs only in that suffix, so it is not part of the name.
function parseFailedTestNames(output) {
  return [
    ...new Set(
      [...String(output || '').matchAll(/(?:not ok \d+ - |✖ )([^\r\n]+)/g)].map((match) =>
        match[1].replace(/\s*\(\d+(?:\.\d+)?m?s\)\s*$/, '').trim()
      )
    ),
  ];
}

// A detached worktree of `ref` in a temp dir; `dir` is null when it cannot be created
// (the caller then runs in place). cleanup() returns the error messages, never throws.
function checkoutCleanCommit(root, ref, { run, fs: fileSystem }) {
  let tempDir = null;
  let dir = null;
  try {
    tempDir = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'host-gate-head-'));
    const wt = path.join(tempDir, 'wt');
    const res = run('git', ['worktree', 'add', '--detach', wt, ref], {
      cwd: root,
      encoding: 'utf8',
    });
    if (res && res.status === 0) dir = wt;
  } catch (_) {
    dir = null;
  }
  return {
    dir,
    cleanup() {
      const errors = [];
      if (dir) {
        try {
          const r = run('git', ['worktree', 'remove', '--force', dir], {
            cwd: root,
            encoding: 'utf8',
          });
          if (r && (r.status !== 0 || r.error))
            errors.push(String((r.error && r.error.message) || r.stderr || r.stdout).trim());
        } catch (err) {
          errors.push(err.message || String(err));
        }
      }
      if (tempDir) {
        try {
          fileSystem.rmSync(tempDir, { recursive: true, force: true });
        } catch (err) {
          errors.push(err.message || String(err));
        }
      }
      return errors;
    },
  };
}

// The head run and the base run must see the identical environment, or a test that is
// environment-sensitive reads as a new failure (or a fixed one) purely from the mismatch.
function hostGateEnv(nodePaths) {
  return Object.assign({}, process.env, {
    // The suite must see what CI sees: no router key, no machine discovery data.
    NINEROUTER_API_KEY: undefined,
    AI_BRAIN_DISCOVERED_SOURCES: 'none',
    AI_BRAIN_MACHINE_DATA: 'none',
    NODE_PATH: [].concat(nodePaths, [process.env.NODE_PATH]).filter(Boolean).join(path.delimiter),
  });
}

// A test that fails on the worker commit but not on the base may be a parallel-file race
// (several files share one data directory). Re-run only those tests alone on the same clean
// checkout; a failure that repeats is confirmed, one that passes is recorded as flaky. Any
// rerun that cannot be read confirms every candidate (fail closed).
function confirmNewFailures(candidates, ctx) {
  const unconfirmed = { confirmed: [...candidates], flaky: [] };
  if (!ctx.cwd || candidates.length === 0) return unconfirmed;
  const escape = (name) => '^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
  const args = ['--test'];
  for (const name of candidates) args.push('--test-name-pattern=' + escape(name));
  args.push(...ctx.suiteFiles);
  let res;
  try {
    res = ctx.run(ctx.node, args, {
      cwd: ctx.cwd,
      encoding: 'utf8',
      timeout: ctx.timeout,
      maxBuffer: 64 * 1024 * 1024,
      env: ctx.env,
    });
  } catch (_) {
    return unconfirmed;
  }
  if (!res || res.error || typeof res.status !== 'number') return unconfirmed;
  const again = parseFailedTestNames(String(res.stdout || '') + '\n' + String(res.stderr || ''));
  if (res.status !== 0 && again.length === 0) return unconfirmed;
  const againSet = new Set(again);
  return {
    confirmed: candidates.filter((name) => againSet.has(name)),
    flaky: candidates.filter((name) => !againSet.has(name)),
  };
}

function runHostBrainGate(job, options = {}) {
  const requestedRoot = options.hostCwd || options.cwd || process.cwd();
  const root =
    (options.platform || process.platform) !== 'win32' &&
    /^[a-z]:[\\/]/i.test(String(requestedRoot))
      ? path.resolve(__dirname, '..', '..', '..')
      : requestedRoot;
  const node = options.nodeExecutable || process.execPath;
  const suite = options.brainSuite || 'tools/ai-brain/test/*.test.js';
  const run = options.spawnSync || require('child_process').spawnSync;
  const suiteFiles = resolveSuiteFiles(root, suite);
  if (suiteFiles.length === 0) {
    return {
      pass: false,
      command: 'node --test ' + String(suite),
      failures: ['NO_BRAIN_TEST_FILES'],
      summary: [],
      cleanupErrors: [],
      cleanupError: null,
    };
  }
  const command = 'node --test ' + suiteFiles.join(' ');
  const extraTestFlags = [];
  if (options.testConcurrency) {
    extraTestFlags.push('--test-concurrency=' + options.testConcurrency);
  }
  if (options.testTimeout) {
    extraTestFlags.push('--test-timeout=' + options.testTimeout);
  }
  // The host checkout carries live Controller state (intake runs, goals, locks) under
  // tools/ai-brain/data, which the base run's clean worktree does not. Run the suite on
  // a clean checkout of the same HEAD so that state never shows up as a new failure.
  const headClean = checkoutCleanCommit(root, 'HEAD', { run, fs: options.fs || fs });
  const headEnv = hostGateEnv(headClean.dir ? [path.join(root, 'node_modules')] : []);
  const result = run(node, ['--test', ...extraTestFlags, ...suiteFiles], {
    cwd: headClean.dir || root,
    encoding: 'utf8',
    timeout: options.brainGateTimeoutMs || 30 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: headEnv,
  });
  let headCleanupErrors = null;
  const cleanupHead = () => headCleanupErrors || (headCleanupErrors = headClean.cleanup());
  const output = String(result.stdout || '') + '\n' + String(result.stderr || '');
  const failed = parseFailedTestNames(output);
  const summary = output.split(/\r?\n/).filter((line) => /^ℹ (?:pass|fail)\b|^✖ /.test(line));
  const pass = result.status === 0 && failed.length === 0;
  if (pass) {
    const hostGateFailures = Object.assign([], { newFailures: [], baselineFailures: [] });
    return {
      pass: true,
      command,
      failures: [],
      hostGateFailures,
      newFailures: [],
      baselineFailures: [],
      summary,
      cleanupErrors: cleanupHead(),
      cleanupError: cleanupHead()[0] || null,
    };
  }

  if (failed.length === 0) {
    const failures = ['UNPARSED_FAILURE'];
    const hostGateFailures = Object.assign([...failures], {
      newFailures: [...failures],
      baselineFailures: [],
    });
    const repairDetails = options.onHostGateFailure ? options.onHostGateFailure(failures) : null;
    // The token stays fail-closed, but the record must say what really ended the
    // suite: exit status, signal, spawn error and the last output lines.
    const unparsedSummary = [
      'exit status=' +
        (result.status === null || result.status === undefined ? 'none' : result.status) +
        ' signal=' +
        (result.signal || 'none') +
        (result.error ? ' spawnError=' + String(result.error.message || result.error) : ''),
    ].concat(
      output
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .slice(-15)
        .map((line) => line.slice(0, 300))
    );
    return {
      pass: false,
      command,
      reason: 'UNPARSED_FAILURE',
      failures,
      output,
      hostGateFailures,
      newFailures: [...failures],
      baselineFailures: [],
      summary: summary.length ? summary : unparsedSummary,
      repairDetails,
      cleanupErrors: cleanupHead(),
      cleanupError: cleanupHead()[0] || null,
    };
  }

  const cache = options.baseCache || baseGateCache;
  let baseFailed = null;
  let baseSummary = [];
  let baseRan = false;

  const candidateBase =
    options.baseSha ||
    options.baseCommit ||
    (job && (job.baseSha || job.baseCommit)) ||
    options.base ||
    (job && job.base) ||
    (job && (job.workItemId || job.branch || job.workerRoot) ? 'origin/main' : null);

  let baseSha = null;
  const refStr = candidateBase ? String(candidateBase).trim() : '';
  if (refStr) {
    if (/^[0-9a-f]{40}$/i.test(refStr)) {
      baseSha = refStr;
    } else {
      try {
        const revRes = run('git', ['rev-parse', '--verify', refStr + '^{commit}'], {
          cwd: root,
          encoding: 'utf8',
        });
        if (revRes && revRes.status === 0 && revRes.stdout) {
          baseSha = String(revRes.stdout).trim();
          // The writer branched from an older main: gate against the common ancestor, not the moved ref.
          const mbRes = run('git', ['merge-base', 'HEAD', refStr], { cwd: root, encoding: 'utf8' });
          const mbSha = mbRes && mbRes.status === 0 ? String(mbRes.stdout || '').trim() : '';
          if (/^[0-9a-f]{40}$/i.test(mbSha)) baseSha = mbSha;
        }
      } catch (_) {
        baseSha = null;
      }
    }
  }

  if (baseSha && cache.has(baseSha)) {
    const cached = cache.get(baseSha);
    baseFailed = cached.failed;
    baseSummary = cached.summary;
    baseRan = true;
  }

  const cleanupErrors = [];
  const fileSystem = options.fs || fs;

  if (!baseRan && baseSha) {
    let tempDir = null;
    let tempWorktree = null;
    let worktreeAdded = false;
    try {
      tempDir = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'host-gate-base-'));
      tempWorktree = path.join(tempDir, 'wt');

      const addRes = run('git', ['worktree', 'add', '--detach', tempWorktree, baseSha], {
        cwd: root,
        encoding: 'utf8',
      });
      if (addRes && addRes.status === 0) {
        worktreeAdded = true;
        const wtFiles = resolveSuiteFiles(tempWorktree, suite);
        const filesToRun = wtFiles.length > 0 ? wtFiles : suiteFiles;
        const nodeEnv = hostGateEnv([
          path.join(tempWorktree, 'node_modules'),
          path.join(root, 'node_modules'),
        ]);
        const baseResult = run(node, ['--test', ...filesToRun], {
          cwd: tempWorktree,
          encoding: 'utf8',
          timeout: options.brainGateTimeoutMs || 30 * 60 * 1000,
          maxBuffer: 64 * 1024 * 1024,
          env: nodeEnv,
        });

        if (baseResult && typeof baseResult.status === 'number' && !baseResult.error) {
          const baseOutput =
            String(baseResult.stdout || '') + '\n' + String(baseResult.stderr || '');
          const parsedFailures = parseFailedTestNames(baseOutput);

          if (baseResult.status === 0 || parsedFailures.length > 0) {
            baseFailed = parsedFailures;
            baseSummary = baseOutput
              .split(/\r?\n/)
              .filter((line) => /^ℹ (?:pass|fail)\b|^✖ /.test(line));
            baseRan = true;
            cache.set(baseSha, { failed: baseFailed, summary: baseSummary });
          }
        }
      }
    } catch (_) {
      // Base run cannot be executed; keep strict behavior
    } finally {
      if (worktreeAdded) {
        try {
          const removeRes = run('git', ['worktree', 'remove', '--force', tempWorktree], {
            cwd: root,
            encoding: 'utf8',
          });
          if (removeRes && (removeRes.status !== 0 || removeRes.error)) {
            const err =
              removeRes.error ||
              new Error(
                String(removeRes.stderr || removeRes.stdout || 'git worktree remove failed').trim()
              );
            cleanupErrors.push(err.message || String(err));
            if (typeof options.onCleanupError === 'function') options.onCleanupError(err);
          }
        } catch (err) {
          cleanupErrors.push(err.message || String(err));
          if (typeof options.onCleanupError === 'function') options.onCleanupError(err);
        }
      }
      if (tempDir) {
        try {
          fileSystem.rmSync(tempDir, { recursive: true, force: true });
        } catch (err) {
          cleanupErrors.push(err.message || String(err));
          if (typeof options.onCleanupError === 'function') options.onCleanupError(err);
        }
      }
    }
  }

  const baselineKnown = baseRan && Array.isArray(baseFailed);
  const baseSet = new Set(baselineKnown ? baseFailed : []);
  const candidates = Array.from(new Set(failed.filter((name) => !baseSet.has(name))));
  // Confirm on the still-present clean head checkout, then release it.
  const confirmation = baselineKnown
    ? confirmNewFailures(candidates, {
        run,
        node,
        suiteFiles,
        cwd: headClean.dir,
        env: headEnv,
        timeout: options.brainGateTimeoutMs || 30 * 60 * 1000,
      })
    : { confirmed: [...failed], flaky: [] };
  cleanupErrors.push(...cleanupHead());
  const cleanupMessages = cleanupErrors;
  const cleanupError = cleanupErrors.length > 0 ? cleanupErrors[0] : null;

  if (baselineKnown) {
    const newFailures = candidates;
    const flakyRecovered = confirmation.flaky;
    const baselineFailures = Array.from(new Set(baseFailed));
    // The decision record carries both numbers: what failed before this commit, and what is new.
    const counts = {
      baselineFailureCount: baselineFailures.length,
      newFailureCount: newFailures.length,
      flakyRecoveredCount: flakyRecovered.length,
    };

    if (newFailures.length === 0) {
      const hostGateFailures = Object.assign([], {
        newFailures: [],
        baselineFailures,
      });
      return Object.assign(
        {
          pass: true,
          command,
          failures: [],
          hostGateFailures,
          newFailures: [],
          baselineFailures,
          flakyRecovered,
          summary,
          cleanupErrors: cleanupMessages,
          cleanupError,
        },
        counts
      );
    }

    const hostGateFailures = Object.assign([...newFailures], {
      newFailures,
      baselineFailures,
    });
    const repairDetails = options.onHostGateFailure ? options.onHostGateFailure(newFailures) : null;
    return Object.assign(
      {
        pass: false,
        command,
        failures: [...newFailures],
        output,
        hostGateFailures,
        newFailures,
        baselineFailures,
        flakyRecovered,
        summary,
        repairDetails,
        cleanupErrors: cleanupMessages,
        cleanupError,
      },
      counts
    );
  }

  // The baseline could not be computed: fail closed on every failure, say why.
  const hostGateFailures = Object.assign([...failed], {
    newFailures: [...failed],
    baselineFailures: [],
  });
  const repairDetails = options.onHostGateFailure ? options.onHostGateFailure(failed) : null;
  return {
    pass: false,
    command,
    reason: 'BASELINE_UNAVAILABLE',
    failures: [...failed],
    output,
    hostGateFailures,
    newFailures: [...failed],
    baselineFailures: [],
    baselineFailureCount: 0,
    newFailureCount: failed.length,
    flakyRecoveredCount: 0,
    summary,
    repairDetails,
    cleanupErrors: cleanupMessages,
    cleanupError,
  };
}

/**
 * Format host gate diagnostics (failing checks, truncated summary, detail message).
 * Fails closed if maxSummaryChars is not a positive number.
 */
function formatHostGateDiagnostics({ failures, summary, output, maxSummaryChars, defaultDetail }) {
  const failedChecks = Array.isArray(failures) ? failures.map(String) : [];
  let shortSummary = '';
  if (typeof maxSummaryChars === 'number' && maxSummaryChars > 0) {
    const rawSummary = Array.isArray(summary) ? summary.join('; ') : summary || output || '';
    shortSummary = String(rawSummary).trim().slice(0, maxSummaryChars);
  }
  const detailMessage =
    failedChecks.length > 0
      ? `${failedChecks.join(', ')}${shortSummary ? ': ' + shortSummary : ''}`
      : defaultDetail || shortSummary || '';
  return { failedChecks, shortSummary, detailMessage };
}

module.exports = {
  baseGateCache,
  resolveSuiteFiles,
  parseFailedTestNames,
  checkoutCleanCommit,
  hostGateEnv,
  confirmNewFailures,
  runHostBrainGate,
  formatHostGateDiagnostics,
};
