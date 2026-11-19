'use strict';

/**
 * Ship Dễ — TASK-AI-122: each Work Item in a run publishes its own draft PR with
 * its own review and approval.
 *
 * Uses the task-ai-119/120 harness (runOrchestration with real temp git repos
 * under the repo's .upstream-tmp) with a fake publisher — no network.
 *
 * PI-R01: the review manifest and artifact are per Work Item
 *   (review-manifest-<workItemId>.json / review-artifact-<workItemId>.md in the
 *   decision dir), written at review time, and publication() validates each
 *   item against its own manifest. Two reviewed items in one run both publish;
 *   neither is refused with WORK_ITEM_MISMATCH because the shared file was
 *   overwritten by the last reviewed item.
 *
 * PI-R02: the CLI accepts several approvals (`--approval ID1,ID2`). An approval
 *   applies only to the item whose reviewed SHA it is bound to, matched by the
 *   approval record's reviewedSha. An item without a matching approval is
 *   reported NOT_REQUESTED (APPROVAL_NOT_SUPPLIED), which is not a refusal and
 *   does not trip the replay guard.
 *
 * PI-R03: each published item gets its own draft PR titled
 *   "[<workItemId>] <outcome>" from that item's spec (never specs[0]), with a
 *   body naming only that Work Item. A dependent stacks its PR base branch on
 *   the dependency's published branch, so the PR diff carries only the
 *   dependent's own commit(s). A dependent whose dependency was not published
 *   is not published (DEPENDENCY_NOT_PUBLISHED).
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration } = require('../orchestrate');
const cli = require('../cli');
const { createDraftPullRequest } = require('../publisher');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse('2026-10-08T12:00:00Z');
const REMOTE_URL = 'https://github.com/shipde/shipde-platform.git';

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

function outcomeOf(log, id) {
  return (log.outcomes || []).find((entry) => entry.workItemId === id) || null;
}

function publicationOf(log, id) {
  return (log.publications || []).find((entry) => entry.workItemId === id) || null;
}

/** One real git repository with a base commit. */
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
  git(['config', 'user.email', 'task-ai-122@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-122 test']);
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

/** The operator-side approval record shape approval-registry.js writes. */
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

function ciForPublications(state) {
  return (args) => {
    assert.equal(args[0], 'pr');
    const publication = state.publishCalls.find((call) => call.branch === args[2]);
    assert.ok(publication, 'CI must query the branch actually published');
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        headRefOid: publication.reviewedSha,
        statusCheckRollup: require('../sources.json').dispatch.ciGate.requiredChecks.map(
          (name) => ({
            name,
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
          })
        ),
      }),
    };
  };
}

/**
 * The task-ai-119/120 harness with a fake publisher: one writer, one reviewer,
 * a recorded launcher that commits per work item and passes every review, and a
 * publisher fake that only records what it was handed. `config.approvals` maps
 * workItemId -> approvalId and writes the SHA-bound record at review time, the
 * way an operator approves a reviewed commit before the publish stage.
 */
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
    return { exitCode: 0, stdout: 'worker completed' };
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
    ghRunner: ciForPublications(state),
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
        remoteUrl: REMOTE_URL,
      },
      cfg.publication || {}
    ),
  };

  return { dir, repo, registryPath, state, opts, writer, reviewerA };
}

const SPECS_AB = [
  {
    id: 'A',
    businessOutcome: 'Ship the first outcome',
    files: ['a.js'],
    verification: { command: 'test' },
  },
  {
    id: 'B',
    businessOutcome: 'Ship the second outcome',
    files: ['b.js'],
    verification: { command: 'test' },
  },
];

const SPECS_STACKED = [
  {
    id: 'A',
    businessOutcome: 'Ship the base outcome',
    files: ['a.js'],
    verification: { command: 'test' },
  },
  {
    id: 'B',
    businessOutcome: 'Ship the dependent outcome',
    files: ['b.js'],
    dependencies: ['A'],
    verification: { command: 'test' },
  },
];

