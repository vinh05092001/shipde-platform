'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  recordDecision,
  readDecisionsDetailed,
  compactDecisions,
  capDecision,
  summarizeOldRankingFiles,
} = require('../decisions');
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

test('capDecision limits rejected samples per (harness, reason) pair and reduces size >= 80%', () => {
  // Simulate trial 14 data with 120 rejected items from paseo harness with same failure reason
  const rejected = Array.from({ length: 120 }, (_, i) => ({
    candidateKey: `paseo::claude-3-5-sonnet-${i}::acct-${i}`,
    harness: 'paseo',
    reasonCode: 'WRITER_SCHEMA_NOT_VERIFIED_BUDGET',
    detail: 'Schema not verified for budget and constraints',
    score: 80,
    evidence: { probe: { elapsedMs: 1200 + i, pass: true } },
  }));
  // Plus 10 items from codex with QUOTA
  for (let i = 0; i < 10; i++) {
    rejected.push({
      candidateKey: `codex::gpt-5-${i}::acct-${i}`,
      harness: 'codex',
      reasonCode: 'QUOTA',
      detail: 'Insufficient quota',
    });
  }

  const rawEntry = {
    workItemId: 'TASK-AI-142',
    chosen: 'agy::gemini-3.8-flash-high',
    candidates: [{ candidateKey: 'agy::gemini-3.8-flash-high', score: 95 }],
    rejected,
  };

  const rawSize = Buffer.byteLength(JSON.stringify(rawEntry));
  const capped = capDecision(rawEntry);
  const cappedSize = Buffer.byteLength(JSON.stringify(capped));

  // Should reduce size by >= 80%
  const reduction = (rawSize - cappedSize) / rawSize;
  assert.ok(reduction >= 0.8, `Expected reduction >= 80%, got ${(reduction * 100).toFixed(1)}%`);

  // Max 2 samples per (harness, reason) pair by default (from sources.json decisionSampleCap)
  const paseoCount = capped.rejected.filter((r) => r.candidateKey.startsWith('paseo::')).length;
  const codexCount = capped.rejected.filter((r) => r.candidateKey.startsWith('codex::')).length;
  assert.equal(paseoCount, 2);
  assert.equal(codexCount, 2);

  // Full counts preserved
  assert.equal(capped.rejectedCount, 130);
  assert.equal(capped.rejectedByReasonCode.WRITER_SCHEMA_NOT_VERIFIED_BUDGET, 120);
  assert.equal(capped.rejectedByReasonCode.QUOTA, 10);
});

test('summarizeOldRankingFiles aggregates old ranking files and removes them while keeping fresh files', (t) => {
  const dir = fixture(t);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Create an old ranking file (10 days old, exceeds 7 days retention)
  const oldRankingPath = path.join(dir, 'ranking-2026-10-09T10-00-00.000Z.json');
  fs.writeFileSync(
    oldRankingPath,
    JSON.stringify({
      workItemId: 'OLD-TASK',
      chosen: 'agy01',
      candidates: [{ candidateKey: 'agy01', score: 90 }],
      rejected: [
        { candidateKey: 'paseo::m1', reasonCode: 'QUOTA' },
        { candidateKey: 'paseo::m2', reasonCode: 'QUOTA' },
        { candidateKey: 'paseo::m3', reasonCode: 'RATE' },
      ],
    }),
    'utf8'
  );
  // Set mtime to 10 days ago
  const oldTime = new Date(now - 10 * dayMs);
  fs.utimesSync(oldRankingPath, oldTime, oldTime);

  // Create a fresh ranking file (2 days old)
  const freshRankingPath = path.join(dir, 'ranking-2026-10-17T10-00-00.000Z.json');
  fs.writeFileSync(
    freshRankingPath,
    JSON.stringify({
      workItemId: 'FRESH-TASK',
      chosen: 'agy02',
      candidates: [{ candidateKey: 'agy02', score: 85 }],
      rejected: [],
    }),
    'utf8'
  );
  const freshTime = new Date(now - 2 * dayMs);
  fs.utimesSync(freshRankingPath, freshTime, freshTime);

  const result = summarizeOldRankingFiles({ dir, now, decisionRetentionDays: 7 });
  assert.equal(result.removed, 1);
  assert.equal(result.summarized, 1);

  // Old file was removed
  assert.equal(fs.existsSync(oldRankingPath), false);
  // Fresh file remains
  assert.equal(fs.existsSync(freshRankingPath), true);

  // Summary file exists and contains summarized data
  const summaryFile = path.join(dir, 'ranking-summary.json');
  assert.equal(fs.existsSync(summaryFile), true);
  const summaryContent = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
  assert.equal(summaryContent.length, 1);
  assert.equal(summaryContent[0].file, 'ranking-2026-10-09T10-00-00.000Z.json');
  assert.equal(summaryContent[0].rejectedCount, 3);
  assert.equal(summaryContent[0].rejectedByReasonCode.QUOTA, 2);
  assert.equal(summaryContent[0].rejectedByReasonCode.RATE, 1);
});

