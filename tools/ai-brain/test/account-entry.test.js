'use strict';

/**
 * Ship D.. - Account and quota entry path (TASK-AI-29)
 *
 * Every rule the entry command must hold is exercised here against injected
 * paths under os.tmpdir(): no real registry, no real home directory and no
 * credential leaves this process. Each test names the rule it holds, so a
 * reviewer can read the suite against the Work Item's business rules.
 *
 * The registry, the validator, the limit resolver and the encrypted store are
 * the shipped modules. Nothing here re-implements one of them; these tests
 * drive the composition and assert its refusals.
 */

const { test, describe, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  ENTRY_PROVENANCE,
  ENTRY_WINDOWS,
  EntryRefused,
  entryFindings,
  parseLimitSpec,
  buildLimits,
  composeAccount,
  prepareAdd,
  registryExposesCredential,
  readback,
  readbackJson,
  formatReadback,
  applyAdd,
  applyLimits,
  applySecret,
  runAccountCli,
} = require('../account-entry');

const { getSecret, listAccounts, loadRegistry } = require('../accounts');
const { WINDOWS, resolveLimits } = require('../limits');

/** A distinctive value: any copy of it outside the encrypted store is a leak. */
const TOKEN = 'sk-entry-token-do-not-leak';

const created = [];

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-entry-'));
  created.push(dir);
  return {
    dir,
    key: Buffer.alloc(32, 11),
    registryFile: path.join(dir, 'accounts.registry.json'),
    secretsFile: path.join(dir, 'accounts.secrets.enc'),
    keyFile: path.join(dir, 'accounts.key'),
  };
}

after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

function fields(over) {
  return Object.assign(
    {
      id: 'entry-acct',
      provider: 'antigravity',
      model: 'gemini-3.8-flash-high',
      contextWindow: 1000000,
    },
    over || {}
  );
}

function refuses(rule) {
  return (error) =>
    error instanceof EntryRefused && error.findings.some((finding) => finding.rule === rule);
}

function io() {
  const lines = [];
  return {
    out: (line) => lines.push(line),
    err: (line) => lines.push(line),
    text: () => lines.join('\n'),
  };
}

function credentialFile(dir, value) {
  const file = path.join(dir, 'credential.txt');
  fs.writeFileSync(file, value + '\n');
  return file;
}

/** The same injected paths with no explicit key, so loadKey runs as the CLI does. */
function keyless(s) {
  return { registryFile: s.registryFile, secretsFile: s.secretsFile, keyFile: s.keyFile };
}

function addArgs(s, over) {
  return [
    'add',
    '--id',
    'entry-acct',
    '--provider',
    'antigravity',
    '--model',
    'gemini-3.8-flash-high',
    '--context-window',
    '1000000',
    '--registry',
    s.registryFile,
    '--secrets',
    s.secretsFile,
    '--key-file',
    s.keyFile,
  ].concat(over || []);
}

