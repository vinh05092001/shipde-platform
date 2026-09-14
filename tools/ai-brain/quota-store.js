'use strict';

/**
 * Ship Dễ — where vendor-reported quota readings are kept between runs
 *
 * Reading `/quota` costs a CLI round trip of ten seconds or more, so the
 * dashboard cannot take one on every refresh. The readings are cached, which
 * makes the interesting question not "what did it say" but "is what it said
 * still true".
 *
 * Two things can make a cached reading untrue, and they fail differently:
 *
 * Age. A percentage drains as work runs. An old reading is wrong by a
 * predictable amount in a predictable direction — always too optimistic — so
 * it expires.
 *
 * Identity. The operator switches Google accounts. The cached number is then
 * not stale but simply about someone else, and no amount of recency makes it
 * apply. Age cannot catch this: a reading taken one minute before the switch
 * looks perfectly fresh.
 *
 * So freshness is checked on both, and the identity check is the one that
 * needs saying out loud, because nothing about that failure looks like a
 * failure.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const { checkFreshness } = require('./agy-identity');

/** Readings older than this are refused. A quota percentage drains steadily. */
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * A reading that failed is kept for far less time, and for a different reason.
 *
 * A successful reading is cached because it is expensive to take and stays
 * roughly true for a while. A failure is neither: it measured nothing, so it
 * has no truth to go stale, and the only reason to remember it at all is to
 * avoid hammering a probe that just refused.
 *
 * Holding one for the full window is actively harmful. A one-second network
 * blip during the eligibility check blanked every Antigravity panel for half
 * an hour while an immediate retry would have succeeded — observed on
 * 2026-09-14, when two agy accounts cached "Eligibility check thất bại (mạng)"
 * one second before the claude-code account read cleanly. A short cooldown
 * stops the hammering without turning a blip into an outage.
 */
const DEFAULT_FAILURE_MAX_AGE_MS = 60 * 1000;

function storePath(options) {
  const opts = options || {};
  return opts.path || path.join(opts.home || os.homedir(), '.shipde', 'agy-quota.json');
}

function loadStore(options) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(options), 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.accounts ? parsed : { accounts: {} };
  } catch (e) {
    // A missing or corrupt cache is an empty cache. It is never an error: the
    // pipeline ran without this file before it existed and must still run.
    return { accounts: {} };
  }
}

