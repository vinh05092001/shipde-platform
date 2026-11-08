'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadScoringPolicy, joinMeasurements } = require('../scoring-policy');

function policyDir(t, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-join-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, 'aa.json'),
    JSON.stringify({
      source: 'https://aa.example/models',
      version: 'AA-T',
      unit: 'pct',
      observedAt: new Date().toISOString(),
      rows,
    })
  );
  fs.writeFileSync(
    path.join(dir, 'policy.json'),
    JSON.stringify({
      version: 'T',
      source: 'https://aa.example/models',
      rationale: 'test',
      maxAgeMs: 86400000,
      priorsFile: 'aa.json',
      deploymentTags: ['free'],
      dimensions: {
        quality: {
          weight: 1,
          min: 0,
          max: 100,
          unit: 'pct',
          direction: 'higher',
          measurement: { store: 'priors', metric: 'quality' },
        },
      },
    })
  );
  return loadScoringPolicy(path.join(dir, 'policy.json'));
}
const rows = [
  { name: 'Grok 4.7 (High)', base: 'grok-4-7', variant: 'high', ii: 35, pct: 62.6 },
  { name: 'Grok 4.7 (Low)', base: 'grok-4-7', variant: 'low', ii: 30, pct: 54 },
  { name: 'Kimi K3.1 Pro', base: 'kimi-k3-1-pro', variant: '', ii: 40, pct: 76.8 },
];
const quality = (assessment, modelId) => {
  const c = { harness: 'opencode', source: 'x', modelId };
  joinMeasurements([c], assessment, { routeHealth: { paths: {} }, priors: { ranking: [] } });
  return c.measurements.quality;
};

test('gateway path and deployment tag do not hide the AA base', (t) => {
  const q = quality(policyDir(t, rows), 'openrouter/moonshotai/kimi-k3.1-pro:free');
  assert.equal(q.value, 76.8);
  assert.equal(q.matchedVia, 'aa-base');
  assert.equal(q.aaModelId, 'kimi-k3-1-pro');
});

test('a named effort takes that published effort only', (t) => {
  assert.equal(quality(policyDir(t, rows), 'gcli/grok-4.7-high').value, 62.6);
  // Operator 2026-11-08: an unpublished variant takes its base at the lowest published score.
  const v = quality(policyDir(t, rows), 'gcli/grok-4.7-xhigh');
  assert.equal(v.value, 54);
  assert.equal(v.matchedVia, 'aa-origin-variant');
});

test('no effort named takes the lowest published effort, never a higher one', (t) => {
  const q = quality(policyDir(t, rows), 'gcli/grok-4.7');
  assert.equal(q.value, 54);
  assert.equal(q.matchedVia, 'aa-lowest-effort');
});

test('a model AA does not publish stays unscored', (t) => {
  assert.equal(quality(policyDir(t, rows), 'kr/glm-5'), undefined);
});

test('a revision or quantization tag is a different model and stays unscored', (t) => {
  const a = policyDir(t, rows);
  assert.equal(quality(a, 'gateway/kimi-k3.1-pro:q4_K_M'), undefined);
  assert.equal(quality(a, 'gateway/kimi-k3.1-pro:unmeasured-revision'), undefined);
  assert.equal(quality(a, 'gateway/kimi-k3.1-pro:free').value, 76.8);
});

test('a missing runtime AA snapshot leaves the policy inactive and says why', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aa-missing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const src = path.join(__dirname, 'fixtures/aa-policy/scoring-policy.json');
  fs.copyFileSync(src, path.join(dir, 'scoring-policy.json'));
  const loaded = loadScoringPolicy(path.join(dir, 'scoring-policy.json'));
  assert.equal(loaded.scoringPolicy, undefined);
  assert.equal(loaded.scoringPolicyStatus, 'SCORING_POLICY_INACTIVE');
  assert.equal(loaded.scoringPriorsStatus, 'AA_SNAPSHOT_MISSING');
});

test('aa-snapshot parses leaderboard rows into midrank percentiles', () => {
  const { parseRows } = require('../aa-snapshot');
  const html =
    '<table><tr><td>A (High)</td><td>x</td><td>c</td><td>40</td></tr>' +
    '<tr><td>B</td><td>x</td><td>c</td><td>20</td></tr>' +
    '<tr><td>C 1.5</td><td>x</td><td>c</td><td>20</td></tr><tr><td>bad</td><td>x</td></tr></table>';
  const { rows } = parseRows(html);
  assert.deepEqual(
    rows.map((r) => [r.base, r.variant, r.pct]),
    [
      ['a', 'high', 83.3],
      ['b', '', 33.3],
      ['c-1-5', '', 33.3],
    ]
  );
});

test('aa-snapshot reads each embedded record by its own slug, including deprecated ones', () => {
  const { parseRecords, releaseSlugs, rowsFromRecords } = require('../aa-snapshot');
  const page =
    '{"list":[{"releaseSlug":"m-1"},{"releaseSlug":"m-2"}],' +
    '"a":{"slug":"m-1-high","name":"M 1 (High)","release":{"slug":"m-1"},"deprecated":true,"intelligenceIndex":40},' +
    '"b":{"slug":"m-2","name":"M 2","intelligenceIndex":20},' +
    '"c":{"slug":"m-3","name":"M 3","intelligenceIndex":null}}';
  const records = parseRecords(page);
  const wrapped = '<script>self.__next_f.push([1,' + JSON.stringify(page) + '])</script>';
  assert.deepEqual(parseRecords(wrapped), records);
  assert.deepEqual(
    records.map((r) => [r.slug, r.ii, r.deprecated, r.release]),
    [
      ['m-1-high', 40, true, 'm-1'],
      ['m-2', 20, false, null],
    ]
  );
  assert.deepEqual(releaseSlugs(page), ['m-1', 'm-2']);
  const { rows } = rowsFromRecords(records);
  assert.deepEqual(
    rows.map((r) => [r.base, r.variant, r.pct]),
    [
      ['m-1', 'high', 75],
      ['m-2', '', 25],
    ]
  );
});