describe('the add path writes only the entry the registry accepts', () => {
  test('a valid entry is written and read back through the shipped defaults (AI-29-R02)', () => {
    const s = store();
    const result = applyAdd(fields(), s);

    assert.equal(result.accountId, 'entry-acct');
    const stored = loadRegistry(s);
    assert.equal(stored.length, 1);
    // enabled/tier are addAccount's own defaults, so the write went through it
    // rather than through a second serialiser of the same file.
    assert.equal(stored[0].enabled, true);
    assert.equal(stored[0].tier, 2);
  });

  test('an undeclared window is written as nothing and stays unknown (AI-29-R06)', () => {
    const s = store();
    const result = applyAdd(fields(), s);

    assert.deepEqual(result.known, []);
    assert.deepEqual(result.unknown, WINDOWS);
    assert.deepEqual(loadRegistry(s)[0].limits, {});
  });

  test('a declared ceiling carries value, provenance and assertedAt (AI-29-R05)', () => {
    const s = store();
    const result = applyAdd(fields({ limit: ['tokensPerDay=1000:operator-declared'] }), s);

    assert.equal(result.known.length, 1);
    assert.equal(result.known[0].window, 'tokensPerDay');
    assert.equal(result.known[0].ceiling, 1000);
    assert.equal(result.known[0].provenance, 'operator-declared');
    assert.equal(typeof result.known[0].assertedAt, 'number');

    const written = loadRegistry(s)[0].limits;
    assert.deepEqual(Object.keys(written), ['tokensPerDay']);
    assert.equal(written.tokensPerDay.value, 1000);
    assert.equal(written.tokensPerDay.provenance, 'operator-declared');
    assert.equal(written.tokensPerDay.assertedAt, result.known[0].assertedAt);
  });

  test('a vendor-documented figure the operator transcribes is admitted (AI-29-R05)', () => {
    const s = store();
    const result = applyAdd(fields({ limit: ['requestsPerDay=9000:vendor-documented'] }), s);
    assert.equal(result.known[0].provenance, 'vendor-documented');
  });

  test('capabilities the operator declares are carried through', () => {
    const s = store();
    applyAdd(fields({ tools: true, jsonSchema: true }), s);
    const stored = loadRegistry(s)[0];
    assert.equal(stored.capabilities.tools, true);
    assert.equal(stored.capabilities.jsonSchema, true);
  });

  test('an entry written without a credential reports it cannot authenticate yet (AI-29-R10)', () => {
    const s = store();
    const result = applyAdd(fields(), s);
    assert.equal(result.hasSecret, false);
  });
});

describe('the validator is the gate and names every failing field', () => {
  test('a missing provider, model and context window are all reported at once (AI-29-R03)', () => {
    const s = store();
    let thrown = null;
    try {
      applyAdd({ id: 'entry-acct' }, s);
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof EntryRefused);
    assert.ok(thrown.findings.every((finding) => finding.rule === 'REGISTRY_VALIDATOR'));
    assert.ok(thrown.findings.length >= 3, 'provider, model and context window are each named');
    const detail = thrown.findings.map((finding) => finding.detail).join(' ');
    assert.match(detail, /provider/);
    assert.match(detail, /model/);
    assert.match(detail, /contextWindow/);
    assert.equal(fs.existsSync(s.registryFile), false, 'nothing was written');
  });

  test('a malformed id is refused rather than written (AI-29-R03)', () => {
    const s = store();
    assert.throws(() => applyAdd(fields({ id: 'BAD ID' }), s), refuses('REGISTRY_VALIDATOR'));
    assert.equal(fs.existsSync(s.registryFile), false);
  });

  test('a tier outside the ladder is refused (AI-29-R03)', () => {
    const s = store();
    assert.throws(() => applyAdd(fields({ tier: 9 }), s), refuses('REGISTRY_VALIDATOR'));
    assert.equal(fs.existsSync(s.registryFile), false);
  });

  test('a credential field inside the entry is refused, and cannot be smuggled in (AI-29-R04)', () => {
    const smuggled = Object.assign(fields(), { apiKey: TOKEN });
    assert.ok(
      entryFindings({
        id: 'entry-acct',
        provider: 'antigravity',
        model: 'm',
        capabilities: { contextWindow: 1000 },
        apiKey: TOKEN,
      }).some((finding) => finding.rule === 'REGISTRY_VALIDATOR')
    );
    // composeAccount copies only known fields, so an unknown one never reaches
    // the object the validator sees either.
    assert.equal('apiKey' in composeAccount(smuggled), false);
  });
});

