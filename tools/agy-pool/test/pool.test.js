'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildProfiles, ensureProfiles, resolveProfile } = require('../pool');
const { createPoolServer } = require('../server');

test('creates exactly four isolated Agy profiles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-agy-pool-'));
  const profiles = buildProfiles({ SHIPDE_AGY_POOL_ROOT: root });
  assert.equal(profiles.length, 4);
  assert.equal(new Set(profiles.map((profile) => profile.home)).size, 4);
  ensureProfiles(profiles);
  for (const profile of profiles) assert.equal(fs.existsSync(profile.home), true);
});

test('refuses unknown profile ids', () => {
  assert.throws(() =>
    resolveProfile(buildProfiles({ SHIPDE_AGY_POOL_ROOT: os.tmpdir() }), 'agy-5')
  );
});

function request(port, method, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: pathname, headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('requires confirmation token and launches only the selected pinned profile', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-agy-server-'));
  const launches = [];
  const profiles = buildProfiles({ SHIPDE_AGY_POOL_ROOT: root });
  const instance = createPoolServer({
    root,
    profiles,
    workspace: root,
    actionToken: 'test-token',
    launcher(input) {
      launches.push(input);
      return 4321;
    },
  });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  context.after(() => instance.server.close());
  const port = instance.server.address().port;

  const denied = await request(port, 'POST', '/api/profiles/agy-1/open');
  assert.equal(denied.status, 403);
  const accepted = await request(port, 'POST', '/api/profiles/agy-2/login', {
    'X-Shipde-Action-Token': 'test-token',
  });
  assert.equal(accepted.status, 202);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].profile.id, 'agy-2');
  assert.equal(launches[0].mode, 'Login');
});
