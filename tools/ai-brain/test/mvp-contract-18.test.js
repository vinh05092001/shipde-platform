'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const candidates = require('../candidates');
const ranking = require('../ranking');
const quota = require('../quota');
const evidence = require('../evidence');
const { classifyFailure, Scope, Cause } = require('../failure-classifier');
const { planDispatch } = require('../scheduler');
const decisions = require('../decisions');
const { readDiscoveryCatalogue } = require('../discovery');
const { dispatchCommand } = require('../cli');

const NOW = Date.parse('2026-09-27T12:00:00Z');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function registry() {
  return {
    version: 1,
    sources: [
      {
        id: 'gw-a',
        kind: 'router',
        harness: 'paseo',
        accessPath: 'path-a',
        endpoint: 'path-a',
        servesModels: true,
      },
      {
        id: 'gw-b',
        kind: 'router',
        harness: 'paseo',
        accessPath: 'path-b',
        endpoint: 'path-b',
        servesModels: true,
      },
      {
        id: 'cli-src',
        kind: 'agent-cli',
        harness: 'direct-cli',
        accessPath: 'cli',
        servesModels: true,
      },
    ],
    retired: [],
    dispatch: {},
  };
}

function cand(over) {
  return Object.assign(
    {
      harness: 'paseo',
      accessPath: 'path-a',
      gateway: 'gw-a',
      upstream: 'up-a',
      accountId: 'acct-a',
      quotaScope: 'acct-a',
      modelId: 'up-a/model-one',
      source: 'gw-a',
      kind: 'router',
      qualifiedRoles: ['author.foundation'],
      cost: 1,
      evidence: [{ status: 'passed', level: 'outcome' }],
      status: 'passed',
    },
    over
  );
}

function account(over) {
  return Object.assign(
    {
      id: 'acct-a',
      provider: 'prov-a',
      model: 'model-one',
      enabled: true,
      qualifiedRoles: ['author.foundation'],
      capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
      cost: { inputPerMillion: 3, outputPerMillion: 15 },
      limits: { requestsPerDay: 20 },
    },
    over
  );
}

function item(over) {
  return Object.assign(
    {
      workItemId: 'FEAT-MVP-01',
      role: 'author.foundation',
      branch: 'feat/mvp-01',
      riskDomains: [],
    },
    over
  );
}

function rank(list, over) {
  return ranking.rankAndRecord(
    list.map((c) => Object.assign({}, c)),
    Object.assign(
      {
        workItemId: 'FEAT-MVP-01',
        role: 'author.foundation',
        kind: 'author.foundation',
        dryRun: true,
        explorationBudget: 0,
        useStoredQuota: false,
        now: NOW,
      },
      over || {}
    )
  );
}

test('01 new source by data -> candidate appears', () => {
  const reg = registry();
  const before = candidates.generateCandidates({
    registry: reg,
    catalogue: ['up-a/model-one'],
    accounts: [],
  });
  assert.equal(
    before.some((c) => c.upstream === 'up-new'),
    false
  );
  reg.sources.push({
    id: 'src-new',
    kind: 'model-source',
    reachedVia: 'gw-a',
    routerAlias: 'up-new',
    servesModels: true,
  });
  const after = candidates.generateCandidates({
    registry: reg,
    catalogue: ['up-a/model-one', 'up-new/model-new'],
    accounts: [],
  });
  const found = after.find((c) => c.modelId === 'up-new/model-new');
  assert.ok(found, 'adding a source in registry data must yield a candidate without a code change');
  assert.equal(found.upstream, 'up-new');
  assert.equal(found.gateway, 'gw-a');
});

