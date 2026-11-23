'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const intake = require('../intake');
const planner = require('../planner');
const { pinpointTarget } = require('../pinpoint');
const { compilePrompt } = require('../prompt-compiler');
const { createContextPack } = require('../context-pack');
const { repairSpec } = require('../orchestrate/review-lane');
const { repairRound } = require('../orchestrate/repair-round');
const { resolveLauncher } = require('../orchestrate/writer-loop');
const { runOrchestration } = require('../orchestrate');
const {
  enforceWriterCommitScope,
  finalizeIsolatedLaunchResult,
  getIsolatedLauncher,
  getFolderHash,
} = require('../isolation-launcher');
const supervisor = require('../supervisor');
const scopeGate = require('../scope-gate');
const writerScope = require('../writer-scope');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const REAL_187_PATH = path.join(REPO_ROOT, 'docs', 'product-spec', 'work-items', 'TASK-AI-187.md');

function git(cwd, args) {
  const res = cp.spawnSync('git', ['-c', 'safe.directory=*', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  }
  return (res.stdout || '').trim();
}

function makeGitFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-f2-git-'));
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'test@shipde.local']);
  git(dir, ['config', 'user.name', 'ShipDe Test']);

  const write = (rel, body) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body, 'utf8');
  };
  write('tools/ai-brain/cli/commands.js', '// controller\nmodule.exports = {};\n');
  write('tools/ai-brain/combo-reader.js', '// combo reader\nmodule.exports = {};\n');
  write(
    'tools/ai-brain/review-manifest.js',
    '// target\nfunction cli() { return path.join("a","b"); }\n'
  );
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'base']);
  const originMain = git(dir, ['rev-parse', 'HEAD']);

  // Prerequisite R1/R2 commit already on branch before writer turn
  write(
    'tools/ai-brain/combo-reader.js',
    '// combo reader with agent:false\nmodule.exports = { v: 2 };\n'
  );
  git(dir, ['add', 'tools/ai-brain/combo-reader.js']);
  git(dir, ['commit', '-m', 'prereq R1']);
  const turnBase = git(dir, ['rev-parse', 'HEAD']);

  return { dir, originMain, turnBase, write };
}

