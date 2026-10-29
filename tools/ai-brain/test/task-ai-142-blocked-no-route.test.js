'use strict';

/**
 * Ship Dễ — TASK-AI-142: Controller BLOCKED_NO_ROUTE handling tests.
 *
 * Covers:
 *   1. executeIntakeForItem detects BLOCKED_NO_ROUTE from checkpoint or intakeResult,
 *      extracts triedRoutes, records COOLED stage decision, and returns isBlockedNoRoute: true.
 *   2. nextLoop does not mark BLOCKED_NO_ROUTE items as terminal, scans quotas if due,
 *      and retries after polling interval when quota recovers.
 *   3. nextLoop stops cleanly with BLOCKED_NO_ROUTE_TIMEOUT and Stage.FAILED when
 *      waiting timeout (blockedNoRouteTimeoutMs) expires.
 *   4. orchestrate exports ItemStatus.BLOCKED_NO_ROUTE and RunStatus.BLOCKED_NO_ROUTE.
 *   5. sourcesApi provides default blockedNoRouteTimeoutMs and blockedNoRoutePollIntervalMs.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runNext, nextLoop, executeIntakeForItem } = require('../next-runner');
const { ItemStatus, RunStatus } = require('../orchestrate');
const sourcesApi = require('../sources');
const decisions = require('../decisions');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const UPSTREAM_DIR = path.join(REPO_ROOT, '.upstream-tmp');

function makeTempDir(prefix) {
  fs.mkdirSync(UPSTREAM_DIR, { recursive: true });
  return fs.mkdtempSync(path.join(UPSTREAM_DIR, prefix || 'task-142-no-route-'));
}

const REGISTER_HEADER =
  '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"';

function row(order, id, status, deps) {
  return [
    `"${order}"`,
    '"S00"',
    '"AI workflow"',
    `"${id}"`,
    '""',
    `"Feature ${id}"`,
    '"behavior"',
    `"${status}"`,
    `"${deps || ''}"`,
    `"docs/product-spec/work-items/${id}.md"`,
    `"feat/${id.toLowerCase()}"`,
    '""',
    '""',
    '""',
  ].join(',');
}

describe('TASK-AI-142: BLOCKED_NO_ROUTE Handling', () => {
  test('constants and dispatch config defaults', () => {
    assert.equal(ItemStatus.BLOCKED_NO_ROUTE, 'BLOCKED_NO_ROUTE');
    assert.equal(RunStatus.BLOCKED_NO_ROUTE, 'BLOCKED_NO_ROUTE');

    const dispatchCfg = sourcesApi.getDispatchConfig();
    assert.equal(typeof dispatchCfg.blockedNoRouteTimeoutMs, 'number');
    assert.equal(typeof dispatchCfg.blockedNoRoutePollIntervalMs, 'number');
    assert.ok(dispatchCfg.blockedNoRouteTimeoutMs >= 60000);
    assert.ok(dispatchCfg.blockedNoRoutePollIntervalMs >= 1000);
  });

  test('executeIntakeForItem detects BLOCKED_NO_ROUTE checkpoint and extracts triedRoutes', async () => {
    const dir = makeTempDir('exec-no-route-');
    const decDir = path.join(dir, 'decisions');
    const checkpointFile = path.join(dir, 'checkpoint.json');

    const triedRoutes = [
      {
        candidateKey: '9router:claude-3-5-sonnet',
        reasonCode: 'QUOTA_EXHAUSTED',
        reason: '429 rate limit',
      },
      {
        candidateKey: 'pool:gemini-2.5-pro',
        reasonCode: 'ALL_LANES_UNAVAILABLE',
        reason: 'cooldown active',
      },
    ];

    fs.writeFileSync(
      checkpointFile,
      JSON.stringify({
        status: RunStatus.BLOCKED_NO_ROUTE,
        outcomes: [
          {
            workItemId: 'FEAT-AUTH-02',
            status: ItemStatus.BLOCKED_NO_ROUTE,
            reasonCode: 'BLOCKED_NO_ROUTE',
            reason: 'NO_ELIGIBLE_CANDIDATE: all candidate routes exhausted',
            triedRoutes,
          },
        ],
      }),
      'utf8'
    );

    const fakeIntake = async () => ({
      status: 'failed',
      exitCode: 1,
      runFiles: { checkpoint: checkpointFile },
    });

    const item = { work_item_id: 'FEAT-AUTH-02' };
    const res = await executeIntakeForItem(
      item,
      {},
      { runIntake: fakeIntake },
      { dir: decDir, now: Date.now() }
    );

    assert.equal(res.isBlockedNoRoute, true);
    assert.equal(res.outcome, 'blocked_no_route');
    assert.equal(res.success, false);
    assert.deepEqual(res.triedRoutes, triedRoutes);

    const recs = decisions.readDecisions({ dir: decDir });
    const blockedRec = recs.find(
      (r) => r.workItemId === 'FEAT-AUTH-02' && r.stage === decisions.Stage.COOLED
    );
    assert.ok(blockedRec, 'decision log must record COOLED stage for BLOCKED_NO_ROUTE');
    assert.deepEqual(blockedRec.triedRoutes, triedRoutes);
  });

  test('nextLoop retries BLOCKED_NO_ROUTE item without dropping it, then succeeds on quota recovery', async () => {
    const dir = makeTempDir('loop-retry-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [REGISTER_HEADER, row('1', 'FEAT-AUTH-02', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    let intakeCalls = 0;
    let quotaScans = 0;
    const sleptMs = [];
    const logs = [];

    const fakeIntake = async (opts) => {
      intakeCalls += 1;
      if (intakeCalls === 1) {
        // First run: all routes exhausted
        return {
          id: opts.workItem,
          status: 'failed',
          exitCode: 1,
          isBlockedNoRoute: true,
          triedRoutes: [
            {
              candidateKey: '9router:gpt-5-6-sol',
              reasonCode: 'QUOTA_EXHAUSTED',
              reason: '429 Insufficient quota',
            },
          ],
        };
      }
      // Second run: route recovered
      return {
        id: opts.workItem,
        status: 'completed',
        exitCode: 0,
      };
    };

    const fakeQuotaScan = {
      scanAllQuotas: async (opts) => {
        quotaScans += 1;
        assert.equal(opts.ifDue, true);
      },
    };

    const res = await nextLoop(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        intakeDir: path.join(dir, 'intake'),
        blockedNoRouteTimeoutMs: 600000,
        blockedNoRoutePollIntervalMs: 5000,
        maxIterations: 3,
      },
      {
        runIntake: fakeIntake,
        quotaScan: fakeQuotaScan,
        sleep: async (ms) => sleptMs.push(ms),
        log: (line) => logs.push(line),
      }
    );

    assert.equal(intakeCalls, 2, 'must retry the work item after BLOCKED_NO_ROUTE');
    assert.equal(quotaScans, 1, 'must trigger quota scan during wait');
    assert.equal(sleptMs[0], 5000, 'first sleep must be retry wait interval');
    assert.ok(
      logs.some((line) =>
        line.includes('BLOCKED_NO_ROUTE: Work Item FEAT-AUTH-02 has no available routes')
      ),
      'must log waiting progress with tried routes'
    );
    assert.ok(
      logs.some((line) =>
        line.includes('Work Item FEAT-AUTH-02 ended with terminal state completed')
      ),
      'must complete item after quota recovers'
    );
  });

  test('nextLoop stops cleanly with BLOCKED_NO_ROUTE_TIMEOUT when wait exceeds timeout', async () => {
    const dir = makeTempDir('loop-timeout-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [REGISTER_HEADER, row('1', 'FEAT-AUTH-02', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    let intakeCalls = 0;
    let mockTime = Date.now();
    const logs = [];

    const fakeIntake = async (opts) => {
      intakeCalls += 1;
      return {
        id: opts.workItem,
        status: 'failed',
        exitCode: 1,
        isBlockedNoRoute: true,
        triedRoutes: [
          { candidateKey: '9router:combo', reasonCode: 'QUOTA_EXHAUSTED', reason: 'upstream down' },
        ],
      };
    };

    const res = await nextLoop(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        intakeDir: path.join(dir, 'intake'),
        blockedNoRouteTimeoutMs: 30000, // 30s timeout
        blockedNoRoutePollIntervalMs: 10000,
        maxIterations: 5,
      },
      {
        runIntake: fakeIntake,
        quotaScan: { scanAllQuotas: async () => {} },
        sleep: async () => {
          mockTime += 35000; // Advance time past 30s timeout
        },
        now: () => mockTime,
        log: (line) => logs.push(line),
      }
    );

    assert.equal(res.stopped, true);
    assert.equal(res.reason, 'BLOCKED_NO_ROUTE_TIMEOUT');
    assert.equal(res.workItemId, 'FEAT-AUTH-02');
    assert.ok(res.elapsedMs >= 30000);

    const recs = decisions.readDecisions({ dir: decDir, now: mockTime });
    const timeoutRec = recs.find((r) => r.detail === 'BLOCKED_NO_ROUTE_TIMEOUT');
    assert.ok(timeoutRec, 'decision log must record BLOCKED_NO_ROUTE_TIMEOUT');
    assert.equal(timeoutRec.stage, decisions.Stage.FAILED);
  });

  test('runNext non-loop returns isBlockedNoRoute and triedRoutes', async () => {
    const dir = makeTempDir('run-next-no-route-');
    const decDir = path.join(dir, 'decisions');
    const csvPath = path.join(dir, 'register.csv');
    const content = [REGISTER_HEADER, row('1', 'FEAT-AUTH-02', 'READY_FOR_AUTHOR', '')].join('\n');
    fs.writeFileSync(csvPath, content, 'utf8');

    const fakeIntake = async (opts) => ({
      id: opts.workItem,
      status: 'failed',
      exitCode: 1,
      isBlockedNoRoute: true,
      triedRoutes: [{ candidateKey: 'opencode:fast', reasonCode: 'RATE_LIMIT' }],
    });

    const res = await runNext(
      {
        registerPath: csvPath,
        decisionDir: decDir,
        intakeDir: path.join(dir, 'intake'),
        run: true,
      },
      {
        runIntake: fakeIntake,
      }
    );

    assert.equal(res.ran, true);
    assert.equal(res.status, 'blocked_no_route');
    assert.equal(res.isBlockedNoRoute, true);
    assert.equal(res.triedRoutes.length, 1);
    assert.equal(res.triedRoutes[0].candidateKey, 'opencode:fast');
  });
});
