'use strict';

/**
 * TASK-AI-62 — Import newly configured sources into the Controller
 * registry/evidence with honest proof levels.
 *
 * Tested guarantees:
 *
 *   1. A new source added by data (no code change) appears in discovery.
 *   2. API_PASS is never treated as harness-proven by selection.
 *   3. Two accounts on one upstream are never merged.
 *   4. The HTTP alias and the OpenCode alias stay separate candidates.
 *   5. No key material appears in the work item's files (checked without
 *      ever printing values).
 *   6. Dahl (DEFERRED / COMPROMISED_CREDENTIAL) is recorded but never
 *      eligible: no candidate, no enumeration, no harness pass, no dispatch.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sources = require('../sources');
const evidence = require('../evidence');
const candidates = require('../candidates');
const ranking = require('../ranking');
const { enumerate } = require('../discovery/adapters');
const { importProbePass } = require('../discovery/probe-import');
const { readDiscoveryCatalogue } = require('../discovery/read');
const { candidateKey } = require('../discovery/identity');

const BRAIN = path.join(__dirname, '..');
const DATA_DIR = path.join(BRAIN, 'data', 'discovery');
const REAL_REGISTRY = sources.loadSources();

/** The files this Work Item is allowed to touch — the secret-free scan set. */
const WORK_ITEM_FILES = [
  'sources.json',
  'sources.js',
  'candidates.js',
  'evidence.js',
  'discovery.js',
  'discovery/read.js',
  'discovery/adapters.js',
  'discovery/probe-import.js',
  'data/discovery/probe-harness-passes.json',
];

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(file, doc) {
  fs.writeFileSync(file, JSON.stringify(doc), 'utf8');
  return file;
}

/** Registry fixture with only what a probe import needs. */
function fixtureRegistry() {
  return {
    sources: [
      {
        id: 'prov-a',
        label: 'Provider A',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://prov-a.example/v1',
        credential: { type: 'api-key', env: 'PROV_A_API_KEY' },
        verify: { method: 'completion' },
      },
      {
        id: 'prov-b',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://prov-b.example/v1',
        credential: { type: 'api-key', env: 'PROV_B_API_KEY' },
      },
      {
        id: 'prov-x',
        kind: 'model-source',
        servesModels: true,
        endpoint: 'https://prov-x.example/v1',
        credential: { type: 'api-key', env: 'PROV_X_API_KEY' },
        disposition: 'deferred',
        dispositionReason: 'COMPROMISED_CREDENTIAL',
      },
    ],
  };
}

function fixtureProbeFile(dir) {
  return writeJson(path.join(dir, 'probe_pass.json'), {
    'prov-a': ['alpha-1', 'alpha-2'],
    'prov-b': ['beta-1'],
    'prov-x': ['shady-model'],
  });
}

describe('TASK-AI-62: data-driven source discovery', () => {
  test('a new source added by data appears in discovery without a code change', () => {
    const dir = tmpDir('shipde-ai62-');
    const probeFile = fixtureProbeFile(dir);
    const entry = importProbePass(probeFile, {
      registry: fixtureRegistry(),
      now: '2026-09-28T10:00:00.000Z',
    });

    // Every listed model of the new source becomes a candidate with API_PASS.
    const provA = entry.candidates.filter((c) => c.source === 'prov-a');
    assert.equal(provA.length, 2);
    for (const c of provA) {
      assert.equal(c.proofLevel, evidence.ProofLevel.API_PASS);
      assert.equal(c.status, 'PASS');
      assert.equal(c.resultState, 'PASS');
    }

    // And they are readable through the Controller discovery interface.
    const catalogue = readDiscoveryCatalogue({ imports: [entry] });
    const cand = catalogue.getModel({ accessPath: 'prov-a', account: '', modelId: 'alpha-1' });
    assert.ok(cand, 'new source candidate must be discoverable');
    assert.equal(cand.proofLevel, 'API_PASS');
    assert.equal(cand.resultState, 'PASS');
    assert.ok(cand.alive, 'a direct-HTTP nonce keeps the candidate alive on its own path');
    assert.ok(cand.evidence.length > 0);
    assert.equal(cand.evidence[0].rawEvidence.file, 'probe_pass.json');
  });

  test('enumeration of a new model-source is driven by the registry kind, not by id', async () => {
    const dir = tmpDir('shipde-ai62-');
    const registry = fixtureRegistry();
    const ctx = {
      registry,
      httpGet: async (url) => {
        assert.equal(url, 'https://prov-a.example/v1/models');
        return {
          ok: true,
          status: 200,
          parsed: {
            object: 'list',
            data: [{ id: 'alpha-1' }, { id: 'alpha-2' }],
          },
          request: { url },
          error: null,
        };
      },
      runCommand: async () => {
        throw new Error('no CLI should run for an HTTP model-source');
      },
    };
    const res = await enumerate(registry.sources[0], ctx);
    assert.equal(res.status, 'enumerated');
    assert.equal(res.catalogs.length, 1);
    assert.deepEqual(res.catalogs[0].models, ['alpha-1', 'alpha-2']);
  });
});

