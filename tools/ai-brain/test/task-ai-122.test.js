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

test('PI-R01: each work item is validated against its own review manifest and both publish', async () => {
  const f = setup('task-ai-122-pi-r01-', SPECS_AB, {
    approvals: { A: 'AP-122-R01-A', B: 'AP-122-R01-B' },
  });

  const log = await runOrchestration('PI-R01 per item manifests', f.opts);

  assert.equal(outcomeOf(log, 'A').status, 'completed', JSON.stringify(log.outcomes, null, 2));
  assert.equal(outcomeOf(log, 'B').status, 'completed');
  for (const id of ['A', 'B']) {
    const published = publicationOf(log, id);
    assert.ok(published, 'a publication record for ' + id);
    assert.equal(
      published.status,
      'PUBLISHED_DRAFT',
      id + ' publishes against its own manifest: ' + JSON.stringify(published)
    );
    assert.ok(
      !String(published.reason || '').includes('WORK_ITEM_MISMATCH'),
      id + ' must not see the other item manifest'
    );
  }
  assert.equal(f.state.publishCalls.length, 2, 'both items reach the publisher');

  const manifestA = path.join(f.opts.decisionDir, 'review-manifest-A.json');
  const manifestB = path.join(f.opts.decisionDir, 'review-manifest-B.json');
  const artifactA = path.join(f.opts.decisionDir, 'review-artifact-A.md');
  const artifactB = path.join(f.opts.decisionDir, 'review-artifact-B.md');
  for (const file of [manifestA, manifestB, artifactA, artifactB]) {
    assert.ok(fs.existsSync(file), 'written at review time: ' + file);
  }
  const callA = f.state.publishCalls.find((c) => c.workItemId === 'A');
  const callB = f.state.publishCalls.find((c) => c.workItemId === 'B');
  assert.equal(callA.reviewManifest, manifestA, 'A is validated against its own manifest');
  assert.equal(callB.reviewManifest, manifestB, 'B is validated against its own manifest');
  assert.equal(callA.reviewArtifact, artifactA);
  assert.equal(callB.reviewArtifact, artifactB);
  assert.equal(
    JSON.parse(fs.readFileSync(manifestA, 'utf8')).workItemId,
    'A',
    'the per-item manifest reviews its own item'
  );
  assert.equal(JSON.parse(fs.readFileSync(manifestB, 'utf8')).workItemId, 'B');
});

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

test('PI-R02: two approvals each publish only the item whose reviewed SHA they bind', async () => {
  const f = setup('task-ai-122-pi-r02-two-', SPECS_AB, {
    approvals: { A: 'AP-122-R02-A', B: 'AP-122-R02-B' },
  });

  const log = await runOrchestration('PI-R02 two approvals', f.opts);

  assert.equal(f.state.publishCalls.length, 2, 'both items publish');
  const callA = f.state.publishCalls.find((c) => c.workItemId === 'A');
  const callB = f.state.publishCalls.find((c) => c.workItemId === 'B');
  assert.equal(callA.approvalId, 'AP-122-R02-A', 'A is authorised by the approval bound to A');
  assert.equal(callB.approvalId, 'AP-122-R02-B', 'B is authorised by the approval bound to B');
  assert.equal(callA.reviewedSha, f.state.passSha.A);
  assert.equal(callB.reviewedSha, f.state.passSha.B);
  assert.equal(publicationOf(log, 'A').status, 'PUBLISHED_DRAFT');
  assert.equal(publicationOf(log, 'B').status, 'PUBLISHED_DRAFT');
});

test('PI-R02: an item without a matching approval is NOT_REQUESTED and does not trip the replay guard', async () => {
  const f = setup('task-ai-122-pi-r02-missing-', SPECS_AB, {
    // Only B is approved; A is reviewed but nobody approved its commit.
    approvals: { B: 'AP-122-R02-ONLY-B' },
  });

  const log = await runOrchestration('PI-R02 missing approval', f.opts);

  const publishedA = publicationOf(log, 'A');
  assert.ok(publishedA, 'A carries a publication record');
  assert.equal(
    publishedA.status,
    'NOT_REQUESTED',
    'a missing approval is not a refusal: ' + JSON.stringify(publishedA)
  );
  assert.match(
    String(publishedA.reason || ''),
    /APPROVAL_NOT_SUPPLIED/,
    'the reason names the missing approval: ' + String(publishedA.reason)
  );

  const publishedB = publicationOf(log, 'B');
  assert.equal(
    publishedB.status,
    'PUBLISHED_DRAFT',
    'the unapproved item does not trip the replay guard: ' + JSON.stringify(publishedB)
  );
  for (const record of log.publications) {
    assert.ok(
      !String(record.reason || '').includes('PUBLISH_NOT_REPLAYABLE'),
      'nothing is refused as PUBLISH_NOT_REPLAYABLE: ' + JSON.stringify(record)
    );
  }
  assert.equal(f.state.publishCalls.length, 1, 'only the approved item reaches the publisher');
  assert.equal(f.state.publishCalls[0].workItemId, 'B');
  assert.equal(f.state.publishCalls[0].approvalId, 'AP-122-R02-ONLY-B');
});

