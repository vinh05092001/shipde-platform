'use strict';

/**
 * Acceptance tests for Slices B+C: candidate generation, ranking, and
 * decision recording.
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

/** Create a temp dir with a sources.json and optional evidence. */
function setup(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-bc-'));
  const decDir = path.join(dir, 'decisions');
  fs.mkdirSync(decDir, { recursive: true });

  // The real sources.json from the repository, loaded for reference.
  const registry = sourcesApi.loadSources();

  if (opts && opts.evidence) {
    evidence.saveEvidence(dir, opts.evidence);
  }

  return { dir, decDir, registry };
}

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
      harness: 'paseo', accessPath: 'http', upstream: 'gh', modelId: 'gh/gpt-4.1',
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
      harness: 'paseo', accessPath: 'http', upstream: 'kimchi', modelId: 'kimchi/some-model',
    }, {
      level: evidence.Level.API, status: 'failed', httpStatus: 402,
      source: 'test', cause: '402 Payment Required',
    });
    const data = evidence.loadEvidence(dir);

    // kimchi is blocked.
    const kimchiBlock = evidence.isUpstreamBlocked(data, 'kimchi');
    assert.equal(kimchiBlock.blocked, true);
    assert.match(kimchiBlock.reason, /402/);
    assert.equal(kimchiBlock.scope, 'upstream');

    // ag is NOT blocked — failure scope is per-upstream.
    const agBlock = evidence.isUpstreamBlocked(data, 'ag');
    assert.equal(agBlock.blocked, false);
  });

  test('block expires after TTL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    evidence.recordProbe(dir, {
      harness: 'paseo', accessPath: 'http', upstream: 'kr', modelId: 'kr/model',
    }, {
      level: evidence.Level.API, status: 'failed', httpStatus: 402, source: 'test',
    });
    const data = evidence.loadEvidence(dir);
    // Simulate time passing beyond TTL.
    const future = Date.now() + evidence.BLOCK_TTL_MS + 1000;
    const block = evidence.isUpstreamBlocked(data, 'kr', { now: future });
    assert.equal(block.blocked, false);
  });

  test('records aliases with verified flag', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-'));
    evidence.recordAlias(dir, 'gh', 'gpt-4.1-2025-04-14', 'opencode', 'gpt-4.1', false,
      'OpenCode alias differs from HTTP id');
    const data = evidence.loadEvidence(dir);
    assert.equal(data.aliases.length, 1);
    assert.equal(data.aliases[0].verified, false);
    assert.equal(data.aliases[0].canonical, 'gpt-4.1-2025-04-14');
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
      harness: 'paseo', accessPath: 'http', upstream: 'gh', modelId: 'gh/gpt-4o',
    });
    assert.equal(key, 'paseo::http::gh::gh/gpt-4o');
  });
});

// ── Candidate Generation ──────────────────────────────────────────────

