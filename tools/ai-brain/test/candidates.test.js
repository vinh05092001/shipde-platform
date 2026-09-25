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
 * SEVEN-FIX CONTRACT — one test per verified defect, each written to fail on
 * the previous commit and pass after the fix.
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
    evidence.recordProbe(
      dir,
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-up',
        modelId: 'test-up/invented-alpha',
      },
      {
        level: evidence.Level.API,
        status: 'passed',
        httpStatus: 200,
        source: 'test',
      }
    );
    const data = evidence.loadEvidence(dir);
    assert.equal(data.combinations.length, 1);
    assert.equal(data.combinations[0].evidence[0].status, 'passed');
  });

  test('blocks upstream on 402, scoped to that upstream only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    evidence.recordProbe(
      dir,
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-blocked',
        modelId: 'test-blocked/invented-model',
      },
      {
        level: evidence.Level.API,
        status: 'failed',
        httpStatus: 402,
        source: 'test',
        cause: '402 Payment Required',
      }
    );
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
    evidence.recordProbe(
      dir,
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-ttl',
        modelId: 'test-ttl/invented-model',
      },
      {
        level: evidence.Level.API,
        status: 'failed',
        httpStatus: 402,
        source: 'test',
      }
    );
    const data = evidence.loadEvidence(dir);
    // Simulate time passing beyond TTL.
    const future = Date.now() + evidence.BLOCK_TTL_MS + 1000;
    const block = evidence.isUpstreamBlocked(data, 'test-ttl', { now: future });
    assert.equal(block.blocked, false);
  });

  test('records aliases with verified flag', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    evidence.recordAlias(
      dir,
      'test-up',
      'invented-model-v2',
      'opencode',
      'invented-model',
      false,
      'OpenCode alias differs from HTTP id'
    );
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

  test('candidateKey produces seven-part identity everywhere matching candidates.candidateKey', () => {
    const key = evidence.candidateKey({
      harness: 'paseo',
      accessPath: 'http',
      upstream: 'test-up',
      modelId: 'test-up/invented-model',
    });
    assert.equal(key, 'paseo::http::::test-up::*::::test-up/invented-model');
    assert.equal(
      key,
      candidates.candidateKey({
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-up',
        modelId: 'test-up/invented-model',
      })
    );
  });

  test('cross-account: 401 on one account does not block unrelated accounts on same upstream', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-xacc1-'));
    const candA = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-a',
      quotaScope: 'acc-a',
      modelId: 'gh/gpt-4o',
    };
    const candB = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-b',
      quotaScope: 'acc-b',
      modelId: 'gh/gpt-4o',
    };

    evidence.recordProbe(dir, candA, {
      level: evidence.Level.API,
      status: 'failed',
      httpStatus: 401,
      cause: '401 Unauthorized',
    });
    const data = evidence.loadEvidence(dir);

    // Candidate A is blocked with account scope
    const blockA = evidence.isCandidateBlocked(data, candA);
    assert.equal(blockA.blocked, true);
    assert.equal(blockA.scope, 'account');

    // Candidate B on same upstream is NOT blocked
    const blockB = evidence.isCandidateBlocked(data, candB);
    assert.equal(blockB.blocked, false);

    // Annotate candidates confirms candA blocked, candB eligible
    const annotated = candidates.annotateCandidates([candA, candB], data);
    assert.equal(annotated[0].blocked, true);
    assert.equal(annotated[1].blocked, false);

    // In ranking, candB is not rejected for upstream block
    const decision = ranking.rankAndRecord(annotated, {
      workItemId: 'TASK-XACC-01',
      role: 'author.foundation',
      dryRun: true,
      explorationBudget: 1,
    });
    const rejB = decision.rejected.find(
      (r) => r.accountId === 'acc-b' && r.reason.includes('blocked')
    );
    assert.equal(rejB, undefined, 'acc-b is not rejected for blocking');
  });

  test('cross-account: failure recorded for one account does not infect other accounts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-xacc2-'));
    const candA = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-a',
      quotaScope: 'acc-a',
      modelId: 'gh/gpt-4o',
    };
    const candB = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-b',
      quotaScope: 'acc-b',
      modelId: 'gh/gpt-4o',
    };

    evidence.recordProbe(dir, candA, {
      level: evidence.Level.OUTCOME,
      status: 'failed',
      cause: 'context length exceeded',
    });
    const data = evidence.loadEvidence(dir);

    // Candidate A has failed evidence
    assert.equal(evidence.candidateStatus(data, candA), 'failed');
    candA.evidence = evidence.getEvidence(data, candA);
    assert.equal(ranking.evidenceScore(candA), 0);

    // Candidate B has no evidence and status is unknown (scores 30, not 0)
    assert.equal(evidence.getEvidence(data, candB).length, 0);
    assert.equal(evidence.candidateStatus(data, candB), 'unknown');
    candB.evidence = evidence.getEvidence(data, candB);
    assert.equal(ranking.evidenceScore(candB), 30);
  });

  test('cross-account: success on one account is not inherited as verified by another', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-xacc3-'));
    const candA = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-a',
      quotaScope: 'acc-a',
      modelId: 'gh/gpt-4o',
    };
    const candB = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-b',
      quotaScope: 'acc-b',
      modelId: 'gh/gpt-4o',
    };

    evidence.recordProbe(dir, candA, {
      level: evidence.Level.OUTCOME,
      status: 'passed',
      source: 'task run',
    });
    const data = evidence.loadEvidence(dir);

    // Candidate A has passed evidence
    assert.equal(evidence.candidateStatus(data, candA), 'passed');
    candA.evidence = evidence.getEvidence(data, candA);
    assert.equal(ranking.evidenceScore(candA), 100);

    // Candidate B has never run and must not inherit verified status
    assert.equal(evidence.getEvidence(data, candB).length, 0);
    assert.equal(evidence.candidateStatus(data, candB), 'unknown');
    candB.evidence = evidence.getEvidence(data, candB);
    assert.equal(ranking.evidenceScore(candB), 30);
  });

  test('migration: legacy 4-field evidence is migrated fail-closed as unverified history', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-mig-'));
    const legacyRaw = {
      combinations: [
        {
          harness: 'paseo',
          accessPath: 'http://127.0.0.1:20128/v1',
          upstream: 'gh',
          model: 'gh/gpt-4o',
          evidence: [{ level: 3, status: 'passed', source: 'v1 legacy run' }],
        },
      ],
    };
    fs.writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(legacyRaw, null, 2));

    const data = evidence.loadEvidence(dir);
    assert.equal(data.version, 2, 'migrated to schema version 2');
    assert.equal(data.combinations.length, 1, 'legacy row preserved (not deleted)');
    const legacyRow = data.combinations[0];
    assert.equal(legacyRow.legacy, true, 'flagged as legacy');
    assert.equal(legacyRow.verified, false, 'flagged as unverified');
    assert.equal(legacyRow.accountId, null, 'never assigned default accountId');
    assert.equal(legacyRow.quotaScope, null, 'never assigned default quotaScope');

    // A concrete candidate querying this data does not inherit verified status
    const cand = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-a',
      quotaScope: 'acc-a',
      modelId: 'gh/gpt-4o',
    };
    assert.equal(evidence.getEvidence(data, cand).length, 0);
    assert.equal(evidence.candidateStatus(data, cand), 'unknown');

    // candidatesFromEvidence preserves legacy rows as unverified history
    const fromEv = candidates.candidatesFromEvidence(data);
    assert.equal(fromEv.length, 1);
    assert.equal(fromEv[0].legacy, true);
    assert.equal(fromEv[0].verified, false);
    assert.equal(fromEv[0].accountId, null);
    assert.equal(fromEv[0].status, 'unknown');

    // ranking rejects legacy unverified candidates
    const decision = ranking.rankAndRecord(fromEv, {
      workItemId: 'TASK-MIG-01',
      role: 'author.foundation',
      dryRun: true,
      explorationBudget: 1,
    });
    assert.equal(decision.chosen, null);
    assert.ok(decision.rejected.some((r) => r.reason === 'UNVERIFIED_LEGACY_EVIDENCE'));
  });

  test('headroomScore: unpacks object readings from quota.accountHeadroom', () => {
    const cand = {
      harness: 'paseo',
      accessPath: 'http://127.0.0.1:20128/v1',
      gateway: '9router',
      upstream: 'gh',
      accountId: 'acc-cooling',
      quotaScope: 'acc-cooling',
      modelId: 'gh/gpt-4o',
    };
    // Object reading as returned by quota.js accountHeadroom
    const objectReading = {
      accountId: 'acc-cooling',
      status: 'cooling',
      worstRatio: 1,
      window: 'tokensPerDay',
    };
    const score = ranking.headroomScore(cand, { headrooms: { 'acc-cooling': objectReading } });
    assert.equal(score, 0, 'cooling object reading evaluates to 0, not default 30');
    assert.equal(cand.headroomStatus, 'cooling');

    const openReading = {
      accountId: 'acc-cooling',
      status: 'open',
      worstRatio: 0.1,
    };
    const openScore = ranking.headroomScore(cand, { headrooms: { 'acc-cooling': openReading } });
    assert.equal(openScore, 90, 'open object reading evaluates to 90');
    assert.equal(cand.headroomStatus, 'open');
  });
});

