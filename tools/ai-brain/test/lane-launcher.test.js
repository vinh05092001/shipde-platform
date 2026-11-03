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

test('2 job tranh 1 lane -> 1 bị từ chối, bỏ skipLock', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const res1 = launch(dir, { name: 'job-1' });
  assert.strictEqual(res1.ok, true);
  assert.ok(res1.job.jobId);
  assert.ok(res1.job.attemptId);

  const res2 = launch(dir, { name: 'job-2' });
  assert.strictEqual(res2.ok, false);

  // skipLock đã bị loại bỏ -> vẫn bị từ chối
  const res3 = launch(dir, { name: 'job-3' }, { skipLock: true });
  assert.strictEqual(res3.ok, false);

  // kiểm tra pid > 0 được bảo đảm không bị bypass kể cả khi truyền skipLock: true
  const dirPid = makeTempLane();
  t.after(() => fs.rmSync(dirPid, { recursive: true, force: true }));
  assert.throws(
    () => launch(dirPid, { name: 'job-4' }, { pid: 0, skipLock: true }),
    /positive pid required/
  );
  assert.throws(
    () => launch(dirPid, { name: 'job-5' }, { pid: -1, skipLock: true }),
    /positive pid required/
  );
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

test('cleanup không đụng pid job khác, chỉ kill khi jobId lưu trong lane khớp', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const killed = [];
  const mockKill = (pid) => killed.push(pid);

  // lane đang lưu jobA
  const jobA = { jobId: 'job-A', pidTree: [100, 101, 102] };
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(jobA, null, 2));

  // cleanup với jobB khác jobId -> không kill gì
  const jobB = { jobId: 'job-B', pidTree: [200, 201] };
  const resB = cleanup(dir, jobB, { kill: mockKill });
  assert.strictEqual(resB.ok, false);
  assert.deepStrictEqual(resB.killed, []);
  assert.deepStrictEqual(killed, []);

  // cleanup với jobA khớp jobId -> dùng pidTree đã lưu trong lane
  const resA = cleanup(dir, jobA, { kill: mockKill });
  assert.strictEqual(resA.ok, true);
  assert.deepStrictEqual(resA.killed, [100, 101, 102]);
  assert.deepStrictEqual(killed, [100, 101, 102]);
  assert.strictEqual(killed.includes(200), false);
  assert.strictEqual(killed.includes(201), false);
});

test('stderr không còn chuỗi key (regex key/token/Bearer), lưu exitCode, durationMs, logPath', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Test che JSON {"api_key":"secret","token":"secret"}
  const jsonDirty = '{"api_key":"secret","token":"secret"}';
  const savedJson = saveResult(
    dir,
    { jobId: 'job-json' },
    {
      stderr: jsonDirty,
    }
  );
  assert.strictEqual(savedJson.stderr.includes('secret'), false);
  assert.strictEqual(savedJson.stderr, '[REDACTED LINE: credential]');

  const dirty =
    'Error: Bearer secret-tok-999; api_key="secret-key-888"; token=tok-777; --key=key-666';
  const saved = saveResult(
    dir,
    { jobId: 'job-secure' },
    {
      exitCode: 7,
      stderr: dirty,
      durationMs: 350,
      logPath: '/tmp/job.log',
    }
  );

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

test('relaunch cùng object job cũ -> ID khác, result cũ bị bỏ', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const l1 = launch(dir, { name: 'relaunch-task' });
  assert.strictEqual(l1.ok, true);
  saveResult(dir, l1.job, { exitCode: 0, stderr: '' });
  releaseLaneLock(dir, l1.job);

  // relaunch cùng object job cũ
  const l2 = launch(dir, l1.job);
  assert.strictEqual(l2.ok, true);
  assert.notStrictEqual(l2.job.jobId, l1.job.jobId);
  assert.notStrictEqual(l2.job.attemptId, l1.job.attemptId);

  // result cũ bị bỏ vì jobId không khớp
  const oldResult = readResult(dir, l2.job);
  assert.strictEqual(oldResult, null);
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

test('redacts-comma-containing-unquoted-api-key', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const job = { jobId: 'job-unquoted-comma-key' };
  const rawStderr = 'api_key=FAKE_PREFIX,FAKE_SUFFIX';
  const saved = saveResult(dir, job, { stderr: rawStderr });

  assert.strictEqual(saved.stderr.includes('FAKE_PREFIX'), false);
  assert.strictEqual(saved.stderr.includes('FAKE_SUFFIX'), false);

  const persisted = readResult(dir, job);
  assert.ok(persisted);
  assert.strictEqual(persisted.stderr.includes('FAKE_PREFIX'), false);
  assert.strictEqual(persisted.stderr.includes('FAKE_SUFFIX'), false);
});

test('cleanup-rejects-supplied-job-without-jobId', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const killed = [];
  let killCalled = false;
  const mockKill = (pid) => {
    killCalled = true;
    killed.push(pid);
  };

  const jobA = { jobId: 'job-A', pidTree: [100, 101] };
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(jobA, null, 2));

  const jobB = { name: 'job-B', pidTree: [200] };
  const res = cleanup(dir, jobB, { kill: mockKill });

  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.killed, []);
  assert.strictEqual(killCalled, false);
});

