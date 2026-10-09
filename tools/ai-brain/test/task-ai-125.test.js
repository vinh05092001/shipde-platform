'use strict';

/**
 * Ship Dễ — TASK-AI-125: tests for P2 follow-ups.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration } = require('../orchestrate');
const { buildDraftBody } = require('../publisher');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse('2026-10-08T12:00:00Z');

function tmpDir(prefix) {
  const upstreamDir = path.join(__dirname, '..', '..', '..', '.upstream-tmp');
  fs.mkdirSync(upstreamDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(upstreamDir, prefix));
  dirs.push(dir);
  return dir;
}

function cand(id, role, over) {
  return Object.assign(
    {
      harness: 'hermes',
      accessPath: 'cli-' + id,
      gateway: 'gw-' + id,
      upstream: 'up-' + id,
      accountId: 'acct-' + id,
      quotaScope: 'scope-' + id,
      modelId: 'model-' + id,
      source: 'gw-' + id,
      qualifiedRoles: [role],
      capabilities: { contextWindow: 64000 },
      cost: 1,
    },
    over || {}
  );
}

function makeRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const git = (args) => {
    const result = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(
      result.status,
      0,
      (result.stderr || result.stdout || '') + ' [' + args.join(' ') + ']'
    );
    return (result.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'task-ai-125@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-125 test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'base']);
  return { dir, git, base: git(['rev-parse', 'HEAD']) };
}

function commitIn(repo, name, content) {
  fs.writeFileSync(path.join(repo.dir, name), content);
  repo.git(['add', '.']);
  repo.git(['commit', '-q', '-m', 'work ' + name]);
  return repo.git(['rev-parse', 'HEAD']);
}

function approvalRecord(approvalId, reviewedSha) {
  return {
    approvalId,
    state: 'APPROVED',
    reviewedSha,
    verdict: 'PASS',
    reviewer:
      'hermes::cli-reviewera::gw-reviewera::up-reviewera::acct-reviewera::scope-reviewera::model-reviewera',
    issuedAt: new Date(NOW).toISOString(),
    expiry: '2100-01-01T00:00:00.000Z',
  };
}

function writeApproval(registryPath, record) {
  const registry = fs.existsSync(registryPath)
    ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
    : {};
  registry[record.approvalId] = record;
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
}

function setup(prefix, specs, config) {
  const cfg = config || {};
  const dir = tmpDir(prefix);
  const repo = makeRepo(path.join(dir, 'repo'));
  const registryPath = path.join(dir, 'approvals.json');
  const state = {
    calls: [],
    publishCalls: [],
    passSha: {},
    reviewSha: {},
  };
  const writer = cand('writer', 'author.foundation', { cost: 0.1 });
  const reviewerA = cand('reviewera', 'reviewer.primary');

  const run = (job) => {
    state.calls.push({
      workItemId: job.workItemId,
      isReview: Boolean(job.isReview),
      baseSha: job.baseSha,
    });
    if (job.usageFile) {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + state.calls.length }));
    }
    if (job.isReview) {
      const itemId = String(job.workItemId).replace(/-review$/, '');
      state.reviewSha[itemId] = job.baseSha;
      const approvalId = (cfg.approvals || {})[itemId];
      if (approvalId) writeApproval(registryPath, approvalRecord(approvalId, job.baseSha));
      fs.writeFileSync(
        job.verdictFile || path.join(job.cwd, 'verdict.json'),
        JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
      );
      return { exitCode: 0, stdout: 'review pass' };
    }
    state.passSha[job.workItemId] = commitIn(
      repo,
      'change-' + job.workItemId + '.js',
      'done for ' + job.workItemId + '\n'
    );
    return { exitCode: 0, stdout: 'worker completed', headSha: state.passSha[job.workItemId] };
  };

  const opts = {
    specs,
    candidates: [writer, reviewerA],
    registry: { sources: [] },
    checkpointFile: path.join(dir, 'checkpoint.json'),
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    now: NOW,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.base,
    ranking: {
      headrooms: {
        'acct-writer': { status: 'available' },
        'acct-reviewera': { status: 'available' },
      },
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    run,
    repairer: async (_findings, sha) => ({ sha }),
    publisher: (pubOpts) => {
      state.publishCalls.push(pubOpts);
      return (
        (cfg.publisher && cfg.publisher(pubOpts)) || {
          status: 'published',
          sha: pubOpts.reviewedSha,
          branch: pubOpts.branch,
          approvalId: pubOpts.approvalId,
        }
      );
    },
    publication: Object.assign(
      {
        approvalIds: Object.keys(cfg.approvals || {}).map((id) => cfg.approvals[id]),
        registryPath,
        expiry: NOW + 60 * 60 * 1000,
        remoteUrl: 'https://github.com/shipde/shipde-platform.git',
      },
      cfg.publication || {}
    ),
  };

  return { dir, repo, registryPath, state, opts, writer, reviewerA };
}

const GATE5_SPEC_111 = {
  id: 'TASK-AI-111',
  roleRequirement: { role: 'author.foundation' },
  complexity: 'standard',
  files: [
    'tools/ai-brain/slugify.js',
    'tools/ai-brain/test/proof-slugify.test.js',
    'docs/product-spec/work-items/TASK-AI-111.md',
    'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv',
  ],
  dependencies: [],
  acceptanceCriteria: [
    'SL-R01: slugify(text) lower-cases, replaces runs of non [a-z0-9] with a single dash',
  ],
  verification: {
    command: 'node --test tools/ai-brain/test/proof-slugify.test.js',
    expect: 'fail 0',
  },
};

test('TASK-AI-125: a finding whose id contains <x> produces a body that does not match /<[^>\\n]+>/', () => {
  const manifest = {
    verdict: 'PASS',
    reviewedCommit: '1234567890123456789012345678901234567890',
    writerCandidateKey: 'w',
    reviewerCandidateKey: 'r',
    tests: [{ command: 'npm test', result: 'pass' }],
    findings: [{ id: '<x> injected', status: 'resolved', summary: 'test' }],
  };
  const evidence = {
    workItemId: 'FEAT-1',
    reviewManifest: 'path/to/manifest',
    reviewArtifact: 'path/to/artifact',
    decisionEvidence: 'path/to/decision',
    failBefore: { command: 'test', exitCode: 1 },
    outcome: 'outcome',
  };
  const body = buildDraftBody(manifest, evidence);

  const CONTRACT_GATE_BODY_PATTERN = /<[^>\n]+>/;
  assert.ok(!CONTRACT_GATE_BODY_PATTERN.test(body), 'Body should not contain un-neutralised <...>');
  assert.ok(body.includes('‹x› injected'), 'Body should contain neutralised finding id');
});

test('TASK-AI-125: pass the run goal into checkpoint normalisation for real', async () => {
  const f = setup('task-ai-125-', [GATE5_SPEC_111], {
    approvals: { 'TASK-AI-111': 'AP-125-R02' },
  });

  const GOAL = 'add a pure slugify helper and a branch-name helper';
  await runOrchestration(GOAL, f.opts);

  const checkpointOnDisk = JSON.parse(fs.readFileSync(f.opts.checkpointFile, 'utf8'));
  const reviews = checkpointOnDisk.reviews || [];
  const review = reviews.find((r) => r.workItemId === 'TASK-AI-111');

  assert.ok(review, 'checkpoint review must exist');
  assert.equal(
    review.draftTitle,
    '[TASK-AI-111] ' + GOAL,
    'draftTitle must fall back to the goal-based title, not "work item"'
  );
});
