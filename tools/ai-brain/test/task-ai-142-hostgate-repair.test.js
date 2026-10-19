'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { runOrchestration } = require('../orchestrate');
const { candidateKey } = require('../candidates');
const { getDispatchConfig } = require('../sources');
const { readDecisions } = require('../decisions');

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeCandidate(index) {
  return {
    account: 'acct-' + index,
    accountId: 'acct-' + index,
    quotaScope: 'acct-' + index,
    model: 'model-' + index,
    modelId: 'model-' + index,
    gateway: 'gw',
    upstream: 'up-' + index,
    harness: 'paseo',
    source: 'up-' + index,
    qualifiedRoles: ['author.foundation'],
    capabilities: { contextWindow: 999999 },
  };
}

test('TASK-AI-142 (1): repair prompt only includes narrow tests for gate.failures and truncates output per dispatch config', async () => {
  const root = makeTempDir('hostgate-repair-prompt-');
  const decisionDir = path.join(root, 'decisions');
  fs.mkdirSync(decisionDir, { recursive: true });

  const dispatchConfig = getDispatchConfig();
  const maxOutputChars = dispatchConfig.maxPromptCommandOutputChars;
  assert.ok(maxOutputChars > 0, 'maxPromptCommandOutputChars must be configured in dispatch');

  const longOutput = 'ERROR: test failure details\n' + 'x'.repeat(maxOutputChars * 20);
  const failureName = 'tools/ai-brain/test/task-ai-142-hostgate-repair.test.js > unit test failure';

  let repairPromptSeen = null;
  let runCount = 0;

  await runOrchestration('goal repair prompt', {
    specs: [
      {
        id: 'GOAL-TEST-REPAIR-PROMPT',
        complexity: 'simple',
        riskDomains: [],
        files: [],
        verification: { command: 'node --test tools/ai-brain/test/' },
        allowedPaths: ['tools/ai-brain/test/task-ai-142-hostgate-repair.test.js'],
      },
    ],
    candidates: [makeCandidate(0)],
    cwd: root,
    decisionDir,
    checkpointFile: path.join(root, 'checkpoint.json'),
    maxRepairs: 0,
    maxAttempts: 1,
    hostCwd: root,
    run: (job) => {
      runCount++;
      if (runCount === 2) {
        repairPromptSeen = job.prompt;
      }
      return { exitCode: 0, stdout: JSON.stringify({ id: 'ses-writer' }) };
    },
    hostGate: (() => {
      let calls = 0;
      return () => {
        calls++;
        if (calls === 1) {
          return {
            pass: false,
            command: 'node --test tools/ai-brain/test/',
            failures: [failureName],
            summary: ['✖ ' + failureName, 'ℹ fail 1'],
            output: longOutput,
          };
        }
        return { pass: true, failures: [] };
      };
    })(),
  });

  assert.ok(repairPromptSeen, 'repair worker must be invoked with a compiled repair prompt');
  // 1. Must NOT tell the repair worker to run the entire suite
  assert.doesNotMatch(
    repairPromptSeen,
    /Tests:\s+node\s+--test\s+tools\/ai-brain\/test\/?(?:\s|$)/,
    'repair prompt must not instruct the worker to run the full test suite'
  );
  // 2. Must narrow to the failing test and pattern
  assert.match(
    repairPromptSeen,
    /node --test tools\/ai-brain\/test\/task-ai-142-hostgate-repair\.test\.js --test-name-pattern="unit test failure"/,
    'repair prompt must carry the narrow test command derived from gate.failures'
  );
  // 3. Command output in prompt must be truncated according to maxPromptCommandOutputChars
  assert.match(repairPromptSeen, /Host gate output:/);
  assert.match(repairPromptSeen, /\(truncated\)/);
  assert.ok(
    repairPromptSeen.length < longOutput.length,
    'repair prompt must truncate long gate command output'
  );
  assert.ok(
    !repairPromptSeen.includes('x'.repeat(maxOutputChars + 1)),
    'repair prompt must not contain more than maxPromptCommandOutputChars output characters'
  );
});