// ── Candidate Generation ──────────────────────────────────────────────

describe('candidate generation', () => {
  test('generates candidates from gateway catalogue without hard-coded models', () => {
    const registry = sourcesApi.loadSources();
    // Invented catalogue — these ids are not real models.
    const catalogue = ['test-a/invented-alpha', 'test-b/invented-beta', 'test-c/invented-gamma'];

    const result = candidates.generateCandidates({ registry, catalogue });

    // Must have candidates from multiple different upstreams.
    const upstreams = new Set(result.map((c) => c.upstream));
    assert.ok(upstreams.has('test-a'), 'has test-a upstream');
    assert.ok(upstreams.has('test-b'), 'has test-b upstream');
    assert.ok(upstreams.has('test-c'), 'has test-c upstream');

    // Every candidate has the seven-part identity.
    for (const c of result) {
      assert.ok(c.harness, 'has harness');
      assert.ok(c.accessPath, 'has accessPath');
      assert.ok(c.upstream, 'has upstream');
      assert.ok(c.modelId, 'has modelId');
      assert.ok(c.accountId !== undefined, 'has accountId');
      assert.ok(c.quotaScope !== undefined, 'has quotaScope');
      assert.ok(c.gateway !== undefined, 'has gateway');
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
      (c) =>
        c.modelId === 'test-up/invented-model-v2' &&
        c.harness === 'paseo' &&
        c.accessPath.includes('127.0.0.1')
    );
    // The OpenCode candidate (via oc source).
    const ocCandidate = result.find(
      (c) => c.modelId === 'ninerouter/test-up/invented-model' && c.harness === 'opencode'
    );

    assert.ok(httpCandidate, 'HTTP candidate exists');
    assert.ok(ocCandidate, 'OpenCode candidate exists');
    // They are different candidates.
    assert.notEqual(
      candidates.candidateKey(httpCandidate),
      candidates.candidateKey(ocCandidate),
      'HTTP and OpenCode are distinct candidates'
    );
  });

  test('candidatesFromEvidence recovers models not in the live catalogue', () => {
    const evData = {
      combinations: [
        {
          harness: 'paseo',
          accessPath: 'http',
          upstream: 'test-ev',
          model: 'test-ev/invented-recovered',
          source: 'test-ev',
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

  test('mergeCandidates deduplicates by seven-part key', () => {
    const a = [
      { harness: 'paseo', accessPath: 'http', upstream: 'test-up', modelId: 'test-up/invented-a' },
    ];
    const b = [
      { harness: 'paseo', accessPath: 'http', upstream: 'test-up', modelId: 'test-up/invented-a' },
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-up',
        accountId: 'acc-x',
        quotaScope: 'acc-x',
        modelId: 'test-up/invented-a',
      },
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-up2',
        modelId: 'test-up2/invented-b',
      },
    ];
    const merged = candidates.mergeCandidates(a, b);
    // The shared arc and the account-bound arc for the same model are distinct.
    assert.equal(merged.length, 3);
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
          harness: 'paseo',
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
    assert.equal(np.harness, 'paseo', 'harness also comes from data');
    assert.equal(np.accessPath, 'http://127.0.0.1:20128/v1', 'accessPath also comes from data');
  });

  // F2: model-source accessPath resolves to router endpoint, not source id
  test('model-source candidate carries router endpoint as accessPath, not source id (F2)', () => {
    const registry = sourcesApi.loadSources();
    const catalogue = ['kr/invented-model-f2'];
    const result = candidates.generateCandidates({ registry, catalogue });

    const krCandidate = result.find((c) => c.upstream === 'kr' && c.source === 'xkiro');
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
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-a',
        accountId: '*',
        quotaScope: 'test-a',
        gateway: '',
        modelId: 'test-a/invented-alpha',
        source: '9router',
        status: 'passed',
        evidence: [{ level: 3, status: 'passed' }],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-b',
        accountId: '*',
        quotaScope: 'test-b',
        gateway: '',
        modelId: 'test-b/invented-beta',
        source: '9router',
        status: 'unknown',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
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
    assert.ok(
      decision.candidates.every((c) => c.score !== undefined),
      'every candidate has a score'
    );
  });

  test('rejects blocked upstream, scoped to that upstream only', () => {
    const testCandidates = [
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-blocked',
        accountId: '*',
        quotaScope: 'test-blocked',
        gateway: '',
        modelId: 'test-blocked/invented-model',
        source: '9router',
        status: 'failed',
        evidence: [],
        blocked: true,
        blockReason: 'HTTP 402',
        blockScope: 'upstream',
        sharedQuota: 'unknown',
      },
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-a',
        accountId: '*',
        quotaScope: 'test-a',
        gateway: '',
        modelId: 'test-a/invented-alpha',
        source: '9router',
        status: 'passed',
        evidence: [{ level: 2, status: 'passed' }],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-c',
        accountId: '*',
        quotaScope: 'test-c',
        gateway: '',
        modelId: 'test-c/invented-gamma',
        source: '9router',
        status: 'unknown',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-02',
      role: 'author.foundation',
      dryRun: true,
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
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'bai',
        accountId: '*',
        quotaScope: 'bai',
        gateway: '',
        modelId: 'bai/invented-model',
        source: 'bai',
        status: 'unknown',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
      },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-03',
      role: 'author.foundation',
      dryRun: true,
      registry,
      credentialOpts: { env: {} }, // no env vars set
    });

    const baiRejection = decision.rejected.find((r) => r.offeringId.includes('bai'));
    assert.ok(baiRejection, 'bai rejected for missing credential');
    assert.match(baiRejection.reason, /no credential/);
  });

  test('refuses when no candidate qualifies', () => {
    const decision = ranking.rankAndRecord([], {
      workItemId: 'TASK-TEST-04',
      role: 'author.foundation',
      dryRun: true,
    });

    assert.equal(decision.chosen, null);
    assert.match(decision.reason, /REFUSED/);
  });

  test('spreads load across providers using current sessions and reservations', () => {
    // Two candidates from the same upstream, one from a different one.  The
    // candidate set size no longer matters — only the live load does.
    const testCandidates = [
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-a',
        accountId: '*',
        quotaScope: 'test-a',
        gateway: '',
        modelId: 'test-a/invented-model-1',
        source: '9router',
        status: 'passed',
        evidence: [{ level: 2, status: 'passed' }],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-a',
        accountId: '*',
        quotaScope: 'test-a',
        gateway: '',
        modelId: 'test-a/invented-model-2',
        source: '9router',
        status: 'passed',
        evidence: [{ level: 2, status: 'passed' }],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-b',
        accountId: '*',
        quotaScope: 'test-b',
        gateway: '',
        modelId: 'test-b/invented-model-3',
        source: '9router',
        status: 'passed',
        evidence: [{ level: 2, status: 'passed' }],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-05',
      role: 'author.foundation',
      dryRun: true,
      load: [
        { upstream: 'test-a', quotaScope: 'test-a', accountId: '*' },
        { upstream: 'test-a', quotaScope: 'test-a', accountId: '*' },
      ],
    });

    // test-b has better spread score (no active session) vs test-a (2 active).
    const bScore = decision.candidates.find((c) => c.upstream === 'test-b');
    const aScore = decision.candidates.find((c) => c.upstream === 'test-a');
    assert.ok(bScore, 'test-b candidate present');
    assert.ok(aScore, 'test-a candidate present');
    assert.equal(aScore.scoreBreakdown.spread, 50, 'two active sessions on test-a → 50');
    assert.equal(bScore.scoreBreakdown.spread, 100, 'no active session on test-b → 100');
    assert.ok(
      bScore.scoreBreakdown.spread > aScore.scoreBreakdown.spread,
      'test-b has better spread score than test-a'
    );
  });

  test('records decision through decisions.js', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dec-'));
    const testCandidates = [
      {
        harness: 'agy',
        accessPath: 'cli',
        upstream: 'agy-local',
        accountId: '*',
        quotaScope: 'agy-local',
        gateway: '',
        modelId: 'invented-cli-model',
        source: 'agy-local',
        status: 'passed',
        evidence: [{ level: 2, status: 'passed' }],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
    ];

    ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-06',
      role: 'author.foundation',
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
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-a',
        accountId: '*',
        quotaScope: 'test-a',
        gateway: '',
        modelId: 'test-a/invented-alpha',
        source: '9router',
        status: 'passed',
        evidence: [{ level: 3, status: 'passed' }],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-gone',
        accountId: '*',
        quotaScope: 'test-gone',
        gateway: '',
        modelId: 'test-gone/invented-removed',
        source: '9router',
        status: 'passed',
        evidence: [{ level: 3, status: 'passed' }],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-CATALOG',
      role: 'author.foundation',
      dryRun: true,
      cataloguesByPath: { http: catalogueSet },
    });

    // test-gone/invented-removed is rejected because it is not in the catalogue.
    const goneRejection = decision.rejected.find((r) => r.reason === 'MODEL_NOT_IN_CATALOG');
    assert.ok(goneRejection, 'missing model is rejected with MODEL_NOT_IN_CATALOG');
    assert.equal(goneRejection.modelId, 'test-gone/invented-removed');
    assert.equal(goneRejection.scope, 'model');

    // test-a/invented-alpha is still eligible and chosen.
    assert.ok(decision.chosen, 'a valid model was chosen');
    assert.ok(
      decision.chosen.includes('test-a/invented-alpha'),
      'winner is the model in catalogue'
    );
  });

  // CLI candidates are exempt from catalogue validation (no enumerable
  // catalogue for a cli path), and a resolved wildcard becomes concrete.
  test('cli candidates are exempt from catalogue validation; resolved wildcard is concrete', () => {
    const catalogueSet = ranking.buildCatalogueSet(['test-a/invented-alpha']);

    const testCandidates = [
      {
        harness: 'agy',
        accessPath: 'cli',
        upstream: 'agy-local',
        accountId: '*',
        quotaScope: 'agy-local',
        gateway: '',
        modelId: '*',
        resolvedModel: 'invented-cli-model',
        source: 'agy-local',
        status: 'unknown',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
      {
        harness: 'opencode',
        accessPath: 'cli',
        upstream: 'test-oc',
        accountId: '*',
        quotaScope: 'test-oc',
        gateway: '',
        modelId: 'test-oc/invented-cli',
        source: 'oc',
        status: 'unknown',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-EXEMPT',
      role: 'author.foundation',
      dryRun: true,
      cataloguesByPath: { http: catalogueSet },
    });

    // Neither should be rejected — CLI has no enumerable catalogue.
    assert.equal(decision.rejected.length, 0, 'no rejections for cli candidates');
    assert.equal(decision.candidates.length, 2, 'both candidates are eligible');
    const agy = decision.candidates.find((c) => c.harness === 'agy');
    assert.equal(agy.modelId, 'invented-cli-model', 'resolved wildcard became the concrete model');
  });

  // PER-PATH CATALOGUE VALIDATION
  test('validates candidate against its own access path catalogue', () => {
    // two catalogues, one per access path, with different contents
    const cataloguesByPath = {
      http: ranking.buildCatalogueSet(['test-a/invented-alpha']),
      opencode: ranking.buildCatalogueSet(['test-b/invented-beta']),
    };

    const testCandidates = [
      // Present in http, should survive
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-a',
        modelId: 'test-a/invented-alpha',
        source: '9router',
        status: 'passed',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
      },
      // Absent in http, should be rejected
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'test-b',
        modelId: 'test-b/invented-beta',
        source: '9router',
        status: 'passed',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
      },
      // Present in opencode, should survive
      {
        harness: 'opencode',
        accessPath: 'opencode',
        upstream: 'test-b',
        modelId: 'test-b/invented-beta',
        source: 'oc',
        status: 'passed',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
      },
      // Absent in opencode, should be rejected
      {
        harness: 'opencode',
        accessPath: 'opencode',
        upstream: 'test-a',
        modelId: 'test-a/invented-alpha',
        source: 'oc',
        status: 'passed',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
      },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-PER-PATH',
      role: 'author.foundation',
      dryRun: true,
      cataloguesByPath, // Pass new property instead of catalogueSet
    });

    const httpAbsentRej = decision.rejected.find(
      (r) => r.modelId === 'test-b/invented-beta' && r.scope === 'model'
    );
    assert.ok(httpAbsentRej, 'candidate absent from http path catalogue is rejected');

    const ocAbsentRej = decision.rejected.find(
      (r) => r.modelId === 'test-a/invented-alpha' && r.scope === 'model'
    );
    assert.ok(ocAbsentRej, 'candidate absent from opencode path catalogue is rejected');

    const httpSurviving = decision.candidates.find((c) => c.modelId === 'test-a/invented-alpha');
    assert.ok(httpSurviving, 'candidate present in http path catalogue survives');

    const ocSurviving = decision.candidates.find((c) => c.modelId === 'test-b/invented-beta');
    assert.ok(ocSurviving, 'candidate present in opencode path catalogue survives');
  });

  test('same upstream model under two different ids validated against its own path', () => {
    const cataloguesByPath = {
      http: ranking.buildCatalogueSet(['gh/gpt-4.1-2025-04-14']),
      opencode: ranking.buildCatalogueSet(['gh/gpt-4.1']),
    };

    const testCandidates = [
      // HTTP candidate uses the http id, exists in http catalogue
      {
        harness: 'paseo',
        accessPath: 'http',
        upstream: 'gh',
        modelId: 'gh/gpt-4.1-2025-04-14',
        source: '9router',
        status: 'passed',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
      },
      // OpenCode candidate uses the oc alias, exists in opencode catalogue
      {
        harness: 'opencode',
        accessPath: 'opencode',
        upstream: 'gh',
        modelId: 'gh/gpt-4.1',
        source: 'oc',
        status: 'passed',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
      },
      // A mixed-up candidate that borrows presence: OpenCode path but HTTP id
      {
        harness: 'opencode',
        accessPath: 'opencode',
        upstream: 'gh',
        modelId: 'gh/gpt-4.1-2025-04-14',
        source: 'oc',
        status: 'passed',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
      },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-ALIAS',
      role: 'author.foundation',
      dryRun: true,
      cataloguesByPath,
    });

    const validHttp = decision.candidates.find(
      (c) => c.modelId === 'gh/gpt-4.1-2025-04-14' && c.accessPath === 'http'
    );
    assert.ok(validHttp, 'valid http candidate survives');

    const validOc = decision.candidates.find(
      (c) => c.modelId === 'gh/gpt-4.1' && c.accessPath === 'opencode'
    );
    assert.ok(validOc, 'valid opencode candidate survives');

    const invalidOc = decision.rejected.find((r) => r.modelId === 'gh/gpt-4.1-2025-04-14');
    assert.ok(invalidOc, 'opencode candidate with http id rejected from opencode path');
  });

  test('cli path without catalogue marks status unknown but allows candidate', () => {
    const cataloguesByPath = {
      http: ranking.buildCatalogueSet(['test-a/invented-alpha']),
    };
    const testCandidates = [
      {
        harness: 'agy',
        accessPath: 'cli',
        upstream: 'agy-local',
        accountId: '*',
        quotaScope: 'agy-local',
        gateway: '',
        modelId: 'invented-cli-model',
        source: 'agy-local',
        status: 'passed',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-CLI',
      role: 'author.foundation',
      dryRun: true,
      cataloguesByPath,
    });

    assert.equal(decision.rejected.length, 0, 'cli candidate is not rejected');
    const cliCandidate = decision.candidates[0];
    assert.equal(
      cliCandidate.headroom,
      'unknown',
      'cli candidate status marked as unknown due to missing catalogue'
    );
  });

  test('buildCatalogueSet strips trailing CR from Windows command output', () => {
    const set = ranking.buildCatalogueSet([
      'test-a/model-one\r',
      'test-b/model-two\r',
      'test-c/model-three',
    ]);

    assert.ok(set.has('test-a/model-one'), 'CR-stripped id found');
    assert.ok(set.has('test-b/model-two'), 'CR-stripped id found');
    assert.ok(set.has('test-c/model-three'), 'plain id found');
    assert.ok(!set.has('test-a/model-one\r'), 'CR-suffixed id not stored');
  });
});