test('PI-R02: --approval ID1,ID2 reaches the run as several approvals', async () => {
  const dir = tmpDir('task-ai-122-pi-r02-cli-');
  const specsFile = path.join(dir, 'specs.json');
  fs.writeFileSync(
    specsFile,
    JSON.stringify([{ id: 'A', files: ['a.js'], verification: { command: 'test' } }])
  );
  const seen = [];
  const deps = {
    log: () => {},
    exit: () => {},
    candidates: [],
    registry: { sources: [] },
    accounts: [],
    registryAccounts: [],
    listAccounts: () => [],
    runOrchestration: async (_goal, opts) => {
      seen.push(opts);
      return {
        status: 'COMPLETED',
        reconciliation: { total: 1, completed: ['A'], blocked: [], deferred: [] },
        publications: [],
        outcomes: [],
      };
    },
  };
  const argsFor = (approval) =>
    Object.assign(
      { _: ['orchestrate'], goal: 'several approvals', specs: specsFile, publish: true },
      { approval }
    );

  await cli.orchestrateCommand(argsFor('AP-1,AP-2'), deps);
  assert.deepEqual(
    seen[0].publication.approvalIds,
    ['AP-1', 'AP-2'],
    'a comma-separated --approval list is one approval per reviewed item'
  );
  await cli.orchestrateCommand(argsFor('AP-1'), deps);
  assert.deepEqual(seen[1].publication.approvalIds, ['AP-1']);
});

test('PI-R03: createDraftPullRequest titles the draft from the item and stacks its base branch', () => {
  const reviewedSha = 'b'.repeat(40);
  const manifest = {
    workItemId: 'B',
    reviewedCommit: reviewedSha,
    verdict: 'PASS',
    writerCandidateKey:
      'hermes::cli-writer::gw-writer::up-writer::acct-writer::scope-writer::model-writer',
    reviewerCandidateKey:
      'hermes::cli-reviewera::gw-reviewera::up-reviewera::acct-reviewera::scope-reviewera::model-reviewera',
    findings: [],
    tests: [{ command: 'test', result: 'pass', summary: 'pass-after green' }],
    reviewedTree: 't'.repeat(40),
    reviewedPatchId: 'p'.repeat(40),
    reviewedBase: 'a'.repeat(40),
    artifactSha256: 'c'.repeat(64),
    createdAt: new Date(NOW).toISOString(),
  };
  const calls = [];
  const ghRun = (args) => {
    calls.push(args);
    if (args[1] === 'list') return { exitCode: 0, stdout: '[]' };
    if (args[1] === 'create') return { exitCode: 0, stdout: 'https://github.com/o/r/pull/7' };
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        isDraft: true,
        headRefOid: reviewedSha,
        title: '[B] Ship the dependent outcome',
      }),
    };
  };

  const result = createDraftPullRequest({
    remoteUrl: REMOTE_URL,
    branch: 'feat/b',
    reviewedSha,
    workItemId: 'B',
    outcome: 'Ship the dependent outcome',
    baseBranch: 'feat/a',
    manifest,
    reviewManifest: 'decisions/review-manifest-B.json',
    reviewArtifact: 'decisions/review-artifact-B.md',
    decisionEvidence: 'decisions',
    failBefore: { command: 'test', exitCode: 1 },
    ghRun,
  });

  const create = calls.find((args) => args[1] === 'create');
  assert.ok(create, 'gh pr create runs');
  assert.equal(create[create.indexOf('--title') + 1], '[B] Ship the dependent outcome');
  assert.equal(create[create.indexOf('--head') + 1], 'feat/b');
  assert.ok(create.includes('--base'), 'a stacked draft names its base branch');
  assert.equal(create[create.indexOf('--base') + 1], 'feat/a');
  const body = create[create.indexOf('--body') + 1];
  assert.ok(body.includes('Exactly one Work Item: B'), 'the body names only this Work Item');
  assert.ok(body.includes('Work Item ID: B'));
  assert.ok(!body.includes('Work Item ID: A'), 'the body names no other Work Item');
  assert.equal(result.status, 'draft_created');
  assert.ok(
    String(result.number).endsWith('7'),
    'the draft number comes from gh: ' + result.number
  );
  assert.equal(result.headRefOid, reviewedSha);
});
