'use strict';

/**
 * Ship Dễ — TASK-AI-123: draft PR titles use the Work Item outcome, and worker
 * commits pass the format gate before review.
 *
 * Uses the task-ai-120 harness with real temp git repos and a fake publisher.
 *
 * DT-R01: the draft PR title is "[<workItemId>] <outcome>". <outcome> comes from
 *   the spec item's title/outcome field, not from acceptance criteria text.
 *   - Truncate to 72 characters.
 *   - Strip any other Work Item ID pattern from <outcome>.
 *
 * DT-R02: after a worker commit and BEFORE review, the Controller runs a host-side
 *   format check on the worker's changed files only. If it fails, the item takes
 *   a bounded repair round and is refused while it stays unformatted; a prettier
 *   the host cannot run is a recorded FORMAT_CHECK_UNAVAILABLE warning.
 *
 * DT-R03: tests cover title from outcome with exactly one ID, badly formatted worker
 *   file triggers repair instead of review, and well-formatted file goes straight
 *   to review. Each test must fail on origin/main.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { runOrchestration, draftTitleForItem } = require('../orchestrate');
const cli = require('../cli');

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
  git(['config', 'user.email', 'task-ai-123@shipde.test']);
  git(['config', 'user.name', 'TASK-AI-123 test']);
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

/**
 * Harness with a fake publisher. `config.workerFormatCheck` can be injected to
 * simulate format check behavior.
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
    formatCheckCalls: [],
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
      if (approvalId) {
        const registry = fs.existsSync(registryPath)
          ? JSON.parse(fs.readFileSync(registryPath, 'utf8'))
          : {};
        registry[approvalId] = {
          approvalId,
          state: 'APPROVED',
          reviewedSha: job.baseSha,
          verdict: 'PASS',
          reviewer:
            'hermes::cli-reviewera::gw-reviewera::up-reviewera::acct-reviewera::scope-reviewera::model-reviewera',
          issuedAt: new Date(NOW).toISOString(),
          expiry: '2100-01-01T00:00:00.000Z',
        };
        fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));
      }
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

/**
 * Title helper for DT-R01: strips any Work Item ID from the outcome text and
 * truncates to 72 characters. This is what the controller should do.
 */
function buildDraftTitle(workItemId, outcomeRaw) {
  const outcome = String(outcomeRaw || '').trim();
  // Strip any Work Item ID patterns from outcome text (DT-R01)
  const stripped = outcome.replace(/\b(FEAT-|TASK-FOUND-|TASK-AI-)[A-Za-z0-9]+/g, '');
  const title = '[' + String(workItemId || '').trim() + '] ' + stripped.trim();
  // Truncate to 72 characters
  return title.slice(0, 72);
}

test('DT-R01: title from outcome, exactly one ID even when outcome mentions another ID', async () => {
  const f = setup(
    'task-ai-123-dt-r01-',
    [
      {
        id: 'TASK-AI-123',
        businessOutcome: 'Draft PR titles use the Work Item outcome from TASK-AI-122',
        files: ['test.js'],
        verification: { command: 'test' },
      },
    ],
    {
      approvals: { 'TASK-AI-123': 'AP-123-R01' },
    }
  );

  const log = await runOrchestration('DT-R01 title from outcome', f.opts);

  const publication = publicationOf(log, 'TASK-AI-123');
  assert.ok(publication, 'publication exists');
  assert.equal(publication.status, 'PUBLISHED_DRAFT');

  const draft = f.state.publishCalls[0].draft;
  const outcome = draft.outcome;

  // DT-R01: the outcome field contains the businessOutcome (from spec, not acceptance criteria)
  assert.ok(
    outcome.includes('Draft PR titles'),
    'outcome is from spec businessOutcome: ' + outcome
  );

  // DT-R01: PR title must have exactly one Work Item ID
  // Any other IDs in outcome text should be stripped when creating title
  const idPattern = /\b(FEAT-|TASK-FOUND-|TASK-AI-)[A-Za-z0-9]+\b/g;
  const title = '[' + draft.workItemId + '] ' + outcome.trim();

  // After stripping IDs from outcome, only the prefix ID should remain
  const strippedTitle = title.replace(idPattern, '');
  const finalId = '[' + draft.workItemId + '] ' + strippedTitle.trim();

  const finalIds = finalId.match(idPattern) || [];
  assert.equal(finalIds.length, 1, 'exactly one Work Item ID in final title: ' + finalId);

  assert.ok(
    finalId.startsWith('[TASK-AI-123]'),
    'title starts with correct Work Item ID: ' + finalId
  );

  // DT-R01: the outcome text itself carries no second Work Item ID, and the
  // composed title is truncated to 72 characters. Both fail on origin/main,
  // where the outcome is published verbatim.
  const idPatternHyphen = /\b(?:FEAT|TASK-FOUND|TASK-AI)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g;
  assert.equal(
    (outcome.match(idPatternHyphen) || []).length,
    0,
    'the outcome must not quote another Work Item ID: ' + outcome
  );
  assert.ok(title.length <= 72, 'the title is at most 72 characters: ' + title.length);
});

