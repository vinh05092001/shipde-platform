'use strict';

// The Controller launches workers with cp.spawnSync, which blocks this
// process's event loop for minutes. A JEV request made after that block must
// not reuse a pooled keep-alive socket the server closed meanwhile, or the
// request fails with ECONNRESET and JEV silently falls back.

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('child_process');
const { buildJevAsk } = require('../jev');

// The server runs in its own process so blocking this process blocks only the
// client, as spawnSync does in the Controller.
const SERVER_SCRIPT = `
const http = require('http');
const server = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const body = JSON.stringify({ choice: 'M0', confidence: 0.9 });
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    res.end(body);
    // Close the idle socket shortly after the response, as a server does when
    // its keep-alive timeout passes while the client is blocked.
    res.on('finish', () => setTimeout(() => req.socket.destroy(), 30));
  });
});
server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
`;

function startServer(t) {
  const child = cp.spawn(process.execPath, ['-e', SERVER_SCRIPT], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => child.kill());
  return new Promise((resolve, reject) => {
    child.stdout.once('data', (chunk) => resolve(Number(String(chunk).trim())));
    child.once('exit', (code) => reject(new Error('fixture server exited early: ' + code)));
  });
}

function blockEventLoop(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

test('JEV ask after a synchronous event-loop block does not reuse a closed keep-alive socket', async (t) => {
  const port = await startServer(t);
  const source = {
    kind: 'decision-service',
    endpoint: 'http://127.0.0.1:' + port + '/v1/systemone',
    model: 'jev-test',
    credential: { type: 'api-key', env: 'JEV_TEST_KEY' },
  };
  const ask = buildJevAsk(source, { env: { JEV_TEST_KEY: 'test-not-a-key' } });
  const question = { kind: 'select-combo-member', prompt: 'pick', options: ['M0', 'M1'] };

  const first = await ask(question);
  assert.equal(first.choice, 'M0');

  // Longer than the server keep-alive timeout, like a worker run under spawnSync.
  blockEventLoop(200);

  const second = await ask(question);
  assert.equal(second.choice, 'M0');
});
