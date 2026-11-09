'use strict';

const fc = require('./failure-classifier');
const { DEFAULT_WORKER_TIMEOUT_MS } = require('./isolation-launcher');
const { afterFailure } = require('./route-handoff');
const { Cause, Scope, extractInnerStatus, extractProviderErrorText, classifyFailure } = fc;

const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const positiveMs = (v, code) => {
  if (typeof v === 'boolean' || v === null || v === undefined || v === '') fail(code);
  const ms = Number(v);
  return Number.isFinite(ms) && ms > 0 ? ms : fail(code);
};
const validateWorkerTimeout = (ms) => positiveMs(ms, 'WORKER_TIMEOUT_INVALID');
const validateHoldDuration = (ms) => positiveMs(ms, 'HOLD_DURATION_INVALID');
const stripAnsi = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '');
const timeMs = (v) =>
  typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Date.parse(v) : NaN;
const readVal = (fn, arg, alt) => (typeof fn === 'function' ? fn(arg) : alt);

function causeStatus(c) {
  if (/rate_limit|quota|exhaustion/.test(c)) return 429;
  if (/credit|monthly/.test(c)) return 402;
  if (/auth|credential/.test(c)) return 401;
  if (c === Cause.UPSTREAM_ENTITLEMENT) return 403;
  return /unsupported|alias/.test(c) ? 404 : c === Cause.GENUINE_CAPACITY ? 503 : 0;
}

function hasRunBoundCommit(commit, run) {
  if (!commit || typeof commit !== 'object' || !run?.runId || commit.runId !== run.runId)
    return false;
  if (run.workItemId && commit.workItemId && commit.workItemId !== run.workItemId) return false;
  const sha = typeof commit.sha === 'string' ? commit.sha.trim() : '';
  return Boolean(sha && sha !== run.baseSha);
}

async function awaitWorkerCompletion(options = {}) {
  const timeoutMs = validateWorkerTimeout(options.workerTimeoutMs);
  const { setTimer = setTimeout, clearTimer = clearTimeout } = options;
  const s = { settled: false, timedOut: false, timer: null, cleanup: null };
  const exitCode = await new Promise((resolve) => {
    const finish = (code, isTimeout) => {
      if (s.settled) return;
      s.settled = true;
      s.timedOut = Boolean(isTimeout);
      if (s.timer !== null) clearTimer(s.timer);
      if (typeof s.cleanup === 'function') s.cleanup();
      resolve(isTimeout ? null : Number(code));
    };
    const onExit = (code) => finish(code, false);
    s.timer = setTimer(() => finish(null, true), timeoutMs);
    if (typeof options.waitForExit === 'function') s.cleanup = options.waitForExit(onExit);
    else if (typeof options.worker?.on === 'function') {
      options.worker.on('exit', onExit);
      const rm = options.worker.off || options.worker.removeListener;
      s.cleanup = () => rm?.call(options.worker, 'exit', onExit);
    } else (clearTimer(s.timer), fail('WORKER_EXIT_SOURCE_REQUIRED'));
  });
  return { exitCode, timedOut: s.timedOut, timeoutMs, defaultTimeoutMs: DEFAULT_WORKER_TIMEOUT_MS };
}

