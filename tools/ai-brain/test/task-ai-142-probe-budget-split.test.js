'use strict';

// Live trial 15 (2026-10-18 15:59Z, goal G-F622511E): capability proofs for CLI
// writers ran first and their duration was charged to the writer route-probe
// window (#388), so the route window was already spent when route probing
// began; the item ended PROBE_BUDGET_EXHAUSTED without probing a single route.
// Capability proofs have their own budget (schemaProbeBudgetMs); the route
// window starts when route probing starts and its length comes from the
// dispatch configuration, not a module constant.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'orchestrate.js'), 'utf8');

test('the writer route-probe window is not charged with capability proof time', () => {
  assert.doesNotMatch(
    source,
    /writerProbeStartedAt\s*=\s*Date\.now\(\)\s*-\s*\(?o\.capabilityProbeDurationMs/
  );
});

test('writer route-probe budget checks read the configured budget', () => {
  assert.doesNotMatch(source, /Date\.now\(\)\s*-\s*writerProbeStartedAt\s*>=\s*PROBE_BUDGET_MS/);
  assert.match(
    source,
    /writerProbeBudgetMs\s*=\s*o\.probeBudgetMs\s*\?\?\s*itemDispatchConfig\.probeBudgetMs/
  );
});