test('summarizeOldRankingFiles preserves source rankings when the summary cannot be replaced', (t) => {
  const dir = fixture(t);
  const now = Date.now();
  const oldRankingPath = path.join(dir, 'ranking-write-failure.json');
  fs.writeFileSync(oldRankingPath, JSON.stringify({ candidates: [], rejected: [] }), 'utf8');
  const oldTime = new Date(now - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldRankingPath, oldTime, oldTime);

  const invalidSummaryTarget = path.join(dir, 'missing-parent', 'ranking-summary.json');

  assert.throws(() =>
    summarizeOldRankingFiles({
      dir,
      now,
      decisionRetentionDays: 1,
      summaryFile: invalidSummaryTarget,
    })
  );
  assert.equal(fs.existsSync(oldRankingPath), true);
});

test('summarizeOldRankingFiles rolls overflow into the configured entry bound', (t) => {
  const dir = fixture(t);
  const now = Date.now();
  const rankingSummaryMaxEntries = 3;
  const fileCount = rankingSummaryMaxEntries + 2;

  for (let i = 0; i < fileCount; i += 1) {
    const rankingPath = path.join(dir, `ranking-bounded-${i}.json`);
    fs.writeFileSync(
      rankingPath,
      JSON.stringify({
        candidates: Array.from({ length: i + 1 }, () => ({ candidateKey: 'candidate' })),
        rejected: [{ candidateKey: 'rejected', reasonCode: i % 2 ? 'BUSY' : 'QUOTA' }],
      }),
      'utf8'
    );
    const oldTime = new Date(now - (fileCount + i + 1) * 24 * 60 * 60 * 1000);
    fs.utimesSync(rankingPath, oldTime, oldTime);
  }

  summarizeOldRankingFiles({
    dir,
    now,
    dispatch: { decisionRetentionDays: 1, rankingSummaryMaxEntries },
  });

  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'ranking-summary.json'), 'utf8'));
  assert.equal(summary.length, rankingSummaryMaxEntries);
  assert.equal(summary[0].kind, 'rollup');
  assert.equal(summary[0].filesCount, fileCount - rankingSummaryMaxEntries + 1);
  assert.equal(
    summary.reduce((total, entry) => total + (entry.filesCount || 1), 0),
    fileCount
  );
  assert.equal(
    summary.reduce((total, entry) => total + entry.rejectedCount, 0),
    fileCount
  );

  const nextRankingPath = path.join(dir, 'ranking-bounded-next.json');
  fs.writeFileSync(
    nextRankingPath,
    JSON.stringify({ candidates: [], rejected: [{ reasonCode: 'BUSY' }] }),
    'utf8'
  );
  const nextOldTime = new Date(now - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(nextRankingPath, nextOldTime, nextOldTime);
  summarizeOldRankingFiles({
    dir,
    now,
    dispatch: { decisionRetentionDays: 1, rankingSummaryMaxEntries },
  });

  const replacedSummary = JSON.parse(
    fs.readFileSync(path.join(dir, 'ranking-summary.json'), 'utf8')
  );
  assert.equal(replacedSummary.length, rankingSummaryMaxEntries);
  assert.equal(
    replacedSummary.reduce((total, entry) => total + (entry.filesCount || 1), 0),
    fileCount + 1
  );
});

