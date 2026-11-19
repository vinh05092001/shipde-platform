'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  launchHermesSession,
  selectReasoningCandidate,
  buildHermesArgv,
} = require('../hermes-session');
const routing = require('../routing');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'hermes-dyn-model-'));
}

test('TASK-AI-142: source alias resolution derives aliases dynamically from fixture sources.json without hardcoding', () => {
  const tmpDir = makeTempDir('sources-alias-');
  try {
    const fixtureSourcesPath = path.join(tmpDir, 'sources.json');
    const fixture = {
      version: 2,
      sources: [
        {
          id: 'custom-vendor',
          label: 'Custom Vendor',
          kind: 'model-source',
          aliases: ['vendor-alias-1', 'vendor-alias-2'],
          routerAlias: 'cv',
        },
      ],
      dispatch: {
        hermesOrchestrator: {
          qualityFloor: 60,
          costCeiling: 100000,
          weightProfile: 'LATENCY_FIRST',
          complexity: 'standard',
          maxProbes: 16,
          maxRoutesPerAccount: 3,
        },
      },
    };
    fs.writeFileSync(fixtureSourcesPath, JSON.stringify(fixture, null, 2), 'utf8');

    const sourcesApi = require('../sources');
    const quotaScanApi = require('../quota-scan');
    const registry = sourcesApi.loadSources({ file: fixtureSourcesPath });

    // Test resolving by alias
    const aliasesFromAlias = sourcesApi.getSourceAliases('vendor-alias-1', registry);
    assert.ok(aliasesFromAlias.includes('vendor-alias-1'));
    assert.ok(aliasesFromAlias.includes('custom-vendor'));
    assert.ok(aliasesFromAlias.includes('vendor-alias-2'));
    assert.ok(aliasesFromAlias.includes('cv'));

    // Test resolving by stripped opencode-provider gateway
    const aliasesFromGw = sourcesApi.getSourceAliases(
      'opencode-provider-vendor-alias-2-options',
      registry
    );
    assert.ok(aliasesFromGw.includes('custom-vendor'));
    assert.ok(aliasesFromGw.includes('vendor-alias-1'));

    // Test quotaScope lookup using the alias-derived registry
    const now = 1700000000000;
    const quotaState = {
      scopes: {
        'vendor-alias-1::test-model': {
          source: 'vendor-alias-1',
          scope: 'test-model',
          code: 'QUOTA',
          status: 429,
          at: new Date(now).toISOString(),
          retryAfter: now + 60000,
        },
      },
    };
    const cand = {
      gateway: 'opencode-provider-custom-vendor-options',
      modelId: 'test-model',
    };
    const scopeState = quotaScanApi.getQuotaScopeState(cand, quotaState, { now, registry });
    assert.ok(scopeState, 'Must resolve scope across aliases');
    assert.equal(scopeState.code, 'QUOTA');
    assert.equal(quotaScanApi.isScopeBlocked(scopeState, now), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
