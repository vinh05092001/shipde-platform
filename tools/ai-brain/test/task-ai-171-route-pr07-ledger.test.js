'use strict';

// TASK-AI-171 Route PR 07 — the fallback ceiling survives crashes and restarts (rows B46, B49, C6).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ledgerMod = require('../coordinator-ledger');

const { readLedger, saveLedger, launchFirst, launchAfterFailure, SCHEMA_VERSION } = ledgerMod;

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pr07-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const file = path.join(cwd, 'ledger.json');
  const candidates = ['a', 'b', 'c'].map((id) => ({
    offeringId: id,
    modelId: 'fake/' + id,
    upstream: id,
    gateway: 'fake-gateway',
    accountId: id,
    harness: 'paseo',
  }));
  const registry = {
    sources: [],
    dispatch: {
      providers: { 'fake-gateway': { harness: 'paseo', provider: 'opencode' } },
      launchModes: { opencode: ['full-access', 'plan'] },
    },
  };
  const decision = { workItemId: 'TASK-AI-171', selected: 'a', candidates };
  const ticket = {
    workItemId: 'TASK-AI-171',
    outputTokens: 100,
    minProof: 'HARNESS_PASS',
    maxFallbacks: 1,
    request: { cwd, branch: 'fake-branch', prompt: 'fake ticket' },
  };
  const context = {
    evidenceData: {
      combinations: candidates.map((c) => ({
        ...c,
        evidence: [{ status: 'passed', proofLevel: 'HARNESS_PASS' }],
      })),
    },
  };
  const spawned = [];
  let n = 0;
  const deps = {
    registry,
    context,
    tag: () => `run-${++n}`,
    spawn: (launch, meta) => {
      // the receipt must already be on disk when spawn is called
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
      spawned.push({ launch, meta, onDisk });
      return { pid: 1000 + spawned.length };
    },
  };
  const expect = { item: 'TASK-AI-171', worktree: cwd };
  const valid = (over) => ({
    version: SCHEMA_VERSION,
    item: 'TASK-AI-171',
    worktree: cwd,
    launches: 0,
    fallbacksUsed: 0,
    failures: [],
    activeWorker: null,
    stopped: null,
    ...over,
  });
  const write = (v) => fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v));
  const failure = (id, status) => ({
    offeringId: id,
    upstream: id,
    status,
    phase: 'after-launch',
    worktree: cwd,
    workerStopped: true,
  });
  return { cwd, file, decision, ticket, deps, spawned, expect, valid, write, failure };
}

test('missing file is a fresh ticket; invalid files are unreadable and never reset the budget', (t) => {
  const f = fixture(t);
  assert.equal(readLedger(f.file, f.expect).ok, true);
  const cases = {
    truncated: '{"version":1,"item":"TASK',
    emptyObject: {},
    versionOnly: { version: 1 },
    unknownVersion: f.valid({ version: 2 }),
    missingCounters: f.valid({ launches: undefined }),
    fallbackAboveLaunches: f.valid({ launches: 1, fallbacksUsed: 1 }),
    wrongItem: f.valid({ item: 'TASK-AI-999' }),
    wrongWorktree: f.valid({ worktree: path.join(f.cwd, 'other') }),
    conflictingVersionAlias: { ...f.valid(), schemaVersion: 99 },
    conflictingItemAlias: { ...f.valid(), workItemId: 'TASK-AI-999' },
    conflictingWorkerAlias: f.valid({ activeWorker: { tag: 'x' }, active: { tag: 'y' } }),
  };
  for (const [name, value] of Object.entries(cases)) {
    f.write(value);
    assert.deepEqual(
      readLedger(f.file, f.expect),
      { ok: false, reason: 'LEDGER_UNREADABLE' },
      name
    );
    const out = launchFirst(f.file, f.decision, f.ticket, f.deps);
    assert.equal(out.action, 'BLOCKED', name);
    assert.equal(f.spawned.length, 0, `${name}: nothing spawned`);
  }
});

