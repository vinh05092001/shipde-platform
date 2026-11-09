'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const history = require('../outcome-history');

const S = '\u241f';
const key = (...p) => p.join(S);
const W = 'TASK-AI-171';
const A = key('paseo', 'http://gw/v1', '9router', 'up-a', 'acc-1', 'scope', 'model-x');
const A2 = key('paseo', 'http://gw/v1', '9router', 'up-a', 'acc-2', 'scope', 'model-x');
const B = key('paseo', 'http://gw/v1', '9router', 'up-b', 'acc-1', 'scope', 'model-x');
const round = (over) => Object.assign({ workItemId: W, verdict: 'changes_required' }, over);

test('B12: history is keyed by the full route, not the leaf model name', () => {
  const records = [
    round({ candidateKey: A, reviewedSha: 's1' }),
    round({ candidateKey: B, reviewedSha: 's2' }),
    round({ candidateKey: A2, reviewedSha: 's3' }),
  ];
  const hist = history.verdictHistory(records, W);
  assert.deepEqual([...hist.keys()].sort(), [A, A2, B].sort());
  for (const k of [A, A2, B]) {
    assert.equal(hist.get(k).rounds, 1);
    assert.deepEqual(hist.get(k).verdicts, { changes_required: 1 });
  }
});

test('B12: a verdict is attributed only to the route its record names', () => {
  const hist = history.verdictHistory([round({ candidateKey: A, reviewedSha: 's1' })], W);
  assert.deepEqual([hist.has(A), hist.has(B), hist.has(A2)], [true, false, false]);
});

test('B35/B36: a failed round is changes_required bound to a reviewed SHA', () => {
  const records = [
    round({ candidateKey: A, reviewedSha: 'good-1' }),
    Object.assign(round({ candidateKey: A, reviewedSha: 'infra-1' }), {
      cause: 'UPSTREAM_RATE_LIMIT',
      scope: 'UPSTREAM',
    }),
    round({ candidateKey: A, reviewedSha: 'sandbox-1', reason: 'sandbox clone failed' }),
    round({ candidateKey: A }),
    round({ candidateKey: A, status: 'completed' }),
  ];
  const failed = history.failedRounds(records, W);
  assert.deepEqual([...failed.get(A)], ['good-1']);
  assert.deepEqual([...history.roundsUsed(records, W)], [A]);
});

test('B36: a commit between launches is not failure evidence', () => {
  const records = [
    { workItemId: W, candidateKey: A, status: 'completed', reviewedSha: 'c1' },
    { workItemId: W, candidateKey: A, status: 'completed', at: '2026-11-09T10:00:00Z' },
  ];
  assert.equal(history.failedRounds(records, W).has(A), false);
  assert.equal(history.lastFailedRoute(records, W), null);
});

test('B36: lastFailedRoute is item- and run-scoped', () => {
  const records = [
    { workItemId: 'TASK-OTHER', candidateKey: B, stage: 'failed', at: '2026-11-09T12:00:00Z' },
    { workItemId: W, candidateKey: A, stage: 'failed', runId: 'run-1', at: '2026-11-09T10:00:00Z' },
    { workItemId: W, candidateKey: B, stage: 'failed', runId: 'run-2', at: '2026-11-09T11:00:00Z' },
  ];
  assert.equal(history.lastFailedRoute(records, W).routeKey, B);
  assert.equal(history.lastFailedRoute(records, W, { runId: 'run-1' }).routeKey, A);
  assert.equal(history.lastFailedRoute(records, W, { runId: 'run-9' }), null);
});

test('B65: escalate only to an untried known score at least the best tried (ties count)', () => {
  const plan = history.escalationPlan(
    [
      { candidateKey: A, score: 5, qualityKnown: true },
      { candidateKey: B, score: 5, qualityKnown: true },
      { candidateKey: A2, score: 9, qualityKnown: false },
    ],
    { failedRoutes: new Set([A]) }
  );
  assert.deepEqual([plan.action, plan.launch, plan.escalated], ['LAUNCH', B, true]);
  assert.equal(plan.rejected.map((r) => r.routeKey).includes(B), false);
});

