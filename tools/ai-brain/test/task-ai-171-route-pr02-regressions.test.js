'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const evidence = require('../evidence');
const routing = require('../routing');
const { buildTaskProfile } = require('../orchestrate');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr02-regressions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('PR02 regression: pre-upgrade keys keep literal percent-encoded identity fields', () => {
  const { readDiscoveryCatalogue } = require('../discovery/read');
  const identity = {
    harness: 'paseo',
    accessPath: 'https://fixture.invalid/a%3Ab',
    gateway: 'fixture',
    upstream: 'vendor',
    account: 'account-b',
    quotaScope: '',
    modelId: 'vendor/model%25',
  };
  const legacyKey = [
    identity.harness,
    identity.accessPath,
    identity.gateway,
    identity.upstream,
    identity.account,
    identity.quotaScope,
    identity.modelId,
  ].join('::');
  const catalogue = readDiscoveryCatalogue({
    lines: [],
    evidence: [{ key: legacyKey, passes: 1, attempts: 1 }],
  });
  const actual = catalogue.candidates[0];
  assert.deepEqual(
    { modelId: actual.modelId, accessPath: actual.accessPath },
    { modelId: identity.modelId, accessPath: identity.accessPath }
  );
});

// ---------------------------------------------------------------------------
// P2 fix: explicit format marker — new test cases (fail on 71998e6a, pass on HEAD)
// ---------------------------------------------------------------------------

// (a) Legacy modelId with %25 under accessPath 'cli' — the original test hid this
// bug by putting %3A in accessPath, which made the trial diverge and correctly
// returned raw parts.  With accessPath 'cli' the trial matched the original key
// and incorrectly decoded %25 -> % on the base commit.
test('P2 identity: legacy key with %25 in modelId under accessPath cli keeps literal value', () => {
  const { parseCandidateKey } = require('../discovery/identity');
  const legacyKey = 'paseo::cli::fixture::vendor::account-b::::vendor/model%25';
  const parsed = parseCandidateKey(legacyKey);
  assert.ok(parsed, 'must parse legacy 7-part key');
  assert.equal(
    parsed.modelId,
    'vendor/model%25',
    'legacy %25 must be kept literal, not decoded to %'
  );
  assert.equal(parsed.accessPath, 'cli', 'accessPath must be preserved verbatim');
});

// (b) Legacy upstream field ending with %3A — the boundary-colon escape rule caused
// unescapePart to decode %3A -> ':' and re-encoding ':' at end of string gave %3A
// back, so the trial matched and the old code incorrectly decoded the field.
test('P2 identity: legacy key with %3A in upstream endpoint keeps literal value', () => {
  const { parseCandidateKey } = require('../discovery/identity');
  // 'vendor%3A' simulates a router that names an upstream with a trailing colon
  // percent-encoded; the value is literal in the pre-upgrade key.
  const legacyKey = 'paseo::cli::fixture::vendor%3A::account-b::::some/model';
  const parsed = parseCandidateKey(legacyKey);
  assert.ok(parsed, 'must parse legacy 7-part key');
  assert.equal(parsed.upstream, 'vendor%3A', 'legacy %3A must be kept literal, not decoded to :');
});

// (b2) Legacy endpoint (accessPath) ending with %3A, model id without percent.
test('P2 identity: legacy key with %3A in the accessPath endpoint keeps literal value', () => {
  const { parseCandidateKey } = require('../discovery/identity');
  const legacyKey =
    'paseo::https://fixture.invalid/a%3A::fixture::vendor::account-b::::vendor/model';
  const parsed = parseCandidateKey(legacyKey);
  assert.ok(parsed, 'must parse legacy 7-part key');
  assert.equal(parsed.accessPath, 'https://fixture.invalid/a%3A');
  assert.equal(parsed.modelId, 'vendor/model');
});

