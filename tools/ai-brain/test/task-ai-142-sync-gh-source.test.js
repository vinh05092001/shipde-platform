'use strict';

// The register sync reads merged PRs from GitHub through governed-merge's
// runGh. Live 17/10: runGh was not exported, the require threw inside a
// try/catch, and GOAL-AUTOCLAW-REPOS-5 (PR #361) stayed IN_PROGRESS after
// merge. These tests use the real GitHub path with an injected gh runner.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const reconcile = require('../reconcile');
const governedMerge = require('../governed-merge');

const HEADER =
  '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"';
const row = (id, status, deps = '') =>
  `"1","GOAL","Goal: X","${id}","GOAL-X","n","k","${status}","${deps}","docs/product-spec/work-items/${id}.md","","","",""`;

test('governed-merge exports runGh for the register sync', () => {
  assert.equal(typeof governedMerge.runGh, 'function');
});

test('a merged PR from gh marks the canonical and goal registers MERGED', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-gh-'));
  try {
    const canonical = path.join(
      root,
      'docs',
      'product-spec',
      'docs',
      '10-ai-collaboration',
      'FEATURE-DELIVERY-REGISTER.csv'
    );
    const goalReg = path.join(root, 'data', 'goals', 'X', 'register.csv');
    for (const f of [canonical, goalReg]) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(
        f,
        [HEADER, row('GOAL-X-1', 'IN_PROGRESS'), row('GOAL-X-2', 'BACKLOG', 'GOAL-X-1')].join(
          '\n'
        ) + '\n'
      );
    }
    const calls = [];
    const ghRunner = (args) => {
      calls.push(args.join(' '));
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            number: 361,
            title: '[GOAL-X-1] Something',
            mergeCommit: { oid: 'a'.repeat(40) },
          },
        ]),
        stderr: '',
      };
    };
    reconcile.syncMergedPullRequestsToRegister(
      { rootDir: root, dataDir: path.join(root, 'data') },
      { ghRunner }
    );
    assert.ok(
      calls.some((c) => c.startsWith('pr list')),
      'gh pr list was never called'
    );
    for (const f of [canonical, goalReg]) {
      const text = fs.readFileSync(f, 'utf8');
      assert.match(text, /"GOAL-X-1","GOAL-X","n","k","MERGED"/, f);
      assert.match(text, /"GOAL-X-2","GOAL-X","n","k","BACKLOG"/, f);
      assert.doesNotMatch(text, /"PASS"/, 'a merge is not review evidence');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
