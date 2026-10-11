'use strict';

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

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

function createContextPack(items, options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const requestedOutput = options.output ? path.resolve(options.output) : null;
  const outputDir = path.resolve(
    options.outputDir ||
      (requestedOutput && path.dirname(requestedOutput)) ||
      path.join(root, 'tools', 'ai-brain', 'data', 'context-packs')
  );
  const files = new Set();
  for (const item of items || []) {
    const referenced = new Set();
    for (const candidate of [...(item.allowedPaths || []), ...(options.sources || [])]) {
      const relative = safeRelative(candidate);
      if (
        relative &&
        fs.existsSync(path.join(root, relative)) &&
        fs.statSync(path.join(root, relative)).isFile()
      ) {
        files.add(relative);
        referenced.add(relative);
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
        referenced.add(relative);
      }
    }
  }
  const manifest = [...files].sort();
  fs.mkdirSync(outputDir, { recursive: true });
  const output =
    requestedOutput || path.join(outputDir, 'context-' + Date.now() + '-' + process.pid + '.md');
  fs.writeFileSync(
    output + '.manifest.json',
    JSON.stringify({ files: manifest, createdAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8'
  );
  const includeArg = manifest.join(',');
  const repomix = path.join(
    root,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'repomix.cmd' : 'repomix'
  );
  let content = null;
  if (fs.existsSync(repomix) && includeArg.length <= 4000) {
    const result = cp.spawnSync(repomix, ['--include', includeArg, '--output', output], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      windowsHide: true,
    });
    if (result.status === 0 && fs.existsSync(output)) {
      content = fs.readFileSync(output, 'utf8');
    }
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
  return { path: output, files: manifest, content };
}

module.exports = { createContextPack, safeRelative };

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
