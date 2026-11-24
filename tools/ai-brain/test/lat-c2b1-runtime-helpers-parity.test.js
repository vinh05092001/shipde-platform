'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runtimeHelpers = require('../orchestrate/runtime-helpers');
const dispatchHelpers = require('../cli/dispatch-helpers');
const cli = require('../cli');

const LIVE_HELPER_NAMES = [
  'mergeEvidenceAccounts',
  'assembleForDispatch',
  'readCheckpoint',
  'writeJsonFile',
  'sameFailureDomain',
  'applyFailureBlocks',
  'DRY_RUN_BLOCK_CODES',
  'LIVE_BLOCK_CODES',
];

test('runtime-helpers exports all live helpers and dispatch-helpers/cli re-export them', () => {
  for (const name of LIVE_HELPER_NAMES) {
    assert.ok(runtimeHelpers[name] !== undefined, `runtime-helpers must export ${name}`);
    assert.ok(dispatchHelpers[name] !== undefined, `dispatch-helpers must re-export ${name}`);
  }
  for (const name of [
    'mergeEvidenceAccounts',
    'assembleForDispatch',
    'readCheckpoint',
    'writeJsonFile',
    'applyFailureBlocks',
    'DRY_RUN_BLOCK_CODES',
    'LIVE_BLOCK_CODES',
  ]) {
    assert.strictEqual(
      dispatchHelpers[name],
      runtimeHelpers[name],
      `dispatch-helpers.${name} must share reference with runtime-helpers.${name}`
    );
  }
  assert.strictEqual(typeof cli.readCheckpoint, 'function');
  assert.strictEqual(typeof cli.writeJsonFile, 'function');
  assert.strictEqual(typeof cli.assembleForDispatch, 'function');
  assert.strictEqual(typeof cli.sameFailureDomain, 'function');
  assert.strictEqual(typeof cli.applyFailureBlocks, 'function');
  assert.strictEqual(typeof cli.applyDryRunBlocks, 'function');
  assert.strictEqual(cli.DRY_RUN_BLOCK_CODES, runtimeHelpers.DRY_RUN_BLOCK_CODES);
  assert.strictEqual(cli.LIVE_BLOCK_CODES, runtimeHelpers.LIVE_BLOCK_CODES);
  assert.strictEqual(typeof cli.dispatchProfileCommand, 'function');
});

test('live runtime callers require orchestrate/runtime-helpers instead of cli or dispatch-helpers', () => {
  const root = path.resolve(__dirname, '..');
  const checks = [
    [
      'cli/commands.js',
      /\.\.\/orchestrate\/runtime-helpers/,
      /require\(['"]\.\/dispatch-helpers['"]\)/,
    ],
    ['orchestrate.js', /\.\/orchestrate\/runtime-helpers/, /return require\(['"]\.\/cli['"]\)/],
    ['isolation-launcher.js', /\.\/orchestrate\/runtime-helpers/, /require\(['"]\.\/cli['"]\)/],
    [
      'planning-services.js',
      /\.\/orchestrate\/runtime-helpers/,
      /require\(['"]\.\/cli['"]\)\.assembleForDispatch/,
    ],
  ];
  for (const [rel, mustMatch, mustNotMatch] of checks) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.match(src, mustMatch, `${rel} must require orchestrate/runtime-helpers`);
    assert.doesNotMatch(
      src,
      mustNotMatch,
      `${rel} must not depend on legacy cli/dispatch-helpers seam`
    );
  }
});

test('mergeEvidenceAccounts and assembleForDispatch preserve offline behavior', () => {
  const merged = runtimeHelpers.mergeEvidenceAccounts(
    [{ id: 'acc-1', tier: 'paid' }, { noId: true }],
    [
      { id: 'acc-1', capabilities: { code: true } },
      { id: 'acc-2', capabilities: { review: true } },
    ]
  );
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.find((a) => a.id === 'acc-1').capabilities, { code: true });
  assert.ok(merged.some((a) => a.id === 'acc-2'));
  assert.ok(merged.some((a) => a.noId === true));

  const injected = [{ id: 'cand-1', model: 'ninerouter/vinh' }];
  assert.strictEqual(
    runtimeHelpers.assembleForDispatch(null, [], null, { candidates: injected }),
    injected
  );
});

test('readCheckpoint and writeJsonFile preserve atomic write and .tmp adoption semantics', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-c2b1-rt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const ckpt = path.join(dir, 'state', 'checkpoint.json');
  assert.equal(runtimeHelpers.readCheckpoint(ckpt), null);

  runtimeHelpers.writeJsonFile(ckpt, { step: 1, ok: true });
  assert.deepEqual(runtimeHelpers.readCheckpoint(ckpt), { step: 1, ok: true });

  // Valid .tmp newer than checkpoint is adopted and promoted
  fs.writeFileSync(ckpt + '.tmp', JSON.stringify({ step: 2, adopted: true }), 'utf8');
  assert.deepEqual(runtimeHelpers.readCheckpoint(ckpt), { step: 2, adopted: true });
  assert.equal(fs.existsSync(ckpt + '.tmp'), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(ckpt, 'utf8')), { step: 2, adopted: true });

  // Torn .tmp is discarded without corrupting checkpoint
  fs.writeFileSync(ckpt + '.tmp', '{broken-json', 'utf8');
  assert.deepEqual(runtimeHelpers.readCheckpoint(ckpt), { step: 2, adopted: true });
  assert.equal(fs.existsSync(ckpt + '.tmp'), false);
});

test('applyFailureBlocks and sameFailureDomain match dispatch-helpers parity', () => {
  const failed = {
    sourceId: '9router',
    gateway: '9router',
    model: 'ninerouter/a',
    accountId: 'acc-a',
  };
  const candidates = [
    { ...failed },
    { sourceId: '9router', gateway: '9router', model: 'ninerouter/b', accountId: 'acc-a' },
    { sourceId: 'inception', gateway: 'inception', model: 'inception/m', accountId: 'acc-b' },
  ];
  const classification = { scope: 'account', failureClass: 'quota' };

  // Fixed golden expectations from base ea00c3cf (avoid comparing against re-export)
  assert.equal(runtimeHelpers.sameFailureDomain(candidates[1], failed, classification), true);
  assert.equal(runtimeHelpers.sameFailureDomain(candidates[2], failed, classification), false);
  assert.equal(dispatchHelpers.sameFailureDomain(candidates[1], failed, classification), true);
  assert.equal(dispatchHelpers.sameFailureDomain(candidates[2], failed, classification), false);

  const failedKeys = new Set([require('../candidates').candidateKey(failed)]);
  runtimeHelpers.applyFailureBlocks(
    candidates,
    failedKeys,
    failed,
    classification,
    true,
    runtimeHelpers.LIVE_BLOCK_CODES
  );
  assert.equal(candidates[0].blocked, true);
  assert.equal(candidates[0].blockReason, runtimeHelpers.LIVE_BLOCK_CODES.failed);
  assert.equal(candidates[1].blocked, true);
  assert.equal(candidates[1].blockReason, runtimeHelpers.LIVE_BLOCK_CODES.sameDomain);
  assert.equal(candidates[2].blocked, undefined);
});
