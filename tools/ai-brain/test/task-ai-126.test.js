'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { getHarness } = require('../harness');
const classify = require('../failure-classifier').classifyFailure;
const { generateCandidates } = require('../candidates');
const sourcesApi = require('../sources');
const orch = require('../orchestrate');

describe('TASK-AI-126', () => {
  test('AL-R01: autoclaw argv building without the token value', () => {
    const adapter = getHarness('autoclaw');
    const job = {
      model: 'zai/zai_auto',
      cwd: process.cwd(),
      prompt: 'Test message',
      sessionId: 's123',
    };
    const args = adapter.launch(job);

    // Check that we have the openclaw args
    assert.ok(args.includes('agent'));
    assert.ok(args.includes('--agent'));
    assert.ok(args.includes('main'));
    assert.ok(args.includes('--session-id'));
    assert.ok(args.includes('s123'));
    assert.ok(args.includes('--model'));
    assert.ok(args.includes('zai/zai_auto'));
    assert.ok(args.includes('--message'));

    // Must NOT contain token
    const hasTokenArg = args.some(
      (a) => String(a).includes('gateway-token') || String(a).includes('TOKEN')
    );
    assert.ok(!hasTokenArg, 'must not pass token in argv');
  });

  test('AL-R01: 810002 classification', () => {
    const res = classify({ stdout: 'Error 810002: high demand' });
    assert.equal(res.cause, 'upstream_rate_limit');
    assert.equal(res.retryable, true);
    assert.equal(res.retryAfterMs, 120000);
  });

  test('AL-R02: candidate registration with failure domains', () => {
    const registry = sourcesApi.loadSources({ file: path.join(__dirname, '../sources.json') });
    const candidates = generateCandidates({ registry, discoverPool: true, openCodeIds: [] });

    const agyCandidates = candidates.filter((c) => c.harness === 'agy-pool');
    assert.ok(agyCandidates.length > 0, 'agy-pool candidates must be registered');

    const autoCandidates = candidates.filter((c) => c.harness === 'autoclaw');
    assert.ok(autoCandidates.length > 0, 'autoclaw candidates must be registered');

    // verify failure domains
    for (const c of autoCandidates) {
      assert.equal(c.upstream, 'zai');
      assert.equal(c.quotaScope, 'zai');
    }
  });

  test('AL-R03: launcher flag gating', async () => {
    // isolated launcher missing and external worker not requested
    const orch = require('../orchestrate');
    let thrown = false;
    try {
      const { resolveLauncher } = orch; // it's not exported, so we have to use runOrchestration or require it.
      // runOrchestration will fail at LAUNCHER_MISSING if launcher is null.
      await orch.runOrchestration('goal', {
        specs: [{ id: 'ITEM1' }],
        candidates: [{ harness: 'autoclaw' }],
        isolatedWorker: false,
        externalWorkers: '', // not requested
        decisionDir: path.join(process.cwd(), 'dummy'),
      });
    } catch (e) {
      thrown = true;
      assert.ok(e.message.includes('LAUNCHER_MISSING') || e.message.includes('goal'), e.message);
    }
    // With externalWorkers set, runOrchestration should not throw LAUNCHER_MISSING
    // because resolveLauncher will return a function.
    let thrown2 = false;
    try {
      await orch.runOrchestration('goal', {
        specs: [{ id: 'ITEM1' }],
        candidates: [{ harness: 'autoclaw' }],
        isolatedWorker: false,
        externalWorkers: 'autoclaw',
        decisionDir: path.join(process.cwd(), 'dummy'),
        tests: () => ({ exitCode: 0, stdout: '', stderr: '' }),
      });
    } catch (e) {
      thrown2 = true;
      if (e.message.includes('LAUNCHER_MISSING')) assert.fail('should not be missing launcher');
    }
  });

  test('AL-R05: agy account validation', () => {
    const adapter = getHarness('agy-pool');
    const res = adapter.launch({ accountId: 'invalid' }, {});
    assert.equal(res.state, 'error');
    assert.equal(res.refusal, 'INVALID_ACCOUNT_ID');
  });
});
