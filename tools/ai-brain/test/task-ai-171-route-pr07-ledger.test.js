'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LEDGER_SCHEMA_VERSION,
  readLedger,
  validateLedger,
  saveLedger,
  restartAction,
  recordLaunchIntent,
} = require('../coordinator-ledger');
const { firstLaunch, afterFailure } = require('../route-handoff');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'ledger.json');
}

// ── B46: Schema & validation ─────────────────────────────────────────────

test('B46: missing ledger file returns fresh empty ledger', (t) => {
  const r = readLedger(tmp(t));
  assert.equal(r.ok, true);
  assert.deepEqual(r.ledger, {});
});

test('B46: truncated JSON is LEDGER_UNREADABLE', (t) => {
  const file = tmp(t);
  fs.writeFileSync(file, '{ "launches": 1, "fallback');
  assert.deepEqual(readLedger(file), { ok: false, reason: 'LEDGER_UNREADABLE' });
});

test('B46: inconsistent counters fail closed as LEDGER_UNREADABLE', (t) => {
  const file = tmp(t);
  for (const bad of [
    { launches: -1, fallbacksUsed: 0 },
    { launches: 1, fallbacksUsed: 0.5 },
    { launches: 0, fallbacksUsed: 1 },
    { launches: 3, fallbacksUsed: 1 },
  ]) {
    fs.writeFileSync(file, JSON.stringify(bad));
    assert.equal(readLedger(file).reason, 'LEDGER_UNREADABLE');
  }
});

test('B46: wrong item or worktree fails closed as LEDGER_UNREADABLE', (t) => {
  const file = tmp(t);
  fs.writeFileSync(
    file,
    JSON.stringify({ launches: 1, fallbacksUsed: 0, item: 'TASK-171', worktree: '/path/a' })
  );
  assert.equal(readLedger(file, { item: 'TASK-999' }).reason, 'LEDGER_UNREADABLE');
  assert.equal(readLedger(file, { worktree: '/path/b' }).reason, 'LEDGER_UNREADABLE');
  assert.equal(readLedger(file, { item: 'TASK-171', worktree: '/path/a' }).ok, true);
});

test('B46: unknown version fails closed as LEDGER_UNREADABLE', () => {
  assert.equal(validateLedger({ version: 2 }).reason, 'LEDGER_UNREADABLE');
  assert.equal(validateLedger({ schemaVersion: 99 }).reason, 'LEDGER_UNREADABLE');
  assert.equal(validateLedger({ version: '1' }).reason, 'LEDGER_UNREADABLE');
  assert.equal(validateLedger({ version: LEDGER_SCHEMA_VERSION }).ok, true);
});

test('B46: atomic save writes via tmp and rename, survives simulated rename failure', (t) => {
  const file = tmp(t);
  const initial = { launches: 1, fallbacksUsed: 0 };
  saveLedger(file, initial);
  assert.deepEqual(readLedger(file).ledger, { ...initial, version: LEDGER_SCHEMA_VERSION });

  const origRename = fs.renameSync;
  t.after(() => {
    fs.renameSync = origRename;
  });
  fs.renameSync = () => {
    throw new Error('SIMULATED_RENAME_CRASH');
  };
  assert.throws(
    () => saveLedger(file, { launches: 2, fallbacksUsed: 1 }),
    /SIMULATED_RENAME_CRASH/
  );

  fs.renameSync = origRename;
  const recovered = readLedger(file);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.ledger.launches, 1);
});

// ── B49: Pre-spawn persistence and ordering ──────────────────────────────

test('B49: recordLaunchIntent writes launch count and activeWorker in one record', (t) => {
  const file = tmp(t);
  const ledger = {};
  recordLaunchIntent(
    ledger,
    { offeringId: 'o1', upstream: 'u1', tag: 'TAG-1', item: 'T1', worktree: '/w' },
    file
  );
  assert.equal(ledger.launches, 1);
  assert.equal(ledger.fallbacksUsed, 0);
  assert.deepEqual(ledger.activeWorker, { offeringId: 'o1', upstream: 'u1', tag: 'TAG-1' });

  const disk = readLedger(file);
  assert.equal(disk.ok, true);
  assert.equal(disk.ledger.launches, 1);
  assert.equal(disk.ledger.activeWorker.tag, 'TAG-1');
  assert.equal(disk.ledger.version, LEDGER_SCHEMA_VERSION);
});