describe('TASK-AI-62: honest proof levels', () => {
  test('API_PASS is never treated as harness-proven', () => {
    const apiPass = [{ status: 'PASS', proofLevel: evidence.ProofLevel.API_PASS }];
    const harnessPass = [{ status: 'PASS', proofLevel: evidence.ProofLevel.HARNESS_PASS }];
    const workItemPass = [{ status: 'PASS', proofLevel: evidence.ProofLevel.WORK_ITEM_PASS }];
    const nothing = [{ status: 'PASS' }];

    assert.equal(evidence.isHarnessProven(apiPass), false);
    assert.equal(evidence.isHarnessProven(harnessPass), true);
    assert.equal(evidence.isHarnessProven(workItemPass), true);
    assert.equal(evidence.isHarnessProven(nothing), false);
    assert.equal(evidence.isHarnessProven([]), false);
    assert.equal(evidence.isHarnessProven(undefined), false);

    // The ladder is one-way: strongest level wins, but API stays the floor.
    assert.equal(evidence.proofLevelOf(apiPass), 'API_PASS');
    assert.equal(evidence.proofLevelOf([...apiPass, ...harnessPass]), 'HARNESS_PASS');
    assert.equal(evidence.proofLevelOf(nothing), null);
  });

  test('numeric evidence levels carry their honest proof level, never promoted', () => {
    assert.equal(evidence.proofLevelFromLevel(evidence.Level.API), 'API_PASS');
    assert.equal(evidence.proofLevelFromLevel(evidence.Level.HARNESS), 'HARNESS_PASS');
    assert.equal(evidence.proofLevelFromLevel(evidence.Level.OUTCOME), 'WORK_ITEM_PASS');

    const dir = tmpDir('shipde-ai62-');
    const cand = {
      harness: 'http',
      accessPath: 'prov-a',
      gateway: '',
      upstream: 'prov-a',
      accountId: '',
      quotaScope: '',
      modelId: 'alpha-1',
    };
    evidence.recordProbe(dir, cand, { status: 'passed', level: evidence.Level.API });
    const data = evidence.loadEvidence(dir);
    const stored = evidence.getEvidence(data, cand);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].proofLevel, 'API_PASS');
    assert.equal(evidence.isHarnessProven(stored), false);
  });

  test('selection scores harness proof above API proof — an API nonce never reads as harness', () => {
    const apiCand = {
      evidence: [{ status: 'passed', level: evidence.Level.API, proofLevel: 'API_PASS' }],
    };
    const harnessCand = {
      evidence: [{ status: 'passed', level: evidence.Level.HARNESS, proofLevel: 'HARNESS_PASS' }],
    };
    assert.ok(ranking.evidenceScore(apiCand) < ranking.evidenceScore(harnessCand));
    assert.equal(evidence.isHarnessProven(apiCand.evidence), false);
    assert.equal(evidence.isHarnessProven(harnessCand.evidence), true);
  });

  test('failure causes and scopes are preserved per candidate (429/401/402 keep their class)', () => {
    const dir = tmpDir('shipde-ai62-');
    const base = {
      harness: 'http',
      accessPath: 'prov-a',
      gateway: '',
      upstream: 'prov-a',
      accountId: '',
      quotaScope: '',
    };
    const rate = { ...base, modelId: 'alpha-1' };
    evidence.recordProbe(dir, rate, {
      status: 'failed',
      httpStatus: 429,
      body: 'rate limit exceeded, retry after 60s',
    });
    const auth = { ...base, modelId: 'alpha-2' };
    evidence.recordProbe(dir, auth, { status: 'failed', httpStatus: 401, body: 'unauthorized' });

    const data = evidence.loadEvidence(dir);
    const rateBlock = evidence.isCandidateBlocked(data, { ...rate }, { now: Date.now() + 1000 });
    assert.equal(rateBlock.blocked, true);
    assert.match(rateBlock.reason, /rate/i);

    const rateCooldown = data.cooldowns[candidateKey(rate)];
    assert.equal(rateCooldown.cause, 'upstream_rate_limit');
    assert.equal(rateCooldown.scope, 'upstream');
    const authCooldown = data.cooldowns[candidateKey(auth)];
    assert.equal(authCooldown.cause, 'upstream_credential');
    assert.equal(authCooldown.scope, 'upstream');
  });
});