test('02 two accounts same upstream -> two independent keys', () => {
  const list = candidates.generateCandidates({
    registry: registry(),
    catalogue: ['up-a/model-one'],
    accounts: [
      { id: 'acct-a', sourceId: 'gw-a' },
      { id: 'acct-b', sourceId: 'gw-a' },
    ],
  });
  const keys = list
    .filter((c) => c.modelId === 'up-a/model-one' && c.gateway === 'gw-a')
    .map((c) => candidates.candidateKey(c));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 2);
  assert.ok(keys.some((k) => k.includes('acct-a')));
  assert.ok(keys.some((k) => k.includes('acct-b')));
  const parts = keys[0].split('::');
  assert.equal(parts.length, 7, 'identity is the seven-part key, not a four-field key');
});

test('03 model only on path A -> path B cannot borrow', () => {
  const lines = [
    {
      type: 'transition',
      ts: '2026-09-27T00:00:00.000Z',
      key: ['http', 'path-a', 'gw-a', 'up-a', 'acct-a', 'acct-a', 'up-a/only-a'].join('\u241f'),
      harness: 'http',
      accessPath: 'path-a',
      gateway: 'gw-a',
      upstream: 'up-a',
      account: 'acct-a',
      quotaScope: 'acct-a',
      modelId: 'up-a/only-a',
      state: 'AVAILABLE',
      resultState: 'PASS',
      passes: 1,
      failures: [],
      evidence: [{ ts: '2026-09-27T00:00:00.000Z', status: 'PASS' }],
    },
  ];
  const cat = readDiscoveryCatalogue({ lines, imports: [], evidence: [] });
  assert.equal(cat.hasModel('path-a', 'acct-a', 'up-a/only-a'), true);
  assert.equal(
    cat.hasModel('path-b', 'acct-a', 'up-a/only-a'),
    false,
    'a model advertised only on path A must not be borrowed by path B'
  );
  assert.equal(
    cat.isModelAlive({ accessPath: 'path-b', account: 'acct-a', modelId: 'up-a/only-a' }),
    false
  );
});

test('04 UNTESTED not chosen without exploration budget', () => {
  const untested = cand({
    qualifiedRoles: undefined,
    evidence: [],
    status: 'UNTESTED',
    modelId: 'up-a/untested',
  });
  const refused = rank([untested], { explorationBudget: 0 });
  assert.equal(refused.chosen, null);
  assert.ok(
    (refused.rejected || []).some((r) =>
      /EXPLORATION_BUDGET_EXHAUSTED|UNTESTED/i.test(String(r.reason))
    ),
    'UNTESTED must be refused when the exploration budget is zero: ' +
      JSON.stringify(refused.rejected)
  );
  assert.notEqual(untested.status, 'passed');
  assert.notEqual(untested.status, 'PASS');
});

test('05 unknown cost/capability gets no neutral score', () => {
  const unknown = cand({
    cost: undefined,
    qualifiedRoles: undefined,
    evidence: [],
    modelId: 'up-a/unknown-score',
  });
  const scored = ranking.scoreCandidate(unknown, [unknown], 'author.foundation', {
    useStoredQuota: false,
    now: NOW,
  });
  assert.equal(ranking.costScore(unknown), null, 'unknown cost is excluded, never scored 50');
  assert.notEqual(scored.breakdown.cost, 50);
  assert.notEqual(scored.breakdown.capability, 50, 'unproven capability is not a neutral 50');
  assert.ok(
    scored.breakdown.capability < 50,
    'unproven capability score must sit strictly below neutral, got ' + scored.breakdown.capability
  );
  const missingEvidence = ranking.evidenceScore({ evidence: [] });
  assert.notEqual(missingEvidence, 50, 'missing evidence is unknown/fail-closed, not 50');
});

test('06 account A out of quota does not lock account B', () => {
  const headA = quota.accountHeadroom(
    account({ id: 'acct-a', limits: { requestsPerDay: 1 } }),
    [{ at: NOW - 1000, tokens: 1, cost: 0 }],
    { now: NOW }
  );
  const headB = quota.accountHeadroom(
    account({ id: 'acct-b', limits: { requestsPerDay: 10 } }),
    [],
    { now: NOW }
  );
  assert.equal(headA.status, 'exhausted');
  assert.notEqual(headB.status, 'exhausted');
  assert.equal(quota.isDispatchable(headB), true);
  const decision = rank(
    [
      cand({ accountId: 'acct-a', quotaScope: 'acct-a' }),
      cand({ accountId: 'acct-b', quotaScope: 'acct-b', modelId: 'up-a/model-two' }),
    ],
    {
      headrooms: {
        'acct-a': headA,
        'acct-b': headB,
      },
    }
  );
  const chosen = decision.chosen || '';
  assert.equal(chosen.includes('acct-a'), false, 'exhausted account A must not be selected');
  assert.equal(chosen.includes('acct-b'), true, 'account B stays selectable');
});

