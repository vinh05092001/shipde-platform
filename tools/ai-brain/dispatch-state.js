'use strict';

/**
 * Ship Dễ — Dispatch state: what is running and who holds which branch.
 *
 * planDispatch needs two arrays to enforce its ceilings across repeated calls:
 *
 *   running — sessions already in flight: [{ workItemId, role, accountId }]
 *             Used to count load against the implementation / research / review
 *             ceilings and to mark Work Items busy.
 *
 *   claims  — branches currently held by a writer: [{ branch, owner }]
 *             Used to catch the cross-session collision the writer claim exists
 *             for (AGENTS.md: one writer per Work Item, permanently).
 *
 * Before this module existed, cli.js passed {} as the third argument to
 * planDispatch, so running and claims were always undefined. The scheduler
 * treated every dispatch as if the machine were completely idle, and the
 * ceiling could never hold across two calls in a row.
 *
 * Source choice: the executor (executor.js) already calls `ao spawn` and
 * captures the session ID and outcome for every assignment. Writing those
 * records to a small local JSON file on each dispatch, and reading them back
 * on the next, is the least invasive path: it touches nothing in the scheduler
 * or executor, it requires no live `ao session ls` round-trip, and it follows
 * the same write-then-read pattern already used by quota-store.js.
 *
 * Unreadable-state policy: REFUSE rather than treat as idle. Treating a
 * corrupted or missing file as "nothing is running" reintroduces the original
 * bug at the worst moment — right after a crash that left real sessions alive.
 * readDispatchState throws a DispatchStateError on any parse failure. The
 * caller decides how to surface it; cli.js exits with a message that names the
 * file and the reason so the operator can either delete it or investigate.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Maximum age (ms) of a running entry before it is considered expired.
 * A session that has been running longer than this is assumed dead: its worker
 * probably crashed without cleaning up. The default of 4 hours is generous —
 * most AI sessions finish within 30 minutes — but conservative enough that
 * a legitimately long session is not prematurely evicted.
 *
 * When an entry expires, readDispatchState emits a visible warning to stderr
 * so the operator knows a branch was unblocked automatically.
 *
 * This avoids a live `ao session ls` query on the read path (deliberate
 * design choice for planning latency) while preventing indefinite stale claims.
 *
 * Override via options.sessionTtlMs in tests; the default is used in production.
 */
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Sentinel error type so the caller can distinguish parse failures. */
class DispatchStateError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'DispatchStateError';
    this.cause = cause || null;
  }
}

function statePath(options) {
  const opts = options || {};
  return (
    opts.path || path.join(opts.home || os.homedir(), '.shipde', 'dispatch-state.json')
  );
}

/**
 * Returns { running, claims } from the persisted dispatch log.
 *
 * - If the file does not exist, returns empty arrays (clean machine; no prior
 *   dispatch has ever run).
 * - If the file exists but cannot be parsed or has the wrong structure, throws
 *   DispatchStateError. The caller must surface this and stop rather than
 *   planning as if idle.
 *
 * `running` entries come from prior LAUNCHED records; `claims` entries are
 * derived from the same records (branch → workItemId) so that the two stay
 * consistent with a single source of truth.
 */
function readDispatchState(options) {
  const file = statePath(options);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') {
      return { running: [], claims: [], expired: [] };
    }
    throw new DispatchStateError(
      'Không đọc được dispatch-state: ' + file + ' (' + e.message + ')',
      e
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new DispatchStateError(
      'dispatch-state bị hỏng (JSON không hợp lệ): ' + file + ' — ' + e.message,
      e
    );
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.running)) {
    throw new DispatchStateError(
      'dispatch-state không hợp lệ (thiếu trường running[]): ' + file
    );
  }

  const opts = options || {};
  const ttl = opts.sessionTtlMs != null ? opts.sessionTtlMs : SESSION_TTL_MS;
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();

  const allValid = parsed.running.filter(
    (r) => r && typeof r === 'object' && r.workItemId && r.role
  );

  // Finding 2: expire entries whose launchedAt is older than the TTL.
  // A LAUNCHED session whose worker dies would otherwise leave its branch
  // claimed forever. The TTL is a passive safety net — no live `ao session ls`
  // query, just a timestamp comparison. Expired entries are logged to stderr
  // so the operator can see what was released and investigate if needed.
  const running = [];
  const expired = [];
  for (const r of allValid) {
    const age = r.launchedAt ? now - new Date(r.launchedAt).getTime() : 0;
    if (ttl > 0 && age > ttl) {
      expired.push(r);
    } else {
      running.push(r);
    }
  }
  if (expired.length > 0) {
    for (const r of expired) {
      const ageH = ((now - new Date(r.launchedAt).getTime()) / 3600000).toFixed(1);
      console.error(
        'DISPATCH_STATE_EXPIRED: ' + r.workItemId +
        ' (session ' + (r.sessionId || '?') + ', branch ' + (r.branch || '?') +
        ') ran for ' + ageH + 'h — released from ceiling. Investigate if the session is still alive.'
      );
    }
  }

  // claims are derived from running so they are always consistent with it.
  const claims = running
    .filter((r) => r.branch)
    .map((r) => ({ branch: r.branch, owner: r.workItemId }));

  return { running, claims, expired };
}

