'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchFromDecision, firstLaunch, afterFailure } = require('../route-handoff');
const { getQuotaScopeState, isScopeBlocked } = require('../quota-scan');
const { recordProbe, loadEvidence, Level, Status } = require('../evidence');
const { createWorktreeClaim } = require('./helpers/worktree-claim');

const claimHelper = createWorktreeClaim();
after(() => {
  claimHelper.cleanup();
  assert.equal(fs.existsSync(claimHelper.root), false);
  assert.equal(fs.existsSync(claimHelper.claim.lockFile), false);
});

const registry = {
  sources: [{ id: 'gw', kind: 'router', servesModels: true, endpoint: 'http://127.0.0.1:1/v1' }],
  dispatch: {
    providers: { gw: { harness: 'paseo', provider: 'opencode', modelPrefix: 'gateway/' } },
  },
};
const route = {
  offeringId: 'route-a',
  harness: 'paseo',
  gateway: 'gw',
  upstream: 'vendor',
  accountId: 'acct',
  quotaScope: 'acct',
  modelId: 'vendor/org/model-a',
};
const request = {
  prompt: 'p',
  branch: 'b',
  base: 'origin/main',
  cwd: claimHelper.worktree,
  title: 't',
};

test('the argv keeps the gateway and the full model of the decision', () => {
  const decision = { selected: 'route-a', candidates: [route] };
  const { args } = launchFromDecision(decision, request, registry);
  assert.equal(args[args.indexOf('--provider') + 1], 'opencode');
  assert.equal(args[args.indexOf('--model') + 1], 'gateway/vendor/org/model-a');
  assert.equal(args[args.indexOf('--base') + 1], 'origin/main');
});

test('an offering can be named, but only one the decision holds', () => {
  const decision = { selected: 'route-a', candidates: [route] };
  assert.throws(
    () => launchFromDecision(decision, { ...request, offeringId: 'other' }, registry),
    /DECISION_ROUTE_MISSING/
  );
});

test('a route with no dispatch row is refused, not launched as a bare model', () => {
  const lost = { ...route, harness: undefined, gateway: '', upstream: 'unknown' };
  assert.throws(
    () => launchFromDecision({ selected: 'route-a', candidates: [lost] }, request, registry),
    /DECISION_ROUTE_UNRESOLVED/
  );
});

test('an explicit harness cannot bypass a missing dispatch row', () => {
  const lost = { ...route, gateway: '', upstream: 'unknown' };
  assert.throws(
    () => launchFromDecision({ selected: lost.offeringId, candidates: [lost] }, request, registry),
    /DECISION_ROUTE_UNRESOLVED/
  );
});

const screened = {
  sources: [...registry.sources, { id: 'cli', kind: 'agent-cli' }],
  dispatch: {
    launchModes: { opencode: ['full-access'], claude: ['auto'] },
    providers: {
      ...registry.dispatch.providers,
      cli: { harness: 'paseo', provider: 'claude' },
    },
  },
};
const offering = (id, over) => ({ ...route, offeringId: id, modelId: 'vendor/' + id, ...over });
const proof = (c, proofLevel) => ({
  harness: c.harness,
  accessPath: c.accessPath,
  modelId: c.modelId,
  gateway: c.gateway,
  upstream: c.upstream,
  accountId: c.accountId,
  quotaScope: c.quotaScope,
  evidence: [{ status: 'passed', proofLevel, observedAt: new Date(0).toISOString() }],
});
const ticket = () => ({
  workItemId: 'ITEM-1',
  outputTokens: 32000,
  minProof: 'HARNESS_PASS',
  maxFallbacks: 1,
  request,
});
const decided = (...candidates) => ({
  workItemId: 'ITEM-1',
  selected: candidates[0].offeringId,
  candidates,
});
const proved = (...candidates) => ({
  evidenceData: { combinations: candidates.map((c) => proof(c, 'HARNESS_PASS')) },
  ledger: {},
  ...claimHelper.context,
});

