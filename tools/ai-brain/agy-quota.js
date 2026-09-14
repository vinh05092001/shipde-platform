'use strict';

/**
 * Ship Dễ — Antigravity quota, read from the CLI that owns it
 *
 * `agy` reports its own limits through the `/quota` slash command. It prints a
 * percentage remaining and a reset instant per window, not an absolute ceiling:
 *
 *   Gemini Models            Weekly Limit Remaining      40%   2026-09-16T06:47:24Z
 *   Gemini Models            Five Hour Limit Remaining   98%   2026-09-14T12:56:43Z
 *   Claude and GPT models    Weekly Limit Remaining      69%   2026-09-18T04:39:38Z
 *   Claude and GPT models    Five Hour Limit Remaining   60%   2026-09-14T12:25:57Z
 *
 * A percentage is more useful than it looks and less useful than it seems.
 *
 * More useful: it answers the scheduling question directly. "40% of the week
 * left" is exactly what decides whether to dispatch here or drop a tier, and
 * it needs no ceiling at all.
 *
 * Less useful: it cannot be converted into tokens. Without knowing what 100%
 * is, 40% remaining says nothing about how many tasks fit in it. So this
 * reports headroom as a fraction and leaves absolute limits to the learned
 * ceiling, which measures them in the only unit the scheduler can spend.
 *
 * Two model families share one account and drain separately. Dispatching a
 * Gemini model while the Claude pool is empty is fine and the reverse is too,
 * so the families are kept apart rather than averaged into one number.
 */

const { execFileSync } = require('child_process');

/** Which pool a model name draws from. */
const Family = {
  GEMINI: 'gemini',
  CLAUDE_GPT: 'claude-gpt',
};

function familyOf(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('gemini')) return Family.GEMINI;
  if (m.includes('claude') || m.includes('gpt')) return Family.CLAUDE_GPT;
  return null;
}

const WINDOW_NAMES = {
  weekly: /weekly/i,
  fiveHour: /five\s*hour/i,
};

/**
 * Parses the `/quota` table.
 *
 * The output is tab-or-space separated and its wording has changed before, so
 * matching is by recognisable parts — a family, a window word, a percentage,
 * an ISO instant — rather than by column position.
 */
function parseQuota(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    // A window can report `disabled` instead of a percentage: the pool is off
    // for this account, not merely unreported. Skipping the row would let the
    // other window speak for the whole family, so it is read as no headroom.
    const percent = line.match(/(\d+(?:\.\d+)?)\s*%/);
    const disabled = !percent && /\bdisabled\b/i.test(line);
    if (!percent && !disabled) continue;

    const reset = line.match(/\d{4}-\d{2}-\d{2}T[\d:]+(?:\.\d+)?Z/);
    const family = /gemini/i.test(line)
      ? Family.GEMINI
      : /claude|gpt/i.test(line)
        ? Family.CLAUDE_GPT
        : null;
    if (!family) continue;

    let window = null;
    for (const [name, re] of Object.entries(WINDOW_NAMES)) {
      if (re.test(line)) window = name;
    }
    if (!window) continue;

    rows.push({
      family,
      window,
      remainingPercent: disabled ? 0 : Number(percent[1]),
      disabled,
      resetsAt: reset ? reset[0] : null,
    });
  }

  if (rows.length === 0) {
    return { available: false, reason: 'Không nhận ra bảng /quota trong đầu ra', rows: [] };
  }
  return { available: true, rows, observedAt: new Date().toISOString() };
}

/**
 * Runs `/quota` for an account.
 *
 * `--new-project` matters: without it the CLI may answer from a previous
 * conversation instead of expanding the slash command, and the reply then
 * reads as a plausible essay about the word "quota" rather than the table.
 * That failure is silent, so it is worth avoiding rather than detecting.
 *
 * The argument must also reach the CLI intact. Under MSYS2 (Git Bash, and any
 * tool that shells through it) a lone `/quota` is rewritten to a Windows path
 * before the process starts, so `agy` receives `C:/Program Files/Git/quota` and
 * answers with an essay about a missing directory. It looks like a refusal or a
 * permission problem and is neither. execFileSync passes argv directly and is
 * therefore safe; a shell in between is not, and needs MSYS_NO_PATHCONV=1.
 */
function readQuota(options) {
  const opts = options || {};
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120000;

  const command = opts.command || 'agy';
  const args = opts.args || [
    '--new-project',
    '--print',
    '/quota',
    '--output-format',
    'text',
    '--print-timeout',
    '90s',
  ];

  try {
    const out = execFileSync(command, args, {
      cwd: opts.cwd || process.cwd(),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseQuota(out);
  } catch (e) {
    const combined = String((e.stdout || '') + (e.stderr || '') || e.message || '');
    // An eligibility check reaches out to Google for a profile picture, and a
    // timeout there is a network problem rather than an exhausted account.
    if (/eligibility check failed/i.test(combined)) {
      return { available: false, reason: 'Eligibility check thất bại (mạng), chưa đọc được quota', rows: [] };
    }
    const parsed = parseQuota(combined);
    if (parsed.available) return parsed;
    return { available: false, reason: combined.slice(0, 200), rows: [] };
  }
}

/**
 * Headroom for one model on this account, as a fraction of its pool.
 *
 * The tightest window wins for the same reason it does everywhere else: a
 * weekly budget with room is worthless while the five-hour window is spent.
 */
function headroomFor(quota, model) {
  if (!quota || !quota.available) {
    return { known: false, reason: (quota && quota.reason) || 'chưa đọc được quota' };
  }
  const family = familyOf(model);
  if (!family) return { known: false, reason: 'không rõ model thuộc nhóm nào' };

  const rows = quota.rows.filter((r) => r.family === family);
  if (rows.length === 0) return { known: false, reason: 'không có dòng quota cho nhóm ' + family };

  let tightest = rows[0];
  for (const r of rows) {
    if (r.remainingPercent < tightest.remainingPercent) tightest = r;
  }

  return {
    known: true,
    family,
    remainingPercent: tightest.remainingPercent,
    window: tightest.window,
    resetsAt: tightest.resetsAt,
    windows: rows,
  };
}

/**
 * Translates headroom into the status vocabulary the scheduler already uses,
 * so a percentage from one provider and a token count from another are ranked
 * on the same scale.
 */
function statusFrom(headroom, options) {
  const opts = options || {};
  const tight = Number(opts.tightBelow) > 0 ? Number(opts.tightBelow) : 20;
  const exhausted = Number(opts.exhaustedBelow) >= 0 ? Number(opts.exhaustedBelow) : 2;

  if (!headroom || !headroom.known) return 'unknown';
  if (headroom.remainingPercent <= exhausted) return 'exhausted';
  if (headroom.remainingPercent < tight) return 'tight';
  return 'open';
}

module.exports = { Family, familyOf, parseQuota, readQuota, headroomFor, statusFrom };
