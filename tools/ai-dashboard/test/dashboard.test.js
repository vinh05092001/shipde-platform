/**
 * Ship Dễ — Realtime AI Cockpit Automated Test Suite
 * TASK-AI-15: Acceptance Criteria AI15-AC01 through AI15-AC11
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const http = require('http');

const {
  parseRegisterCsv,
  deriveAuthor,
  deriveRegisterState,
  deriveGatePipeline,
  loadRegister,
  resolveAssignedAuthorFromWorkItem,
  resetWorkItemAuthorCacheForTest,
} = require('../register-adapter');

const {
  classifySessionRole,
  computeFreshness,
  parseAoStatus,
  parseAoSessions,
} = require('../ao-adapter');

const {
  parseChecks,
  parseReviews,
  TRUSTED_CODEX_LOGIN,
  safeGitHubErrorReason,
} = require('../github-adapter');

const { parseWorktreesPorcelain, parseCommits } = require('../git-adapter');

const { resolveAoExecutable, resetAoExecutableCacheForTest } = require('../ao-adapter');

const { detectConflicts } = require('../conflict-detector');

const { redactSensitive, redactPath, redactObject } = require('../redaction');

const {
  aggregateCockpitState,
  deriveOverallStatus,
  buildActivityStream,
  buildGitHubEvidence,
  computeSourceFreshness,
  DEFAULT_FRESHNESS_THRESHOLDS_MS,
  resetRevisionForTest,
} = require('../aggregator');

const { createDashboardServer, isPathTraversal } = require('../server');

const {
  deriveWriterState,
  GATE_STAGE_LABELS,
  formatSourceAge,
  FRESHNESS_BADGE,
} = require('../client');

const { renderStaticDashboard } = require('../render-static');

describe('TASK-AI-15 Realtime AI Cockpit Suite', () => {
  describe('AI15-AC01: Register CSV Parsing & Derivations', () => {
    test('parses RFC 4180 CSV with quotes, embedded commas, escaped quotes, and newlines', () => {
      const csv = `"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"
"1","S00","Foundation","TASK-FOUND-01","","Freeze, classify","Inventory and ""protect"" behavior
multiline detail","MERGED","","docs/item1.md","feat/item1","#1","PASS","abc1234"
"2","S01","Identity","FEAT-AUTH-01","FEAT-AUTH-01","Sign up","Email, phone verify","IN_PROGRESS","TASK-FOUND-01","docs/auth.md","feat/auth","#14","",""`;

      const items = parseRegisterCsv(csv);
      assert.strictEqual(items.length, 2);

      assert.strictEqual(items[0].work_item_id, 'TASK-FOUND-01');
      assert.strictEqual(items[0].feature_name, 'Freeze, classify');
      assert.strictEqual(
        items[0].key_behavior,
        'Inventory and "protect" behavior\nmultiline detail'
      );
      assert.strictEqual(items[0].status, 'MERGED');
      // Register rows in this fixture carry no assigned_author column, so the
      // author is honestly UNKNOWN rather than guessed from the ID prefix.
      assert.strictEqual(items[0].assigned_author, 'UNKNOWN');

      assert.strictEqual(items[1].work_item_id, 'FEAT-AUTH-01');
      assert.strictEqual(items[1].assigned_author, 'UNKNOWN');
      assert.strictEqual(items[1].status, 'IN_PROGRESS');
    });

    test('derives author solely from an explicit assigned_author field, never from the work_item_id', () => {
      assert.strictEqual(
        deriveAuthor({ work_item_id: 'TASK-AI-15', assigned_author: 'GEMINI' }),
        'GEMINI'
      );
      assert.strictEqual(
        deriveAuthor({ work_item_id: 'CUSTOM', assigned_author: 'HUMAN' }),
        'HUMAN'
      );
      assert.strictEqual(
        deriveAuthor({ work_item_id: 'CUSTOM', assigned_author: '  CLAUDE  ' }),
        'CLAUDE'
      );

      // IDs that previously triggered inference must no longer influence the result.
      assert.strictEqual(deriveAuthor({ work_item_id: 'TASK-AI-15' }), 'UNKNOWN');
      assert.strictEqual(deriveAuthor({ work_item_id: 'TASK-FOUND-02' }), 'UNKNOWN');
      assert.strictEqual(deriveAuthor({ work_item_id: 'FEAT-AUTH-01' }), 'UNKNOWN');
      assert.strictEqual(deriveAuthor({ work_item_id: 'TASK-FIXTURE-01' }), 'UNKNOWN');
      assert.strictEqual(deriveAuthor({ work_item_id: 'FEAT-USR-01' }), 'UNKNOWN');

      // Blank/whitespace-only assigned_author is also UNKNOWN, not inferred.
      assert.strictEqual(
        deriveAuthor({ work_item_id: 'TASK-AI-15', assigned_author: '   ' }),
        'UNKNOWN'
      );
      assert.strictEqual(deriveAuthor({}), 'UNKNOWN');
    });

    test('derives totals, active item, and gate pipeline without mock overrides', () => {
      const items = [
        { work_item_id: 'T1', status: 'MERGED', slice: 'S00' },
        { work_item_id: 'T2', status: 'MERGED', slice: 'S00' },
        { work_item_id: 'T3', status: 'READY_FOR_CODEX', slice: 'S01', branch: 'feat/t3' },
        { work_item_id: 'T4', status: 'READY_FOR_AUTHOR', slice: 'S01' },
      ];

      const derived = deriveRegisterState(items);
      assert.strictEqual(derived.total, 4);
      assert.strictEqual(derived.mergedCount, 2);
      assert.strictEqual(derived.completionPercent, '50.0');
      assert.strictEqual(derived.activeItem.work_item_id, 'T3');
      // Without live, exact-HEAD GitHub evidence, register-only derivation
      // must never claim the review/CI gates are running or passed.
      assert.strictEqual(derived.gatePipeline.currentGate, 'EVIDENCE_UNAVAILABLE');
      assert.strictEqual(derived.gatePipeline.gates[2].status, 'UNAVAILABLE');
      assert.strictEqual(derived.gatePipeline.gates[3].status, 'UNAVAILABLE');
    });

    test('loads live canonical repository register file without error', () => {
      const csvPath = path.resolve(
        __dirname,
        '../../../docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'
      );
      const res = loadRegister(csvPath);
      assert.strictEqual(res.health.status, 'live');
      assert.ok(res.data.total >= 148, `Expected at least 148 items, got ${res.data.total}`);
      assert.ok(res.data.mergedCount >= 10);
      assert.ok(res.data.activeItem !== null);
    });
  });

  describe('AI15-R03: Gate pipeline requires exact-HEAD GitHub evidence', () => {
    test('never infers CODEX_REVIEW/CI_GATES/HUMAN_MERGE as passed from register fields alone', () => {
      const activeItem = {
        work_item_id: 'T9',
        status: 'READY_FOR_HUMAN_MERGE',
        codex_verdict: 'PASS',
        branch: 'feat/t9',
      };

      const withoutEvidence = deriveGatePipeline(activeItem, null);
      assert.strictEqual(withoutEvidence.currentGate, 'EVIDENCE_UNAVAILABLE');
      for (const gateName of ['CODEX_REVIEW', 'CI_GATES', 'HUMAN_MERGE']) {
        const gate = withoutEvidence.gates.find((g) => g.name === gateName);
        assert.strictEqual(gate.status, 'UNAVAILABLE');
      }
    });

    test('shows UNAVAILABLE when GitHub evidence exists but the PR head does not match local HEAD', () => {
      const activeItem = { work_item_id: 'T9', status: 'READY_FOR_CODEX', branch: 'feat/t9' };
      const evidence = { available: true, headMatches: false, ciPassed: true, codexPass: true };

      const result = deriveGatePipeline(activeItem, evidence);
      assert.strictEqual(result.currentGate, 'EVIDENCE_UNAVAILABLE');
      assert.strictEqual(result.gates.find((g) => g.name === 'CI_GATES').status, 'UNAVAILABLE');
      assert.strictEqual(result.gates.find((g) => g.name === 'HUMAN_MERGE').status, 'UNAVAILABLE');
    });

    test('marks the merge gate READY only when exact-HEAD CI and Codex evidence both pass', () => {
      const activeItem = { work_item_id: 'T9', status: 'READY_FOR_CODEX', branch: 'feat/t9' };
      const evidence = { available: true, headMatches: true, ciPassed: true, codexPass: true };

      const result = deriveGatePipeline(activeItem, evidence);
      assert.strictEqual(result.currentGate, 'HUMAN_MERGE');
      assert.strictEqual(result.gates.find((g) => g.name === 'CODEX_REVIEW').status, 'PASSED');
      assert.strictEqual(result.gates.find((g) => g.name === 'CI_GATES').status, 'PASSED');
      assert.strictEqual(result.gates.find((g) => g.name === 'HUMAN_MERGE').status, 'READY');
    });

    test('stays IN_PROGRESS on exact HEAD when CI or Codex evidence has not passed yet', () => {
      const activeItem = { work_item_id: 'T9', status: 'READY_FOR_CODEX', branch: 'feat/t9' };
      const evidence = { available: true, headMatches: true, ciPassed: false, codexPass: true };

      const result = deriveGatePipeline(activeItem, evidence);
      assert.strictEqual(result.currentGate, 'CODEX_REVIEW');
      assert.strictEqual(result.gates.find((g) => g.name === 'CI_GATES').status, 'IN_PROGRESS');
      assert.strictEqual(result.gates.find((g) => g.name === 'HUMAN_MERGE').status, 'PENDING');
    });

    test('buildGitHubEvidence reports unavailable when the GitHub source is not live/authenticated', () => {
      const activeItem = { work_item_id: 'T9', branch: 'feat/t9' };
      const evidence = buildGitHubEvidence(
        activeItem,
        { headOid: 'abc' },
        { authenticated: false, pullRequests: [] },
        'unavailable'
      );
      assert.strictEqual(evidence.available, false);
      assert.strictEqual(evidence.headMatches, false);
    });

    test('buildGitHubEvidence detects a head mismatch between local git and the matching PR', () => {
      const activeItem = { work_item_id: 'T9', branch: 'feat/t9' };
      const gitData = { headOid: 'localsha123' };
      const githubData = {
        authenticated: true,
        pullRequests: [
          {
            headRefName: 'feat/t9',
            headRefOid: 'differentsha456',
            checks: { summary: 'PASSED', totalCount: 3 },
            reviews: { trustedCodexVerdict: 'PASS' },
          },
        ],
      };
      const evidence = buildGitHubEvidence(activeItem, gitData, githubData, 'live');
      assert.strictEqual(evidence.available, true);
      assert.strictEqual(evidence.headMatches, false);
      assert.strictEqual(evidence.ciPassed, false);
      assert.strictEqual(evidence.codexPass, false);
    });

    test('buildGitHubEvidence confirms full evidence on an exact-HEAD match with passing CI and Codex', () => {
      const activeItem = { work_item_id: 'T9', branch: 'feat/t9' };
      const gitData = { headOid: 'samesha789' };
      const githubData = {
        authenticated: true,
        pullRequests: [
          {
            headRefName: 'feat/t9',
            headRefOid: 'samesha789',
            checks: { summary: 'PASSED', totalCount: 3 },
            reviews: { trustedCodexVerdict: 'PASS' },
          },
        ],
      };
      const evidence = buildGitHubEvidence(activeItem, gitData, githubData, 'live');
      assert.strictEqual(evidence.headMatches, true);
      assert.strictEqual(evidence.ciPassed, true);
      assert.strictEqual(evidence.codexPass, true);
    });
  });

  describe('AI15-R01: Per-source freshness (observedAt, ageMs, freshness)', () => {
    const FIXED_NOW = new Date('2026-09-13T12:00:00.000Z').getTime();

    test('reports live for a recent successful observation', () => {
      const observedAt = new Date(FIXED_NOW - 2000).toISOString(); // 2s ago
      const result = computeSourceFreshness(
        observedAt,
        'live',
        DEFAULT_FRESHNESS_THRESHOLDS_MS,
        FIXED_NOW
      );
      assert.strictEqual(result.freshness, 'live');
      assert.strictEqual(result.ageMs, 2000);
    });

    test('reports stale once age exceeds the live threshold but is still within the stale threshold', () => {
      const observedAt = new Date(FIXED_NOW - 30 * 1000).toISOString(); // 30s ago
      const result = computeSourceFreshness(
        observedAt,
        'live',
        DEFAULT_FRESHNESS_THRESHOLDS_MS,
        FIXED_NOW
      );
      assert.strictEqual(result.freshness, 'stale');
      assert.strictEqual(result.ageMs, 30000);
    });

    test('reports unavailable once age exceeds the stale threshold, even if collection itself succeeded', () => {
      const observedAt = new Date(FIXED_NOW - 10 * 60 * 1000).toISOString(); // 10 minutes ago
      const result = computeSourceFreshness(
        observedAt,
        'live',
        DEFAULT_FRESHNESS_THRESHOLDS_MS,
        FIXED_NOW
      );
      assert.strictEqual(result.freshness, 'unavailable');
      assert.strictEqual(result.ageMs, 10 * 60 * 1000);
    });

    test('reports unavailable with a null ageMs when the source status itself is unavailable', () => {
      const observedAt = new Date(FIXED_NOW - 1000).toISOString();
      const result = computeSourceFreshness(
        observedAt,
        'unavailable',
        DEFAULT_FRESHNESS_THRESHOLDS_MS,
        FIXED_NOW
      );
      assert.strictEqual(result.freshness, 'unavailable');
      assert.strictEqual(result.ageMs, null);
    });

    test('reports unavailable when no observedAt or an unparseable timestamp is given (never fabricated live)', () => {
      assert.strictEqual(
        computeSourceFreshness(null, 'live', DEFAULT_FRESHNESS_THRESHOLDS_MS, FIXED_NOW).freshness,
        'unavailable'
      );
      assert.strictEqual(
        computeSourceFreshness('not-a-date', 'live', DEFAULT_FRESHNESS_THRESHOLDS_MS, FIXED_NOW)
          .freshness,
        'unavailable'
      );
    });

    test('aggregateCockpitState attaches observedAt, ageMs and freshness to every source health record', async () => {
      resetRevisionForTest(1);
      const observedAt = new Date(FIXED_NOW - 1000).toISOString();
      const mockHealth = (name, status) => ({
        name,
        status,
        observedAt,
        latencyMs: 5,
        provenance: 'test',
        impact: 'None',
        error: null,
      });

      const state = await aggregateCockpitState({
        now: FIXED_NOW,
        mockGit: {
          health: mockHealth('git', 'live'),
          data: {
            currentBranch: 'main',
            headOid: '',
            headOidShort: '',
            dirtyCount: 0,
            worktrees: [],
            recentCommits: [],
          },
        },
        mockAo: {
          health: mockHealth('ao', 'unavailable'),
          data: { daemon: { ready: false, state: 'stopped' }, sessions: [] },
        },
        mockGitHub: {
          health: mockHealth('github', 'live'),
          data: { authenticated: true, repo: 'x/y', pullRequests: [] },
        },
        mockRegister: {
          health: mockHealth('register', 'live'),
          data: {
            total: 0,
            mergedCount: 0,
            completionPercent: '0.0',
            byStatus: {},
            bySlice: {},
            activeItem: null,
            gatePipeline: { currentGate: 'IDLE', gates: [] },
            items: [],
          },
        },
      });

      for (const key of ['register', 'git', 'ao', 'github']) {
        const src = state.sources[key];
        assert.ok(src.observedAt, `${key} must expose observedAt`);
        assert.ok('ageMs' in src, `${key} must expose ageMs`);
        assert.ok('freshness' in src, `${key} must expose freshness`);
      }

      assert.strictEqual(state.sources.git.freshness, 'live');
      assert.strictEqual(state.sources.git.ageMs, 1000);
      // AO's own status was collected as unavailable, so freshness must never
      // be fabricated as live/stale even though observedAt is recent.
      assert.strictEqual(state.sources.ao.freshness, 'unavailable');
      assert.strictEqual(state.sources.ao.ageMs, null);
    });

    test('formatSourceAge renders human-readable ages and N/A for unknown age', () => {
      assert.strictEqual(formatSourceAge(null), 'N/A');
      assert.strictEqual(formatSourceAge(undefined), 'N/A');
      assert.strictEqual(formatSourceAge(500), '<1s');
      assert.strictEqual(formatSourceAge(45000), '45s');
      assert.strictEqual(formatSourceAge(125000), '2m 5s');
    });

    test('FRESHNESS_BADGE provides a distinct, non-color-only label for each freshness state', () => {
      // The cockpit reads Vietnamese; what matters is that each state carries its own
      // word, so colour is never the only signal.
      assert.strictEqual(FRESHNESS_BADGE.live.text.includes('Trực tiếp'), true);
      assert.strictEqual(FRESHNESS_BADGE.stale.text.includes('Cũ'), true);
      assert.strictEqual(FRESHNESS_BADGE.unavailable.text.includes('Không có'), true);
      const labels = [FRESHNESS_BADGE.live.text, FRESHNESS_BADGE.stale.text, FRESHNESS_BADGE.unavailable.text];
      assert.strictEqual(new Set(labels).size, 3);
    });
  });

  describe('AI15-R05: Git & AO adapter PII/path minimization', () => {
    test('parsed commits never expose authorEmail', () => {
      const commits = parseCommits('abc123|Dev Name|2026-09-13T10:00:00Z|Commit message');
      assert.strictEqual(commits.length, 1);
      assert.strictEqual(commits[0].authorName, 'Dev Name');
      assert.strictEqual('authorEmail' in commits[0], false);
    });

    test('parsed worktrees never expose an unredacted rawPath', () => {
      const output =
        'worktree C:\\Users\\gumac\\AI\\shipde-platform\nHEAD abc123\nbranch refs/heads/main\n';
      const worktrees = parseWorktreesPorcelain(output);
      assert.strictEqual(worktrees.length, 1);
      assert.strictEqual('rawPath' in worktrees[0], false);
      assert.strictEqual(worktrees[0].path.includes('gumac'), false);
    });

    test('resolves an AO executable path or command deterministically without a shell', () => {
      resetAoExecutableCacheForTest();
      const resolved = resolveAoExecutable();
      assert.strictEqual(typeof resolved, 'string');
      assert.ok(resolved.length > 0);
      // Calling again must return the cached, identical resolution.
      assert.strictEqual(resolveAoExecutable(), resolved);
    });
  });

  describe('AI15-AC02: Agent Orchestrator State & Role Classification', () => {
    test('classifies AO roles correctly separating author, reviewer, analyst, supervisor', () => {
      const sup = classifySessionRole({
        role: 'orchestrator',
        branch: 'ao/shipde-platf-orchestrator',
      });
      assert.strictEqual(sup.category, 'SUPERVISOR');
      assert.strictEqual(sup.isWriter, false);

      const rev = classifySessionRole({
        role: 'worker',
        branch: 'agent/codex-review',
        harness: 'codex',
      });
      assert.strictEqual(rev.category, 'REVIEWER');
      assert.strictEqual(rev.isWriter, false);

      const ana = classifySessionRole({
        role: 'worker',
        harness: 'claude-code',
        branch: 'ao/shipde-platform-13/root',
      });
      assert.strictEqual(ana.category, 'ANALYST');
      assert.strictEqual(ana.isWriter, false);

      const aut = classifySessionRole({
        role: 'worker',
        harness: 'agy',
        branch: 'feat/task-ai-15-realtime-ai-cockpit',
      });
      assert.strictEqual(aut.category, 'AUTHOR');
      assert.strictEqual(aut.isWriter, true);
    });

    test('computes freshness age labels deterministically', () => {
      const now = new Date().toISOString();
      const fLive = computeFreshness(now);
      assert.strictEqual(fLive.status, 'live');

      const pastTenMins = new Date(Date.now() - 600 * 1000).toISOString();
      const fStale = computeFreshness(pastTenMins);
      assert.strictEqual(fStale.status, 'stale');
      assert.ok(fStale.label.includes('STALE') || fStale.label.includes('cũ'));
    });

    test('handles malformed AO json without crashing', () => {
      const status = parseAoStatus('not-json-content');
      assert.strictEqual(status.ready, false);
      assert.strictEqual(status.state, 'malformed_json');

      const sessions = parseAoSessions('{ "invalid": true }');
      assert.deepStrictEqual(sessions, []);
    });
  });

  describe('AI15-AC03: GitHub CLI Adapter & Exact-HEAD Evidence', () => {
    test('parses check runs rollup into pass/fail counts and overall conclusion', () => {
      const rollup = [
        { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'typecheck', status: 'COMPLETED', conclusion: 'SUCCESS' },
      ];
      const parsed = parseChecks(rollup);
      assert.strictEqual(parsed.summary, 'PASSED');
      assert.strictEqual(parsed.passCount, 3);
      assert.strictEqual(parsed.failCount, 0);
    });

    test('detects check failures accurately', () => {
      const rollup = [
        { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { name: 'test', status: 'COMPLETED', conclusion: 'FAILURE' },
      ];
      const parsed = parseChecks(rollup);
      assert.strictEqual(parsed.summary, 'FAILED');
      assert.strictEqual(parsed.failCount, 1);
    });

    test('extracts trusted Codex review verdicts', () => {
      const reviews = [
        { author: { login: TRUSTED_CODEX_LOGIN }, state: 'APPROVED', body: 'VERDICT: PASS' },
      ];
      const parsed = parseReviews(reviews, []);
      assert.strictEqual(parsed.trustedCodexVerdict, 'PASS');
    });

    test('never trusts an arbitrary bot or a login that merely contains "codex"/"bot"', () => {
      const impostorReviews = [
        { author: { login: 'codex-impersonator-bot' }, state: 'APPROVED', body: 'VERDICT: PASS' },
        { author: { login: 'some-other-bot[bot]' }, state: 'APPROVED', body: '**PASS**' },
        { author: { login: 'chatgpt-codex-connector' }, state: 'APPROVED', body: 'VERDICT: PASS' }, // missing [bot] suffix
      ];
      const parsed = parseReviews(impostorReviews, []);
      assert.strictEqual(parsed.trustedCodexVerdict, 'PENDING');
    });

    test('unauthenticated GitHub context returns empty PRs and does not fabricate data', () => {
      // Direct verification of parsing empty/missing records
      const parsed = parseChecks(null);
      assert.strictEqual(parsed.summary, 'NO_CHECKS');
      assert.strictEqual(parsed.totalCount, 0);
    });
  });

  describe('AI15-AC05 & AI15-AC06: Multi-Source State Derivation & Conflict Detection', () => {
    test('detects branch mismatch conflict between Register and Git', () => {
      const reg = {
        activeItem: { work_item_id: 'TASK-AI-15', branch: 'feat/task-ai-15-realtime-ai-cockpit' },
      };
      const git = { currentBranch: 'feat/different-branch' };
      const conflicts = detectConflicts(reg, git, { sessions: [] }, { pullRequests: [] });

      assert.strictEqual(conflicts.length, 1);
      assert.strictEqual(conflicts[0].id, 'CONFLICT_BRANCH_MISMATCH');
      assert.strictEqual(conflicts[0].severity, 'warning');
    });

    test('detects uncommitted changes on branch during review state', () => {
      const reg = {
        activeItem: {
          work_item_id: 'TASK-AI-15',
          status: 'READY_FOR_CODEX',
          branch: 'feat/task-ai-15',
        },
      };
      const git = { currentBranch: 'feat/task-ai-15', dirtyCount: 3 };
      const conflicts = detectConflicts(reg, git, { sessions: [] }, { pullRequests: [] });

      const dirtyConflict = conflicts.find((c) => c.id === 'CONFLICT_DIRTY_WORKTREE_IN_REVIEW');
      assert.ok(dirtyConflict, 'Expected dirty worktree conflict');
      assert.strictEqual(dirtyConflict.severity, 'error');
    });

    test('derives overallStatus: partial when one source is unavailable', () => {
      const sources = {
        register: { status: 'live' },
        git: { status: 'live' },
        ao: { status: 'unavailable' },
        github: { status: 'live' },
      };
      assert.strictEqual(deriveOverallStatus(sources, []), 'partial');
    });

    test('derives overallStatus: conflict when error conflict exists', () => {
      const sources = {
        register: { status: 'live' },
        git: { status: 'live' },
        ao: { status: 'live' },
        github: { status: 'live' },
      };
      const conflicts = [{ severity: 'error', title: 'Fatal mismatch' }];
      assert.strictEqual(deriveOverallStatus(sources, conflicts), 'conflict');
    });

    test('builds chronological activity stream from commits and AO events', () => {
      const commits = [
        { hashShort: 'c1', message: 'Commit 1', date: '2026-09-13T10:00:00Z', authorName: 'Dev' },
        { hashShort: 'c2', message: 'Commit 2', date: '2026-09-13T12:00:00Z', authorName: 'Dev' },
      ];
      const sessions = [
        {
          id: 's1',
          displayRole: 'Author',
          status: 'WORKING',
          harness: 'agy',
          updatedAt: '2026-09-13T11:00:00Z',
        },
      ];

      const stream = buildActivityStream(commits, sessions);
      assert.strictEqual(stream.length, 3);
      assert.strictEqual(stream[0].id, 'commit-c2'); // 12:00
      assert.strictEqual(stream[1].id, 'ao-s1'); // 11:00
      assert.strictEqual(stream[2].id, 'commit-c1'); // 10:00
    });
  });

  describe('AI15-AC07: Security, Redaction & Loopback Binding', () => {
    test('redacts secret tokens and sensitive environment values', () => {
      const input = 'Error with token gho_1234567890abcdef123456 and sk-secretkey1234567890123456';
      const cleaned = redactSensitive(input);
      assert.strictEqual(cleaned.includes('gho_'), false);
      assert.strictEqual(cleaned.includes('sk-'), false);
      assert.ok(cleaned.includes('[REDACTED_SECRET]'));
    });

    test('QA regression: never corrupts legitimate branch names containing "sk-" mid-word', () => {
      // "task-ai-15-..." contains the literal substring "sk-ai-15-..." —
      // without a token boundary this was misidentified as a secret and the
      // branch name shown at runtime was corrupted to "feat/ta[REDACTED_SECRET]".
      const branch = 'feat/task-ai-15-realtime-ai-cockpit';
      assert.strictEqual(redactSensitive(branch), branch);
      assert.strictEqual(redactSensitive(`Nhánh làm việc: ${branch}`).includes(branch), true);
    });

    test('QA regression: still redacts a real sk-* secret token', () => {
      const withRealSecret = 'leaked key sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const cleaned = redactSensitive(withRealSecret);
      assert.strictEqual(cleaned.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ'), false);
      assert.ok(cleaned.includes('[REDACTED_SECRET]'));
    });

    test('redacts user home path segments', () => {
      const winPath = 'C:\\Users\\gumac\\AI\\shipde-platform\\secret.txt';
      const cleaned = redactPath(winPath);
      assert.strictEqual(cleaned.includes('gumac'), false);
      assert.strictEqual(cleaned.startsWith('~/'), true);
    });

    test('redacts nested object fields', () => {
      const obj = {
        apiKey: 'sk-12345678901234567890',
        userPath: 'C:\\Users\\gumac\\secret',
        nested: {
          token: 'ghp_1234567890abcdefghij',
          safe: 'hello',
        },
      };
      const redacted = redactObject(obj);
      assert.strictEqual(redacted.apiKey, '[REDACTED_CONFIDENTIAL]');
      assert.strictEqual(redacted.nested.token, '[REDACTED_CONFIDENTIAL]');
      assert.strictEqual(redacted.nested.safe, 'hello');
      assert.strictEqual(redacted.userPath.includes('gumac'), false);
    });

    test('detects path traversal attempts', () => {
      const allowedRoots = [path.resolve(__dirname, '..')];
      assert.strictEqual(isPathTraversal('/../package.json', allowedRoots), true);
      assert.strictEqual(isPathTraversal('/%2e%2e/secret', allowedRoots), true);
      assert.strictEqual(isPathTraversal('/client.js', allowedRoots), false);
    });
  });

  describe('AI15-AC04, AC07, AC10: Server Integration & SSE Stream', () => {
    let server = null;
    let testPort = 0;
    const testHost = '127.0.0.1';

    before(async () => {
      resetRevisionForTest(1);
      server = createDashboardServer({
        rootDir: path.resolve(__dirname, '../../../'),
        disablePolling: true, // Disable background interval during tests
      });

      await new Promise((resolve) => {
        // Port 0 binds to ephemeral free port
        server.listen(0, testHost, () => {
          testPort = server.address().port;
          resolve();
        });
      });
    });

    after(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    test('binds strictly to loopback 127.0.0.1 (AI15-R05)', () => {
      const addr = server.address();
      assert.strictEqual(addr.address, '127.0.0.1');
      assert.ok(addr.port > 0);
    });

    test('rejects unsafe mutation methods with 405 Method Not Allowed (AI15-R05, AI15-R09)', async () => {
      const postRes = await makeRequest(testHost, testPort, '/api/state', 'POST');
      assert.strictEqual(postRes.statusCode, 405);
      assert.strictEqual(postRes.headers['allow'], 'GET, HEAD, OPTIONS');

      const deleteRes = await makeRequest(testHost, testPort, '/api/tasks', 'DELETE');
      assert.strictEqual(deleteRes.statusCode, 405);
    });

    test('rejects path traversal requests with 403 Forbidden', async () => {
      const res = await makeRequest(testHost, testPort, '/../package.json', 'GET');
      assert.strictEqual(res.statusCode, 403);
    });

    test('denies repository files outside the dashboard asset allowlist (AI15-R05)', async () => {
      const res = await makeRequest(testHost, testPort, '/AGENTS.md', 'GET');
      assert.strictEqual(res.statusCode, 404);
    });

    test('denies dotfiles such as .env even when directly requested (AI15-R05)', async () => {
      const res = await makeRequest(testHost, testPort, '/.env', 'GET');
      assert.strictEqual(res.statusCode, 404);
    });

    test('returns 400 without crashing on a malformed request URL', async () => {
      const res = await makeRequest(testHost, testPort, '/%E0%A4%A', 'GET'); // truncated percent-encoding
      assert.strictEqual(res.statusCode, 400);

      // The server must still be responsive for the next request (no crash).
      const followUp = await makeRequest(testHost, testPort, '/api/health', 'GET');
      assert.strictEqual(followUp.statusCode, 200);
    });

    test('HEAD requests receive headers without a response body', async () => {
      const res = await makeRequest(testHost, testPort, '/api/state', 'HEAD');
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body, '');
      assert.ok(Number(res.headers['content-length']) > 0);
    });

    test('never emits a wildcard Access-Control-Allow-Origin header', async () => {
      const res = await makeRequest(testHost, testPort, '/api/health', 'GET');
      assert.notStrictEqual(res.headers['access-control-allow-origin'], '*');
    });

    test('refuses the null origin, which any sandboxed iframe can send', async () => {
      // "null" is not private to file:// pages. A sandboxed iframe on any site
      // the operator visits sends it too, so allowing it would let that site
      // read this service off loopback.
      const res = await makeRequest(testHost, testPort, '/api/state', 'GET', {
        Origin: 'null',
      });
      assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
    });

    test('refuses an unrelated origin', async () => {
      const res = await makeRequest(testHost, testPort, '/api/state', 'GET', {
        Origin: 'https://evil.example',
      });
      assert.strictEqual(res.headers['access-control-allow-origin'], undefined);
    });

    test('allows the service its own origin, and varies on Origin either way', async () => {
      const selfOrigin = `http://${testHost}:${testPort}`;
      const allowed = await makeRequest(testHost, testPort, '/api/state', 'GET', {
        Origin: selfOrigin,
      });
      assert.strictEqual(allowed.headers['access-control-allow-origin'], selfOrigin);
      assert.strictEqual(allowed.headers['vary'], 'Origin');

      // Vary must be present even when the header is withheld, or a cache
      // could hand an allowed response to a disallowed origin.
      const refused = await makeRequest(testHost, testPort, '/api/state', 'GET', {
        Origin: 'null',
      });
      assert.strictEqual(refused.headers['vary'], 'Origin');
    });

    test('sends CSP, nosniff, no-store and referrer-policy headers on every response', async () => {
      const res = await makeRequest(testHost, testPort, '/api/health', 'GET');
      assert.ok(res.headers['content-security-policy']);
      assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(res.headers['cache-control'], 'no-store');
      assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
    });

    test('serves /api/health with explicit application/json header', async () => {
      const res = await makeRequest(testHost, testPort, '/api/health', 'GET');
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers['content-type'].includes('application/json'));
      const body = JSON.parse(res.body);
      assert.strictEqual(body.schemaVersion, '3.3.0');
      assert.ok(body.status);
    });

    test('serves /api/state with versioned aggregated payload', async () => {
      const res = await makeRequest(testHost, testPort, '/api/state', 'GET');
      assert.strictEqual(res.statusCode, 200);
      const state = JSON.parse(res.body);
      assert.strictEqual(state.schemaVersion, '3.3.0');
      assert.ok(state.revision >= 1);
      assert.ok(state.workItems);
      assert.ok(state.sources);
    });

    test('serves Server-Sent Events stream at /api/events with revision ID (AI15-AC04, AC10)', async () => {
      const sseRes = await new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: testHost,
            port: testPort,
            path: '/api/events',
            method: 'GET',
          },
          (res) => {
            let chunks = '';
            res.on('data', (chunk) => {
              chunks += chunk.toString();
              // Once initial event is received, close and resolve
              if (chunks.includes('event: state')) {
                req.destroy();
                resolve({
                  statusCode: res.statusCode,
                  headers: res.headers,
                  data: chunks,
                });
              }
            });
          }
        );
        req.on('error', (err) => {
          // req.destroy() causes error on client side, ignore if resolved
          if (!err.message.includes('socket hang up')) reject(err);
        });
        req.end();
      });

      assert.strictEqual(sseRes.statusCode, 200);
      assert.ok(sseRes.headers['content-type'].includes('text/event-stream'));
      assert.ok(sseRes.data.includes('id:'));
      assert.ok(sseRes.data.includes('event: state'));
      assert.ok(sseRes.data.includes('schemaVersion'));
    });
  });

  describe('AI15-AC08 & AI15-AC09: Accessibility & Empty States', () => {
    test('UI HTML includes semantic landmarks, ARIA live region, and reduced motion', () => {
      const fs = require('fs');
      const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');

      assert.ok(html.includes('<header'));
      assert.ok(html.includes('<main'));
      assert.ok(html.includes('<nav'));
      assert.ok(html.includes('<footer'));
      assert.ok(html.includes('role="status"'));
      assert.ok(html.includes('aria-live="polite"'));
      assert.ok(html.includes('prefers-reduced-motion'));
      assert.ok(html.includes('focus-visible'));
    });

    test('handles completely empty items list truthfully without throwing', () => {
      const derived = deriveRegisterState([]);
      assert.strictEqual(derived.total, 0);
      assert.strictEqual(derived.mergedCount, 0);
      assert.strictEqual(derived.completionPercent, '0.0');
      assert.strictEqual(derived.activeItem, null);
      assert.strictEqual(derived.gatePipeline.currentGate, 'IDLE');
    });
  });

  describe('AI15-R01/R04: No hardcoded task counts or writer assertions', () => {
    const fs = require('fs');

    test('index.html, rendered.html and template.html never hardcode the task count "150"', () => {
      for (const file of ['../index.html', '../rendered.html', '../template.html']) {
        const html = fs.readFileSync(path.resolve(__dirname, file), 'utf-8');
        assert.strictEqual(/\b150\b/.test(html), false, `${file} must not hardcode a task count`);
      }
    });

    test('markup exposes dynamic task-count elements instead of literal numbers', () => {
      const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');
      assert.ok(html.includes('id="heroTaskCount"'));
      assert.ok(html.includes('id="tabQueueCountLabel"'));
      assert.ok(html.includes('id="statTotal"'));
    });

    test('markup never asserts a static "1 Writer Active" state', () => {
      const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');
      assert.strictEqual(html.includes('>1 Writer Active<'), false);
      assert.ok(html.includes('id="writerStateLabel"'));
      assert.ok(html.includes('id="writerCountValue"'));
    });

    test('QA regression: role copy matches AGENTS.md — Gemini primary, Claude secondary/analyst fallback, 9Router constrained fallback', () => {
      for (const file of ['../index.html', '../rendered.html', '../template.html']) {
        const html = fs.readFileSync(path.resolve(__dirname, file), 'utf-8');

        // Gemini must be present and named as the primary author — it must
        // never be omitted, and Claude must never be labeled primary/chính.
        // The wildcard excludes '<', '>' and '"' so the check cannot bridge
        // across an HTML tag/attribute boundary into unrelated text.
        assert.ok(html.includes('Gemini'), `${file} must name Gemini as an author role`);
        assert.strictEqual(
          /Gemini[^<>"]*ch[ií]nh/i.test(html),
          true,
          `${file} must label Gemini (not Claude) as the primary/"chính" author`
        );
        assert.strictEqual(
          /Claude[^<>"]*ch[ií]nh/i.test(html),
          false,
          `${file} must never label Claude as primary/"chính"`
        );
        assert.ok(html.includes('9Router'), `${file} must mention the 9Router fallback role`);
      }
    });

    test('QA regression: mobile-safe structural classes prevent horizontal page overflow at 390px', () => {
      for (const file of ['../index.html', '../rendered.html', '../template.html']) {
        const html = fs.readFileSync(path.resolve(__dirname, file), 'utf-8');

        // Page-level safety net: html/body must never grow a horizontal
        // scrollbar, regardless of any residual child sizing quirk.
        assert.ok(
          /html\s*\{[^}]*overflow-x:\s*hidden/i.test(html),
          `${file}: <html> must set overflow-x: hidden`
        );
        assert.ok(
          /body\s*\{[^}]*overflow-x:\s*hidden/i.test(html),
          `${file}: body CSS must set overflow-x: hidden`
        );
        assert.ok(
          html.includes('overflow-x-hidden'),
          `${file}: <body> must carry the overflow-x-hidden utility class`
        );

        // Root cause fix: the hero's flex row and its two children (heading
        // block + topStats grid) — plus header and main — must all be able
        // to shrink below their content's intrinsic width (min-width:auto
        // is the classic flexbox/grid overflow trap this bug hit).
        assert.ok(
          /id="topStats"[^>]*class="[^"]*min-w-0/.test(html) ||
            /class="[^"]*min-w-0[^"]*"[^>]*id="topStats"/.test(html),
          `${file}: #topStats must carry min-w-0`
        );
        const minW0Count = (html.match(/min-w-0/g) || []).length;
        assert.ok(
          minW0Count >= 8,
          `${file}: expected header/main/hero/stat-card containers to carry min-w-0 (found ${minW0Count})`
        );

        // Wrapping/breaking so long headings/labels reflow instead of
        // forcing width.
        assert.ok(html.includes('break-words'), `${file}: hero text must allow word breaking`);
      }
    });

    test('QA regression: intentional horizontal-scroll regions (tab nav, tables) are preserved', () => {
      const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');
      const overflowXAutoCount = (html.match(/overflow-x-auto/g) || []).length;
      // Tab nav + 2 table wrappers (roster tab table, queue tab table).
      assert.ok(
        overflowXAutoCount >= 3,
        `expected at least 3 intentional overflow-x-auto regions, found ${overflowXAutoCount}`
      );
      assert.ok(
        /<nav[^>]*overflow-x-auto/.test(html),
        'tab nav must keep its own horizontal scroll'
      );
    });

    test('deriveWriterState reports UNAVAILABLE honestly when AO is not live, never asserting an active writer', () => {
      const result = deriveWriterState({
        sources: { ao: { status: 'unavailable' } },
        sessions: [{ isWriter: true, isTerminated: false }],
      });
      assert.strictEqual(result.level, 'unavailable');
      assert.strictEqual(result.countLabel, 'Không có');
    });

    test('deriveWriterState reflects zero, one, and multiple real writer sessions from AO data', () => {
      const live = { status: 'live' };
      assert.strictEqual(deriveWriterState({ sources: { ao: live }, sessions: [] }).level, 'idle');
      assert.strictEqual(
        deriveWriterState({
          sources: { ao: live },
          sessions: [{ isWriter: false }, { isWriter: true, isTerminated: false }],
        }).level,
        'single'
      );
      assert.strictEqual(
        deriveWriterState({
          sources: { ao: live },
          sessions: [
            { isWriter: true, isTerminated: false },
            { isWriter: true, isTerminated: false },
          ],
        }).level,
        'conflict'
      );
      // Terminated writer sessions must not count as currently active.
      assert.strictEqual(
        deriveWriterState({
          sources: { ao: live },
          sessions: [{ isWriter: true, isTerminated: true }],
        }).level,
        'idle'
      );
    });

    test('gate pipeline renders EVIDENCE_UNAVAILABLE as a clear, non-PASS label', () => {
      assert.match(GATE_STAGE_LABELS.EVIDENCE_UNAVAILABLE, /CHỜ BẰNG CHỨNG/);
      assert.notStrictEqual(GATE_STAGE_LABELS.EVIDENCE_UNAVAILABLE, 'PASSED');
    });
  });

  describe('QA fix: Assigned author parsed from the Work Item markdown, never inferred', () => {
    before(() => resetWorkItemAuthorCacheForTest());
    after(() => resetWorkItemAuthorCacheForTest());

    const repoRoot = path.resolve(__dirname, '../../../');

    test('parses the explicit `| Assigned author | `GEMINI` |` row from TASK-AI-15.md', () => {
      const author = resolveAssignedAuthorFromWorkItem(
        'docs/product-spec/work-items/TASK-AI-15.md',
        repoRoot
      );
      assert.strictEqual(author, 'GEMINI');
    });

    test('returns null (never a guess) for a missing Work Item file', () => {
      const author = resolveAssignedAuthorFromWorkItem(
        'docs/product-spec/work-items/DOES-NOT-EXIST-999.md',
        repoRoot
      );
      assert.strictEqual(author, null);
    });

    test('rejects a work_item_path that escapes rootDir (safe bounded file reading)', () => {
      const author = resolveAssignedAuthorFromWorkItem('../../../../../../etc/passwd', repoRoot);
      assert.strictEqual(author, null);
    });

    test('rejects a missing/empty/non-string work_item_path or rootDir without throwing', () => {
      assert.strictEqual(resolveAssignedAuthorFromWorkItem('', repoRoot), null);
      assert.strictEqual(resolveAssignedAuthorFromWorkItem(null, repoRoot), null);
      assert.strictEqual(
        resolveAssignedAuthorFromWorkItem('docs/product-spec/work-items/TASK-AI-15.md', null),
        null
      );
    });

    test('deriveAuthor uses the Work Item document only when no explicit CSV assigned_author is present, and never infers from the ID', () => {
      const item = {
        work_item_id: 'TASK-AI-15',
        work_item_path: 'docs/product-spec/work-items/TASK-AI-15.md',
      };
      assert.strictEqual(deriveAuthor(item, repoRoot), 'GEMINI');

      // Explicit CSV assigned_author still wins over the document.
      const overridden = {
        work_item_id: 'TASK-AI-15',
        work_item_path: 'docs/product-spec/work-items/TASK-AI-15.md',
        assigned_author: 'HUMAN',
      };
      assert.strictEqual(deriveAuthor(overridden, repoRoot), 'HUMAN');

      // No rootDir and no CSV field: honestly UNKNOWN, never an ID guess.
      assert.strictEqual(
        deriveAuthor({
          work_item_id: 'TASK-AI-15',
          work_item_path: 'docs/product-spec/work-items/TASK-AI-15.md',
        }),
        'UNKNOWN'
      );
    });

    test('loadRegister resolves TASK-AI-15 to GEMINI from the live register + work item doc', () => {
      const csvPath = path.join(
        repoRoot,
        'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'
      );
      const res = loadRegister(csvPath, null, repoRoot);
      const item = res.data.items.find((it) => it.work_item_id === 'TASK-AI-15');
      assert.ok(item, 'TASK-AI-15 must be present in the register');
      assert.strictEqual(item.assigned_author, 'GEMINI');
    });
  });

  describe('QA fix: GitHub error detail is sanitized to a safe, stable reason', () => {
    test('never echoes raw multiline command output or account/user identifiers', () => {
      const raw = [
        'github.com',
        '  X Failed to log in to github.com account octocat-user (keyring)',
        '  - Active account: true',
        '  - Token: gho_1234567890abcdefghijklmno',
        "  - Token scopes: 'gist', 'read:org', 'repo'",
      ].join('\n');

      const reason = safeGitHubErrorReason(raw, 'gh auth status failed');
      assert.strictEqual(reason.includes('octocat-user'), false);
      assert.strictEqual(reason.includes('gho_'), false);
      assert.strictEqual(reason.includes('\n'), false);
      assert.strictEqual(typeof reason, 'string');
    });

    test('maps common gh failure modes to fixed, stable reasons', () => {
      assert.strictEqual(
        safeGitHubErrorReason(
          'You are not logged into any GitHub hosts. Run gh auth login to authenticate.'
        ),
        'GitHub CLI unauthenticated (run gh auth login)'
      );
      assert.strictEqual(
        safeGitHubErrorReason("'gh' is not recognized as an internal or external command"),
        'GitHub CLI (gh) not found or not on PATH'
      );
      assert.strictEqual(
        safeGitHubErrorReason('API rate limit exceeded for user'),
        'GitHub API rate limit reached'
      );
    });

    test('falls back to a fixed safe reason for unrecognized or missing raw text', () => {
      assert.strictEqual(
        safeGitHubErrorReason(undefined, 'gh auth status failed'),
        'gh auth status failed'
      );
      assert.strictEqual(
        safeGitHubErrorReason('some unexpected internal detail'),
        'GitHub CLI command failed'
      );
    });
  });

  describe('Codex Review Findings Regression Suite (TASK-AI-15 Repair)', () => {
    test('Finding 1: parseChecks treats CANCELLED, STARTUP_FAILURE, ACTION_REQUIRED as failed', () => {
      const cancelled = parseChecks([
        { name: 'test', status: 'COMPLETED', conclusion: 'CANCELLED' },
      ]);
      assert.strictEqual(cancelled.summary, 'FAILED');
      assert.strictEqual(cancelled.failCount, 1);

      const startup = parseChecks([
        { name: 'build', status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' },
      ]);
      assert.strictEqual(startup.summary, 'FAILED');
      assert.strictEqual(startup.failCount, 1);

      const action = parseChecks([
        { name: 'gate', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' },
      ]);
      assert.strictEqual(action.summary, 'FAILED');
      assert.strictEqual(action.failCount, 1);
    });

    test('Finding 1: parseReviews ties Codex verdict to exact commit SHA and flags older review as STALE_REVIEW', () => {
      const oldReviews = [
        {
          author: { login: TRUSTED_CODEX_LOGIN },
          state: 'APPROVED',
          commitId: 'oldsha1234567890123456789012345678901234',
          body: 'VERDICT: PASS',
        },
      ];
      const parsedOld = parseReviews(oldReviews, [], 'newshaabcdef123456789012345678901234567890');
      assert.strictEqual(parsedOld.trustedCodexVerdict, 'STALE_REVIEW');
      assert.strictEqual(parsedOld.headShaMatches, false);

      const matchingReviews = [
        {
          author: { login: TRUSTED_CODEX_LOGIN },
          state: 'APPROVED',
          commitId: 'matchingsha123456789012345678901234567890',
          body: 'VERDICT: PASS',
        },
      ];
      const parsedMatch = parseReviews(
        matchingReviews,
        [],
        'matchingsha123456789012345678901234567890'
      );
      assert.strictEqual(parsedMatch.trustedCodexVerdict, 'PASS');
      assert.strictEqual(parsedMatch.headShaMatches, true);
    });

    test('Finding 1: parseReviews never defaults unresolvedThreadsCount to 0', () => {
      const reviews = [
        { author: { login: TRUSTED_CODEX_LOGIN }, state: 'APPROVED', body: 'VERDICT: PASS' },
      ];
      const parsed = parseReviews(reviews, []);
      assert.strictEqual(parsed.unresolvedThreadsCount, null);
      assert.strictEqual(parsed.unresolvedThreadsStatus, 'UNVERIFIED');
    });

    test('Finding 1: deriveGatePipeline blocks merge gate when mergeability or unresolved threads fail preflight', () => {
      const activeItem = { work_item_id: 'T9', status: 'READY_FOR_CODEX', branch: 'feat/t9' };

      // Case A: mergeable is false (e.g. CONFLICTING)
      const conflictingEvidence = {
        available: true,
        headMatches: true,
        ciPassed: true,
        codexPass: true,
        mergeable: false,
      };
      const resA = deriveGatePipeline(activeItem, conflictingEvidence);
      assert.strictEqual(resA.currentGate, 'PREFLIGHT_PENDING');
      assert.strictEqual(resA.gates.find((g) => g.name === 'HUMAN_MERGE').status, 'PENDING');

      // Case B: unresolved threads not verified
      const unverifiedThreads = {
        available: true,
        headMatches: true,
        ciPassed: true,
        codexPass: true,
        unresolvedThreadsVerified: false,
      };
      const resB = deriveGatePipeline(activeItem, unverifiedThreads);
      assert.strictEqual(resB.currentGate, 'PREFLIGHT_PENDING');
      assert.strictEqual(resB.gates.find((g) => g.name === 'HUMAN_MERGE').status, 'PENDING');

      // Case C: all preflight passes
      const preflightPassed = {
        available: true,
        headMatches: true,
        ciPassed: true,
        codexPass: true,
        mergeable: true,
        unresolvedThreadsVerified: true,
        readyForMerge: true,
      };
      const resC = deriveGatePipeline(activeItem, preflightPassed);
      assert.strictEqual(resC.currentGate, 'HUMAN_MERGE');
      assert.strictEqual(resC.gates.find((g) => g.name === 'HUMAN_MERGE').status, 'READY');
    });

    test('Finding 2: AO role classification authorizes Claude on repair and keeps unknown feat branches read-only', () => {
      // Claude on fix branch is author/repair writer
      const claudeFix = classifySessionRole({
        harness: 'claude-code',
        branch: 'fix/task-ai-15-repair',
        role: 'worker',
      });
      assert.strictEqual(claudeFix.category, 'REPAIR_AUTHOR');
      assert.strictEqual(claudeFix.isWriter, true);

      // Claude on idle/analysis session is read-only
      const claudeIdle = classifySessionRole({
        harness: 'claude-code',
        branch: 'analysis/s01',
        role: 'analyst',
      });
      assert.strictEqual(claudeIdle.category, 'ANALYST');
      assert.strictEqual(claudeIdle.isWriter, false);

      // Unknown harness on feat/ branch is NOT a writer
      const unknownFeat = classifySessionRole({
        harness: 'custom-tool',
        branch: 'feat/dangerous-feature',
        role: 'worker',
      });
      assert.strictEqual(unknownFeat.category, 'WORKER');
      assert.strictEqual(unknownFeat.isWriter, false);

      // DSH is CONSTRAINED_AUTHOR, not primary author
      const dshSession = classifySessionRole({
        harness: 'dsh',
        branch: 'feat/fixtures',
        role: 'worker',
      });
      assert.strictEqual(dshSession.category, 'CONSTRAINED_AUTHOR');
      assert.strictEqual(dshSession.isWriter, true);
    });

    test('Finding 3: start-ai-dashboard.ps1 resolves repo root by traversing two directory levels', () => {
      const fs = require('fs');
      const scriptContent = fs.readFileSync(
        path.resolve(__dirname, '../../../scripts/ai/start-ai-dashboard.ps1'),
        'utf-8'
      );
      assert.ok(
        scriptContent.includes('$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)'),
        'start-ai-dashboard.ps1 must compute repo root by traversing two parent levels'
      );
      assert.strictEqual(scriptContent.includes('150'), false, 'must not hardcode 150 task count');
    });

    test('Finding 4: deriveOverallStatus evaluates freshness rather than raw collection status', () => {
      const sourcesStale = {
        register: { status: 'live', freshness: 'live' },
        git: { status: 'live', freshness: 'stale' }, // collection says live, but age makes freshness stale
        ao: { status: 'live', freshness: 'live' },
        github: { status: 'live', freshness: 'live' },
      };
      assert.strictEqual(deriveOverallStatus(sourcesStale, []), 'stale');

      const sourcesUnavailable = {
        register: { status: 'live', freshness: 'live' },
        git: { status: 'live', freshness: 'unavailable' },
        ao: { status: 'live', freshness: 'live' },
        github: { status: 'live', freshness: 'live' },
      };
      assert.strictEqual(deriveOverallStatus(sourcesUnavailable, []), 'partial');
    });

    test('Finding 4: aggregateCockpitState caches last-known state as stale on adapter failure (AI15-R01)', async () => {
      resetRevisionForTest(1);
      const mockHealth = (name, status) => ({
        name,
        status,
        observedAt: new Date().toISOString(),
        latencyMs: 5,
        provenance: 'test',
        impact: 'None',
        error: null,
      });

      // Pass 1: Successful git observation
      const state1 = await aggregateCockpitState({
        mockGit: {
          health: mockHealth('git', 'live'),
          data: { currentBranch: 'feat/test-branch', headOid: 'sha1', recentCommits: [] },
        },
        mockAo: {
          health: mockHealth('ao', 'live'),
          data: { daemon: { ready: true, state: 'ready' }, sessions: [] },
        },
        mockGitHub: {
          health: mockHealth('github', 'live'),
          data: { authenticated: true, pullRequests: [] },
        },
        mockRegister: {
          health: mockHealth('register', 'live'),
          data: {
            total: 10,
            mergedCount: 5,
            completionPercent: '50.0',
            byStatus: {},
            bySlice: {},
            activeItem: null,
            gatePipeline: { currentGate: 'IDLE', gates: [] },
            items: [],
          },
        },
      });
      assert.strictEqual(state1.git.currentBranch, 'feat/test-branch');

      // Pass 2: Git adapter query temporarily fails / unavailable
      const state2 = await aggregateCockpitState({
        mockGit: {
          health: mockHealth('git', 'unavailable'),
          data: { currentBranch: null, headOid: '', recentCommits: [] },
        },
        mockAo: {
          health: mockHealth('ao', 'live'),
          data: { daemon: { ready: true, state: 'ready' }, sessions: [] },
        },
        mockGitHub: {
          health: mockHealth('github', 'live'),
          data: { authenticated: true, pullRequests: [] },
        },
        mockRegister: {
          health: mockHealth('register', 'live'),
          data: {
            total: 10,
            mergedCount: 5,
            completionPercent: '50.0',
            byStatus: {},
            bySlice: {},
            activeItem: null,
            gatePipeline: { currentGate: 'IDLE', gates: [] },
            items: [],
          },
        },
      });

      // Data must NOT be blanked out; must retain last-known data labeled stale
      assert.strictEqual(state2.sources.git.status, 'stale');
      assert.strictEqual(state2.git.currentBranch, 'feat/test-branch');
    });

    test('Finding 5: SSE revision deduping and recovery transition activity', async () => {
      resetRevisionForTest(1);
      const mockHealth = (name, status) => ({
        name,
        status,
        observedAt: new Date().toISOString(),
        latencyMs: 5,
        provenance: 'test',
        impact: 'None',
        error: null,
      });

      // Pass 1: Initial state (ao unavailable)
      const state1 = await aggregateCockpitState({
        mockGit: {
          health: mockHealth('git', 'live'),
          data: { currentBranch: 'main', headOid: 'sha1', recentCommits: [] },
        },
        mockAo: {
          health: mockHealth('ao', 'unavailable'),
          data: { daemon: { ready: false }, sessions: [] },
        },
        mockGitHub: {
          health: mockHealth('github', 'live'),
          data: { authenticated: true, pullRequests: [] },
        },
        mockRegister: {
          health: mockHealth('register', 'live'),
          data: {
            total: 1,
            mergedCount: 0,
            completionPercent: '0.0',
            byStatus: {},
            bySlice: {},
            activeItem: null,
            gatePipeline: { currentGate: 'IDLE', gates: [] },
            items: [],
          },
        },
      });
      const rev1 = state1.revision;

      // Pass 2: AO recovers to live -> should generate recovery activity item
      const state2 = await aggregateCockpitState({
        mockGit: {
          health: mockHealth('git', 'live'),
          data: { currentBranch: 'main', headOid: 'sha1', recentCommits: [] },
        },
        mockAo: {
          health: mockHealth('ao', 'live'),
          data: { daemon: { ready: true, state: 'ready' }, sessions: [] },
        },
        mockGitHub: {
          health: mockHealth('github', 'live'),
          data: { authenticated: true, pullRequests: [] },
        },
        mockRegister: {
          health: mockHealth('register', 'live'),
          data: {
            total: 1,
            mergedCount: 0,
            completionPercent: '0.0',
            byStatus: {},
            bySlice: {},
            activeItem: null,
            gatePipeline: { currentGate: 'IDLE', gates: [] },
            items: [],
          },
        },
      });

      const recoveryAct = state2.activity.find((a) => a.type === 'SOURCE_RECOVERY');
      assert.ok(recoveryAct, 'Expected a SOURCE_RECOVERY activity record upon AO recovery');
      assert.ok(recoveryAct.title.includes('AO'));
      assert.strictEqual(state2.revision > rev1, true);

      // Pass 3: Identical state again -> revision must NOT increment
      const state3 = await aggregateCockpitState({
        mockGit: {
          health: mockHealth('git', 'live'),
          data: { currentBranch: 'main', headOid: 'sha1', recentCommits: [] },
        },
        mockAo: {
          health: mockHealth('ao', 'live'),
          data: { daemon: { ready: true, state: 'ready' }, sessions: [] },
        },
        mockGitHub: {
          health: mockHealth('github', 'live'),
          data: { authenticated: true, pullRequests: [] },
        },
        mockRegister: {
          health: mockHealth('register', 'live'),
          data: {
            total: 1,
            mergedCount: 0,
            completionPercent: '0.0',
            byStatus: {},
            bySlice: {},
            activeItem: null,
            gatePipeline: { currentGate: 'IDLE', gates: [] },
            items: [],
          },
        },
      });
      assert.strictEqual(state3.revision, state2.revision);
    });

    test('Finding 6: static dashboard snapshot reports overallStatus: partial when offline', () => {
      const fs = require('fs');
      const repoRoot = path.resolve(__dirname, '../../../');
      const testOut = path.join(__dirname, 'test-static-dashboard.html');
      const outPath = renderStaticDashboard(repoRoot, { port: 4444, outputPath: testOut });
      assert.ok(fs.existsSync(outPath));

      const content = fs.readFileSync(outPath, 'utf-8');
      assert.ok(
        content.includes('"overallStatus":"partial"'),
        'Static snapshot must report partial overallStatus'
      );
      assert.ok(
        content.includes('http://127.0.0.1:4444'),
        'Static renderer must respect configured port'
      );
      try {
        fs.unlinkSync(testOut);
      } catch {}
    });

    test('Finding 8: index.html defines responsive-table CSS rules and data-label attributes', () => {
      const fs = require('fs');
      const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf-8');
      assert.ok(
        html.includes('.responsive-table'),
        'index.html must include .responsive-table class'
      );
      assert.ok(
        html.includes('@media (max-width: 640px)'),
        'index.html must include 640px breakpoint rule'
      );
      assert.ok(
        html.includes('attr(data-label)'),
        'index.html must use attr(data-label) for labeled stacked rows'
      );

      const clientCode = fs.readFileSync(path.resolve(__dirname, '../client.js'), 'utf-8');
      assert.ok(
        clientCode.includes('data-label="Session ID"'),
        'client.js renderSessions must set data-label'
      );
      assert.ok(
        clientCode.includes('data-label="Mã Task"'),
        'client.js renderQueueTable must set data-label'
      );
      assert.strictEqual(
        clientCode.includes("active.assigned_author || 'GEMINI'"),
        false,
        'client.js must not default missing author to GEMINI'
      );
    });
  });
});

function makeRequest(host, port, path, method, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk.toString()));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
