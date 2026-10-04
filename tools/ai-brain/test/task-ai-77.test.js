'use strict';

/**
 * Ship Dễ — TASK-AI-77 (Gate B): structured review manifest contract tests.
 *
 * One rule: evidence is promoted only when it is bound to the exact Work Item,
 * commit, tree, patch, Pull Request head and merge that were reviewed. Prose is
 * not a binding.
 *
 *   M-R01 validateManifest answers {ok:true} or {ok:false, code} for every shape.
 *   M-R02 tree and patch are recomputed from git, never read from the manifest.
 *   M-R03 PASS with an open finding is refused.
 *   M-R04 the reviewer must be independent of the writer.
 *   M-R05 artifactSha256 binds the manifest to the markdown review.
 *   M-R06 publish requires the manifest and validates it before any push.
 *   M-R07 import takes --manifest; a markdown review alone is MANIFEST_REQUIRED.
 *   M-R08 the merge must carry the reviewed patch; --pr-head must be the commit.
 *   M-R09 the recorded evidence item carries the whole binding, one store only.
 *   M-R10 `review manifest validate` exits 0 / 1 / 2.
 *
 * Hermetic: every repository, evidence store and manifest lives in a temp
 * directory removed afterwards. No network, no host registry, no host keys.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

// Lazy on purpose: on the parent commit review-manifest.js does not exist, so
// every requirement below is itself a failure of the contract.
const manifestApi = () => require('../review-manifest');
const evidence = require('../evidence');
const publisher = require('../publisher');
const { importWorkItemPass } = require('../work-evidence');
const { reviewCommand } = require('../cli');

const WORK_ITEM = 'TASK-AI-77';
const WRITER = 'openclaw::opencode::router::github::acc-1::scope-1::gpt-4.1';
const REVIEWER = 'codex::cli::review-gw::openai::rev-acc::rev-scope::gpt-5-codex';
const WRITER_CANDIDATE = {
  harness: 'openclaw',
  accessPath: 'opencode',
  gateway: 'router',
  upstream: 'github',
  accountId: 'acc-1',
  quotaScope: 'scope-1',
  modelId: 'gpt-4.1',
};
const FIXTURES = path.join(__dirname, 'fixtures', 'task-ai-77');
const CLI = path.join(__dirname, '..', 'cli.js');

const cleanup = [];
after(() => {
  for (const dir of cleanup) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // a temp dir left behind must never fail the suite
    }
  }
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

/** A temp git repository with no host config, no signing and no CRLF rewriting. */
function makeRepo() {
  const dir = tmpDir('task-ai-77-repo-');
  const git = (args) => {
    const res = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(res.status, 0, 'git ' + args.join(' ') + ': ' + (res.stderr || res.stdout));
    return (res.stdout || '').trim();
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'gate-b@shipde.test']);
  git(['config', 'user.name', 'ShipDe Gate B']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# gate-b fixture\n', 'utf8');
  git(['add', 'README.md']);
  git(['commit', '-q', '-m', 'initial commit']);
  return { dir, git, base: git(['rev-parse', 'HEAD']) };
}

/** One reviewed commit on its own branch; nothing is merged yet. */
function featureCommit(repo, file) {
  const name = file || 'feature.txt';
  repo.git(['checkout', '-q', '-b', 'feat/reviewed']);
  fs.writeFileSync(path.join(repo.dir, name), 'reviewed work\n', 'utf8');
  repo.git(['add', name]);
  repo.git(['commit', '-q', '-m', 'feat: reviewed work']);
  const commit = repo.git(['rev-parse', 'HEAD']);
  repo.git(['checkout', '-q', 'main']);
  return { base: repo.base, commit };
}

/** The human-readable review the manifest binds by sha256. */
function writeReview(repo, commit, name) {
  const file = path.join(repo.dir, name || 'review.md');
  fs.writeFileSync(
    file,
    '# Independent review for commit ' + commit + '\nReview verdict: PASS\n\nEvidence.\n',
    'utf8'
  );
  return file;
}

