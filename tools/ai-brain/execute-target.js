'use strict';

/**
 * TASK-AI-171: ONE validated execute target for every execute path.
 *
 * resolveExecuteTarget(args, deps) -> Object.freeze({ok, reason?, targetRepo, cwd, baseSha, origin})
 *
 * Requires only fs/path/child_process/./facts (no cli.js / routing.js require: no cycle).
 * Move the logic of resolveExecuteBase here. Keep SHA source precedence and the
 * internal seams deps.gitRoot / deps.commitExists. ONE cwd formula = exactly
 * what adapter AND runner use for that entry. Explicit treePath/provenance/root/cwd
 * conflicts -> TARGET_WORKTREE_CONFLICT; never fall back to the tool repo.
 * Every SHA origin verified with commitExists in targetRepo.
 *
 * The frozen result object carries a module-private provenance tag so that
 * executePlan can distinguish a genuine resolveExecuteTarget result from a
 * forged {ok:true} literal.
 */

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// Module-private provenance: a WeakSet of objects created by this module.
// executePlan checks membership to reject forged targets.
const _validTargets = new WeakSet();

const is40HexSha = (v) => typeof v === 'string' && /^[0-9a-fA-F]{40}$/.test(v.trim());

/**
 * @param {object} [args]  CLI-level arguments (execute, root, cwd, base-sha, baseSha, base, branch, ...)
 * @param {object} [deps]  Dependency-injected seams (treePath, baseSha, gitRoot, commitExists, ...)
 * @returns {Readonly<{ok:boolean, reason?:string, code?:string, detail?:string, targetRepo:string|null, cwd:string|null, baseSha:string|null, origin:string|null}>}
 */
