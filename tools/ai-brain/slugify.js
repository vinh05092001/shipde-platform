'use strict';

/**
 * Ship Dễ — pure slugging and Work Item branch names.
 *
 * A Work Item branch must read the same on every host and in every run, so the
 * derivation lives in one pure place with no dependencies and no state: the
 * text goes in, the branch name comes out, and nothing else is consulted.
 */

const SLUG_MAX_LENGTH = 48;
const BRANCH_KINDS = ['feat', 'fix'];

function slugifyInputError(message) {
  const error = new Error(message);
  error.code = 'SLUGIFY_INPUT_INVALID';
  return error;
}

function branchNameInputError(message) {
  const error = new Error(message);
  error.code = 'BRANCH_NAME_INPUT_INVALID';
  return error;
}

/**
 * Normalize `text` for a branch segment.
 *
 * Lower-case, collapse every run of non `[a-z0-9]` characters to one `-`, trim
 * leading and trailing `-`, then cap the result at 48 characters with no
 * trailing `-`. Non-string input, and input that survives normalization as
 * nothing, throw `SLUGIFY_INPUT_INVALID`.
 */
function slugify(text) {
  if (typeof text !== 'string') {
    throw slugifyInputError('slugify input must be a string');
  }
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  if (slug === '') {
    throw slugifyInputError('slugify input produced an empty slug');
  }
  return slug;
}

/**
 * Derive a Work Item branch name as `AGENTS.md` defines it:
 * `feat/<lowercase-work-item-id>-<short-slug>` or `fix/...`.
 *
 * Both segments go through `slugify`, so one set of rules governs the whole
 * name. `kind` defaults to `feat` and must be `feat` or `fix`; anything else
 * throws `BRANCH_NAME_INPUT_INVALID`, while invalid text segments surface
 * `SLUGIFY_INPUT_INVALID` from the slugify they are derived with.
 */
function branchName(workItemId, shortSlug, kind) {
  const prefix = kind === undefined ? 'feat' : kind;
  if (!BRANCH_KINDS.includes(prefix)) {
    throw branchNameInputError('branch kind must be "feat" or "fix"');
  }
  return `${prefix}/${slugify(workItemId)}-${slugify(shortSlug)}`;
}

module.exports = { SLUG_MAX_LENGTH, BRANCH_KINDS, slugify, branchName };
