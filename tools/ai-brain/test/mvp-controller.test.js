'use strict';

/**
 * Ship Dễ — MVP Controller Contract Test Suite (Lane 2)
 *
 * Verifies the dry-run controller contract:
 *   node tools/ai-brain/cli.js dispatch --dry-run --item <ID> --simulate-failure <candidateKey|first> --checkpoint <file>
 *
 * Contract requirements:
 *   1. First source fails with quota exhaustion (402 inside 503) -> cooldown applied
 *      at classifier's scope; fallback selected.
 *   2. First source fails with a generic error -> fallback is from a DIFFERENT
 *      failure domain (upstream/account/gateway) unless proven candidate-only.
 *   3. Checkpoint/resume: second run resumes from saved step, failed candidate is
 *      never re-selected, decision log records resume.
 *   4. An UNTESTED candidate is never selected as if PASS and never reported PASS.
 *   5. Decision log contains every required field; every excluded candidate has
 *      a reason code; count in == count out.
 *
 * All tests use isolated temp dirs and hermetic fixtures; no real agents or network calls.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'cli.js');

function parseCandidateParts(key) {
  if (!key || typeof key !== 'string') {
    return {
      harness: '',
      accessPath: '',
      gateway: '',
      upstream: '',
      account: '',
      accountId: '',
      quotaScope: '',
      modelId: '',
    };
  }
  const sep = key.includes('\u241F') ? '\u241F' : '::';
  const parts = key.split(sep);
  return {
    harness: parts[0] || '',
    accessPath: parts[1] || '',
    gateway: parts[2] || '',
    upstream: parts[3] || '',
    account: parts[4] || '',
    accountId: parts[4] || '',
    quotaScope: parts[5] || '',
    modelId: parts[6] || '',
  };
}

function extractLogFields(log) {
  const selected = log.selected || log.selectedCandidate || null;
  const excluded = log.excluded || log.excludedCandidates || [];
  const failure = log.failure || log.simulatedFailure || null;
  const fallback = log.fallback || null;
  const checkpoint = log.checkpoint || null;
  const candidates = log.candidates || [];
  const quotaState = log.quotaState || null;

  let failureNorm = null;
  if (failure) {
    const rawFail = failure.failure || failure;
    const bodyText = rawFail.body || rawFail.stderr || '';
    const innerMatch = bodyText.match(/[\[(]\s*(401|402|403|404|429)\s*[\])]/);
    const innerStatus =
      failure.innermostStatus !== undefined
        ? failure.innermostStatus
        : innerMatch
          ? parseInt(innerMatch[1], 10)
          : rawFail.httpStatus !== undefined
            ? rawFail.httpStatus
            : rawFail.exitCode;

    failureNorm = {
      candidateKey: failure.candidateKey || failure.candidate || '',
      innermostStatus: innerStatus,
      cause: failure.cause || failure.innermostCause || 'unknown',
      scope: failure.scope || failure.classifierScope || 'unknown',
      raw: failure,
    };
  }

  let fallbackNorm = null;
  if (fallback) {
    fallbackNorm = {
      candidateKey: fallback.candidateKey || fallback.chosen || fallback.candidate || '',
      reason: fallback.reason || '',
      raw: fallback,
    };
  }

  return {
    selected,
    excluded,
    failure: failureNorm,
    fallback: fallbackNorm,
    checkpoint,
    candidates,
    quotaState,
  };
}

describe('MVP Controller Contract (tools/ai-brain/cli.js dispatch)', () => {
  let tmpDir;
  let homeDir;
  let appdataDir;
  let discoveryDir;
  let evidenceDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-ctrl-contract-'));
    homeDir = path.join(tmpDir, 'home');
    appdataDir = path.join(tmpDir, 'appdata');
    discoveryDir = path.join(tmpDir, 'discovery');
    evidenceDir = path.join(tmpDir, 'evidence');

    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(appdataDir, { recursive: true });
    fs.mkdirSync(discoveryDir, { recursive: true });
    fs.mkdirSync(evidenceDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function writeDiscoveryCatalogue(candidates) {
    const cataloguePath = path.join(discoveryDir, 'catalogue.jsonl');
    const lines = candidates.map((c, idx) => {
      const harness = c.harness || 'http';
      const accessPath = c.accessPath || '9router';
      const gateway = c.gateway || '9router';
      const upstream = c.upstream || 'gh';
      const account = c.account || c.accountId || '*';
      const quotaScope = c.quotaScope || (account !== '*' ? account : upstream);
      const modelId = c.modelId || 'gh/gpt-4o';
      const key = [harness, accessPath, gateway, upstream, account, quotaScope, modelId].join(
        '\u241F'
      );
      return JSON.stringify({
        type: 'transition',
        ts: new Date(Date.now() - 60000 + idx * 1000).toISOString(),
        runId: `run-${idx}`,
        key,
        harness,
        accessPath,
        gateway,
        upstream,
        account,
        quotaScope,
        modelId,
        base: modelId.replace(/^[^/]+\//, ''),
        sourceIds: [gateway],
        state: c.state || 'AVAILABLE',
        resultState: c.resultState || 'PASS',
        passes: c.passes !== undefined ? c.passes : c.resultState === 'UNTESTED' ? 0 : 1,
        failures: c.failures || [],
        evidence: c.evidence || [],
      });
    });
    fs.writeFileSync(cataloguePath, lines.join('\n') + '\n', 'utf8');
  }

  function runDispatch(cliArgs) {
    const args = ['dispatch', ...cliArgs];
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      cwd: tmpDir,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        APPDATA: appdataDir,
      },
      timeout: 15000,
    });
  }

  test('1. first source fails with quota exhaustion (402 inside 503) -> cooldown applied at classifier scope; fallback selected', () => {
    const candA = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'gh',
      account: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o',
      cost: 5,
      quality: 95,
      resultState: 'PASS',
    };
    const candB = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'gh',
      account: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o-mini',
      cost: 2,
      quality: 85,
      resultState: 'PASS',
    };
    const candC = {
      harness: 'paseo',
      accessPath: 'opencode',
      gateway: 'agentrouter',
      upstream: 'kr',
      account: 'acc-2',
      quotaScope: 'acc-2',
      modelId: 'kr/claude-sonnet',
      cost: 15,
      quality: 90,
      resultState: 'PASS',
    };

    writeDiscoveryCatalogue([candA, candB, candC]);

    const checkpointFile = path.join(tmpDir, 'chk-1.json');
    const decisionLogFile = path.join(tmpDir, 'dec-1.json');

    const res = runDispatch([
      '--dry-run',
      '--item',
      'TASK-QUOTA-FAIL',
      '--simulate-failure',
      'first',
      '--checkpoint',
      checkpointFile,
      '--decision-log',
      decisionLogFile,
      '--discovery-dir',
      discoveryDir,
      '--evidence-dir',
      evidenceDir,
    ]);

    assert.equal(
      res.status,
      0,
      `Dispatch command failed with exit code ${res.status}.\nStderr: ${res.stderr}\nStdout: ${res.stdout}`
    );
    assert.ok(
      fs.existsSync(decisionLogFile),
      `Expected decision log file to exist at ${decisionLogFile}`
    );

    const log = JSON.parse(fs.readFileSync(decisionLogFile, 'utf8'));
    const { selected, failure, fallback, candidates, excluded } = extractLogFields(log);

    // 1. Failure was captured and classified as quota exhaustion
    assert.ok(failure, 'Decision log must record simulated failure');
    assert.equal(
      failure.innermostStatus,
      402,
      `Expected innermostStatus to be 402, got ${failure.innermostStatus}`
    );
    assert.match(
      failure.cause,
      /quota|credit|limit/i,
      `Expected failure cause to indicate quota exhaustion, got ${failure.cause}`
    );
    assert.ok(
      ['upstream', 'account'].includes(failure.scope),
      `Expected failure scope to be upstream or account, got ${failure.scope}`
    );

    // 2. Fallback was selected and matches overall selected candidate
    assert.ok(fallback, 'Decision log must record fallback');
    assert.ok(fallback.candidateKey, 'Fallback must have a candidateKey');
    assert.ok(fallback.reason, 'Fallback must have an explanatory reason');
    assert.equal(
      selected,
      fallback.candidateKey,
      'Selected candidate must match the fallback candidate'
    );
    assert.notEqual(
      selected,
      failure.candidateKey,
      'Selected candidate must not be the failed candidate'
    );

    // 3. Cooldown applied at classifier scope: candidates sharing the failed scope must not be selected
    const failedParts = parseCandidateParts(failure.candidateKey);
    const fallbackParts = parseCandidateParts(fallback.candidateKey);

    if (failure.scope === 'upstream') {
      assert.notEqual(
        fallbackParts.upstream,
        failedParts.upstream,
        `Fallback candidate must not share upstream '${failedParts.upstream}' when cooled down at upstream scope`
      );
    } else if (failure.scope === 'account') {
      assert.notEqual(
        fallbackParts.account,
        failedParts.account,
        `Fallback candidate must not share account '${failedParts.account}' when cooled down at account scope`
      );
    }

    // Any candidate sharing the failed scope should be excluded
    const sameScopeExcluded = excluded.some((ex) => {
      const exKey = ex.candidateKey || ex.offeringId || ex.key || '';
      const exParts = parseCandidateParts(exKey);
      return (
        exKey !== failure.candidateKey &&
        (failure.scope === 'upstream'
          ? exParts.upstream === failedParts.upstream
          : exParts.account === failedParts.account)
      );
    });
    assert.ok(
      sameScopeExcluded || candidates.length <= 2,
      'Other candidates within the same failure scope must be excluded under scoped cooldown'
    );
  });

  test('2. first source fails with a generic error -> fallback is from a DIFFERENT failure domain (upstream/account/gateway) unless the failure is proven candidate-only', () => {
    const candA = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'gh',
      account: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o',
      resultState: 'PASS',
    };
    const candB = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'gh',
      account: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o-mini',
      resultState: 'PASS',
    };
    const candC = {
      harness: 'paseo',
      accessPath: 'opencode',
      gateway: 'agentrouter',
      upstream: 'kr',
      account: 'acc-2',
      quotaScope: 'acc-2',
      modelId: 'kr/claude-opus-5',
      resultState: 'PASS',
    };

    writeDiscoveryCatalogue([candA, candB, candC]);

    const checkpointFile = path.join(tmpDir, 'chk-2.json');
    const decisionLogFile = path.join(tmpDir, 'dec-2.json');

    const res = runDispatch([
      '--dry-run',
      '--item',
      'TASK-GENERIC-FAIL',
      '--simulate-failure',
      'first',
      '--checkpoint',
      checkpointFile,
      '--decision-log',
      decisionLogFile,
      '--discovery-dir',
      discoveryDir,
      '--evidence-dir',
      evidenceDir,
    ]);

    assert.equal(
      res.status,
      0,
      `Dispatch command failed with exit code ${res.status}.\nStderr: ${res.stderr}\nStdout: ${res.stdout}`
    );
    assert.ok(
      fs.existsSync(decisionLogFile),
      `Expected decision log file to exist at ${decisionLogFile}`
    );

    const log = JSON.parse(fs.readFileSync(decisionLogFile, 'utf8'));
    const { selected, failure, fallback } = extractLogFields(log);

    assert.ok(failure, 'Decision log must record failure');
    assert.ok(fallback, 'Decision log must record fallback');
    assert.equal(selected, fallback.candidateKey, 'Selected must match fallback candidateKey');
    assert.notEqual(
      failure.candidateKey,
      fallback.candidateKey,
      'Fallback must differ from failed candidate'
    );

    const failedParts = parseCandidateParts(failure.candidateKey);
    const fallbackParts = parseCandidateParts(fallback.candidateKey);

    const isDifferentFailureDomain =
      (fallbackParts.upstream && fallbackParts.upstream !== failedParts.upstream) ||
      (fallbackParts.account &&
        fallbackParts.account !== '*' &&
        fallbackParts.account !== failedParts.account) ||
      (fallbackParts.gateway && fallbackParts.gateway !== failedParts.gateway);

    assert.ok(
      isDifferentFailureDomain,
      `Fallback candidate (${fallback.candidateKey}) must come from a DIFFERENT failure domain (upstream, account, or gateway) than failed candidate (${failure.candidateKey})`
    );
  });

  test('3. checkpoint/resume: second run resumes, failed candidate not re-selected, decision log shows resume', () => {
    const candA = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'gh',
      account: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o',
      resultState: 'PASS',
    };
    const candB = {
      harness: 'paseo',
      accessPath: 'opencode',
      gateway: 'agentrouter',
      upstream: 'kr',
      account: 'acc-2',
      quotaScope: 'acc-2',
      modelId: 'kr/claude-sonnet',
      resultState: 'PASS',
    };

    writeDiscoveryCatalogue([candA, candB]);

    const checkpointFile = path.join(tmpDir, 'chk-3.json');
    const decisionLog1File = path.join(tmpDir, 'dec-3-run1.json');
    const decisionLog2File = path.join(tmpDir, 'dec-3-run2.json');

    // Run 1: simulates failure and writes checkpoint
    const res1 = runDispatch([
      '--dry-run',
      '--item',
      'TASK-RESUME-TEST',
      '--simulate-failure',
      'first',
      '--checkpoint',
      checkpointFile,
      '--decision-log',
      decisionLog1File,
      '--discovery-dir',
      discoveryDir,
      '--evidence-dir',
      evidenceDir,
    ]);

    assert.equal(
      res1.status,
      0,
      `Run 1 failed with exit code ${res1.status}.\nStderr: ${res1.stderr}\nStdout: ${res1.stdout}`
    );
    assert.ok(
      fs.existsSync(checkpointFile),
      `Expected checkpoint file to exist at ${checkpointFile}`
    );
    assert.ok(
      fs.existsSync(decisionLog1File),
      `Expected run 1 decision log to exist at ${decisionLog1File}`
    );

    const log1 = JSON.parse(fs.readFileSync(decisionLog1File, 'utf8'));
    const fields1 = extractLogFields(log1);
    const failedKey = fields1.failure ? fields1.failure.candidateKey : fields1.selected;
    assert.ok(failedKey, 'Run 1 must identify a failed candidate');

    // Run 2: re-run with the same checkpoint file to resume
    const res2 = runDispatch([
      '--dry-run',
      '--item',
      'TASK-RESUME-TEST',
      '--checkpoint',
      checkpointFile,
      '--decision-log',
      decisionLog2File,
      '--discovery-dir',
      discoveryDir,
      '--evidence-dir',
      evidenceDir,
    ]);

    assert.equal(
      res2.status,
      0,
      `Run 2 (resume) failed with exit code ${res2.status}.\nStderr: ${res2.stderr}\nStdout: ${res2.stdout}`
    );
    assert.ok(
      fs.existsSync(decisionLog2File),
      `Expected run 2 decision log to exist at ${decisionLog2File}`
    );

    const log2 = JSON.parse(fs.readFileSync(decisionLog2File, 'utf8'));
    const fields2 = extractLogFields(log2);

    // Verify resume is noted in the decision log
    const showsResume =
      log2.resumed === true ||
      log2.mode === 'resume' ||
      log2.stage === 'resumed' ||
      (fields2.checkpoint && fields2.checkpoint.step === 'fallback_selected') ||
      (fields2.checkpoint && fields2.checkpoint.loaded === true) ||
      (fields2.checkpoint && Array.isArray(fields2.checkpoint.failedCandidates));

    assert.ok(showsResume, 'Run 2 decision log must record that execution resumed from checkpoint');

    // Verify failed candidate from run 1 is NEVER re-selected
    assert.notEqual(
      fields2.selected,
      failedKey,
      `Run 2 must not re-select previously failed candidate ${failedKey}`
    );

    // Verify failed candidate is recorded as excluded or failed in run 2
    const isExcludedInRun2 = fields2.excluded.some(
      (e) => (e.candidateKey || e.offeringId || e.key) === failedKey
    );
    const inFailedList =
      fields2.checkpoint &&
      Array.isArray(fields2.checkpoint.failedCandidates) &&
      fields2.checkpoint.failedCandidates.includes(failedKey);

    assert.ok(
      isExcludedInRun2 || inFailedList,
      `Failed candidate ${failedKey} must be tracked as excluded or failed upon resume`
    );
  });

  test('4. an UNTESTED candidate is never selected as if PASS and never reported PASS', () => {
    const candUntested = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'tencent',
      account: 'acc-untested',
      quotaScope: 'acc-untested',
      modelId: 'tencent/hy3-preview',
      state: 'UNKNOWN',
      resultState: 'UNTESTED',
      passes: 0,
      cost: 1,
      quality: 99,
    };
    const candPass = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'gh',
      account: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o',
      state: 'AVAILABLE',
      resultState: 'PASS',
      passes: 5,
      cost: 10,
      quality: 80,
    };

    writeDiscoveryCatalogue([candUntested, candPass]);

    const checkpointFile = path.join(tmpDir, 'chk-4.json');
    const decisionLogFile = path.join(tmpDir, 'dec-4.json');

    const res = runDispatch([
      '--dry-run',
      '--item',
      'TASK-UNTESTED-GATE',
      '--checkpoint',
      checkpointFile,
      '--decision-log',
      decisionLogFile,
      '--discovery-dir',
      discoveryDir,
      '--evidence-dir',
      evidenceDir,
    ]);

    assert.equal(
      res.status,
      0,
      `Dispatch command failed with exit code ${res.status}.\nStderr: ${res.stderr}\nStdout: ${res.stdout}`
    );
    assert.ok(
      fs.existsSync(decisionLogFile),
      `Expected decision log file to exist at ${decisionLogFile}`
    );

    const log = JSON.parse(fs.readFileSync(decisionLogFile, 'utf8'));
    const { candidates, selected, quotaState } = extractLogFields(log);

    // 1. In candidate listing, untested candidate must never be reported as PASS
    const untestedInCandidates = candidates.find(
      (c) =>
        (c.modelId || '').includes('hy3-preview') ||
        (c.offeringId || '').includes('hy3-preview') ||
        (c.upstream === 'tencent' &&
          (c.account === 'acc-untested' || c.accountId === 'acc-untested'))
    );

    if (untestedInCandidates) {
      assert.notEqual(
        String(untestedInCandidates.status || '').toUpperCase(),
        'PASS',
        'Untested candidate status must not be reported as PASS'
      );
      assert.notEqual(
        String(untestedInCandidates.resultState || '').toUpperCase(),
        'PASS',
        'Untested candidate resultState must not be reported as PASS'
      );
    }

    // 2. In quotaState, untested candidate must never be recorded as PASS
    if (quotaState && typeof quotaState === 'object') {
      for (const [key, q] of Object.entries(quotaState)) {
        if (key.includes('hy3-preview')) {
          assert.notEqual(
            String(q.status || q.resultState || '').toUpperCase(),
            'PASS',
            'Untested candidate in quotaState must not be reported as PASS'
          );
        }
      }
    }

    // 3. Selection check: untested candidate must not be chosen over a verified PASS candidate
    if (untestedInCandidates) {
      const untestedKey = untestedInCandidates.offeringId || untestedInCandidates.key;
      assert.notEqual(
        selected,
        untestedKey,
        'Untested candidate must not be selected as if it were PASS over a verified candidate'
      );
    }
  });

  test('5. decision log contains every required field; every excluded candidate has a reason code; count in == count out', () => {
    const cand1 = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'gh',
      account: 'acc-1',
      quotaScope: 'acc-1',
      modelId: 'gh/gpt-4o',
      resultState: 'PASS',
    };
    const cand2 = {
      harness: 'paseo',
      accessPath: 'opencode',
      gateway: 'agentrouter',
      upstream: 'kr',
      account: 'acc-2',
      quotaScope: 'acc-2',
      modelId: 'kr/claude-sonnet',
      resultState: 'PASS',
    };
    const cand3 = {
      harness: 'http',
      accessPath: '9router',
      gateway: '9router',
      upstream: 'invalid-upstream',
      account: 'acc-3',
      quotaScope: 'acc-3',
      modelId: 'invalid/model-x',
      resultState: 'FAIL',
      failures: [{ reason: 'upstream unreachable' }],
    };

    writeDiscoveryCatalogue([cand1, cand2, cand3]);

    const checkpointFile = path.join(tmpDir, 'chk-5.json');
    const decisionLogFile = path.join(tmpDir, 'dec-5.json');

    const res = runDispatch([
      '--dry-run',
      '--item',
      'TASK-SCHEMA-COUNT',
      '--checkpoint',
      checkpointFile,
      '--decision-log',
      decisionLogFile,
      '--discovery-dir',
      discoveryDir,
      '--evidence-dir',
      evidenceDir,
    ]);

    assert.equal(
      res.status,
      0,
      `Dispatch command failed with exit code ${res.status}.\nStderr: ${res.stderr}\nStdout: ${res.stdout}`
    );
    assert.ok(
      fs.existsSync(decisionLogFile),
      `Expected decision log file to exist at ${decisionLogFile}`
    );

    const log = JSON.parse(fs.readFileSync(decisionLogFile, 'utf8'));

    // Check required top-level contract fields
    assert.ok(Array.isArray(log.candidates), "Decision log must contain 'candidates' array");
    const excludedList = log.excluded || log.excludedCandidates;
    assert.ok(
      Array.isArray(excludedList),
      "Decision log must contain 'excluded' (or 'excludedCandidates') array"
    );

    const selectedVal = log.selected !== undefined ? log.selected : log.selectedCandidate;
    assert.ok(selectedVal !== undefined, "Decision log must contain 'selected' field");

    assert.ok(log.quotaState, "Decision log must contain 'quotaState' field");
    assert.ok(
      'failure' in log || 'simulatedFailure' in log,
      "Decision log must contain 'failure' field"
    );
    assert.ok('fallback' in log, "Decision log must contain 'fallback' field");
    assert.ok(log.checkpoint, "Decision log must contain 'checkpoint' field");

    // Check candidate seven-part shape
    for (const c of log.candidates) {
      assert.ok(typeof c.harness === 'string', 'Candidate harness must be a string');
      assert.ok(typeof c.accessPath === 'string', 'Candidate accessPath must be a string');
      assert.ok(typeof c.gateway === 'string', 'Candidate gateway must be a string');
      assert.ok(typeof c.upstream === 'string', 'Candidate upstream must be a string');
      assert.ok(
        typeof (c.account !== undefined ? c.account : c.accountId) === 'string',
        'Candidate account/accountId must be a string'
      );
      assert.ok(typeof c.quotaScope === 'string', 'Candidate quotaScope must be a string');
      assert.ok(typeof c.modelId === 'string', 'Candidate modelId must be a string');
    }

    // Check excluded candidate reason codes
    for (const ex of excludedList) {
      const exKey = ex.candidateKey || ex.offeringId || ex.key;
      assert.ok(exKey, 'Excluded candidate must identify candidateKey / offeringId');
      const reasonCode = ex.reasonCode || ex.reason || ex.code;
      assert.ok(
        typeof reasonCode === 'string' && reasonCode.trim().length > 0,
        `Excluded candidate ${exKey} must provide a non-empty reason code`
      );
    }

    // Check checkpoint { path, step }
    assert.ok(
      typeof log.checkpoint.path === 'string' && log.checkpoint.path.length > 0,
      'Checkpoint must have a path string'
    );
    assert.ok(
      typeof log.checkpoint.step === 'string' && log.checkpoint.step.length > 0,
      'Checkpoint must have a step string'
    );

    // Count in == count out
    // Total input candidates = excluded + selected (or count in ranking / evaluation)
    const countIn = log.candidates.length;
    const countExcluded = excludedList.length;
    const countSelected = selectedVal ? 1 : 0;

    assert.equal(
      countIn,
      countExcluded + countSelected,
      `Count in (${countIn}) must equal count out (excluded: ${countExcluded} + selected: ${countSelected})`
    );
  });
});