function saveReading(accountId, quota, options) {
  const file = storePath(options);
  const store = loadStore(options);
  store.accounts[accountId] = Object.assign({}, quota, {
    cachedAt: new Date((options || {}).now || Date.now()).toISOString(),
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
  return store;
}

/**
 * Whether one cached reading may still be used.
 *
 * `action` is `use`, or `reread` with a reason fit to show an operator. The
 * reason matters: "account đã đổi" and "quá hạn" call for the same next step
 * but mean very different things about the number that was on screen a moment
 * ago.
 */
function freshness(reading, currentIdentity, options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  const maxAge = Number(opts.maxAgeMs) > 0 ? Number(opts.maxAgeMs) : DEFAULT_MAX_AGE_MS;

  if (!reading) return { usable: false, action: 'reread', reason: 'chưa có số liệu' };

  const identity = checkFreshness(reading, currentIdentity);
  if (!identity.usable) return identity;

  const cachedAt = Date.parse(reading.cachedAt || reading.observedAt || '');
  if (!Number.isFinite(cachedAt)) {
    return { usable: false, action: 'reread', reason: 'bản ghi không có mốc thời gian' };
  }
  const ageMs = now - cachedAt;

  // A failed reading is on a much shorter leash than a successful one; see
  // DEFAULT_FAILURE_MAX_AGE_MS. Note this is decided by the reading itself,
  // not by the caller's maxAgeMs, so no caller can accidentally extend a
  // failure's life by asking for a longer window.
  if (reading.available === false) {
    const failureMaxAge =
      Number(opts.failureMaxAgeMs) > 0 ? Number(opts.failureMaxAgeMs) : DEFAULT_FAILURE_MAX_AGE_MS;
    if (ageMs > failureMaxAge) {
      return {
        usable: false,
        action: 'reread',
        reason: 'lần đọc trước thất bại, đã hết thời gian chờ (' + Math.round(ageMs / 1000) + ' giây)',
        ageMs,
      };
    }
    return {
      usable: true,
      action: 'use',
      ageMs,
      account: identity.account,
      failed: true,
    };
  }

  if (ageMs > maxAge) {
    return {
      usable: false,
      action: 'reread',
      reason: 'quá hạn (' + Math.round(ageMs / 60000) + ' phút)',
      ageMs,
    };
  }

  return { usable: true, action: 'use', ageMs, account: identity.account };
}

/**
 * The identity a stored reading must be compared against.
 *
 * Not every account lives in the same identity space. The host account is an
 * email address that can be re-read from disk for free, so a switch is caught
 * the moment it happens. An account that names itself some other way — the
 * container, which reports a fingerprint of its own credential — cannot be
 * re-checked without paying for the probe again, and comparing its fingerprint
 * against the host's email address is not a strict check, it is a meaningless
 * one: the two can never be equal, so every such reading is discarded.
 *
 * So a fingerprint is compared against itself, and age is what protects it.
 * That is a real limitation and worth stating plainly: a switch inside the
 * container is caught at the next refresh, not before it.
 *
 * An account whose address the operator declared is NOT self-compared. Its
 * address and the host's are the same kind of thing, so the comparison is
 * meaningful — and it is the one that catches the operator signing in as
 * somebody else, which is the whole point. Self-comparing it would make the
 * check pass forever.
 */
function identityToCompare(reading, hostIdentity, resolvers) {
  const source = reading && reading.account && reading.account.source;
  if (source === 'fingerprint') return reading.account;

  // Each provider signs in separately, so "the current login" is a different
  // question per provider. Comparing a Claude Code address against the
  // Antigravity login is the same mistake as comparing it against a
  // fingerprint: two real identities that can never be equal, so every reading
  // is discarded and the panel goes blank for a reason that is not true.
  const provider = reading && reading.provider;
  const resolve = (resolvers || PROVIDER_IDENTITY)[provider];
  if (resolve) return resolve();

  return hostIdentity;
}

/**
 * How to ask each provider who it is currently signed in as.
 *
 * Cheap, file-based lookups only. This runs on the dashboard's read path, so
 * anything that costs a CLI round trip belongs in the refresh instead.
 */
const PROVIDER_IDENTITY = {
  // Antigravity is deliberately absent. Its readings identify themselves by the
  // budget they describe, because no file on this machine tracks which account
  // its CLI is signed in as — see budgetFingerprint. Listing it here with a
  // file-based lookup would restore a check that cannot fail and cannot help.
  'claude-code': () => require('./claude-usage').readAccount({}),
};

/**
 * The readings that may be used right now, keyed by account id, in the shape
 * `offeringHeadroom` expects for its `reported` option.
 *
 * Unusable readings are dropped rather than passed along degraded, because a
 * reading that reaches the merge at all is treated as the vendor speaking.
 * They are reported separately so the dashboard can say why a figure is
 * missing instead of leaving a blank.
 */
function usableReadings(currentIdentity, options) {
  const store = loadStore(options);
  const reported = {};
  const problems = {};

  for (const [accountId, reading] of Object.entries(store.accounts || {})) {
    const verdict = freshness(reading, identityToCompare(reading, currentIdentity, (options || {}).identityResolvers), options);
    if (verdict.usable) reported[accountId] = reading;
    else problems[accountId] = verdict;
  }

  return { reported, problems };
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  DEFAULT_FAILURE_MAX_AGE_MS,
  storePath,
  loadStore,
  saveReading,
  freshness,
  identityToCompare,
  PROVIDER_IDENTITY,
  usableReadings,
};