/** A manifest whose binding fields are computed from git unless overridden. */
function manifestFor(repo, spec) {
  const api = manifestApi();
  const writerKey = spec.writerKey || WRITER;
  const reviewerKey = spec.reviewerKey || REVIEWER;
  const manifest = {
    schemaVersion: spec.schemaVersion === undefined ? 1 : spec.schemaVersion,
    workItemId: spec.workItem === undefined ? WORK_ITEM : spec.workItem,
    reviewedCommit: spec.commit,
    reviewedBase: spec.base,
    reviewedTree: spec.tree || api.computeReviewedTree(repo.dir, spec.commit),
    reviewedPatchId: spec.patchId || api.computePatchId(repo.dir, spec.base, spec.commit),
    reviewerCandidateKey: reviewerKey,
    writerCandidateKey: writerKey,
    writerFailureDomain: spec.writerDomain || publisher.failureDomainFromCandidateKey(writerKey),
    reviewerFailureDomain:
      spec.reviewerDomain || publisher.failureDomainFromCandidateKey(reviewerKey),
    verdict: spec.verdict || 'PASS',
    findings: spec.findings || [],
    tests: spec.tests || [{ command: 'node --test', result: 'pass', summary: 'green' }],
    artifactSha256: spec.artifactSha256 || api.sha256File(spec.review),
    createdAt: spec.createdAt || '2026-10-04T00:00:00.000Z',
  };
  const file = spec.file || path.join(repo.dir, spec.name || 'review-manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { file, manifest };
}

/** repo + reviewed commit + merged main + review + manifest, ready to import. */
function mergedRepo(spec) {
  const o = spec || {};
  const repo = makeRepo();
  const reviewed = featureCommit(repo);
  const review = writeReview(repo, reviewed.commit);
  const written = manifestFor(repo, { ...reviewed, review, verdict: o.verdict });
  if (o.squash) {
    repo.git(['merge', '--squash', 'feat/reviewed']);
    repo.git(['commit', '-q', '-m', '[' + WORK_ITEM + '] Squashed work item']);
  } else {
    repo.git(['merge', '--no-ff', '-q', '-m', '[' + WORK_ITEM + '] Merge', 'feat/reviewed']);
  }
  return {
    ...reviewed,
    repo,
    review,
    manifest: written.manifest,
    manifestFile: written.file,
    mergeCommit: repo.git(['rev-parse', 'HEAD']),
    evidenceDir: tmpDir('task-ai-77-ev-'),
  };
}

const importOptions = (fixture, extra) =>
  Object.assign(
    {
      manifest: fixture.manifestFile,
      sha: fixture.commit,
      writer: WRITER,
      review: fixture.review,
      reviewer: 'independent-codex',
      workItem: WORK_ITEM,
      mainRef: 'main',
      evidenceDir: fixture.evidenceDir || tmpDir('task-ai-77-ev-'),
      cwd: fixture.repo.dir,
    },
    extra || {}
  );

const validate = (fixture, extra) =>
  manifestApi().validateManifest(
    fixture.manifest,
    Object.assign(
      { repoCwd: fixture.repo.dir, expected: { workItemId: WORK_ITEM, commit: fixture.commit } },
      extra || {}
    )
  );

/** Assert a refusal code, keeping one rule per line. */
function assertCode(result, code, message) {
  assert.equal(result.ok, false, message);
  assert.equal(result.code, code, message);
}

const mergedFixture = (fixture, extra) =>
  validate({ ...fixture }, { artifactPath: fixture.review, ...extra });

// M-R01 -----------------------------------------------------------------------
test('M-R01 every schema field is required; a malformed manifest is SCHEMA_INVALID', () => {
  const api = manifestApi();
  const fixture = mergedRepo();
  const bound = {
    repoCwd: fixture.repo.dir,
    expected: { workItemId: WORK_ITEM, commit: fixture.commit },
  };
  const check = (manifest) => api.validateManifest(manifest, bound);
  assert.equal(check(fixture.manifest).ok, true, 'a faithful manifest validates');
  // Every field the built manifest carries is required: drop one, get a refusal.
  for (const field of Object.keys(fixture.manifest)) {
    const copy = Object.assign({}, fixture.manifest);
    delete copy[field];
    assertCode(check(copy), 'SCHEMA_INVALID', field + ' must be required');
  }
  const malformed = [
    { schemaVersion: 2 },
    { verdict: 'APPROVED' },
    { writerCandidateKey: 'openclaw::opencode::router::github::acc-1::scope-1' },
    { reviewedTree: 'not-a-tree' },
    { artifactSha256: 'ab' },
    { createdAt: 'yesterday' },
    { findings: [{ id: 'F-1', severity: 'minor', status: 'maybe', summary: 'x' }] },
    { tests: [{ command: 'node --test', result: 'skipped', summary: 'x' }] },
  ];
  for (const override of malformed) {
    const label = JSON.stringify(override);
    assertCode(check(Object.assign({}, fixture.manifest, override)), 'SCHEMA_INVALID', label);
  }
  // Committed malformed samples are refused on shape alone, before git runs.
  for (const name of fs.readdirSync(FIXTURES)) {
    assertCode(api.validateManifestFile(path.join(FIXTURES, name), bound), 'SCHEMA_INVALID', name);
  }
  assertCode(
    api.validateManifestFile(path.join(FIXTURES, 'does-not-exist.json'), bound),
    'SCHEMA_INVALID',
    'an unreadable manifest is SCHEMA_INVALID, never an exception'
  );
  assertCode(
    check(Object.assign({}, fixture.manifest, { workItemId: 'TASK-AI-78' })),
    'WORK_ITEM_MISMATCH',
    'a manifest for another work item is refused'
  );
});

// M-R02 -----------------------------------------------------------------------
test('M-R02 tree and patch are recomputed from git, never read from the manifest', () => {
  const api = manifestApi();
  const fixture = mergedRepo();
  const check = (override) =>
    api.validateManifest(Object.assign({}, fixture.manifest, override), {
      repoCwd: fixture.repo.dir,
      expected: { workItemId: WORK_ITEM, commit: fixture.commit },
    });
  assertCode(check({ reviewedTree: 'a'.repeat(40) }), 'TREE_MISMATCH', 'only git catches this');
  assertCode(check({ reviewedPatchId: 'b'.repeat(40) }), 'PATCH_MISMATCH', 'only git catches this');
  // The manifest is about one commit, never about HEAD: git moving on must not
  // disturb it, and a manifest pointed at another commit must not match.
  fs.writeFileSync(path.join(fixture.repo.dir, 'later.txt'), 'later\n', 'utf8');
  fixture.repo.git(['add', 'later.txt']);
  fixture.repo.git(['commit', '-q', '-m', 'later commit']);
  assert.equal(
    validate({ repo: fixture.repo, commit: fixture.commit, manifest: fixture.manifest }).ok,
    true,
    'a later commit on main must not disturb a manifest bound to its own commit'
  );
  assertCode(
    validate({ repo: fixture.repo, commit: fixture.base, manifest: fixture.manifest }),
    'SHA_MISMATCH',
    'expected.commit that is not the reviewed commit is SHA_MISMATCH'
  );
  assertCode(check({ reviewedCommit: 'c'.repeat(40) }), 'SHA_MISMATCH', 'git has no such commit');
  assertCode(
    api.validateManifest(fixture.manifest, { expected: {} }),
    'SCHEMA_INVALID',
    'without repoCwd nothing can be recomputed, so the manifest is refused'
  );
});

// M-R03 -----------------------------------------------------------------------
test('M-R03 PASS with any open finding is refused; nothing open passes', () => {
  const fixture = mergedRepo();
  const base = { base: fixture.base, commit: fixture.commit, review: fixture.review };
  const withOpen = manifestFor(fixture.repo, {
    ...base,
    findings: [
      { id: 'F-1', severity: 'minor', status: 'resolved', summary: 'fixed' },
      { id: 'F-2', severity: 'major', status: 'open', summary: 'tenant scope unproven' },
    ],
  });
  const refused = mergedFixture({ ...fixture, manifest: withOpen.manifest });
  assertCode(refused, 'PASS_WITH_OPEN_FINDINGS');
  assert.match(refused.reason, /F-2/, 'the refusal names the open finding');
  const resolved = manifestFor(fixture.repo, {
    ...base,
    name: 'resolved.json',
    findings: [{ id: 'F-2', severity: 'major', status: 'resolved', summary: 'fixed' }],
  });
  assert.equal(mergedFixture({ ...fixture, manifest: resolved.manifest }).ok, true);
  const blocked = manifestFor(fixture.repo, { ...base, name: 'blocked.json', verdict: 'BLOCKED' });
  assert.equal(
    mergedFixture({ ...fixture, manifest: blocked.manifest }).ok,
    true,
    'a review that did not pass is a valid document; promotion is refused elsewhere'
  );
});

// M-R04 -----------------------------------------------------------------------
test('M-R04 a reviewer that is the writer, shares its domain, upstream or model is refused', () => {
  const fixture = mergedRepo();
  const refuse = (spec) =>
    mergedFixture({
      ...fixture,
      manifest: manifestFor(fixture.repo, {
        base: fixture.base,
        commit: fixture.commit,
        review: fixture.review,
        ...spec,
      }).manifest,
    });
  const cases = [
    [{ reviewerKey: WRITER, name: 'same-key.json' }, 'the writer cannot review itself'],
    [
      {
        reviewerKey: 'codex::cli::other-gw::openai::rev-acc::rev-scope::gpt-5-codex',
        writerDomain: 'router/github',
        reviewerDomain: 'router/github',
        name: 'declared.json',
      },
      'declared domains cannot launder a shared domain',
    ],
    [
      {
        reviewerKey: 'codex::cli::router::github::rev-acc::rev-scope::gpt-5-codex',
        name: 'd.json',
      },
      'same gateway and upstream is the same failure domain',
    ],
    [
      {
        reviewerKey: 'codex::cli::other-gw::github::rev-acc::rev-scope::gpt-5-codex',
        name: 'u.json',
      },
      'same upstream',
    ],
    [
      { reviewerKey: 'codex::cli::other-gw::openai::rev-acc::rev-scope::gpt-4.1', name: 'm.json' },
      'same modelId',
    ],
  ];
  for (const [spec, why] of cases) {
    assertCode(refuse(spec), 'REVIEWER_NOT_INDEPENDENT', why);
  }
  assert.equal(refuse({}).ok, true, 'an independent reviewer validates');
});

// M-R05 -----------------------------------------------------------------------
test('M-R05 artifactSha256 must be the sha256 of the markdown review it accompanies', () => {
  const fixture = mergedRepo();
  assert.equal(mergedFixture(fixture).ok, true);
  fs.appendFileSync(fixture.review, 'tampered after review\n', 'utf8');
  assertCode(mergedFixture(fixture), 'ARTIFACT_HASH_MISMATCH');
  assertCode(
    validate(fixture, { artifactPath: path.join(fixture.repo.dir, 'no-such-review.md') }),
    'ARTIFACT_HASH_MISMATCH',
    'a missing artifact cannot match a recorded digest'
  );
});

// M-R06 -----------------------------------------------------------------------
test('M-R06 publish requires the manifest and validates it before any push', () => {
  // The publish path compares cwd HEAD with reviewedSha, so the reviewed commit
  // is the one checked out here.
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo.dir, 'feature.txt'), 'reviewed work\n', 'utf8');
  repo.git(['add', 'feature.txt']);
  repo.git(['commit', '-q', '-m', 'feat: reviewed work']);
  const commit = repo.git(['rev-parse', 'HEAD']);
  const review = writeReview(repo, commit);
  const good = manifestFor(repo, { base: repo.base, commit, review });
  const other = manifestFor(repo, {
    base: repo.base,
    commit: repo.base,
    review,
    patchId: 'b'.repeat(40),
    name: 'other-commit.json',
  });
  const wrongItem = manifestFor(repo, {
    base: repo.base,
    commit,
    review,
    workItem: 'TASK-AI-76',
    name: 'other-work-item.json',
  });
  // A temp approval registry naming this approval, so the refusal under test is
  // the manifest gate and not the registry, the clone or the push.
  const registryPath = path.join(tmpDir('task-ai-77-reg-'), 'approvals.json');
  fs.writeFileSync(registryPath, JSON.stringify({ 'AP-77-1': 'APPROVED' }), 'utf8');
  const options = {
    cwd: repo.dir,
    reviewedSha: commit,
    workItemId: WORK_ITEM,
    approvalId: 'AP-77-1',
    expiry: Date.now() + 60000,
    verdict: 'PASS',
    remoteUrl: 'https://github.com/shipde/shipde-platform.git',
    branch: 'feat/task-ai-77',
    reviewArtifact: review,
    registryPath,
    testMode: false,
  };

  assert.throws(
    () => publisher.publish(options),
    /PUBLISH_REFUSED: MANIFEST_REQUIRED/,
    'a push with no review manifest is refused before the clone and the push'
  );
  assert.throws(
    () => publisher.publish({ ...options, reviewManifest: other.file }),
    /PUBLISH_REFUSED: SHA_MISMATCH/,
    'a manifest for another commit cannot authorise this push'
  );
  assert.throws(
    () => publisher.publish({ ...options, reviewManifest: wrongItem.file }),
    /PUBLISH_REFUSED: WORK_ITEM_MISMATCH/
  );
  assert.throws(
    () => publisher.publish({ ...options, testMode: true, reviewManifest: other.file }),
    /PUBLISH_REFUSED: SHA_MISMATCH/,
    'a manifest that IS supplied is validated in testMode too'
  );
  assert.equal(
    publisher.publish({ ...options, testMode: true, reviewManifest: good.file }).status,
    'published',
    'a valid manifest does not block a publish'
  );
  assert.equal(
    publisher.publish({ ...options, testMode: true }).status,
    'published',
    'testMode is the P2-style test-only seam: a simulated publish pushes nothing'
  );
});

