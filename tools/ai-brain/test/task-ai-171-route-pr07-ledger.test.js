'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
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

const cand = { offeringId: 'c1', harness: 'paseo', gateway: 'gw', upstream: 'up', modelId: 'm1' };
const dec = { workItemId: 'TASK-171', selected: 'c1', candidates: [cand] };
const tkt = {
  workItemId: 'TASK-171',
  outputTokens: 100,
  minProof: 'HARNESS_PASS',
  maxFallbacks: 1,
  request: { cwd: '/w', branch: 'b', prompt: 'p' },
};
const ev = {
  combinations: [
    {
      harness: 'paseo',
      modelId: 'm1',
      gateway: 'gw',
      upstream: 'up',
      evidence: [{ status: 'passed', proofLevel: 'HARNESS_PASS' }],
    },
  ],
};
const reg = {
  sources: [{ id: 'gw', kind: 'agent-cli' }],
  dispatch: {
    providers: { gw: { harness: 'paseo', provider: 'opencode' } },
    launchModes: { opencode: ['full-access'] },
  },
};
const fail = (offeringId = 'c1', extra = {}) => ({
  offeringId,
  phase: 'after-launch',
  workerStopped: true,
  ...extra,
});

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

test('B46: inconsistent counters and conflicting aliases fail closed as LEDGER_UNREADABLE', (t) => {
  const file = tmp(t);
  for (const bad of [
    { launches: -1, fallbacksUsed: 0 },
    { launches: 1, fallbacksUsed: 0.5 },
    { launches: 0, fallbacksUsed: 1 },
    { launches: 3, fallbacksUsed: 1 },
    { version: 1, schemaVersion: 99, launches: 1, fallbacksUsed: 0 },
    { version: 1, launches: 1, fallbacksUsed: 0, item: 'A', workItemId: 'B' },
    {
      version: 1,
      launches: 1,
      fallbacksUsed: 0,
      active: { tag: 'W1' },
      activeWorker: { tag: 'W2' },
    },
  ]) {
    const originalContent = JSON.stringify(bad, null, 2);
    fs.writeFileSync(file, originalContent);
    assert.equal(readLedger(file).reason, 'LEDGER_UNREADABLE');
    assert.equal(fs.readFileSync(file, 'utf8'), originalContent);
  }
});

test('B46: wrong or missing item or worktree fails closed as LEDGER_UNREADABLE', (t) => {
  const file = tmp(t);
  fs.writeFileSync(
    file,
    JSON.stringify({ launches: 1, fallbacksUsed: 0, item: 'TASK-171', worktree: '/path/a' })
  );
  assert.equal(readLedger(file, { item: 'TASK-999' }).reason, 'LEDGER_UNREADABLE');
  assert.equal(readLedger(file, { worktree: '/path/b' }).reason, 'LEDGER_UNREADABLE');
  assert.equal(readLedger(file, { item: 'TASK-171', worktree: '/path/a' }).ok, true);

  const file2 = tmp(t);
  fs.writeFileSync(file2, JSON.stringify({ launches: 1, fallbacksUsed: 0 }));
  assert.equal(readLedger(file2, { item: 'TASK-171' }).reason, 'LEDGER_UNREADABLE');
  assert.equal(readLedger(file2, { worktree: '/path/a' }).reason, 'LEDGER_UNREADABLE');
});