test('B49: crash before write leaves ledger unchanged', (t) => {
  const file = tmp(t);
  saveLedger(file, { launches: 1, fallbacksUsed: 0 });
  const disk = readLedger(file);
  assert.equal(disk.ledger.launches, 1);
  assert.equal(disk.ledger.activeWorker, undefined);
});

test('B49: crash after write but before spawn keeps launch counted and worker known', (t) => {
  const file = tmp(t);
  recordLaunchIntent({}, { offeringId: 'o1', upstream: 'u1', tag: 'TAG-CRASH' }, file);
  const reloaded = readLedger(file);
  assert.equal(reloaded.ok, true);
  assert.equal(reloaded.ledger.launches, 1);
  assert.deepEqual(restartAction(reloaded.ledger), {
    action: 'STOP_WORKER',
    active: { offeringId: 'o1', upstream: 'u1', tag: 'TAG-CRASH' },
    note: 'interrupted worker found on restart',
  });
});

test('B49: launch throws leaves launch counted and enables afterFailure recovery', (t) => {
  const file = tmp(t);
  recordLaunchIntent({}, { offeringId: 'o1', upstream: 'u1', tag: 'TAG-THROW' }, file);

  const reloaded = readLedger(file).ledger;
  assert.equal(reloaded.launches, 1);
  assert.equal(reloaded.activeWorker.tag, 'TAG-THROW');
  delete reloaded.activeWorker;
  reloaded.failures = [{ offeringId: 'o1', class: 'LAUNCH_FAILED', message: 'SPAWN_ENOENT' }];
  saveLedger(file, reloaded);

  const after = readLedger(file).ledger;
  assert.equal(after.launches, 1);
  assert.equal(after.failures[0].class, 'LAUNCH_FAILED');
  assert.equal(after.activeWorker, undefined);
});

test('B48+B49: restartAction handles stopped, active worker, ceiling, and fresh ledger', () => {
  assert.equal(restartAction({ stopped: 'DONE' }).action, 'STOP');
  assert.equal(restartAction({ activeWorker: { tag: 'T' } }).action, 'STOP_WORKER');
  assert.equal(restartAction({ active: { tag: 'T' } }).action, 'STOP_WORKER');
  assert.equal(restartAction({ launches: 1 }).action, 'STOP');
  assert.equal(restartAction({}).action, 'FRESH');
});

// ── C6: Compatibility for legacy "active" field ─────────────────────────

test('C6: readLedger migrates legacy active to activeWorker and saveLedger writes only activeWorker', (t) => {
  const file = tmp(t);
  fs.writeFileSync(
    file,
    JSON.stringify({
      launches: 1,
      fallbacksUsed: 0,
      active: { offeringId: 'leg-1', tag: 'T-LEGACY' },
    })
  );
  const read = readLedger(file);
  assert.equal(read.ok, true);
  assert.equal(read.ledger.activeWorker.tag, 'T-LEGACY');
  assert.equal(read.ledger.active, undefined);

  saveLedger(file, read.ledger);
  const rawWritten = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(rawWritten.active, undefined);
  assert.equal(rawWritten.activeWorker.tag, 'T-LEGACY');
  assert.equal(rawWritten.version, LEDGER_SCHEMA_VERSION);
});

test('C6: route-handoff firstLaunch and afterFailure guard legacy active field', () => {
  const decision = { workItemId: 'TASK-1', candidates: [{ offeringId: 'a' }] };
  const ticket = { workItemId: 'TASK-1', maxFallbacks: 1 };

  const blocked = firstLaunch(decision, ticket, { ledger: { active: { tag: 'LEGACY-TAG' } } });
  assert.equal(blocked.action, 'BLOCKED');
  assert.equal(blocked.reason, 'WORKER_STILL_ACTIVE');

  const ctx = { ledger: { active: { offeringId: 'other', tag: 'LEGACY-TAG' }, worktree: '/w' } };
  const stopped = afterFailure(decision, ticket, ctx, {
    offeringId: 'a',
    phase: 'after-launch',
    workerStopped: true,
  });
  assert.equal(stopped.action, 'STOP');
  assert.equal(stopped.reason, 'WORKER_STILL_ACTIVE');
  assert.equal(ctx.ledger.active.tag, 'LEGACY-TAG');

  const ctx2 = { ledger: { active: { offeringId: 'a', tag: 'LEGACY-TAG' }, worktree: '/w' } };
  afterFailure(decision, ticket, ctx2, {
    offeringId: 'a',
    phase: 'after-launch',
    workerStopped: true,
  });
  assert.equal(ctx2.ledger.active, undefined);
});
