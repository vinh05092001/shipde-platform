'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const ranking = require('../ranking');
const routing = require('../routing');
const sources = require('../sources');
const configured = require('../sources.json');
const quotaStore = require('../quota-store');

const source = configured.sources.find((s) => s.endpoint && s.credential?.env);
const defaults = sources.getDispatchConfig();
const freshnessMs = defaults.quotaReadingMaxAgeMs ?? quotaStore.DEFAULT_MAX_AGE_MS;

function candidate(overrides = {}) {
  const accountId = randomUUID();
  return {
    harness: 'paseo',
    accessPath: source.endpoint,
    gateway: source.id,
    source: source.id,
    upstream: randomUUID(),
    accountId,
    quotaScope: accountId,
    modelId: randomUUID(),
    qualifiedRoles: ['author.foundation'],
    quality: defaults.headroomUnknownPenalty + defaults.headroomTightPenalty,
    cost: null,
    evidence: [],
    ...overrides,
  };
}

function context(candidates, readings = {}, overrides = {}) {
  const now = Date.now();
  return {
    now,
    role: 'author.foundation',
    workItemId: 'TASK-AI-150',
    dryRun: true,
    registry: { ...configured, sources: [] },
    useStoredQuota: false,
    loadQuotaState: false,
    quotaState: {},
    evidenceData: { combinations: [] },
    priors: { ranking: [] },
    reservations: [],
    allowNetwork: false,
    headrooms: Object.fromEntries(
      candidates.map((c) => [
        c.accountId,
        { status: 'open', observedAt: new Date(now).toISOString(), ...readings[c.accountId] },
      ])
    ),
    ...overrides,
  };
}

function profile() {
  return {
    taskId: 'TASK-AI-150',
    role: 'reviewer',
    complexity: 'short',
    requiredCapabilities: [],
    proofFloor: 'NONE',
    contextSize: 0,
    expectedDuration: defaults.probeTimeoutMs,
    latencyPriority: 'normal',
    qualityFloor: 0,
    costCeiling: Infinity,
    forbiddenFailureDomains: [],
    riskDomains: [],
  };
}

const assessment = { weightProfile: 'QUALITY_FIRST' };

function profileRank(candidates, ctx) {
  const result = routing.rankForProfile(candidates, profile(), assessment, ctx);
  return { ...result, candidates: result.ranking };
}

function key(row) {
  return row.offeringId || row.candidateKey;
}

function probeContext(candidates, readings = {}, overrides = {}) {
  return context(candidates, readings, {
    httpRoute: (c) => ({
      accessPath: c.accessPath,
      modelId: c.modelId,
      apiKeyEnv: source.credential.env,
      maxOutputTokens: defaults.quotaProbeMaxOutputTokens,
    }),
    routeProbe: async () => ({ ok: true, status: 200, body: 'OK' }),
    ...overrides,
  });
}

