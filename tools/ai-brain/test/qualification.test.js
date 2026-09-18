'use strict';
// TASK-AI-30 — deterministic unit tests for the qualification rule.
// Injected functions and plain objects only; no network, no real registry.
const { describe, test } = require('node:test');
const assert = require('node:assert');
const { probeRuleFindings, resultCredentialFindings } = require('../acceptance/lib/qualification');

describe('Probe rule', () => {
  test('accepts a compliant injected configuration', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      account: { id: 'acc-1', provider: 'claude-code' },
      provider: 'claude-code',
      outcome: 'pass',
      isEntryAdmitted: () => true,
      isProviderSupported: () => true,
      recordOutcome: () => true,
    });
    assert.deepStrictEqual(findings, []);
  });

  test('refuses a configuration missing required fields', () => {
    const findings = probeRuleFindings({});
    assert.ok(findings.length >= 4);
    for (const f of findings) assert.ok(f.startsWith('PROBE_VIOLATED'));
  });

  test('refuses a configuration with non-positive timeout', () => {
    const findings = probeRuleFindings({
      timeoutMs: 0,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
    });
    assert.ok(findings.some((f) => f.includes('timeoutMs')));
  });

  test('refuses a configuration with tree kill disabled', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: false,
      cheapestModel: true,
      cacheWindowMs: 60_000,
    });
    assert.ok(findings.some((f) => f.includes('treeKill')));
  });

  test('refuses a configuration with cheapest model not selected', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: false,
      cacheWindowMs: 60_000,
    });
    assert.ok(findings.some((f) => f.includes('cheapestModel')));
  });

  test('refuses a configuration with non-positive cache window', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: -1,
    });
    assert.ok(findings.some((f) => f.includes('cacheWindowMs')));
  });

  test('refuses when the injected entry admission fails', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      account: { id: 'acc-1' },
      isEntryAdmitted: () => false,
    });
    assert.ok(findings.some((f) => f.includes('entry-admitted')));
  });

  test('refuses when the injected provider is unsupported', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      provider: 'unknown',
      isProviderSupported: () => false,
    });
    assert.ok(findings.some((f) => f.includes('provider')));
  });

  test('refuses when the injected outcome is not recorded', () => {
    const findings = probeRuleFindings({
      timeoutMs: 30_000,
      treeKill: true,
      cheapestModel: true,
      cacheWindowMs: 60_000,
      outcome: 'pass',
      recordOutcome: () => false,
    });
    assert.ok(findings.some((f) => f.includes('outcome')));
  });
});

describe('Result credential rule', () => {
  test('accepts a clean well-formed result', () => {
    const result = {
      accountId: 'acc-1',
      model: 'claude-haiku-4-5-20251001',
      instant: '2026-09-17T00:00:00.000Z',
      outcome: 'pass',
      latencyMs: 1200,
      reason: 'answered',
    };
    assert.deepStrictEqual(resultCredentialFindings(result, 'super-secret'), []);
  });

  test('flags a result that carries the credential', () => {
    const result = {
      accountId: 'acc-1',
      model: 'claude-haiku-4-5-20251001',
      instant: '2026-09-17T00:00:00.000Z',
      outcome: 'pass',
      latencyMs: 1200,
      reason: 'super-secret',
    };
    const findings = resultCredentialFindings(result, 'super-secret');
    assert.ok(findings.some((f) => f.startsWith('CREDENTIAL_IN_RESULT')));
  });

  test('flags a result missing required fields', () => {
    const findings = resultCredentialFindings({ accountId: 'acc-1' }, '');
    assert.ok(findings.some((f) => f.startsWith('RESULT_SHAPE')));
  });

  test('refuses a non-object result', () => {
    assert.ok(resultCredentialFindings(null, '').some((f) => f.startsWith('RESULT_SHAPE')));
    assert.ok(
      resultCredentialFindings('not an object', '').some((f) => f.startsWith('RESULT_SHAPE'))
    );
  });
});
