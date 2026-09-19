'use strict';

/**
 * Ship Dễ — Single-Writer Claim Guard
 *
 * The orchestrator enforces single-writer only over sessions it launched. A
 * session started directly in a terminal is invisible to it, so two authors
 * can work the same branch without either noticing — which is exactly what
 * happened on TASK-AI-15, where a direct session rebuilt a cockpit an AO
 * worker had already written.
 *
 * Routing every session through AO would fix that by removing the ability to
 * ask a model for a quick change, which is worth keeping. So instead of moving
 * the boundary, this widens it: AO sessions are read from the daemon, direct
 * sessions record a claim file, and a git hook refuses a write when somebody
 * else already holds the branch.
 *
 * A claim is advisory and expires. It is a collision check, not a permission
 * system: it exists to surface a conflict before a commit, not to stop anyone.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync, spawnSync } = require('child_process');

const DAEMON_HOST = '127.0.0.1';
const DAEMON_RUN_FILE = path.join(os.homedir(), '.ao', 'running.json');
const CLAIM_DIR = path.join(os.homedir(), '.ao', 'data', 'writer-claims');
const DEFAULT_TTL_MINUTES = 120;
const DAEMON_TIMEOUT_MS = 2500;

function readDaemonPort() {
  try {
    const raw = JSON.parse(fs.readFileSync(DAEMON_RUN_FILE, 'utf8'));
    return Number(raw.port) || null;
  } catch (e) {
    return null;
  }
}

function getJson(port, route) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: DAEMON_HOST, port, path: route, timeout: DAEMON_TIMEOUT_MS },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          // The session list is small; a runaway response is a bug, not data.
          if (body.length > 4 * 1024 * 1024) req.destroy();
        });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** Live AO sessions that currently hold a branch. */
async function readAoHolders() {
  const port = readDaemonPort();
  if (!port) return { reachable: false, holders: [] };

  const payload = await getJson(port, '/api/v1/sessions');
  if (!payload || !Array.isArray(payload.sessions)) return { reachable: false, holders: [] };

  const holders = [];
  for (const session of payload.sessions) {
    if (session.isTerminated) continue;
    const branch = session.branch || (session.worktree && session.worktree.branch) || null;
    if (!branch) continue;
    holders.push({
      source: 'ao',
      id: session.id,
      harness: session.harness || 'unknown',
      kind: session.kind || 'unknown',
      branch,
      state: (session.activity && session.activity.state) || session.status || 'unknown',
      lastActivityAt:
        (session.activity && session.activity.lastActivityAt) || session.updatedAt || null,
    });
  }
  return { reachable: true, holders };
}

function ensureClaimDir() {
  fs.mkdirSync(CLAIM_DIR, { recursive: true });
}

function claimPath(branch, dir) {
  // Branch names contain slashes; encode so each claim is one flat file.
  const safe = Buffer.from(branch, 'utf8').toString('base64url');
  return path.join(dir || CLAIM_DIR, safe + '.json');
}

function readClaims(dir) {
  const root = dir || CLAIM_DIR;
  let names;
  try {
    names = fs.readdirSync(root);
  } catch (e) {
    return [];
  }
  const now = Date.now();
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(root, name);
    let claim;
    try {
      claim = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      continue;
    }
    // An expired claim is removed on sight: a crashed session must not hold a
    // branch forever.
    if (!claim.expiresAt || Date.parse(claim.expiresAt) <= now) {
      try {
        fs.unlinkSync(full);
      } catch (e) {
        /* another process may have cleaned it first */
      }
      continue;
    }
    out.push(Object.assign({ source: 'claim' }, claim));
  }
  return out;
}

function writeClaim(options) {
  const opts = options || {};
  if (!opts.branch) throw new Error('branch is required to claim');
  if (!opts.owner) throw new Error('owner is required to claim');

  const dir = opts.dir || CLAIM_DIR;
  fs.mkdirSync(dir, { recursive: true });

  const ttl = Number(opts.ttlMinutes) > 0 ? Number(opts.ttlMinutes) : DEFAULT_TTL_MINUTES;
  const claim = {
    branch: opts.branch,
    owner: opts.owner,
    harness: opts.harness || 'direct',
    note: opts.note || null,
    claimedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 60000).toISOString(),
  };
  fs.writeFileSync(claimPath(opts.branch, dir), JSON.stringify(claim, null, 2), 'utf8');
  return claim;
}

function releaseClaim(branch, dir) {
  const file = claimPath(branch, dir);
  try {
    fs.unlinkSync(file);
    return true;
  } catch (e) {
    return false;
  }
}

