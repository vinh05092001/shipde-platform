'use strict';

const { slugify } = require('./slugify');

const WORK_ITEM_ID_PATTERN = /^(TASK|FEAT)-[A-Z0-9-]+$/;

function branchNameFor(workItemId, title) {
  if (typeof workItemId !== 'string' || !WORK_ITEM_ID_PATTERN.test(workItemId)) {
    const err = new Error(
      'BRANCH_NAME_INPUT_INVALID: workItemId must match ^(TASK|FEAT)-[A-Z0-9-]+$'
    );
    err.code = 'BRANCH_NAME_INPUT_INVALID';
    throw err;
  }
  return 'feat/' + workItemId.toLowerCase() + '-' + slugify(title);
}

module.exports = { branchNameFor };
