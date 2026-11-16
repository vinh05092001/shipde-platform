'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dispatchCommand } = require('../cli');
const health = require('../route-health');
const { candidateKey } = require('../candidates');

test('ticket admission uses the CLI health file before the dependency default', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-health-input-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ticket = path.join(root, 'ticket.md');
  fs.writeFileSync(
    ticket,
    '# TASK-AI-171: fixture\nGOAL: fixture\nVERIFY: fixture\nALLOWED FILES: fixture.js'
  );
  const c = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: 'fixture-router',
    upstream: 'fixture-upstream',
    accountId: 'fixture-account',
    quotaScope: 'fixture-account',
    modelId: 'fixture-model',
    quality: 90,
    cost: 1,
    contextWindow: 128000,
    qualifiedRoles: ['author.foundation'],
  };
  const explicit = path.join(root, 'explicit-health.json');
  const fallback = path.join(root, 'fallback-health.json');
  health.saveStore(explicit, {
    version: 1,
    paths: {
      [health.healthKey(c.modelId, c.gateway)]: {
        modelId: c.modelId,
        routeId: c.gateway,
        status: 'AVAILABLE',
        classifierVersion: 2,
      },
    },
    events: [],
  });
  health.saveStore(fallback, { version: 1, paths: {}, events: [] });
  const before = [explicit, fallback].map((file) => fs.readFileSync(file, 'utf8'));
  const logs = [];
  await dispatchCommand(
    { ticket, 'dry-run': true, json: true, 'onboarding-prepared': true, 'route-health': explicit },
    {
      candidates: [c],
      accounts: [],
      registry: { sources: [] },
      requireRouteHealth: true,
      routeHealthFile: fallback,
      quotaState: { scopes: {} },
      evidenceData: {},
      scoringPolicyFile: path.join(root, 'absent-scoring-policy.json'),
      home: root,
      decisionDir: root,
      evidenceDir: root,
      onboardingPrepared: true,
      log: (value) => logs.push(value),
      error: () => {},
      exit: () => {},
    }
  );
  const decision = logs
    .map((value) => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })
    .find((value) => value?.profile);
  assert.ok(decision, 'real dispatch emits a decision');
  assert.ok(
    decision.ranking.some((row) => row.candidateKey === candidateKey(c)),
    'proven route is admitted instead of ROUTE_PROBE_UNPROVEN'
  );
  assert.deepEqual(
    [explicit, fallback].map((file) => fs.readFileSync(file, 'utf8')),
    before
  );
});