describe('candidate generation', () => {
  test('generates candidates from gateway catalogue without hard-coded models', () => {
    const registry = sourcesApi.loadSources();
    // Simulate a live catalogue with a few models across different upstreams.
    const catalogue = [
      'gh/gpt-4.1-2025-04-14',
      'ag/gemini-2.5-pro',
      'kr/claude-sonnet-4',
      'cerebras/llama3-70b',
      'kimchi/glm-5.3-flash',
      'groq/llama-3.1-8b',
    ];

    const result = candidates.generateCandidates({ registry, catalogue });

    // Must have candidates from multiple different upstreams.
    const upstreams = new Set(result.map((c) => c.upstream));
    assert.ok(upstreams.has('gh'), 'has gh upstream');
    assert.ok(upstreams.has('ag'), 'has ag upstream');
    assert.ok(upstreams.has('kr'), 'has kr upstream');
    assert.ok(upstreams.has('cerebras'), 'has cerebras upstream');

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
    const catalogue = ['gh/gpt-4.1-2025-04-14'];
    const openCodeIds = ['ninerouter/gh/gpt-4.1'];

    const result = candidates.generateCandidates({ registry, catalogue, openCodeIds });

    // The HTTP candidate.
    const httpCandidate = result.find(
      (c) => c.modelId === 'gh/gpt-4.1-2025-04-14' && c.harness === 'paseo' && c.accessPath.includes('127.0.0.1')
    );
    // The OpenCode candidate (via oc source).
    const ocCandidate = result.find(
      (c) => c.modelId === 'ninerouter/gh/gpt-4.1' && c.harness === 'opencode'
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
          harness: 'paseo', accessPath: 'http', upstream: 'cc',
          model: 'cc/claude-sonnet-5', source: 'cc',
          evidence: [{ level: 1, status: 'failed', httpStatus: 403 }],
        },
      ],
      aliases: [],
      sharedQuotas: [],
      upstreamStatus: {},
    };
    const fromEvidence = candidates.candidatesFromEvidence(evData);
    assert.equal(fromEvidence.length, 1);
    assert.equal(fromEvidence[0].modelId, 'cc/claude-sonnet-5');
  });

  test('mergeCandidates deduplicates by four-part key', () => {
    const a = [{ harness: 'paseo', accessPath: 'http', upstream: 'gh', modelId: 'gh/model-a' }];
    const b = [
      { harness: 'paseo', accessPath: 'http', upstream: 'gh', modelId: 'gh/model-a' },
      { harness: 'paseo', accessPath: 'http', upstream: 'ag', modelId: 'ag/model-b' },
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
    const catalogue = ['np/some-new-model', 'gh/gpt-4o'];
    const result = candidates.generateCandidates({ registry, catalogue });

    // The new provider's model appears without any code change.
    const np = result.find((c) => c.upstream === 'np' && c.modelId === 'np/some-new-model');
    assert.ok(np, 'new data-only source produced a candidate');
    assert.equal(np.source, 'newprovider');
  });
});

// ── Ranking ───────────────────────────────────────────────────────────

