'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createContextPack, createContextPackAsync } = require('../context-pack');

for (const [name, packer] of [
  ['sync', createContextPack],
  ['async', createContextPackAsync],
]) {
  for (const source of ['allowedPaths', 'sources', 'citation']) {
    test(`${name} refuses outside and broken links from ${source}`, async (t) => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'context-symlink-'));
      t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
      const root = path.join(temp, 'repo');
      const outside = path.join(temp, 'repo-outside');
      fs.mkdirSync(root);
      fs.mkdirSync(outside);
      const sentinel = 'SYNTHETIC_OUTSIDE_CONTENT_171';
      fs.writeFileSync(path.join(outside, 'secret.md'), sentinel);
      fs.writeFileSync(path.join(root, 'safe.md'), 'safe context');
      const type = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(outside, path.join(root, 'docs'), type);
      fs.symlinkSync(path.join(temp, 'missing'), path.join(root, 'tools'), type);
      const candidates = ['docs/secret.md', 'tools/broken.md'];
      const item = { allowedPaths: ['safe.md'] };
      const options = { root, outputDir: path.join(temp, 'out') };
      if (source === 'allowedPaths') item.allowedPaths.push(...candidates);
      if (source === 'sources') options.sources = candidates;
      if (source === 'citation') item.specText = candidates.join('\n');
      const pack = await packer([item], options);
      assert.equal(pack.content.includes(sentinel), false);
      assert.deepEqual(pack.files, ['safe.md']);
      assert.deepEqual(pack.refusals, [
        { file: candidates[0], reason: 'CONTEXT_PATH_OUTSIDE_ROOT' },
        { file: candidates[1], reason: 'CONTEXT_PATH_UNRESOLVABLE' },
      ]);
      const manifest = fs.readFileSync(pack.path + '.manifest.json', 'utf8');
      assert.deepEqual(JSON.parse(manifest).refusals, pack.refusals);
      assert.equal(manifest.includes(sentinel), false);
      assert.equal(manifest.includes(outside), false);
    });
  }
  test(`${name} accepts an in-root link and a linked repository root`, async (t) => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'context-inside-'));
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const root = path.join(temp, 'repo');
    fs.mkdirSync(path.join(root, 'actual'), { recursive: true });
    fs.writeFileSync(path.join(root, 'actual', 'safe.md'), 'safe context');
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    fs.symlinkSync(path.join(root, 'actual'), path.join(root, 'docs'), type);
    fs.symlinkSync(root, path.join(temp, 'alias'), type);
    const pack = await packer([{ allowedPaths: ['docs/safe.md'] }], {
      root: path.join(temp, 'alias'),
      outputDir: path.join(temp, 'out'),
    });
    assert.deepEqual(pack.files, ['docs/safe.md']);
    assert.ok(pack.content.includes('safe context'));
    assert.deepEqual(pack.refusals, []);
  });
}
