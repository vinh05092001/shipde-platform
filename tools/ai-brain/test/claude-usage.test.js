/**
 * Ship Dễ — Claude Code Usage Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { parseUsage, headroom, statusFrom } = require('../claude-usage');

/** Exactly what `claude -p "/usage"` printed on 2026-09-14. */
const REAL_OUTPUT = [
  'You are currently using your subscription to power your Claude Code usage',
  '',
  'Current session: 79% used · resets Sep 14, 4:20pm (Asia/Bangkok)',
  'Current week (all models): 31% used · resets Sep 17, 4am (Asia/Bangkok)',
  '',
  "What's contributing to your limits usage?",
  'Last 24h · 1078 requests · 8 sessions',
  '  92% of your usage was at >150k context',
].join('\n');

describe('Reading the usage report', () => {
  test('parses the real output', () => {
    const u = parseUsage(REAL_OUTPUT);
    assert.equal(u.available, true);
    assert.equal(u.rows.length, 2);
  });

  test('spent is converted to left exactly once', () => {
    // This report says what is SPENT; the other provider says what is LEFT.
    // One inverted subtraction turns an exhausted account into a healthy one.
    const session = parseUsage(REAL_OUTPUT).rows.find((r) => r.window === 'session');
    assert.equal(session.usedPercent, 79);
    assert.equal(session.remainingPercent, 21);
  });

  test('the reset time is kept as printed', () => {
    const session = parseUsage(REAL_OUTPUT).rows.find((r) => r.window === 'session');
    assert.match(session.resetsAtText, /Sep 14, 4:20pm/);
  });

  test('the window scope is kept rather than collapsed', () => {
    // Some plans report "all models" and "Opus" as separate budgets; merging
    // them hides one behind the other.
    const week = parseUsage(REAL_OUTPUT).rows.find((r) => r.window === 'weekly');
    assert.equal(week.scope, 'all models');
  });

  test('the contributing-usage percentages are not mistaken for limits', () => {
    // "92% of your usage was at >150k context" is a percentage on a line with
    // no window name, and reading it as a budget would report a false figure.
    const rows = parseUsage(REAL_OUTPUT).rows;
    assert.ok(!rows.some((r) => r.usedPercent === 92));
  });

  test('output with no limit lines reports a reason rather than zero', () => {
    for (const text of ['', 'command not found', 'Last 24h · 1078 requests']) {
      const u = parseUsage(text);
      assert.equal(u.available, false);
      assert.ok(u.reason.length > 0);
    }
  });

  test('a row with no reset time still parses', () => {
    const row = parseUsage('Current session: 5% used').rows[0];
    assert.equal(row.remainingPercent, 95);
    assert.equal(row.resetsAtText, null);
  });
});

describe('Headroom across the windows', () => {
  const u = parseUsage(REAL_OUTPUT);

  test('the tightest window wins', () => {
    // 79% of the session spent against 31% of the week: the session binds, and
    // reporting the weekly figure alone would read healthy until work stops.
    const h = headroom(u);
    assert.equal(h.remainingPercent, 21);
    assert.equal(h.window, 'session');
  });

  test('both windows stay visible', () => {
    assert.equal(headroom(u).windows.length, 2);
  });

  test('an unread report carries its reason forward', () => {
    const h = headroom({ available: false, reason: 'claude không chạy' });
    assert.equal(h.known, false);
    assert.match(h.reason, /không chạy/);
  });
});

describe('Mapping onto the shared status vocabulary', () => {
  test('the real reading today is open but not comfortable', () => {
    assert.equal(statusFrom(headroom(parseUsage(REAL_OUTPUT))), 'open');
  });

  test('a nearly spent window is tight', () => {
    assert.equal(statusFrom(headroom(parseUsage('Current session: 85% used'))), 'tight');
  });

  test('a spent window is exhausted', () => {
    assert.equal(statusFrom(headroom(parseUsage('Current session: 99% used'))), 'exhausted');
    assert.equal(statusFrom(headroom(parseUsage('Current session: 100% used'))), 'exhausted');
  });

  test('unknown stays unknown rather than becoming open', () => {
    assert.equal(statusFrom({ known: false }), 'unknown');
    assert.equal(statusFrom(null), 'unknown');
  });
});
