'use strict';

/**
 * Ship Dễ — Claude Code's own subscription limits, read from the CLI
 *
 * `claude -p "/usage"` reports how much of each window has been spent:
 *
 *   Current session: 79% used · resets Sep 14, 4:20pm (Asia/Bangkok)
 *   Current week (all models): 31% used · resets Sep 17, 4am (Asia/Bangkok)
 *
 * Note the polarity, because it is the opposite of the other provider this
 * pipeline reads. Antigravity reports what is LEFT; this reports what is SPENT.
 * 79% means nearly gone here and nearly full there. Everything downstream
 * speaks in headroom, so the conversion happens once, here, rather than at
 * every call site where one inverted subtraction would turn an exhausted
 * account into a healthy one.
 *
 * The transcripts on disk do not carry this. They record what was said, not
 * what the subscription has left, so there is no cheaper source to read: the
 * CLI has to be asked. It is asked on the same timer as everything else.
 *
 * The figures are also explicitly local. The CLI says they cover sessions on
 * this machine and exclude other devices and claude.ai, so the true spend is
 * this or higher — which makes an optimistic reading the dangerous direction
 * and is why nothing here rounds in the account's favour.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/** The windows the CLI reports, in the vocabulary used elsewhere. */
const Window = {
  SESSION: 'session',
  WEEKLY: 'weekly',
};

/**
 * Recognises one reported window.
 *
 * Matched on the parts that carry meaning — a window name, a percentage, the
 * word "used" — rather than on column position, since the wording has room to
 * drift and a line that no longer matches must be skipped, not guessed at.
 */
const LINE = /^\s*current\s+(session|week)([^:]*):\s*(\d+(?:\.\d+)?)\s*%\s*used(.*)$/i;

function parseUsage(text) {
  const rows = [];

  for (const line of String(text || '').split('\n')) {
    const m = line.match(LINE);
    if (!m) continue;

    const usedPercent = Number(m[3]);
    if (!Number.isFinite(usedPercent)) continue;

    const resets = m[4].match(/resets?\s+(.+?)\s*$/i);
    const scope = String(m[2] || '').replace(/[()]/g, '').trim();

    rows.push({
      window: /week/i.test(m[1]) ? Window.WEEKLY : Window.SESSION,
      // Kept as reported. "all models" and "Opus" are separate budgets on some
      // plans, and collapsing them would hide one behind the other.
      scope: scope || 'all',
      usedPercent,
      // The single conversion point from spent to left.
      remainingPercent: Math.max(0, 100 - usedPercent),
      // Left as the CLI printed it: a local-format date in the user's own
      // timezone. Parsing it into an instant would invent a precision the
      // string does not carry, and it is shown, not computed on.
      resetsAtText: resets ? resets[1].trim() : null,
    });
  }

  if (rows.length === 0) {
    return { available: false, reason: 'Không nhận ra dòng hạn mức nào trong đầu ra', rows: [] };
  }
  return { available: true, rows, observedAt: new Date().toISOString() };
}

/**
 * Finds something this process can actually launch.
 *
 * On Windows `claude` on PATH is a .cmd shim. Node refuses to spawn a .cmd
 * without a shell, and the refusal is EINVAL — which reads like a malformed
 * call, while the ENOENT from trying the bare name reads like Claude Code not
 * being installed. Neither is true, and both are easy to record as a permanent
 * fact about the machine.
 *
 * The shim wraps a real executable, so that is what gets launched. A shell
 * would also work and is deliberately not used: it would reintroduce the
 * argument rewriting that turns `/usage` into a directory path.
 */
function resolveCommand() {
  if (process.env.SHIPDE_CLAUDE_BIN) return process.env.SHIPDE_CLAUDE_BIN;
  if (process.platform !== 'win32') return 'claude';

  const appData = process.env.APPDATA;
  if (appData) {
    const exe = path.join(
      appData,
      'npm',
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe'
    );
    if (fs.existsSync(exe)) return exe;
  }
  // Nothing better found. The bare name will fail, and its reason is reported
  // rather than being turned into a claim about what is installed.
  return 'claude';
}

/**
 * Runs `/usage`.
 *
 * As with the other CLI, the argument must arrive intact: under MSYS2 a bare
 * `/usage` is rewritten into a Windows path before the process starts, and the
 * reply then discusses a missing directory. execFileSync passes argv straight
 * through, so this path is safe; a shell in between is not.
 */
