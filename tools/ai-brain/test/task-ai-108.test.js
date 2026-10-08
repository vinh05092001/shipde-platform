'use strict';

/**
 * TASK-AI-108 — the Controller imports a model evaluation file.
 *
 *   EV-R01 `evidence import-evaluation --file <path> [--evidence-dir <dir>] [--dry-run]`
 *          validates the schema id, writes through evidence.js and prints counts.
 *   EV-R02 ALIVE records API_PASS (source "model-evaluation", observedAt), never a
 *          higher proof level, never lowers an existing higher level.
 *   EV-R03 QUOTA sets/refreshes a cooldown from resetAt, else failure-classifier
 *          defaults; isCandidateBlocked is true before the reset and false after.
 *   EV-R04 callContract notes are stored on the combination.
 *   EV-R05 re-importing the same file is idempotent.
 *   EV-R06 malformed input is rejected with a named error and nothing is written.
 *
 * The fixture is a 16-candidate verbatim copy from the real evaluation file.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const evidence = require('../evidence');
const { DEFAULT_COOLDOWNS } = require('../failure-classifier');
const { evidenceCommand } = require('../cli');

const FIXTURE = path.join(__dirname, 'fixtures', 'model-evaluation-sample.json');
const CLI = path.resolve(__dirname, '..', 'cli.js');

const ALIVE_KEY = 'direct-http::9router::9router::bzl::ninerouter::UNKNOWN::bzl/auto:free';
const OMIT_KEY = 'direct-http::direct::::corti::*::UNKNOWN::corti-s1';
const CONCURRENCY_KEY = 'direct-http::direct::::thegrid::*::UNKNOWN::agent-max';
const QUOTA_RESET_KEY =
  'direct-http::9router::9router::ag::ninerouter::UNKNOWN::ag/claude-opus-4-6-thinking';
const QUOTA_RESET_AT = '2026-10-10T15:22:44.402Z';
const QUOTA_DEFAULT_KEY =
  'direct-http::9router::9router::alims-intl::ninerouter::UNKNOWN::alims-intl/qwen3-coder-next';
const RATE_DEFAULT_KEY =
  'direct-http::9router::9router::cl::ninerouter::UNKNOWN::cl/cognitivecomputations/dolphin-mistral-24b-venice-edition';
const AUTH_KEY = 'direct-http::9router::9router::cc::ninerouter::UNKNOWN::cc/claude-fable-5';

function loadFixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
}

function candidateFromKey(key) {
  const p = key.split('::');
  return {
    harness: p[0],
    accessPath: p[1],
    gateway: p[2],
    upstream: p[3],
    accountId: p[4],
    quotaScope: p[5],
    modelId: p[6],
  };
}

function loadImporter() {
  return require('../evaluation-import');
}

function runCli(args) {
  return cp.spawnSync(process.execPath, [CLI, 'evidence', 'import-evaluation', ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

function captureCommand(args) {
  const out = [];
  const err = [];
  let code = null;
  const result = evidenceCommand(args, {
    log: (m) => out.push(String(m)),
    error: (m) => err.push(String(m)),
    exit: (c) => {
      code = c;
    },
  });
  return { out: out.join('\n'), err: err.join('\n'), code, result };
}

let tempRoot;
let evDir;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(__dirname, '.temp-task-ai-108-'));
  evDir = path.join(tempRoot, 'evidence');
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function writeDoc(doc, name) {
  const fp = path.join(tempRoot, name || 'eval.json');
  fs.writeFileSync(fp, JSON.stringify(doc, null, 2));
  return fp;
}

describe('EV-R01 CLI command', () => {
  test('imports the fixture and prints counts', () => {
    const proc = runCli(['--file', FIXTURE, '--evidence-dir', evDir]);
    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stdout, /imported alive 4\b/);
    assert.match(proc.stdout, /cooldowns set 5\b/);
    assert.match(proc.stdout, /skipped 7\b/);
    assert.match(proc.stdout, /rejected 0\b/);
    const data = evidence.loadEvidence(evDir);
    assert.equal(data.version, evidence.SCHEMA_VERSION);
    assert.equal(data.combinations.length, 4);
    assert.equal(Object.keys(data.cooldowns).length, 5);
    assert.deepEqual(fs.readdirSync(evDir), ['evidence.json']);
  });

  test('--dry-run reports the same counts and writes nothing', () => {
    const proc = runCli(['--file', FIXTURE, '--evidence-dir', evDir, '--dry-run']);
    assert.equal(proc.status, 0, proc.stderr);
    assert.match(proc.stdout, /imported alive 4\b/);
    assert.match(proc.stdout, /cooldowns set 5\b/);
    assert.equal(fs.existsSync(path.join(evDir, 'evidence.json')), false);
  });

  test('--json prints the counts object', () => {
    const r = captureCommand({
      _: ['evidence', 'import-evaluation'],
      file: FIXTURE,
      'evidence-dir': evDir,
      json: true,
    });
    assert.equal(r.code, 0, r.err);
    const parsed = JSON.parse(r.out);
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.counts, {
      importedAlive: 4,
      cooldownsSet: 5,
      skipped: 7,
      rejected: 0,
    });
  });

  test('missing --file is bad argv (exit 2)', () => {
    const proc = runCli(['--evidence-dir', evDir]);
    assert.equal(proc.status, 2);
    assert.equal(fs.existsSync(evDir), false);
  });

  test('an unreadable file is refused with a named error (exit 1)', () => {
    const proc = runCli(['--file', path.join(tempRoot, 'missing.json'), '--evidence-dir', evDir]);
    assert.equal(proc.status, 1);
    assert.match(proc.stderr, /INPUT_UNREADABLE/);
    assert.equal(fs.existsSync(evDir), false);
  });

  test('import-work usage is unchanged for unknown subcommands', () => {
    const r = captureCommand({ _: ['evidence', 'nope'] });
    assert.equal(r.code, 2);
    assert.match(r.err, /import-evaluation/);
  });
});

describe('EV-R02 ALIVE records API_PASS only', () => {
  test('ALIVE candidate gets one API_PASS item with observedAt and source', () => {
    const doc = loadFixture();
    const { importEvaluation } = loadImporter();
    importEvaluation({ doc, evidenceDir: evDir });
    const data = evidence.loadEvidence(evDir);
    const combo = evidence.findCombo(data, candidateFromKey(ALIVE_KEY));
    assert.ok(combo, 'combination created');
    assert.equal(evidence.candidateKey(combo), ALIVE_KEY);
    assert.equal(combo.evidence.length, 1);
    const item = combo.evidence[0];
    assert.equal(item.proofLevel, 'API_PASS');
    assert.equal(item.status, 'passed');
    assert.equal(item.source, 'model-evaluation');
    const src = doc.candidates.find((c) => c.candidateKey === ALIVE_KEY);
    assert.equal(item.observedAt, src.observedAt);
    assert.equal(evidence.isHarnessProven(combo.evidence), false);
  });

  test('no imported item is ever HARNESS_PASS or WORK_ITEM_PASS', () => {
    const { importEvaluation } = loadImporter();
    importEvaluation({ doc: loadFixture(), evidenceDir: evDir });
    const data = evidence.loadEvidence(evDir);
    for (const combo of data.combinations) {
      for (const item of combo.evidence) {
        assert.equal(item.proofLevel, 'API_PASS');
        assert.equal(item.level, evidence.Level.API);
      }
    }
  });

  test('an existing higher proof level is never lowered', () => {
    const cand = candidateFromKey(ALIVE_KEY);
    evidence.recordProbe(evDir, cand, {
      level: evidence.Level.OUTCOME,
      proofLevel: 'WORK_ITEM_PASS',
      status: 'passed',
      source: 'import-work',
    });
    const { importEvaluation } = loadImporter();
    importEvaluation({ doc: loadFixture(), evidenceDir: evDir });
    const data = evidence.loadEvidence(evDir);
    const combo = evidence.findCombo(data, cand);
    assert.equal(evidence.proofLevelOf(combo.evidence), 'WORK_ITEM_PASS');
    const wip = combo.evidence.find((e) => e.proofLevel === 'WORK_ITEM_PASS');
    assert.ok(wip, 'WORK_ITEM_PASS item preserved');
    assert.equal(data.combinations.filter((c) => evidence.candidateKey(c) === ALIVE_KEY).length, 1);
  });

  test('non-ALIVE, non-QUOTA candidates create no combination', () => {
    const { importEvaluation } = loadImporter();
    importEvaluation({ doc: loadFixture(), evidenceDir: evDir });
    const data = evidence.loadEvidence(evDir);
    assert.equal(evidence.findCombo(data, candidateFromKey(AUTH_KEY)), undefined);
    assert.equal(evidence.findCombo(data, candidateFromKey(QUOTA_RESET_KEY)), undefined);
  });
});

describe('EV-R03 QUOTA cooldowns', () => {
  test('resetAt drives the cooldown; blocked before, clear after', () => {
    const { importEvaluation } = loadImporter();
    importEvaluation({ doc: loadFixture(), evidenceDir: evDir });
    const data = evidence.loadEvidence(evDir);
    const cd = data.cooldowns[QUOTA_RESET_KEY];
    assert.ok(cd);
    assert.equal(cd.lastStatus, 'blocked');
    assert.equal(new Date(cd.resetTime).getTime(), Date.parse(QUOTA_RESET_AT));
    const reset = Date.parse(QUOTA_RESET_AT);
    assert.equal(
      evidence.isCandidateBlocked(data, candidateFromKey(QUOTA_RESET_KEY), { now: reset - 1000 })
        .blocked,
      true
    );
    assert.equal(
      evidence.isCandidateBlocked(data, QUOTA_RESET_KEY, { now: reset - 1000 }).blocked,
      true
    );
    assert.equal(
      evidence.isCandidateBlocked(data, candidateFromKey(QUOTA_RESET_KEY), { now: reset + 1000 })
        .blocked,
      false
    );
  });

  test('without resetAt the failure-classifier default applies per cause', () => {
    const doc = loadFixture();
    const { importEvaluation } = loadImporter();
    importEvaluation({ doc, evidenceDir: evDir });
    const data = evidence.loadEvidence(evDir);

    const q = data.cooldowns[QUOTA_DEFAULT_KEY];
    assert.equal(q.cause, 'quota_exhausted');
    assert.equal(q.cooldownMs, DEFAULT_COOLDOWNS.quota_exhausted);
    assert.ok(q.resetTime === null || q.resetTime === undefined);
    const qObserved = Date.parse(
      doc.candidates.find((c) => c.candidateKey === QUOTA_DEFAULT_KEY).observedAt
    );
    const qc = candidateFromKey(QUOTA_DEFAULT_KEY);
    assert.equal(evidence.isCandidateBlocked(data, qc, { now: qObserved + 1000 }).blocked, true);
    assert.equal(
      evidence.isCandidateBlocked(data, qc, {
        now: qObserved + DEFAULT_COOLDOWNS.quota_exhausted + 1000,
      }).blocked,
      false
    );

    const r = data.cooldowns[RATE_DEFAULT_KEY];
    assert.equal(r.cause, 'upstream_rate_limit');
    assert.equal(r.cooldownMs, DEFAULT_COOLDOWNS.upstream_rate_limit);
  });

  test('a QUOTA candidate with no cooldown entry still gets a default cooldown', () => {
    const doc = loadFixture();
    delete doc.cooldowns[QUOTA_DEFAULT_KEY];
    const { importEvaluation } = loadImporter();
    importEvaluation({ doc, evidenceDir: evDir });
    const data = evidence.loadEvidence(evDir);
    const cd = data.cooldowns[QUOTA_DEFAULT_KEY];
    assert.equal(cd.cause, 'quota_exhausted');
    assert.equal(cd.cooldownMs, DEFAULT_COOLDOWNS.quota_exhausted);
  });

  test('a later evaluation refreshes the cooldown; an older one does not regress it', () => {
    const { importEvaluation } = loadImporter();
    const doc = loadFixture();
    importEvaluation({ doc, evidenceDir: evDir });

    const newer = loadFixture();
    const c = newer.candidates.find((x) => x.candidateKey === QUOTA_RESET_KEY);
    c.observedAt = '2026-10-07T00:00:00.000Z';
    c.quota.resetAt = '2026-10-12T00:00:00.000Z';
    importEvaluation({ doc: newer, evidenceDir: evDir });
    let data = evidence.loadEvidence(evDir);
    assert.equal(
      new Date(data.cooldowns[QUOTA_RESET_KEY].resetTime).getTime(),
      Date.parse('2026-10-12T00:00:00.000Z')
    );

    importEvaluation({ doc, evidenceDir: evDir });
    data = evidence.loadEvidence(evDir);
    assert.equal(
      new Date(data.cooldowns[QUOTA_RESET_KEY].resetTime).getTime(),
      Date.parse('2026-10-12T00:00:00.000Z')
    );
  });
});

describe('EV-R04 callContract stored on the combination', () => {
  test('omitted params and max concurrency are recorded', () => {
    const { importEvaluation } = loadImporter();
    importEvaluation({ doc: loadFixture(), evidenceDir: evDir });
    const data = evidence.loadEvidence(evDir);

    const omit = evidence.findCombo(data, candidateFromKey(OMIT_KEY));
    assert.ok(omit.callContract);
    assert.deepEqual(omit.callContract.notes, ['omit temperature,max_tokens']);
    assert.deepEqual(omit.callContract.omitParams, ['temperature', 'max_tokens']);

    const conc = evidence.findCombo(data, candidateFromKey(CONCURRENCY_KEY));
    assert.deepEqual(conc.callContract.notes, ['concurrency<=2']);
    assert.equal(conc.callContract.maxConcurrency, 2);

    const plain = evidence.findCombo(data, candidateFromKey(ALIVE_KEY));
    assert.equal(plain.callContract, undefined);
  });
});

describe('EV-R05 idempotent re-import', () => {
  test('re-importing the same file changes nothing', () => {
    const { importEvaluation } = loadImporter();
    const first = importEvaluation({ doc: loadFixture(), evidenceDir: evDir });
    const before = fs.readFileSync(path.join(evDir, 'evidence.json'), 'utf8');
    const second = importEvaluation({ doc: loadFixture(), evidenceDir: evDir });
    const after = fs.readFileSync(path.join(evDir, 'evidence.json'), 'utf8');
    assert.equal(after, before);
    assert.equal(first.counts.importedAlive, 4);
    assert.equal(second.counts.importedAlive, 0);
    assert.equal(second.counts.cooldownsSet, 0);
    assert.equal(second.counts.skipped, 16);
  });

  test('CLI re-import leaves the same evidence and cooldowns', () => {
    assert.equal(runCli(['--file', FIXTURE, '--evidence-dir', evDir]).status, 0);
    const before = evidence.loadEvidence(evDir);
    const proc = runCli(['--file', FIXTURE, '--evidence-dir', evDir]);
    assert.equal(proc.status, 0);
    assert.match(proc.stdout, /imported alive 0\b/);
    const after = evidence.loadEvidence(evDir);
    assert.deepEqual(after.cooldowns, before.cooldowns);
    assert.deepEqual(after.combinations, before.combinations);
  });
});

describe('EV-R06 malformed input is rejected and nothing is written', () => {
  function expectRejected(mutate, code) {
    const doc = loadFixture();
    mutate(doc);
    const { importEvaluation, ModelEvaluationImportError } = loadImporter();
    assert.throws(
      () => importEvaluation({ doc, evidenceDir: evDir }),
      (err) => {
        assert.ok(err instanceof ModelEvaluationImportError);
        assert.equal(err.name, 'ModelEvaluationImportError');
        assert.equal(err.code, code);
        return true;
      }
    );
    assert.equal(fs.existsSync(path.join(evDir, 'evidence.json')), false);

    const fp = writeDoc(doc);
    const proc = runCli(['--file', fp, '--evidence-dir', evDir]);
    assert.equal(proc.status, 1);
    assert.match(proc.stderr, new RegExp(code));
    assert.equal(fs.existsSync(path.join(evDir, 'evidence.json')), false);
  }

  test('wrong schema id', () => {
    expectRejected((d) => {
      d.schema = 'shipde-model-evaluation/2';
    }, 'SCHEMA_INVALID');
  });

  test('a candidateKey that is not 7 parts', () => {
    expectRejected((d) => {
      d.candidates[5].candidateKey = 'direct-http::9router::9router::cl::ninerouter::x';
    }, 'CANDIDATE_KEY_INVALID');
  });

  test('ALIVE without API_PASS', () => {
    expectRejected((d) => {
      d.candidates[0].proofLevel = null;
    }, 'ALIVE_WITHOUT_API_PASS');
  });

  test('a proofLevel above API_PASS', () => {
    expectRejected((d) => {
      d.candidates[0].proofLevel = 'HARNESS_PASS';
    }, 'PROOF_LEVEL_TOO_HIGH');
  });

  test('WORK_ITEM_PASS on a non-ALIVE candidate is also too high', () => {
    expectRejected((d) => {
      d.candidates[10].proofLevel = 'WORK_ITEM_PASS';
    }, 'PROOF_LEVEL_TOO_HIGH');
  });

  test('a valid row before a malformed one is not written', () => {
    const doc = loadFixture();
    doc.candidates.push(Object.assign({}, doc.candidates[1], { proofLevel: 'HARNESS_PASS' }));
    const { importEvaluation } = loadImporter();
    assert.throws(() => importEvaluation({ doc, evidenceDir: evDir }), /PROOF_LEVEL_TOO_HIGH/);
    assert.equal(fs.existsSync(evDir), false);
  });

  test('rejection leaves an existing store byte-identical', () => {
    evidence.recordProbe(evDir, candidateFromKey(ALIVE_KEY), {
      level: evidence.Level.API,
      status: 'passed',
    });
    const before = fs.readFileSync(path.join(evDir, 'evidence.json'), 'utf8');
    const doc = loadFixture();
    doc.schema = 'other';
    const { importEvaluation } = loadImporter();
    assert.throws(() => importEvaluation({ doc, evidenceDir: evDir }), /SCHEMA_INVALID/);
    assert.equal(fs.readFileSync(path.join(evDir, 'evidence.json'), 'utf8'), before);
  });
});

describe('EV-R07 fixture hygiene', () => {
  test('fixture holds at most 20 candidates and no key material', () => {
    const raw = fs.readFileSync(FIXTURE, 'utf8');
    const doc = JSON.parse(raw);
    assert.ok(doc.candidates.length <= 20);
    assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{16,}|Bearer\s|api[_-]?key"\s*:/i);
  });
});
