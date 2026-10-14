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