// ── Seven-Fix Contract (one per verified defect) ─────────────────────

describe('acceptance: seven-fix contract', () => {
  // D1: candidate identity must include gateway + account + quotaScope.
  test('T1 two accounts on the same upstream are distinct candidates', () => {
    const registry = sourcesApi.loadSources();
    const result = candidates.generateCandidates({
      registry,
      catalogue: ['gh/invented-model'],
      accounts: [
        { id: 'acc-a', sourceId: '9router' },
        { id: 'acc-b', sourceId: '9router' },
      ],
    });

    const gh = result.filter((c) => c.source === '9router' && c.upstream === 'gh');
    assert.equal(gh.length, 2, 'one candidate per bound account');
    assert.notEqual(candidates.candidateKey(gh[0]), candidates.candidateKey(gh[1]));
    assert.notEqual(gh[0].accountId, gh[1].accountId, 'accountId differs');
    assert.equal(gh[0].quotaScope, gh[0].accountId, 'quotaScope is the account');
  });

  // D2: harness + accessPath must come from the registry, not from code.
  test('T2 harness and accessPath are read from the registry, not hard-coded', () => {
    const customRegistry = {
      version: 2,
      sources: [
        {
          id: 'weird',
          label: 'Weird Gateway',
          kind: 'router',
          servesModels: true,
          harness: 'maverick',
          endpoint: 'http://odd.example:7777/v1',
        },
      ],
    };
    const result = candidates.generateCandidates({
      registry: customRegistry,
      catalogue: ['wz/invented-z'],
    });
    const c = result.find((x) => x.upstream === 'wz');
    assert.ok(c, 'candidate produced against an unusual registry');
    assert.equal(c.harness, 'maverick', 'harness read from the registry, not paseo');
    assert.equal(c.accessPath, 'http://odd.example:7777/v1', 'accessPath read from the registry');
  });

  // D3: an unresolved wildcard is a named rejection, never a pass-through.
  test('T3 unresolved wildcard is rejected with a named cause', () => {
    const decision = ranking.rankAndRecord(
      [
        {
          harness: 'agy',
          accessPath: 'cli',
          upstream: 'agy-local',
          accountId: '*',
          quotaScope: 'agy-local',
          gateway: '',
          modelId: '*',
          source: 'agy-local',
          status: 'unknown',
          evidence: [],
          blocked: false,
          sharedQuota: 'unknown',
        },
      ],
      {
        workItemId: 'TASK-7FIX-03',
        role: 'author.foundation',
        dryRun: true,
      }
    );

    const rejection = decision.rejected.find((r) => r.reason === 'WILDCARD_UNRESOLVED');
    assert.ok(rejection, 'unresolved wildcard is rejected with WILDCARD_UNRESOLVED');
    assert.equal(decision.chosen, null, 'nothing is selected when only a wildcard is offered');
  });

  // D4: headroom must come from real quota readings, never unlimited.
  test('T4 headroom score reads real quota readings, missing quota is fifty-less unknown', () => {
    const mk = (upstream, quotaScope) => ({
      harness: 'paseo',
      accessPath: 'http',
      upstream,
      accountId: '*',
      quotaScope,
      gateway: '',
      modelId: upstream + '/invented-m',
      source: '9router',
      blocked: false,
      evidence: [],
      status: 'unknown',
    });
    const open = mk('test-open', 'q-open');
    const tight = mk('test-tight', 'q-tight');
    const exh = mk('test-exh', 'q-exh');
    const mystery = mk('test-mystery', 'q-mystery');
    const none = mk('test-none', 'q-none');

    const scores = [
      ranking.headroomScore(open, { headrooms: { 'q-open': 'open' } }),
      ranking.headroomScore(tight, { headrooms: { 'q-tight': 'tight' } }),
      ranking.headroomScore(exh, { headrooms: { 'q-exh': 'exhausted' } }),
      ranking.headroomScore(mystery, { headrooms: { 'q-mystery': 'mystery' } }),
      ranking.headroomScore(none, { headrooms: {} }),
    ];
    assert.deepEqual(
      scores,
      [90, 40, 0, 30, 30],
      'open→90, tight→40, exhausted→0, unknown→30, never unlimited'
    );
    assert.equal(open.headroomStatus, 'open');
    assert.equal(none.headroomStatus, 'unknown');
  });

  // D5: cost must come from real data; unknown cost is excluded, never 50.
  test('T5 unknown cost is excluded from the total; known cost drives the cheap pick', () => {
    const mk = (upstream, cost) => ({
      harness: 'paseo',
      accessPath: 'http',
      upstream,
      accountId: '*',
      quotaScope: upstream,
      gateway: '',
      modelId: upstream + '/invented-m',
      source: '9router',
      blocked: false,
      evidence: [{ level: 3, status: 'passed' }],
      status: 'passed',
      cost,
    });
    const zero = mk('test-zero', 0);
    const cheap = mk('test-cheap', 500);
    const pricey = mk('test-pricey', 1000000);
    const unknown = mk('test-unknown', undefined);

    const sz = ranking.scoreCandidate(zero, [], 'author.foundation', {});
    const sc = ranking.scoreCandidate(cheap, [], 'author.foundation', {});
    const sp = ranking.scoreCandidate(pricey, [], 'author.foundation', {});
    const su = ranking.scoreCandidate(unknown, [], 'author.foundation', {});

    assert.equal(sz.breakdown.cost, 100, 'free is the best cost score');
    assert.ok(sc.breakdown.cost > sp.breakdown.cost, 'cheap outscores pricey');
    assert.equal(su.breakdown.cost, null, 'unknown cost is excluded, never 50');
  });

  // D6: spread must count current sessions + reservations, not candidate-set size.
  test('T6 spread counts active load and reservations, not the candidate set', () => {
    const a = {
      harness: 'paseo',
      accessPath: 'http',
      upstream: 'test-a',
      accountId: '*',
      quotaScope: 'test-a',
      gateway: '',
      modelId: 'test-a/invented-m1',
      source: '9router',
      blocked: false,
      status: 'passed',
      evidence: [],
    };
    const b = { ...a, upstream: 'test-b', quotaScope: 'test-b', modelId: 'test-b/invented-m2' };

    assert.equal(
      ranking.spreadPenalty(a, {}),
      100,
      'no load → full spread, regardless of candidate-set size'
    );
    assert.equal(ranking.spreadPenalty(b, {}), 100);

    const ctxLoad = {
      load: [
        { upstream: 'test-a', quotaScope: 'test-a' },
        { upstream: 'test-a', quotaScope: 'test-a' },
      ],
      reservations: [],
    };
    assert.equal(ranking.spreadPenalty(a, ctxLoad), 50, 'two active sessions on test-a → 50');
    assert.equal(ranking.spreadPenalty(b, ctxLoad), 100, 'no active session on test-b → 100');

    const ctxRes = {
      load: [],
      reservations: [{ offeringId: candidates.candidateKey(a) }],
    };
    assert.equal(
      ranking.spreadPenalty(a, ctxRes),
      70,
      'an outstanding reservation on the candidate → 70'
    );
  });

  // D7: unproven capability is never neutral — only selectable inside an
  // explicit exploration budget.
  test('T7 unproven capability is refused unless an exploration budget allows it', () => {
    const unproven = {
      harness: 'paseo',
      accessPath: 'http',
      upstream: 'test-a',
      accountId: '*',
      quotaScope: 'test-a',
      gateway: '',
      modelId: 'test-a/invented-m',
      source: '9router',
      blocked: false,
      evidence: [],
      status: 'unknown',
    };
    const gate = {
      workItemId: 'TASK-7FIX-07',
      role: 'author.foundation',
      kind: 'author.foundation',
      dryRun: true,
    };

    const refused = ranking.rankAndRecord([unproven], gate);
    assert.equal(refused.chosen, null, 'unproven cannot be picked outside a budget');
    const rejection = refused.rejected.find((r) => r.reason === 'EXPLORATION_BUDGET_EXHAUSTED');
    assert.ok(rejection, 'refusal names the exploration budget gate');

    const allowed = ranking.rankAndRecord([unproven], {
      ...gate,
      explorationBudget: 1,
      priorUntested: 0,
    });
    assert.ok(allowed.chosen, 'with an explicit budget an unproven pick is permitted');

    const proven = ranking.rankAndRecord(
      [{ ...unproven, qualifiedRoles: ['author.foundation'] }],
      gate
    );
    assert.ok(proven.chosen, 'a proven capability needs no exploration budget');
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
          harness: 'paseo',
          accessPath: 'http://127.0.0.1:20128/v1',
          upstream: 'test-blocked',
          model: 'test-blocked/invented-model',
          evidence: [
            {
              level: 1,
              status: 'failed',
              httpStatus: 402,
              source: 'probe',
              cause: '402 Payment Required',
            },
          ],
        },
        {
          harness: 'paseo',
          accessPath: 'http://127.0.0.1:20128/v1',
          upstream: 'test-a',
          model: 'test-a/invented-alpha',
          evidence: [{ level: 3, status: 'passed', source: 'production run' }],
        },
        {
          harness: 'agy',
          accessPath: 'cli',
          upstream: 'agy-local',
          model: 'invented-cli-model',
          evidence: [{ level: 2, status: 'passed', source: 'CLI session' }],
        },
      ],
      aliases: [
        {
          upstream: 'test-b',
          canonical: 'invented-beta-v2',
          harness: 'opencode',
          alias: 'invented-beta',
          verified: false,
        },
      ],
      sharedQuotas: [],
      upstreamStatus: {
        'test-blocked': {
          lastStatus: 'blocked',
          failCount: 1,
          blockedAt: new Date().toISOString(),
          blockReason: 'HTTP 402',
          scope: 'upstream',
        },
      },
    };
    evidence.saveEvidence(dir, evData);

    // Generate candidates — one agy account binds a concrete CLI model.
    const fromCatalogue = candidates.generateCandidates({
      registry,
      catalogue,
      accounts: [{ id: 'agy-main', sourceId: 'agy-local', models: ['invented-cli-model'] }],
    });
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
      explorationBudget: 1,
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
    assert.ok(
      routerUpstreams.size >= 3,
      'has candidates from >= 3 different 9Router upstreams, got: ' +
        [...routerUpstreams].join(', ')
    );

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
          harness: 'paseo',
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
    const catalogue = ['test-a/invented-alpha', 'test-b/invented-beta', 'test-c/invented-gamma'];

    const evData = {
      combinations: [
        {
          harness: 'paseo',
          accessPath: 'http://127.0.0.1:20128/v1',
          upstream: 'test-a',
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
      explorationBudget: 1,
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
      dir: path.join(dir, 'decisions'),
      days: 1,
    });
    assert.ok(records.length >= 1, 'decision was written to the log');
    assert.equal(records[records.length - 1].workItemId, 'UNASSIGNED-01');

    // When the first choice fails, the second candidate should be available.
    // Simulate: block the chosen upstream.
    const chosen = decision.candidates[0];
    evidence.recordProbe(
      dir,
      {
        harness: chosen.harness,
        accessPath: chosen.accessPath,
        upstream: chosen.upstream,
        modelId: chosen.modelId,
      },
      {
        level: evidence.Level.API,
        status: 'failed',
        httpStatus: 402,
        source: 'simulated failure',
      }
    );

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
      explorationBudget: 1,
      decisionOpts: { dir: path.join(dir, 'decisions'), now: Date.now() },
      credentialOpts: { env: { NINEROUTER_API_KEY: 'present' } },
    });

    // The second run should choose a different candidate (the first is now blocked).
    if (decision2.chosen) {
      assert.notEqual(
        decision2.chosen,
        decision.chosen,
        'fallback chose a different candidate after first-choice failure'
      );
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
    assert.ok(
      snapshot.models.length > 100,
      'snapshot has a reasonable number of models: ' + snapshot.models.length
    );
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
        harness: 'paseo',
        accessPath: 'http://127.0.0.1:20128/v1',
        upstream: agModel.split('/')[0],
        model: agModel,
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
      explorationBudget: 1,
      cataloguesByPath: { 'http://127.0.0.1:20128/v1': catalogueSet },
      credentialOpts: { env: { NINEROUTER_API_KEY: 'present' } },
    });

    assert.ok(decision.chosen, 'integration run chose a candidate');
    // The winner's modelId must be in the snapshot catalogue.
    const winnerCandidate = decision.candidates.find(
      (c) => evidence.candidateKey(c) === decision.chosen || c.offeringId === decision.chosen
    );
    assert.ok(winnerCandidate, 'winner found in candidates list');
    if (winnerCandidate.modelId !== '*') {
      assert.ok(
        catalogueSet.has(winnerCandidate.modelId),
        'winning model ' + winnerCandidate.modelId + ' exists in the snapshot catalogue'
      );
    }

    // No MODEL_NOT_IN_CATALOG rejections when all models come from the snapshot.
    const catalogRejections = decision.rejected.filter((r) => r.reason === 'MODEL_NOT_IN_CATALOG');
    assert.equal(
      catalogRejections.length,
      0,
      'no MODEL_NOT_IN_CATALOG rejections when catalogue is self-consistent'
    );
  });

  test('stale model id is rejected with MODEL_NOT_IN_CATALOG when validated against snapshot', () => {
    if (!snapshot) return;

    const catalogueSet = ranking.buildCatalogueSet(snapshot.models);

    // A stale model id that is NOT in the snapshot.
    const staleId = 'ag/gemini-2.5-pro';
    assert.ok(!catalogueSet.has(staleId), 'stale model is indeed absent from snapshot');

    const testCandidates = [
      {
        harness: 'paseo',
        accessPath: 'http://127.0.0.1:20128/v1',
        upstream: 'ag',
        modelId: staleId,
        source: '9router',
        status: 'passed',
        evidence: [{ level: 3, status: 'passed' }],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
      {
        harness: 'paseo',
        accessPath: 'http://127.0.0.1:20128/v1',
        upstream: 'ag',
        modelId: 'ag/gemini-3.8-flash-high',
        source: '9router',
        status: 'unknown',
        evidence: [],
        blocked: false,
        sharedQuota: 'unknown',
        qualifiedRoles: ['author.foundation'],
      },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'INTEG-STALE-01',
      role: 'author.foundation',
      dryRun: true,
      cataloguesByPath: { 'http://127.0.0.1:20128/v1': catalogueSet },
    });

    // The stale model is rejected.
    const staleRejection = decision.rejected.find(
      (r) => r.reason === 'MODEL_NOT_IN_CATALOG' && r.modelId === staleId
    );
    assert.ok(staleRejection, 'ag/gemini-2.5-pro is rejected as MODEL_NOT_IN_CATALOG');

    // The valid model is chosen instead.
    assert.ok(decision.chosen, 'a valid model was chosen');
    assert.ok(
      decision.chosen.includes('ag/gemini-3.8-flash-high'),
      'winner is the model that exists in the catalogue'
    );
  });
});
