'use strict';

// goal resume promotes a BACKLOG goal item to READY_FOR_AUTHOR once all its
// dependencies merged and its Work Item file exists. Live 17/10: after
// GOAL-AUTOCLAW-REPOS-1 merged, item 2 stayed BACKLOG and the runner stopped
// with "plan --run requires the isolated planner".

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { promoteReadyGoalRows } = require('../goals');

function row(id, status, deps, spec) {
  return ['1', 'GOAL', 'Goal: X', id, 'GOAL-X', 'n', 'k', status, deps, spec, '', '', '', ''];
}

test('only BACKLOG items with every dependency merged and a Work Item file are promoted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-ready-'));
  try {
    const dir = path.join(root, 'docs', 'product-spec', 'work-items');
    fs.mkdirSync(dir, { recursive: true });
    for (const n of [2, 3, 5]) fs.writeFileSync(path.join(dir, `GOAL-X-${n}.md`), '# spec\n');
    const spec = (n) => `docs/product-spec/work-items/GOAL-X-${n}.md`;
    const rows = [
      row('GOAL-X-1', 'MERGED', '', spec(1)),
      row('GOAL-X-2', 'BACKLOG', 'GOAL-X-1', spec(2)),
      row('GOAL-X-3', 'BACKLOG', 'GOAL-X-1;GOAL-X-2', spec(3)),
      row('GOAL-X-4', 'BACKLOG', 'GOAL-X-1', spec(4)),
      row('GOAL-X-5', 'BLOCKED', 'GOAL-X-1', spec(5)),
    ];
    assert.equal(promoteReadyGoalRows(rows, root), 1);
    assert.deepEqual(
      rows.map((r) => r[7]),
      ['MERGED', 'READY_FOR_AUTHOR', 'BACKLOG', 'BACKLOG', 'BLOCKED']
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
