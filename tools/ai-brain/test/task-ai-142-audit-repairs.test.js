'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const seed = require('../seed-accounts');
const benchmarks = require('../benchmarks');
const routing = require('../routing');
const cli = require('../cli');
const ranking = require('../ranking');
const refreshQuota = require('../refresh-quota');
const routeHealth = require('../route-health');
const routeProbe = require('../route-probe');

describe('TASK-AI-142 Audit Repairs: Benchmark & Quality hygiene', () => {
  test('seed-accounts.js has NO hardcoded quality scores', () => {
    const rawContent = fs.readFileSync(path.join(__dirname, '..', 'seed-accounts.js'), 'utf8');
    assert.equal(
      /quality:\s*\d+/.test(rawContent),
      false,
      'seed-accounts.js must not contain any hardcoded quality: XX scores'
    );

    for (const acc of seed.ACCOUNTS) {
      for (const m of acc.models || []) {
        if (typeof m === 'object') {
          assert.equal(
            m.quality,
            undefined,
            `Model ${m.model} in account ${acc.id} must not have hardcoded quality`
          );
        }
      }
    }
  });

  test('benchmarks.json source_urls are valid swebench.com URLs and marked verified: false', () => {
    const list = benchmarks.loadBenchmarks();
    assert.ok(list.length > 0);
    for (const r of list) {
      assert.equal(r.verified, false, 'Shipped benchmark records must be verified: false');
      assert.equal(r.source_url, 'https://www.swebench.com/');
    }
  });
});

describe('TASK-AI-142 Audit Repairs: Score display shows "chưa rõ", not 100', () => {
  test('candidates lacking quality display "chưa rõ" in CLI ranked output and dry run log', () => {
    const candidateUnmeasured = {
      harness: 'test-harness',
      accessPath: 'cli',
      gateway: 'test-gw',
      upstream: 'test-up',
      accountId: 'test-acc',
      quotaScope: 'test-acc',
      modelId: 'test-up/unmeasured-free',
      contextWindow: 64000,
      quality: null,
      cost: 0,
      evidence: [],
    };
    candidateUnmeasured.candidateKey = routing.candidateKey(candidateUnmeasured);

    const assessment = {
      weightProfile: null,
      weightSource: 'jev-score',
      weights: { quality: 50, latency: 25, cost: 25 },
    };

    const taskProfile = {
      taskId: 'TASK-AUDIT-1',
      role: 'writer',
      complexity: 'standard',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      qualityFloor: 0,
      costCeiling: 100,
    };

    const ranked = routing.rankForProfile([candidateUnmeasured], taskProfile, assessment, {
      headrooms: { default: 'open' },
    });

    // Reason line must say (score chưa rõ, ...) and must NOT say "weights null"
    assert.ok(ranked.ranking.length > 0);
    assert.match(ranked.reason || '', /score chưa rõ/);
    assert.ok(!ranked.reason.includes('weights null'));
    assert.match(ranked.reason, /weights jev-score/);

    // Dry-run log formatting
    const logData = cli.buildDryRunLog({
      item: { workItemId: 'TASK-AUDIT-1' },
      now: Date.now(),
      annotated: [ranked.ranking[0]],
      candidatesApi: require('../candidates'),
      decision: {
        chosen: ranked.chosen,
        reason: ranked.reason,
        candidates: ranked.ranking.map((c) => ({
          offeringId: c.candidateKey,
          score: c.score,
          scoreBreakdown: c.scoreBreakdown,
          headroom: 'open',
        })),
        rejected: [],
      },
    });

    assert.equal(logData.candidates[0].score, 'chưa rõ');
    assert.equal(logData.ranking.ordered[0].score, 'chưa rõ');
  });
});

describe('TASK-AI-142 Audit Repairs: Ineligible and unprobed routes appear in rejected list', () => {
  test('assembleForDispatch records excluded candidates in excludedRoutes with reason code', () => {
    const candidateUnprobed = {
      modelId: '9router/model-unprobed',
      gateway: '9router',
      accountId: 'acc-9router',
    };
    const candidateFailing = {
      modelId: '9router/model-failing',
      gateway: '9router',
      accountId: 'acc-9router',
    };

    const failingKey = routeHealth.healthKey('9router/model-failing', { id: '9router', accountId: 'acc-9router' });
    const mockHealth = {
      version: 1,
      paths: {
        [failingKey]: {
          status: 'UNAVAILABLE_NOW',
          lastCheckedAt: new Date().toISOString(),
        },
      },
      events: [],
    };

    const registry = {
      sources: [{ id: '9router', kind: 'router' }],
    };

    const eligible = cli.assembleForDispatch({}, [], registry, {
      candidates: [candidateUnprobed, candidateFailing],
      routeHealth: mockHealth,
      requireRouteHealth: true,
    });

    // Both are excluded from eligible
    assert.equal(eligible.length, 0);

    // Both are captured in eligible.excludedRoutes
    assert.ok(Array.isArray(eligible.excludedRoutes));
    assert.equal(eligible.excludedRoutes.length, 2);

    const unprobedRec = eligible.excludedRoutes.find((r) => r.candidateKey.includes('model-unprobed'));
    assert.ok(unprobedRec);
    assert.equal(unprobedRec.reasonCode, 'ROUTE_PROBE_UNPROVEN');
    assert.equal(unprobedRec.scope, 'route');

    const failingRec = eligible.excludedRoutes.find((r) => r.candidateKey.includes('model-failing'));
    assert.ok(failingRec);
    assert.equal(failingRec.reasonCode, 'UNAVAILABLE_NOW');
  });
});

