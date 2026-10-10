'use strict';

/** TASK-AI-135: dependency evidence and planner refusal diagnostics. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const intake = require('../intake');
const orchestrate = require('../orchestrate');
const decisions = require('../decisions');
const cli = require('../cli');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const UPSTREAM_DIR = path.join(REPO_ROOT, '.upstream-tmp');
const WORK_ITEM = 'FIXTURE-AI-135';
const HEADER =
  '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"';
const WORK_ITEM_TEXT = `# ${WORK_ITEM} — fixture

## Control

| Field | Value |
|---|---|
| Work Item ID | \`${WORK_ITEM}\` |
| Feature ID | \`N/A\` |
| Status | \`READY_FOR_AUTHOR\` |
| Dependencies | \`FIXTURE-DEP\` |
| Assigned author | \`GEMINI\` |
| Risk | \`MEDIUM\` |
| Allowed paths | \`tools/ai-brain/intake.js\` |
| Branch | \`feat/fixture\` |

## Business Outcome

Fixture intake goal.

## Acceptance Matrix

| AC/Test ID | Scenario | Expected result | Evidence required |
|---|---|---|---|
| FX-R01 | Intake | Dependencies resolve | Test |

## Verification Commands

- \`node --test tools/ai-brain/test/task-ai-135.test.js\`
`;

const dirs = [];
function tempDir(prefix) {
  fs.mkdirSync(UPSTREAM_DIR, { recursive: true });
  const dir = fs.mkdtempSync(path.join(UPSTREAM_DIR, prefix));
  dirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function quote(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function row(id, status, dependencies, mergeCommit) {
  return [
    '247',
    'S00',
    'AI workflow',
    id,
    '',
    'fixture',
    'fixture behavior',
    status,
    dependencies || '',
    'docs/product-spec/work-items/' + id + '.md',
    'feat/fixture',
    '',
    '',
    mergeCommit || '',
  ];
}

function writeFixture(root, dependencies, extraRows = []) {
  const workItems = path.join(root, 'docs', 'product-spec', 'work-items');
  const register = path.join(root, 'docs', 'product-spec', 'docs', '10-ai-collaboration');
  fs.mkdirSync(workItems, { recursive: true });
  fs.mkdirSync(register, { recursive: true });
  fs.writeFileSync(path.join(workItems, WORK_ITEM + '.md'), WORK_ITEM_TEXT);
  const own = row(WORK_ITEM, 'READY_FOR_AUTHOR', dependencies);
  fs.writeFileSync(
    path.join(register, 'FEATURE-DELIVERY-REGISTER.csv'),
    [HEADER, ...[own, ...extraRows].map((cells) => cells.map(quote).join(','))].join('\n') + '\n'
  );
}

function git(root, args) {
  return cp.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function makeGitRepo() {
  const root = tempDir('task-ai-135-git-');
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'task-ai-135@example.invalid']);
  git(root, ['config', 'user.name', 'TASK-AI-135 fixture']);
  fs.writeFileSync(path.join(root, 'fixture.txt'), 'base\n');
  git(root, ['add', 'fixture.txt']);
  git(root, ['commit', '-m', 'fixture base']);
  return root;
}

function commit(root, subject, content) {
  fs.appendFileSync(path.join(root, 'fixture.txt'), content + '\n');
  git(root, ['add', 'fixture.txt']);
  git(root, ['commit', '-m', subject]);
  return git(root, ['rev-parse', 'HEAD']);
}

function intakeDeps(root) {
  return {
    root,
    baseSha: () => git(root, ['rev-parse', 'HEAD']),
    listAccounts: () => [],
    readEvidence: async () => ({ combinations: [{ modelId: 'fixture/model' }] }),
    runAgyModels: async () => '',
    httpGet: async () => ({ ok: true, parsed: { data: [{ id: 'fixture/model' }] } }),
  };
}

test('DP-R01 resolves history-merged dependencies, removes them, and records the commit SHA', async () => {
  const root = makeGitRepo();
  const dependencySha = commit(root, '(#126) [FIXTURE-DEP] merged dependency', 'dep');
  writeFixture(root, 'FIXTURE-DEP');

  const result = await intake.runIntake({ workItem: WORK_ITEM }, intakeDeps(root));

  assert.deepEqual(result.spec.dependencies, []);
  assert.deepEqual(result.resolvedDependencies, [
    { id: 'FIXTURE-DEP', commitSha: dependencySha, source: 'history' },
  ]);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(result.runDir, 'resolved-dependencies.json'), 'utf8')),
    result.resolvedDependencies
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(result.runDir, 'specs.json'), 'utf8'))[0].dependencies,
    []
  );
});

test('DP-R01 removes dependencies declared MERGED in the register and records its SHA', async () => {
  const root = makeGitRepo();
  const dependencySha = commit(root, 'fixture merged item', 'dep');
  writeFixture(root, 'FIXTURE-DEP', [row('FIXTURE-DEP', 'MERGED', '', dependencySha)]);

  const result = await intake.runIntake({ workItem: WORK_ITEM }, intakeDeps(root));

  assert.deepEqual(result.spec.dependencies, []);
  assert.deepEqual(result.resolvedDependencies, [
    { id: 'FIXTURE-DEP', commitSha: dependencySha, source: 'register' },
  ]);
});

test('DP-R01 refuses unmerged dependencies and lists every unresolved ID', async () => {
  const root = makeGitRepo();
  writeFixture(root, 'FIXTURE-DEP, FIXTURE-OTHER');

  await assert.rejects(intake.runIntake({ workItem: WORK_ITEM }, intakeDeps(root)), (error) => {
    assert.equal(error.code, 'DEPENDENCY_NOT_MERGED');
    assert.match(error.message, /FIXTURE-DEP/);
    assert.match(error.message, /FIXTURE-OTHER/);
    return true;
  });
});

test('DP-R01 history matching is exact for dependency IDs', async () => {
  const root = makeGitRepo();
  commit(root, '(#10) [FEAT-AUTH-10] different item', 'wrong id');
  writeFixture(root, 'FEAT-AUTH-1');

  await assert.rejects(
    intake.runIntake({ workItem: WORK_ITEM }, intakeDeps(root)),
    (error) => error.code === 'DEPENDENCY_NOT_MERGED' && /FEAT-AUTH-1/.test(error.message)
  );
});

test('DP-R02 orchestrate surfaces planner errors in refusal and decision log', async () => {
  const root = tempDir('task-ai-135-orchestrate-');
  const decisionDir = path.join(root, 'decisions');
  const plannerError = 'UNKNOWN_DEPENDENCY: FIXTURE-AI-135 -> FIXTURE-MISSING';

  const result = await orchestrate.runOrchestration('fixture goal', {
    specs: [{ id: WORK_ITEM, dependencies: ['FIXTURE-MISSING'], files: [] }],
    decisionDir,
    cwd: root,
    now: Date.parse('2026-10-10T00:00:00Z'),
  });

  assert.equal(result.status, 'REFUSED');
  assert.deepEqual(result.plan.errors, [plannerError]);
  assert.match(result.refusal, new RegExp(plannerError.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const records = decisions.readDecisions({
    dir: decisionDir,
    now: Date.parse('2026-10-10T00:00:00Z'),
  });
  assert.ok(records.some((record) => record.stage === 'refused' && record.detail === plannerError));

  const goalFile = path.join(root, 'goal.txt');
  const specsFile = path.join(root, 'specs.json');
  fs.writeFileSync(goalFile, 'fixture goal');
  fs.writeFileSync(
    specsFile,
    JSON.stringify([{ id: WORK_ITEM, dependencies: ['FIXTURE-MISSING'], files: [] }])
  );
  const printed = [];
  const cliDecisionDir = path.join(root, 'cli-decisions');
  await cli.orchestrateCommand(
    {
      _: ['orchestrate'],
      goal: goalFile,
      specs: specsFile,
      'decision-dir': cliDecisionDir,
      cwd: root,
    },
    {
      registry: { sources: [] },
      candidates: [],
      accounts: [],
      registryAccounts: [],
      listAccounts: () => [],
      log: (line) => printed.push(line),
      exit: () => {},
      now: Date.parse('2026-10-10T00:00:00Z'),
    }
  );
  const cliResult = JSON.parse(printed[0]);
  assert.deepEqual(cliResult.plan.errors, [plannerError]);
  assert.equal(cliResult.refusal, plannerError);
  assert.match(cliResult.publication.reason, /PLANNER_REFUSED: UNKNOWN_DEPENDENCY/);
});
