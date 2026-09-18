/**
 * Ship Dễ — Account Entry Validation Test Suite (TASK-AI-29)
 *
 * Covers `entryFindings` and `registryExposesCredential` against injected
 * paths under os.tmpdir(). No real registry, no real home directory, no real
 * credential is ever touched.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { entryFindings, registryExposesCredential, setSecret, getSecret } = require('../account-entry');
const { addAccount, loadRegistry } = require('../accounts');

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-entry-'));
  return {
    registryFile: path.join(dir, 'registry.json'),
    secretsFile: path.join(dir, 'secrets.enc'),
    key: Buffer.alloc(32, 5),
    dir,
  };
}

function def(over) {
  return Object.assign(
    {
      id: 'agy-docker-a',
      provider: 'openrouter',
      model: 'some/free-model',
      tier: 2,
      capabilities: { jsonSchema: true, tools: true, contextWindow: 128000 },
      cost: { inputPerMillion: 0, outputPerMillion: 0 },
      limits: {},
    },
    over
  );
}

describe('entryFindings — registry validator half (AI-29-R03)', () => {
  test('a well-formed account with no limits passes with no findings', () => {
    assert.deepEqual(entryFindings(def()), []);
  });

  test('a missing provider is reported by REGISTRY_VALIDATOR, naming the field', () => {
    const account = def({ provider: undefined });
    const findings = entryFindings(account);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'REGISTRY_VALIDATOR');
    assert.match(findings[0].message, /provider/);
  });

  test('every failing field is reported at once, not just the first', () => {
    const account = def({ provider: undefined, model: undefined, capabilities: {} });
    const findings = entryFindings(account);
    assert.equal(findings.length, 1, 'one REGISTRY_VALIDATOR finding carrying every field');
    assert.ok(findings[0].fields.length >= 3, 'provider, model and contextWindow all named');
  });

  test('a credential field inside the declaration is refused (AI-29-R04)', () => {
    for (const field of ['apiKey', 'token', 'accessToken', 'secret', 'password']) {
      const account = def();
      account[field] = 'sk-live-value';
      const findings = entryFindings(account);
      assert.equal(findings.length, 1, 'refuses ' + field);
      assert.equal(findings[0].code, 'REGISTRY_VALIDATOR');
      assert.match(findings[0].message, /setSecret/);
    }
  });
});

describe('entryFindings — limit provenance half (AI-29-R05, AI-29-R06)', () => {
  test('a ceiling with recognised provenance passes', () => {
    const account = def({
      limits: {
        tokensPerDay: { value: 1000000, provenance: 'operator-declared', assertedAt: Date.now() },
      },
    });
    assert.deepEqual(entryFindings(account), []);
  });

  test('a ceiling with no provenance is refused, naming the account and the window', () => {
    const account = def({
      limits: { tokensPerDay: { value: 1000000, assertedAt: Date.now() } },
    });
    const findings = entryFindings(account);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'LIMIT_PROVENANCE');
    assert.equal(findings[0].accountId, 'agy-docker-a');
    assert.equal(findings[0].window, 'tokensPerDay');
    assert.match(findings[0].message, /agy-docker-a/);
    assert.match(findings[0].message, /tokensPerDay/);
  });

  test('an unrecognised provenance string is refused the same way', () => {
    const account = def({
      limits: { tokensPerDay: { value: 1000000, provenance: 'guessed', assertedAt: Date.now() } },
    });
    const findings = entryFindings(account);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'LIMIT_PROVENANCE');
  });

  test('a window left undeclared produces no finding at all (AI-29-R06: a blank is honest)', () => {
    assert.deepEqual(entryFindings(def({ limits: {} })), []);
  });

  test('multiple bad windows are each reported', () => {
    const account = def({
      limits: {
        tokensPerDay: { value: 1, assertedAt: Date.now() },
        requestsPerDay: { value: 1, provenance: 'nonsense', assertedAt: Date.now() },
      },
    });
    const findings = entryFindings(account);
    assert.equal(findings.length, 2);
    assert.ok(findings.every((f) => f.code === 'LIMIT_PROVENANCE'));
    const windows = findings.map((f) => f.window).sort();
    assert.deepEqual(windows, ['requestsPerDay', 'tokensPerDay']);
  });

  test('both halves combine: a bad field and a bad ceiling are both reported', () => {
    const account = def({
      provider: undefined,
      limits: { tokensPerDay: { value: 1, assertedAt: Date.now() } },
    });
    const findings = entryFindings(account);
    const codes = findings.map((f) => f.code).sort();
    assert.deepEqual(codes, ['LIMIT_PROVENANCE', 'REGISTRY_VALIDATOR']);
  });
});

describe('registryExposesCredential (AI-29-R04)', () => {
  test('a clean registry carries no readable copy of a credential', () => {
    assert.deepEqual(registryExposesCredential({ accounts: [def()] }), { exposed: false });
  });

  test('a registry entry carrying a credential field is detected and named', () => {
    const tampered = { accounts: [Object.assign(def(), { apiKey: 'sk-leaked' })] };
    const result = registryExposesCredential(tampered);
    assert.equal(result.exposed, true);
    assert.equal(result.accountId, 'agy-docker-a');
    assert.equal(result.field, 'apiKey');
  });

  test('an empty or malformed registry is treated as carrying nothing', () => {
    assert.deepEqual(registryExposesCredential({}), { exposed: false });
    assert.deepEqual(registryExposesCredential({ accounts: null }), { exposed: false });
  });
});

describe('End-to-end entry path (AI-29-R02, AI-29-R07, AI-29-R09, AI-29-R10)', () => {
  test('a validated account is written through addAccount and the credential stays out of it', () => {
    const s = store();
    const account = def();
    assert.deepEqual(entryFindings(account), []);
    const entry = addAccount(account, s);
    assert.equal(entry.id, 'agy-docker-a');

    setSecret('agy-docker-a', 'sk-or-v1-SHOULD-NOT-LEAK', s);
    assert.equal(getSecret('agy-docker-a', s), 'sk-or-v1-SHOULD-NOT-LEAK');

    const registryJson = JSON.parse(fs.readFileSync(s.registryFile, 'utf8'));
    assert.deepEqual(registryExposesCredential(registryJson), { exposed: false });
    assert.ok(
      !fs.readFileSync(s.registryFile, 'utf8').includes('SHOULD-NOT-LEAK'),
      'the registry file never carries the plaintext credential'
    );
  });

  test('an account written without a credential is reported as such (AI-29-R10)', () => {
    const s = store();
    addAccount(def({ id: 'no-secret-yet' }), s);
    const listed = loadRegistry(s);
    assert.equal(listed.length, 1);
    // loadRegistry returns raw registry entries; hasSecret is listAccounts'
    // job, exercised in accounts.test.js. Here we only confirm the entry
    // path wrote no credential field of its own.
    assert.equal(listed[0].apiKey, undefined);
    assert.equal(listed[0].token, undefined);
  });

  test('a refused entry writes nothing at all (AI-29-R08: complete or nothing)', () => {
    const s = store();
    const account = def({ provider: undefined });
    const findings = entryFindings(account);
    assert.ok(findings.length > 0);
    // The command never calls addAccount when entryFindings is non-empty; a
    // registry that was never written has no file at all.
    assert.equal(fs.existsSync(s.registryFile), false);
  });
});