function currentBranch(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Decides whether `owner` may write to `branch`.
 *
 * Blocks only on a holder that is somebody else on the same branch. An
 * unreachable daemon never blocks: a guard that fails closed when a local
 * service is down would stop all work for no safety gain, so it reports the
 * degraded check instead.
 */
async function checkWrite(options) {
  const opts = options || {};
  const branch = opts.branch || currentBranch(opts.cwd);
  const owner = opts.owner;

  if (!branch) {
    return {
      allowed: true,
      degraded: true,
      reason: 'Không xác định được nhánh hiện tại',
      holders: [],
    };
  }
  if (branch === 'main' || branch === 'master') {
    return {
      allowed: false,
      degraded: false,
      reason: 'Không ghi trực tiếp lên ' + branch + '. Hãy tạo nhánh riêng.',
      holders: [],
    };
  }

  const ao = opts.aoHolders ? { reachable: true, holders: opts.aoHolders } : await readAoHolders();
  const claims = opts.claims || readClaims(opts.dir);

  const holders = ao.holders
    .concat(claims)
    .filter((h) => h.branch === branch)
    .filter((h) => {
      const id = h.owner || h.id;
      return id !== owner;
    });

  if (holders.length === 0) {
    return {
      allowed: true,
      degraded: !ao.reachable,
      reason: ao.reachable
        ? 'Không có phiên nào khác giữ nhánh này'
        : 'Không liên lạc được daemon AO; chỉ kiểm tra được claim cục bộ',
      holders: [],
    };
  }

  return {
    allowed: false,
    degraded: !ao.reachable,
    reason:
      'Nhánh "' +
      branch +
      '" đang được giữ bởi: ' +
      holders.map((h) => (h.owner || h.id) + ' [' + (h.harness || '?') + ']').join(', '),
    holders,
  };
}

function defaultOwner(env) {
  const e = env || process.env;
  if (e.SHIPDE_WRITER) return e.SHIPDE_WRITER;
  if (e.AO_SESSION_ID) return e.AO_SESSION_ID;
  if (e.AO_REVIEW_WORKER_SESSION_ID) return e.AO_REVIEW_WORKER_SESSION_ID;
  if (e.AO_REVIEW_SESSION_ID) return e.AO_REVIEW_SESSION_ID;
  if (e.CLAUDE_CODE_SESSION_ID) return e.CLAUDE_CODE_SESSION_ID;
  if (e.CLAUDE_SESSION_ID) return e.CLAUDE_SESSION_ID;

  try {
    const user = os.userInfo();
    if (user && user.username) {
      return user.username + '@' + os.hostname();
    }
  } catch (err) {
    /* ignore and fall through */
  }
  return ((e && (e.USER || e.USERNAME)) || 'unknown') + '@' + os.hostname();
}

// TASK-AI-36 moved hook definition and installation to Lefthook: the pre-commit
// guard is declared in lefthook.yml and `pnpm lefthook install` writes a hook
// that delegates to the pinned binary into the repository's common hooks
// directory. The bespoke `core.hooksPath = .githooks` wiring is retired — while
// that override is set, the hook Git executes is the one behind it, so the
// declared configuration stops running even though a pre-commit file exists.
//
// "Is the guard installed?" therefore cannot be answered from one config key.
// It has to be answered from the hook Git will actually run, and from whether
// the configuration behind that hook still declares the guard command.
const LEFTHOOK_CONFIG_FILE = 'lefthook.yml';
const LEFTHOOK_DELEGATION_MARKER = 'call_lefthook';
const GUARD_COMMAND_MARKER = 'ai-guard/cli.js check';

function gitLine(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
  } catch (e) {
    return null;
  }
}