test('PI-R03: each published item gets its own draft PR titled from its own spec', async () => {
  const dir = tmpDir('task-ai-122-pi-r03-titles-');
  const repo = makeRepo(path.join(dir, 'repo'));
  const specsFile = path.join(dir, 'specs.json');
  fs.writeFileSync(specsFile, JSON.stringify(SPECS_AB));
  const state = { publishCalls: [], passSha: {} };
  // The CLI runs with enforceProofFloors, so these candidates carry the role
  // capabilities and the WORK_ITEM_PASS proof the profile requires.
  const writer = cand('writer', 'author.foundation', {
    cost: 0.1,
    capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
    evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS' }],
  });
  const reviewerA = cand('reviewera', 'reviewer.primary', {
    capabilities: { jsonSchema: true, tools: true, contextWindow: 200000 },
    evidence: [{ status: 'passed', proofLevel: 'WORK_ITEM_PASS' }],
  });

  const run = (job) => {
    if (job.usageFile) {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(
        job.usageFile,
        JSON.stringify({ session_id: 'sess-' + state.publishCalls.length })
      );
    }
    if (job.isReview) {
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

  const realRunOrchestration = require('../orchestrate').runOrchestration;
  const captured = [];
  const deps = {
    log: () => {},
    exit: () => {},
    candidates: [writer, reviewerA],
    registry: { sources: [] },
    accounts: [],
    registryAccounts: [],
    listAccounts: () => [],
    run,
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    now: NOW,
    runOrchestration: (goal, opts) => {
      captured.push(opts);
      return realRunOrchestration(
        goal,
        Object.assign({}, opts, {
          ranking: {
            headrooms: {
              'acct-writer': { status: 'available' },
              'acct-reviewera': { status: 'available' },
            },
          },
          repairer: async (_findings, sha) => ({ sha }),
          publisher: (pubOpts) => {
            state.publishCalls.push(pubOpts);
            return { status: 'published', sha: pubOpts.reviewedSha, branch: pubOpts.branch };
          },
        })
      );
    },
  };

  await cli.orchestrateCommand(
    {
      _: ['orchestrate'],
      goal: 'one draft PR per work item',
      specs: specsFile,
      publish: true,
      approval: 'AP-122-R03-A,AP-122-R03-B',
      'decision-dir': path.join(dir, 'decisions'),
      checkpoint: path.join(dir, 'checkpoint.json'),
      'usage-dir': path.join(dir, 'usage'),
      'evidence-dir': path.join(dir, 'evidence'),
      cwd: repo.dir,
      'worker-root': repo.dir,
      'base-sha': repo.base,
    },
    deps
  );

  assert.deepEqual(
    captured[0].publication.approvalIds,
    ['AP-122-R03-A', 'AP-122-R03-B'],
    'the CLI forwards every approval it was given'
  );
  assert.equal(state.publishCalls.length, 2, 'both items publish a draft');
  const callA = state.publishCalls.find((c) => c.workItemId === 'A');
  const callB = state.publishCalls.find((c) => c.workItemId === 'B');
  assert.ok(callA && callB, 'one publish per work item');
  assert.equal(callA.draft.workItemId, 'A');
  assert.equal(callA.draft.outcome, 'Ship the first outcome', 'A is titled from its own spec');
  assert.equal(callB.draft.workItemId, 'B', 'the title never uses specs[0]');
  assert.equal(callB.draft.outcome, 'Ship the second outcome', 'B is titled from its own spec');
  assert.equal(callA.draft.workItemId + '|' + callA.draft.outcome, 'A|Ship the first outcome');
  assert.notEqual(callA.draft.outcome, callB.draft.outcome, 'each item keeps its own outcome');
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

test('PI-R03: a dependent draft stacks on the dependency published branch', async () => {
  const f = setup('task-ai-122-pi-r03-stacked-', SPECS_STACKED, {
    approvals: { A: 'AP-122-R03-S-A', B: 'AP-122-R03-S-B' },
  });

  const log = await runOrchestration('PI-R03 stacked draft', f.opts);

  assert.equal(publicationOf(log, 'A').status, 'PUBLISHED_DRAFT', JSON.stringify(log.publications));
  assert.equal(publicationOf(log, 'B').status, 'PUBLISHED_DRAFT', JSON.stringify(log.publications));
  assert.equal(f.state.publishCalls.length, 2);
  const callA = f.state.publishCalls.find((c) => c.workItemId === 'A');
  const callB = f.state.publishCalls.find((c) => c.workItemId === 'B');
  assert.equal(callA.branch, 'feat/a');
  assert.equal(callB.branch, 'feat/b', 'the dependent publishes to its own branch');
  assert.equal(callA.draft.baseBranch, undefined, 'the first item stacks on the default base');
  assert.equal(
    callB.draft.baseBranch,
    'feat/a',
    'the dependent PR base is the dependency published branch: ' +
      JSON.stringify(callB.draft.baseBranch)
  );
  assert.equal(callB.reviewedSha, f.state.passSha.B);
  assert.notEqual(callB.reviewedSha, callA.reviewedSha);
});

test('PI-R03: a dependent is not published when its dependency was not published', async () => {
  const f = setup('task-ai-122-pi-r03-unpublished-dep-', SPECS_STACKED, {
    // Only the dependent is approved; the dependency is never published.
    approvals: { B: 'AP-122-R03-U-B' },
  });

  const log = await runOrchestration('PI-R03 dependency not published', f.opts);

  const publishedA = publicationOf(log, 'A');
  assert.equal(publishedA.status, 'NOT_REQUESTED', JSON.stringify(publishedA));
  const publishedB = publicationOf(log, 'B');
  assert.equal(
    publishedB.status,
    'REFUSED',
    'the dependent is NOT published: ' + JSON.stringify(publishedB)
  );
  assert.match(
    String(publishedB.reason || ''),
    /^DEPENDENCY_NOT_PUBLISHED/,
    'the reason is DEPENDENCY_NOT_PUBLISHED: ' + String(publishedB.reason)
  );
  assert.equal(f.state.publishCalls.length, 0, 'no draft PR is created for the dependent');
});
