/**
 * Ship Dễ — Quota Cache Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadStore, saveReading, freshness, identityToCompare, usableReadings } = require('../quota-store');

const ME = { known: true, email: 'someone@gmail.com' };

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-quota-'));
  return path.join(dir, 'agy-quota.json');
}

function reading(overrides) {
  return Object.assign(
    {
      available: true,
      rows: [{ family: 'gemini', window: 'weekly', remainingPercent: 40 }],
      account: { known: true, email: 'someone@gmail.com' },
      cachedAt: new Date().toISOString(),
    },
    overrides
  );
}

describe('Persisting readings', () => {
  test('a saved reading comes back', () => {
    const p = tmpStore();
    saveReading('acc-a', reading(), { path: p });
    assert.equal(loadStore({ path: p }).accounts['acc-a'].rows.length, 1);
  });

  test('saving one account leaves the others alone', () => {
    const p = tmpStore();
    saveReading('acc-a', reading(), { path: p });
    saveReading('acc-b', reading(), { path: p });
    assert.deepEqual(Object.keys(loadStore({ path: p }).accounts).sort(), ['acc-a', 'acc-b']);
  });

  test('a missing or corrupt file is an empty cache, not an error', () => {
    assert.deepEqual(loadStore({ path: tmpStore() }).accounts, {});
    const p = tmpStore();
    fs.writeFileSync(p, 'not json at all');
    assert.deepEqual(loadStore({ path: p }).accounts, {});
  });
});

describe('Deciding whether a cached reading still applies', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');

  test('a recent reading from the same account is used', () => {
    const r = reading({ cachedAt: '2026-09-14T11:50:00Z' });
    assert.equal(freshness(r, ME, { now }).usable, true);
  });

  test('an old reading expires', () => {
    const r = reading({ cachedAt: '2026-09-14T10:00:00Z' });
    const v = freshness(r, ME, { now });
    assert.equal(v.usable, false);
    assert.match(v.reason, /quá hạn/);
  });

  test('a reading from a different account is refused however recent', () => {
    // Taken one minute ago and completely inapplicable. Age cannot catch this.
    const r = reading({
      cachedAt: '2026-09-14T11:59:00Z',
      account: { known: true, email: 'other@gmail.com' },
    });
    const v = freshness(r, ME, { now });
    assert.equal(v.usable, false);
    assert.match(v.reason, /account đã đổi/);
  });

  test('a reading with no timestamp is refused', () => {
    assert.equal(freshness(reading({ cachedAt: null, observedAt: null }), ME, { now }).usable, false);
  });

  test('no reading at all says so plainly', () => {
    assert.match(freshness(null, ME, { now }).reason, /chưa có số liệu/);
  });
});

describe('Collecting what may be used now', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');

  test('usable and unusable readings are separated, not blended', () => {
    const p = tmpStore();
    saveReading('fresh', reading(), { path: p, now: Date.parse('2026-09-14T11:55:00Z') });
    saveReading('old', reading(), { path: p, now: Date.parse('2026-09-14T09:00:00Z') });
    saveReading('switched', reading({ account: { known: true, email: 'other@gmail.com' } }), {
      path: p,
      now: Date.parse('2026-09-14T11:59:00Z'),
    });

    const { reported, problems } = usableReadings(ME, { path: p, now });
    assert.deepEqual(Object.keys(reported), ['fresh']);
    assert.deepEqual(Object.keys(problems).sort(), ['old', 'switched']);
    // The dashboard needs to say why a figure is missing, not leave a blank.
    assert.match(problems.switched.reason, /account đã đổi/);
  });

  test('an empty cache yields no figures and no problems', () => {
    const { reported, problems } = usableReadings(ME, { path: tmpStore(), now });
    assert.deepEqual(reported, {});
    assert.deepEqual(problems, {});
  });
});

describe('Which identity a reading is compared against', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');

  test('a host reading is compared against the host address', () => {
    const r = reading();
    assert.equal(identityToCompare(r, ME).email, 'someone@gmail.com');
  });

  test('a declared address is still compared against the host login', () => {
    // Self-comparing it would make the check pass forever, and the switch it
    // exists to catch is exactly the operator signing in as somebody else.
    const r = reading({ account: { known: true, email: 'declared@gmail.com', source: 'declared' } });
    assert.equal(identityToCompare(r, ME).email, 'someone@gmail.com');
  });

  test('a self-identifying reading is compared against itself', () => {
    // The container reports a fingerprint of its own credential. Comparing it
    // to the host's email is not a strict check but a meaningless one: the two
    // can never be equal, so every such reading would be thrown away.
    const r = reading({ account: { known: true, email: 'fingerprint:abc', source: 'fingerprint' } });
    assert.equal(identityToCompare(r, ME).email, 'fingerprint:abc');
  });

  test('the container reading survives a host account switch', () => {
    const p = tmpStore();
    saveReading('docker', reading({ account: { known: true, email: 'fingerprint:abc', source: 'fingerprint' } }), {
      path: p,
      now: Date.parse('2026-09-14T11:55:00Z'),
    });
    const { reported } = usableReadings({ known: true, email: 'a-different-host@gmail.com' }, { path: p, now });
    assert.deepEqual(Object.keys(reported), ['docker']);
  });

  test('but it still expires with age', () => {
    const p = tmpStore();
    saveReading('docker', reading({ account: { known: true, email: 'fingerprint:abc', source: 'fingerprint' } }), {
      path: p,
      now: Date.parse('2026-09-14T08:00:00Z'),
    });
    const { problems } = usableReadings(ME, { path: p, now });
    assert.match(problems.docker.reason, /quá hạn/);
  });
});

describe('Comparing across providers', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  const AGY = { known: true, email: 'gmail-login@gmail.com' };

  const claudeReading = (email) =>
    reading({
      provider: 'claude-code',
      account: { known: true, email, source: 'declared' },
    });

  test("a provider's reading is compared against that provider's login", () => {
    // Comparing a Claude Code address against the Antigravity login is the same
    // mistake as comparing it against a fingerprint: two real identities that
    // can never be equal, so every reading would be thrown away.
    const resolvers = { 'claude-code': () => ({ known: true, email: 'me@anthropic-account.com' }) };
    const p = tmpStore();
    saveReading('claude', claudeReading('me@anthropic-account.com'), {
      path: p,
      now: Date.parse('2026-09-14T11:55:00Z'),
    });
    const { reported } = usableReadings(AGY, { path: p, now, identityResolvers: resolvers });
    assert.deepEqual(Object.keys(reported), ['claude']);
  });

  test('a switch within that provider is still caught', () => {
    const resolvers = { 'claude-code': () => ({ known: true, email: 'someone-new@example.com' }) };
    const p = tmpStore();
    saveReading('claude', claudeReading('me@anthropic-account.com'), {
      path: p,
      now: Date.parse('2026-09-14T11:55:00Z'),
    });
    const { problems } = usableReadings(AGY, { path: p, now, identityResolvers: resolvers });
    assert.match(problems.claude.reason, /account đã đổi/);
  });

  test('a reading with no provider falls back to the host login', () => {
    const r = reading();
    assert.equal(identityToCompare(r, AGY, {}).email, 'gmail-login@gmail.com');
  });
});


describe('A failed reading is not cached like a measurement', () => {
  // A success is cached because it is expensive and stays roughly true. A
  // failure measured nothing, so the only thing it can buy is a cooldown.
  const identity = { known: true, email: 'a@example.com', source: 'host' };
  const failed = {
    available: false,
    reason: 'Eligibility check thất bại (mạng), chưa đọc được quota',
    rows: [],
    account: { known: true, email: 'a@example.com', source: 'host' },
    cachedAt: '2026-09-14T09:00:00.000Z',
  };
  const ok = Object.assign({}, failed, { available: true, reason: undefined, rows: [{ family: 'gemini' }] });

  test('a fresh failure is reused, so a broken probe is not hammered', () => {
    const f = freshness(failed, identity, { now: Date.parse('2026-09-14T09:00:30.000Z') });
    assert.strictEqual(f.usable, true);
    assert.strictEqual(f.failed, true);
  });

  test('a failure expires in a minute, not in half an hour', () => {
    const now = Date.parse('2026-09-14T09:02:00.000Z');
    const f = freshness(failed, identity, { now });
    assert.strictEqual(f.usable, false);
    assert.strictEqual(f.action, 'reread');
    assert.match(f.reason, /thất bại/);

    // The same age leaves a successful reading perfectly usable, which is the
    // asymmetry the whole change exists for.
    assert.strictEqual(freshness(ok, identity, { now }).usable, true);
  });

  test('a caller asking for a longer window cannot extend a failure', () => {
    const f = freshness(failed, identity, {
      now: Date.parse('2026-09-14T09:20:00.000Z'),
      maxAgeMs: 60 * 60 * 1000,
    });
    assert.strictEqual(f.usable, false);
  });

  test('a blip does not outlive the retry that would have fixed it', () => {
    // 2026-09-14: two agy accounts cached a network failure one second before
    // the claude-code account read cleanly, and the panels stayed blank.
    const f = freshness(failed, identity, { now: Date.parse('2026-09-14T09:01:01.000Z') });
    assert.strictEqual(f.usable, false);
  });
});
