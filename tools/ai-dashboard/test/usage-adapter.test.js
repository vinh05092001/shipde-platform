/**
 * Ship Dễ — Token Usage & Quota Adapter Test Suite
 * TASK-AI-15: AI15-R01, AI15-R05, AI15-R06
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  collectUsageState,
  collectRouterUsage,
  collectClaudeUsage,
} = require('../usage-adapter');
const { redactObject } = require('../redaction');

/** Builds a throwaway ~/.claude/projects tree with hand-written transcripts. */
function makeTranscriptDir(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-usage-'));
  const projectDir = path.join(dir, 'proj-a');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'session-1.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8'
  );
  return dir;
}

function turn(id, model, usage, timestamp) {
  return {
    type: 'assistant',
    timestamp: timestamp || '2026-09-13T10:00:00.000Z',
    message: { id, model, usage },
  };
}

const U = (input, output, cacheWrite, cacheRead) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheWrite,
  cache_read_input_tokens: cacheRead,
});

describe('Usage Adapter (TASK-AI-15 quota truthfulness)', () => {
  describe('Claude Code transcript ledger', () => {
    test('sums token counters across turns', () => {
      const dir = makeTranscriptDir([
        turn('m1', 'claude-sonnet-5', U(100, 50, 10, 1000)),
        turn('m2', 'claude-sonnet-5', U(200, 60, 20, 2000)),
      ]);
      const result = collectClaudeUsage(dir);
      assert.equal(result.available, true);
      assert.equal(result.totals.messages, 2);
      assert.equal(result.totals.input, 300);
      assert.equal(result.totals.output, 110);
      assert.equal(result.totals.cacheWrite, 30);
      assert.equal(result.totals.cacheRead, 3000);
    });

    test('counts a repeated message id once, so resumed sessions do not inflate totals', () => {
      const dir = makeTranscriptDir([
        turn('dup', 'claude-sonnet-5', U(100, 10, 0, 0)),
        turn('dup', 'claude-sonnet-5', U(100, 10, 0, 0)),
        turn('other', 'claude-sonnet-5', U(5, 1, 0, 0)),
      ]);
      const result = collectClaudeUsage(dir);
      assert.equal(result.totals.messages, 2, 'duplicate id collapsed');
      assert.equal(result.totals.input, 105);
    });

    test('skips synthetic turns, which were never billed', () => {
      const dir = makeTranscriptDir([
        turn('s1', '<synthetic>', U(0, 0, 0, 0)),
        turn('r1', 'claude-opus-5', U(10, 5, 0, 0)),
      ]);
      const result = collectClaudeUsage(dir);
      assert.equal(result.totals.messages, 1);
      assert.equal(result.models.length, 1);
      assert.equal(result.models[0].model, 'claude-opus-5');
    });

    test('ignores malformed lines rather than failing the whole read', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-usage-bad-'));
      fs.mkdirSync(path.join(dir, 'p'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'p', 's.jsonl'),
        'not json\n' +
          JSON.stringify({ message: { id: 'ok', model: 'claude-opus-5', usage: U(7, 3, 0, 0) } }) +
          '\n{"broken":\n',
        'utf8'
      );
      const result = collectClaudeUsage(dir);
      assert.equal(result.available, true);
      assert.equal(result.totals.input, 7);
    });

    test('an unpriced model is counted in tokens but excluded from cost', () => {
      const dir = makeTranscriptDir([
        turn('x', 'some-unknown-model', U(1000, 1000, 0, 0)),
      ]);
      const result = collectClaudeUsage(dir);
      assert.equal(result.totals.input, 1000, 'tokens still counted');
      assert.equal(result.totals.cost, 0, 'no invented price');
      assert.equal(result.unpricedMessages, 1);
      assert.equal(result.models[0].priced, false, 'flagged so the UI can say so');
    });

    test('cache hit rate is the cached share of prompt tokens', () => {
      const dir = makeTranscriptDir([turn('c', 'claude-sonnet-5', U(100, 0, 0, 900))]);
      const result = collectClaudeUsage(dir);
      assert.equal(result.cacheHitRate, 0.9);
    });

    test('cost is priced per model, not a flat rate', () => {
      const opus = collectClaudeUsage(makeTranscriptDir([turn('o', 'claude-opus-5', U(1e6, 0, 0, 0))]));
      const sonnet = collectClaudeUsage(
        makeTranscriptDir([turn('s', 'claude-sonnet-5', U(1e6, 0, 0, 0))])
      );
      assert.equal(opus.totals.cost, 15, 'opus input is $15/M');
      assert.equal(sonnet.totals.cost, 3, 'sonnet input is $3/M');
    });

    test('groups by day for trend reporting', () => {
      const dir = makeTranscriptDir([
        turn('d1', 'claude-sonnet-5', U(10, 0, 0, 0), '2026-09-12T01:00:00.000Z'),
        turn('d2', 'claude-sonnet-5', U(20, 0, 0, 0), '2026-09-13T01:00:00.000Z'),
        turn('d3', 'claude-sonnet-5', U(30, 0, 0, 0), '2026-09-13T02:00:00.000Z'),
      ]);
      const result = collectClaudeUsage(dir);
      assert.equal(result.days.length, 2);
      assert.equal(result.days[1].day, '2026-09-13');
      assert.equal(result.days[1].input, 50);
    });

    test('reports unavailable with a reason when the directory is missing', () => {
      const result = collectClaudeUsage(path.join(os.tmpdir(), 'shipde-does-not-exist-' + Date.now()));
      assert.equal(result.available, false);
      assert.ok(result.reason.length > 0, 'a reason is given rather than a zeroed total');
      assert.equal(result.totals, undefined, 'no fabricated zero totals');
    });

    test('redacts the home directory out of the unavailable reason', () => {
      const missing = path.join(os.homedir(), 'definitely-not-here-' + Date.now());
      const result = collectClaudeUsage(missing);
      assert.equal(result.available, false);
      assert.ok(!/[A-Za-z]:[\\/]Users[\\/][^\\/]+/.test(result.reason), 'no raw user path leaks');
    });
  });

  describe('9router ledger', () => {
    test('reports unavailable with a reason when the database is absent', () => {
      const result = collectRouterUsage(path.join(os.tmpdir(), 'no-such-' + Date.now() + '.sqlite'));
      assert.equal(result.available, false);
      assert.ok(result.reason.includes('not found'));
      assert.equal(result.totals, undefined, 'no fabricated totals');
    });

    test('does not leak the home path in its reason', () => {
      const result = collectRouterUsage(path.join(os.homedir(), 'nope-' + Date.now() + '.sqlite'));
      assert.ok(!/[A-Za-z]:[\\/]Users[\\/][^\\/]+/.test(result.reason));
    });
  });

  describe('Adapter contract', () => {
    test('unavailable when neither ledger can be read, and says why', async () => {
      const result = await collectUsageState({
        routerDbPath: path.join(os.tmpdir(), 'x-' + Date.now() + '.sqlite'),
        claudeProjectsDir: path.join(os.tmpdir(), 'y-' + Date.now()),
      });
      assert.equal(result.health.status, 'unavailable');
      assert.match(result.health.impact, /withheld rather than estimated/);
      assert.equal(result.data.combined, null, 'no combined figures invented');
    });

    test('degraded, not live, when only one ledger is readable', async () => {
      const dir = makeTranscriptDir([turn('a', 'claude-opus-5', U(10, 10, 0, 0))]);
      const result = await collectUsageState({
        routerDbPath: path.join(os.tmpdir(), 'missing-' + Date.now() + '.sqlite'),
        claudeProjectsDir: dir,
      });
      assert.equal(result.health.status, 'degraded');
      assert.ok(result.health.impact.includes('Only one of two'));
      assert.equal(result.data.claude.available, true);
      assert.equal(result.data.router.available, false);
    });

    test('never sums the two ledgers into one total', async () => {
      const dir = makeTranscriptDir([turn('a', 'claude-opus-5', U(10, 10, 0, 0))]);
      const result = await collectUsageState({
        routerDbPath: path.join(os.tmpdir(), 'missing-' + Date.now() + '.sqlite'),
        claudeProjectsDir: dir,
      });
      const c = result.data.combined;
      assert.ok('routerTokens' in c && 'claudeTokens' in c, 'reported side by side');
      assert.ok(!('totalTokens' in c), 'billed spend and list-price estimate are not added');
      assert.equal(c.routerTokens, null, 'an unreadable ledger reads null, not zero');
    });

    test('states plainly that no quota ceiling is known', async () => {
      const dir = makeTranscriptDir([turn('a', 'claude-opus-5', U(1, 1, 0, 0))]);
      const result = await collectUsageState({ claudeProjectsDir: dir });
      assert.equal(result.data.combined.quotaCeilingKnown, false);
      assert.ok(
        !('quotaPercent' in result.data.combined),
        'no percentage is derived without a ceiling'
      );
    });
  });

  describe('Redaction interaction (AI15-R05)', () => {
    test('token counts survive redaction while credentials do not', () => {
      const redacted = redactObject({
        tokens: 42085106,
        promptTokens: 123,
        completionTokens: 45,
        cacheReadTokens: 999,
        token: 'ghp_abcdefghijklmnopqrstuvwx',
        apiKey: 'sk-' + 'a'.repeat(30),
        authHeader: 'Bearer abcdefghijklmnopqrst',
      });
      assert.equal(redacted.tokens, 42085106, 'a count is not a credential');
      assert.equal(redacted.promptTokens, 123);
      assert.equal(redacted.cacheReadTokens, 999);
      assert.equal(redacted.token, '[REDACTED_CONFIDENTIAL]');
      assert.equal(redacted.apiKey, '[REDACTED_CONFIDENTIAL]');
      assert.equal(redacted.authHeader, '[REDACTED_CONFIDENTIAL]');
    });

    test('a string under a token-shaped key is still redacted', () => {
      const redacted = redactObject({ refreshToken: 'value-that-must-not-appear' });
      assert.equal(redacted.refreshToken, '[REDACTED_CONFIDENTIAL]');
    });

    test('a whole usage payload passes through redaction with counts intact', async () => {
      const dir = makeTranscriptDir([turn('a', 'claude-opus-5', U(111, 222, 333, 444))]);
      const state = await collectUsageState({ claudeProjectsDir: dir });
      const redacted = redactObject(state.data);
      assert.equal(redacted.claude.totals.input, 111);
      assert.equal(redacted.claude.totals.cacheRead, 444);
    });
  });
});
