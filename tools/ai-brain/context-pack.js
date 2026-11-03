'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function safeRelative(file) {
  const value = String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  return value &&
    !path.posix.isAbsolute(value) &&
    !/^[a-zA-Z]:/.test(value) &&
    !value.split('/').includes('..')
    ? value
    : null;
}

function collectManifest(items, root, sources) {
  const files = new Set();
  for (const item of items || []) {
    for (const candidate of [...(item.allowedPaths || []), ...(sources || [])]) {
      const relative = safeRelative(candidate);
      if (
        relative &&
        fs.existsSync(path.join(root, relative)) &&
        fs.statSync(path.join(root, relative)).isFile()
      ) {
        files.add(relative);
      }
    }
    const specText = String(item.specText || item.sourceText || '');
    const citedPaths = [
      ...specText.matchAll(/(?:^|[\s(])((?:docs|tools)\/[A-Za-z0-9_./-]+\.md)(?::\d+(?:-\d+)?)?/gm),
    ].map((match) => match[1]);
    for (const candidate of citedPaths) {
      const relative = safeRelative(candidate);
      if (
        relative &&
        fs.existsSync(path.join(root, relative)) &&
        fs.statSync(path.join(root, relative)).isFile()
      ) {
        files.add(relative);
      }
    }
  }
  return [...files].sort();
}

function assertPackSize(files, root, options = {}) {
  const maxFileBytes = Number(options.maxFileBytes) || DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = Number(options.maxTotalBytes) || DEFAULT_MAX_TOTAL_BYTES;
  let totalBytes = 0;
  for (const file of files) {
    const size = fs.statSync(path.join(root, file)).size;
    if (size > maxFileBytes) throw new Error('CONTEXT_FILE_TOO_LARGE: ' + file);
    totalBytes += size;
    if (totalBytes > maxTotalBytes) throw new Error('CONTEXT_PACK_TOO_LARGE');
  }
}

// The repomix binary comes from SHIPDE_REPOMIX_BIN (set by tools/repomix/run.sh,
// which installs the pinned version in an isolated npm prefix) or from the
// workspace node_modules. Callers learn which packer actually produced the pack.
function resolveRepomix(root, env = process.env) {
  const bin = process.platform === 'win32' ? 'repomix.cmd' : 'repomix';
  const candidates = [env.SHIPDE_REPOMIX_BIN, path.join(root, 'node_modules', '.bin', bin)];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function resolveRepomixCmd(bin, root, includeArg, output) {
  const args = ['--include', includeArg, '--output', output];
  if (!bin || !/\.(cmd|bat)$/i.test(bin)) return { cmd: bin, args };
  const d = path.dirname(bin);
  for (const p of ['../repomix', '.']) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(d, p, 'package.json'), 'utf8'));
      const b = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.repomix;
      if (b && fs.existsSync(path.resolve(d, p, b))) {
        return { cmd: process.execPath, args: [path.resolve(d, p, b), ...args] };
      }
    } catch {}
  }
  return { cmd: bin, args };
}

function fallbackReason(repomix, includeArg, attempted) {
  if (!repomix) return 'REPOMIX_NOT_INSTALLED';
  if (includeArg.length > 4000) return 'INCLUDE_ARG_TOO_LONG';
  return attempted ? 'REPOMIX_FAILED' : 'REPOMIX_SKIPPED';
}

