'use strict';

/**
 * Ship Dễ — TASK-AI-142 Tests:
 * Auto-sync merged PRs to register, goal PR registration in worker, and writer pinpointing
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const reconcile = require('../reconcile');
const pinpoint = require('../pinpoint');
const promptCompiler = require('../prompt-compiler');
const isolationLauncher = require('../isolation-launcher');
const nextRunner = require('../next-runner');

const python = ['python', 'python3'].find(
  (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0
);

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'task-ai-142-sync-pinpoint-'));
}

describe('TASK-AI-142: Register auto-sync, Goal registration, and Pinpointing', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  // --- Item 7: Register Auto-Sync ---
  describe('Item 7: Register Auto-Sync from GitHub merged PRs', () => {
    test('extractWorkItemIdFromPrTitle parses various valid work item formats', () => {
      assert.equal(
        reconcile.extractWorkItemIdFromPrTitle('[TASK-AI-142] Sync merged PRs to register'),
        'TASK-AI-142'
      );
      assert.equal(
        reconcile.extractWorkItemIdFromPrTitle('[FEAT-AUTH-01] Google OAuth implementation'),
        'FEAT-AUTH-01'
      );
      assert.equal(
        reconcile.extractWorkItemIdFromPrTitle('[TASK-FOUND-03] Worker local infrastructure'),
        'TASK-FOUND-03'
      );
      assert.equal(
        reconcile.extractWorkItemIdFromPrTitle('[GOAL-AUTOCLAW-REPOS-1] Pinpointed brief runner'),
        'GOAL-AUTOCLAW-REPOS-1'
      );
      assert.equal(
        reconcile.extractWorkItemIdFromPrTitle('Random title without any work item id'),
        null
      );
      assert.equal(reconcile.extractWorkItemIdFromPrTitle(null), null);
      assert.equal(reconcile.extractWorkItemIdFromPrTitle(123), null);
    });

    test('syncMergedPullRequestsToRegister updates register CSV with merge evidence', () => {
      const regDir = path.join(tempDir, 'docs', 'product-spec', 'docs', '10-ai-collaboration');
      fs.mkdirSync(regDir, { recursive: true });
      const regPath = path.join(regDir, 'FEATURE-DELIVERY-REGISTER.csv');

      const initialCsv =
        [
          '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"',
          '"100","S01","AI","TASK-AI-999","","Feature 999","Key behavior","READY_FOR_AUTHOR","","docs/product-spec/work-items/TASK-AI-999.md","feat/task-ai-999","","",""',
          '"101","S01","AI","TASK-AI-1000","","Feature 1000","Key behavior","BACKLOG","TASK-AI-999","docs/product-spec/work-items/TASK-AI-1000.md","","","",""',
        ].join('\n') + '\n';

      fs.writeFileSync(regPath, initialCsv, 'utf8');

      const mockMergedPrs = [
        {
          number: 400,
          title: '[TASK-AI-999] Feature 999 implementation',
          mergeCommit: { oid: 'c0ffee1234567890abcdef1234567890abcdef12' },
        },
      ];

      const res = reconcile.syncMergedPullRequestsToRegister(
        { rootDir: tempDir, registerPath: regPath },
        { mergedPullRequests: mockMergedPrs }
      );

      assert.equal(res.synced, true);
      assert.equal(res.updatedCount, 1);

      const updatedCsv = fs.readFileSync(regPath, 'utf8');
      assert.ok(updatedCsv.includes('"TASK-AI-999"'));
      assert.ok(updatedCsv.includes('"MERGED"'));
      // A merge is not review evidence: the review verdict column is never invented.
      assert.ok(!updatedCsv.includes('"PASS"'));
      assert.ok(updatedCsv.includes('"c0ffee1234567890abcdef1234567890abcdef12"'));
      // Dependent row unchanged
      assert.ok(updatedCsv.includes('"TASK-AI-1000"'));
      assert.ok(updatedCsv.includes('"BACKLOG"'));
    });

    test('findNextWorkItem triggers syncMergedPullRequestsToRegister', () => {
      const regDir = path.join(tempDir, 'docs', 'product-spec', 'docs', '10-ai-collaboration');
      fs.mkdirSync(regDir, { recursive: true });
      const regPath = path.join(regDir, 'FEATURE-DELIVERY-REGISTER.csv');

      const initialCsv =
        [
          '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"',
          '"1","S01","AI","TASK-AI-101","","Feature 101","Key behavior","READY_FOR_AUTHOR","","docs/product-spec/work-items/TASK-AI-101.md","feat/task-ai-101","","",""',
        ].join('\n') + '\n';

      fs.writeFileSync(regPath, initialCsv, 'utf8');

      const mockMergedPrs = [
        {
          number: 555,
          title: '[TASK-AI-101] Feature 101 merged',
          mergeCommit: { oid: 'abcdef1234567890abcdef1234567890abcdef12' },
        },
      ];

      // Call findNextWorkItem with mergedPullRequests injected
      const result = nextRunner.findNextWorkItem(
        { rootDir: tempDir, registerPath: regPath },
        { mergedPullRequests: mockMergedPrs }
      );

      // Since TASK-AI-101 was synced to MERGED, there should be no runnable items left
      assert.ok(!result.item);

      const updatedCsv = fs.readFileSync(regPath, 'utf8');
      assert.ok(updatedCsv.includes('"MERGED"'));
      assert.ok(updatedCsv.includes('"#555"'));
    });
  });

  // --- Item 8: Goal PR Registration in Worker & CI Contract ---
  describe('Item 8: Goal PR Registration and Contract Validation', () => {
    test('ensureGoalRegistrationInWorker provisions missing spec and register row into workerRoot', () => {
      const hostCwd = path.join(tempDir, 'host');
      const workerRoot = path.join(tempDir, 'worker');

      const regRel = path.join(
        'docs',
        'product-spec',
        'docs',
        '10-ai-collaboration',
        'FEATURE-DELIVERY-REGISTER.csv'
      );
      const hostRegPath = path.join(hostCwd, regRel);
      const workerRegPath = path.join(workerRoot, regRel);

      fs.mkdirSync(path.dirname(hostRegPath), { recursive: true });
      fs.mkdirSync(path.dirname(workerRegPath), { recursive: true });

      const goalItemId = 'GOAL-TEST-1';
      const specRel = path.join('docs', 'product-spec', 'work-items', `${goalItemId}.md`);
      const hostSpecPath = path.join(hostCwd, specRel);
      fs.mkdirSync(path.dirname(hostSpecPath), { recursive: true });
      fs.writeFileSync(hostSpecPath, '# GOAL-TEST-1 spec\n', 'utf8');

      // Host register has the goal row
      const hostCsv =
        [
          '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"',
          `"200","GOAL","Goal: TEST","${goalItemId}","GOAL-TEST","Goal item 1","Outcome","READY_FOR_AUTHOR","","${specRel.replace(/\\/g, '/')}","","","",""`,
        ].join('\n') + '\n';
      fs.writeFileSync(hostRegPath, hostCsv, 'utf8');

      // Worker register does not yet have the goal row (e.g. freshly cloned from origin/main)
      const workerCsv =
        [
          '"delivery_order","slice","group","work_item_id","feature_id","feature_name","key_behavior","status","dependencies","work_item_path","branch","pr","codex_verdict","merge_commit"',
        ].join('\n') + '\n';
      fs.writeFileSync(workerRegPath, workerCsv, 'utf8');

      isolationLauncher.ensureGoalRegistrationInWorker(hostCwd, workerRoot, goalItemId);

      // Verify spec copied
      const workerSpecPath = path.join(workerRoot, specRel);
      assert.ok(fs.existsSync(workerSpecPath));
      assert.equal(fs.readFileSync(workerSpecPath, 'utf8'), '# GOAL-TEST-1 spec\n');

      // Verify row appended to worker register
      const updatedWorkerCsv = fs.readFileSync(workerRegPath, 'utf8');
      assert.ok(updatedWorkerCsv.includes(`"${goalItemId}"`));
      assert.ok(updatedWorkerCsv.includes('"GOAL-TEST"'));
    });

    test('ensureGoalRegistrationInWorker ignores non-goal items', () => {
      const hostCwd = path.join(tempDir, 'host');
      const workerRoot = path.join(tempDir, 'worker');
      fs.mkdirSync(hostCwd, { recursive: true });
      fs.mkdirSync(workerRoot, { recursive: true });

      // Should not throw and do nothing
      isolationLauncher.ensureGoalRegistrationInWorker(hostCwd, workerRoot, 'FEAT-AUTH-01');
      assert.equal(fs.readdirSync(workerRoot).length, 0);
    });

    test(
      'validate_docs.py ignores GOAL-* feature_id to prevent feature-register-extra error',
      { skip: !python },
      () => {
        const script = path.join(
          __dirname,
          '..',
          '..',
          '..',
          'docs',
          'product-spec',
          'scripts',
          'validate_docs.py'
        );
        const res = spawnSync(python, [script], {
          cwd: path.resolve(__dirname, '..', '..', '..'),
          encoding: 'utf8',
        });
        assert.equal(res.status, 0, `validate_docs.py failed: ${res.stdout}\n${res.stderr}`);
      }
    );
  });

  // --- Item 9: Pre-writer Target Pinpointing ---
  describe('Item 9: Pinpointing pre-step', () => {
    test('extractKeywords extracts salient identifiers and filters stop words', () => {
      const keywords = pinpoint.extractKeywords([
        'Ensure the syncMergedPullRequestsToRegister function should return a status object with updatedCount',
        'validate_pr_contract passes without errors',
      ]);
      assert.ok(keywords.includes('syncMergedPullRequestsToRegister'));
      assert.ok(keywords.includes('updatedCount'));
      assert.ok(keywords.includes('validate_pr_contract'));
      assert.ok(!keywords.includes('the'));
      assert.ok(!keywords.includes('should'));
      assert.ok(!keywords.includes('with'));
    });

    test('extractExplicitLocations parses explicit file:line annotations', () => {
      const text = `
Some spec background.
Target location: tools/ai-brain/goals.js:800-850
Other file:
Chỗ: tools/ai-brain/reconcile.js:900
`;
      const locations = pinpoint.extractExplicitLocations(text);
      assert.equal(locations.length, 2);
      assert.equal(locations[0].file, 'tools/ai-brain/goals.js');
      assert.equal(locations[0].startLine, 800);
      assert.equal(locations[0].endLine, 850);
      assert.equal(locations[1].file, 'tools/ai-brain/reconcile.js');
      assert.equal(locations[1].startLine, 900);
      assert.equal(locations[1].endLine, 900);
    });

    test('scanFileForRanges clusters keyword matches into contiguous ranges', () => {
      const testFile = path.join(tempDir, 'sample.js');
      const lines = [
        '// line 1',
        'function alpha() {',
        '  return 1;',
        '}',
        '// line 5',
        '// line 6',
        'function beta() {',
        '  console.log("something");',
        '  return alpha();',
        '}',
      ];
      fs.writeFileSync(testFile, lines.join('\n'), 'utf8');

      const ranges = pinpoint.scanFileForRanges(testFile, ['alpha']);
      assert.ok(ranges.length > 0);
      // First range covers around line 2
      assert.ok(ranges[0].startLine <= 2 && ranges[0].endLine >= 2);
      assert.ok(ranges[0].symbols.includes('alpha'));
    });

    test('pinpointTarget builds target locations and formatted brief', () => {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      const targetFile = path.join(srcDir, 'handler.js');
      fs.writeFileSync(
        targetFile,
        '// Header\nfunction processPayment(orderId) {\n  return executePayment(orderId);\n}\n',
        'utf8'
      );

      const item = {
        id: 'TASK-AI-142',
        title: 'Fix processPayment',
        businessOutcome: 'Ensure processPayment handles orderId correctly',
        allowedPaths: ['src/handler.js', 'src/new-helper.js'],
        acceptanceCriteria: ['processPayment passes verification'],
      };

      const result = pinpoint.pinpointTarget(item, { rootDir: tempDir });
      assert.equal(result.workItemId, 'TASK-AI-142');
      assert.equal(result.locations.length, 2);

      const existingLoc = result.locations.find((l) => l.file === 'src/handler.js');
      assert.ok(existingLoc);
      assert.equal(existingLoc.action, 'EDIT');

      const newLoc = result.locations.find((l) => l.file === 'src/new-helper.js');
      assert.ok(newLoc);
      assert.equal(newLoc.action, 'CREATE');

      assert.ok(result.promptHeader.includes('=== TARGET LOCATION & PINPOINTED BRIEF ==='));
      assert.ok(result.promptHeader.includes('src/handler.js'));
      assert.ok(result.promptHeader.includes('src/new-helper.js (New file to create)'));
    });

    test('compilePrompt includes pinpointed brief and goal registration rules', () => {
      const item = {
        id: 'GOAL-TEST-1',
        title: 'Test goal prompt',
        roleRequirement: { role: 'author.foundation' },
        allowedPaths: ['tools/ai-brain/goals.js'],
        acceptanceCriteria: ['Goal passes CI'],
      };

      const prompt = promptCompiler.compilePrompt(item, {
        rootDir: tempDir,
        goal: 'TEST',
        branch: 'feat/goal-test-1',
      });

      // Pinpoint section
      assert.ok(prompt.includes('=== TARGET LOCATION & PINPOINTED BRIEF ==='));

      // Allowed files include FEATURE-DELIVERY-REGISTER.csv and spec file for goal
      assert.ok(
        prompt.includes('docs/product-spec/docs/10-ai-collaboration/FEATURE-DELIVERY-REGISTER.csv')
      );
      assert.ok(prompt.includes('docs/product-spec/work-items/GOAL-TEST-1.md'));

      // Registration requirement note
      assert.ok(prompt.includes('Registration requirement: you must stage and commit'));
    });
  });
});
