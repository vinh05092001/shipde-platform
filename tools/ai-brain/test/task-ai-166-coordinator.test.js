'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  writerAlive,
  canReroute,
  chooseWriter,
  reviewPrompt,
  partitionFindings,
  coordinatorTick,
  metricsSummary,
  unionRegister,
  preflight,
} = require('../coordinator');

const NOW = 1800000000000;
test('PID or recent current log prevents reroute; 8min boundary is inclusive', () => {
  assert.equal(writerAlive({ pid: 3 }, { pidAlive: () => true, now: NOW }), true);
  assert.equal(
    writerAlive(
      { pid: 3, log: 'log' },
      { pidAlive: () => false, logMtime: () => NOW - 179999, now: NOW }
    ),
    true
  );
  assert.equal(
    canReroute(
      { writer: { log: 'log' }, lastRouteAt: NOW - 900000 },
      { now: NOW, logMtime: () => NOW - 1000 }
    ),
    false
  );
  assert.equal(canReroute({ lastRouteAt: NOW - 479999 }, { now: NOW }), false);
  assert.equal(canReroute({ lastRouteAt: NOW - 480000 }, { now: NOW }), true);
});
test('selection excludes quota, unconfigured models, launch saturation and escalates after one round', () => {
  const models = [
    { model: 'p/m', family: 'a', score: 95, harness: 'opencode' },
    { model: 'p/n', family: 'b', score: 85, harness: 'opencode' },
    { model: 'p/o', family: 'c', score: 79, harness: 'opencode' },
  ];
  const config = new Set(models.map((m) => m.model));
  assert.equal(
    chooseWriter(models, {
      configured: config,
      exhausted: [{ model: 'p/m', until: NOW + 1 }],
      now: NOW,
      highRisk: true,
    }).model,
    'p/n'
  );
  assert.equal(
    chooseWriter(models, { configured: config, failedWriters: ['p/m'], now: NOW }).model,
    'p/n'
  );
  assert.equal(chooseWriter(models, { configured: new Set(['p/o']), now: NOW }).model, 'p/o');
  assert.equal(
    chooseWriter(models, {
      configured: config,
      launches: [
        { model: 'p/m', at: NOW },
        { model: 'p/m', at: NOW },
      ],
      now: NOW,
    }).model,
    'p/n'
  );
});
test('fixed prompt contains all contract checks then open sweep with previous findings', () => {
  const prompt = reviewPrompt({ id: 'TASK-AI-166', pr: 10 }, 'abc', 'prior finding');
  for (const word of [
    'tenant',
    'RBAC',
    'empty scope',
    'negative tests',
    'acceptance',
    'integer VND',
    'idempotency',
    'reconcile',
    'audit',
    'PII',
    'UI',
    'FIXED',
    'NOT FIXED',
    'Phase 2',
    'prior finding',
    'abc',
  ])
    assert.ok(prompt.includes(word), word);
});
test('fan-out joins overlapping file sets, shared files lane 1 and <=3 lanes', () => {
  const lanes = partitionFindings([
    { files: ['apps/api/a.ts'], text: 'A' },
    { files: ['apps/web/b.ts'], text: 'B' },
    { files: ['apps/api/a.ts', 'packages/contracts/x.ts'], text: 'C' },
    { files: ['tools/z.js'], text: 'D' },
    { files: ['scripts/x.js'], text: 'E' },
  ]);
  assert.equal(lanes.length, 3);
  assert.ok(lanes[0].files.includes('packages/contracts/x.ts'));
  const files = lanes.flatMap((lane) => lane.files);
  assert.equal(new Set(files).size, files.length);
  assert.equal(
    partitionFindings([
      { files: [], text: 'unowned' },
      { files: ['apps/x.ts'], text: 'owned' },
    ]).length,
    1
  );
});
test('CSV union preserves both additions, refuses same item disagreement and handles quoted commas', () => {
  const head = '"id","name"\n';
  assert.equal(
    unionRegister(head + '"A","one, two"\n', head + '"B","three"\n'),
    head + '"A","one, two"\n"B","three"\n'
  );
  assert.throws(() => unionRegister(head + '"A","x"\n', head + '"A","y"\n'), /REGISTER_CONFLICT/);
});
test('preflight rejects bad subject, protected paths and whitespace', () => {
  assert.equal(preflight('TASK-AI-166', ['other'], [], '').ok, false);
  for (const file of [
    '.github/a.yml',
    'tools/semgrep/x',
    'scripts/a-allowlist.json',
    'data/baselines/a',
    'lefthook.yml',
    '.prettierrc.json',
  ])
    assert.equal(preflight('TASK-AI-166', ['[TASK-AI-166] x'], [file], '').ok, false, file);
  assert.equal(
    preflight('TASK-AI-166', ['[TASK-AI-166] x'], ['tools/ai-brain/a.js'], 'bad whitespace').ok,
    false
  );
});

