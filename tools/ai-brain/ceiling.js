'use strict';

/**
 * Ship Dễ — Learned Quota Ceilings
 *
 * No provider on this machine reports its plan ceiling. `/usage` covers the
 * Claude subscription and nothing else; `agy` has no quota command at all; and
 * 9router only aggregates what it proxied, not what its upstreams allow. So a
 * declared limit is either an operator's guess or absent, and an absent one
 * leaves the scheduler flying blind until it hits a wall.
 *
 * A refusal is the one honest measurement available. When a provider says no,
 * the consumption at that instant bounds the ceiling from above; the largest
 * request that succeeded bounds it from below. Enough of both and the range
 * closes on the real number, per account and per window, without anyone
 * looking it up.
 *
 * Two properties this deliberately keeps:
 *
 *   It is conservative. The working ceiling is the LOWEST refusal ever seen,
 *   not an average. A ceiling guessed too high gets discovered by failing a
 *   task; guessed too low only forfeits some headroom.
 *
 *   It never outranks a declared limit. If the operator states a number, that
 *   number is used and the observations stay as a cross-check — a learned
 *   value silently overriding a stated one is how a system starts disagreeing
 *   with its own configuration.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME_DIR = path.join(os.homedir(), '.shipde');
const LEDGER_FILE = path.join(HOME_DIR, 'quota.observations.json');

/** Windows a ceiling can be learned for. */
const WINDOWS = ['requestsPerMinute', 'requestsPerDay', 'tokensPerDay', 'tokensPerMonth'];

/** What a provider said. Only REFUSED bounds the ceiling from above. */
const Outcome = {
  ACCEPTED: 'accepted',
  REFUSED: 'refused',
};

/**
 * Reasons that mean "out of quota" rather than "something else broke".
 * A 500 or a socket error says nothing about the ceiling, and treating it as a
 * refusal would teach the system a limit that does not exist.
 *
 * Routing states (such as 503 or "no available channel") indicate model naming
 * or upstream supply issues, not quota exhaustion.
 */
const QUOTA_SIGNALS = [
  // Status codes are matched in their status context, not as bare numbers.
  // A loose /402/ also matches any message that happens to contain the digits
  // — a request id, a duration, a token count — and one false positive pins
  // the learned ceiling permanently, which is the exact failure this module
  // just removed for 503. Verified: "completed in 402 ms" used to count as a
  // quota refusal.
  /(?:status|code|error|http)[^0-9]{0,12}429(?![0-9])/i,
  /(?:status|code|error|http)[^0-9]{0,12}402(?![0-9])/i,
  /(?:^|[\s])429(?=[\s]*[:-])/,
  /(?:^|[\s])402(?=[\s]*[:-])/,
  // The canonical raw status text matched none of the numeric patterns above,
  // which all require a keyword or a trailing separator. 429 survived through
  // the too-many-requests pattern; 402 had no such backstop, so a client
  // surfacing err.statusText would have had a genuine spending refusal
  // silently dropped.
  /payment required/i,
  /rate.?limit/i,
  /quota/i,
  /too many requests/i,
  /insufficient.*(credit|balance)/i,
];

function isQuotaRefusal(text) {
  const s = String(text || '');
  return QUOTA_SIGNALS.some((re) => re.test(s));
}

function readLedger(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file || LEDGER_FILE, 'utf8'));
    return Array.isArray(raw.observations) ? raw.observations : [];
  } catch (e) {
    return [];
  }
}

function writeLedger(observations, file) {
  const target = file || LEDGER_FILE;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), observations }, null, 2),
    { mode: 0o600 }
  );
}

/**
 * Records one outcome.
 *
 * `consumed` is what the account had already spent in each window at the
 * moment of the call — not the size of this call. That is what bounds the
 * ceiling.
 */
function record(observation, options) {
  const opts = options || {};
  const file = opts.file;
  if (!observation || !observation.accountId) throw new Error('accountId là bắt buộc');
  if (observation.outcome !== Outcome.ACCEPTED && observation.outcome !== Outcome.REFUSED) {
    throw new Error('outcome phải là accepted hoặc refused');
  }

  const entry = {
    accountId: observation.accountId,
    model: observation.model || null,
    outcome: observation.outcome,
    consumed: observation.consumed || {},
    reason: observation.reason || null,
    at: observation.at || new Date().toISOString(),
  };

  const ledger = readLedger(file);
  ledger.push(entry);

  // Keep the ledger bounded. Old observations describe a plan that may since
  // have changed, and the newest refusals are the ones that matter.
  const max = Number(opts.maxEntries) > 0 ? Number(opts.maxEntries) : 2000;
  const trimmed = ledger.length > max ? ledger.slice(ledger.length - max) : ledger;
  writeLedger(trimmed, file);
  return entry;
}

