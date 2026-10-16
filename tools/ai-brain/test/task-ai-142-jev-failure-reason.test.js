'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jev = require('../jev');
const routing = require('../routing');

const SECRET = 'never-print-this-key';

function source(endpoint) {
  return {
    id: 'jev',
    kind: 'decision-service',
    endpoint: endpoint || 'https://jev.example/ask',
    model: 'jev-latest',
    credential: { env: 'TYPESAFE_API_KEY' },
    mayWriteCode: false,
  };
}

function profile() {
  return {
    taskId: 'TASK-AI-142-H3',
    role: 'writer',
    complexity: 'standard',
    requiredCapabilities: [],
    proofFloor: 'NONE',
    contextSize: 1000,
    expectedDuration: 10000,
    latencyPriority: 'normal',
    qualityFloor: 0,
    costCeiling: 100,
    requiredHarness: null,
    forbiddenFailureDomains: [],
    riskDomains: [],
  };
}

async function reasonCodesFor(ask) {
  const assessment = await routing.assessTask(profile(), { ask });
  const text = JSON.stringify(assessment);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes('UNREACHABLE'), false);
  return assessment.reasonCodes;
}

function askWith(httpClient, env) {
  return jev.buildJevAsk(source(), {
    env: env || { TYPESAFE_API_KEY: SECRET },
    home: '/nonexistent-home-for-test',
    httpClient,
  });
}

test('missing credential is reported as CREDENTIAL_MISSING', async () => {
  const codes = await reasonCodesFor(askWith(async () => ({}), {}));
  assert.ok(codes.includes('JEV_UNDECIDED:CREDENTIAL_MISSING'), codes.join(','));
});

test('timeout is reported as TIMEOUT', async () => {
  const codes = await reasonCodesFor(
    askWith(async () => {
      throw new Error('JEV_TIMEOUT');
    })
  );
  assert.ok(codes.includes('JEV_UNDECIDED:TIMEOUT'), codes.join(','));
});

test('HTTP status is reported as HTTP_<status>', async () => {
  const codes = await reasonCodesFor(
    askWith(async () => {
      throw new Error('JEV_HTTP_422');
    })
  );
  assert.ok(codes.includes('JEV_UNDECIDED:HTTP_422'), codes.join(','));
});

test('unparseable body is reported as INVALID_RESPONSE', async () => {
  const codes = await reasonCodesFor(
    askWith(async () => {
      JSON.parse('<html>');
    })
  );
  assert.ok(codes.includes('JEV_UNDECIDED:INVALID_RESPONSE'), codes.join(','));
});

test('socket failure is reported as NETWORK_ERROR', async () => {
  const codes = await reasonCodesFor(
    askWith(async () => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:1');
      err.code = 'ECONNREFUSED';
      throw err;
    })
  );
  assert.ok(codes.includes('JEV_UNDECIDED:NETWORK_ERROR'), codes.join(','));
});

test('real transport maps HTTP status and invalid JSON without echoing the body', async () => {
  let mode = 'status';
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (mode === 'status') {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end('{"error":"schema says no ' + SECRET + '"}');
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>' + SECRET + '</html>');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/ask';
    const ask = jev.buildJevAsk(source(url), { env: { TYPESAFE_API_KEY: SECRET } });
    assert.ok((await reasonCodesFor(ask)).includes('JEV_UNDECIDED:HTTP_422'));
    mode = 'html';
    assert.ok((await reasonCodesFor(ask)).includes('JEV_UNDECIDED:INVALID_RESPONSE'));
  } finally {
    server.close();
  }
});

test('the new causes count as provider failures', () => {
  for (const reason of ['CREDENTIAL_MISSING', 'TIMEOUT', 'HTTP_503', 'INVALID_RESPONSE']) {
    assert.equal(jev.isProviderFailure(reason), true, reason);
  }
  assert.equal(jev.isProviderFailure('NETWORK_ERROR'), true);
  assert.equal(jev.isProviderFailure('LOW_CONFIDENCE'), false);
});