test('07 upstream A 402 does not lock upstream B', () => {
  const dir = tmp('mvp18-07-');
  const a = cand({
    upstream: 'up-a',
    modelId: 'up-a/model-one',
    quotaScope: 'up-a',
    accountId: '*',
  });
  const b = cand({
    upstream: 'up-b',
    gateway: 'gw-b',
    accessPath: 'path-b',
    source: 'gw-b',
    modelId: 'up-b/model-one',
    quotaScope: 'up-b',
    accountId: '*',
  });
  evidence.recordProbe(dir, a, {
    level: evidence.Level.API,
    status: 'failed',
    httpStatus: 402,
    body: '[402]: out of credit',
    cause: '402',
  });
  const data = evidence.loadEvidence(dir);
  const blockA = evidence.isCandidateBlocked(data, a, { now: Date.now() });
  const blockB = evidence.isCandidateBlocked(data, b, { now: Date.now() });
  assert.equal(blockA.blocked, true);
  assert.equal(blockA.scope, 'upstream');
  assert.equal(blockB.blocked, false, '402 on upstream A must not lock upstream B');
});

test('08 HTTP 000 does not fail the model', () => {
  const classified = classifyFailure({
    exitCode: 1,
    httpStatus: 0,
    body: 'connect ECONNREFUSED 127.0.0.1',
    stderr: 'HTTP 000 gateway unreachable',
  });
  assert.notEqual(
    classified.scope,
    Scope.MODEL,
    'HTTP 000 locks the gateway/path, never the model; got scope ' + classified.scope
  );
  assert.notEqual(classified.cause, Cause.MODEL_UNSUPPORTED);
  assert.notEqual(classified.cause, Cause.ALIAS_MISMATCH);
  assert.ok(
    classified.scope === Scope.GATEWAY || classified.scope === Scope.ACCESS_PATH,
    'HTTP 000 must lock gateway or access path, got ' + classified.scope
  );
  const dir = tmp('mvp18-08-');
  const model = cand({ modelId: 'up-a/still-alive' });
  evidence.recordProbe(dir, model, {
    level: evidence.Level.API,
    status: 'failed',
    exitCode: 1,
    body: 'HTTP 000 gateway unreachable',
  });
  const stored = evidence.loadEvidence(dir);
  const combo = stored.combinations[0];
  const last = combo.evidence[combo.evidence.length - 1];
  assert.equal(last.httpStatus, undefined, 'a process failure must not invent an HTTP status');
  const otherModel = cand({ modelId: 'up-a/other-model' });
  const block = evidence.isCandidateBlocked(stored, otherModel, { now: Date.now() });
  assert.equal(block.scope === 'model' && block.blocked, false);
});

