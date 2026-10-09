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
  // A review round (TASK-AI-64). Added to this enum rather than to a second log,
  // so the verdict, the open findings and the refusal cause land in the one
  // append-only trace a human reads. It opens and closes no writer claim.
  REVIEW: 'review',
  REVIEWER_SELECTION: 'reviewer-selection',
  // A non-blocking warning (TASK-AI-127 WD-R03, e.g. WORKER_DEPS_UNAVAILABLE):
  // the run continues, but the condition must be readable in the same trace.
  WARNING: 'warning',
  // TASK-AI-129 (TM-R04): the tool manifest reaches the same trace — which
  // tools the prompt offered (PROMPT_TOOLS) and how each gate tool ran before
  // review (TOOL_GATE). Gate entries carry the tool id and pass/fail only;
  // raw tool output never lands here.
  PROMPT_TOOLS: 'prompt_tools',
  TOOL_GATE: 'tool_gate',
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
 * Every record from the last `days` days, oldest first, plus what went wrong
 * while reading: `{ records, damaged, readable }`.
 *
 * The distinction matters more than it looks. A directory that has never
 * existed is an empty history — the first dispatch on a fresh machine must not
 * fail because nothing has been decided yet. A directory that cannot be read,
 * or a file that cannot be opened, is not evidence of anything: the claims may
 * still be there and simply be unreachable. Collapsing the two into "no
 * writers" is what lets a second agent onto a branch that already has one.
 *
 * A truncated last line is different again, and is not damage: it is the
 * normal shape of a file whose writer was killed mid-append, and every
 * complete line before it is still good evidence.
 */
function readDecisionsDetailed(options) {
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
  } catch (err) {
    // ENOENT is a history that has not started. Anything else — a permission
    // error, a broken mount — is a history we cannot see, which is not the
    // same thing and must not read as "nothing is claimed".
    if (err && err.code === 'ENOENT') return { records: [], damaged: [], readable: true };
    return {
      records: [],
      damaged: [dir + ': ' + (err && err.code ? err.code : 'unreadable')],
      readable: false,
    };
  }

  const out = [];
  const damaged = [];
  for (const file of files.sort()) {
    let raw;
    try {
      raw = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch (err) {
      damaged.push(file + ': ' + (err && err.code ? err.code : 'unreadable'));
      continue;
    }
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch (_) {
        // Only the final line may be half-written; a broken line anywhere else
        // means the file was damaged rather than interrupted.
        const isLast = lines.slice(i + 1).every((l) => l.trim() === '');
        if (!isLast) damaged.push(file + ': unparsable line ' + (i + 1));
      }
    }
  }
  return { records: out, damaged, readable: damaged.length === 0 };
}

/** The records alone, for callers that only want the history.
 *
 * Note: This discards the `readable` and `damaged` flags. Callers that need
 * to know whether the log could be trusted (e.g. the executor deciding
 * whether to launch a new writer) MUST use `readDecisionsDetailed` or
 * `openWritersDetailed` instead.
 */
function readDecisions(options) {
  return readDecisionsDetailed(options).records;
}

/**
 * Reads decisions and throws if the log is damaged/unreadable.
 * Use this when the caller must refuse rather than guess on a damaged log.
 */
function readDecisionsSafe(options) {
  const detail = readDecisionsDetailed(options);
  if (!detail.readable) {
    const err = new Error('Decision log unreadable: ' + detail.damaged.join('; '));
    err.code = 'DECISION_LOG_UNREADABLE';
    err.damaged = detail.damaged;
    throw err;
  }
  return detail.records;
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
  return openWritersDetailed(options).writers;
}

/**
 * The open writers plus whether the log could be read at all:
 * `{ writers, readable, damaged }`.
 *
 * A caller deciding whether a branch is free must look at `readable`. An
 * unreadable log means "unknown", and unknown has to stop a launch — the whole
 * point of the log is that it is the only evidence of a claim, so losing it
 * cannot be the same as there being no claim.
 */