test('B46: unknown version or missing counters fail closed as LEDGER_UNREADABLE', (t) => {
  assert.equal(validateLedger({ version: 2 }).reason, 'LEDGER_UNREADABLE');
  assert.equal(validateLedger({ schemaVersion: 99 }).reason, 'LEDGER_UNREADABLE');
  assert.equal(validateLedger({ version: '1' }).reason, 'LEDGER_UNREADABLE');
  assert.equal(validateLedger({ version: LEDGER_SCHEMA_VERSION }).reason, 'LEDGER_UNREADABLE');
  assert.equal(
    validateLedger({ version: LEDGER_SCHEMA_VERSION, launches: 1, fallbacksUsed: 0 }).ok,
    true
  );

  const file1 = tmp(t);
  fs.writeFileSync(file1, JSON.stringify({ version: 1 }));
  assert.equal(readLedger(file1).reason, 'LEDGER_UNREADABLE');

  const fileEmpty = tmp(t);
  fs.writeFileSync(fileEmpty, '{}');
  assert.equal(readLedger(fileEmpty).reason, 'LEDGER_UNREADABLE');
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

test('B46: handoff entry points validate ledger and reject unreadable state', () => {
  const badLedgers = [
    undefined,
    null,
    { ok: false, reason: 'LEDGER_UNREADABLE' },
    { version: 99, launches: 1, fallbacksUsed: 0 },
    { version: 1, launches: -1, fallbacksUsed: 0 },
    { version: 1, launches: 3, fallbacksUsed: 1 },
  ];
  for (const bad of badLedgers) {
    const first = firstLaunch(dec, tkt, { ledger: bad }, reg);
    assert.equal(first.action, 'BLOCKED');
    assert.equal(first.reason, 'LEDGER_UNREADABLE');

    const stopped = afterFailure(dec, tkt, { ledger: bad, worktree: '/w' }, fail(), reg);
    assert.equal(stopped.action, 'STOP');
    assert.equal(stopped.reason, 'LEDGER_UNREADABLE');
  }
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

test('B49: failed intent write prevents spawn and leaves disk state unchanged', (t) => {
  const file = tmp(t);
  saveLedger(file, { launches: 1, fallbacksUsed: 0, item: 'TASK-171', worktree: '/w' });
  const origRename = fs.renameSync;
  t.after(() => {
    fs.renameSync = origRename;
  });

  let spawnCalled = false;
  fs.renameSync = () => {
    throw new Error('SIMULATED_RENAME_FAILURE');
  };
  assert.throws(
    () =>
      firstLaunch(
        dec,
        tkt,
        {
          ledger: { launches: 1, fallbacksUsed: 0, item: 'TASK-171', worktree: '/w' },
          ledgerFile: file,
          evidenceData: ev,
          launcher: () => {
            spawnCalled = true;
          },
        },
        reg
      ),
    /SIMULATED_RENAME_FAILURE/
  );
  assert.equal(spawnCalled, false);
  fs.renameSync = origRename;

  const disk = readLedger(file);
  assert.equal(disk.ledger.launches, 1);
  assert.equal(disk.ledger.activeWorker, undefined);
});

test('B49: intent rename precedes spawn, and caller contract drives real spawn execution', (t) => {
  const file = tmp(t);
  const sequence = [];
  const origRename = fs.renameSync;
  t.after(() => {
    fs.renameSync = origRename;
  });

  fs.renameSync = (from, to) => {
    sequence.push('rename');
    origRename(from, to);
  };
  const launcher = () => {
    sequence.push('spawn');
    return cp.spawn(process.execPath, ['-e', 'process.exit(0)']);
  };

  const res = firstLaunch(
    dec,
    tkt,
    { ledger: {}, ledgerFile: file, evidenceData: ev, launcher },
    reg
  );
  assert.equal(res.action, 'LAUNCH');
  assert.deepEqual(sequence, ['rename', 'spawn']);
  assert.ok(res.run && res.run.pid);
  res.run.kill();

  const disk = readLedger(file);
  assert.equal(disk.ok, true);
  assert.equal(disk.ledger.launches, 1);
  assert.equal(disk.ledger.activeWorker.offeringId, 'c1');
  assert.deepEqual(restartAction(disk.ledger), {
    action: 'STOP_WORKER',
    active: disk.ledger.activeWorker,
    note: 'interrupted worker found on restart',
  });
});

test('B49: launch throws leaves launch counted and enables afterFailure recovery', (t) => {
  const file = tmp(t);
  const throwingLauncher = () => {
    const err = new Error('SPAWN_ENOENT');
    err.code = 'ENOENT';
    throw err;
  };

  assert.throws(
    () =>
      firstLaunch(
        dec,
        tkt,
        { ledger: {}, ledgerFile: file, evidenceData: ev, launcher: throwingLauncher },
        reg
      ),
    /SPAWN_ENOENT/
  );

  const disk = readLedger(file);
  assert.equal(disk.ok, true);
  assert.equal(disk.ledger.launches, 1);
  assert.equal(disk.ledger.activeWorker.offeringId, 'c1');
  assert.ok(disk.ledger.activeWorker.tag.startsWith('TASK-171-'));

  const recovered = afterFailure(
    dec,
    tkt,
    { ledger: disk.ledger, ledgerFile: file, evidenceData: ev },
    fail('c1', { message: 'SPAWN_ENOENT' }),
    reg
  );
  assert.equal(recovered.worktree, '/w');
  const diskAfter = readLedger(file);
  assert.equal(diskAfter.ledger.launches, 1);
  assert.equal(diskAfter.ledger.failures[0].class, 'UNAVAILABLE_NOW');
  assert.equal(diskAfter.ledger.activeWorker, undefined);
});

test('B48+B49: restartAction handles stopped, active worker, ceiling, and fresh ledger', () => {
  assert.equal(restartAction({ stopped: 'DONE' }).action, 'STOP');
  assert.equal(
    restartAction({ stopped: 'FALLBACK_LIMIT', activeWorker: { tag: 'T' } }).action,
    'STOP_WORKER'
  );
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
