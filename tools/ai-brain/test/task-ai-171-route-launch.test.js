'use strict';

/**
 * Ship Dễ — TASK-AI-171: the launcher keeps the route decision.
 *
 * Drives the real sanitized fixture (runs.json) through decide and then through
 * the launcher. Checks that the argv holds exactly the decided model, that a
 * combo stays a combo, that AGY jobs keep model/account/cwd and report BUSY,
 * that observed() never invents run data, and that a failed route is dropped by
 * routeKey without touching another account of the same model. No network or
 * model call; no fixture edit.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { decide, classifyFailure, routeKey } = require('../route-decision');
const { buildLaunch, observed, nextDecisionInput } = require('../route-launch');

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'routing-replay', 'runs.json'), 'utf8')
);
const CASES = FIXTURE.cases;
const CANDIDATES = FIXTURE.candidates;
const REQUEST = FIXTURE.request;
const PREFIXES = { '9router': 'ninerouter' };

function modelArgOf(launch) {
  const index = launch.args.indexOf('-m');
  assert.notEqual(index, -1, 'argv carries -m');
  return launch.args[index + 1];
}

test('aa-v5-percentile at 32000 tokens launches the decided deepseek model, never the combo', () => {
  const decision = decide({
    runId: 'r-deep',
    candidates: CANDIDATES,
    request: REQUEST,
    scale: 'aa-v5-percentile',
  });
  assert.equal(decision.chosen.modelId, 'deepseek-v4.1-flash');

  const launch = buildLaunch(decision, { cwd: 'wt-a', prefixes: PREFIXES, taskFile: 'task.md' });
  assert.equal(launch.status, 'READY');
  assert.equal(launch.command, 'opencode');
  assert.equal(launch.kind, 'model');
  assert.equal(launch.runId, 'r-deep');
  assert.equal(launch.requestedRoute, routeKey(decision.chosen));
  assert.equal(modelArgOf(launch), 'explabs/deepseek-v4.1-flash');
  assert.ok(modelArgOf(launch).endsWith('deepseek-v4.1-flash'));
  assert.equal(modelArgOf(launch), decision.chosen.source + '/' + decision.chosen.modelId);
  assert.ok(!launch.args.some((a) => String(a).includes('vinh')), 'no combo name in argv');
});

test('a combo given its own quality is launched as itself, no member score substituted', () => {
  const withQuality = CANDIDATES.map((c) =>
    c.routeKind === 'combo'
      ? Object.assign({}, c, { quality: { score: 99, scale: 'aa-v5-percentile', version: 'v' } })
      : c
  );
  const decision = decide({
    runId: 'r-combo',
    candidates: withQuality,
    request: REQUEST,
    scale: 'aa-v5-percentile',
  });
  assert.equal(decision.chosen.routeKind, 'combo');
  assert.equal(decision.chosen.modelId, 'vinh');

  const launch = buildLaunch(decision, { prefixes: PREFIXES });
  assert.equal(launch.kind, 'combo');
  assert.equal(modelArgOf(launch), 'ninerouter/vinh');
  assert.deepEqual(
    launch.args.filter((a) => a !== '-m'),
    ['ninerouter/vinh']
  );
});

test('9router model ids keep their slashes and case verbatim in the argv', () => {
  const luna = CANDIDATES[0];
  const withQuality = Object.assign({}, luna, {
    quality: { score: 50, scale: 'aa-v5-percentile', version: 'v' },
    budget: { maxOutputTokens: 100000 },
  });
  const decision = decide({
    runId: 'r-slash',
    candidates: [withQuality],
    request: { outputTokens: 1000 },
    scale: 'aa-v5-percentile',
  });
  const launch = buildLaunch(decision, { prefixes: PREFIXES });
  assert.equal(modelArgOf(launch), 'ninerouter/openrouter/openai/gpt-5.6-luna');

  const mixed = Object.assign({}, withQuality, { modelId: 'OpenRouter/OpenAI/GPT-5.6-Luna' });
  const mixedDecision = decide({
    runId: 'r-case',
    candidates: [mixed],
    request: { outputTokens: 1000 },
    scale: 'aa-v5-percentile',
  });
  const mixedLaunch = buildLaunch(mixedDecision, { prefixes: PREFIXES });
  assert.equal(modelArgOf(mixedLaunch), 'ninerouter/OpenRouter/OpenAI/GPT-5.6-Luna');
});

test('agy-pool launches a job that keeps the decided model, account and cwd', () => {
  const agy = CANDIDATES.filter((c) => c.routeKind === 'agy-pool');
  const decision = decide({
    runId: 'r-agy',
    candidates: agy,
    request: { outputTokens: 1000 },
    scale: 'aa-v5-percentile',
  });
  assert.equal(decision.chosen.account, 'acct-A');
  assert.equal(decision.chosen.modelId, 'gemini-3.8-flash-high');

  const launch = buildLaunch(decision, { cwd: 'wt-launch' });
  assert.equal(launch.kind, 'agy-pool');
  assert.equal(launch.command, null);
  assert.deepEqual(Object.keys(launch.job), ['cwd', 'model', 'accountId']);
  assert.deepEqual(launch.job, {
    cwd: 'wt-launch',
    model: 'gemini-3.8-flash-high',
    accountId: 'acct-A',
  });
});

test('agy-pool falls back to the decided cwd and reports BUSY without a job', () => {
  const agy = CANDIDATES.filter((c) => c.routeKind === 'agy-pool');
  const decision = decide({
    runId: 'r-agy2',
    candidates: agy,
    request: { outputTokens: 1000 },
    scale: 'aa-v5-percentile',
  });
  const fallback = buildLaunch(decision, {});
  assert.equal(fallback.job.cwd, decision.chosen.cwd);

  const busy = buildLaunch(decision, { cwd: 'wt-launch', laneBusy: true });
  assert.deepEqual(busy, { status: 'BUSY' });
  assert.equal(busy.job, undefined);
});

test('observed reports UNKNOWN for absent run data and never fakes exit code 0', () => {
  const decision = decide({
    runId: 'r-obs',
    candidates: CANDIDATES,
    request: REQUEST,
    scale: 'aa-v5-percentile',
  });
  const empty = observed(decision, {});
  assert.equal(empty.runId, 'r-obs');
  assert.equal(empty.requestedRoute, routeKey(decision.chosen));
  assert.equal(empty.executedModel, 'UNKNOWN');
  assert.equal(empty.executedAccount, 'UNKNOWN');
  assert.equal(empty.exitCode, 'UNKNOWN');
  assert.notEqual(empty.exitCode, 0);

  const noRun = observed(decision);
  assert.equal(noRun.executedModel, 'UNKNOWN');
  assert.equal(noRun.executedAccount, 'UNKNOWN');
});

test('observed keeps the run values it was given and classifies present failure text', () => {
  const decision = decide({
    runId: 'r-obs2',
    candidates: CANDIDATES,
    request: REQUEST,
    scale: 'aa-v5-percentile',
  });
  const record = observed(decision, {
    executedModel: 'ninerouter/vinh',
    executedAccount: 'acct-X',
    exitCode: 0,
    text: CASES.bracket_error.text,
  });
  assert.equal(record.executedModel, 'ninerouter/vinh');
  assert.equal(record.executedAccount, 'acct-X');
  assert.equal(record.exitCode, 0);
  assert.equal(record.failure.class, 'UPSTREAM_UNAVAILABLE');
});

test('nextDecisionInput drops only the failed route and keeps another account of the same model', () => {
  const base = {
    routeKind: 'agy-pool',
    source: 'agy-pool',
    harness: 'agy',
    modelId: 'gemini-3.8-flash-high',
  };
  const acctA = Object.assign({}, base, {
    account: 'acct-A',
    quality: { score: 52.7, scale: 'aa-v5-percentile', version: 'v' },
  });
  const acctB = Object.assign({}, base, {
    account: 'acct-B',
    quality: { score: 10, scale: 'aa-v5-percentile', version: 'v' },
  });
  const input = {
    runId: 'r-fail',
    candidates: [acctA, acctB],
    request: { outputTokens: 1000 },
    scale: 'aa-v5-percentile',
  };
  const decision = decide(input);
  assert.equal(decision.chosen.account, 'acct-A');

  const failure = classifyFailure(CASES.bracket_error.text);
  assert.equal(failure.class, 'UPSTREAM_UNAVAILABLE');
  const next = nextDecisionInput(input, decision, failure);

  assert.equal(next.candidates.length, 1);
  assert.equal(next.candidates[0].account, 'acct-B');
  assert.equal(
    next.candidates.find((c) => routeKey(c) === routeKey(acctA)),
    undefined
  );
  assert.equal(next.failures.length, 1);
  assert.equal(next.failures[0].routeKey, routeKey(acctA));
  assert.equal(next.failures[0].failure.class, 'UPSTREAM_UNAVAILABLE');
  assert.deepEqual(next.request, input.request);
  assert.equal(next.scale, input.scale);

  // The same model on another account is still usable on the next decide call.
  assert.equal(decide(next).chosen.account, 'acct-B');
});

test('decide requires a numeric now when a state carries a cooldownUntil', () => {
  const candidate = CANDIDATES[2];
  const base = {
    runId: 'r-now',
    candidates: [candidate],
    request: { outputTokens: 1000 },
    scale: 'aa-v5-percentile',
  };
  const cooldown = { [routeKey(candidate)]: { cooldownUntil: '2099-01-01T00:00:00Z' } };

  const missing = decide(Object.assign({}, base, { states: cooldown }));
  assert.equal(missing.status, 'BLOCKED');
  assert.ok(missing.reasons.includes('NOW_REQUIRED'));

  const notNumber = decide(Object.assign({}, base, { states: cooldown, now: 'not-a-number' }));
  assert.equal(notNumber.status, 'BLOCKED');
  assert.ok(notNumber.reasons.includes('NOW_REQUIRED'));

  const past = { [routeKey(candidate)]: { cooldownUntil: '2000-01-01T00:00:00Z' } };
  const allowed = decide(Object.assign({}, base, { states: past, now: 1700000000000 }));
  assert.equal(allowed.status, 'DECIDED');
});

test('a non-decided decision has no command and an unsupported route is refused', () => {
  const blocked = decide({
    runId: 'r-none',
    candidates: CANDIDATES,
    request: REQUEST,
    scale: 'no-such-scale',
  });
  assert.equal(blocked.status, 'BLOCKED');
  assert.deepEqual(buildLaunch(blocked, {}), { status: 'BLOCKED' });

  const wrongHarness = {
    status: 'DECIDED',
    runId: 'r-uns',
    chosen: { routeKind: 'model', source: 's', harness: 'hermes', modelId: 'm', account: null },
  };
  assert.deepEqual(buildLaunch(wrongHarness, {}), {
    status: 'BLOCKED',
    reason: 'UNSUPPORTED_ROUTE',
  });

  const badKind = {
    status: 'DECIDED',
    runId: 'r-bad',
    chosen: { routeKind: 'shadow', source: 's', harness: 'opencode', modelId: 'm', account: null },
  };
  assert.deepEqual(buildLaunch(badKind, {}), { status: 'BLOCKED', reason: 'UNSUPPORTED_ROUTE' });
});
