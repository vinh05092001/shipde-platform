/**
 * Ship Dễ — Register Reconciliation Test Suite
 *
 * Each rule is exercised through injected fact functions, so the suite proves
 * the reasoning rather than the state of whatever repository it runs in.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  reconcileRegister,
  parseDependencies,
  findDuplicateIds,
  planReconciliation,
  applyStatusMutations,
  parseCsvRecords,
} = require('../reconcile');

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

/**
 * Write-back.
 *
 * These tests inject the Git probes for the same reason the suite above does:
 * a reachability answer that depends on which commits happen to be fetched
 * would make the assertions drift with the checkout rather than with the code.
 * The fixture-backed end-to-end rows live in the acceptance matrix, where the
 * real repository is the point.
 */

const ALL_PROVEN = {
  commitExists: () => true,
  isAncestorOf: () => true,
  fileExists: () => true,
};

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function mergedDep(overrides) {
  return Object.assign(
    {
      work_item_id: 'TASK-AI-05',
      status: 'MERGED',
      merge_commit: SHA_A,
      codex_verdict: 'PASS',
      work_item_path: 'docs/spec.md',
    },
    overrides || {}
  );
}

function blockedRow(overrides) {
  return Object.assign(
    {
      work_item_id: 'TASK-AI-07',
      status: 'BLOCKED_DEPENDENCY',
      dependencies: 'TASK-AI-05',
      work_item_path: 'docs/spec.md',
    },
    overrides || {}
  );
}

function evidenceFor(overrides) {
  return Object.assign(
    {
      number: 9,
      title: '[TASK-AI-06] Something that landed',
      headRefOid: SHA_B,
      mergeCommit: { oid: SHA_A },
      codexVerdict: 'PASS',
      unresolvedThreadsCount: 0,
      ciChecksStatus: 'SUCCESS',
    },
    overrides || {}
  );
}

function readyRow(overrides) {
  return Object.assign(
    {
      work_item_id: 'TASK-AI-06',
      status: 'READY_FOR_CODEX',
      pr: '9',
      work_item_path: 'docs/spec.md',
    },
    overrides || {}
  );
}

describe('planReconciliation — clearing a stale block', () => {
  test('a block whose every dependency is proven merged clears to BACKLOG', () => {
    const plan = planReconciliation([mergedDep(), blockedRow()], ALL_PROVEN);
    assert.equal(plan.mutations.length, 1);
    assert.equal(plan.mutations[0].to, 'BACKLOG');
    assert.equal(plan.mutations[0].from, 'BLOCKED_DEPENDENCY');
  });

  test('clearing a block never advances the row to READY_FOR_AUTHOR', () => {
    const plan = planReconciliation([mergedDep(), blockedRow()], ALL_PROVEN);
    assert.equal(
      plan.mutations.some((m) => m.to === 'READY_FOR_AUTHOR'),
      false
    );
  });

  test('BLOCKED_BY_FOUNDATION clears the same way', () => {
    const plan = planReconciliation(
      [mergedDep(), blockedRow({ status: 'BLOCKED_BY_FOUNDATION' })],
      ALL_PROVEN
    );
    assert.equal(plan.mutations[0].to, 'BACKLOG');
  });

  test('a dependency that has not merged keeps the block', () => {
    const plan = planReconciliation(
      [mergedDep({ status: 'READY_FOR_CODEX' }), blockedRow()],
      ALL_PROVEN
    );
    assert.equal(plan.mutations.length, 0);
  });

  test('a dependency whose merge commit is unreachable keeps the block', () => {
    const plan = planReconciliation([mergedDep(), blockedRow()], {
      commitExists: () => true,
      isAncestorOf: () => false,
      fileExists: () => true,
    });
    assert.equal(plan.mutations.length, 0);
  });

  test('a dependency with a short merge commit keeps the block', () => {
    const plan = planReconciliation(
      [mergedDep({ merge_commit: 'abc1234' }), blockedRow()],
      ALL_PROVEN
    );
    assert.equal(plan.mutations.length, 0);
  });

  test('a dependency without a PASS verdict keeps the block', () => {
    const plan = planReconciliation([mergedDep({ codex_verdict: '' }), blockedRow()], ALL_PROVEN);
    assert.equal(plan.mutations.length, 0);
  });

  test('every dependency must be proven, not just the first', () => {
    const rows = [
      mergedDep(),
      mergedDep({ work_item_id: 'TASK-AI-04', status: 'BACKLOG', merge_commit: '' }),
      blockedRow({ dependencies: 'TASK-AI-05, TASK-AI-04' }),
    ];
    assert.equal(planReconciliation(rows, ALL_PROVEN).mutations.length, 0);
  });

  test('a dependency missing from the register keeps the block', () => {
    const plan = planReconciliation([blockedRow({ dependencies: 'TASK-AI-99' })], ALL_PROVEN);
    assert.equal(plan.mutations.length, 0);
  });
});

