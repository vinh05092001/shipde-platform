#!/usr/bin/env node
'use strict';

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFocusedConfig,
  estimateTokens,
  looksLikeBudgetFailure,
  looksLikeSecretFailure,
  main,
  parseArgs,
  publishOutput,
  resolveExistingAncestorsAndAliases,
  resolveRepomixEntry,
  sameFileIdentity,
  validateOutputPath,
} from '../pack-context.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEST_TMP = path.join(REPO_ROOT, '.oc', 'tmp');
fs.mkdirSync(TEST_TMP, { recursive: true });

describe('TASK-AI-158 delivery registration', () => {
  const register = fs.readFileSync(
    path.join(REPO_ROOT, 'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'),
    'utf8',
  );
  const itemRows = register.split(/\r?\n/).filter((line) =>
    /^"\d+","S00","AI workflow","TASK-AI-158",/.test(line),
  );

  test('has exactly one register row with an unused numeric delivery order', () => {
    assert.equal(itemRows.length, 1, 'TASK-AI-158 must have exactly one register row');
    const order = itemRows[0].match(/^"(\d+)"/)[1];
    const orders = [...register.matchAll(/^"(\d+)"/gm)].map((match) => match[1]);
    assert.equal(
      orders.filter((value) => value === order).length,
      1,
      `TASK-AI-158 delivery order ${order} is already assigned to another Work Item`,
    );
  });

  test('Work Item delivery order matches its register row', () => {
    assert.equal(itemRows.length, 1);
    const workItem = fs.readFileSync(
      path.join(REPO_ROOT, 'docs/product-spec/work-items/TASK-AI-158.md'),
      'utf8',
    );
    const order = workItem.match(/^\| Delivery order \| `(\d+)` \|\r?$/m);
    assert.ok(order, 'Work Item must declare a numeric delivery order');
    assert.equal(order[1], itemRows[0].match(/^"(\d+)"/)[1]);
  });

  test('test_ci_pipeline_gates_and_toolchain_sync: ai-brain-tests and current-application integrity checks pass fail-closed', async () => {
    const cp = await import("node:child_process");

    // 1. Toolchain snapshot sync (prevents ai-brain-tests failure in repo-integration-group-7)
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    const toolchainDoc = fs.readFileSync(
      path.join(REPO_ROOT, "docs/product-spec/docs/10-ai-collaboration/repo-integration/GROUP-7-PRODUCT-TOOLCHAIN.md"),
      "utf8",
    );
    const repomixVer = pkg.devDependencies?.repomix;
    assert.equal(repomixVer, "1.18.1", "Root package.json must pin repomix to 1.18.1");
    const repomixMatches = [...toolchainDoc.matchAll(/"repomix":\s*"1\.18\.1"/g)];
    assert.equal(
      repomixMatches.length,
      3,
      "GROUP-7-PRODUCT-TOOLCHAIN.md must include repomix: 1.18.1 in all 3 dependency snapshots",
    );

    // 2. Controller no-hardcode guard (ai-brain-tests pre-push requirement)
    const hardcodeRes = cp.spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts", "ai", "check-no-hardcode.mjs")],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    assert.equal(
      hardcodeRes.status,
      0,
      `check-no-hardcode.mjs must pass with exit code 0:\n${hardcodeRes.stderr || hardcodeRes.stdout}`,
    );

    // 3. Feature delivery register integrity (contract requirement)
    const registerContent = fs.readFileSync(
      path.join(REPO_ROOT, "docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv"),
      "utf8",
    );
    const rows = registerContent.split(/\r?\n/).filter(Boolean);
    const ai158Rows = rows.filter((r) => r.includes('"TASK-AI-158"'));
    assert.equal(ai158Rows.length, 1, "Register must have exactly one row for TASK-AI-158");
    assert.ok(ai158Rows[0].startsWith('"294"'), "TASK-AI-158 row must have delivery order 294");
  });
});

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
  const root = fs.mkdtempSync(path.join(TEST_TMP, 'pack-ctx-'));
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

  test('throws when flag value is missing or another flag', () => {
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--out', '--max-tokens', '100']),
      /--out requires a value/,
    );
    assert.throws(
      () => parseArgs(['--paths', '--out', 'out.xml']),
      /--paths requires a value/,
    );
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--out', 'out.xml', '--max-tokens']),
      /--max-tokens requires a positive integer value/,
    );
  });

  test('throws on unexpected positional arguments', () => {
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--out', 'out.xml', 'extra']),
      /Unexpected positional argument/,
    );
    assert.throws(
      () => parseArgs(['extra', '--paths', 'src/**', '--out', 'out.xml']),
      /Unexpected positional argument/,
    );
  });

  test('throws on duplicate flags', () => {
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--paths', 'other/**', '--out', 'out.xml']),
      /--paths can only be specified once/,
    );
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--out', 'out.xml', '--out', 'other.xml']),
      /--out can only be specified once/,
    );
    assert.throws(
      () => parseArgs(['--paths', 'src/**', '--out', 'out.xml', '--max-tokens', '100', '--max-tokens', '200']),
      /--max-tokens can only be specified once/,
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
  test('denies blank or comma-only path selections without creating a pack', async () => {
    const fixture = createFixtureRoot();
    const logs = [];
    const errors = [];
    try {
      for (const paths of ['', ' , , ']) {
        const code = await main(['--paths', paths, '--out', '.context-packs/output.xml'], {
          root: fixture,
          log: (line) => logs.push(line),
          logError: (line) => errors.push(line),
        });
        assert.equal(code, 1);
        assert.equal(fs.existsSync(path.join(fixture, '.context-packs', 'output.xml')), false);
      }
      assert.equal(logs.length, 0);
      assert.match(errors.join('\n'), /--paths is required/);
      assert.equal(errors.join('\n').includes('export const hello'), false);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('fails when the fixture pack exceeds --max-tokens and does not keep the file', async () => {
    const fixture = createFixtureRoot();
    const logs = [];
    const errors = [];
    try {
      const code = await main(
        ['--paths', 'src/**', '--out', '.context-packs/output.xml', '--max-tokens', '1'],
        {
          root: fixture,
          log: (line) => logs.push(line),
          logError: (line) => errors.push(line),
        },
      );
      assert.equal(code, 1);
      assert.equal(fs.existsSync(path.join(fixture, '.context-packs', 'output.xml')), false);
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
      const code = await main(['--paths', 'src/**', '--out', '.context-packs/output.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(errors.join('\n'), '');
      assert.equal(code, 0);
      const output = fs.readFileSync(path.join(fixture, '.context-packs', 'output.xml'), 'utf8');
      const fileSection = output.split('<files>')[1] || '';
      assert.match(fileSection, /hello\.js/);
      assert.match(fileSection, /world\.js/);
      assert.match(fileSection, /export const hello/);
      assert.match(logs.join('\n'), /OK: 2 files, ~\d+ tokens, \.context-packs[/\\]output\.xml/);
      assert.equal(logs.join('\n').includes('export const hello'), false);
    } finally {
      cleanupDir(fixture);
    }
  });
});

describe('environment file exclusion', () => {
  const excludedPaths = [
    '.env',
    '.env.example',
    '.env.local',
    '.envrc',
    '.environment',
    'src/.env',
    'src/.env.example',
    'src/deep/.env.production',
    'src/deep/.envrc',
  ];

  for (const [selection, paths] of [
    ['explicit paths', ['src/hello.js', 'src/world.js', ...excludedPaths].join(',')],
    ['globs', 'src/**,.env*'],
  ]) {
    test(`excludes root and nested .env* files selected by ${selection}`, async () => {
      const fixture = createFixtureRoot();
      const logs = [];
      const errors = [];
      const markers = excludedPaths.map((_, index) => `EXCLUDED_ENV_CONTENT_${index}`);
      try {
        fs.copyFileSync(
          path.join(REPO_ROOT, 'repomix.config.json'),
          path.join(fixture, 'repomix.config.json'),
        );
        for (const [index, relativePath] of excludedPaths.entries()) {
          const filePath = path.join(fixture, relativePath);
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          // Harmless markers prove exclusion without relying on secretlint detection.
          fs.writeFileSync(filePath, `context_marker=${markers[index]}\n`);
        }
        const code = await main(['--paths', paths, '--out', '.context-packs/output.xml'], {
          root: fixture,
          log: (line) => logs.push(line),
          logError: (line) => errors.push(line),
        });
        assert.equal(errors.join('\n'), '');
        assert.equal(code, 0);
        const output = fs.readFileSync(path.join(fixture, '.context-packs', 'output.xml'), 'utf8');
        assert.match(output, /export const hello/);
        assert.match(output, /export const world/);
        const printed = `${logs.join('\n')}\n${errors.join('\n')}`;
        for (const [index, relativePath] of excludedPaths.entries()) {
          assert.equal(output.includes(markers[index]), false, `Packed ${relativePath}`);
          assert.equal(printed.includes(markers[index]), false, `Printed ${relativePath}`);
        }
        assert.match(logs.join('\n'), /OK: 2 files,/);
      } finally {
        cleanupDir(fixture);
      }
    });
  }
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
      const code = await main(['--paths', 'src/**', '--out', '.context-packs/output.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.equal(fs.existsSync(path.join(fixture, '.context-packs', 'output.xml')), false);
      assert.match(errors.join('\n'), /security check found suspicious content/i);
      const printed = `${logs.join('\n')}\n${errors.join('\n')}`;
      assert.equal(printed.includes(secret), false);
    } finally {
      cleanupDir(fixture);
    }
  });
});

describe('failure cleanup and destination safety', () => {
  test('preserves an existing output file when repomix fails to launch', async () => {
    const fixture = createFixtureRoot();
    const existingOut = path.join(fixture, '.context-packs', 'existing-output.xml');
    fs.mkdirSync(path.dirname(existingOut), { recursive: true });
    const existingContent = '<existing>User Content</existing>\n';
    fs.writeFileSync(existingOut, existingContent, 'utf8');

    // Remove repomix to cause launch failure
    const pkgDir = path.join(fixture, 'node_modules', 'repomix');
    fs.rmSync(pkgDir, { recursive: true, force: true });

    const logs = [];
    const errors = [];
    try {
      const code = await main(
        ['--paths', 'src/**', '--out', '.context-packs/existing-output.xml'],
        {
          root: fixture,
          log: (line) => logs.push(line),
          logError: (line) => errors.push(line),
        },
      );
      assert.equal(code, 1);
      assert.equal(fs.existsSync(existingOut), true);
      assert.equal(fs.readFileSync(existingOut, 'utf8'), existingContent);
      assert.match(errors.join('\n'), /repomix not found/);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('preserves an existing output file when token budget is exceeded', async () => {
    const fixture = createFixtureRoot();
    const existingOut = path.join(fixture, '.context-packs', 'existing-output.xml');
    fs.mkdirSync(path.dirname(existingOut), { recursive: true });
    const existingContent = '<existing>User Content</existing>\n';
    fs.writeFileSync(existingOut, existingContent, 'utf8');

    const logs = [];
    const errors = [];
    try {
      const code = await main(
        ['--paths', 'src/**', '--out', '.context-packs/existing-output.xml', '--max-tokens', '1'],
        {
          root: fixture,
          log: (line) => logs.push(line),
          logError: (line) => errors.push(line),
        },
      );
      assert.equal(code, 1);
      assert.equal(fs.existsSync(existingOut), true);
      assert.equal(fs.readFileSync(existingOut, 'utf8'), existingContent);
      assert.match(errors.join('\n'), /exceeds --max-tokens 1/);
    } finally {
      cleanupDir(fixture);
    }
  });
  test('rejects unsafe output destinations and input/output collisions', async () => {
    const fixture = createFixtureRoot();
    const logs = [];
    const errors = [];
    try {
      // Destination is directory
      const codeDir = await main(['--paths', 'src/**', '--out', 'src'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(codeDir, 1);
      assert.match(errors.join('\n'), /directory/i);

      // Destination outside root
      const codeOut = await main(['--paths', 'src/**', '--out', '../outside.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(codeOut, 1);
      assert.match(errors.join('\n'), /outside the repository root/i);

      // Destination is inside .git
      const codeGit = await main(['--paths', 'src/**', '--out', '.git/pack.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(codeGit, 1);
      assert.match(errors.join('\n'), /inside \.git/i);

      // Destination is input/output collision: output file is an existing source file in paths
      const codeCollision = await main(['--paths', 'src/**', '--out', 'src/hello.js'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(codeCollision, 1);
      assert.match(errors.join('\n'), /collision|must resolve inside \.context-packs/i);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('rejects destination alias symlink to selected source file and preserves source', async () => {
    const fixture = createFixtureRoot();
    const srcHello = path.join(fixture, 'src', 'hello.js');
    const originalHello = fs.readFileSync(srcHello, 'utf8');
    const contextXml = path.join(fixture, '.context-packs', 'context.xml');
    fs.mkdirSync(path.dirname(contextXml), { recursive: true });

    try {
      fs.symlinkSync(srcHello, contextXml, 'file');
    } catch {
      fs.linkSync(srcHello, contextXml);
    }

    const logs = [];
    const errors = [];
    try {
      const code = await main(['--paths', 'src/**', '--out', '.context-packs/context.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /collision|must resolve inside \.context-packs/i);
      assert.equal(fs.readFileSync(srcHello, 'utf8'), originalHello);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('rejects destination alias symlink when input path uses ./ prefix and preserves source', async () => {
    const fixture = createFixtureRoot();
    const srcHello = path.join(fixture, 'src', 'hello.js');
    const originalHello = fs.readFileSync(srcHello, 'utf8');
    const contextXml = path.join(fixture, '.context-packs', 'context.xml');
    fs.mkdirSync(path.dirname(contextXml), { recursive: true });

    try {
      fs.symlinkSync(srcHello, contextXml, 'file');
    } catch {
      fs.linkSync(srcHello, contextXml);
    }

    const logs = [];
    const errors = [];
    try {
      const code = await main(['--paths', './src/**', '--out', '.context-packs/context.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /collision|must resolve inside \.context-packs/i);
      assert.equal(fs.readFileSync(srcHello, 'utf8'), originalHello);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('rejects directory alias pointing to selected source dir and preserves source', async () => {
    const fixture = createFixtureRoot();
    const srcDir = path.join(fixture, 'src');
    const srcHello = path.join(srcDir, 'hello.js');
    const originalHello = fs.readFileSync(srcHello, 'utf8');
    const symSrc = path.join(fixture, 'sym_src');

    fs.symlinkSync(srcDir, symSrc, process.platform === 'win32' ? 'junction' : 'dir');

    const logs = [];
    const errors = [];
    try {
      const code = await main(['--paths', 'src/**', '--out', 'sym_src/hello.js'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /collision|must resolve inside \.context-packs/i);
      assert.equal(fs.readFileSync(srcHello, 'utf8'), originalHello);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('rejects destination inside symlinked directory pointing outside repository root', async () => {
    const fixture = createFixtureRoot();
    const outside = fs.mkdtempSync(path.join(TEST_TMP, 'outside-pack-'));
    const symOutside = path.join(fixture, 'sym_outside');

    fs.symlinkSync(outside, symOutside, process.platform === 'win32' ? 'junction' : 'dir');

    const logs = [];
    const errors = [];
    try {
      const code = await main(['--paths', 'src/**', '--out', 'sym_outside/pack.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /outside the repository root/i);
      assert.equal(fs.existsSync(path.join(outside, 'pack.xml')), false);
    } finally {
      try {
        fs.rmSync(outside, { recursive: true, force: true });
      } catch {}
      cleanupDir(fixture);
    }
  });

  test('preserves existing output file when publication fails', async () => {
    const fixture = createFixtureRoot();
    const existingOut = path.join(fixture, '.context-packs', 'existing-output.xml');
    fs.mkdirSync(path.dirname(existingOut), { recursive: true });
    const existingContent = '<existing>User Content</existing>\n';
    fs.writeFileSync(existingOut, existingContent, 'utf8');

    const logs = [];
    const errors = [];
    try {
      const code = await main(
        ['--paths', 'src/**', '--out', '.context-packs/existing-output.xml'],
        {
          root: fixture,
          rename: () => {
            throw new Error('simulated rename failure');
          },
          log: (line) => logs.push(line),
          logError: (line) => errors.push(line),
        },
      );
      assert.equal(code, 1);
      assert.equal(fs.existsSync(existingOut), true);
      assert.equal(fs.readFileSync(existingOut, 'utf8'), existingContent);
      assert.match(errors.join('\n'), /failed to publish output/i);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('preserves existing output file when publication copy fails', async () => {
    const fixture = createFixtureRoot();
    const existingOut = path.join(fixture, '.context-packs', 'existing-output.xml');
    fs.mkdirSync(path.dirname(existingOut), { recursive: true });
    const existingContent = '<existing>User Content</existing>\n';
    fs.writeFileSync(existingOut, existingContent, 'utf8');

    const logs = [];
    const errors = [];
    try {
      const code = await main(
        ['--paths', 'src/**', '--out', '.context-packs/existing-output.xml'],
        {
          root: fixture,
          copyFile: () => {
            throw new Error('simulated copy failure');
          },
          log: (line) => logs.push(line),
          logError: (line) => errors.push(line),
        },
      );
      assert.equal(code, 1);
      assert.equal(fs.existsSync(existingOut), true);
      assert.equal(fs.readFileSync(existingOut, 'utf8'), existingContent);
      assert.match(errors.join('\n'), /failed to publish output/i);
      const remainingTmp = fs.readdirSync(fixture).filter((f) => f.includes('tmp'));
      assert.equal(remainingTmp.length, 0);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('rejects broken link as output destination', async () => {
    const fixture = createFixtureRoot();
    const brokenLink = path.join(fixture, 'broken_dir');
    try {
      fs.symlinkSync(
        path.join(fixture, 'non_existent_target'),
        brokenLink,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch {
      // If OS denies broken link creation, skip
      return;
    }

    const logs = [];
    const errors = [];
    try {
      const code = await main(['--paths', 'src/**', '--out', 'broken_dir/out.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /invalid or broken link|outside the repository root/i);
    } finally {
      try {
        fs.unlinkSync(brokenLink);
      } catch {}
      cleanupDir(fixture);
    }
  });

  test('rejects symlinked directory pointing into .git', async () => {
    const fixture = createFixtureRoot();
    const gitDir = path.join(fixture, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    const symGit = path.join(fixture, 'sym_git');

    fs.symlinkSync(gitDir, symGit, process.platform === 'win32' ? 'junction' : 'dir');

    const logs = [];
    const errors = [];
    try {
      const code = await main(['--paths', 'src/**', '--out', 'sym_git/pack.xml'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /inside \.git/i);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('destination allowlist: refuses .GIT, refuses docs/x.md, accepts default/allowed path', async () => {
    const fixture = createFixtureRoot();
    try {
      // 1. --out .GIT refused
      assert.throws(
        () => validateOutputPath(fixture, '.context-packs/.GIT'),
        /inside \.git/i,
      );
      assert.throws(
        () => validateOutputPath(fixture, '.GIT'),
        /inside \.git|inside \.context-packs/i,
      );

      // 2. --out docs/x.md refused
      assert.throws(
        () => validateOutputPath(fixture, 'docs/x.md'),
        /inside \.context-packs/i,
      );

      // 3. default/allowed path accepted
      const defaultDest = validateOutputPath(fixture);
      assert.ok(defaultDest.includes('.context-packs'));
      const allowedDest = validateOutputPath(fixture, '.context-packs/test-pack.xml');
      assert.ok(allowedDest.includes('.context-packs'));
    } finally {
      cleanupDir(fixture);
    }
  });

  test('rejects_character_class_glob_through_directory_alias: validateOutputPath refuses destination outside .context-packs and preserves source bytes', async () => {
    const fixture = createFixtureRoot();
    try {
      const srcDir = path.join(fixture, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const sourceFile = path.join(srcDir, 'a.ts');
      const originalBytes = 'export const a = 1;\n';
      fs.writeFileSync(sourceFile, originalBytes, 'utf8');

      const aliasDir = path.join(fixture, 'alias');
      try {
        fs.symlinkSync(srcDir, aliasDir, 'junction');
      } catch {}

      assert.throws(
        () => validateOutputPath(fixture, 'src/a.ts', ['alias/[a].ts']),
        /inside \.context-packs|Input\/output collision/i,
      );
      assert.strictEqual(fs.readFileSync(sourceFile, 'utf8'), originalBytes);
    } finally {
      cleanupDir(fixture);
    }
  });

  test('rejects_case_variant_git_pointer_on_windows: case-variant .git pointer output refused and preserved byte-for-byte', async () => {
    const fixture = createFixtureRoot();
    const gitFile = path.join(fixture, '.git');
    const gitPointerContent = 'gitdir: /fake/worktree/.git/worktrees/p-task-ai-158\n';
    fs.writeFileSync(gitFile, gitPointerContent, 'utf8');

    const logs = [];
    const errors = [];
    try {
      const code = await main(['--paths', 'src/**', '--out', '.GIT'], {
        root: fixture,
        log: (line) => logs.push(line),
        logError: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /inside \.git/i);
      assert.equal(fs.existsSync(gitFile), true);
      assert.equal(fs.readFileSync(gitFile, 'utf8'), gitPointerContent);
    } finally {
      cleanupDir(fixture);
    }
  });
});

describe('publishOutput unit suite', () => {
  test('atomically publishes pack via sibling temp file and rename', () => {
    const tmpDir = fs.mkdtempSync(path.join(TEST_TMP, 'pub-test-'));
    try {
      const tempPack = path.join(tmpDir, 'source-pack.xml');
      const targetOut = path.join(tmpDir, 'dest', 'final-output.xml');
      fs.writeFileSync(tempPack, '<pack>Clean Content</pack>\n', 'utf8');

      publishOutput(tempPack, targetOut);

      assert.equal(fs.existsSync(targetOut), true);
      assert.equal(fs.readFileSync(targetOut, 'utf8'), '<pack>Clean Content</pack>\n');
      const destFiles = fs.readdirSync(path.dirname(targetOut));
      assert.deepStrictEqual(destFiles, ['final-output.xml']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('preserves target and cleans sibling temp when rename fails', () => {
    const tmpDir = fs.mkdtempSync(path.join(TEST_TMP, 'pub-test-'));
    try {
      const tempPack = path.join(tmpDir, 'source-pack.xml');
      const targetOut = path.join(tmpDir, 'dest', 'final-output.xml');
      fs.mkdirSync(path.dirname(targetOut), { recursive: true });
      fs.writeFileSync(tempPack, '<pack>New Content</pack>\n', 'utf8');
      fs.writeFileSync(targetOut, '<pack>Original Content</pack>\n', 'utf8');

      assert.throws(
        () =>
          publishOutput(tempPack, targetOut, {
            rename: () => {
              throw new Error('EPERM: rename locked');
            },
          }),
        /rename locked/,
      );

      assert.equal(fs.readFileSync(targetOut, 'utf8'), '<pack>Original Content</pack>\n');
      const destFiles = fs.readdirSync(path.dirname(targetOut));
      assert.deepStrictEqual(destFiles, ['final-output.xml']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('preserves target and cleans sibling temp when copyFile fails', () => {
    const tmpDir = fs.mkdtempSync(path.join(TEST_TMP, 'pub-test-'));
    try {
      const tempPack = path.join(tmpDir, 'source-pack.xml');
      const targetOut = path.join(tmpDir, 'dest', 'final-output.xml');
      fs.mkdirSync(path.dirname(targetOut), { recursive: true });
      fs.writeFileSync(tempPack, '<pack>New Content</pack>\n', 'utf8');
      fs.writeFileSync(targetOut, '<pack>Original Content</pack>\n', 'utf8');

      assert.throws(
        () =>
          publishOutput(tempPack, targetOut, {
            copyFile: () => {
              throw new Error('ENOSPC: disk full');
            },
          }),
        /disk full/,
      );

      assert.equal(fs.readFileSync(targetOut, 'utf8'), '<pack>Original Content</pack>\n');
      const destFiles = fs.readdirSync(path.dirname(targetOut));
      assert.deepStrictEqual(destFiles, ['final-output.xml']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('destination alias and collision unit suite', () => {
  test('sameFileIdentity identifies same inode and device', () => {
    assert.equal(sameFileIdentity({ ino: 123, dev: 456 }, { ino: 123, dev: 456 }), true);
    assert.equal(sameFileIdentity({ ino: 123, dev: 456 }, { ino: 124, dev: 456 }), false);
    assert.equal(sameFileIdentity({ ino: 0, dev: 456 }, { ino: 0, dev: 456 }), false);
    assert.equal(sameFileIdentity(null, { ino: 123, dev: 456 }), false);
  });

  test('validateOutputPath rejects exact hard link collision with input file', () => {
    const tmpDir = fs.mkdtempSync(path.join(TEST_TMP, 'alias-test-'));
    try {
      const srcFile = path.join(tmpDir, 'source.js');
      const packsDir = path.join(tmpDir, '.context-packs');
      fs.mkdirSync(packsDir, { recursive: true });
      const hardLink = path.join(packsDir, 'alias.xml');
      fs.writeFileSync(srcFile, 'export const a = 1;\n', 'utf8');
      fs.linkSync(srcFile, hardLink);

      assert.throws(
        () => validateOutputPath(tmpDir, '.context-packs/alias.xml', ['source.js']),
        /Input\/output collision/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('TASK-AI-158 allowed paths and approved scope', () => {
  test('test_task_ai_158_delta_respects_allowed_paths: installer paths must not be present in PR delta', async () => {
    const cp = await import("node:child_process");
    const forbiddenInstallerPaths = [
      "tools/ctx-tools/attach.py",
      "tools/ctx-tools/test_attach.py",
    ];
    let diffPaths = [];
    try {
      const gitOut = cp.execSync("git -c safe.directory=* diff --name-only origin/main", {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      diffPaths = gitOut.split(/\r?\n/).filter(Boolean);
    } catch {
      diffPaths = forbiddenInstallerPaths.filter((p) => fs.existsSync(path.join(REPO_ROOT, p)));
    }
    for (const forbidden of forbiddenInstallerPaths) {
      assert.equal(
        diffPaths.includes(forbidden) || fs.existsSync(path.join(REPO_ROOT, forbidden)),
        false,
        `Installer path ${forbidden} must not be present in TASK-AI-158 PR delta`,
      );
    }
  });

  test('task_ai_158_respects_approved_scope: Work Item acceptance matrix contains only AC-AI-158-01 through 04', () => {
    const workItemDoc = fs.readFileSync(
      path.join(REPO_ROOT, "docs/product-spec/work-items/TASK-AI-158.md"),
      "utf8",
    );
    const acMatches = [...workItemDoc.matchAll(/\|\s*(AC-AI-158-\d+)\s*\|/g)].map((m) => m[1]);
    assert.deepStrictEqual(
      acMatches,
      ["AC-AI-158-01", "AC-AI-158-02", "AC-AI-158-03", "AC-AI-158-04"],
      "TASK-AI-158 acceptance matrix must contain only AC-AI-158-01 through AC-AI-158-04",
    );
    assert.equal(
      /AC-AI-158-05/i.test(workItemDoc),
      false,
      "AC-AI-158-05 must be removed from TASK-AI-158",
    );
    assert.equal(
      /MCP client configuration/i.test(workItemDoc) || /multi-client attachment script/i.test(workItemDoc),
      false,
      "Work item must not introduce MCP client configuration row",
    );
  });

  test('smoke_redacts_jsonrpc_error_payload: smoke CLI redacts sensitive error payload from stdout, stderr and results', async (t) => {
    const cp = await import("node:child_process");
    const CANARY = "CANARY_SECRET_158";
    let pythonCmd = null;
    for (const candidate of ["python", "python3", "py", "C:\\Program Files\\PostgreSQL\\16\\pgAdmin 4\\python\\python.exe"]) {
      try {
        cp.execFileSync(candidate, ["--version"], { stdio: "ignore" });
        pythonCmd = candidate;
        break;
      } catch {}
    }
    if (!pythonCmd) {
      t?.skip?.("python runtime unavailable for smoke redaction execution");
      return;
    }
    const testTmp = path.join(REPO_ROOT, ".oc", "tmp", "smoke-test-" + Date.now());
    fs.mkdirSync(testTmp, { recursive: true });
    try {
      const fakeServer = path.join(testTmp, "fake.py");
      fs.writeFileSync(
        fakeServer,
        [
          "import sys, json",
          "for line in sys.stdin:",
          "    try:",
          "        req = json.loads(line)",
          "        req_id = req.get(\"id\")",
          "        if req_id is not None:",
          '            err_resp = {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32000, "message": "Auth failure: password=' + CANARY + '"}}',
          "            sys.stdout.write(json.dumps(err_resp) + \"\\n\")",
          "            sys.stdout.flush()",
          "    except Exception:",
          "        pass",
        ].join("\n"),
        "utf8",
      );
      const entriesFile = path.join(testTmp, "entries.json");
      fs.writeFileSync(
        entriesFile,
        JSON.stringify({
          fake: {
            command: pythonCmd,
            args: [fakeServer],
          },
        }),
        "utf8",
      );
      const outDir = path.join(testTmp, "out");
      fs.mkdirSync(outDir, { recursive: true });
      let exitCode = 0;
      let stdout = "";
      let stderr = "";
      try {
        stdout = cp.execFileSync(
          pythonCmd,
          [
            path.join(REPO_ROOT, "tools", "ctx-tools", "smoke.py"),
            "--entries", entriesFile,
            "--out-dir", outDir,
            "--project", REPO_ROOT,
          ],
          { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
        );
      } catch (err) {
        exitCode = err.status ?? 1;
        stdout = err.stdout ?? "";
        stderr = err.stderr ?? "";
      }
      assert.notEqual(exitCode, 0, "smoke.py must exit non-zero when upstream returns error");
      assert.equal(stdout.includes(CANARY), false, `Secret ${CANARY} must not appear in stdout: ${stdout}`);
      assert.equal(stderr.includes(CANARY), false, `Secret ${CANARY} must not appear in stderr: ${stderr}`);
      const resultsFile = path.join(outDir, "smoke-results.json");
      if (fs.existsSync(resultsFile)) {
        const resultsJson = fs.readFileSync(resultsFile, "utf8");
        assert.equal(resultsJson.includes(CANARY), false, `Secret ${CANARY} must not appear in results: ${resultsJson}`);
      }
    } finally {
      fs.rmSync(testTmp, { recursive: true, force: true });
    }
  });
});
