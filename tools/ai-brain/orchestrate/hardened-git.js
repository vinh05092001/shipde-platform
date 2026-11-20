'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

function hardenedGitEnv() {
  const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  return Object.assign({}, process.env, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: nulDevice,
    GIT_CONFIG_SYSTEM: nulDevice,
  });
}

function hardenedGitArgs(cwd, extraSafeDirs) {
  const nulDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const dirs = [cwd].concat(Array.isArray(extraSafeDirs) ? extraSafeDirs : []).filter(Boolean);
  const args = [];
  for (const dir of dirs) {
    args.push('-c', 'safe.directory=' + path.resolve(dir).replace(/\\/g, '/'));
  }
  args.push(
    '-c',
    'core.hooksPath=' + nulDevice,
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.attributesFile=' + nulDevice,
    '-c',
    'diff.external=',
    '-c',
    'uploadpack.packObjectsHook='
  );
  return args;
}

function runHardenedGit(cwd, args, extraSafeDirs) {
  return spawnSync('git', hardenedGitArgs(cwd, extraSafeDirs).concat(args), {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    env: hardenedGitEnv(),
  });
}

function assertGitOk(res, refusal) {
  if (!res || res.status !== 0) {
    const detail = res && (res.stderr || res.stdout) ? String(res.stderr || res.stdout).trim() : '';
    throw new Error(refusal + (detail ? ': ' + detail : ''));
  }
  return String((res && res.stdout) || '').trim();
}

module.exports = {
  hardenedGitEnv,
  hardenedGitArgs,
  runHardenedGit,
  assertGitOk,
};