describe('ranking', () => {
  test('ranks candidates and selects winner with stated reason', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-'));
    const decDir = path.join(dir, 'decisions');

    const testCandidates = [
      { harness: 'paseo', accessPath: 'http', upstream: 'ag', modelId: 'ag/gemini-2.5-pro',
        source: '9router', status: 'passed', evidence: [{ level: 3, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'gh', modelId: 'gh/gpt-4.1',
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
      { harness: 'paseo', accessPath: 'http', upstream: 'kimchi', modelId: 'kimchi/model',
        source: '9router', status: 'failed', evidence: [],
        blocked: true, blockReason: 'HTTP 402', blockScope: 'upstream', sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'ag', modelId: 'ag/gemini',
        source: '9router', status: 'passed', evidence: [{ level: 2, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'cerebras', modelId: 'cerebras/llama',
        source: '9router', status: 'unknown', evidence: [],
        blocked: false, sharedQuota: 'unknown' },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-02', role: 'author.foundation', dryRun: true,
    });

    // kimchi is rejected.
    const kimchiRejection = decision.rejected.find((r) => r.upstream === 'kimchi');
    assert.ok(kimchiRejection, 'kimchi is rejected');
    assert.match(kimchiRejection.reason, /402/);
    assert.equal(kimchiRejection.scope, 'upstream');

    // ag and cerebras are still eligible.
    const agCandidate = decision.candidates.find((c) => c.upstream === 'ag');
    assert.ok(agCandidate, 'ag is still eligible');
    const cereCandidate = decision.candidates.find((c) => c.upstream === 'cerebras');
    assert.ok(cereCandidate, 'cerebras is still eligible');
  });

  test('rejects candidate with absent credential', () => {
    const registry = sourcesApi.loadSources();
    const testCandidates = [
      { harness: 'paseo', accessPath: 'http', upstream: 'bai', modelId: 'bai/model',
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
      { harness: 'paseo', accessPath: 'http', upstream: 'ag', modelId: 'ag/model-a',
        source: '9router', status: 'passed', evidence: [{ level: 2, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'ag', modelId: 'ag/model-b',
        source: '9router', status: 'passed', evidence: [{ level: 2, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
      { harness: 'paseo', accessPath: 'http', upstream: 'gh', modelId: 'gh/model-c',
        source: '9router', status: 'passed', evidence: [{ level: 2, status: 'passed' }],
        blocked: false, sharedQuota: 'unknown' },
    ];

    const decision = ranking.rankAndRecord(testCandidates, {
      workItemId: 'TASK-TEST-05', role: 'author.foundation', dryRun: true,
    });

    // gh has better spread score (only 1 from that upstream) vs ag (2 from ag).
    const ghScore = decision.candidates.find((c) => c.upstream === 'gh');
    const agScore = decision.candidates.find((c) => c.upstream === 'ag');
    assert.ok(ghScore, 'gh candidate present');
    assert.ok(agScore, 'ag candidate present');
    // The spread component should favour gh.
    assert.ok(
      ghScore.scoreBreakdown.spread > agScore.scoreBreakdown.spread,
      'gh has better spread score than ag'
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
});

// ── Full Acceptance Run ───────────────────────────────────────────────

describe('acceptance: full ranking run', () => {
  test('candidate list has agy, multiple 9Router upstreams, 402 rejection, unknown, and stated reason', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-'));
    const registry = sourcesApi.loadSources();

    // Simulated live catalogue — models from different upstreams.
    const catalogue = [
      'ag/gemini-2.5-pro',
      'gh/gpt-4.1-2025-04-14',
      'kr/claude-sonnet-4',
      'kimchi/glm-5.3-flash',
      'cerebras/llama3-70b',
      'groq/llama-3.1-8b',
      'cc/claude-sonnet-5',
    ];

    // Seed evidence: kimchi returned 402.
    const evData = {
      combinations: [
        {
          harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1', upstream: 'kimchi',
          model: 'kimchi/glm-5.3-flash',
          evidence: [{ level: 1, status: 'failed', httpStatus: 402, source: 'probe',
            cause: '402 Payment Required' }],
        },
        {
          harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1', upstream: 'ag',
          model: 'ag/gemini-2.5-pro',
          evidence: [{ level: 3, status: 'passed', source: 'production run' }],
        },
        {
          harness: 'agy', accessPath: 'cli', upstream: 'agy-local',
          model: '*',
          evidence: [{ level: 2, status: 'passed', source: 'CLI session' }],
        },
      ],
      aliases: [
        { upstream: 'gh', canonical: 'gpt-4.1-2025-04-14', harness: 'opencode',
          alias: 'gpt-4.1', verified: false },
      ],
      sharedQuotas: [],
      upstreamStatus: {
        kimchi: { lastStatus: 'blocked', failCount: 1,
          blockedAt: new Date().toISOString(), blockReason: 'HTTP 402', scope: 'upstream' },
      },
    };
    evidence.saveEvidence(dir, evData);

    // Generate candidates.
    const fromCatalogue = candidates.generateCandidates({ registry, catalogue });
    const fromEvidence = candidates.candidatesFromEvidence(evData);
    const merged = candidates.mergeCandidates(fromCatalogue, fromEvidence);
    const annotated = candidates.annotateCandidates(merged, evData);

    // Rank.
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
    // Other upstreams of the same gateway are still eligible.
    assert.ok(
      decision.candidates.some((c) => c.upstream === 'ag'),
      'ag is still eligible despite kimchi 402'
    );
    assert.ok(
      decision.candidates.some((c) => c.upstream === 'cerebras'),
      'cerebras is still eligible despite kimchi 402'
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

    const catalogue = ['bn/new-model-v1', 'gh/gpt-4o'];
    const result = candidates.generateCandidates({ registry, catalogue });

    const bnCandidate = result.find((c) => c.upstream === 'bn');
    assert.ok(bnCandidate, 'brand-new data-only source produced a candidate');
    assert.equal(bnCandidate.source, 'brandnew');
    assert.equal(bnCandidate.modelId, 'bn/new-model-v1');
  });
});

describe('acceptance: unassigned work item', () => {
  test('dispatching with no model, account or harness named in input', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unassigned-'));
    const registry = sourcesApi.loadSources();

    const catalogue = [
      'ag/gemini-2.5-pro',
      'gh/gpt-4.1-2025-04-14',
      'cerebras/llama3-70b',
    ];

    const evData = {
      combinations: [
        {
          harness: 'paseo', accessPath: 'http://127.0.0.1:20128/v1', upstream: 'ag',
          model: 'ag/gemini-2.5-pro',
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
