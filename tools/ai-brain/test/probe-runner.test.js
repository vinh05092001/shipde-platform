'use strict';

/**
 * Ship Dễ — 9Router Probe Runner Tests
 *
 * Verifies all 9 core real-world cases against a local fake HTTP server:
 * 1. JSON completion
 * 2. SSE stream (lines beginning "data: ", chunks with delta.content and delta.reasoning_content)
 * 3. 200 with empty content is FAIL
 * 4. 401 unauthorized
 * 5. 402 wrapped in 503 (innermost cause extraction)
 * 6. 404 one model only (does not defer remaining models in upstream)
 * 7. Gateway dead aborts the batch (never writes false FAIL rows)
 * 8. Restart resumes without duplicate rows
 * 9. Upstream 402 defers only proven-shared scope
 *
 * Additional invariants verified:
 * - Missing auth fails preflight immediately
 * - Network failure with no HTTP response carries NO httpStatus
 * - Status is strictly PASS, FAIL, DEFERRED, UNTESTED
 * - Never writes verified: true
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  runProbeBatch,
  runPreflight,
  loadHistory,
  buildQueueKey,
  parseQueueKey,
} = require('../probe-runner');

const Cause = {
  UPSTREAM_CREDIT_EXHAUSTED: 'upstream_credit_exhausted',
  UPSTREAM_MONTHLY_LIMIT: 'upstream_monthly_limit',
  UPSTREAM_ENTITLEMENT: 'upstream_entitlement',
  UPSTREAM_RATE_LIMIT: 'upstream_rate_limit',
  UPSTREAM_CREDENTIAL: 'upstream_credential',
  MODEL_UNSUPPORTED: 'model_unsupported',
  ALIAS_MISMATCH: 'alias_mismatch',
  ACCOUNT_QUOTA_EXHAUSTED: 'account_quota_exhausted',
  GENUINE_CAPACITY: 'genuine_capacity',
  ACCOUNT_AUTH_FAILED: 'account_auth_failed',
  EXHAUSTION_HIDING: 'exhaustion_hiding',
  UNKNOWN: 'unknown',
};

const Scope = {
  MODEL: 'model',
  UPSTREAM: 'upstream',
  ACCOUNT: 'account',
  ACCESS_PATH: 'access_path',
  HARNESS: 'harness',
  UNKNOWN: 'unknown',
};

const testClassifier = {
  Cause,
  Scope,
  classifyFailure(input) {
    const { httpStatus, body = '', stderr = '' } = input || {};
    const text = [String(body || ''), String(stderr || '')].filter(Boolean).join('\n');

    // Extract innermost HTTP status if wrapped (e.g., "[402]: ..." or "503: [402]: ...")
    const innerMatch = text.match(/[\[(]\s*(400|401|402|403|410|429)\s*[\])]/);
    const effectiveStatus = innerMatch ? parseInt(innerMatch[1], 10) : httpStatus;

    if (
      (effectiveStatus === 402 || effectiveStatus === 429) &&
      /out of credit|credit.{0,20}exhaust|insufficient.*credit|provider.{0,20}credit/i.test(text)
    ) {
      return {
        cause: Cause.UPSTREAM_CREDIT_EXHAUSTED,
        scope: Scope.UPSTREAM,
        cooldownMs: 86400000,
        resetTime: null,
      };
    }

    if (
      effectiveStatus === 401 &&
      /unauthorized|invalid.*token|authentication failed|invalid.*credential/i.test(text)
    ) {
      return {
        cause: Cause.UPSTREAM_CREDENTIAL,
        scope: Scope.UPSTREAM,
        cooldownMs: 3600000,
        resetTime: null,
      };
    }

    if (
      effectiveStatus === 403 &&
      /unauthorized|not licensed|entitlement|forbidden|access.*disabled|model access.*disabled/i.test(
        text
      )
    ) {
      return {
        cause: Cause.UPSTREAM_ENTITLEMENT,
        scope: Scope.UPSTREAM,
        cooldownMs: null,
        resetTime: null,
      };
    }

    if (
      effectiveStatus === 400 &&
      /arrearage|invalid.subscription|account.*standing|overdue|payment/i.test(text)
    ) {
      return {
        cause: Cause.UPSTREAM_ENTITLEMENT,
        scope: Scope.UPSTREAM,
        cooldownMs: null,
        resetTime: null,
      };
    }

    if (
      effectiveStatus === 404 ||
      (effectiveStatus === 400 && /model.{0,20}not.{0,10}support/i.test(text)) ||
      /model not found/i.test(text)
    ) {
      return {
        cause: Cause.MODEL_UNSUPPORTED,
        scope: Scope.MODEL,
        cooldownMs: null,
        resetTime: null,
      };
    }

    if (
      effectiveStatus === 429 &&
      /rate.?limit|too many requests|user_global_rate_limited/i.test(text)
    ) {
      return {
        cause: Cause.UPSTREAM_RATE_LIMIT,
        scope: Scope.UPSTREAM,
        cooldownMs: 300000,
        resetTime: null,
      };
    }

    return {
      cause: Cause.UNKNOWN,
      scope: Scope.UNKNOWN,
      cooldownMs: 300000,
      resetTime: null,
    };
  },
};

describe('9Router Probe Runner Suite', () => {
  let server;
  let serverPort;
  let gatewayUrl;
  let customRoutes = new Map();
  let tmpDirs = [];

  function makeTmpFile(filename = 'probe-results.jsonl') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-runner-test-'));
    tmpDirs.push(tmpDir);
    return path.join(tmpDir, filename);
  }

  before(async () => {
    server = http.createServer((req, res) => {
      // 1. Models list endpoint: GET /v1/models or GET /models
      if (req.method === 'GET' && (req.url === '/v1/models' || req.url === '/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const defaultModels = [
          { id: 'json-upstream/model-json' },
          { id: 'sse-upstream/model-sse' },
        ];
        res.end(JSON.stringify({ object: 'list', data: defaultModels }));
        return;
      }

      // 2. Chat completions endpoint: POST /v1/chat/completions or /chat/completions
      if (
        req.method === 'POST' &&
        (req.url === '/v1/chat/completions' || req.url === '/chat/completions')
      ) {
        const auth = req.headers['authorization'] || '';
        if (!auth.startsWith('Bearer ')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Missing API key' } }));
          return;
        }

        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
            return;
          }

          const modelId = parsed.model;
          const handler = customRoutes.get(modelId);

          if (handler) {
            handler(req, res, parsed);
          } else {
            // Default 200 JSON handler
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                id: 'cmpl-default',
                choices: [{ message: { content: `Response for ${modelId}` } }],
              })
            );
          }
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        serverPort = server.address().port;
        gatewayUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) {
      server.close();
    }
    for (const dir of tmpDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  it('1. JSON completion records PASS with content and latency', async () => {
    const modelId = 'test-json/model-a';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'cmpl-json-1',
          choices: [{ message: { content: 'pong from json' } }],
        })
      );
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.probedCount, 1);
    assert.equal(summary.passedCount, 1);
    assert.equal(summary.failedCount, 0);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-json', modelId });
    const row = history.get(key);

    assert.ok(row, 'Result row must exist in history');
    assert.equal(row.status, 'PASS');
    assert.equal(row.httpStatus, 200);
    assert.equal(row.content, 'pong from json');
    assert.ok(row.latencyMs >= 0);
    assert.equal(row.verified, undefined, 'Never write verified true');
  });

  it('2. SSE stream parses delta.content and delta.reasoning_content into PASS', async () => {
    const modelId = 'test-sse/model-stream';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"reasoning_content":"(thinking) "}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"world!"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.passedCount, 1);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-sse', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'PASS');
    assert.equal(row.httpStatus, 200);
    assert.ok(row.content.includes('Hello'));
    assert.ok(row.content.includes('(thinking)'));
    assert.ok(row.content.includes('world!'));
    assert.equal(row.verified, undefined);
  });

  it('3. HTTP 200 with empty content is FAIL', async () => {
    const modelId = 'test-empty/model-empty';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '' } }],
        })
      );
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.failedCount, 1);
    assert.equal(summary.passedCount, 0);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-empty', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'FAIL');
    assert.equal(row.httpStatus, 200);
    assert.ok(row.reason.includes('empty content'));
    assert.equal(row.verified, undefined);
  });

  it('4. HTTP 401 unauthorized classifies as upstream_credential', async () => {
    const modelId = 'test-401/model-unauth';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'unauthorized: invalid token' } }));
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.failedCount, 1);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-401', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'FAIL');
    assert.equal(row.httpStatus, 401);
    assert.equal(row.cause, Cause.UPSTREAM_CREDENTIAL);
    assert.equal(row.scope, Scope.UPSTREAM);
    assert.equal(row.verified, undefined);
  });

  it('5. HTTP 402 wrapped in 503 classifies on innermost cause', async () => {
    const modelId = 'test-503/model-credit';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('503 Service Unavailable: [402]: out of credit');
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.failedCount, 1);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-503', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'FAIL');
    assert.equal(row.httpStatus, 503);
    assert.equal(row.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(row.scope, Scope.UPSTREAM);
    assert.equal(row.verified, undefined);
  });

  it('6. 404 one model only does not defer other models in the upstream', async () => {
    const model1 = 'upstream-404/model-notfound';
    const model2 = 'upstream-404/model-working';

    customRoutes.set(model1, (req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: '[404]: Model not found' } }));
    });

    customRoutes.set(model2, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'working' } }] }));
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: model1 }, { id: model2 }],
      outPath,
      classifier: testClassifier,
    });

    // model1 fails with 404 (scope: MODEL), model2 is probed and succeeds
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.passedCount, 1);
    assert.equal(summary.deferredCount, 0);

    const history = loadHistory(outPath);
    const key1 = buildQueueKey({ upstream: 'upstream-404', modelId: model1 });
    const key2 = buildQueueKey({ upstream: 'upstream-404', modelId: model2 });

    const row1 = history.get(key1);
    const row2 = history.get(key2);

    assert.ok(row1);
    assert.equal(row1.status, 'FAIL');
    assert.equal(row1.scope, Scope.MODEL);

    assert.ok(row2);
    assert.equal(row2.status, 'PASS');
    assert.equal(row2.content, 'working');
  });

  it('7. Gateway dead aborts the batch and writes zero model FAIL rows', async () => {
    const outPath = makeTmpFile();
    const deadGatewayUrl = 'http://127.0.0.1:19999';

    await assert.rejects(
      async () => {
        await runProbeBatch({
          gatewayUrl: deadGatewayUrl,
          apiKey: 'test-token',
          catalogue: [{ id: 'dead/model-1' }, { id: 'dead/model-2' }],
          outPath,
          classifier: testClassifier,
        });
      },
      (err) => {
        assert.ok(
          err.message.includes('PREFLIGHT_GATEWAY_DEAD'),
          `Error should indicate gateway is dead: ${err.message}`
        );
        return true;
      }
    );

    // Verify outPath does not exist or has 0 bytes (no model FAIL rows written)
    if (fs.existsSync(outPath)) {
      const content = fs.readFileSync(outPath, 'utf8').trim();
      assert.equal(content, '', 'Never write model FAIL rows when gateway is dead');
    }
  });

  it('8. Restart resumes without duplicate rows and respects budget', async () => {
    const m1 = 'restart-test/m1';
    const m2 = 'restart-test/m2';
    const m3 = 'restart-test/m3';

    customRoutes.set(m1, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'm1' } }] }));
    });
    customRoutes.set(m2, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'm2' } }] }));
    });
    customRoutes.set(m3, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'm3' } }] }));
    });

    const outPath = makeTmpFile();

    // First batch: budget of 2 requests
    const summary1 = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: m1 }, { id: m2 }, { id: m3 }],
      outPath,
      maxRequests: 2,
      classifier: testClassifier,
    });

    assert.equal(summary1.probedCount, 2);
    assert.equal(summary1.stoppedDueToBudget, true);

    const history1 = loadHistory(outPath);
    assert.equal(history1.size, 2);

    // Second batch: resumes on same outPath, no budget
    const summary2 = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: m1 }, { id: m2 }, { id: m3 }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary2.alreadyCompleted, 2);
    assert.equal(summary2.probedCount, 1);
    assert.equal(summary2.passedCount, 1);

    const history2 = loadHistory(outPath);
    assert.equal(history2.size, 3);

    // Check raw lines in outPath: exactly 3 lines, no duplicates!
    const lines = fs
      .readFileSync(outPath, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    assert.equal(lines.length, 3, 'Must have exactly 3 rows with no duplicates');
  });

  it('9. An upstream 402 defers only proven-shared scope', async () => {
    const a1 = 'upstream-a/model-a1';
    const a2 = 'upstream-a/model-a2';
    const b1 = 'upstream-b/model-b1';
    const b2 = 'upstream-b/model-b2';

    // Upstream A fails with 402 out of credit
    customRoutes.set(a1, (req, res) => {
      res.writeHead(402, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'out of credit: provider credit exhausted' } }));
    });

    // Upstream B succeeds
    customRoutes.set(b1, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'b1' } }] }));
    });
    customRoutes.set(b2, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'b2' } }] }));
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: a1 }, { id: a2 }, { id: b1 }, { id: b2 }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.failedCount, 1); // a1
    assert.equal(summary.deferredCount, 1); // a2 deferred
    assert.equal(summary.passedCount, 2); // b1 and b2 passed

    const history = loadHistory(outPath);
    const keyA1 = buildQueueKey({ upstream: 'upstream-a', modelId: a1 });
    const keyA2 = buildQueueKey({ upstream: 'upstream-a', modelId: a2 });
    const keyB1 = buildQueueKey({ upstream: 'upstream-b', modelId: b1 });
    const keyB2 = buildQueueKey({ upstream: 'upstream-b', modelId: b2 });

    const rowA1 = history.get(keyA1);
    const rowA2 = history.get(keyA2);
    const rowB1 = history.get(keyB1);
    const rowB2 = history.get(keyB2);

    assert.equal(rowA1.status, 'FAIL');
    assert.equal(rowA1.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);

    assert.equal(rowA2.status, 'DEFERRED');
    assert.equal(rowA2.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(rowA2.scope, Scope.UPSTREAM);

    assert.equal(rowB1.status, 'PASS');
    assert.equal(rowB2.status, 'PASS');
  });

  it('10. Missing NINEROUTER_API_KEY fails preflight clearly', async () => {
    const oldEnv = process.env.NINEROUTER_API_KEY;
    delete process.env.NINEROUTER_API_KEY;

    try {
      await assert.rejects(
        async () => {
          await runPreflight({
            gatewayUrl,
            apiKey: '',
          });
        },
        (err) => {
          assert.ok(
            err.message.includes('PREFLIGHT_AUTH_MISSING'),
            `Should fail on missing auth: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      if (oldEnv) {
        process.env.NINEROUTER_API_KEY = oldEnv;
      }
    }
  });

  it('11. Key parsing and building preserve slashes in model IDs', () => {
    const item = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'kimchi',
      account: 'acct-1',
      quotaScope: 'pool-a',
      modelId: 'kimchi/glm-5.3-flash',
    };

    const key = buildQueueKey(item);
    assert.equal(key, 'http/9router/9router/kimchi/acct-1/pool-a/kimchi/glm-5.3-flash');

    const parsed = parseQueueKey(key);
    assert.equal(parsed.harness, 'http');
    assert.equal(parsed.accessPath, '9router');
    assert.equal(parsed.gateway, '9router');
    assert.equal(parsed.upstream, 'kimchi');
    assert.equal(parsed.account, 'acct-1');
    assert.equal(parsed.quotaScope, 'pool-a');
    assert.equal(parsed.modelId, 'kimchi/glm-5.3-flash');
  });

  it('12. Network failure with no HTTP response carries NO httpStatus', async () => {
    const modelId = 'test-network/model-socket-hangup';
    customRoutes.set(modelId, (req, res) => {
      // Abruptly destroy socket before writing headers to simulate network failure
      req.socket.destroy();
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      readTimeoutMs: 500,
      classifier: testClassifier,
    });

    assert.equal(summary.failedCount, 1);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-network', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'FAIL');
    assert.equal(
      row.httpStatus,
      undefined,
      'A process or network failure with no HTTP response carries NO httpStatus'
    );
    assert.equal(row.verified, undefined);
  });

  it('13. Restart retries PROBE_INVALID and expired DEFERRED, skips unexpired DEFERRED', async () => {
    const invalidModel = 'retry-test/invalid-m';
    const expiredDeferredModel = 'retry-test/expired-m';
    const activeDeferredModel = 'retry-test/active-m';
    const passedModel = 'retry-test/passed-m';

    const outPath = makeTmpFile();

    // Pre-seed history in outPath
    const now = Date.now();
    const seedRows = [
      {
        key: buildQueueKey({ upstream: 'retry-test', modelId: invalidModel }),
        harness: 'http',
        accessPath: '9router',
        gateway: '9router',
        upstream: 'retry-test',
        account: '',
        quotaScope: '',
        modelId: invalidModel,
        status: 'FAIL',
        probeInvalid: true,
        ts: new Date(now - 10000).toISOString(),
      },
      {
        key: buildQueueKey({ upstream: 'retry-test', modelId: expiredDeferredModel }),
        harness: 'http',
        accessPath: '9router',
        gateway: '9router',
        upstream: 'retry-test',
        account: '',
        quotaScope: '',
        modelId: expiredDeferredModel,
        status: 'DEFERRED',
        cooldownMs: 5000,
        cooldownExpiresAt: new Date(now - 1000).toISOString(), // Expired 1s ago
        ts: new Date(now - 6000).toISOString(),
      },
      {
        key: buildQueueKey({ upstream: 'retry-test', modelId: activeDeferredModel }),
        harness: 'http',
        accessPath: '9router',
        gateway: '9router',
        upstream: 'retry-test',
        account: '',
        quotaScope: '',
        modelId: activeDeferredModel,
        status: 'DEFERRED',
        cooldownMs: 60000,
        cooldownExpiresAt: new Date(now + 60000).toISOString(), // Expires in 60s
        ts: new Date(now).toISOString(),
      },
      {
        key: buildQueueKey({ upstream: 'retry-test', modelId: passedModel }),
        harness: 'http',
        accessPath: '9router',
        gateway: '9router',
        upstream: 'retry-test',
        account: '',
        quotaScope: '',
        modelId: passedModel,
        status: 'PASS',
        ts: new Date(now - 5000).toISOString(),
      },
    ];

    for (const r of seedRows) {
      fs.appendFileSync(outPath, JSON.stringify(r) + '\n', 'utf8');
    }

    // Configure routes for the models that should be retried
    customRoutes.set(invalidModel, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'invalid recovered' } }] }));
    });
    customRoutes.set(expiredDeferredModel, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'expired recovered' } }] }));
    });

    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [
        { id: invalidModel },
        { id: expiredDeferredModel },
        { id: activeDeferredModel },
        { id: passedModel },
      ],
      outPath,
      classifier: testClassifier,
    });

    // Only invalidModel and expiredDeferredModel should be probed
    assert.equal(summary.probedCount, 2);
    assert.equal(summary.passedCount, 2);

    const history = loadHistory(outPath);
    assert.equal(
      history.get(buildQueueKey({ upstream: 'retry-test', modelId: invalidModel })).status,
      'PASS'
    );
    assert.equal(
      history.get(buildQueueKey({ upstream: 'retry-test', modelId: expiredDeferredModel })).status,
      'PASS'
    );
    // activeDeferredModel remains DEFERRED
    assert.equal(
      history.get(buildQueueKey({ upstream: 'retry-test', modelId: activeDeferredModel })).status,
      'DEFERRED'
    );
    // passedModel remains PASS
    assert.equal(
      history.get(buildQueueKey({ upstream: 'retry-test', modelId: passedModel })).status,
      'PASS'
    );
  });

  it('14. Adaptive worker pool drops concurrency on 429 and scales up on steady latency', () => {
    const { AdaptiveWorkerPool } = require('../probe-runner/pool');

    const pool = new AdaptiveWorkerPool({
      concurrency: 2,
      maxConcurrency: 6,
    });

    assert.equal(pool.currentConcurrency, 2);

    // Simulate steady successes
    for (let i = 0; i < 4; i++) {
      pool.beginRequest();
      pool.recordOutcome({ httpStatus: 200, latencyMs: 200 });
    }
    // Raised to 4
    assert.equal(pool.currentConcurrency, 4);

    for (let i = 0; i < 4; i++) {
      pool.beginRequest();
      pool.recordOutcome({ httpStatus: 200, latencyMs: 200 });
    }
    // Raised to 6
    assert.equal(pool.currentConcurrency, 6);

    // Receive 429: immediate backpressure drop
    pool.beginRequest();
    pool.recordOutcome({ httpStatus: 429, latencyMs: 100 });
    assert.equal(pool.currentConcurrency, 4);

    // Receive timeout: drops further
    pool.beginRequest();
    pool.recordOutcome({ isReadTimeout: true, latencyMs: 15000 });
    assert.equal(pool.currentConcurrency, 2);
  });

  it('15. HTTP 200 with tool_calls only records PASS with responseKind=tool_calls', async () => {
    const modelId = 'test-tool-calls/model-agent';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                content: '',
                tool_calls: [
                  { function: { name: 'grep_search', arguments: '{}' } },
                  { function: { name: 'run_in_terminal', arguments: '{}' } },
                ],
              },
            },
          ],
        })
      );
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.passedCount, 1);
    assert.equal(summary.failedCount, 0);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-tool-calls', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'PASS');
    assert.equal(row.httpStatus, 200);
    assert.equal(row.responseKind, 'tool_calls');
    assert.ok(Array.isArray(row.toolCalls));
    assert.equal(row.toolCalls.length, 2);
    assert.ok(row.toolCalls.includes('grep_search'));
    assert.ok(row.toolCalls.includes('run_in_terminal'));
    assert.equal(row.verified, undefined);
  });

  it('16. Length-truncated empty response (finish_reason=length) returns PROBE_INVALID', async () => {
    const modelId = 'test-reasoning/model-truncated';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'length',
              message: {
                content: '',
                reasoning_content: 'Long reasoning trace that consumed all tokens...',
              },
            },
          ],
        })
      );
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.passedCount, 0);
    assert.equal(summary.failedCount, 1); // PROBE_INVALID counts as failed for budget

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-reasoning', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'PROBE_INVALID');
    assert.equal(row.httpStatus, 200);
    assert.equal(row.finishReason, 'length');
    assert.ok(row.probeInvalid === true);
    assert.ok(row.cooldownMs > 0);
    assert.equal(row.verified, undefined);
  });

  it('17. HTTP 400 with [400] Arrearage body extracts inner 400 for classifier', async () => {
    const modelId = 'test-arrearage/model-billing';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              '[400]: {"error":{"message":"Access denied, please make sure your account is in good standing...","type":"Arrearage"}}',
            type: 'invalid_request_error',
          },
        })
      );
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.failedCount, 1);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-arrearage', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'FAIL');
    assert.equal(row.httpStatus, 400);
    // Classifier should see inner 400 with Arrearage -> upstream_entitlement
    assert.equal(row.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(row.scope, Scope.UPSTREAM);
    assert.equal(row.verified, undefined);
  });

  it('18. HTTP 503 with nested [403] body extracts inner 403 for classifier', async () => {
    const modelId = 'test-nested-403/model-entitlement';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('503 Service Unavailable: [403]: {"error":{"message":"Model access is disabled"}}');
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.failedCount, 1);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-nested-403', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'FAIL');
    assert.equal(row.httpStatus, 503);
    // Classifier should see inner 403 -> upstream_entitlement
    assert.equal(row.cause, Cause.UPSTREAM_ENTITLEMENT);
    assert.equal(row.scope, Scope.UPSTREAM);
    assert.equal(row.verified, undefined);
  });

  it('19. HTTP 503 with [402] credit exhausted body extracts inner 402 for classifier', async () => {
    const modelId = 'test-nested-402/model-credit';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              '[codebuddy-intl/glm-5.2] [429]: {"error":{"data":{"code":14018,"msg":"Credits exhausted..."}}}',
          },
        })
      );
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.failedCount, 1);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-nested-402', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'FAIL');
    assert.equal(row.httpStatus, 503);
    // Classifier should see inner 429 -> upstream_credit_exhausted (or rate_limit)
    // Our test classifier matches 429 with credit exhausted -> upstream_credit_exhausted
    assert.equal(row.cause, Cause.UPSTREAM_CREDIT_EXHAUSTED);
    assert.equal(row.scope, Scope.UPSTREAM);
    assert.equal(row.verified, undefined);
  });

  it('20. Decisions model returns UNSUPPORTED_BY_PROBE', async () => {
    const modelId = 'test-decisions/model-jev';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message:
              '[400]: {"error":{"message":"typesafe/jev-1.13 is a decisions model and cannot be used with the chat/completions endpoint..."}}',
          },
        })
      );
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.passedCount, 0);
    assert.equal(summary.failedCount, 0); // UNSUPPORTED_BY_PROBE not counted as failed

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-decisions', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'UNSUPPORTED_BY_PROBE');
    assert.equal(row.httpStatus, 400);
    assert.equal(row.cause, 'unsupported_by_probe');
    assert.equal(row.scope, 'model');
    assert.equal(row.cooldownMs, null);
    assert.equal(row.cooldownExpiresAt, null);
    assert.ok(row.reason.includes('decisions_endpoint_required'));
    assert.equal(row.verified, undefined);
  });

  it('21. Embeddings model returns UNSUPPORTED_BY_PROBE', async () => {
    const modelId = 'test-embeddings/model-embed';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'This is an embeddings model, use /embeddings endpoint instead',
          },
        })
      );
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.passedCount, 0);
    assert.equal(summary.failedCount, 0);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-embeddings', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'UNSUPPORTED_BY_PROBE');
    assert.ok(row.reason.includes('embeddings_endpoint_required'));
  });

  it('22. Image generation model returns UNSUPPORTED_BY_PROBE', async () => {
    const modelId = 'test-image/model-dalle';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'This is an image generation model, use /images/generations endpoint',
          },
        })
      );
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.passedCount, 0);
    assert.equal(summary.failedCount, 0);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-image', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'UNSUPPORTED_BY_PROBE');
    assert.ok(row.reason.includes('images_endpoint_required'));
  });

  it('23. SSE stream with tool_calls in delta records PASS with responseKind=tool_calls', async () => {
    const modelId = 'test-sse-tool-calls/model-stream-agent';
    customRoutes.set(modelId, (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"grep_search"}}]}}]}\n\n'
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });

    const outPath = makeTmpFile();
    const summary = await runProbeBatch({
      gatewayUrl,
      apiKey: 'test-token',
      catalogue: [{ id: modelId }],
      outPath,
      classifier: testClassifier,
    });

    assert.equal(summary.passedCount, 1);

    const history = loadHistory(outPath);
    const key = buildQueueKey({ upstream: 'test-sse-tool-calls', modelId });
    const row = history.get(key);

    assert.ok(row);
    assert.equal(row.status, 'PASS');
    assert.equal(row.responseKind, 'tool_calls');
    assert.ok(Array.isArray(row.toolCalls));
    assert.equal(row.toolCalls.length, 1);
    assert.ok(row.toolCalls.includes('grep_search'));
  });

  it('15. Absent canonical classifier fails with clear message naming dependency when unpassed', async () => {
    const outPath = makeTmpFile();
    const classifierPath = require('../probe-runner').CANONICAL_CLASSIFIER_PATH;
    let classifierExisted = false;
    let backupPath = null;

    // Temporarily remove canonical classifier to test missing dependency error
    if (fs.existsSync(classifierPath)) {
      classifierExisted = true;
      backupPath = classifierPath + '.bak';
      fs.renameSync(classifierPath, backupPath);
    }

    // Clear require cache so the missing file is detected
    if (require.cache[classifierPath]) {
      delete require.cache[classifierPath];
    }
    // Also clear the runner module cache since it may have cached the classifier
    const runnerPath = require.resolve('../probe-runner');
    if (require.cache[runnerPath]) {
      delete require.cache[runnerPath];
    }
    // Re-require to get fresh module
    const { runProbeBatch: freshRunProbeBatch } = require('../probe-runner');

    try {
      await assert.rejects(
        async () => {
          await freshRunProbeBatch({
            gatewayUrl,
            apiKey: 'test-token',
            catalogue: [{ id: 'test/model' }],
            outPath,
          });
        },
        (err) => {
          assert.ok(
            err.message.includes('failure-classifier.js'),
            `Error should name failure-classifier.js: ${err.message}`
          );
          assert.ok(
            err.message.includes('PR #144') || err.message.includes('brain-failure-classes'),
            `Error should name PR #144 or branch: ${err.message}`
          );
          return true;
        }
      );
    } finally {
      // Restore canonical classifier
      if (classifierExisted && backupPath && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, classifierPath);
      }
      // Clear cache again so subsequent tests get the classifier
      if (require.cache[classifierPath]) {
        delete require.cache[classifierPath];
      }
      if (require.cache[runnerPath]) {
        delete require.cache[runnerPath];
      }
    }
  });
});