test('redacts-following-quoted-token-after-unquoted-key', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const job = { jobId: 'job-A' };
  const rawStderr = 'api_key=FAKE_FIRST,token="FAKE_SECOND"';
  const saved = saveResult(dir, job, { stderr: rawStderr });

  assert.strictEqual(saved.stderr.includes('FAKE_FIRST'), false);
  assert.strictEqual(saved.stderr.includes('FAKE_SECOND'), false);
  assert.strictEqual(saved.stderr, '[REDACTED LINE: credential]');

  const persisted = readResult(dir, job);
  assert.ok(persisted);
  assert.strictEqual(persisted.stderr.includes('FAKE_FIRST'), false);
  assert.strictEqual(persisted.stderr.includes('FAKE_SECOND'), false);
  assert.strictEqual(persisted.stderr, '[REDACTED LINE: credential]');
});

test('cleanup-rejects-empty-job-identifier', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const killed = [];
  let killCalled = false;
  const mockKill = (pid) => {
    killCalled = true;
    killed.push(pid);
  };

  const jobA = { jobId: 'job-A', pidTree: [100, 101] };
  fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(jobA, null, 2));

  const resEmptyStr = cleanup(dir, '', { kill: mockKill });
  assert.strictEqual(resEmptyStr.ok, false);
  assert.strictEqual(resEmptyStr.cause, 'JOB_MISMATCH');
  assert.deepStrictEqual(resEmptyStr.killed, []);
  assert.strictEqual(killCalled, false);

  const resEmptyObj = cleanup(dir, { jobId: '' }, { kill: mockKill });
  assert.strictEqual(resEmptyObj.ok, false);
  assert.strictEqual(resEmptyObj.cause, 'JOB_MISMATCH');
  assert.deepStrictEqual(resEmptyObj.killed, []);
  assert.strictEqual(killCalled, false);
  assert.deepStrictEqual(killed, []);
});

test('redactStderr replaces only lines containing credentials, preserves safe lines', (t) => {
  const dir = makeTempLane();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const job = { jobId: 'job-multiline' };
  const rawStderr = [
    'INFO: process started successfully',
    'DEBUG: api_key=super_secret_123 in config',
    'WARN: high memory usage detected',
    'ERROR: token="another_secret_456" expired',
    'INFO: process terminating normally',
  ].join('\n');

  const saved = saveResult(dir, job, { stderr: rawStderr });
  assert.strictEqual(saved.stderr.includes('super_secret_123'), false);
  assert.strictEqual(saved.stderr.includes('another_secret_456'), false);
  assert.strictEqual(saved.stderr.includes('INFO: process started successfully'), true);
  assert.strictEqual(saved.stderr.includes('WARN: high memory usage detected'), true);
  assert.strictEqual(saved.stderr.includes('INFO: process terminating normally'), true);

  const expected = [
    'INFO: process started successfully',
    '[REDACTED LINE: credential]',
    'WARN: high memory usage detected',
    '[REDACTED LINE: credential]',
    'INFO: process terminating normally',
  ].join('\n');
  assert.strictEqual(saved.stderr, expected);
});