describe('planReconciliation — recording a merge', () => {
  test('durable evidence moves READY_FOR_CODEX to MERGED', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: evidenceFor() }, ALL_PROVEN)
    );
    assert.equal(plan.mutations.length, 1);
    assert.equal(plan.mutations[0].to, 'MERGED');
    assert.equal(plan.mutations[0].evidence.mergeCommit, SHA_A);
  });

  test('CODEX_PASS is also an allowed source', () => {
    const plan = planReconciliation(
      [readyRow({ status: 'CODEX_PASS' })],
      Object.assign({ mergeEvidence: evidenceFor() }, ALL_PROVEN)
    );
    assert.equal(plan.mutations[0].to, 'MERGED');
  });

  test('without evidence the row is refused, not inferred from the branch', () => {
    const plan = planReconciliation([readyRow()], ALL_PROVEN);
    assert.equal(plan.mutations.length, 0);
    assert.equal(plan.refusals[0].reason, 'no durable merge evidence provided');
  });

  test('a BACKLOG row is refused even when the evidence itself is valid', () => {
    const plan = planReconciliation(
      [readyRow({ work_item_id: 'TASK-AI-12', status: 'BACKLOG' })],
      Object.assign({ mergeEvidence: evidenceFor({ title: '[TASK-AI-12] Skipped' }) }, ALL_PROVEN)
    );
    assert.equal(plan.mutations.length, 0);
    assert.match(plan.refusals[0].reason, /not an allowed transition source/);
  });

  test('a merge commit that is not reachable on mainRef is refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({}, ALL_PROVEN, { mergeEvidence: evidenceFor(), isAncestorOf: () => false })
    );
    assert.equal(plan.mutations.length, 0);
    assert.match(plan.refusals[0].reason, /not reachable on mainRef/);
  });

  test('a merge commit absent from this clone is refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({}, ALL_PROVEN, { mergeEvidence: evidenceFor(), commitExists: () => false })
    );
    assert.match(plan.refusals[0].reason, /not in this clone/);
  });

  test('evidence for a different PR number is refused', () => {
    const plan = planReconciliation(
      [readyRow({ pr: '4' })],
      Object.assign({ mergeEvidence: evidenceFor() }, ALL_PROVEN)
    );
    assert.match(plan.refusals[0].reason, /does not match register PR/);
  });

  test('evidence whose title does not name the work item is refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: evidenceFor({ title: '[TASK-AI-99] Other' }) }, ALL_PROVEN)
    );
    assert.match(plan.refusals[0].reason, /title does not start with/);
  });

  test('a non-PASS verdict is refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign(
        { mergeEvidence: evidenceFor({ codexVerdict: 'CHANGES_REQUESTED' }) },
        ALL_PROVEN
      )
    );
    assert.match(plan.refusals[0].reason, /Codex verdict is not PASS/);
  });

  test('unresolved review threads are refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: evidenceFor({ unresolvedThreadsCount: 2 }) }, ALL_PROVEN)
    );
    assert.match(plan.refusals[0].reason, /unresolved review threads/);
  });

  test('failing CI on the reviewed head is refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: evidenceFor({ ciChecksStatus: 'FAILURE' }) }, ALL_PROVEN)
    );
    assert.match(plan.refusals[0].reason, /CI checks are not SUCCESS/);
  });

  test('a missing work_item_path is refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({}, ALL_PROVEN, { mergeEvidence: evidenceFor(), fileExists: () => false })
    );
    assert.match(plan.refusals[0].reason, /work_item_path does not exist/);
  });
});