test('DT-R01: strip multiple ID patterns from outcome', async () => {
  const testCases = [
    {
      input: 'Implement feature from TASK-AI-100 and TASK-AI-101',
      expectedStart: '[TASK-AI-123]',
      description: 'multiple IDs in outcome',
    },
    {
      input: 'Fix bug introduced in FEAT-500',
      expectedStart: '[TASK-AI-123]',
      description: 'FEAT pattern in outcome',
    },
    {
      input: 'Update based on TASK-FOUND-750',
      expectedStart: '[TASK-AI-123]',
      description: 'TASK-FOUND pattern in outcome',
    },
  ];

  for (const tc of testCases) {
    const title = buildDraftTitle('TASK-AI-123', tc.input);
    assert.ok(title.startsWith(tc.expectedStart), 'title starts correctly: ' + tc.description);

    // Only one ID in the title (the prefix)
    const idPattern = /\b(?:FEAT|TASK-FOUND|TASK-AI)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g;
    const allIds = title.match(idPattern) || [];
    assert.equal(allIds.length, 1, 'only one ID in title for ' + tc.description + ': ' + title);

    // DT-R01: the Controller composes that title itself. On origin/main the
    // builder is not exported and keeps the foreign ID, so this cannot pass.
    const composed = draftTitleForItem({ id: 'TASK-AI-123' }, tc.input);
    assert.ok(
      composed.startsWith(tc.expectedStart),
      'the controller title starts correctly: ' + composed
    );
    assert.equal(
      (composed.match(idPattern) || []).length,
      1,
      'the controller title carries only the prefix ID for ' + tc.description + ': ' + composed
    );
  }
});

test('DT-R01: truncate to 72 characters', async () => {
  const longOutcome = 'A'.repeat(100) + ' (this is very long and should be truncated properly)';
  const title = buildDraftTitle('TASK-AI-123', longOutcome);

  assert.ok(title.length <= 72, 'title is 72 characters or less: ' + title.length);
  assert.equal(title.length, 72, 'title is truncated to exactly 72');

  // DT-R01: the Controller truncates the title it actually composes. On
  // origin/main the builder is not exported and truncates nothing.
  const composed = draftTitleForItem({ id: 'TASK-AI-123' }, longOutcome);
  assert.equal(
    composed.length,
    72,
    'the controller title is truncated to exactly 72: ' + composed.length
  );
  assert.ok(composed.startsWith('[TASK-AI-123] '), 'the composed title keeps its prefix');
});