describe('a ceiling carries its provenance and never a bare number', () => {
  test('a bare number ceiling is refused, not assumed (AI-29-R05)', () => {
    assert.throws(() => parseLimitSpec('tokensPerDay=1000'), refuses('LIMIT_PROVENANCE'));
  });

  test('this path never claims observed (AI-29-R05)', () => {
    assert.throws(() => parseLimitSpec('tokensPerDay=1000:observed'), refuses('LIMIT_PROVENANCE'));
    assert.equal(ENTRY_PROVENANCE.includes('observed'), false);
    assert.deepEqual(ENTRY_PROVENANCE, ['operator-declared', 'vendor-documented']);
  });

  test('an unrecognised provenance is refused (AI-29-R05)', () => {
    assert.throws(() => parseLimitSpec('tokensPerDay=1000:guessed'), refuses('LIMIT_PROVENANCE'));
  });

  test('a window outside the declared set is refused (AI-29-R05)', () => {
    assert.throws(
      () => parseLimitSpec('tokensPerWeek=1000:operator-declared'),
      refuses('LIMIT_WINDOW')
    );
  });

  test('a non-positive ceiling is refused (AI-29-R05)', () => {
    assert.throws(() => parseLimitSpec('tokensPerDay=0:operator-declared'), refuses('LIMIT_VALUE'));
  });

  test('only the declared windows appear, and the window set is the shipped one (AI-29-R06)', () => {
    assert.deepEqual(ENTRY_WINDOWS, WINDOWS);
    assert.deepEqual(buildLimits(['tokensPerDay=1000:operator-declared'], 5), {
      tokensPerDay: { value: 1000, provenance: 'operator-declared', assertedAt: 5 },
    });
  });
});

describe('the credential never enters the registry', () => {
  test('the credential reaches setSecret and no readable copy lands in the registry (AI-29-R04)', () => {
    const s = store();
    const result = applyAdd(fields(), s, TOKEN);

    const registryText = fs.readFileSync(s.registryFile, 'utf8');
    assert.equal(registryText.includes(TOKEN), false);
    assert.equal(getSecret('entry-acct', s), TOKEN);
    assert.equal(listAccounts(s)[0].hasSecret, true);
    assert.equal(result.hasSecret, true);
  });

  test('a registry document exposing the credential is detected (AI-29-R04)', () => {
    assert.equal(registryExposesCredential('{"token":"' + TOKEN + '"}', TOKEN), true);
    assert.equal(registryExposesCredential('{"token":"other"}', TOKEN), false);
    assert.equal(registryExposesCredential('{"token":"other"}', ''), false);
  });

  test('the readback never prints the credential, not even masked (AI-29-R09)', () => {
    const s = store();
    const result = applyAdd(fields(), s, TOKEN);
    assert.equal(formatReadback(result).includes(TOKEN), false);
    assert.equal(readbackJson(result).includes(TOKEN), false);
    assert.equal('credential' in JSON.parse(readbackJson(result)), false);
  });

  test('applySecret stores a credential for an existing entry and nothing else (AI-29-R04)', () => {
    const s = store();
    applyAdd(fields(), s);
    const result = applySecret('entry-acct', TOKEN, s);
    assert.equal(getSecret('entry-acct', s), TOKEN);
    assert.equal(result.hasSecret, true);
    assert.equal(fs.readFileSync(s.registryFile, 'utf8').includes(TOKEN), false);
  });
});

describe('a refusal is not a partial write', () => {
  test('a refused add leaves no registry entry, no limit and no credential (AI-29-R08)', () => {
    const s = store();
    assert.throws(
      () => applyAdd(fields({ limit: ['tokensPerDay=1000'] }), s, TOKEN),
      refuses('LIMIT_PROVENANCE')
    );
    assert.equal(fs.existsSync(s.registryFile), false);
    assert.equal(fs.existsSync(s.secretsFile), false);
  });

  test('a credential the store refuses rolls the registry entry back (AI-29-R08)', () => {
    const s = store();
    // A directory where the secrets file should be makes the store itself
    // refuse the write, after the registry entry already landed.
    s.secretsFile = path.join(s.dir, 'secrets-as-directory');
    fs.mkdirSync(s.secretsFile);

    assert.throws(() => applyAdd(fields(), s, TOKEN));
    assert.deepEqual(loadRegistry(s), []);
  });

  test('an unknown account cannot receive limits (AI-29-R08)', () => {
    const s = store();
    assert.throws(
      () => applyLimits('ghost', ['tokensPerDay=1:operator-declared'], s),
      refuses('UNKNOWN_ACCOUNT')
    );
    assert.equal(fs.existsSync(s.registryFile), false);
  });

  test('an unrecognised option is refused rather than ignored (AI-29-R07)', () => {
    const s = store();
    const out = io();
    const argv = addArgs(s);
    argv.splice(argv.indexOf('--provider'), 0, '--proivder', 'typo');
    const code = runAccountCli(argv, out);

    assert.equal(code, 1);
    assert.match(out.text(), /UNKNOWN_OPTION/);
    assert.equal(fs.existsSync(s.registryFile), false);
  });
});

