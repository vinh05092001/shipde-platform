'use strict';

/**
 * Ship Dễ — TASK-AI-124: draft PR bodies never trip the placeholder rule, and
 * titles fall back to the run goal on publish.
 *
 * Uses the task-ai-123/122 harness (runOrchestration with real temp git repos
 * under the repo's .upstream-tmp) with a fake publisher — no network.
 *
 * PB-R01: every free-text fragment the publisher puts in a PR body (test names
 *   and test output lines, fail-before output, finding text, outcome) is
 *   neutralised, so the body never matches the Feature contract gate regex
 *   /<[^>\n]+>/ — a verbatim test name such as
 *   "returns feat/<lower-cased work item id>-<slugified title>" no longer reads
 *   as a required template placeholder. Headings and links are unaffected.
 *
 * PB-R02: on the publish path the run goal (the --goal content, first non-empty
 *   line) is passed to draftTitleForItem, so gate5-shaped specs — which carry no
 *   outcome/title/name — title the draft "[<workItemId>] <goal>" instead of the
 *   literal "work item".
 *
 * PB-R03: both tests fail on origin/main.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration } = require('../orchestrate');
const { buildDraftBody, createDraftPullRequest } = require('../publisher');

const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const NOW = Date.parse('2026-10-08T12:00:00Z');
const REMOTE_URL = 'https://github.com/shipde/shipde-platform.git';

/** docs/product-spec/scripts/validate_pr_contract.py: the placeholder rule. */
const CONTRACT_GATE_BODY_PATTERN = /<[^>\n]+>/;

/** The Work Item IDs a title or outcome may carry (same shape as the gate). */
const WORK_ITEM_ID_PATTERN = /\b(?:FEAT|TASK-FOUND|TASK-AI)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g;

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
  git(['config', 'user.email', 'task-ai-124@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-124 test']);
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
 * The task-ai-123/122 harness with a fake publisher: one writer, one reviewer,
 * a recorded launcher that commits per work item and passes every review, and a
 * publisher fake that only records what it was handed. `config.approvals` maps
 * workItemId -> approvalId and writes the SHA-bound record at review time.
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
        remoteUrl: REMOTE_URL,
      },
      cfg.publication || {}
    ),
  };

  return { dir, repo, registryPath, state, opts, writer, reviewerA };
}

/** .upstream-tmp/gate5-goal.txt — the gate5 run goal, verbatim. */
const GATE5_GOAL =
  'add a pure slugify helper and a branch-name helper that uses it, so Work Item branches are derived consistently';

/** .upstream-tmp/gate5-specs.json[0] — no outcome, title or name field. */
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
    'SL-R02: throws Error with code SLUGIFY_INPUT_INVALID for non-string or empty input',
  ],
  verification: {
    command: 'node --test tools/ai-brain/test/proof-slugify.test.js',
    expect: 'fail 0',
  },
};

const VERBATIM_TEST_NAME = 'returns feat/<lower-cased work item id>-<slugified title>';