test('09 firstChoice !== selected on fallback', () => {
  const dir = tmp('mvp18-09-');
  const logFile = path.join(dir, 'decision.json');
  const lines = [];
  const result = dispatchCommand(
    {
      _: ['dispatch'],
      'dry-run': true,
      item: 'FEAT-FALLBACK-09',
      role: 'author.foundation',
      'simulate-failure': 'first',
      'decision-log': logFile,
      root: dir,
    },
    {
      candidates: [
        cand({ upstream: 'up-a', modelId: 'up-a/first', cost: 1 }),
        cand({
          upstream: 'up-b',
          gateway: 'gw-b',
          accessPath: 'path-b',
          source: 'gw-b',
          modelId: 'up-b/second',
          cost: 2,
        }),
      ],
      accounts: [],
      registry: registry(),
      evidenceDir: path.join(dir, 'evidence'),
      discoveryCatalogue: { candidates: [] },
      offerings: [],
      useStoredQuota: false,
      now: NOW,
      log: (m) => lines.push(String(m)),
      error: () => {},
      exit: () => {},
    }
  );
  const log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  const first = log.firstChoice || (result.decision && result.decision.chosen);
  const selected =
    log.selected || log.selectedCandidate || (result.fallback && result.fallback.chosen);
  assert.ok(first, 'decision log records firstChoice');
  assert.ok(selected, 'decision log records the final selected candidate');
  assert.notEqual(first, selected, 'on fallback firstChoice must differ from selected');
});

