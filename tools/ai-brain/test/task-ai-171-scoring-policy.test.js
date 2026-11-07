'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { dispatchCommand } = require('../cli');
const { candidateKey } = require('../candidates');
const now = Date.parse('2026-11-07T00:00:00Z');
const policy = () => ({
  version: 'fixture-v1',
  source: 'fixture://policy',
  rationale: 'Synthetic latency comparison',
  maxAgeMs: 1000,
  dimensions: {
    latency: {
      weight: 1,
      min: 0,
      max: 100,
      unit: 'milliseconds',
      direction: 'lower',
      measurement: { store: 'evidence', metric: 'elapsedMs' },
    },
  },
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(__dirname, '../../../.oc/policy-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rows = ['slow', 'fast'].map((id) => ({
    harness: 'paseo',
    accessPath: 'fixture',
    gateway: 'fixture',
    upstream: id,
    accountId: 'fixture',
    quotaScope: 'fixture',
    modelId: `fixture/${id}`,
    modelVersion: 'fixture-revision',
    qualifiedRoles: ['*'],
    quality: 1,
    contextWindow: 64000,
  }));
  const evidenceData = {
    combinations: rows.map((c, i) => ({
      ...c,
      evidence: [
        {
          elapsedMs: i ? 10 : 90,
          timestamp: new Date(now).toISOString(),
          modelId: c.modelId,
          modelVersion: c.modelVersion,
          ...(i === 0 ? { status: 'passed', level: 2 } : {}),
        },
      ],
    })),
  };
  const evidenceDir = path.join(dir, 'evidence');
  fs.mkdirSync(evidenceDir);
  fs.writeFileSync(path.join(evidenceDir, 'evidence.json'), JSON.stringify(evidenceData));
  const policyFile = path.join(dir, 'scoring-policy.json');
  fs.writeFileSync(policyFile, JSON.stringify(policy()));
  const logs = [];
  return {
    dir,
    rows,
    policyFile,
    evidenceData,
    logs,
    deps: {
      candidates: rows,
      registry: { sources: [], dispatch: { providers: {} } },
      accounts: [],
      allowUnprobedCandidates: true,
      home: dir,
      rootDir: dir,
      evidenceDir,
      evidenceData,
      decisionDir: path.join(dir, 'decisions'),
      storePath: path.join(dir, 'quota.json'),
      routeHealthFile: path.join(dir, 'empty-health.json'),
      scoringPolicyFile: policyFile,
      now,
      reservations: [],
      headrooms: {},
      priors: { ranking: [] },
      assessment: {},
      taskProfile: {
        taskId: 'TASK-AI-171',
        role: 'writer',
        proofFloor: 'NONE',
        requiredCapabilities: [],
      },
      log: (line) => logs.push(line),
      exit: () => {},
    },
  };
}
for (const execute of [false, true]) {
  test(`policy file drives ${execute ? 'execute' : 'dispatch'} and exposes sourced parts`, (t) => {
    const f = fixture(t);
    let selected;
    const result = dispatchCommand(
      { item: 'TASK-AI-171', role: 'writer', execute, 'dry-run': !execute },
      {
        ...f.deps,
        run: () => {
          selected = require('../decisions')
            .readDecisions({ dir: f.deps.decisionDir, now })
            .find((r) => r.stage === 'selected');
          return { exitCode: 0, stdout: '{"id":"fixture-session","status":"completed"}' };
        },
      }
    );
    const decision = execute ? selected : result.decision;
    assert.equal(decision.chosen, candidateKey(f.rows[1]), JSON.stringify(decision));
    for (const c of decision.candidates) {
      assert.equal(c.scoreBreakdown.policy.version, 'fixture-v1');
      assert.equal(c.scoreBreakdown.measurements.latency?.unit, 'milliseconds', JSON.stringify(c));
      assert.match(c.scoreBreakdown.measurements.latency.source, /evidence/);
      assert.equal(c.scoreBreakdown.measurements.latency.rule.max, policy().dimensions.latency.max);
    }
    assert.ok(f.logs.some((line) => line.includes('latency=sourced')));
  });
}
for (const execute of [false, true])
  test(`missing policy records reason and preserves legacy selection: execute=${execute}`, (t) => {
    const f = fixture(t);
    fs.unlinkSync(f.policyFile);
    const decisionLog = path.join(f.dir, 'decision.json');
    let decision;
    const result = dispatchCommand(
      {
        item: 'TASK-AI-171',
        role: 'writer',
        execute,
        'dry-run': !execute,
        'decision-log': decisionLog,
      },
      {
        ...f.deps,
        run: () => {
          decision = require('../decisions')
            .readDecisions({ dir: f.deps.decisionDir, now })
            .find((r) => r.stage === 'selected');
          return { exitCode: 0, stdout: '{"id":"fixture-session","status":"completed"}' };
        },
      }
    );
    decision ||= result.decision;
    assert.equal(decision.scoringPolicyStatus, 'SCORING_POLICY_MISSING');
    assert.equal(decision.chosen, candidateKey(f.rows[0]));
    for (const c of decision.candidates) assert.equal(c.scoreBreakdown.policy, undefined);
    if (!execute)
      assert.equal(
        JSON.parse(fs.readFileSync(decisionLog)).scoringPolicyStatus,
        'SCORING_POLICY_MISSING'
      );
  });