describe('CSV serialization', () => {
  const HEADER = '"a","b","work_item_id","s"\n';

  test('an untouched row is returned as the exact bytes it arrived as', () => {
    const text = HEADER + '"1","x","TASK-AI-01","BACKLOG"\r\n"2","y","TASK-AI-02","MERGED"\n';
    const out = applyStatusMutations(text, [], { idColumn: 2, statusColumn: 3 });
    assert.equal(out.text, text);
    assert.equal(out.applied, 0);
  });

  test('only the named row changes, and only in its status cell', () => {
    const text =
      HEADER + '"1","x","TASK-AI-01","BLOCKED_DEPENDENCY"\n"2","y","TASK-AI-02","MERGED"\n';
    const out = applyStatusMutations(text, [{ workItemId: 'TASK-AI-01', to: 'BACKLOG' }], {
      idColumn: 2,
      statusColumn: 3,
    });
    assert.match(out.text, /"TASK-AI-01","BACKLOG"/);
    assert.match(out.text, /"2","y","TASK-AI-02","MERGED"/);
    assert.equal(out.applied, 1);
  });

  test('a rewritten row keeps the line ending it had', () => {
    const text = HEADER + '"1","x","TASK-AI-01","BLOCKED_DEPENDENCY"\r\n';
    const out = applyStatusMutations(text, [{ workItemId: 'TASK-AI-01', to: 'BACKLOG' }], {
      idColumn: 2,
      statusColumn: 3,
    });
    assert.ok(out.text.endsWith('\r\n'));
  });

  test('embedded commas, quotes and newlines survive a rewrite', () => {
    const text =
      HEADER + '"1","he said ""go"", then, left\nand waited","TASK-AI-01","BLOCKED_DEPENDENCY"\n';
    const out = applyStatusMutations(text, [{ workItemId: 'TASK-AI-01', to: 'BACKLOG' }], {
      idColumn: 2,
      statusColumn: 3,
    });
    const back = parseCsvRecords(out.text);
    assert.equal(back[1].fields[1], 'he said "go", then, left\nand waited');
    assert.equal(back[1].fields[3], 'BACKLOG');
  });

  test('applying the same mutation twice changes nothing the second time', () => {
    const text = HEADER + '"1","x","TASK-AI-01","BLOCKED_DEPENDENCY"\n';
    const muts = [{ workItemId: 'TASK-AI-01', to: 'BACKLOG' }];
    const once = applyStatusMutations(text, muts, { idColumn: 2, statusColumn: 3 });
    const twice = applyStatusMutations(once.text, muts, { idColumn: 2, statusColumn: 3 });
    assert.equal(twice.applied, 0);
    assert.equal(twice.text, once.text);
  });

  test('the header row is never treated as data', () => {
    const text = '"a","b","work_item_id","s"\n"1","x","TASK-AI-01","BACKLOG"\n';
    const out = applyStatusMutations(text, [{ workItemId: 'work_item_id', to: 'NOPE' }], {
      idColumn: 2,
      statusColumn: 3,
    });
    assert.equal(out.applied, 0);
  });
});

