/**
 * Ship Dễ — Antigravity Quota Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const { Family, familyOf, parseQuota, budgetFingerprint, headroomFor, statusFrom } = require('../agy-quota');

/** Exactly what `agy --print "/quota"` printed on 2026-09-14. */
const REAL_OUTPUT = [
  'Gemini Models\tWeekly Limit Remaining\t40%\t2026-09-16T06:47:24Z',
  'Gemini Models\tFive Hour Limit Remaining\t98%\t2026-09-14T12:56:43Z',
  'Claude and GPT models\tWeekly Limit Remaining\t69%\t2026-09-18T04:39:38Z',
  'Claude and GPT models\tFive Hour Limit Remaining\t60%\t2026-09-14T12:25:57Z',
].join('\n');

describe('Reading the quota table', () => {
  test('parses the real output', () => {
    const q = parseQuota(REAL_OUTPUT);
    assert.equal(q.available, true);
    assert.equal(q.rows.length, 4);
  });

  test('keeps the two pools apart', () => {
    // One account, two budgets that drain separately. Averaging them would
    // hide an empty pool behind a full one.
    const q = parseQuota(REAL_OUTPUT);
    const gemini = q.rows.filter((r) => r.family === Family.GEMINI);
    const claude = q.rows.filter((r) => r.family === Family.CLAUDE_GPT);
    assert.equal(gemini.length, 2);
    assert.equal(claude.length, 2);
  });

  test('reads the percentage and the reset instant', () => {
    const row = parseQuota(REAL_OUTPUT).rows.find(
      (r) => r.family === Family.GEMINI && r.window === 'weekly'
    );
    assert.equal(row.remainingPercent, 40);
    assert.equal(row.resetsAt, '2026-09-16T06:47:24Z');
  });

  test('tolerates spacing and wording drift', () => {
    const loose = 'Gemini Models   Weekly Limit Remaining   7.5 %   2026-09-16T06:47:24Z';
    const row = parseQuota(loose).rows[0];
    assert.equal(row.remainingPercent, 7.5);
  });

  test('a disabled window is no headroom, not a missing row', () => {
    // Account B reports this for the Claude pool. Dropping the row would leave
    // the weekly row speaking for the family on its own.
    const q = parseQuota(
      [
        'Claude and GPT models\tWeekly Limit Remaining\t0%\t2026-09-16T04:12:24Z',
        'Claude and GPT models\tFive Hour Limit Remaining\tdisabled',
      ].join('\n')
    );
    assert.equal(q.rows.length, 2);
    const off = q.rows.find((r) => r.window === 'fiveHour');
    assert.equal(off.disabled, true);
    assert.equal(off.remainingPercent, 0);
    assert.equal(statusFrom(headroomFor(q, 'claude-opus-4-8')), 'exhausted');
  });

  test('a row missing its reset time still parses', () => {
    const row = parseQuota('Gemini Models  Weekly Limit Remaining  40%').rows[0];
    assert.equal(row.remainingPercent, 40);
    assert.equal(row.resetsAt, null);
  });

  test('prose about the word quota is not mistaken for a table', () => {
    // Without --new-project the CLI answers from a previous conversation, and
    // the reply reads as a plausible essay rather than the table. That failure
    // is silent, so it has to be refused here.
    const prose = [
      'If Git threw an "Out of disk space" or quota-related error, it is',
      'frequently caused by Windows 260-character path limits. Around 80% of',
      'cases resolve with core.longpaths true.',
    ].join('\n');
    assert.equal(parseQuota(prose).available, false);
  });

  test('empty or unrelated output reports a reason rather than zero', () => {
    for (const text of ['', 'command not found']) {
      const q = parseQuota(text);
      assert.equal(q.available, false);
      assert.ok(q.reason.length > 0);
    }
  });
});

describe('Which pool a model draws from', () => {
  test('classifies the real model names', () => {
    assert.equal(familyOf('gemini-3.8-flash-high'), Family.GEMINI);
    assert.equal(familyOf('gemini-3.1-pro-low'), Family.GEMINI);
    assert.equal(familyOf('claude-opus-4-6-thinking'), Family.CLAUDE_GPT);
    assert.equal(familyOf('claude-sonnet-4-6'), Family.CLAUDE_GPT);
    assert.equal(familyOf('gpt-oss-120b-medium'), Family.CLAUDE_GPT);
  });

  test('an unrecognised model is null rather than guessed into a pool', () => {
    assert.equal(familyOf('some-new-model'), null);
    assert.equal(familyOf(''), null);
  });
});

