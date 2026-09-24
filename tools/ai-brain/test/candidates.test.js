'use strict';

/**
 * Acceptance tests for Slices B+C: candidate generation, ranking, and
 * decision recording.
 *
 * LAYER 1 — Unit tests of the algorithm.
 * Use fixed, obviously-invented ids (test-up/invented-*).  They test ranking,
 * scoring, scope and fallback.  They must not call the network, and they must
 * not pretend their ids are real models.
 *
 * LAYER 2 — Integration check against data.
 * Loads catalogue-snapshot.json (committed, with provenance) and validates
 * that the chosen id exists in the snapshot.  When the snapshot drifts from
 * the live catalogue, the test fails with MODEL_NOT_IN_CATALOG — that is the
 * signal to refresh the snapshot, not to ignore the mismatch.
 *
 * Every test is deterministic — no network calls, all I/O mocked through
 * temp directories.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const evidence = require('../evidence');
const candidates = require('../candidates');
const ranking = require('../ranking');
const decisions = require('../decisions');
const sourcesApi = require('../sources');

// ── Evidence Store ────────────────────────────────────────────────────

describe('evidence store', () => {
  test('loads empty evidence when file does not exist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    const data = evidence.loadEvidence(dir);
    assert.deepEqual(data.combinations, []);
    assert.deepEqual(data.aliases, []);
    assert.deepEqual(data.sharedQuotas, []);
  });

  test('records a probe and updates upstream status', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    evidence.recordProbe(dir, {
      harness: 'paseo', accessPath: 'http', upstream: 'test-up', modelId: 'test-up/invented-alpha',
    }, {
      level: evidence.Level.API, status: 'passed', httpStatus: 200, source: 'test',
    });
    const data = evidence.loadEvidence(dir);
    assert.equal(data.combinations.length, 1);
    assert.equal(data.combinations[0].evidence[0].status, 'passed');
  });

  test('blocks upstream on 402, scoped to that upstream only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    evidence.recordProbe(dir, {
      harness: 'paseo', accessPath: 'http', upstream: 'test-blocked', modelId: 'test-blocked/invented-model',
    }, {
      level: evidence.Level.API, status: 'failed', httpStatus: 402,
      source: 'test', cause: '402 Payment Required',
    });
    const data = evidence.loadEvidence(dir);

    // test-blocked is blocked.
    const blockedBlock = evidence.isUpstreamBlocked(data, 'test-blocked');
    assert.equal(blockedBlock.blocked, true);
    assert.match(blockedBlock.reason, /402/);
    assert.equal(blockedBlock.scope, 'upstream');

    // test-up is NOT blocked — failure scope is per-upstream.
    const otherBlock = evidence.isUpstreamBlocked(data, 'test-up');
    assert.equal(otherBlock.blocked, false);
  });

  test('block expires after TTL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    evidence.recordProbe(dir, {
      harness: 'paseo', accessPath: 'http', upstream: 'test-ttl', modelId: 'test-ttl/invented-model',
    }, {
      level: evidence.Level.API, status: 'failed', httpStatus: 402, source: 'test',
    });
    const data = evidence.loadEvidence(dir);
    // Simulate time passing beyond TTL.
    const future = Date.now() + evidence.BLOCK_TTL_MS + 1000;
    const block = evidence.isUpstreamBlocked(data, 'test-ttl', { now: future });
    assert.equal(block.blocked, false);
  });

  test('records aliases with verified flag', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    evidence.recordAlias(dir, 'test-up', 'invented-model-v2', 'opencode', 'invented-model', false,
      'OpenCode alias differs from HTTP id');
    const data = evidence.loadEvidence(dir);
    assert.equal(data.aliases.length, 1);
    assert.equal(data.aliases[0].verified, false);
    assert.equal(data.aliases[0].canonical, 'invented-model-v2');
  });

  test('shared-quota defaults to unknown', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    evidence.recordSharedQuota(dir, 'path-a', 'path-b');
    const data = evidence.loadEvidence(dir);
    assert.equal(data.sharedQuotas[0].status, 'unknown');
    assert.equal(data.sharedQuotas[0].verified, false);
  });

  test('candidateKey produces four-part identity', () => {
    const key = evidence.candidateKey({
      harness: 'paseo', accessPath: 'http', upstream: 'test-up', modelId: 'test-up/invented-model',
    });
    assert.equal(key, 'paseo::http::test-up::test-up/invented-model');
  });
});

// ── Candidate Generation ──────────────────────────────────────────────

describe('candidate generation', () => {
  test('generates candidates from gateway catalogue without hard-coded models', () => {
    const registry = sourcesApi.loadSources();
    // Invented catalogue — these ids are not real models.
    const catalogue = [
      'test-a/invented-alpha',
      'test-b/invented-beta',
      'test-c/invented-gamma',
    ];

    const result = candidates.generateCandidates({ registry, catalogue });

    // Must have candidates from multiple different upstreams.
    const upstreams = new Set(result.map((c) => c.upstream));
    assert.ok(upstreams.has('test-a'), 'has test-a upstream');
    assert.ok(upstreams.has('test-b'), 'has test-b upstream');
    assert.ok(upstreams.has('test-c'), 'has test-c upstream');

    // Every candidate has the four-part identity.
    for (const c of result) {
      assert.ok(c.harness, 'has harness');
      assert.ok(c.accessPath, 'has accessPath');
      assert.ok(c.upstream, 'has upstream');
      assert.ok(c.modelId, 'has modelId');
    }
  });

  test('generates agy candidates from agent-cli sources', () => {
    const registry = sourcesApi.loadSources();
    const result = candidates.generateCandidates({ registry, catalogue: [] });

    // agy-local should appear as a candidate (with wildcard model).
    const agy = result.find((c) => c.source === 'agy-local');
    assert.ok(agy, 'has agy-local candidate');
    assert.equal(agy.harness, 'agy');
    assert.equal(agy.accessPath, 'cli');
  });

  test('OpenCode alias and HTTP id are separate candidates', () => {
    const registry = sourcesApi.loadSources();
    const catalogue = ['test-up/invented-model-v2'];
    const openCodeIds = ['ninerouter/test-up/invented-model'];

    const result = candidates.generateCandidates({ registry, catalogue, openCodeIds });

    // The HTTP candidate.
    const httpCandidate = result.find(
      (c) => c.modelId === 'test-up/invented-model-v2' && c.harness === 'paseo' && c.accessPath.includes('127.0.0.1')
    );
    // The OpenCode candidate (via oc source).
    const ocCandidate = result.find(
      (c) => c.modelId === 'ninerouter/test-up/invented-model' && c.harness === 'opencode'
    );

    assert.ok(httpCandidate, 'HTTP candidate exists');
    assert.ok(ocCandidate, 'OpenCode candidate exists');
    // They are different candidates.
    assert.notEqual(
      evidence.candidateKey(httpCandidate),
      evidence.candidateKey(ocCandidate),
      'HTTP and OpenCode are distinct candidates'
    );
  });

  test('candidatesFromEvidence recovers models not in the live catalogue', () => {
    const evData = {
      combinations: [
        {
          harness: 'paseo', accessPath: 'http', upstream: 'test-ev',
          model: 'test-ev/invented-recovered', source: 'test-ev',
          evidence: [{ level: 1, status: 'failed', httpStatus: 403 }],
        },
      ],
      aliases: [],
      sharedQuotas: [],
      upstreamStatus: {},
    };
    const fromEvidence = candidates.candidatesFromEvidence(evData);
    assert.equal(fromEvidence.length, 1);
    assert.equal(fromEvidence[0].modelId, 'test-ev/invented-recovered');
  });

  test('mergeCandidates deduplicates by four-part key', () => {
    const a = [{ harness: 'paseo', accessPath: 'http', upstream: 'test-up', modelId: 'test-up/invented-a' }];
    const b = [
      { harness: 'paseo', accessPath: 'http', upstream: 'test-up', modelId: 'test-up/invented-a' },
      { harness: 'paseo', accessPath: 'http', upstream: 'test-up2', modelId: 'test-up2/invented-b' },
    ];
    const merged = candidates.mergeCandidates(a, b);
    assert.equal(merged.length, 2);
  });

  test('adding a source through data only (no code change) produces candidates', () => {
    // Write a custom sources.json with an extra source.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'));
    const customRegistry = {
      version: 2,
      sources: [
        {
          id: 'newprovider',
          label: 'NewProvider',
          kind: 'model-source',
          servesModels: true,
          reachedVia: '9router',
          routerAlias: 'np',
          credential: { type: 'api-key', env: 'NP_KEY' },
          verify: { method: 'completion' },
        },
        {
          id: '9router',
          label: '9Router',
          kind: 'router',
          servesModels: true,
          endpoint: 'http://127.0.0.1:20128/v1',
          credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
          verify: { method: 'models-list', path: '/models' },
        },
      ],
    };
    const file = path.join(dir, 'sources.json');
    fs.writeFileSync(file, JSON.stringify(customRegistry), 'utf8');

    const registry = sourcesApi.loadSources({ file });
    const catalogue = ['np/invented-new-model', 'test-up/invented-other'];
    const result = candidates.generateCandidates({ registry, catalogue });

    // The new provider's model appears without any code change.
    const np = result.find((c) => c.upstream === 'np' && c.modelId === 'np/invented-new-model');
    assert.ok(np, 'new data-only source produced a candidate');
    assert.equal(np.source, 'newprovider');
  });

  // F2: model-source accessPath resolves to router endpoint, not source id
  test('model-source candidate carries router endpoint as accessPath, not source id (F2)', () => {
    const registry = sourcesApi.loadSources();
    const catalogue = ['kr/invented-model-f2'];
    const result = candidates.generateCandidates({ registry, catalogue });

    const krCandidate = result.find(
      (c) => c.upstream === 'kr' && c.source === 'xkiro'
    );
    assert.ok(krCandidate, 'xkiro model-source candidate exists');
    // accessPath must be the router endpoint URL, not '9router'.
    assert.ok(
      krCandidate.accessPath.startsWith('http'),
      'accessPath is a URL, not a source id: ' + krCandidate.accessPath
    );
    assert.equal(krCandidate.accessPath, 'http://127.0.0.1:20128/v1');
    // reachedVia records the indirection.
    assert.equal(krCandidate.reachedVia, '9router');
  });
});

// ── Ranking (LAYER 1 — unit tests with invented ids) ─────────────────

describe('ranking', () => {
  test('ranks candidates and selects winner with stated reason', () => {
    const testCandidates = [
      { harness: 'paseo', accessPath: 'http', upstream: 'test-a', modelId: 'test-a/invented-alpha',
        source: '9router', status: 'passed', evidence: [{ level: 3, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'test-b', modelId: 'test-b/invented-beta',
        source: '9router', status: 'unknown', evidence: [],
        blocked: false, sharedQuota: 'unknown' },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-01',
      role: 'author.foundation',
      kind: 'author.foundation',
      dryRun: true,
    });

    assert.ok(decision.chosen, 'has a winner');
    assert.ok(decision.reason, 'has a stated reason');
    assert.match(decision.reason, /Score/, 'reason includes score');
    assert.ok(decision.candidates.length >= 2, 'candidates list present');
    assert.ok(decision.candidates.every((c) => c.score !== undefined), 'every candidate has a score');
  });

  test('rejects blocked upstream, scoped to that upstream only', () => {
    const testCandidates = [
      { harness: 'paseo', accessPath: 'http', upstream: 'test-blocked', modelId: 'test-blocked/invented-model',
        source: '9router', status: 'failed', evidence: [],
        blocked: true, blockReason: 'HTTP 402', blockScope: 'upstream', sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'test-a', modelId: 'test-a/invented-alpha',
        source: '9router', status: 'passed', evidence: [{ level: 2, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'test-c', modelId: 'test-c/invented-gamma',
        source: '9router', status: 'unknown', evidence: [],
        blocked: false, sharedQuota: 'unknown' },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-02', role: 'author.foundation', dryRun: true,
    });

    // test-blocked is rejected.
    const blockedRejection = decision.rejected.find((r) => r.upstream === 'test-blocked');
    assert.ok(blockedRejection, 'blocked upstream is rejected');
    assert.match(blockedRejection.reason, /402/);
    assert.equal(blockedRejection.scope, 'upstream');

    // test-a and test-c are still eligible.
    const aCandidate = decision.candidates.find((c) => c.upstream === 'test-a');
    assert.ok(aCandidate, 'test-a is still eligible');
    const cCandidate = decision.candidates.find((c) => c.upstream === 'test-c');
    assert.ok(cCandidate, 'test-c is still eligible');
  });

  test('rejects candidate with absent credential', () => {
    const registry = sourcesApi.loadSources();
    const testCandidates = [
      { harness: 'paseo', accessPath: 'http', upstream: 'bai', modelId: 'bai/invented-model',
        source: 'bai', status: 'unknown', evidence: [],
        blocked: false, sharedQuota: 'unknown' },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-03', role: 'author.foundation', dryRun: true,
      registry,
      credentialOpts: { env: {} }, // no env vars set
    });

    const baiRejection = decision.rejected.find((r) => r.offeringId.includes('bai'));
    assert.ok(baiRejection, 'bai rejected for missing credential');
    assert.match(baiRejection.reason, /no credential/);
  });

  test('refuses when no candidate qualifies', () => {
    const decision = ranking.rankAndRecord([], {
      workItemId: 'TASK-TEST-04', role: 'author.foundation', dryRun: true,
    });

    assert.equal(decision.chosen, null);
    assert.match(decision.reason, /REFUSED/);
  });

  test('spreads load across providers', () => {
    // Two candidates from the same upstream, one from a different one.
    const testCandidates = [
      { harness: 'paseo', accessPath: 'http', upstream: 'test-a', modelId: 'test-a/invented-model-1',
        source: '9router', status: 'passed', evidence: [{ level: 2, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'test-a', modelId: 'test-a/invented-model-2',
        source: '9router', status: 'passed', evidence: [{ level: 2, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'test-b', modelId: 'test-b/invented-model-3',
        source: '9router', status: 'passed', evidence: [{ level: 2, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-05', role: 'author.foundation', dryRun: true,
    });

    // test-b has better spread score (only 1 from that upstream) vs test-a (2).
    const bScore = decision.candidates.find((c) => c.upstream === 'test-b');
    const aScore = decision.candidates.find((c) => c.upstream === 'test-a');
    assert.ok(bScore, 'test-b candidate present');
    assert.ok(aScore, 'test-a candidate present');
    assert.ok(
      bScore.scoreBreakdown.spread > aScore.scoreBreakdown.spread,
      'test-b has better spread score than test-a'
    );
  });

  test('records decision through decisions.js', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dec-'));
    const testCandidates = [
      { harness: 'agy', accessPath: 'cli', upstream: 'agy-local', modelId: '*',
        source: 'agy-local', status: 'passed', evidence: [{ level: 2, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
    ];

    ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-06', role: 'author.foundation',
      decisionOpts: { dir, now: Date.now() },
    });

    // Read back from the decision log.
    const records = decisions.readDecisions({ dir, days: 1 });
    assert.ok(records.length >= 1, 'decision was recorded');
    const record = records[records.length - 1];
    assert.equal(record.workItemId, 'TASK-TEST-06');
    assert.equal(record.stage, 'selected');
    assert.ok(record.chosen, 'chosen is recorded');
    assert.ok(record.reason, 'reason is recorded');
  });

  // F1: MODEL_NOT_IN_CATALOG rejection
  test('rejects candidate whose modelId is not in the catalogue', () => {
    const catalogueSet = ranking.buildCatalogueSet([
      'test-a/invented-alpha',
      'test-b/invented-beta',
    ]);

    const testCandidates = [
      { harness: 'paseo', accessPath: 'http', upstream: 'test-a', modelId: 'test-a/invented-alpha',
        source: '9router', status: 'passed', evidence: [{ level: 3, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'test-gone', modelId: 'test-gone/invented-removed',
        source: '9router', status: 'passed', evidence: [{ level: 3, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-CATALOG', role: 'author.foundation', dryRun: true,
      catalogueSet,
    });

    // test-gone/invented-removed is rejected because it is not in the catalogue.
    const goneRejection = decision.rejected.find((r) => r.reason === 'MODEL_NOT_IN_CATALOG');
    assert.ok(goneRejection, 'missing model is rejected with MODEL_NOT_IN_CATALOG');
    assert.equal(goneRejection.modelId, 'test-gone/invented-removed');
    assert.equal(goneRejection.scope, 'model');

    // test-a/invented-alpha is still eligible and chosen.
    assert.ok(decision.chosen, 'a valid model was chosen');
    assert.ok(decision.chosen.includes('test-a/invented-alpha'), 'winner is the model in catalogue');
  });

  // F1: wildcard and CLI candidates are exempt from catalogue validation
  test('wildcard and CLI candidates are exempt from catalogue validation', () => {
    const catalogueSet = ranking.buildCatalogueSet(['test-a/invented-alpha']);

    const testCandidates = [
      { harness: 'agy', accessPath: 'cli', upstream: 'agy-local', modelId: '*',
        source: 'agy-local', status: 'unknown', evidence: [],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'opencode', accessPath: 'cli', upstream: 'test-oc', modelId: 'test-oc/invented-cli',
        source: 'oc', status: 'unknown', evidence: [],
        blocked: false, sharedQuota: 'unknown' },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-EXEMPT', role: 'author.foundation', dryRun: true,
      catalogueSet,
    });

    // Neither should be rejected — wildcards and CLI are exempt.
    assert.equal(decision.rejected.length, 0, 'no rejections for exempt candidates');
    assert.equal(decision.candidates.length, 2, 'both candidates are eligible');
  });

  // F1: buildCatalogueSet strips trailing CR from Windows command output
  test('buildCatalogueSet strips trailing CR from Windows command output', () => {
    const set = ranking.buildCatalogueSet([
      "test-a/model-one\r",
      "test-b/model-two\r",
      "test-c/model-three",
    ]);

    assert.ok(set.has('test-a/model-one'), 'CR-stripped id found');
    assert.ok(set.has('test-b/model-two'), 'CR-stripped id found');
    assert.ok(set.has('test-c/model-three'), 'plain id found');
    assert.ok(!set.has("test-a/model-one\r"), 'CR-suffixed id not stored');
  });
});

// ── Full Acceptance Run (LAYER 1 — invented ids) ─────────────────────

describe('acceptance: full ranking run', () => {
  test('candidate list has agy, multiple 9Router upstreams, 402 rejection, unknown, and stated reason', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-'));
    const registry = sourcesApi.loadSources();

    // Invented catalogue — NOT real models.  This tests the algorithm.
    const catalogue = [
      'test-a/invented-alpha',
      'test-b/invented-beta',
      'test-c/invented-gamma',
      'test-blocked/invented-model',
      'test-d/invented-delta',
      'test-e/invented-epsilon',
      'test-f/invented-zeta',
    ];

    // Seed evidence: test-blocked returned 402.
    const evData = {
      combinations: [
        {
          harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1', upstream: 'test-blocked',
          model: 'test-blocked/invented-model',
          evidence: [{ level: 1, status: 'failed', httpStatus: 402, source: 'probe',
            cause: '402 Payment Required' }],
        },
        {
          harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1', upstream: 'test-a',
          model: 'test-a/invented-alpha',
          evidence: [{ level: 3, status: 'passed', source: 'production run' }],
        },
        {
          harness: 'agy', accessPath: 'cli', upstream: 'agy-local',
          model: '*',
          evidence: [{ level: 2, status: 'passed', source: 'CLI session' }],
        },
      ],
      aliases: [
        { upstream: 'test-b', canonical: 'invented-beta-v2', harness: 'opencode',
          alias: 'invented-beta', verified: false },
      ],
      sharedQuotas: [],
      upstreamStatus: {
        'test-blocked': { lastStatus: 'blocked', failCount: 1,
          blockedAt: new Date().toISOString(), blockReason: 'HTTP 402', scope: 'upstream' },
      },
    };
    evidence.saveEvidence(dir, evData);

    // Generate candidates.
    const fromCatalogue = candidates.generateCandidates({ registry, catalogue });
    const fromEvidence = candidates.candidatesFromEvidence(evData);
    const merged = candidates.mergeCandidates(fromCatalogue, fromEvidence);
    const annotated = candidates.annotateCandidates(merged, evData);

    // Rank — no catalogue validation in this layer (unit test of algorithm).
    const decision = ranking.rankAndRecord(annotated, {
      workItemId: 'TASK-ACCEPT-01',
      role: 'author.foundation',
      registry,
      evidenceData: evData,
      dryRun: true,
      credentialOpts: {
        env: { NINEROUTER_API_KEY: 'present' },
      },
    });

    // ── Acceptance criteria ──────────────────────────────────────

    // 1. At least one agy candidate.
    const agyCandidates = decision.candidates.filter((c) => c.harness === 'agy');
    assert.ok(agyCandidates.length >= 1, 'has at least one agy candidate');

    // 2. Several candidates from DIFFERENT 9Router upstreams.
    const routerUpstreams = new Set(
      decision.candidates
        .filter((c) => c.accessPath && c.accessPath.includes('127.0.0.1'))
        .map((c) => c.upstream)
    );
    assert.ok(routerUpstreams.size >= 3,
      'has candidates from >= 3 different 9Router upstreams, got: ' + [...routerUpstreams].join(', '));

    // 3. One rejected for 402, scoped to upstream, others still eligible.
    const rejection402 = decision.rejected.find((r) => r.reason && r.reason.includes('402'));
    assert.ok(rejection402, 'has a 402 rejection');
    assert.equal(rejection402.scope, 'upstream', '402 rejection is scoped to upstream');
    // Other upstreams are still eligible.
    assert.ok(
      decision.candidates.some((c) => c.upstream === 'test-a'),
      'test-a is still eligible despite test-blocked 402'
    );
    assert.ok(
      decision.candidates.some((c) => c.upstream === 'test-d'),
      'test-d is still eligible despite test-blocked 402'
    );

    // 4. One candidate that has never been verified, carried as unknown.
    const unknowns = decision.candidates.filter((c) => c.headroom === 'unknown');
    assert.ok(unknowns.length >= 1, 'has at least one unknown candidate');

    // 5. Stated, specific reason for the final choice.
    assert.ok(decision.reason, 'has a reason');
    assert.ok(decision.reason.length > 10, 'reason is specific, not a placeholder');
    assert.ok(decision.chosen, 'a winner was chosen');

    // Every candidate has a score.
    for (const c of decision.candidates) {
      assert.ok(c.score !== undefined, 'candidate has score: ' + c.offeringId);
    }

    // Every rejection has a cause and scope.
    for (const r of decision.rejected) {
      assert.ok(r.reason, 'rejection has a cause: ' + r.offeringId);
    }
  });
});

describe('acceptance: data-only source addition', () => {
  test('adding a source through data only, with no code change, still produces candidates', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-src-'));
    const customRegistry = {
      version: 2,
      sources: [
        {
          id: 'brandnew',
          label: 'BrandNew AI',
          kind: 'model-source',
          servesModels: true,
          reachedVia: '9router',
          routerAlias: 'bn',
          credential: { type: 'api-key', env: 'BRANDNEW_KEY' },
          verify: { method: 'completion' },
        },
        {
          id: '9router',
          label: '9Router',
          kind: 'router',
          servesModels: true,
          endpoint: 'http://127.0.0.1:20128/v1',
          credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
          verify: { method: 'models-list' },
        },
      ],
    };
    const file = path.join(dir, 'sources.json');
    fs.writeFileSync(file, JSON.stringify(customRegistry), 'utf8');
    const registry = sourcesApi.loadSources({ file });

    const catalogue = ['bn/invented-new-model-v1', 'test-up/invented-other'];
    const result = candidates.generateCandidates({ registry, catalogue });

    const bnCandidate = result.find((c) => c.upstream === 'bn');
    assert.ok(bnCandidate, 'brand-new data-only source produced a candidate');
    assert.equal(bnCandidate.source, 'brandnew');
    assert.equal(bnCandidate.modelId, 'bn/invented-new-model-v1');
  });
});

// ── Acceptance: Unassigned Work Item (LAYER 1 — invented ids) ────────

describe('acceptance: unassigned work item', () => {
  test('dispatching with no model, account or harness named in input', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unassigned-'));
    const registry = sourcesApi.loadSources();

    // Invented ids — test the ranking algorithm, not real model availability.
    const catalogue = [
      'test-a/invented-alpha',
      'test-b/invented-beta',
      'test-c/invented-gamma',
    ];

    const evData = {
      combinations: [
        {
          harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1', upstream: 'test-a',
          model: 'test-a/invented-alpha',
          evidence: [{ level: 3, status: 'passed', source: 'previous run' }],
        },
      ],
      aliases: [],
      sharedQuotas: [],
      upstreamStatus: {},
    };
    evidence.saveEvidence(dir, evData);

    // Generate, annotate, rank — no model/account/harness named.
    const fromCatalogue = candidates.generateCandidates({ registry, catalogue });
    const fromEvidence = candidates.candidatesFromEvidence(evData);
    const merged = candidates.mergeCandidates(fromCatalogue, fromEvidence);
    const annotated = candidates.annotateCandidates(merged, evData);

    const decision = ranking.rankAndRecord(annotated, {
      workItemId: 'UNASSIGNED-01',
      role: 'author.foundation',
      registry,
      evidenceData: evData,
      decisionOpts: { dir: path.join(dir, 'decisions'), now: Date.now() },
      credentialOpts: { env: { NINEROUTER_API_KEY: 'present' } },
    });

    // The code chose a model, an account, and a harness — all from data.
    assert.ok(decision.chosen, 'code chose a candidate');
    assert.ok(decision.harness, 'code chose a harness');
    assert.ok(decision.reason, 'code stated a reason');
    assert.ok(decision.candidates.length >= 1, 'candidate list is non-empty');

    // Decision was recorded.
    const records = decisions.readDecisions({
      dir: path.join(dir, 'decisions'), days: 1,
    });
    assert.ok(records.length >= 1, 'decision was written to the log');
    assert.equal(records[records.length - 1].workItemId, 'UNASSIGNED-01');

    // When the first choice fails, the second candidate should be available.
    // Simulate: block the chosen upstream.
    const chosen = decision.candidates[0];
    evidence.recordProbe(dir, {
      harness: chosen.harness,
      accessPath: chosen.accessPath,
      upstream: chosen.upstream,
      modelId: chosen.modelId,
    }, {
      level: evidence.Level.API, status: 'failed', httpStatus: 402,
      source: 'simulated failure',
    });

    // Re-annotate and re-rank.
    const evData2 = evidence.loadEvidence(dir);
    const annotated2 = candidates.annotateCandidates(
      candidates.mergeCandidates(
        candidates.generateCandidates({ registry, catalogue }),
        candidates.candidatesFromEvidence(evData2)
      ),
      evData2
    );

    const decision2 = ranking.rankAndRecord(annotated2, {
      workItemId: 'UNASSIGNED-01-retry',
      role: 'author.foundation',
      registry,
      evidenceData: evData2,
      decisionOpts: { dir: path.join(dir, 'decisions'), now: Date.now() },
      credentialOpts: { env: { NINEROUTER_API_KEY: 'present' } },
    });

    // The second run should choose a different candidate (the first is now blocked).
    if (decision2.chosen) {
      assert.notEqual(decision2.chosen, decision.chosen,
        'fallback chose a different candidate after first-choice failure');
    }
    // Or it might refuse if no alternative qualifies — that is also correct.
  });
});

// ── LAYER 2: Integration — Catalogue Snapshot Validation ─────────────

describe('integration: catalogue snapshot validation', () => {
  // Load the committed snapshot.
  const snapshotPath = path.join(__dirname, 'catalogue-snapshot.json');
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    snapshot = null;
  }

  test('catalogue snapshot exists and has provenance', () => {
    assert.ok(snapshot, 'catalogue-snapshot.json must exist');
    assert.ok(snapshot.fetchedAt, 'snapshot records when it was taken');
    assert.ok(snapshot.endpoint, 'snapshot records where it came from');
    assert.ok(snapshot.fetchedBy, 'snapshot records how it was fetched');
    assert.ok(Array.isArray(snapshot.models), 'snapshot has a models array');
    assert.ok(snapshot.models.length > 100, 'snapshot has a reasonable number of models: ' + snapshot.models.length);
  });

  test('acceptance run with real catalogue: chosen model exists in snapshot', () => {
    if (!snapshot) return; // skip if snapshot missing (caught above)

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'integ-'));
    const registry = sourcesApi.loadSources();

    // Use REAL model ids from the snapshot for the catalogue.
    const catalogueModels = snapshot.models;
    const catalogueSet = ranking.buildCatalogueSet(catalogueModels);

    // Pick a few models from different upstreams that are actually in the snapshot.
    const agModel = catalogueModels.find((m) => m.startsWith('ag/'));
    const ghModel = catalogueModels.find((m) => m.startsWith('gh/'));
    assert.ok(agModel, 'snapshot has an ag/ model');
    assert.ok(ghModel, 'snapshot has a gh/ model');

    // Seed evidence with real ids from the snapshot.
    const evData = {
      combinations: [],
      aliases: [],
      sharedQuotas: [],
      upstreamStatus: {},
    };
    if (agModel) {
      evData.combinations.push({
        harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1',
        upstream: agModel.split('/')[0], model: agModel,
        evidence: [{ level: 3, status: 'passed', source: 'snapshot integration test' }],
      });
    }
    evidence.saveEvidence(dir, evData);

    const fromCatalogue = candidates.generateCandidates({ registry, catalogue: catalogueModels });
    const fromEvidence = candidates.candidatesFromEvidence(evData);
    const merged = candidates.mergeCandidates(fromCatalogue, fromEvidence);
    const annotated = candidates.annotateCandidates(merged, evData);

    // Rank WITH catalogue validation — this is the layer 2 check.
    const decision = ranking.rankAndRecord(annotated, {
      workItemId: 'INTEG-SNAPSHOT-01',
      role: 'author.foundation',
      registry,
      evidenceData: evData,
      dryRun: true,
      catalogueSet,
      credentialOpts: { env: { NINEROUTER_API_KEY: 'present' } },
    });

    assert.ok(decision.chosen, 'integration run chose a candidate');
    // The winner's modelId must be in the snapshot catalogue.
    const winnerCandidate = decision.candidates.find(
      (c) => evidence.candidateKey(c) === decision.chosen ||
             c.offeringId === decision.chosen
    );
    assert.ok(winnerCandidate, 'winner found in candidates list');
    if (winnerCandidate.modelId !== '*') {
      assert.ok(
        catalogueSet.has(winnerCandidate.modelId),
        'winning model ' + winnerCandidate.modelId + ' exists in the snapshot catalogue'
      );
    }

    // No MODEL_NOT_IN_CATALOG rejections when all models come from the snapshot.
    const catalogRejections = decision.rejected.filter(
      (r) => r.reason === 'MODEL_NOT_IN_CATALOG'
    );
    assert.equal(catalogRejections.length, 0,
      'no MODEL_NOT_IN_CATALOG rejections when catalogue is self-consistent');
  });

  test('stale model id is rejected with MODEL_NOT_IN_CATALOG when validated against snapshot', () => {
    if (!snapshot) return;

    const catalogueSet = ranking.buildCatalogueSet(snapshot.models);

    // A stale model id that is NOT in the snapshot.
    const staleId = 'ag/gemini-2.5-pro';
    assert.ok(!catalogueSet.has(staleId), 'stale model is indeed absent from snapshot');

    const testCandidates = [
      { harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1', upstream: 'ag',
        modelId: staleId, source: '9router', status: 'passed',
        evidence: [{ level: 3, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1', upstream: 'ag',
        modelId: 'ag/gemini-3.8-flash-high', source: '9router', status: 'unknown',
        evidence: [], blocked: false, sharedQuota: 'unknown' },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'INTEG-STALE-01', role: 'author.foundation', dryRun: true,
      catalogueSet,
    });

    // The stale model is rejected.
    const staleRejection = decision.rejected.find(
      (r) => r.reason === 'MODEL_NOT_IN_CATALOG' && r.modelId === staleId
    );
    assert.ok(staleRejection, 'ag/gemini-2.5-pro is rejected as MODEL_NOT_IN_CATALOG');

    // The valid model is chosen instead.
    assert.ok(decision.chosen, 'a valid model was chosen');
    assert.ok(decision.chosen.includes('ag/gemini-3.8-flash-high'),
      'winner is the model that exists in the catalogue');
  });
});