test('B65: a retained route is never listed as rejected and is preferred when nothing joins', () => {
  const plan = history.escalationPlan(
    [
      { candidateKey: A, score: 9, qualityKnown: true },
      { candidateKey: B, score: 3, qualityKnown: true },
      { candidateKey: A2, score: 2, qualityKnown: true },
    ],
    { failedRoutes: new Set([A]) }
  );
  assert.deepEqual(
    [plan.action, plan.launch, plan.escalated, plan.retained],
    ['LAUNCH', A, false, A]
  );
  assert.equal(plan.rejected.map((r) => r.routeKey).includes(A), false);
});

test('B69: the only failed candidate, or no candidate, is a truthful BLOCKED', () => {
  const only = history.escalationPlan([{ candidateKey: A, score: 5, qualityKnown: true }], {
    failedRoutes: new Set([A]),
    lastFailedRoute: { routeKey: A },
  });
  assert.deepEqual(
    [only.action, only.reason, only.launch],
    ['BLOCKED', 'ONLY_FAILED_CANDIDATE', null]
  );
  const empty = history.escalationPlan([], {});
  assert.deepEqual([empty.action, empty.reason], ['BLOCKED', 'NO_ELIGIBLE_CANDIDATE']);
});

test('B69: the last failed route is not re-launched when an untried alt exists', () => {
  const plan = history.escalationPlan(
    [
      { candidateKey: A, score: 8, qualityKnown: true },
      { candidateKey: B, score: 4, qualityKnown: true },
    ],
    { failedRoutes: new Set([A]), lastFailedRoute: { routeKey: A } }
  );
  assert.notEqual(plan.launch, A);
  assert.ok(plan.rejected.some((r) => r.routeKey === A && r.reason === 'LAST_FAILED_THIS_ITEM'));
});

test('B71: the summary is bounded and makes no best-finisher claim or question', () => {
  const records = [
    round({ candidateKey: A, reviewedSha: 's1' }),
    round({ candidateKey: B, reviewedSha: 's2' }),
  ];
  const full = history.boundedOutcomeSummary(records, W);
  assert.doesNotMatch(full.summary, /best finisher|\?/i);
  assert.deepEqual(full.routes.map((r) => r.routeKey).sort(), [A, B].sort());
  const clipped = history.boundedOutcomeSummary(records, W, { maxChars: 10 });
  assert.deepEqual([clipped.summary.length, clipped.truncated], [10, true]);
});

test('B35: reportDispatchOutcome persists a structured quality-vs-outage classification', () => {
  const routing = require('../routing');
  const decisions = require('../decisions');
  const root = path.join(os.tmpdir(), 'task-ai-171-pr09-' + process.pid + '-' + Date.now());
  const decisionDir = path.join(root, 'decisions');
  fs.mkdirSync(root, { recursive: true });
  const candidateKey = key('paseo', 'http://gw/v1', '9router', 'up', 'acc', 'scope', 'model');
  const outcomeFile = path.join(root, 'quota-outcome.json');
  fs.writeFileSync(
    outcomeFile,
    JSON.stringify({ candidateKey, status: 'failed', taskId: W, reason: 'quota exhausted' })
  );
  const now = Date.parse('2026-11-09T10:00:00Z');
  routing.reportDispatchOutcome(
    { 'report-outcome': outcomeFile },
    {
      evidenceDir: root,
      storePath: path.join(root, 'quota.json'),
      routeHealthFile: path.join(root, 'route-health.json'),
      decisionDir,
      now,
      log: () => {},
      exit: () => {},
    }
  );
  const rec = decisions
    .readDecisionsDetailed({ dir: decisionDir, now })
    .records.find((r) => r.chosen === candidateKey && r.stage === 'failed');
  assert.ok(rec, 'failed outcome must be recorded');
  assert.equal(rec.classification.infrastructure, true);
  assert.equal(history.isInfrastructureOutcome(rec), true);
});
