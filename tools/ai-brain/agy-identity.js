'use strict';

/**
 * Ship Dễ — which Google account `agy` is currently signed in as
 *
 * The operator switches accounts. That makes every cached quota reading
 * conditional on an identity: "40% of the weekly Gemini budget" is only true
 * for the account that answered, and after a switch the same number describes
 * someone else's budget entirely. A reading without an identity attached is
 * not a stale reading, it is a wrong one, because nothing about it looks old.
 *
 * The identity comes from `~/.gemini/google_accounts.json`, which records the
 * active address and the ones used before it:
 *
 *   { "active": "someone@gmail.com", "old": ["older@gmail.com", ...] }
 *
 * That file holds addresses and no secrets, which is the reason it is the
 * source used here. The OAuth token file sitting next to it would also
 * identify the account, but reading it means handling a live refresh token to
 * learn an email address, and a refresh token that leaks does not expire on
 * its own. Identity is cheap to get safely, so it is got safely.
 *
 * When the file is absent — the Docker worker has no copy of it — this reports
 * unknown rather than inventing a label. An unknown identity cannot be matched
 * against a later one, so its quota readings are never reused across a switch.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

/** Where the CLI keeps the account list, relative to a home directory. */
const ACCOUNTS_FILE = path.join('.gemini', 'google_accounts.json');

function readIdentity(options) {
  const opts = options || {};
  const home = opts.home || os.homedir();
  const file = opts.file || path.join(home, ACCOUNTS_FILE);

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return {
      known: false,
      reason:
        e.code === 'ENOENT'
          ? 'không có ' + ACCOUNTS_FILE + ' (không xác định được account)'
          : 'không đọc được ' + ACCOUNTS_FILE + ': ' + e.code,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { known: false, reason: ACCOUNTS_FILE + ' không phải JSON hợp lệ' };
  }

  const active = typeof parsed.active === 'string' ? parsed.active.trim() : '';
  if (!active) {
    return { known: false, reason: ACCOUNTS_FILE + ' không ghi account nào đang active' };
  }

  return {
    known: true,
    email: active,
    previous: Array.isArray(parsed.old) ? parsed.old.filter((x) => typeof x === 'string') : [],
    source: file,
  };
}

/**
 * Whether a stored reading still describes the account in front of us.
 *
 * Two unknowns are not a match. Being unable to name the account twice says
 * nothing about whether it is the same account, and treating that as a match
 * is how a reading survives exactly the switch it was supposed to detect.
 */
function sameAccount(a, b) {
  if (!a || !b || !a.known || !b.known) return false;
  return String(a.email).toLowerCase() === String(b.email).toLowerCase();
}

/**
 * Decides what to do with a stored quota reading given who is signed in now.
 *
 * `reread` means the number on file belongs to a different account and must be
 * replaced before anything is dispatched on it. That is deliberately stronger
 * than letting it age out: an expired reading merely stops being trusted,
 * while this one is actively describing the wrong budget.
 */
function checkFreshness(stored, current) {
  if (!stored || !stored.account) {
    return { usable: false, action: 'reread', reason: 'bản ghi quota không gắn account' };
  }
  if (!current || !current.known) {
    return { usable: false, action: 'reread', reason: 'không xác định được account hiện tại' };
  }
  if (!sameAccount(stored.account, current)) {
    return {
      usable: false,
      action: 'reread',
      reason:
        'account đã đổi: ' +
        (stored.account.known ? stored.account.email : 'không rõ') +
        ' → ' +
        current.email,
      switched: true,
    };
  }
  return { usable: true, action: 'use', account: current.email };
}

module.exports = { ACCOUNTS_FILE, readIdentity, sameAccount, checkFreshness };