test('loader validates the whole versioned policy without authoring defaults', (t) => {
  const { loadScoringPolicy } = require('../scoring-policy');
  const f = fixture(t);
  assert.deepEqual(loadScoringPolicy(f.policyFile).scoringPolicy, policy());
  const invalid = [
    { version: '' },
    { source: '' },
    { rationale: '' },
    { maxAgeMs: null },
    { dimensions: {} },
    ...[
      { max: 0 },
      { weight: 0 },
      { min: '0' },
      { unit: '' },
      { direction: 'sideways' },
      { measurement: null },
    ].map((r) => ({ dimensions: { latency: { ...policy().dimensions.latency, ...r } } })),
  ];
  for (const patch of invalid) {
    fs.writeFileSync(f.policyFile, JSON.stringify({ ...policy(), ...patch }));
    assert.throws(() => loadScoringPolicy(f.policyFile), { code: 'SCORING_POLICY_INVALID' });
  }
});
test('profile CLI loads policy and joins recorded measurements', async (t) => {
  const f = fixture(t);
  const profileFile = path.join(f.dir, 'profile.json');
  fs.writeFileSync(
    profileFile,
    JSON.stringify({
      ...f.deps.taskProfile,
      complexity: 'short',
      contextSize: 64000,
      expectedDuration: 600000,
      latencyPriority: 'normal',
      qualityFloor: 0,
      costCeiling: 1000,
      requiredHarness: null,
      forbiddenFailureDomains: [],
      resourceCeiling: 4,
      currentWorkload: 1,
    })
  );
  const result = await dispatchCommand(
    { profile: profileFile, 'dry-run': true, 'exploration-budget': 2 },
    {
      ...f.deps,
      ask: async () => ({ choice: 'BALANCED', confidence: 1 }),
      probeCapabilities: async () => {},
      modelChoiceAsk: async () => ({ choice: null, confidence: 0 }),
    }
  );
  assert.equal(result.assessment.scoringPolicy?.version, 'fixture-v1');
  const saved = require('../decisions')
    .readDecisions({ dir: f.deps.decisionDir, now })
    .find((r) => r.stage === 'selected');
  assert.equal(saved.chosen, candidateKey(f.rows[1]));
  assert.equal(saved.ranking[0].scoreBreakdown.measurements.latency.value, 10);
});
test('measurement join rejects stale, wrong-unit, unversioned and foreign-route evidence', (t) => {
  const { joinMeasurements } = require('../scoring-policy');
  const f = fixture(t);
  for (const patch of [
    { modelVersion: undefined },
    { modelVersion: 'other' },
    { modelId: 'other' },
    { timestamp: new Date(now - 1001).toISOString() },
    { timestamp: new Date(now + 1).toISOString() },
  ]) {
    const data = structuredClone(f.evidenceData);
    Object.assign(data.combinations[0].evidence[0], patch);
    const row = { ...f.rows[0] };
    joinMeasurements([row], { scoringPolicy: policy() }, { ...f.deps, evidenceData: data, now });
    assert.deepEqual(row.measurements, {});
  }
  const row = { ...f.rows[0], accountId: 'other' };
  joinMeasurements([row], { scoringPolicy: policy() }, { ...f.deps, now });
  assert.deepEqual(row.measurements, {});
  const wrongUnit = policy();
  wrongUnit.dimensions.latency.unit = 'seconds';
  joinMeasurements([f.rows[0]], { scoringPolicy: wrongUnit }, { ...f.deps, now });
  assert.deepEqual(f.rows[0].measurements, {});
});
test('raw provenance from priors and route health is joined without aliases or invented quality', (t) => {
  const { joinMeasurements } = require('../scoring-policy');
  const health = require('../route-health');
  const f = fixture(t);
  const row = f.rows[0];
  const p = policy();
  delete p.dimensions.latency.measurement;
  const measurement = {
    value: 40,
    unit: 'milliseconds',
    samples: 3,
    observedAt: new Date(now).toISOString(),
    modelId: row.modelId,
    modelVersion: row.modelVersion,
    source: 'fixture://prior',
  };
  const priors = { ranking: [{ modelId: row.modelId, measurements: { latency: measurement } }] };
  joinMeasurements([row], { scoringPolicy: p }, { ...f.deps, priors, now });
  assert.deepEqual(row.measurements.latency, measurement);
  const id = health.probeIdentity(row);
  const routeHealthFile = path.join(f.dir, 'health.json');
  fs.writeFileSync(
    routeHealthFile,
    JSON.stringify({
      version: 1,
      paths: {
        [health.healthKey(id.model, id.route)]: {
          candidateKey: candidateKey(row),
          measurements: { latency: measurement },
        },
      },
    })
  );
  joinMeasurements(
    [row],
    { scoringPolicy: p },
    { ...f.deps, routeHealthFile, priors: { ranking: [] }, now }
  );
  assert.deepEqual(row.measurements.latency, measurement);
  const alias = { ...row, modelId: 'alias' };
  joinMeasurements([alias], { scoringPolicy: p }, { ...f.deps, priors, now });
  assert.deepEqual(alias.measurements, {});
  assert.equal(row.measurements.quality, undefined);
});
test('valid policy with incomplete evidence refuses execute and reports unknown parts', (t) => {
  const f = fixture(t);
  delete f.evidenceData.combinations[0].evidence[0].modelVersion;
  delete f.evidenceData.combinations[1].evidence[0].modelVersion;
  fs.writeFileSync(path.join(f.deps.evidenceDir, 'evidence.json'), JSON.stringify(f.evidenceData));
  const result = dispatchCommand(
    { item: 'TASK-AI-171', role: 'writer', execute: true },
    {
      ...f.deps,
      run: () => assert.fail('Unverified score must never launch'),
    }
  );
  assert.equal(result.decision.chosen, null);
  assert.equal(result.decision.reasonCode, 'SCORING_INPUTS_UNVERIFIED');
  assert.ok(f.logs.some((line) => line.includes('latency=unknown')));
  assert.equal(
    require('../decisions').readDecisions({ dir: f.deps.decisionDir, now })[0]?.scoringPolicyStatus,
    'SCORING_POLICY_LOADED'
  );
});

