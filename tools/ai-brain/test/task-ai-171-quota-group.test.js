'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pool = require('../agy-pool-runtime');
const { poolAccountCandidates } = require('../candidates');

const fixturePath = path.join(__dirname, 'fixtures', 'task-ai-171-real-quota-out.json');

test('parseQuotaJson parses real-quota-out.json fixture with exact group names, windows, and percents', () => {
  const parsed = pool.parseQuotaJson(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
  assert.ok(parsed.rows.length >= 4);
  const gemWeekly = parsed.rows.find((r) => r.group === 'Gemini Models' && r.window === 'weekly');
  assert.equal(gemWeekly?.remainingPercent, 95);
  assert.ok(gemWeekly?.resetAt);
  const claudeWeekly = parsed.rows.find(
    (r) => r.group === 'Claude and GPT models' && r.window === 'weekly'
  );
  assert.equal(claudeWeekly?.remainingPercent, 49);
});

function testPool(quota, modelsTxt, catalogue) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-qg-'));
  const accDir = path.join(dir, 'agy01');
  fs.mkdirSync(accDir, { recursive: true });
  fs.writeFileSync(path.join(accDir, 'out.txt'), JSON.stringify(quota));
  if (modelsTxt !== undefined) fs.writeFileSync(path.join(accDir, 'models-out.txt'), modelsTxt);
  return poolAccountCandidates({
    fakeRunsDir: dir,
    catalogue: catalogue.map((m) => ({ modelId: m, upstream: 'antigravity' })),
    keepExhausted: true,
  });
}

const makeQuota = (tsv, groups) => ({ response: tsv, command: { data: { groups } } });
const geminiQuota = makeQuota('Gemini Models\tWeekly Limit Remaining\t95%\t2026-11-16T04:03:11Z', [
  { name: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro' },
]);

test('case (a): Argon group 0% + Gemini Models 97% -> gemini-3.8-flash-high kept, gemini-4-argon blocked', () => {
  const quota = makeQuota(
    'Gemini 4 Argon\tWeekly Limit Remaining\t0%\t2026-11-16T04:03:11Z\nGemini Models\tWeekly Limit Remaining\t97%\t2026-11-16T04:03:11Z',
    [
      { name: 'Gemini 4 Argon', description: 'Models within this group: Gemini 4 Argon' },
      { name: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro' },
    ]
  );
  const res = testPool(
    quota,
    'gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ngemini-4-argon\tGemini 4 Argon',
    ['gemini-3.8-flash-high', 'gemini-4-argon']
  );
  assert.equal(res.find((c) => c.modelId === 'gemini-3.8-flash-high')?.blocked, false);
  const argon = res.find((c) => c.modelId === 'gemini-4-argon');
  assert.equal(argon?.blocked, true);
  assert.equal(argon?.blockReason, 'QUOTA_EXHAUSTED');
});

test('case (b): Claude-and-GPT weekly 0% -> claude-opus-4-6-thinking blocked even though five-hour is 100%', () => {
  const quota = makeQuota(
    'Claude and GPT models\tWeekly Limit Remaining\t0%\t2026-11-16T03:23:26Z\nClaude and GPT models\tFive Hour Limit Remaining\t100%\t2026-11-09T17:34:12Z',
    [
      {
        name: 'Claude and GPT models',
        description: 'Models within this group: Claude Opus, Claude Sonnet, GPT-OSS',
      },
    ]
  );
  const res = testPool(quota, 'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)', [
    'claude-opus-4-6-thinking',
  ]);
  const opus = res.find((c) => c.modelId === 'claude-opus-4-6-thinking');
  assert.equal(opus?.blocked, true);
  assert.equal(opus?.blockReason, 'QUOTA_EXHAUSTED');
});

test('case (c): display-name alias (model id vs "Gemini 3.8 Flash (High)") maps correctly', () => {
  const modelsTxt = 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)';
  assert.equal(
    pool.buildModelGroupMap(geminiQuota, modelsTxt)['gemini-3.8-flash-high'],
    'Gemini Models'
  );
  const res = testPool(geminiQuota, modelsTxt, ['gemini-3.8-flash-high']);
  assert.equal(res.find((c) => c.modelId === 'gemini-3.8-flash-high')?.blocked, false);
});

test('case (d): model with no group mapping -> QUOTA_GROUP_UNKNOWN', () => {
  const cand = testPool(geminiQuota, 'gemini-custom-unmapped\tGemini Custom Unmapped', [
    'gemini-custom-unmapped',
  ]).find((c) => c.modelId === 'gemini-custom-unmapped');
  assert.equal(cand?.blocked, true);
  assert.equal(cand?.blockReason, 'QUOTA_GROUP_UNKNOWN');
});
