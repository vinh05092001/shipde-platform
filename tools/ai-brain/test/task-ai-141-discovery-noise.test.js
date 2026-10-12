'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverSources } = require('../source-discovery');

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-noise-'));
  const write = (rel, data) => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };
  return { dir, write };
}

test('session history and repository links are not model sources', () => {
  const { dir, write } = home();
  write('.cline/data/sessions/1/1.json', { url: 'https://github.com/acme/repo.git' });
  write('.gemini/antigravity/brain/abc/scratch/x.json', { baseURL: 'https://api.example.ai/v1' });
  write('.cline-real/data/settings/providers.json', {
    providers: { openai: { baseURL: 'https://api.real.ai/v1' } },
  });
  const sources = discoverSources({ home: dir, env: {}, localAppData: path.join(dir, 'local') });
  const endpoints = sources.map((source) => source.endpoint);
  assert.ok(!endpoints.some((endpoint) => /github\.com/.test(endpoint || '')));
  assert.ok(!endpoints.includes('https://api.example.ai/v1'));
  assert.ok(endpoints.includes('https://api.real.ai/v1'));
});

test('an endpoint known with an env credential drops its credential-less file copies', () => {
  const { dir, write } = home();
  write('.config/opencode/opencode.json', {
    provider: {
      bai3: { options: { baseURL: 'https://api.b.ai/v1', apiKey: '{env:BAI_API_KEY_3}' } },
    },
  });
  write('.cline-bai3/data/settings/providers.json', {
    providers: { openai: { baseURL: 'https://api.b.ai/v1/' } },
  });
  const sources = discoverSources({
    home: dir,
    env: { BAI_API_KEY_3: 'x' },
    localAppData: path.join(dir, 'local'),
  });
  const bai = sources.filter((source) => /api\.b\.ai/.test(source.endpoint || ''));
  assert.equal(bai.length, 1);
  assert.equal(bai[0].credential.type, 'env');
  assert.equal(bai[0].credential.name, 'BAI_API_KEY_3');
});

test('a credential-less endpoint with no env twin is kept for the inventory', () => {
  const { dir, write } = home();
  write('.cline-kios/data/settings/providers.json', {
    providers: { openai: { baseURL: 'https://kiosapi.com/v1' } },
  });
  const sources = discoverSources({ home: dir, env: {}, localAppData: path.join(dir, 'local') });
  assert.ok(sources.some((source) => source.endpoint === 'https://kiosapi.com/v1'));
});