// M-R07 -----------------------------------------------------------------------
test('M-R07 a markdown review alone is MANIFEST_REQUIRED; the verdict comes from the manifest', () => {
  const fixture = mergedRepo();
  const withoutManifest = importOptions(fixture);
  delete withoutManifest.manifest;
  assertCode(importWorkItemPass(withoutManifest), 'MANIFEST_REQUIRED');
  assert.equal(
    fs.existsSync(path.join(fixture.evidenceDir, 'evidence.json')),
    false,
    'a refused import writes nothing'
  );
  // The markdown says PASS, the manifest says CHANGES_REQUIRED: the manifest wins.
  const changes = mergedRepo({ verdict: 'CHANGES_REQUIRED' });
  assertCode(importWorkItemPass(importOptions(changes)), 'VERDICT_NOT_PASS');
  const imported = importWorkItemPass(importOptions(fixture));
  assert.equal(imported.ok, true);
  assert.equal(imported.status, 'IMPORTED');
});

// M-R08 -----------------------------------------------------------------------
test('M-R08 the merge must carry the reviewed patch; a title alone is never enough', () => {
  // 1. A merge titled [TASK-AI-77] that carries the reviewed patch: ancestor.
  const merged = mergedRepo();
  const mergedImport = importWorkItemPass(importOptions(merged));
  assert.equal(mergedImport.ok, true, 'the reviewed patch reached main');
  assert.equal(mergedImport.mergeProof, 'ancestor');
  assert.equal(mergedImport.mergeCommit, merged.mergeCommit);
  assert.equal(
    importWorkItemPass(importOptions(merged, { prHead: merged.commit })).ok,
    true,
    'a PR head equal to the reviewed commit is accepted'
  );
  assertCode(
    importWorkItemPass(importOptions(merged, { prHead: merged.mergeCommit })),
    'PR_HEAD_MISMATCH',
    'a PR head that moved is refused'
  );

  // 2. The same merge with a title that never names the work item: no proof.
  const untitled = makeRepo();
  const feature = featureCommit(untitled);
  const review = writeReview(untitled, feature.commit);
  const manifest = manifestFor(untitled, { ...feature, review });
  untitled.git(['merge', '--no-ff', '-q', '-m', 'Merge feature branch', 'feat/reviewed']);
  assertCode(
    importWorkItemPass(
      importOptions({ ...feature, repo: untitled, review, manifestFile: manifest.file })
    ),
    'NOT_MERGED',
    'an untitled merge proves nothing'
  );

  // 3. Squash merge: the reviewed commit is not an ancestor, the patch is.
  const squashed = mergedRepo({ squash: true });
  const squashImport = importWorkItemPass(importOptions(squashed));
  assert.equal(squashImport.ok, true);
  assert.equal(squashImport.mergeProof, 'squash');
  assert.equal(squashImport.mergeCommit, squashed.mergeCommit);

  // 4. A [TASK-AI-77] commit whose patch is not the reviewed one.
  const tampered = makeRepo();
  const reviewedFeature = featureCommit(tampered);
  const tamperedReview = writeReview(tampered, reviewedFeature.commit);
  const tamperedManifest = manifestFor(tampered, { ...reviewedFeature, review: tamperedReview });
  fs.writeFileSync(path.join(tampered.dir, 'other.txt'), 'not the reviewed work\n', 'utf8');
  tampered.git(['add', 'other.txt']);
  tampered.git(['commit', '-q', '-m', '[' + WORK_ITEM + '] A different change']);
  assertCode(
    importWorkItemPass(
      importOptions({
        ...reviewedFeature,
        repo: tampered,
        review: tamperedReview,
        manifestFile: tamperedManifest.file,
      })
    ),
    'SQUASH_PATCH_MISMATCH',
    'a commit message alone never promotes anything'
  );
});