function createContextPack(items, options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const requestedOutput = options.output ? path.resolve(options.output) : null;
  const outputDir = path.resolve(
    options.outputDir ||
      (requestedOutput && path.dirname(requestedOutput)) ||
      path.join(root, 'tools', 'ai-brain', 'data', 'context-packs')
  );
  const manifest = collectManifest(items, root, options.sources);
  assertPackSize(manifest, root, options);
  fs.mkdirSync(outputDir, { recursive: true });
  const output =
    requestedOutput || path.join(outputDir, 'context-' + Date.now() + '-' + process.pid + '.md');
  fs.writeFileSync(
    output + '.manifest.json',
    JSON.stringify({ files: manifest, createdAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  );
  const includeArg = manifest.join(',');
  const repomix = resolveRepomix(root);
  let content = null;
  let attempted = false;
  let repomixErr = null;
  if (repomix && includeArg.length <= 4000) {
    attempted = true;
    const { cmd, args } = resolveRepomixCmd(repomix, root, includeArg, output);
    const result = cp.spawnSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
      shell: false,
    });
    if (result.status === 0 && fs.existsSync(output)) content = fs.readFileSync(output, 'utf8');
    else repomixErr = result.error || { code: result.status != null ? result.status : 'UNKNOWN' };
  }
  const packer = content ? 'repomix' : 'fallback';
  const packerReason = content ? null : fallbackReason(repomix, includeArg, attempted);
  if (packer === 'fallback' && packerReason === 'REPOMIX_FAILED') {
    process.stderr.write(
      `[context-pack] warning: repomix failed: ${repomixErr?.code ?? repomixErr?.message ?? 'UNKNOWN'}\n`
    );
  }
  if (!content) {
    content =
      '# Focused context pack\n\n' +
      manifest
        .map(
          (file) =>
            '## ' + file + '\n\n```\n' + fs.readFileSync(path.join(root, file), 'utf8') + '\n```'
        )
        .join('\n\n');
    fs.writeFileSync(output, content, 'utf8');
  }
  fs.writeFileSync(
    output + '.manifest.json',
    JSON.stringify({ files: manifest, createdAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  );
  return { path: output, files: manifest, content, packer, packerReason };
}

async function createContextPackAsync(items, options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const requestedOutput = options.output ? path.resolve(options.output) : null;
  const outputDir = path.resolve(
    options.outputDir ||
      (requestedOutput && path.dirname(requestedOutput)) ||
      path.join(root, 'tools', 'ai-brain', 'data', 'context-packs')
  );
  const manifest = collectManifest(items, root, options.sources);
  assertPackSize(manifest, root, options);
  await fs.promises.mkdir(outputDir, { recursive: true });
  const output =
    requestedOutput || path.join(outputDir, 'context-' + Date.now() + '-' + process.pid + '.md');
  const manifestPath = output + '.manifest.json';
  await fs.promises.writeFile(
    manifestPath,
    JSON.stringify({ files: manifest, createdAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  );
  const includeArg = manifest.join(',');
  const repomix = resolveRepomix(root);
  let content = null;
  let attempted = false;
  let repomixErr = null;
  if (repomix && includeArg.length <= 4000) {
    attempted = true;
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 120000;
    const { cmd, args } = resolveRepomixCmd(repomix, root, includeArg, output);
    const completed = await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const child = cp.spawn(cmd, args, {
        cwd: root,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
      const timer = setTimeout(() => {
        repomixErr = { code: 'ETIMEDOUT' };
        child.kill();
        finish(false);
      }, timeoutMs);
      child.once('error', (err) => {
        repomixErr = err;
        finish(false);
      });
      child.once('close', (code) => {
        if (code !== 0 && !repomixErr) repomixErr = { code: code != null ? code : 'UNKNOWN' };
        finish(code === 0);
      });
    });
    if (completed && fs.existsSync(output)) {
      const outputStat = await fs.promises.stat(output);
      const maxTotalBytes = Number(options.maxTotalBytes) || DEFAULT_MAX_TOTAL_BYTES;
      if (outputStat.size > maxTotalBytes) throw new Error('CONTEXT_PACK_TOO_LARGE');
      content = await fs.promises.readFile(output, 'utf8');
    } else if (!repomixErr) repomixErr = { code: 'NO_OUTPUT' };
  }
  const packer = content ? 'repomix' : 'fallback';
  const packerReason = content ? null : fallbackReason(repomix, includeArg, attempted);
  if (packer === 'fallback' && packerReason === 'REPOMIX_FAILED') {
    process.stderr.write(
      `[context-pack] warning: repomix failed: ${repomixErr?.code ?? repomixErr?.message ?? 'UNKNOWN'}\n`
    );
  }
  if (!content) {
    const sections = [];
    for (const file of manifest) {
      const source = await fs.promises.readFile(path.join(root, file));
      if (source.length > (Number(options.maxFileBytes) || DEFAULT_MAX_FILE_BYTES)) {
        throw new Error('CONTEXT_FILE_TOO_LARGE: ' + file);
      }
      sections.push('## ' + file + '\n\n```\n' + source.toString('utf8') + '\n```');
    }
    content = '# Focused context pack\n\n' + sections.join('\n\n');
    await fs.promises.writeFile(output, content, 'utf8');
  }
  return { path: output, files: manifest, content, packer, packerReason };
}

module.exports = { createContextPack, createContextPackAsync, resolveRepomix, safeRelative };

if (require.main === module) {
  const args = process.argv.slice(2);
  const specIndex = args.indexOf('--spec');
  const outIndex = args.indexOf('--output');
  if (specIndex < 0 || !args[specIndex + 1] || outIndex < 0 || !args[outIndex + 1]) {
    process.stderr.write(
      'Usage: node context-pack.js --spec <work-item.json> --output <contextPack>\n'
    );
    process.exitCode = 2;
  } else {
    const item = JSON.parse(fs.readFileSync(args[specIndex + 1], 'utf8'));
    const output = path.resolve(args[outIndex + 1]);
    const result = createContextPack(Array.isArray(item) ? item : [item], {
      root: process.cwd(),
      output,
    });
    process.stdout.write(result.path + '\n');
  }
}
