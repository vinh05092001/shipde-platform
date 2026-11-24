'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-'));
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
}
for (const execute of [false, true])
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

const aaFile = path.join(__dirname, 'fixtures/aa-policy/aa-intelligence.json');
const defaultPolicyFile = path.join(__dirname, 'fixtures/aa-policy/scoring-policy.json');

test('AA join binds the observation version and labels how each route was matched', (t) => {
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
  // The snapshot's observedAt is the fixed test clock; inject it, since PR 13
  // freshness reads the observation, never the file's recent write time.
  const loaded = loadScoringPolicy(f.policyFile, { now });
  const via = {
    'synthetic-high': undefined,
    synthetic: 'aa-lowest-effort',
    'alias/synthetic-high': 'aa-base-effort',
    'synthetic-low': 'aa-origin-variant',
  };
  for (const [modelId, expected] of Object.entries(via)) {
    const candidate = { ...f.rows[0], modelId, modelVersion: undefined };
    joinMeasurements([candidate], loaded, f.deps);
    if (expected === null) {
      assert.equal(candidate.measurements.quality, undefined);
      continue;
    }
    assert.equal(candidate.measurements.quality.matchedVia, expected);
    assert.equal(candidate.modelVersion, `${data.version}:${data.rows[0].name}`);
  }
});
test('AA policy loads one measured percentile dimension and reuses priors freshness', () => {
  const { loadScoringPolicy } = require('../scoring-policy');
  const loaded = loadScoringPolicy(defaultPolicyFile);
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