test('passed execution proof loaded from the Controller store qualifies its route', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-handoff-proof-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const a = offering('stored', { accessPath: 'gateway' });
  recordProbe(dir, a, { status: Status.PASSED, level: Level.HARNESS });
  const evidenceData = loadEvidence(dir);
  assert.equal(evidenceData.combinations[0].model, a.modelId);
  assert.equal(evidenceData.combinations[0].evidence[0].proofLevel, 'HARNESS_PASS');
  const out = firstLaunch(
    decided(a),
    ticket(),
    { evidenceData, ledger: {}, ...claimHelper.context },
    screened
  );
  assert.equal(out.action, 'LAUNCH');
  assert.equal(out.launch.offeringId, a.offeringId);
});

for (const status of [Status.FAILED, Status.UNKNOWN, undefined]) {
  test('execution proof with status ' + status + ' does not qualify a route', () => {
    const a = offering('a');
    const ctx = proved(a);
    ctx.evidenceData.combinations[0].evidence = [
      { status, level: Level.HARNESS, proofLevel: 'HARNESS_PASS' },
    ];
    const out = firstLaunch(decided(a), ticket(), ctx, screened);
    assert.equal(out.action, 'BLOCKED');
    assert.equal(out.rejected[0].reason, 'PROOF_BELOW_TICKET:NONE');
  });
}

test('failed stronger proof cannot promote passed API proof to execution proof', () => {
  const a = offering('a');
  const ctx = proved(a);
  const items = [
    { status: Status.FAILED, proofLevel: 'WORK_ITEM_PASS' },
    { status: Status.PASSED, proofLevel: 'API_PASS' },
  ];
  ctx.evidenceData.combinations[0].evidence = items;
  const out = firstLaunch(decided(a), ticket(), ctx, screened);
  assert.equal(out.action, 'BLOCKED');
  assert.equal(out.rejected[0].reason, 'PROOF_BELOW_TICKET:API_PASS');
  items.push({ status: Status.PASSED, proofLevel: 'HARNESS_PASS' });
  assert.equal(firstLaunch(decided(a), ticket(), ctx, screened).action, 'LAUNCH');
});

test('an unknown harness is refused and the next eligible route launches', () => {
  const a = offering('a', { harness: 'unknown-harness' });
  const b = offering('b');
  const ctx = proved(a, b);
  const out = firstLaunch(decided(a, b), ticket(), ctx, screened);
  assert.equal(out.action, 'LAUNCH');
  assert.equal(out.launch.offeringId, b.offeringId);
  assert.equal(out.launch.harness, b.harness);
  assert.deepStrictEqual(out.rejected, [
    { offeringId: a.offeringId, reason: 'LAUNCHER_UNAVAILABLE' },
  ]);
  const blocked = firstLaunch(decided(a), ticket(), ctx, screened);
  assert.equal(blocked.action, 'BLOCKED');
  assert.deepStrictEqual(blocked.rejected, out.rejected);
});

test('active quota auth blocks refuse launch until retryAfter expires', () => {
  const a = offering('a');
  const ctx = {
    ...proved(a),
    now: 1000,
    quotaState: {
      scopes: { [a.quotaScope]: { code: 'AUTH', status: 401, retryAfter: 2000 } },
    },
  };
  const entry = getQuotaScopeState(a, ctx.quotaState, { now: ctx.now, registry: screened });
  assert.equal(isScopeBlocked(entry, ctx.now), true);
  const out = firstLaunch(decided(a), ticket(), ctx, screened);
  assert.equal(out.action, 'BLOCKED');
  assert.equal(out.rejected[0].reason, 'QUOTA_BLOCKED');
  ctx.now = 2000;
  assert.equal(firstLaunch(decided(a), ticket(), ctx, screened).action, 'LAUNCH');
});