test('F2 end-to-end intake -> planner -> pinpoint/context-pack/prompt on real TASK-AI-187.md with Writer paths', () => {
  const raw187 = fs.readFileSync(REAL_187_PATH, 'utf8');
  const wiWithWriterPaths = /\|\s*Writer paths\s*\|/i.test(raw187)
    ? raw187
    : raw187.replace(
        /(\|\s*Allowed paths\s*\|[^\r\n]+\r?\n)/i,
        '$1| Writer paths | `tools/ai-brain/review-manifest.js`, `tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js` |\n'
      );

  const derived = intake.deriveSpec({
    id: 'TASK-AI-187',
    workItemText: wiWithWriterPaths,
    registerItem: { id: 'TASK-AI-187', dependencies: '' },
    root: REPO_ROOT,
  });
  assert.deepEqual(derived.writerPaths, [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ]);
  assert.ok(derived.allowedPaths.includes('tools/ai-brain/cli/commands.js'));
  assert.equal(derived.complexity, 'standard');
  assert.deepEqual(derived.riskDomains, []);

  // Even when PR Allowed paths expands to 15+ prereq files, Writer paths (2 files) keeps writer complexity at 'standard'
  const expandedAllowedRow =
    '| Allowed paths | `tools/ai-brain/review-manifest.js`, `tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js`, `tools/ai-brain/combo-reader.js`, `tools/ai-brain/writer-scope.js`, `tools/ai-brain/intake.js`, `tools/ai-brain/planner.js`, `tools/ai-brain/orchestrate.js`, `tools/ai-brain/orchestrate/candidate-select.js`, `tools/ai-brain/orchestrate/review-lane.js`, `tools/ai-brain/orchestrate/repair-round.js`, `tools/ai-brain/isolation-launcher.js`, `tools/ai-brain/pinpoint.js`, `tools/ai-brain/context-pack.js`, `tools/ai-brain/prompt-compiler.js`, `tools/ai-brain/cli/commands.js` |\n';
  const wiExpandedPr = wiWithWriterPaths.replace(
    /\|\s*Allowed paths\s*\|[^\r\n]+\r?\n/i,
    expandedAllowedRow
  );
  const derivedExpanded = intake.deriveSpec({
    id: 'TASK-AI-187',
    workItemText: wiExpandedPr,
    registerItem: { id: 'TASK-AI-187', dependencies: '' },
    root: REPO_ROOT,
  });
  assert.equal(derivedExpanded.complexity, 'standard');
  assert.deepEqual(derivedExpanded.riskDomains, []);
  assert.equal(derivedExpanded.allowedPaths.length, 15);
  assert.equal(derivedExpanded.writerPaths.length, 2);

  const planned = planner.plan('Fix review-manifest CLI', { specs: [derived.specItem] });
  const plannedItem = planned.workItems[0];
  assert.deepEqual(plannedItem.writerPaths, derived.writerPaths);
  assert.deepEqual(writerScope.effectiveWriterScope(plannedItem), derived.writerPaths);

  const repaired = repairSpec(plannedItem, [{ id: 'F1', detail: 'fix' }], 1);
  assert.deepEqual(repaired.writerPaths, derived.writerPaths);
  assert.deepEqual(writerScope.effectiveWriterScope(repaired), derived.writerPaths);

  const pp = pinpointTarget(plannedItem, { rootDir: REPO_ROOT });
  const pinFiles = [...new Set(pp.locations.map((l) => l.file))];
  assert.deepEqual(pinFiles, [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ]);

  const pack = createContextPack([plannedItem], { root: REPO_ROOT });
  assert.equal(pack.files[0], 'tools/ai-brain/review-manifest.js');
  assert.ok(!pack.files.includes('tools/ai-brain/cli/commands.js'));

  const prompt = compilePrompt(plannedItem, {
    goal: derived.goal,
    rootDir: REPO_ROOT,
    isolatedWorker: true,
    focusedTestsOnly: true,
  });
  assert.match(
    prompt,
    /Allowed files: tools\/ai-brain\/review-manifest\.js, tools\/ai-brain\/test\/task-ai-187-review-manifest-cli\.test\.js/
  );
  assert.match(prompt, /Worker shell: Windows PowerShell/);
  assert.match(prompt, /do NOT invoke any external skill tool/);
  assert.doesNotMatch(prompt, /\| grep -E/);
  assert.doesNotMatch(
    prompt,
    /Target files & lines:[\s\S]*cli\/commands\.js[\s\S]*=== END OF TARGET LOCATION ===/
  );
});

test('F2 legacy Work Item without Writer paths preserves allowedPaths without AC heuristic dropping review-manifest.js', () => {
  const raw187 = fs.readFileSync(REAL_187_PATH, 'utf8');
  const legacyText = raw187.replace(/^\|\s*Writer paths\s*\|[^\r\n]*\r?\n?/gim, '');
  assert.doesNotMatch(legacyText, /^\|\s*Writer paths\s*\|/im);
  const derived = intake.deriveSpec({
    id: 'TASK-AI-187',
    workItemText: legacyText,
    registerItem: { id: 'TASK-AI-187', dependencies: '' },
    root: REPO_ROOT,
  });
  assert.equal(derived.writerPaths, undefined);
  assert.equal(derived.specItem.writerPaths, undefined);
  assert.deepEqual(writerScope.effectiveWriterScope(derived.specItem), derived.allowedPaths);

  const pp = pinpointTarget(derived.specItem, { rootDir: REPO_ROOT });
  const pinFiles = [...new Set(pp.locations.map((l) => l.file))];
  assert.ok(
    pinFiles.includes('tools/ai-brain/review-manifest.js'),
    'legacy pinpoint without Writer paths must keep review-manifest.js'
  );
});

