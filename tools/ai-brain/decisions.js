'use strict';

/**
 * Ship Dễ — Dispatch decision log (TASK-AI-49)
 *
 * Every routing choice writes one line here: the work item, the candidates,
 * the evidence each was judged on, the ones refused and why, the one chosen,
 * the session it became, and how it ended.
 *
 * The reason is recovery, not audit theatre. When a run is interrupted the
 * only question that matters is "is there already a writer on this branch, and
 * what is its session id" — and the answer has to survive the process that
 * knew it. Without this file the honest answer is a guess, and a guess puts a
 * second agent on a branch that already has commits.
 *
 * Append-only JSONL, one file per day. Appending means a crashed writer loses
 * at most its own line; rewriting a JSON document would risk the whole history
 * on every dispatch. Lines that fail to parse are skipped on read rather than
 * failing the read, because a truncated last line is the normal shape of a
 * file whose writer was killed.
 *
 * Nothing here may carry a credential. The candidates carry account ids and
 * model names, which are already on the dashboard; a token would make this log
 * a secrets file that every agent has a reason to open.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_DIR = path.join(os.homedir(), '.shipde', 'decisions');

const Stage = Object.freeze({
  SELECTED: 'selected',
  LAUNCHED: 'launched',
  REFUSED: 'refused',
  COOLED: 'cooled',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RESUMED: 'resumed',
});

const SECRET_KEYS = /^(key|apiKey|api_key|token|secret|password|authorization|credential)$/i;

/**
 * Drops anything that looks like a credential, at any depth.
 *
 * A caller passing the whole account object is the expected mistake, not an
 * exotic one: `listAccounts` already returns secrets as a presence flag, but a
 * hand-built candidate assembled from a config file has no such discipline.
 */
function scrub(value, depth) {
  const level = depth || 0;
  if (level > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, level + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.test(k)) {
      out[k] = v === undefined || v === null || v === '' ? null : '[redacted]';
      continue;
    }
    out[k] = scrub(v, level + 1);
  }
  return out;
}

function dayFile(dir, now) {
  const stamp = new Date(now).toISOString().slice(0, 10);
  return path.join(dir, stamp + '.jsonl');
}

/**
 * @param entry {
 *   stage, workItemId, role, candidates:[{offeringId,grade,evidence,headroom}],
 *   rejected:[{offeringId,reason}], chosen, harness, sessionId, branch,
 *   worktree, outcome, detail, cooldownUntil
 * }
 * @param options { dir, now }
 * @returns the record as written
 */
function recordDecision(entry, options) {
  const opts = options || {};
  const dir = opts.dir || DEFAULT_DIR;
  const now = opts.now || Date.now();
  const record = Object.assign({ at: new Date(now).toISOString() }, scrub(entry || {}));
  if (!record.stage) record.stage = Stage.SELECTED;
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(dayFile(dir, now), JSON.stringify(record) + '\n', 'utf8');
  return record;
}

/**
 * Every record from the last `days` days, oldest first.
 * A missing directory is an empty history, not an error: the first dispatch on
 * a fresh machine must not fail because nothing has been decided yet.
 */
function readDecisions(options) {
  const opts = options || {};
  const dir = opts.dir || DEFAULT_DIR;
  const days = opts.days || 7;
  const now = opts.now || Date.now();

  const wanted = new Set();
  for (let i = 0; i < days; i += 1) {
    wanted.add(new Date(now - i * 86400000).toISOString().slice(0, 10));
  }

  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl') && wanted.has(f.slice(0, -6)));
  } catch (_) {
    return [];
  }

  const out = [];
  for (const file of files.sort()) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (_) {
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch (_) {
        // A half-written last line is what a killed writer leaves behind.
      }
    }
  }
  return out;
}

/**
 * Work items that still hold a writer: launched or resumed, with nothing since
 * that ended them.
 *
 * This is the question asked after an interruption, and it is answered from
 * what was written down rather than from what is running, because a session
 * whose daemon restarted is still the rightful writer of its branch.
 */
function openWriters(options) {
  const records = (options && options.records) || readDecisions(options);
  const state = new Map();
  for (const r of records) {
    if (!r || !r.workItemId) continue;
    if (r.stage === Stage.LAUNCHED || r.stage === Stage.RESUMED) {
      state.set(r.workItemId, {
        workItemId: r.workItemId,
        sessionId: r.sessionId || null,
        harness: r.harness || null,
        branch: r.branch || null,
        chosen: r.chosen || null,
        since: r.at,
      });
    } else if (r.stage === Stage.COMPLETED || r.stage === Stage.FAILED) {
      state.delete(r.workItemId);
    }
  }
  return Array.from(state.values());
}

/** The open writer for this work item, or null when it is free to claim. */
function writerFor(workItemId, options) {
  return openWriters(options).find((w) => w.workItemId === workItemId) || null;
}

/**
 * Records that a work item's writer has ended, releasing its claim.
 *
 * Without this a session that was stopped, or that died with its daemon, reads
 * as an open writer for ever and the work item can never be picked up again —
 * the log is the only evidence of a claim, so it has to be the evidence of a
 * release too.
 *
 * Returns null when nothing held the item, so calling it twice is harmless.
 */
function closeWriter(workItemId, outcome, options) {
  const writer = writerFor(workItemId, options);
  if (!writer) return null;
  return recordDecision(
    {
      stage: outcome === 'completed' ? Stage.COMPLETED : Stage.FAILED,
      workItemId,
      harness: writer.harness,
      sessionId: writer.sessionId,
      branch: writer.branch,
      chosen: writer.chosen,
      detail: (options && options.detail) || null,
    },
    options
  );
}

module.exports = {
  Stage,
  DEFAULT_DIR,
  recordDecision,
  readDecisions,
  openWriters,
  writerFor,
  closeWriter,
  scrub,
};
