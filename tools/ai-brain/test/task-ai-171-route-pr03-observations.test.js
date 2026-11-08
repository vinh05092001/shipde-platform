'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scan = require('../scan-liveness');
const quota = require('../quota-scan');
const health = require('../route-health');
const { assembleForDispatch } = require('../cli');
beforeEach((t) => {
  const forbidden = () => assert.fail('offline observation adapter must not execute or fetch');
  t.mock.method(globalThis, 'fetch', forbidden);
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    t.mock.method(require('node:child_process'), name, forbidden);
  }
});
const at = '2026-11-08T00:00:00.000Z';
const row = (over = {}) => ({
  sourceId: 'fixture-gw',
  accountId: 'a',
  modelId: 'vendor/Case',
  reason: 'OK',
  httpStatus: 200,
  observedAt: at,
  ...over,
});
function read(t, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr03-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'scan.jsonl');
  fs.writeFileSync(file, rows.map(JSON.stringify).join('\n'));
  return scan.readScanLiveness(file);
}
for (const [status, reason] of [
  [429, 'RATE'],
  [401, 'AUTH'],
  [402, 'QUOTA'],
  [404, 'NO_CHANNEL'],
]) {
  test(`PR03: outer 503 classifies inner ${status} without persisting error text`, (t) => {
    const records = read(t, [row({ httpStatus: 503, body: `upstream [${status}] [REDACTED]` })]);
    const result = scan.withScanLiveness(row(), records).scanLiveness;
    assert.equal(result.reason, reason);
    assert.equal(result.observedAt, at);
    assert.equal(JSON.stringify(result).includes('REDACTED'), false);
  });
}
test('PR03: older pass cannot replace newer failure; exact account/source isolation and malformed timestamp', (t) => {
  const records = read(t, [
    row({ reason: 'RATE', httpStatus: 429 }),
    row({ observedAt: '2026-11-07T00:00:00Z' }),
  ]);
  assert.equal(scan.withScanLiveness(row(), records).scanLiveness.status, 'failed');
  assert.equal(scan.withScanLiveness(row({ accountId: 'b' }), records).scanLiveness, undefined);
  assert.equal(scan.withScanLiveness(row({ sourceId: 'direct' }), records).scanLiveness, undefined);
  assert.throws(() => read(t, [row({ observedAt: 'invalid' })]), /SCAN_INVALID_LINE/);
});
test('PR03: native completion proof survives timeout but error prose containing OK is not proof', (t) => {
  const records = read(t, [row({ body: 'Error: OK quota exhausted' })]);
  assert.equal(scan.withScanLiveness(row(), records).scanLiveness.status, 'failed');
  const completion = { choices: [{ message: { content: 'OK' } }] };
  assert.equal(
    scan.withScanLiveness(row(), read(t, [row({ body: completion, timedOut: true })])).scanLiveness
      .status,
    'passed'
  );
});
test('PR03: synthetic file timestamp never outranks an explicit newer failure', (t) => {
  const records = read(t, [
    row({ reason: 'RATE', httpStatus: 429, observedAt: '2026-11-07T00:00:00Z' }),
    row({ observedAt: undefined }),
  ]);
  assert.equal(scan.withScanLiveness(row(), records).scanLiveness.status, 'failed');
  assert.equal(scan.withScanLiveness(row(), records).scanLiveness.reason, 'RATE');
});
test('PR03: quota windows retain five-hour exhaustion, unknown and expired telemetry', async () => {
  const windows = [
    { family: 'fixture', window: 'weekly', remainingPercent: 80 },
    { family: 'fixture', window: 'fiveHour', remainingPercent: 0 },
  ];
  assert.equal(quota.mergeQuotaWindows(windows, Date.parse(at))[0].remainingPercent, 0);
  assert.equal(
    quota.mergeQuotaWindows([{ ...windows[0], resetsAt: at }], Date.parse(at))[0].known,
    false
  );
  assert.equal(
    quota.mergeQuotaWindows([{ ...windows[0], remainingPercent: null }], Date.parse(at))[0].known,
    false
  );
  const state = { scopes: {} };
  await quota.scanCliLanes(state, {
    now: Date.parse(at),
    source: 'agy-pool',
    registry: { sources: [] },
    poolAccounts: ['a', 'b', 'c'],
    poolRuntime: {
      quotaReading: (id) => ({
        available: true,
        rows: id === 'a' ? windows : id === 'b' ? [windows[0]] : [],
      }),
    },
  });
  assert.equal(state.scopes['a:fixture'].code, 'QUOTA');
  assert.equal(state.scopes['b:fixture'].code, 'OK');
  assert.equal(state.scopes.c.requiresProbe, true);
  assert.equal(
    quota.isScopeBlocked(
      { code: 'STATE_ERROR', requiresProbe: true, retryAfter: at },
      Date.parse(at) + 1
    ),
    true
  );
});
test('PR03: merging quota windows keeps the last exhausted reset so the block survives', () => {
  const fiveReset = new Date(Date.parse(at) + 3600 * 1000).toISOString();
  const weekReset = new Date(Date.parse(at) + 7 * 86400 * 1000).toISOString();
  const merged = quota.mergeQuotaWindows(
    [
      { family: 'fixture', window: 'fiveHour', remainingPercent: 0, resetsAt: fiveReset },
      { family: 'fixture', window: 'weekly', remainingPercent: 0, resetsAt: weekReset },
    ],
    Date.parse(at)
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].resetsAt, weekReset);
  const after = quota.mergeQuotaWindows(merged, Date.parse(fiveReset) + 1);
  assert.equal(after[0].known, true);
  assert.equal(after[0].remainingPercent, 0);
});
test('PR03: stale execution success never clears newer matching failure or another account', () => {
  const store = { version: 1, paths: {}, events: [] };
  const route = { id: 'fixture-gw', accountId: 'a' };
  health.recordExecutionResult(
    store,
    'vendor/Case',
    route,
    { status: 429 },
    { now: Date.parse(at) }
  );
  health.recordExecutionResult(store, 'vendor/Case', route, 'success', { now: Date.parse(at) - 1 });
  assert.equal(health.getPathRecord(store, 'vendor/Case', route).status, 'RATE_LIMITED');
  health.recordExecutionResult(store, 'vendor/Case', { ...route, accountId: 'b' }, 'success', {
    now: Date.parse(at) + 1,
  });
  assert.equal(health.getPathRecord(store, 'vendor/Case', route).status, 'RATE_LIMITED');
});
test('PR03: explicit unavailable health bridge fails closed without network or log reads', () => {
  const actual = assembleForDispatch(
    null,
    [],
    { sources: [], dispatch: { providers: {} } },
    {
      candidates: [{ ...row(), gateway: 'fixture-gw', harness: 'paseo', accessPath: 'cli' }],
      routeHealth: null,
      requireRouteHealth: true,
      evidenceData: {},
    }
  );
  assert.equal(actual.length, 0);
});