// M-R09 -----------------------------------------------------------------------
test('M-R09 the recorded item carries the whole binding, in the one existing store', () => {
  const api = manifestApi();
  const fixture = mergedRepo();
  assert.equal(importWorkItemPass(importOptions(fixture)).ok, true);
  const items = evidence.getEvidence(evidence.loadEvidence(fixture.evidenceDir), WRITER_CANDIDATE);
  assert.equal(items.length, 1, 'exactly one evidence item, and no second store');
  const binding = {
    workItemId: WORK_ITEM,
    reviewedCommit: fixture.commit,
    reviewedTree: api.computeReviewedTree(fixture.repo.dir, fixture.commit),
    reviewedPatchId: api.computePatchId(fixture.repo.dir, fixture.base, fixture.commit),
    mergeCommit: fixture.mergeCommit,
    manifestSha256: api.sha256File(fixture.manifestFile),
  };
  for (const [field, value] of Object.entries(binding)) {
    assert.equal(items[0][field], value, field + ' must be the reviewed binding');
  }
  assert.deepEqual(fs.readdirSync(fixture.evidenceDir), ['evidence.json']);
  // The binding recorded is the one git still agrees with, re-derived from scratch.
  assert.equal(
    api.validateManifestFile(fixture.manifestFile, {
      repoCwd: fixture.repo.dir,
      expected: { workItemId: items[0].workItemId, commit: items[0].reviewedCommit },
      artifactPath: fixture.review,
    }).ok,
    true
  );
});

