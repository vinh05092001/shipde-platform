'use strict';

/**
 * Ship Dễ — TASK-AI-87 contract tests:
 * Evidence-only candidates carry their bound account's declared capabilities.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const candidatesApi = require('../candidates');
const orchestrate = require('../orchestrate');
const routing = require('../routing');
const evidence = require('../evidence');
const { assembleForDispatch } = require('../cli');

const NOW = Date.parse('2026-10-05T00:00:00.000Z');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const FIXTURE_EVIDENCE = path.join(__dirname, 'fixtures', 'task-ai-87', 'evidence.json');
const FIXTURE_ACCOUNTS = path.join(__dirname, 'fixtures', 'task-ai-87', 'accounts.json');

describe('TASK-AI-87: Evidence-only candidate capabilities', () => {
  let tempRoot, evidenceDir, decisionDir;
  let testEvidenceData;
  let accountsList;

  beforeEach(() => {
    tempRoot = tmpDir('task-ai-87-');
    evidenceDir = path.join(tempRoot, 'evidence');
    decisionDir = path.join(tempRoot, 'decisions');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(decisionDir, { recursive: true });

    testEvidenceData = JSON.parse(fs.readFileSync(FIXTURE_EVIDENCE, 'utf8'));
    accountsList = JSON.parse(fs.readFileSync(FIXTURE_ACCOUNTS, 'utf8'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  });

  // C-R01: candidatesFromEvidence(evidenceData, {accounts}) sets capabilities from the account
  // whose id equals the combo accountId (declared capabilities only); combo.capabilities, if present,
  // wins only when the account declares none.
  describe('C-R01: capabilities from declared account', () => {
    test('candidatesFromEvidence sets capabilities from matched account', () => {
      const candidates = candidatesApi.candidatesFromEvidence(testEvidenceData, {
        accounts: accountsList,
      });
      const cand = candidates.find((c) => c.accountId === 'xkiro');
      assert.ok(cand, 'candidate for xkiro must be present');
      assert.deepEqual(
        cand.capabilities,
        { jsonSchema: true, tools: true, contextWindow: 200000 },
        'candidate must carry account declared capabilities'
      );
    });

    test('account declared capabilities override combo.capabilities when account declares them', () => {
      const evCopy = JSON.parse(JSON.stringify(testEvidenceData));
      evCopy.combinations[0].capabilities = { legacyCap: true, contextWindow: 32000 };

      const candidates = candidatesApi.candidatesFromEvidence(evCopy, {
        accounts: accountsList,
      });
      const cand = candidates.find((c) => c.accountId === 'xkiro');
      assert.ok(cand, 'candidate for xkiro must be present');
      assert.deepEqual(
        cand.capabilities,
        { jsonSchema: true, tools: true, contextWindow: 200000 },
        'account declared capabilities must win over combo.capabilities'
      );
      assert.equal(cand.capabilities.legacyCap, undefined);
    });

    test('combo.capabilities wins only when account declares none', () => {
      const evCopy = JSON.parse(JSON.stringify(testEvidenceData));
      evCopy.combinations[0].capabilities = { customFallback: true, contextWindow: 128000 };

      const emptyCapsAccounts = [
        {
          id: 'xkiro',
          provider: '9router',
          capabilities: {},
        },
      ];

      const candidates = candidatesApi.candidatesFromEvidence(evCopy, {
        accounts: emptyCapsAccounts,
      });
      const cand = candidates.find((c) => c.accountId === 'xkiro');
      assert.ok(cand, 'candidate must be present');
      assert.deepEqual(
        cand.capabilities,
        { customFallback: true, contextWindow: 128000 },
        'combo.capabilities must win when account declares none'
      );
    });
  });

  // C-R02: an evidence-only candidate whose account is unknown or 'UNPINNED' keeps capabilities {}
  // and therefore still fails capability floors (fail closed).
  describe('C-R02: unknown or UNPINNED account keeps capabilities {} and fails closed', () => {
    test('unknown account keeps capabilities {}', () => {
      const evCopy = JSON.parse(JSON.stringify(testEvidenceData));
      evCopy.combinations[0].accountId = 'unknown-account';
      evCopy.combinations[0].quotaScope = 'unknown-account';

      const candidates = candidatesApi.candidatesFromEvidence(evCopy, {
        accounts: accountsList,
      });
      const cand = candidates.find((c) => c.accountId === 'unknown-account');
      assert.ok(cand, 'candidate must be present');
      assert.deepEqual(
        cand.capabilities,
        {},
        'unknown account candidate must have capabilities {}'
      );
    });

    test('UNPINNED account keeps capabilities {}', () => {
      const evCopy = JSON.parse(JSON.stringify(testEvidenceData));
      evCopy.combinations[0].accountId = 'UNPINNED';
      evCopy.combinations[0].quotaScope = 'ocz';

      const candidates = candidatesApi.candidatesFromEvidence(evCopy, {
        accounts: accountsList,
      });
      const cand = candidates.find((c) => c.accountId === 'UNPINNED');
      assert.ok(cand, 'candidate must be present');
      assert.deepEqual(cand.capabilities, {}, 'UNPINNED candidate must have capabilities {}');
    });

    test('candidate with capabilities {} fails capability floor (fail closed)', () => {
      const evCopy = JSON.parse(JSON.stringify(testEvidenceData));
      evCopy.combinations[0].accountId = 'UNPINNED';
      evCopy.combinations[0].quotaScope = 'ocz';

      const candidates = candidatesApi.candidatesFromEvidence(evCopy, {
        accounts: accountsList,
      });
      const cand = candidates.find((c) => c.accountId === 'UNPINNED');

      const profile = {
        taskId: 'TASK-C-R02',
        role: 'writer',
        complexity: 'standard',
        requiredCapabilities: ['jsonSchema'],
        proofFloor: 'NONE',
        contextSize: 64000,
        qualityFloor: 0,
        costCeiling: 100000,
        forbiddenFailureDomains: [],
      };

      const assessment = {
        jevOutcome: 'UNDECIDED',
        decidedBy: 'controller',
        weightProfile: 'BALANCED',
        weights: { latency: 34, quality: 33, cost: 33 },
      };

      const rankResult = routing.rankForProfile([cand], profile, assessment, {
        now: NOW,
        evidenceData: evCopy,
      });

      assert.equal(rankResult.chosen, null, 'Candidate must not be chosen');
      const rejection = rankResult.rejected.find(
        (r) => r.candidateKey === candidatesApi.candidateKey(cand)
      );
      assert.ok(rejection, 'Rejection must be recorded');
      assert.equal(rejection.reasonCode, 'CAPABILITY_MISSING:jsonSchema');
    });
  });

  // C-R03: live callers (orchestrate buildCandidates/selectCandidateForProfile and cli assembleForDispatch)
  // pass the same accounts list they already use; tests that inject candidates without accounts see no host registry.
  describe('C-R03: live callers pass accounts; hermetic tests see no host registry', () => {
    test('orchestrate.buildCandidates passes accounts to evidence candidates', () => {
      const candidates = orchestrate.buildCandidates({ accounts: accountsList }, testEvidenceData);
      const cand = candidates.find((c) => c.accountId === 'xkiro');
      assert.ok(cand, 'xkiro candidate must be present');
      assert.deepEqual(
        cand.capabilities,
        { jsonSchema: true, tools: true, contextWindow: 200000 },
        'evidence candidate in buildCandidates must receive account capabilities'
      );
    });

    test('hermetic test: injecting candidates without accounts sees no host registry', () => {
      const candidates = orchestrate.buildCandidates({ candidates: [] }, testEvidenceData);
      const cand = candidates.find((c) => c.accountId === 'xkiro');
      assert.ok(cand, 'xkiro candidate must be present');
      assert.deepEqual(
        cand.capabilities,
        {},
        'without injected accounts, evidence candidate must have capabilities {} (no host registry)'
      );
    });

    test('orchestrate.selectCandidateForProfile passes accounts to evidence candidates', async () => {
      const item = {
        id: 'TASK-C-R03',
        requiredCapabilities: ['jsonSchema', 'tools'],
        roleRequirement: {
          role: 'writer',
        },
        complexity: 'standard',
        proofFloor: 'WORK_ITEM_PASS',
      };

      const decision = await orchestrate.selectCandidateForProfile(
        item,
        [],
        [],
        testEvidenceData,
        { accounts: accountsList, decisionDir },
        { dir: decisionDir, now: NOW },
        NOW
      );

      assert.ok(decision.chosen, 'Candidate must be chosen');
      assert.match(decision.chosen, /xkiro/, 'Chosen candidate must be xkiro');
    });

    test('cli.assembleForDispatch passes accounts to evidence candidates', () => {
      const fakeRegistry = {
        sources: [
          {
            id: '9router',
            kind: 'router',
            harness: 'paseo',
            accessPath: 'http://127.0.0.1:20128/v1',
            servesModels: true,
          },
        ],
      };

      const assembled = assembleForDispatch({ candidates: [] }, accountsList, fakeRegistry, {
        evidenceData: testEvidenceData,
      });

      const cand = assembled.find((c) => c.accountId === 'xkiro');
      assert.ok(cand, 'xkiro candidate must be present in assembled candidates');
      assert.deepEqual(
        cand.capabilities,
        { jsonSchema: true, tools: true, contextWindow: 200000 },
        'candidate assembled for dispatch must carry account declared capabilities'
      );
    });
  });

  // C-R04: test: evidence store with WORK_ITEM_PASS for an xkiro-like key + injected accounts
  // declaring jsonSchema/tools -> the candidate passes the capability floor and is ranked;
  // without the account -> CAPABILITY_MISSING:jsonSchema.
  describe('C-R04: evidence store with WORK_ITEM_PASS for xkiro passes floor when accounts injected', () => {
    const item = {
      id: 'TASK-C-R04',
      requiredCapabilities: ['jsonSchema', 'tools'],
      roleRequirement: {
        role: 'writer',
      },
      complexity: 'standard',
      proofFloor: 'WORK_ITEM_PASS',
    };

    test('with injected accounts declaring jsonSchema/tools -> candidate passes floor and is ranked', async () => {
      const decision = await orchestrate.selectCandidateForProfile(
        item,
        [],
        [],
        testEvidenceData,
        { accounts: accountsList, decisionDir },
        { dir: decisionDir, now: NOW },
        NOW
      );

      assert.ok(decision.chosen, 'Candidate must be chosen');
      const ranked = decision.result.ranking.find((r) => r.accountId === 'xkiro');
      assert.ok(ranked, 'xkiro candidate must be ranked');
      assert.equal(
        decision.result.rejected.some((r) => r.reasonCode.startsWith('CAPABILITY_MISSING')),
        false,
        'No candidate should be rejected for missing capabilities'
      );
    });

    test('without the account -> candidate is refused CAPABILITY_MISSING:jsonSchema', async () => {
      const decision = await orchestrate.selectCandidateForProfile(
        item,
        [],
        [],
        testEvidenceData,
        { accounts: [], decisionDir },
        { dir: decisionDir, now: NOW },
        NOW
      );

      assert.equal(decision.chosen, null, 'Candidate must not be chosen without account');
      const rejected = decision.result.rejected.find(
        (r) => r.reasonCode === 'CAPABILITY_MISSING:jsonSchema'
      );
      assert.ok(
        rejected,
        'Candidate must be rejected with CAPABILITY_MISSING:jsonSchema when account is missing'
      );
    });
  });
});
