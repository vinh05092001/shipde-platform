'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const capabilityProbe = require('../capability-probe');

test('probes run concurrently up to maxConcurrentProbes so late strong candidates are reached', async () => {
  const candidates = Array.from({ length: 6 }, (_, i) => ({
    harness: 'codex',
    accessPath: 'cli',
    accountId: 'acct-' + i,
    modelId: 'model-' + i,
    capabilities: {},
  }));
  let inFlight = 0;
  let peak = 0;
  await capabilityProbe.probeCapabilities(
    candidates,
    { role: 'writer', requiredCapabilities: ['tools'] },
    {
      maxConcurrentProbes: 3,
      priors: { ranking: [] },
      registry: { sources: [], dispatch: { probeRoundRobinBatch: 1 } },
      probeCli: async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inFlight--;
        return { ok: true, method: 'fixture-real-observation' };
      },
    }
  );
  assert.equal(peak, 3, 'three probes are in flight at once');
  assert.ok(
    candidates.every((c) => c.capabilities.tools === true),
    'every candidate is reached'
  );
});
