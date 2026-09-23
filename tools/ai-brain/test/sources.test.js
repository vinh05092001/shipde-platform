'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sources = require('../sources');
const { getHarness, listHarnesses, parseLastJson } = require('../harness');

const registry = sources.loadSources();

function writeRegistry(doc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-src-'));
  const file = path.join(dir, 'sources.json');
  fs.writeFileSync(file, JSON.stringify(doc), 'utf8');
  return file;
}

describe('source registry', () => {
  test('every dashboard source is classified, and only capacity kinds count as capacity', () => {
    const described = sources.describeAll({ registry });
    const byId = new Map(described.map((d) => [d.id, d]));

    // A router forwards to somebody else's accounts; counting its catalog as
    // capacity would plan work that no account can pay for.
    assert.equal(byId.get('9router').kind, 'router');
    assert.equal(byId.get('paseo').countsAsCapacity, false);
    assert.equal(byId.get('cline').countsAsCapacity, false);
    assert.equal(byId.get('hermes').countsAsCapacity, false);
    assert.equal(byId.get('jev').countsAsCapacity, false);
    // These three bring their own quota.
    assert.equal(byId.get('xkiro').countsAsCapacity, true);
    assert.equal(byId.get('tencent').countsAsCapacity, true);
    assert.equal(byId.get('bai').countsAsCapacity, true);
  });

  test('an unknown kind is refused rather than defaulted to a model source', () => {
    const file = writeRegistry({ sources: [{ id: 'x', kind: 'something-new' }] });
    assert.throws(() => sources.loadSources({ file }), /unknown kind/);
  });

  test('AO is retired, and asking for it says why', () => {
    assert.equal(sources.getSource('ao', registry), null);
    assert.match(sources.refuseReason('ao', registry), /^RETIRED:/);
    assert.match(sources.refuseReason('never-heard-of-it', registry), /^UNKNOWN_SOURCE:/);
  });

  test('a new source needs no code change: the registry alone routes it', () => {
    const file = writeRegistry({
      sources: [
        {
          id: 'newthing',
          label: 'New',
          kind: 'model-source',
          credential: { type: 'api-key', env: 'NEW_KEY' },
        },
      ],
      dispatch: {
        providers: {
          newthing: { harness: 'paseo', provider: 'opencode', modelPrefix: 'ninerouter/nt/' },
        },
      },
    });
    const custom = sources.loadSources({ file });
    assert.equal(sources.capacitySources(custom).length, 1);
    const route = sources.dispatchRoute('newthing', custom);
    assert.equal(route.harness, 'paseo');
    assert.equal(sources.qualifyModel('big-model', route), 'ninerouter/nt/big-model');
  });
});

describe('credential presence', () => {
  const source = (cred) => ({ id: 't', kind: 'model-source', credential: cred });

  test('an env key that is set is present; unset is absent', () => {
    assert.equal(
      sources.credentialPresence(source({ type: 'api-key', env: 'K' }), { env: { K: 'v' } })
        .present,
      true
    );
    assert.equal(
      sources.credentialPresence(source({ type: 'api-key', env: 'K' }), { env: {} }).present,
      false
    );
  });

  test('an empty env key counts as unset, not as a credential', () => {
    assert.equal(
      sources.credentialPresence(source({ type: 'api-key', env: 'K' }), { env: { K: '  ' } })
        .present,
      false
    );
  });

  test('an OAuth session elsewhere is unknown, never assumed either way', () => {
    const p = sources.credentialPresence(
      source({ type: 'oauth', store: 'windows-credential-manager:x' }),
      { env: {} }
    );
    assert.equal(p.present, null);
    assert.equal(p.required, true);
  });

  test('no value of a credential is ever returned', () => {
    const p = sources.credentialPresence(source({ type: 'api-key', env: 'K' }), {
      env: { K: 'sk-secret-value' },
    });
    assert.ok(!JSON.stringify(p).includes('sk-secret-value'));
  });
});

describe('harness adapters', () => {
  test('the retired AO harness throws instead of resolving', () => {
    assert.throws(() => getHarness('ao'), /RETIRED_HARNESS/);
    assert.equal(getHarness('nobody'), null);
    assert.ok(listHarnesses().includes('paseo'));
  });

  test('a paseo launch is background, full access, and carries its labels', () => {
    const args = getHarness('paseo').launch({
      provider: 'opencode',
      model: 'ninerouter/gh/gpt-4.1',
      prompt: 'do the thing',
      branch: 'feat/x',
      base: 'main',
      labels: { workItem: 'TASK-AI-49' },
    });
    assert.ok(args.includes('--background'));
    assert.equal(args[args.indexOf('--mode') + 1], 'full-access');
    assert.equal(args[args.indexOf('--label') + 1], 'workItem=TASK-AI-49');
    assert.equal(args[args.length - 1], 'do the thing');
  });

  test('a review job gets no branch and so makes no worktree', () => {
    const args = getHarness('paseo').launch({ provider: 'codex', prompt: 'review', branch: null });
    assert.ok(!args.includes('--new-workspace'));
  });

  test('resume continues the same session', () => {
    assert.deepEqual(getHarness('paseo').resume('abc', 'carry on'), [
      'send',
      'abc',
      '--json',
      'carry on',
    ]);
  });

  test('cline has no resume, which is why it cannot hold an interrupted writer', () => {
    assert.equal(getHarness('cline').resume, null);
  });
});

describe('parseLastJson', () => {
  test('finds the JSON after progress chatter', () => {
    assert.deepEqual(parseLastJson('starting…\nworking\n{"id":"abc"}\n'), { id: 'abc' });
  });

  test('a brace inside a string does not unbalance the object', () => {
    // Paseo echoes the prompt back, and a prompt containing `{` is ordinary.
    const out = parseLastJson('log\n{"id":"a","name":"fix the {broken} thing"}');
    assert.equal(out.id, 'a');
  });

  test('the last object wins when several are printed', () => {
    assert.equal(parseLastJson('{"id":"first"}\n{"id":"second"}').id, 'second');
  });

  test('no JSON at all is null, not a throw', () => {
    assert.equal(parseLastJson('nothing here'), null);
  });
});