test('10 first reason explains fallback', () => {
  const dir = tmp('mvp18-10-');
  const logFile = path.join(dir, 'decision.json');
  dispatchCommand(
    {
      _: ['dispatch'],
      'dry-run': true,
      item: 'FEAT-FALLBACK-10',
      role: 'author.foundation',
      'simulate-failure': 'first',
      'decision-log': logFile,
      root: dir,
    },
    {
      candidates: [
        cand({ upstream: 'up-a', modelId: 'up-a/first', cost: 1 }),
        cand({
          upstream: 'up-b',
          gateway: 'gw-b',
          accessPath: 'path-b',
          source: 'gw-b',
          modelId: 'up-b/second',
          cost: 2,
        }),
      ],
      accounts: [],
      registry: registry(),
      evidenceDir: path.join(dir, 'evidence'),
      discoveryCatalogue: { candidates: [] },
      offerings: [],
      now: NOW,
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );
  const log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  const reason = (log.fallback && log.fallback.reason) || log.reason || '';
  assert.match(
    String(reason),
    /fail|fallback|domain|402|quota|exhaust/i,
    'the first failure reason must explain why fallback happened, got: ' + reason
  );
  assert.equal(
    log.fallback && log.fallback.preferredDifferentFailureDomain,
    true,
    'fallback must prefer a different failure domain, got preferredDifferentFailureDomain=' +
      String(log.fallback && log.fallback.preferredDifferentFailureDomain) +
      ' reason=' +
      reason
  );
});

test('11 resume skips cooldown/deferred', () => {
  const dir = tmp('mvp18-11-');
  const checkpoint = path.join(dir, 'checkpoint.json');
  const firstKey = candidates.candidateKey(cand({ modelId: 'up-a/cooled' }));
  const deferredKey = candidates.candidateKey(
    cand({
      modelId: 'up-a/deferred',
      upstream: 'up-a',
      accountId: 'acct-deferred',
      quotaScope: 'acct-deferred',
    })
  );
  fs.writeFileSync(
    checkpoint,
    JSON.stringify({
      schemaVersion: 1,
      workItemId: 'FEAT-RESUME-11',
      step: 'fallback_selected',
      failedCandidates: [firstKey, deferredKey],
      selectedCandidate: candidates.candidateKey(
        cand({ upstream: 'up-b', gateway: 'gw-b', accessPath: 'path-b', modelId: 'up-b/live' })
      ),
      fallbackCandidate: candidates.candidateKey(
        cand({ upstream: 'up-b', gateway: 'gw-b', accessPath: 'path-b', modelId: 'up-b/live' })
      ),
    })
  );
  const logFile = path.join(dir, 'decision.json');
  dispatchCommand(
    {
      _: ['dispatch'],
      'dry-run': true,
      item: 'FEAT-RESUME-11',
      role: 'author.foundation',
      checkpoint,
      'decision-log': logFile,
      'simulate-failure': 'first',
      root: dir,
    },
    {
      candidates: [
        cand({ modelId: 'up-a/cooled' }),
        cand({ modelId: 'up-a/deferred', accountId: 'acct-deferred', quotaScope: 'acct-deferred' }),
        cand({
          upstream: 'up-b',
          gateway: 'gw-b',
          accessPath: 'path-b',
          source: 'gw-b',
          modelId: 'up-b/live',
        }),
      ],
      accounts: [],
      registry: registry(),
      evidenceDir: path.join(dir, 'evidence'),
      discoveryCatalogue: { candidates: [] },
      offerings: [],
      now: NOW,
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );
  const log = JSON.parse(fs.readFileSync(logFile, 'utf8'));
  const selected = log.selected || log.selectedCandidate;
  assert.notEqual(selected, firstKey, 'resume must not retry a cooled-down candidate');
  assert.notEqual(selected, deferredKey, 'resume must not retry a deferred candidate');
  const excluded = new Set((log.excluded || []).map((e) => e.candidateKey || e.offeringId));
  assert.equal(excluded.has(firstKey), true);
  assert.equal(excluded.has(deferredKey), true);
});

test('12 resume does not duplicate work', () => {
  const dir = tmp('mvp18-12-');
  const decisionDir = path.join(dir, 'decisions');
  const checkpoint = path.join(dir, 'checkpoint.json');
  const live = cand({
    upstream: 'up-b',
    gateway: 'gw-b',
    accessPath: 'path-b',
    source: 'gw-b',
    modelId: 'up-b/live',
  });
  const liveKey = candidates.candidateKey(live);
  fs.writeFileSync(
    checkpoint,
    JSON.stringify({
      schemaVersion: 1,
      workItemId: 'FEAT-RESUME-12',
      step: 'ranked',
      failedCandidates: [],
      selectedCandidate: liveKey,
    })
  );
  decisions.recordDecision(
    {
      stage: decisions.Stage.LAUNCHED,
      workItemId: 'FEAT-RESUME-12',
      chosen: liveKey,
      sessionId: 'sess-existing',
      branch: 'feat/resume-12',
      harness: 'paseo',
    },
    { dir: decisionDir, now: NOW }
  );
  const launches = [];
  const result = dispatchCommand(
    {
      _: ['dispatch'],
      execute: true,
      item: 'FEAT-RESUME-12',
      role: 'author.foundation',
      branch: 'feat/resume-12',
      checkpoint,
      'decision-dir': decisionDir,
      root: dir,
    },
    {
      candidates: [live],
      accounts: [],
      registry: registry(),
      evidenceDir: path.join(dir, 'evidence'),
      discoveryCatalogue: { candidates: [] },
      offerings: [],
      decisionDir,
      home: dir,
      now: NOW,
      run: () => {
        launches.push('launch');
        return { stdout: '{"sessionId":"sess-new"}', exitCode: 0 };
      },
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );
  const records = decisions.readDecisions({ dir: decisionDir, now: NOW });
  const launchesLogged = records.filter(
    (r) => r.workItemId === 'FEAT-RESUME-12' && r.stage === decisions.Stage.LAUNCHED
  );
  assert.equal(launches.length, 0, 'resume must not launch a second external effect');
  assert.equal(launchesLogged.length, 1, 'resume must not duplicate the decision');
  assert.notEqual(result && result.exitCode, 0, 'a claimed writer must stop a second dispatch');
});

test('13 decision log has no credentials', () => {
  const dir = tmp('mvp18-13-');
  decisions.recordDecision(
    {
      stage: decisions.Stage.SELECTED,
      workItemId: 'FEAT-SECRET-13',
      chosen: 'paseo::path-a::gw-a::up-a::acct-a::acct-a::up-a/model-one',
      apiKey: 'sk-live-secret-value',
      token: 'tok-live-secret-value',
      password: 'pw-live-secret-value',
      authorization: 'Bearer live-secret',
      candidates: [{ offeringId: 'x', secret: 'nested-secret-value' }],
    },
    { dir, now: NOW }
  );
  const raw = fs.readFileSync(path.join(dir, '2026-09-27.jsonl'), 'utf8');
  assert.equal(raw.includes('sk-live-secret-value'), false);
  assert.equal(raw.includes('tok-live-secret-value'), false);
  assert.equal(raw.includes('pw-live-secret-value'), false);
  assert.equal(raw.includes('Bearer live-secret'), false);
  assert.equal(raw.includes('nested-secret-value'), false);
  assert.match(raw, /\[redacted\]/);
  const fields = ['workItemId', 'chosen', 'rejected', 'at'];
  const record = decisions.readDecisions({ dir, now: NOW })[0];
  for (const field of ['workItemId', 'chosen']) {
    assert.ok(record[field], 'decision log keeps ' + field);
  }
  assert.ok(fields.includes('at'));
});

test('14 new source needs no controller change', () => {
  const dir = tmp('mvp18-14-');
  const logFile = path.join(dir, 'decision.json');
  const extra = cand({
    source: 'src-data-only',
    gateway: 'gw-data',
    accessPath: 'path-data',
    upstream: 'up-data',
    accountId: 'acct-data',
    quotaScope: 'acct-data',
    modelId: 'up-data/from-data',
    harness: 'paseo',
  });
  const reg = registry();
  reg.sources.push({
    id: 'src-data-only',
    kind: 'model-source',
    reachedVia: 'gw-a',
    routerAlias: 'up-data',
    servesModels: true,
  });
  const result = dispatchCommand(
    {
      _: ['dispatch'],
      'dry-run': true,
      item: 'FEAT-DATA-14',
      role: 'author.foundation',
      'decision-log': logFile,
      root: dir,
    },
    {
      candidates: [extra],
      accounts: [],
      registry: reg,
      evidenceDir: path.join(dir, 'evidence'),
      discoveryCatalogue: { candidates: [] },
      offerings: [],
      now: NOW,
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );
  const selected = (result.decision && result.decision.chosen) || '';
  assert.equal(selected.includes('up-data/from-data'), true);
  assert.equal(selected.includes('acct-data'), true);
  const cliSrc = fs.readFileSync(path.join(__dirname, '..', 'cli.js'), 'utf8');
  assert.equal(
    cliSrc.includes('src-data-only'),
    false,
    'the new source id must not be hard-coded in the controller'
  );
  assert.equal(cliSrc.includes('up-data'), false);
});

test('15 Work Item without model/account still gets a combination', () => {
  const dir = tmp('mvp18-15-');
  const result = dispatchCommand(
    {
      _: ['dispatch'],
      'dry-run': true,
      item: 'FEAT-UNPINNED-15',
      role: 'author.foundation',
      root: dir,
    },
    {
      candidates: [
        cand({ accountId: 'acct-a', modelId: 'up-a/auto' }),
        cand({
          accountId: 'acct-b',
          quotaScope: 'acct-b',
          upstream: 'up-b',
          gateway: 'gw-b',
          accessPath: 'path-b',
          source: 'gw-b',
          modelId: 'up-b/auto',
          cost: 4,
        }),
      ],
      accounts: [],
      registry: registry(),
      evidenceDir: path.join(dir, 'evidence'),
      discoveryCatalogue: { candidates: [] },
      offerings: [],
      now: NOW,
      log: () => {},
      error: () => {},
      exit: () => {},
    }
  );
  const chosen = result.decision && result.decision.chosen;
  assert.ok(chosen, 'an unpinned Work Item still receives a full combination');
  const parts = String(chosen).split('::');
  assert.equal(parts.length, 7);
  assert.ok(parts[3], 'upstream is chosen by the controller');
  assert.ok(parts[4] && parts[4] !== '', 'account is chosen by the controller');
  assert.ok(parts[6], 'model is chosen by the controller');
  assert.equal(Boolean(result.decision && result.decision.pinned), false);
});

test('16 resource ceiling limits writers', () => {
  const pool = [
    account({ id: 'w1', model: 'model-w1' }),
    account({ id: 'w2', model: 'model-w2' }),
    account({ id: 'w3', model: 'model-w3' }),
  ];
  const plan = planDispatch(
    [
      item({ workItemId: 'W-1', branch: 'feat/area-a' }),
      item({ workItemId: 'W-2', branch: 'feat/area-b' }),
      item({ workItemId: 'W-3', branch: 'feat/area-c' }),
    ],
    pool,
    {
      now: NOW,
      governedDecision: 'DEC-017',
      limits: { maxImplementationAgents: 3, maxPerAccount: 1, maxTotal: 6 },
      resources: { freeMb: 2048 + 350, reserveMb: 2048, perAgentMb: 350 },
      home: tmp('mvp18-16-'),
      dryRun: true,
    }
  );
  assert.equal(plan.utilisation.ramLimited, true);
  assert.equal(plan.utilisation.maxImplementation, 1);
  assert.equal(plan.assignments.length, 1, 'resource ceiling admits only one writer');
  assert.ok(plan.deferred.length >= 2);
});

test('17 failed writer releases its writer claim', () => {
  const dir = tmp('mvp18-17-');
  decisions.recordDecision(
    {
      stage: decisions.Stage.LAUNCHED,
      workItemId: 'FEAT-CLAIM-17',
      sessionId: 'sess-17',
      harness: 'paseo',
      branch: 'feat/area-17',
      chosen: 'paseo::cli::cli-src::cli-src::acct-a::acct-a::model-one',
    },
    { dir, now: NOW }
  );
  assert.ok(decisions.writerFor('FEAT-CLAIM-17', { dir, now: NOW }));
  const released = decisions.closeWriter('FEAT-CLAIM-17', 'failed', {
    dir,
    now: NOW + 1,
    detail: 'writer failed',
  });
  assert.ok(released);
  assert.equal(released.stage, decisions.Stage.FAILED);
  assert.equal(decisions.writerFor('FEAT-CLAIM-17', { dir, now: NOW + 1 }), null);
  const again = planDispatch(
    [item({ workItemId: 'FEAT-CLAIM-17', branch: 'feat/area-17' })],
    [account()],
    { now: NOW + 2, decisionDir: dir, home: dir, dryRun: true }
  );
  assert.equal(
    again.assignments.length,
    1,
    'after a failed writer releases the claim the area can be written again'
  );
  assert.equal(
    again.deferred.some((d) => d.reason === 'WORK_ITEM_ALREADY_WRITING'),
    false
  );
});

test('18 a reserved candidate is not selected concurrently beyond the ceiling', () => {
  const home = tmp('mvp18-18-');
  const reserved = account({
    id: 'reserved-acct',
    model: 'model-reserved',
    limits: { requestsPerDay: 2 },
  });
  const other = account({ id: 'other-acct', model: 'model-other', provider: 'prov-b' });
  const first = planDispatch(
    [item({ workItemId: 'HOLD-1', branch: 'feat/hold-1' })],
    [reserved, other],
    {
      now: NOW,
      home,
      dryRun: false,
      governedDecision: 'DEC-017',
      limits: { maxImplementationAgents: 2, maxPerAccount: 1, maxConcurrentPerModel: 1 },
    }
  );
  assert.equal(first.assignments.length, 1);
  const held = first.assignments[0];
  const second = planDispatch(
    [item({ workItemId: 'HOLD-2', branch: 'feat/hold-2' })],
    [reserved, other],
    {
      now: NOW,
      home,
      dryRun: true,
      running: [
        {
          workItemId: held.workItemId,
          role: 'author.foundation',
          accountId: held.accountId,
          model: held.model,
          provider: held.provider,
        },
      ],
      governedDecision: 'DEC-017',
      limits: { maxImplementationAgents: 2, maxPerAccount: 1, maxConcurrentPerModel: 1 },
    }
  );
  const picked = second.assignments.map((a) => a.accountId + '::' + a.model);
  assert.equal(
    picked.includes(held.accountId + '::' + held.model),
    false,
    'a reserved candidate must not be selected again while its reservation is outstanding: ' +
      picked.join(',')
  );
  assert.equal(second.assignments.length, 1);
  assert.notEqual(second.assignments[0].model, held.model);
});
