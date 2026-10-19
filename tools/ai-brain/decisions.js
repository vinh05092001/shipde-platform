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
 * Append-only JSONL, size-bounded parts per day. Appending means a crashed writer loses
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
const { StringDecoder } = require('node:string_decoder');

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
  // TASK-AI-133: Reviewer launch by orchestrate
  REVIEW_LAUNCH: 'review-launch',
  // A non-blocking warning (TASK-AI-127 WD-R03, e.g. WORKER_DEPS_UNAVAILABLE):
  // the run continues, but the condition must be readable in the same trace.
  WARNING: 'warning',
  // TASK-AI-129 (TM-R04): the tool manifest reaches the same trace — which
  // tools the prompt offered (PROMPT_TOOLS) and how each gate tool ran before
  // review (TOOL_GATE). Gate entries carry the tool id and pass/fail only;
  // raw tool output never lands here.
  PROMPT_TOOLS: 'prompt_tools',
  TOOL_GATE: 'tool_gate',
  ALREADY_SATISFIED_ON_BASE: 'already_satisfied_on_base',
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

const CANDIDATE_LIMIT = 10;
const DAILY_LIMIT_BYTES = 50 * 1024 * 1024;
const PART_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/;
const identity = (c) =>
  typeof c === 'string' ? c : c && (c.candidateKey || c.offeringId || c.key);

function sampleRepresentative(list, limit = CANDIDATE_LIMIT) {
  if (!Array.isArray(list) || list.length <= limit) return (list || []).slice(0, limit);
  const picked = [];
  const seenHarnessReason = new Set();
  const harnessOf = (row) =>
    (row.candidateKey && row.candidateKey.split('::')[0]) || row.harness || 'unknown';
  const reasonOf = (row) => row.reasonCode || row.reason || 'UNKNOWN';

  // Pass 1: Ensure distinct (harness, reason) combinations have representation
  for (const row of list) {
    if (picked.length >= limit) break;
    const hr = harnessOf(row) + '::' + reasonOf(row);
    if (!seenHarnessReason.has(hr)) {
      seenHarnessReason.add(hr);
      picked.push(row);
    }
  }

  // Pass 2: Fill remaining slots up to limit in original order
  if (picked.length < limit) {
    const pickedSet = new Set(picked);
    for (const row of list) {
      if (picked.length >= limit) break;
      if (!pickedSet.has(row)) {
        pickedSet.add(row);
        picked.push(row);
      }
    }
  }
  return picked;
}

function capDecision(entry) {
  const out = { ...entry };
  const chosen = identity(entry.chosen) || entry.chosenKey || entry.selected;
  for (const field of ['candidates', 'ranking', 'top3', 'modelRanking']) {
    if (!Array.isArray(entry[field])) continue;
    const rows = entry[field];
    out.chosenCandidate = out.chosenCandidate || rows.find((c) => identity(c) === chosen) || null;
    out[field + 'Count'] = entry[field + 'Count'] ?? rows.length;
    out[field] = rows.slice(0, field === 'top3' ? 3 : CANDIDATE_LIMIT).map((row) => {
      if (!row || typeof row !== 'object') return row;
      const summary = { ...row };
      delete summary.prior;
      delete summary.sources;
      delete summary.sourceLinks;
      if (summary.scoreBreakdown && typeof summary.scoreBreakdown === 'object') {
        summary.scoreBreakdown = Object.fromEntries(
          Object.entries(summary.scoreBreakdown).map(([k, v]) => [
            k,
            v && typeof v === 'object'
              ? Object.fromEntries(
                  Object.entries(v).filter(([, x]) => x === null || typeof x !== 'object')
                )
              : v,
          ])
        );
      }
      return summary;
    });
  }
  for (const field of ['rejected', 'knownGoodRejected', 'isolatedLaneRejected']) {
    if (!Array.isArray(entry[field])) continue;
    out[field + 'Count'] = entry[field + 'Count'] ?? entry[field].length;
    if (!entry[field + 'ByReasonCode']) {
      const counts = Object.create(null);
      for (const row of entry[field]) {
        const reason = row.reasonCode || row.reason || 'UNKNOWN';
        counts[reason] = (counts[reason] || 0) + 1;
      }
      out[field + 'ByReasonCode'] = counts;
    }
    out[field] = sampleRepresentative(entry[field], CANDIDATE_LIMIT);
  }
  return out;
}

function decisionFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => PART_PATTERN.test(f))
    .sort((a, b) => {
      const x = a.match(PART_PATTERN),
        y = b.match(PART_PATTERN);
      return x[1].localeCompare(y[1]) || Number(x[2] || 0) - Number(y[2] || 0);
    });
}

// Output stays outside the daily reader namespace until operator replacement.
function compactDecisions(options) {
  const dir = options && options.dir;
  if (!dir) throw new Error('decisions compact requires --dir');
  return decisionFiles(dir).map((name) => {
    const source = path.join(dir, name);
    const output = source + '.compact-' + Date.now() + '.jsonl';
    const fd = fs.openSync(output, 'wx');
    let records = 0;
    try {
      for (const { line } of decisionLines(source, fs)) {
        if (!line.trim()) continue;
        fs.writeSync(fd, JSON.stringify(scrub(capDecision(JSON.parse(line)))) + '\n');
        records += 1;
      }
    } finally {
      fs.closeSync(fd);
    }
    return { source, output, records };
  });
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
function recordRouteRefusals(entries, previous, entry, options) {
  const summaries = new Map();
  for (const { candidateKey, reason } of entries) {
    const cooldown = String(reason || '').match(
      /^(PROBE_COOLDOWN(?:_ACCOUNT)?): (.*?)(?: until (.*))?$/
    );
    if (cooldown) {
      const code =
        cooldown[1] === 'PROBE_COOLDOWN_ACCOUNT' ? cooldown[1] : cooldown[1] + ': ' + cooldown[2];
      const nextCheckAt = cooldown[3] || null;
      const summary = summaries.get(code) || { reason: code, count: 0, earliestNextCheckAt: null };
      summary.count += 1;
      if (
        nextCheckAt &&
        (!summary.earliestNextCheckAt || nextCheckAt < summary.earliestNextCheckAt)
      )
        summary.earliestNextCheckAt = nextCheckAt;
      summaries.set(code, summary);
    }
    const seen = previous.has(candidateKey);
    const prior = previous.get(candidateKey);
    if ((seen && prior !== reason) || (!seen && reason && !cooldown)) {
      recordDecision(
        {
          ...entry,
          stage: reason ? Stage.REFUSED : Stage.RESUMED,
          rejected: reason ? [{ candidateKey, reason }] : [],
          candidateKey,
          detail: reason,
          previousReason: prior || null,
        },
        options
      );
    }
    previous.set(candidateKey, reason);
  }
  for (const summary of summaries.values())
    recordDecision({ ...entry, stage: Stage.REFUSED, ...summary, detail: summary.reason }, options);
}

function recordDecision(entry, options) {
  const opts = options || {};
  const dir = opts.dir || DEFAULT_DIR;
  const now = opts.now || Date.now();
  const record = Object.assign(
    { at: new Date(now).toISOString() },
    scrub(capDecision(entry || {}))
  );
  if (!record.stage) record.stage = Stage.SELECTED;
  fs.mkdirSync(dir, { recursive: true });
  const base = dayFile(dir, now);
  const stamp = path.basename(base, '.jsonl');
  const parts = decisionFiles(dir).filter((f) => f.startsWith(stamp));
  let file = parts.length ? path.join(dir, parts[parts.length - 1]) : base;
  const line = JSON.stringify(record) + '\n';
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (size > 0 && size + Buffer.byteLength(line) > (opts.maxFileBytes ?? DAILY_LIMIT_BYTES)) {
    const part = Number(path.basename(file).match(PART_PATTERN)[2] || 0) + 1;
    file = path.join(dir, stamp + '.' + part + '.jsonl');
  }
  fs.appendFileSync(file, line, 'utf8');
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
    files = decisionFiles(dir).filter((f) => wanted.has(f.slice(0, 10)));
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
  for (const file of files) {
    let lineNumber = 0;
    try {
      for (const { line, final } of decisionLines(path.join(dir, file), opts.reader || fs)) {
        lineNumber += 1;
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          out.push(JSON.parse(trimmed));
        } catch (_) {
          if (!final) damaged.push(file + ': unparsable line ' + lineNumber);
        }
      }
    } catch (err) {
      damaged.push(file + ': ' + (err && err.code ? err.code : 'unreadable'));
    }
  }
  return { records: out, damaged, readable: damaged.length === 0 };
}

