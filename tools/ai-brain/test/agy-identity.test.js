/**
 * Ship Dễ — Antigravity Identity Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readIdentity, sameAccount, checkFreshness } = require('../agy-identity');

/** Writes a google_accounts.json into a throwaway home and returns its path. */
function homeWith(contents) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-identity-'));
  const dir = path.join(home, '.gemini');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'google_accounts.json'), contents);
  return home;
}

describe('Reading the active account', () => {
  test('reads the real file shape', () => {
    // Exactly what the host had on 2026-09-14, addresses altered.
    const home = homeWith(
      JSON.stringify({
        active: 'someone@gmail.com',
        old: ['older@gmail.com', 'student@st.example.edu.vn'],
      })
    );
    const id = readIdentity({ home });
    assert.equal(id.known, true);
    assert.equal(id.email, 'someone@gmail.com');
    assert.equal(id.previous.length, 2);
  });

  test('a missing file is unknown, not a default account', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-identity-'));
    const id = readIdentity({ home });
    assert.equal(id.known, false);
    assert.match(id.reason, /google_accounts/);
  });

  test('malformed or empty content is refused', () => {
    for (const body of ['not json', '{}', '{"active":"   "}']) {
      assert.equal(readIdentity({ home: homeWith(body) }).known, false);
    }
  });
});

describe('Comparing accounts', () => {
  const a = { known: true, email: 'someone@gmail.com' };

  test('the same address matches regardless of case', () => {
    assert.equal(sameAccount(a, { known: true, email: 'SomeOne@Gmail.com' }), true);
  });

  test('a different address does not match', () => {
    assert.equal(sameAccount(a, { known: true, email: 'other@gmail.com' }), false);
  });

  test('two unknowns are not a match', () => {
    // Failing to name the account twice says nothing about it being the same
    // account, and calling it a match is how a reading survives the very
    // switch it exists to catch.
    assert.equal(sameAccount({ known: false }, { known: false }), false);
  });
});

describe('Deciding whether a stored reading still applies', () => {
  const now = { known: true, email: 'someone@gmail.com' };

  test('same account, the reading is used', () => {
    const stored = { account: { known: true, email: 'someone@gmail.com' } };
    assert.equal(checkFreshness(stored, now).usable, true);
  });

  test('after a switch the reading is dropped and re-read', () => {
    const stored = { account: { known: true, email: 'other@gmail.com' } };
    const verdict = checkFreshness(stored, now);
    assert.equal(verdict.usable, false);
    assert.equal(verdict.action, 'reread');
    assert.equal(verdict.switched, true);
    assert.match(verdict.reason, /other@gmail\.com/);
  });

  test('a reading with no account attached is never reused', () => {
    assert.equal(checkFreshness({ rows: [] }, now).action, 'reread');
  });

  test('an unidentifiable present account forces a re-read', () => {
    const stored = { account: { known: true, email: 'someone@gmail.com' } };
    assert.equal(checkFreshness(stored, { known: false }).action, 'reread');
  });
});
