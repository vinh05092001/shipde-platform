'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const decisions = require('../decisions');
const evidence = require('../evidence');
const { candidateKey } = require('../candidates');
const { progressFromWorkerRoot } = require('../supervisor');
const { captureFailBefore } = require('../isolation-launcher');
const { launchFailureText } = require('./decisions-log');
const { SHA_40 } = require('./shared');

function resolveLauncher(o, isolatedLauncher) {
  if (typeof o.run === 'function') return o.run;

  const externalWorkers =
    typeof o.externalWorkers === 'string'
      ? o.externalWorkers
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

  if (!isolatedLauncher && externalWorkers.length === 0) return null;
  const { getHarness } = require('../harness');
  return (job) => {
    if (job.harness === 'agy-pool') {
      const isAuthorized =
        externalWorkers.includes('agy-pool') &&
        Boolean(
          o.allowAgyPoolWriter ||
          o.dispatch?.agyPoolWriterEnabled ||
          o.registry?.dispatch?.agyPoolWriterEnabled
        );
      if (!isAuthorized) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'LAUNCH_REFUSED: agy-pool writer is disabled by configuration',
          refusal: 'WRITER_LAUNCH_NOT_AUTHORIZED: agy-pool writer is disabled by configuration',
        };
      }
    }
    const writerSchema = require('../writer-schema');
    if (['codex', 'agy-pool'].includes(job.harness) && !job.resultSchema && !job.isReview) {
      job = writerSchema.prepareJob(job);
    }
    if (job.harness === 'codex' && o.isolatedWorker) {
      job.isolationVerdict = require('../isolation-launcher').readClosedIsolationVerdict();
    }
    const adapter = getHarness(job.harness);
    if (!adapter) throw new Error('UNKNOWN_HARNESS: ' + String(job.harness));
    if (
      adapter.id === 'agy-pool' &&
      externalWorkers.includes(adapter.id) &&
      Boolean(
        o.registry?.dispatch?.agyPoolWriterEnabled ||
        o.dispatch?.agyPoolWriterEnabled ||
        o.allowAgyPoolWriter
      )
    ) {
      const pool = require('../agy-pool-runtime');
      // The pool wait is synchronous, so it honours the tightest finite bound among
      // the pool setting, the launch timeout and the job's own deadline; an
      // unbounded (Infinity) general timeout never widens it.
      const bounds = [
        o.poolTimeoutMs,
        o.registry?.dispatch?.agyPoolTimeoutMs,
        o.timeoutMs,
        job.workerTimeoutMs,
        o.workerTimeoutMs,
      ]
        .filter((v) => v !== null && v !== undefined && v !== '')
        .map(Number)
        .filter((v) => Number.isFinite(v) && v >= 0);
      const poolTimeoutMs = bounds.length > 0 ? Math.min(...bounds) : undefined;
      const agyCandidates = require('../agy-pool-candidates');
      const readQuota =
        typeof o.readAgyQuota === 'function'
          ? o.readAgyQuota
          : (accountId) => agyCandidates.readAccountQuotaSnapshot(accountId, o);
      const quotaBefore = readQuota(job.accountId);
      const runStartedAt = Date.now();
      const result = pool.submitJob(job.accountId, job, {
        ...o,
        timeoutMs: poolTimeoutMs,
      });
      const runEndedAt = Date.now();
      const launched = {
        ...result,
        exitCode: result.state === 'ok' ? result.exitCode : result.exitCode || 1,
        stdout: result.jobId && result.state === 'ok' ? pool.readOutText(job.accountId, o) : '',
        stderr: result.reason || (result.state === 'ok' ? '' : result.state || ''),
        refusal: result.state === 'error' ? result.reason : undefined,
        launchHandle: result.jobId || null,
      };
      if (result.state !== 'ok') return launched;
      // The job binding itself comes from agy-pool-runtime: waitForResult only
      // returns a result whose jobId is the submitted one. The receipt checks
      // below are a second guard on that, not a replacement for it.
      // The pool reports no served model, so quota groups are the only run
      // evidence. Evidence that contradicts the request refuses the run; a
      // writer may continue on group evidence only after its commit passes the
      // writer-scope diff check below (the pool bypasses the isolated launcher,
      // so that check is not applied anywhere else), and a reviewer needs the
      // served model itself to prove family independence.
      const scope = String(job.quotaScope || '');
      const identityProof = agyCandidates.verifyAgyServedIdentity({
        requestedModel: job.model,
        expectedBucket: scope.includes(':') ? scope.slice(scope.indexOf(':') + 1) : null,
        quotaBefore,
        quotaAfter: readQuota(job.accountId),
        receipt: {
          accountId: result.accountId,
          jobId: result.jobId,
          servedModel: result.servedModel,
        },
        accountId: job.accountId,
        runStartedAt,
        runEndedAt,
      });
      const contradicting = [
        'AGY_RECEIPT_MISSING',
        'AGY_ACCOUNT_MISMATCH',
        'AGY_RUN_BINDING_MISMATCH',
        'AGY_SERVED_MODEL_MISMATCH',
        'AGY_GROUP_DELTA_MISMATCH',
      ];
      const refusal = contradicting.includes(identityProof.error)
        ? 'AGY_IDENTITY_REFUSED: ' + identityProof.error
        : job.isReview && identityProof.modelVerified !== true
          ? 'REVIEWER_SERVED_MODEL_UNVERIFIED: ' +
            (identityProof.error || identityProof.evidenceKind)
          : null;
      if (refusal) {
        return { ...launched, exitCode: 1, stderr: refusal, refusal, identityProof };
      }
      if (!job.isReview && WRITER_ROLE.test(job.labels?.role || '')) {
        const scoped = verifyAgyWriterCommit(job, result, o);
        if (!scoped.ok) {
          const reason =
            scoped.code +
            (scoped.offending && scoped.offending.length
              ? ': ' + scoped.offending.map((f) => (f && f.path) || String(f)).join(', ')
              : scoped.detail
                ? ': ' + scoped.detail
                : '');
          const refused = {
            ...launched,
            exitCode: 1,
            localFailure: scoped.code,
            refusal: reason,
            failureReason: reason,
            stderr: [launched.stderr, reason].filter(Boolean).join('\n'),
            identityProof,
          };
          delete refused.workerSha;
          delete refused.retainedHeadSha;
          return refused;
        }
        return { ...launched, identityProof, workerSha: scoped.headSha };
      }
      return { ...launched, identityProof };
    }
    let launchArgs;
    try {
      launchArgs = adapter.launch(job);
    } catch (err) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: (err && err.message) || String(err),
        error: err,
      };
    }
    if (launchArgs && !Array.isArray(launchArgs)) {
      const reason =
        launchArgs.reason || launchArgs.refusal || launchArgs.error || 'LAUNCH_REFUSED';
      return {
        exitCode: launchArgs.exitCode !== undefined ? launchArgs.exitCode : 1,
        stdout: '',
        stderr: reason,
        refusal: launchArgs.refusal || reason,
      };
    }

    const isExternal = externalWorkers.includes(adapter.id);
    if (isExternal && (adapter.id === 'agy-pool' || adapter.id === 'autoclaw')) {
      const { runHarness } = require('../harness');
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const env = Object.assign({}, process.env);
      if (adapter.id === 'autoclaw') {
        const tokenFile = path.join(os.homedir(), '.openclaw-autoclaw', '.gateway-token');
        if (fs.existsSync(tokenFile)) {
          env.OPENCLAW_GATEWAY_TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
        }
      }
      return runHarness(adapter, launchArgs, {
        cwd: job.cwd,
        timeoutMs: job.workerTimeoutMs || o.workerTimeoutMs,
        env,
      });
    }

    if (!isolatedLauncher) {
      throw new Error('LAUNCHER_MISSING: no isolated launcher for ' + adapter.id);
    }

    const launched = isolatedLauncher(adapter, launchArgs, {
      cwd: job.hostWorktree || job.cwd,
      workerRoot: job.workerRoot,
      baseSha: job.baseSha,
      branch: job.branch,
      workItemId: job.title || (job.labels && job.labels.workItem) || null,
      commitFileOnlyWriter: WRITER_ROLE.test(job.labels?.role || ''),
      retainWorkerHead: job.retainWorkerHead || undefined,
      // TASK-AI-188: the dirty-root adoption check needs the run that owns the
      // retained root and the Work Item's allowed paths.
      runId: job.runId || undefined,
      allowedPaths: job.allowedPaths || undefined,
      verdictPath: job.verdictPath,
      exercise: job.exercise || o.exercise || null,
      onProvisioned: (root, details) => {
        if (job.resultSchema) writerSchema.materialise(job, root);
        return typeof o.onProvisioned === 'function' ? o.onProvisioned(root, details) : undefined;
      },
      candidateKey: job.candidateKey || null,
      gateway: job.gateway || null,
      model: job.model || null,
      upstream: job.upstream || null,
      contextWindow: job.contextWindow || null,
      maxOutputTokens: job.maxOutputTokens || null,
      usageFile: job.usageFile || null,
      tokenBudget: job.tokenBudget || null,
      progressTimeoutMs: job.progressTimeoutMs || o.progressTimeoutMs || null,
      rtk: job.rtk || null,
      riskDomains: job.riskDomains || null,
      lowRisk: job.lowRisk === true,
      // TASK-AI-121 LF-R03: the worker timeout the run was given, for writer,
      // reviewer and repair launches alike.
      workerTimeoutMs: job.workerTimeoutMs || o.workerTimeoutMs || undefined,
      // TASK-AI-127 WD-R03: a WORKER_DEPS_UNAVAILABLE warning is recorded in
      // the same decision log the run itself writes.
      decisionDir: o.decisionDir || undefined,
      checkpoint: o.checkpointFile || (typeof o.checkpoint === 'string' ? o.checkpoint : undefined),
    });
    if (job.resultSchema && launched && launched.exitCode === 0) {
      const checked = writerSchema.validate(launched.stdout, job.resultSchema);
      if (!checked.ok || checked.value.status !== 'completed') {
        return {
          ...launched,
          exitCode: 1,
          failureReason: checked.reason || 'WRITER_RESULT_NOT_COMPLETED',
        };
      }
    }
    return launched;
  };
}

