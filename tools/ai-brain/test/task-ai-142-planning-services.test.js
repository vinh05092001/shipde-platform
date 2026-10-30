'use strict';

/**
 * Governed planning services: isolated planner, independent reviewer (including
 * `review pr` at an exact SHA) and the governed docs-only merge executor.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const services = require('../planning-services');
const planner = require('../work-item-planner');
const cli = require('../cli');

const ID = 'FEAT-AUTH-02';
const REGISTER = services.REGISTER_REL;
const DOC = services.workItemRel(ID);

const WRITER = 'opencode::api::gw-a::up-a::acct-a::scope-a::model-a';
const WRITER_2 = 'claude::cli::gw-b::up-b::acct-b::scope-b::model-b';
const REVIEWER = 'codex::cli::::up-r::acct-r::scope-r::model-r';

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plansvc-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@example.test');
  sh(dir, 'config', 'user.name', 't');
  sh(dir, 'config', 'commit.gpgsign', 'false');
  const hooksDir = path.join(dir, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.mkdirSync(path.join(dir, path.dirname(REGISTER)), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs/product-spec/work-items'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, REGISTER),
    '"1","A","x","FEAT-AUTH-01","a","t","d","READY_FOR_CODEX"\n"2","A","x","' +
      ID +
      '","a","t","d","BACKLOG"\n'
  );
  fs.writeFileSync(path.join(dir, 'README.md'), 'readme\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'base');
  return { dir, base: sh(dir, 'rev-parse', 'HEAD') };
}

const DEFAULT_DOC_TEXT =
  '# ' +
  ID +
  '\n\nComplete.\n\n| Section | Content |\n| --- | --- |\n| Allowed paths | `docs/product-spec/**` |\n\n## Acceptance\n| Criterion | Details |\n| 1 | Plan is complete |\n';

function commitDoc(dir, { register = true, extra, text } = {}) {
  fs.mkdirSync(path.dirname(path.join(dir, DOC)), { recursive: true });
  fs.writeFileSync(path.join(dir, DOC), text || DEFAULT_DOC_TEXT);
  if (register) {
    const p = path.join(dir, REGISTER);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/"BACKLOG"/, '"READY_FOR_AUTHOR"'));
  }
  if (extra) fs.writeFileSync(path.join(dir, extra), 'x\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'plan');
  return sh(dir, 'rev-parse', 'HEAD');
}

test('docs-only rule accepts the Work Item document and its own register row', () => {
  const { dir, base } = makeRepo();
  const head = commitDoc(dir);
  const r = services.verifyDocsOnlyChange({ cwd: dir, base, head, workItemId: ID });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.files.sort(), [DOC, REGISTER].sort());
});

test('docs-only rule refuses any other file, another register row and non-adds', () => {
  const a = makeRepo();
  const headA = commitDoc(a.dir, { extra: 'src.js' });
  const ra = services.verifyDocsOnlyChange({
    cwd: a.dir,
    base: a.base,
    head: headA,
    workItemId: ID,
  });
  assert.equal(ra.ok, false);
  assert.equal(ra.code, 'NOT_DOCS_ONLY');

  const b = makeRepo();
  const p = path.join(b.dir, REGISTER);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/"READY_FOR_CODEX"/, '"MERGED"'));
  fs.writeFileSync(path.join(b.dir, DOC), 'x\n');
  sh(b.dir, 'add', '-A');
  sh(b.dir, 'commit', '-q', '-m', 'wrong row');
  const rb = services.verifyDocsOnlyChange({
    cwd: b.dir,
    base: b.base,
    head: sh(b.dir, 'rev-parse', 'HEAD'),
    workItemId: ID,
  });
  assert.equal(rb.ok, false);
  assert.match(rb.reason, /exactly the row/);

  const c = makeRepo();
  fs.writeFileSync(path.join(c.dir, 'README.md'), 'changed\n');
  sh(c.dir, 'add', '-A');
  sh(c.dir, 'commit', '-q', '-m', 'no doc');
  const rc = services.verifyDocsOnlyChange({
    cwd: c.dir,
    base: c.base,
    head: sh(c.dir, 'rev-parse', 'HEAD'),
    workItemId: ID,
  });
  assert.equal(rc.ok, false);
});

function fakeOrchestrate(overrides) {
  return Object.assign(
    {
      resolveLauncher: () => () => ({ exitCode: 0 }),
      resolveLaunchRoute: (cand) => ({ harnessName: cand.harness, provider: 'p', model: 'm' }),
      resolveIsolatedWorkerRoot: (o, host) => host,
      routeProbeCandidate: () => null,
    },
    overrides || {}
  );
}

function cand(key, extra) {
  return Object.assign(
    { eligible: true, candidateKey: key, harness: 'opencode', accountId: key.split('::')[4] },
    extra
  );
}

test('isolated planner: docs-only commit succeeds and returns the exact SHA and draft text', async () => {
  const { dir } = makeRepo();
  let launched;
  const svc = services.createPlanningServices({
    rootDir: dir,
    plannerRoot: dir,
    decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plandec-')),
    probe: false,
    loadPool: () => ({ annotated: [], evidenceData: {}, accounts: [], registry: { sources: [] } }),
    orchestrate: fakeOrchestrate(),
    launcher: (job) => {
      launched = job;
      commitDoc(dir);
      return { exitCode: 0 };
    },
  });
  const out = await svc.launchPlanner({
    workItemId: ID,
    candidate: cand(WRITER),
    draft: { text: 'draft' },
  });
  assert.equal(out.success, true, JSON.stringify(out));
  assert.match(out.headSha, /^[0-9a-f]{40}$/);
  assert.equal(out.candidateKey, WRITER);
  assert.match(out.draftText, /Complete\./);
  assert.equal(launched.isolatedWorker, true);
  assert.equal(launched.labels.role, 'author.docs');
  assert.match(launched.prompt, /only from the approved sources|approved sources/i);
});

test('isolated planner: a write outside the docs boundary is refused, not retried', async () => {
  const { dir } = makeRepo();
  let ranks = 0;
  const svc = services.createPlanningServices({
    rootDir: dir,
    plannerRoot: dir,
    decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plandec-')),
    probe: false,
    loadPool: () => ({ annotated: [], evidenceData: {}, accounts: [], registry: { sources: [] } }),
    orchestrate: fakeOrchestrate(),
    rankPlanner: async () => (ranks++, cand(WRITER_2)),
    launcher: () => (commitDoc(dir, { extra: 'src.js' }), { exitCode: 0 }),
  });
  const out = await svc.launchPlanner({
    workItemId: ID,
    candidate: cand(WRITER),
    draft: { text: '' },
  });
  assert.equal(out.success, false);
  assert.match(out.reason, /NOT_DOCS_ONLY/);
  assert.equal(ranks, 0);
});

test('isolated planner: a failing/exhausted candidate is skipped and the next ranked one runs', async () => {
  const { dir } = makeRepo();
  const seen = [];
  const rankCalls = [];
  const svc = services.createPlanningServices({
    rootDir: dir,
    plannerRoot: dir,
    decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plandec-')),
    probe: false,
    loadPool: () => ({ annotated: [], evidenceData: {}, accounts: [], registry: { sources: [] } }),
    orchestrate: fakeOrchestrate(),
    rankPlanner: async (req) => {
      rankCalls.push([...req.failedKeys]);
      return cand(WRITER_2);
    },
    launcher: (job) => {
      seen.push(job.candidateKey);
      if (job.candidateKey === WRITER) return { exitCode: 1, stderr: 'quota exhausted 429' };
      commitDoc(dir);
      return { exitCode: 0 };
    },
  });
  const out = await svc.launchPlanner({
    workItemId: ID,
    candidate: cand(WRITER),
    draft: { text: '' },
  });
  assert.equal(out.success, true, JSON.stringify(out));
  assert.deepEqual(seen, [WRITER, WRITER_2]);
  assert.deepEqual(rankCalls, [[WRITER]]);
});

test('external (pool) planner: gets its own provisioned root, never the shared worker root, and the Controller commits its output', async () => {
  const { dir, base } = makeRepo();
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'plansvc-shared-'));
  const planRoot = path.join(
    os.tmpdir(),
    'plansvc-own-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  );
  const provisioned = [];
  const svc = services.createPlanningServices({
    rootDir: dir,
    plannerRoot: planRoot,
    externalWorkers: 'opencode',
    decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plandec-')),
    probe: false,
    loadPool: () => ({ annotated: [], evidenceData: {}, accounts: [], registry: { sources: [] } }),
    orchestrate: fakeOrchestrate({ resolveIsolatedWorkerRoot: () => shared }),
    provision: (src, dest, sha) => {
      provisioned.push([src, dest, sha]);
      sh(dir, 'clone', '-q', dir, dest);
    },
    launcher: (job) => {
      assert.equal(job.cwd, planRoot);
      assert.notEqual(job.cwd, shared);
      fs.mkdirSync(path.join(planRoot, path.dirname(DOC)), { recursive: true });
      fs.writeFileSync(path.join(planRoot, DOC), '# ' + ID + '\n');
      return { exitCode: 0 };
    },
  });
  const out = await svc.launchPlanner({
    workItemId: ID,
    candidate: cand(WRITER),
    draft: { text: '' },
  });
  assert.equal(out.success, true, JSON.stringify(out));
  assert.deepEqual(provisioned, [[dir, planRoot, base]]);
  assert.equal(out.workerRoot, planRoot);
  assert.equal(sh(planRoot, 'rev-parse', 'HEAD'), out.headSha);
  assert.deepEqual(fs.readdirSync(shared), []);
});

function reviewSvc(dir, opts) {
  const o = opts || {};
  return services.createPlanningServices(
    Object.assign(
      {
        rootDir: dir,
        decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plandec-')),
        probe: false,
        loadPool: () => ({
          annotated: [cand(WRITER), cand(REVIEWER, { harness: 'codex' })],
          evidenceData: {},
          accounts: [],
          registry: { sources: [] },
        }),
        orchestrate: fakeOrchestrate(),
        launcher: () => ({ exitCode: 0 }),
      },
      o
    )
  );
}

test('independent reviewer: excludes the author, binds the verdict to the exact SHA', async () => {
  const { dir } = makeRepo();
  const sha = commitDoc(dir);
  let selection;
  const svc = reviewSvc(dir, {
    selectCandidate: async (item, pool, forbidden) => {
      selection = { item, forbidden, keys: pool.map((c) => c.candidateKey) };
      return { chosen: REVIEWER };
    },
    reviewLane: () => async (target) => ({
      pass: true,
      verdict: 'PASS',
      sha: target,
      findings: [],
    }),
  });
  const out = await svc.reviewAtSha({
    workItemId: ID,
    sha,
    baseSha: sha,
    authorKey: WRITER,
    authorRoot: dir,
  });
  assert.equal(out.verdict, 'PASS');
  assert.equal(out.sha, sha);
  assert.equal(out.reviewer, REVIEWER);
  assert.equal(selection.item.roleRequirement.role, 'reviewer');
  assert.deepEqual(selection.forbidden, ['up-a', 'gw-a', 'acct-a', 'opencode', 'gw-a/up-a']);
  assert.equal(selection.item.writerCandidateKey, WRITER);
});

test('independent reviewer: a verdict on another SHA is BLOCKED, a launch failure picks the next reviewer', async () => {
  const { dir } = makeRepo();
  const sha = commitDoc(dir);
  const chosen = [REVIEWER, WRITER_2];
  const svc = reviewSvc(dir, {
    loadPool: () => ({
      annotated: [cand(REVIEWER, { harness: 'codex' }), cand(WRITER_2)],
      evidenceData: {},
      accounts: [],
      registry: { sources: [] },
    }),
    selectCandidate: async (item, pool) => ({
      chosen: pool.map((c) => c.candidateKey).find((k) => chosen.includes(k)) || null,
    }),
    reviewLane: (o) => async () =>
      o.reviewerIdentity === REVIEWER
        ? {
            pass: false,
            verdict: 'LAUNCH_FAILED',
            launchFailed: true,
            res: { exitCode: 1, stderr: 'boom' },
          }
        : { pass: true, verdict: 'PASS', sha: 'f'.repeat(40), findings: [] },
  });
  const out = await svc.reviewAtSha({
    workItemId: ID,
    sha,
    baseSha: sha,
    authorKey: WRITER,
    authorRoot: dir,
  });
  assert.equal(out.verdict, 'BLOCKED');
  assert.match(out.reason, /REVIEW_SHA_MISMATCH/);
  assert.equal(out.reviewer, WRITER_2);
});

test('independent reviewer: no candidate outside the author domain means BLOCKED', async () => {
  const { dir } = makeRepo();
  const sha = commitDoc(dir);
  const svc = reviewSvc(dir, {
    selectCandidate: async () => ({ chosen: null, reason: 'NO_REVIEWER_CANDIDATE' }),
  });
  const out = await svc.reviewAtSha({
    workItemId: ID,
    sha,
    baseSha: sha,
    authorKey: WRITER,
    authorRoot: dir,
  });
  assert.equal(out.verdict, 'BLOCKED');
});

test('review pr: refuses a PR whose head moved and a bad argv; reviews at the exact head', async () => {
  const { dir } = makeRepo();
  const sha = commitDoc(dir);
  const gh = (cwd, args) => ({
    ok: true,
    stdout: JSON.stringify({
      headRefOid: sha,
      baseRefOid: sha,
      title: '[' + ID + '] x',
      headRefName: 'feat/x',
    }),
    stderr: '',
  });
  const decisionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plandec-'));
  const svc = reviewSvc(dir, {
    decisionDir,
    gh,
    git: (cwd, args) => {
      if (args[0] === 'fetch') return { ok: true, stdout: '', stderr: '' };
      const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
      return {
        ok: r.status === 0,
        stdout: String(r.stdout || '').trim(),
        stderr: String(r.stderr || ''),
      };
    },
    selectCandidate: async () => ({ chosen: REVIEWER }),
    reviewLane: () => async (target) => ({
      pass: true,
      verdict: 'PASS',
      sha: target,
      findings: [],
    }),
  });
  const moved = await svc.reviewPullRequest({ pr: '7', sha: 'a'.repeat(40), authorKey: WRITER });
  assert.equal(moved.verdict, 'BLOCKED');
  assert.match(moved.reason, /PR_HEAD_MOVED/);

  const ok = await svc.reviewPullRequest({ pr: '7', sha, authorKey: WRITER });
  assert.equal(ok.verdict, 'PASS');
  assert.equal(ok.workItemId, ID);
  assert.equal(ok.sha, sha);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(decisionDir, 'review-manifest-' + ID + '.json'), 'utf8')
  );
  assert.equal(manifest.reviewedCommit, sha);
  assert.equal(manifest.reviewerCandidateKey, REVIEWER);
  assert.equal(manifest.writerCandidateKey, WRITER);

  const codes = [];
  const out = await cli.reviewCommand(
    { _: ['review', 'pr'], pr: 'x', sha: 'nope' },
    { error() {}, log() {}, exit: (c) => codes.push(c) }
  );
  assert.equal(out.exitCode, 2);
  assert.deepEqual(codes, [2]);
});

test('review pr CLI exits 0 only on PASS', async () => {
  const codes = [];
  const sha = 'b'.repeat(40);
  const run = (verdict) =>
    cli.reviewCommand(
      { _: ['review', 'pr'], pr: '3', sha, json: true },
      {
        log() {},
        error() {},
        exit: (c) => codes.push(c),
        planningServices: { reviewPullRequest: async () => ({ verdict, sha, reviewer: REVIEWER }) },
      }
    );
  await run('PASS');
  await run('CHANGES_REQUIRED');
  await run('BLOCKED');
  assert.deepEqual(codes, [0, 1, 1]);
});

function mergeFixture(extraCtx) {
  const { dir, base } = makeRepo();
  const head = commitDoc(dir);
  const calls = [];
  const svc = services.createPlanningServices(
    Object.assign(
      {
        rootDir: dir,
        decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plandec-')),
        publishPlan: async () => (calls.push('publish'), { ok: true }),
        governedMerge: async (o) => (
          calls.push('merge:' + o.workItemId),
          { ok: true, headSha: head }
        ),
      },
      extraCtx
    )
  );
  const plan = {
    headSha: head,
    baseSha: base,
    workerRoot: dir,
    branch: 'feat/x',
    candidateKey: WRITER,
  };
  const review = { verdict: 'PASS', sha: head, reviewer: REVIEWER, findings: [] };
  return { svc, plan, review, calls, dir, base, head };
}

test('docs-only merge executor: merges only with PASS on the exact SHA, docs-only, via exact-HEAD preflight', async () => {
  const f = mergeFixture();
  const ok = await f.svc.mergePlan({
    workItemId: ID,
    candidate: cand(WRITER),
    plan: f.plan,
    review: f.review,
  });
  assert.equal(ok.merged, true, JSON.stringify(ok));
  assert.deepEqual(f.calls, ['publish', 'merge:' + ID]);

  const stale = mergeFixture();
  const r1 = await stale.svc.mergePlan({
    workItemId: ID,
    candidate: cand(WRITER),
    plan: stale.plan,
    review: Object.assign({}, stale.review, { sha: 'c'.repeat(40) }),
  });
  assert.equal(r1.merged, false);
  assert.match(r1.reason, /MERGE_REVIEW_NOT_PASS_ON_SHA/);
  assert.deepEqual(stale.calls, []);

  const notPass = mergeFixture();
  const r2 = await notPass.svc.mergePlan({
    workItemId: ID,
    candidate: cand(WRITER),
    plan: notPass.plan,
    review: Object.assign({}, notPass.review, { verdict: 'CHANGES_REQUIRED' }),
  });
  assert.equal(r2.merged, false);

  const self = mergeFixture();
  const r3 = await self.svc.mergePlan({
    workItemId: ID,
    candidate: cand(WRITER),
    plan: self.plan,
    review: Object.assign({}, self.review, { reviewer: WRITER }),
  });
  assert.match(r3.reason, /NOT_INDEPENDENT/);
  assert.deepEqual(self.calls, []);
});

test('docs-only merge executor: refuses non-docs changes and relays a failed preflight (CI not green)', async () => {
  const bad = makeRepo();
  const head = commitDoc(bad.dir, { extra: 'src.js' });
  const calls = [];
  const svc = services.createPlanningServices({
    rootDir: bad.dir,
    decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plandec-')),
    publishPlan: async () => (calls.push('publish'), { ok: true }),
    governedMerge: async () => (calls.push('merge'), { ok: true }),
  });
  const r = await svc.mergePlan({
    workItemId: ID,
    candidate: cand(WRITER),
    plan: {
      headSha: head,
      baseSha: bad.base,
      workerRoot: bad.dir,
      branch: 'b',
      candidateKey: WRITER,
    },
    review: { verdict: 'PASS', sha: head, reviewer: REVIEWER, findings: [] },
  });
  assert.equal(r.merged, false);
  assert.match(r.reason, /NOT_DOCS_ONLY/);
  assert.deepEqual(calls, []);

  const red = mergeFixture({
    governedMerge: async () => ({
      ok: false,
      refusal: 'CHECK_NOT_SUCCESS',
      reason: 'CHECK_NOT_SUCCESS: ci',
    }),
  });
  const r2 = await red.svc.mergePlan({
    workItemId: ID,
    candidate: cand(WRITER),
    plan: red.plan,
    review: red.review,
  });
  assert.equal(r2.merged, false);
  assert.match(r2.reason, /CHECK_NOT_SUCCESS/);
});

const VALID_DRAFT_TEXT = `# FEAT-AUTH-02

## Business outcome

> Some spec content.

## Source references

- docs/product-spec/docs/01-product/PRODUCT-VISION-SCOPE.md

## Preconditions and dependencies

- None

## Author boundary

- None

## In scope

- None

## Out of scope

- None

## Business rules and edge cases

- None

## UI states

- None

## API, event and data impact

- None

## Acceptance matrix

| AC | Scenario | Expected | Evidence |
| --- | --- | --- | --- |

## Verification commands

- None

## Codex review record

| Round | Commit | Verdict | Findings |
| --- | --- | --- | --- |

## Residual limitations

- None
`;

function setupValidSourceRepo() {
  const host = makeRepo();
  const specFile = path.join(
    host.dir,
    'docs',
    'product-spec',
    'docs',
    '01-product',
    'PRODUCT-VISION-SCOPE.md'
  );
  fs.mkdirSync(path.dirname(specFile), { recursive: true });
  fs.writeFileSync(specFile, '# Product Vision\n\nSome spec content.', 'utf8');
  sh(host.dir, 'add', '-A');
  sh(host.dir, 'commit', '-m', 'chore: add spec source');
  return host;
}

test('planWorkItem --run reaches READY_FOR_AUTHOR with the real service wiring (stubbed externals)', async () => {
  const host = setupValidSourceRepo();
  const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plansvc-worker-'));
  sh(host.dir, 'clone', '-q', host.dir, workerDir);
  sh(workerDir, 'config', 'user.email', 't@example.test');
  sh(workerDir, 'config', 'user.name', 't');
  sh(workerDir, 'config', 'commit.gpgsign', 'false');
  const head = commitDoc(workerDir, { text: VALID_DRAFT_TEXT });
  const gitFn = (cwd, args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return {
      ok: r.status === 0,
      stdout: String(r.stdout || '').trim(),
      stderr: String(r.stderr || ''),
    };
  };
  const calls = [];
  const deps = planner.defaultPlanningDeps(host.dir, {
    items: [{ work_item_id: ID, status: 'BACKLOG' }],
    draftWorkItem: async () => ({
      id: ID,
      status: 'DRAFT',
      blocking: false,
      text: VALID_DRAFT_TEXT,
    }),
    rankPlanner: async () => cand(WRITER),
    servicesContext: {
      plannerRoot: workerDir,
      decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plandec-')),
      probe: false,
      git: gitFn,
      loadPool: () => ({
        annotated: [cand(REVIEWER, { harness: 'codex' })],
        evidenceData: {},
        accounts: [],
        registry: { sources: [] },
      }),
      orchestrate: fakeOrchestrate({
        resolveIsolatedWorkerRoot: () => workerDir,
        selectCandidateForProfile: async () => ({ chosen: REVIEWER }),
        reviewLane: () => async (t) => ({ pass: true, verdict: 'PASS', sha: t, findings: [] }),
      }),
      launcher: () => ({ exitCode: 0, workerSha: head, draftText: VALID_DRAFT_TEXT }),
      publishPlan: async () => (calls.push('publish'), { ok: true }),
      governedMerge: async () => (calls.push('merge'), { ok: true, headSha: head }),
    },
  });
  const result = await planner.planWorkItem(ID, { rootDir: host.dir, run: true }, deps);
  assert.equal(result.status, 'READY_FOR_AUTHOR');
  assert.deepEqual(calls, ['publish', 'merge']);
});

test('next-runner builds the real planning services and reaches review and governed merge', async () => {
  const { planningDepsFor } = require('../next-runner');
  const host = setupValidSourceRepo();
  const workerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plansvc-runner-worker-'));
  sh(host.dir, 'clone', '-q', host.dir, workerDir);
  sh(workerDir, 'config', 'user.email', 't@example.test');
  sh(workerDir, 'config', 'user.name', 't');
  sh(workerDir, 'config', 'commit.gpgsign', 'false');
  const head = commitDoc(workerDir, { text: VALID_DRAFT_TEXT });
  const gitFn = (cwd, args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    return {
      ok: r.status === 0,
      stdout: String(r.stdout || '').trim(),
      stderr: String(r.stderr || ''),
    };
  };
  const calls = [];
  const baseDeps = {
    items: [{ work_item_id: ID, status: 'BACKLOG' }],
    draftWorkItem: async () => ({
      id: ID,
      status: 'DRAFT',
      blocking: false,
      text: VALID_DRAFT_TEXT,
    }),
    rankPlanner: async () => cand(WRITER),
    servicesContext: {
      plannerRoot: workerDir,
      decisionDir: fs.mkdtempSync(path.join(os.tmpdir(), 'plandec2-')),
      probe: false,
      git: gitFn,
      loadPool: () => ({
        annotated: [cand(REVIEWER, { harness: 'codex' })],
        evidenceData: {},
        accounts: [],
        registry: { sources: [] },
      }),
      orchestrate: fakeOrchestrate({
        resolveIsolatedWorkerRoot: () => workerDir,
        selectCandidateForProfile: async () => ({ chosen: REVIEWER }),
        reviewLane: () => async (t) => ({ pass: true, verdict: 'PASS', sha: t, findings: [] }),
      }),
      launcher: () => ({ exitCode: 0, workerSha: head, draftText: VALID_DRAFT_TEXT }),
      publishPlan: async () => (calls.push('publish'), { ok: true }),
      governedMerge: async () => (calls.push('merge'), { ok: true, headSha: head }),
    },
  };
  const resolved = planningDepsFor(baseDeps, { externalWorkers: 'agy-pool' }, host.dir);
  assert.equal(typeof resolved.runPlanning, 'function');
  const result = await planner.planWorkItem(ID, { rootDir: host.dir, run: true }, resolved);
  assert.equal(result.status, 'READY_FOR_AUTHOR');
  assert.deepEqual(calls, ['publish', 'merge']);
});
