'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'task-ai-142');
const CHECKER_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'ai',
  'check-no-hardcode.mjs'
);
const ALLOWLIST_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'ai',
  'hardcode-allowlist.json'
);
const BASELINE_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'ai',
  'hardcode-baseline.json'
);

// Dynamic import of ESM checker module
async function getChecker() {
  return await import('file:///' + CHECKER_PATH.replace(/\\/g, '/'));
}

test('TASK-AI-142: clean fixture produces zero violations', async () => {
  const checker = await getChecker();
  const file = path.join(FIXTURES_DIR, 'valid-clean.js');
  const violations = checker.scanFile(file);
  assert.equal(violations.length, 0, 'Clean dynamic code must have zero violations');
});

test('TASK-AI-142: flags string literals that look like model IDs', async () => {
  const checker = await getChecker();
  const file = path.join(FIXTURES_DIR, 'invalid-model-ids.js');
  const violations = checker.scanFile(file);

  assert.ok(violations.length >= 7, 'Must flag all hardcoded model string literals');
  const matchedStrings = violations.map((v) => v.matched);
  assert.ok(matchedStrings.includes('gpt-4o-2024-08-06'));
  assert.ok(matchedStrings.includes('claude-3-5-sonnet-20241022'));
  assert.ok(matchedStrings.includes('deepseek-chat'));
  assert.ok(matchedStrings.includes('gemini-1.5-pro'));
  assert.ok(matchedStrings.includes('qwen-2.5-coder-32b'));
  assert.ok(matchedStrings.includes('kimchi/minimax-m3'));
  assert.ok(matchedStrings.includes('cl/openai/gpt-6-astra'));

  for (const v of violations) {
    assert.equal(v.rule, 'MODEL_ID_LITERAL');
  }
});

test('TASK-AI-142: flags object and array literals pairing model IDs with numeric scores', async () => {
  const checker = await getChecker();
  const file = path.join(FIXTURES_DIR, 'invalid-scores.js');
  const violations = checker.scanFile(file);

  const scorePairViolations = violations.filter((v) => v.rule === 'MODEL_SCORE_PAIR');
  assert.ok(
    scorePairViolations.length >= 3,
    'Must flag direct pairs, object entries, and array pairs'
  );

  const matches = scorePairViolations.map((v) => v.matched);
  assert.ok(matches.some((m) => m.includes('gpt-4o: 85')));
  assert.ok(matches.some((m) => m.includes('gemini-3.8-flash-high -> score: 84')));
  assert.ok(matches.some((m) => m.includes('gpt-4o -> 90')));
});

test('TASK-AI-142: flags numeric literals assigned to names matching cap regex', async () => {
  const checker = await getChecker();
  const file = path.join(FIXTURES_DIR, 'invalid-caps.js');
  const violations = checker.scanFile(file);

  const capViolations = violations.filter((v) => v.rule === 'NUMERIC_CAP');
  assert.ok(capViolations.length >= 7, 'Must flag all numeric cap assignments');

  const matches = capViolations.map((v) => v.matched);
  assert.ok(matches.some((m) => m.includes('maxAttempts = 5')));
  assert.ok(matches.some((m) => m.includes('probeBudget = 1000')));
  assert.ok(matches.some((m) => m.includes('attemptLimit = 3')));
  assert.ok(matches.some((m) => m.includes('quality = 80')));
  assert.ok(matches.some((m) => m.includes('maxProbes: 10')));
  assert.ok(matches.some((m) => m.includes('probeBudgetMs: 180000')));
  assert.ok(matches.some((m) => m.includes('qualityFloor: 90')));
});

test('TASK-AI-142: isModelId correctly distinguishes model IDs from file paths, mime types, and git refs', async () => {
  const checker = await getChecker();

  // Model IDs
  assert.equal(checker.isModelId('gpt-4o'), true);
  assert.equal(checker.isModelId('claude-sonnet-5'), true);
  assert.equal(checker.isModelId('gemini-3.8-flash-high'), true);
  assert.equal(checker.isModelId('deepseek-v4.1-flash'), true);
  assert.equal(checker.isModelId('qwen3-8-max'), true);
  assert.equal(checker.isModelId('glm-5.3'), true);
  assert.equal(checker.isModelId('grok-4-6'), true);
  assert.equal(checker.isModelId('kimi-k3'), true);
  assert.equal(checker.isModelId('mistral-large'), true);
  assert.equal(checker.isModelId('llama-3-70b'), true);
  assert.equal(checker.isModelId('mercury-2'), true);
  assert.equal(checker.isModelId('muse-spark-1.3'), true);
  assert.equal(checker.isModelId('kimchi/minimax-m3'), true);
  assert.equal(checker.isModelId('cl/openai/gpt-6-astra'), true);

  // Non-model strings (paths, URLs, mime types, git refs, etc.)
  assert.equal(checker.isModelId('tools/ai-brain'), false);
  assert.equal(checker.isModelId('./routing'), false);
  assert.equal(checker.isModelId('../common.ps1'), false);
  assert.equal(checker.isModelId('application/json'), false);
  assert.equal(checker.isModelId('origin/main'), false);
  assert.equal(checker.isModelId('feat/task-ai-142'), false);
  assert.equal(checker.isModelId('https://benchlm.ai/data/models.json'), false);
  assert.equal(checker.isModelId('vinh05092001/shipde-platform'), false);
  assert.equal(checker.isModelId('N/A'), false);
});

