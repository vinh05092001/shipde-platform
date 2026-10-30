'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createContextPack, resolveRepomix } = require('../context-pack');

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctxpack-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'module.exports = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'b.js'), 'module.exports = 2;\n');
  return root;
}

test('resolveRepomix prefers SHIPDE_REPOMIX_BIN and ignores missing paths', () => {
  const root = tempRoot();
  const bin = path.join(root, 'fake-repomix');
  fs.writeFileSync(bin, '');
  assert.equal(resolveRepomix(root, { SHIPDE_REPOMIX_BIN: bin }), bin);
  assert.equal(resolveRepomix(root, { SHIPDE_REPOMIX_BIN: path.join(root, 'nope') }), null);
  assert.equal(resolveRepomix(root, {}), null);
});

test('a pack without repomix says so instead of passing as a repomix pack', () => {
  const root = tempRoot();
  const saved = process.env.SHIPDE_REPOMIX_BIN;
  delete process.env.SHIPDE_REPOMIX_BIN;
  try {
    const pack = createContextPack([{ allowedPaths: ['src/a.js'] }], {
      root,
      outputDir: path.join(root, 'out'),
    });
    assert.equal(pack.packer, 'fallback');
    assert.equal(pack.packerReason, 'REPOMIX_NOT_INSTALLED');
    assert.deepEqual(pack.files, ['src/a.js']);
    assert.ok(!pack.content.includes('src/b.js'));
  } finally {
    if (saved !== undefined) process.env.SHIPDE_REPOMIX_BIN = saved;
  }
});
