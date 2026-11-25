'use strict';

const { currentBranch, headSha, commitExists } = require('../facts');
const { toPositiveInteger } = require('../source-discovery');
const { atomicRenameSync } = require('../atomic-rename');
const { maskEmailsInString } = require('../route-identity-utils');
const { pick } = require('./reconcile-manifest');
const {
  mergeEvidenceAccounts,
  assembleForDispatch,
  readCheckpoint,
  writeJsonFile,
  applyFailureBlocks,
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
} = require('../orchestrate/runtime-helpers');

function sameFailureDomain(candidate, failed, classification) {
  // mvp-repair.test.js:66-70 evaluates this function via new Function without CommonJS require scope.
  const failureDomain =
    typeof require === 'function'
      ? require('../failure-domain')
      : process.getBuiltinModule('module').createRequire(`${process.cwd()}/tools/ai-brain/cli.js`)(
          './failure-domain'
        );
  return failureDomain.sameFailureDomain(candidate, failed, classification);
}

module.exports = {
  DRY_RUN_BLOCK_CODES,
  LIVE_BLOCK_CODES,
  mergeEvidenceAccounts,
  assembleForDispatch,
  readCheckpoint,
  writeJsonFile,
  sameFailureDomain,
  applyFailureBlocks,
};
