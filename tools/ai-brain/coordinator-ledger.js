'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEDGER_SCHEMA_VERSION = 1;

/**
 * Validate a coordinator decision ledger.
 * Missing file is fresh. Corrupted/truncated/inconsistent/wrong-item/unknown-version
 * fails closed as LEDGER_UNREADABLE (never resets the fallback ceiling).
 */
function validateLedger(ledger, options = {}) {
  const bad = () => ({ ok: false, reason: 'LEDGER_UNREADABLE' });
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return bad();

  if (
    ledger.version !== undefined &&
    ledger.schemaVersion !== undefined &&
    ledger.version !== ledger.schemaVersion
  ) {
    return bad();
  }
  const ver = ledger.version !== undefined ? ledger.version : ledger.schemaVersion;
  if (ver !== undefined && (!Number.isInteger(ver) || ver !== LEDGER_SCHEMA_VERSION)) return bad();
  if (options.expectedVersion !== undefined && ver !== undefined && ver !== options.expectedVersion)
    return bad();

  if (
    ledger.item !== undefined &&
    ledger.workItemId !== undefined &&
    ledger.item !== ledger.workItemId
  ) {
    return bad();
  }

  const checkActive = (a) =>
    a === undefined ||
    (a &&
      typeof a === 'object' &&
      !Array.isArray(a) &&
      (typeof a.tag === 'string'
        ? a.tag.length > 0
        : typeof a.offeringId === 'string' || typeof a.sessionId === 'string'));
  if (!checkActive(ledger.active) || !checkActive(ledger.activeWorker)) return bad();

  if (ledger.active !== undefined && ledger.activeWorker !== undefined) {
    if (JSON.stringify(ledger.active) !== JSON.stringify(ledger.activeWorker)) {
      return bad();
    }
  }

  const hasL = ledger.launches !== undefined;
  const hasF = ledger.fallbacksUsed !== undefined;
  if (ver !== undefined && (!hasL || !hasF)) return bad();

  const isCount = (v) => v === undefined || (Number.isInteger(v) && v >= 0);
  if (!isCount(ledger.launches) || !isCount(ledger.fallbacksUsed)) return bad();

  if (hasL) {
    const l = ledger.launches;
    const f = ledger.fallbacksUsed || 0;
    if (l === 0 && f > 0) return bad();
    if (l > 0 && hasF && (f < l - 1 || f > l)) return bad();
  }

  if (ledger.failures !== undefined && !Array.isArray(ledger.failures)) return bad();

  for (const field of ['stopped', 'worktree', 'item', 'workItemId']) {
    if (ledger[field] !== undefined && typeof ledger[field] !== 'string') return bad();
  }

  const expItem = options.item || options.workItemId;
  const legItem = ledger.item || ledger.workItemId;
  if (expItem && legItem && legItem !== expItem) return bad();

  const expWorktree = options.worktree || options.cwd;
  if (expWorktree && ledger.worktree && path.resolve(ledger.worktree) !== path.resolve(expWorktree))
    return bad();

  const isCounted = hasL || ver !== undefined;
  if (isCounted) {
    if (expItem && !legItem) return bad();
    if (expWorktree && !ledger.worktree) return bad();
  }

  return { ok: true };
}

/** @returns {{ ok: true, ledger: object } | { ok: false, reason: string }} */
function readLedger(file, options = {}) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, ledger: {} };
    return { ok: false, reason: 'LEDGER_UNREADABLE' };
  }
  let ledger;
  try {
    ledger = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'LEDGER_UNREADABLE' };
  }
  if (
    ledger &&
    typeof ledger === 'object' &&
    !Array.isArray(ledger) &&
    Object.keys(ledger).length === 0
  ) {
    return { ok: false, reason: 'LEDGER_UNREADABLE' };
  }
  const v = validateLedger(ledger, options);
  if (!v.ok) return v;

  if (ledger.active && !ledger.activeWorker) {
    ledger.activeWorker = ledger.active;
    delete ledger.active;
  }
  return { ok: true, ledger };
}

/** Atomic write: write to a PID+timestamp tmp file, then rename into place. */
function saveLedger(file, ledger) {
  const toWrite = { ...ledger, version: LEDGER_SCHEMA_VERSION };
  if (toWrite.active) {
    toWrite.activeWorker = toWrite.activeWorker || toWrite.active;
    delete toWrite.active;
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(toWrite, null, 1));
  fs.renameSync(tmp, file);
}

/** Determine action on restart from validated ledger. */
function restartAction(ledger) {
  const active = ledger.activeWorker || ledger.active;
  if (active) return { action: 'STOP_WORKER', active, note: 'interrupted worker found on restart' };
  if (ledger.stopped) return { action: 'STOP', reason: ledger.stopped, note: 'already stopped' };
  if (ledger.launches > 0)
    return { action: 'STOP', reason: 'FALLBACK_LIMIT', note: 'nothing active after restart' };
  return { action: 'FRESH' };
}

/** Record launch intent atomically in one ledger record before spawning. */
function recordLaunchIntent(ledger, opts, file) {
  ledger.version = LEDGER_SCHEMA_VERSION;
  ledger.launches = (ledger.launches || 0) + 1;
  ledger.fallbacksUsed = ledger.fallbacksUsed || 0;
  if (opts.item || opts.workItemId) ledger.item = opts.item || opts.workItemId;
  if (opts.worktree || opts.cwd) ledger.worktree = opts.worktree || opts.cwd;
  ledger.activeWorker = { offeringId: opts.offeringId, upstream: opts.upstream, tag: opts.tag };
  delete ledger.active;
  saveLedger(file, ledger);
  return ledger;
}

module.exports = {
  LEDGER_SCHEMA_VERSION,
  readLedger,
  validateLedger,
  saveLedger,
  restartAction,
  recordLaunchIntent,
};
