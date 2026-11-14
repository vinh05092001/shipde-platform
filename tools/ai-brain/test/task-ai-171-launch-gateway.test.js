'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dispatchCommand } = require('../cli');
const { candidateKey } = require('../discovery/identity');
const { getHarness } = require('../harness');
const BASE = '0123456789abcdef0123456789abcdef01234567';
function launch(gateway, source, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-launch-'));
  const prompt = path.join(dir, 'prompt.md');
  fs.writeFileSync(prompt, 'Test bounded task.');
  const c = {
    harness: 'paseo',
    accessPath: 'http://127.0.0.1:20128/v1',
    gateway,
    source,
    upstream: 'cmc',
    accountId: 'xkiro',
    quotaScope: 'xkiro',
    modelId: 'cmc/moonshotai/Kimi-K3.1-Pro',
    quality: 90,
    cost: 1,
    qualifiedRoles: ['author.foundation'],
    ...(options.candidate || {}),
  };
  c.candidateKey = candidateKey(c);
  const checkpointFile = options.checkpoint ? path.join(dir, 'checkpoint.json') : undefined;
  if (checkpointFile) {
    fs.writeFileSync(
      checkpointFile,
      JSON.stringify({ selectedCandidate: c.candidateKey, ...(options.checkpointFields || {}) })
    );
  }
  const registry = JSON.parse(JSON.stringify(require('../sources').loadSources()));
  // Fixture-only credentials: this test exercises route resolution, not environment authentication.
  for (const source of registry.sources) {
    delete source.credential;
    delete source.apiKeyEnv;
  }
  if (options.routerWithoutRoute) {
    registry.sources.push({ id: options.routerWithoutRoute, kind: 'router' });
  }
  if (options.upstreamRoute) {
    registry.dispatch.providers.cmc = {
      harness: 'paseo',
      provider: 'unexpected-backend',
      modelPrefix: 'unexpected/',
    };
  }
  let job, argv;
  const adapter = {
    ...getHarness('paseo'),
    launch(x) {
      job = x;
      if (c.harness !== 'paseo') return ['adapter-fixture', x.model];
      return getHarness('paseo').launch(x);
    },
  };
  try {
    const result = dispatchCommand(
      {
        execute: true,
        json: true,
        cwd: dir,
        item: 'TASK-AI-171-GATEWAY',
        'prompt-file': prompt,
        'base-sha': BASE,
      },
      {
        candidates: [c],
        registry,
        checkpointFile,
        maxAttempts: 1,
        concurrency: 1,
        now: Date.now(),
        probeEvidence: (modelId, route) =>
          modelId === c.modelId &&
          route.id === (c.gateway || c.upstream) &&
          route.accountId === c.accountId,
        quotaState: { scopes: {} },
        routeHealth: { version: 1, paths: {}, events: [] },
        scoringPolicyFile: path.join(dir, 'no-scoring-policy.json'),
        home: dir,
        decisionDir: dir,
        evidenceDir: dir,
        baseSha: BASE,
        gitRoot: () => dir,
        commitExists: () => true,
        log: () => {},
        error: () => {},
        exit: () => {},
        harnessAdapter: adapter,
        run: (_adapter, args) => {
          argv = args;
          return {
            exitCode: 0,
            stdout: JSON.stringify({ agentId: 'test-session', status: 'running' }),
          };
        },
      }
    );
    if (options.expectFailure) return { job, argv, result };
    assert.equal(result.exitCode, 0, JSON.stringify(result).slice(0, 2500));
    assert.equal(result.chosen, c.candidateKey, 'Controller chosen identity is preserved');
    assert.equal(result.launchedArgvIdentity.gateway, gateway || '');
    assert.equal(result.launchedArgvIdentity.upstream, c.upstream);
    assert.equal(result.launchedArgvIdentity.account, c.accountId);
    return { job, argv };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test('checkpoint resume retains the current router source instead of launching its backend provider', () => {
  const { job, argv } = launch('9router', '9router', { checkpoint: true });
  assert.equal(job.provider, 'opencode');
  assert.equal(job.model, 'ninerouter/cmc/moonshotai/Kimi-K3.1-Pro');
  assert.equal(argv[argv.indexOf('--provider') + 1], 'opencode');
  assert.equal(argv[argv.indexOf('--model') + 1], job.model);
});
test('current exact candidate source overrides stale checkpoint source', () => {
  const { job } = launch('9router', '9router', {
    checkpoint: true,
    checkpointFields: { source: 'cmc' },
  });
  assert.equal(job.provider, 'opencode');
  assert.equal(job.model, 'ninerouter/cmc/moonshotai/Kimi-K3.1-Pro');
});
test('fresh selection keeps its existing router identity', () => {
  const { job } = launch('9router', '9router');
  assert.equal(job.provider, 'opencode');
  assert.equal(job.model, 'ninerouter/cmc/moonshotai/Kimi-K3.1-Pro');
});