describe('Headroom for a model', () => {
  const q = parseQuota(REAL_OUTPUT);

  test('the tightest window wins', () => {
    // Gemini has 98% of five hours but only 40% of the week; the week binds.
    const h = headroomFor(q, 'gemini-3.8-flash-high');
    assert.equal(h.remainingPercent, 40);
    assert.equal(h.window, 'weekly');
  });

  test('the other pool is read independently', () => {
    const h = headroomFor(q, 'claude-opus-4-6-thinking');
    assert.equal(h.remainingPercent, 60);
    assert.equal(h.window, 'fiveHour');
  });

  test('both windows stay visible after the tightest is chosen', () => {
    assert.equal(headroomFor(q, 'gemini-3.8-flash-high').windows.length, 2);
  });

  test('an unknown model is refused rather than assigned a pool', () => {
    const h = headroomFor(q, 'mystery-model');
    assert.equal(h.known, false);
  });

  test('an unread quota carries its reason forward', () => {
    const h = headroomFor({ available: false, reason: 'Eligibility check thất bại' }, 'gemini-3.8-flash-high');
    assert.equal(h.known, false);
    assert.match(h.reason, /Eligibility/);
  });
});

describe('Mapping headroom onto the scheduler vocabulary', () => {
  const at = (p) => ({ known: true, remainingPercent: p });

  test('plenty left is open', () => {
    assert.equal(statusFrom(at(60)), 'open');
    assert.equal(statusFrom(at(40)), 'open');
  });

  test('nearly gone is tight', () => {
    assert.equal(statusFrom(at(15)), 'tight');
    assert.equal(statusFrom(at(3)), 'tight');
  });

  test('effectively gone is exhausted', () => {
    assert.equal(statusFrom(at(2)), 'exhausted');
    assert.equal(statusFrom(at(0)), 'exhausted');
  });

  test('unknown stays unknown rather than becoming open', () => {
    // Treating an unread quota as full is how a drained account keeps being
    // dispatched to.
    assert.equal(statusFrom({ known: false }), 'unknown');
    assert.equal(statusFrom(null), 'unknown');
  });

  test('thresholds are configurable', () => {
    assert.equal(statusFrom(at(25), { tightBelow: 50 }), 'tight');
  });
});

describe('Identifying which budget answered', () => {
  test('two readings of the same budget share a signature', () => {
    const a = parseQuota(REAL_OUTPUT);
    const b = parseQuota(REAL_OUTPUT.replace('40%', '38%'));
    // The percentages drain; the budget is the same one.
    assert.equal(budgetFingerprint(a), budgetFingerprint(b));
  });

  test('a different reset instant is a different budget', () => {
    // This is the case that exposed the problem: one machine's weekly reset
    // moved from Sep 16 to Sep 17 while every file-based identity said nothing
    // had changed.
    const a = parseQuota(REAL_OUTPUT);
    const b = parseQuota(REAL_OUTPUT.replace('2026-09-16T06:47:24Z', '2026-09-17T23:27:08Z'));
    assert.notEqual(budgetFingerprint(a), budgetFingerprint(b));
  });

  test('row order does not change the signature', () => {
    const rows = REAL_OUTPUT.split('\n');
    const shuffled = [rows[3], rows[0], rows[2], rows[1]].join('\n');
    assert.equal(budgetFingerprint(parseQuota(REAL_OUTPUT)), budgetFingerprint(parseQuota(shuffled)));
  });

  test('a reading with no reset instants has no signature', () => {
    // Returning an empty signature would make it match every other
    // unfingerprintable reading.
    assert.equal(budgetFingerprint(parseQuota('Gemini Models  Weekly Limit Remaining  40%')), null);
  });

  test('an unread quota has no signature', () => {
    assert.equal(budgetFingerprint({ available: false, rows: [] }), null);
    assert.equal(budgetFingerprint(null), null);
  });
});
