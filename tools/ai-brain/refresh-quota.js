'use strict';

/**
 * Ship Dễ — refreshing the vendor-reported quota cache
 *
 * Asking `agy` for its quota costs a CLI round trip measured in tens of
 * seconds, so it happens here, on a schedule or on demand, rather than on the
 * dashboard's refresh path. Everything downstream reads the cache.
 *
 * Only accounts that can answer are asked. An account whose quota is read
 * through a different mechanism, or none at all, is skipped with a reason
 * rather than probed hopefully and recorded as a failure — an empty result
 * from a question that could not have been answered is not evidence.
 */

const { execFileSync } = require('child_process');

const { readQuota } = require('./agy-quota');
const { readIdentity } = require('./agy-identity');
const { saveReading } = require('./quota-store');

/** Providers whose quota `agy --print "/quota"` can actually report. */
const SUPPORTED_PROVIDERS = new Set(['antigravity']);

/**
 * Whose account this reading will belong to.
 *
 * The host identity is only the right answer for an account that runs as the
 * host user. An account reached through another entry point — the Docker
 * worker, which signs in inside its own volume — has its own login, and
 * stamping the host's address on its reading would attach a real number to the
 * wrong account. That is the precise failure this stamping exists to prevent,
 * so it is refused rather than guessed: such an account must declare its
 * address, or its readings are marked unknown and never reused across a switch.
 */
function identityFor(account, options) {
  const opts = options || {};
  if (account.email) return { known: true, email: account.email, source: 'declared' };
  if (account.identityHome) return readIdentity({ home: account.identityHome });

  // An account that can name its own login does so. The container answers with
  // a fingerprint rather than an address, which is enough: the cache only ever
  // asks whether this is the same login as last time.
  if (account.identityCommand) {
    try {
      const out = (opts.runIdentity || execFileSync)(account.identityCommand, account.identityArgs || [], {
        encoding: 'utf8',
        timeout: Number(account.identityTimeoutMs) > 0 ? Number(account.identityTimeoutMs) : 120000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const value = String(out || '').trim().split('\n').pop().trim();
      if (value) return { known: true, email: value, source: 'fingerprint' };
      return { known: false, reason: 'lệnh nhận diện không in ra gì' };
    } catch (e) {
      return { known: false, reason: 'lệnh nhận diện hỏng: ' + String(e.message || e.code).slice(0, 120) };
    }
  }

  if (account.quotaCommand) {
    return {
      known: false,
      reason: 'account chạy qua ' + account.quotaCommand + ', không dùng chung đăng nhập với host',
    };
  }
  return opts.identity || readIdentity({ home: opts.home });
}

function refreshAccount(account, options) {
  const opts = options || {};

  if (!SUPPORTED_PROVIDERS.has(account.provider)) {
    return { accountId: account.id, skipped: true, reason: 'nhà cung cấp không báo quota qua agy' };
  }

  const identity = identityFor(account, opts);
  const quota = (opts.readQuota || readQuota)({
    command: account.quotaCommand || opts.command,
    args: account.quotaArgs || opts.args,
    cwd: account.cwd || opts.cwd,
    home: opts.home,
    account: identity,
  });

  // Failures are cached too. "The last attempt failed at 09:12 because the
  // eligibility check timed out" is a fact the dashboard should show; dropping
  // it leaves the previous, healthier reading on screen looking current.
  saveReading(account.id, quota, opts);

  return {
    accountId: account.id,
    ok: quota.available === true,
    reason: quota.available ? null : quota.reason,
    account: quota.account && quota.account.known ? quota.account.email : null,
    rows: quota.available ? quota.rows.length : 0,
  };
}

function refreshAll(accounts, options) {
  return (accounts || []).map((a) => refreshAccount(a, options));
}

module.exports = { SUPPORTED_PROVIDERS, identityFor, refreshAccount, refreshAll };