// (c) Both %25 and %3A in the same legacy key — combined case.
test('P2 identity: legacy key with both %25 and %3A keeps both literal', () => {
  const { readDiscoveryCatalogue } = require('../discovery/read');
  const identity = {
    harness: 'paseo',
    accessPath: 'cli',
    gateway: 'fixture',
    upstream: 'vendor%3A',
    account: 'account-b',
    quotaScope: '',
    modelId: 'vendor/model%25',
  };
  const legacyKey = [
    identity.harness,
    identity.accessPath,
    identity.gateway,
    identity.upstream,
    identity.account,
    identity.quotaScope,
    identity.modelId,
  ].join('::');
  const catalogue = readDiscoveryCatalogue({
    lines: [],
    evidence: [{ key: legacyKey, passes: 1, attempts: 1 }],
  });
  const actual = catalogue.candidates[0];
  assert.ok(actual, 'candidate must be parsed from legacy key');
  assert.equal(actual.modelId, identity.modelId, 'modelId must keep literal %25');
  assert.equal(actual.upstream, identity.upstream, 'upstream must keep literal %3A');
});

// (d) Round-trip: parseCandidateKey(candidateKey(identity)) returns the same
// identity for a model containing U+241F.  On the base commit the trial encoder
// used the literal text \\u241f (not the actual U+241F character), so a U+241F
// in a field round-tripped to %25241F instead of back to the original char.
test('P2 identity: candidateKey/parseCandidateKey round-trips a model id containing U+241F', () => {
  const { candidateKey, parseCandidateKey } = require('../discovery/identity');
  const identity = {
    harness: 'paseo',
    accessPath: 'cli',
    gateway: 'fixture',
    upstream: 'vendor',
    account: 'account-b',
    quotaScope: '',
    modelId: 'vendor/model\u241fvariant',
  };
  const key = candidateKey(identity);
  const parsed = parseCandidateKey(key);
  assert.ok(parsed, 'new-format key must parse');
  assert.equal(
    parsed.modelId,
    identity.modelId,
    'modelId with U+241F must round-trip through candidateKey/parseCandidateKey'
  );
});

// (e) Normalising twice equals normalising once, and a key just written by
// candidateKey is already a fixed point of normalizeCandidateKey.  On the base
// commit the trial encoder mis-detected the U+241F escape, so normalizing a
// fresh key re-escaped it again (%241F -> %25241F) and the fixed point failed.
test('P2 identity: normalizeCandidateKey is idempotent', () => {
  const { candidateKey, normalizeCandidateKey } = require('../discovery/identity');
  const identity = {
    harness: 'paseo',
    accessPath: 'cli',
    gateway: 'fixture',
    upstream: 'vendor',
    account: 'account-b',
    quotaScope: '',
    modelId: 'vendor/model\u241fvariant',
  };
  const fresh = candidateKey(identity);
  const once = normalizeCandidateKey(fresh);
  const twice = normalizeCandidateKey(once);
  assert.equal(once, fresh, 'a freshly written key must already be normal form');
  assert.equal(twice, once, 'second normalization must equal first');
});

// (f) Catalogue ingestion keeps each legacy field literal, one field at a time and combined.
for (const [label, accessPath, modelId] of [
  ['model only', 'cli', 'vendor/model%25'],
  ['endpoint only', 'https://fixture.invalid/a%3A', 'vendor/model'],
  ['endpoint and model', 'https://fixture.invalid/a%3A', 'vendor/model%25'],
]) {
  test(`P2 identity: catalogue keeps legacy ${label} literal`, () => {
    const { readDiscoveryCatalogue } = require('../discovery/read');
    const key = ['paseo', accessPath, 'fixture', 'vendor', 'account-b', '', modelId].join('::');
    const catalogue = readDiscoveryCatalogue({
      lines: [],
      evidence: [{ key, passes: 1, attempts: 1 }],
    });
    const actual = catalogue.candidates[0];
    assert.ok(actual, 'candidate must be parsed from legacy key');
    assert.equal(actual.accessPath, accessPath);
    assert.equal(actual.modelId, modelId);
  });
}