test('DT-R02: badly formatted worker file triggers repair instead of review', async () => {
  const dir = tmpDir('task-ai-123-dt-r02-bad-');
  const repo = makeRepo(path.join(dir, 'repo'));
  const registryPath = path.join(dir, 'approvals.json');

  const state = { calls: [], passSha: {}, formatCheckCalls: [] };
  const writer = cand('writer', 'author.foundation', { cost: 0.1 });
  const reviewerA = cand('reviewera', 'reviewer.primary');

  const run = (job) => {
    state.calls.push({
      workItemId: job.workItemId,
      isReview: Boolean(job.isReview),
    });
    if (job.usageFile) {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + state.calls.length }));
    }
    if (job.isReview) {
      fs.writeFileSync(
        job.verdictFile || path.join(job.cwd, 'verdict.json'),
        JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
      );
      return { exitCode: 0, stdout: 'review pass' };
    }
    // Simulate badly formatted file
    fs.writeFileSync(
      path.join(repo.dir, 'test.js'),
      'function test(  {    console.log(  "bad"  );  }\n'
    );
    repo.git(['add', '.']);
    repo.git(['commit', '-q', '-m', 'worker work']);
    state.passSha[job.workItemId] = repo.git(['rev-parse', 'HEAD']);
    return { exitCode: 0, stdout: 'worker completed' };
  };

  const opts = {
    specs: [
      {
        id: 'TASK-AI-123',
        businessOutcome: 'Format check before review',
        files: ['test.js'],
        verification: { command: 'test' },
      },
    ],
    candidates: [writer, reviewerA],
    registry: { sources: [] },
    checkpointFile: path.join(dir, 'checkpoint.json'),
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    now: NOW,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.base,
    formatCheck: true,
    // DT-R02: every format-check verdict the Controller emits lands in the same
    // list the repair round writes to, so a passing check is observable too.
    log: (code, payload) => {
      if (String(code).indexOf('FORMAT_CHECK') === 0) state.formatCheckCalls.push(payload);
    },
    ranking: {
      headrooms: {
        'acct-writer': { status: 'available' },
        'acct-reviewera': { status: 'available' },
      },
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    run,
    repairer: async (findings, sha) => {
      // Track format check failures that trigger repair
      state.formatCheckCalls.push({ findings, sha });
      return { sha };
    },
    publication: {
      approvalIds: ['AP-123-R02-BAD'],
      registryPath,
      expiry: NOW + 60 * 60 * 1000,
      remoteUrl: REMOTE_URL,
    },
    publisher: (pubOpts) => ({ status: 'published', sha: pubOpts.reviewedSha }),
  };

  const log = await runOrchestration('DT-R02 badly formatted file', opts);

  // DT-R02: format check runs BEFORE review and the repair round is triggered
  // for the badly formatted file (the repairer records the finding it received)
  assert.ok(
    state.formatCheckCalls.length > 0,
    'format check must run before review: ' + JSON.stringify(state.formatCheckCalls)
  );

  const outcome = outcomeOf(log, 'TASK-AI-123');
  assert.ok(outcome, 'outcome exists');

  // After format check repair, item should be completed or refused
  assert.ok(
    outcome.status === 'completed' || outcome.status === 'refused',
    'outcome status: ' + outcome.status
  );

  // DT-R02: the finding names the files, the item is refused rather than
  // reviewed, and the run records why. None of this exists on origin/main.
  const repairCall = state.formatCheckCalls.find((call) => Array.isArray(call.findings));
  assert.ok(repairCall, 'the bounded repair round received the format finding');
  assert.equal(repairCall.findings[0].id, 'FORMAT_CHECK_FAILED');
  assert.match(repairCall.findings[0].summary, /test\.js/);
  assert.equal(outcome.status, 'refused', 'an unformatted commit is refused: ' + outcome.status);
  assert.equal(log.reviews.length, 0, 'the unformatted commit is never reviewed');
  assert.equal(
    publicationOf(log, 'TASK-AI-123'),
    null,
    'the unformatted commit is never published'
  );
  assert.ok(
    (log.formatChecks || []).some((entry) => entry.status === 'REFUSED'),
    'the refused verdict is recorded on the run: ' + JSON.stringify(log.formatChecks)
  );
});

