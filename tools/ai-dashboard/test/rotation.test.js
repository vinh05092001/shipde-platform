/**
 * Ship Dễ — Model Rotation Test Suite
 * TASK-AI-47: AC-AI-47-01 through AC-AI-47-04
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const { buildRotationState, parseLogLines, readCooldowns, SOURCE_DEFS } = require('../rotation');
const { createDashboardServer } = require('../server');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-rot-'));
}

describe('TASK-AI-47 Model Rotation Suite', () => {
  describe('AC-AI-47-01: JSON shape validation', () => {
    test('buildRotationState returns correct top-level shape', () => {
      const tmp = makeTmpDir();
      const state = buildRotationState({
        rootDir: tmp,
        logDir: path.join(tmp, 'no-logs'),
        ledgerFile: path.join(tmp, 'no-ledger.json'),
        quotaFile: path.join(tmp, 'no-quota.json'),
        now: Date.now(),
      });
      assert.ok(state.observedAt, 'observedAt must be present');
      assert.ok(state.hub && state.hub.label, 'hub.label must be present');
      assert.ok(Array.isArray(state.sources), 'sources must be an array');
      for (const src of state.sources) {
        assert.ok(src.id, 'source must have id');
        assert.ok(src.label, 'source must have label');
        assert.strictEqual(typeof src.configured, 'boolean');
        assert.ok(['live','idle','cooldown','quota-exhausted'].includes(src.status), 'valid status');
        assert.ok(src.activeRun, 'activeRun must exist');
        assert.ok('modelId' in src.activeRun, 'activeRun.modelId');
        assert.ok('tokensSoFar' in src.activeRun, 'activeRun.tokensSoFar');
        assert.ok(src.cooldown, 'cooldown must exist');
        assert.ok(src.limits, 'limits must exist');
        assert.ok('declaredLimit' in src.limits);
        assert.ok('consumption' in src.limits);
        assert.ok('headroom' in src.limits);
        assert.ok(Array.isArray(src.recentRuns));
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('AC-AI-47-02: UNKNOWN propagation when no data exists', () => {
    test('all limits and consumption are UNKNOWN with empty dirs', () => {
      const tmp = makeTmpDir();
      const state = buildRotationState({
        rootDir: tmp,
        logDir: path.join(tmp, 'empty-logs'),
        ledgerFile: path.join(tmp, 'no.json'),
        quotaFile: path.join(tmp, 'no.json'),
        now: Date.now(),
      });
      for (const src of state.sources) {
        assert.strictEqual(src.limits.declaredLimit, 'UNKNOWN', `${src.id} declaredLimit`);
        assert.strictEqual(src.limits.consumption, 'UNKNOWN', `${src.id} consumption`);
        assert.strictEqual(src.limits.headroom, 'UNKNOWN', `${src.id} headroom`);
        assert.strictEqual(src.activeRun.tokensSoFar, 'UNKNOWN', `${src.id} tokensSoFar`);
        // Must never be 0
        assert.notStrictEqual(src.limits.declaredLimit, 0);
        assert.notStrictEqual(src.limits.consumption, 0);
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('AC-AI-47-03: Cooldown state from ledger', () => {
    test('source transitions to cooldown when ledger has recent refusal', () => {
      const tmp = makeTmpDir();
      const now = Date.now();
      const ledgerFile = path.join(tmp, 'ledger.json');
      const refusedAt = new Date(now - 60000).toISOString();
      fs.writeFileSync(ledgerFile, JSON.stringify({
        version: 1, updatedAt: refusedAt,
        observations: [{ accountId: '9router', model: 'gpt-4o', outcome: 'refused', consumed: {}, reason: 'rate limit exceeded', at: refusedAt }]
      }));
      const state = buildRotationState({ rootDir: tmp, logDir: path.join(tmp, 'no'), ledgerFile, quotaFile: path.join(tmp, 'nq'), now });
      const router = state.sources.find(s => s.id === '9router');
      assert.ok(router, '9router source must exist');
      assert.strictEqual(router.status, 'cooldown');
      assert.ok(router.cooldown.until);
      assert.strictEqual(router.cooldown.reason, 'rate limit exceeded');
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('expired cooldown does not set status to cooldown', () => {
      const tmp = makeTmpDir();
      const now = Date.now();
      const ledgerFile = path.join(tmp, 'ledger.json');
      const refusedAt = new Date(now - 600000).toISOString();
      fs.writeFileSync(ledgerFile, JSON.stringify({
        version: 1, updatedAt: refusedAt,
        observations: [{ accountId: 'cline', outcome: 'refused', reason: 'quota', at: refusedAt }]
      }));
      const state = buildRotationState({ rootDir: tmp, logDir: path.join(tmp, 'x'), ledgerFile, quotaFile: path.join(tmp, 'x.json'), now });
      const cline = state.sources.find(s => s.id === 'cline');
      if (cline) assert.notStrictEqual(cline.status, 'cooldown');
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('AC-AI-47-04: Server routes', () => {
    test('/api/rotation returns 200 with valid JSON', async () => {
      const server = createDashboardServer({ disablePolling: true });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/api/rotation');
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.observedAt);
        assert.ok(data.hub);
        assert.ok(Array.isArray(data.sources));
      } finally { server.close(); }
    });

    test('/rotation serves HTML with SVG container', async () => {
      const server = createDashboardServer({ disablePolling: true });
      await new Promise(r => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/rotation');
        assert.strictEqual(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes('<svg'));
        assert.ok(html.includes('rotation-svg'));
      } finally { server.close(); }
    });
  });

  describe('Log parsing', () => {
    test('parseLogLines extracts entries correctly', () => {
      const tmp = makeTmpDir();
      fs.writeFileSync(path.join(tmp, 'test.log'),
        '[2026-09-18T10:00:00Z] source=9router model=gpt-4o tokens=1500 status=done\n' +
        '[2026-09-18T10:01:00Z] source=cline model=claude-sonnet tokens=UNKNOWN status=live\ngarbage\n');
      const entries = parseLogLines(tmp);
      assert.strictEqual(entries.length, 2);
      assert.strictEqual(entries[0].sourceId, '9router');
      assert.strictEqual(entries[0].tokens, 1500);
      assert.strictEqual(entries[1].tokens, 'UNKNOWN');
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });
});