describe('TASK-AI-62: candidate identity stays exact', () => {
  test('two accounts on one upstream are never merged', () => {
    const dir = tmpDir('shipde-ai62-');
    const acctA = {
      harness: 'http',
      accessPath: 'prov-a',
      gateway: '',
      upstream: 'prov-a',
      accountId: 'acct-a',
      quotaScope: 'acct-a',
      modelId: 'alpha-1',
    };
    const acctB = { ...acctA, accountId: 'acct-b', quotaScope: 'acct-b' };
    assert.notEqual(candidateKey(acctA), candidateKey(acctB));

    evidence.recordProbe(dir, acctA, { status: 'passed', level: evidence.Level.API });
    evidence.recordProbe(dir, acctB, { status: 'failed', httpStatus: 429, body: 'rate limited' });
    const data = evidence.loadEvidence(dir);
    assert.equal(data.combinations.length, 2, 'each account keeps its own combination');
    assert.equal(evidence.candidateStatus(data, acctA), 'passed');
    assert.equal(evidence.candidateStatus(data, acctB), 'failed');

    // A merged candidate would collapse the two accounts into one dispatchable
    // row; the generator keeps them apart too.
    const registry = {
      sources: [
        {
          id: 'gw',
          kind: 'router',
          servesModels: true,
          harness: 'paseo',
          accessPath: 'gw',
          endpoint: 'https://gw.example/v1',
        },
      ],
    };
    const generated = candidates.generateCandidates({
      registry,
      catalogue: ['up1/model-x'],
      accounts: [
        { id: 'acct-a', sourceId: 'gw' },
        { id: 'acct-b', sourceId: 'gw' },
      ],
    });
    assert.equal(generated.length, 2);
    assert.notEqual(candidateKey(generated[0]), candidateKey(generated[1]));
    assert.deepEqual(generated.map((c) => c.accountId).sort(), ['acct-a', 'acct-b']);
    const merged = candidates.mergeCandidates(generated, generated);
    assert.equal(merged.length, 2, 'mergeCandidates must not collapse two accounts');
  });

  test('the HTTP alias and the OpenCode alias stay separate candidates', () => {
    const httpId = candidateKey({
      harness: 'http',
      accessPath: 'baseten',
      gateway: '',
      upstream: 'baseten',
      account: '',
      quotaScope: '',
      modelId: 'zai-org/GLM-5.3',
    });
    const opencodeId = candidateKey({
      harness: 'paseo',
      accessPath: 'opencode',
      gateway: 'opencode',
      upstream: 'baseten',
      account: '',
      quotaScope: '',
      modelId: 'baseten/zai-org/GLM-5.3',
    });
    assert.notEqual(httpId, opencodeId);

    const dir = tmpDir('shipde-ai62-');
    const probeFile = writeJson(path.join(dir, 'probe_pass.json'), { 'prov-a': ['alpha-1'] });
    const harnessPasses = [
      {
        sourceId: 'prov-a',
        modelId: 'alpha-1',
        opencodeAlias: 'prov-a/alpha-1',
        harness: 'paseo',
        accessPath: 'opencode',
        gateway: 'opencode',
        upstream: 'prov-a',
        nonce: 'HARNESS-OK-TEST',
        timestamp: '2026-09-28T00:00:00.000Z',
      },
    ];
    const entry = importProbePass(probeFile, {
      registry: fixtureRegistry(),
      harnessPasses,
      now: '2026-09-28T10:00:00.000Z',
    });
    const catalogue = readDiscoveryCatalogue({ imports: [entry] });

    // Same model family, two routes, two candidates.
    const httpCand = catalogue.getModel({ accessPath: 'prov-a', account: '', modelId: 'alpha-1' });
    const ocCand = catalogue.getModel({
      accessPath: 'opencode',
      account: '',
      modelId: 'prov-a/alpha-1',
    });
    assert.ok(httpCand, 'HTTP candidate exists');
    assert.ok(ocCand, 'OpenCode candidate exists');
    assert.notEqual(httpCand.key, ocCand.key);
    assert.equal(httpCand.proofLevel, 'API_PASS');
    assert.equal(ocCand.proofLevel, 'HARNESS_PASS');

    // Proof never leaks across routes: a model proven over HTTP alone is not
    // reported alive on the OpenCode path.
    const ocOnly = readDiscoveryCatalogue({
      imports: [
        importProbePass(probeFile, {
          registry: fixtureRegistry(),
          now: '2026-09-28T10:00:00.000Z',
        }),
      ],
    });
    assert.equal(
      ocOnly.isModelAlive({ accessPath: 'opencode', account: '', modelId: 'prov-a/alpha-1' }),
      false
    );
    assert.equal(
      ocOnly.isModelAlive({ accessPath: 'prov-a', account: '', modelId: 'alpha-1' }),
      true
    );
  });
});

