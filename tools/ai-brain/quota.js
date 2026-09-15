'use strict';

/**
 * Ship Dễ — Quota Headroom
 *
 * No provider publishes a plan ceiling to this machine, so headroom cannot be
 * measured; it can only be computed from a limit the operator declares and
 * consumption that is measured. Both halves matter:
 *
 *   - A declared limit with no measured spend is a guess.
 *   - Measured spend with no declared limit tells you what you used, never
 *     what is left.
 *
 * An account with no declared limit is therefore reported as `unknown`, not as
 * infinite. Treating unknown as infinite is how a pool drains into one account
 * and every task fails at once.
 *
 * Windows are evaluated independently and the tightest one wins, because a
 * daily budget with room is worthless while the per-minute limit is exhausted.
 */

const WINDOW_MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

/** A limit the operator declared. Every field is optional. */
const LIMIT_FIELDS = [
  'requestsPerMinute',
  'requestsPerDay',
  'tokensPerDay',
  'tokensPerMonth',
  'costPerDay',
  'costPerMonth',
];

function windowStart(now, window) {
  return now - WINDOW_MS[window];
}

/**
 * Consumption inside a window, from measured events.
 * `events` are {at, tokens, cost} — whatever the usage adapters produced.
 */
function consumedIn(events, window, now) {
  const from = windowStart(now, window);
  let requests = 0;
  let tokens = 0;
  let cost = 0;
  for (const e of events || []) {
    const at = typeof e.at === 'number' ? e.at : Date.parse(e.at);
    if (!Number.isFinite(at) || at < from || at > now) continue;
    requests += 1;
    tokens += e.tokens || 0;
    cost += e.cost || 0;
  }
  return { requests, tokens, cost };
}

function ratio(used, limit) {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return used / limit;
}

/**
 * Headroom for one account.
 *
 * `status` is the decision the scheduler acts on:
 *   open      — room to spare
 *   tight     — past the warn threshold, usable but should be de-prioritised
 *   exhausted — a declared limit is reached; do not dispatch
 *   cooling   — the provider refused recently (429/quota); wait it out
 *   unknown   — nothing declared; usable, but never treated as unlimited
 */
function accountHeadroom(account, events, options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  const warnAt = typeof opts.warnAt === 'number' ? opts.warnAt : 0.8;
  const limits = (account && account.limits) || {};

  if (account && account.cooldownUntil && Date.parse(account.cooldownUntil) > now) {
    return {
      accountId: account.id,
      status: 'cooling',
      worstRatio: 1,
      until: account.cooldownUntil,
      reason: 'Nhà cung cấp vừa từ chối; đang chờ hết thời gian nguội',
      windows: {},
    };
  }

  const declared = LIMIT_FIELDS.filter((f) => Number(limits[f]) > 0);
  const windows = {};
  let worst = null;
  let worstLabel = null;

  const perMinute = consumedIn(events, 'minute', now);
  const perDay = consumedIn(events, 'day', now);
  const perMonth = consumedIn(events, 'month', now);

  const checks = [
    ['requestsPerMinute', perMinute.requests, limits.requestsPerMinute],
    ['requestsPerDay', perDay.requests, limits.requestsPerDay],
    ['tokensPerDay', perDay.tokens, limits.tokensPerDay],
    ['tokensPerMonth', perMonth.tokens, limits.tokensPerMonth],
    ['costPerDay', perDay.cost, limits.costPerDay],
    ['costPerMonth', perMonth.cost, limits.costPerMonth],
  ];

  for (const [label, used, limit] of checks) {
    const r = ratio(used, limit);
    if (r === null) continue;
    windows[label] = { used, limit, ratio: r };
    if (worst === null || r > worst) {
      worst = r;
      worstLabel = label;
    }
  }

  if (declared.length === 0) {
    return {
      accountId: account.id,
      status: 'unknown',
      worstRatio: null,
      reason: 'Chưa khai hạn mức; dùng được nhưng không coi là vô hạn',
      windows,
      // Reported so the caller can still spread load across unknown accounts
      // rather than hammering whichever one sorts first.
      recentRequests: perDay.requests,
    };
  }

  let status = 'open';
  if (worst >= 1) status = 'exhausted';
  else if (worst >= warnAt) status = 'tight';

  return {
    accountId: account.id,
    status,
    worstRatio: worst,
    worstWindow: worstLabel,
    reason:
      status === 'exhausted'
        ? 'Đã chạm hạn mức ' + worstLabel
        : status === 'tight'
          ? 'Sắp chạm hạn mức ' + worstLabel + ' (' + Math.round(worst * 100) + '%)'
          : 'Còn dư',
    windows,
    recentRequests: perDay.requests,
  };
}

/** Headroom for every account, keyed by id. */
function poolHeadroom(accounts, eventsByAccount, options) {
  const out = {};
  for (const account of accounts || []) {
    out[account.id] = accountHeadroom(account, (eventsByAccount || {})[account.id] || [], options);
  }
  return out;
}

const DISPATCHABLE = new Set(['open', 'unknown', 'tight']);

function isDispatchable(headroom) {
  return Boolean(headroom) && DISPATCHABLE.has(headroom.status);
}

/**
 * Ranks dispatchable accounts by how much room they have.
 *
 * Accounts with room come before accounts that are tight, and unknown sits
 * between the two: usable, but not preferred over an account whose remaining
 * budget is actually known. Within `unknown`, the least recently loaded goes
 * first so an undeclared pool still spreads instead of stacking.
 */
function rankByHeadroom(accountIds, headrooms) {
  const rank = { open: 0, unknown: 1, tight: 2 };
  return accountIds
    .filter((id) => isDispatchable(headrooms[id]))
    .sort((a, b) => {
      const ha = headrooms[a];
      const hb = headrooms[b];
      if (rank[ha.status] !== rank[hb.status]) return rank[ha.status] - rank[hb.status];
      if (ha.status === 'unknown') return (ha.recentRequests || 0) - (hb.recentRequests || 0);
      return (ha.worstRatio || 0) - (hb.worstRatio || 0);
    });
}

module.exports = {
  WINDOW_MS,
  LIMIT_FIELDS,
  consumedIn,
  accountHeadroom,
  poolHeadroom,
  isDispatchable,
  rankByHeadroom,
};
