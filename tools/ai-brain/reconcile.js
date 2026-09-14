'use strict';

/**
 * Ship Dễ — Register Reconciliation
 *
 * The delivery register is what the project believes. This module compares
 * each belief against what the repository can prove, and reports every place
 * the two disagree.
 *
 * The rules below are not style preferences. Each one exists because a status
 * can be written by an agent that was mistaken, interrupted, or simply never
 * updated, and because a row that claims more than it can prove is how a
 * project convinces itself it has shipped something it has not.
 *
 * Severity is about consequence, not confidence:
 *   error  — the register overstates reality; work may be skipped as done.
 *   warn   — the register understates reality; work may be blocked for nothing.
 *   info   — a record is incomplete but nothing is being misrepresented.
 */

const { commitExists, isAncestorOf, branchExists, fileExists, headSha } = require('./facts');

const TERMINAL_STATUS = 'MERGED';
const BLOCKED_PREFIX = 'BLOCKED';

function finding(severity, code, item, message, evidence) {
  return {
    severity,
    code,
    workItemId: item.work_item_id || '(unknown)',
    status: item.status || '(none)',
    message,
    evidence: evidence || null,
  };
}

/**
 * @param items  register rows, as produced by register-adapter
 * @param deps   { cwd, mainRef } — injectable so tests need no real repository
 */
