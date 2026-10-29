'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'cli.js');

function candidateKey(c) {
  return [
    c.harness || 'http',
    c.accessPath || '9router',
    c.gateway || '9router',
    c.upstream || 'gh',
    c.account || 'acc-1',
    c.quotaScope || c.account || 'acc-1',
    c.modelId || 'gh/gpt-4o',
  ].join('\u241f');
}

function writeDiscoveryCatalogue(dir, candidates) {
  const lines = candidates.map((c, idx) =>
    JSON.stringify({
      type: 'transition',
      ts: new Date(Date.UTC(2026, 8, 25, 1, 0, idx)).toISOString(),
      runId: `mvp-extra-${idx}`,
      key: candidateKey(c),
      harness: c.harness || 'http',
      accessPath: c.accessPath || '9router',
      gateway: c.gateway || '9router',
      upstream: c.upstream || 'gh',
      account: c.account || 'acc-1',
      quotaScope: c.quotaScope || c.account || 'acc-1',
      modelId: c.modelId || 'gh/gpt-4o',
      base: c.modelId || 'gh/gpt-4o',
      sourceIds: [c.gateway || '9router'],
      state: 'AVAILABLE',
      resultState: 'PASS',
      passes: 1,
      evidence: [{ ts: '2026-09-25T01:00:00.000Z', status: 'PASS' }],
    })
  );
  fs.writeFileSync(path.join(dir, 'catalogue.jsonl'), lines.join('\n') + '\n', 'utf8');
}

function runDispatch(tmpDir, args) {
  return spawnSync(process.execPath, [CLI, 'dispatch', ...args], {
    encoding: 'utf8',
    cwd: tmpDir,
    env: {
      ...process.env,
      HOME: path.join(tmpDir, 'home'),
      USERPROFILE: path.join(tmpDir, 'home'),
      APPDATA: path.join(tmpDir, 'appdata'),
    },
    timeout: 15000,
  });
}

describe('MVP controller fallback contract supplements', () => {
  let tmpDir;
  let discoveryDir;
  let evidenceDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-ctrl-extra-'));
    discoveryDir = path.join(tmpDir, 'discovery');
    evidenceDir = path.join(tmpDir, 'evidence');
    fs.mkdirSync(discoveryDir, { recursive: true });
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'home'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'appdata'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('records first choice separately from selected fallback and explains the failed attempt', () => {
    writeDiscoveryCatalogue(discoveryDir, [
      { upstream: 'gh', account: 'acc-1', quotaScope: 'acc-1', modelId: 'gh/gpt-4o' },
      {
        harness: 'paseo',
        accessPath: 'opencode',
        gateway: 'agentrouter',
        upstream: 'kr',
        account: 'acc-2',
        quotaScope: 'acc-2',
        modelId: 'kr/claude-opus-5',
      },
    ]);

    const decisionLog = path.join(tmpDir, 'decision.json');
    const checkpoint = path.join(tmpDir, 'checkpoint.json');
    const res = runDispatch(tmpDir, [
      '--dry-run',
      '--item',
      'TASK-MVP-EXTRA',
      '--simulate-failure',
      'first',
      '--checkpoint',
      checkpoint,
      '--decision-log',
      decisionLog,
      '--discovery-dir',
      discoveryDir,
      '--evidence-dir',
      evidenceDir,
    ]);

    assert.equal(res.status, 0, res.stderr || res.stdout);
    const log = JSON.parse(fs.readFileSync(decisionLog, 'utf8'));

    assert.ok(log.firstChoice, 'firstChoice must be recorded');
    assert.ok(log.selected, 'selected must be recorded');
    assert.notEqual(log.firstChoice, log.selected, 'fallback changes selected candidate');
    assert.equal(log.selected, log.fallback.candidateKey);
    assert.equal(log.failure.candidate, log.firstChoice);
    assert.match(
      `${log.failure.innermostCause} ${log.failure.classifierScope} ${log.fallback.reason}`,
      /credit|quota|upstream|different failure domain/i,
      'first attempt reason must explain why fallback was chosen'
    );
  });

  test('resume does not retry a cooled down or deferred candidate', () => {
    writeDiscoveryCatalogue(discoveryDir, [
      { upstream: 'gh', account: 'acc-1', quotaScope: 'acc-1', modelId: 'gh/gpt-4o' },
      {
        harness: 'paseo',
        accessPath: 'opencode',
        gateway: 'agentrouter',
        upstream: 'kr',
        account: 'acc-2',
        quotaScope: 'acc-2',
        modelId: 'kr/claude-opus-5',
      },
    ]);

    const checkpoint = path.join(tmpDir, 'checkpoint.json');
    const firstLog = path.join(tmpDir, 'first.json');
    const resumeLog = path.join(tmpDir, 'resume.json');

    const first = runDispatch(tmpDir, [
      '--dry-run',
      '--item',
      'TASK-MVP-RESUME',
      '--simulate-failure',
      'first',
      '--checkpoint',
      checkpoint,
      '--decision-log',
      firstLog,
      '--discovery-dir',
      discoveryDir,
      '--evidence-dir',
      evidenceDir,
    ]);
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const failed = JSON.parse(fs.readFileSync(firstLog, 'utf8')).firstChoice;
    const resumed = runDispatch(tmpDir, [
      '--dry-run',
      '--item',
      'TASK-MVP-RESUME',
      '--checkpoint',
      checkpoint,
      '--decision-log',
      resumeLog,
      '--discovery-dir',
      discoveryDir,
      '--evidence-dir',
      evidenceDir,
    ]);
    assert.equal(resumed.status, 0, resumed.stderr || resumed.stdout);

    const log = JSON.parse(fs.readFileSync(resumeLog, 'utf8'));
    const excludedFailed = (log.excluded || []).find((entry) => entry.candidateKey === failed);

    assert.equal(log.resumed, true);
    assert.notEqual(log.selected, failed, 'resume must not retry the failed candidate');
    assert.ok(excludedFailed, 'failed candidate remains excluded on resume');
    assert.match(
      excludedFailed.reason,
      /checkpoint resume skipped|failed|deferred|cool/i,
      'excluded reason must explain the resume skip'
    );
  });
});
