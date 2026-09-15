/**
 * Ship Dễ — Quota Refresher Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');

const { startQuotaRefresher } = require('../quota-refresher');

/** A stand-in child process whose exit this test controls. */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

function harness(overrides) {
  const children = [];
  const refresher = startQuotaRefresher(
    Object.assign(
      {
        runImmediately: false,
        spawn: () => {
          const c = fakeChild();
          children.push(c);
          return c;
        },
      },
      overrides
    )
  );
  return { refresher, children };
}

describe('Running the refresh', () => {
  test('a successful run is recorded', () => {
    const { refresher, children } = harness();
    refresher.runOnce();
    children[0].stdout.emit('data', 'ĐỌC ĐƯỢC agy-native-a');
    children[0].emit('close', 0);

    const last = refresher.lastResult();
    assert.equal(last.ok, true);
    assert.match(last.output, /ĐỌC ĐƯỢC/);
    refresher.stop();
  });

  test('a failing run keeps its output', () => {
    // Otherwise a broken refresh is only visible in whatever terminal happened
    // to be open when it broke.
    const { refresher, children } = harness();
    refresher.runOnce();
    children[0].stderr.emit('data', 'docker: không chạy');
    children[0].emit('close', 1);

    assert.equal(refresher.lastResult().ok, false);
    assert.match(refresher.lastResult().output, /docker/);
    refresher.stop();
  });

  test('a spawn that never starts is a failure, not a hang', () => {
    const { refresher, children } = harness();
    refresher.runOnce();
    children[0].emit('error', new Error('node không tìm thấy'));
    assert.equal(refresher.lastResult().ok, false);
    assert.match(refresher.lastResult().error, /không tìm thấy/);
    refresher.stop();
  });
});

describe('Never stacking two runs', () => {
  test('a second run while one is in flight is skipped', () => {
    // Both would ask the same CLI the same question, and the slow one here is
    // a container start that can outlast its own interval.
    const { refresher, children } = harness();
    refresher.runOnce();
    assert.equal(refresher.isRunning(), true);
    assert.equal(refresher.runOnce(), null);
    assert.equal(children.length, 1);
    refresher.stop();
  });

  test('the next run proceeds once the first finishes', () => {
    const { refresher, children } = harness();
    refresher.runOnce();
    children[0].emit('close', 0);
    assert.equal(refresher.isRunning(), false);
    refresher.runOnce();
    assert.equal(children.length, 2);
    refresher.stop();
  });

  test('a run that overruns its timeout is killed and released', () => {
    const { refresher, children } = harness({ timeoutMs: 1 });
    refresher.runOnce();
    return new Promise((resolve) => {
      setTimeout(() => {
        assert.equal(children[0].killed, true);
        children[0].emit('close', null);
        assert.equal(refresher.isRunning(), false);
        refresher.stop();
        resolve();
      }, 20);
    });
  });
});

describe('Scheduling', () => {
  test('the first refresh can run at startup', () => {
    const { refresher, children } = harness({ runImmediately: true });
    assert.equal(children.length, 1);
    refresher.stop();
  });

  test('the interval fires further runs', () => {
    const { refresher, children } = harness({ intervalMs: 5 });
    return new Promise((resolve) => {
      setTimeout(() => {
        assert.ok(children.length >= 1);
        refresher.stop();
        resolve();
      }, 30);
    });
  });
});
