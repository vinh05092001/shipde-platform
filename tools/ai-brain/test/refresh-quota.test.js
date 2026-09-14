/**
 * Ship Dễ — Quota Refresh Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { identityFor, refreshAccount, refreshAll } = require('../refresh-quota');
const { loadStore } = require('../quota-store');

const ME = { known: true, email: 'someone@gmail.com' };

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-refresh-'));
  return path.join(dir, 'agy-quota.json');
}

const OK = {
  available: true,
  rows: [{ family: 'gemini', window: 'weekly', remainingPercent: 40, disabled: false }],
  account: ME,
  observedAt: '2026-09-14T12:00:00Z',
};

describe('Refreshing one account', () => {
  test('a successful read is cached', () => {
    const p = tmpStore();
    const r = refreshAccount(
      { id: 'acc-a', provider: 'antigravity' },
      { path: p, identity: ME, readQuota: () => OK }
    );
    assert.equal(r.ok, true);
    assert.equal(r.account, 'someone@gmail.com');
    assert.equal(loadStore({ path: p }).accounts['acc-a'].rows.length, 1);
  });

  test('a failed read is cached too, with its reason', () => {
    // Otherwise the previous healthier reading stays on screen looking current,
    // and the failure is invisible precisely when it matters.
    const p = tmpStore();
    const r = refreshAccount(
      { id: 'acc-a', provider: 'antigravity' },
      {
        path: p,
        identity: ME,
        readQuota: () => ({ available: false, reason: 'mạng lỗi', account: ME }),
      }
    );
    assert.equal(r.ok, false);
    assert.match(r.reason, /mạng lỗi/);
    assert.equal(loadStore({ path: p }).accounts['acc-a'].available, false);
  });

  test('the identity is passed to the reader, not re-derived per call', () => {
    let seen = null;
    refreshAccount(
      { id: 'acc-a', provider: 'antigravity' },
      { path: tmpStore(), identity: ME, readQuota: (o) => ((seen = o.account), OK) }
    );
    assert.equal(seen.email, 'someone@gmail.com');
  });

  test('per-account command and cwd reach the reader', () => {
    // The Docker worker runs the same CLI through a different entry point.
    let seen = null;
    refreshAccount(
      { id: 'acc-b', provider: 'antigravity', quotaCommand: 'docker', cwd: '/w' },
      { path: tmpStore(), identity: ME, readQuota: (o) => ((seen = o), OK) }
    );
    assert.equal(seen.command, 'docker');
    assert.equal(seen.cwd, '/w');
  });
});

describe('Skipping accounts that cannot answer', () => {
  test('a provider with no agy quota is skipped, not probed', () => {
    let called = false;
    const r = refreshAccount(
      { id: 'router', provider: '9router' },
      { path: tmpStore(), identity: ME, readQuota: () => ((called = true), OK) }
    );
    assert.equal(r.skipped, true);
    assert.equal(called, false);
  });

  test('a skipped account writes nothing to the cache', () => {
    // Recording "no data" for an account that was never asked would read as a
    // failed reading rather than an absent one.
    const p = tmpStore();
    refreshAccount(
      { id: 'router', provider: '9router' },
      { path: p, identity: ME, readQuota: () => OK }
    );
    assert.deepEqual(loadStore({ path: p }).accounts, {});
  });
});

describe('Refreshing every account', () => {
  test('each account is reported separately', () => {
    const p = tmpStore();
    const out = refreshAll(
      [
        { id: 'acc-a', provider: 'antigravity' },
        { id: 'router', provider: '9router' },
      ],
      { path: p, identity: ME, readQuota: () => OK }
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].ok, true);
    assert.equal(out[1].skipped, true);
  });
});

describe('Whose reading it is', () => {
  test('a declared address wins', () => {
    const id = identityFor({ id: 'a', email: 'declared@gmail.com' }, { identity: ME });
    assert.equal(id.email, 'declared@gmail.com');
  });

  test('an account reached through another entry point is not given the host address', () => {
    // The Docker worker signs in inside its own volume. Stamping the host
    // address on its reading attaches a real number to the wrong account,
    // which is the exact failure the stamping exists to prevent.
    const id = identityFor({ id: 'b', quotaCommand: 'docker' }, { identity: ME });
    assert.equal(id.known, false);
    assert.match(id.reason, /docker/);
  });

  test('a plain host account uses the host address', () => {
    assert.equal(identityFor({ id: 'a' }, { identity: ME }).email, 'someone@gmail.com');
  });
});

describe('An account that names its own login', () => {
  test('a fingerprint counts as an identity', () => {
    const id = identityFor(
      { id: 'b', identityCommand: 'probe' },
      { runIdentity: () => '  fingerprint:abc123  ' }
    );
    assert.equal(id.known, true);
    assert.equal(id.email, 'fingerprint:abc123');
    assert.equal(id.source, 'fingerprint');
  });

  test('two different logins do not match', () => {
    const { sameAccount } = require('../agy-identity');
    const a = identityFor(
      { id: 'b', identityCommand: 'p' },
      { runIdentity: () => 'fingerprint:aaa' }
    );
    const b = identityFor(
      { id: 'b', identityCommand: 'p' },
      { runIdentity: () => 'fingerprint:bbb' }
    );
    assert.equal(sameAccount(a, b), false);
  });

  test('a probe that fails leaves the identity unknown, not assumed', () => {
    const id = identityFor(
      { id: 'b', identityCommand: 'probe' },
      {
        runIdentity: () => {
          throw Object.assign(new Error('container chưa chạy'), { code: 'ENOENT' });
        },
      }
    );
    assert.equal(id.known, false);
    assert.match(id.reason, /lệnh nhận diện hỏng/);
  });

  test('a probe that prints nothing is unknown', () => {
    const id = identityFor({ id: 'b', identityCommand: 'p' }, { runIdentity: () => '   ' });
    assert.equal(id.known, false);
  });
});

describe('Reading the Claude Code subscription limits', () => {
  const USAGE = [
    'Current session: 81% used · resets Sep 14, 4:20pm (Asia/Bangkok)',
    'Current week (all models): 31% used · resets Sep 17, 4am (Asia/Bangkok)',
  ].join('\n');

  test('spent is stored as remaining', () => {
    // The other provider reports what is left. Storing 81 here would put an
    // almost-exhausted session on screen as an almost-full one.
    const p = tmpStore();
    refreshAccount(
      { id: 'claude', provider: 'claude-code', email: 'me@example.com' },
      { path: p, readUsage: () => require('../claude-usage').parseUsage(USAGE) }
    );
    const rows = loadStore({ path: p }).accounts.claude.rows;
    const session = rows.find((r) => r.window === 'session');
    assert.equal(session.remainingPercent, 19);
    assert.equal(session.usedPercent, 81);
  });

  test('the reading carries the signed-in address', () => {
    const p = tmpStore();
    refreshAccount(
      { id: 'claude', provider: 'claude-code', email: 'me@example.com' },
      { path: p, readUsage: () => require('../claude-usage').parseUsage(USAGE) }
    );
    assert.equal(loadStore({ path: p }).accounts.claude.account.email, 'me@example.com');
  });

  test('a failed read is recorded with its reason', () => {
    const p = tmpStore();
    const r = refreshAccount(
      { id: 'claude', provider: 'claude-code', email: 'me@example.com' },
      {
        path: p,
        readUsage: () => ({ available: false, reason: 'claude.exe không chạy', rows: [] }),
      }
    );
    assert.equal(r.ok, false);
    assert.match(r.reason, /không chạy/);
  });
});
