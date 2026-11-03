'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  launch,
  acquireLaneLock,
  releaseLaneLock,
  readResult,
  saveResult,
  cleanup,
} = require('../lane-launcher');

function makeTempLane() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lane-launcher-test-'));
}

test('2 job tranh 1 lane -> 1 bị từ chối', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const res1 = launch(dir, { name: 'job-1' });
  assert.strictEqual(res1.ok, true);
  assert.ok(res1.job.jobId);
  assert.ok(res1.job.attemptId);

  const res2 = launch(dir, { name: 'job-2' });
  assert.strictEqual(res2.ok, false);
});

test('result job cũ bị bỏ', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const oldJob = { jobId: 'job-old-123' };
  saveResult(dir, oldJob, { exitCode: 0, stderr: '' });

  const newJob = { jobId: 'job-new-456' };
  const readMismatch = readResult(dir, newJob);
  assert.strictEqual(readMismatch, null);

  const readOld = readResult(dir, oldJob);
  assert.ok(readOld);
  assert.strictEqual(readOld.jobId, 'job-old-123');
});

test('owner chết -> chiếm qua thế hệ mới, chỉ owner release, không chiếm theo tuổi', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const alivePids = new Set([1001]);
  const lock1 = acquireLaneLock(
    dir,
    { jobId: 'job-1', pid: 1001 },
    { pidAlive: (p) => alivePids.has(p) }
  );
  assert.strictEqual(lock1.ok, true);
  assert.strictEqual(lock1.owner.gen, 1);

  // Live holder prevents stealing, regardless of age
  const blocked = acquireLaneLock(
    dir,
    { jobId: 'job-2', pid: 1002 },
    { pidAlive: (p) => alivePids.has(p) }
  );
  assert.strictEqual(blocked.ok, false);

  // Non-owner release refused
  const badRel = releaseLaneLock(dir, { jobId: 'wrong-owner' });
  assert.strictEqual(badRel.ok, false);

  // Owner 1 dies -> Contender acquires generation 2
  alivePids.delete(1001);
  alivePids.add(1002);
  const lock2 = acquireLaneLock(
    dir,
    { jobId: 'job-2', pid: 1002 },
    { pidAlive: (p) => alivePids.has(p) }
  );
  assert.strictEqual(lock2.ok, true);
  assert.strictEqual(lock2.owner.gen, 2);

  // Owner 2 can release
  const goodRel = releaseLaneLock(dir, lock2.owner);
  assert.strictEqual(goodRel.ok, true);
});

test('cleanup không đụng pid job khác', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const killed = [];
  const mockKill = (pid) => killed.push(pid);

  const jobA = { jobId: 'job-A', pidTree: [100, 101, 102] };
  const jobB = { jobId: 'job-B', pidTree: [200, 201] };

  cleanup(dir, jobA, { kill: mockKill });
  assert.deepStrictEqual(killed, [100, 101, 102]);
  assert.strictEqual(killed.includes(200), false);
  assert.strictEqual(killed.includes(201), false);
});

test('stderr không còn chuỗi key (regex key/token/Bearer), lưu exitCode, durationMs, logPath', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const dirty = 'Error: Bearer secret-tok-999; api_key="secret-key-888"; token=tok-777; --key=key-666';
  const saved = saveResult(dir, { jobId: 'job-secure' }, {
    exitCode: 7,
    stderr: dirty,
    durationMs: 350,
    logPath: '/tmp/job.log',
  });

  assert.strictEqual(saved.exitCode, 7);
  assert.strictEqual(saved.durationMs, 350);
  assert.strictEqual(saved.logPath, '/tmp/job.log');
  assert.strictEqual(saved.stderr.includes('secret-tok-999'), false);
  assert.strictEqual(saved.stderr.includes('secret-key-888'), false);
  assert.strictEqual(saved.stderr.includes('tok-777'), false);
  assert.strictEqual(saved.stderr.includes('key-666'), false);

  const read = readResult(dir, { jobId: 'job-secure' });
  assert.strictEqual(read.stderr, saved.stderr);
});

test('launch cho phép job mới khi job cũ đã có result và lock giải phóng', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const l1 = launch(dir, { name: 'first' });
  assert.strictEqual(l1.ok, true);

  saveResult(dir, l1.job, { exitCode: 0 });
  releaseLaneLock(dir, l1.job);

  const l2 = launch(dir, { name: 'second' });
  assert.strictEqual(l2.ok, true);
  assert.notStrictEqual(l2.job.jobId, l1.job.jobId);
});
