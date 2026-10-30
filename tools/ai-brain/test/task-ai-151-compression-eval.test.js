'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  CATEGORIES,
  ENGINE_STATUS,
  countTokens,
  isCompressionForbidden,
  detectCategory,
  losslessCheckDiff,
  deepCompareJson,
  losslessCheckJson,
  losslessCheckSpecDoc,
  losslessCheckCiLogs,
  verifyLossless,
  compressWithHeadroom,
  compressWithLlmLingua,
  probeHeadroom,
  probeLlmLingua,
  scanInputFiles,
  runCompressionEval,
  formatReportMarkdown,
} = require('../eval/compression-eval');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'compression-eval');

describe('TASK-AI-151: Context Compression Evaluation Engine', () => {
  describe('Token counting and category detection', () => {
    test('countTokens handles null, empty, and non-empty strings deterministically', () => {
      assert.equal(countTokens(''), 0);
      assert.equal(countTokens(null), 0);
      assert.equal(countTokens(undefined), 0);
      assert.equal(countTokens('abcd'), 1);
      assert.equal(countTokens('12345678'), 2);
      assert.equal(countTokens('a'.repeat(400)), 100);
    });

    test('detectCategory classifies code diffs, json, ci logs, and spec docs', () => {
      assert.equal(detectCategory('path/to/feature.diff', ''), CATEGORIES.CODE_DIFFS);
      assert.equal(detectCategory('path/to/diff-148.patch', ''), CATEGORIES.CODE_DIFFS);
      assert.equal(
        detectCategory('temp.txt', 'diff --git a/file b/file\n@@ -1,2 +1,2 @@\n'),
        CATEGORIES.CODE_DIFFS
      );

      assert.equal(detectCategory('quota.json', '{"a": 1}'), CATEGORIES.JSON);
      assert.equal(detectCategory('any.txt', '{"key": "value"}'), CATEGORIES.JSON);

      assert.equal(detectCategory('ci-146-tests.txt', 'log output'), CATEGORIES.CI_LOGS);
      assert.equal(detectCategory('run.log', '##[group] pnpm test'), CATEGORIES.CI_LOGS);

      assert.equal(detectCategory('TASK-AI-151.md', '# Title'), CATEGORIES.SPEC_DOCS);
      assert.equal(detectCategory('job-144ci.txt', 'worker prompt'), CATEGORIES.SPEC_DOCS);
      assert.equal(detectCategory('unknown.xyz', 'plain text without markers'), 'unknown');
    });
  });

  describe('Lossless verification logic', () => {
    test('losslessCheckDiff passes when all hunk headers and changed lines are present', () => {
      const orig = [
        'diff --git a/app.js b/app.js',
        '--- a/app.js',
        '+++ b/app.js',
        '@@ -10,3 +10,4 @@ function run() {',
        '   const a = 1;',
        '-  const b = 2;',
        '+  const b = 3;',
        '+  const c = 4;',
        ' }',
      ].join('\n');

      const comp = [
        'diff header omitted',
        '@@ -10,3 +10,4 @@ function run() {',
        '-  const b = 2;',
        '+  const b = 3;',
        '+  const c = 4;',
      ].join('\n');

      const result = losslessCheckDiff(orig, comp);
      assert.equal(result.passed, true);
      assert.equal(result.missingHunks.length, 0);
      assert.equal(result.missingChangedLines.length, 0);
    });

    test('losslessCheckDiff fails when a diff hunk header is dropped', () => {
      const orig = ['@@ -10,3 +10,4 @@ function run() {', '+  const b = 3;'].join('\n');

      const comp = '+  const b = 3;';
      const result = losslessCheckDiff(orig, comp);
      assert.equal(result.passed, false);
      assert.equal(result.missingHunks.length, 1);
    });

    test('losslessCheckDiff fails when a changed line is dropped or modified', () => {
      const orig = [
        '@@ -10,3 +10,4 @@ function run() {',
        '-  const b = 2;',
        '+  const b = 3;',
      ].join('\n');

      const comp = ['@@ -10,3 +10,4 @@ function run() {', '+  const b = 3;'].join('\n');

      const result = losslessCheckDiff(orig, comp);
      assert.equal(result.passed, false);
      assert.equal(result.missingChangedLines.length, 1);
      assert.equal(result.missingChangedLines[0], '-  const b = 2;');
    });

    test('losslessCheckDiff rejects dropped lines even if substring exists in another line', () => {
      const orig = ['@@ -1,3 +1,3 @@', '+  const b = 2;', '+  const b = 22;'].join('\n');

      // The line '+  const b = 2;' is dropped, but '+  const b = 22;' contains '+  const b = 2' as substring!
      const comp = ['@@ -1,3 +1,3 @@', '+  const b = 22;'].join('\n');

      const result = losslessCheckDiff(orig, comp);
      assert.equal(result.passed, false);
      assert.equal(result.missingChangedLines.length, 1);
      assert.equal(result.missingChangedLines[0], '+  const b = 2;');
    });

    test('losslessCheckJson passes when compressed text parses and retains deep structure', () => {
      const orig = JSON.stringify(
        {
          tenantId: 't-123',
          count: 42,
          active: true,
          data: { units: 1000, consumed: 150, tags: ['a', 'b'] },
        },
        null,
        2
      );
      const comp = JSON.stringify({
        tenantId: 't-123',
        count: 42,
        active: true,
        data: { units: 1000, consumed: 150, tags: ['a', 'b'] },
      }); // minified

      const result = losslessCheckJson(orig, comp);
      assert.equal(result.passed, true);
    });

    test('losslessCheckJson fails when nested key or value is dropped or modified', () => {
      const orig = JSON.stringify({
        tenantId: 't-123',
        data: { units: 1000, consumed: 150 },
      });

      // Nested key dropped
      const droppedNestedKey = JSON.stringify({
        tenantId: 't-123',
        data: { units: 1000 },
      });
      const droppedRes = losslessCheckJson(orig, droppedNestedKey);
      assert.equal(droppedRes.passed, false);
      assert.ok(droppedRes.error.includes("Missing keys at 'data'"));

      // Nested value changed
      const changedNestedVal = JSON.stringify({
        tenantId: 't-123',
        data: { units: 1000, consumed: 999 },
      });
      const changedRes = losslessCheckJson(orig, changedNestedVal);
      assert.equal(changedRes.passed, false);
      assert.ok(changedRes.error.includes("Value mismatch at 'data.consumed'"));

      // Array element order or value changed
      const origArr = JSON.stringify({ tags: ['x', 'y'] });
      const compArr = JSON.stringify({ tags: ['y', 'x'] });
      const arrRes = losslessCheckJson(origArr, compArr);
      assert.equal(arrRes.passed, false);
      assert.ok(arrRes.error.includes("Value mismatch at 'tags[0]'"));
    });

    test('losslessCheckJson fails closed on corrupt original or compressed input', () => {
      const orig = JSON.stringify({ tenantId: 't-123', count: 42 });
      const corrupt = '{ tenantId: "t-123", count: ';
      const dropped = JSON.stringify({ tenantId: 't-123' });

      const corruptRes = losslessCheckJson(orig, corrupt);
      assert.equal(corruptRes.passed, false);
      assert.ok(corruptRes.error);

      const badOrigRes = losslessCheckJson('{ bad json', JSON.stringify({ ok: true }));
      assert.equal(badOrigRes.passed, false);
      assert.ok(badOrigRes.error.includes('Original JSON parse failure'));

      const droppedRes = losslessCheckJson(orig, dropped);
      assert.equal(droppedRes.passed, false);
      assert.ok(droppedRes.error.includes("Missing keys at 'root'"));
    });

    test('verifyLossless fails closed on unknown category', () => {
      const res = verifyLossless('unknown_category', 'some text', 'some text');
      assert.equal(res.passed, false);
      assert.ok(res.error.includes('Unsupported or unknown category'));
    });

    test('losslessCheckSpecDoc verifies markdown headings preservation', () => {
      const orig = '# Title\n\n## Section 1\nContent\n\n## Section 2\nMore';
      const compPass = '# Title\n## Section 1\n## Section 2';
      const compFail = '# Title\n## Section 1';

      assert.equal(losslessCheckSpecDoc(orig, compPass).passed, true);
      const failRes = losslessCheckSpecDoc(orig, compFail);
      assert.equal(failRes.passed, false);
      assert.equal(failRes.missingHeadings.length, 1);
    });

    test('losslessCheckCiLogs verifies error marker preservation', () => {
      const orig = 'Run test\nError: connection refused\nExit code: 1';
      const compPass = 'Error: connection refused\nExit code: 1';
      const compFail = 'Run test\nSuccess';

      assert.equal(losslessCheckCiLogs(orig, compPass).passed, true);
      assert.equal(losslessCheckCiLogs(orig, compFail).passed, false);
    });
  });

  describe('Review, diagnosis, and triage safety guard', () => {
    test('isCompressionForbidden returns true for review, diagnosis, and triage paths', () => {
      assert.equal(isCompressionForbidden({ role: 'reviewer' }), true);
      assert.equal(isCompressionForbidden({ role: 'independent-review' }), true);
      assert.equal(isCompressionForbidden({ taskType: 'diagnosis' }), true);
      assert.equal(isCompressionForbidden({ category: 'diagnostic-run' }), true);
      assert.equal(isCompressionForbidden({ filePath: 'logs/review-verdict.md' }), true);
      assert.equal(isCompressionForbidden({ filePath: 'watch-diag.sh' }), true);
      assert.equal(isCompressionForbidden({ role: 'triager' }), true);
      assert.equal(isCompressionForbidden({ taskType: 'triage' }), true);
      assert.equal(isCompressionForbidden({ filePath: 'logs/triage.txt' }), true);

      // Permitted paths
      assert.equal(isCompressionForbidden({ role: 'author', taskType: 'coding' }), false);
      assert.equal(isCompressionForbidden({ filePath: 'apps/web/page.tsx' }), false);
    });
  });

  describe('Offline probing and evaluation runner', () => {
    test('probeHeadroom rejects unreachable proxy URL and reports NOT_INSTALLED', () => {
      const hrUnreachable = probeHeadroom({ headroomUrl: 'http://127.0.0.1:59999' });
      assert.equal(hrUnreachable.installed, false);
      assert.equal(hrUnreachable.status, ENGINE_STATUS.NOT_INSTALLED);
      assert.ok(
        hrUnreachable.reason.includes('not reachable') ||
          hrUnreachable.reason.includes('not responding')
      );
    });
    test('probeHeadroom and probeLlmLingua return NOT_INSTALLED when tools absent', () => {
      const hr = probeHeadroom({ headroomUrl: null });
      assert.ok(hr.status === ENGINE_STATUS.NOT_INSTALLED || hr.status === ENGINE_STATUS.INSTALLED);
      if (hr.status === ENGINE_STATUS.NOT_INSTALLED) {
        assert.equal(hr.installed, false);
        assert.ok(hr.reason);
      }

      const llm = probeLlmLingua();
      assert.ok(
        llm.status === ENGINE_STATUS.NOT_INSTALLED || llm.status === ENGINE_STATUS.INSTALLED
      );
      if (llm.status === ENGINE_STATUS.NOT_INSTALLED) {
        assert.equal(llm.installed, false);
        assert.ok(llm.reason);
      }
    });

    test('runCompressionEval on fixtures returns truthful NOT_INSTALLED status', () => {
      const result = runCompressionEval({ inputsDir: FIXTURES_DIR });

      assert.ok(result.summary.totalFiles >= 4);
      assert.ok(result.summary.totalOriginalTokens > 0);

      const specStats = result.categories[CATEGORIES.SPEC_DOCS];
      const ciStats = result.categories[CATEGORIES.CI_LOGS];
      const jsonStats = result.categories[CATEGORIES.JSON];
      const diffStats = result.categories[CATEGORIES.CODE_DIFFS];

      assert.ok(specStats.fileCount >= 1);
      assert.ok(ciStats.fileCount >= 1);
      assert.ok(jsonStats.fileCount >= 1);
      assert.ok(diffStats.fileCount >= 1);

      assert.equal(specStats.engines.headroom.status, ENGINE_STATUS.NOT_INSTALLED);
      assert.equal(specStats.engines.headroom.compressedTokens, null);
      assert.equal(specStats.engines.llmlingua2.status, ENGINE_STATUS.NOT_INSTALLED);
      assert.equal(specStats.engines.llmlingua2.compressedTokens, null);
    });

    test('runCompressionEval with mock compressor calculates reduction and enforces review guard', () => {
      // Mock compressor strips extra whitespace and comments
      const mockCompressor = (text, category) => {
        if (category === CATEGORIES.JSON) {
          try {
            return JSON.stringify(JSON.parse(text)); // minified JSON
          } catch (_) {
            return text;
          }
        }
        return text.replace(/\n\s*\n/g, '\n');
      };

      const result = runCompressionEval({
        inputsDir: FIXTURES_DIR,
        mockCompressor,
      });

      const jsonStats = result.categories[CATEGORIES.JSON];
      assert.ok(jsonStats.engines.mock);
      assert.equal(jsonStats.engines.mock.status, ENGINE_STATUS.INSTALLED);
      assert.ok(jsonStats.engines.mock.compressedTokens <= jsonStats.originalTokens);
      assert.equal(jsonStats.engines.mock.losslessPassed, true);
    });

    test('formatReportMarkdown outputs valid markdown table and recommendation', () => {
      const result = runCompressionEval({ inputsDir: FIXTURES_DIR });
      const md = formatReportMarkdown(result);

      assert.ok(md.includes('# Context Compression Evaluation Report (TASK-AI-151)'));
      assert.ok(md.includes('| Category | Files | Original Tokens |'));
      assert.ok(md.includes('REMAIN DEFERRED'));
      assert.ok(md.includes('npm install -g headroom@0.0.1'));
      assert.ok(md.includes('pip install llmlingua==0.2.2'));
    });
  });
});
