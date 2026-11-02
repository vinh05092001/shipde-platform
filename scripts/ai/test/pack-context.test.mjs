#!/usr/bin/env node
'use strict';

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFocusedConfig,
  estimateTokens,
  looksLikeBudgetFailure,
  looksLikeSecretFailure,
  main,
  parseArgs,
  resolveRepomixEntry,
} from '../pack-context.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

function linkRepomixPackage(root) {
  const realPkg = path.join(REPO_ROOT, 'node_modules', 'repomix');
  const linkPath = path.join(root, 'node_modules', 'repomix');
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(realPkg, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    fs.cpSync(realPkg, linkPath, { recursive: true });
  }
}

function createFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-ctx-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'hello.js'), 'export const hello = "hello";\n'.repeat(40));
  fs.writeFileSync(path.join(srcDir, 'world.js'), 'export const world = "world";\n'.repeat(40));
  linkRepomixPackage(root);
  return root;
}

function cleanupDir(dir) {
  const linkPath = path.join(dir, 'node_modules', 'repomix');
  try {
    if (fs.lstatSync(linkPath).isSymbolicLink()) {
      fs.rmSync(linkPath, { force: true });
    }
  } catch {
    // link absent or already removed
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('parseArgs', () => {
  test('parses --paths and --out', () => {
    const result = parseArgs(['--paths', 'apps/**,packages/**', '--out', 'ctx.xml']);
    assert.deepStrictEqual(result.paths, ['apps/**', 'packages/**']);
    assert.equal(result.out, 'ctx.xml');
    assert.equal(result.maxTokens, null);
  });

  test('parses --max-tokens', () => {
    const result = parseArgs(['--paths', 'src/**', '--out', 'out.xml', '--max-tokens', '50000']);
    assert.equal(result.maxTokens, 50000);
  });

  test('throws on missing --paths', () => {
    assert.throws(() => parseArgs(['--out', 'out.xml']), /--paths is required/);
  });

  test('throws on missing --out', () => {
    assert.throws(() => parseArgs(['--paths', 'src/**']), /--out is required/);
  });

  test('throws on empty --paths', () => {
    assert.throws(() => parseArgs(['--paths', '', '--out', 'out.xml']), /--paths is required/);
  });

  test('throws on invalid --max-tokens', () => {
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--out', 'o.xml', '--max-tokens', '-5']),
      /positive integer/,
    );
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--out', 'o.xml', '--max-tokens', 'abc']),
      /positive integer/,
    );
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--out', 'o.xml', '--max-tokens', '3.5']),
      /positive integer/,
    );
  });

  test('ignores a lone -- separator (pnpm pass-through)', () => {
    const result = parseArgs(['--', '--paths', 'src/**', '--out', 'o.xml']);
    assert.deepStrictEqual(result.paths, ['src/**']);
    assert.equal(result.out, 'o.xml');
  });

  test('throws on unknown flag', () => {
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--out', 'o.xml', '--bogus']),
      /Unknown flag/,
    );
  });

  test('trims and filters empty path segments', () => {
    const result = parseArgs(['--paths', ' apps/** , , packages/** ', '--out', 'x.xml']);
    assert.deepStrictEqual(result.paths, ['apps/**', 'packages/**']);
  });
});

describe('estimateTokens', () => {
  test('returns ceiling of byteLength / 4', () => {
    assert.equal(estimateTokens(100), 25);
    assert.equal(estimateTokens(101), 26);
    assert.equal(estimateTokens(0), 0);
    assert.equal(estimateTokens(1), 1);
  });
});

describe('buildFocusedConfig', () => {
  test('keeps the security check on and narrows include to the given paths', () => {
    const config = buildFocusedConfig(
      { ignore: { useGitignore: true }, security: { enableSecurityCheck: false } },
      ['src/**'],
      'out.xml',
    );
    assert.deepStrictEqual(config.include, ['src/**']);
    assert.equal(config.security.enableSecurityCheck, true);
    assert.equal(config.output.style, 'xml');
    assert.equal(config.output.removeComments, false);
    assert.equal(config.output.filePath, 'out.xml');
  });
});

describe('failure markers', () => {
  test('looksLikeSecretFailure matches the repomix security report', () => {
    assert.equal(
      looksLikeSecretFailure(
        '1 suspicious file(s) detected and excluded from the output:\n1. src/tokens.txt',
      ),
      true,
    );
    assert.equal(looksLikeSecretFailure('Security Check: No suspicious files detected.'), false);
    assert.equal(looksLikeSecretFailure('packed 2 files'), false);
  });

  test('looksLikeBudgetFailure matches the repomix token-budget error', () => {
    assert.equal(
      looksLikeBudgetFailure(
        'Packed output exceeds the token budget: 4,000 > 100 tokens.',
      ),
      true,
    );
    assert.equal(looksLikeBudgetFailure('Packing completed successfully!'), false);
  });
});

describe('main — token limit', () => {
  test('fails when the fixture pack exceeds --max-tokens and does not keep the file', async () => {
    const fixture = createFixtureRoot();
    const logs = [];
    const errors = [];
    try {
      const code = await main(
        ['--paths', 'src/**', '--out', 'output.xml', '--max-tokens', '1'],
        {
          root: fixture,
          log: (line) => logs.push(line),
          logError: (line) => errors.push(line),
        },
      );
      assert.equal(code, 1);
      assert.equal(fs.existsSync(path.join(fixture, 'output.xml')), false);
      assert.match(errors.join('\n'), /exceeds --max-tokens 1/);
      const printed = `${logs.join('\n')}\n${errors.join('\n')}`;
      assert.equal(printed.includes('export const hello'), false);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('packs only the fixture and prints a summary without file contents', async () => {
    const fixture = createFixtureRoot();
    const logs = [];
    const errors = [];
    try {
      const code = await main(['--paths', 'src/**', '--out', 'output.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(errors.join('\n'), '');
      assert.equal(code, 0);
      const output = fs.readFileSync(path.join(fixture, 'output.xml'), 'utf8');
      const fileSection = output.split('<files>')[1] || '';
      assert.match(fileSection, /hello\.js/);
      assert.match(fileSection, /world\.js/);
      assert.match(fileSection, /export const hello/);
      assert.match(logs.join('\n'), /OK: 2 files, ~\d+ tokens, output\.xml/);
      assert.equal(logs.join('\n').includes('export const hello'), false);
    } finally {
      cleanupDir(fixture);
    }
  });
});

describe('repomix security check', () => {
  test('exits non-zero when a packed file contains a detected secret', async () => {
    const fixture = createFixtureRoot();
    const logs = [];
    const errors = [];
    // Deliberate dummy (zero-entropy repeat): repomix's secretlint preset
    // still flags it, while the repo gitleaks gate ignores it as a fixture.
    const secret = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    try {
      fs.writeFileSync(
        path.join(fixture, 'src', 'tokens.js'),
        `const tok = "${secret}";\n`,
      );
      const code = await main(['--paths', 'src/**', '--out', 'output.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.equal(fs.existsSync(path.join(fixture, 'output.xml')), false);
      assert.match(errors.join('\n'), /security check found suspicious content/i);
      const printed = `${logs.join('\n')}\n${errors.join('\n')}`;
      assert.equal(printed.includes(secret), false);
    } finally {
      cleanupDir(fixture);
    }
  });
});
