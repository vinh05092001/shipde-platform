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

describe('EV-R07 fixture hygiene', () => {
  test('fixture holds at most 20 candidates and no key material', () => {
    const raw = fs.readFileSync(FIXTURE, 'utf8');
    const doc = JSON.parse(raw);
    assert.ok(doc.candidates.length <= 20);
    assert.doesNotMatch(raw, /sk-[A-Za-z0-9]{16,}|Bearer\s|api[_-]?key"\s*:/i);
  });
});