test('the screened ticket mode reaches first and fallback launches', () => {
  const a = offering('a', { gateway: '', upstream: 'cli' });
  const b = offering('b', { gateway: '', upstream: 'cli' });
  const ctx = proved(a, b);
  const work = { ...ticket(), mode: 'auto', request: { ...request, mode: 'full-access' } };
  const decision = decided(a, b);
  const first = firstLaunch(decision, work, ctx, screened);
  assert.equal(first.action, 'LAUNCH');
  assert.equal(first.launch.args[first.launch.args.indexOf('--mode') + 1], work.mode);
  const fallback = afterFailure(
    decision,
    work,
    ctx,
    { offeringId: a.offeringId, status: 500, phase: 'after-launch', workerStopped: true },
    screened
  );
  assert.equal(fallback.action, 'LAUNCH');
  assert.equal(fallback.launch.args[fallback.launch.args.indexOf('--mode') + 1], work.mode);
});

for (const field of ['harness', 'accessPath', 'upstream', 'quotaScope']) {
  test('proof for another ' + field + ' cannot qualify the execution route', () => {
    const a = offering('a', { accessPath: 'gateway' });
    const ctx = proved({ ...a, [field]: 'another-route' });
    const out = firstLaunch(decided(a), ticket(), ctx, screened);
    assert.equal(out.action, 'BLOCKED');
    assert.equal(out.rejected[0].reason, 'PROOF_BELOW_TICKET:NONE');
    assert.equal(firstLaunch(decided(a), ticket(), proved(a), screened).action, 'LAUNCH');
  });
}

test('screening refuses an unknown dispatch provider even with an explicit harness', () => {
  const a = offering('a', { gateway: '', upstream: 'unknown' });
  const reg = {
    ...screened,
    dispatch: { ...screened.dispatch, launchModes: { unknown: ['full-access'] } },
  };
  const out = firstLaunch(decided(a), ticket(), proved(a), reg);
  assert.equal(out.action, 'BLOCKED');
  assert.equal(out.rejected[0].reason, 'LAUNCHER_UNAVAILABLE');
});

test('a valid route keeps its exact argv', () => {
  const a = offering('a');
  const out = firstLaunch(decided(a), ticket(), proved(a), screened);
  assert.equal(out.action, 'LAUNCH');
  const { args } = out.launch;
  assert.equal(args[args.indexOf('--model') + 1], 'gateway/vendor/a');
  assert.equal(args[args.indexOf('--mode') + 1], 'full-access');
});

test('an incompatible launcher flag is stopped before any call', () => {
  const a = offering('a', { gateway: '', upstream: 'cli' });
  const out = firstLaunch(decided(a), ticket(), proved(a), screened);
  assert.equal(out.action, 'BLOCKED');
  assert.equal(out.rejected[0].reason, 'LAUNCH_MODE_UNSUPPORTED');
});

test('a ping pass does not qualify a route for work', () => {
  const a = offering('a');
  const ctx = {
    evidenceData: { combinations: [proof(a, 'API_PASS')] },
    ledger: {},
    ...claimHelper.context,
  };
  const out = firstLaunch(decided(a), ticket(), ctx, screened);
  assert.equal(out.action, 'BLOCKED');
  assert.equal(out.rejected[0].reason, 'PROOF_BELOW_TICKET:API_PASS');
});

test('402 is never resent and refuses the same wallet for this request size', () => {
  const a = offering('a', { upstream: 'paid' });
  const same = offering('b', { upstream: 'paid' });
  const other = offering('c', { upstream: 'free' });
  const failure = {
    offeringId: 'a',
    upstream: 'paid',
    status: 402,
    affordable: 592,
    workerStopped: true,
  };
  const ctx = proved(a, same, other);
  const out = afterFailure(decided(a, same, other), ticket(), ctx, failure, screened);
  assert.equal(out.launch.offeringId, 'c');
  assert.deepStrictEqual(
    out.rejected.map((r) => r.reason),
    ['ALREADY_FAILED:NO_CREDIT', 'BUDGET_BELOW_REQUEST']
  );
});