test('F2 Writer paths fails closed on empty, invalid token, absolute, traversal, glob, or outside allowedPaths', () => {
  const allowed = [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];

  // Raw cell parsing rejects empty, trailing comma, non-path prose, unbalanced backticks, absolute, traversal, glob
  for (const badCell of [
    '',
    '   ',
    '`tools/ai-brain/review-manifest.js`, ',
    '`tools/ai-brain/review-manifest.js`, not a valid path',
    '`tools/ai-brain/review-manifest.js',
    '/etc/passwd',
    'C:\\Windows\\System32\\cmd.exe',
    '../outside.js',
    'tools/ai-brain/../secret.js',
    'tools/ai-brain/*.js',
    'tools/ai-brain/review-?.js',
    'tools/ai-brain/',
  ]) {
    assert.throws(
      () => writerScope.parseWriterPaths(badCell),
      (err) => err && err.code === 'WRITER_PATHS_INVALID',
      `expected WRITER_PATHS_INVALID for cell: ${JSON.stringify(badCell)}`
    );
  }

  // Subset validation rejects empty array and path outside allowedPaths
  assert.throws(
    () => writerScope.effectiveWriterScope({ allowedPaths: allowed, writerPaths: [] }),
    (err) => err && err.code === 'WRITER_PATHS_INVALID'
  );
  assert.throws(
    () => writerScope.validateWriterPaths(['tools/ai-brain/cli/commands.js'], allowed),
    (err) => err && err.code === 'WRITER_PATHS_OUTSIDE_ALLOWED_PATHS'
  );
  assert.throws(
    () =>
      planner.plan('invalid writerPaths', {
        specs: [
          {
            id: 'TASK-BAD',
            allowedPaths: allowed,
            writerPaths: ['tools/ai-brain/cli/commands.js'],
            acceptanceCriteria: ['ok'],
            verification: { command: 'echo ok' },
          },
        ],
      }),
    (err) => err && err.code === 'WRITER_PATHS_OUTSIDE_ALLOWED_PATHS'
  );

  // Glob in allowedPaths still covers concrete writerPaths via existing scope-gate matcher
  assert.deepEqual(
    writerScope.validateWriterPaths(['tools/ai-brain/review-manifest.js'], ['tools/ai-brain/*.js']),
    ['tools/ai-brain/review-manifest.js']
  );
});

test('F2 writer diff gate checks turnBase..head against writerPaths while PR gate checks originMain..head against allowedPaths', () => {
  const { dir, originMain, turnBase, write } = makeGitFixtureRepo();
  const prAllowedPaths = [
    'tools/ai-brain/combo-reader.js',
    'tools/ai-brain/cli/commands.js',
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];
  const writerPaths = [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];

  // Turn 1: writer edits ONLY writerPaths -> PASS (prereq combo-reader.js in turnBase is NOT blamed)
  write(
    'tools/ai-brain/review-manifest.js',
    'const path = require("path");\nfunction cli() { return path.join("a","b"); }\n'
  );
  git(dir, ['add', 'tools/ai-brain/review-manifest.js']);
  git(dir, ['commit', '-m', 'writer fix']);
  const goodHead = git(dir, ['rev-parse', 'HEAD']);

  const okWriterCheck = writerScope.checkWriterCommitDiff({
    workerRoot: dir,
    baseSha: turnBase,
    headSha: goodHead,
    writerPaths,
    allowedPaths: prAllowedPaths,
  });
  assert.equal(okWriterCheck.ok, true);
  assert.deepEqual(okWriterCheck.files, ['tools/ai-brain/review-manifest.js']);

  // Turn 2: writer touches PR-only allowedPaths file (cli/commands.js, outside writerPaths)
  write(
    'tools/ai-brain/cli/commands.js',
    '// writer illegally edited controller\nmodule.exports = { bad: true };\n'
  );
  git(dir, ['add', 'tools/ai-brain/cli/commands.js']);
  git(dir, ['commit', '-m', 'writer out of writerPaths']);
  const badHead = git(dir, ['rev-parse', 'HEAD']);

  const badWriterCheck = writerScope.checkWriterCommitDiff({
    workerRoot: dir,
    baseSha: turnBase,
    headSha: badHead,
    writerPaths,
    allowedPaths: prAllowedPaths,
  });
  assert.equal(badWriterCheck.ok, false);
  assert.equal(badWriterCheck.code, 'WRITER_DIFF_OUTSIDE_SCOPE');
  assert.deepEqual(badWriterCheck.offending, ['tools/ai-brain/cli/commands.js']);

  // Meanwhile, PR-level check over originMain..goodHead using full allowedPaths accepts both prereq + writer changes
  const prScope = scopeGate.parseScope({
    workItemId: 'TASK-AI-187',
    acceptanceIds: ['AC1'],
    ownedGlobs: prAllowedPaths,
    forbiddenGlobs: [],
    testCommands: ['node --test'],
    maxDiffLines: 500,
    repairBudget: 2,
    maxToolCalls: 50,
  });
  assert.equal(prScope.ok, true);
  const prDiff = scopeGate.checkDiff({
    repoCwd: dir,
    base: originMain,
    head: goodHead,
    scope: prScope.scope,
  });
  assert.equal(prDiff.ok, true);
});