test('old "active" migrates to activeWorker; agreeing aliases in any key order are accepted', (t) => {
  const f = fixture(t);
  const legacy = f.valid({ launches: 1 });
  delete legacy.activeWorker;
  legacy.active = { tag: 'run-old', offeringId: 'a' };
  f.write(legacy);
  const read = readLedger(f.file, f.expect);
  assert.equal(read.ok, true);
  assert.deepEqual(read.ledger.activeWorker, { tag: 'run-old', offeringId: 'a' });
  assert.equal('active' in read.ledger, false);
  f.write({
    ...f.valid({ activeWorker: { tag: 't', offeringId: 'a' } }),
    active: { offeringId: 'a', tag: 't' },
  });
  assert.equal(readLedger(f.file, f.expect).ok, true);
});

test('save refuses a ledger its own validation rejects and writes atomically', (t) => {
  const f = fixture(t);
  assert.throws(() => saveLedger(f.file, f.valid({ launches: 0, fallbacksUsed: 1 }), f.expect));
  assert.equal(fs.existsSync(f.file), false);
  const io = {
    writeFileSync: fs.writeFileSync,
    renameSync: () => {
      throw new Error('crash at rename');
    },
  };
  f.write(f.valid());
  assert.throws(() => saveLedger(f.file, f.valid({ launches: 1 }), f.expect, io));
  assert.equal(
    readLedger(f.file, f.expect).ledger.launches,
    0,
    'old ledger intact after a crash at rename'
  );
});

test('launch intent is persisted before spawn; a failed write means no spawn', (t) => {
  const f = fixture(t);
  const out = launchFirst(f.file, f.decision, f.ticket, f.deps);
  assert.equal(out.action, 'LAUNCH');
  assert.equal(f.spawned.length, 1);
  assert.equal(f.spawned[0].onDisk.launches, 1);
  assert.equal(f.spawned[0].onDisk.activeWorker.tag, f.spawned[0].meta.tag);

  const g = fixture(t);
  const io = {
    readFileSync: fs.readFileSync,
    writeFileSync: () => {
      throw new Error('disk full');
    },
    renameSync: fs.renameSync,
  };
  assert.throws(() => launchFirst(g.file, g.decision, g.ticket, { ...g.deps, io }));
  assert.equal(g.spawned.length, 0, 'no receipt, no spawn');
});

test('restart: an interrupted worker blocks relaunch; a launch that throws keeps it counted', (t) => {
  const f = fixture(t);
  const throwing = {
    ...f.deps,
    spawn: () => {
      throw new Error('launcher crashed');
    },
  };
  assert.throws(() => launchFirst(f.file, f.decision, f.ticket, throwing));
  const after = readLedger(f.file, f.expect).ledger;
  assert.equal(after.launches, 1, 'the attempt stays counted');
  assert.ok(after.activeWorker, 'the possibly-running worker stays known');
  const again = launchFirst(f.file, f.decision, f.ticket, f.deps);
  assert.deepEqual([again.action, again.reason], ['BLOCKED', 'STOP_WORKER']);
  assert.equal(f.spawned.length, 0);
});

test('the fallback ceiling holds across a restart between failure and relaunch', (t) => {
  const f = fixture(t);
  assert.equal(launchFirst(f.file, f.decision, f.ticket, f.deps).action, 'LAUNCH');
  const second = launchAfterFailure(f.file, f.decision, f.ticket, f.failure('a', 429), f.deps);
  assert.equal(second.action, 'LAUNCH');
  const mid = readLedger(f.file, f.expect).ledger;
  assert.deepEqual([mid.launches, mid.fallbacksUsed], [2, 1]);
  // coordinator restarts here: only the file survives
  const third = launchAfterFailure(f.file, f.decision, f.ticket, f.failure('b', 402), f.deps);
  assert.deepEqual([third.action, third.reason], ['STOP', 'FALLBACK_LIMIT']);
  const end = readLedger(f.file, f.expect).ledger;
  assert.deepEqual([end.launches, end.stopped, end.activeWorker], [2, 'FALLBACK_LIMIT', null]);
  assert.equal(f.spawned.length, 2);
  assert.equal(launchFirst(f.file, f.decision, f.ticket, f.deps).action, 'BLOCKED');
});
