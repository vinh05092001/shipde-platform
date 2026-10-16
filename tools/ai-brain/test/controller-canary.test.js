'use strict';

// Run before merging Controller core changes:
// node --test tools/ai-brain/test/controller-canary.test.js
// The two executable TODO assertions belong to agy items 7/8. Remove only
// their `todo` options after those fixes land. The pending gate deliberately
// fails CI: node:test otherwise exits zero for expected TODO failures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

test('Controller offline end-to-end canary', { timeout: 170000 }, async (t) => {
  const started = Date.now();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-canary-'));
  t.mock.method(os, 'tmpdir', () => root);
  const source = path.resolve(__dirname, '../../..');
  const realSpawnSync = cp.spawnSync;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/^GIT_|TOKEN|SECRET|API_KEY|PASSWORD|CREDENTIAL/i.test(key)
    )
  );
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  env.GIT_TERMINAL_PROMPT = '0';
  delete env.NODE_TEST_CONTEXT;
  const gateFile = path.join(root, 'canary-gate.test.js');
  const validator = path.join(root, 'docs/product-spec/scripts/validate_pr_contract.py');
  const insideFixture = (target) => {
    const resolved = path.resolve(String(target));
    assert.ok(
      resolved === root || resolved.startsWith(root + path.sep),
      'write escaped fixture: ' + resolved
    );
  };
  for (const method of [
    'writeFileSync',
    'appendFileSync',
    'mkdirSync',
    'mkdtempSync',
    'renameSync',
    'copyFileSync',
    'rmSync',
    'unlinkSync',
  ]) {
    const original = fs[method];
    t.mock.method(fs, method, (...args) => {
      insideFixture(args[0]);
      if (method === 'renameSync' || method === 'copyFileSync') insideFixture(args[1]);
      return original.apply(fs, args);
    });
  }
  // Fail closed if any production path escapes the fixture or launches a
  // provider, shell, gh, network Git operation, or an unexpected test suite.
  t.mock.method(cp, 'spawnSync', (command, args, options = {}) => {
    if (!Array.isArray(args)) {
      options = args || {};
      assert.equal(command, 'node --test canary-gate.test.js');
      command = process.execPath;
      args = ['--test', gateFile];
      options = { ...options, shell: false };
    }
    const cwd = path.resolve(options.cwd || root);
    assert.ok(cwd === root || cwd.startsWith(root + path.sep), 'process escaped fixture: ' + cwd);
    let verbIndex = 0;
    while (verbIndex < args.length) {
      if (args[verbIndex] === '-c') verbIndex += 2;
      else if (/^--(?:git-dir|work-tree)=/.test(args[verbIndex])) verbIndex++;
      else break;
    }
    const gitVerb = args[verbIndex];
    const localClone =
      gitVerb === 'clone' &&
      args[args.length - 2] === root &&
      path.resolve(args[args.length - 1]).startsWith(root + path.sep);
    const localFetch =
      gitVerb === 'fetch' &&
      args[args.length - 2] === root &&
      /^[a-f0-9]{40}$/.test(args[args.length - 1]);
    const allowed =
      command === 'git'
        ? localClone ||
          localFetch ||
          [
            'init',
            'config',
            'add',
            'commit',
            'rev-parse',
            'diff',
            'show',
            'log',
            'status',
            'branch',
            'checkout',
            'merge',
            'merge-base',
            'update-ref',
            'cat-file',
            'rev-list',
            'for-each-ref',
            'check-ref-format',
            'patch-id',
          ].includes(gitVerb)
        : command === process.execPath
          ? args[0] === '--test' && args.length === 2 && path.resolve(cwd, args[1]) === gateFile
          : ['python', 'python3'].includes(command) &&
            (args[0] === '--version' || args[0] === validator);
    assert.ok(allowed, 'unexpected subprocess: ' + command + ' ' + args.join(' '));
    return realSpawnSync(command, args, {
      ...options,
      cwd,
      env,
      timeout: 10000,
      windowsHide: true,
    });
  });
  for (const method of ['spawn', 'exec', 'execFile', 'execSync', 'execFileSync'])
    t.mock.method(cp, method, () => {
      throw new Error('unexpected subprocess: ' + method);
    });
  for (const module of ['node:http', 'node:https', 'node:net', 'node:tls']) {
    const api = require(module);
    for (const method of ['request', 'get', 'connect', 'createConnection'])
      if (typeof api[method] === 'function')
        t.mock.method(api, method, () => {
          throw new Error('network forbidden: ' + module);
        });
  }
  if (typeof globalThis.fetch === 'function')
    t.mock.method(globalThis, 'fetch', () => {
      throw new Error('fetch forbidden');
    });

  try {
    // Import after installing guards: modules capture spawnSync at load time.
    const goals = require('../goals');
    const orchestration = require('../orchestrate');
    const adapter = require('../plan-adapter');
    const publisher = require('../publisher');
    const next = require('../next-runner');
    const { candidateKey } = require('../candidates');
    const git = (args) => {
      const result = cp.spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result.stdout.trim();
    };
    const write = (name, content) => {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return file;
    };
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', 'Controller Canary']);
    git(['config', 'user.email', 'canary@example.invalid']);
    write('README.md', 'before\n');
    write('docs/spec.md', 'Change the README line to after.\n');
    write(
      'canary-gate.test.js',
      "const {test}=require('node:test');const assert=require('node:assert/strict');" +
        "test('README acceptance',()=>assert.equal(require('node:fs').readFileSync('README.md','utf8'),'after\\n'));\n"
    );
    write(
      'docs/product-spec/scripts/validate_pr_contract.py',
      fs.readFileSync(path.join(source, 'docs/product-spec/scripts/validate_pr_contract.py'))
    );
    git(['add', '.']);
    git(['commit', '-qm', 'canary baseline']);
    const baseSha = git(['rev-parse', 'HEAD']);
    git(['update-ref', 'refs/remotes/origin/main', baseSha]);
    const goalId = 'CANARY';
    const id = 'GOAL-CANARY-1';
    const goalsDir = path.join(root, 'data/goals');
    const registerPath = path.join(
      root,
      'docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv'
    );
    const options = { rootDir: root, goalsDir, registerPath };
    assert.equal(
      goals.startGoal({ ...options, id: goalId, text: 'Change one documentation line' }).status,
      'OPEN'
    );
    const planText =
      '# Canary\nGoal: Change one documentation line\n' +
      '## Task 1: Update README\nSources: `docs/spec.md`\nFiles: `README.md`\n' +
      '- README contains after\nRun: `node --test canary-gate.test.js`\n' +
      '## Task 2: Follow-up\nSources: `docs/spec.md`\nFiles: `FOLLOWUP.md`\n' +
      'Depends on: Task 1\n- Follow-up is ready after merge\nRun: `node --test canary-gate.test.js`\n';
    const file = write('plan.md', planText);
    const planned = goals.planGoal(goalId, { ...options, file });
    assert.equal(planned.status, 'PLANNED', JSON.stringify(planned));
    assert.deepEqual(planned.items, [id, 'GOAL-CANARY-2']);
    const scopedRegister = path.join(goalsDir, goalId, 'register.csv');
    for (const register of [registerPath, scopedRegister]) {
      const csv = fs.readFileSync(register, 'utf8');
      assert.ok(csv.includes('"GOAL-CANARY-1"'));
      assert.ok(csv.includes('"READY_FOR_AUTHOR"'));
      assert.ok(csv.includes('"BACKLOG"'));
    }
    assert.ok(
      fs
        .readFileSync(path.join(root, 'docs/product-spec/work-items/' + id + '.md'), 'utf8')
        .includes(id)
    );
    const specs = adapter.toWorkItemSpecs(adapter.parsePlan(planText), { idPrefix: 'GOAL-CANARY' });
    git(['checkout', '-q', '--detach', baseSha]);
    const candidate = (name, role) => ({
      harness: 'paseo',
      accessPath: 'cli',
      gateway: 'canary-' + name,
      upstream: name,
      accountId: name,
      quotaScope: 'fixture',
      modelId: name,
      qualifiedRoles: [role],
      quality: 100,
    });
    const writer = candidate('writer', 'author.foundation');
    const reviewer = candidate('reviewer', 'reviewer');
    let draftEvent;
    let hostGateCalls = 0;
    const decisionDir = path.join(root, '.git/canary/decisions');
    const run = await orchestration.runOrchestration('Change one documentation line', {
      cwd: root,
      hostCwd: root,
      workerRoot: root,
      publisherCwd: root,
      baseSha,
      decisionDir,
      usageDir: path.join(root, '.git/canary/usage'),
      checkpointFile: path.join(root, '.git/canary/checkpoint.json'),
      specs: [specs[0]],
      candidates: [writer, reviewer],
      registry: { sources: [] },
      writerCandidateKey: candidateKey(writer),
      reviewerIdentity: candidateKey(reviewer),
      routeProbe: async () => ({ ok: true, status: 'ok', latencyMs: 1 }),
      run: (job) => {
        const before = cp.spawnSync(process.execPath, ['--test', gateFile], {
          cwd: root,
          encoding: 'utf8',
        });
        assert.equal(before.status, 1, 'acceptance test must fail before the writer change');
        if (job.usageFile) {
          fs.mkdirSync(path.dirname(job.usageFile), { recursive: true });
          fs.writeFileSync(job.usageFile, JSON.stringify({ session_id: 'canary-writer' }));
        }
        write('README.md', 'after\n');
        git(['add', 'README.md', 'docs/product-spec', 'data/goals', 'plan.md']);
        git(['commit', '-qm', 'canary writer']);
        return {
          exitCode: 0,
          sessionId: 'canary-writer',
          stdout: JSON.stringify({ session_id: 'canary-writer' }),
          failBefore: { command: 'node --test canary-gate.test.js', exitCode: before.status },
        };
      },
      hostGate: (job) => {
        hostGateCalls++;
        return orchestration.runHostBrainGate(job, {
          hostCwd: root,
          brainSuite: 'canary-gate.test.js',
          brainGateTimeoutMs: 10000,
        });
      },
      reviewer: async (sha) => ({
        pass: true,
        sha,
        verdict: 'PASS',
        reviewer: candidateKey(reviewer),
        findings: [],
      }),
      publication: {
        approvalId: 'CANARY-OFFLINE',
        remoteUrl: 'https://github.com/fixture/canary.git',
        branch: 'feat/goal-canary-1',
        // Transport only: use the real draft builder/verification, capture its
        // gh request in memory. No remote or push exists in the fixture repo.
        publish: (o) => {
          const checked = publisher.publish({
            ...o,
            testMode: true,
            expiry: Date.now() + 60000,
            registryPath: path.join(root, '.git/canary/absent-approvals.json'),
          });
          assert.equal(checked.simulated, true);
          return publisher.createDraftPullRequest({
            ...o.draft,
            remoteUrl: o.remoteUrl,
            branch: o.branch,
            reviewedSha: o.reviewedSha,
            manifest: JSON.parse(fs.readFileSync(o.reviewManifest, 'utf8')),
            ghRun: (args) => {
              assert.equal(args[0], 'pr');
              if (args[1] === 'list') return { exitCode: 0, stdout: '[]' };
              if (args[1] === 'create') {
                assert.ok(args.includes('--draft'));
                draftEvent = {
                  pull_request: {
                    draft: true,
                    title: args[args.indexOf('--title') + 1],
                    body: args[args.indexOf('--body') + 1],
                    base: { ref: 'main' },
                  },
                };
                return { exitCode: 0, stdout: 'https://github.com/fixture/canary/pull/1' };
              }
              assert.equal(args[1], 'view');
              return {
                exitCode: 0,
                stdout: JSON.stringify({ isDraft: true, headRefOid: o.reviewedSha }),
              };
            },
          });
        },
      },
    });
    assert.equal(
      run.publication.status,
      'PUBLISHED_DRAFT',
      JSON.stringify({
        publication: run.publication,
        reviews: run.reviews,
        outcomes: run.checkpoint?.outcomes,
        warnings: run.warnings,
      })
    );
    assert.ok(hostGateCalls > 0, 'orchestration must invoke the real host gate');
    assert.ok(draftEvent, 'Controller must generate the draft');
    const python = ['python', 'python3'].find(
      (command) => cp.spawnSync(command, ['--version'], { cwd: root }).status === 0
    );
    assert.ok(python, 'Python is required; never silently skip the PR contract');
    const event = write('event.json', JSON.stringify(draftEvent));
    const contract = cp.spawnSync(python, [validator, '--event', event], {
      cwd: root,
      encoding: 'utf8',
    });
    await t.test('real Python contract accepts Controller draft', () => {
      assert.equal(contract.status, 0, contract.stdout + contract.stderr);
      assert.match(contract.stdout, /[1-9][0-9]* changed files inspected/);
    });
    await t.test('contract rejects a corrupted draft title (negative control)', () => {
      write(
        'event.json',
        JSON.stringify({ pull_request: { ...draftEvent.pull_request, title: 'missing work item' } })
      );
      const broken = cp.spawnSync(python, [validator, '--event', event], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(broken.status, 1);
      assert.match(broken.stdout, /PR title must contain exactly one/);
    });
    // Simulate merge locally, without faking either register's status cells.
    const head = git(['rev-parse', 'HEAD']);
    git(['branch', 'feat/goal-canary-1', head]);
    git(['checkout', '-q', 'main']);
    git(['merge', '--ff-only', 'feat/goal-canary-1']);
    git(['update-ref', 'refs/remotes/origin/main', head]);
    // Simulated external merge completion, in the exact event shape emitted
    // by governed-merge.js. The real status/register consumers run below.
    const decisions = require('../decisions');
    decisions.recordDecision(
      {
        stage: decisions.Stage.COMPLETED,
        workItemId: id,
        status: 'merged',
        detail: 'GOVERNED_MERGE_SUCCESS',
        headSha: head,
        mergeCommitOid: head,
      },
      { dir: decisionDir }
    );
    const resumed = goals.resumeGoal(goalId, options, {
      decisionDir,
      isPidAlive: () => false,
      mockRun: true,
    });
    const pending = [];
    const check = async (name, testOptions, fn) => {
      if (testOptions.todo) pending.push(name);
      await t.test(name, testOptions, fn);
    };
    await check(
      'agy 7: merge propagates MERGED to goal register',
      {},
      () => {
        const status = goals.statusGoal(goalId, options, { decisionDir, isPidAlive: () => false });
        assert.equal(status.items.find((item) => item.workItemId === id).state, 'MERGED');
        assert.match(fs.readFileSync(scopedRegister, 'utf8'), /"GOAL-CANARY-1"[^\n]*"MERGED"/);
      }
    );
    await check(
      'agy 8: canonical row is MERGED and next item opens',
      {},
      () => {
        assert.match(fs.readFileSync(registerPath, 'utf8'), /"GOAL-CANARY-1"[^\n]*"MERGED"/);
        assert.equal(resumed.status, 'RESUMED');
        assert.deepEqual(resumed.skipped, [id]);
        assert.deepEqual(resumed.remaining, ['GOAL-CANARY-2']);
        const selected = next.findNextWorkItem({
          ...options,
          decisionDir,
          forceRegisterRead: true,
        });
        assert.equal(selected.item?.work_item_id, 'GOAL-CANARY-2');
      }
    );
    assert.ok(Date.now() - started < 180000, 'canary exceeded three minutes');
    await t.test('no pending integration links before core merge', () => {
      assert.deepEqual(
        pending,
        [],
        'RED: remove the two todo options only after agy 7/8 land; full pipeline is not PASS'
      );
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