test('PB-R01: a body built from a test named with <...> never matches the contract gate pattern', async () => {
  const f = setup('task-ai-124-pb-r01-', [GATE5_SPEC_111], {
    approvals: { 'TASK-AI-111': 'AP-124-R01' },
  });
  f.opts.tests = () => ({
    pass: true,
    command: 'node --test tools/ai-brain/test/proof-branch-name.test.js',
    exitCode: 0,
    detail: '  ✔ ' + VERBATIM_TEST_NAME + ' (0.93ms)',
  });

  const log = await runOrchestration('PB-R01 neutralise the draft body', f.opts);

  const publication = publicationOf(log, 'TASK-AI-111');
  assert.ok(publication, 'publication exists: ' + JSON.stringify(log.publications));
  assert.equal(publication.status, 'PUBLISHED_DRAFT');

  const call = f.state.publishCalls[0];
  const draft = call.draft;
  assert.ok(
    draft.tests.some((entry) => String(entry.summary).includes(VERBATIM_TEST_NAME)),
    'the recorded test output still carries the verbatim test name: ' + JSON.stringify(draft.tests)
  );

  // The manifest the publisher validates the draft against, with the body's
  // evidence taken from what the publish path actually handed the publisher.
  const manifest = Object.assign({ reviewedCommit: call.reviewedSha }, draft);
  const ghCalls = [];
  const ghRun = (args) => {
    ghCalls.push(args);
    if (args[0] === 'pr' && args[1] === 'list') return { exitCode: 0, stdout: '[]', stderr: '' };
    if (args[0] === 'pr' && args[1] === 'create') {
      return { exitCode: 0, stdout: REMOTE_URL.replace('.git', '') + '/pull/124', stderr: '' };
    }
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        isDraft: true,
        headRefOid: call.reviewedSha,
        title: '[' + draft.workItemId + '] ' + draft.outcome,
      }),
      stderr: '',
    };
  };

  createDraftPullRequest(
    Object.assign({}, draft, {
      remoteUrl: REMOTE_URL,
      branch: 'fix/task-ai-124-draft-body-and-title',
      reviewedSha: call.reviewedSha,
      manifest,
      ghRun,
    })
  );

  const create = ghCalls.find((args) => args[0] === 'pr' && args[1] === 'create');
  assert.ok(create, 'gh pr create runs');
  const body = create[create.indexOf('--body') + 1];

  assert.ok(
    !CONTRACT_GATE_BODY_PATTERN.test(body),
    'the PR body must not match /<[^>\\n]+>/: ' + body
  );
  assert.ok(
    body.includes('lower-cased work item id'),
    'the test evidence is kept, only neutralised'
  );
  assert.ok(body.includes('## Verification'), 'headings are unaffected');
  assert.ok(body.includes('Review status: READY_FOR_CODEX'), 'the readiness marker is unaffected');
  assert.ok(buildDraftBody(manifest, draft) === body, 'the same body reaches buildDraftBody');
  assert.ok(
    !CONTRACT_GATE_BODY_PATTERN.test(buildDraftBody(manifest, draft)),
    'buildDraftBody alone must not trip the placeholder rule'
  );
});

test('PB-R02: the publish path titles the draft from the run goal, never the literal "work item"', async () => {
  const f = setup('task-ai-124-pb-r02-', [GATE5_SPEC_111], {
    approvals: { 'TASK-AI-111': 'AP-124-R02' },
  });

  // The goal is the run goal only — never an option — exactly like
  // `node cli.js orchestrate --goal <file> --specs <file>`.
  const log = await runOrchestration(GATE5_GOAL, f.opts);

  const publication = publicationOf(log, 'TASK-AI-111');
  assert.ok(publication, 'publication exists: ' + JSON.stringify(log.publications));
  assert.equal(publication.status, 'PUBLISHED_DRAFT');

  const draft = f.state.publishCalls[0].draft;
  const title = '[' + String(draft.workItemId).trim() + '] ' + String(draft.outcome || '').trim();
  const expected = ('[TASK-AI-111] ' + GATE5_GOAL).slice(0, 72);

  assert.equal(title, expected, 'the draft title is the truncated run goal: ' + title);
  assert.equal(title.length, 72, 'the title is truncated to 72 characters: ' + title.length);
  assert.ok(
    title.startsWith('[TASK-AI-111] add a pure slugify helper and a branch-name helper that '),
    'the title carries the run goal text: ' + title
  );
  assert.equal(
    (title.match(WORK_ITEM_ID_PATTERN) || []).length,
    1,
    'the title carries exactly one Work Item ID: ' + title
  );
  assert.ok(
    !title.includes('work item'),
    'the literal "work item" fallback is not used when a goal exists: ' + title
  );
  assert.ok(
    !JSON.stringify(draft).includes('"work item"'),
    'no stage of the publish path falls back to the literal: ' + JSON.stringify(draft)
  );
});
