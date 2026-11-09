'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { claimWorktree, verifyWorktreeClaim } = require('../../coordinator-claim');

const systemTmp = os.tmpdir();

function createWorktreeClaim(options = {}) {
  const baseTmp =
    options.dir || (os.tmpdir() && !os.tmpdir().startsWith('undefined') ? os.tmpdir() : systemTmp);
  const ownRoot = !options.worktree;
  const root = ownRoot
    ? fs.mkdtempSync(path.join(baseTmp, 'wt-claim-helper-'))
    : path.dirname(options.worktree);
  const worktree = options.worktree || path.join(root, 'worktree');
  const ownRuntime = !options.runtimeDir;
  const runtimeDir =
    options.runtimeDir || fs.mkdtempSync(path.join(ownRoot ? root : baseTmp, 'wt-claim-rt-'));
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  const claim = claimWorktree(worktree, { runtimeDir, ...options });
  const cleanup = () => {
    try {
      claim.release?.();
    } catch {}
    try {
      if (ownRuntime) fs.rmSync(runtimeDir, { recursive: true, force: true });
    } catch {}
    try {
      if (ownRoot) fs.rmSync(root, { recursive: true, force: true });
    } catch {}
  };
  const boundVerifier = (cwd, c, opts) =>
    verifyWorktreeClaim(cwd, c, { runtimeDir, ...options, ...opts });
  return {
    root,
    worktree,
    runtimeDir,
    claim,
    cleanup,
    verifyWorktreeClaim: boundVerifier,
    context: {
      worktreeClaim: claim,
    },
  };
}

module.exports = { createWorktreeClaim };
