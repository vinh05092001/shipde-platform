'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { runCommand } = require('./discovery/spawn');
const { openCodeConfig, configuredModels } = require('./discovery/live');
const { readJson, writeJson, refreshCatalogue } = require('./catalogue-refresh');
const policy = require('./coordinator');
const { safeText } = require('./coordinator-text');
const {
  readLog,
  readLines,
  parseReview,
  reviewUsage,
  MAX_LOG_BYTES,
  MAX_LOG_LINE_BYTES,
  TRUNCATION,
} = require('./coordinator-runtime-log');
const { EXCLUSIONS, createGitBoundary } = require('./coordinator-runtime-git');
const { createLauncher } = require('./coordinator-runtime-launch');
const { createOpsRuntime } = require('./coordinator-runtime-ops');

function itemBranch(item, branch) {
  const slug = /^(?:feat|fix)\/[\w-]+$/.test(branch) && branch.split('/')[1];
  const id = item.id.toLowerCase();
  return Boolean(slug && (slug === id || slug.startsWith(id + '-')));
}

function createRuntime(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const run = options.run || runCommand;
  const localDir = options.stateDir || path.join(root, '.oc', 'coordinator');
  const metricsFile = path.join(localDir, 'metrics.jsonl');
  const { git, checked, statusFiles, hooked, ownFiles, assertHead, commit, prepare } =
    createGitBoundary({ root, run, options });
  const config = options.config || openCodeConfig(options);
  const launchLog = (item) => path.join(item.cwd, '.oc', 'writer.log');
  const launch = createLauncher({ options, launchLog });
  const runtime = {
    configured: configuredModels(config),
    launchLog,
    refresh: () => refreshCatalogue(),
    save: (state) => writeJson(path.join(localDir, 'state.json'), state),
    inspect: async (item) => {
      const dirty = Boolean(
        await checked(item.cwd, ['status', '--porcelain', '--', ...EXCLUSIONS])
      );
      const branch = await checked(item.cwd, ['branch', '--show-current']);
      if (!itemBranch(item, branch)) throw new Error('ITEM_BRANCH_MISMATCH');
      const subjects = await checked(item.cwd, [
        'log',
        'origin/main..HEAD',
        '--no-merges',
        '--format=%s',
      ]);
      return { sha: subjects ? await checked(item.cwd, ['rev-parse', 'HEAD']) : null, dirty };
    },
    commit,
    prepare,
    push: async (item, sha) => {
      await assertHead(item.cwd, sha);
      const branch = await checked(item.cwd, ['branch', '--show-current']);
      if (!itemBranch(item, branch)) throw new Error('ITEM_BRANCH_MISMATCH');
      await git(item.cwd, ['push', 'origin', sha + ':refs/heads/' + branch]);
    },
  };
  Object.assign(
    runtime,
    createOpsRuntime({
      root,
      run,
      localDir,
      metricsFile,
      git,
      checked,
      statusFiles,
      ownFiles,
      assertHead,
      commit,
      hooked,
      launch,
      launchLog,
      options,
      runtime,
    })
  );
  return {
    ...runtime,
    localDir,
    metricsFile,
    readState: () => readJson(path.join(localDir, 'state.json')),
    run,
    root,
  };
}

module.exports = {
  createRuntime,
  parseReview,
  safeText,
  readLines,
  reviewUsage,
  EXCLUSIONS,
  MAX_LOG_BYTES,
  MAX_LOG_LINE_BYTES,
  readLog,
};