// M-R10 -----------------------------------------------------------------------
test('M-R10 review manifest validate exits 0 when bound, 1 when refused, 2 on bad argv', () => {
  const fixture = mergedRepo();
  const run = (args) => {
    const codes = [];
    const out = [];
    const err = [];
    const res = reviewCommand(
      Object.assign({ _: ['review', 'manifest', 'validate'], root: fixture.repo.dir }, args),
      { log: (m) => out.push(m), error: (m) => err.push(m), exit: (code) => codes.push(code) }
    );
    return { code: res.exitCode, codes, out: out.join('\n'), err: err.join('\n') };
  };
  const args = {
    manifest: fixture.manifestFile,
    artifact: fixture.review,
    'work-item': WORK_ITEM,
    sha: fixture.commit,
  };
  const bound = run({ ...args, json: true });
  assert.equal(bound.code, 0, 'a faithful manifest exits 0');
  assert.deepEqual(bound.codes, [0], 'the injected exit is used');
  assert.equal(JSON.parse(bound.out).ok, true);
  const wrongItem = run({ ...args, 'work-item': 'TASK-AI-76' });
  assert.equal(wrongItem.code, 1);
  assert.match(wrongItem.err, /REFUSED: WORK_ITEM_MISMATCH/);
  assert.equal(run({ manifest: fixture.manifestFile, artifact: fixture.review }).code, 2);
  assert.equal(
    reviewCommand({ _: ['review', 'unknown'] }, { exit: () => {}, error: () => {}, log: () => {} })
      .exitCode,
    2
  );

  // The real CLI entry, in a subprocess: the same three exit codes.
  const spawnCli = (argv) =>
    cp.spawnSync(process.execPath, [CLI].concat(argv), {
      cwd: fixture.repo.dir,
      encoding: 'utf8',
      windowsHide: true,
    });
  const argv = (sha) => [
    'review',
    'manifest',
    'validate',
    '--manifest',
    fixture.manifestFile,
    '--artifact',
    fixture.review,
    '--work-item',
    WORK_ITEM,
    '--sha',
    sha,
  ];
  const ok = spawnCli(argv(fixture.commit));
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  const refused = spawnCli(argv(fixture.base));
  assert.equal(refused.status, 1, refused.stderr || refused.stdout);
  assert.equal(spawnCli(['review', 'manifest', 'validate', '--manifest']).status, 2);
});