function harnessFor(candidate) {
  try {
    return require('../harness').getHarness(candidate && candidate.harness);
  } catch (err) {
    return null;
  }
}

// Record actual writer invocations before downstream verification can fail.
// A checkpoint replay is not a new invocation and must not duplicate this event.
function recordWriterResult(job, result, kind, logOpts, env) {
  const res = result || {};
  const redact = decisions.createSecretRedactor({ ...process.env, ...env });
  const stderr = redact(launchFailureText(res));
  // TASK-AI-188: a later repair may adopt the dirty root this writer left, but
  // only on evidence that the worker actually ran there (a session id) and a
  // HEAD read from that root. A refused launch or an unreadable HEAD records no
  // ownership (#610 review, R2).
  const sessionId = redact(
    require('../executor').readSessionId(harnessFor(job), job, res).id || ''
  );
  const candidateRoot = job.workerRoot || job.cwd || null;
  const workerSha = sessionId && candidateRoot ? headShaOf(candidateRoot) : null;
  const ownership = workerSha ? { workerRoot: candidateRoot, sha: workerSha } : {};
  return decisions.recordDecision(
    {
      stage: 'writer-launch-result',
      runId: logOpts.runId,
      workItemId: job.workItemId,
      chosen: job.candidateKey,
      kind,
      model: job.model,
      harness: job.harness,
      usageFile: job.usageFile,
      ...ownership,
      exitCode: res.exitCode ?? null,
      timedOut: res.timedOut === true,
      httpStatus: res.httpStatus ?? null,
      sessionId,
      stderr: stderr.slice(0, 4096),
      stderrTruncated: stderr.length > 4096,
    },
    logOpts
  );
}

