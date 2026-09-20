/**
 * Ship Dễ — Model Rotation Test Suite
 * TASK-AI-47: AC-AI-47-01 through AC-AI-47-04, plus AC-AI-47-08
 * (the dispatcher log is read where dispatch.sh actually writes it)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const {
  buildRotationState,
  parseLogLines,
  readCooldowns,
  resolveLogDir,
  SOURCE_DEFS,
  probeBai,
  probeAllBaiBalances,
  clearProbeCache,
  getBaiKeyDefinitions,
} = require('../rotation');
const { createDashboardServer } = require('../server');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-rot-'));
}

describe('TASK-AI-47 Model Rotation Suite', () => {
  describe('AC-AI-47-01: JSON shape validation', () => {
    test('buildRotationState returns correct top-level shape', () => {
      const tmp = makeTmpDir();
      const state = buildRotationState({
        homeDir: tmp,
        probe: false,
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
        assert.ok(
          ['live', 'idle', 'cooldown', 'quota-exhausted'].includes(src.status),
          'valid status'
        );
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
        homeDir: tmp,
        probe: false,
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
      fs.writeFileSync(
        ledgerFile,
        JSON.stringify({
          version: 1,
          updatedAt: refusedAt,
          observations: [
            {
              accountId: '9router',
              model: 'gpt-4o',
              outcome: 'refused',
              consumed: {},
              reason: 'rate limit exceeded',
              at: refusedAt,
            },
          ],
        })
      );
      const state = buildRotationState({
        homeDir: tmp,
        probe: false,
        rootDir: tmp,
        logDir: path.join(tmp, 'no'),
        ledgerFile,
        quotaFile: path.join(tmp, 'nq'),
        now,
      });
      const router = state.sources.find((s) => s.id === '9router');
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
      fs.writeFileSync(
        ledgerFile,
        JSON.stringify({
          version: 1,
          updatedAt: refusedAt,
          observations: [
            { accountId: 'cline', outcome: 'refused', reason: 'quota', at: refusedAt },
          ],
        })
      );
      const state = buildRotationState({
        homeDir: tmp,
        probe: false,
        rootDir: tmp,
        logDir: path.join(tmp, 'x'),
        ledgerFile,
        quotaFile: path.join(tmp, 'x.json'),
        now,
      });
      const cline = state.sources.find((s) => s.id === 'cline');
      if (cline) assert.notStrictEqual(cline.status, 'cooldown');
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('AC-AI-47-04: Server routes', () => {
    test('/api/rotation returns 200 with valid JSON', async () => {
      const server = createDashboardServer({ disablePolling: true });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/api/rotation');
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.ok(data.observedAt);
        assert.ok(data.hub);
        assert.ok(Array.isArray(data.sources));
      } finally {
        server.close();
      }
    });

    test('/rotation serves HTML with SVG container', async () => {
      const server = createDashboardServer({ disablePolling: true });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/rotation');
        assert.strictEqual(res.status, 200);
        const html = await res.text();
        assert.ok(html.includes('<svg'));
        assert.ok(html.includes('rotation-svg'));
      } finally {
        server.close();
      }
    });

    test('/api/rotation with disablePolling does not perform provider probe', async () => {
      clearProbeCache();
      let fetchCalled = false;
      const server = createDashboardServer({
        disablePolling: true,
        fetch: () => {
          fetchCalled = true;
          throw new Error('Network probe should not be called when polling disabled');
        },
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/api/rotation');
        assert.strictEqual(res.status, 200);
        assert.strictEqual(fetchCalled, false, 'No probe fetch should be initiated during test');
      } finally {
        server.close();
      }
    });

    test('/api/rotation with probe: true awaits balance probe and returns numeric headroom', async () => {
      clearProbeCache();
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { personal_balance: 7500 } }),
      });
      const tmp = makeTmpDir();
      const server = createDashboardServer({
        probe: true,
        homeDir: tmp,
        baiKeys: ['mock-k1', 'mock-k2'],
        fetch: mockFetch,
        logDir: path.join(tmp, 'no-logs'),
        ledgerFile: path.join(tmp, 'no-ledger.json'),
        quotaFile: path.join(tmp, 'no-quota.json'),
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const port = server.address().port;
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/api/rotation');
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        const bai = data.sources.find((s) => s.id === 'bai');
        assert.ok(bai);
        assert.strictEqual(bai.limits.headroom, 15000);
      } finally {
        server.close();
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('AC-AI-47-08: the dispatcher log is read where dispatch.sh writes it', () => {
    // dispatch.sh logs into the MAIN checkout's .worktrees/logs even when the
    // Work Item it launches runs in a linked worktree below it. Joining this
    // process's own rootDir with .worktrees/logs pointed at a folder that did
    // not exist, and the panel reported zero dispatch attempts while the
    // recorded dispatches sat one level up.
    const stamp = (minutesAgo) => {
      const d = new Date(Date.now() - minutesAgo * 60000);
      return [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map((n) => String(n).padStart(2, '0'))
        .join(':');
    };
    const dispatchLog = () =>
      [
        `=== trying xkiro free/chatgpt-4.1-mini ${stamp(20)} ===`,
        '--- xkiro free/chatgpt-4.1-mini exhausted ---',
        `=== trying bai7 anthropic/claude-sonnet-4.5 ${stamp(15)} ===`,
        '=== finished on bai7 anthropic/claude-sonnet-4.5 ===',
        '--- skip xkiro minimax/minimax-m3: daily free quota remaining 0 ---',
      ].join('\n');

    function fixture() {
      const tmp = makeTmpDir();
      const main = path.join(tmp, 'shipde-platform');
      const logs = path.join(main, '.worktrees', 'logs');
      const worktree = path.join(main, '.worktrees', 'r9001');
      fs.mkdirSync(logs, { recursive: true });
      fs.mkdirSync(worktree, { recursive: true });
      fs.writeFileSync(path.join(logs, 'r9001.log'), dispatchLog());
      return { tmp, main, logs, worktree };
    }

    function stateFrom(options) {
      const f = fixture();
      const state = buildRotationState({
        homeDir: f.tmp,
        probe: false,
        rootDir: f.worktree,
        ledgerFile: path.join(f.tmp, 'no-ledger.json'),
        quotaFile: path.join(f.tmp, 'no-quota.json'),
        now: Date.now(),
        ...options,
      });
      return { f, state };
    }

    test('resolveLogDir walks out of the worktree to the main checkout log folder', () => {
      const f = fixture();
      const resolved = resolveLogDir(f.worktree);
      assert.strictEqual(resolved.dir, path.resolve(f.logs));
      assert.ok(resolved.exists, 'the dispatcher folder must be found, not assumed missing');
      fs.rmSync(f.tmp, { recursive: true, force: true });
    });

    test('attempts are counted from the real dispatcher lines, skips are not runs', () => {
      const { f, state } = stateFrom({});
      assert.strictEqual(
        state.log.exists,
        true,
        'buildRotationState must read the resolved folder'
      );
      assert.strictEqual(state.totals.attempts, 2, 'the two lanes dispatch.sh actually launched');
      assert.strictEqual(state.totals.skipped, 1, 'a pre-flight skip is a refusal, not a run');
      assert.strictEqual(state.totals.quotaRefused, 2, 'one exhausted, one skipped');
      assert.strictEqual(state.totals.live, 0, 'nothing is still open');
      fs.rmSync(f.tmp, { recursive: true, force: true });
    });

    test('a lane the dashboard does not ship with still appears in the breakdown', () => {
      const { f, state } = stateFrom({});
      const bai = state.sources.find((s) => s.id === 'bai');
      assert.ok(bai, 'bai (consolidated B.AI) ran 1 logged attempt and must not be invisible');
      assert.strictEqual(bai.label, 'B.AI');
      assert.strictEqual(
        state.sources.some((s) => s.id === 'bai7'),
        false,
        'bai7 must not be a separate source node'
      );
      const startedFor = (id) =>
        parseLogLines(state.log.dir).filter((e) => e.sourceId === id && e.started).length;
      let accounted = 0;
      for (const src of state.sources) accounted += startedFor(src.id);
      assert.strictEqual(
        accounted,
        state.totals.attempts,
        'the per-source breakdown must add up to the headline'
      );
      fs.rmSync(f.tmp, { recursive: true, force: true });
    });

    test('an unreadable log folder yields UNKNOWN, never a clean zero', () => {
      const tmp = makeTmpDir();
      const state = buildRotationState({
        homeDir: tmp,
        probe: false,
        rootDir: tmp,
        logDir: path.join(tmp, 'definitely-not-logs'),
        ledgerFile: path.join(tmp, 'no.json'),
        quotaFile: path.join(tmp, 'no.json'),
        now: Date.now(),
      });
      assert.strictEqual(state.log.exists, false);
      assert.strictEqual(state.totals.attempts, 'UNKNOWN');
      assert.ok(state.log.reason, 'the panel must be able to say why nothing is measured');
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('AC-AI-47-09: B.AI consolidation and status aggregation', () => {
    test('merges multiple bai lanes into single source bai and sums metrics', () => {
      const tmp = makeTmpDir();
      const logs = path.join(tmp, '.worktrees', 'logs');
      fs.mkdirSync(logs, { recursive: true });

      const lines = [
        '=== trying bai1 anthropic/claude-sonnet-4.5 10:00:00 ===',
        '=== finished on bai1 anthropic/claude-sonnet-4.5 ===',
        '=== trying bai2 anthropic/claude-sonnet-4.5 10:05:00 ===',
        '--- bai2 anthropic/claude-sonnet-4.5 exhausted ---',
        '--- skip bai3 anthropic/claude-sonnet-4.5: cooldown ---',
      ].join('\n');
      fs.writeFileSync(path.join(logs, 'multi-bai.log'), lines);

      const state = buildRotationState({
        homeDir: tmp,
        probe: false,
        logDir: logs,
        ledgerFile: path.join(tmp, 'no-ledger.json'),
        quotaFile: path.join(tmp, 'no-quota.json'),
        totalKeys: 7,
      });

      const baiSources = state.sources.filter((s) => s.id === 'bai');
      assert.strictEqual(baiSources.length, 1, 'must have exactly one consolidated bai source');
      const bai = baiSources[0];
      assert.strictEqual(bai.label, 'B.AI');
      assert.strictEqual(bai.attempts, 2, 'bai1 and bai2 runs started');
      assert.strictEqual(bai.skipped, 1, 'bai3 was skipped');
      assert.strictEqual(bai.quotaRefused, 2, 'bai2 exhausted + bai3 skipped');
      assert.strictEqual(bai.nodeLabel, 'B.AI 0/7 key', '0 keys running when ended');

      // Individual lanes must not appear as separate sources
      assert.strictEqual(
        state.sources.some((s) => s.id === 'bai1'),
        false
      );
      assert.strictEqual(
        state.sources.some((s) => s.id === 'bai2'),
        false
      );
      assert.strictEqual(
        state.sources.some((s) => s.id === 'bai3'),
        false
      );

      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('status is live when any key is active, and indicates running count', () => {
      const tmp = makeTmpDir();
      const logs = path.join(tmp, '.worktrees', 'logs');
      fs.mkdirSync(logs, { recursive: true });

      // Live run on bai2 (TRY without exhausted or finished, file fresh)
      const lines = ['=== trying bai2 anthropic/claude-sonnet-4.5 10:00:00 ==='].join('\n');
      fs.writeFileSync(path.join(logs, 'live-bai.log'), lines);

      const state = buildRotationState({
        homeDir: tmp,
        probe: false,
        logDir: logs,
        ledgerFile: path.join(tmp, 'no-ledger.json'),
        quotaFile: path.join(tmp, 'no-quota.json'),
        totalKeys: 7,
      });

      const bai = state.sources.find((s) => s.id === 'bai');
      assert.ok(bai);
      assert.strictEqual(bai.status, 'live', 'must be live while key is running');
      assert.strictEqual(bai.keys.running, 1);
      assert.strictEqual(bai.keys.total, 7);
      assert.strictEqual(bai.nodeLabel, 'B.AI 1/7 key');

      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('status is quota-exhausted only when all keys are exhausted, otherwise idle', () => {
      const tmp = makeTmpDir();
      const ledger = path.join(tmp, 'ledger.json');
      const logs = path.join(tmp, 'logs');
      fs.mkdirSync(logs, { recursive: true });
      fs.writeFileSync(path.join(logs, 'run.log'), '=== finished on bai1 model ===\n');

      const now = Date.now();
      const recent = new Date(now - 30000).toISOString();

      // Only bai1 in cooldown -> bai should remain 'idle' because other keys exist
      fs.writeFileSync(
        ledger,
        JSON.stringify({
          version: 1,
          observations: [
            { accountId: 'bai1', outcome: 'refused', at: recent, reason: 'rate limit exceeded' },
          ],
        })
      );

      const state1 = buildRotationState({
        homeDir: tmp,
        probe: false,
        logDir: logs,
        ledgerFile: ledger,
        quotaFile: path.join(tmp, 'no-quota.json'),
        baiKeys: ['k1', 'k2', 'k3'],
        now,
      });

      const bai1 = state1.sources.find((s) => s.id === 'bai');
      assert.strictEqual(bai1.status, 'idle', 'status must be idle when only 1 key is on cooldown');

      // When ALL keys are in cooldown -> status becomes quota-exhausted
      fs.writeFileSync(
        ledger,
        JSON.stringify({
          version: 1,
          observations: [
            { accountId: 'bai1', outcome: 'refused', at: recent, reason: 'rate limit exceeded' },
            { accountId: 'bai2', outcome: 'refused', at: recent, reason: 'too many requests' },
            { accountId: 'bai3', outcome: 'refused', at: recent, reason: 'quota exceeded' },
          ],
        })
      );

      const state2 = buildRotationState({
        homeDir: tmp,
        probe: false,
        logDir: logs,
        ledgerFile: ledger,
        quotaFile: path.join(tmp, 'no-quota.json'),
        baiKeys: ['k1', 'k2', 'k3'],
        now,
      });

      const bai2 = state2.sources.find((s) => s.id === 'bai');
      assert.strictEqual(
        bai2.status,
        'quota-exhausted',
        'status must be quota-exhausted when all keys exhausted'
      );

      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('AC-AI-47-10: B.AI real balance probing and quota rules (mock fetch)', () => {
    const keys = [
      { id: 'bai1', name: 'BAI_API_KEY', key: 'secret-key-1' },
      { id: 'bai2', name: 'BAI_API_KEY_2', key: 'secret-key-2' },
    ];

    test('đo được: all keys succeed, total headroom is sum, low balance generates warning', async () => {
      const mockFetch = async (url, opts) => {
        assert.strictEqual(url, 'https://api.b.ai/v1/balance');
        const auth = opts.headers.Authorization;
        if (auth === 'Bearer secret-key-1') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { personal_balance: 50000 } }),
          };
        }
        if (auth === 'Bearer secret-key-2') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { personal_balance: 7500 } }),
          };
        }
        throw new Error('Unexpected key');
      };

      const result = await probeAllBaiBalances(keys, { fetch: mockFetch });

      assert.strictEqual(
        result.headroom,
        57500,
        'headroom must be sum of balances when all succeed'
      );
      assert.strictEqual(result.keys.length, 2);
      assert.strictEqual(result.keys[0].balance, 50000);
      assert.strictEqual(result.keys[1].balance, 7500);

      // Warning when balance < 10000
      assert.strictEqual(result.warnings.length, 1);
      assert.ok(result.warnings[0].includes('bai2') && result.warnings[0].includes('7500'));

      // Security: no secret key string must leak into results or JSON
      const serialized = JSON.stringify(result);
      assert.strictEqual(serialized.includes('secret-key-1'), false);
      assert.strictEqual(serialized.includes('secret-key-2'), false);
    });

    test('một key lỗi: single key failure or timeout causes total headroom to be UNKNOWN, not zero', async () => {
      const mockFetch = async (url, opts) => {
        const auth = opts.headers.Authorization;
        if (auth === 'Bearer secret-key-1') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { personal_balance: 50000 } }),
          };
        }
        // Key 2 fails with 500
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Internal Server Error' }),
        };
      };

      const result = await probeAllBaiBalances(keys, { fetch: mockFetch });

      assert.strictEqual(result.keys[0].balance, 50000);
      assert.strictEqual(result.keys[1].balance, 'UNKNOWN');
      // Rule: if one key fails, total must be UNKNOWN, NEVER 0 and NEVER partial 50000
      assert.strictEqual(
        result.headroom,
        'UNKNOWN',
        'total headroom must be UNKNOWN when any key fails'
      );
    });

    test('tất cả key lỗi: all keys failing yields UNKNOWN headroom and UNKNOWN balances', async () => {
      const mockFetch = async () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      };

      const result = await probeAllBaiBalances(keys, { fetch: mockFetch });

      assert.strictEqual(result.keys[0].balance, 'UNKNOWN');
      assert.strictEqual(result.keys[1].balance, 'UNKNOWN');
      assert.strictEqual(result.headroom, 'UNKNOWN');
    });

    test('probeBai caches probe result and supplies headroom to buildRotationState', async () => {
      clearProbeCache();
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { personal_balance: 42000 } }),
      });

      const probed = await probeBai(Date.now(), 60000, {
        baiKeys: ['mock-k1'],
        fetch: mockFetch,
        async: true,
      });
      assert.strictEqual(probed.headroom, 42000);

      const tmp = makeTmpDir();
      const state = buildRotationState({
        homeDir: tmp,
        probe: true,
        baiKeys: ['mock-k1'],
        logDir: path.join(tmp, 'no-logs'),
        ledgerFile: path.join(tmp, 'no-ledger.json'),
        quotaFile: path.join(tmp, 'no-quota.json'),
      });

      const bai = state.sources.find((s) => s.id === 'bai');
      assert.ok(bai);
      assert.strictEqual(
        bai.limits.headroom,
        42000,
        'buildRotationState must read cached headroom'
      );

      // Security check on the full state payload
      const serializedState = JSON.stringify(state);
      assert.strictEqual(serializedState.includes('mock-k1'), false, 'keys must not leak in state');

      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test('buildRotationState with async: true queries balance probe directly', async () => {
      clearProbeCache();
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { personal_balance: 12345 } }),
      });
      const tmp = makeTmpDir();
      const state = await buildRotationState({
        async: true,
        probe: true,
        homeDir: tmp,
        baiKeys: ['async-k1'],
        fetch: mockFetch,
        logDir: path.join(tmp, 'no-logs'),
        ledgerFile: path.join(tmp, 'no-ledger.json'),
        quotaFile: path.join(tmp, 'no-quota.json'),
      });

      const bai = state.sources.find((s) => s.id === 'bai');
      assert.ok(bai);
      assert.strictEqual(bai.limits.headroom, 12345);
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  // Dispatcher-format parsing is covered by rotation-parse.test.js.
});