describe('TASK-AI-62: Dahl is recorded but never eligible', () => {
  test('the registry records the deferred disposition and refuses dispatch', () => {
    const dahl = sources.getSource('dahl', REAL_REGISTRY);
    assert.ok(dahl, 'dahl is recorded in the registry for audit');
    assert.equal(dahl.disposition, 'deferred');
    assert.equal(dahl.dispositionReason, 'COMPROMISED_CREDENTIAL');
    assert.equal(sources.isDeferred('dahl', REAL_REGISTRY), 'COMPROMISED_CREDENTIAL');
    assert.match(sources.refuseReason('dahl', REAL_REGISTRY), /^DEFERRED: COMPROMISED_CREDENTIAL/);
    // The active new sources are not refused.
    for (const id of ['cohere', 'baseten', 'inception', 'regolo', 'amd-radeon']) {
      assert.ok(sources.getSource(id, REAL_REGISTRY), id + ' is registered');
      assert.equal(sources.refuseReason(id, REAL_REGISTRY), null);
    }
  });

  test('the candidate generator never emits a deferred source', () => {
    const generated = candidates.generateCandidates({
      registry: REAL_REGISTRY,
      catalogue: [],
      openCodeIds: [],
      accounts: [],
    });
    assert.equal(generated.filter((c) => c.source === 'dahl' || c.upstream === 'dahl').length, 0);
  });

  test('enumeration never uses a deferred credential, not even to list models', async () => {
    const dahl = sources.getSource('dahl', REAL_REGISTRY);
    const ctx = {
      registry: REAL_REGISTRY,
      httpGet: async () => {
        throw new Error('a deferred source must never be called over HTTP');
      },
      runCommand: async () => {
        throw new Error('a deferred source must never be dispatched');
      },
    };
    const res = await enumerate(dahl, ctx);
    assert.equal(res.status, 'deferred');
    assert.match(res.reason, /COMPROMISED_CREDENTIAL/);
    assert.deepEqual(res.catalogs, []);
  });

  test('a probe import records dahl as DEFERRED with no proof level, never PASS', () => {
    const dir = tmpDir('shipde-ai62-');
    const probeFile = fixtureProbeFile(dir);
    // Even a harness observation for a deferred source must not become a
    // HARNESS_PASS.
    const harnessPasses = [
      {
        sourceId: 'prov-x',
        modelId: 'shady-model',
        opencodeAlias: 'prov-x/shady-model',
        nonce: 'SHOULD-NOT-COUNT',
        timestamp: '2026-09-28T10:00:00.000Z',
      },
    ];
    const entry = importProbePass(probeFile, {
      registry: fixtureRegistry(),
      harnessPasses,
      now: '2026-09-28T10:00:00.000Z',
    });

    const dahlLike = entry.candidates.filter((c) => c.source === 'prov-x');
    assert.equal(dahlLike.length, 1);
    assert.equal(dahlLike[0].status, 'DEFERRED');
    assert.equal(dahlLike[0].proofLevel, null);
    assert.equal(dahlLike[0].passes, 0);
    assert.equal(dahlLike[0].errorClass, 'COMPROMISED_CREDENTIAL');
    assert.equal(entry.harnessPass, 0, 'a deferred source gains no HARNESS_PASS');

    const catalogue = readDiscoveryCatalogue({ imports: [entry] });
    const cand = catalogue.getModel({ accessPath: 'prov-x', account: '', modelId: 'shady-model' });
    assert.ok(cand, 'the deferred observation is recorded');
    assert.equal(cand.resultState, 'DEFERRED');
    assert.equal(cand.alive, false);
    assert.equal(cand.proofLevel, null);
    assert.equal(
      catalogue
        .candidatesFor({ accessPath: 'opencode', alive: true })
        .filter((c) => c.upstream === 'prov-x').length,
      0
    );
  });
});

