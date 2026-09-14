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
const { execFileSync } = require('child_process');

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

module.exports = {
  readAoHolders,
  readClaims,
  writeClaim,
  releaseClaim,
  checkWrite,
  currentBranch,
  claimPath,
  ensureClaimDir,
  CLAIM_DIR,
  DEFAULT_TTL_MINUTES,
};