for (const [engine, rank] of [
  ['item', ranking.rankAndRecord],
  ['profile', profileRank],
]) {
  test(engine + ': exhausted and cooling candidates never enter ranking', () => {
    const exhausted = candidate({ quality: defaults.probeTimeoutMs });
    const cooling = candidate({ quality: defaults.probeBudgetMs });
    const open = candidate();
    const offered = [exhausted, cooling, open];
    const ctx = context(offered, {
      [exhausted.accountId]: { status: 'exhausted', reason: 'QUOTA_EXHAUSTED' },
      [cooling.accountId]: { status: 'cooling', reason: 'COOLDOWN_ACTIVE' },
    });
    const decision = rank(offered, ctx);
    assert.deepEqual(decision.candidates.map(key), [routing.candidateKey(open)]);
    assert.equal(decision.chosen, routing.candidateKey(open));
    for (const c of [exhausted, cooling]) {
      const rejected = decision.rejected.find((r) => key(r) === routing.candidateKey(c));
      assert.ok(rejected);
      assert.equal(rejected.scope, 'account');
      assert.ok(rejected.quotaEvidence, 'refusal retains the measured quota evidence');
    }
  });

  test(engine + ': stale or unknown quota cannot select first without a live probe', () => {
    const stale = candidate({ quality: defaults.probeTimeoutMs });
    const unknown = candidate();
    const ctx = context(
      [stale, unknown],
      {
        [stale.accountId]: {
          observedAt: new Date(Date.now() - freshnessMs - defaults.probeTimeoutMs).toISOString(),
        },
        [unknown.accountId]: { status: 'unknown' },
      },
      { explorationBudget: defaults.maxWriterSelectionRounds }
    );
    const decision = rank([stale, unknown], ctx);
    assert.equal(decision.chosen, null);
    assert.equal(decision.outcome, 'NO_ELIGIBLE_CANDIDATE');
    assert.equal(decision.candidates.length, 0);
    assert.equal(decision.needsQuotaProbe.length, 2);
  });

  test(engine + ': fresh open quota keeps the configured score order', () => {
    const lower = candidate();
    const higher = candidate({
      quality: lower.quality + defaults.headroomUnknownPenalty,
      evidence: [{ status: 'passed', level: require('../evidence').ProofRank.WORK_ITEM_PASS }],
    });
    const ctx = context([lower, higher]);
    const decision = rank([lower, higher], ctx);
    assert.equal(decision.chosen, routing.candidateKey(higher));
    assert.equal(decision.candidates.length, 2);
    assert.ok(decision.candidates.every((c) => (c.headroom || c.headroomStatus) === 'open'));
  });

  test(
    engine + ': stale quota is probed before final selection and evidence is recorded',
    async () => {
      const stale = candidate();
      const ctx = probeContext([stale], {
        [stale.accountId]: {
          observedAt: new Date(Date.now() - freshnessMs - defaults.probeTimeoutMs).toISOString(),
        },
      });
      let requests = 0;
      ctx.routeProbe = async (route, envName, env, options) => {
        requests += 1;
        assert.equal(route.modelId, stale.modelId);
        assert.ok(options.signal);
        return { ok: true, status: 200, body: 'OK' };
      };
      const decision = await ranking.rankWithQuotaProbe([stale], ctx, rank);
      assert.equal(requests, 1);
      assert.equal(decision.chosen, routing.candidateKey(stale));
      const row = decision.candidates.find((c) => key(c) === decision.chosen);
      assert.equal(row.quotaProbe.candidateKey, decision.chosen);
      assert.equal(row.quotaProbe.ok, true);
      assert.ok(Number.isFinite(Date.parse(row.quotaProbe.observedAt)));
      assert.equal(row.quotaEvidence.status, 'unknown', 'a probe does not invent quota capacity');
    }
  );
}

test('quota freshness is configured and invalid or missing configuration fails closed', () => {
  assert.ok(Number.isSafeInteger(defaults.quotaReadingMaxAgeMs));
  assert.ok(defaults.quotaReadingMaxAgeMs > 0);
  for (const invalid of [0, -1, 'invalid']) {
    assert.throws(
      () => sources.getDispatchConfig({ dispatch: { quotaReadingMaxAgeMs: invalid } }),
      /DISPATCH_CONFIG_INVALID: quotaReadingMaxAgeMs/
    );
  }
  const fallback = { ...configured.dispatch };
  delete fallback.quotaReadingMaxAgeMs;
  assert.throws(
    () => sources.getDispatchConfig({ sources: [], dispatch: {} }, { defaults: fallback }),
    /DISPATCH_CONFIG_INVALID: quotaReadingMaxAgeMs/
  );
});

test('future and missing timestamps cannot prove quota freshness on any binding', () => {
  for (const binding of ['api-key', 'cli-login']) {
    const c = candidate({ binding });
    for (const observedAt of [undefined, new Date(Date.now() + freshnessMs).toISOString()]) {
      const ctx = context([c], { [c.accountId]: { observedAt } });
      assert.equal(ranking.resolveCandidateHeadroom(c, ctx).status, 'unknown');
      assert.equal(ranking.rankAndRecord([c], ctx).chosen, null);
    }
  }
});

