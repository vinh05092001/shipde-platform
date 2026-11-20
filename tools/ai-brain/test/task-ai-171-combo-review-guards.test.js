'use strict';
// TASK-AI-171 review of #605: the reviewer == writer exception, the credential
// block, receipt validation and repair selection apply to the configured combo
// only, and individual 9router routes keep the old rules.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const combo = require('../combo');
const { annotateCandidates, candidateKey } = require('../candidates');
const orchestrate = require('../orchestrate');
const routing = require('../routing');

const registry = {
  sources: [
    {
      id: '9router',
      kind: 'router',
      endpoint: 'http://127.0.0.1:1/v1',
      credential: { env: 'TEST_COMBO_KEY_NOT_SET' },
    },
  ],
  dispatch: { nineRouterWriterCombo: 'vinh' },
};
const comboOf = (env) => combo.comboCandidate({ registry, env }).candidate;
const individual = {
  harness: 'opencode-direct',
  accessPath: 'http://127.0.0.1:1/v1',
  gateway: '9router',
  upstream: '9router',
  accountId: '9router',
  quotaScope: '9router',
  modelId: 'gh/gpt-4.1',
};

test('F1: only the configured combo on the router source counts as a combo', () => {
  const c = comboOf({ TEST_COMBO_KEY_NOT_SET: 'x' });
  assert.equal(combo.isComboCandidate(c, registry), true);
  assert.equal(combo.isComboIdentity(candidateKey(c), registry), true);
  assert.equal(combo.isComboIdentity(c.candidateKey, registry), true);
  // An individual model reached through 9router.
  assert.equal(combo.isComboCandidate(individual, registry), false);
  assert.equal(combo.isComboIdentity(candidateKey(individual), registry), false);
  // Round 2: a combo:: prefix, member metadata, another name or another source
  // must not qualify on their own.
  assert.equal(
    combo.isComboIdentity('combo::http://127.0.0.1:1/v1::9router::gh/gpt-4.1', registry),
    false
  );
  assert.equal(combo.isComboIdentity('combo::http://127.0.0.1:1/v1::other', registry), false);
  assert.equal(combo.isComboIdentity('combo::http://127.0.0.2:1/v1::vinh', registry), false);
  assert.equal(combo.isComboCandidate({ ...individual, comboMembers: ['a'] }, registry), false);
  const elsewhere = { ...c, gateway: 'x', source: 'x', sourceId: 'x', upstream: 'x' };
  assert.equal(combo.isComboCandidate(elsewhere, registry), false);
  // Round 3: one matching alias next to a contradicting one is refused.
  const mixed = { ...c, source: 'other', sourceId: 'other' };
  assert.equal(combo.isComboCandidate(mixed, registry), false);
  const mixedKey = candidateKey({ ...c, gateway: 'other' });
  assert.equal(combo.isComboIdentity(mixedKey, registry), false);
});

test('F2: evidence that finds no block keeps the missing-credential block', () => {
  const c = comboOf({});
  assert.equal(c.blocked, true);
  const [annotated] = annotateCandidates([c], { combinations: [] }, { loadQuotaState: false });
  assert.equal(annotated.blocked, true);
  assert.equal(annotated.blockReason, 'CREDENTIAL_ENV_MISSING');
});

test('F3: a combo receipt with reviewer == writer passes; an individual route does not', () => {
  // The receipt check reads the live registry, so build the key from it.
  const live = combo.comboCandidate({
    env: { [combo.comboCandidate({}).candidate.apiKeyEnv]: 'x' },
  });
  const key = candidateKey(live.candidate);
  const sep = orchestrate.verifyReceiptReviewerSeparation;
  assert.equal(sep({ writerCandidateKey: key, reviewer: key }), null);
  const other = candidateKey(individual);
  assert.match(String(sep({ writerCandidateKey: other, reviewer: other })), /PUBLISH_REFUSED/);
});

test('F4: a combo that only spent its domain attempts is still selectable for repair', async () => {
  const c = comboOf({ TEST_COMBO_KEY_NOT_SET: 'x' });
  const domain = routing.canonicalFailureDomain(c);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'combo-guards-'));
  try {
    const picked = await orchestrate.selectCandidateForProfile(
      { id: 'TASK-X', role: 'author.foundation' },
      [c],
      [],
      { combinations: [] },
      { registry },
      { dir },
      Date.now(),
      { domainAttempts: { [domain]: 2 }, excludedDomains: [domain] }
    );
    assert.equal(picked.chosen, candidateKey(c));

    const failed = await orchestrate.selectCandidateForProfile(
      { id: 'TASK-X', role: 'author.foundation' },
      [c],
      [],
      { combinations: [] },
      { registry },
      { dir },
      Date.now(),
      { failedKeys: [candidateKey(c)] }
    );
    assert.equal(failed.chosen, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