// A day's log can exceed V8's maximum string size. Decode one chunk at a time.
function* decisionLines(file, reader) {
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.alloc(64 * 1024);
  const fd = reader.openSync(file, 'r');
  let pending = '';
  try {
    let count;
    while ((count = reader.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      pending += decoder.write(buffer.subarray(0, count));
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        yield { line: pending.slice(0, newline), final: false };
        pending = pending.slice(newline + 1);
      }
    }
    pending += decoder.end();
    if (pending) yield { line: pending, final: true };
  } finally {
    reader.closeSync(fd);
  }
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
      r.stage === Stage.REVIEW_LAUNCH ||
      r.stage === Stage.REVIEW ||
      r.stage === Stage.REVIEWER_SELECTION ||
      r.role === 'reviewer' ||
      (typeof r.role === 'string' && r.role.startsWith('reviewer.'));
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
    } else if (
      r.stage === Stage.COMPLETED ||
      r.stage === Stage.FAILED ||
      r.stage === Stage.ALREADY_SATISFIED_ON_BASE ||
      r.stage === 'already_satisfied_on_base' ||
      r.status === 'ALREADY_SATISFIED_ON_BASE'
    ) {
      state.delete(r.workItemId);
    }
  }

  const ttlMs = (options && (options.staleWindowMs || options.ttlMs)) || 4 * 60 * 60 * 1000;
  const now = (options && options.now) || Date.now();
  const fs = require('fs');

  const activeWriters = [];
  const staleWriters = [];
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
    } else {
      staleWriters.push({ ...w, staleForMs: elapsed });
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
    stale: staleWriters,
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
      r.stage === Stage.REVIEWER_SELECTION ||
      r.stage === Stage.REVIEW ||
      r.stage === Stage.REVIEW_LAUNCH ||
      r.role === 'reviewer' ||
      (typeof r.role === 'string' && r.role.startsWith('reviewer.'));

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
        const previous = state.get(revKey);
        state.set(revKey, {
          workItemId: r.workItemId,
          sessionId: r.sessionId || null,
          role: r.role || 'reviewer',
          reviewer: r.reviewer || null,
          since: previous ? previous.since : r.at,
          lastActivity: new Date(r.at).getTime(),
        });
      }
    } else if (
      r.stage === Stage.COMPLETED ||
      r.stage === Stage.FAILED ||
      r.stage === Stage.ALREADY_SATISFIED_ON_BASE ||
      r.stage === 'already_satisfied_on_base' ||
      r.status === 'ALREADY_SATISFIED_ON_BASE'
    ) {
      for (const [key, rev] of state.entries()) {
        if (rev.workItemId === r.workItemId) {
          state.delete(key);
        }
      }
    }
  }

  const ttlMs = (options && (options.staleWindowMs || options.ttlMs)) || 4 * 60 * 60 * 1000;
  const now = (options && options.now) || Date.now();
  const activeReviewers = [];
  const staleReviewers = [];
  for (const rev of state.values()) {
    const elapsed = now - rev.lastActivity;
    if (elapsed <= ttlMs) {
      activeReviewers.push(rev);
    } else {
      staleReviewers.push({ ...rev, staleForMs: elapsed });
    }
  }

  return {
    reviewers: activeReviewers,
    stale: staleReviewers,
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

/** Compile literal credential values once per capture. */
function createSecretRedactor(env) {
  const values = [
    ...new Set(
      Object.entries(env || {})
        .filter(
          ([name, value]) =>
            /KEY|TOKEN|SECRET|PASS|AUTH/i.test(name) &&
            typeof value === 'string' &&
            value.length >= 8
        )
        .map(([, value]) => value)
    ),
  ].sort((a, b) => b.length - a.length);
  const pattern = values.length
    ? new RegExp(values.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    : null;
  return (text) =>
    scrubText(pattern ? String(text).replace(pattern, '[REDACTED_SECRET]') : String(text)).replace(
      /((?:api[_-]?key|token|secret|password|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED_SECRET]'
    );
}

module.exports = {
  Stage,
  sampleRepresentative,
  decisionFiles,
  decisionLines,
  capDecision,
  compactDecisions,
  DEFAULT_DIR,
  recordDecision,
  recordRouteRefusals,
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
  createSecretRedactor,
};
