'use strict';

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_RULES,
  parseBudgets,
  parseGitleaksConfig,
  loadRules,
  scanContent,
  formatReport,
  runStagedSecrets,
} = require('../staged-secrets');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'tools', 'ai-guard', 'cli.js');

/**
 * Every token used as a positive fixture is assembled from parts at runtime and
 * generated per run, so this file never contains a literal that Gitleaks (or
 * this scanner, scanning its own repository) would report. The same discipline
 * the secret-surface suite uses for the forbidden column spellings.
 */
const PAT_PREFIX = 'g' + 'hp';
function syntheticPat(seed) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let body = '';
  for (let i = 0; i < 36; i += 1) {
    body += alphabet[(seed + i * 7) % alphabet.length];
  }
  return [PAT_PREFIX, body].join('_');
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(args, cwd) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, 'git ' + args.join(' ') + ' failed: ' + (res.stderr || ''));
  return res.stdout;
}

function initRepo(prefix) {
  const dir = tempDir(prefix);
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'guard@example.invalid'], dir);
  git(['config', 'user.name', 'Guard Test'], dir);
  return dir;
}

function runCli(cwd, env) {
  const res = spawnSync(process.execPath, [CLI, 'staged-secrets'], {
    cwd,
    encoding: 'utf8',
    env: Object.assign({}, process.env, env || {}),
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}

const created = [];
function track(dir) {
  created.push(dir);
  return dir;
}

after(() => {
  for (const dir of created) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('staged-secrets — budgets', () => {
  test('the documented defaults are 5000ms and 536870912 bytes', () => {
    const budgets = parseBudgets({});
    assert.equal(budgets.timeoutMs, DEFAULT_TIMEOUT_MS);
    assert.equal(budgets.maxBytes, DEFAULT_MAX_BYTES);
    assert.equal(DEFAULT_TIMEOUT_MS, 5000);
    assert.equal(DEFAULT_MAX_BYTES, 512 * 1024 * 1024);
  });

  test('both budgets are overridable from the environment', () => {
    const budgets = parseBudgets({
      AI_GUARD_STAGED_TIMEOUT_MS: '250',
      AI_GUARD_STAGED_MAX_BYTES: '4096',
    });
    assert.equal(budgets.timeoutMs, 250);
    assert.equal(budgets.maxBytes, 4096);
  });

  test('a garbage or non-positive override falls back to the default, never to zero', () => {
    for (const bad of ['', '   ', 'soon', '0', '-1', 'NaN']) {
      const budgets = parseBudgets({
        AI_GUARD_STAGED_TIMEOUT_MS: bad,
        AI_GUARD_STAGED_MAX_BYTES: bad,
      });
      assert.equal(budgets.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeout for ' + JSON.stringify(bad));
      assert.equal(budgets.maxBytes, DEFAULT_MAX_BYTES, 'bytes for ' + JSON.stringify(bad));
    }
  });
});

describe('staged-secrets — .gitleaks.toml reading', () => {
  const sample = [
    'title = "sample"',
    '',
    '[allowlist]',
    'paths = [',
    "  '''^vendor[\\\\/]''',",
    ']',
    'stopwords = [',
    '  "NOT_A_SECRET_MARKER",',
    ']',
    'regexes = [',
    "  '''^\\s*key_behavior:''',",
    ']',
    '',
    '[[rules]]',
    'id = "sample-carrier-token"',
    "regex = '''(?:ghn|ghtk)_live_[0-9a-zA-Z]{16,}'''",
    'keywords = ["ghn_live_"]',
  ].join('\n');

  test('rule ids and regexes are extracted', () => {
    const parsed = parseGitleaksConfig(sample);
    const ids = parsed.rules.map((r) => r.id);
    assert.deepEqual(ids, ['sample-carrier-token']);
    assert.ok(parsed.rules[0].pattern.test(['ghn', 'live', 'a1b2c3d4e5f6g7h8x9'].join('_')));
  });

  test('the top-level allowlist arrays are extracted', () => {
    const parsed = parseGitleaksConfig(sample);
    assert.deepEqual(parsed.allowlist.stopwords, ['NOT_A_SECRET_MARKER']);
    assert.equal(parsed.allowlist.paths.length, 1);
    assert.equal(parsed.allowlist.regexes.length, 1);
    assert.ok(parsed.allowlist.paths[0].test('vendor/lib.js'));
  });

  test("this repository's real .gitleaks.toml parses into usable rules", () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, '.gitleaks.toml'), 'utf8');
    const parsed = parseGitleaksConfig(text);
    assert.ok(parsed.rules.length > 0, 'expected at least one repository rule');
    assert.ok(
      parsed.rules.some((r) => r.id === 'shipde-carrier-live-token'),
      'expected the carrier live token rule, got: ' + parsed.rules.map((r) => r.id).join(',')
    );
    assert.ok(parsed.allowlist.stopwords.length > 0);
  });

  test('a Go inline (?i) flag group is translated instead of dropping the rule', () => {
    const parsed = parseGitleaksConfig(
      ['[[rules]]', 'id = "case-insensitive"', "regex = '''(?i)ACME_TOKEN_[0-9]{6}'''"].join('\n')
    );
    assert.equal(parsed.rules.length, 1);
    assert.ok(parsed.rules[0].pattern.test('acme_token_123456'));
    assert.ok(parsed.rules[0].pattern.test('ACME_TOKEN_123456'));
  });

  test('a repository without .gitleaks.toml still gets the built-in rules', () => {
    const dir = track(tempDir('staged-norules-'));
    const loaded = loadRules(dir);
    assert.equal(loaded.configPath, null);
    assert.equal(loaded.rules.length, DEFAULT_RULES.length);
  });

  test('a repository with .gitleaks.toml gets its rules on top of the built-ins', () => {
    const dir = track(tempDir('staged-withrules-'));
    fs.writeFileSync(path.join(dir, '.gitleaks.toml'), sample);
    const loaded = loadRules(dir);
    assert.ok(loaded.rules.length > DEFAULT_RULES.length);
    assert.ok(loaded.rules.some((r) => r.id === 'sample-carrier-token'));
    assert.ok(loaded.rules.some((r) => r.id === 'github-pat'));
  });
});

describe('staged-secrets — content scanning', () => {
  const rules = DEFAULT_RULES.map((r) => ({ id: r.id, pattern: r.pattern, allowlist: [] }));

  test('a synthetic personal access token is reported with file, line and rule', () => {
    const text = 'const a = 1;\nconst b = 2;\nconst token = "' + syntheticPat(3) + '";\n';
    const found = scanContent(text, 'src/config.ts', rules, null);
    assert.equal(found.length, 1);
    assert.equal(found[0].file, 'src/config.ts');
    assert.equal(found[0].line, 3);
    assert.equal(found[0].rule, 'github-pat');
  });

  test('ordinary source is clean', () => {
    const found = scanContent('export const port = 3000;\n', 'src/port.ts', rules, null);
    assert.deepEqual(found, []);
  });

  test('a private key header is reported', () => {
    const header = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
    const found = scanContent('x\n' + header + '\n', 'id_rsa', rules, null);
    assert.equal(found.length, 1);
    assert.equal(found[0].rule, 'private-key');
  });

  test('no finding ever carries the matched value', () => {
    const token = syntheticPat(11);
    const found = scanContent('token=' + token + '\n', 'a.txt', rules, null);
    assert.equal(found.length, 1);
    assert.equal(JSON.stringify(found).includes(token), false);
  });

  test('a stopword exempts the match', () => {
    const token = syntheticPat(5);
    const allow = { regexes: [], stopwords: [token], paths: [] };
    assert.deepEqual(scanContent('t=' + token + '\n', 'a.txt', rules, allow), []);
  });

  test('an allowlisted line regex exempts only that line', () => {
    const tokenA = syntheticPat(7);
    const tokenB = syntheticPat(9);
    const allow = { regexes: [/^fixture:/], stopwords: [], paths: [] };
    const text = 'fixture: ' + tokenA + '\nreal: ' + tokenB + '\n';
    const found = scanContent(text, 'a.txt', rules, allow);
    assert.equal(found.length, 1);
    assert.equal(found[0].line, 2);
  });

  test('an allowlisted path exempts the whole file', () => {
    const allow = { regexes: [], stopwords: [], paths: [/^vendor\//] };
    assert.deepEqual(scanContent('t=' + syntheticPat(13), 'vendor/x.js', rules, allow), []);
  });

  test('every finding in a file is reported, in line order', () => {
    const text = 't1=' + syntheticPat(1) + '\nfiller\nt2=' + syntheticPat(2) + '\n';
    const found = scanContent(text, 'a.txt', rules, null);
    assert.deepEqual(
      found.map((f) => f.line),
      [1, 3]
    );
  });
});

describe('staged-secrets — the frozen output surface', () => {
  test('clean is exit 0 and the exact clean line', () => {
    const report = formatReport({ status: 'clean', detail: null, scanned: 4, findings: [] });
    assert.equal(report.exitCode, 0);
    assert.equal(report.lines[0], 'STAGED_SCAN_CLEAN: 0 secrets detected');
    assert.equal(report.lines[1], 'staged files scanned: 4');
  });

  test('a detection is exit 1 and names the file on the first line, with no value', () => {
    const report = formatReport({
      status: 'detected',
      detail: null,
      scanned: 1,
      findings: [{ file: 'src/a.ts', line: 7, rule: 'github-pat' }],
    });
    assert.equal(report.exitCode, 1);
    assert.equal(report.lines[0], 'STAGED_SECRET_DETECTED: src/a.ts');
    assert.equal(report.lines[1], '  rule: github-pat line: 7');
  });

  test('a budget overrun is exit 2 and the budget line', () => {
    const report = formatReport({
      status: 'budget',
      detail: 'timeout 5000ms exceeded',
      scanned: 0,
      findings: [],
    });
    assert.equal(report.exitCode, 2);
    assert.equal(report.lines[0], 'STAGED_SCAN_BUDGET_EXCEEDED: timeout 5000ms exceeded');
  });

  test('an operational failure is exit 2 and the error line', () => {
    const report = formatReport({ status: 'error', detail: 'boom', scanned: 0, findings: [] });
    assert.equal(report.exitCode, 2);
    assert.equal(report.lines[0], 'STAGED_SCAN_ERROR: boom');
  });
});

describe('staged-secrets — scanning a real git index', () => {
  test('a benign staged change is clean (AC-AI-36-08)', () => {
    const dir = track(initRepo('staged-clean-'));
    fs.writeFileSync(path.join(dir, 'clean.txt'), 'export const port = 3000;\n');
    git(['add', 'clean.txt'], dir);
    const report = runStagedSecrets(dir);
    assert.equal(report.status, 'clean');
    assert.equal(report.exitCode, 0);
    assert.equal(report.scanned, 1);
  });

  test('a staged binary blob is skipped rather than scanned as text', () => {
    const dir = track(initRepo('staged-binary-'));
    fs.writeFileSync(path.join(dir, 'text.txt'), 'plain\n');
    fs.writeFileSync(
      path.join(dir, 'blob.bin'),
      Buffer.concat([Buffer.from('t=' + syntheticPat(41)), Buffer.from([0, 1, 2])])
    );
    git(['add', 'text.txt', 'blob.bin'], dir);
    const report = runStagedSecrets(dir);
    assert.equal(report.status, 'clean');
    assert.equal(report.scanned, 1);
  });

  test('an unstaged secret in the working tree is not a staged secret', () => {
    const dir = track(initRepo('staged-unstaged-'));
    fs.writeFileSync(path.join(dir, 'ok.txt'), 'fine\n');
    git(['add', 'ok.txt'], dir);
    git(['commit', '-qm', 'base'], dir);
    fs.writeFileSync(path.join(dir, 'leak.txt'), 't=' + syntheticPat(17) + '\n');
    const report = runStagedSecrets(dir);
    assert.equal(report.status, 'clean');
    assert.equal(report.exitCode, 0);
  });

  test('a staged secret is detected in a repository that already has commits', () => {
    const dir = track(initRepo('staged-head-'));
    fs.writeFileSync(path.join(dir, 'ok.txt'), 'fine\n');
    git(['add', 'ok.txt'], dir);
    git(['commit', '-qm', 'base'], dir);
    fs.writeFileSync(path.join(dir, 'later.txt'), 't=' + syntheticPat(19) + '\n');
    git(['add', 'later.txt'], dir);
    const report = runStagedSecrets(dir);
    assert.equal(report.status, 'detected');
    assert.equal(report.exitCode, 1);
    assert.equal(report.findings[0].file, 'later.txt');
  });

  test('the index is read, not the working tree: a deleted-after-staging fixture still blocks', () => {
    const dir = track(initRepo('staged-index-'));
    const file = path.join(dir, 'staged-only-fixture.txt');
    fs.writeFileSync(file, 'key=' + syntheticPat(23) + '\n');
    git(['add', 'staged-only-fixture.txt'], dir);
    fs.unlinkSync(file);
    assert.equal(fs.existsSync(file), false);
    const report = runStagedSecrets(dir);
    assert.equal(report.exitCode, 1);
    assert.equal(report.findings[0].file, 'staged-only-fixture.txt');
  });

  test('a working-tree edit after staging does not hide the staged secret', () => {
    const dir = track(initRepo('staged-edited-'));
    const file = path.join(dir, 'edited.txt');
    fs.writeFileSync(file, 'key=' + syntheticPat(29) + '\n');
    git(['add', 'edited.txt'], dir);
    fs.writeFileSync(file, 'key=redacted\n');
    const report = runStagedSecrets(dir);
    assert.equal(report.exitCode, 1);
    assert.equal(report.findings[0].file, 'edited.txt');
  });

  test('the scanner exits 2 outside a git repository rather than reporting clean', () => {
    const dir = track(tempDir('staged-nogit-'));
    const report = runStagedSecrets(dir);
    assert.equal(report.status, 'error');
    assert.equal(report.exitCode, 2);
  });

  test('the byte budget is enforced by the scanner', () => {
    const dir = track(initRepo('staged-bytes-'));
    fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(1024 * 1024) + '\n');
    git(['add', 'big.txt'], dir);
    const report = runStagedSecrets(dir, { env: { AI_GUARD_STAGED_MAX_BYTES: '1024' } });
    assert.equal(report.status, 'budget');
    assert.equal(report.exitCode, 2);
  });

  test('the time budget is enforced by the scanner', () => {
    const dir = track(initRepo('staged-time-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
    git(['add', 'a.txt'], dir);
    const report = runStagedSecrets(dir, { env: { AI_GUARD_STAGED_TIMEOUT_MS: '1' } });
    assert.equal(report.status, 'budget');
    assert.equal(report.exitCode, 2);
  });
});

describe('staged-secrets — the cli command', () => {
  test('a clean index prints the clean line and exits 0 (AC-AI-36-08)', () => {
    const dir = track(initRepo('cli-clean-'));
    fs.writeFileSync(path.join(dir, 'clean.txt'), 'export const port = 3000;\n');
    git(['add', 'clean.txt'], dir);
    const res = runCli(dir);
    assert.equal(res.code, 0);
    assert.ok(
      res.out.includes('STAGED_SCAN_CLEAN: 0 secrets detected'),
      'got: ' + JSON.stringify(res.out)
    );
  });

  test('a generated fixture is blocked with exit 1 and its file name (AC-AI-36-09)', () => {
    const dir = track(initRepo('cli-secret-'));
    fs.writeFileSync(path.join(dir, 'generated-fixture.txt'), 'token=' + syntheticPat(31) + '\n');
    git(['add', 'generated-fixture.txt'], dir);
    const res = runCli(dir);
    assert.equal(res.code, 1, 'got: ' + JSON.stringify(res.out));
    assert.ok(res.out.includes('STAGED_SECRET_DETECTED: generated-fixture.txt'));
  });

  test('the cli reads the index, not the working tree (AC-AI-36-10)', () => {
    const dir = track(initRepo('cli-index-'));
    const file = path.join(dir, 'staged-only-fixture.txt');
    fs.writeFileSync(file, 'key=' + syntheticPat(37) + '\n');
    git(['add', 'staged-only-fixture.txt'], dir);
    fs.unlinkSync(file);
    const res = runCli(dir);
    assert.equal(res.code, 1, 'got: ' + JSON.stringify(res.out));
    assert.ok(res.out.includes('STAGED_SECRET_DETECTED: staged-only-fixture.txt'));
  });

  test('both budgets exit 2 with STAGED_SCAN_BUDGET_EXCEEDED (AC-AI-36-11)', () => {
    const dir = track(initRepo('cli-budget-'));
    fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(5 * 1024 * 1024) + '\n');
    git(['add', 'big.txt'], dir);

    const byTime = runCli(dir, { AI_GUARD_STAGED_TIMEOUT_MS: '1' });
    assert.equal(byTime.code, 2, 'time: ' + JSON.stringify(byTime.out));
    assert.ok(byTime.out.includes('STAGED_SCAN_BUDGET_EXCEEDED'));

    const byBytes = runCli(dir, { AI_GUARD_STAGED_MAX_BYTES: '1024' });
    assert.equal(byBytes.code, 2, 'bytes: ' + JSON.stringify(byBytes.out));
    assert.ok(byBytes.out.includes('STAGED_SCAN_BUDGET_EXCEEDED'));
  });
});