test('an active reset remains excluded even when its quota snapshot is stale', async () => {
  const c = candidate();
  const now = Date.now();
  let requests = 0;
  const ctx = probeContext(
    [c],
    {
      [c.accountId]: {
        status: 'exhausted',
        observedAt: new Date(now - freshnessMs - defaults.probeTimeoutMs).toISOString(),
        resetsAt: new Date(now + freshnessMs).toISOString(),
      },
    },
    {
      routeProbe: async () => {
        requests += 1;
        return { ok: true, status: 200 };
      },
    }
  );
  const decision = await ranking.rankWithQuotaProbe([c], ctx);
  assert.equal(requests, 0);
  assert.equal(decision.chosen, null);
  assert.equal(decision.outcome, 'NO_ELIGIBLE_CANDIDATE');
});

test('stale or foreign probe evidence and a bare success flag never admit unknown quota', () => {
  const c = candidate({ routeEvidence: { configured: true, probeSucceeded: true, status: 200 } });
  const ctx = context([c], { [c.accountId]: { status: 'unknown' } });
  const baseValidProof = {
    candidateKey: routing.candidateKey(c),
    ok: true,
    httpStatus: 200,
    observedAt: new Date(ctx.now).toISOString(),
    quotaStatus: 'open',
  };

  // Positive baseline: complete valid proof promotes candidate to open and selects it
  c.quotaProbe = { ...baseValidProof };
  assert.equal(ranking.rankAndRecord([c], ctx).chosen, routing.candidateKey(c));

  // Invalidate exactly one field per case
  const invalidCases = [
    { ...baseValidProof, candidateKey: randomUUID() },
    { ...baseValidProof, observedAt: new Date(ctx.now - freshnessMs - 1).toISOString() },
    { ...baseValidProof, httpStatus: 0 },
    { ...baseValidProof, httpStatus: 500 },
    { ...baseValidProof, ok: false },
    { ...baseValidProof, quotaStatus: 'exhausted' },
  ];

  for (const proof of invalidCases) {
    c.quotaProbe = proof;
    const decision = ranking.rankAndRecord([c], ctx);
    assert.equal(decision.chosen, null);
    assert.equal(decision.outcome, 'NO_ELIGIBLE_CANDIDATE');
  }
});