test('TASK-AI-142 (2): checkpoint host_gate_failed step and decision record contain failed checks and short summary', async () => {
  const root = makeTempDir('hostgate-repair-record-');
  const checkpointFile = path.join(root, 'checkpoint.json');
  const decisionDir = path.join(root, 'decisions');
  fs.mkdirSync(decisionDir, { recursive: true });

  const failedChecks = ['worker introduced regression', 'tools/ai-brain/test/task-ai-142.test.js'];
  const summaryLines = [
    '✖ worker introduced regression',
    '✖ tools/ai-brain/test/task-ai-142.test.js',
    'ℹ pass 10',
    'ℹ fail 2',
  ];

  let runCount = 0;
  await runOrchestration('goal repair record', {
    specs: [
      {
        id: 'GOAL-TEST-REPAIR-RECORD',
        complexity: 'simple',
        riskDomains: [],
        files: [],
        verification: { command: 'node --test tools/ai-brain/test/' },
        allowedPaths: ['tools/ai-brain/test/task-ai-142-hostgate-repair.test.js'],
      },
    ],
    candidates: [makeCandidate(0)],
    cwd: root,
    decisionDir,
    checkpointFile,
    maxRepairs: 0,
    maxAttempts: 1,
    hostCwd: root,
    run: () => {
      runCount++;
      if (runCount === 1) {
        return { exitCode: 0, stdout: JSON.stringify({ id: 'ses-writer' }) };
      }
      // Repair fails
      return {
        exitCode: 1,
        stderr: 'repair refused',
        stdout: JSON.stringify({ id: 'ses-repair' }),
      };
    },
    hostGate: () => ({
      pass: false,
      command: 'node --test tools/ai-brain/test/',
      failures: failedChecks,
      summary: summaryLines,
      output: summaryLines.join('\n'),
    }),
  });

  // Verify checkpoint
  assert.ok(fs.existsSync(checkpointFile), 'checkpoint file must exist');
  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  const step = checkpoint.liveSteps['GOAL-TEST-REPAIR-RECORD'];
  assert.ok(step, 'checkpoint must record step for work item');
  assert.equal(step.stage, 'host_gate_failed');
  assert.ok(step.failedChecks || step.failures, 'checkpoint must record failedChecks');
  const recordedChecks = step.failedChecks || step.failures;
  assert.deepEqual(recordedChecks, failedChecks, 'failed checks must match gate.failures');
  assert.ok(step.summary, 'checkpoint must record short summary');
  assert.match(step.summary, /worker introduced regression/);

  // Verify decision log
  const records = readDecisions({ dir: decisionDir });
  const failedDecision = records.find(
    (d) => d.stage === 'failed' && d.workItemId === 'GOAL-TEST-REPAIR-RECORD'
  );
  assert.ok(failedDecision, 'a failed decision must be recorded');
  assert.match(
    failedDecision.detail,
    /worker introduced regression/,
    'decision detail must name failed checks'
  );
  assert.ok(
    failedDecision.failedChecks || failedDecision.failures,
    'decision record must have failedChecks or failures'
  );
});

