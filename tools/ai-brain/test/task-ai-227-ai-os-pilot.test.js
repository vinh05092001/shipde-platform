'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BRAIN_DIR = path.resolve(__dirname, '..');
const RESUME_CLI = path.join(BRAIN_DIR, 'resume-status.js');
const VALIDATE_CLI = path.join(BRAIN_DIR, 'validate-work-item.js');
const HYGIENE_CLI = path.join(BRAIN_DIR, 'hygiene-check.js');

function runNode(scriptPath, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
}

function runGit(cwd, args) {
  const nul = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const res = spawnSync(
    'git',
    [
      '-c',
      'core.hooksPath=' + nul,
      '-c',
      'core.autocrlf=false',
      '-c',
      'user.name=Test User',
      '-c',
      'user.email=test@example.com',
      ...args,
    ],
    {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
    }
  );
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return (res.stdout || '').trim();
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function initDisposableRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  runGit(dir, ['init', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n', 'utf8');
  runGit(dir, ['add', 'README.md']);
  runGit(dir, ['commit', '-m', 'init']);
  const baseSha = runGit(dir, ['rev-parse', 'HEAD']);
  runGit(dir, ['checkout', '-b', 'feat/task-ai-227-demo']);
  fs.writeFileSync(path.join(dir, 'feature.txt'), 'v1\n', 'utf8');
  runGit(dir, ['add', 'feature.txt']);
  runGit(dir, ['commit', '-m', 'feat v1']);
  const headSha = runGit(dir, ['rev-parse', 'HEAD']);
  return { baseSha, headSha };
}

function snapshotFile(filePath) {
  const st = fs.statSync(filePath);
  return {
    content: fs.readFileSync(filePath, 'utf8'),
    mtimeMs: st.mtimeMs,
  };
}

test('AC1 & AC4: resume-status reads mid-review checkpoint across independent processes, keeps missing PR/CI/worker unknown, detects HEAD mismatch, and mutates nothing', () => {
  const tmp = makeTempDir('wi227-ac1-');
  try {
    const repoDir = path.join(tmp, 'repo');
    const { baseSha, headSha } = initDisposableRepo(repoDir);
    const cpPath = path.join(tmp, 'checkpoint.json');
    const cpTmpPath = cpPath + '.tmp';

    const checkpoint = {
      runId: 'run-227-001',
      status: 'IN_REVIEW',
      liveSteps: {
        'TASK-AI-227': {
          owner: 'agy08',
          phase: 'REVIEW',
          baseSha,
          headSha,
          branch: 'feat/task-ai-227-demo',
          workerRoot: repoDir,
          review: {
            receipt: {
              workItemId: 'TASK-AI-227',
              sha: headSha,
              baseSha,
              branch: 'feat/task-ai-227-demo',
              workerRoot: repoDir,
              writerCandidateKey: 'agy-pool::agy08::gemini-4-neon-high',
              reviewer: 'codex::gpt-6.2-sol',
              verdict: 'PENDING',
              reviewRounds: 1,
              openFindings: 0,
            },
          },
        },
      },
    };
    fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2), 'utf8');
    // Place a sibling .tmp file to prove resume-status does NOT adopt/unlink it (strict read-only).
    fs.writeFileSync(cpTmpPath, '{"partial":true}', 'utf8');

    const cpBefore = snapshotFile(cpPath);
    const tmpBefore = snapshotFile(cpTmpPath);

    // Two independent CLI processes against the same checkpoint and repo
    const res1 = runNode(RESUME_CLI, [
      '--wi',
      'TASK-AI-227',
      '--checkpoint',
      cpPath,
      '--checkout',
      repoDir,
    ]);
    assert.equal(res1.status, 0, `expected exit 0, got ${res1.status}: ${res1.stderr}`);
    const out1 = JSON.parse(res1.stdout);

    const res2 = runNode(RESUME_CLI, [
      '--wi',
      'TASK-AI-227',
      '--checkpoint',
      cpPath,
      '--checkout',
      repoDir,
    ]);
    assert.equal(res2.status, 0, `expected exit 0, got ${res2.status}: ${res2.stderr}`);
    const out2 = JSON.parse(res2.stdout);

    assert.deepEqual(out1, out2);
    assert.equal(out1.ok, true);
    assert.equal(out1.workItemId, 'TASK-AI-227');
    assert.equal(out1.runId, 'run-227-001');
    assert.equal(out1.git.recordedBaseSha, baseSha);
    assert.equal(out1.git.recordedHeadSha, headSha);
    assert.equal(out1.git.observedHeadSha, headSha);
    assert.equal(out1.git.headMatchesRecorded, true);
    assert.equal(out1.owner.writer, 'agy-pool::agy08::gemini-4-neon-high');
    assert.equal(out1.review.verdict, 'PENDING');
    assert.equal(out1.observations.pr, 'unknown');
    assert.equal(out1.observations.ci, 'unknown');
    assert.equal(out1.observations.worker, 'unknown');
    assert.equal(out1.reconciliation.needed, false);
    assert.notEqual(out1.nextAction, 'MERGE');

    // Mutate HEAD in disposable repo and verify report switches to reconciliation
    fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'v2\n', 'utf8');
    runGit(repoDir, ['add', 'feature.txt']);
    runGit(repoDir, ['commit', '-m', 'feat v2']);
    const newHead = runGit(repoDir, ['rev-parse', 'HEAD']);

    const res3 = runNode(RESUME_CLI, [
      '--wi',
      'TASK-AI-227',
      '--checkpoint',
      cpPath,
      '--checkout',
      repoDir,
    ]);
    assert.equal(res3.status, 0, `expected exit 0 on mismatch report: ${res3.stderr}`);
    const out3 = JSON.parse(res3.stdout);
    assert.equal(out3.git.observedHeadSha, newHead);
    assert.equal(out3.git.headMatchesRecorded, false);
    assert.equal(out3.reconciliation.needed, true);
    assert.ok(out3.reconciliation.reasons.includes('HEAD_MISMATCH'));
    assert.doesNotMatch(String(out3.nextAction), /LAUNCH|MERGE/i);

    // AC4: Checkpoint and sibling .tmp were NOT modified or deleted
    const cpAfter = snapshotFile(cpPath);
    const tmpAfter = snapshotFile(cpTmpPath);
    assert.equal(cpAfter.content, cpBefore.content);
    assert.equal(tmpAfter.content, tmpBefore.content);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC2 & AC4: validate-work-item passes valid WI and fails on missing scope, mismatched branch, and duplicate register row', () => {
  const tmp = makeTempDir('wi227-ac2-');
  try {
    const csvHeader =
      '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"\n';
    const validRow =
      '"349","S00","AI workflow","TASK-AI-227","","Pilot","Pilot behavior","READY_FOR_AUTHOR","TASK-AI-226","docs/product-spec/work-items/TASK-AI-227.md","feat/task-ai-227-ai-os-pilot","","",""\n';

    const validMd = [
      '# TASK-AI-227 — Pilot',
      '',
      '## Control',
      '',
      '| Field | Value |',
      '| --- | --- |',
      '| Work Item ID | TASK-AI-227 |',
      '| Status | READY_FOR_AUTHOR |',
      '| Branch | feat/task-ai-227-ai-os-pilot |',
      '| Allowed paths | `tools/ai-brain/resume-status.js` |',
      '',
      '## Acceptance',
      '',
      '- AC1: works',
      '',
      '## Verification',
      '',
      '- node --test tools/ai-brain/test/task-ai-227-ai-os-pilot.test.js',
      '',
    ].join('\n');

    const regPath = path.join(tmp, 'register.csv');
    const mdPath = path.join(tmp, 'TASK-AI-227.md');
    fs.writeFileSync(regPath, csvHeader + validRow, 'utf8');
    fs.writeFileSync(mdPath, validMd, 'utf8');

    const regBefore = snapshotFile(regPath);
    const mdBefore = snapshotFile(mdPath);

    // 1. Valid item passes
    const okRes = runNode(VALIDATE_CLI, [
      '--wi',
      'TASK-AI-227',
      '--file',
      mdPath,
      '--register',
      regPath,
    ]);
    assert.equal(
      okRes.status,
      0,
      `expected exit 0, got ${okRes.status}: ${okRes.stdout} ${okRes.stderr}`
    );
    const okOut = JSON.parse(okRes.stdout);
    assert.equal(okOut.ok, true);
    assert.equal(okOut.ready, true);
    assert.equal(okOut.errors.length, 0);

    // 2. Missing Allowed paths fails
    const noScopePath = path.join(tmp, 'no-scope.md');
    fs.writeFileSync(
      noScopePath,
      validMd.replace(
        '| Allowed paths | `tools/ai-brain/resume-status.js` |',
        '| Allowed paths |  |'
      ),
      'utf8'
    );
    const noScopeRes = runNode(VALIDATE_CLI, [
      '--wi',
      'TASK-AI-227',
      '--file',
      noScopePath,
      '--register',
      regPath,
    ]);
    assert.notEqual(noScopeRes.status, 0);
    const noScopeOut = JSON.parse(noScopeRes.stdout);
    assert.ok(noScopeOut.errors.some((e) => e.code === 'ALLOWED_PATHS_MISSING'));

    // 3. Mismatched branch fails
    const badBranchPath = path.join(tmp, 'bad-branch.md');
    fs.writeFileSync(
      badBranchPath,
      validMd.replace('feat/task-ai-227-ai-os-pilot', 'feat/other-branch'),
      'utf8'
    );
    const badBranchRes = runNode(VALIDATE_CLI, [
      '--wi',
      'TASK-AI-227',
      '--file',
      badBranchPath,
      '--register',
      regPath,
    ]);
    assert.notEqual(badBranchRes.status, 0);
    const badBranchOut = JSON.parse(badBranchRes.stdout);
    assert.ok(badBranchOut.errors.some((e) => e.code === 'BRANCH_MISMATCH'));

    // 4. Duplicate register row fails
    const dupRegPath = path.join(tmp, 'dup-register.csv');
    fs.writeFileSync(dupRegPath, csvHeader + validRow + validRow, 'utf8');
    const dupRes = runNode(VALIDATE_CLI, [
      '--wi',
      'TASK-AI-227',
      '--file',
      mdPath,
      '--register',
      dupRegPath,
    ]);
    assert.notEqual(dupRes.status, 0);
    const dupOut = JSON.parse(dupRes.stdout);
    assert.ok(dupOut.errors.some((e) => e.code === 'REGISTER_DUPLICATE_ROW'));

    // AC4: Input files untouched
    assert.equal(snapshotFile(regPath).content, regBefore.content);
    assert.equal(snapshotFile(mdPath).content, mdBefore.content);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC3 & AC4: hygiene-check requires --dry-run, lists bound clean shipped candidate, retains dirty/active/unbound/foreign-name worktrees, and deletes nothing', () => {
  const tmp = makeTempDir('wi227-ac3-');
  try {
    const repoRoot = path.join(tmp, 'repo');
    const wtRoot = path.join(repoRoot, '.worktrees');
    fs.mkdirSync(wtRoot, { recursive: true });

    // Base main repo
    fs.mkdirSync(repoRoot, { recursive: true });
    runGit(repoRoot, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# root\n', 'utf8');
    runGit(repoRoot, ['add', 'README.md']);
    runGit(repoRoot, ['commit', '-m', 'root init']);

    // 1. Bound clean shipped worktree
    const cleanWt = path.join(wtRoot, 'agy-task-ai-227-clean');
    runGit(repoRoot, ['worktree', 'add', '-b', 'feat/task-ai-227-clean', cleanWt, 'main']);
    fs.writeFileSync(path.join(cleanWt, 'clean.txt'), 'shipped\n', 'utf8');
    runGit(cleanWt, ['add', 'clean.txt']);
    runGit(cleanWt, ['commit', '-m', 'shipped commit']);
    const shippedSha = runGit(cleanWt, ['rev-parse', 'HEAD']);
    // Merge into main so shipped change is proven in main
    runGit(repoRoot, ['merge', '--ff-only', shippedSha]);

    // 2. Bound dirty worktree
    const dirtyWt = path.join(wtRoot, 'agy-task-ai-227-dirty');
    runGit(repoRoot, ['worktree', 'add', '-b', 'feat/task-ai-227-dirty', dirtyWt, 'main']);
    fs.writeFileSync(path.join(dirtyWt, 'uncommitted.txt'), 'wip\n', 'utf8');

    // 3. Foreign worktree whose name matches TASK-AI-227 but is NOT bound in checkpoint
    const foreignWt = path.join(wtRoot, 'foreign-task-ai-227-match');
    runGit(repoRoot, ['worktree', 'add', '-b', 'feat/task-ai-227-foreign', foreignWt, 'main']);

    const csvHeader =
      '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"\n';
    const mergedRow = `"349","S00","AI workflow","TASK-AI-227","","Pilot","Pilot","MERGED","TASK-AI-226","docs/product-spec/work-items/TASK-AI-227.md","feat/task-ai-227-clean","#999","PASS","${shippedSha}"\n`;
    const regPath = path.join(tmp, 'register.csv');
    fs.writeFileSync(regPath, csvHeader + mergedRow, 'utf8');

    const cpPath = path.join(tmp, 'checkpoint.json');
    const checkpoint = {
      runId: 'run-227-clean',
      status: 'COMPLETED',
      worktrees: [
        {
          workItemId: 'TASK-AI-227',
          owner: 'agy08',
          path: cleanWt,
          branch: 'feat/task-ai-227-clean',
          headSha: shippedSha,
          active: false,
        },
        {
          workItemId: 'TASK-AI-227',
          owner: 'agy08',
          path: dirtyWt,
          branch: 'feat/task-ai-227-dirty',
          headSha: shippedSha,
          active: false,
        },
      ],
    };
    fs.writeFileSync(cpPath, JSON.stringify(checkpoint, null, 2), 'utf8');

    // AC4: Refusal without --dry-run
    const refuseRes = runNode(HYGIENE_CLI, [
      '--wi',
      'TASK-AI-227',
      '--checkpoint',
      cpPath,
      '--repo-root',
      repoRoot,
      '--register',
      regPath,
    ]);
    assert.notEqual(refuseRes.status, 0);
    const refuseOut = JSON.parse(refuseRes.stdout);
    assert.equal(refuseOut.ok, false);
    assert.equal(refuseOut.code, 'DRY_RUN_REQUIRED');

    // AC3: With --dry-run
    const dryRes = runNode(HYGIENE_CLI, [
      '--wi',
      'TASK-AI-227',
      '--checkpoint',
      cpPath,
      '--repo-root',
      repoRoot,
      '--register',
      regPath,
      '--main-ref',
      'main',
      '--dry-run',
    ]);
    assert.equal(
      dryRes.status,
      0,
      `expected exit 0, got ${dryRes.status}: ${dryRes.stdout} ${dryRes.stderr}`
    );
    const dryOut = JSON.parse(dryRes.stdout);
    assert.equal(dryOut.ok, true);
    assert.equal(dryOut.dryRun, true);

    const candidatePaths = dryOut.candidates.map((c) => path.resolve(c.path));
    const retainedPaths = dryOut.retained.map((r) => path.resolve(r.path));

    assert.ok(
      candidatePaths.includes(path.resolve(cleanWt)),
      `bound clean shipped worktree should be candidate: ${JSON.stringify(dryOut)}`
    );
    assert.ok(
      !candidatePaths.includes(path.resolve(dirtyWt)),
      'dirty worktree must not be candidate'
    );
    assert.ok(retainedPaths.includes(path.resolve(dirtyWt)), 'dirty worktree must be retained');
    assert.ok(
      !candidatePaths.includes(path.resolve(foreignWt)),
      'foreign worktree with matching name must NEVER be candidate'
    );

    // Active run must hold even a clean worktree
    const activeCpPath = path.join(tmp, 'checkpoint-active.json');
    fs.writeFileSync(
      activeCpPath,
      JSON.stringify({
        ...checkpoint,
        status: 'RUNNING',
        worktrees: [{ ...checkpoint.worktrees[0], active: true }],
      }),
      'utf8'
    );
    const activeRes = runNode(HYGIENE_CLI, [
      '--wi',
      'TASK-AI-227',
      '--checkpoint',
      activeCpPath,
      '--repo-root',
      repoRoot,
      '--register',
      regPath,
      '--main-ref',
      'main',
      '--dry-run',
    ]);
    assert.equal(activeRes.status, 0);
    const activeOut = JSON.parse(activeRes.stdout);
    assert.equal(activeOut.candidates.length, 0);
    assert.ok(activeOut.retained.some((r) => r.reasons.includes('RUN_ACTIVE')));

    // AC4: Nothing was deleted on disk
    assert.ok(fs.existsSync(cleanWt));
    assert.ok(fs.existsSync(dirtyWt));
    assert.ok(fs.existsSync(foreignWt));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('AC4: missing or invalid CLI inputs produce clear nonzero JSON results', () => {
  const r1 = runNode(RESUME_CLI, ['--wi', 'TASK-AI-227']);
  assert.notEqual(r1.status, 0);
  assert.equal(JSON.parse(r1.stdout).ok, false);

  const r2 = runNode(VALIDATE_CLI, ['--wi', 'TASK-AI-227']);
  assert.notEqual(r2.status, 0);
  assert.equal(JSON.parse(r2.stdout).ok, false);

  const r3 = runNode(HYGIENE_CLI, ['--dry-run']);
  assert.notEqual(r3.status, 0);
  assert.equal(JSON.parse(r3.stdout).ok, false);
});
