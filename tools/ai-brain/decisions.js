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
const { randomUUID } = require('node:crypto');
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

function sampleRepresentative(list, options = CANDIDATE_LIMIT) {
  if (!Array.isArray(list)) return [];
  const opts = typeof options === 'number' ? { limit: options } : options || {};
  const sampleCap = positiveDispatchLimit(
    { decisionSampleCap: opts.sampleCap ?? opts.decisionSampleCap },
    opts.dispatch || {},
    'decisionSampleCap'
  );
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : CANDIDATE_LIMIT;

  const picked = [];
  const pairCounts = new Map();
  const harnessOf = (row) =>
    (row.candidateKey && row.candidateKey.split('::')[0]) || row.harness || 'unknown';
  const reasonOf = (row) => row.reasonCode || row.reason || 'UNKNOWN';

  for (const row of list) {
    if (picked.length >= limit) break;
    const hr = harnessOf(row) + '::' + reasonOf(row);
    const count = pairCounts.get(hr) || 0;
    if (count < sampleCap) {
      pairCounts.set(hr, count + 1);
      picked.push(row);
    }
  }
  return picked;
}

function capDecision(entry, options) {
  const out = { ...entry };
  const opts = options || {};
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
    out[field] = sampleRepresentative(entry[field], opts);
  }
  return out;
}

function positiveDispatchLimit(options, dispatch, key) {
  const configured = require('./sources.json').dispatch || {};
  const value = Number(options[key] ?? dispatch[key] ?? configured[key]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('DISPATCH_CONFIG_INVALID: ' + key + ' must be a positive integer');
  }
  return value;
}

function mergeRankingSummaryEntries(entries, maxEntries) {
  const rollups = [];
  const detailsByFile = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.kind === 'rollup') {
      rollups.push(entry);
    } else if (typeof entry.file === 'string') {
      detailsByFile.set(entry.file, entry);
    }
  }

  const details = [...detailsByFile.values()].sort(
    (a, b) =>
      String(a.mtime || '').localeCompare(String(b.mtime || '')) || a.file.localeCompare(b.file)
  );
  if (rollups.length === 0 && details.length <= maxEntries) return details;

  const detailSlots = Math.max(0, maxEntries - 1);
  const retained = detailSlots > 0 ? details.slice(-detailSlots) : [];
  const rolledDetails = details.slice(0, details.length - retained.length);
  const rolledEntries = [...rollups, ...rolledDetails];
  const rollup = {
    kind: 'rollup',
    filesCount: 0,
    oldestMtime: null,
    newestMtime: null,
    candidatesCount: 0,
    rejectedCount: 0,
    rejectedByReasonCode: {},
    modelRankingCount: 0,
  };

  for (const entry of rolledEntries) {
    const filesCount = entry.kind === 'rollup' ? Number(entry.filesCount) : 1;
    rollup.filesCount += Number.isSafeInteger(filesCount) && filesCount > 0 ? filesCount : 0;
    for (const field of ['candidatesCount', 'rejectedCount', 'modelRankingCount']) {
      const count = Number(entry[field]);
      if (Number.isFinite(count) && count > 0) rollup[field] += count;
    }
    for (const [reason, countValue] of Object.entries(entry.rejectedByReasonCode || {})) {
      const count = Number(countValue);
      if (Number.isFinite(count) && count > 0) {
        rollup.rejectedByReasonCode[reason] = (rollup.rejectedByReasonCode[reason] || 0) + count;
      }
    }
    const oldest = entry.oldestMtime || entry.mtime || null;
    const newest = entry.newestMtime || entry.mtime || null;
    if (oldest && (!rollup.oldestMtime || oldest < rollup.oldestMtime)) {
      rollup.oldestMtime = oldest;
    }
    if (newest && (!rollup.newestMtime || newest > rollup.newestMtime)) {
      rollup.newestMtime = newest;
    }
  }

  return [rollup, ...retained];
}

function replaceJsonDurably(file, value) {
  const temporary = file + '.' + process.pid + '-' + randomUUID() + '.tmp';
  let fd;
  let directoryFd;
  try {
    fd = fs.openSync(temporary, 'wx');
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
    if (process.platform !== 'win32') {
      directoryFd = fs.openSync(path.dirname(file), 'r');
      fs.fsyncSync(directoryFd);
      fs.closeSync(directoryFd);
      directoryFd = undefined;
    }
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    if (directoryFd !== undefined) {
      try {
        fs.closeSync(directoryFd);
      } catch {}
    }
    try {
      fs.unlinkSync(temporary);
    } catch {}
  }
}

function retentionLimits(options) {
  const opts = options || {};
  const dispatch = opts.dispatch || (opts.registry && opts.registry.dispatch) || {};
  return {
    decisionRetentionDays: positiveDispatchLimit(opts, dispatch, 'decisionRetentionDays'),
    rankingSummaryMaxEntries: positiveDispatchLimit(opts, dispatch, 'rankingSummaryMaxEntries'),
  };
}

