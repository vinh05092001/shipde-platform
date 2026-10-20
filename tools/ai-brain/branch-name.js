'use strict';

// Pure branch-name helper for AI-loop Work Items (TASK-AI-64).
//
// normalizeWorkItemBranch(workItemId, kind, outcome) derives the git branch
// name for a Work Item without hand-typing it. The function is pure: it
// performs no I/O, mutates nothing, and always returns the same output for
// the same inputs.
//
// Rules:
//   E1-R01: workItemId must match ^(FEAT|TASK-FOUND|TASK-AI)-[A-Z0-9-]+$,
//           otherwise throws WORK_ITEM_ID_INVALID.
//   E1-R02: result is "<kind>/<lower-cased-id>-<slug>".
//   E1-R03: kind is exactly "feat" or "fix" (default "feat" when omitted),
//           otherwise throws BRANCH_KIND_INVALID.
//   E1-R04: outcome is slugified (lower-cased; every run of characters
//           outside [a-z0-9] becomes a single "-"; leading/trailing "-"
//           trimmed; inner runs collapsed). An empty slug throws
//           OUTCOME_SLUG_EMPTY.
//   E1-R05: result longer than 60 characters throws BRANCH_TOO_LONG and is
//           never silently truncated.
//   E1-R06: result contains exactly one "/" and never contains "\", "..",
//           a trailing ".", ".lock", or a shell metacharacter.
//   E1-R07: pure function (no I/O, no mutation).

const WORK_ITEM_ID_PATTERN = /^(FEAT|TASK-FOUND|TASK-AI)-[A-Z0-9-]+$/;
const SAFE_RESULT_PATTERN = /^(feat|fix)\/[a-z0-9][a-z0-9-]*$/;
const MAX_BRANCH_LENGTH = 60;

function codedError(code, detail) {
  const err = new Error(code + (detail ? ': ' + detail : ''));
  err.code = code;
  return err;
}

function normalizeWorkItemBranch(workItemId, kind, outcome) {
  if (typeof workItemId !== 'string' || !WORK_ITEM_ID_PATTERN.test(workItemId)) {
    throw codedError('WORK_ITEM_ID_INVALID', String(workItemId));
  }

  const resolvedKind = kind === undefined || kind === null ? 'feat' : kind;
  if (resolvedKind !== 'feat' && resolvedKind !== 'fix') {
    throw codedError('BRANCH_KIND_INVALID', String(kind));
  }

  const slug =
    typeof outcome === 'string'
      ? outcome
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+/, '')
          .replace(/-+$/, '')
      : '';
  if (slug === '') {
    throw codedError('OUTCOME_SLUG_EMPTY', String(outcome));
  }

  const result = resolvedKind + '/' + workItemId.toLowerCase() + '-' + slug;

  if (result.length > MAX_BRANCH_LENGTH) {
    throw codedError('BRANCH_TOO_LONG', String(result.length));
  }

  // E1-R06 fail-closed guard: with the charsets above this can only contain
  // [a-z0-9/-], but reject anything unexpected (backslash, "..", trailing
  // ".", ".lock", shell metacharacters, extra slashes) rather than emit it.
  if (
    !SAFE_RESULT_PATTERN.test(result) ||
    result.indexOf('/') !== result.lastIndexOf('/') ||
    result.indexOf('\\') !== -1 ||
    result.indexOf('..') !== -1 ||
    result.endsWith('.') ||
    result.indexOf('.lock') !== -1
  ) {
    throw codedError('BRANCH_INVALID', result);
  }

  return result;
}

module.exports = {
  normalizeWorkItemBranch,
};
