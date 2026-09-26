'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessProgress, evaluateProgress, DEFAULT_WINDOW_MS } = require('../executor');

test('forward motion diffChanged => ALIVE', () => {
  const verdict = assessProgress(null, { diffChanged: true });
  assert.strictEqual(verdict, 'ALIVE');
});

test('forward motion logGrew without error => ALIVE', () => {
  const verdict = assessProgress({ diffChanged: false }, { logGrew: true });
  assert.strictEqual(verdict, 'ALIVE');
});

test('repeating same error => STALLED', () => {
  const prev = { error: 'Unavailable (reset after 151h)' };
  const curr = { error: 'Unavailable (reset after 151h)' };
  const verdict = assessProgress(prev, curr);
  assert.strictEqual(verdict, 'STALLED');
  assert.strictEqual(curr.cause, 'Unavailable (reset after 151h)');
});

test('a session whose log grows but whose worktree never changes and which only repeats one retry error is STALLED', () => {
  const prev = {
    error: 'Unavailable (reset after 151h)',
    headSha: 'c0ffee',
    logSize: 100,
  };
  const curr = {
    diffChanged: false,
    commitChanged: false,
    testRan: false,
    checkpointWritten: false,
    logGrew: true,
    error: 'Unavailable (reset after 151h)',
  };
  const res = evaluateProgress(prev, curr);
  assert.strictEqual(res.verdict, 'STALLED');
  assert.strictEqual(res.cause, 'Unavailable (reset after 151h)');
  assert.strictEqual(assessProgress(prev, curr), 'STALLED');
  assert.strictEqual(curr.cause, 'Unavailable (reset after 151h)');
});

test('a session that produces a diff within the window is alive', () => {
  const prev = {
    timestamp: 1000,
    lastProgressAt: 1000,
  };
  const curr = {
    timestamp: 3000,
    diffChanged: true,
  };
  const res = evaluateProgress(prev, curr, { windowMs: 10000 });
  assert.strictEqual(res.verdict, 'ALIVE');
  assert.strictEqual(assessProgress(prev, curr, { windowMs: 10000 }), 'ALIVE');
});

test('a session with no measurable signal is unknown, not alive', () => {
  const prev = {};
  const curr = {};
  const res = evaluateProgress(prev, curr);
  assert.strictEqual(res.verdict, 'UNKNOWN');
  assert.notStrictEqual(res.verdict, 'ALIVE');
  assert.strictEqual(assessProgress(prev, curr), 'UNKNOWN');
});

test('one progress signal resets the window', () => {
  const windowMs = 5000;
  // Step 1: Initial progress at t=0
  const snap1 = { timestamp: 0, diffChanged: true };
  const res1 = evaluateProgress(null, snap1, { windowMs, now: 0 });
  assert.strictEqual(res1.verdict, 'ALIVE');
  assert.strictEqual(res1.lastProgressAt, 0);

  // Step 2: At t=6000 (exceeded windowMs of 5000 with no progress), session is STALLED
  const snap2 = { timestamp: 6000, diffChanged: false };
  const res2 = evaluateProgress(res1, snap2, { windowMs, now: 6000 });
  assert.strictEqual(res2.verdict, 'STALLED');
  assert.match(res2.cause, /NO_PROGRESS_ACROSS_WINDOW/);

  // Step 3: One progress signal arrives at t=7000 (diffChanged: true) -> resets window
  const snap3 = { timestamp: 7000, diffChanged: true };
  const res3 = evaluateProgress(res2, snap3, { windowMs, now: 7000 });
  assert.strictEqual(res3.verdict, 'ALIVE');
  assert.strictEqual(res3.lastProgressAt, 7000);

  // Step 4: At t=9000 (2000ms after snap3, within 5000ms window), session is not stalled
  const snap4 = { timestamp: 9000, diffChanged: false, logGrew: false };
  const res4 = evaluateProgress(res3, snap4, { windowMs, now: 9000 });
  assert.notStrictEqual(res4.verdict, 'STALLED');
});

test('different error => UNKNOWN', () => {
  const prev = { error: 'first' };
  const curr = { error: 'second' };
  const verdict = assessProgress(prev, curr);
  assert.strictEqual(verdict, 'UNKNOWN');
});

test('no forward flags and no error repeat => UNKNOWN', () => {
  const prev = {};
  const curr = {};
  const verdict = assessProgress(prev, curr);
  assert.strictEqual(verdict, 'UNKNOWN');
});

test('progress window defaults to 10 minutes with stated rationale', () => {
  assert.strictEqual(DEFAULT_WINDOW_MS, 600000);
});