function summarizeOldRankingFiles(options) {
  const opts = options || {};
  const dir = opts.dir || opts.decisionDir || DEFAULT_DIR;
  if (!dir || !fs.existsSync(dir)) return { summarized: 0, removed: 0 };

  const now = Number(opts.now) > 0 ? Number(opts.now) : Date.now();
  const dispatch = opts.dispatch || (opts.registry && opts.registry.dispatch) || {};
  const retentionDays = positiveDispatchLimit(opts, dispatch, 'decisionRetentionDays');
  const summaryMaxEntries = positiveDispatchLimit(opts, dispatch, 'rankingSummaryMaxEntries');
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return { summarized: 0, removed: 0 };
  }
  const rankingPattern = /^ranking-(?!summary).*\.json$/;
  const oldFiles = [];

  for (const file of entries) {
    if (!rankingPattern.test(file)) continue;
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        oldFiles.push({ file, fullPath, mtimeMs: stat.mtimeMs });
      }
    } catch {}
  }

  const summaryFile = opts.summaryFile || path.join(dir, 'ranking-summary.json');
  let summaries = [];
  if (fs.existsSync(summaryFile)) {
    const parsed = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('RANKING_SUMMARY_INVALID');
    summaries = parsed;
  }

  // Sources already folded into the summary by an earlier run whose unlink did not
  // complete. They are removed now and never counted again.
  const pendingEntry = summaries.find((entry) => entry && entry.kind === 'pending');
  summaries = summaries.filter((entry) => !(entry && entry.kind === 'pending'));
  const alreadyCounted = new Set();
  let removed = 0;
  for (const file of (pendingEntry && pendingEntry.files) || []) {
    if (typeof file !== 'string' || !rankingPattern.test(file)) continue;
    try {
      fs.unlinkSync(path.join(dir, file));
      removed += 1;
    } catch (error) {
      if (error && error.code !== 'ENOENT') alreadyCounted.add(file);
    }
  }

  const summarizedFiles = [];
  for (const { file, fullPath, mtimeMs } of oldFiles) {
    if (alreadyCounted.has(file)) continue;
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const data = JSON.parse(content);
      const capped = capDecision(data, opts);
      summaries.push({
        file,
        mtime: new Date(mtimeMs).toISOString(),
        candidatesCount:
          capped.candidatesCount ?? (Array.isArray(data.candidates) ? data.candidates.length : 0),
        rejectedCount:
          capped.rejectedCount ?? (Array.isArray(data.rejected) ? data.rejected.length : 0),
        rejectedByReasonCode: capped.rejectedByReasonCode || {},
        modelRankingCount:
          capped.modelRankingCount ??
          (Array.isArray(data.modelRanking) ? data.modelRanking.length : 0),
        chosen: identity(data.chosen) || data.chosenKey || data.selected || null,
      });
      summarizedFiles.push({ file, fullPath });
    } catch {}
  }

  const pendingFiles = [...alreadyCounted, ...summarizedFiles.map(({ file }) => file)];
  const pendingChanged =
    JSON.stringify(pendingFiles) !== JSON.stringify((pendingEntry && pendingEntry.files) || []);
  if (summarizedFiles.length === 0 && !pendingChanged) {
    return { summarized: summaries.length, removed, summaryFile };
  }

  summaries = mergeRankingSummaryEntries(summaries, summaryMaxEntries);
  const written = pendingFiles.length
    ? [...summaries, { kind: 'pending', files: pendingFiles }]
    : summaries;
  replaceJsonDurably(summaryFile, written);

  const stillPending = [...alreadyCounted];
  for (const { file, fullPath } of summarizedFiles) {
    try {
      fs.unlinkSync(fullPath);
      removed += 1;
    } catch {
      stillPending.push(file);
    }
  }
  if (stillPending.length !== pendingFiles.length) {
    try {
      replaceJsonDurably(
        summaryFile,
        stillPending.length ? [...summaries, { kind: 'pending', files: stillPending }] : summaries
      );
    } catch {
      // The earlier pending list stays; next run finds those sources gone and drops them.
    }
  }

  return { summarized: summaries.length, removed, summaryFile };
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
  summarizeOldRankingFiles(options);
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
  const retention = retentionLimits(opts);
  const record = Object.assign(
    { at: new Date(now).toISOString() },
    scrub(capDecision(entry || {}, opts))
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
  try {
    summarizeOldRankingFiles({ ...opts, ...retention });
  } catch (error) {
    // The decision is already durable. Retention I/O is retried on the next record:
    // sources stay in place until the summary that counts them has been replaced.
    if (String(error && error.message).startsWith('DISPATCH_CONFIG_INVALID')) throw error;
  }
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
    } else if (r.stage === Stage.COMPLETED || r.stage === Stage.FAILED) {
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
    } else if (r.stage === Stage.COMPLETED || r.stage === Stage.FAILED) {
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
  summarizeOldRankingFiles,
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