function rig(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      now: NOW,
      refresh: async () => {
        calls.push('refresh');
        return { ok: true };
      },
      inspect: async () => ({ sha: 'a'.repeat(40), dirty: false }),
      prepare: async () => ({ ok: true, sha: 'a'.repeat(40) }),
      push: async () => calls.push('push'),
      ci: async () => ({ state: 'green', sha: 'a'.repeat(40) }),
      candidates: async () => [
        { model: 'p/w', family: 'w', score: 90, harness: 'opencode' },
        { model: 'p/r', family: 'r', score: 89, harness: 'opencode' },
      ],
      configured: new Set(['p/w', 'p/r']),
      review: async (item, reviewer, prompt, sha) => {
        calls.push(['review', reviewer.family, prompt]);
        return {
          verdict: 'CHANGES_REQUIRED',
          sha,
          findings: [{ files: ['apps/a.js'], text: 'repair' }],
          tokens: 10,
        };
      },
      launch: async (item, writer) => {
        calls.push(['launch', writer.model]);
        return { pid: 123 };
      },
      history: async () => calls.push('history'),
      metrics: async () => calls.push('metrics'),
      save: async () => {},
      ...overrides,
    },
  };
}
const item = { id: 'TASK-AI-166', pr: 10, cwd: 'fixture', task: 'task.md' };
test('alive writer suppresses inspection, commit, launch and review', async () => {
  const { calls, deps } = rig({
    pidAlive: () => true,
    inspect: async () => {
      throw new Error('must not inspect');
    },
  });
  await coordinatorTick(
    [item],
    { items: { [item.id]: { writer: { pid: 3 } } }, lastRefreshAt: NOW },
    deps
  );
  assert.deepEqual(calls, []);
});
test('dead sandbox writer commits through host then gate refusal becomes review feedback', async () => {
  let committed = false;
  const { calls, deps } = rig({
    inspect: async () => ({ sha: 'a'.repeat(40), dirty: !committed }),
    commit: async () => {
      committed = true;
      calls.push('commit');
    },
    prepare: async () => ({ ok: false, reason: 'PROTECTED_PATH' }),
  });
  const state = {
    items: { [item.id]: { writer: { model: 'p/w', family: 'w', cannotCommit: true } } },
    lastRefreshAt: NOW,
  };
  await coordinatorTick([item], state, deps);
  assert.ok(calls.includes('commit'));
  assert.ok(calls.includes('history'));
  assert.ok(calls.includes('metrics'));
  assert.equal(calls.includes('push'), false);
  assert.equal(state.items[item.id].lastVerdict, 'CHANGES_REQUIRED');
});
test('red CI is a zero-token CHANGES_REQUIRED round without reviewer, four rounds STUCK', async () => {
  const { calls, deps } = rig({
    ci: async () => ({ state: 'red', sha: 'a'.repeat(40), reason: 'lint' }),
  });
  const state = {
    items: { [item.id]: { rounds: 3, writer: { model: 'p/w', family: 'w' } } },
    lastRefreshAt: NOW,
  };
  await coordinatorTick([item], state, deps);
  assert.equal(state.items[item.id].status, 'STUCK');
  assert.ok(calls.includes('metrics'));
  assert.equal(
    calls.some((call) => Array.isArray(call) && call[0] === 'review'),
    false
  );
  assert.equal(
    calls.some((call) => Array.isArray(call) && call[0] === 'launch'),
    false
  );
});
test('green CI calls different-family reviewer; history persists and stronger failed model rotates', async () => {
  const { calls, deps } = rig();
  const state = {
    items: { [item.id]: { writer: { model: 'p/w', family: 'w' } } },
    lastRefreshAt: NOW,
  };
  await coordinatorTick([item], state, deps);
  assert.equal(calls.find((call) => Array.isArray(call) && call[0] === 'review')[1], 'r');
  assert.equal(calls.find((call) => Array.isArray(call) && call[0] === 'launch')[1], 'p/r');
  assert.equal(state.items[item.id].rounds, 1);
});
test('pending CI does not consume rounds; daily refresh is persisted and runs once', async () => {
  const { calls, deps } = rig({ ci: async () => ({ state: 'pending', sha: 'a'.repeat(40) }) });
  const state = {};
  await coordinatorTick([item], state, deps);
  await coordinatorTick([item], state, deps);
  assert.equal(calls.filter((call) => call === 'refresh').length, 1);
  assert.equal(state.items[item.id].rounds || 0, 0);
});
test('stale SHA, unbound PASS or PASS with findings cannot complete an item', async () => {
  for (const result of [
    { verdict: 'PASS', sha: 'b'.repeat(40) },
    { verdict: 'PASS' },
    { verdict: 'PASS', sha: 'a'.repeat(40), findings: [{ text: 'open' }] },
  ]) {
    const { deps } = rig({ review: async () => result });
    const state = {
      items: { [item.id]: { writer: { family: 'w', model: 'p/w' } } },
      lastRefreshAt: NOW,
    };
    await coordinatorTick([item], state, deps);
    assert.notEqual(state.items[item.id].status, 'PASS');
  }
});
test('metrics summary uses final PASS per PR and actual merged PR tokens, deduplicates retries', () => {
  const rows = [1, 2, 3, 4].map((round) => ({
    item: 'A',
    pr: 1,
    sha: 'a',
    round,
    verdict: round === 4 ? 'PASS' : 'CHANGES_REQUIRED',
    tokens: 10,
    ciRed: round === 1,
  }));
  rows.push({ item: 'B', pr: 2, sha: 'b', round: 2, verdict: 'PASS', tokens: 100 });
  rows.push(rows[0]);
  assert.deepEqual(metricsSummary(rows, new Set([1])), {
    reviews: 5,
    medianRoundsToPass: 3,
    p90RoundsToPass: 4,
    ciRedRate: 0.2,
    mergedPRs: 1,
    tokensPerMergedPR: 40,
  });
});