test('braces inside record strings do not drop or merge records', () => {
  const { parseRecords } = require('../aa-snapshot');
  const page =
    '[{"slug":"a","name":"A {","intelligenceIndex":40},' +
    '{"slug":"b","name":"B }","intelligenceIndex":20}]';
  assert.deepEqual(
    parseRecords(page).map((r) => [r.slug, r.ii]),
    [
      ['a', 40],
      ['b', 20],
    ]
  );
});

test('a malformed payload chunk breaks the stream instead of joining its neighbours', () => {
  const { parseRecords } = require('../aa-snapshot');
  const push = (s) => `self.__next_f.push([1,${s}])`;
  const page =
    push(JSON.stringify('{"slug":"x","name":"X",')) +
    push('"bad\\q"') +
    push(JSON.stringify('"intelligenceIndex":50}{"slug":"y","name":"Y","intelligenceIndex":30}'));
  assert.deepEqual(
    parseRecords(page).map((r) => r.slug),
    ['y']
  );
});

test('an escape at the end of a chunk cannot swallow the break marker', () => {
  const { parseRecords } = require('../aa-snapshot');
  const push = (s) => `self.__next_f.push([1,${s}])`;
  const page =
    push(JSON.stringify('{"bad":"\\')) +
    push('"bad\\q"') +
    push(JSON.stringify('"foo"}{"slug":"y","name":"Y","intelligenceIndex":30}'));
  assert.deepEqual(
    parseRecords(page).map((r) => r.slug),
    ['y']
  );
});

test('a renamed model takes its origin: a release tag on one side, lowest score when several', (t) => {
  const a = policyDir(t, [
    ...rows,
    {
      name: 'DeepSeek V4.1 Flash 1017 (High)',
      base: 'deepseek-v4-1-flash-1017',
      variant: 'high',
      ii: 30,
      pct: 58,
    },
    {
      name: 'DeepSeek V4.1 Flash 1017 (Max)',
      base: 'deepseek-v4-1-flash-1017',
      variant: 'max',
      ii: 33,
      pct: 61,
    },
  ]);
  const q = quality(a, 'oc/deepseek-v4.1-flash-free');
  assert.equal(q.value, 58);
  assert.equal(q.matchedVia, 'aa-origin-release-tag');
  assert.equal(quality(a, 'gcli/grok-4.7-turbo').matchedVia, 'aa-origin-variant');
});

test('origin join never strips an unpublished effort, merges distinct models, or ignores policy tags', (t) => {
  const grok = [
    { name: 'Grok 4.7 (Low)', base: 'grok-4-7', variant: 'low', ii: 30, pct: 54 },
    { name: 'Grok 4.7 (High)', base: 'grok-4-7', variant: 'high', ii: 35, pct: 63 },
  ];
  assert.equal(quality(policyDir(t, grok), 'gateway/grok4.7-xhigh'), undefined);
  const synth = [
    { name: 'Synthetic', base: 'synthetic', variant: '', ii: 5, pct: 10 },
    { name: 'Synthetic Thinking', base: 'synthetic-thinking', variant: '', ii: 50, pct: 90 },
  ];
  assert.equal(quality(policyDir(t, synth), 'gateway/synthetic-free').value, 10);
});

test('a deployment tag on an exact AA base never falls back to a shorter parent', (t) => {
  const a = policyDir(t, [
    { name: 'GLM-5', base: 'glm-5', variant: '', ii: 10, pct: 20 },
    { name: 'GLM-5.3', base: 'glm-5-3', variant: '', ii: 40, pct: 80 },
    { name: 'GPT-6', base: 'gpt-6', variant: '', ii: 20, pct: 30 },
    { name: 'GPT-6.1', base: 'gpt-6-1', variant: '', ii: 45, pct: 85 },
  ]);
  assert.equal(quality(a, 'gateway/glm-5.3-free').value, 80);
  assert.equal(quality(a, 'gateway/gpt-6.1-free').value, 85);
  assert.equal(quality(a, 'gateway/glm-5.3-prime').value, 80);
});

test('a name AA does not list takes its prefix family, then its vendor floor; an unknown vendor stays unscored', (t) => {
  const a = policyDir(t, [
    { name: 'GLM-5.3', base: 'glm-5-3', variant: '', ii: 40, pct: 80 },
    { name: 'GLM-5.3-Flash', base: 'glm-5-3-flash', variant: '', ii: 20, pct: 40 },
    { name: 'Kimi K3.1 Pro', base: 'kimi-k3-1-pro', variant: '', ii: 40, pct: 77 },
  ]);
  const q = quality(a, 'gateway/glm-5');
  assert.equal(q.value, 40);
  assert.equal(q.matchedVia, 'aa-origin-family');
  const vendor = quality(a, 'gateway/kimi-k2.6');
  assert.equal(vendor.value, 77);
  assert.equal(vendor.matchedVia, 'aa-origin-vendor');
  assert.equal(quality(a, 'gateway/unrelated-model'), undefined);
});
