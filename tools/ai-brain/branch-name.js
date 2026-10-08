'use strict';

const { slugify } = require('./slugify');

const WORK_ITEM_ID_PATTERN = /^(TASK|FEAT)-[A-Z0-9-]+$/;

const BRANCH_NAME_INPUT_INVALID = 'BRANCH_NAME_INPUT_INVALID';

function invalid(message) {
  const error = new Error(`${BRANCH_NAME_INPUT_INVALID}: ${message}`);
  error.code = BRANCH_NAME_INPUT_INVALID;
  return error;
}

function branchNameFor(workItemId, title) {
  if (typeof workItemId !== 'string' || !WORK_ITEM_ID_PATTERN.test(workItemId)) {
    throw invalid('workItemId must match /^(TASK|FEAT)-[A-Z0-9-]+$/');
  }
  return `feat/${workItemId.toLowerCase()}-${slugify(title)}`;
}

module.exports = { branchNameFor, WORK_ITEM_ID_PATTERN, BRANCH_NAME_INPUT_INVALID };
