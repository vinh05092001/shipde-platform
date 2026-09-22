'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectAgyPoolState } = require('../agy-pool-adapter');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-pool-'));
  for (const name of ['agy01', 'agy02', 'agy03', 'agy04', 'agy05']) {
    fs.mkdirSync(path.join(root, name));
  }
  return root;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

test('collects account states, active flag, and only future cooldowns', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = Date.parse('2026-09-22T12:00:00Z');
  const result = (name, state) =>
    writeJson(path.join(root, name, 'result.json'), {
      name,
      state,
      exitCode: state === 'ok' ? 0 : 1,
      startedAt: '2026-09-22T11:00:00Z',
      finishedAt: '2026-09-22T11:01:00Z',
      user: name,
    });
  result('agy02', 'ok');
  result('agy03', 'quota');
  result('agy04', 'quota');
  fs.writeFileSync(path.join(root, 'agy05', 'result.json'), '{bad json', 'utf8');
  writeJson(path.join(root, 'pool.json'), {
    active: 'agy02',
    updatedAt: '2026-09-22T11:30:00Z',
    accounts: {
      agy03: { cooldownUntil: '2026-09-22T13:00:00Z' },
      agy04: { cooldownUntil: '2026-09-22T10:00:00Z' },
    },
  });

  const collected = collectAgyPoolState({ root, now });
  assert.strictEqual(collected.health.status, 'live');
  assert.deepStrictEqual(collected.data.counts, {
    total: 5,
    ready: 1,
    cooling: 1,
    loginRequired: 0,
    error: 1,
    neverRun: 1,
  });
  assert.strictEqual(collected.data.active, 'agy02');
  assert.strictEqual(collected.data.accounts[0].state, 'never-run');
  assert.strictEqual(collected.data.accounts[1].active, true);
  assert.strictEqual(collected.data.accounts[2].cooldownUntil, '2026-09-22T13:00:00Z');
  assert.strictEqual(collected.data.accounts[3].cooldownUntil, null);
  assert.strictEqual(collected.data.accounts[4].state, 'error');
  assert.match(collected.data.accounts[4].note, /result\.json không hợp lệ/);
});

test('missing root is unavailable with an empty account list', () => {
  const root = path.join(os.tmpdir(), `missing-agy-pool-${Date.now()}`);
  const collected = collectAgyPoolState({ root });
  assert.strictEqual(collected.health.status, 'unavailable');
  assert.deepStrictEqual(collected.data.accounts, []);
  assert.match(collected.health.impact, /Không đọc được thư mục pool agy/);
});

test('a result.json written by Windows PowerShell 5.1 (UTF-8 with BOM) reads as its real state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-pool-bom-'));
  fs.mkdirSync(path.join(root, 'agy01'));
  const body = JSON.stringify({ name: 'agy01', state: 'ok', exitCode: 0, finishedAt: '2026-09-22T08:24:29Z' });
  fs.writeFileSync(path.join(root, 'agy01', 'result.json'), '﻿' + body, 'utf8');
  const result = await collectAgyPoolState({ root });
  assert.strictEqual(result.data.accounts[0].state, 'ok');
  assert.strictEqual(result.data.counts.ready, 1);
  assert.strictEqual(result.data.counts.error, 0);
});
