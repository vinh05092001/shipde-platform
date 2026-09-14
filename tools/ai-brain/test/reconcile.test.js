/**
 * Ship Dễ — Register Reconciliation Test Suite
 *
 * Each rule is exercised through injected fact functions, so the suite proves
 * the reasoning rather than the state of whatever repository it runs in.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { reconcileRegister, parseDependencies, findDuplicateIds } = require('../reconcile');

const NOTHING_EXISTS = {
  commitExists: () => false,
  isAncestorOf: () => false,
  branchExists: () => false,
  fileExists: () => true,
  headSha: () => null,
};

const EVERYTHING_EXISTS = {
  commitExists: () => true,
  isAncestorOf: () => true,
  branchExists: () => true,
  fileExists: () => true,
  headSha: () => 'deadbeef',
};

function row(over) {
  return Object.assign(
    {
      work_item_id: 'FEAT-X-01',
      status: 'BLOCKED_BY_FOUNDATION',
      dependencies: '',
      work_item_path: '',
      branch: '',
      pr: '',
      codex_verdict: '',
      merge_commit: '',
    },
    over
  );
}

const codes = (result) => result.findings.map((f) => f.code);

describe('Register reconciliation', () => {
  describe('Claims of completion', () => {
    test('MERGED without a merge commit is an error', () => {
      const r = reconcileRegister(
        [row({ status: 'MERGED', codex_verdict: 'PASS' })],
        EVERYTHING_EXISTS
      );
      assert.ok(codes(r).includes('MERGED_WITHOUT_COMMIT'));
      assert.equal(r.trustworthy, false);
    });

    test('a merge commit that does not exist is an error', () => {
      const r = reconcileRegister(
        [row({ status: 'MERGED', codex_verdict: 'PASS', merge_commit: 'abc1234' })],
        Object.assign({}, EVERYTHING_EXISTS, { commitExists: () => false })
      );
      assert.ok(codes(r).includes('MERGE_COMMIT_MISSING'));
    });

    test('a real commit that is not reachable from main is an error', () => {
      // The dangerous case: a commit exists on an abandoned branch and is
      // quoted as proof of delivery.
      const r = reconcileRegister(
        [row({ status: 'MERGED', codex_verdict: 'PASS', merge_commit: 'abc1234' })],
        Object.assign({}, EVERYTHING_EXISTS, { isAncestorOf: () => false })
      );
      assert.ok(codes(r).includes('MERGE_COMMIT_NOT_REACHABLE'));
      assert.equal(r.trustworthy, false);
    });

    test('MERGED without a PASS verdict is an error', () => {
      for (const verdict of ['', 'CHANGES_REQUIRED', 'BLOCKED', 'pass']) {
        const r = reconcileRegister(
          [row({ status: 'MERGED', codex_verdict: verdict, merge_commit: 'abc1234' })],
          EVERYTHING_EXISTS
        );
        assert.ok(
          codes(r).includes('MERGED_WITHOUT_PASS'),
          'verdict rejected: ' + (verdict || 'empty')
        );
      }
    });

    test('a fully evidenced MERGED row produces no finding', () => {
      const r = reconcileRegister(
        [row({ status: 'MERGED', codex_verdict: 'PASS', merge_commit: 'abc1234' })],
        EVERYTHING_EXISTS
      );
      assert.deepEqual(r.findings, []);
      assert.equal(r.trustworthy, true);
    });
  });

  describe('Blocks that are no longer true', () => {
    test('flags a block whose dependency has merged', () => {
      const r = reconcileRegister(
        [
          row({
            work_item_id: 'TASK-FOUND-04',
            status: 'MERGED',
            codex_verdict: 'PASS',
            merge_commit: 'a1b2c3d',
          }),
          row({
            work_item_id: 'FEAT-AUTH-01',
            status: 'BLOCKED_BY_FOUNDATION',
            dependencies: 'TASK-FOUND-04',
          }),
        ],
        EVERYTHING_EXISTS
      );
      const f = r.findings.find((x) => x.code === 'BLOCK_NO_LONGER_TRUE');
      assert.ok(f, 'the stale block is reported');
      assert.equal(f.workItemId, 'FEAT-AUTH-01');
      assert.equal(f.severity, 'warn', 'understatement is a warning, not an error');
    });

    test('does not flag a block whose dependency is still open', () => {
      const r = reconcileRegister(
        [
          row({ work_item_id: 'TASK-FOUND-04', status: 'READY_FOR_CODEX' }),
          row({
            work_item_id: 'FEAT-AUTH-01',
            status: 'BLOCKED_BY_FOUNDATION',
            dependencies: 'TASK-FOUND-04',
          }),
        ],
        EVERYTHING_EXISTS
      );
      assert.ok(!codes(r).includes('BLOCK_NO_LONGER_TRUE'));
    });

    test('requires every dependency to have merged, not just one', () => {
      const r = reconcileRegister(
        [
          row({
            work_item_id: 'A-1',
            status: 'MERGED',
            codex_verdict: 'PASS',
            merge_commit: 'aaa1111',
          }),
          row({ work_item_id: 'B-1', status: 'READY_FOR_AUTHOR' }),
          row({ work_item_id: 'C-1', status: 'BLOCKED_DEPENDENCY', dependencies: 'A-1; B-1' }),
        ],
        EVERYTHING_EXISTS
      );
      assert.ok(!codes(r).includes('BLOCK_NO_LONGER_TRUE'));
    });

    test('an unknown dependency is reported without pretending the block resolved', () => {
      const r = reconcileRegister(
        [row({ status: 'BLOCKED_DEPENDENCY', dependencies: 'GHOST-99' })],
        EVERYTHING_EXISTS
      );
      assert.ok(codes(r).includes('DEPENDENCY_UNKNOWN'));
      assert.ok(!codes(r).includes('BLOCK_NO_LONGER_TRUE'));
    });
  });

  describe('Work that landed but was not recorded', () => {
    test('flags a branch already contained in main while the status says otherwise', () => {
      const r = reconcileRegister(
        [row({ status: 'READY_FOR_CODEX', branch: 'feat/task-found-04' })],
        EVERYTHING_EXISTS
      );
      const f = r.findings.find((x) => x.code === 'MERGE_NOT_RECORDED');
      assert.ok(f, 'the unrecorded merge is reported');
      assert.equal(f.severity, 'warn');
      assert.equal(f.evidence.branch, 'feat/task-found-04');
    });

    test('does not flag a branch that has not landed', () => {
      const r = reconcileRegister(
        [row({ status: 'READY_FOR_CODEX', branch: 'feat/in-flight' })],
        Object.assign({}, EVERYTHING_EXISTS, { isAncestorOf: () => false })
      );
      assert.ok(!codes(r).includes('MERGE_NOT_RECORDED'));
    });
  });

  describe('Records that point at nothing', () => {
    test('a missing spec is an error once the row claims to be merged or ready', () => {
      for (const status of ['MERGED', 'READY_FOR_CODEX', 'READY_FOR_AUTHOR']) {
        const r = reconcileRegister(
          [
            row({
              status,
              codex_verdict: 'PASS',
              merge_commit: 'abc1234',
              work_item_path: 'docs/x.md',
            }),
          ],
          Object.assign({}, EVERYTHING_EXISTS, { fileExists: () => false })
        );
        const f = r.findings.find((x) => x.code === 'SPEC_MISSING');
        assert.equal(f.severity, 'error', status + ' with no spec is an error');
      }
    });

    test('a missing spec on a blocked row is only informational', () => {
      const r = reconcileRegister(
        [row({ status: 'BLOCKED_BY_FOUNDATION', work_item_path: 'docs/x.md' })],
        Object.assign({}, EVERYTHING_EXISTS, { fileExists: () => false })
      );
      const f = r.findings.find((x) => x.code === 'SPEC_MISSING');
      assert.equal(f.severity, 'info', 'not yet started work need not have a spec on disk');
      assert.equal(r.trustworthy, true);
    });

    test('a declared branch that does not exist is reported while work is live', () => {
      const r = reconcileRegister(
        [row({ status: 'READY_FOR_CODEX', branch: 'feat/gone' })],
        NOTHING_EXISTS
      );
      assert.ok(codes(r).includes('BRANCH_MISSING'));
    });

    test('a deleted branch on a merged row is not reported', () => {
      // Deleting the branch after merge is normal housekeeping.
      const r = reconcileRegister(
        [
          row({
            status: 'MERGED',
            codex_verdict: 'PASS',
            merge_commit: 'abc1234',
            branch: 'feat/done',
          }),
        ],
        Object.assign({}, EVERYTHING_EXISTS, { branchExists: () => false })
      );
      assert.ok(!codes(r).includes('BRANCH_MISSING'));
    });

    test('a PR without a branch cannot be traced back', () => {
      const r = reconcileRegister([row({ pr: '#13' })], EVERYTHING_EXISTS);
      assert.ok(codes(r).includes('PR_WITHOUT_BRANCH'));
    });
  });

  describe('Structural integrity', () => {
    test('a row with no id is an error', () => {
      const r = reconcileRegister([row({ work_item_id: '' })], EVERYTHING_EXISTS);
      assert.ok(codes(r).includes('ROW_WITHOUT_ID'));
      assert.equal(r.trustworthy, false);
    });

    test('a duplicated id makes the status of that item undecidable', () => {
      const r = reconcileRegister(
        [row({ work_item_id: 'DUP-1' }), row({ work_item_id: 'DUP-1', status: 'MERGED' })],
        EVERYTHING_EXISTS
      );
      const f = r.findings.find((x) => x.code === 'DUPLICATE_WORK_ITEM_ID');
      assert.ok(f);
      assert.equal(f.evidence.count, 2);
      assert.equal(r.trustworthy, false);
    });

    test('trustworthy stays true when only warnings and info are present', () => {
      const r = reconcileRegister(
        [
          row({
            work_item_id: 'A-1',
            status: 'MERGED',
            codex_verdict: 'PASS',
            merge_commit: 'aaa1111',
          }),
          row({ work_item_id: 'B-1', status: 'BLOCKED_DEPENDENCY', dependencies: 'A-1' }),
        ],
        EVERYTHING_EXISTS
      );
      assert.ok(r.summary.warn > 0);
      assert.equal(r.summary.error, 0);
      assert.equal(r.trustworthy, true, 'understatement does not make the register untrustworthy');
    });

    test('counts every row it was given', () => {
      const r = reconcileRegister(
        [row({ work_item_id: 'A' }), row({ work_item_id: 'B' })],
        EVERYTHING_EXISTS
      );
      assert.equal(r.checked, 2);
    });
  });

  describe('Dependency parsing', () => {
    test('reads ids and ignores the prose beside them', () => {
      assert.deepEqual(
        parseDependencies('TASK-FOUND-04; see BACKLOG-DEPENDENCIES.md'),
        ['TASK-FOUND-04'],
        'a filename is not a dependency'
      );
    });

    test('handles several separators and blank input', () => {
      assert.deepEqual(parseDependencies('A-1; B-2, C-3'), ['A-1', 'B-2', 'C-3']);
      assert.deepEqual(parseDependencies(''), []);
      assert.deepEqual(parseDependencies(null), []);
    });
  });

  describe('Duplicate detection', () => {
    test('reports the id and how many times it appeared', () => {
      const dups = findDuplicateIds([
        { work_item_id: 'X' },
        { work_item_id: 'X' },
        { work_item_id: 'Y' },
      ]);
      assert.deepEqual(dups, [{ id: 'X', count: 2 }]);
    });

    test('ignores rows with no id', () => {
      assert.deepEqual(findDuplicateIds([{ work_item_id: '' }, { work_item_id: '' }]), []);
    });
  });
});