const aaFile = path.join(__dirname, '../data/aa-intelligence.json');
const defaultPolicyFile = path.join(__dirname, '../data/scoring-policy.json');
test('AA exact variant join binds only the named observation version', (t) => {
  const { loadScoringPolicy, joinMeasurements } = require('../scoring-policy');
  const f = fixture(t);
  const data = {
    version: 'fixture-AA-version',
    source: 'fixture://AA',
    observedAt: new Date(now).toISOString(),
    unit: 'fixture-points',
    rows: [{ name: 'Synthetic (high)', base: 'synthetic', variant: 'high', pct: 4 }],
  };
  fs.writeFileSync(path.join(f.dir, 'aa.json'), JSON.stringify(data));
  const p = policy();
  p.priorsFile = 'aa.json';
  p.dimensions = {
    quality: {
      weight: 1,
      min: 0,
      max: 10,
      direction: 'higher',
      unit: data.unit,
      measurement: { store: 'priors', metric: 'quality' },
    },
  };
  fs.writeFileSync(f.policyFile, JSON.stringify(p));
  const loaded = loadScoringPolicy(f.policyFile);
  for (const modelId of ['synthetic-high', 'synthetic', 'alias/synthetic-high']) {
    const candidate = { ...f.rows[0], modelId, modelVersion: undefined };
    joinMeasurements([candidate], loaded, f.deps);
    assert.equal(Boolean(candidate.measurements.quality), modelId === 'synthetic-high');
    if (modelId === 'synthetic-high')
      assert.equal(candidate.modelVersion, `${data.version}:${data.rows[0].name}`);
  }
});
test('AA policy loads one measured percentile dimension and reuses priors freshness', () => {
  const { loadScoringPolicy } = require('../scoring-policy');
  const loaded = loadScoringPolicy();
  assert.equal(loaded.scoringPolicyStatus, 'SCORING_POLICY_LOADED');
  const p = loaded.scoringPolicy;
  const data = JSON.parse(fs.readFileSync(aaFile, 'utf8'));
  assert.equal(p.maxAgeMs, require('../priors').STALE_AFTER_MS);
  assert.deepEqual(Object.keys(p.dimensions), ['quality']);
  assert.deepEqual(p.notMeasured, ['latency', 'cost', 'reliability']);
  assert.deepEqual(p.dimensions.quality, {
    weight: 1,
    min: data.min,
    max: data.max,
    unit: data.unit,
    direction: 'higher',
    measurement: { store: 'priors', metric: 'quality' },
  });
  // Independently replay aa-fetch's midrank formula over the complete population.
  for (const row of data.rows) {
    const population = Object.entries(data.population);
    const lower = population
      .filter(([ii]) => Number(ii) < row.ii)
      .reduce((n, [, count]) => n + count, 0);
    const tied = data.population[row.ii];
    const size = population.reduce((n, [, count]) => n + count, 0);
    assert.equal(row.pct, Math.round(((lower + tied / 2) / size) * 1000) / 10);
  }
});
test('AA dry-run and execute share sourced parts and equal a hand replay', (t) => {
  const f = fixture(t);
  const data = JSON.parse(fs.readFileSync(aaFile, 'utf8'));
  const rows = data.rows.slice(0, f.rows.length);
  const candidates = f.rows.map((c, i) => {
    const { modelVersion, ...route } = c;
    const row = rows[i];
    return { ...route, modelId: row.variant ? `${row.base}-${row.variant}` : row.base };
  });
  const at = Date.parse(data.observedAt);
  const deps = {
    ...f.deps,
    candidates,
    evidenceData: { combinations: [] },
    now: at,
    scoringPolicyFile: defaultPolicyFile,
  };
  const dry = dispatchCommand({ item: 'TASK-AI-171', role: 'writer', 'dry-run': true }, deps);
  let executed;
  dispatchCommand({ item: 'TASK-AI-171', role: 'writer', execute: true }, {
    ...deps,
    run: () => {
      executed = require('../decisions')
        .readDecisions({ dir: deps.decisionDir, now: at })
        .filter((r) => r.stage === 'selected')
        .at(-1);
      return { exitCode: 0, stdout: '{"id":"fixture-session","status":"completed"}' };
    },
  });
  assert.ok(executed, 'stub execute must launch a measured candidate');
  assert.equal(executed.chosen, dry.decision.chosen);
  for (const c of dry.decision.candidates) {
    const replay = executed.candidates.find((r) => r.offeringId === c.offeringId);
    assert.deepEqual(replay.scoreBreakdown, c.scoreBreakdown);
    const m = c.scoreBreakdown.measurements.quality;
    const row = rows.find((r) => `AA-II-5.0.1:${r.name}` === m.modelVersion);
    assert.ok(row);
    const p = JSON.parse(fs.readFileSync(defaultPolicyFile, 'utf8'));
    const rule = p.dimensions.quality;
    const byHand = (row.pct - rule.min) / (rule.max - rule.min);
    assert.equal(c.scoreBreakdown.quality, byHand);
    assert.equal(c.score, byHand);
    assert.equal(m.source, data.source);
    assert.equal(m.observedAt, data.observedAt);
    assert.equal(c.scoreBreakdown.policy.version, p.version);
  }
});
test('AA rejects stale, wrong-unit, foreign-model and foreign-version rows; unknown refuses execute', (t) => {
  const { loadScoringPolicy, joinMeasurements } = require('../scoring-policy');
  const loaded = loadScoringPolicy();
  const data = JSON.parse(fs.readFileSync(aaFile, 'utf8'));
  const row = data.rows[0];
  const modelId = row.variant ? `${row.base}-${row.variant}` : row.base;
  const f = fixture(t);
  const at = Date.parse(data.observedAt);
  const original = { ...f.rows[0], modelId, modelVersion: `AA-II-5.0.1:${row.name}` };
  for (const patch of [
    { now: at + loaded.scoringPolicy.maxAgeMs + 1 },
    { now: at - 1 },
    { candidate: { modelId: `${modelId}-alias` } },
    { candidate: { modelId: `${row.base}-unmeasured-variant` } },
    { candidate: { modelVersion: 'foreign-version' } },
    { unit: 'raw index' },
    { foreignModel: true },
  ]) {
    const assessment = structuredClone(loaded);
    if (patch.unit) assessment.scoringPriors.ranking[0].measurements.quality.unit = patch.unit;
    if (patch.foreignModel)
      assessment.scoringPriors.ranking[0].measurements.quality.modelId = 'foreign';
    const candidate = { ...original, ...patch.candidate };
    joinMeasurements([candidate], assessment, { ...f.deps, now: patch.now ?? at });
    assert.deepEqual(candidate.measurements, {}, JSON.stringify(patch));
  }
  const unknown = { ...original, modelId: `${modelId}-unknown` };
  const result = dispatchCommand({ item: 'TASK-AI-171', role: 'writer', execute: true }, {
    ...f.deps,
    candidates: [unknown],
    scoringPolicyFile: defaultPolicyFile,
    now: at,
    run: () => assert.fail('Unknown model must not launch'),
  });
  assert.equal(result.decision.chosen, null);
  assert.equal(result.decision.reasonCode, 'SCORING_INPUTS_UNVERIFIED');
});
