'use strict';

/**
 * Ship Dễ — TASK-AI-111: one pure slug for Work Item text, and the Work Item
 * branch name derived from it.
 *
 * Branch names were written by hand in several shapes (feat/task-ai-111,
 * fix/task-ai-123-draft-title-and-format-gate) and each caller spelled the
 * derivation differently. This module is the single derivation: slugify turns
 * any Work Item text into one [a-z0-9-] slug, and branchNameFor composes the
 * branch from a kind, a Work Item id and an optional title.
 *
 * Pure: no I/O, no clock, no state. Input that cannot produce a slug is
 * refused with SLUGIFY_INPUT_INVALID rather than replaced with a guess, because
 * a silently invented branch name is worse than a failed one.
 */

/** Cap on a slug, so a long title cannot grow an unbounded branch name. */
const SLUG_MAX_LENGTH = 48;

/** Error code carried by every refusal in this module. */
const SLUGIFY_INPUT_INVALID = 'SLUGIFY_INPUT_INVALID';

function invalid(message) {
  const error = new Error(`${SLUGIFY_INPUT_INVALID}: ${message}`);
  error.code = SLUGIFY_INPUT_INVALID;
  return error;
}

/**
 * Lower-case, collapse runs of non [a-z0-9] into one '-', trim the ends, and
 * cap at SLUG_MAX_LENGTH characters with no trailing '-'.
 *
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  if (typeof text !== 'string') {
    throw invalid('expected a string');
  }
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  if (slug.length === 0) {
    throw invalid('input produces an empty slug');
  }
  return slug;
}

/**
 * Derive a Work Item branch name: kind/<lower-cased work item id> with the
 * slugified title appended when one is given, e.g.
 * branchNameFor('feat', 'TASK-AI-111', 'Add slugify helper') returns
 * 'feat/task-ai-111-add-slugify-helper'.
 *
 * @param {string} kind e.g. 'feat' or 'fix'
 * @param {string} workItemId
 * @param {string|null|undefined} [title]
 * @returns {string}
 */
function branchNameFor(kind, workItemId, title) {
  const head = `${slugify(kind)}/${slugify(workItemId)}`;
  if (title === undefined || title === null) {
    return head;
  }
  return `${head}-${slugify(title)}`;
}

module.exports = {
  slugify,
  branchNameFor,
  SLUG_MAX_LENGTH,
  SLUGIFY_INPUT_INVALID,
};