function resolveExecuteTarget(args, deps) {
  args = args || {};
  deps = deps || {};

  // Mode guard: only real execution validates a base.
  // executePlan with dryRun false is real execution even if args.execute is omitted.
  const isExecute = args.execute === true || deps.executeMode === true;
  if (!isExecute) {
    return Object.freeze({
      ok: true,
      baseSha: null,
      origin: 'dry-run',
      targetRepo: null,
      cwd: null,
    });
  }

  const factsApi = require('./facts');
  const checkCommit =
    typeof deps.commitExists === 'function' ? deps.commitExists : factsApi.commitExists;

  const provenance = deps.provenance || args.provenance;

  const defaultGitRoot = (resolved) => {
    const out = cp.execFileSync('git', ['-C', resolved, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    return out.trim();
  };
  // Internal seam (like deps.commitExists); never wired to CLI flags, data or env.
  const resolveGitRoot = typeof deps.gitRoot === 'function' ? deps.gitRoot : defaultGitRoot;

  const canonicalGitRoot = (dir) => {
    if (!dir || typeof dir !== 'string') return null;
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) return null;
    try {
      const top = resolveGitRoot(resolved);
      if (typeof top !== 'string') return null;
      const trimmed = top.trim();
      return trimmed && path.isAbsolute(trimmed) ? path.resolve(trimmed) : null;
    } catch (_) {
      return null;
    }
  };

  // Build the explicit target set
  const explicitTargets = [];
  if (args.root !== undefined && args.root !== null && args.root !== '') {
    explicitTargets.push({ name: 'args.root', path: args.root });
  }
  if (deps.treePath) {
    explicitTargets.push({ name: 'deps.treePath', path: deps.treePath });
  }
  const prov = provenance;
  if (prov && prov.treePath) {
    explicitTargets.push({ name: 'provenance.treePath', path: prov.treePath });
  }
  // P1-1: The EFFECTIVE cwd (exactly the value adapter and runner use) is always
  // part of the authoritative target set.
  const effectiveCwd = args.cwd || deps.cwd || deps.rootDir || null;
  const cwdName = args.cwd ? 'args.cwd' : deps.cwd ? 'deps.cwd' : 'deps.rootDir';
  if (
    effectiveCwd &&
    typeof effectiveCwd === 'string' &&
    !explicitTargets.some((t) => t.path === effectiveCwd)
  ) {
    explicitTargets.push({ name: cwdName, path: effectiveCwd });
  }

  let targetRepo = null;
  if (explicitTargets.length > 0) {
    const canonicalRoots = [];
    for (const t of explicitTargets) {
      const root = canonicalGitRoot(t.path);
      if (!root) {
        return Object.freeze({
          ok: false,
          code: 'TARGET_WORKTREE_UNRESOLVED',
          detail: `target worktree ${t.path} not a git repository`,
        });
      }
      canonicalRoots.push({ name: t.name, root });
    }
    const uniqueRoots = Array.from(new Set(canonicalRoots.map((c) => c.root)));
    if (uniqueRoots.length > 1) {
      return Object.freeze({
        ok: false,
        code: 'TARGET_WORKTREE_CONFLICT',
        detail: 'authoritative target worktrees resolve to different git roots',
      });
    }
    targetRepo = uniqueRoots[0];
  } else {
    if (deps.rootDir) {
      targetRepo = canonicalGitRoot(deps.rootDir);
    }
    if (!targetRepo) {
      targetRepo = canonicalGitRoot(process.cwd());
    }
    if (!targetRepo) {
      return Object.freeze({
        ok: false,
        code: 'TARGET_WORKTREE_UNRESOLVED',
        detail: 'no target worktree resolved',
      });
    }
  }

  // ONE cwd formula: what the adapter AND runner use.
  const resolvedCwd = effectiveCwd || targetRepo;

  const branchName = args.branch || deps.branch || (deps.item && deps.item.branch);

  // SHA resolution with the same precedence as resolveExecuteBase
  // Precedence 1: Explicit --base-sha / baseSha / base
  const explicitArg = args['base-sha'] ?? args.baseSha ?? args.base;
  if (explicitArg !== undefined && explicitArg !== null) {
    let val = typeof explicitArg === 'function' ? null : explicitArg;
    if (typeof explicitArg === 'function') {
      try {
        val = explicitArg();
      } catch (_) {}
    }
    if (is40HexSha(val)) {
      const trimmed = val.trim();
      if (checkCommit(trimmed, targetRepo)) {
        const result = Object.freeze({
          ok: true,
          baseSha: trimmed,
          origin: 'explicit',
          targetRepo,
          cwd: resolvedCwd,
        });
        _validTargets.add(result);
        return result;
      }
    }
    return Object.freeze({
      ok: false,
      code: 'BASE_SHA_UNRESOLVED',
      detail: 'explicit base SHA unresolvable in target repo',
    });
  }

  // Precedence 2: deps.baseSha / base / repoSha
  const depCandidates = [deps.baseSha, deps.base, deps.repoSha];
  for (const candItem of depCandidates) {
    if (candItem !== undefined && candItem !== null) {
      let val = typeof candItem === 'function' ? null : candItem;
      if (typeof candItem === 'function') {
        try {
          val = candItem();
        } catch (_) {}
      }
      if (is40HexSha(val)) {
        const trimmed = val.trim();
        if (checkCommit(trimmed, targetRepo)) {
          const result = Object.freeze({
            ok: true,
            baseSha: trimmed,
            origin: 'deps',
            targetRepo,
            cwd: resolvedCwd,
          });
          _validTargets.add(result);
          return result;
        }
        return Object.freeze({
          ok: false,
          code: 'BASE_SHA_UNRESOLVED',
          detail: 'dependency base SHA unresolvable in target repo',
        });
      }
      return Object.freeze({
        ok: false,
        code: 'BASE_SHA_UNRESOLVED',
        detail: 'invalid dependency base SHA',
      });
    }
  }

  // Precedence 3: provenance repoSha
  const provSha = prov && (prov.repoSha || prov.baseSha);
  if (provSha !== undefined && provSha !== null) {
    let val = typeof provSha === 'function' ? null : provSha;
    if (typeof provSha === 'function') {
      try {
        val = provSha();
      } catch (_) {}
    }
    if (is40HexSha(val)) {
      const trimmed = val.trim();
      if (checkCommit(trimmed, targetRepo)) {
        const result = Object.freeze({
          ok: true,
          baseSha: trimmed,
          origin: 'provenance',
          targetRepo,
          cwd: resolvedCwd,
        });
        _validTargets.add(result);
        return result;
      }
    }
    return Object.freeze({
      ok: false,
      code: 'BASE_SHA_UNRESOLVED',
      detail: 'provenance base SHA unresolvable in target repo',
    });
  }

  // Precedence 4: branch tip via rev-parse
  if (branchName && typeof branchName === 'string') {
    const trimmedBranch = branchName.trim();
    if (/^[a-zA-Z0-9._\-/]+$/.test(trimmedBranch) && !trimmedBranch.startsWith('-')) {
      for (const ref of [
        trimmedBranch,
        `refs/heads/${trimmedBranch}`,
        `refs/remotes/origin/${trimmedBranch}`,
      ]) {
        try {
          const out = cp.execFileSync(
            'git',
            ['-C', targetRepo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
            {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
              timeout: 5000,
            }
          );
          const sha = out.trim();
          if (is40HexSha(sha) && checkCommit(sha, targetRepo)) {
            const result = Object.freeze({
              ok: true,
              baseSha: sha,
              origin: 'branch',
              targetRepo,
              cwd: resolvedCwd,
            });
            _validTargets.add(result);
            return result;
          }
        } catch (_) {}
      }
    }
  }

  // Precedence 5: default origin/main via intake.revParseOriginMain
  try {
    if (typeof deps.revParse === 'function') {
      const v = deps.revParse('origin/main');
      if (is40HexSha(v) && checkCommit(v.trim(), targetRepo)) {
        const result = Object.freeze({
          ok: true,
          baseSha: v.trim(),
          origin: 'default',
          targetRepo,
          cwd: resolvedCwd,
        });
        _validTargets.add(result);
        return result;
      }
    } else {
      const intake = require('./intake');
      const sha = intake.revParseOriginMain(targetRepo, deps);
      if (is40HexSha(sha) && checkCommit(sha.trim(), targetRepo)) {
        const result = Object.freeze({
          ok: true,
          baseSha: sha.trim(),
          origin: 'default',
          targetRepo,
          cwd: resolvedCwd,
        });
        _validTargets.add(result);
        return result;
      }
    }
  } catch (_) {}

  return Object.freeze({
    ok: false,
    code: 'BASE_SHA_UNRESOLVED',
    detail: 'no resolved 40-hex base commit in target repo',
  });
}

/**
 * Check if an object was genuinely created by resolveExecuteTarget.
 * @param {object} obj
 * @returns {boolean}
 */
function isValidTarget(obj) {
  return (
    obj != null &&
    typeof obj === 'object' &&
    _validTargets.has(obj) &&
    obj.ok === true &&
    typeof obj.baseSha === 'string' &&
    obj.baseSha.length === 40 &&
    typeof obj.cwd === 'string' &&
    obj.cwd.length > 0 &&
    typeof obj.targetRepo === 'string' &&
    obj.targetRepo.length > 0
  );
}

module.exports = { resolveExecuteTarget, isValidTarget };
