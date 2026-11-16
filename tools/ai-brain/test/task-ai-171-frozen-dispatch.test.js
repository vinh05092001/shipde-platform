'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { candidateKey } = require('../discovery/identity');
const health = require('../route-health');
const frozen = require('../frozen-dispatch');
const FAKE_BASE_SHA = '0123456789abcdef0123456789abcdef01234567';
function reviewDeps(env, errors = []) {
  return {
    log: () => {},
    error: (value) => errors.push(value),
    exit: () => {},
    getTreeProvenance: () => ({ repoSha: env.realHeadSha }),
    gitStatus: '',
    commitExists: () => true,
    gitRoot: () => env.targetCwd,
    home: env.root,
    decisionDir: env.decisionDir,
    storePath: path.join(env.root, 'quota.json'),
    routeHealthFile: env.routeHealthPath,
    run: () => ({ exitCode: 0, stdout: 'Hermes response text', stderr: '' }),
  };
}

function setupEnvironment() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-171-frozen-'));
  const targetCwd = path.join(root, 'target-worktree');
  fs.mkdirSync(targetCwd, { recursive: true });

  const discoveryDir = path.join(root, 'discovery');
  fs.mkdirSync(discoveryDir, { recursive: true });

  const candidate = {
    harness: 'hermes',
    accessPath: 'cli',
    gateway: 'test-gateway',
    upstream: 'test-upstream',
    accountId: 'test-account',
    account: 'test-account',
    quotaScope: 'test-account',
    modelId: 'test-model',
    quality: 90,
    cost: 1,
    qualifiedRoles: ['writer'],
  };
  candidate.candidateKey = candidateKey(candidate);

  fs.writeFileSync(
    path.join(discoveryDir, 'catalogue.jsonl'),
    JSON.stringify({
      key: candidate.candidateKey,
      modelId: candidate.modelId,
      gateway: candidate.gateway,
      upstream: candidate.upstream,
      accountId: candidate.accountId,
      account: candidate.accountId,
      quotaScope: candidate.quotaScope,
      harness: candidate.harness,
      accessPath: candidate.accessPath,
    }) + '\n'
  );
  fs.writeFileSync(
    path.join(discoveryDir, 'freshness.json'),
    JSON.stringify({
      lastSuccessfulAt: new Date().toISOString(),
      sources: [{ id: 'test-upstream', lastAttemptAt: new Date().toISOString() }],
    })
  );

  const ticketPath = path.join(root, 'ticket.md');
  const ticketContent = [
    '# TASK-AI-171: Freeze and execute',
    'GOAL (AC): Test frozen execution',
    'VERIFY: node --test',
    'ALLOWED FILES: tools/ai-brain/cli.js, tools/ai-brain/frozen-dispatch.js',
  ].join('\n');
  fs.writeFileSync(ticketPath, ticketContent);

  const promptPath = path.join(root, 'prompt.md');
  fs.writeFileSync(promptPath, 'System prompt for frozen execution');

  const selectionPath = path.join(root, 'selection.json');
  fs.writeFileSync(
    selectionPath,
    JSON.stringify({
      chosen: candidate,
      profile: {
        taskId: 'TASK-AI-171',
        role: 'writer',
        allowedFiles: ['tools/ai-brain/cli.js', 'tools/ai-brain/frozen-dispatch.js'],
        acceptanceCriteria: ['Test frozen execution', 'node --test'],
      },
    })
  );

  const checkpointPath = path.join(root, 'checkpoint.json');
  fs.writeFileSync(
    checkpointPath,
    JSON.stringify({
      schemaVersion: 1,
      workItemId: 'TASK-AI-171',
      step: 'ranked',
      selectedCandidate: candidate,
      failedCandidates: [],
    })
  );

  const requestPath = path.join(root, 'request.json');
  fs.writeFileSync(
    requestPath,
    JSON.stringify({
      selection: 'selection.json',
      ticket: 'ticket.md',
      prompt: 'prompt.md',
      checkpoint: 'checkpoint.json',
      discoveryDir: 'discovery',
      target: {
        cwd: targetCwd,
        branch: 'feat/frozen-test',
        baseSha: FAKE_BASE_SHA,
      },
      workerTimeoutMs: 60000,
    })
  );

  const manifestPath = path.join(root, 'manifest.json');

  const routeHealthPath = path.join(root, 'route-health.json');
  health.saveStore(routeHealthPath, {
    version: 1,
    paths: {
      [health.healthKey(candidate.modelId, candidate.gateway)]: {
        modelId: candidate.modelId,
        routeId: candidate.gateway,
        status: 'AVAILABLE',
        classifierVersion: 2,
      },
    },
    events: [],
  });

  const decisionDir = path.join(root, 'decisions');
  fs.mkdirSync(decisionDir, { recursive: true });

  const realHeadSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();

  return {
    root,
    targetCwd,
    discoveryDir,
    candidate,
    ticketPath,
    promptPath,
    selectionPath,
    checkpointPath,
    requestPath,
    manifestPath,
    routeHealthPath,
    decisionDir,
    realHeadSha,
  };
}