test('DT-R02: well-formatted worker file goes straight to review', async () => {
  const dir = tmpDir('task-ai-123-dt-r02-good-');
  const repo = makeRepo(path.join(dir, 'repo'));
  const registryPath = path.join(dir, 'approvals.json');

  const state = { calls: [], passSha: {}, formatCheckCalls: [] };
  const writer = cand('writer', 'author.foundation', { cost: 0.1 });
  const reviewerA = cand('reviewera', 'reviewer.primary');

  const run = (job) => {
    state.calls.push({
      workItemId: job.workItemId,
      isReview: Boolean(job.isReview),
    });
    if (job.usageFile) {
      fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
      fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'sess-' + state.calls.length }));
    }
    if (job.isReview) {
      fs.writeFileSync(
        job.verdictFile || path.join(job.cwd, 'verdict.json'),
        JSON.stringify({ sha: job.baseSha, verdict: 'PASS', findings: [] })
      );
      return { exitCode: 0, stdout: 'review pass' };
    }
    // Simulate well-formatted file: single quotes match the repository .prettierrc
    fs.writeFileSync(
      path.join(repo.dir, 'test.js'),
      "function test() {\n  console.log('good');\n}\n"
    );
    repo.git(['add', '.']);
    repo.git(['commit', '-q', '-m', 'worker work']);
    state.passSha[job.workItemId] = repo.git(['rev-parse', 'HEAD']);
    return { exitCode: 0, stdout: 'worker completed' };
  };

  const opts = {
    specs: [
      {
        id: 'TASK-AI-123',
        businessOutcome: 'Well-formatted file test',
        files: ['test.js'],
        verification: { command: 'test' },
      },
    ],
    candidates: [writer, reviewerA],
    registry: { sources: [] },
    checkpointFile: path.join(dir, 'checkpoint.json'),
    decisionDir: path.join(dir, 'decisions'),
    usageDir: path.join(dir, 'usage'),
    now: NOW,
    cwd: repo.dir,
    workerRoot: repo.dir,
    baseSha: repo.base,
    formatCheck: true,
    // DT-R02: every format-check verdict the Controller emits lands in the same
    // list the repair round writes to, so a passing check is observable too.
    log: (code, payload) => {
      if (String(code).indexOf('FORMAT_CHECK') === 0) state.formatCheckCalls.push(payload);
    },
    ranking: {
      headrooms: {
        'acct-writer': { status: 'available' },
        'acct-reviewera': { status: 'available' },
      },
    },
    tests: () => ({ pass: true, command: 'test', exitCode: 0 }),
    measureFailBefore: () => ({ command: 'test', exitCode: 1 }),
    run,
    repairer: async (findings, sha) => {
      state.formatCheckCalls.push({ findings, sha });
      return { sha };
    },
    publication: {
      approvalIds: ['AP-123-R02-GOOD'],
      registryPath,
      expiry: NOW + 60 * 60 * 1000,
      remoteUrl: REMOTE_URL,
    },
    publisher: (pubOpts) => ({ status: 'published', sha: pubOpts.reviewedSha }),
  };

  const log = await runOrchestration('DT-R02 well-formatted file', opts);

  // DT-R02: the format check runs for every worker commit, formatted or not
  assert.ok(
    state.formatCheckCalls.length > 0,
    'format check must run for all files: ' + JSON.stringify(state.formatCheckCalls)
  );

  const outcome = outcomeOf(log, 'TASK-AI-123');
  assert.ok(outcome, 'outcome exists');

  // After format check, item should be completed or refused
  assert.ok(
    outcome.status === 'completed' || outcome.status === 'refused',
    'outcome status: ' + outcome.status
  );

  // DT-R02: a formatted commit needs no repair round and reaches the reviewer.
  // Neither the PASSED verdict nor the review exists on origin/main.
  assert.equal(outcome.status, 'completed', 'a formatted commit completes: ' + outcome.status);
  assert.equal(
    state.formatCheckCalls.some((call) => Array.isArray(call.findings)),
    false,
    'the formatted file never triggers a repair round'
  );
  assert.ok(
    (log.formatChecks || []).some((entry) => entry.status === 'PASSED'),
    'the passing verdict is recorded on the run: ' + JSON.stringify(log.formatChecks)
  );
  assert.equal(log.reviews.length, 1, 'the formatted commit is reviewed exactly once');
});
