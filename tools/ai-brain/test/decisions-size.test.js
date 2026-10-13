'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recordDecision, readDecisionsDetailed, compactDecisions } = require('../decisions');
const { spawnSync } = require('node:child_process');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-size-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test('caps inventories, retains chosen outside top ten, counts every rejection', (t) => {
  const dir = fixture(t);
  const candidates = Array.from({ length: 2000 }, (_, i) => ({
    candidateKey: 'c' + i,
    score: 2000 - i,
    scoreBreakdown: { prior: { score: 80, sources: Array(100).fill('source') }, quality: 4 },
  }));
  const record = recordDecision(
    {
      chosen: 'c1999',
      candidates,
      ranking: candidates,
      top3: candidates.slice(0, 3),
      rejected: candidates.map((c) => ({ candidateKey: c.candidateKey, reasonCode: 'QUOTA' })),
    },
    { dir }
  );
  assert.equal(record.candidates.length, 10);
  assert.equal(record.ranking.length, 10);
  assert.equal(record.top3.length, 3);
  assert.equal(record.candidatesCount, 2000);
  assert.deepEqual(record.chosenCandidate, candidates[1999]);
  assert.deepEqual(record.candidates[0].scoreBreakdown.prior, { score: 80 });
  assert.equal(record.rejected.length, 10);
  assert.equal(record.rejectedByReasonCode.QUOTA, 2000);
  assert.ok(JSON.stringify(record).length < 15000);
  assert.equal(candidates.length, 2000);
});
test('rolls before limit and reads numeric parts in chronological order', (t) => {
  const dir = fixture(t);
  const now = Date.now();
  for (let i = 0; i < 13; i++)
    recordDecision({ workItemId: String(i) }, { dir, now, maxFileBytes: 1 });
  const detail = readDecisionsDetailed({ dir, now });
  assert.equal(detail.readable, true);
  assert.deepEqual(
    detail.records.map((r) => r.workItemId),
    Array.from({ length: 13 }, (_, i) => String(i))
  );
  assert.equal(fs.readdirSync(dir).length, 13);
});
test('CLI compacts into new files, preserves originals and avoids duplicate history', (t) => {
  const dir = fixture(t);
  const file = path.join(dir, new Date().toISOString().slice(0, 10) + '.jsonl');
  const original =
    JSON.stringify({
      chosen: 'x',
      candidates: Array(100).fill({ candidateKey: 'x', score: 2 }),
      rejected: [],
    }) + '\n';
  fs.writeFileSync(file, original);
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../cli.js'), 'decisions', 'compact', '--dir', dir],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 0, result.stderr);
  const [output] = JSON.parse(result.stdout);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(JSON.parse(fs.readFileSync(output.output, 'utf8')).candidates.length, 10);
  assert.equal(readDecisionsDetailed({ dir }).records.length, 1);
  assert.throws(() => compactDecisions({}), /requires --dir/);
});

test('token report streams daily parts and excludes compact copies', (t) => {
  const dir = fixture(t);
  const usage = fixture(t);
  for (let i = 0; i < 12; i++)
    recordDecision(
      { workItemId: 'TASK', model: 'model', tokenUsage: { input: 1, output: 2 } },
      { dir, maxFileBytes: 1 }
    );
  compactDecisions({ dir });
  const result = require('../cli').tokenReportCommand(
    { dir: usage, 'decision-dir': dir },
    { log: () => {} }
  );
  assert.equal(result.records, 12);
  assert.equal(result.totals[0].input, 12);
  assert.equal(result.totals[0].output, 24);
});