test('local accountHeadroom calculations preserve underlying observation timestamp and never renew freshness', () => {
  const c = candidate();
  const oldTimestamp = new Date(Date.now() - freshnessMs - defaults.probeTimeoutMs).toISOString();

  // 1. Account snapshot with limits yielding open headroom, but stale observedAt
  const staleAccount = {
    id: c.accountId,
    limits: { requestsPerDay: 1000 },
    observedAt: oldTimestamp,
  };
  const ctx = context(
    [c],
    {},
    {
      headrooms: {},
      accounts: [staleAccount],
      eventsByAccount: { [c.accountId]: [] },
    }
  );

  const resolved = ranking.resolveCandidateHeadroom(c, ctx);
  assert.equal(resolved.status, 'unknown');
  assert.equal(resolved.quotaEvidence.reasonCode, 'QUOTA_STALE');
  assert.equal(resolved.quotaEvidence.observedAt, oldTimestamp);
  assert.equal(resolved.requiresLiveProbe, true);

  // 2. Repeated ranking pass must not renew freshness or admit candidate
  const firstPass = ranking.rankAndRecord([c], ctx);
  assert.equal(firstPass.chosen, null);
  assert.equal(firstPass.outcome, 'NO_ELIGIBLE_CANDIDATE');
  assert.equal(firstPass.needsQuotaProbe.length, 1);

  // Simulate repeated ranking 5 seconds later
  const repeatedCtx = { ...ctx, now: ctx.now + 5000 };
  const repeatedPass = ranking.rankAndRecord([c], repeatedCtx);
  assert.equal(repeatedPass.chosen, null);
  assert.equal(repeatedPass.outcome, 'NO_ELIGIBLE_CANDIDATE');
  assert.equal(repeatedPass.needsQuotaProbe.length, 1);

  // 3. Account snapshot without any observation timestamp must fail closed as QUOTA_TIMESTAMP_MISSING
  const untimestampedAccount = {
    id: c.accountId,
    limits: { requestsPerDay: 1000 },
  };
  const missingCtx = context(
    [c],
    {},
    {
      headrooms: {},
      accounts: [untimestampedAccount],
      eventsByAccount: { [c.accountId]: [] },
    }
  );
  const missingResolved = ranking.resolveCandidateHeadroom(c, missingCtx);
  assert.equal(missingResolved.status, 'unknown');
  assert.equal(missingResolved.quotaEvidence.reasonCode, 'QUOTA_TIMESTAMP_MISSING');
  assert.equal(missingResolved.requiresLiveProbe, true);

  // 4. Account snapshot with fresh observedAt is admitted without requiring probe
  const freshAccount = {
    id: c.accountId,
    limits: { requestsPerDay: 1000 },
    observedAt: new Date(ctx.now).toISOString(),
  };
  const freshCtx = context(
    [c],
    {},
    {
      headrooms: {},
      accounts: [freshAccount],
      eventsByAccount: { [c.accountId]: [] },
    }
  );
  const freshResolved = ranking.resolveCandidateHeadroom(c, freshCtx);
  assert.equal(freshResolved.status, 'open');
  assert.equal(freshResolved.requiresLiveProbe, false);
  const freshPass = ranking.rankAndRecord([c], freshCtx);
  assert.equal(freshPass.chosen, routing.candidateKey(c));
});

test('failed, timed out and zero-remaining probes fail closed without storing response bodies', async () => {
  for (const response of [
    { ok: false, status: 429, body: 'quota exhausted secret-response-marker' },
    { ok: false, status: 503, body: 'secret-response-marker' },
    { ok: true, status: 200, body: 'secret-response-marker', quota: { status: 'exhausted' } },
    null,
  ]) {
    const c = candidate();
    const ctx = probeContext(
      [c],
      { [c.accountId]: { status: 'unknown' } },
      {
        probeTimeoutMs: defaults.quotaProbeMaxOutputTokens,
        routeProbe: response === null ? () => new Promise(() => {}) : async () => response,
      }
    );
    const decision = await ranking.rankWithQuotaProbe([c], ctx);
    assert.equal(decision.chosen, null);
    assert.equal(decision.outcome, 'NO_ELIGIBLE_CANDIDATE');
    assert.equal(decision.candidates.length, 0);
    assert.ok(!JSON.stringify(decision).includes('secret-response-marker'));
    assert.ok(decision.rejected.some((r) => r.quotaProbe));
  }
});

test('all-excluded decisions are persisted with their named outcome and quota evidence', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-150-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const c = candidate();
  const ctx = context(
    [c],
    { [c.accountId]: { status: 'exhausted', reason: 'QUOTA_EXHAUSTED' } },
    {
      dryRun: false,
      decisionOpts: { dir },
    }
  );
  const decision = ranking.rankAndRecord([c], ctx);
  assert.equal(decision.chosen, null);
  assert.equal(decision.outcome, 'NO_ELIGIBLE_CANDIDATE');
  const records = fs.readdirSync(dir).filter((name) => name.endsWith('.jsonl'));
  assert.equal(records.length, 1);
  const recorded = JSON.parse(fs.readFileSync(path.join(dir, records[0]), 'utf8').trim());
  assert.equal(recorded.stage, 'refused');
  assert.equal(recorded.outcome, 'NO_ELIGIBLE_CANDIDATE');
  assert.equal(recorded.rejected[0].quotaEvidence.status, 'exhausted');
});
