#!/usr/bin/env node
'use strict';

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs, main } from '../pack-context.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEST_TMP = path.join(REPO_ROOT, '.oc', 'tmp');
fs.mkdirSync(TEST_TMP, { recursive: true });

function linkRepomixPackage(root) {
  const realPkg = path.join(REPO_ROOT, 'node_modules', 'repomix');
  const linkPath = path.join(root, 'node_modules', 'repomix');
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    fs.symlinkSync(realPkg, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    // link already exists
  }
}

function createFixtureRoot() {
  const root = fs.mkdtempSync(path.join(TEST_TMP, 'pack-ctx-'));
  const srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'hello.js'), 'export const hello = "hello";\n'.repeat(40));
  fs.writeFileSync(path.join(srcDir, 'world.js'), 'export const world = "world";\n'.repeat(40));
  fs.copyFileSync(
    path.join(REPO_ROOT, 'repomix.config.json'),
    path.join(root, 'repomix.config.json'),
  );
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

describe('TASK-AI-158 acceptance criteria', () => {
  after(() => {
    try {
      fs.rmSync(TEST_TMP, { recursive: true, force: true });
    } catch {}
  });

  test('AC-AI-158-01: root config and pinned dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const repomixVer = pkg.devDependencies?.repomix;
    assert.ok(repomixVer, 'repomix must be in devDependencies');
    assert.match(repomixVer, /^\d+\.\d+\.\d+$/, `repomix version must be exact/pinned, got ${repomixVer}`);

    const repomixConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'repomix.config.json'), 'utf8'));
    assert.equal(repomixConfig.output?.style, 'xml', 'output style must be xml');
    assert.equal(repomixConfig.output?.removeComments, false, 'comments must be kept');
    assert.equal(repomixConfig.security?.enableSecurityCheck, true, 'security check must be enabled');
    const customPatterns = repomixConfig.ignore?.customPatterns || [];
    assert.ok(
      customPatterns.some((p) => p.includes('.env')),
      'customPatterns must ignore .env files',
    );

    const register = fs.readFileSync(
      path.join(REPO_ROOT, 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'),
      'utf8',
    );
    const rows = register.split(/\r?\n/).filter((line) => line.includes('"TASK-AI-158"'));
    assert.equal(rows.length, 1, 'TASK-AI-158 must have exactly one register row');
  });

  test('AC-AI-158-02: argument parsing', () => {
    const res1 = parseArgs(['--paths', 'apps/**,packages/**', '--out', '.context-packs/ctx.xml']);
    assert.deepStrictEqual(res1, {
      paths: ['apps/**', 'packages/**'],
      out: '.context-packs/ctx.xml',
      maxTokens: null,
    });

    const res2 = parseArgs(['--paths', 'src/**', '--out', '.context-packs/ctx.xml', '--max-tokens', '50000']);
    assert.equal(res2.maxTokens, 50000);

    assert.throws(() => parseArgs(['--out', '.context-packs/out.xml']), /--paths is required/);
    assert.throws(() => parseArgs(['--paths', 'src/**']), /--out is required/);
    assert.throws(() => parseArgs(['--paths', 'src/**', '--out', 'out.xml', '--max-tokens', '0']), /positive integer/);
    assert.throws(() => parseArgs(['--paths', 'src/**', '--out', 'out.xml', '--max-tokens', 'abc']), /positive integer/);
    assert.throws(() => parseArgs(['--paths', 'src/**', '--out', 'out.xml', '--unknown']), /Unknown flag/);
    assert.throws(() => parseArgs(['--paths', 'a', '--paths', 'b', '--out', 'out.xml']), /specified once/);
  });

  test('AC-AI-158-03: token limit', async () => {
    const fixture = createFixtureRoot();
    try {
      const outPath = path.join(fixture, '.context-packs', 'budget.xml');
      const logs = [];
      const errors = [];

      const exitCode = await main(['--paths', 'src/**', '--out', '.context-packs/budget.xml', '--max-tokens', '1'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });

      assert.equal(exitCode, 1, 'exceeding token limit must exit non-zero');
      assert.ok(!fs.existsSync(outPath), 'output file must be removed when token budget is exceeded');
      const combined = `${logs.join('\n')}\n${errors.join('\n')}`;
      assert.ok(!combined.includes('export const hello'), 'stdout must not contain packed file contents');
    } finally {
      cleanupDir(fixture);
    }
  });

  test('AC-AI-158-04: secret check and advisory note', async () => {
    const fixture = createFixtureRoot();
    const secret = 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    try {
      fs.writeFileSync(
        path.join(fixture, 'src', 'tokens.js'),
        `const tok = "${secret}";\n`,
      );

      const outPath = path.join(fixture, '.context-packs', 'secret.xml');
      const errors = [];
      const logs = [];

      const exitCode = await main(['--paths', 'src/**', '--out', '.context-packs/secret.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });

      assert.equal(exitCode, 1, 'detected secrets must cause non-zero exit');
      assert.ok(!fs.existsSync(outPath), 'output must not exist on secret check failure');
      assert.ok(
        errors.some((e) => e.includes('repomix security check found suspicious content')),
        'must log security check failure',
      );
      assert.ok(!logs.join('\n').includes(secret), 'secret must not appear in stdout');
    } finally {
      cleanupDir(fixture);
    }
  });
});