test('module: local freeze and trusted receipt validate the same captured input bytes', (t) => {
  const env = setupEnvironment();
  t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
  const receipt = frozen.freeze(env.requestPath, env.manifestPath, {}, reviewDeps(env));
  assert.equal(receipt.manifestSha256, frozen.computeSha256(fs.readFileSync(env.manifestPath)));
  assert.equal(Object.hasOwn(receipt.manifest, 'manifestSha256'), false);
  const context = frozen.validateFrozenManifest(
    env.manifestPath,
    { manifestSha256: receipt.manifestSha256 },
    reviewDeps(env)
  );
  assert.equal(context.chosenKey, env.candidate.candidateKey);
  assert.equal(context.promptText, fs.readFileSync(env.promptPath, 'utf8'));
});

test('module: missing or invalid trusted digest refuses before manifest access', () => {
  for (const digest of [undefined, true, '', 'invalid']) {
    assert.throws(
      () => frozen.validateFrozenManifest('absent-manifest.json', { manifestSha256: digest }),
      digest === undefined ? /MANIFEST_DIGEST_REQUIRED/ : /MANIFEST_DIGEST_INVALID/
    );
  }
});

test('module: changed manifest and input bytes cannot reuse the trusted receipt', (t) => {
  for (const which of ['manifest', 'prompt']) {
    const env = setupEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const receipt = frozen.freeze(env.requestPath, env.manifestPath, {}, reviewDeps(env));
    if (which === 'manifest') {
      receipt.manifest.target.branch = 'feat/changed';
      fs.writeFileSync(env.manifestPath, JSON.stringify(receipt.manifest));
    } else fs.writeFileSync(env.promptPath, 'changed input');
    assert.throws(
      () =>
        frozen.validateFrozenManifest(
          env.manifestPath,
          { manifestSha256: receipt.manifestSha256 },
          reviewDeps(env)
        ),
      which === 'manifest' ? /MANIFEST_DIGEST_MISMATCH/ : /DRIFT_DETECTED/
    );
  }
});

test('module: missing profile identity and dirty provenance refuse without output', (t) => {
  for (const which of ['profile', 'dirty']) {
    const env = setupEnvironment();
    t.after(() => fs.rmSync(env.root, { recursive: true, force: true }));
    const deps = reviewDeps(env);
    if (which === 'profile') {
      const selection = JSON.parse(fs.readFileSync(env.selectionPath, 'utf8'));
      delete selection.profile.taskId;
      fs.writeFileSync(env.selectionPath, JSON.stringify(selection));
    } else deps.gitStatus = ' M tools/ai-brain/cli.js';
    assert.throws(
      () => frozen.freeze(env.requestPath, env.manifestPath, {}, deps),
      which === 'profile' ? /SELECTION_PROFILE_ID_REQUIRED/ : /DIRTY_WORKTREE/
    );
    assert.equal(fs.existsSync(env.manifestPath), false);
  }
});