/**
 * Records a provider failure, deciding first whether it was about quota.
 * Returns null when the error says nothing about the ceiling.
 */
function recordFailure(accountId, model, errorText, consumed, options) {
  if (!isQuotaRefusal(errorText)) return null;
  return record(
    {
      accountId,
      model,
      outcome: Outcome.REFUSED,
      consumed: consumed || {},
      reason: String(errorText || '').slice(0, 200),
    },
    options
  );
}

/**
 * Infers the ceiling for one account and window.
 *
 *   upper  — the lowest consumption ever refused. The limit is at most this.
 *   lower  — the highest consumption ever accepted. The limit is at least this.
 *
 * A `confident` range is one where the two are close enough that treating the
 * upper bound as the ceiling costs little. Until then the estimate is usable
 * but reported as provisional, because acting on a wide range as if it were
 * precise is how a guess turns into a fact nobody rechecks.
 */
function inferWindow(observations, accountId, window, options) {
  const opts = options || {};
  const rows = observations.filter(
    (o) => o.accountId === accountId && Number.isFinite(Number((o.consumed || {})[window]))
  );
  if (rows.length === 0) return null;

  let upper = null;
  let lower = null;
  let refusals = 0;
  let lastRefusalAt = null;

  for (const o of rows) {
    const value = Number(o.consumed[window]);
    if (o.outcome === Outcome.REFUSED) {
      refusals += 1;
      if (upper === null || value < upper) upper = value;
      if (!lastRefusalAt || o.at > lastRefusalAt) lastRefusalAt = o.at;
    } else if (lower === null || value > lower) {
      lower = value;
    }
  }

  if (upper === null) {
    // Only successes so far. That is a floor, never a ceiling: the limit is
    // above everything seen, and how far above is unknown.
    return {
      window,
      ceiling: null,
      lower,
      upper: null,
      refusals: 0,
      confident: false,
      note: 'chưa từng bị từ chối; chỉ biết trần cao hơn ' + lower,
    };
  }

  const spread = lower === null ? null : (upper - lower) / Math.max(upper, 1);
  const tolerance = Number(opts.confidentWithin) > 0 ? Number(opts.confidentWithin) : 0.15;

  return {
    window,
    ceiling: upper,
    lower,
    upper,
    refusals,
    lastRefusalAt,
    confident: spread !== null && spread <= tolerance && refusals >= 2,
    note:
      spread === null
        ? 'mới có lần từ chối, chưa có lần thành công để chặn dưới'
        : 'khoảng ' + (lower || 0) + '–' + upper + ' (' + Math.round(spread * 100) + '% rộng)',
  };
}

/** Every window this account has enough observations to say something about. */
function inferLimits(accountId, options) {
  const opts = options || {};
  const observations = opts.observations || readLedger(opts.file);
  const out = {};
  for (const window of WINDOWS) {
    const inferred = inferWindow(observations, accountId, window, opts);
    if (inferred) out[window] = inferred;
  }
  return out;
}

/**
 * Merges declared and learned limits for the scheduler.
 *
 * A declared limit always wins. A learned one fills a gap and is tagged so the
 * dashboard can show which numbers came from a person and which from a wall
 * the system walked into.
 */
function effectiveLimits(account, options) {
  const declared = (account && account.limits) || {};
  const learned = inferLimits(account.id, options);

  const limits = Object.assign({}, declared);
  const sources = {};

  for (const window of WINDOWS) {
    if (Number(declared[window]) > 0) {
      sources[window] = 'declared';
      continue;
    }
    const guess = learned[window];
    if (guess && Number(guess.ceiling) > 0) {
      limits[window] = guess.ceiling;
      sources[window] = guess.confident ? 'learned' : 'learned-provisional';
    }
  }

  return { limits, sources, learned };
}

/**
 * How long to cool an account after a refusal.
 *
 * A per-minute limit clears in a minute; a daily one does not, and retrying
 * against it burns attempts for nothing. The window that was refused decides
 * the wait, and an unknown window gets the short one so a transient refusal
 * does not park an account for a day.
 */
function cooldownFor(window, now) {
  const base = now || Date.now();
  const minutes = {
    requestsPerMinute: 2,
    requestsPerDay: 60,
    tokensPerDay: 60,
    tokensPerMonth: 240,
  };
  const wait = minutes[window] || 5;
  return new Date(base + wait * 60000).toISOString();
}

module.exports = {
  Outcome,
  WINDOWS,
  LEDGER_FILE,
  isQuotaRefusal,
  record,
  recordFailure,
  readLedger,
  inferWindow,
  inferLimits,
  effectiveLimits,
  cooldownFor,
};
