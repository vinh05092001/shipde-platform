'use strict';
// Live proof: the Controller's context packer must run the real repomix on a
// task-scoped file list and pack exactly those files, never the whole repo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { createContextPackAsync, resolveRepomix } = require('../ai-brain/context-pack');

async function main() {
  const root = path.resolve(__dirname, '..', '..');
  const bin = resolveRepomix(root);
  if (!bin) throw new Error('REPOMIX_NOT_INSTALLED: run through tools/repomix/run.sh');
  const version = cp
    .execFileSync(bin, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' })
    .trim();
  const expected = process.env.SHIPDE_REPOMIX_VERSION;
  if (expected && !version.includes(expected)) {
    throw new Error(`REPOMIX_VERSION_MISMATCH: expected ${expected}, got ${version}`);
  }
  const allowed = ['tools/ai-brain/context-pack.js', 'tools/repomix/run.sh'];
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-repomix-proof-'));
  const pack = await createContextPackAsync([{ allowedPaths: allowed }], {
    root,
    outputDir: outDir,
  });
  const problems = [];
  if (pack.packer !== 'repomix') problems.push(`packer=${pack.packer} (${pack.packerReason})`);
  for (const file of allowed) {
    if (!pack.content.includes(file)) problems.push(`missing ${file}`);
  }
  if (pack.content.includes('tools/ai-brain/orchestrate.js'))
    problems.push('packed a file outside scope');
  fs.rmSync(outDir, { recursive: true, force: true });
  console.log(
    `REPOMIX_CONTEXT_PACK: repomix ${version}, packer=${pack.packer}, files=${pack.files.length}, bytes=${Buffer.byteLength(pack.content)}`
  );
  if (problems.length) {
    for (const p of problems) console.error('FAIL', p);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