describe('TASK-AI-62: committed evidence honesty', () => {
  test('the committed probe-pass import carries the supervisor HARNESS_PASS and API floors only', () => {
    const importsDir = path.join(DATA_DIR, 'imports');
    const files = fs
      .readdirSync(importsDir)
      .filter((f) => f.startsWith('probe-pass-') && f.endsWith('.json'));
    assert.equal(files.length, 1, 'exactly one committed probe-pass import');
    const entry = JSON.parse(fs.readFileSync(path.join(importsDir, files[0]), 'utf8'));

    assert.equal(entry.evidenceKind, 'probe-pass-import');
    assert.equal(entry.candidateCount, entry.apiPass + entry.harnessPass + entry.deferred);

    // The only HARNESS_PASS is the supervisor's baseten OpenCode observation.
    const harnessCandidates = entry.candidates.filter((c) => c.proofLevel === 'HARNESS_PASS');
    assert.equal(harnessCandidates.length, 1);
    assert.equal(harnessCandidates[0].source, 'baseten');
    assert.equal(harnessCandidates[0].accessPath, 'opencode');
    assert.equal(harnessCandidates[0].harness, 'paseo');
    assert.equal(harnessCandidates[0].rawEvidence.nonce, 'HARNESS-OK-8K2');
    assert.equal(harnessCandidates[0].timestamp, '2026-09-28T00:00:00.000Z');

    // No HTTP API_PASS was promoted to the harness level: every API_PASS
    // candidate lives on the http path of its own source.
    for (const c of entry.candidates.filter((c) => c.proofLevel === 'API_PASS')) {
      assert.equal(c.harness, 'http');
      assert.equal(c.accessPath, c.source);
    }

    // Dahl is present only as DEFERRED.
    const dahl = entry.candidates.filter((c) => c.source === 'dahl');
    assert.equal(dahl.length, 1);
    assert.equal(dahl[0].status, 'DEFERRED');
    assert.equal(dahl[0].proofLevel, null);
    assert.equal(entry.summary.dahl.deferred, 1);
    assert.equal(entry.summary.dahl.apiPass, 0);

    // The supervisor proof reads as harness-proven through the catalogue.
    const catalogue = readDiscoveryCatalogue({ imports: [entry] });
    const ocCand = catalogue.getModel({
      accessPath: 'opencode',
      account: '',
      modelId: 'baseten/zai-org/GLM-5.3',
    });
    assert.ok(ocCand);
    assert.equal(ocCand.proofLevel, 'HARNESS_PASS');
    assert.equal(evidence.isHarnessProven(ocCand.evidence), true);
    const httpCand = catalogue.getModel({
      accessPath: 'baseten',
      account: '',
      modelId: 'zai-org/GLM-5.3',
    });
    assert.ok(httpCand);
    assert.equal(httpCand.proofLevel, 'API_PASS');
    assert.equal(evidence.isHarnessProven(httpCand.evidence), false);
  });

  test('the committed harness-pass file holds at most one probe per source', () => {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'probe-harness-passes.json'), 'utf8');
    const passes = JSON.parse(raw);
    assert.ok(Array.isArray(passes));
    const seen = new Set();
    for (const p of passes) {
      assert.ok(p.sourceId && p.modelId && p.nonce, 'a harness pass carries its evidence');
      assert.ok(!seen.has(p.sourceId), 'one representative harness probe per source');
      seen.add(p.sourceId);
    }
    for (const p of passes) {
      assert.equal(sources.isDeferred(p.sourceId, REAL_REGISTRY), null);
    }
  });
});