test('TASK-AI-142 (3a): REQUEST_TOO_LARGE at repair does not make item non-retryable when other candidates remain', async () => {
  const root = makeTempDir('hostgate-repair-retryable-');
  const checkpointFile = path.join(root, 'checkpoint.json');
  const decisionDir = path.join(root, 'decisions');
  fs.mkdirSync(decisionDir, { recursive: true });

  let runCount = 0;

  await runOrchestration('goal repair retryable', {
    specs: [
      {
        id: 'GOAL-TEST-RETRYABLE-YES',
        complexity: 'simple',
        riskDomains: [],
        files: [],
        verification: { command: 'node --test tools/ai-brain/test/' },
        allowedPaths: ['tools/ai-brain/test/task-ai-142-hostgate-repair.test.js'],
      },
    ],
    candidates: [makeCandidate(0), makeCandidate(1)],
    cwd: root,
    decisionDir,
    checkpointFile,
    maxRepairs: 0,
    maxAttempts: 1,
    hostCwd: root,
    run: () => {
      runCount++;
      if (runCount === 1) {
        return { exitCode: 0, stdout: JSON.stringify({ id: 'ses-writer' }) };
      }
      // Repair worker killed with REQUEST_TOO_LARGE
      return {
        exitCode: -1,
        stderr:
          'REQUEST_TOO_LARGE: {"type":"tool_use","command":"node --test tools/ai-brain/test/"}; worker was killed',
      };
    },
    hostGate: () => ({
      pass: false,
      command: 'node --test tools/ai-brain/test/',
      failures: ['regression in unit'],
      summary: ['✖ regression in unit'],
      output: '✖ regression in unit',
    }),
  });

  const records = readDecisions({ dir: decisionDir });
  const failedDecision = records.find(
    (d) => d.stage === 'failed' && d.workItemId === 'GOAL-TEST-RETRYABLE-YES'
  );

  assert.ok(failedDecision, 'failed decision must be recorded');
  assert.equal(
    failedDecision.retryable,
    true,
    'REQUEST_TOO_LARGE at repair must keep retryable: true when other candidates remain'
  );

  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  const step = checkpoint.liveSteps['GOAL-TEST-RETRYABLE-YES'];
  assert.equal(
    step.retryable,
    true,
    'checkpoint host_gate_failed step must record retryable: true when candidates remain'
  );
});

test('TASK-AI-142 (3b): REQUEST_TOO_LARGE at repair makes item non-retryable when NO other candidates remain', async () => {
  const root = makeTempDir('hostgate-repair-nonretryable-');
  const checkpointFile = path.join(root, 'checkpoint.json');
  const decisionDir = path.join(root, 'decisions');
  fs.mkdirSync(decisionDir, { recursive: true });

  let runCount = 0;

  await runOrchestration('goal repair nonretryable', {
    specs: [
      {
        id: 'GOAL-TEST-RETRYABLE-NO',
        complexity: 'simple',
        riskDomains: [],
        files: [],
        verification: { command: 'node --test tools/ai-brain/test/' },
        allowedPaths: ['tools/ai-brain/test/task-ai-142-hostgate-repair.test.js'],
      },
    ],
    candidates: [makeCandidate(0)],
    cwd: root,
    decisionDir,
    checkpointFile,
    maxRepairs: 0,
    maxAttempts: 1,
    hostCwd: root,
    run: () => {
      runCount++;
      if (runCount === 1) {
        return { exitCode: 0, stdout: JSON.stringify({ id: 'ses-writer' }) };
      }
      return {
        exitCode: -1,
        stderr: 'REQUEST_TOO_LARGE: tool output exceeded limit',
      };
    },
    hostGate: () => ({
      pass: false,
      command: 'node --test tools/ai-brain/test/',
      failures: ['regression in unit'],
      summary: ['✖ regression in unit'],
      output: '✖ regression in unit',
    }),
  });

  const records = readDecisions({ dir: decisionDir });
  const failedDecision = records.find(
    (d) => d.stage === 'failed' && d.workItemId === 'GOAL-TEST-RETRYABLE-NO'
  );

  assert.ok(failedDecision, 'failed decision must be recorded');
  assert.equal(
    failedDecision.retryable,
    false,
    'REQUEST_TOO_LARGE at repair must be retryable: false when no other candidates remain'
  );

  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  const step = checkpoint.liveSteps['GOAL-TEST-RETRYABLE-NO'];
  assert.equal(
    step.retryable,
    false,
    'checkpoint host_gate_failed step must record retryable: false when no candidates remain'
  );
});