function reconcileRegister(items, deps) {
  const opts = deps || {};
  const cwd = opts.cwd || process.cwd();
  const mainRef = opts.mainRef || 'origin/main';

  // Injection points keep the rules testable without a fixture repository.
  const hasCommit = opts.commitExists || ((sha) => commitExists(sha, cwd));
  const merged = opts.isAncestorOf || ((sha) => isAncestorOf(sha, mainRef, cwd));
  const hasBranch = opts.branchExists || ((b) => branchExists(b, cwd));
  const hasFile = opts.fileExists || ((p) => fileExists(p, cwd));
  const tipOf = opts.headSha || ((ref) => headSha(ref, cwd));

  const byId = new Map();
  for (const item of items) {
    if (item.work_item_id) byId.set(item.work_item_id, item);
  }

  const findings = [];

  for (const item of items) {
    const status = (item.status || '').trim();
    const id = item.work_item_id || '';

    // --- Claims of completion must be provable --------------------------
    if (status === TERMINAL_STATUS) {
      const sha = (item.merge_commit || '').trim();

      if (!sha) {
        findings.push(
          finding(
            'error',
            'MERGED_WITHOUT_COMMIT',
            item,
            'Ghi là MERGED nhưng không có merge_commit để kiểm chứng.'
          )
        );
      } else if (!hasCommit(sha)) {
        findings.push(
          finding(
            'error',
            'MERGE_COMMIT_MISSING',
            item,
            'merge_commit không tồn tại trong repository.',
            { sha }
          )
        );
      } else if (!merged(sha)) {
        // The commit is real but unreachable from main: it was never merged,
        // or it was merged and later dropped.
        findings.push(
          finding(
            'error',
            'MERGE_COMMIT_NOT_REACHABLE',
            item,
            'merge_commit có thật nhưng không nằm trong lịch sử ' + mainRef + '.',
            { sha, mainRef }
          )
        );
      }

      const verdict = (item.codex_verdict || '').trim();
      if (verdict !== 'PASS') {
        findings.push(
          finding(
            'error',
            'MERGED_WITHOUT_PASS',
            item,
            'Ghi là MERGED nhưng codex_verdict là "' + (verdict || 'trống') + '", không phải PASS.'
          )
        );
      }
    }

    // --- Blocks must still be true --------------------------------------
    if (status.startsWith(BLOCKED_PREFIX)) {
      const deps = parseDependencies(item.dependencies);
      const known = deps.filter((d) => byId.has(d));
      const unresolved = known.filter((d) => (byId.get(d).status || '') !== TERMINAL_STATUS);

      if (known.length > 0 && unresolved.length === 0) {
        // Understating progress is how a backlog stays frozen after the thing
        // it was waiting for has landed.
        findings.push(
          finding(
            'warn',
            'BLOCK_NO_LONGER_TRUE',
            item,
            'Vẫn ghi là ' + status + ' nhưng mọi phụ thuộc đã MERGED.',
            { dependencies: known }
          )
        );
      }

      const unknown = deps.filter((d) => !byId.has(d));
      if (unknown.length > 0) {
        findings.push(
          finding(
            'info',
            'DEPENDENCY_UNKNOWN',
            item,
            'Phụ thuộc không có trong register: ' + unknown.join(', '),
            { unknown }
          )
        );
      }
    }

    // --- Work that landed but was never recorded ------------------------
    // The opposite direction from an overstated MERGED, and the one that keeps
    // a backlog frozen: the branch is already in main and nobody wrote it down.
    if (status !== TERMINAL_STATUS && item.branch && hasBranch(item.branch)) {
      const tip = tipOf(item.branch);
      if (tip && merged(tip)) {
        findings.push(
          finding(
            'warn',
            'MERGE_NOT_RECORDED',
            item,
            'Nhánh đã nằm trọn trong ' + mainRef + ' nhưng trạng thái vẫn là ' + status + '.',
            { branch: item.branch, tip }
          )
        );
      }
    }

    // --- Records that point at nothing ----------------------------------
    if (item.work_item_path && !hasFile(item.work_item_path)) {
      const severity = status === TERMINAL_STATUS || status.startsWith('READY') ? 'error' : 'info';
      findings.push(
        finding(
          severity,
          'SPEC_MISSING',
          item,
          'work_item_path được khai nhưng file không tồn tại.',
          { path: item.work_item_path }
        )
      );
    }

    if (item.branch && !hasBranch(item.branch)) {
      // A merged Work Item's branch is normally deleted, so this is only a
      // problem while the work is supposed to be live.
      if (status !== TERMINAL_STATUS) {
        findings.push(
          finding(
            'warn',
            'BRANCH_MISSING',
            item,
            'Nhánh được khai nhưng không tồn tại cục bộ lẫn trên origin.',
            { branch: item.branch }
          )
        );
      }
    }

    if (item.pr && !item.branch) {
      findings.push(
        finding(
          'info',
          'PR_WITHOUT_BRANCH',
          item,
          'Có số PR nhưng không ghi nhánh, nên không truy ngược được.',
          { pr: item.pr }
        )
      );
    }

    if (!id) {
      findings.push(finding('error', 'ROW_WITHOUT_ID', item, 'Dòng không có work_item_id.'));
    }
  }

  const duplicates = findDuplicateIds(items);
  for (const dup of duplicates) {
    findings.push({
      severity: 'error',
      code: 'DUPLICATE_WORK_ITEM_ID',
      workItemId: dup.id,
      status: '(nhiều)',
      message: 'work_item_id xuất hiện ' + dup.count + ' lần; trạng thái không xác định được.',
      evidence: { count: dup.count },
    });
  }

  return {
    checked: items.length,
    findings,
    summary: {
      error: findings.filter((f) => f.severity === 'error').length,
      warn: findings.filter((f) => f.severity === 'warn').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
    // An overstated register is the dangerous direction: it lets finished-looking
    // work be skipped. Understatement only wastes time.
    trustworthy: findings.every((f) => f.severity !== 'error'),
  };
}

function parseDependencies(raw) {
  if (!raw) return [];
  return (
    String(raw)
      .split(/[;,]/)
      .map((part) => part.trim())
      // Rows carry prose alongside ids ("see BACKLOG-DEPENDENCIES.md"); only
      // things shaped like a Work Item id are treated as dependencies.
      .filter((part) => /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(part))
  );
}

function findDuplicateIds(items) {
  const counts = new Map();
  for (const item of items) {
    const id = item.work_item_id;
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const out = [];
  for (const [id, count] of counts) {
    if (count > 1) out.push({ id, count });
  }
  return out;
}

module.exports = { reconcileRegister, parseDependencies, findDuplicateIds };
