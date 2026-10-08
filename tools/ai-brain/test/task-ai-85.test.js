'use strict';

/**
 * Ship Dễ — TASK-AI-85: Live orchestrate CLI loads evidence store.
 * Matrix: V-R01 (explicit and default evidenceDir), V-R02 (hermetic isolation), V-R03 (in-process selection).
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
const FIXTURE_SPECS = path.join(__dirname, 'fixtures', 'task-ai-85', 'specs.json');
const DEFAULT_EVIDENCE_DIR = path.join(__dirname, '..', 'data', 'evidence');
const SHA = '0123456789012345678901234567890123456789';
const noop = () => {};
const runStub = (fn) => (_g, o) => {
  fn(o);
  return Promise.resolve({ status: 'COMPLETED' });
};
const readLastJson = (dir) => {
  const file = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .pop();
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').trim().split('\n').pop());
};

function makeCand(overrides = {}) {
  const c = Object.assign(
    {
      harness: 'paseo',
      accessPath: 'cli',
      gateway: '9router',
      upstream: 'ag',
      accountId: 'xkiro',
      quotaScope: 'ag',
      modelId: 'ag/m1',
      quality: 85,
      latencyMs: 1000,
      capabilities: { tools: true, jsonSchema: true, contextWindow: 64000 },
      evidence: [],
    },
    overrides
  );
  c.candidateKey = candidatesApi.candidateKey(c);
  return c;
}

describe('TASK-AI-85: live orchestrate CLI loads evidence store', () => {
  let tempRoot, tempEvidenceDir, decisionDir, accountsFile;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-85-'));
    [tempEvidenceDir, decisionDir] = ['evidence', 'decisions'].map((d) => path.join(tempRoot, d));
    fs.mkdirSync(tempEvidenceDir);
    fs.mkdirSync(decisionDir);
    accountsFile = path.join(tempRoot, 'accounts.json');
    fs.writeFileSync(accountsFile, '[]');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (_) {}
  });

  const runCli = (args, deps = {}) =>
    cli.orchestrateCommand(
      Object.assign(
        { _: ['orchestrate'], goal: 'g', specs: FIXTURE_SPECS, 'decision-dir': decisionDir },
        args
      ),
      Object.assign({ log: noop, exit: noop }, deps)
    );

  test('V-R01: orchestrate CLI passes explicit --evidence-dir when provided', async () => {
    assert.equal(typeof cli.orchestrateCommand, 'function');
    let captured;
    await runCli(
      { 'evidence-dir': tempEvidenceDir },
      { runOrchestration: runStub((o) => (captured = o)) }
    );
    assert.ok(captured);
    assert.equal(captured.evidenceDir, tempEvidenceDir);
  });

  test('V-R01: orchestrate CLI passes default tools/ai-brain/data/evidence when omitted', async () => {
    let captured;
    await runCli({}, { runOrchestration: runStub((o) => (captured = o)) });
    assert.ok(captured);
    assert.equal(captured.evidenceDir, DEFAULT_EVIDENCE_DIR);
    assert.notEqual(captured.evidenceDir, null);
  });

  test('V-R02: hermetic tests that inject candidates without evidenceDir read no host evidence', async () => {
    const cand = makeCand({
      gateway: 'gw-hermetic',
      upstream: 'up-hermetic',
      accountId: 'acc-hermetic',
    });
    const built = orchestrate.buildCandidates({ candidates: [cand] });
    assert.equal(built.length, 1);
    assert.equal(built[0].candidateKey, cand.candidateKey);

    let launched = false;
    await orchestrate.runOrchestration('Goal', {
      specs: [
        {
          id: 'ITEM-H',
          roleRequirement: { role: 'writer' },
          files: ['a.js'],
          acceptanceCriteria: ['pass'],
          proofFloor: 'WORK_ITEM_PASS',
          verification: { command: 'node -e ""' },
        },
      ],
      candidates: [cand],
      decisionDir,
      now: NOW,
      run: () => ((launched = true), { exitCode: 0, stdout: 'ok' }),
    });
    assert.equal(launched, false);
  });

  test('V-R03: in-process orchestrate CLI with temp --evidence-dir ranks key absent from --accounts', async () => {
    const candK = makeCand({ gateway: 'gw-k85', upstream: 'up-k85', accountId: 'acc-k85' });
    evidence.recordProbe(tempEvidenceDir, candK, {
      status: 'passed',
      level: evidence.Level.OUTCOME,
      proofLevel: evidence.ProofLevel.WORK_ITEM_PASS,
      role: 'writer',
      taskId: 'TASK-AI-85-ITEM',
    });
    const evData = evidence.loadEvidence(tempEvidenceDir);
    const combo = evData.combinations.find(
      (c) => candidatesApi.candidateKey(c) === candK.candidateKey
    );
    combo.capabilities = { tools: true, jsonSchema: true, contextWindow: 200000 };
    evidence.saveEvidence(tempEvidenceDir, evData);

    let launchedJob;
    const result = await runCli(
      { accounts: accountsFile, 'evidence-dir': tempEvidenceDir },
      {
        now: NOW,
        run: (job) => ((launchedJob = job), { exitCode: 0, stdout: 'ok' }),
        tests: () => ({ pass: true, findings: [] }),
        reviewer: () => ({ sha: SHA, verdict: 'PASS', findings: [] }),
        baseSha: SHA,
      }
    );
    assert.ok(launchedJob);
    assert.equal(launchedJob.candidateKey, candK.candidateKey);
    assert.equal(launchedJob.accountId, 'acc-k85');
    assert.ok(result);

    const lastDec = readLastJson(decisionDir);
    assert.equal(lastDec.chosen, candK.candidateKey);
    assert.ok(
      lastDec.ranking && lastDec.ranking.some((r) => r.candidateKey === candK.candidateKey)
    );
  });

  test('V-R03: without --evidence-dir the default path is passed (assert option value, never null)', async () => {
    let captured;
    await runCli({}, { runOrchestration: runStub((o) => (captured = o)) });
    assert.ok(captured);
    assert.notEqual(captured.evidenceDir, null);
    assert.notEqual(captured.evidenceDir, undefined);
    assert.equal(captured.evidenceDir, DEFAULT_EVIDENCE_DIR);
  });
});
