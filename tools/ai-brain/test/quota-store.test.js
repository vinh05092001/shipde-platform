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
