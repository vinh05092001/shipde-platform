'use strict';

/**
 * Ship Dễ — Work Item branch names derived through the shared slugify helper.
 *
 * `AGENTS.md` fixes one branch shape per Work Item:
 * `feat/<lowercase-work-item-id>-<short-slug>`. The Work Item id keeps its
 * structure and is only lower-cased; the outcome text is normalized by the
 * pure `slugify` helper from TASK-AI-111, so one set of slug rules governs
 * every branch and this module never re-implements them.
 */

const { slugify } = require('./slugify');

const WORK_ITEM_ID_PATTERN = /^(TASK|FEAT)-[A-Z0-9-]+$/;

function branchNameInputError(message) {
  const error = new Error(message);
  error.code = 'BRANCH_NAME_INPUT_INVALID';
  return error;
}

/**
 * Derive the branch name for a Work Item as
 * `'feat/' + workItemId.toLowerCase() + '-' + slugify(title)`.
 *
 * `workItemId` must match `/^(TASK|FEAT)-[A-Z0-9-]+$/` or the call throws
 * `BRANCH_NAME_INPUT_INVALID`. `title` goes through the TASK-AI-111 `slugify`
 * helper required as `./slugify`; that helper's own `SLUGIFY_INPUT_INVALID`
 * surfaces for text that cannot be slugified, never a re-implementation here.
 */
function branchNameFor(workItemId, title) {
  if (typeof workItemId !== 'string' || !WORK_ITEM_ID_PATTERN.test(workItemId)) {
    throw branchNameInputError('workItemId must match /^(TASK|FEAT)-[A-Z0-9-]+$/');
  }
  return `feat/${workItemId.toLowerCase()}-${slugify(title)}`;
}

module.exports = { WORK_ITEM_ID_PATTERN, branchNameFor };