describe('TASK-AI-62: no key material in the work item files', () => {
  test('credentials are referenced by env var name only — values never appear', () => {
    const envNames = [
      'COHERE_API_KEY',
      'BASETEN_API_KEY',
      'INCEPTION_API_KEY',
      'REGOLO_API_KEY',
      'AMD_RADEON_API_KEY',
      'DAHL_API_KEY',
    ];
    const contents = new Map();
    for (const rel of WORK_ITEM_FILES) {
      const file = path.join(BRAIN, rel);
      assert.ok(fs.existsSync(file), rel + ' is part of this work item');
      contents.set(rel, fs.readFileSync(file, 'utf8'));
    }
    // The committed import file is part of the scan set too.
    const importsDir = path.join(DATA_DIR, 'imports');
    for (const f of fs.readdirSync(importsDir)) {
      contents.set(
        'data/discovery/imports/' + f,
        fs.readFileSync(path.join(importsDir, f), 'utf8')
      );
    }

    // Every declared credential must appear as an env NAME in the registry.
    const registryJson = contents.get('sources.json');
    for (const name of envNames) {
      assert.ok(registryJson.includes(name), name + ' is referenced by name');
    }

    // No set secret VALUE may appear in any file. The check compares values
    // without printing them; absent variables are simply skipped.
    for (const name of envNames) {
      const value = process.env[name];
      if (!value || String(value).trim().length < 8) continue;
      for (const [rel, text] of contents) {
        assert.ok(
          !text.includes(String(value)),
          'a credential value appears in ' + rel + ' (value withheld)'
        );
      }
    }

    // The same guarantee for every other key-shaped environment variable that
    // is set on this machine, so the diff can never carry a foreign key.
    // Endpoints and URLs are public configuration, not credentials.
    for (const [name, value] of Object.entries(process.env)) {
      if (!/(API_KEY|_KEY|TOKEN|SECRET|PASSWORD)/i.test(name)) continue;
      if (/(_URL|_HOST|_ENDPOINT|_BASE)$/i.test(name)) continue;
      const v = String(value || '').trim();
      if (v.length < 16) continue;
      if (/^https?:\/\//.test(v)) continue;
      if (envNames.includes(name)) continue;
      for (const [rel, text] of contents) {
        assert.ok(!text.includes(v), 'a secret appears in ' + rel + ' (value withheld)');
      }
    }
  });
});
