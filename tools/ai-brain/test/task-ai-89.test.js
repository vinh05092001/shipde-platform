'use strict';

/**
 * Ship Dễ — TASK-AI-89 contract tests:
 * Live capability lookup uses the official account registry.
 *
 * Matrix:
 *   G-R01: live orchestrate CLI and dispatch pass union of --accounts input and
 *          accounts.listAccounts() (registry wins only when input declares none),
 *          deduplicated by account id.
 *   G-R02: hermetic runOrchestration calls that inject candidates and no registry
 *          still see no host registry.
 *   G-R03: with injected registry declaring xkiro capabilities and an --accounts input
 *          without xkiro, evidence-only xkiro WORK_ITEM_PASS candidate passes capability
 *          floor and is ranked; with registry empty it is refused CAPABILITY_MISSING:jsonSchema.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cli = require('../cli');
const orchestrate = require('../orchestrate');
const candidatesApi = require('../candidates');
const evidence = require('../evidence');

const NOW = Date.parse('2026-10-05T00:00:00.000Z');
const FIXTURE_SPECS = path.join(__dirname, 'fixtures', 'task-ai-89', 'specs.json');
const FIXTURE_EVIDENCE = path.join(__dirname, 'fixtures', 'task-ai-89', 'evidence.json');
const FIXTURE_ACCOUNTS = path.join(__dirname, 'fixtures', 'task-ai-89', 'accounts.json');

const noop = () => {};
const runStub = (fn) => (_g, o) => {
  fn(o);
  return Promise.resolve({ status: 'COMPLETED' });
};

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('TASK-AI-89: Live capability lookup uses official account registry', () => {
  let tempRoot, evidenceDir, decisionDir;
  let testEvidenceData;
  let registryAccountsList;

  beforeEach(() => {
    tempRoot = tmpDir('task-ai-89-');
    evidenceDir = path.join(tempRoot, 'evidence');
    decisionDir = path.join(tempRoot, 'decisions');
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(decisionDir, { recursive: true });

    testEvidenceData = JSON.parse(fs.readFileSync(FIXTURE_EVIDENCE, 'utf8'));
    registryAccountsList = JSON.parse(fs.readFileSync(FIXTURE_ACCOUNTS, 'utf8'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  });

  const runCli = (args, deps = {}) =>
    cli.orchestrateCommand(
      Object.assign(
        {
          _: ['orchestrate'],
          goal: 'Goal for TASK-AI-89',
          specs: FIXTURE_SPECS,
          'decision-dir': decisionDir,
        },
        args
      ),
      Object.assign({ log: noop, exit: noop }, deps)
    );

  // G-R01: the live orchestrate CLI and dispatch pass, for evidence-candidate capability lookup,
  // the union of the --accounts input and accounts.listAccounts() (registry entries win on capabilities
  // only when the input entry declares none), deduplicated by account id.
  describe('G-R01: live orchestrate CLI and dispatch pass union of --accounts and listAccounts()', () => {
    test('orchestrate CLI passes union of --accounts input and listAccounts() to runOrchestration', async () => {
      const inputAccounts = [
        {
          id: 'ninerouter',
          provider: '9router',
          capabilities: { tools: true },
        },
        {
          id: 'override-test',
          provider: 'custom',
          capabilities: { customCap: true },
        },
        {
          id: 'empty-caps',
          provider: 'custom',
          capabilities: {},
        },
      ];
      const accountsFile = path.join(tempRoot, 'input-accounts.json');
      fs.writeFileSync(accountsFile, JSON.stringify(inputAccounts), 'utf8');

      const injectedRegistry = [
        {
          id: 'xkiro',
          provider: '9router',
          capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
        },
        {
          id: 'override-test',
          provider: '9router',
          capabilities: { registryWins: false, contextWindow: 100000 },
        },
        {
          id: 'empty-caps',
          provider: '9router',
          capabilities: { registryWon: true, contextWindow: 50000 },
        },
      ];

      let capturedOptions;
      await runCli(
        { accounts: accountsFile },
        {
          listAccounts: () => injectedRegistry,
          runOrchestration: runStub((o) => (capturedOptions = o)),
        }
      );

      assert.ok(capturedOptions, 'runOrchestration must be called');
      assert.ok(
        Array.isArray(capturedOptions.accounts),
        'captured options must have accounts array'
      );

      const xkiroAcc = capturedOptions.accounts.find((a) => a.id === 'xkiro');
      assert.ok(xkiroAcc, 'xkiro from registry must be in union accounts');
      assert.deepEqual(
        xkiroAcc.capabilities,
        { jsonSchema: true, tools: true, contextWindow: 200000 },
        'xkiro must carry registry declared capabilities'
      );

      const overrideAcc = capturedOptions.accounts.find((a) => a.id === 'override-test');
      assert.ok(overrideAcc, 'override-test must be in union accounts');
      assert.deepEqual(
        overrideAcc.capabilities,
        { customCap: true },
        'input entry with declared capabilities must win over registry entry'
      );

      const emptyCapsAcc = capturedOptions.accounts.find((a) => a.id === 'empty-caps');
      assert.ok(emptyCapsAcc, 'empty-caps must be in union accounts');
      assert.deepEqual(
        emptyCapsAcc.capabilities,
        { registryWon: true, contextWindow: 50000 },
        'registry entry must win when input entry declares none'
      );

      const ninerouterAcc = capturedOptions.accounts.find((a) => a.id === 'ninerouter');
      assert.ok(ninerouterAcc, 'ninerouter from input must be preserved');
      assert.deepEqual(ninerouterAcc.capabilities, { tools: true });

      // Deduplication check: each account id appears exactly once
      const ids = capturedOptions.accounts.map((a) => a.id);
      const uniqueIds = Array.from(new Set(ids));
      assert.equal(
        ids.length,
        uniqueIds.length,
        'accounts list must be deduplicated by account id'
      );
    });

    test('assembleForDispatch passes union of accounts and registry accounts to candidatesFromEvidence', () => {
      const inputAccounts = [
        {
          id: 'ninerouter',
          provider: '9router',
          capabilities: { tools: true },
        },
        {
          id: 'override-test',
          provider: 'custom',
          capabilities: { customCap: true },
        },
        {
          id: 'xkiro',
          provider: 'custom',
          capabilities: {},
        },
      ];

      const injectedRegistry = [
        {
          id: 'xkiro',
          provider: '9router',
          capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
        },
        {
          id: 'override-test',
          provider: '9router',
          capabilities: { registryOverrode: true },
        },
      ];

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

      const evData = JSON.parse(JSON.stringify(testEvidenceData));
      evData.combinations.push({
        harness: 'paseo',
        accessPath: 'http://127.0.0.1:20128/v1',
        gateway: '9router',
        upstream: 'ocz',
        accountId: 'override-test',
        quotaScope: 'override-test',
        model: 'ocz/override-model',
        evidence: [
          {
            ts: '2026-10-05T00:00:00.000Z',
            status: 'passed',
            exitCode: 0,
            proofLevel: 'WORK_ITEM_PASS',
          },
        ],
      });

      const assembled = cli.assembleForDispatch({ candidates: [] }, inputAccounts, fakeRegistry, {
        evidenceData: evData,
        registryAccounts: injectedRegistry,
      });

      const xkiroCand = assembled.find((c) => c.accountId === 'xkiro');
      assert.ok(xkiroCand, 'xkiro candidate must be assembled');
      assert.deepEqual(
        xkiroCand.capabilities,
        { jsonSchema: true, tools: true, contextWindow: 200000 },
        'registry capabilities must win when input entry declared none'
      );

      const overrideCand = assembled.find((c) => c.accountId === 'override-test');
      assert.ok(overrideCand, 'override-test candidate must be assembled');
      assert.deepEqual(
        overrideCand.capabilities,
        { customCap: true },
        'input entry capabilities must win when declared'
      );
    });
  });

  // G-R02: hermetic runOrchestration calls that inject candidates and no registry still see no host registry.
  describe('G-R02: hermetic runOrchestration calls that inject candidates see no host registry', () => {
    test('runOrchestration with injected candidates and no registry gives evidence candidate capabilities {}', async () => {
      const item = {
        id: 'TASK-AI-89-ITEM',
        roleRequirement: { role: 'writer' },
        requiredCapabilities: ['jsonSchema'],
        proofFloor: 'WORK_ITEM_PASS',
      };

      // Injected candidates array without xkiro, and no registry passed
      const log = await orchestrate.runOrchestration('Goal for hermetic test', {
        specs: [item],
        candidates: [],
        evidenceData: testEvidenceData,
        run: () => ({ exitCode: 0, stdout: 'ok' }),
        decisionDir,
        now: NOW,
      });

      // Because candidates were injected and no registry was provided,
      // the xkiro evidence candidate gets capabilities {} (no host registry)
      // and fails the jsonSchema capability floor -> selection refused.
      assert.ok(log.selections && log.selections[0], 'selection must be recorded');
      assert.equal(
        log.selections[0].decision.chosen,
        null,
        'xkiro must not be chosen when registry not injected'
      );
      const decRejection = log.selections[0].decision.result.rejected.find((r) =>
        r.candidateKey.includes('xkiro')
      );
      assert.ok(decRejection, 'xkiro rejection must be recorded');
      assert.equal(decRejection.reasonCode, 'CAPABILITY_MISSING:jsonSchema');
    });

    test('orchestrate.buildCandidates with injected candidates and no registry sees no host registry', () => {
      const candidates = orchestrate.buildCandidates({ candidates: [] }, testEvidenceData);
      const cand = candidates.find((c) => c.accountId === 'xkiro');
      assert.ok(cand, 'xkiro candidate must be present from evidence');
      assert.deepEqual(
        cand.capabilities,
        {},
        'without injected registry, evidence candidate must have capabilities {}'
      );
    });
  });

  // G-R03: test: with an injected registry declaring xkiro capabilities and an --accounts input without xkiro,
  // an evidence-only xkiro WORK_ITEM_PASS candidate passes the capability floor and is ranked;
  // with the registry empty it is refused CAPABILITY_MISSING:jsonSchema.
  describe('G-R03: injected registry allows evidence-only xkiro candidate to pass floor and be ranked', () => {
    const item = {
      id: 'TASK-AI-89-ITEM',
      roleRequirement: { role: 'writer' },
      requiredCapabilities: ['jsonSchema', 'tools'],
      complexity: 'standard',
      proofFloor: 'WORK_ITEM_PASS',
    };

    test('with injected registry declaring xkiro capabilities and --accounts input without xkiro: candidate passes floor and is ranked', async () => {
      // Injected accounts has only ninerouter (no xkiro)
      const inputAccounts = [
        {
          id: 'ninerouter',
          provider: '9router',
          capabilities: { tools: true },
        },
      ];

      const decision = await orchestrate.selectCandidateForProfile(
        item,
        [],
        [],
        testEvidenceData,
        {
          accounts: inputAccounts,
          registryAccounts: registryAccountsList,
          decisionDir,
        },
        { dir: decisionDir, now: NOW },
        NOW
      );

      assert.ok(decision.chosen, 'Candidate must be chosen');
      assert.match(decision.chosen, /xkiro/, 'Chosen candidate must be xkiro');
      const ranked = decision.result.ranking.find((r) => r.accountId === 'xkiro');
      assert.ok(ranked, 'xkiro candidate must be ranked');
      assert.equal(
        decision.result.rejected.some((r) => r.reasonCode.startsWith('CAPABILITY_MISSING')),
        false,
        'No candidate should be rejected for missing capabilities'
      );
    });

    test('with the registry empty: candidate is refused CAPABILITY_MISSING:jsonSchema', async () => {
      // Injected accounts has only ninerouter (no xkiro), and registry is empty
      const inputAccounts = [
        {
          id: 'ninerouter',
          provider: '9router',
          capabilities: { tools: true },
        },
      ];

      const decision = await orchestrate.selectCandidateForProfile(
        item,
        [],
        [],
        testEvidenceData,
        {
          accounts: inputAccounts,
          registryAccounts: [],
          decisionDir,
        },
        { dir: decisionDir, now: NOW },
        NOW
      );

      assert.equal(decision.chosen, null, 'Candidate must not be chosen when registry is empty');
      const rejected = decision.result.rejected.find(
        (r) => r.reasonCode === 'CAPABILITY_MISSING:jsonSchema'
      );
      assert.ok(
        rejected,
        'Candidate must be rejected with CAPABILITY_MISSING:jsonSchema when registry is empty'
      );
    });

    test('orchestrate CLI end-to-end: injected listAccounts allows evidence-only xkiro candidate to be ranked and launched', async () => {
      fs.copyFileSync(FIXTURE_EVIDENCE, path.join(evidenceDir, 'evidence.json'));
      const accountsFile = path.join(tempRoot, 'empty-accounts.json');
      fs.writeFileSync(accountsFile, '[]', 'utf8');

      let launchedJob;
      await runCli(
        { accounts: accountsFile, 'evidence-dir': evidenceDir },
        {
          now: NOW,
          listAccounts: () => registryAccountsList,
          run: (job) => ((launchedJob = job), { exitCode: 0, stdout: 'ok' }),
          tests: () => ({ pass: true, findings: [] }),
          reviewer: () => ({
            sha: '0123456789012345678901234567890123456789',
            verdict: 'PASS',
            findings: [],
          }),
          baseSha: '0123456789012345678901234567890123456789',
        }
      );

      assert.ok(launchedJob, 'Job must be launched for xkiro candidate');
      assert.equal(launchedJob.accountId, 'xkiro');
    });

    test('orchestrate CLI end-to-end: with empty listAccounts, xkiro candidate is refused CAPABILITY_MISSING:jsonSchema', async () => {
      fs.copyFileSync(FIXTURE_EVIDENCE, path.join(evidenceDir, 'evidence.json'));
      const accountsFile = path.join(tempRoot, 'empty-accounts.json');
      fs.writeFileSync(accountsFile, '[]', 'utf8');

      let launchedJob = null;
      await runCli(
        { accounts: accountsFile, 'evidence-dir': evidenceDir },
        {
          now: NOW,
          listAccounts: () => [],
          run: (job) => ((launchedJob = job), { exitCode: 0, stdout: 'ok' }),
          tests: () => ({ pass: true, findings: [] }),
          reviewer: () => ({
            sha: '0123456789012345678901234567890123456789',
            verdict: 'PASS',
            findings: [],
          }),
          baseSha: '0123456789012345678901234567890123456789',
        }
      );

      assert.equal(launchedJob, null, 'No job must be launched');
      const decFile = fs
        .readdirSync(decisionDir)
        .filter((f) => f.endsWith('.jsonl'))
        .pop();
      assert.ok(decFile, 'decision log must be written');
      const dec = JSON.parse(
        fs.readFileSync(path.join(decisionDir, decFile), 'utf8').trim().split('\n')[0]
      );
      assert.equal(dec.chosen, null);
      const rejected = (dec.rejected || []).find((r) => r.candidateKey.includes('xkiro'));
      assert.ok(rejected);
      assert.equal(rejected.reasonCode, 'CAPABILITY_MISSING:jsonSchema');
    });
  });
});
