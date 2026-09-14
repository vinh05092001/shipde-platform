/**
 * Ship Dễ — Vendor Quota Panel Test Suite
 *
 * The panel is browser code, so it is exercised against DOM stubs. What is
 * being checked is not layout but whether a figure can reach the screen
 * misread: a disabled pool showing as a number, a fingerprint shown as if it
 * were an email address, or a refused reading leaving a blank that looks like
 * zero.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CLIENT = path.join(__dirname, '..', 'client.js');

/** Loads client.js with just enough DOM for the panel, and returns its output. */
function render(vendor) {
  const el = { innerHTML: '' };
  const ctx = vm.createContext({
    console,
    window: {},
    document: {
      getElementById: (id) => (id === 'capacityVendor' ? el : null),
      addEventListener() {},
      querySelectorAll: () => [],
    },
  });
  vm.runInContext(fs.readFileSync(CLIENT, 'utf8'), ctx);
  ctx.renderVendorQuota(vendor);
  return el.innerHTML;
}

const HOST = { known: true, email: 'someone@gmail.com' };

const DOCKER_ACCOUNT = {
  accountId: 'agy-docker-b',
  account: 'fingerprint:f39c06d3addd508f',
  observedAt: '2026-09-14T09:00:00Z',
  rows: [
    { family: 'gemini', window: 'weekly', remainingPercent: 33, disabled: false },
    { family: 'claude-gpt', window: 'weekly', remainingPercent: 0, disabled: false },
    { family: 'claude-gpt', window: 'fiveHour', remainingPercent: 0, disabled: true },
  ],
};

describe('Showing what the provider reported', () => {
  const html = render({ identity: HOST, accounts: [DOCKER_ACCOUNT], problems: [] });

  test('each pool and window is listed separately', () => {
    // One account, two budgets that drain independently. A single averaged
    // number would hide an empty pool behind a full one.
    assert.ok(html.includes('Gemini'));
    assert.ok(html.includes('Claude / GPT'));
    assert.ok(html.includes('33%'));
  });

  test('a switched-off window says so instead of showing 0%', () => {
    // `0%` reads as "nearly there"; the pool is off and will not refill.
    assert.ok(html.includes('đã tắt'));
  });

  test('a fingerprint is not presented as an email address', () => {
    assert.ok(html.includes('đăng nhập riêng trong container'));
    assert.ok(!html.includes('fingerprint:f39c06d3addd508f'));
  });

  test('the host login is named, so a switch is visible', () => {
    assert.ok(html.includes('someone@gmail.com'));
  });
});

describe('Showing why a figure is missing', () => {
  test('a refused reading appears as a refusal, not a gap', () => {
    // A blank row reads as zero. "We do not know" and "there is none left"
    // call for opposite responses.
    const html = render({
      identity: HOST,
      accounts: [],
      problems: [{ accountId: 'agy-native-a', reason: 'account đã đổi: a@b.com → c@d.com', switched: true }],
    });
    assert.ok(html.includes('agy-native-a'));
    assert.ok(html.includes('account đã đổi'));
    assert.ok(html.includes('cần chạy lại lệnh quota'));
  });

  test('an unidentifiable host login is flagged rather than omitted', () => {
    const html = render({
      identity: { known: false, reason: 'không có google_accounts.json' },
      accounts: [DOCKER_ACCOUNT],
      problems: [],
    });
    assert.ok(html.includes('không rõ account host'));
  });

  test('nothing to report renders nothing at all', () => {
    assert.equal(render({ identity: HOST, accounts: [], problems: [] }), '');
    assert.equal(render(null), '');
  });
});

describe('Not trusting the numbers it is handed', () => {
  test('a percentage outside 0-100 does not escape its bar', () => {
    const html = render({
      identity: HOST,
      accounts: [
        {
          accountId: 'a',
          account: 'someone@gmail.com',
          observedAt: '2026-09-14T09:00:00Z',
          rows: [{ family: 'gemini', window: 'weekly', remainingPercent: 420, disabled: false }],
        },
      ],
      problems: [],
    });
    assert.ok(html.includes('width:100%'));
  });

  test('an account id is escaped rather than interpolated as markup', () => {
    const html = render({
      identity: HOST,
      accounts: [{ accountId: '<img src=x>', account: null, observedAt: null, rows: [] }],
      problems: [],
    });
    assert.ok(!html.includes('<img src=x>'));
  });
});