function readUsage(options) {
  const opts = options || {};
  const command = opts.command || resolveCommand();
  const args = opts.args || ['-p', '/usage', '--output-format', 'text'];

  try {
    const out = execFileSync(command, args, {
      cwd: opts.cwd || process.cwd(),
      encoding: 'utf8',
      timeout: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 180000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseUsage(out);
  } catch (e) {
    const combined = String((e.stdout || '') + (e.stderr || '') || e.message || '');
    const parsed = parseUsage(combined);
    if (parsed.available) return parsed;
    return { available: false, reason: combined.slice(0, 200), rows: [] };
  }
}

/**
 * Headroom across the reported windows.
 *
 * The tightest wins, for the reason it always does: a weekly budget with room
 * is worthless while the session window is spent. It is also the common case
 * here — the session window refills every few hours and is usually the binding
 * one, so reporting the weekly figure alone would read as healthy right up to
 * the moment work stops.
 */
function headroom(usage) {
  if (!usage || !usage.available) {
    return { known: false, reason: (usage && usage.reason) || 'chưa đọc được hạn mức' };
  }

  let tightest = usage.rows[0];
  for (const r of usage.rows) {
    if (r.remainingPercent < tightest.remainingPercent) tightest = r;
  }

  return {
    known: true,
    remainingPercent: tightest.remainingPercent,
    usedPercent: tightest.usedPercent,
    window: tightest.window,
    scope: tightest.scope,
    resetsAtText: tightest.resetsAtText,
    windows: usage.rows,
  };
}

/** The same status vocabulary every other source is ranked in. */
function statusFrom(view, options) {
  const opts = options || {};
  const tight = Number(opts.tightBelow) > 0 ? Number(opts.tightBelow) : 20;
  const exhausted = Number(opts.exhaustedBelow) >= 0 ? Number(opts.exhaustedBelow) : 2;

  if (!view || !view.known) return 'unknown';
  if (view.remainingPercent <= exhausted) return 'exhausted';
  if (view.remainingPercent < tight) return 'tight';
  return 'open';
}

/**
 * Which Anthropic account Claude Code is signed in as.
 *
 * Read from `~/.claude.json`, which records the signed-in profile and holds no
 * credentials — the credentials live in a separate file that is deliberately
 * never opened here. As everywhere else, a reading that cannot name its account
 * is marked unknown rather than assumed to belong to whoever was signed in last.
 */
function readAccount(options) {
  const opts = options || {};
  const file = opts.file || path.join(opts.home || os.homedir(), '.claude.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const email = parsed && parsed.oauthAccount && parsed.oauthAccount.emailAddress;
    if (typeof email === 'string' && email.trim()) {
      return { known: true, email: email.trim(), source: 'declared' };
    }
    return { known: false, reason: '.claude.json không ghi email đăng nhập' };
  } catch (e) {
    return {
      known: false,
      reason: e.code === 'ENOENT' ? 'không có ~/.claude.json' : 'không đọc được ~/.claude.json: ' + e.code,
    };
  }
}

/**
 * Presents a reading in the shape the shared quota cache and panel already use.
 *
 * The row shape carries `remainingPercent` because that is what every consumer
 * ranks on. `usedPercent` is carried alongside rather than dropped: it is the
 * number this provider actually reported, and keeping it means a figure on
 * screen can be checked against the CLI without anyone having to remember
 * which direction the subtraction went.
 *
 * The pool is named for the subscription rather than for a model family. These
 * windows are not per-model — every model on the plan draws from the same
 * session and weekly budget — so borrowing the family vocabulary would imply a
 * split that does not exist.
 */
function asQuotaReading(usage, account) {
  if (!usage || !usage.available) {
    return { available: false, reason: usage ? usage.reason : 'chưa đọc được hạn mức', rows: [], account };
  }
  return {
    available: true,
    observedAt: usage.observedAt,
    account,
    rows: usage.rows.map((r) => ({
      family: 'claude-code',
      window: r.window,
      remainingPercent: r.remainingPercent,
      usedPercent: r.usedPercent,
      scope: r.scope,
      disabled: false,
      resetsAt: null,
      resetsAtText: r.resetsAtText,
    })),
  };
}

module.exports = {
  Window,
  resolveCommand,
  parseUsage,
  readUsage,
  headroom,
  statusFrom,
  readAccount,
  asQuotaReading,
};