describe('AI-19-R03 — which review outcomes may clear a stale block', () => {
  test('a Codex PASS clears the block', () => {
    const plan = planReconciliation(
      [mergedDep({ codex_verdict: 'PASS' }), blockedRow()],
      ALL_PROVEN
    );
    assert.equal(plan.mutations.length, 1);
    assert.equal(plan.mutations[0].to, 'BACKLOG');
  });

  test('a named fallback review also clears it, because BACKLOG grants nothing', () => {
    const plan = planReconciliation(
      [mergedDep({ codex_verdict: 'FALLBACK_PASS' }), blockedRow()],
      ALL_PROVEN
    );
    assert.equal(plan.mutations.length, 1);
    assert.equal(plan.mutations[0].to, 'BACKLOG');
  });

  test('no verdict at all does not clear it - absence of review is not weak evidence', () => {
    const plan = planReconciliation([mergedDep({ codex_verdict: '' }), blockedRow()], ALL_PROVEN);
    assert.equal(plan.mutations.length, 0);
  });

  test('a negative verdict does not clear it', () => {
    const plan = planReconciliation(
      [mergedDep({ codex_verdict: 'CHANGES_REQUIRED' }), blockedRow()],
      ALL_PROVEN
    );
    assert.equal(plan.mutations.length, 0);
  });

  test('a bare fallback verdict is still refused for a MERGED transition', () => {
    // Until TASK-AI-14's reviewer was admitted, any FALLBACK_PASS was refused
    // here. It is admitted now, but only carrying a named reviewer and the
    // exact head it read, so the bare verdict this test passes is still not
    // enough on its own.
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: evidenceFor({ codexVerdict: 'FALLBACK_PASS' }) }, ALL_PROVEN)
    );
    assert.equal(plan.mutations.length, 0);
    assert.match(plan.refusals[0].reason, /names nobody/);
  });

  test('clearing a block never produces READY_FOR_AUTHOR, whatever the verdict', () => {
    for (const v of ['PASS', 'FALLBACK_PASS']) {
      const plan = planReconciliation([mergedDep({ codex_verdict: v }), blockedRow()], ALL_PROVEN);
      assert.equal(
        plan.mutations.some((m) => m.to === 'READY_FOR_AUTHOR'),
        false
      );
    }
  });
});

describe('planReconciliation - a fallback review recording a merge', () => {
  function fallback(overrides) {
    return evidenceFor(
      Object.assign(
        {
          codexVerdict: 'FALLBACK_PASS',
          fallbackReviewer: 'z-ai/glm-5.3-flash',
          reviewedCommit: SHA_B,
        },
        overrides || {}
      )
    );
  }

  test('a named review of the exact head records the merge', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: fallback() }, ALL_PROVEN)
    );
    assert.equal(plan.mutations.length, 1);
    assert.equal(plan.mutations[0].to, 'MERGED');
  });

  test('a fallback review that names no reviewer is refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: fallback({ fallbackReviewer: '' }) }, ALL_PROVEN)
    );
    assert.equal(plan.mutations.length, 0);
    assert.match(plan.refusals[0].reason, /names nobody/);
  });

  test('a fallback review of an earlier commit is refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: fallback({ reviewedCommit: 'c'.repeat(40) }) }, ALL_PROVEN)
    );
    assert.equal(plan.mutations.length, 0);
    assert.match(plan.refusals[0].reason, /but the evidence head is/);
  });

  test('a fallback review with no reviewedCommit is refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: fallback({ reviewedCommit: '' }) }, ALL_PROVEN)
    );
    assert.match(plan.refusals[0].reason, /reviewedCommit is not a 40-character SHA/);
  });

  test('a fallback review does not excuse unresolved threads', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: fallback({ unresolvedThreadsCount: 1 }) }, ALL_PROVEN)
    );
    assert.match(plan.refusals[0].reason, /unresolved review threads/);
  });

  test('a fallback review does not excuse failing CI', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: fallback({ ciChecksStatus: 'FAILURE' }) }, ALL_PROVEN)
    );
    assert.match(plan.refusals[0].reason, /CI checks are not SUCCESS/);
  });

  test('a fallback review does not excuse an unreachable merge commit', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({}, ALL_PROVEN, { mergeEvidence: fallback(), isAncestorOf: () => false })
    );
    assert.match(plan.refusals[0].reason, /not reachable on mainRef/);
  });

  test('an unknown verdict is still refused', () => {
    const plan = planReconciliation(
      [readyRow()],
      Object.assign({ mergeEvidence: fallback({ codexVerdict: 'LGTM' }) }, ALL_PROVEN)
    );
    assert.match(plan.refusals[0].reason, /Codex verdict is not PASS/);
  });
});