function oldRanking(dir, name, now) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({ candidates: [], rejected: [{ reasonCode: 'QUOTA' }] }));
  const when = new Date(now - 3 * 24 * 60 * 60 * 1000);
  fs.utimesSync(file, when, when);
  return file;
}

test('recordDecision retires old rankings into the summary through its retention path', (t) => {
  const dir = fixture(t);
  const now = Date.now();
  const ranking = oldRanking(dir, 'ranking-record-path.json', now);
  recordDecision(
    { stage: 'SELECTED', chosen: 'c0' },
    { dir, now, dispatch: { decisionRetentionDays: 1, rankingSummaryMaxEntries: 5 } }
  );
  assert.equal(fs.existsSync(ranking), false);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'ranking-summary.json'), 'utf8'));
  assert.equal(summary[0].file, 'ranking-record-path.json');
});

test('compactDecisions retires old rankings and keeps them when the summary write fails', (t) => {
  const dir = fixture(t);
  const now = Date.now();
  const ranking = oldRanking(dir, 'ranking-compact-path.json', now);
  assert.throws(() =>
    compactDecisions({
      dir,
      now,
      dispatch: { decisionRetentionDays: 1, rankingSummaryMaxEntries: 5 },
      summaryFile: path.join(dir, 'missing-parent', 'ranking-summary.json'),
    })
  );
  assert.equal(fs.existsSync(ranking), true);
  compactDecisions({
    dir,
    now,
    dispatch: { decisionRetentionDays: 1, rankingSummaryMaxEntries: 5 },
  });
  assert.equal(fs.existsSync(ranking), false);
});

test('invalid retention configuration raises on every path and deletes nothing', (t) => {
  const dir = fixture(t);
  const now = Date.now();
  const ranking = oldRanking(dir, 'ranking-invalid-config.json', now);
  assert.throws(
    () => summarizeOldRankingFiles({ dir, now, dispatch: { decisionRetentionDays: 0 } }),
    /DISPATCH_CONFIG_INVALID/
  );
  assert.throws(
    () =>
      recordDecision(
        { stage: 'SELECTED' },
        { dir, now, dispatch: { rankingSummaryMaxEntries: -1 } }
      ),
    /DISPATCH_CONFIG_INVALID/
  );
  assert.throws(
    () => compactDecisions({ dir, now, dispatch: { decisionRetentionDays: 'x' } }),
    /DISPATCH_CONFIG_INVALID/
  );
  assert.equal(fs.existsSync(ranking), true);
  assert.equal(readDecisionsDetailed({ dir, now }).records.length, 0);
});

test('a source left behind after the summary was replaced is never counted twice', (t) => {
  const dir = fixture(t);
  const now = Date.now();
  const dispatch = { decisionRetentionDays: 1, rankingSummaryMaxEntries: 1 };
  const first = oldRanking(dir, 'ranking-left-a.json', now);
  const second = oldRanking(dir, 'ranking-left-b.json', now);
  const realUnlink = fs.unlinkSync;
  fs.unlinkSync = () => {
    throw Object.assign(new Error('busy'), { code: 'EBUSY' });
  };
  try {
    summarizeOldRankingFiles({ dir, now, dispatch });
  } finally {
    fs.unlinkSync = realUnlink;
  }
  assert.equal(fs.existsSync(first), true);
  assert.equal(fs.existsSync(second), true);
  summarizeOldRankingFiles({ dir, now, dispatch });
  summarizeOldRankingFiles({ dir, now, dispatch });
  assert.equal(fs.existsSync(first), false);
  assert.equal(fs.existsSync(second), false);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'ranking-summary.json'), 'utf8'));
  const counted = summary.filter((entry) => entry.kind !== 'pending');
  assert.equal(
    counted.reduce((total, entry) => total + (entry.filesCount || 1), 0),
    2
  );
  assert.equal(
    counted.reduce((total, entry) => total + entry.rejectedCount, 0),
    2
  );
});