async function superviseWorkerCompletion(options = {}) {
  const { exitCode, timedOut, timeoutMs } = await awaitWorkerCompletion(options);
  const { decision, ticket, context, registry } = options;
  const note = typeof options.note === 'function' ? options.note : () => {};
  const stopCall =
    typeof options.stopWorker === 'function' ? options.stopWorker(options.runId) : false;
  const workerStopped = await Promise.resolve(stopCall)
    .catch(() => false)
    .then((v) => v === true);
  const raw = await readVal(options.readOutput, undefined, options.output || '');
  const stdout = stripAnsi(typeof raw === 'object' ? raw.stdout || raw.log || '' : raw);
  const stderr = stripAnsi(typeof raw === 'object' ? raw.stderr || '' : '');
  const body = stripAnsi(typeof raw === 'object' ? raw.body || '' : '');
  const errParts = [body, extractProviderErrorText(stdout), extractProviderErrorText(stderr)];
  const providerError = errParts.filter(Boolean).join('\n');
  const errLineRe = /^\s*Error:\s*\S/m;
  const hasErrorLine = Boolean(providerError) || errLineRe.test(stdout) || errLineRe.test(stderr);
  const httpMatch = providerError.match(/\bHTTP(?:\s+status)?[ :=]*(\d{3})\b/i);
  const outer = options.httpStatus != null ? Number(options.httpStatus) : Number(httpMatch?.[1]);
  const effectiveStatus = extractInnerStatus(providerError) || outer || 0;
  const workItemId = ticket?.workItemId || decision?.workItemId;
  const runMeta = { cwd: options.cwd, runId: options.runId, workItemId, baseSha: options.baseSha };
  const commit = await readVal(options.readCommit, runMeta, options.commit);
  const committed = hasRunBoundCommit(commit, runMeta);
  const cleanExit = !timedOut && exitCode === 0 && !hasErrorLine && effectiveStatus < 400;

  if (cleanExit && committed && workerStopped) {
    if (context?.ledger) delete context.ledger.activeWorker;
    const category = 'WORKER_FINISHED';
    const record = { step: 'worker-done', runId: options.runId, code: 0, status: 0, category };
    record.commitSha = commit.sha;
    note(record);
    return { status: category, finished: true, completed: true, timedOut, workerStopped, record };
  }

  const noCommitOnly = cleanExit && !committed;
  const clsInput = { ...options, exitCode: timedOut ? -1 : exitCode || 1, timedOut };
  Object.assign(clsInput, { httpStatus: effectiveStatus || undefined, body: providerError });
  const cls = classifyFailure({ ...clsInput, stdout, stderr });
  const category = noCommitOnly ? 'NO_COMMIT_ARTIFACT' : cls.cause;
  const scope = noCommitOnly ? Scope.UNKNOWN : cls.scope;
  const handoffStatus = effectiveStatus || causeStatus(cls.cause);
  const step = timedOut ? 'worker-timeout' : 'worker-failed';
  const code = timedOut ? 'TIMEOUT' : exitCode;
  const record = { step, runId: options.runId, code, status: handoffStatus, category, scope };
  if (timedOut) record.timeoutMs = timeoutMs;
  note(record);
  const failure = { offeringId: options.offeringId, upstream: options.upstream, workerStopped };
  Object.assign(failure, { connectionId: options.connectionId, authLayer: cls.authLayer });
  Object.assign(failure, { status: handoffStatus, message: category, worktree: options.cwd });
  const next = afterFailure(decision, ticket, context, failure, registry);
  let status = timedOut ? 'WORKER_TIMEOUT' : 'WORKER_FAILED';
  if (noCommitOnly) status = 'WORKER_NO_COMMIT';
  if (!workerStopped) status = 'BLOCKED_WORKER_NOT_STOPPED';
  return { status, finished: false, completed: false, timedOut, workerStopped, record, next };
}

function evaluateLaneHold(run, options = {}) {
  const holdDurationMs = validateHoldDuration(options.holdDurationMs);
  const now = typeof options.now === 'function' ? Number(options.now()) : timeMs(options.now);
  if (!Number.isFinite(now)) fail('CLOCK_INVALID');
  const base = { lane: run?.lane || null, runId: run?.runId || null };
  const state = (held, completed, expired, status, reason, extra) =>
    Object.assign({ ...base, held, released: !held, completed, expired, status, reason }, extra);
  const launchedAt = timeMs(run?.launchedAt ?? run?.at);
  if (!base.runId || !base.lane || !Number.isFinite(launchedAt))
    return state(true, false, false, 'HELD', 'RUN_IDENTITY_MISSING');
  const commit = readVal(options.readCommit, run, options.commit);
  const result = readVal(options.readResult, run, options.result);
  const marker = readVal(options.readEndedMarker, run, options.endedMarker);
  const stopConfirmed = Boolean(readVal(options.confirmStop, run, options.stopConfirmed === true));
  if (hasRunBoundCommit(commit, run)) {
    const extra = { commitSha: commit.sha };
    return state(false, true, false, 'WORKER_FINISHED', 'RUN_COMMIT_VERIFIED', extra);
  }
  const validResult = Boolean(
    result?.runId === base.runId && timeMs(result.finishedAt) >= launchedAt
  );
  const markerTime = timeMs(marker?.endedAt ?? marker?.finishedAt ?? marker?.at);
  if (validResult || Boolean(marker?.runId === base.runId && markerTime >= launchedAt))
    return state(false, false, false, 'COMPLETED_EMPTY', 'COMPLETION_WITHOUT_COMMIT');
  const expired = now - launchedAt > holdDurationMs;
  if (expired && stopConfirmed)
    return state(false, false, true, 'STOPPED_AFTER_EXPIRY', 'STOP_CONFIRMED');
  let reason = commit ? 'UNRELATED_COMMIT' : 'ACTIVE_HOLD';
  if (!commit && (result || marker)) reason = 'FOREIGN_RUN_MARKER';
  if (expired) reason = 'HOLD_EXPIRED_UNCONFIRMED';
  return state(true, false, expired, expired ? 'HOLD_EXPIRED_UNCONFIRMED' : 'HELD', reason);
}

function activeHeldLanes(runs, options = {}) {
  validateHoldDuration(options.holdDurationMs);
  const outcomes = (runs || []).map((run) => evaluateLaneHold(run, options));
  const busyLanes = new Set(outcomes.filter((o) => o.held && o.lane).map((o) => o.lane));
  return { busyLanes, outcomes };
}

module.exports = {
  validateWorkerTimeout,
  validateHoldDuration,
  awaitWorkerCompletion,
  superviseWorkerCompletion,
  evaluateLaneHold,
  activeHeldLanes,
};