/** Where Git will actually look for a hook, and what is behind it. */
function hookFacts(cwd) {
  const topLevel = gitLine(['rev-parse', '--show-toplevel'], cwd) || cwd;
  let commonDir = gitLine(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
  if (!commonDir) {
    // Git before 2.31 prints the common directory relative to the working tree.
    const relative = gitLine(['rev-parse', '--git-common-dir'], cwd);
    commonDir = relative ? path.resolve(topLevel, relative) : null;
  }
  // A relative core.hooksPath resolves against the working-tree top level, not
  // the current directory; with no override Git uses the common hooks
  // directory, which every linked worktree of the repository shares. Resolving
  // against cwd made `status` report NOT INSTALLED from any subdirectory of a
  // correctly installed repository — the same false-negative class the unscoped
  // `git config` call produced in scripts/ai/doctor.ps1.
  const configured = gitLine(['config', 'core.hooksPath'], cwd) || null;
  const hooksDir = configured
    ? path.isAbsolute(configured)
      ? configured
      : path.resolve(topLevel, configured)
    : commonDir
      ? path.join(commonDir, 'hooks')
      : null;
  const hookFile = hooksDir ? path.join(hooksDir, 'pre-commit') : null;
  const hookPresent = !!hookFile && fs.existsSync(hookFile);
  let hookContent = '';
  if (hookPresent) {
    try {
      hookContent = fs.readFileSync(hookFile, 'utf8');
    } catch (e) {
      hookContent = '';
    }
  }
  // A hook that delegates to Lefthook guards nothing unless lefthook.yml still
  // declares the command, so the declaration is part of the measured state and
  // not an assumption: installed must never be claimed without both halves.
  let guardDeclared = false;
  try {
    guardDeclared = fs
      .readFileSync(path.join(topLevel, LEFTHOOK_CONFIG_FILE), 'utf8')
      .includes(GUARD_COMMAND_MARKER);
  } catch (e) {
    guardDeclared = false;
  }
  return {
    topLevel,
    commonDir,
    configured,
    hooksDir,
    hookFile,
    hookPresent,
    hookContent,
    guardDeclared,
  };
}

function hookRemediation(status) {
  if (status.installed) return [];
  if (status.hookManager === 'lefthook') {
    return ['Restore `node tools/ai-guard/cli.js check` in lefthook.yml'];
  }
  const commands = [];
  if (status.hooksPath) {
    // Any override — the retired bespoke one included — keeps Git from reading
    // the common hooks directory where Lefthook installs, so it must go first.
    commands.push('git config --unset core.hooksPath');
  }
  commands.push('pnpm lefthook install');
  return commands;
}

/**
 * Retire the bespoke core.hooksPath override at the scope Git resolves it from.
 * The override is what hides the Lefthook hook, so it has to go wherever it
 * lives — unsetting the local file does not remove a value inherited from the
 * global one.
 */
function retireHooksPathOverride(cwd) {
  const scoped = gitLine(['config', '--show-scope', '--get', 'core.hooksPath'], cwd);
  if (!scoped) return { retired: null };
  const parts = scoped.split('\t');
  const scope = parts.length > 1 ? parts[0] : 'local';
  const value = parts.length > 1 ? parts[1] : scoped;
  const args = ['config'];
  if (scope === 'global' || scope === 'system') {
    args.push('--' + scope);
  }
  args.push('--unset', 'core.hooksPath');
  try {
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    return { retired: value, scope };
  } catch (e) {
    // Exit 5 means the key vanished between the read and the unset.
    if (e && e.status === 5) return { retired: null };
    return { retired: null, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * The runners `install` may use, best evidence first: the repository's own
 * pinned Lefthook, then the pinned copy this tool ships beside (both execute
 * the JS shim that resolves the platform binary from the lockfile — never a
 * bare `npx lefthook`, which could fetch an unpinned version under AI-TOOL-11),
 * then the package-manager paths, with `npx` pinned to the same 1.11.3 the
 * workspace declares.
 */
function lefthookRunners(topLevel) {
  const runners = [];
  const shimFor = (base) => path.join(base, 'node_modules', 'lefthook', 'bin', 'index.js');
  const toolCopy = path.resolve(__dirname, '..', '..');
  for (const shim of [shimFor(topLevel), shimFor(toolCopy)]) {
    if (fs.existsSync(shim)) {
      runners.push({
        label: 'node ' + shim + ' install',
        run: () =>
          spawnSync(process.execPath, [shim, 'install'], {
            cwd: topLevel,
            encoding: 'utf8',
            timeout: 60000,
          }),
      });
    }
  }
  for (const command of ['pnpm exec lefthook install', 'npx --yes lefthook@1.11.3 install']) {
    runners.push({
      label: command,
      run: () =>
        spawnSync(command, {
          cwd: topLevel,
          encoding: 'utf8',
          shell: true,
          timeout: 120000,
        }),
    });
  }
  return runners;
}

// The retired wiring resolved its hooks directory with either separator; the
// backslash is built here so the matching below never hides in a regex.
const REVERSE_SLASH = String.fromCharCode(92);

function isGithooksOverride(value) {
  return (
    value === '.githooks' ||
    value.endsWith('/.githooks') ||
    value.endsWith(REVERSE_SLASH + '.githooks')
  );
}

function getHookStatus(options) {
  const opts = options || {};
  const facts = hookFacts(opts.cwd || process.cwd());
  const status = {
    installed: false,
    configuredOnly: false,
    guardDeclared: facts.guardDeclared,
    hooksPath: facts.configured,
    hooksDir: facts.hooksDir,
    hookManager: null,
    legacyOverride: !!facts.configured && isGithooksOverride(facts.configured),
  };
  if (facts.configured) {
    // An explicit override decides where Git looks. Only the repository's own
    // retired `.githooks` wiring is a state this tool vouches for; crediting
    // an arbitrary third-party hooks directory as "installed" would answer a
    // different question than the one being asked.
    if (status.legacyOverride) {
      status.hookManager = 'legacy-githooks';
      // A configured path is still not an installed hook: pointing
      // core.hooksPath at a directory with no pre-commit in it must report
      // configuredOnly, never installed, while commits run free.
      status.installed = facts.hookPresent;
      status.configuredOnly = !facts.hookPresent;
    } else {
      status.hookManager = 'custom';
    }
  } else if (facts.hookPresent) {
    if (facts.hookContent.includes(LEFTHOOK_DELEGATION_MARKER)) {
      // The hook Git runs delegates to Lefthook, which executes what
      // lefthook.yml declares today — so the guard is installed only when
      // the versioned config still carries the command. A delegation whose
      // config lost the declaration guards nothing and must not be reported
      // as installed.
      status.hookManager = 'lefthook';
      status.installed = facts.guardDeclared;
      status.configuredOnly = !facts.guardDeclared;
    } else {
      status.hookManager = 'other';
    }
  }
  status.remediation = hookRemediation(status);
  return status;
}

function installHook(options) {
  const opts = options || {};
  const cwd = opts.cwd || process.cwd();
  const facts = hookFacts(cwd);
  const topLevel = facts.topLevel;

  // Retire the bespoke override first. While it is set, the hook Git executes
  // is the one behind it, so installing into the common directory would write
  // a file no commit ever runs.
  const retirement = retireHooksPathOverride(cwd);
  if (retirement.error) {
    return {
      success: false,
      installed: false,
      retired: null,
      error: 'không gỡ được core.hooksPath: ' + retirement.error,
    };
  }

  // Lefthook invents an empty configuration and installs no hook when it
  // finds none. Refuse before that side effect: the guard definition lives in
  // the versioned lefthook.yml, and installing nothing must never be reported
  // as success (AI-TOOL-10).
  const configPath = path.join(topLevel, LEFTHOOK_CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return {
      success: false,
      installed: false,
      retired: retirement.retired,
      error:
        'không có ' +
        LEFTHOOK_CONFIG_FILE +
        ' tại ' +
        topLevel +
        ' — định nghĩa hook phải nằm trong tệp được version control',
    };
  }

  let runner = null;
  let lastError = null;
  for (const candidate of lefthookRunners(topLevel)) {
    let result;
    try {
      result = candidate.run();
    } catch (e) {
      lastError = e && e.message ? e.message : String(e);
      continue;
    }
    if (result.error) {
      lastError = result.error.message;
      continue;
    }
    if (result.status === 0) {
      runner = candidate.label;
      break;
    }
    const output = ((result.stderr || '') + String.fromCharCode(10) + (result.stdout || '')).trim();
    lastError = output.split(/\r?\n/).filter(Boolean).pop() || 'exit ' + result.status;
  }
  if (!runner) {
    return {
      success: false,
      installed: false,
      retired: retirement.retired,
      error: 'lefthook install thất bại: ' + lastError,
    };
  }

  // Setting the path is not the same as having the hook: verify from what
  // Git will actually execute before claiming anything was installed.
  const status = getHookStatus({ cwd: topLevel });
  return {
    success: status.installed,
    installed: status.installed,
    hookManager: status.hookManager,
    hooksDir: status.hooksDir,
    runner,
    retired: retirement.retired,
    scope: retirement.scope || null,
    error: status.installed
      ? null
      : 'hook đã ghi nhưng không được xác minh: ' +
        LEFTHOOK_CONFIG_FILE +
        ' không còn khai báo lệnh guard',
  };
}

function uninstallHook(options) {
  const opts = options || {};
  // Under Lefthook there are two separate facts: the bespoke override (this
  // command's job — retire it wherever Git resolves it from) and the hook in
  // the common directory (owned by `lefthook uninstall`, left untouched, so
  // the guard survives a `guard:install` round-trip of the override).
  // Reaching a repository with no override is the requested end state, not a
  // failure: `git config --unset` exits 5 when the key is absent, and the old
  // code turned arriving there already into a warning with a non-zero exit.
  const retirement = retireHooksPathOverride(opts.cwd || process.cwd());
  if (retirement.error) {
    return { success: false, error: retirement.error };
  }
  return {
    success: true,
    retired: retirement.retired,
    scope: retirement.scope || null,
    alreadyAbsent: !retirement.retired,
  };
}

module.exports = {
  readAoHolders,
  readClaims,
  writeClaim,
  releaseClaim,
  checkWrite,
  currentBranch,
  defaultOwner,
  getHookStatus,
  installHook,
  uninstallHook,
  hookFacts,
  retireHooksPathOverride,
  claimPath,
  ensureClaimDir,
  CLAIM_DIR,
  DEFAULT_TTL_MINUTES,
};