test('F2 isolation-launcher enforceWriterCommitScope strips workerSha and fails closed on WRITER_DIFF_OUTSIDE_SCOPE', () => {
  const { dir, turnBase, write } = makeGitFixtureRepo();
  const writerPaths = [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];

  // In-scope commit passes through launcher gate with workerSha intact
  write(
    'tools/ai-brain/review-manifest.js',
    'const path = require("path");\nmodule.exports = path;\n'
  );
  git(dir, ['add', 'tools/ai-brain/review-manifest.js']);
  git(dir, ['commit', '-m', 'in-scope writer commit']);
  const goodHead = git(dir, ['rev-parse', 'HEAD']);

  const okRes = enforceWriterCommitScope(
    { exitCode: 0, workerSha: goodHead, retainedHeadSha: goodHead, stderr: '' },
    { commitFileOnlyWriter: true, baseSha: turnBase, allowedPaths: writerPaths },
    dir
  );
  assert.equal(okRes.exitCode, 0);
  assert.equal(okRes.localFailure, undefined);
  assert.equal(okRes.workerSha, goodHead);

  // Out-of-writerPaths commit (PR-only allowedPaths file) is refused and workerSha is stripped
  write('tools/ai-brain/cli/commands.js', '// out of writerPaths\nmodule.exports = { x: 1 };\n');
  git(dir, ['add', 'tools/ai-brain/cli/commands.js']);
  git(dir, ['commit', '-m', 'out-of-writer-scope commit']);
  const badHead = git(dir, ['rev-parse', 'HEAD']);

  const badRes = enforceWriterCommitScope(
    { exitCode: 0, workerSha: badHead, retainedHeadSha: badHead, stderr: '' },
    { commitFileOnlyWriter: true, baseSha: turnBase, allowedPaths: writerPaths },
    dir
  );
  assert.equal(badRes.exitCode, 1);
  assert.equal(badRes.localFailure, 'WRITER_DIFF_OUTSIDE_SCOPE');
  assert.match(badRes.failureReason, /tools\/ai-brain\/cli\/commands\.js/);
  assert.equal(badRes.workerSha, undefined);
  assert.equal(badRes.retainedHeadSha, undefined);
});

