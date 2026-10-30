'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  CATEGORIES,
  ENGINE_STATUS,
  isOptedIn,
  isLoopbackUrl,
  countTokens,
  isCompressionForbidden,
  detectCategory,
  extractDiffHunksAndChangedLines,
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

    test('losslessCheckDiff distinguishes real file headers from hunk code changes like +++counter and ---decrement', () => {
      const orig = [
        'diff --git a/src/counter.js b/src/counter.js',
        '--- a/src/counter.js',
        '+++ b/src/counter.js',
        '@@ -1,5 +1,7 @@',
        ' function mutate() {',
        '+++counter;',
        '---decrement;',
        '-  const oldVal = 1;',
        '+  const newVal = 2;',
        ' }',
      ].join('\n');

      // 1. Fully preserved diff passes lossless check
      const compPreserved = [
        'diff --git a/src/counter.js b/src/counter.js',
        '@@ -1,5 +1,7 @@',
        ' function mutate() {',
        '+++counter;',
        '---decrement;',
        '-  const oldVal = 1;',
        '+  const newVal = 2;',
        ' }',
      ].join('\n');
      const passResult = losslessCheckDiff(orig, compPreserved);
      assert.equal(passResult.passed, true);
      assert.equal(passResult.totalChangedLines, 4);
      assert.equal(passResult.missingChangedLines.length, 0);

      // 2. Dropping +++counter; inside hunk MUST fail lossless check
      const compDroppedPlus = [
        '@@ -1,5 +1,7 @@',
        ' function mutate() {',
        '---decrement;',
        '-  const oldVal = 1;',
        '+  const newVal = 2;',
        ' }',
      ].join('\n');
      const failPlusResult = losslessCheckDiff(orig, compDroppedPlus);
      assert.equal(failPlusResult.passed, false);
      assert.equal(failPlusResult.missingChangedLines.length, 1);
      assert.equal(failPlusResult.missingChangedLines[0], '+++counter;');

      // 3. Dropping ---decrement; inside hunk MUST fail lossless check
      const compDroppedMinus = [
        '@@ -1,5 +1,7 @@',
        ' function mutate() {',
        '+++counter;',
        '-  const oldVal = 1;',
        '+  const newVal = 2;',
        ' }',
      ].join('\n');
      const failMinusResult = losslessCheckDiff(orig, compDroppedMinus);
      assert.equal(failMinusResult.passed, false);
      assert.equal(failMinusResult.missingChangedLines.length, 1);
      assert.equal(failMinusResult.missingChangedLines[0], '---decrement;');

      // 4. File headers outside hunks are not treated as changed lines
      const { changedLines } = extractDiffHunksAndChangedLines(orig);
      assert.equal(changedLines.includes('--- a/src/counter.js'), false);
      assert.equal(changedLines.includes('+++ b/src/counter.js'), false);
      assert.equal(changedLines.includes('+++counter;'), true);
      assert.equal(changedLines.includes('---decrement;'), true);
    });

    test('losslessCheckDiff tracks hunk line counts and verifies changed lines shaped like +++ b/x and --- a/x inside hunks', () => {
      // Diff with both +++ b/... and --- a/... changed lines inside hunks, plus file headers outside hunks
      const orig = [
        'diff --git a/src/counter.js b/src/counter.js',
        '--- a/src/counter.js',
        '+++ b/src/counter.js',
        '@@ -1,3 +1,4 @@',
        ' function mutate() {',
        '--- a/counter;',
        '+++ b/counter;',
        '+checked();',
        ' }',
      ].join('\n');

      // 1. Fully preserved diff passes lossless verification
      const compPreserved = [
        'diff --git a/src/counter.js b/src/counter.js',
        '@@ -1,3 +1,4 @@',
        ' function mutate() {',
        '--- a/counter;',
        '+++ b/counter;',
        '+checked();',
        ' }',
      ].join('\n');
      const passResult = losslessCheckDiff(orig, compPreserved);
      assert.equal(passResult.passed, true);
      assert.equal(passResult.totalChangedLines, 3);
      assert.equal(passResult.missingChangedLines.length, 0);

      // 2. Dropping +++ b/counter; inside hunk MUST fail lossless check
      const compDroppedPlus = [
        '@@ -1,3 +1,4 @@',
        ' function mutate() {',
        '--- a/counter;',
        '+checked();',
        ' }',
      ].join('\n');
      const failPlusResult = losslessCheckDiff(orig, compDroppedPlus);
      assert.equal(failPlusResult.passed, false);
      assert.ok(failPlusResult.missingChangedLines.includes('+++ b/counter;'));

      // 3. Dropping --- a/counter; inside hunk MUST fail lossless check
      const compDroppedMinus = [
        '@@ -1,3 +1,4 @@',
        ' function mutate() {',
        '+++ b/counter;',
        '+checked();',
        ' }',
      ].join('\n');
      const failMinusResult = losslessCheckDiff(orig, compDroppedMinus);
      assert.equal(failMinusResult.passed, false);
      assert.ok(failMinusResult.missingChangedLines.includes('--- a/counter;'));

      // 4. Dropping the following line (+checked();) must also fail
      const compDroppedFollow = [
        '@@ -1,3 +1,4 @@',
        ' function mutate() {',
        '--- a/counter;',
        '+++ b/counter;',
        ' }',
      ].join('\n');
      const failFollowResult = losslessCheckDiff(orig, compDroppedFollow);
      assert.equal(failFollowResult.passed, false);
      assert.ok(failFollowResult.missingChangedLines.includes('+checked();'));

      // 5. File headers outside hunks are not changed lines; changes inside hunks are
      const { changedLines } = extractDiffHunksAndChangedLines(orig);
      assert.equal(changedLines.includes('--- a/src/counter.js'), false);
      assert.equal(changedLines.includes('+++ b/src/counter.js'), false);
      assert.equal(changedLines.includes('--- a/counter;'), true);
      assert.equal(changedLines.includes('+++ b/counter;'), true);
      assert.equal(changedLines.includes('+checked();'), true);
    });

    test('losslessCheckDiff tracks multi-file hunks and stops hunk boundary when counts reach zero', () => {
      const multiDiff = [
        'diff --git a/file1.txt b/file1.txt',
        '--- a/file1.txt',
        '+++ b/file1.txt',
        '@@ -1,2 +1,3 @@',
        ' ctx1',
        '+++ b/x',
        ' ctx2',
        'diff --git a/file2.txt b/file2.txt',
        '--- a/file2.txt',
        '+++ b/file2.txt',
        '@@ -1,3 +1,2 @@',
        ' ctx1',
        '--- a/x',
        ' ctx2',
      ].join('\n');

      const { hunks, changedLines } = extractDiffHunksAndChangedLines(multiDiff);
      assert.equal(hunks.length, 2);
      assert.deepEqual(changedLines, ['+++ b/x', '--- a/x']);

      // Preserved passes
      const pass = losslessCheckDiff(multiDiff, multiDiff);
      assert.equal(pass.passed, true);

      // Dropping --- a/x fails
      const dropped = multiDiff.replace('--- a/x\n', '');
      const fail = losslessCheckDiff(multiDiff, dropped);
      assert.equal(fail.passed, false);
      assert.ok(fail.missingChangedLines.includes('--- a/x'));
    });

    test('losslessCheckDiff preserves changed lines following context lines that resemble hunk headers', () => {
      // Regression case for Review Finding 2:
      // Context lines like " @@ -0,0 +0,0 @@" must not be trimmed into false hunk headers
      const orig = ['@@ -1,2 +1,3 @@', ' @@ -0,0 +0,0 @@', '+checked();', ' tail'].join('\n');

      const { hunks, changedLines } = extractDiffHunksAndChangedLines(orig);
      assert.equal(hunks.length, 1);
      assert.equal(hunks[0], '@@ -1,2 +1,3 @@');
      assert.deepEqual(changedLines, ['+checked();']);

      // Preserved diff passes
      const compPreserved = orig;
      const passRes = losslessCheckDiff(orig, compPreserved);
      assert.equal(passRes.passed, true);
      assert.equal(passRes.totalChangedLines, 1);
      assert.equal(passRes.missingChangedLines.length, 0);

      // Dropping +checked(); MUST fail lossless verification
      const compDropped = ['@@ -1,2 +1,3 @@', ' @@ -0,0 +0,0 @@', ' tail'].join('\n');
      const failRes = losslessCheckDiff(orig, compDropped);
      assert.equal(failRes.passed, false);
      assert.equal(failRes.missingChangedLines.length, 1);
      assert.equal(failRes.missingChangedLines[0], '+checked();');
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
    test('probeHeadroom and probeLlmLingua default to NOT_ENABLED without opt-in and run nothing', () => {
      // By default without opt-in, probing does not contact network or run binaries
      const hr = probeHeadroom({ headroomUrl: 'http://127.0.0.1:8787' });
      assert.equal(hr.installed, false);
      assert.equal(hr.status, ENGINE_STATUS.NOT_ENABLED);
      assert.ok(hr.reason.includes('opt-in required'));

      const llm = probeLlmLingua();
      assert.equal(llm.installed, false);
      assert.equal(llm.status, ENGINE_STATUS.NOT_ENABLED);
      assert.ok(llm.reason.includes('opt-in required'));
    });

    test('probeHeadroom strictly enforces loopback restriction for HEADROOM_URL when opted in', () => {
      // Non-loopback URL must be rejected without making any external network connection
      const remote = probeHeadroom({ headroomUrl: 'http://remote-server.com:8787', optIn: true });
      assert.equal(remote.installed, false);
      assert.equal(remote.status, ENGINE_STATUS.NOT_INSTALLED);
      assert.ok(remote.reason.includes('restricted to loopback'));

      const publicIp = probeHeadroom({ headroomUrl: 'http://93.184.216.34:8787', optIn: true });
      assert.equal(publicIp.installed, false);
      assert.equal(publicIp.status, ENGINE_STATUS.NOT_INSTALLED);
      assert.ok(publicIp.reason.includes('restricted to loopback'));

      // Loopback URL is checked only when opted in
      const loopbackUnreachable = probeHeadroom({
        headroomUrl: 'http://127.0.0.1:59999',
        optIn: true,
      });
      assert.equal(loopbackUnreachable.installed, false);
      assert.equal(loopbackUnreachable.status, ENGINE_STATUS.NOT_INSTALLED);
      assert.ok(
        loopbackUnreachable.reason.includes('not responding') ||
          loopbackUnreachable.reason.includes('failed capability check') ||
          loopbackUnreachable.reason.includes('probe error')
      );
    });

    test('probeHeadroom verifies engine-specific capability, refusing remote redirects and unrelated 200 servers', async () => {
      const { spawn } = await import('child_process');
      // Run mock HTTP server in a separate process so its event loop is not blocked by spawnSync
      const serverProcess = spawn(process.execPath, [
        '-e',
        `
        const http = require('http');
        // Documented Headroom proxy GET /health response shape:
        // JSON body carrying Headroom's exact product identifier.
        const healthBody = JSON.stringify({
          service: 'headroom-proxy',
          status: 'healthy',
          ready: true,
          version: '0.0.0-test',
          timestamp: '2026-01-01T00:00:00Z',
          uptime_seconds: 1,
          checks: {},
          runtime: {},
          rust_core: 'loaded',
        });
        const server = http.createServer((req, res) => {
          if (req.url === '/redirect-remote') {
            res.writeHead(302, { Location: 'http://remote-attacker.example.com/exploit' });
            res.end();
          } else if (req.url === '/redirect-loopback') {
            res.writeHead(302, { Location: '/health' });
            res.end();
          } else if (req.url === '/health' || req.url.startsWith('/health?')) {
            // Query string keeps the documented endpoint pathname (/health)
            // while selecting what the (unrelated) server answers with.
            const query = req.url.split('?')[1] || '';
            if (query.includes('mode=plain')) {
              // Unrelated server answering the allowed endpoint with plain text
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end('ok');
            } else if (query.includes('mode=unrelated-json')) {
              // Unrelated server answering the allowed endpoint with foreign JSON
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ok', service: 'other-service' }));
            } else if (query.includes('mode=spoofed-powered-by')) {
              // Unrelated 200 server with a spoofed X-Powered-By containing 'headroom'
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'X-Powered-By': 'not-headroom',
              });
              res.end(JSON.stringify({ status: 'ok', service: 'other-service' }));
            } else if (query.includes('mode=spoofed-x-service')) {
              // Unrelated 200 server with a spoofed X-Service header
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'X-Service': 'headroom',
              });
              res.end(JSON.stringify({ status: 'ok', service: 'other-service' }));
            } else if (query.includes('mode=wrong-identifier')) {
              // Close-but-wrong product identifier in the documented shape
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'ok', service: 'headroom' }));
            } else {
              // Verified Headroom: documented endpoint + documented response shape
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(healthBody);
            }
          } else if (req.url === '/unrelated-plain') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
          } else if (req.url === '/unrelated-json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', service: 'other-service' }));
          } else {
            res.writeHead(404);
            res.end();
          }
        }).listen(0, '127.0.0.1', () => {
          process.stdout.write(String(server.address().port));
        });
        `,
      ]);

      const port = await new Promise((resolve, reject) => {
        serverProcess.stdout.once('data', (d) => resolve(d.toString().trim()));
        serverProcess.on('error', reject);
      });

      try {
        // 1. Loopback redirecting to remote host MUST be refused
        const remoteRedirect = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}/redirect-remote`,
          optIn: true,
        });
        assert.equal(remoteRedirect.installed, false);
        assert.equal(remoteRedirect.status, ENGINE_STATUS.NOT_INSTALLED);
        assert.ok(
          remoteRedirect.reason.includes('Refused non-loopback redirect target') ||
            remoteRedirect.reason.includes('remote-attacker.example.com')
        );

        // 2. 200 server on a non-documented endpoint (plain text) MUST be rejected
        const unrelatedPlain = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}/unrelated-plain`,
          optIn: true,
        });
        assert.equal(unrelatedPlain.installed, false);
        assert.equal(unrelatedPlain.status, ENGINE_STATUS.NOT_INSTALLED);
        assert.ok(unrelatedPlain.reason.includes('not the documented Headroom health endpoint'));

        // 3. 200 server on a non-documented endpoint (JSON) MUST be rejected
        const unrelatedJson = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}/unrelated-json`,
          optIn: true,
        });
        assert.equal(unrelatedJson.installed, false);
        assert.equal(unrelatedJson.status, ENGINE_STATUS.NOT_INSTALLED);
        assert.ok(unrelatedJson.reason.includes('not the documented Headroom health endpoint'));

        // 4. Unrelated 200 server answering the allowed endpoint with plain text
        //    MUST be rejected (identity, not endpoint, fails)
        const plainAtHealth = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}/health?mode=plain`,
          optIn: true,
        });
        assert.equal(plainAtHealth.installed, false);
        assert.equal(plainAtHealth.status, ENGINE_STATUS.NOT_INSTALLED);
        assert.ok(plainAtHealth.reason.includes('product identifier not found'));

        // 5. Unrelated 200 server answering the allowed endpoint with foreign JSON
        //    MUST be rejected
        const foreignJsonAtHealth = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}/health?mode=unrelated-json`,
          optIn: true,
        });
        assert.equal(foreignJsonAtHealth.installed, false);
        assert.equal(foreignJsonAtHealth.status, ENGINE_STATUS.NOT_INSTALLED);
        assert.ok(foreignJsonAtHealth.reason.includes('product identifier not found'));

        // 6. Unrelated 200 server with a spoofed X-Powered-By containing
        //    'headroom' (e.g. 'not-headroom') MUST be rejected: response
        //    headers are never trusted for identity
        const spoofedPoweredBy = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}/health?mode=spoofed-powered-by`,
          optIn: true,
        });
        assert.equal(spoofedPoweredBy.installed, false);
        assert.equal(spoofedPoweredBy.status, ENGINE_STATUS.NOT_INSTALLED);
        assert.ok(spoofedPoweredBy.reason.includes('product identifier not found'));

        // 7. Unrelated 200 server with a spoofed X-Service: headroom header
        //    MUST be rejected for the same reason
        const spoofedXService = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}/health?mode=spoofed-x-service`,
          optIn: true,
        });
        assert.equal(spoofedXService.installed, false);
        assert.equal(spoofedXService.status, ENGINE_STATUS.NOT_INSTALLED);
        assert.ok(spoofedXService.reason.includes('product identifier not found'));

        // 8. Documented shape with a close-but-wrong product identifier
        //    (service: 'headroom' instead of the exact documented identifier)
        //    MUST be rejected
        const wrongIdentifier = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}/health?mode=wrong-identifier`,
          optIn: true,
        });
        assert.equal(wrongIdentifier.installed, false);
        assert.equal(wrongIdentifier.status, ENGINE_STATUS.NOT_INSTALLED);
        assert.ok(wrongIdentifier.reason.includes('product identifier not found'));

        // 9. Loopback redirecting to /health with verified Headroom response is permitted
        const loopbackRedirect = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}/redirect-loopback`,
          optIn: true,
        });
        assert.equal(loopbackRedirect.installed, true);
        assert.equal(loopbackRedirect.status, ENGINE_STATUS.INSTALLED);

        // 10. Direct base URL automatically targeting /health with verified Headroom response succeeds
        const directBase = probeHeadroom({
          headroomUrl: `http://127.0.0.1:${port}`,
          optIn: true,
        });
        assert.equal(directBase.installed, true);
        assert.equal(directBase.status, ENGINE_STATUS.INSTALLED);
      } finally {
        serverProcess.kill();
      }
    });

    test('probeHeadroom and probeLlmLingua return NOT_INSTALLED when opted in but tools absent', () => {
      const hr = probeHeadroom({ headroomUrl: null, optIn: true });
      assert.ok(hr.status === ENGINE_STATUS.NOT_INSTALLED || hr.status === ENGINE_STATUS.INSTALLED);
      if (hr.status === ENGINE_STATUS.NOT_INSTALLED) {
        assert.equal(hr.installed, false);
        assert.ok(hr.reason);
      }

      const llm = probeLlmLingua({ optIn: true });
      assert.ok(
        llm.status === ENGINE_STATUS.NOT_INSTALLED || llm.status === ENGINE_STATUS.INSTALLED
      );
      if (llm.status === ENGINE_STATUS.NOT_INSTALLED) {
        assert.equal(llm.installed, false);
        assert.ok(llm.reason);
      }
    });

    test('runCompressionEval on fixtures defaults to truthful NOT_ENABLED status when not opted in', () => {
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

      assert.equal(specStats.engines.headroom.status, ENGINE_STATUS.NOT_ENABLED);
      assert.equal(specStats.engines.headroom.compressedTokens, null);
      assert.equal(specStats.engines.llmlingua2.status, ENGINE_STATUS.NOT_ENABLED);
      assert.equal(specStats.engines.llmlingua2.compressedTokens, null);
    });

    test('runCompressionEval on fixtures returns truthful NOT_INSTALLED status when opted in', () => {
      const result = runCompressionEval({ inputsDir: FIXTURES_DIR, optIn: true });

      const specStats = result.categories[CATEGORIES.SPEC_DOCS];
      assert.equal(specStats.engines.headroom.status, ENGINE_STATUS.NOT_INSTALLED);
      assert.equal(specStats.engines.headroom.compressedTokens, null);
      assert.equal(specStats.engines.llmlingua2.status, ENGINE_STATUS.NOT_INSTALLED);
      assert.equal(specStats.engines.llmlingua2.compressedTokens, null);
    });

    test('failed compressor is reported as FAILED with error and never counted in aggregates', () => {
      // 1. Mock compressor returning explicit error
      const resultWithError = runCompressionEval({
        inputsDir: FIXTURES_DIR,
        mockCompressor: () => ({ error: 'CCR proxy timed out' }),
      });

      const jsonStats = resultWithError.categories[CATEGORIES.JSON];
      assert.equal(jsonStats.engines.mock.status, ENGINE_STATUS.FAILED);
      assert.equal(jsonStats.engines.mock.error, 'CCR proxy timed out');
      assert.equal(jsonStats.engines.mock.compressedTokens, null);
      assert.equal(jsonStats.engines.mock.tokenReductionPercent, null);
      assert.equal(jsonStats.engines.mock.losslessPassed, ENGINE_STATUS.FAILED);

      // 2. Mock compressor throwing an exception
      const resultWithThrow = runCompressionEval({
        inputsDir: FIXTURES_DIR,
        mockCompressor: () => {
          throw new Error('Process crash');
        },
      });

      const diffStats = resultWithThrow.categories[CATEGORIES.CODE_DIFFS];
      assert.equal(diffStats.engines.mock.status, ENGINE_STATUS.FAILED);
      assert.equal(diffStats.engines.mock.error, 'Process crash');
      assert.equal(diffStats.engines.mock.compressedTokens, null);

      // 3. Headroom failed execution marks headroom as FAILED with unavailable metrics
      const resultWithFailedHeadroom = runCompressionEval({
        inputsDir: FIXTURES_DIR,
        optIn: true,
        headroomProbe: {
          installed: true,
          status: ENGINE_STATUS.INSTALLED,
          mode: 'cli',
        },
      });
      const hrStats = resultWithFailedHeadroom.categories[CATEGORIES.CODE_DIFFS].engines.headroom;
      assert.equal(hrStats.status, ENGINE_STATUS.FAILED);
      assert.equal(hrStats.compressedTokens, null);
      assert.equal(hrStats.tokenReductionPercent, null);
      assert.equal(hrStats.losslessPassed, ENGINE_STATUS.FAILED);
      assert.ok(hrStats.error);
    });

    test('runCompressionEval with mock compressor calculates reduction and demonstrates skipped compressor calls on review guard', () => {
      const invokedCalls = [];

      const mockCompressor = (text, category, sample) => {
        const filePath = sample ? sample.relativePath || sample.filePath : 'unknown';
        invokedCalls.push({
          category,
          filePath,
          text,
        });

        if (category === CATEGORIES.JSON) {
          try {
            return JSON.stringify(JSON.parse(text));
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

      // 1. Assert non-review JSON compression works and calculates reduction
      const jsonStats = result.categories[CATEGORIES.JSON];
      assert.ok(jsonStats.engines.mock);
      assert.equal(jsonStats.engines.mock.status, ENGINE_STATUS.INSTALLED);
      assert.ok(jsonStats.engines.mock.compressedTokens <= jsonStats.originalTokens);
      assert.equal(jsonStats.engines.mock.losslessPassed, true);

      // 2. Demonstrate that compressor calls were invoked for normal files
      const nonReviewCalls = invokedCalls.filter(
        (c) => !c.filePath.toLowerCase().includes('review')
      );
      assert.ok(nonReviewCalls.length >= 3);
      assert.ok(invokedCalls.some((c) => c.filePath.includes('sample-quota.json')));
      assert.ok(invokedCalls.some((c) => c.filePath.includes('sample-code.diff')));
      assert.ok(invokedCalls.some((c) => c.filePath.includes('sample-ci.txt')));
      assert.ok(invokedCalls.some((c) => c.filePath.includes('sample-spec.md')));

      // 3. Finding 5 demonstration: prove mock compressor was NEVER called for sample-review.md
      const reviewCalls = invokedCalls.filter((c) => c.filePath.toLowerCase().includes('review'));
      assert.equal(
        reviewCalls.length,
        0,
        'Expected zero compressor calls for review/diagnosis files under FIXTURES_DIR'
      );

      // 4. Verify compressWithHeadroom and compressWithLlmLingua return skipped: true on review context
      const hrReview = compressWithHeadroom(
        '# Review verdict',
        { role: 'reviewer', filePath: 'sample-review.md' },
        { installed: true },
        { optIn: true }
      );
      assert.equal(hrReview.skipped, true);
      assert.equal(hrReview.compressedText, '# Review verdict');

      const llmReview = compressWithLlmLingua(
        '# Review verdict',
        { role: 'reviewer', filePath: 'sample-review.md' },
        { installed: true, pythonPath: 'python' },
        { optIn: true }
      );
      assert.equal(llmReview.skipped, true);
      assert.equal(llmReview.compressedText, '# Review verdict');
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
