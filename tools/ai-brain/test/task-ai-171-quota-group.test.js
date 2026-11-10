'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('../agy-pool-runtime');

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

const makeQuota = (tsv, groups) => ({ response: tsv, command: { data: { groups } } });
const geminiQuota = makeQuota('Gemini Models\tWeekly Limit Remaining\t95%\t2026-11-16T04:03:11Z', [
  { name: 'Gemini Models', description: 'Models within this group: Gemini Flash, Gemini Pro' },
]);

test('display-name alias (model id vs "Gemini 3.8 Flash (High)") maps correctly via buildModelGroupMap', () => {
  const modelsTxt = 'gemini-3.8-flash-high\tGemini 3.8 Flash (High)';
  assert.equal(
    pool.buildModelGroupMap(geminiQuota, modelsTxt)['gemini-3.8-flash-high'],
    'Gemini Models'
  );
});

test('resolveModelGroup resolves exact model group from patterns or modelGroups map', () => {
  const qr = {
    modelGroups: { 'gemini-3.8-flash-high': 'Gemini Models' },
    rows: [{ group: 'Gemini Models', model: 'gemini-3.8-flash-high' }],
  };
  assert.equal(pool.resolveModelGroup('gemini-3.8-flash-high', qr), 'Gemini Models');
  assert.equal(pool.resolveModelGroup('unknown-model', qr), null);
});
