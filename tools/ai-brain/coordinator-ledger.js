'use strict';

// TASK-AI-171 Route PR 07 — the ticket ledger survives crashes and restarts.
// This module is the only owner of the ledger schema and the only path that spawns a worker:
// read + validate -> route-handoff decides (pure) -> launch intent persisted -> spawn.
// A missing ledger file is a fresh ticket; any present but invalid file is LEDGER_UNREADABLE
// and never resets the fallback ceiling.

const fs = require('node:fs');
const path = require('node:path');
const { firstLaunch, afterFailure } = require('./route-handoff');

const SCHEMA_VERSION = 1;
const UNREADABLE = 'LEDGER_UNREADABLE';

class LedgerError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

// Order-insensitive comparison for alias migration.
function sameValue(a, b) {
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameValue(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  return a === b;
}

// Old names are read only for migration, and only when they agree with the canonical name.
function alias(raw, canonical, legacy) {
  const hasC = Object.prototype.hasOwnProperty.call(raw, canonical);
  const hasL = Object.prototype.hasOwnProperty.call(raw, legacy);
  if (hasC && hasL && !sameValue(raw[canonical], raw[legacy])) throw new LedgerError(UNREADABLE);
  return hasC ? raw[canonical] : raw[legacy];
}

function validWorker(w) {
  return w === null || (isObject(w) && typeof w.tag === 'string' && w.tag.length > 0);
}

/**
 * Validate and canonicalise a parsed ledger against the caller's expected item and worktree.
 * Every field is required; the caller's expectation is the reference, never the ledger itself.
 */
function canonical(raw, expect) {
  if (!isObject(raw)) throw new LedgerError(UNREADABLE);
  if (!expect || !expect.item || !expect.worktree)
    throw new LedgerError('LEDGER_EXPECTATION_MISSING');
  const ledger = {
    version: alias(raw, 'version', 'schemaVersion'),
    item: alias(raw, 'item', 'workItemId'),
    worktree: raw.worktree,
    launches: raw.launches,
    fallbacksUsed: raw.fallbacksUsed,
    failures: raw.failures,
    activeWorker: alias(raw, 'activeWorker', 'active'),
    stopped: raw.stopped === undefined ? null : raw.stopped,
  };
  // A present record states its worker explicitly (null = none); absence is not "no worker".
  if (ledger.activeWorker === undefined) throw new LedgerError(UNREADABLE);
  const ok =
    ledger.version === SCHEMA_VERSION &&
    typeof ledger.item === 'string' &&
    typeof ledger.worktree === 'string' &&
    isCount(ledger.launches) &&
    isCount(ledger.fallbacksUsed) &&
    // every launch after the first is a fallback, and both are saved in one write
    ledger.fallbacksUsed === Math.max(ledger.launches - 1, 0) &&
    Array.isArray(ledger.failures) &&
    validWorker(ledger.activeWorker) &&
    (ledger.stopped === null || typeof ledger.stopped === 'string');
  if (!ok) throw new LedgerError(UNREADABLE);
  if (ledger.item !== expect.item) throw new LedgerError(UNREADABLE);
  if (path.resolve(ledger.worktree) !== path.resolve(expect.worktree)) {
    throw new LedgerError(UNREADABLE);
  }
  return ledger;
}

function fresh(expect) {
  return canonical(
    {
      version: SCHEMA_VERSION,
      item: expect.item,
      worktree: expect.worktree,
      launches: 0,
      fallbacksUsed: 0,
      failures: [],
      activeWorker: null,
    },
    expect
  );
}

/** @returns {{ok:true, ledger:object} | {ok:false, reason:string}} */
function readLedger(file, expect, io = fs) {
  let text;
  try {
    text = io.readFileSync(file, 'utf8');
  } catch (e) {
    if (!e || e.code !== 'ENOENT') return { ok: false, reason: UNREADABLE };
    text = null;
  }
  try {
    return {
      ok: true,
      ledger: text === null ? fresh(expect) : canonical(JSON.parse(text), expect),
    };
  } catch (e) {
    return { ok: false, reason: e instanceof LedgerError ? e.reason : UNREADABLE };
  }
}

/** Atomic save of the canonical shape; refuses anything its own validation would reject. */
function saveLedger(file, ledger, expect, io = fs) {
  const value = canonical(ledger, expect);
  const tmp = `${file}.${process.pid}.tmp`;
  io.writeFileSync(tmp, JSON.stringify(value, null, 1));
  io.renameSync(tmp, file);
  return value;
}

/** What a restarted coordinator must do before any new launch. */
function restartAction(ledger) {
  if (ledger.activeWorker) return { action: 'STOP_WORKER', worker: ledger.activeWorker };
  if (ledger.stopped) return { action: 'STOP', reason: ledger.stopped };
  return { action: 'CONTINUE' };
}

// Persist the launch intent, then spawn. No persisted receipt, no spawn.
function persistAndSpawn(file, ledger, expect, plan, deps) {
  const tag = deps.tag();
  const next = {
    ...ledger,
    launches: ledger.launches + 1,
    activeWorker: { tag, offeringId: plan.launch && plan.launch.offeringId },
  };
  const receipt = saveLedger(file, next, expect, deps.io);
  const run = deps.spawn(plan.launch, { tag });
  return { ...plan, receipt, run };
}

/**
 * The only supervised launch path. deps: { spawn(launch, {tag}), tag(), io?, registry? }.
 * Returns the handoff plan; LAUNCH carries the persisted receipt and the spawn result.
 */
function launchFirst(file, decision, ticket, deps) {
  const expect = { item: ticket.workItemId, worktree: ticket.request && ticket.request.cwd };
  const read = readLedger(file, expect, deps.io);
  if (!read.ok) return { action: 'BLOCKED', reason: read.reason, rejected: [] };
  const restart = restartAction(read.ledger);
  if (restart.action !== 'CONTINUE')
    return { action: 'BLOCKED', reason: restart.action, rejected: [] };
  const plan = firstLaunch(
    decision,
    ticket,
    { ...deps.context, ledger: read.ledger },
    deps.registry
  );
  if (plan.action !== 'LAUNCH') return plan;
  return persistAndSpawn(file, read.ledger, expect, plan, deps);
}

/** After a failed run: record it, then at most the allowed fallback through the same path. */
function launchAfterFailure(file, decision, ticket, failure, deps) {
  const expect = { item: ticket.workItemId, worktree: ticket.request && ticket.request.cwd };
  const read = readLedger(file, expect, deps.io);
  if (!read.ok) return { action: 'STOP', reason: read.reason };
  const ledger = read.ledger;
  const plan = afterFailure(decision, ticket, { ...deps.context, ledger }, failure, deps.registry);
  // afterFailure deletes activeWorker once the failed worker is confirmed stopped
  if (ledger.activeWorker === undefined) ledger.activeWorker = null;
  if (plan.action !== 'LAUNCH') {
    ledger.stopped = plan.action === 'STOP' ? plan.reason : ledger.stopped;
    saveLedger(file, ledger, expect, deps.io);
    return plan;
  }
  ledger.activeWorker = null;
  return persistAndSpawn(file, ledger, expect, plan, deps);
}

/** Guard used by route-handoff when a persisted ledger is passed to it directly. */
function checkLedger(raw, expect) {
  try {
    return { ok: true, ledger: canonical(raw, expect) };
  } catch (e) {
    return { ok: false, reason: e instanceof LedgerError ? e.reason : UNREADABLE };
  }
}

module.exports = {
  SCHEMA_VERSION,
  checkLedger,
  readLedger,
  saveLedger,
  restartAction,
  launchFirst,
  launchAfterFailure,
};