test('F2 orchestrate writer job and repairRound job receive effective writerPaths and per-turn baseSha', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-f2-jobs-'));
  const prAllowedPaths = [
    'tools/ai-brain/combo-reader.js',
    'tools/ai-brain/cli/commands.js',
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];
  const writerPaths = [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];
  const registry = {
    dispatch: { nineRouterWriterCombo: 'vinh', comboSource: '9router' },
    sources: [
      {
        id: '9router',
        kind: 'router',
        servesModels: true,
        harness: 'opencode-direct',
        endpoint: 'http://127.0.0.1:20128/v1',
        credential: { type: 'api-key', env: 'NINEROUTER_API_KEY' },
      },
    ],
  };

  const writerJobs = [];
  await runOrchestration('F2 writer job scope', {
    specs: [
      {
        id: 'TASK-AI-187',
        objective: 'Fix review-manifest CLI',
        allowedPaths: prAllowedPaths,
        writerPaths,
        acceptanceCriteria: ['AC1 | ok'],
        verification: { command: 'echo ok' },
      },
    ],
    registry,
    env: { NINEROUTER_API_KEY: 'test-key' },
    decisionDir: dir,
    evidenceDir: dir,
    comboJevSelect: false,
    run: (job) => {
      writerJobs.push(job);
      return { exitCode: 0, stdout: 'ok', stderr: '' };
    },
  });
  assert.equal(writerJobs.length, 1);
  assert.deepEqual(writerJobs[0].allowedPaths, writerPaths);

  const repairJobs = [];
  const turnHeadSha = 'a'.repeat(40);
  const candidate = {
    harness: 'opencode-direct',
    endpoint: 'http://127.0.0.1:20128/v1',
    gateway: '9router',
    source: '9router',
    upstream: '9router',
    accountId: '9router',
    quotaScope: '9router',
    modelId: 'vinh',
    combo: 'vinh',
  };
  const runRepair = repairRound(
    {
      registry,
      env: { NINEROUTER_API_KEY: 'test-key' },
      decisionDir: dir,
      evidenceDir: dir,
      comboJevSelect: false,
      baseSha: 'b'.repeat(40),
      specs: [
        {
          id: 'TASK-AI-187',
          allowedPaths: prAllowedPaths,
          writerPaths,
          acceptanceCriteria: ['AC1 | ok'],
          verification: { command: 'echo ok' },
        },
      ],
    },
    {
      id: 'TASK-AI-187',
      allowedPaths: prAllowedPaths,
      writerPaths,
      verification: { command: 'echo ok' },
    },
    {
      candidateKey:
        'opencode-direct::http://127.0.0.1:20128/v1::9router::9router::9router::9router::vinh',
    },
    { goal: 'F2 repair job scope', prompts: [], selections: [], launches: [] },
    { dir, now: Date.now(), runId: 'run-f2' },
    async (job) => {
      repairJobs.push(job);
      return { exitCode: 0, stdout: 'ok', stderr: '', workerSha: 'c'.repeat(40) };
    },
    dir,
    Date.now(),
    [candidate],
    {},
    registry,
    {}
  );
  const repairRes = await runRepair([{ id: 'F1', detail: 'fix test' }], turnHeadSha);
  assert.equal(repairJobs.length, 1);
  assert.deepEqual(repairJobs[0].allowedPaths, writerPaths);
  assert.equal(repairJobs[0].baseSha, turnHeadSha);
  assert.ok(repairRes && (repairRes.ok === true || repairRes.repaired === true || repairRes.sha));
});

test('F2 wiring M2: writer-loop passes commitFileOnlyWriter=true, baseSha, and writerPaths to isolatedLauncher for author and repair roles', () => {
  const writerPaths = [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];
  const turnBase = 'd'.repeat(40);
  const captured = [];
  const launcher = resolveLauncher({ isolatedWorker: true }, (_adapter, _args, opts) => {
    captured.push(opts);
    return { exitCode: 0, stdout: 'ok', stderr: '' };
  });

  for (const role of ['author.foundation', 'repair']) {
    const res = launcher({
      harness: 'opencode-direct',
      isolatedWorker: true,
      gateway: '9router',
      endpoint: 'http://127.0.0.1:20128/v1',
      model: 'ninerouter/vinh',
      prompt: 'fix review-manifest',
      cwd: REPO_ROOT,
      baseSha: turnBase,
      branch: 'feat/task-ai-187',
      title: 'TASK-AI-187',
      allowedPaths: writerPaths,
      labels: { workItem: 'TASK-AI-187', role },
    });
    assert.equal(res.exitCode, 0, res.stderr || res.refusal || '');
  }

  assert.equal(captured.length, 2);
  for (const opts of captured) {
    assert.equal(opts.commitFileOnlyWriter, true);
    assert.equal(opts.baseSha, turnBase);
    assert.deepEqual(opts.allowedPaths, writerPaths);
  }
});

test('F2 wiring M1: isolation-launcher finalizeIsolatedLaunchResult reads HEAD from git and refuses WRITER_DIFF_OUTSIDE_SCOPE', () => {
  const { dir, turnBase, write } = makeGitFixtureRepo();
  const writerPaths = [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];

  write(
    'tools/ai-brain/cli/commands.js',
    '// out of writerPaths\nmodule.exports = { m1: true };\n'
  );
  git(dir, ['add', 'tools/ai-brain/cli/commands.js']);
  git(dir, ['commit', '-m', 'writer illegally touched controller']);

  const res = finalizeIsolatedLaunchResult({
    launchResult: { exitCode: 0, stdout: 'ok', stderr: '' },
    adapter: { id: 'opencode-direct' },
    opts: {
      commitFileOnlyWriter: true,
      baseSha: turnBase,
      allowedPaths: writerPaths,
      workItemId: 'TASK-AI-187',
    },
    hostCwd: dir,
    workerRoot: dir,
  });
  assert.equal(res.exitCode, 1);
  assert.equal(res.localFailure, 'WRITER_DIFF_OUTSIDE_SCOPE');
  assert.match(res.failureReason, /tools\/ai-brain\/cli\/commands\.js/);
  assert.equal(res.workerSha, undefined);
  assert.equal(res.retainedHeadSha, undefined);
});

