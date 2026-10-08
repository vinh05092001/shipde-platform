'use strict';

/**
 * Ship Dễ — pure slug and branch-name derivation for Work Items.
 *
 * Branch names are hand-written today: one branch spells the outcome with
 * dashes, the next with underscores, a third drops the outcome entirely. A
 * slug is a small thing to disagree about and an expensive one to reconcile,
 * so the rule lives here once. Every helper is pure: no I/O, no clock, no
 * randomness, no module state, Node built-ins only.
 */

const SLUG_MAX_LENGTH = 48;

function invalidInput(message) {
  const error = new Error(message);
  error.code = 'SLUGIFY_INPUT_INVALID';
  return error;
}

/**
 * SL-R01: lower-case; every run of characters outside [a-z0-9] becomes a
 * single '-'; leading and trailing '-' are trimmed; the result is capped at
 * 48 characters and never ends with '-'.
 * SL-R02: a non-string argument, or one that reduces to an empty slug, throws
 * an Error with code SLUGIFY_INPUT_INVALID.
 */
function slugify(text) {
  if (typeof text !== 'string') {
    throw invalidInput('slugify expects a string');
  }
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length === 0) {
    throw invalidInput('slugify input reduces to an empty slug');
  }
  return slug.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, '');
}

/**
 * Derives a Work Item branch name: `<kind>/<slugified work item id>` with the
 * slugified outcome appended when given. `kind` is exactly 'feat' or 'fix'
 * ('feat' is the default); anything else throws BRANCH_NAME_INPUT_INVALID.
 * Work item id and outcome are validated by slugify, so they throw
 * SLUGIFY_INPUT_INVALID on non-string or empty-after-slugify input.
 */
function branchName(kind, workItemId, outcome) {
  const branchKind = kind === undefined ? 'feat' : kind;
  if (branchKind !== 'feat' && branchKind !== 'fix') {
    const error = new Error('branchName kind must be "feat" or "fix"');
    error.code = 'BRANCH_NAME_INPUT_INVALID';
    throw error;
  }
  const id = slugify(workItemId);
  if (outcome === undefined) {
    return `${branchKind}/${id}`;
  }
  return `${branchKind}/${id}-${slugify(outcome)}`;
}

module.exports = { slugify, branchName, SLUG_MAX_LENGTH };