test('TASK-AI-142: allowlist filters genuine safety invariant and requires reason', async () => {
  const checker = await getChecker();
  const file = path.join(FIXTURES_DIR, 'allowlisted-sample.js');
  const violations = checker.scanFile(file);

  assert.equal(violations.length, 1);
  assert.ok(violations[0].matched.includes('DEFAULT_MAX_ATTEMPTS = 10'));

  const allowlist = [
    {
      file: checker.normalizePath(file),
      pattern: 'DEFAULT_MAX_ATTEMPTS',
      reason: 'Atomic rename retry count safety invariant',
    },
  ];

  const result = checker.checkViolations(violations, allowlist, { total: 0, violations: [] });
  assert.equal(result.newViolations.length, 0, 'Must be filtered by allowlist');
  assert.equal(result.allowlistedCount, 1, 'Allowlisted count must be 1');

  // Allowlist entry without reason throws
  const badAllowlistFile = path.join(FIXTURES_DIR, 'bad-allowlist.json');
  fs.writeFileSync(badAllowlistFile, JSON.stringify([{ file: 'a.js', pattern: 'foo' }]), 'utf8');
  try {
    assert.throws(() => {
      checker.loadAllowlist(badAllowlistFile);
    }, /missing required reason/i);
  } finally {
    if (fs.existsSync(badAllowlistFile)) {
      fs.unlinkSync(badAllowlistFile);
    }
  }
});

test('TASK-AI-142: baseline check passes on existing violations and fails on new violations', async () => {
  const checker = await getChecker();
  const file = path.join(FIXTURES_DIR, 'invalid-model-ids.js');
  const violations = checker.scanFile(file);

  // Baseline containing the first 2 violations
  const baseline = {
    total: 2,
    violations: [
      {
        file: checker.normalizePath(file),
        line: violations[0].line,
        rule: violations[0].rule,
        matched: violations[0].matched,
      },
      {
        file: checker.normalizePath(file),
        line: violations[1].line,
        rule: violations[1].rule,
        matched: violations[1].matched,
      },
    ],
  };

  const result = checker.checkViolations(violations, [], baseline);
  assert.equal(result.baselineHitsCount, 2, 'Must match 2 baseline violations');
  assert.equal(
    result.newViolations.length,
    violations.length - 2,
    'Remaining must be new violations'
  );
});

test('TASK-AI-142: repository allowlist and baseline integrity', async () => {
  const checker = await getChecker();
  const allowlist = checker.loadAllowlist(ALLOWLIST_PATH);
  assert.ok(Array.isArray(allowlist), 'Allowlist must be an array');
  assert.ok(allowlist.length > 0, 'Allowlist must have entries');

  for (const entry of allowlist) {
    assert.ok(entry.file, 'Entry must have file');
    assert.ok(entry.pattern, 'Entry must have pattern');
    assert.ok(entry.reason, 'Entry must have reason');
    assert.ok(entry.reason.trim().length > 0, 'Reason must be non-empty');
  }

  const baseline = checker.loadBaseline(BASELINE_PATH);
  assert.ok(typeof baseline.total === 'number', 'Baseline must have total');
  assert.ok(Array.isArray(baseline.violations), 'Baseline violations must be array');
  assert.equal(baseline.total, baseline.violations.length, 'Total must match violations length');
  assert.ok(baseline.total > 0, 'Baseline must contain existing violations from main');
});