/**
 * The host-side test gate: the item's own verification command, run here.
 *
 * Host-side because the worker is untrusted — a failing test the worker reports
 * is a failing test the worker can also hide. The command is the work item's own
 * declared verification command, authored in the plan, never anything the worker
 * produced, and an item that declares none is refused rather than assumed
 * (AI-64-R06).
 */
function runVerificationCommand(item, options) {
  const o = options || {};
  const verification = (item && item.verification) || null;
  let command = verification && verification.command;
  if (!command) {
    return {
      pass: false,
      cause: 'VERIFICATION_COMMAND_MISSING',
      findings: [
        {
          id: 'VERIFICATION_COMMAND_MISSING',
          open: true,
          detail: 'the work item declares no verification.command (AI-64-R06)',
        },
      ],
    };
  }
  const cwd = o.workerRoot || o.cwd || process.cwd();
  // Operator decision: CI is the final verification. The isolated worker has no
  // PostgreSQL/Redis/object storage, so scripts that need them (sources.json
  // dispatch.verification) are deferred to CI instead of failing here forever.
  let deferredToCi = [];
  if (o.isolatedWorker || o.workerRoot) {
    const split = require('../verification-split').deriveInfraFreeCommand(command, { cwd });
    if (split.command) {
      command = split.command;
      deferredToCi = split.deferred;
    }
  }
  const env = { ...process.env, ...(o.env || {}) };
  const res = (o.spawnSync || spawnSync)(command, {
    cwd,
    env,
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
    timeout: o.timeoutMs || 30 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = String((res && res.stdout) || '') + String((res && res.stderr) || '');
  const expect = verification.expect || null;
  const exitOk = Boolean(res) && res.status === 0;
  const expectOk = expect ? output.includes(expect) : true;
  if (!exitOk || !expectOk) {
    return {
      pass: false,
      cause: exitOk ? 'VERIFICATION_EXPECT_MISSING' : 'VERIFICATION_EXIT',
      deferredToCi,
      command,
      expect,
      exitCode: res ? res.status : null,
      detail: output.slice(-2000),
    };
  }

  // After verification command passes, verify worker commit:
  const workerRoot =
    o.workerRoot ||
    (o.isolatedWorker
      ? require('../isolation-launcher').workerRootFor(o.cwd || process.cwd())
      : null) ||
    null;
  const commitCheck = verifyWorkerCommit(
    workerRoot,
    o.baseSha,
    Object.assign({ workItemId: (item && item.id) || o.workItemId }, o)
  );
  if (!commitCheck.pass) {
    return {
      pass: false,
      cause: 'NO_LOCAL_COMMIT',
      deferredToCi,
      findings: [
        {
          id: 'NO_LOCAL_COMMIT',
          open: true,
          detail: commitCheck.detail,
          dirtyPaths: commitCheck.dirtyPaths || [],
          headSha: commitCheck.headSha || null,
          baseSha: commitCheck.baseSha || null,
        },
      ],
      command,
      expect,
      exitCode: res ? res.status : null,
      detail: commitCheck.detail,
    };
  }

  return {
    pass: true,
    cause: null,
    deferredToCi,
    command,
    expect,
    exitCode: res ? res.status : null,
    detail: output.slice(-2000),
  };
}

/**
 * Provision a separate read-only review root from the worker repository at the exact targetSha.
 * Hardened git per PR #184/#187/#189: never consults worker config, copies sanitized objects,
 * configures safe line endings and filemode, and verifies HEAD matches targetSha via hardened rev-parse.
 */

// The roles whose commit is a writer commit; aligned with routing.js (/i) and used by both launchers.
const WRITER_ROLE = /^author(?:\.|$)|^(?:writer|repair)$/i;

/**
 * Writer-scope check for an agy-pool writer, which runs outside the isolated
 * launcher. The root and base come from the job the Controller bound to this
 * run, and the head from that job's own receipt: the pool worker records the
 * root it ran in and the HEAD it left there. The root's HEAD must still be that
 * head, so a commit another job made on a shared root is never taken as this
 * job's. A missing or mismatched value refuses, and nothing falls back to the
 * Controller's own checkout or HEAD.
 */
function verifyAgyWriterCommit(job, receipt, options) {
  const root = job.workerRoot || job.cwd || null;
  if (!root || !fs.existsSync(path.join(root, '.git'))) {
    return { ok: false, code: 'AGY_WRITER_ROOT_UNBOUND' };
  }
  const baseSha = typeof job.baseSha === 'string' && SHA_40.test(job.baseSha) ? job.baseSha : null;
  if (!baseSha) return { ok: false, code: 'AGY_WRITER_BASE_UNBOUND' };
  const ran = receipt && typeof receipt.cwd === 'string' && receipt.cwd ? receipt.cwd : null;
  if (!ran) return { ok: false, code: 'AGY_WRITER_RECEIPT_ROOT_MISSING' };
  const same = (a, b) => {
    const norm = (p) => path.resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'win32'
      ? norm(a).toLowerCase() === norm(b).toLowerCase()
      : norm(a) === norm(b);
  };
  if (!same(ran, root)) {
    return { ok: false, code: 'AGY_WRITER_RECEIPT_ROOT_MISMATCH', detail: ran };
  }
  const headSha =
    receipt && typeof receipt.headSha === 'string' && SHA_40.test(receipt.headSha)
      ? receipt.headSha.toLowerCase()
      : null;
  if (!headSha) return { ok: false, code: 'AGY_WRITER_RECEIPT_HEAD_MISSING' };
  const current = headShaOf(root, options);
  if (!current) return { ok: false, code: 'AGY_WRITER_HEAD_UNREADABLE' };
  if (current.toLowerCase() !== headSha) {
    return { ok: false, code: 'AGY_WRITER_RECEIPT_HEAD_MISMATCH', detail: current };
  }
  if (headSha !== baseSha.toLowerCase()) {
    const { runHardenedGit } = require('./hardened-git');
    const anc = runHardenedGit(root, ['merge-base', '--is-ancestor', baseSha, headSha]);
    if (anc.error || anc.status !== 0) {
      return { ok: false, code: 'AGY_WRITER_HEAD_NOT_FROM_BASE', detail: headSha };
    }
  }
  const diff = require('../writer-scope').checkWriterCommitDiff({
    workerRoot: root,
    baseSha,
    headSha,
    writerPaths: job.writerPaths,
    allowedPaths: job.allowedPaths,
  });
  if (!diff.ok) return diff;
  return { ok: true, headSha, root };
}

/**
 * The worker sha of a launch that did not run in an isolated root. An agy-pool
 * writer's commit is the one its scope check verified in the job's own root, never
 * that root's later HEAD or the Controller's sha; other harnesses keep their rule.
 */
function nonIsolatedWorkerSha(job, res, controllerSha) {
  if (job && job.harness === 'agy-pool') {
    const sha = res && !res.localFailure && res.workerSha ? res.workerSha : null;
    const unverified = !sha && Boolean(res && res.exitCode === 0 && !job.isReview);
    return { sha, unverified };
  }
  return { sha: headShaOf(job && job.cwd) || controllerSha || null, unverified: false };
}

function headShaOf(cwd, options) {
  if (!cwd || !fs.existsSync(path.join(cwd, '.git'))) return null;
  const { withCleanGitEnv, safeGit } = require('../supervisor');
  try {
    return withCleanGitEnv(
      cwd,
      (tmpDir) => {
        const res = safeGit(tmpDir, cwd, ['rev-parse', 'HEAD'], 20000, options);
        if (!res || res.status !== 0) return null;
        return String(res.stdout || '').trim() || null;
      },
      Object.assign({ workerWritable: true }, options)
    );
  } catch (err) {
    return null;
  }
}

function verifyCommitSha(cwd, sha, options) {
  if (!cwd || !sha || !fs.existsSync(path.join(cwd, '.git'))) return null;
  const shaStr = String(sha).trim();
  if (!/^[0-9a-f]{40}$/i.test(shaStr)) return null;
  const { withCleanGitEnv, safeGit } = require('../supervisor');
  try {
    return withCleanGitEnv(
      cwd,
      (tmpDir) => {
        const res = safeGit(
          tmpDir,
          cwd,
          ['rev-parse', '--verify', '--quiet', shaStr + '^{commit}'],
          20000,
          options
        );
        if (!res || res.status !== 0) return null;
        const out = String(res.stdout || '').trim();
        return out.toLowerCase() === shaStr.toLowerCase() ? out : null;
      },
      Object.assign({ workerWritable: true }, options)
    );
  } catch (err) {
    return null;
  }
}

function resolveIsolatedWorkerRoot(o, hostWorktree) {
  if (!o || !o.isolatedWorker) return null;
  if (o.isolatedWorkerRoot) return o.isolatedWorkerRoot;
  if (o.workerRoot) return o.workerRoot;
  try {
    return require('../isolation-launcher').workerRootFor(hostWorktree);
  } catch {
    return null;
  }
}

function isTestFilePath(filePath) {
  return /(?:^|\/)tests?(?:\/|$)|\.(?:test|spec)\./i.test(filePath);
}

function measureFailBefore(workerRoot, baseSha, headSha, command, options) {
  if (
    typeof workerRoot !== 'string' ||
    !workerRoot ||
    typeof baseSha !== 'string' ||
    !baseSha ||
    typeof headSha !== 'string' ||
    !headSha ||
    typeof command !== 'string' ||
    !command.trim()
  ) {
    return null;
  }

  const o = options || {};
  const check = o.spawnSync || spawnSync;
  const timeout = o.timeoutMs || 120000;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-brain-fail-before-'));
  const baseTree = path.join(tempRoot, 'base-tree');
  const archiveFile = path.join(tempRoot, 'base.tar');

  try {
    fs.mkdirSync(baseTree, { recursive: true });

    const archive = check(
      'git',
      [
        '-c',
        'safe.directory=*',
        '-C',
        workerRoot,
        'archive',
        '--format=tar',
        '--output',
        archiveFile,
        baseSha,
      ],
      { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 }
    );
    if (!archive || archive.status !== 0 || !fs.existsSync(archiveFile)) return null;

    const extracted = check('tar', ['-xf', 'base.tar', '-C', 'base-tree'], {
      cwd: tempRoot,
      encoding: 'utf8',
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!extracted || extracted.status !== 0) return null;

    const diff = check(
      'git',
      ['-c', 'safe.directory=*', '-C', workerRoot, 'diff', '--name-only', '-z', baseSha, headSha],
      { encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024 }
    );
    if (!diff || diff.status !== 0) return null;

    const changedPaths = String(diff.stdout || '')
      .split('\0')
      .filter(Boolean);
    const testFiles = changedPaths.filter(isTestFilePath);
    for (const filePath of testFiles) {
      const segments = filePath.split(/[\\/]/);
      if (
        path.isAbsolute(filePath) ||
        segments.some((segment) => segment === '..' || segment === '.')
      ) {
        return null;
      }
      const fileResult = check(
        'git',
        ['-c', 'safe.directory=*', '-C', workerRoot, 'show', headSha + ':' + filePath],
        { encoding: null, timeout, maxBuffer: 16 * 1024 * 1024 }
      );
      if (!fileResult || fileResult.status !== 0 || !Buffer.isBuffer(fileResult.stdout)) {
        return null;
      }
      const destination = path.resolve(baseTree, ...segments);
      if (!destination.startsWith(path.resolve(baseTree) + path.sep)) return null;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, fileResult.stdout);
    }

    const env = Object.assign({}, process.env);
    delete env.NODE_TEST_CONTEXT;
    const result = check(command, [], {
      cwd: baseTree,
      env,
      shell: true,
      encoding: 'utf8',
      timeout,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!result || !Number.isInteger(result.status)) return null;

    return {
      command,
      exitCode: result.status,
      output: (String(result.stdout || '') + String(result.stderr || '')).slice(-4000),
      baseSha,
      headSha,
      testFiles,
      measuredBy: 'supervisor-base-tree',
    };
  } catch (_) {
    return null;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function getTreeStatus(cwd, options) {
  if (!cwd || !fs.existsSync(path.join(cwd, '.git'))) {
    return { isDirty: false, dirtyPaths: [], lines: [] };
  }
  const { withCleanGitEnv, safeGit } = require('../supervisor');
  try {
    return withCleanGitEnv(
      cwd,
      (tmpDir) => {
        const statusArgs = ['status', '--porcelain'];
        if (options && (options.untracked === 'all' || options.untrackedFiles === 'all')) {
          statusArgs.push('-uall');
        }
        const res = safeGit(tmpDir, cwd, statusArgs, 20000, options);
        if (!res || res.status !== 0) return { isDirty: false, dirtyPaths: [], lines: [] };
        const raw = String(res.stdout || '').trim();
        if (!raw) return { isDirty: false, dirtyPaths: [], lines: [] };
        const lines = raw
          .split(/\r?\n/)
          .map((l) => l.trimEnd())
          .filter(Boolean);
        const activeWorkItemId = options && (options.workItemId || options.workItem);
        const filteredLines = lines.filter((line) => {
          if (!activeWorkItemId) return true;
          if (line.trimStart().startsWith('??')) {
            const pathPart = line.replace(/^[A-Z? ]{1,2}\s+/, '').trim();
            if (
              pathPart.startsWith('docs/product-spec/work-items/') ||
              pathPart.startsWith('docs\\product-spec\\work-items\\')
            ) {
              const basename = path.basename(pathPart);
              if (basename.endsWith('.md') && basename !== `${activeWorkItemId}.md`) {
                return false;
              }
            }
          }
          return true;
        });
        const dirtyPaths = [
          ...new Set(
            filteredLines.map((line) => {
              let p = line.replace(/^[A-Z? ]{1,2}\s+/, '').trim();
              if (p.includes(' -> ')) {
                p = p.split(' -> ')[1].trim();
              }
              if (p.startsWith('"') && p.endsWith('"')) {
                p = p.slice(1, -1);
              }
              return p;
            })
          ),
        ];
        return { isDirty: filteredLines.length > 0, dirtyPaths, lines: filteredLines };
      },
      Object.assign({ workerWritable: true }, options)
    );
  } catch (err) {
    return { isDirty: false, dirtyPaths: [], lines: [] };
  }
}

function isTreeDirty(cwd, options) {
  return getTreeStatus(cwd, options).isDirty;
}

function verifyWorkerCommit(workerRoot, baseSha, options) {
  if (!workerRoot) return { pass: true };
  const headSha = headShaOf(workerRoot, options);
  const isGitRepo = fs.existsSync(path.join(workerRoot, '.git'));
  const cleanBase = baseSha ? String(baseSha).trim() : null;
  if (!headSha) {
    if (isGitRepo) {
      return {
        pass: false,
        cause: 'NO_LOCAL_COMMIT',
        headSha: null,
        baseSha: cleanBase,
        dirtyPaths: [],
        detail:
          'no commit found at HEAD in worker root; HEAD SHA: none, base SHA: ' +
          (cleanBase || 'none'),
      };
    }
    return { pass: true };
  }
  if (cleanBase && headSha.toLowerCase() === cleanBase.toLowerCase()) {
    const treeStatus = getTreeStatus(workerRoot, options);
    const dirtyPaths = treeStatus.dirtyPaths;
    const pathsDetail = dirtyPaths.length > 0 ? '; offending paths: ' + dirtyPaths.join(', ') : '';
    return {
      pass: false,
      cause: 'NO_LOCAL_COMMIT',
      headSha,
      baseSha: cleanBase,
      dirtyPaths,
      detail:
        'worker head matches base SHA ' +
        cleanBase +
        ' (no local commit created)' +
        pathsDetail +
        '; HEAD SHA: ' +
        headSha +
        ', base SHA: ' +
        cleanBase,
    };
  }
  if (cleanBase && headSha) {
    const isAncestor = (() => {
      try {
        const check = (options && options.spawnSync) || spawnSync;
        const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
        const normWorkerRoot = path.resolve(workerRoot).replace(/\\/g, '/');
        const res = check(
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
            cleanBase,
            headSha,
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
        return res && res.status === 0;
      } catch {
        return false;
      }
    })();
    if (!isAncestor) {
      const treeStatus = getTreeStatus(workerRoot, options);
      const dirtyPaths = treeStatus.dirtyPaths;
      const pathsDetail =
        dirtyPaths.length > 0 ? '; offending paths: ' + dirtyPaths.join(', ') : '';
      return {
        pass: false,
        cause: 'NO_LOCAL_COMMIT',
        headSha,
        baseSha: cleanBase,
        dirtyPaths,
        detail:
          'worker commit ' +
          headSha +
          ' is not a descendant of base SHA ' +
          cleanBase +
          pathsDetail +
          '; HEAD SHA: ' +
          headSha +
          ', base SHA: ' +
          cleanBase,
      };
    }
  }
  const treeStatus = getTreeStatus(workerRoot, options);
  if (treeStatus.isDirty) {
    const dirtyPaths = treeStatus.dirtyPaths;
    const pathsStr = dirtyPaths.join(', ');
    return {
      pass: false,
      cause: 'NO_LOCAL_COMMIT',
      headSha,
      baseSha: cleanBase,
      dirtyPaths,
      detail:
        'worker left uncommitted changes in the worktree (dirty tree); offending paths: ' +
        pathsStr +
        '; HEAD SHA: ' +
        (headSha || 'none') +
        ', base SHA: ' +
        (cleanBase || 'none'),
    };
  }
  return {
    pass: true,
    headSha,
    baseSha: cleanBase,
  };
}

function writeUsageReportFromHarnessResult(job, res) {
  if (!job || !job.usageFile || typeof job.usageFile !== 'string') return null;
  if (fs.existsSync(job.usageFile)) return job.usageFile;

  // Hermes CLI writes its own --usage-file; an absent report for Hermes is an error (AI-64-R04, 64-01).
  // Adapters like opencode-direct do not have a CLI --usage-file flag, so the loop writes it from the result.
  if (job.harness === 'hermes') return null;
  if (typeof job.run === 'function' && job.harness !== 'opencode-direct') return null;

  let sessionId = null;
  let tokens = { input: 0, cacheRead: 0, output: 0, total: 0 };
  let sawTokens = false;

  const directUsage = res && res.usage;
  if (directUsage && typeof directUsage === 'object') {
    const input = Number(directUsage.input_tokens ?? directUsage.input ?? 0);
    const output = Number(directUsage.output_tokens ?? directUsage.output ?? 0);
    const cacheRead = Number(
      directUsage.cache_read_tokens ?? directUsage.cacheRead ?? directUsage.cache_read ?? 0
    );
    const total = Number(directUsage.total_tokens ?? directUsage.total ?? 0);
    if ([input, output, cacheRead, total].some((value) => Number.isFinite(value) && value > 0)) {
      tokens = { input, output, cacheRead, total };
      sawTokens = true;
    }
  }

  const stdout = String((res && res.stdout) || '');
  if (stdout && !sawTokens) {
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.sessionID || parsed.sessionId || parsed.session_id) {
            sessionId = parsed.sessionID || parsed.sessionId || parsed.session_id;
          }
          const t = parsed.tokens || (parsed.part && parsed.part.tokens);
          if (t) {
            sawTokens = true;
            tokens.input = Number(t.input) || tokens.input;
            tokens.output = Number(t.output) || tokens.output;
            tokens.total = Number(t.total) || tokens.total;
            const cr =
              (t.cache && (t.cache.read ?? t.cache.read_tokens)) ??
              t.cacheRead ??
              t.cache_read ??
              t.cache_read_tokens;
            if (cr != null) {
              tokens.cacheRead = Number(cr) || 0;
            }
          }
        } catch (e) {
          // ignore non-json line
        }
      }
    }
  }

  if (!sessionId && res && res.completionNonce) {
    sessionId = res.completionNonce;
  }
  if (!sawTokens && !sessionId && (!res || res.exitCode === 0 || res.exitCode == null)) {
    return null;
  }
  // A failed launch reports session_id: null per AC-AI-64-23 / TASK-AI-63
  if (res && res.exitCode !== 0 && res.exitCode !== null && res.exitCode !== undefined) {
    sessionId = null;
  }

  const accountedTotal = tokens.input + (Number(tokens.cacheRead) || 0) + tokens.output;
  const report = {
    session_id: sessionId,
    model: job.model || (job.candidate && job.candidate.model) || null,
    provider: job.upstream || job.provider || (job.candidate && job.candidate.provider) || null,
    usage: sawTokens
      ? {
          input: tokens.input,
          cacheRead: tokens.cacheRead || 0,
          cache_read: tokens.cacheRead || 0,
          cache_read_tokens: tokens.cacheRead || 0,
          output: tokens.output,
          total: tokens.total ? Math.max(tokens.total, accountedTotal) : accountedTotal,
        }
      : {},
  };

  try {
    fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
    fs.writeFileSync(job.usageFile, JSON.stringify(report, null, 2), 'utf8');
    return job.usageFile;
  } catch (err) {
    return null;
  }
}

function readUsageReport(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/** Progress markers, measured host-side from the worker's own worktree. */
function progressOf(o, res, now) {
  const merged = Object.assign({}, (res && res.progress) || {});
  const root = o.workerRoot || o.cwd;
  if (root) Object.assign(merged, progressFromWorkerRoot(root, { baseSha: o.baseSha, now }));
  return merged;
}

/**
 * The report path for one launch, with any report already at that path removed.
 *
 * A leftover report from an earlier launch is not evidence about this one: reading
 * it would turn a launch that produced no handle into one that did, which is the
 * simulated-success failure this loop refuses to make. The path is per attempt, so
 * two attempts in one run cannot collide either.
 */
function prepareUsageReport(dir, stem) {
  const file = path.join(dir, stem + '.json');
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.unlinkSync(file);
  } catch (err) {
    // No report there yet, which is the normal case.
  }
  return file;
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

/**
 * A receipt count: a number, or null when the field is absent, null or not a
 * number. `Number(null)` is `0`, so coercing first would launder an omitted
 * `repairCount` into "no repairs happened" — absence is never evidence
 * (AI-64-P08), and each count check downstream tests the raw field for null.
 */
module.exports = {
  resolveLauncher,
  harnessFor,
  recordWriterResult,
  runVerificationCommand,
  headShaOf,
  verifyCommitSha,
  resolveIsolatedWorkerRoot,
  isTestFilePath,
  measureFailBefore,
  getTreeStatus,
  isTreeDirty,
  verifyWorkerCommit,
  writeUsageReportFromHarnessResult,
  readUsageReport,
  progressOf,
  prepareUsageReport,
  unique,
  nonIsolatedWorkerSha,
};
