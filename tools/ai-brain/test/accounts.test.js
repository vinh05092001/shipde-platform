/**
 * Ship Dễ — Account Registry and Escalation Test Suite
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  Tier,
  loadKey,
  addAccount,
  listAccounts,
  updateAccount,
  removeAccount,
  setSecret,
  getSecret,
  hasSecret,
  validateAccount,
  tiersOf,
} = require('../accounts');
const { planDispatch } = require('../scheduler');

const NOW = Date.parse('2026-09-14T12:00:00Z');
const hoursAgo = (n) => NOW - n * 3600000;

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-acct-'));
  return {
    registryFile: path.join(dir, 'registry.json'),
    secretsFile: path.join(dir, 'secrets.enc'),
    key: Buffer.alloc(32, 7),
    dir,
  };
}

function def(over) {
  return Object.assign(
    {
      id: 'openrouter-free',
      provider: 'openrouter',
      model: 'some/free-model',
      capabilities: { jsonSchema: true, tools: true, contextWindow: 128000 },
      cost: { inputPerMillion: 0, outputPerMillion: 0 },
      tier: Tier.EXTERNAL,
      limits: {},
    },
    over
  );
}

describe('Account registry', () => {
  test('an added account is listed back', () => {
    const s = store();
    addAccount(def(), s);
    const all = listAccounts(s);
    assert.equal(all.length, 1);
    assert.equal(all[0].id, 'openrouter-free');
    assert.equal(all[0].enabled, true, 'accounts arrive enabled');
  });

  test('a duplicate id is refused', () => {
    const s = store();
    addAccount(def(), s);
    assert.throws(() => addAccount(def(), s), /Đã có tài khoản/);
  });

  test('an id with unsafe characters is refused', () => {
    const s = store();
    for (const bad of ['../escape', 'has space', 'UPPER', 'x', '']) {
      assert.throws(() => addAccount(def({ id: bad }), s), /không hợp lệ/, 'refuses id: ' + bad);
    }
  });

  test('a missing context window is refused rather than defaulted', () => {
    const s = store();
    assert.throws(
      () => addAccount(def({ capabilities: { jsonSchema: true, tools: true } }), s),
      /contextWindow/
    );
  });

  test('a credential passed inside the registry object is refused', () => {
    // Accepting it would write a live key into the readable registry file.
    const s = store();
    for (const field of ['apiKey', 'token', 'accessToken', 'secret', 'password']) {
      const account = def({ id: 'acct-' + field.toLowerCase() });
      account[field] = 'sk-live-value';
      assert.throws(() => addAccount(account, s), /dùng setSecret/, 'refuses ' + field);
    }
  });

  test('an invalid tier is refused', () => {
    const s = store();
    assert.throws(() => addAccount(def({ tier: 9 }), s), /tier phải là/);
  });
});

describe('Secret handling', () => {
  test('a stored secret round-trips', () => {
    const s = store();
    addAccount(def(), s);
    setSecret('openrouter-free', 'sk-or-v1-abcdef', s);
    assert.equal(getSecret('openrouter-free', s), 'sk-or-v1-abcdef');
  });

  test('the secret never appears in the registry file', () => {
    const s = store();
    addAccount(def(), s);
    setSecret('openrouter-free', 'sk-or-v1-SHOULD-NOT-LEAK', s);
    const registry = fs.readFileSync(s.registryFile, 'utf8');
    assert.ok(!registry.includes('SHOULD-NOT-LEAK'), 'registry stays readable and inert');
  });

  test('the secret is not stored in plaintext anywhere', () => {
    const s = store();
    addAccount(def(), s);
    setSecret('openrouter-free', 'sk-or-v1-SHOULD-NOT-LEAK', s);
    const encrypted = fs.readFileSync(s.secretsFile, 'utf8');
    assert.ok(
      !encrypted.includes('SHOULD-NOT-LEAK'),
      'the secrets file is ciphertext, not the key'
    );
  });

  test('listAccounts reports presence but never the value', () => {
    const s = store();
    addAccount(def(), s);
    setSecret('openrouter-free', 'sk-or-v1-SHOULD-NOT-LEAK', s);
    const listed = listAccounts(s);
    assert.equal(listed[0].hasSecret, true);
    assert.ok(
      !JSON.stringify(listed).includes('SHOULD-NOT-LEAK'),
      'a listing is safe to show on a dashboard'
    );
  });

  test('a wrong key fails loudly instead of returning garbage', () => {
    const s = store();
    addAccount(def(), s);
    setSecret('openrouter-free', 'sk-or-v1-abcdef', s);
    const wrong = Object.assign({}, s, { key: Buffer.alloc(32, 9) });
    assert.throws(() => getSecret('openrouter-free', wrong));
  });

  test('a secret for an unknown account is refused', () => {
    const s = store();
    assert.throws(() => setSecret('ghost', 'x', s), /Không có tài khoản/);
  });

  test('removing an account destroys its secret', () => {
    const s = store();
    addAccount(def(), s);
    setSecret('openrouter-free', 'sk-or-v1-abcdef', s);
    removeAccount('openrouter-free', s);
    assert.equal(hasSecret('openrouter-free', s), false);
    assert.equal(getSecret('openrouter-free', s), null);
  });

  test('updating an account keeps its secret', () => {
    const s = store();
    addAccount(def(), s);
    setSecret('openrouter-free', 'sk-or-v1-abcdef', s);
    updateAccount('openrouter-free', { limits: { requestsPerDay: 50 } }, s);
    assert.equal(getSecret('openrouter-free', s), 'sk-or-v1-abcdef');
    assert.equal(listAccounts(s)[0].limits.requestsPerDay, 50);
  });

  test('a short SHIPDE_ACCOUNT_KEY throws naming the real problem and required length (Finding #5)', () => {
    const origEnv = process.env.SHIPDE_ACCOUNT_KEY;
    try {
      process.env.SHIPDE_ACCOUNT_KEY = 'short-key-under-32';
      assert.throws(
        () => loadKey(),
        (err) => {
          assert.match(err.message, /SHIPDE_ACCOUNT_KEY/);
          assert.match(err.message, /32/);
          return true;
        }
      );

      // Verify setSecret and getSecret also throw when no explicit key option is given
      const s = store();
      addAccount(def(), s);
      assert.throws(
        () =>
          setSecret('openrouter-free', 'sk-secret-123', {
            registryFile: s.registryFile,
            secretsFile: s.secretsFile,
          }),
        /SHIPDE_ACCOUNT_KEY.*32/
      );
    } finally {
      if (origEnv !== undefined) {
        process.env.SHIPDE_ACCOUNT_KEY = origEnv;
      } else {
        delete process.env.SHIPDE_ACCOUNT_KEY;
      }
    }
  });

  test('a valid SHIPDE_ACCOUNT_KEY (>= 32 chars) is accepted and used', () => {
    const origEnv = process.env.SHIPDE_ACCOUNT_KEY;
    try {
      process.env.SHIPDE_ACCOUNT_KEY = 'valid-env-account-key-test-fixture-32chars';
      const key = loadKey();
      assert.ok(Buffer.isBuffer(key));
      assert.equal(key.length, 32);

      const crypto = require('crypto');
      const expected = crypto.createHash('sha256').update(process.env.SHIPDE_ACCOUNT_KEY).digest();
      assert.deepEqual(key, expected);
    } finally {
      if (origEnv !== undefined) {
        process.env.SHIPDE_ACCOUNT_KEY = origEnv;
      } else {
        delete process.env.SHIPDE_ACCOUNT_KEY;
      }
    }
  });

  test('an unset SHIPDE_ACCOUNT_KEY falls back to the file key', () => {
    const origEnv = process.env.SHIPDE_ACCOUNT_KEY;
    const s = store();
    const keyFile = path.join(s.dir, 'custom.key');
    try {
      delete process.env.SHIPDE_ACCOUNT_KEY;
      const key1 = loadKey({ keyFile });
      assert.ok(Buffer.isBuffer(key1));
      assert.equal(key1.length, 32);
      assert.ok(fs.existsSync(keyFile), 'key file was created');

      const key2 = loadKey({ keyFile });
      assert.deepEqual(key1, key2, 'reads existing key file');
    } finally {
      if (origEnv !== undefined) {
        process.env.SHIPDE_ACCOUNT_KEY = origEnv;
      } else {
        delete process.env.SHIPDE_ACCOUNT_KEY;
      }
    }
  });
});

describe('Escalation ladder', () => {
  const base = {
    capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
    enabled: true,
  };
  const local = Object.assign(
    {
      id: '9router',
      provider: 'oc',
      model: 'free',
      tier: Tier.LOCAL,
      cost: { inputPerMillion: 0, outputPerMillion: 0 },
      limits: { requestsPerDay: 2 },
    },
    base
  );
  const gemini = Object.assign(
    {
      id: 'gemini',
      provider: 'ag',
      model: 'gemini-3',
      tier: Tier.ACCOUNT,
      cost: { inputPerMillion: 0, outputPerMillion: 0 },
      limits: { requestsPerDay: 2 },
    },
    base
  );
  const external = Object.assign(
    {
      id: 'openrouter',
      provider: 'or',
      model: 'paid',
      tier: Tier.EXTERNAL,
      cost: { inputPerMillion: 5, outputPerMillion: 15 },
      limits: { requestsPerDay: 100 },
    },
    base
  );
  const pool = [external, gemini, local];

  const item = { workItemId: 'A-1', role: 'author.foundation', branch: 'feat/a', riskDomains: [] };

  test('local capacity is used first even when a paid key has more headroom', () => {
    const plan = planDispatch([item], pool, { now: NOW });
    assert.equal(plan.assignments[0].accountId, '9router');
    assert.equal(plan.assignments[0].tier, Tier.LOCAL);
  });

  test('when local is exhausted it falls to the account tier, not straight to paid', () => {
    const plan = planDispatch([item], pool, {
      eventsByAccount: { '9router': [{ at: hoursAgo(1) }, { at: hoursAgo(2) }] },
      now: NOW,
    });
    assert.equal(plan.assignments[0].accountId, 'gemini');
    assert.equal(plan.assignments[0].tier, Tier.ACCOUNT);
  });

  test('only when both free tiers are exhausted does the external key run', () => {
    // This is the sequence the operator described: 9router runs dry, Gemini
    // takes over, and the added API key picks up what is left.
    const plan = planDispatch([item], pool, {
      eventsByAccount: {
        '9router': [{ at: hoursAgo(1) }, { at: hoursAgo(2) }],
        gemini: [{ at: hoursAgo(1) }, { at: hoursAgo(2) }],
      },
      now: NOW,
    });
    assert.equal(plan.assignments[0].accountId, 'openrouter');
    assert.equal(plan.assignments[0].tier, Tier.EXTERNAL);
  });

  test('every tier exhausted defers with the reason rather than overspending', () => {
    const plan = planDispatch([item], pool, {
      eventsByAccount: {
        '9router': [{ at: hoursAgo(1) }, { at: hoursAgo(2) }],
        gemini: [{ at: hoursAgo(1) }, { at: hoursAgo(2) }],
        openrouter: Array.from({ length: 100 }, () => ({ at: hoursAgo(1) })),
      },
      now: NOW,
    });
    assert.equal(plan.assignments.length, 0);
    assert.equal(plan.deferred[0].reason, 'NO_QUOTA_OR_BUSY');
  });

  test('a cooling account is skipped and the next tier serves', () => {
    const cooling = Object.assign({}, local, {
      cooldownUntil: new Date(NOW + 300000).toISOString(),
    });
    const plan = planDispatch([item], [external, gemini, cooling], { now: NOW });
    assert.equal(plan.assignments[0].accountId, 'gemini');
  });

  test('tiersOf groups and orders lowest first', () => {
    const tiers = tiersOf(pool);
    assert.deepEqual(
      tiers.map((t) => t.tier),
      [Tier.LOCAL, Tier.ACCOUNT, Tier.EXTERNAL]
    );
  });

  test('a newly added account joins the ladder without touching any workflow', () => {
    const s = store();
    addAccount(def({ id: 'new-free-api', tier: Tier.EXTERNAL }), s);
    const registered = listAccounts(s)[0];
    const withNew = pool.concat([
      Object.assign({}, registered, {
        capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
      }),
    ]);
    const plan = planDispatch([item], withNew, {
      eventsByAccount: {
        '9router': [{ at: hoursAgo(1) }, { at: hoursAgo(2) }],
        gemini: [{ at: hoursAgo(1) }, { at: hoursAgo(2) }],
        openrouter: Array.from({ length: 100 }, () => ({ at: hoursAgo(1) })),
      },
      now: NOW,
    });
    assert.equal(
      plan.assignments[0].accountId,
      'new-free-api',
      'config alone brings new capacity online'
    );
  });
});

describe('Validation helper', () => {
  test('reports every problem at once', () => {
    const errors = validateAccount({ id: 'BAD ID', capabilities: {} });
    assert.ok(errors.length >= 3, 'id, provider, model and context all reported');
  });
});

describe('An exported-but-empty key means unset', () => {
  // Shells, CI matrices and .env loaders all spell "unset" as an exported
  // empty value. Throwing on it broke every secret read on a machine that
  // merely exports the name.
  const orig = process.env.SHIPDE_ACCOUNT_KEY;
  function restore() {
    if (orig === undefined) delete process.env.SHIPDE_ACCOUNT_KEY;
    else process.env.SHIPDE_ACCOUNT_KEY = orig;
  }

  // Deliberately no `key` in the options: that forces loadKey to run, which is
  // the code under test.
  function keyedStore(keyFileRel) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-key-'));
    return {
      registryFile: path.join(dir, 'registry.json'),
      secretsFile: path.join(dir, 'secrets.enc'),
      keyFile: path.join(dir, ...keyFileRel),
      dir,
    };
  }

  test('an empty value falls back to the key file instead of throwing', () => {
    const s = keyedStore(['nested', 'account.key']);
    try {
      process.env.SHIPDE_ACCOUNT_KEY = '';
      addAccount(def(), s);
      assert.doesNotThrow(() => setSecret('openrouter-free', 'sk-value', s));
      assert.strictEqual(getSecret('openrouter-free', s), 'sk-value');
      // The directory of the requested keyFile is created, not the home one.
      assert.ok(fs.existsSync(s.keyFile));
    } finally {
      restore();
      fs.rmSync(s.dir, { recursive: true, force: true });
    }
  });

  test('a whitespace-only value is also unset', () => {
    const s = keyedStore(['deep', 'nested', 'account.key']);
    try {
      process.env.SHIPDE_ACCOUNT_KEY = '   ';
      addAccount(def(), s);
      assert.doesNotThrow(() => setSecret('openrouter-free', 'sk-value', s));
      assert.ok(fs.existsSync(s.keyFile));
    } finally {
      restore();
      fs.rmSync(s.dir, { recursive: true, force: true });
    }
  });

  test('a short but genuinely set value still throws', () => {
    const s = keyedStore(['account.key']);
    try {
      addAccount(def(), s);
      process.env.SHIPDE_ACCOUNT_KEY = 'too-short';
      assert.throws(() => setSecret('openrouter-free', 'sk-value', s), /SHIPDE_ACCOUNT_KEY/);
    } finally {
      restore();
      fs.rmSync(s.dir, { recursive: true, force: true });
    }
  });
});
