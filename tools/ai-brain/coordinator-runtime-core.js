'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const policy = require('./coordinator');
const { EXCLUSIONS } = require('./coordinator-runtime-git');

function itemBranch(item, branch) {
  const slug = /^(?:feat|fix)\/[\w-]+$/.test(branch) && branch.split('/')[1];
  const id = item.id.toLowerCase();
  return Boolean(slug && (slug === id || slug.startsWith(id + '-')));
}

function createCoreRuntime({ root, run, localDir, metricsFile, git, checked, statusFiles, hooked, ownFiles, assertHead, commit, prepare, config, launchLog, launch, options }) {
  const runtime = {
    configured: require('./discovery/live').configuredModels ? require('./discovery/live').configuredModels(config) : require('./discovery/live').configuredModels ? require('./discovery/live').configuredModels(config) : [],
    launchLog,
    refresh: () => require('./catalogue-refresh').refreshCatalogue(),
    save: (state) => require('./catalogue-refresh').writeJson(path.join(localDir, 'state.json'), state),
    inspect: async (item) => {
      const dirty = Boolean(await checked(item.cwd, ['status', '--porcelain', '--', ...EXCLUSIONS]));
      const branch = await checked(item.cwd, ['branch', '--show-current']);
      if (!itemBranch(item, branch)) throw new Error('ITEM_BRANCH_MISMATCH');
      const subjects = await checked(item.cwd, ['log', 'origin/main..HEAD', '--no-merges', '--format=%s']);
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
  return runtime;
}

module.exports = { itemBranch, createCoreRuntime };
