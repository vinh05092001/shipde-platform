'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { claimWorktree, verifyWorktreeClaim } = require('../../coordinator-claim');

const systemTmp = os.tmpdir();

function createWorktreeClaim(options = {}) {
  const baseTmp =
    options.dir || (os.tmpdir() && !os.tmpdir().startsWith('undefined') ? os.tmpdir() : systemTmp);
  const root = options.worktree
    ? path.dirname(options.worktree)
    : fs.mkdtempSync(path.join(baseTmp, 'wt-claim-helper-'));
  const worktree = options.worktree || path.join(root, 'worktree');
  const runtimeDir = options.runtimeDir || path.join(root, 'runtime');
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  const claim = claimWorktree(worktree, { runtimeDir, ...options });
  const cleanup = () => {
    try {
      claim.release?.();
    } catch {}
    try {
      if (!options.worktree) {
        fs.rmSync(root, { recursive: true, force: true });
      } else if (!options.runtimeDir) {
        fs.rmSync(runtimeDir, { recursive: true, force: true });
      }
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
