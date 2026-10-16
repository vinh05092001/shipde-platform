'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jev = require('../jev');

test('JEV score questions send criteria within the API level limit', async () => {
  let body;
  const ask = jev.buildJevAsk(
    {
      id: 'jev',
      kind: 'decision-service',
      endpoint: 'https://jev.invalid/v1',
      model: 'm',
      credential: { type: 'api-key', env: 'JEV_TEST_KEY' },
    },
    { env: { JEV_TEST_KEY: 'x' }, httpClient: async (_url, b) => ((body = b), { answers: {} }) }
  );
  await ask({
    kind: 'assess-task-profile',
    options: ['BALANCED', 'QUALITY_FIRST'],
    state: {},
    scoreDimensions: [{ name: 'qualityImportance', instructions: 'q' }],
  }).catch(() => {});
  const q = body.questions.qualityImportance;
  assert.equal(q.type, 'score');
  assert.ok(Array.isArray(q.criteria) && q.criteria.length > 0, 'criteria, not levels');
  assert.equal(q.levels, undefined);
  assert.ok(q.criteria.length <= 10, 'the API accepts at most 10 score levels');
});
