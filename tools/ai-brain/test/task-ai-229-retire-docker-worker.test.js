'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const RETIRED_FILES = [
  'scripts/ai/docker-worker/Dockerfile',
  'scripts/ai/docker-worker/docker-compose.yml',
  'scripts/ai/docker-worker/start-worker.bat',
  'scripts/ai/docker-worker/account-fingerprint.js',
  'scripts/ai/create-docker-shortcut.ps1',
  'scripts/ai/review-pr.ps1',
];

const RETAINED_OPERATOR_SCRIPTS = [
  'scripts/ai/bootstrap-worktrees.ps1',
  'scripts/ai/install-clis.ps1',
  'scripts/ai/install-control-shortcut.ps1',
  'scripts/ai/protect-main.ps1',
];

test('AC1: retired Docker writer files and review-pr.ps1 are absent while retained operator scripts exist', () => {
  for (const rel of RETIRED_FILES) {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, rel)),
      false,
      `retired file must not exist: ${rel}`
    );
  }
  for (const rel of RETAINED_OPERATOR_SCRIPTS) {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, rel)),
      true,
      `retained operator script must still exist: ${rel}`
    );
  }
});

test('AC1: seed-accounts.js removes agy-docker-b and docker-compose launch while retaining native AGY seed', () => {
  const { ACCOUNTS } = require('../seed-accounts');
  assert.ok(Array.isArray(ACCOUNTS) && ACCOUNTS.length > 0, 'ACCOUNTS must be non-empty');
  assert.equal(
    ACCOUNTS.some((a) => a && a.id === 'agy-docker-b'),
    false,
    'agy-docker-b must be removed from live ACCOUNTS'
  );
  assert.equal(
    ACCOUNTS.some((a) => a && a.launch && a.launch.kind === 'docker-compose'),
    false,
    'no live account may use docker-compose launch'
  );
  assert.equal(
    ACCOUNTS.some((a) => a && a.launch && String(a.launch.dir || '').includes('docker-worker')),
    false,
    'no live account may reference scripts/ai/docker-worker'
  );
  assert.equal(
    ACCOUNTS.some((a) => a && a.id === 'agy-native-a'),
    true,
    'native AGY seed agy-native-a must be preserved'
  );
});

test('AC2: .trivyignore removes Docker-only DS-0002 exception and validate_docs.py drops review-pr.ps1 only', () => {
  const trivy = fs.readFileSync(path.join(REPO_ROOT, '.trivyignore'), 'utf8');
  assert.doesNotMatch(trivy, /\bDS-0002\b/, '.trivyignore must not retain DS-0002');
  assert.doesNotMatch(
    trivy,
    /scripts\/ai\/docker-worker\/Dockerfile/,
    '.trivyignore must not reference retired Dockerfile'
  );

  const validator = fs.readFileSync(
    path.join(REPO_ROOT, 'docs/product-spec/scripts/validate_docs.py'),
    'utf8'
  );
  assert.doesNotMatch(
    validator,
    /scripts\/ai\/review-pr\.ps1/,
    'validate_docs.py must no longer require scripts/ai/review-pr.ps1'
  );
  for (const rel of RETAINED_OPERATOR_SCRIPTS) {
    assert.ok(validator.includes(rel), `validate_docs.py must retain ${rel}`);
  }
});

test('AC1: live runtime scripts and operator documentation contain zero references to retired paths', () => {
  const retiredPatterns = [
    /scripts\/ai\/docker-worker/i,
    /create-docker-shortcut\.ps1/i,
    /review-pr\.ps1/i,
  ];
  const liveTargets = [
    'scripts/ai/README.md',
    'docs/product-spec/docs/10-ai-collaboration/WINDOWS-SETUP-RUNBOOK.md',
    'tools/ai-brain/seed-accounts.js',
  ];

  // Also scan all live scripts under scripts/ai/ (excluding test/)
  const scriptsDir = path.join(REPO_ROOT, 'scripts', 'ai');
  for (const entry of fs.readdirSync(scriptsDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(ps1|mjs|js)$/i.test(entry.name)) {
      liveTargets.push(`scripts/ai/${entry.name}`);
    }
  }

  for (const rel of liveTargets) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const pattern of retiredPatterns) {
      assert.doesNotMatch(text, pattern, `live file ${rel} must not reference ${pattern}`);
    }
  }
});