test('TASK-AI-142: CLI execution exits 0 on clean code and 1 on new hardcode', () => {
  const cleanFile = path.join(FIXTURES_DIR, 'valid-clean.js');
  const invalidFile = path.join(FIXTURES_DIR, 'invalid-model-ids.js');

  // Clean file check
  const cleanOut = execFileSync(process.execPath, [CHECKER_PATH, cleanFile], {
    encoding: 'utf8',
  });
  assert.ok(cleanOut.includes('PASS'), 'Clean file must pass');

  // Invalid file check must exit 1
  assert.throws(
    () => {
      execFileSync(process.execPath, [CHECKER_PATH, invalidFile], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    },
    (err) => {
      assert.equal(err.status, 1, 'Must exit with code 1');
      assert.ok(err.stderr.includes('No-hardcode guard failed'), 'Must output failure message');
      return true;
    }
  );
});

const { spawnSync } = require('node:child_process');

function withGuardRepo(run) {
  const root = fs.mkdtempSync(
    path.join(path.dirname(path.dirname(path.dirname(__dirname))), '.guard-test-')
  );
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  const write = (name, content) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const baseline = 'scripts/ai/hardcode-baseline.json';
  try {
    write('scripts/ai/check-no-hardcode.mjs', fs.readFileSync(CHECKER_PATH));
    write('scripts/ai/hardcode-allowlist.json', '[]');
    write(baseline, JSON.stringify({ total: 0, violations: [] }));
    git('init');
    git('config', 'user.email', 'guard-test@example.invalid');
    git('config', 'user.name', 'Guard test');
    git('add', '.');
    git('-c', 'core.hooksPath=disabled-hooks', 'commit', '-m', 'fixture');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const cli = (args = [], env = {}) =>
      spawnSync(process.execPath, [path.join(root, 'scripts/ai/check-no-hardcode.mjs'), ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_BASE_REF: '', ...env },
      });
    run({ root, git, write, cli, baseline });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('TASK-AI-142: unresolvable base exits 1', () =>
  withGuardRepo(({ cli }) => {
    const out = cli([], { GITHUB_BASE_REF: 'missing-base' });
    assert.equal(out.status, 1);
    assert.match(out.stderr, /Git failed.*merge-base/);
  }));

test('TASK-AI-142: appended baseline entry with unchanged total exits 1', () =>
  withGuardRepo(({ write, cli, baseline }) => {
    write(
      baseline,
      JSON.stringify({
        total: 0,
        violations: [{ file: 'a.js', rule: 'NUMERIC_CAP', matched: 'quality = 3' }],
      })
    );
    const out = cli();
    assert.equal(out.status, 1);
    assert.match(out.stderr, /total must equal/);
  }));

test('TASK-AI-142: baseline additions fail even with a consistent total', () =>
  withGuardRepo(({ write, cli, baseline }) => {
    write(
      baseline,
      JSON.stringify({
        total: 1,
        violations: [{ file: 'a.js', rule: 'NUMERIC_CAP', matched: 'quality = 3' }],
      })
    );
    const out = cli();
    assert.equal(out.status, 1);
    assert.match(out.stderr, /only shrink/);
  }));

test('TASK-AI-142: parse errors exit 1 and identify file', () =>
  withGuardRepo(({ write, cli }) => {
    write('tools/ai-brain/broken.js', 'function {');
    const out = cli(['--all']);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /broken.js/);
  }));

test('TASK-AI-142: unreadable target exits 1 and identifies file', () =>
  withGuardRepo(({ cli }) => {
    const out = cli(['tools/ai-brain/missing.js']);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /missing.js/);
  }));

test('TASK-AI-142: --all counts mjs and cjs files', () =>
  withGuardRepo(({ write, cli }) => {
    write('tools/ai-brain/module.mjs', 'export const value = process.env.VALUE;');
    write('tools/ai-brain/module.cjs', 'module.exports = process.env.VALUE;');
    const out = cli(['--all']);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /2 files scanned/);
  }));

test('TASK-AI-142: parameter and destructuring default caps are flagged', () =>
  withGuardRepo(({ write, cli }) => {
    write('tools/ai-brain/defaults.js', 'function run(maxAttempts = 4, {probeBudget = 5} = {}) {}');
    const out = cli(['--all']);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /maxAttempts = 4/);
    assert.match(out.stderr, /probeBudget = 5/);
  }));

test('TASK-AI-142: baseline comparison ignores lines but forbids replacement entries', async () => {
  const { enforceBaselineShrink } = await getChecker();
  const entry = {
    file: 'tools/ai-brain/a.js',
    rule: 'NUMERIC_CAP',
    matched: 'quality = 3',
    line: 1,
  };
  const previous = { total: 1, violations: [entry] };
  assert.doesNotThrow(() =>
    enforceBaselineShrink({ total: 1, violations: [{ ...entry, line: 2 }] }, previous)
  );
  assert.throws(
    () =>
      enforceBaselineShrink(
        { total: 1, violations: [{ ...entry, matched: 'quality = 4' }] },
        previous
      ),
    /only shrink/
  );
});

test('TASK-AI-142: allowlist cannot hide an unrelated violation on the same line', async () => {
  const checker = await getChecker();
  assert.equal(
    checker.isAllowlisted(
      {
        file: 'a.js',
        matched: 'quality = 4',
        lineText: 'const DEFAULT_MAX_ATTEMPTS = 10, quality = 4;',
      },
      [{ file: 'a.js', pattern: 'DEFAULT_MAX_ATTEMPTS', reason: 'rename safety invariant' }]
    ),
    false
  );
});

test('TASK-AI-142: renamed destructuring default caps are flagged', () =>
  withGuardRepo(({ write, cli }) => {
    write('tools/ai-brain/defaults.js', 'function run({maxAttempts: attempts = 4} = {}) {}');
    const out = cli(['--all']);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /maxAttempts = 4/);
  }));

test('TASK-AI-142: missing baseline not added in this PR fails closed', () =>
  withGuardRepo(({ cli }) => {
    const out = cli(['--baseline', 'scripts/ai/missing.json']);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /Cannot read baseline/);
  }));
