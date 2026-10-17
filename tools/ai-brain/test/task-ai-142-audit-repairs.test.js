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

  test('benchmarks.json has purged unverified/fabricated benchmark records and is empty', () => {
    const list = benchmarks.loadBenchmarks();
    assert.ok(Array.isArray(list), 'loadBenchmarks must return array');
    assert.equal(list.length, 0, 'shipped benchmarks must be empty (fabricated records purged)');
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

  const writerProfile = {
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

  function makeRolloutContent({
    usedPrimary = 90,
    usedSecondary = 86,
    windowPrimary = 300,
    windowSecondary = 10080,
    resetsPrimary = 1792211503,
    timestamp = new Date().toISOString(),
  } = {}) {
    return (
      JSON.stringify({
        timestamp,
        type: 'event_msg',
        payload: {
          type: 'rate_limits',
          rate_limits: {
            limit_id: 'codex',
            primary: {
              used_percent: usedPrimary,
              window_minutes: windowPrimary,
              resets_at: resetsPrimary,
            },
            secondary: {
              used_percent: usedSecondary,
              window_minutes: windowSecondary,
              resets_at: 1792650681,
            },
            credits: { has_credits: false, balance: '0' },
          },
        },
      }) + '\n'
    );
  }

  function makeFakeCodexFs({ auth = true, config = 'model = "gpt-5.3-codex"\n', sessions = [] } = {}) {
    const files = new Map();
    const dirs = new Set(['/fake', '/fake/home', '/fake/home/.codex', '/fake/home/.codex/sessions']);

    if (auth) files.set('/fake/home/.codex/auth.json', '{"auth":"dummy"}');
    if (config) files.set('/fake/home/.codex/config.toml', config);

    for (const s of sessions) {
      const filePath = `/fake/home/.codex/sessions/${s.name}`;
      files.set(filePath, s.content);
    }

    return {
      existsSync: (p) => {
        const norm = p.replace(/\\/g, '/');
        return files.has(norm) || dirs.has(norm);
      },
      readdirSync: (dir) => {
        const norm = dir.replace(/\\/g, '/');
        const prefix = norm.endsWith('/') ? norm : norm + '/';
        const names = [];
        for (const f of files.keys()) {
          if (f.startsWith(prefix)) {
            const rest = f.slice(prefix.length);
            if (!rest.includes('/')) {
              names.push(rest);
            }
          }
        }
        return names;
      },
      statSync: (p) => {
        const norm = p.replace(/\\/g, '/');
        if (dirs.has(norm)) {
          return { isDirectory: () => true, isFile: () => false };
        }
        if (files.has(norm)) {
          return { isDirectory: () => false, isFile: () => true };
        }
        throw new Error(`ENOENT: ${p}`);
      },
      readFileSync: (p) => {
        const norm = p.replace(/\\/g, '/');
        if (norm.endsWith('auth.json')) {
          throw new Error('AUTH_FORBIDDEN: auth.json must never be read for quota!');
        }
        if (!files.has(norm)) throw new Error(`ENOENT: ${p}`);
        return files.get(norm);
      },
    };
  }

  test('auth.json present but NO session rollout logs -> unknown status, rejected with NATIVE_WRITER_QUOTA_UNVERIFIED', () => {
    const now = Date.now();
    const fakeFs = makeFakeCodexFs({ auth: true, sessions: [] });
    const codexOpts = { homeDir: '/fake/home', fs: fakeFs };

    const headroom = ranking.resolveCandidateHeadroom(codexCandidate, {
      codexOpts,
      useStoredQuota: true,
      now,
    });
    assert.equal(headroom.status, 'unknown', 'absence of session rollout must resolve unknown');

    const ranked = routing.rankForProfile([codexCandidate], writerProfile, assessment, {
      codexOpts,
      useStoredQuota: true,
      now,
    });
    assert.equal(ranked.ranking.length, 0, 'writer cannot be chosen without live quota telemetry');
    const rejection = ranked.rejected.find((r) => r.candidateKey === codexCandidate.candidateKey);
    assert.ok(rejection, 'candidate must be rejected');
    assert.equal(rejection.reasonCode, 'NATIVE_WRITER_QUOTA_UNVERIFIED');
  });

  test('fixture rollout with 90%/86% resolves "tight" status and is admitted in writer ranking', () => {
    const now = Date.now();
    const content = makeRolloutContent({ usedPrimary: 90, usedSecondary: 86, timestamp: new Date(now).toISOString() });
    const fakeFs = makeFakeCodexFs({
      auth: true,
      sessions: [{ name: 'rollout-2026-10-17T06-51-57-test.jsonl', content }],
    });
    const codexOpts = { homeDir: '/fake/home', fs: fakeFs };

    const headroom = ranking.resolveCandidateHeadroom(codexCandidate, {
      codexOpts,
      useStoredQuota: true,
      now,
    });
    assert.equal(headroom.status, 'tight', '90% used primary is past 80% threshold -> tight');

    const ranked = routing.rankForProfile([codexCandidate], writerProfile, assessment, {
      codexOpts,
      useStoredQuota: true,
      now,
    });
    assert.equal(ranked.rejected.length, 0, 'candidate must be admitted when tight');
    assert.equal(ranked.chosen, codexCandidate.candidateKey);
  });

  test('fixture rollout with 50%/40% resolves "open" status and is admitted in writer ranking', () => {
    const now = Date.now();
    const content = makeRolloutContent({ usedPrimary: 50, usedSecondary: 40, timestamp: new Date(now).toISOString() });
    const fakeFs = makeFakeCodexFs({
      auth: true,
      sessions: [{ name: 'rollout-2026-10-17T06-51-57-test.jsonl', content }],
    });
    const codexOpts = { homeDir: '/fake/home', fs: fakeFs };

    const headroom = ranking.resolveCandidateHeadroom(codexCandidate, {
      codexOpts,
      useStoredQuota: true,
      now,
    });
    assert.equal(headroom.status, 'open', '50% used primary is below threshold -> open');

    const ranked = routing.rankForProfile([codexCandidate], writerProfile, assessment, {
      codexOpts,
      useStoredQuota: true,
      now,
    });
    assert.equal(ranked.rejected.length, 0);
    assert.equal(ranked.chosen, codexCandidate.candidateKey);
  });

  test('fixture rollout with 100% resolves "exhausted" with resets_at and is rejected with QUOTA_EXHAUSTED', () => {
    const now = Date.now();
    const resetEpoch = Math.floor(now / 1000) + 7200;
    const content = makeRolloutContent({
      usedPrimary: 100,
      usedSecondary: 60,
      resetsPrimary: resetEpoch,
      timestamp: new Date(now).toISOString(),
    });
    const fakeFs = makeFakeCodexFs({
      auth: true,
      sessions: [{ name: 'rollout-2026-10-17T06-51-57-test.jsonl', content }],
    });
    const codexOpts = { homeDir: '/fake/home', fs: fakeFs };

    const headroom = ranking.resolveCandidateHeadroom(codexCandidate, {
      codexOpts,
      useStoredQuota: true,
      now,
    });
    assert.equal(headroom.status, 'exhausted');
    assert.equal(headroom.cooldownUntil, new Date(resetEpoch * 1000).toISOString());

    const ranked = routing.rankForProfile([codexCandidate], writerProfile, assessment, {
      codexOpts,
      useStoredQuota: true,
      now,
    });
    assert.equal(ranked.ranking.length, 0);
    const rejection = ranked.rejected.find((r) => r.candidateKey === codexCandidate.candidateKey);
    assert.ok(rejection);
    assert.equal(rejection.reasonCode, 'QUOTA_EXHAUSTED');
  });

  test('stale rollout reading (older than primary window_minutes) resolves "unknown"', () => {
    const now = Date.now();
    // 350 minutes old with a 300 minute primary window
    const oldTime = new Date(now - 350 * 60 * 1000).toISOString();
    const content = makeRolloutContent({
      usedPrimary: 50,
      windowPrimary: 300,
      timestamp: oldTime,
    });
    const fakeFs = makeFakeCodexFs({
      auth: true,
      sessions: [{ name: 'rollout-2026-10-17T01-00-00-test.jsonl', content }],
    });
    const codexOpts = { homeDir: '/fake/home', fs: fakeFs };

    const headroom = ranking.resolveCandidateHeadroom(codexCandidate, {
      codexOpts,
      useStoredQuota: true,
      now,
    });
    assert.equal(headroom.status, 'unknown', 'reading older than window_minutes must be unknown');
  });

  test('refresh-quota.js supports codex provider and delegates to readCodexSessionQuota', () => {
    assert.ok(refreshQuota.SUPPORTED_PROVIDERS.has('codex'));
    const now = Date.now();
    const content = makeRolloutContent({ usedPrimary: 90, usedSecondary: 86, timestamp: new Date(now).toISOString() });
    const fakeFs = makeFakeCodexFs({
      auth: true,
      sessions: [{ name: 'rollout-2026-10-17T06-51-57-test.jsonl', content }],
    });
    const reading = refreshQuota.READERS.codex.read(
      { id: 'codex-cli', provider: 'codex' },
      {
        codexOpts: { homeDir: '/fake/home', fs: fakeFs },
        now,
      }
    );
    assert.equal(reading.available, true);
    assert.equal(reading.status, 'tight');
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
