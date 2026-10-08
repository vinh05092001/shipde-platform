'use strict';

/**
 * Ship Dễ — Work Item branch-name derivation for Work Item branches.
 *
 * Branch names are assembled by hand at every call site today: the family
 * prefix, the id case and the outcome spelling each drift on their own. BN-R01
 * fixes the composition once as
 * `'feat/' + workItemId.toLowerCase() + '-' + slugify(title)`, and the slug
 * rule itself belongs to the TASK-AI-111 helper (require('./slugify')) — this
 * module never re-implements it. Pure over strings: no I/O, no clock, no
 * randomness, no module state, Node built-ins only.
 */

const { slugify } = require('./slugify');

const WORK_ITEM_ID_PATTERN = /^(TASK|FEAT)-[A-Z0-9-]+$/;

function invalidInput(message) {
  const error = new Error(message);
  error.code = 'BRANCH_NAME_INPUT_INVALID';
  return error;
}

/**
 * BN-R01: returns 'feat/' + workItemId.toLowerCase() + '-' + slugify(title);
 * the work item id is lower-cased verbatim and the title slug keeps every
 * TASK-AI-111 rule. BN-R02: a work item id that is not a string matching
 * /^(TASK|FEAT)-[A-Z0-9-]+$/ throws an Error with code
 * BRANCH_NAME_INPUT_INVALID before the title is touched; title failures
 * propagate SLUGIFY_INPUT_INVALID from the slugify helper.
 */
function branchNameFor(workItemId, title) {
  if (typeof workItemId !== 'string' || !WORK_ITEM_ID_PATTERN.test(workItemId)) {
    throw invalidInput('branchNameFor workItemId must match /^(TASK|FEAT)-[A-Z0-9-]+$/');
  }
  return 'feat/' + workItemId.toLowerCase() + '-' + slugify(title);
}

module.exports = { branchNameFor };
