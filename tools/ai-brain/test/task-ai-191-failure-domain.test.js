'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BRAIN_DIR = path.resolve(__dirname, '..');
const fd = require('../failure-domain');
const routing = require('../routing');

test('TASK-AI-191 AC1: failure-domain.js exports match routing.js re-exports', () => {
  for (const name of [
    'canonicalFailureDomain',
    'failureDomainOf',
    'sameFailureDomain',
    'matchesForbiddenDomain',
  ]) {
    assert.equal(typeof fd[name], 'function', `failure-domain.${name} must be a function`);
    assert.equal(routing[name], fd[name], `routing.${name} must re-export failure-domain.${name}`);
  }
  assert.equal(
    fd.canonicalFailureDomain(
      'opencode-direct::http://127.0.0.1:20128/v1::9router::9router::9router::9router::vinh'
    ),
    '9router/9router'
  );
  assert.equal(
    fd.sameFailureDomain(
      { gateway: '9router', upstream: 'grok' },
      { gateway: '9router', upstream: 'grok' },
      { scope: 'upstream' }
    ),
    true
  );
});

test('TASK-AI-191 AC2: live orchestrate/intake/publisher modules do not require routing.js or ranking.js', () => {
  const migrated = [
    'orchestrate.js',
    'orchestrate/candidate-select.js',
    'orchestrate/checkpoint.js',
    'orchestrate/repair-round.js',
    'orchestrate/review-item.js',
    'orchestrate/review-lane.js',
    'publisher.js',
    'intake.js',
    'planning-services.js',
  ];
  for (const rel of migrated) {
    const src = fs.readFileSync(path.join(BRAIN_DIR, rel), 'utf8');
    assert.doesNotMatch(
      src,
      /require\(\s*['"]\.{1,2}\/routing['"]\s*\)/,
      `${rel} should not require routing.js`
    );
    assert.doesNotMatch(
      src,
      /require\(\s*['"]\.{1,2}\/ranking['"]\s*\)/,
      `${rel} should not require ranking.js`
    );
  }
});
