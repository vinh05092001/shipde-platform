'use strict';

const SLUG_MAX = 48;
const BRANCH_MAX = 60;
const WORK_ITEM_ID_PATTERN = /^(FEAT|TASK-FOUND|TASK-AI)-[A-Z0-9-]+$/;

function slugifyError(message) {
  const err = new Error(message);
  err.code = 'SLUGIFY_INPUT_INVALID';
  return err;
}

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function slugify(text) {
  if (typeof text !== 'string') {
    throw slugifyError('SLUGIFY_INPUT_INVALID: text must be a string');
  }
  let slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  slug = slug.replace(/^-+/, '').replace(/-+$/, '');
  if (slug.length > SLUG_MAX) {
    slug = slug.slice(0, SLUG_MAX).replace(/-+$/, '');
  }
  if (slug === '') {
    throw slugifyError('SLUGIFY_INPUT_INVALID: text slugs to empty');
  }
  return slug;
}

function normalizeWorkItemBranch(workItemId, kind, outcome) {
  const branchKind = kind === undefined || kind === null ? 'feat' : kind;
  if (branchKind !== 'feat' && branchKind !== 'fix') {
    throw codedError('BRANCH_KIND_INVALID', 'BRANCH_KIND_INVALID: kind must be feat or fix');
  }
  if (typeof workItemId !== 'string' || !WORK_ITEM_ID_PATTERN.test(workItemId)) {
    throw codedError(
      'WORK_ITEM_ID_INVALID',
      'WORK_ITEM_ID_INVALID: workItemId must match ^(FEAT|TASK-FOUND|TASK-AI)-[A-Z0-9-]+$'
    );
  }
  let slug;
  try {
    slug = slugify(outcome);
  } catch (err) {
    if (err && err.code === 'SLUGIFY_INPUT_INVALID' && typeof outcome === 'string') {
      throw codedError('OUTCOME_SLUG_EMPTY', 'OUTCOME_SLUG_EMPTY: outcome slugs to empty');
    }
    throw err;
  }
  const branch = branchKind + '/' + workItemId.toLowerCase() + '-' + slug;
  if (branch.length > BRANCH_MAX) {
    throw codedError('BRANCH_TOO_LONG', 'BRANCH_TOO_LONG: branch exceeds 60 characters');
  }
  return branch;
}

module.exports = { slugify, normalizeWorkItemBranch };