test('429 avoids the limited upstream and takes an eligible route', () => {
  const a = offering('a', { upstream: 'busy' });
  const same = offering('b', { upstream: 'busy' });
  const other = offering('c', { upstream: 'free' });
  const failure = { offeringId: 'a', upstream: 'busy', status: 429, workerStopped: true };
  const ctx = proved(a, same, other);
  const out = afterFailure(decided(a, same, other), ticket(), ctx, failure, screened);
  assert.equal(out.launch.offeringId, 'c');
  assert.equal(out.rejected[1].reason, 'UPSTREAM_RATE_LIMITED');
});

test('one fallback is the ceiling for the ticket, across routes', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((id) => offering(id, { upstream: id }));
  const ctx = proved(a, b, c);
  const decision = decided(a, b, c);
  const fail = (id, status) => ({ offeringId: id, upstream: id, status, workerStopped: true });
  const first = afterFailure(decision, ticket(), ctx, fail('a', 429), screened);
  assert.equal(first.launch.offeringId, 'b');
  const second = afterFailure(decision, ticket(), ctx, fail('b', 500), screened);
  assert.deepStrictEqual(
    { action: second.action, reason: second.reason },
    { action: 'STOP', reason: 'FALLBACK_LIMIT' }
  );
});

test('no eligible route left means BLOCKED, without spending the fallback', () => {
  const a = offering('a');
  const ctx = proved(a);
  const failure = { offeringId: 'a', upstream: 'vendor', status: 429, workerStopped: true };
  const out = afterFailure(decided(a), ticket(), ctx, failure, screened);
  assert.equal(out.action, 'BLOCKED');
  assert.equal(ctx.ledger.fallbacksUsed, undefined);
});

test('a decision made for another ticket is refused, whatever routes it holds', () => {
  const a = offering('a');
  const decision = { ...decided(a), workItemId: 'ITEM-2' };
  const out = firstLaunch(decision, ticket(), proved(a), screened);
  assert.deepStrictEqual(
    { action: out.action, reason: out.reason },
    { action: 'BLOCKED', reason: 'DECISION_FOR_OTHER_TICKET' }
  );
});

test('429 takes the one fallback in the same worktree, then 402 stops and keeps it', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((id) => offering(id, { upstream: id }));
  const ctx = proved(a, b, c);
  const decision = decided(a, b, c);
  const worktree = claimHelper.worktree;
  const first = afterFailure(
    decision,
    ticket(),
    ctx,
    { offeringId: 'a', upstream: 'a', status: 429, worktree, workerStopped: true },
    screened
  );
  const { args } = first.launch;
  assert.equal(first.action, 'LAUNCH');
  assert.equal(first.launch.offeringId, 'b');
  assert.equal(args[args.indexOf('--cwd') + 1], worktree);
  assert.ok(!args.includes('--new-workspace'));
  const second = afterFailure(
    decision,
    ticket(),
    ctx,
    { offeringId: 'b', upstream: 'b', status: 402, workerStopped: true },
    screened
  );
  assert.deepStrictEqual(second, {
    action: 'STOP',
    reason: 'FALLBACK_LIMIT',
    used: 1,
    worktree,
  });
  assert.deepStrictEqual(
    ctx.ledger.failures.map((x) => x.class),
    ['RATE_LIMITED', 'NO_CREDIT']
  );
});

test('sibling worktree helpers isolate runtime cleanup and preserve parent fixtures', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-sibling-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const unrelated = path.join(parent, 'keep.txt');
  fs.writeFileSync(unrelated, 'ok');
  const h1 = createWorktreeClaim({ worktree: path.join(parent, 'wt1') });
  const h2 = createWorktreeClaim({ worktree: path.join(parent, 'wt2') });
  t.after(h2.cleanup);
  h1.cleanup();
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'ok');
  assert.equal(h2.verifyWorktreeClaim(h2.worktree, h2.claim).ok, true);
  assert.equal(fs.existsSync(h1.runtimeDir), false);
});