/**
 * Persists the dispatch state after a successful dispatch.
 *
 * `assignments` is plan.assignments and `records` is result.records — they
 * are parallel arrays in plan order. Only entries whose record outcome is
 * LAUNCHED are kept: dry-run, refused and failed records have no live session
 * and must not be counted as running.
 *
 * MERGE BEHAVIOR (finding 1 fix): the function reads the existing state file
 * first and merges prior running entries with newly LAUNCHED entries. A new
 * LAUNCHED record for the same workItemId replaces the old one. Prior entries
 * for other work items are preserved. This prevents a dispatch that defers
 * everything (0 assignments) from erasing sessions that are still alive.
 *
 * accountId and branch are sourced from the assignment (the executor's slim
 * record carries neither). The two arrays are parallel by plan order; the
 * caller (cli.js) owns both and can guarantee they align.
 *
 * The write is atomic: tmp file → rename, so a crash mid-write leaves the
 * previous state intact rather than a half-written file.
 */
function writeDispatchState(assignments, records, options) {
  const file = statePath(options);
  const asgns = assignments || [];
  const recs = records || [];

  // Collect newly LAUNCHED entries from this dispatch.
  const newEntries = [];
  const newWorkItemIds = new Set();
  const n = Math.min(asgns.length, recs.length);
  for (let i = 0; i < n; i += 1) {
    const r = recs[i];
    const a = asgns[i];
    if (!r || r.outcome !== 'LAUNCHED') continue;
    if (!r.workItemId || !r.role) continue;
    newWorkItemIds.add(r.workItemId);
    newEntries.push({
      workItemId: r.workItemId,
      role: r.role,
      accountId: (a && a.accountId) || null,
      branch: (a && a.branch) || null,
      sessionId: r.sessionId || null,
      launchedAt: new Date().toISOString(),
    });
  }

  // Finding 1 fix: merge with prior state. Read the existing file and keep
  // entries for work items that were NOT re-launched in this dispatch.
  // A new LAUNCHED record for the same workItemId replaces the old one
  // (the new session supersedes the prior). Prior entries for other work
  // items are preserved so a dispatch that defers everything does not erase
  // sessions that are still alive.
  let prior = [];
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.running)) {
      prior = parsed.running.filter(
        (r) => r && typeof r === 'object' && r.workItemId && r.role
      );
    }
  } catch (_) {
    // No prior file or unparseable: start fresh. This is fine because
    // a missing file means no prior sessions, and a corrupt file was
    // already surfaced by readDispatchState on the previous dispatch.
  }

  // Keep prior entries whose workItemId is not superseded by a new launch.
  const running = prior.filter((r) => !newWorkItemIds.has(r.workItemId));
  // Append new entries after the preserved prior entries.
  running.push(...newEntries);

  const content = JSON.stringify(
    { version: 1, updatedAt: new Date().toISOString(), running },
    null,
    2
  );
  const tmp = file + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    throw new DispatchStateError(
      'Không ghi được dispatch-state: ' + file + ' (' + e.message + ')',
      e
    );
  }
}

/**
 * Clears the dispatch state file. This is the operator's escape hatch when
 * a stuck claim needs to be manually released (e.g. `node cli.js dispatch --clear-state`).
 *
 * Returns true if a file was removed, false if none existed.
 */
function clearDispatchState(options) {
  const file = statePath(options);
  try {
    fs.unlinkSync(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw new DispatchStateError(
      'Không xoá được dispatch-state: ' + file + ' (' + e.message + ')',
      e
    );
  }
}

module.exports = {
  DispatchStateError,
  SESSION_TTL_MS,
  statePath,
  readDispatchState,
  writeDispatchState,
  clearDispatchState,
};