test('F2 wiring M1b: getIsolatedLauncher() entry invokes finalize and refuses WRITER_DIFF_OUTSIDE_SCOPE on real git diff', (t) => {
  const { dir: workerDir, turnBase, write } = makeGitFixtureRepo();
  const writerPaths = [
    'tools/ai-brain/review-manifest.js',
    'tools/ai-brain/test/task-ai-187-review-manifest-cli.test.js',
  ];

  // Worker commits a file outside writerPaths (only allowed in broader PR allowedPaths)
  write(
    'tools/ai-brain/cli/commands.js',
    '// out of writerPaths\nmodule.exports = { m1b: true };\n'
  );
  git(workerDir, ['add', 'tools/ai-brain/cli/commands.js']);
  git(workerDir, ['commit', '-m', 'writer illegally touched controller']);
  const badHead = git(workerDir, ['rev-parse', 'HEAD']);

  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'shipde-f2-m1b-'));
  t.after(() => fs.rmSync(area, { recursive: true, force: true }));
  t.mock.method(os, 'tmpdir', () => area);
  const prevLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = area;
  t.after(() => {
    if (prevLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = prevLocalAppData;
  });

  const host = path.join(area, 'host');
  fs.mkdirSync(host, { recursive: true });
  const verdictPath = path.join(host, 'verdict.json');
  fs.writeFileSync(
    verdictPath,
    JSON.stringify({
      worktree: host,
      verdict: 'CLOSED',
      timestamp: new Date(Date.now() - 1000).toISOString(),
      policyHash: getFolderHash(path.join(host, 'scripts/ai/isolation')),
      sid: 'fixture-sid',
      details: { boundary: 'PASS' },
    })
  );

  const realRm = fs.rmSync.bind(fs);
  t.mock.method(fs, 'rmSync', (target, options) => {
    if (path.resolve(String(target)) === path.resolve(workerDir)) return;
    return realRm(target, options);
  });

  let launched = false;
  t.mock.method(supervisor, 'withCleanGitEnv', (_dir, cb) => cb('safegit'));
  t.mock.method(supervisor, 'safeGit', () => ({
    status: 0,
    stdout: launched ? badHead : turnBase,
  }));

  const realSpawnSync = cp.spawnSync.bind(cp);
  t.mock.method(cp, 'spawnSync', (command, args, opts) => {
    if (command === 'git' && Array.isArray(args) && args.includes('diff')) {
      return realSpawnSync(command, args, opts);
    }
    if (
      command === 'git' &&
      Array.isArray(args) &&
      args.some((a) => String(a).startsWith('refs/shipde/carry/'))
    ) {
      return { status: 1, stdout: '' };
    }
    if (command === 'powershell.exe') {
      const script = fs.readFileSync(args[args.length - 1], 'utf8');
      const nonce = script.match(/\$completionNonce = "([^"]+)"/)[1];
      const output = script.match(/\$output \| ConvertTo-Json.*Out-File "([^"]+)"/)[1];
      fs.writeFileSync(
        output,
        JSON.stringify({
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          completed: true,
          completionNonce: nonce,
        })
      );
      launched = true;
      return { status: 0, stdout: 'ok' };
    }
    return { status: 0, stdout: turnBase };
  });

  const decisionDir = path.join(area, 'decisions');
  const result = getIsolatedLauncher()({ id: 'dummy', command: 'node' }, [], {
    cwd: host,
    workerRoot: workerDir,
    baseSha: turnBase,
    verdictPath,
    decisionDir,
    getWorkerSid: () => 'fixture-sid',
    verifyBoundary: () => true,
    isolatedWorker: true,
    commitFileOnlyWriter: true,
    allowedPaths: writerPaths,
    workItemId: 'TASK-AI-187',
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.localFailure, 'WRITER_DIFF_OUTSIDE_SCOPE');
  assert.match(result.failureReason, /tools\/ai-brain\/cli\/commands\.js/);
  assert.equal(result.workerSha, undefined);
  assert.equal(result.retainedHeadSha, undefined);
});
