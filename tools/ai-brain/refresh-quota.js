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

const { readQuota, budgetFingerprint } = require('./agy-quota');
const claudeUsage = require('./claude-usage');
const { readIdentity } = require('./agy-identity');
const { saveReading } = require('./quota-store');

/**
 * How each provider reports what it has left, and how it names its account.
 *
 * Two providers, two vocabularies. Antigravity states what remains; Claude Code
 * states what has been spent. Both are normalised to remaining before they
 * reach this file, so nothing downstream has to remember which is which.
 *
 * A provider absent from this table is skipped with a reason. Probing it and
 * recording the empty result would turn "we never asked" into "it reported
 * nothing", which are not the same claim.
 */
const READERS = {
  antigravity: {
    read: (account, opts) => {
      const quota = (opts.readQuota || readQuota)({
        command: account.quotaCommand || opts.command,
        args: account.quotaArgs || opts.args,
        cwd: account.cwd || opts.cwd,
        home: opts.home,
        account: identityFor(account, opts),
      });

      // The reading identifies itself by the budget it describes. The declared
      // address is kept as a label but is not the identity: on this CLI the
      // files that carry an address do not track its login, so a check built on
      // them answers confidently about the wrong thing. A reset instant that
      // moved is proof a different budget answered; an address that did not
      // move is proof of nothing.
      const signature = budgetFingerprint(quota);
      if (signature) {
        return Object.assign({}, quota, {
          account: { known: true, email: signature, source: 'fingerprint' },
          // Only an operator-written name. Falling back to whatever the
          // previous identity held would print a credential fingerprint as if
          // it were a name someone chose.
          label: account.email || null,
        });
      }
      return quota;
    },
  },
  'claude-code': {
    read: (account, opts) => {
      const identity = account.email
        ? { known: true, email: account.email, source: 'declared' }
        : claudeUsage.readAccount({ home: opts.home });
      const usage = (opts.readUsage || claudeUsage.readUsage)({
        command: account.quotaCommand || opts.claudeCommand,
        args: account.quotaArgs,
        cwd: account.cwd || opts.cwd,
      });
      return claudeUsage.asQuotaReading(usage, identity);
    },
  },
  /**
   * OpenAI-compatible gateways (9Router, etc).
   *
   * There is no percentage-remaining concept: the provider is pay-per-call,
   * so the only question a quota refresh can answer is "is the gateway alive
   * and does it list any models?"  The reader hits /v1/models synchronously
   * and reports a single row with window 'on-demand'.
   *
   * The identity is always the account's own label — there is no host login
   * to stamp, and the gateway's credential lives inside the router, not here.
   */
  oc: {
    read: (account, opts) => {
      const identity = account.email
        ? { known: true, email: account.email, source: 'declared' }
        : { known: true, email: account.id, source: 'account-id' };
      const baseUrl = (account.launch && account.launch.baseUrl) || '';
      const url = String(baseUrl).replace(/\/+$/, '') + '/models';
      try {
        const out = (opts.execSync || execFileSync)(
          'curl',
          ['-sS', '--max-time', '10', url],
          { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        const parsed = JSON.parse(out);
        const modelCount =
          parsed && Array.isArray(parsed.data) ? parsed.data.length : 0;
        return {
          available: true,
          rows: [
            {
              family: 'gateway',
              window: 'on-demand',
              remainingPercent: 100,
              disabled: false,
              modelCount,
            },
          ],
          account: identity,
          observedAt: new Date().toISOString(),
        };
      } catch (e) {
        return {
          available: false,
          reason: 'gateway unreachable: ' + String(e.message || e).slice(0, 120),
          rows: [],
          account: identity,
          observedAt: new Date().toISOString(),
        };
      }
    },
  },
};

const SUPPORTED_PROVIDERS = new Set(Object.keys(READERS));

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
      const out = (opts.runIdentity || execFileSync)(
        account.identityCommand,
        account.identityArgs || [],
        {
          encoding: 'utf8',
          timeout:
            Number(account.identityTimeoutMs) > 0 ? Number(account.identityTimeoutMs) : 120000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      const value = String(out || '')
        .trim()
        .split('\n')
        .pop()
        .trim();
      if (value) return { known: true, email: value, source: 'fingerprint' };
      return { known: false, reason: 'lệnh nhận diện không in ra gì' };
    } catch (e) {
      return {
        known: false,
        reason: 'lệnh nhận diện hỏng: ' + String(e.message || e.code).slice(0, 120),
      };
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
    return {
      accountId: account.id,
      skipped: true,
      reason: 'nhà cung cấp "' + account.provider + '" chưa có cách đọc hạn mức',
    };
  }

  // The provider is stamped alongside the account, because "who is signed in
  // now" is a different question for each one. Without it a Claude Code address
  // gets compared against the Antigravity login and every reading is thrown
  // away for a mismatch that was never meaningful.
  const quota = Object.assign(
    { provider: account.provider },
    READERS[account.provider].read(account, opts)
  );

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