describe('TASK-AI-142 Audit Repairs: Transient cooldown for TIMEOUT and PROBE_NO_RESPONSE', () => {
  test('TIMEOUT and PROBE_NO_RESPONSE expire after 30 minutes to allow re-probing', () => {
    const cooldownMs = routeHealth.probeCooldownMs('TIMEOUT');
    assert.equal(cooldownMs, 30 * 60 * 1000, 'TIMEOUT must have 30m cooldown');

    const noResponseMs = routeHealth.probeCooldownMs('PROBE_NO_RESPONSE');
    assert.equal(noResponseMs, 30 * 60 * 1000, 'PROBE_NO_RESPONSE must have 30m cooldown');
  });
});

describe('TASK-AI-142 Audit Repairs: Live Codex CLI Quota Telemetry', () => {
  test('codex-cli with valid auth resolves status "open" and is NOT rejected with NATIVE_WRITER_QUOTA_UNVERIFIED', () => {
    const codexCandidate = {
      harness: 'codex',
      source: 'codex',
      sourceId: 'codex',
      accountId: 'codex-cli',
      quotaScope: 'codex-cli',
      modelId: 'gpt-5.3-codex',
      binding: 'cli-login',
      evidence: [],
      quality: 85,
      cost: 0,
    };
    codexCandidate.candidateKey = routing.candidateKey(codexCandidate);

    const fakeCodexOpts = {
      homeDir: '/fake/home',
      fs: {
        existsSync: (p) => p.endsWith('auth.json') || p.endsWith('config.toml'),
        statSync: () => ({ isFile: () => true }),
        readFileSync: () => 'model = "gpt-5.3-codex"\n',
      },
    };

    // Headroom resolution with live auth succeeds with 'open'
    const headroom = ranking.resolveCandidateHeadroom(codexCandidate, {
      codexOpts: fakeCodexOpts,
      useStoredQuota: true,
      now: Date.now(),
    });
    assert.equal(headroom.status, 'open');

    // Profile ranking admits codex-cli as writer
    const profile = {
      taskId: 'TASK-CODEX-WRITER',
      role: 'writer',
      complexity: 'complex',
      requiredCapabilities: [],
      proofFloor: 'NONE',
      qualityFloor: 50,
      costCeiling: 100,
    };
    const assessment = {
      weightProfile: 'QUALITY_FIRST',
      weights: routing.WEIGHT_PROFILES.QUALITY_FIRST,
    };

    const ranked = routing.rankForProfile([codexCandidate], profile, assessment, {
      codexOpts: fakeCodexOpts,
      useStoredQuota: true,
      now: Date.now(),
    });

    assert.equal(ranked.rejected.length, 0, 'codex-cli must not be rejected');
    assert.equal(ranked.chosen, codexCandidate.candidateKey);
  });

  test('refresh-quota.js supports codex provider and reports open when auth exists', () => {
    assert.ok(refreshQuota.SUPPORTED_PROVIDERS.has('codex'));
    const reading = refreshQuota.READERS.codex.read(
      { id: 'codex-cli', provider: 'codex' },
      {
        codexOpts: {
          fs: {
            existsSync: () => true,
            statSync: () => ({ isFile: () => true }),
          },
        },
      }
    );
    assert.equal(reading.available, true);
    assert.equal(reading.status, 'open');
  });
});

describe('TASK-AI-142 Audit Repairs: Route health file untracked from Git', () => {
  test('.gitignore contains tools/ai-brain/data/model-route-health.json', () => {
    const gitignoreContent = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.gitignore'), 'utf8');
    assert.ok(
      gitignoreContent.includes('tools/ai-brain/data/model-route-health.json'),
      '.gitignore must ignore model-route-health.json'
    );
  });
});