function openWritersDetailed(options) {
  const detail =
    options && options.records
      ? { records: options.records, damaged: [], readable: true }
      : readDecisionsDetailed(options);
  const records = detail.records;
  const state = new Map();
  for (const r of records) {
    if (!r || !r.workItemId) continue;
    const isReview =
      r.stage === Stage.REVIEW ||
      r.stage === Stage.REVIEWER_SELECTION ||
      r.role === 'reviewer' ||
      (typeof r.role === 'string' && (r.role.startsWith('reviewer.') || r.role === 'reviewer'));
    if (isReview) continue;
    if (r.stage === Stage.LAUNCHED || r.stage === Stage.RESUMED) {
      state.set(r.workItemId, {
        workItemId: r.workItemId,
        sessionId: r.sessionId || null,
        harness: r.harness || null,
        branch: r.branch || null,
        chosen: r.chosen || null,
        worktree: r.worktree || null,
        since: r.at,
        area: r.area || null,
      });
    } else if (r.stage === Stage.COMPLETED || r.stage === Stage.FAILED) {
      state.delete(r.workItemId);
    }
  }

  const ttlMs = (options && options.ttlMs) || 4 * 60 * 60 * 1000;
  const now = (options && options.now) || Date.now();
  const fs = require('fs');

  const activeWriters = [];
  for (const w of state.values()) {
    let lastActivity = new Date(w.since).getTime();
    if (w.worktree) {
      const pathsToCheck = [
        path.join(w.worktree, '.git', 'index'),
        path.join(w.worktree, 'logs'),
        path.join(w.worktree, '.shipde', 'heartbeat'),
      ];
      for (const p of pathsToCheck) {
        try {
          const stats = fs.statSync(p);
          if (stats.mtimeMs > lastActivity) {
            lastActivity = stats.mtimeMs;
          }
        } catch (e) {
          // ignore
        }
      }
    }
    const elapsed = now - lastActivity;
    if (elapsed <= ttlMs) {
      activeWriters.push(w);
    }
  }

  // exclude a second writer on the same branch/area.
  const filtered = [];
  const seenBranches = new Set();
  const seenAreas = new Set();
  for (const w of activeWriters.sort(
    (a, b) => new Date(b.since).getTime() - new Date(a.since).getTime()
  )) {
    if (w.branch && seenBranches.has(w.branch)) continue;
    if (w.area && seenAreas.has(w.area)) continue;
    if (w.branch) seenBranches.add(w.branch);
    if (w.area) seenAreas.add(w.area);
    filtered.push(w);
  }

  return {
    writers: filtered,
    readable: detail.readable,
    damaged: detail.damaged,
  };
}

/**
 * Reviewers currently active according to the decision log.
 */
function openReviewersDetailed(options) {
  const detail =
    options && options.records
      ? { records: options.records, damaged: [], readable: true }
      : readDecisionsDetailed(options);
  const records = detail.records;
  const state = new Map();
  for (const r of records) {
    if (!r || !r.workItemId) continue;
    const isReview =
      r.stage === Stage.REVIEW ||
      r.stage === Stage.REVIEWER_SELECTION ||
      r.role === 'reviewer' ||
      (typeof r.role === 'string' && (r.role.startsWith('reviewer.') || r.role === 'reviewer'));

    if (isReview) {
      const isTerminal =
        r.stage === Stage.COMPLETED ||
        r.stage === Stage.FAILED ||
        r.outcome === 'passed' ||
        r.outcome === 'failed' ||
        r.verdict === 'PASS' ||
        r.verdict === 'FAIL' ||
        r.verdict === 'CHANGES_REQUIRED' ||
        r.verdict === 'BLOCKED';

      const revKey = r.sessionId
        ? `${r.workItemId}:${r.sessionId}`
        : r.reviewer
          ? `${r.workItemId}:${r.reviewer}`
          : r.role
            ? `${r.workItemId}:${r.role}`
            : r.workItemId;

      if (isTerminal) {
        if (state.has(revKey)) {
          state.delete(revKey);
        } else {
          for (const [key, rev] of state.entries()) {
            if (rev.workItemId === r.workItemId) {
              if (r.sessionId && rev.sessionId === r.sessionId) {
                state.delete(key);
              } else if (r.reviewer && rev.reviewer === r.reviewer) {
                state.delete(key);
              } else if (r.role && rev.role === r.role) {
                state.delete(key);
              } else if (!r.sessionId && !r.reviewer && !r.role) {
                state.delete(key);
              }
            }
          }
        }
      } else {
        state.set(revKey, {
          workItemId: r.workItemId,
          sessionId: r.sessionId || null,
          role: r.role || 'reviewer',
          reviewer: r.reviewer || null,
          since: r.at,
        });
      }
    } else if (r.stage === Stage.COMPLETED || r.stage === Stage.FAILED) {
      for (const [key, rev] of state.entries()) {
        if (rev.workItemId === r.workItemId) {
          state.delete(key);
        }
      }
    }
  }

  const ttlMs = (options && options.ttlMs) || 4 * 60 * 60 * 1000;
  const now = (options && options.now) || Date.now();
  const activeReviewers = [];
  for (const rev of state.values()) {
    const elapsed = now - new Date(rev.since).getTime();
    if (elapsed <= ttlMs) {
      activeReviewers.push(rev);
    }
  }

  return {
    reviewers: activeReviewers,
    readable: detail.readable,
    damaged: detail.damaged,
  };
}

function openReviewers(options) {
  return openReviewersDetailed(options).reviewers;
}

/** The open writer for this work item, or null when it is free to claim. */
function writerFor(workItemId, options) {
  const detail = openWritersDetailed(options);
  if (!detail.readable) {
    throw new Error(`Cannot determine writer for ${workItemId}: decision log is unreadable`);
  }
  return detail.writers.find((w) => w.workItemId === workItemId) || null;
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

function scrubText(text) {
  if (typeof text !== 'string') return text;
  return text.replace(
    /(sk-[a-zA-Z0-9_-]+|gh[a-zA-Z]_[a-zA-Z0-9_-]+|Bearer\s+[^\s]+|Basic\s+[^\s]+)/g,
    '[REDACTED_SECRET]'
  );
}

module.exports = {
  Stage,
  DEFAULT_DIR,
  recordDecision,
  readDecisions,
  readDecisionsSafe,
  readDecisionsDetailed,
  openWriters,
  openWritersDetailed,
  openReviewers,
  openReviewersDetailed,
  writerFor,
  closeWriter,
  scrub,
  scrubText,
};
