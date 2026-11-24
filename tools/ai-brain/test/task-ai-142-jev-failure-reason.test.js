'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jev = require('../jev');

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

// The live JEV call: combo-jev-select asks a select-combo-member question through
// jev.advise, which maps a failed ask to a reason with jev.failureReason.
function question() {
  return {
    kind: 'select-combo-member',
    prompt: 'pick the single best option ID',
    evidence: JSON.stringify({ task: { complexity: 'standard' }, members: [] }),
    options: ['M0', 'M1'],
  };
}

async function reasonFor(ask) {
  const result = await jev.advise(question(), { ask });
  const text = JSON.stringify(result);
  assert.equal(text.includes(SECRET), false);
  assert.equal(result.outcome, jev.Outcome.UNDECIDED);
  assert.notEqual(result.reason, 'UNREACHABLE');
  return result.reason;
}

function askWith(httpClient, env) {
  return jev.buildJevAsk(source(), {
    env: env || { TYPESAFE_API_KEY: SECRET },
    home: '/nonexistent-home-for-test',
    httpClient,
  });
}

test('missing credential is reported as CREDENTIAL_MISSING', async () => {
  assert.equal(await reasonFor(askWith(async () => ({}), {})), 'CREDENTIAL_MISSING');
});

test('timeout is reported as TIMEOUT', async () => {
  const reason = await reasonFor(
    askWith(async () => {
      throw new Error('JEV_TIMEOUT');
    })
  );
  assert.equal(reason, 'TIMEOUT');
});

test('HTTP status is reported as HTTP_<status>', async () => {
  const reason = await reasonFor(
    askWith(async () => {
      throw new Error('JEV_HTTP_422');
    })
  );
  assert.equal(reason, 'HTTP_422');
});

test('unparseable body is reported as INVALID_RESPONSE', async () => {
  const reason = await reasonFor(
    askWith(async () => {
      JSON.parse('<html>');
    })
  );
  assert.equal(reason, 'INVALID_RESPONSE');
});

test('socket failure is reported as NETWORK_ERROR', async () => {
  const reason = await reasonFor(
    askWith(async () => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:1');
      err.code = 'ECONNREFUSED';
      throw err;
    })
  );
  assert.equal(reason, 'NETWORK_ERROR');
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
    assert.equal(await reasonFor(ask), 'HTTP_422');
    mode = 'html';
    assert.equal(await reasonFor(ask), 'INVALID_RESPONSE');
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