describe('the command surface prints what it wrote and never the credential', () => {
  test('add returns 0 and reports the id, the known windows and the unknown ones (AI-29-R09)', () => {
    const s = store();
    const out = io();
    const argv = addArgs(s, ['--limit', 'tokensPerDay=500:operator-declared']);
    const code = runAccountCli(argv, out);

    assert.equal(code, 0);
    const text = out.text();
    assert.match(text, /entry-acct/);
    assert.match(text, /tokensPerDay/);
    assert.match(text, /tokensPerMonth/);
  });

  test('secret reads the credential from a file and never prints it (AI-29-R09)', () => {
    const s = store();
    applyAdd(fields(), s);
    const file = credentialFile(s.dir, TOKEN);
    const out = io();
    const code = runAccountCli(
      [
        'secret',
        '--id',
        'entry-acct',
        '--credential-file',
        file,
        '--registry',
        s.registryFile,
        '--secrets',
        s.secretsFile,
        '--key-file',
        s.keyFile,
      ],
      out
    );

    assert.equal(code, 0);
    assert.equal(out.text().includes(TOKEN), false);
    assert.equal(getSecret('entry-acct', keyless(s)), TOKEN);
  });

  test('limits updates an existing entry through updateAccount', () => {
    const s = store();
    applyAdd(fields(), s);
    const result = applyLimits('entry-acct', ['requestsPerDay=100:vendor-documented'], s);
    assert.equal(result.known[0].window, 'requestsPerDay');
    assert.equal(loadRegistry(s)[0].limits.requestsPerDay.value, 100);
  });

  test('an unknown sub-command exits 2', () => {
    assert.equal(runAccountCli(['frobnicate'], io()), 2);
  });

  test('a refused invocation exits 1 and writes nothing (AI-29-R08)', () => {
    const s = store();
    const out = io();
    const argv = addArgs(s, ['--limit', 'tokensPerDay=1']);
    const code = runAccountCli(argv, out);

    assert.equal(code, 1);
    assert.match(out.text(), /LIMIT_PROVENANCE/);
    assert.equal(fs.existsSync(s.registryFile), false);
  });
});

describe('the entry path keeps one writer and one rule set', () => {
  test('entryFindings composes the shipped validator and resolver by reference', () => {
    const account = fields();
    // A clean account yields no findings...
    assert.deepEqual(entryFindings(composeAccount(account)), []);
    // ...and a ceiling with no provenance is refused by limits.resolveLimits,
    // naming the account and the window, not by a private copy of the rule.
    const bad = composeAccount(account);
    bad.limits = { tokensPerDay: { value: 1 } };
    const findings = entryFindings(bad);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, 'LIMIT_PROVENANCE');
    assert.match(findings[0].detail, /entry-acct/);
    assert.match(findings[0].detail, /tokensPerDay/);
  });

  test('prepareAdd returns the composed entry and readback agrees with the resolver', () => {
    const s = store();
    const account = prepareAdd(fields({ limit: ['tokensPerDay=1000:operator-declared'] }));
    const result = readback(account, s);
    assert.equal(result.accountId, 'entry-acct');
    assert.equal(result.known[0].ceiling, 1000);
    const resolved = resolveLimits(account, { skipLedger: true });
    assert.equal(resolved.windows.tokensPerDay.ceiling, result.known[0].ceiling);
  });
});
